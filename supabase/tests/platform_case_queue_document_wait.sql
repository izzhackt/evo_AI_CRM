\set ON_ERROR_STOP on
-- Boundary suite for migration 252 (EVO Docs «Документы дела»: сколько ждёт
-- проверки, Э8.5, решения владельца 28.09.2026). Members are modelled like
-- production after 155 and 244 (as in 245's suite): invited staff have
-- organization_memberships.current_role NULL and current_bundle_id NULL;
-- permissions come only from scoped role assignments with the production
-- permission keys. Only the system Admin carries the coarse role; the
-- Student has an own active portal case.
-- Proves:
--  * each page row's documents object gains exactly one key,
--    oldest_submitted_at = the oldest current-version upload among the
--    case's non-removed 'submitted' slots — a re-upload counts from the new
--    version, older versions, other statuses and removed slots never count —
--    and NULL when nothing waits (also with no checklist at all);
--  * the six checklist counts are exactly as before (one scalar subquery,
--    no join into the counting query), (oldest IS NULL) = (submitted = 0);
--  * visibility is unchanged: an own-scope Admissions member reads only the
--    own cases, a member without document.read.full reads documents NULL
--    (no wait either), counts equal rows for every view; the Sales Manager,
--    the Student and anon stay refused;
--  * the read keeps SECURITY DEFINER, search_path = '' and its grants.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n252_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n252_auth_role$;

CREATE FUNCTION pg_temp.n252_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n252_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N252: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n252_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.n252_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n252_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.n252_id(x) ORDER BY pg_temp.n252_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
-- The documents object of one case in the «Все в работе» page of the current actor.
CREATE FUNCTION pg_temp.n252_documents(p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT r -> 'documents' FROM jsonb_array_elements(platform.staff_student_case_queue_v1('active', 100) -> 'rows') AS r
  WHERE (r ->> 'student_case_id')::UUID = pg_temp.n252_id(500 + p_case)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n252_id(INTEGER), pg_temp.n252_assert(BOOLEAN, TEXT),
  pg_temp.n252_error(TEXT), pg_temp.n252_case_ids(JSONB), pg_temp.n252_ids(INTEGER[]), pg_temp.n252_documents(INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N252_CASE_QUEUE_DOCUMENT_WAIT_SUITE_START' AS n252_suite_marker;

-- The moment every fixture upload is measured from (fixed inside the transaction).
CREATE TEMP TABLE n252_t0 AS SELECT date_trunc('second', now()) AS t0;
GRANT SELECT ON n252_t0 TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager, 3 Admissions A (own scope, production keys), 4 Admissions
-- B (own scope, no document.read.full); 5 Student (own portal case 505).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n252_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n252_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student');
GRANT SELECT ON n252_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n252_id(1), 'N252 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n252_id(100 + n), 'n252-' || n || '@example.invalid', '{}'::JSONB FROM n252_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n252_id(200 + n), pg_temp.n252_id(100 + n), 'N252 Actor ' || n, 'active', 1 FROM n252_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n252_id(300 + n), pg_temp.n252_id(1), pg_temp.n252_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n252_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n252_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n252_id(401), pg_temp.n252_id(1), 'organization', pg_temp.n252_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n252_id(1), pg_temp.n252_id(301), pg_temp.n252_id(401), 1, 1, TRUE, 'system',
    'N252 synthetic organization scope', pg_temp.n252_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n252_id(901), pg_temp.n252_id(1), 'N252 Sales'),
  (pg_temp.n252_id(902), pg_temp.n252_id(1), 'N252 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n252_id(1), pg_temp.n252_id(302), pg_temp.n252_id(901)),
  (pg_temp.n252_id(1), pg_temp.n252_id(303), pg_temp.n252_id(902)),
  (pg_temp.n252_id(1), pg_temp.n252_id(304), pg_temp.n252_id(902));

-- Cases, all active:
-- 501 curator A: a checklist with two waiting slots (one re-uploaded), one
--     correction, one approved, one missing and one removed waiting slot;
-- 502 curator A: nothing waits (approved + missing);
-- 503 curator B: one waiting slot;
-- 504 curator A: no checklist at all;
-- 505 curator A: the Student's own portal case, one waiting slot.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n252_id(420 + k), pg_temp.n252_id(1), 'student_case', pg_temp.n252_id(500 + k), 1
  FROM generate_series(1, 5) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at,
  next_action, next_action_due_on)
SELECT pg_temp.n252_id(500 + f.k), pg_temp.n252_id(1), pg_temp.n252_id(302), pg_temp.n252_id(f.curator),
  'synthetic:n252:' || f.k, 'N252 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  'active', clock_timestamp(), pg_temp.n252_id(420 + f.k), 1, 'documents',
  CASE WHEN f.k = 5 THEN pg_temp.n252_id(305) END, CASE WHEN f.k = 5 THEN clock_timestamp() END,
  'N252 step ' || f.k, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE + 7
FROM (VALUES (1, 303), (2, 303), (3, 304), (4, 303), (5, 303)) AS f(k, curator);
-- Slots: n, case, status, current version no, removed.
CREATE TEMP TABLE n252_slots(n INTEGER, case_no INTEGER, status TEXT, current_no INTEGER, removed BOOLEAN);
INSERT INTO n252_slots VALUES
  (1, 1, 'submitted', 1, FALSE),            -- waits since t0 - 5 days
  (2, 1, 'submitted', 2, FALSE),            -- v1 t0 - 10 days, re-uploaded: v2 t0 - 2 days
  (3, 1, 'correction_required', 1, FALSE),  -- t0 - 20 days: not waiting for review
  (4, 1, 'approved', 1, FALSE),             -- t0 - 40 days
  (5, 1, 'required', NULL, FALSE),          -- nothing uploaded
  (6, 1, 'submitted', 1, TRUE),             -- t0 - 30 days, removed from the checklist
  (7, 2, 'approved', 1, FALSE),             -- t0 - 3 days
  (8, 2, 'required', NULL, FALSE),
  (9, 3, 'submitted', 1, FALSE),            -- t0 - 1 day
  (10, 5, 'submitted', 1, FALSE);           -- t0 - 4 days
-- Versions: slot, version no, age in days.
CREATE TEMP TABLE n252_versions(slot INTEGER, version_no INTEGER, age_days INTEGER);
INSERT INTO n252_versions VALUES (1, 1, 5), (2, 1, 10), (2, 2, 2), (3, 1, 20), (4, 1, 40), (6, 1, 30), (7, 1, 3), (9, 1, 1), (10, 1, 4);
INSERT INTO platform.document_versions(id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, created_at)
SELECT pg_temp.n252_id(1000 + v.slot * 10 + v.version_no), pg_temp.n252_id(1), pg_temp.n252_id(500 + s.case_no),
  pg_temp.n252_id(800 + v.slot), v.version_no, 'n252-slot-' || v.slot || '-v' || v.version_no || '.pdf', 'application/pdf', 1024,
  encode(sha256(convert_to('n252:' || v.slot || ':' || v.version_no, 'UTF8')), 'hex'), 'synthetic:n252:ingest',
  pg_temp.n252_id(303), (SELECT t0 FROM n252_t0) - make_interval(days => v.age_days)
FROM n252_versions v JOIN n252_slots s ON s.n = v.slot;
INSERT INTO platform.document_slots(id, organization_id, student_case_id, status, current_version_id,
  current_version_no, created_by_membership_id, intent_kind, display_label, group_label,
  removed_at, removed_by_membership_id, removal_reason)
SELECT pg_temp.n252_id(800 + s.n), pg_temp.n252_id(1), pg_temp.n252_id(500 + s.case_no), s.status::platform.document_slot_status,
  CASE WHEN s.current_no IS NULL THEN NULL ELSE pg_temp.n252_id(1000 + s.n * 10 + s.current_no) END, s.current_no,
  pg_temp.n252_id(301), 'custom', 'N252 slot ' || s.n, 'N252 group',
  CASE WHEN s.removed THEN clock_timestamp() END,
  CASE WHEN s.removed THEN pg_temp.n252_id(301) END,
  CASE WHEN s.removed THEN 'N252 synthetic removal' END
FROM n252_slots s;
SET LOCAL session_replication_role = origin;
-- The Student signs in and reads only the own case (the provisioned portal shape).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n252_id(1), pg_temp.n252_id(305), pg_temp.n252_id(401), 1, 1, TRUE, 'system',
    'N252 synthetic Student organization scope', pg_temp.n252_id(604)),
  (pg_temp.n252_id(1), pg_temp.n252_id(305), pg_temp.n252_id(425), 1, 1, TRUE, 'system',
    'N252 synthetic Student case scope', pg_temp.n252_id(605));

-- Roles with the production permission keys (as in 244's and 245's suites);
-- Admissions B is the Admissions role without any document key.
CREATE TEMP TABLE n252_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n252_roles VALUES
 (pg_temp.n252_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n252_id(1102), 'Admissions without documents', '["application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","profile.read.full","staff.task.read","task.create"]', 1120),
 (pg_temp.n252_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130);
CREATE TEMP TABLE n252_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n252_grants VALUES
 (302, pg_temp.n252_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n252_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n252_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n252_id(1102), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE n252_access_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n252_id(1);
GRANT SELECT ON n252_roles, n252_grants, n252_access_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n252_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n252_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n252_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n252_admin_setup';
SET LOCAL ROLE authenticated;
DO $n252_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n252_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n252_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N252 ' || r.label, 'description', 'Migration 252 synthetic role',
        'permissionKeys', r.keys), 'N252 create role', pg_temp.n252_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n252_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n252_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N252 publish role', pg_temp.n252_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n252_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n252_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n252_id(1), pg_temp.n252_id(m),
      (SELECT access_version FROM n252_access_versions WHERE membership_id = pg_temp.n252_id(m)), items, bindings,
      'N252 grant roles', pg_temp.n252_id(2000 + m));
  END LOOP;
