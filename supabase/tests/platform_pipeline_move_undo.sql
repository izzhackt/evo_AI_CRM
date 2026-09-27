\set ON_ERROR_STOP on
-- Boundary suite for migration 251 (Э7 «Отменить» на доске поступления с
-- проверкой версии): platform.student_cases.pipeline_version, the trigger
-- student_cases_pipeline_version and platform.move_case_pipeline_v2.
-- Members are modelled like production, with the fixtures of 244/250: invited
-- staff have organization_memberships.current_role NULL and
-- current_bundle_id NULL (current_actor_authority().platform_role is NULL, the
-- JWT says 'staff'); permissions come only from scoped role assignments with
-- the production permission keys (26.09 read-only audit): Admissions (own
-- scope), Admissions Manager (department), Sales Manager (department) and the
-- two «общие разделы» roles (organization). Only the system Admin carries the
-- coarse role.
-- Proves: every existing case reads version 1; v1 of the running release
-- bumps the version; v2 allows and refuses exactly like v1 (allowed curator,
-- department manager and Admin; another curator, a case outside the
-- department, Sales Manager, the Student, no membership and anon refused);
-- request-id replay (shared with v1) before the version check; the undo
-- succeeds when nobody moved the case; case_pipeline_moved (PT409) with the
-- current position when someone moved it in between — also away and back to
-- the same stage — and nothing is written; removal and «Вернуть в воронку»
-- with a version; only position changes bump; a direct write of the version is
-- put back; definer, search path and grants.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action. Style follows platform_access_by_permissions.sql.
BEGIN;

DO $n251_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n251_auth_role$;

CREATE FUNCTION pg_temp.n251_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n251_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N251: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n251_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The refusal of a v2 call: SQLSTATE, message and, for PT409, the DETAIL as JSON.
CREATE FUNCTION pg_temp.n251_refusal(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE state TEXT; message TEXT; detail TEXT;
BEGIN
  EXECUTE sql; RETURN jsonb_build_object('state', 'ok');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT, detail = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('state', state, 'message', message,
    'detail', CASE WHEN state = 'PT409' THEN detail::JSONB ELSE to_jsonb(NULLIF(detail, '')) END);
END
$$;
-- A v2 call as SQL text: stage (NULL = remove), request number, expected version (NULL = none).
CREATE FUNCTION pg_temp.n251_v2(p_case INTEGER, p_stage TEXT, p_request INTEGER, p_expected BIGINT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.move_case_pipeline_v2(%L, %L, %L, %L, %L, %L)', pg_temp.n251_id(1), pg_temp.n251_id(p_case),
    p_stage, p_stage IS NULL, pg_temp.n251_id(p_request), p_expected)
$$;
-- The board position of a case: stage:hidden:version.
CREATE FUNCTION pg_temp.n251_position(p_case INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT pipeline_stage || ':' || (pipeline_hidden_at IS NOT NULL)::TEXT || ':' || pipeline_version::TEXT
  FROM platform.student_cases WHERE id = pg_temp.n251_id(p_case)
$$;
CREATE FUNCTION pg_temp.n251_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.n251_id(x) ORDER BY pg_temp.n251_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n251_id(INTEGER), pg_temp.n251_assert(BOOLEAN, TEXT), pg_temp.n251_error(TEXT),
  pg_temp.n251_refusal(TEXT), pg_temp.n251_v2(INTEGER, TEXT, INTEGER, BIGINT), pg_temp.n251_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N251_PIPELINE_MOVE_UNDO_SUITE_START' AS n251_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture (244's shape). 1 Admin (system); invited staff with coarse role
-- NULL: 2 Sales Manager (sales department), 3 Admissions Manager, 4
-- Admissions A, 6 Admissions B (admissions department); 5 Student (case 505).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n251_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n251_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL);
GRANT SELECT ON n251_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n251_id(1), 'N251 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n251_id(100 + n), 'n251-' || n || '@example.invalid', '{}'::JSONB FROM n251_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n251_id(199), 'n251-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n251_id(200 + n), pg_temp.n251_id(100 + n), 'N251 Actor ' || n, 'active', 1 FROM n251_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n251_id(300 + n), pg_temp.n251_id(1), pg_temp.n251_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n251_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n251_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n251_id(401), pg_temp.n251_id(1), 'organization', pg_temp.n251_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n251_id(1), pg_temp.n251_id(301), pg_temp.n251_id(401), 1, 1, TRUE, 'system',
    'N251 synthetic organization scope', pg_temp.n251_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n251_id(901), pg_temp.n251_id(1), 'N251 Sales'),
  (pg_temp.n251_id(902), pg_temp.n251_id(1), 'N251 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n251_id(1), pg_temp.n251_id(302), pg_temp.n251_id(901)),
  (pg_temp.n251_id(1), pg_temp.n251_id(303), pg_temp.n251_id(902)),
  (pg_temp.n251_id(1), pg_temp.n251_id(304), pg_temp.n251_id(902)),
  (pg_temp.n251_id(1), pg_temp.n251_id(306), pg_temp.n251_id(902));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin (outside the admissions department); 504 pending (not on the
-- board); 505 active, curator A, the Student's own case. Inserted like 244's
-- fixture (replica), so they read the column default: version 1.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n251_id(420 + k), pg_temp.n251_id(1), 'student_case', pg_temp.n251_id(500 + k), 1
  FROM generate_series(1, 5) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.n251_id(500 + f.k), pg_temp.n251_id(1), pg_temp.n251_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n251_id(f.curator) END,
  'synthetic:n251:' || f.k, 'N251 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  pg_temp.n251_id(420 + f.k), 1, 'new',
  CASE f.k WHEN 5 THEN pg_temp.n251_id(305) END,
  CASE WHEN f.k = 5 THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, NULL, 'pending'), (5, 304, 'active'))
  AS f(k, curator, state);
