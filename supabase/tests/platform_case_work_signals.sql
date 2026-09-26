\set ON_ERROR_STOP on
-- Boundary suite for migration 245 («Требуют действия» и «Ждём студента» по
-- правде, решение владельца 26.09.2026). Members are modelled like
-- production after 155 and 244 (the fixture of
-- platform_access_by_permissions.sql): invited staff have
-- organization_memberships.current_role NULL and current_bundle_id NULL, so
-- current_actor_authority().platform_role is NULL; permissions come only from
-- scoped role assignments with the production permission keys — Admissions
-- (own scope), Admissions Manager (department scope), Sales Manager. Only
-- the system Admin carries the coarse role; the Student has an own active
-- portal case.
-- Proves:
--  * «Требуют действия» (needs_action) rows and counts include an active case
--    with no next step and an active or pending case whose chat waits for a
--    staff answer; a closed case never; tab counts equal the rows for every
--    view; the rows stay inside the actor's visible set (no widening);
--  * each row returns needs_reply; attention_flags stay 182's (no queue-only
--    signal leaks into them);
--  * a staff post sets awaiting_student with await_set_by/await_set_at, an
--    explicit state in the same command wins, a student post sets
--    needs_reply and keeps the last explicit marker, set_await is unchanged;
--  * post idempotency is unchanged (exact replay = same receipt, no second
--    message; another payload under the same request id = 40001) and a bad
--    state is 22023 with nothing written; authority is unchanged (another
--    curator 42501; Sales Manager, Student, anon refused on the reads).
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n245_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n245_auth_role$;

CREATE FUNCTION pg_temp.n245_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n245_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N245: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n245_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.n245_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n245_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.n245_id(x) ORDER BY pg_temp.n245_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n245_id(INTEGER), pg_temp.n245_assert(BOOLEAN, TEXT),
  pg_temp.n245_error(TEXT), pg_temp.n245_case_ids(JSONB), pg_temp.n245_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N245_CASE_WORK_SIGNALS_SUITE_START' AS n245_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager, 3 Admissions Manager, 4 Admissions A, 6 Admissions B
-- (admissions department); 5 Student (own active portal case 505).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n245_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n245_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL);
GRANT SELECT ON n245_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n245_id(1), 'N245 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n245_id(100 + n), 'n245-' || n || '@example.invalid', '{}'::JSONB FROM n245_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n245_id(200 + n), pg_temp.n245_id(100 + n), 'N245 Actor ' || n, 'active', 1 FROM n245_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n245_id(300 + n), pg_temp.n245_id(1), pg_temp.n245_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n245_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n245_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n245_id(401), pg_temp.n245_id(1), 'organization', pg_temp.n245_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n245_id(1), pg_temp.n245_id(301), pg_temp.n245_id(401), 1, 1, TRUE, 'system',
    'N245 synthetic organization scope', pg_temp.n245_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n245_id(901), pg_temp.n245_id(1), 'N245 Sales'),
  (pg_temp.n245_id(902), pg_temp.n245_id(1), 'N245 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n245_id(1), pg_temp.n245_id(302), pg_temp.n245_id(901)),
  (pg_temp.n245_id(1), pg_temp.n245_id(303), pg_temp.n245_id(902)),
  (pg_temp.n245_id(1), pg_temp.n245_id(304), pg_temp.n245_id(902)),
  (pg_temp.n245_id(1), pg_temp.n245_id(306), pg_temp.n245_id(902));

-- Cases (step due dates are in the future, so no 'overdue' flag interferes):
-- 501 active, curator A, step set;       502 active, curator B, NO step;
-- 503 active, curator Admin, step set, chat waits for staff (a student message);
-- 504 pending, no curator, no sale, chat waits for staff;
-- 505 active, curator A, step set, the Student's own portal case, no chat yet;
-- 506 closed, curator A, chat waits for staff;
-- 507 pending, no curator, no step, no chat (a pending case has no step by
--     design: it must not count as «нет шага»).
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n245_id(420 + k), pg_temp.n245_id(1), 'student_case', pg_temp.n245_id(500 + k), 1
  FROM generate_series(1, 7) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at,
  next_action, next_action_due_on)