END
$n252_roles$;
RESET ROLE;
UPDATE n252_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n252_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n252_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n252_admin FROM n252_actors WHERE n = 1 \gset
SELECT claims AS n252_sales_manager FROM n252_actors WHERE n = 2 \gset
SELECT claims AS n252_admissions_a FROM n252_actors WHERE n = 3 \gset
SELECT claims AS n252_admissions_b FROM n252_actors WHERE n = 4 \gset
SELECT claims AS n252_student FROM n252_actors WHERE n = 5 \gset
SELECT pg_temp.n252_assert((SELECT count(*) = 3 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n252_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n252_ids(302, 303, 304))), 'invited members have coarse role and bundle NULL');

-- Every row: the exact key set, and a wait exactly when something waits; counts equal rows for every view.
CREATE FUNCTION pg_temp.n252_check(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE row JSONB; view_key TEXT; rows_count INTEGER; counts JSONB;
BEGIN
  FOR row IN SELECT * FROM jsonb_array_elements(platform.staff_student_case_queue_v1('active', 100) -> 'rows') LOOP
    CONTINUE WHEN jsonb_typeof(row -> 'documents') = 'null';
    PERFORM pg_temp.n252_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row -> 'documents') AS k)
      = ARRAY['approved', 'correction_required', 'missing', 'oldest_submitted_at', 'rejected', 'submitted', 'total'],
      p_label || ': documents carries the six counts and oldest_submitted_at only');
    PERFORM pg_temp.n252_assert((jsonb_typeof(row -> 'documents' -> 'oldest_submitted_at') = 'null')
      = ((row -> 'documents' ->> 'submitted')::INTEGER = 0), p_label || ': a wait exactly when something waits');
  END LOOP;
  FOREACH view_key IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending'] LOOP
    counts := platform.staff_student_case_queue_counts_v1(view_key);
    rows_count := jsonb_array_length(platform.staff_student_case_queue_v1(view_key, 100) -> 'rows');
    PERFORM pg_temp.n252_assert((counts -> 'views' ->> view_key)::INTEGER = rows_count AND (counts ->> 'total')::INTEGER = rows_count,
      p_label || ': ' || view_key || ' count ' || (counts -> 'views' ->> view_key) || ' = rows ' || rows_count);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n252_check(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. The Admin: the oldest current upload among waiting slots
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n252_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_check('Admin');
SELECT pg_temp.n252_assert(pg_temp.n252_case_ids(platform.staff_student_case_queue_v1('active', 100) -> 'rows')
  = pg_temp.n252_ids(501, 502, 503, 504, 505), 'Admin reads every active case');
-- 501: slot 1 (5 days) is older than slot 2's current re-upload (2 days); slot 2's
-- first version (10 days), the correction (20), the removed slot (30) and the approved one (40) never count.
SELECT pg_temp.n252_assert((pg_temp.n252_documents(1) ->> 'oldest_submitted_at')::TIMESTAMPTZ
  = (SELECT t0 FROM n252_t0) - INTERVAL '5 days', '501 waits since the oldest current upload of a waiting slot');
SELECT pg_temp.n252_assert(pg_temp.n252_documents(1) - 'oldest_submitted_at'
  = '{"total": 5, "submitted": 2, "correction_required": 1, "rejected": 0, "approved": 1, "missing": 1}'::JSONB,
  '501 counts are unchanged (the removed slot does not count)');
SELECT pg_temp.n252_assert(jsonb_typeof(pg_temp.n252_documents(2) -> 'oldest_submitted_at') = 'null'
  AND (pg_temp.n252_documents(2) ->> 'total')::INTEGER = 2, '502: nothing waits — NULL');
SELECT pg_temp.n252_assert((pg_temp.n252_documents(3) ->> 'oldest_submitted_at')::TIMESTAMPTZ
  = (SELECT t0 FROM n252_t0) - INTERVAL '1 day', '503 waits since its one upload');
SELECT pg_temp.n252_assert(pg_temp.n252_documents(4) = '{"total": 0, "submitted": 0, "correction_required": 0, "rejected": 0, "approved": 0, "missing": 0, "oldest_submitted_at": null}'::JSONB,
  '504 has no checklist: zeros and no wait');
-- The page's other readers of the same row stay consistent: the «Требуют действия» and updated-order pages carry it too.
SELECT pg_temp.n252_assert((SELECT (r -> 'documents' ->> 'oldest_submitted_at')::TIMESTAMPTZ FROM jsonb_array_elements(
  platform.staff_student_case_queue_v1('active', 100, 'updated') -> 'rows') AS r WHERE (r ->> 'student_case_id')::UUID = pg_temp.n252_id(501))
  = (SELECT t0 FROM n252_t0) - INTERVAL '5 days', 'the updated order returns the same wait');
-- A re-upload moves the wait: the newer current version of slot 1 makes slot 2 (2 days) the oldest.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.document_versions(id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, created_at)
  VALUES (pg_temp.n252_id(1012), pg_temp.n252_id(1), pg_temp.n252_id(501), pg_temp.n252_id(801), 2, 'n252-slot-1-v2.pdf',
    'application/pdf', 2048, encode(sha256(convert_to('n252:1:2', 'UTF8')), 'hex'), 'synthetic:n252:ingest', pg_temp.n252_id(303),
    (SELECT t0 FROM n252_t0) - INTERVAL '1 hour');
UPDATE platform.document_slots SET current_version_id = pg_temp.n252_id(1012), current_version_no = 2 WHERE id = pg_temp.n252_id(801);
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'n252_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_assert((pg_temp.n252_documents(1) ->> 'oldest_submitted_at')::TIMESTAMPTZ
  = (SELECT t0 FROM n252_t0) - INTERVAL '2 days', 'after a re-upload the wait counts from the new version');