SET LOCAL session_replication_role = origin;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n251_id(1), pg_temp.n251_id(305), pg_temp.n251_id(401), 1, 1, TRUE, 'system',
    'N251 synthetic Student organization scope', pg_temp.n251_id(604)),
  (pg_temp.n251_id(1), pg_temp.n251_id(305), pg_temp.n251_id(425), 1, 1, TRUE, 'system',
    'N251 synthetic Student case scope', pg_temp.n251_id(605));

-- Roles with the EXACT production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE n251_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n251_roles VALUES
 (pg_temp.n251_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n251_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n251_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n251_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n251_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n251_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n251_grants VALUES
 (302, pg_temp.n251_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n251_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n251_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n251_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n251_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n251_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n251_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n251_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n251_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n251_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n251_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n251_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n251_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n251_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n251_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n251_id(1);
GRANT SELECT ON n251_roles, n251_grants, n251_versions TO authenticated;

SELECT pg_temp.n251_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n251_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n251_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n251_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n251_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n251_admin_setup';
SET LOCAL ROLE authenticated;
DO $n251_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n251_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n251_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N251 ' || r.label, 'description', 'Migration 251 synthetic role',
        'permissionKeys', r.keys), 'N251 create role', pg_temp.n251_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n251_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n251_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N251 publish role', pg_temp.n251_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n251_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n251_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n251_id(1), pg_temp.n251_id(m),
      (SELECT access_version FROM n251_versions WHERE membership_id = pg_temp.n251_id(m)), items, bindings,
      'N251 grant roles', pg_temp.n251_id(2000 + m));
  END LOOP;
END
$n251_roles$;
RESET ROLE;

UPDATE n251_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n251_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n251_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n251_admin FROM n251_actors WHERE n = 1 \gset
SELECT claims AS n251_sales_manager FROM n251_actors WHERE n = 2 \gset
SELECT claims AS n251_admissions_manager FROM n251_actors WHERE n = 3 \gset
SELECT claims AS n251_admissions_a FROM n251_actors WHERE n = 4 \gset
SELECT claims AS n251_student FROM n251_actors WHERE n = 5 \gset
SELECT claims AS n251_admissions_b FROM n251_actors WHERE n = 6 \gset
SELECT jsonb_build_object('sub', pg_temp.n251_id(199), 'role', 'authenticated')::TEXT AS n251_no_member \gset
SELECT pg_temp.n251_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n251_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n251_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n251_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n251_ids(302, 303, 304, 306))), 'invited members have coarse role and bundle NULL');

-- ---------------------------------------------------------------------------
-- 1. The column: every existing case reads version 1.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n251_assert((SELECT bool_and(pipeline_version = 1) AND count(*) = 5 FROM platform.student_cases
  WHERE organization_id = pg_temp.n251_id(1)), 'existing cases read the default version 1');
