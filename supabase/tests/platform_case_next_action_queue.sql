\set ON_ERROR_STOP on
-- Boundary suite for migration 241 («Студенты» queue backend): the editable
-- «Следующий шаг / Срок» write (platform.set_case_next_action_v1), the queue
-- page (platform.staff_student_case_queue_v1), its counts
-- (platform.staff_student_case_queue_counts_v1) and the «История» allowlist.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real customer,
-- provider or production action. Style follows platform_pipeline_board.sql
-- (187) and platform_document_export_artifacts.sql (scoped roles through the
-- installed staff_role_* commands, claims minted by the installed token hook).
BEGIN;

-- The «История» read (132) checks auth.role(), which managed Supabase Auth
-- owns. Add the same transaction-local stand-in 193's suite uses when the
-- disposable database lacks it; ROLLBACK discards it with every row.
DO $n241_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n241_auth_role$;

CREATE FUNCTION pg_temp.n241_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n241_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N241: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n241_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Follow next_cursor to the end and return every case id in page order.
CREATE FUNCTION pg_temp.n241_ids(
  p_view TEXT, p_sort TEXT, p_limit INTEGER, p_direction TEXT DEFAULT NULL,
  p_curator UUID DEFAULT NULL, p_stage TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL
) RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE page JSONB; next_cur TEXT := NULL; ids UUID[] := ARRAY[]::UUID[]; pages INTEGER := 0;
BEGIN
  LOOP
    page := platform.staff_student_case_queue_v1(p_view, p_limit, p_sort, next_cur,
      p_direction, p_curator, p_stage, p_query);
    IF jsonb_array_length(page -> 'rows') > p_limit THEN RAISE EXCEPTION 'N241: page exceeds limit'; END IF;
    ids := ids || COALESCE((SELECT array_agg((r ->> 'student_case_id')::UUID ORDER BY o)
      FROM jsonb_array_elements(page -> 'rows') WITH ORDINALITY AS t(r, o)), ARRAY[]::UUID[]);
    next_cur := page ->> 'next_cursor';
    EXIT WHEN next_cur IS NULL;
    IF jsonb_array_length(page -> 'rows') <> p_limit
      OR next_cur IS DISTINCT FROM (page -> 'rows' -> (p_limit - 1) ->> 'cursor') THEN
      RAISE EXCEPTION 'N241: next_cursor is not the last full-page row cursor';
    END IF;
    pages := pages + 1;
    IF pages > 200 THEN RAISE EXCEPTION 'N241: paging did not terminate'; END IF;
  END LOOP;
  RETURN ids;
END
$$;
CREATE FUNCTION pg_temp.n241_row(p_view TEXT, p_case UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT r FROM jsonb_array_elements(platform.staff_student_case_queue_v1(p_view, 100) -> 'rows') AS r
  WHERE r ->> 'student_case_id' = p_case::TEXT
$$;
-- Every count equals the row count of the list read under the same filters.
CREATE FUNCTION pg_temp.n241_counts_match_rows(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT; counts JSONB; facet JSONB; bands_total BIGINT;
BEGIN
  FOREACH v IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed'] LOOP
    counts := platform.staff_student_case_queue_counts_v1(v);
    PERFORM pg_temp.n241_assert((counts -> 'views' ->> v)::BIGINT = cardinality(pg_temp.n241_ids(v, 'due', 100)),
      p_label || ': tab count equals rows for ' || v);
    PERFORM pg_temp.n241_assert((counts ->> 'total')::BIGINT = cardinality(pg_temp.n241_ids(v, 'due', 100)),
      p_label || ': total equals rows for ' || v);
    SELECT sum(value::BIGINT) INTO bands_total FROM jsonb_each_text(counts -> 'bands');
    PERFORM pg_temp.n241_assert(bands_total = (counts ->> 'total')::BIGINT, p_label || ': bands add up to total for ' || v);
    FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'curators') LOOP
      PERFORM pg_temp.n241_assert((facet ->> 'count')::BIGINT
        = cardinality(pg_temp.n241_ids(v, 'due', 100, NULL, (facet ->> 'membership_id')::UUID)),
        p_label || ': curator facet equals filtered rows for ' || v);
    END LOOP;
    FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'directions') LOOP
      PERFORM pg_temp.n241_assert((facet ->> 'count')::BIGINT
        = cardinality(pg_temp.n241_ids(v, 'due', 100, facet ->> 'direction')),
        p_label || ': direction facet equals filtered rows for ' || v);
    END LOOP;
    FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'stages') LOOP
      PERFORM pg_temp.n241_assert((facet ->> 'count')::BIGINT
        = cardinality(pg_temp.n241_ids(v, 'due', 100, NULL, NULL, facet ->> 'pipeline_stage')),
        p_label || ': stage facet equals filtered rows for ' || v);
    END LOOP;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n241_id(INTEGER), pg_temp.n241_assert(BOOLEAN, TEXT),
  pg_temp.n241_error(TEXT), pg_temp.n241_ids(TEXT, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT),
  pg_temp.n241_row(TEXT, UUID), pg_temp.n241_counts_match_rows(TEXT)
  TO authenticated, anon, service_role;