-- The review decides slot 2: only slot 1 (1 hour) still waits.
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE platform.document_slots SET status = 'approved' WHERE id = pg_temp.n252_id(802);
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'n252_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_assert((pg_temp.n252_documents(1) ->> 'oldest_submitted_at')::TIMESTAMPTZ
  = (SELECT t0 FROM n252_t0) - INTERVAL '1 hour' AND (pg_temp.n252_documents(1) ->> 'submitted')::INTEGER = 1,
  'a decided slot leaves the wait');
SELECT pg_temp.n252_check('Admin after the changes');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Visibility is unchanged
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n252_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_check('Admissions A');
SELECT pg_temp.n252_assert(pg_temp.n252_case_ids(platform.staff_student_case_queue_v1('active', 100) -> 'rows')
  = pg_temp.n252_ids(501, 502, 504, 505), 'Admissions A reads its own cases only');
SELECT pg_temp.n252_assert((pg_temp.n252_documents(5) ->> 'oldest_submitted_at')::TIMESTAMPTZ
  = (SELECT t0 FROM n252_t0) - INTERVAL '4 days', 'Admissions A reads the wait of its own case');
SELECT pg_temp.n252_assert(pg_temp.n252_documents(3) IS NULL, 'another curator''s case is not in the page');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n252_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_check('Admissions B');
SELECT pg_temp.n252_assert(pg_temp.n252_case_ids(platform.staff_student_case_queue_v1('active', 100) -> 'rows')
  = pg_temp.n252_ids(503), 'Admissions B reads its own case only');
SELECT pg_temp.n252_assert(jsonb_typeof(pg_temp.n252_documents(3)) = 'null',
  'without document.read.full the documents object — and the wait with it — is NULL');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n252_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_assert(pg_temp.n252_error($q$SELECT platform.staff_student_case_queue_v1('active', 100)$q$)
  = '42501:Staff admissions authority required', 'Sales Manager: queue read refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n252_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n252_assert(pg_temp.n252_error($q$SELECT platform.staff_student_case_queue_v1('active', 100)$q$)
  = '42501:Staff admissions authority required', 'Student: queue read refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n252_assert(pg_temp.n252_error($q$SELECT platform.staff_student_case_queue_v1('active', 100)$q$)
  LIKE '42501:permission denied for %', 'anon: queue read refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. Definer, search_path and grants
-- ---------------------------------------------------------------------------
SELECT pg_temp.n252_assert(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'),
  'the read keeps SECURITY DEFINER, search_path and grants')
FROM pg_catalog.pg_proc AS p
WHERE p.oid = 'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure;

SELECT 'N252_CASE_QUEUE_DOCUMENT_WAIT_SUITE_OK' AS n252_suite_marker;
ROLLBACK;