SELECT pg_temp.n251_assert((SELECT format_type(a.atttypid, a.atttypmod) = 'bigint' AND a.attnotnull
    AND pg_get_expr(d.adbin, d.adrelid) = '1'
  FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'platform.student_cases'::REGCLASS AND a.attname = 'pipeline_version'),
  'pipeline_version BIGINT NOT NULL DEFAULT 1');
SELECT pg_temp.n251_assert(pg_temp.n251_error(format(
  'UPDATE platform.student_cases SET pipeline_version = 0 WHERE id = %L', pg_temp.n251_id(501))) = 'ok'
  AND pg_temp.n251_position(501) = 'new:false:1', 'a direct write of the version (even an invalid one) is put back');

-- ---------------------------------------------------------------------------
-- 2. v1 of the running release bumps the version too.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v1(pg_temp.n251_id(1), pg_temp.n251_id(501), 'shortlist', FALSE,
  pg_temp.n251_id(3001)) AS n251_v1_receipt \gset
RESET ROLE;
SELECT pg_temp.n251_assert(:'n251_v1_receipt'::JSONB = jsonb_build_object('student_case_id', pg_temp.n251_id(501),
  'pipeline_stage', 'shortlist', 'pipeline_hidden', FALSE, 'request_id', pg_temp.n251_id(3001)),
  'v1 is unchanged: its receipt has no version');
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'shortlist:false:2', 'a v1 move bumps the version (trigger)');

-- ---------------------------------------------------------------------------
-- 3. v2 without an expected version is v1's move; replay is shared with v1.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'documents', FALSE,
  pg_temp.n251_id(3002)) AS n251_move \gset
SELECT pg_temp.n251_assert(:'n251_move'::JSONB = jsonb_build_object('student_case_id', pg_temp.n251_id(501),
  'pipeline_stage', 'documents', 'pipeline_hidden', FALSE, 'pipeline_version', 3, 'request_id', pg_temp.n251_id(3002)),
  'Admissions A moves the own case; the receipt carries the new version');
SELECT pg_temp.n251_assert(platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'documents', FALSE,
  pg_temp.n251_id(3002)) = :'n251_move'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'visa', 3002, NULL))
  = '22023:case_pipeline_request_id_conflict', 'the same request id for another stage is a request conflict');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'documents', 3002, 3))
  = '22023:case_pipeline_request_id_conflict', 'the same request id with an expected version is another command');
SELECT pg_temp.n251_assert(platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'shortlist', FALSE,
  pg_temp.n251_id(3001)) = :'n251_v1_receipt'::JSONB,
  'a v1 request id replayed through v2 without a version is the same command (same fingerprint)');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'documents:false:3', 'replays and refusals changed nothing');

-- ---------------------------------------------------------------------------
-- 4. The undo succeeds when nobody moved the case.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'shortlist', FALSE,
  pg_temp.n251_id(3003), 3) AS n251_undo \gset
SELECT pg_temp.n251_assert((:'n251_undo'::JSONB ->> 'pipeline_stage') = 'shortlist'
  AND (:'n251_undo'::JSONB ->> 'pipeline_version')::BIGINT = 4, 'the undo with the version of the own move is accepted');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'shortlist:false:4', 'the case is back where it was');

-- ---------------------------------------------------------------------------
-- 5. Someone moved the case in between: refused with the current position.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'ready_to_submit', FALSE,
  pg_temp.n251_id(3004)) ->> 'pipeline_version')::BIGINT = 5, 'Admissions A moves 501 (version 5)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'awaiting_decision', FALSE,
  pg_temp.n251_id(3005)) ->> 'pipeline_version')::BIGINT = 6, 'the Admissions Manager moves it on (version 6)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_refusal(pg_temp.n251_v2(501, 'documents', 3006, 5)) AS n251_moved \gset
SELECT pg_temp.n251_assert(:'n251_moved'::JSONB = jsonb_build_object('state', 'PT409', 'message', 'case_pipeline_moved',
  'detail', jsonb_build_object('pipeline_stage', 'awaiting_decision', 'pipeline_hidden', FALSE, 'pipeline_version', 6)),
  'the undo of the own move is refused with the position the Manager left');
SELECT pg_temp.n251_assert(pg_temp.n251_refusal(pg_temp.n251_v2(501, 'documents', 3006, 5)) = :'n251_moved'::JSONB,
  'a retry with the same request id is refused again (a refusal is not a receipt)');
