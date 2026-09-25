\set ON_ERROR_STOP on
-- Boundary suite for migration 242: the «Ожидает начала» view of the
-- «Студенты» queue. platform.staff_student_case_queue_v1 and
-- platform.staff_student_case_queue_counts_v1 accept p_view 'pending'
-- (state 'pending'); every other view, the authority gate and row
-- visibility are unchanged. Isolated synthetic SQL fixtures only -- no Auth
-- invitation, real customer, provider or production action. Fixture style
-- follows platform_case_next_action_queue.sql (241).
BEGIN;

CREATE FUNCTION pg_temp.n242_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n242_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N242: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n242_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- Follow next_cursor to the end and return every case id in page order.
CREATE FUNCTION pg_temp.n242_ids(
  p_view TEXT, p_sort TEXT, p_limit INTEGER, p_direction TEXT DEFAULT NULL,
  p_curator UUID DEFAULT NULL, p_stage TEXT DEFAULT NULL
) RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE page JSONB; next_cur TEXT := NULL; ids UUID[] := ARRAY[]::UUID[]; pages INTEGER := 0;
BEGIN
  LOOP
    page := platform.staff_student_case_queue_v1(p_view, p_limit, p_sort, next_cur, p_direction, p_curator, p_stage);
    ids := ids || COALESCE((SELECT array_agg((r ->> 'student_case_id')::UUID ORDER BY o)
      FROM jsonb_array_elements(page -> 'rows') WITH ORDINALITY AS t(r, o)), ARRAY[]::UUID[]);
    next_cur := page ->> 'next_cursor';
    EXIT WHEN next_cur IS NULL;
    pages := pages + 1;
    IF pages > 50 THEN RAISE EXCEPTION 'N242: paging did not terminate'; END IF;
  END LOOP;
  RETURN ids;
END
$$;
-- Every view count and total equals the rows the same view returns.
CREATE FUNCTION pg_temp.n242_counts_match_rows(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT; counts JSONB; bands_total BIGINT;
BEGIN
  FOREACH v IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending'] LOOP
    counts := platform.staff_student_case_queue_counts_v1(v);
    PERFORM pg_temp.n242_assert((counts -> 'views' ->> v)::BIGINT = cardinality(pg_temp.n242_ids(v, 'due', 100)),
      p_label || ': view count equals rows for ' || v);
    PERFORM pg_temp.n242_assert((counts ->> 'total')::BIGINT = cardinality(pg_temp.n242_ids(v, 'due', 100)),
      p_label || ': total equals rows for ' || v);
    SELECT sum(value::BIGINT) INTO bands_total FROM jsonb_each_text(counts -> 'bands');
    PERFORM pg_temp.n242_assert(bands_total = (counts ->> 'total')::BIGINT, p_label || ': bands add up to total for ' || v);
  END LOOP;
END
$$;
-- Every facet of the pending view equals the rows the same filter returns.
CREATE FUNCTION pg_temp.n242_pending_facets_match(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE counts JSONB := platform.staff_student_case_queue_counts_v1('pending'); facet JSONB; facet_total BIGINT;
BEGIN
  FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'directions') LOOP
    PERFORM pg_temp.n242_assert((facet ->> 'count')::BIGINT = cardinality(pg_temp.n242_ids('pending', 'due', 100, facet ->> 'direction')),
      p_label || ': pending direction facet equals filtered rows');
  END LOOP;
  FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'curators') LOOP
    PERFORM pg_temp.n242_assert((facet ->> 'count')::BIGINT
      = cardinality(pg_temp.n242_ids('pending', 'due', 100, NULL, (facet ->> 'membership_id')::UUID)),
      p_label || ': pending curator facet equals filtered rows');
  END LOOP;
  FOR facet IN SELECT value FROM jsonb_array_elements(counts -> 'stages') LOOP
    PERFORM pg_temp.n242_assert((facet ->> 'count')::BIGINT = cardinality(pg_temp.n242_ids('pending', 'due', 100, NULL, NULL, facet ->> 'pipeline_stage')),
      p_label || ': pending stage facet equals filtered rows');
  END LOOP;
  SELECT COALESCE(sum((value ->> 'count')::BIGINT), 0) INTO facet_total FROM jsonb_array_elements(counts -> 'directions');
  PERFORM pg_temp.n242_assert(facet_total = (counts ->> 'total')::BIGINT, p_label || ': pending directions add up to the total');
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n242_id(INTEGER), pg_temp.n242_assert(BOOLEAN, TEXT), pg_temp.n242_error(TEXT),
  pg_temp.n242_ids(TEXT, TEXT, INTEGER, TEXT, UUID, TEXT), pg_temp.n242_counts_match_rows(TEXT),
  pg_temp.n242_pending_facets_match(TEXT)
  TO authenticated, anon, service_role;