SELECT pg_temp.n245_id(500 + f.k), pg_temp.n245_id(1), pg_temp.n245_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n245_id(f.curator) END,
  'synthetic:n245:' || f.k, 'N245 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END,
  pg_temp.n245_id(420 + f.k), 1, 'documents',
  CASE f.k WHEN 5 THEN pg_temp.n245_id(305) END,
  CASE WHEN f.k = 5 THEN clock_timestamp() END,
  f.step, CASE WHEN f.step IS NULL THEN NULL ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE + 7 END
FROM (VALUES
  (1, 304, 'active', 'N245 step one'),
  (2, 306, 'active', NULL),
  (3, 301, 'active', 'N245 step three'),
  (4, NULL, 'pending', NULL),
  (5, 304, 'active', 'N245 step five'),
  (6, 304, 'closed', 'N245 step six'),
  (7, NULL, 'pending', NULL)) AS f(k, curator, state, step);
SET LOCAL session_replication_role = origin;
-- A chat already waiting for staff: the thread row a student post leaves
-- behind (portal_case_chat_post_v1 writes exactly this shape).
INSERT INTO platform.case_chat_threads(organization_id, student_case_id, await_state)
  SELECT pg_temp.n245_id(1), pg_temp.n245_id(500 + k), 'needs_reply' FROM unnest(ARRAY[3, 4, 6]) AS k;
-- The Student signs in and reads only the own case (the provisioned portal shape).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n245_id(1), pg_temp.n245_id(305), pg_temp.n245_id(401), 1, 1, TRUE, 'system',
    'N245 synthetic Student organization scope', pg_temp.n245_id(604)),
  (pg_temp.n245_id(1), pg_temp.n245_id(305), pg_temp.n245_id(425), 1, 1, TRUE, 'system',
    'N245 synthetic Student case scope', pg_temp.n245_id(605));

-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE n245_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n245_roles VALUES
 (pg_temp.n245_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n245_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n245_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n245_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n245_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n245_grants VALUES
 (302, pg_temp.n245_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n245_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n245_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n245_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n245_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n245_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n245_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n245_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n245_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n245_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n245_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n245_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n245_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n245_id(1);
GRANT SELECT ON n245_roles, n245_grants, n245_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n245_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n245_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n245_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n245_admin_setup';
SET LOCAL ROLE authenticated;
DO $n245_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n245_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n245_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N245 ' || r.label, 'description', 'Migration 245 synthetic role',
        'permissionKeys', r.keys), 'N245 create role', pg_temp.n245_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n245_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n245_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N245 publish role', pg_temp.n245_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n245_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n245_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n245_id(1), pg_temp.n245_id(m),
      (SELECT access_version FROM n245_versions WHERE membership_id = pg_temp.n245_id(m)), items, bindings,
      'N245 grant roles', pg_temp.n245_id(2000 + m));
  END LOOP;
END
$n245_roles$;
RESET ROLE;

UPDATE n245_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n245_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n245_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n245_admin FROM n245_actors WHERE n = 1 \gset
SELECT claims AS n245_sales_manager FROM n245_actors WHERE n = 2 \gset
SELECT claims AS n245_admissions_manager FROM n245_actors WHERE n = 3 \gset
SELECT claims AS n245_admissions_a FROM n245_actors WHERE n = 4 \gset
SELECT claims AS n245_student FROM n245_actors WHERE n = 5 \gset
SELECT claims AS n245_admissions_b FROM n245_actors WHERE n = 6 \gset
SELECT pg_temp.n245_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n245_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n245_ids(302, 303, 304, 306))), 'invited members have coarse role and bundle NULL');

