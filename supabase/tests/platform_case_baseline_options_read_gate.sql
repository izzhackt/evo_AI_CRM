\set ON_ERROR_STOP on
-- Boundary suite for migration 243: platform.staff_case_baseline_checklist_options
-- (179) works in a READ ONLY transaction, which PostgREST uses for every GET
-- and for every POST to a STABLE function. Before 243 its gate
-- (require_case_operator -> require_domain_actor, 155) took SELECT ... FOR
-- UPDATE and failed with 25006 on every read. The suite proves:
--  1) under READ ONLY the read returns its rows, no 25006 (control: the old
--     gate in the same mode still fails with 25006);
--  2) without 'document.manage' the read is refused with 42501;
--  3) a case outside the staff member's scope is refused with 42501;
-- and that the new gate decides exactly like the old one for every fixture
-- actor and case. Isolated synthetic SQL fixtures only -- no Auth invitation,
-- real customer, provider or production action. Fixture style follows
-- platform_case_queue_pending_view.sql (242).
BEGIN;

CREATE FUNCTION pg_temp.n243_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n243_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N243: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n243_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- The options read for one case of the fixture organization, as the SQLSTATE
-- of the call ('ok' when it returned).
CREATE FUNCTION pg_temp.n243_read_state(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n243_error(format(
    'SELECT count(*) FROM platform.staff_case_baseline_checklist_options(%L, %L)',
    pg_temp.n243_id(1), pg_temp.n243_id(p_case)))
$$;
-- The old 179 gate for the same call, as a SQLSTATE.
CREATE FUNCTION pg_temp.n243_old_gate_state(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n243_error(format(
    'SELECT * FROM platform_private.require_case_operator(%L, %L, %L)',
    pg_temp.n243_id(1), pg_temp.n243_id(p_case), 'document.manage'))
$$;
-- Version ids offered for one case, in the read's own order.
CREATE FUNCTION pg_temp.n243_options(p_case INTEGER) RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(o.country_requirement_version_id), ARRAY[]::UUID[])
  FROM platform.staff_case_baseline_checklist_options(pg_temp.n243_id(1), pg_temp.n243_id(p_case)) AS o
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n243_id(INTEGER), pg_temp.n243_assert(BOOLEAN, TEXT),
  pg_temp.n243_error(TEXT), pg_temp.n243_read_state(INTEGER), pg_temp.n243_options(INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N243_CASE_BASELINE_OPTIONS_READ_GATE_SUITE_START' AS n243_suite_marker;

-- ---------------------------------------------------------------------------
-- Catalog: the read stays STABLE SECURITY DEFINER with a lock-free gate and
-- unchanged grants; the seeding write keeps its locking gate.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n243_assert((
  SELECT proc.provolatile = 's' AND proc.prosecdef
    AND proc.proconfig = ARRAY['search_path=""']
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = 'platform.staff_case_baseline_checklist_options(uuid,uuid)'::REGPROCEDURE
), 'the options read stays STABLE SECURITY DEFINER with an empty search_path');
SELECT pg_temp.n243_assert((
  SELECT strpos(proc.prosrc, 'require_case_operator') = 0
    AND strpos(upper(proc.prosrc), 'FOR UPDATE') = 0
    AND strpos(proc.prosrc, 'platform_private.require_domain_actor_read(') > 0
    AND strpos(proc.prosrc, 'platform_private.staff_can_access(') > 0
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = 'platform.staff_case_baseline_checklist_options(uuid,uuid)'::REGPROCEDURE
), 'the options read gate is require_domain_actor_read plus staff_can_access, with no row lock');
SELECT pg_temp.n243_assert(
  has_function_privilege('authenticated', 'platform.staff_case_baseline_checklist_options(uuid,uuid)', 'EXECUTE'),
  'authenticated still executes the options read');
SELECT pg_temp.n243_assert(
  NOT has_function_privilege('anon', 'platform.staff_case_baseline_checklist_options(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.staff_case_baseline_checklist_options(uuid,uuid)', 'EXECUTE'),
  'anon and service_role still cannot execute the options read');
SELECT pg_temp.n243_assert((
  SELECT proc.provolatile = 'v'
    AND strpos(proc.prosrc, 'platform_private.require_case_operator(') > 0
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = 'platform.seed_case_baseline_checklist(uuid,uuid,uuid,uuid)'::REGPROCEDURE
), 'the seeding write is untouched: VOLATILE behind require_case_operator');

-- ---------------------------------------------------------------------------
-- Fixture: admin (1), curator A with 'document.manage' on own cases (2), a
-- reader with case and document read but no 'document.manage' on the whole
-- organization (3), and a manager with 'document.manage' on the whole
-- organization (4). Only this organization's synthetic rows are created.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n243_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO n243_actors(n, role) VALUES (1, 'admin'), (2, 'curator'), (3, 'curator'), (4, NULL);
GRANT SELECT ON n243_actors TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n243_id(1), 'N243 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n243_id(100 + n), 'n243-' || n || '@example.invalid', '{}'::JSONB FROM n243_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n243_id(200 + n), pg_temp.n243_id(100 + n), 'N243 Actor ' || n, 'active', 1 FROM n243_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n243_id(300 + n), pg_temp.n243_id(1), pg_temp.n243_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM n243_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n243_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n243_id(401), pg_temp.n243_id(1), 'organization', pg_temp.n243_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n243_id(1), pg_temp.n243_id(301), pg_temp.n243_id(401), 1, 1, TRUE, 'system',
    'N243 synthetic organization scope', pg_temp.n243_id(601));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n243_id(420 + k), pg_temp.n243_id(1), 'student_case', pg_temp.n243_id(500 + k), 1
  FROM generate_series(1, 3) AS k;

SET LOCAL session_replication_role = replica;
-- Approved CN/Bachelor/General v1 with two active requirements (801), an
-- approved version without requirements (802) and a draft (803): only 801
-- is ever a real option.
INSERT INTO platform.country_requirement_versions(
  id, organization_id, target_country, target_degree, program_direction, version, status,
  created_by_membership_id, approved_by_membership_id, approved_at
) VALUES
  (pg_temp.n243_id(801), pg_temp.n243_id(1), 'CN', 'Bachelor', 'General', 1, 'approved',
    pg_temp.n243_id(301), pg_temp.n243_id(301), clock_timestamp()),
  (pg_temp.n243_id(802), pg_temp.n243_id(1), 'CN', 'Master', 'General', 1, 'approved',
    pg_temp.n243_id(301), pg_temp.n243_id(301), clock_timestamp()),
  (pg_temp.n243_id(803), pg_temp.n243_id(1), 'CN', 'Bachelor', 'General', 2, 'draft',
    pg_temp.n243_id(301), NULL, NULL);
INSERT INTO platform.document_requirements(
  id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, status, created_by_membership_id
) VALUES
  (pg_temp.n243_id(811), pg_temp.n243_id(1), 'CN', 'Bachelor', 'General', 1, 'n243.passport',
    'N243 passport', 'N243 synthetic instruction', 'active', pg_temp.n243_id(301)),
  (pg_temp.n243_id(812), pg_temp.n243_id(1), 'CN', 'Bachelor', 'General', 1, 'n243.transcript',
    'N243 transcript', 'N243 synthetic instruction', 'active', pg_temp.n243_id(301));
-- 501: active, curator A, route only partly set (degree and direction open),
-- unbound. 502: the same route, curated by the organization manager -- outside
-- curator A's own scope. 503: curator A, already bound to 801, so no version
-- is an option any more.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction,
  operational_stage, state, handoff_at, current_scope_id, current_scope_version,
  admissions_direction, pipeline_stage, applied_country_requirement_version_id
)
SELECT pg_temp.n243_id(500 + f.k), pg_temp.n243_id(1), pg_temp.n243_id(301), pg_temp.n243_id(f.curator),
  'synthetic:n243:' || f.k, 'N243 Student ' || (500 + f.k), 'CN', f.degree, f.direction,
  'contract_confirmed', 'active', clock_timestamp(), pg_temp.n243_id(420 + f.k), 1,
  'CN', 'new', CASE WHEN f.bound THEN pg_temp.n243_id(801) END