SELECT pg_temp.n251_assert(platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(501), 'shortlist', FALSE,
  pg_temp.n251_id(3003), 3) = :'n251_undo'::JSONB,
  'an accepted undo replays its receipt before the version check, although the version moved on');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'awaiting_decision:false:6', 'the refused undo wrote nothing');
SELECT pg_temp.n251_assert(NOT EXISTS (SELECT 1 FROM platform_private.case_pipeline_requests
    WHERE organization_id = pg_temp.n251_id(1) AND request_id = pg_temp.n251_id(3006))
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.n251_id(3006)),
  'no receipt and no journal row for the refused undo');

-- Away and back to the same stage is still a move in between.
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(505), 'documents', FALSE,
  pg_temp.n251_id(3007)) ->> 'pipeline_version')::BIGINT = 2, 'Admissions A moves 505 (version 2)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(505), 'visa', FALSE, pg_temp.n251_id(3008));
SELECT platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(505), 'documents', FALSE, pg_temp.n251_id(3009));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_refusal(pg_temp.n251_v2(505, 'new', 3010, 2)) = jsonb_build_object('state', 'PT409',
  'message', 'case_pipeline_moved',
  'detail', jsonb_build_object('pipeline_stage', 'documents', 'pipeline_hidden', FALSE, 'pipeline_version', 4)),
  'the same stage after a move away and back is refused: the version, not the stage, decides');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(505) = 'documents:false:4', 'the refused undo left 505 as the Manager did');

-- ---------------------------------------------------------------------------
-- 6. Removal and «Вернуть в воронку» with a version.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(502), NULL, TRUE, pg_temp.n251_id(3011)) AS n251_removed \gset
SELECT pg_temp.n251_assert((:'n251_removed'::JSONB ->> 'pipeline_hidden')::BOOLEAN
  AND (:'n251_removed'::JSONB ->> 'pipeline_version')::BIGINT = 2, 'the removal hides the case and bumps the version');
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(502), 'new', FALSE,
  pg_temp.n251_id(3012), 2) ->> 'pipeline_version')::BIGINT = 3, '«Вернуть в воронку» with the removal''s version is accepted');
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(502), NULL, TRUE,
  pg_temp.n251_id(3013)) ->> 'pipeline_version')::BIGINT = 4, 'removed again (version 4)');
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(502), NULL, TRUE,
  pg_temp.n251_id(3014)) ->> 'pipeline_version')::BIGINT = 4, 'removing a hidden case again is no position change: no bump');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v1(pg_temp.n251_id(1), pg_temp.n251_id(502), 'visa', FALSE,
  pg_temp.n251_id(3015)) ->> 'pipeline_stage') = 'visa', 'the Admin brings it back from a stale board through v1');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_refusal(pg_temp.n251_v2(502, 'new', 3016, 4)) = jsonb_build_object('state', 'PT409',
  'message', 'case_pipeline_moved',
  'detail', jsonb_build_object('pipeline_stage', 'visa', 'pipeline_hidden', FALSE, 'pipeline_version', 5)),
  '«Вернуть в воронку» after someone else''s move is refused with the case back on the board');
-- A move to the current stage with the current version: accepted, no bump.
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(502), 'visa', FALSE,
  pg_temp.n251_id(3017), 5) ->> 'pipeline_version')::BIGINT = 5, 'a move to the same stage is not a position change');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(502) = 'visa:false:5', '502 stays where the Admin put it');

-- ---------------------------------------------------------------------------
-- 7. Only position changes bump; the version is not writable.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET student_display_name = 'N251 Student 501 renamed', updated_at = clock_timestamp()
  WHERE id = pg_temp.n251_id(501);
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'awaiting_decision:false:6', 'another edit of the case keeps the version');
UPDATE platform.student_cases SET pipeline_version = 1 WHERE id = pg_temp.n251_id(501);
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'awaiting_decision:false:6', 'a direct write of the version is put back');
UPDATE platform.student_cases SET pipeline_stage = 'confirmed', pipeline_version = 1 WHERE id = pg_temp.n251_id(501);
SELECT pg_temp.n251_assert(pg_temp.n251_position(501) = 'confirmed:false:7', 'any position change bumps from the stored version');