-- ---------------------------------------------------------------------------
-- Helpers: «Требуют действия» for the current actor, checked against the
-- actor's own visibility; counts equal rows for every view.
-- ---------------------------------------------------------------------------
-- The thread state as the database holds it (the test reads it as the owner,
-- the queue reads it through its own SECURITY DEFINER helper).
CREATE FUNCTION pg_temp.n245_waits(p_case UUID) RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.case_chat_threads t WHERE t.student_case_id = p_case AND t.await_state = 'needs_reply')
$$;
CREATE FUNCTION pg_temp.n245_needs_action() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT pg_temp.n245_case_ids(platform.staff_student_case_queue_v1('needs_action', 100) -> 'rows')
$$;
-- p_visible_only: the expected set is the organization-wide one, narrowed to
-- what this actor can read (department scope); otherwise it is exact.
CREATE FUNCTION pg_temp.n245_check(p_label TEXT, p_expected UUID[], p_visible_only BOOLEAN DEFAULT FALSE) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE page JSONB; counts JSONB; visible UUID[]; expected UUID[]; row JSONB; view_key TEXT; rows_count INTEGER;
BEGIN
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::UUID[]) INTO visible FROM platform.student_cases c
    WHERE c.organization_id = pg_temp.n245_id(1) AND private.platform_can_read_student_case(c.organization_id, c.id);
  expected := CASE WHEN p_visible_only
    THEN (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::UUID[]) FROM unnest(p_expected) AS x WHERE x = ANY (visible))
    ELSE p_expected END;
  page := platform.staff_student_case_queue_v1('needs_action', 100);
  PERFORM pg_temp.n245_assert(pg_temp.n245_case_ids(page -> 'rows') = expected,
    p_label || ': needs_action rows ' || pg_temp.n245_case_ids(page -> 'rows')::TEXT || ' = ' || expected::TEXT);
  PERFORM pg_temp.n245_assert(pg_temp.n245_case_ids(page -> 'rows') <@ visible, p_label || ': rows stay inside the visible set');
  FOR row IN SELECT * FROM jsonb_array_elements(page -> 'rows') LOOP
    PERFORM pg_temp.n245_assert(jsonb_typeof(row -> 'needs_reply') = 'boolean'
      AND (row ->> 'needs_reply')::BOOLEAN = pg_temp.n245_waits((row ->> 'student_case_id')::UUID),
      p_label || ': needs_reply is the thread state');
    PERFORM pg_temp.n245_assert(NOT (row -> 'attention_flags') ?| ARRAY['no_step', 'needs_reply'],
      p_label || ': attention_flags stay 182''s');
  END LOOP;
  FOREACH view_key IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending'] LOOP
    counts := platform.staff_student_case_queue_counts_v1(view_key);
    rows_count := jsonb_array_length(platform.staff_student_case_queue_v1(view_key, 100) -> 'rows');
    PERFORM pg_temp.n245_assert((counts -> 'views' ->> view_key)::INTEGER = rows_count AND (counts ->> 'total')::INTEGER = rows_count,
      p_label || ': ' || view_key || ' count ' || (counts -> 'views' ->> view_key) || ' = rows ' || rows_count);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n245_waits(UUID), pg_temp.n245_needs_action(), pg_temp.n245_check(TEXT, UUID[], BOOLEAN) TO authenticated;