FROM (VALUES
  (1, 302, NULL, NULL, FALSE),
  (2, 304, NULL, NULL, FALSE),
  (3, 302, 'Bachelor', 'General', TRUE)
) AS f(k, curator, degree, direction, bound);
SET LOCAL session_replication_role = origin;

-- Staff roles through the installed commands.
CREATE TEMP TABLE n243_roles(role_id UUID, membership_id UUID, keys JSONB, request_base INTEGER, scope JSONB);
INSERT INTO n243_roles VALUES
  (pg_temp.n243_id(701), pg_temp.n243_id(302), '["case.read.full","document.read.full","document.manage"]', 710,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n243_id(702), pg_temp.n243_id(303), '["case.read.full","document.read.full"]', 720,
    jsonb_build_object('kind', 'organization', 'key', pg_temp.n243_id(1)::TEXT, 'resourceKind', NULL)),
  (pg_temp.n243_id(703), pg_temp.n243_id(304), '["case.read.full","document.read.full","document.manage"]', 730,
    jsonb_build_object('kind', 'organization', 'key', pg_temp.n243_id(1)::TEXT, 'resourceKind', NULL));
GRANT SELECT ON n243_roles TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n243_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n243_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n243_admin \gset
SET LOCAL request.jwt.claims TO :'n243_admin';
SET LOCAL ROLE authenticated;
DO $n243_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM n243_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n243_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N243 role ' || r.request_base, 'description', 'Migration 243 synthetic role',
        'permissionKeys', r.keys), 'N243 create role', pg_temp.n243_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n243_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n243_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N243 publish role', pg_temp.n243_id(r.request_base + 2));
    PERFORM platform.staff_role_assignments_save(pg_temp.n243_id(1), r.membership_id, 1,
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'scope', r.scope)),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'roleVersion', 2,
        'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'N243 grant role', pg_temp.n243_id(r.request_base + 3));
  END LOOP;