SELECT 'N242_CASE_QUEUE_PENDING_VIEW_SUITE_START' AS n242_suite_marker;

-- The shared predicate: pending is exactly state 'pending'.
SELECT pg_temp.n242_assert(platform_private.case_queue_in_view('pending', 'pending', FALSE, NULL), 'pending state is in the pending view');
SELECT pg_temp.n242_assert(NOT platform_private.case_queue_in_view('pending', 'active', TRUE, NULL), 'active is not pending');
SELECT pg_temp.n242_assert(NOT platform_private.case_queue_in_view('pending', 'closed', FALSE, NULL), 'closed is not pending');
SELECT pg_temp.n242_assert(NOT platform_private.case_queue_in_view('active', 'pending', FALSE, NULL), 'pending is still not active');
SELECT pg_temp.n242_assert(NOT platform_private.case_queue_in_view('bogus', 'pending', FALSE, NULL), 'unknown views stay empty');

-- ---------------------------------------------------------------------------
-- Fixture: admin (1), sales (2), curator A (3), a manager invited through
-- «Сотрудники» (4: no coarse role, as 157 creates staff) and a legacy finance
-- member (5: coarse role frozen since 155). Only this organization's
-- synthetic rows are created.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n242_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO n242_actors(n, role) VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, NULL), (5, 'finance');
GRANT SELECT ON n242_actors TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n242_id(1), 'N242 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n242_id(100 + n), 'n242-' || n || '@example.invalid', '{}'::JSONB FROM n242_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n242_id(200 + n), pg_temp.n242_id(100 + n), 'N242 Actor ' || n, 'active', 1 FROM n242_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n242_id(300 + n), pg_temp.n242_id(1), pg_temp.n242_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM n242_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n242_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n242_id(401), pg_temp.n242_id(1), 'organization', pg_temp.n242_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n242_id(1), pg_temp.n242_id(301), pg_temp.n242_id(401), 1, 1, TRUE, 'system',
    'N242 synthetic organization scope', pg_temp.n242_id(601));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n242_id(420 + k), pg_temp.n242_id(1), 'student_case', pg_temp.n242_id(500 + k), 1
  FROM generate_series(1, 5) AS k;

CREATE TEMP TABLE n242_today AS SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS d;
GRANT SELECT ON n242_today TO authenticated;

SET LOCAL session_replication_role = replica;
-- 501 active and 505 active with an overdue step (curator A), 502/503 plain
-- pending cases (no curator, no handoff, no sale evidence; 503 carries the
-- 088-style default step; 502 is already on «shortlist», so the pending stage
-- facet has two buckets), 504 closed (curator A).
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, closed_at, current_scope_id, current_scope_version,
  admissions_direction, pipeline_stage, next_action, next_action_due_on
)
SELECT pg_temp.n242_id(500 + f.k), pg_temp.n242_id(1), pg_temp.n242_id(302),
  CASE WHEN f.state = 'pending' THEN NULL ELSE pg_temp.n242_id(303) END,
  'synthetic:n242:' || f.k, 'N242 Student ' || (500 + f.k), f.country, 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state,
  CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END,
  pg_temp.n242_id(420 + f.k), 1, f.direction, f.stage, f.step,
  CASE WHEN f.due_offset IS NULL THEN NULL ELSE (SELECT d FROM n242_today) + f.due_offset END