CREATE FUNCTION pg_temp.n245_thread(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE((SELECT t.await_state || ':' || COALESCE(t.await_set_by_membership_id::TEXT, '-') || ':'
      || (t.await_set_at IS NOT NULL)::TEXT
    FROM platform.case_chat_threads t WHERE t.student_case_id = pg_temp.n245_id(500 + p_case)), 'no thread')
$$;
CREATE FUNCTION pg_temp.n245_messages(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.case_chat_messages m WHERE m.student_case_id = pg_temp.n245_id(500 + p_case)
$$;
CREATE FUNCTION pg_temp.n245_post(p_case INTEGER, p_request INTEGER, p_input JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.case_chat_command(pg_temp.n245_id(1), pg_temp.n245_id(500 + p_case), pg_temp.n245_id(p_request), p_input)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n245_post(INTEGER, INTEGER, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. «Требуют действия» counts no step and chat waiting for staff
-- ---------------------------------------------------------------------------
SELECT pg_temp.n245_assert(pg_temp.n245_thread(3) = 'needs_reply:-:false' AND pg_temp.n245_thread(5) = 'no thread',
  'fixture threads');
SET LOCAL request.jwt.claims TO :'n245_admin';
SET LOCAL ROLE authenticated;
-- Admin: 502 (no step), 503 (chat, active), 504 (chat, pending); never 506
-- (closed), 507 (pending without a step) or 501/505.
SELECT pg_temp.n245_check('Admin', pg_temp.n245_ids(502, 503, 504));
SELECT pg_temp.n245_assert(pg_temp.n245_case_ids(platform.staff_student_case_queue_v1('pending', 100) -> 'rows')
  = pg_temp.n245_ids(504, 507), 'both pending cases stay in «Ожидает начала»');
SELECT pg_temp.n245_assert(((platform.staff_student_case_queue_v1('closed', 100) -> 'rows' -> 0) ->> 'needs_reply')::BOOLEAN,
  'a closed case still reports its chat state on its row');
SELECT pg_temp.n245_assert(NOT ((SELECT r FROM jsonb_array_elements(platform.staff_student_case_queue_v1('active', 100) -> 'rows') r
  WHERE (r ->> 'student_case_id')::UUID = pg_temp.n245_id(501)) ->> 'needs_reply')::BOOLEAN,
  'a case without a chat reports needs_reply false');
SELECT pg_temp.n245_assert((platform.staff_student_case_queue_v1('needs_action', 100) -> 'rows') @> jsonb_build_array(
  jsonb_build_object('student_case_id', pg_temp.n245_id(502), 'due_band', 'no_step', 'needs_reply', FALSE)),
  'the no-step case sits in the no_step band of «Требуют действия»');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n245_admissions_manager';
SET LOCAL ROLE authenticated;
-- The department scope narrows the organization-wide set; 502 (a department
-- curator's case with no step) is in it, 503 (the Admin's) is not.
SELECT pg_temp.n245_check('Admissions Manager', pg_temp.n245_ids(502, 503, 504), TRUE);
SELECT pg_temp.n245_assert(pg_temp.n245_id(502) = ANY (pg_temp.n245_needs_action())
  AND NOT pg_temp.n245_id(503) = ANY (pg_temp.n245_needs_action()), 'Admissions Manager: 502 in, 503 out');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_assert(pg_temp.n245_needs_action() = ARRAY[]::UUID[], 'Admissions A: nothing needs action yet');
SELECT pg_temp.n245_check('Admissions A', ARRAY[]::UUID[]);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n245_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_check('Admissions B', pg_temp.n245_ids(502));
RESET ROLE;
-- Reads stay refused where they were (244 gate).
SET LOCAL request.jwt.claims TO :'n245_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_assert(pg_temp.n245_error($q$SELECT platform.staff_student_case_queue_v1('needs_action', 100)$q$)
  = '42501:Staff admissions authority required', 'Sales Manager: queue read refused');
SELECT pg_temp.n245_assert(pg_temp.n245_error($q$SELECT platform.staff_student_case_queue_counts_v1('needs_action')$q$)
  = '42501:Staff admissions authority required', 'Sales Manager: counts read refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n245_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_assert(pg_temp.n245_error($q$SELECT platform.staff_student_case_queue_v1('needs_action', 100)$q$)
  = '42501:Staff admissions authority required', 'Student: queue read refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n245_assert(pg_temp.n245_error($q$SELECT platform.staff_student_case_queue_counts_v1('needs_action')$q$)
  LIKE '42501:permission denied for %', 'anon: counts read refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Chat state both ways
-- ---------------------------------------------------------------------------
-- a) The Student writes: «Нужен ответ»; the case enters A's «Требуют действия».
SET LOCAL request.jwt.claims TO :'n245_student';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_post_v1(pg_temp.n245_id(7001), 'N245 question from the student') IS NOT NULL AS n245_student_post;
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(5) = 'needs_reply:-:false', 'a student post sets needs_reply');
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_check('Admissions A after the student wrote', pg_temp.n245_ids(505));
-- b) A replies: «Ждём студента», with who and when; the case leaves the tab.
SELECT pg_temp.n245_post(5, 7101, '{"mode": "post", "body": "N245 answer from the curator"}'::JSONB) AS n245_reply \gset
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(5) = 'awaiting_student:' || pg_temp.n245_id(304) || ':true',
  'a staff post sets awaiting_student with await_set_by and await_set_at');
SELECT pg_temp.n245_assert(pg_temp.n245_messages(5) = 2, 'two messages');
SELECT (SELECT await_set_at FROM platform.case_chat_threads WHERE student_case_id = pg_temp.n245_id(505))::TEXT AS n245_set_at \gset
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_check('Admissions A after the reply', ARRAY[]::UUID[]);
-- c) Exact replay: the same receipt, no second message, no state change.
SELECT pg_temp.n245_assert(pg_temp.n245_post(5, 7101, '{"mode": "post", "body": "N245 answer from the curator"}'::JSONB)
  = :'n245_reply'::JSONB, 'an exact replay returns the first receipt');
-- d) Same request id, another payload: 40001 as before.
SELECT pg_temp.n245_assert(pg_temp.n245_error(format($q$SELECT pg_temp.n245_post(5, 7101, %L::JSONB)$q$,
  '{"mode": "post", "body": "N245 another answer"}')) = '40001:case_chat_request_conflict',
  'the same request id with another payload is refused');