END
$n243_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions.
UPDATE n243_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n243_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n243_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n243_admin FROM n243_actors WHERE n = 1 \gset
SELECT claims AS n243_curator FROM n243_actors WHERE n = 2 \gset
SELECT claims AS n243_reader FROM n243_actors WHERE n = 3 \gset
SELECT claims AS n243_manager FROM n243_actors WHERE n = 4 \gset
SELECT pg_temp.n243_assert((SELECT count(*) = 4 FROM n243_actors
  WHERE claims::JSONB ->> 'platform_membership_id' = pg_temp.n243_id(300 + n)::TEXT), 'staff claims resolve to their memberships');

-- ---------------------------------------------------------------------------
-- Same authorization: in a read-write transaction (where the old gate's locks
-- are allowed) the new read and the old require_case_operator gate give the
-- same answer for every actor and case, including an unknown case id.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n243_admin';
SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'off', 'the equivalence check runs read-write');
DO $n243_same$
DECLARE actor RECORD; case_n INTEGER; old_state TEXT; new_state TEXT;
BEGIN
  FOR actor IN SELECT n, claims FROM n243_actors ORDER BY n LOOP
    PERFORM set_config('request.jwt.claims', actor.claims, TRUE);
    FOREACH case_n IN ARRAY ARRAY[501, 502, 503, 599] LOOP
      old_state := pg_temp.n243_old_gate_state(case_n);
      new_state := pg_temp.n243_read_state(case_n);
      IF old_state IS DISTINCT FROM new_state OR new_state NOT IN ('ok', '42501') THEN
        RAISE EXCEPTION 'N243: actor % case %: old gate % but new read %', actor.n, case_n, old_state, new_state;
      END IF;
    END LOOP;
  END LOOP;
END
$n243_same$;