FROM (VALUES
  (1, 'active', 'CN', 'CN', 'new', 'Шаг 501', 5),
  (2, 'pending', 'MY', 'MY', 'shortlist', NULL, NULL),
  (3, 'pending', 'CN', NULL, 'new', 'Шаг 503', 2),
  (4, 'closed', 'IT', 'EUROPE', 'new', 'Шаг 504', -5),
  (5, 'active', 'TR', 'TR', 'new', 'Шаг 505', -1)
) AS f(k, state, country, direction, stage, step, due_offset);
SET LOCAL session_replication_role = origin;

-- Staff roles through the installed commands. Curator A: own scope with full
-- case read; Sales: the Sales template's summary keys, own scope; the manager
-- and the legacy finance member: full case read on the whole organization.
CREATE TEMP TABLE n242_roles(role_id UUID, membership_id UUID, keys JSONB, request_base INTEGER, scope JSONB);
INSERT INTO n242_roles VALUES
  (pg_temp.n242_id(701), pg_temp.n242_id(303), '["case.read.full","case.route.manage","case.update.append"]', 710,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n242_id(702), pg_temp.n242_id(302), '["lead.read","case.read.summary","document.read.sales","task.create"]', 720,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n242_id(703), pg_temp.n242_id(304), '["case.read.full","case.route.manage","case.update.append"]', 730,
    jsonb_build_object('kind', 'organization', 'key', pg_temp.n242_id(1)::TEXT, 'resourceKind', NULL)),
  (pg_temp.n242_id(704), pg_temp.n242_id(305), '["case.read.full","case.route.manage","case.update.append"]', 740,
    jsonb_build_object('kind', 'organization', 'key', pg_temp.n242_id(1)::TEXT, 'resourceKind', NULL));
GRANT SELECT ON n242_roles TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n242_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n242_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n242_admin \gset
SET LOCAL request.jwt.claims TO :'n242_admin';
SET LOCAL ROLE authenticated;
DO $n242_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM n242_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n242_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N242 role ' || r.request_base, 'description', 'Migration 242 synthetic role',
        'permissionKeys', r.keys), 'N242 create role', pg_temp.n242_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n242_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n242_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N242 publish role', pg_temp.n242_id(r.request_base + 2));
    PERFORM platform.staff_role_assignments_save(pg_temp.n242_id(1), r.membership_id, 1,
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'scope', r.scope)),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'roleVersion', 2,
        'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'N242 grant role', pg_temp.n242_id(r.request_base + 3));
  END LOOP;
END
$n242_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions.
UPDATE n242_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n242_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n242_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n242_admin FROM n242_actors WHERE n = 1 \gset
SELECT claims AS n242_sales FROM n242_actors WHERE n = 2 \gset
SELECT claims AS n242_curator FROM n242_actors WHERE n = 3 \gset
SELECT claims AS n242_manager FROM n242_actors WHERE n = 4 \gset
SELECT claims AS n242_finance FROM n242_actors WHERE n = 5 \gset
SELECT pg_temp.n242_assert((SELECT count(*) = 5 FROM n242_actors
  WHERE claims::JSONB ->> 'platform_membership_id' = pg_temp.n242_id(300 + n)::TEXT), 'staff claims resolve to their memberships');
SELECT pg_temp.n242_assert(:'n242_manager'::JSONB ->> 'platform_role' = 'staff', 'the invited manager has no coarse role');
SELECT pg_temp.n242_assert(:'n242_finance'::JSONB ->> 'platform_role' = 'finance', 'the legacy member keeps the frozen finance role');

-- ---------------------------------------------------------------------------
-- Admin: the pending view lists exactly the pending cases; nothing else moves.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n242_admin';
SET LOCAL ROLE authenticated;

SELECT pg_temp.n242_assert(pg_temp.n242_ids('pending', 'due', 100) = ARRAY[pg_temp.n242_id(503), pg_temp.n242_id(502)],
  'pending view: the two pending cases, dated step first');
SELECT pg_temp.n242_assert(pg_temp.n242_ids('pending', 'due', 1) = pg_temp.n242_ids('pending', 'due', 100), 'pending due paging by 1 is stable');
SELECT pg_temp.n242_assert(pg_temp.n242_ids('pending', 'updated', 1) = pg_temp.n242_ids('pending', 'updated', 100), 'pending updated paging by 1 is stable');
SELECT pg_temp.n242_assert(
  (SELECT bool_and(r ->> 'state' = 'pending') FROM jsonb_array_elements(platform.staff_student_case_queue_v1('pending', 100) -> 'rows') AS r),
  'every pending row reports state pending');