SELECT 'N241_CASE_NEXT_ACTION_QUEUE_SUITE_START' AS n241_suite_marker;

-- ---------------------------------------------------------------------------
-- Band helper: fixed dates, Wednesday 2026-09-23 and Sunday 2026-09-27.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', DATE '2026-09-22', DATE '2026-09-23') = 'overdue', 'yesterday is overdue');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', DATE '2026-09-23', DATE '2026-09-23') = 'today', 'same day is today');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', DATE '2026-09-27', DATE '2026-09-23') = 'this_week', 'Sunday closes the week');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', DATE '2026-09-28', DATE '2026-09-23') = 'later', 'next Monday is later');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', DATE '2026-09-28', DATE '2026-09-27') = 'later', 'on Sunday the next day is already later');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band('s', NULL, DATE '2026-09-23') = 'undated', 'a step without a date is undated');
SELECT pg_temp.n241_assert(platform_private.case_next_action_band(NULL, DATE '2026-09-22', DATE '2026-09-23') = 'no_step', 'no step wins over a stray date');

-- ---------------------------------------------------------------------------
-- Fixture: admin (1), sales (2), curator A (3), curator B (4), student (5),
-- curator C (6). Only this organization's synthetic rows are created.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n241_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO n241_actors(n, role) VALUES
  (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'curator'), (5, 'student'), (6, 'curator');
GRANT SELECT ON n241_actors TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n241_id(1), 'N241 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n241_id(100 + n), 'n241-' || n || '@example.invalid', '{}'::JSONB FROM n241_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n241_id(200 + n), pg_temp.n241_id(100 + n), 'N241 Actor ' || n, 'active', 1 FROM n241_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n241_id(300 + n), pg_temp.n241_id(1), pg_temp.n241_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM n241_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n241_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n241_id(401), pg_temp.n241_id(1), 'organization', pg_temp.n241_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n241_id(1), pg_temp.n241_id(301), pg_temp.n241_id(401), 1, 1, TRUE, 'system',
    'N241 synthetic organization scope', pg_temp.n241_id(601));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n241_id(420 + k), pg_temp.n241_id(1), 'student_case', pg_temp.n241_id(500 + k), 1
  FROM generate_series(1, 11) AS k;

CREATE TEMP TABLE n241_today AS SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS d;
GRANT SELECT ON n241_today TO authenticated;

SET LOCAL session_replication_role = replica;
-- 501/507 overdue (same date: tie broken by id), 502 today (+ an overdue task),
-- 503 a step without a date, 504/511 no step, 505 curator B's, 506 closed,
-- 508 pending without sale evidence, 509 a CN playbook-configured case,
-- 510 names curator C as curator although C's role reaches only 511.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, closed_at, current_scope_id, current_scope_version,
  admissions_direction, pipeline_stage, next_action, next_action_due_on
)
SELECT pg_temp.n241_id(500 + f.k), pg_temp.n241_id(1), pg_temp.n241_id(302),
  CASE WHEN f.state = 'pending' THEN NULL ELSE pg_temp.n241_id(f.curator) END,
  'synthetic:n241:' || f.k, 'N241 Student ' || (500 + f.k), f.country, 'Bachelor', f.stage_op,
  f.state::platform.student_case_state,
  CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END,
  pg_temp.n241_id(420 + f.k), 1, f.direction, f.pipeline, f.step,
  CASE WHEN f.due_offset IS NULL THEN NULL ELSE (SELECT d FROM n241_today) + f.due_offset END