-- ---------------------------------------------------------------------------
-- 8. Allowed and refused exactly like v1 after 244; no position leaks.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n251_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(502, 'shortlist', 3101, NULL)) = '42501:case_pipeline_forbidden',
  'Admissions A cannot move the case of Admissions B (own scope)');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(502, 'shortlist', 3102, 1)) = '42501:case_pipeline_forbidden',
  'a stale version on a case the actor may not move is forbidden, not PT409: no position leaks');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(503, 'shortlist', 3103, NULL)) = '42501:case_pipeline_forbidden',
  'Admissions A cannot move the Admin''s case');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'shortlist', 3104, 0)) = '22023:case_pipeline_invalid_command',
  'an expected version below 1 is an invalid command');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(503, 'shortlist', 3105, NULL)) = '42501:case_pipeline_forbidden',
  'the Admissions Manager cannot move a case outside the department');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'shortlist', 3106, NULL)) = '42501:case_pipeline_forbidden',
  'the Sales Manager cannot move (no case.update.append), even the case it sold');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'bogus', 3107, 0)) = '42501:case_pipeline_forbidden',
  'the Sales Manager is refused before input validation, as with v1');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(505, 'shortlist', 3108, 4)) = '42501:case_pipeline_forbidden',
  'the Student cannot move the own case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'shortlist', 3109, NULL)) = '42501:case_pipeline_forbidden',
  'an authenticated user without membership cannot move');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(501, 'shortlist', 3110, NULL)) LIKE '42501:permission denied for %',
  'anon cannot execute v2');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n251_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n251_assert((platform.move_case_pipeline_v2(pg_temp.n251_id(1), pg_temp.n251_id(503), 'visa', FALSE,
  pg_temp.n251_id(3111), 1) ->> 'pipeline_version')::BIGINT = 2, 'the Admin moves any case with its version');
SELECT pg_temp.n251_assert(pg_temp.n251_error(pg_temp.n251_v2(504, 'shortlist', 3112, NULL))
  = '22023:Case is not active in this pipeline', 'a pending case is not on the board, as with v1');
RESET ROLE;
SELECT pg_temp.n251_assert(pg_temp.n251_position(503) = 'visa:false:2' AND pg_temp.n251_position(504) = 'new:false:1',
  'only the allowed move changed 503; 504 untouched');

-- ---------------------------------------------------------------------------
-- 9. Journal: each accepted move once under its actor; refusals never.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n251_assert((SELECT array_agg(right(request_id::TEXT, 4) || ':' || right(actor_profile_id::TEXT, 3) ORDER BY request_id)
  FROM platform.audit_events WHERE action = 'case.pipeline.move' AND organization_id = pg_temp.n251_id(1))
  = ARRAY['3001:204', '3002:204', '3003:204', '3004:204', '3005:203', '3007:204', '3008:203', '3009:203',
    '3011:203', '3012:203', '3013:203', '3014:203', '3015:201', '3017:203', '3111:201'],
  'each accepted move is journaled once under its actor; replays and refusals are not');
SELECT pg_temp.n251_assert((SELECT before_state ? 'pipeline_stage' AND NOT before_state ? 'pipeline_version'
    AND after_state = jsonb_build_object('pipeline_stage', 'shortlist', 'pipeline_hidden', FALSE)
  FROM platform.audit_events WHERE request_id = pg_temp.n251_id(3003)), 'the journal row keeps v1''s shape');

-- ---------------------------------------------------------------------------
-- 10. Definer, search path and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n251_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND p.prosrc !~ 'platform_role\s*(NOT\s+)?IN\s*\(' AND p.prosrc !~ 'platform_role\s*<>'
  FROM pg_proc p WHERE p.oid = 'platform.move_case_pipeline_v2(uuid,uuid,text,boolean,uuid,bigint)'::REGPROCEDURE),
  'v2: SECURITY DEFINER, empty search_path, authenticated-only EXECUTE, no coarse-role gate');
SELECT pg_temp.n251_assert((SELECT p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform_private.bump_case_pipeline_version()'::REGPROCEDURE),
  'the trigger function is private with an empty search_path');
SELECT pg_temp.n251_assert((SELECT strpos(p.prosrc, 'pipeline_version') = 0
  FROM pg_proc p WHERE p.oid = 'platform.move_case_pipeline_v1(uuid,uuid,text,boolean,uuid)'::REGPROCEDURE),
  'v1 is untouched');

SELECT 'N251_PIPELINE_MOVE_UNDO_SUITE_PASS' AS n251_suite_marker;
ROLLBACK;