SELECT pg_temp.n242_assert(
  (SELECT array_agg(x ORDER BY x) FROM unnest(pg_temp.n242_ids('active', 'due', 100)) AS x)
    = ARRAY[pg_temp.n242_id(501), pg_temp.n242_id(505)],
  'active view is unchanged: no pending case');
SELECT pg_temp.n242_assert(pg_temp.n242_ids('closed', 'due', 100) = ARRAY[pg_temp.n242_id(504)], 'closed view is unchanged');
SELECT pg_temp.n242_assert((platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 2,
  'counts report views.pending');
SELECT pg_temp.n242_assert(
  (SELECT count(*) = 6 FROM jsonb_object_keys(platform.staff_student_case_queue_counts_v1('active') -> 'views')),
  'views carries exactly the six views');
SELECT pg_temp.n242_counts_match_rows('admin');
SELECT pg_temp.n242_pending_facets_match('admin');
SELECT pg_temp.n242_assert(jsonb_array_length(platform.staff_student_case_queue_counts_v1('pending') -> 'stages') = 2,
  'the pending stage facet has both stages, so the stage filter is exercised');
SELECT pg_temp.n242_assert(jsonb_array_length(platform.staff_student_case_queue_counts_v1('pending') -> 'curators') = 0,
  'pending cases have no curator, so the pending curator facet is empty');
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_v1('bogus', 10)$q$) = '22023',
  'unknown view is still invalid for the page read');
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_counts_v1('bogus')$q$) = '22023',
  'unknown view is still invalid for the counts read');

-- ---------------------------------------------------------------------------
-- Curator A (own scope): row visibility is unchanged — unassigned pending
-- cases stay invisible, and every number still equals the rows.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n242_curator';
SELECT pg_temp.n242_assert(cardinality(pg_temp.n242_ids('pending', 'due', 100)) = 0,
  'own-scope curator does not see unassigned pending cases');
SELECT pg_temp.n242_assert((platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 0,
  'own-scope curator pending count is zero');
SELECT pg_temp.n242_counts_match_rows('curator A');

-- ---------------------------------------------------------------------------
-- A manager invited through «Сотрудники» (no coarse role) reads the queue by
-- the right: 241's coarse check lets a NULL role through, and the
-- organization scope shows the unassigned pending cases.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n242_manager';
SELECT pg_temp.n242_assert(pg_temp.n242_ids('pending', 'due', 100) = ARRAY[pg_temp.n242_id(503), pg_temp.n242_id(502)],
  'the invited manager sees the pending cases of the organization');
SELECT pg_temp.n242_counts_match_rows('manager');
SELECT pg_temp.n242_pending_facets_match('manager');

-- ---------------------------------------------------------------------------
-- A legacy member whose frozen coarse role is finance is refused even with
-- full case read on the organization — the 241 gate this migration keeps.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n242_finance';
SELECT pg_temp.n242_assert(platform.staff_access_snapshot() -> 'permissions' ? 'case.read.full',
  'the legacy finance member does hold case.read.full — the refusal is the coarse role');
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_v1('pending', 10)$q$) = '42501',
  'a legacy finance role is refused the pending view despite case.read.full');
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_counts_v1('pending')$q$) = '42501',
  'a legacy finance role is refused pending counts despite case.read.full');

-- ---------------------------------------------------------------------------
-- Refusals are unchanged: Sales and anon cannot read any view, pending included.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n242_sales';
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_v1('pending', 10)$q$) = '42501',
  'Sales cannot read the pending view');
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_counts_v1('pending')$q$) = '42501',
  'Sales cannot read pending counts');
RESET ROLE;
RESET request.jwt.claims;
SET LOCAL ROLE anon;
SELECT pg_temp.n242_assert(pg_temp.n242_error($q$SELECT platform.staff_student_case_queue_v1('pending', 10)$q$) = '42501',
  'anon cannot read the pending view');
RESET ROLE;

SELECT 'N242_CASE_QUEUE_PENDING_VIEW_SUITE_PASSED' AS n242_suite_marker;
ROLLBACK;