FROM (VALUES
  (1, 303, 'active', 'CZ', 'contract_confirmed', 'EUROPE', 'documents', 'Шаг 501', -2),
  (2, 303, 'active', 'CN', 'contract_confirmed', NULL, 'new', 'Шаг 502', 0),
  (3, 303, 'active', 'CN', 'contract_confirmed', NULL, 'new', 'Шаг 503', NULL),
  (4, 303, 'active', 'CN', 'contract_confirmed', NULL, 'shortlist', NULL, NULL),
  (5, 304, 'active', 'IT', 'contract_confirmed', 'EUROPE', 'new', 'Шаг 505', 30),
  (6, 303, 'closed', 'IT', 'completed', 'EUROPE', 'arrived', 'Шаг 506', -5),
  (7, 303, 'active', 'CZ', 'contract_confirmed', 'EUROPE', 'documents', 'Шаг 507', -2),
  (8, NULL, 'pending', 'MY', 'contract_confirmed', NULL, 'new', NULL, NULL),
  (9, 303, 'active', 'CN', 'documents', NULL, 'visa', 'Шаг 509', 1),
  (10, 306, 'active', 'AE', 'contract_confirmed', 'AE', 'new', 'Шаг 510', 3),
  (11, 303, 'active', 'TR', 'contract_confirmed', 'TR', 'new', NULL, NULL)
) AS f(k, curator, state, country, stage_op, direction, pipeline, step, due_offset);
UPDATE platform.student_cases
  SET admissions_direction = 'CN', admissions_version = 3, admissions_outcome = 'active',
    admissions_playbook_version_id = (SELECT id FROM platform_private.admissions_playbook_versions
      WHERE direction = 'CN' ORDER BY published_at, id LIMIT 1)
  WHERE id = pg_temp.n241_id(509);
INSERT INTO platform.case_tasks(organization_id, student_case_id, task_type, title, assignee_membership_id,
  status, created_by_membership_id, due_on)
  VALUES (pg_temp.n241_id(1), pg_temp.n241_id(502), 'admissions', 'N241 overdue task', pg_temp.n241_id(303),
    'open', pg_temp.n241_id(301), (SELECT d FROM n241_today) - 1);
-- Checklist on 501: one slot per status plus one removed slot that must not count.
INSERT INTO platform.document_slots(organization_id, student_case_id, status, current_version_id,
  current_version_no, created_by_membership_id, intent_kind, display_label, group_label,
  removed_at, removed_by_membership_id, removal_reason)
SELECT pg_temp.n241_id(1), pg_temp.n241_id(501), s.status::platform.document_slot_status,
  CASE WHEN s.status = 'required' THEN NULL ELSE gen_random_uuid() END,
  CASE WHEN s.status = 'required' THEN NULL ELSE 1 END,
  pg_temp.n241_id(301), 'custom', 'N241 slot ' || s.n, 'N241 group',
  CASE WHEN s.removed THEN clock_timestamp() END,
  CASE WHEN s.removed THEN pg_temp.n241_id(301) END,
  CASE WHEN s.removed THEN 'N241 synthetic removal' END
FROM (VALUES (1, 'submitted', FALSE), (2, 'correction_required', FALSE), (3, 'rejected', FALSE),
  (4, 'approved', FALSE), (5, 'required', FALSE), (6, 'submitted', TRUE)) AS s(n, status, removed);
SET LOCAL session_replication_role = origin;

-- Staff roles through the installed commands. A: own scope with documents;
-- B: own scope without document.read.full; C: one record (case 511); Sales:
-- the Sales template's case/lead keys, own scope.
CREATE TEMP TABLE n241_roles(role_id UUID, membership_id UUID, keys JSONB, scope JSONB, request_base INTEGER);
INSERT INTO n241_roles VALUES
  (pg_temp.n241_id(701), pg_temp.n241_id(303),
    '["case.read.full","case.route.manage","case.update.append","document.read.full"]',
    jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 710),
  (pg_temp.n241_id(702), pg_temp.n241_id(304),
    '["case.read.full","case.route.manage","case.update.append"]',
    jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 720),
  (pg_temp.n241_id(703), pg_temp.n241_id(306),
    '["case.read.full","case.route.manage"]',
    jsonb_build_object('kind', 'record', 'key', pg_temp.n241_id(511), 'resourceKind', 'student_case'), 730),
  (pg_temp.n241_id(704), pg_temp.n241_id(302),
    '["lead.read","case.read.summary","document.read.sales","task.create"]',
    jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 740);
GRANT SELECT ON n241_roles TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n241_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n241_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n241_admin \gset
SET LOCAL request.jwt.claims TO :'n241_admin';
SET LOCAL ROLE authenticated;
DO $n241_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM n241_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n241_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N241 role ' || r.request_base, 'description', 'Migration 241 synthetic role',
        'permissionKeys', r.keys), 'N241 create role', pg_temp.n241_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n241_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n241_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N241 publish role', pg_temp.n241_id(r.request_base + 2));
    PERFORM platform.staff_role_assignments_save(pg_temp.n241_id(1), r.membership_id, 1,
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'scope', r.scope)),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'roleVersion', 2,
        'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'N241 grant role', pg_temp.n241_id(r.request_base + 3));
  END LOOP;