-- ---------------------------------------------------------------------------
-- Control: in READ ONLY the old gate fails exactly as production did.
-- ---------------------------------------------------------------------------
SAVEPOINT n243_control;
SET TRANSACTION READ ONLY;
SET LOCAL request.jwt.claims TO :'n243_curator';
SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'on', 'control: the transaction is read-only');
SELECT pg_temp.n243_assert(pg_temp.n243_old_gate_state(501) = '25006',
  'control: the 179 gate (require_case_operator) fails with 25006 in READ ONLY');
ROLLBACK TO SAVEPOINT n243_control;

-- ---------------------------------------------------------------------------
-- 1) READ ONLY, curator A on an own case: rows, no 25006.
-- ---------------------------------------------------------------------------
SAVEPOINT n243_curator_read_only;
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO :'n243_curator';
SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'on', 'curator: the transaction is read-only');
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(501) = 'ok', 'curator: the read succeeds in READ ONLY (no 25006)');
SELECT pg_temp.n243_assert(pg_temp.n243_options(501) = ARRAY[pg_temp.n243_id(801)],
  'curator: the one approved, requirement-backed version is offered');
SELECT pg_temp.n243_assert((
  SELECT o.requirement_count = 2 AND o.target_country = 'CN' AND o.target_degree = 'Bachelor'
    AND o.program_direction = 'General' AND o.checklist_version = 1
  FROM platform.staff_case_baseline_checklist_options(pg_temp.n243_id(1), pg_temp.n243_id(501)) AS o
), 'curator: the option carries its route and requirement count');
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(503) = 'ok' AND cardinality(pg_temp.n243_options(503)) = 0,
  'curator: a bound case reads as an empty list, not an error');
-- 3) A case outside curator A's own scope, and an unknown case.
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(502) = '42501', 'curator: an out-of-scope case is refused with 42501');
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(599) = '42501', 'curator: an unknown case is refused with 42501');
ROLLBACK TO SAVEPOINT n243_curator_read_only;

-- ---------------------------------------------------------------------------
-- READ ONLY, organization-wide manager and Admin: rows on every case.
-- ---------------------------------------------------------------------------
SAVEPOINT n243_manager_read_only;
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO :'n243_manager';
SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'on', 'manager: the transaction is read-only');
SELECT pg_temp.n243_assert(pg_temp.n243_options(501) = ARRAY[pg_temp.n243_id(801)]
  AND pg_temp.n243_options(502) = ARRAY[pg_temp.n243_id(801)],
  'manager: organization scope reads both unbound cases in READ ONLY');
SET LOCAL request.jwt.claims TO :'n243_admin';
SELECT pg_temp.n243_assert(pg_temp.n243_options(502) = ARRAY[pg_temp.n243_id(801)],
  'Admin: reads the case in READ ONLY');
ROLLBACK TO SAVEPOINT n243_manager_read_only;

-- ---------------------------------------------------------------------------
-- 2) READ ONLY, no 'document.manage': refused with 42501 on every case.
-- ---------------------------------------------------------------------------
SAVEPOINT n243_reader_read_only;
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO :'n243_reader';
SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'on', 'reader: the transaction is read-only');
SELECT pg_temp.n243_assert(NOT (platform.staff_access_snapshot() -> 'permissions' ? 'document.manage')
  AND platform.staff_access_snapshot() -> 'permissions' ? 'document.read.full',
  'reader: holds document read but not document.manage');
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(501) = '42501', 'reader: refused with 42501 without document.manage');
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(502) = '42501', 'reader: refused with 42501 on every case');
ROLLBACK TO SAVEPOINT n243_reader_read_only;

-- anon cannot call the read at all.
SAVEPOINT n243_anon_read_only;
SET TRANSACTION READ ONLY;
SET LOCAL ROLE anon;
SELECT pg_temp.n243_assert(pg_temp.n243_read_state(501) = '42501', 'anon: refused with 42501');
ROLLBACK TO SAVEPOINT n243_anon_read_only;

SELECT pg_temp.n243_assert(current_setting('transaction_read_only') = 'off',
  'rolling back each savepoint restores the read-write transaction');

SELECT 'N243_CASE_BASELINE_OPTIONS_READ_GATE_SUITE_PASSED' AS n243_suite_marker;
ROLLBACK;