-- e) Bad explicit state: 22023 and nothing written.
SELECT pg_temp.n245_assert(pg_temp.n245_error(format($q$SELECT pg_temp.n245_post(5, 7102, %L::JSONB)$q$,
  '{"mode": "post", "body": "N245 bogus state", "state": "bogus"}')) = '22023:case_chat_invalid', 'unknown state is invalid');
SELECT pg_temp.n245_assert(pg_temp.n245_error(format($q$SELECT pg_temp.n245_post(5, 7103, %L::JSONB)$q$,
  '{"mode": "post", "body": "N245 numeric state", "state": 5}')) = '22023:case_chat_invalid', 'a non-text state is invalid');
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_messages(5) = 2 AND pg_temp.n245_thread(5) = 'awaiting_student:' || pg_temp.n245_id(304) || ':true'
  AND (SELECT await_set_at FROM platform.case_chat_threads WHERE student_case_id = pg_temp.n245_id(505))::TEXT = :'n245_set_at',
  'replay, conflict and invalid posts wrote nothing');
-- f) The Student writes again: «Нужен ответ»; the last explicit marker stays.
SET LOCAL request.jwt.claims TO :'n245_student';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_post_v1(pg_temp.n245_id(7002), 'N245 follow-up from the student') IS NOT NULL AS n245_student_post_2;
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(5) = 'needs_reply:' || pg_temp.n245_id(304) || ':true',
  'a student post sets needs_reply and keeps await_set_by/at');
-- g) An explicit state in the same command wins over the default.
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_post(5, 7104, '{"mode": "post", "body": "N245 answer, still open", "state": "needs_reply"}'::JSONB) IS NOT NULL AS n245_explicit_1;
SELECT pg_temp.n245_check('Admissions A with an explicit needs_reply', pg_temp.n245_ids(505));
SELECT pg_temp.n245_post(5, 7105, '{"mode": "post", "body": "N245 no answer needed", "state": "none"}'::JSONB) IS NOT NULL AS n245_explicit_2;
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(5) = 'none:' || pg_temp.n245_id(304) || ':true', 'an explicit none wins');
-- h) Another curator cannot post into A's case (authority unchanged).
SET LOCAL request.jwt.claims TO :'n245_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_assert(pg_temp.n245_error(format($q$SELECT pg_temp.n245_post(5, 7106, %L::JSONB)$q$,
  '{"mode": "post", "body": "N245 not my case"}')) = '42501:case_chat_forbidden', 'Admissions B cannot post into A''s case');
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_messages(5) = 5 AND pg_temp.n245_thread(5) = 'none:' || pg_temp.n245_id(304) || ':true',
  'the refused post wrote nothing');
-- i) A first staff post creates the thread as «Ждём студента»; set_await is unchanged.
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_post(1, 7107, '{"mode": "post", "body": "N245 first message"}'::JSONB) IS NOT NULL AS n245_first;
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(1) = 'awaiting_student:' || pg_temp.n245_id(304) || ':true',
  'the first staff post creates the thread waiting for the student');
SET LOCAL request.jwt.claims TO :'n245_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_assert((pg_temp.n245_post(1, 7108, '{"mode": "set_await", "state": "needs_reply"}'::JSONB) ->> 'awaitState') = 'needs_reply',
  'set_await still sets the state explicitly');
SELECT pg_temp.n245_check('Admissions A after set_await', pg_temp.n245_ids(501));
RESET ROLE;
-- j) The Admin answers the chat of 503: it leaves «Требуют действия»; 502 and 504 stay.
SET LOCAL request.jwt.claims TO :'n245_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n245_post(3, 7109, '{"mode": "post", "body": "N245 admin answer"}'::JSONB) IS NOT NULL AS n245_admin_reply;
SELECT pg_temp.n245_check('Admin after answering 503', pg_temp.n245_ids(501, 502, 504));
RESET ROLE;
SELECT pg_temp.n245_assert(pg_temp.n245_thread(3) = 'awaiting_student:' || pg_temp.n245_id(301) || ':true',
  'the Admin post sets awaiting_student too');
-- The journal records each accepted post once.
SELECT pg_temp.n245_assert((SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n245_id(1)
  AND action = 'case.chat.post') = 7, 'each accepted post is journaled once (2 student, 4 curator, 1 admin)');

SELECT 'N245_CASE_WORK_SIGNALS_SUITE_OK' AS n245_suite_marker;
ROLLBACK;