END
$n241_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions.
UPDATE n241_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n241_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n241_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
WHERE a.n <> 5;
UPDATE n241_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', 'student',
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.n241_id(205) AND a.n = 5;
SELECT claims AS n241_admin FROM n241_actors WHERE n = 1 \gset
SELECT claims AS n241_sales FROM n241_actors WHERE n = 2 \gset
SELECT claims AS n241_curator_a FROM n241_actors WHERE n = 3 \gset
SELECT claims AS n241_curator_b FROM n241_actors WHERE n = 4 \gset
SELECT claims AS n241_student FROM n241_actors WHERE n = 5 \gset
SELECT claims AS n241_curator_c FROM n241_actors WHERE n = 6 \gset
SELECT pg_temp.n241_assert((SELECT count(*) = 5 FROM n241_actors WHERE n <> 5
  AND claims::JSONB ->> 'platform_membership_id' = pg_temp.n241_id(300 + n)::TEXT), 'staff claims resolve to their memberships');

-- ---------------------------------------------------------------------------
-- Curator A: queue order, keyset paging with NULL dates, rows and views.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n241_curator_a';
SET LOCAL ROLE authenticated;

SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 100) = ARRAY[
  pg_temp.n241_id(501), pg_temp.n241_id(507), pg_temp.n241_id(502), pg_temp.n241_id(509),
  pg_temp.n241_id(503), pg_temp.n241_id(504), pg_temp.n241_id(511)],
  'due order: dated ascending (ties by id), then a step without a date, then no step');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 1) = pg_temp.n241_ids('mine', 'due', 100), 'due paging by 1 crosses the NULL groups without gaps or repeats');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 2) = pg_temp.n241_ids('mine', 'due', 100), 'due paging by 2 is stable');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 3) = pg_temp.n241_ids('mine', 'due', 100), 'due paging by 3 is stable');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'updated', 1) = pg_temp.n241_ids('mine', 'updated', 100), 'updated paging by 1 is stable');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'updated', 100) = (
  SELECT array_agg(id ORDER BY updated_at DESC, id DESC) FROM platform.student_cases
  WHERE id = ANY (pg_temp.n241_ids('mine', 'due', 100))), 'updated sort is updated_at DESC, id DESC');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('active', 'due', 100) = pg_temp.n241_ids('mine', 'due', 100),
  'curator A reads exactly the cases A curates (own scope)');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('closed', 'due', 100) = ARRAY[pg_temp.n241_id(506)], 'closed view lists only the closed case');
SELECT pg_temp.n241_assert((SELECT array_agg(x ORDER BY x) FROM unnest(pg_temp.n241_ids('needs_action', 'due', 100)) x)
  = ARRAY[pg_temp.n241_id(501), pg_temp.n241_id(502), pg_temp.n241_id(507)],
  'needs_action = overdue step or overdue task (no sale evidence, so no awaiting_ack)');
SELECT pg_temp.n241_assert(cardinality(pg_temp.n241_ids('needs_curator', 'due', 100)) = 0, 'no needs_curator case for a curator');
SELECT pg_temp.n241_assert(cardinality(pg_temp.n241_ids('active', 'due', 100, NULL, pg_temp.n241_id(304))) = 0,
  'a curator filter on another curator never widens visibility');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 100, 'EUROPE') = ARRAY[pg_temp.n241_id(501), pg_temp.n241_id(507)], 'direction filter');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 100, 'unknown')
  = ARRAY[pg_temp.n241_id(502), pg_temp.n241_id(503), pg_temp.n241_id(504)],
  'unknown direction matches cases without a direction only (509 is CN)');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 100, NULL, NULL, 'documents') = ARRAY[pg_temp.n241_id(501), pg_temp.n241_id(507)], 'pipeline stage filter');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('mine', 'due', 100, NULL, NULL, NULL, 'student 50') = ARRAY[
  pg_temp.n241_id(501), pg_temp.n241_id(507), pg_temp.n241_id(502), pg_temp.n241_id(509),
  pg_temp.n241_id(503), pg_temp.n241_id(504)], 'search narrows by name, case-insensitively');

SELECT pg_temp.n241_row('mine', pg_temp.n241_id(501)) AS n241_row_501 \gset
SELECT pg_temp.n241_assert(:'n241_row_501'::JSONB ->> 'pipeline_stage' = 'documents'
  AND :'n241_row_501'::JSONB ->> 'due_band' = 'overdue'
  AND :'n241_row_501'::JSONB ->> 'admissions_version' = '0'
  AND (:'n241_row_501'::JSONB ->> 'is_mine')::BOOLEAN
  AND :'n241_row_501'::JSONB ->> 'current_curator_display_name' = 'N241 Actor 3'
  AND :'n241_row_501'::JSONB -> 'attention_flags' ? 'overdue'
  AND :'n241_row_501'::JSONB ->> 'next_action' = 'Шаг 501'
  AND :'n241_row_501'::JSONB ->> 'next_action_due_on' = to_char((SELECT d FROM n241_today) - 2, 'YYYY-MM-DD'),
  'row carries board stage, band, version, curator and flags');
SELECT pg_temp.n241_assert(:'n241_row_501'::JSONB -> 'documents' = jsonb_build_object('total', 5, 'submitted', 1,
  'correction_required', 1, 'rejected', 1, 'approved', 1, 'missing', 1), 'checklist counts exclude the removed slot');
SELECT pg_temp.n241_assert((pg_temp.n241_row('mine', pg_temp.n241_id(502)) ->> 'overdue_task_count')::INTEGER = 1
  AND pg_temp.n241_row('mine', pg_temp.n241_id(502)) ->> 'due_band' = 'today', 'overdue task counted; due today is today');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(503)) ->> 'due_band' = 'undated'
  AND pg_temp.n241_row('mine', pg_temp.n241_id(504)) ->> 'due_band' = 'no_step', 'undated and no-step bands');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(509)) ->> 'due_band'
  = CASE WHEN (SELECT d FROM n241_today) + 1 <= (SELECT d + (7 - EXTRACT(ISODOW FROM d)::INTEGER) FROM n241_today)
    THEN 'this_week' ELSE 'later' END, 'tomorrow is this_week unless today is Sunday');
SELECT pg_temp.n241_counts_match_rows('curator A');
SELECT platform.staff_student_case_queue_counts_v1('mine') AS n241_counts_a \gset
SELECT pg_temp.n241_assert(:'n241_counts_a'::JSONB -> 'views' = jsonb_build_object('mine', 7, 'needs_action', 3,
  'active', 7, 'needs_curator', 0, 'closed', 1), 'curator A tab counts');
SELECT pg_temp.n241_assert((:'n241_counts_a'::JSONB -> 'bands' ->> 'overdue')::INTEGER = 2
  AND (:'n241_counts_a'::JSONB -> 'bands' ->> 'today')::INTEGER = 1
  AND (:'n241_counts_a'::JSONB -> 'bands' ->> 'undated')::INTEGER = 1
  AND (:'n241_counts_a'::JSONB -> 'bands' ->> 'no_step')::INTEGER = 2, 'curator A band counts');
SELECT pg_temp.n241_assert(:'n241_counts_a'::JSONB -> 'curators' = jsonb_build_array(jsonb_build_object(
  'membership_id', pg_temp.n241_id(303), 'display_name', 'N241 Actor 3', 'is_me', TRUE, 'count', 7)),
  'curator facet lists only curators of visible cases, me first');
SELECT pg_temp.n241_assert(:'n241_counts_a'::JSONB ->> 'today' = to_char((SELECT d FROM n241_today), 'YYYY-MM-DD'), 'counts expose the Bishkek day');

-- Request validation and cursor tampering.
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('everything')$q$) LIKE '22023:%', 'unknown view is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('mine', 0)$q$) LIKE '22023:%', 'limit 0 is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('mine', 101)$q$) LIKE '22023:%', 'limit 101 is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'name')$q$) LIKE '22023:%', 'name sort is not offered');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'due', 'garbage')$q$) LIKE '22023:%', 'garbage cursor');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'updated', %L)$q$,
  'due|0|2026-09-23|' || pg_temp.n241_id(501))) LIKE '22023:%', 'a due cursor cannot page the updated sort');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'due', %L)$q$,
  'due|0|infinity|' || pg_temp.n241_id(501))) LIKE '22023:%', 'rank 0 must carry a date');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'due', %L)$q$,
  'due|1|2026-09-23|' || pg_temp.n241_id(501))) LIKE '22023:%', 'ranks 1-2 must carry infinity');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'due', %L)$q$,
  'due|0|2026-02-30|' || pg_temp.n241_id(501))) LIKE '22023:%', 'impossible calendar date in a cursor');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('mine', 5, 'due', NULL, 'XX')$q$) LIKE '22023:%', 'unknown direction');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_counts_v1('mine', NULL, NULL, 'nowhere')$q$) LIKE '22023:%', 'unknown stage');

-- ---------------------------------------------------------------------------
-- Curator A: the next-step write.
-- ---------------------------------------------------------------------------
SELECT platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(504), 0,
  '  Позвонить студенту  ', (SELECT d FROM n241_today) + 3, pg_temp.n241_id(901)) AS n241_set_receipt \gset
SELECT pg_temp.n241_assert(:'n241_set_receipt'::JSONB ->> 'next_action' = 'Позвонить студенту'
  AND :'n241_set_receipt'::JSONB ->> 'next_action_due_on' = to_char((SELECT d FROM n241_today) + 3, 'YYYY-MM-DD')
  AND :'n241_set_receipt'::JSONB ->> 'admissions_version' = '1'
  AND (:'n241_set_receipt'::JSONB ->> 'cleared')::BOOLEAN = FALSE
  AND :'n241_set_receipt'::JSONB ->> 'request_id' = pg_temp.n241_id(901)::TEXT
  AND :'n241_set_receipt'::JSONB ->> 'student_case_id' = pg_temp.n241_id(504)::TEXT,
  'receipt is the committed, trimmed row with the bumped version');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(504), 0,
  '  Позвонить студенту  ', (SELECT d FROM n241_today) + 3, pg_temp.n241_id(901)) = :'n241_set_receipt'::JSONB,
  'exact replay returns the identical receipt');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Другой текст', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), pg_temp.n241_id(901))) = '22023:case_next_action_request_conflict',
  'same request id with other input is a conflict, not a replay');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Устаревшая версия', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), pg_temp.n241_id(902))) = 'PT409:case_next_action_version_conflict',
  'a stale expected version is a PT409 conflict');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(504)) ->> 'next_action' = 'Позвонить студенту'
  AND pg_temp.n241_row('mine', pg_temp.n241_id(504)) ->> 'admissions_version' = '1',
  'the conflicting write changed nothing');
SELECT platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(504), 1, E' \t ', NULL,
  pg_temp.n241_id(903)) AS n241_clear_receipt \gset
SELECT pg_temp.n241_assert((:'n241_clear_receipt'::JSONB ->> 'cleared')::BOOLEAN
  AND :'n241_clear_receipt'::JSONB -> 'next_action' = 'null'::JSONB
  AND :'n241_clear_receipt'::JSONB -> 'next_action_due_on' = 'null'::JSONB
  AND :'n241_clear_receipt'::JSONB ->> 'admissions_version' = '2', 'blank text without a date clears the step');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(504), 1, E' \t ', NULL,
  pg_temp.n241_id(903)) = :'n241_clear_receipt'::JSONB, 'a clearing replay returns the same receipt');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(504)) ->> 'due_band' = 'no_step', 'a cleared case falls back to no_step');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 2, NULL, %L, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), (SELECT d FROM n241_today), gen_random_uuid())) = '22023:case_next_action_invalid',
  'a date without a step is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 2, %L, NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), E'Строка\nвторая', gen_random_uuid())) = '22023:case_next_action_invalid',
  'the step is one line');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 2, %L, NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), repeat('я', 1001), gen_random_uuid())) = '22023:case_next_action_invalid',
  'the step is at most 1000 characters');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 2, %L, 'infinity', %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), 'Шаг', gen_random_uuid())) = '22023:case_next_action_invalid',
  'an infinite date is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, -1, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), gen_random_uuid())) = '22023:case_next_action_invalid',
  'a negative expected version is invalid');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 9223372036854775807, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), gen_random_uuid())) = '22023:case_next_action_invalid',
  'the largest bigint cannot be incremented, so it is never a valid expected version');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, NULL)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504))) = '22023:case_next_action_invalid', 'a request id is required');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(504), 2,
  repeat('я', 1000), NULL, pg_temp.n241_id(904)) ->> 'admissions_version' = '3', 'exactly 1000 characters is accepted');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(506), gen_random_uuid())) = '22023:case_next_action_case_not_active',
  'a closed case is not edited');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  gen_random_uuid(), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'another organization id is refused');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(505), gen_random_uuid())) LIKE '42501:%', 'curator A cannot edit curator B''s case');
-- A CN playbook-configured case: 137's guard demands exactly version + 1.
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(509), 3,
  'Подать визовые документы', (SELECT d FROM n241_today) + 7, pg_temp.n241_id(905)) ->> 'admissions_version' = '4',
  'a playbook-configured case accepts the write through 137''s version guard');
-- «История»: the next-step events appear in the allowlisted activity stream.
SELECT platform.staff_student_case_activity(pg_temp.n241_id(504), 50) AS n241_activity \gset
SELECT pg_temp.n241_assert((SELECT count(*) = 3 FROM jsonb_array_elements(:'n241_activity'::JSONB -> 'events') e
  WHERE e ->> 'action' = 'case.next.action.change' AND e ->> 'target_kind' = 'overview'
    AND e ->> 'target_id' = pg_temp.n241_id(504)::TEXT AND e -> 'changed_fields' = '[]'::JSONB),
  'History shows the three next-step changes (set, clear, set) without payloads');
RESET ROLE;

-- Journal rows (superuser; authenticated has no SELECT on audit_events).
SELECT pg_temp.n241_assert((SELECT count(*) = 3 FROM platform.audit_events
  WHERE resource_id = pg_temp.n241_id(504) AND action = 'case.next.action.change'),
  'one journal row per committed write; replays and refusals add none');
SELECT pg_temp.n241_assert((SELECT before_state = jsonb_build_object('next_action', NULL, 'next_action_due_on', NULL, 'admissions_version', '0')
  AND after_state = jsonb_build_object('next_action', 'Позвонить студенту',
    'next_action_due_on', to_char((SELECT d FROM n241_today) + 3, 'YYYY-MM-DD'), 'admissions_version', '1')
  AND actor_membership_id = pg_temp.n241_id(303) AND actor_kind = 'user' AND resulting_version = 1
  AND reason = 'Case next action set' AND resource_type = 'student_case'
  FROM platform.audit_events WHERE request_id = pg_temp.n241_id(901)), 'journal row carries before/after and the actor');
SELECT pg_temp.n241_assert((SELECT reason = 'Case next action cleared' FROM platform.audit_events WHERE request_id = pg_temp.n241_id(903)),
  'clearing is journaled as cleared');
SELECT pg_temp.n241_assert((SELECT next_action = 'Шаг 505' AND admissions_version = 0
  FROM platform.student_cases WHERE id = pg_temp.n241_id(505)), 'refused writes left curator B''s case untouched');
SELECT pg_temp.n241_assert((SELECT admissions_version = 4 AND admissions_playbook_version_id IS NOT NULL
  AND next_action = 'Подать визовые документы' FROM platform.student_cases WHERE id = pg_temp.n241_id(509)),
  'playbook case row updated with its binding intact');
SELECT pg_temp.n241_assert(NOT ('case.next.action.change' = ANY (platform_private.p7a_safe_audit_actions())),
  'the Admin audit search allowlist is deliberately unchanged');

-- ---------------------------------------------------------------------------
-- Admin: every case of the organization; may edit any active case; cannot
-- replay curator A's request id.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n241_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(cardinality(pg_temp.n241_ids('mine', 'due', 100)) = 0, 'Admin curates nothing, so «Мои» is empty');
SELECT pg_temp.n241_assert((SELECT array_agg(x ORDER BY x) FROM unnest(pg_temp.n241_ids('active', 'due', 100)) x) = ARRAY[
  pg_temp.n241_id(501), pg_temp.n241_id(502), pg_temp.n241_id(503), pg_temp.n241_id(504), pg_temp.n241_id(505),
  pg_temp.n241_id(507), pg_temp.n241_id(509), pg_temp.n241_id(510), pg_temp.n241_id(511)], 'Admin sees every active case');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('active', 'due', 2) = pg_temp.n241_ids('active', 'due', 100), 'Admin due paging is stable');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('active', 'updated', 2) = pg_temp.n241_ids('active', 'updated', 100), 'Admin updated paging is stable');
SELECT pg_temp.n241_assert(cardinality(pg_temp.n241_ids('needs_curator', 'due', 100)) = 0,
  'a pending case without sale or handoff evidence does not wait for a curator');
SELECT pg_temp.n241_counts_match_rows('Admin');
SELECT pg_temp.n241_assert((SELECT jsonb_agg(c ->> 'membership_id' ORDER BY c ->> 'membership_id')
  FROM jsonb_array_elements(platform.staff_student_case_queue_counts_v1('active') -> 'curators') c)
  = jsonb_build_array(pg_temp.n241_id(303)::TEXT, pg_temp.n241_id(304)::TEXT, pg_temp.n241_id(306)::TEXT),
  'Admin curator facet lists the three curators of active cases');
SELECT pg_temp.n241_assert((pg_temp.n241_row('active', pg_temp.n241_id(505)) -> 'documents') IS NOT NULL,
  'Admin reads checklist counts');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(505), 0,
  'Проверить ответ вуза', (SELECT d FROM n241_today) + 1, pg_temp.n241_id(911)) ->> 'admissions_version' = '1',
  'Admin edits any active case');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, %L, %L, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(504), '  Позвонить студенту  ', (SELECT d FROM n241_today) + 3, pg_temp.n241_id(901)))
  = '22023:case_next_action_request_conflict', 'another actor cannot replay a request id');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Curator B: own case only; no document.read.full, so no checklist numbers.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n241_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(pg_temp.n241_ids('active', 'due', 100) = ARRAY[pg_temp.n241_id(505)], 'curator B sees only B''s case');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(505)) -> 'documents' = 'null'::JSONB,
  'without document.read.full the checklist counts are absent, not zero');
SELECT pg_temp.n241_assert(pg_temp.n241_row('mine', pg_temp.n241_id(505)) ->> 'admissions_version' = '1',
  'B sees Admin''s committed version');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'another curator is refused');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(505), 1,
  'Отправить пакет', NULL, gen_random_uuid()) ->> 'admissions_version' = '2', 'the case''s own curator edits it');
SELECT pg_temp.n241_counts_match_rows('curator B');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Curator C: named curator of 510 but the role reaches only case 511.
-- «Мои» must not widen visibility to 510; the record grant is honoured.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n241_curator_c';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(cardinality(pg_temp.n241_ids('mine', 'due', 100)) = 0,
  '«Мои» never shows a curated case the actor cannot read');
SELECT pg_temp.n241_assert(pg_temp.n241_ids('active', 'due', 100) = ARRAY[pg_temp.n241_id(511)], 'record scope reads one case');
SELECT pg_temp.n241_assert((platform.staff_student_case_queue_counts_v1('mine') -> 'views' ->> 'mine')::INTEGER = 0,
  '«Мои» count agrees: no widening');
SELECT pg_temp.n241_counts_match_rows('curator C');
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(510), gen_random_uuid())) LIKE '42501:%',
  'being named curator without read authority does not allow the write');
SELECT pg_temp.n241_assert(platform.set_case_next_action_v1(pg_temp.n241_id(1), pg_temp.n241_id(511), 0,
  'Шаг по записи', NULL, gen_random_uuid()) ->> 'admissions_version' = '1',
  'a record-scoped case.route.manage grant passes, like every case.route.manage command');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Sales, Student, anon, authenticated without claims: refused everywhere.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n241_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'Sales cannot write the next step');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('active')$q$) LIKE '42501:%', 'Sales cannot read the queue');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_counts_v1('active')$q$) LIKE '42501:%', 'Sales cannot read the counts');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'n241_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'a Student cannot write the next step');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('active')$q$) LIKE '42501:%', 'a Student cannot read the queue');
RESET ROLE;

SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'anon cannot execute the write');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('active')$q$) LIKE '42501:%', 'anon cannot execute the queue read');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_counts_v1('active')$q$) LIKE '42501:%', 'anon cannot execute the counts read');
RESET ROLE;

SET LOCAL request.jwt.claims TO '{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'a session without a staff actor is refused');
SELECT pg_temp.n241_assert(pg_temp.n241_error($q$SELECT platform.staff_student_case_queue_v1('active')$q$) LIKE '42501:%', 'a session without a staff actor cannot read');
RESET ROLE;

SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n241_assert(pg_temp.n241_error(format($q$SELECT platform.set_case_next_action_v1(%L, %L, 0, 'Шаг', NULL, %L)$q$,
  pg_temp.n241_id(1), pg_temp.n241_id(501), gen_random_uuid())) LIKE '42501:%', 'service_role has no EXECUTE on the write');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Final invariants (superuser).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n241_assert((SELECT count(*) = 7 FROM platform.audit_events
  WHERE organization_id = pg_temp.n241_id(1) AND action = 'case.next.action.change'),
  'seven committed writes (A x4, Admin, B, C), seven journal rows');
SELECT pg_temp.n241_assert((SELECT next_action = 'Шаг 501' AND admissions_version = 0
  FROM platform.student_cases WHERE id = pg_temp.n241_id(501)), 'every refused write left case 501 untouched');
SELECT pg_temp.n241_assert((SELECT next_action = 'Шаг 510' AND admissions_version = 0
  FROM platform.student_cases WHERE id = pg_temp.n241_id(510)), 'refused write left case 510 untouched');
SELECT pg_temp.n241_assert((
  SELECT bool_and(NOT has_function_privilege(role_name, f, 'EXECUTE'))
  FROM unnest(ARRAY['anon', 'service_role', 'supabase_auth_admin']) AS role_name,
    unnest(ARRAY[
      'platform.set_case_next_action_v1(uuid,uuid,bigint,text,date,uuid)',
      'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
      'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)']::REGPROCEDURE[]) AS f
) AND (
  SELECT bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
  FROM unnest(ARRAY[
      'platform.set_case_next_action_v1(uuid,uuid,bigint,text,date,uuid)',
      'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
      'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)']::REGPROCEDURE[]) AS f
) AND NOT has_function_privilege('authenticated',
  'platform_private.case_queue_in_view(text,platform.student_case_state,boolean,text[])'::REGPROCEDURE, 'EXECUTE'),
  'only authenticated executes the three RPCs; helpers stay private');
SELECT pg_temp.n241_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
  FROM pg_proc p WHERE p.oid IN (
    'platform.set_case_next_action_v1(uuid,uuid,bigint,text,date,uuid)'::REGPROCEDURE,
    'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::REGPROCEDURE,
    'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::REGPROCEDURE)),
  'SECURITY DEFINER with an empty search_path');

SELECT 'N241_CASE_NEXT_ACTION_QUEUE_SUITE_PASS' AS n241_suite_marker;
ROLLBACK;
