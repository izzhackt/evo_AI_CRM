\set ON_ERROR_STOP on
-- Boundary suite for migration 323 «Отчёты Looker Studio» (docs/EVO_LOOKER_REPORTS_PLAN_2026-10-27.md §4, §6, §12.2):
-- хранение двух ссылок организации (отчёт «Маркетинга» и отчёт «Финансов»), чтение и правка. Runs on the real chain
-- right after 323 inside one transaction that is rolled back, with its own synthetic organizations, members and
-- roles (the roles are made and assigned through the REAL platform.staff_role_command / staff_role_publish /
-- staff_role_assignments_save; sessions are the real custom_access_token_hook claims): no Google call, no real
-- report, no real person, no production action. Report identifiers are synthetic or Google's public example.
--
-- Proves:
--  1. catalog and grants: the table is closed (RLS enabled and forced, no policy, no privilege for any client role);
--     the two staff functions are SECURITY DEFINER with an empty search_path, EXECUTE for authenticated only, the read
--     STABLE and the save VOLATILE; the private finance helper is closed to PUBLIC and every client role; the
--     journal allowlist grew by exactly one action and the previous list is intact;
--  2. who reads «marketing»: the Admin only; every other holder of finance rights, a role without finance, a
--     member without a role, a Student, an inactive member, another organization's Admin, anon, service_role and a
--     session without claims are refused with 42501;
--  3. who reads «finance»: the Admin and a holder of finance.read.full over the WHOLE organization; the same right
--     with the scope own, direction, department or record, a revoked assignment, finance.read.summary alone, a role
--     without finance, no role, a Student and an inactive member are refused with 42501;
--  4. the organization: a foreign or NULL organization is 42501 for read and save (even for an Admin of the other
--     organization); an unknown or NULL key is 22023;
--  5. no row yet: the read answers configured false, version 0, no identifiers, writes nothing;
--  6. saving: only the Admin (the accountant, the own-scope holder, a Student and a foreign Admin are 42501); the
--     first save with version 0 makes version 1; version 1 with no row and a second «first» save are PT409; bad
--     identifiers, versions, requests and a page without a report are 22023; the replay of one request returns the
--     same receipt with replayed true and no second journal row; the same request id with another input or from
--     another person is 23505; an old version is PT409; the same input is `unchanged` with no new version and no
--     journal row; removing (report NULL) keeps the row, configured false, version + 1; removing what is gone is
--     `unchanged`; the two keys and the two organizations never touch each other;
--  7. the journal: one report.link.change per real change (no row for unchanged, for a replay or for a refusal), the
--     object organization, the actor, the resulting version, the fingerprint kept out of the receipt;
--  8. direct access: authenticated and anon cannot read or write the table; anon and service_role cannot call the
--     functions.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

DO $t323_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t323_auth_role$;

\echo T323_REPORT_LINKS_SUITE_START

CREATE FUNCTION pg_temp.t323_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
-- The role set-up below runs as `authenticated` (the real role API), which then evaluates this helper.
GRANT EXECUTE ON FUNCTION pg_temp.t323_id(INTEGER) TO authenticated;
CREATE FUNCTION pg_temp.t323_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T323: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.t323_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.t323_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE TEMP TABLE t323_claims(actor INTEGER PRIMARY KEY, claims TEXT);
CREATE FUNCTION pg_temp.t323_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t323_call('authenticated', (SELECT claims FROM t323_claims WHERE actor = p_actor), p_sql)
$$;
-- A read: actor, key, organization number.
CREATE FUNCTION pg_temp.t323_read(p_actor INTEGER, p_key TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t323_as(p_actor, format('SELECT platform.organization_report_link_v1(%L, %L)', pg_temp.t323_id(p_org), p_key))
$$;
-- A save: actor, key, expected version, report id, page id, request number, organization number.
CREATE FUNCTION pg_temp.t323_save(p_actor INTEGER, p_key TEXT, p_version BIGINT, p_report TEXT, p_page TEXT, p_req INTEGER,
  p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t323_as(p_actor, format('SELECT platform.organization_report_link_save_v1(%L, %L, %s, %L, %L, %L)',
    pg_temp.t323_id(p_org), p_key, COALESCE(p_version::TEXT, 'NULL'), p_report, p_page, pg_temp.t323_id(6000 + p_req)))
$$;
CREATE FUNCTION pg_temp.t323_journal(p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.action = 'report.link.change' AND e.organization_id = pg_temp.t323_id(p_org)
$$;
CREATE FUNCTION pg_temp.t323_rows(p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.organization_report_links WHERE organization_id = pg_temp.t323_id(p_org)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   actor 1  org 1 Admin (system admin)             actor 12 org 1 second Admin (system admin)
--   actor 2  org 1 accountant: finance.read.full, scope organization
--   actor 3  org 1 salesperson: finance.read.full, scope own
--   actor 4  org 1 finance.read.full, scope direction (CN)
--   actor 5  org 1 finance.read.full, scope department
--   actor 6  org 1 finance.read.full, scope record (a student_case record)
--   actor 7  org 1 finance.read.summary only, scope organization
--   actor 8  org 1 a role without finance (lead.read), scope organization
--   actor 9  org 1 member without a role           actor 10 org 1 Student
--   actor 11 org 1 accountant whose assignment is revoked later
--   actor 13 org 1 accountant whose membership goes inactive later
--   actor 14 org 2 Admin (system admin)             actor 15 org 2 accountant (finance.read.full, scope organization)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t323_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t323_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, NULL, FALSE), (7, 1, NULL, FALSE), (8, 1, NULL, FALSE), (9, 1, NULL, FALSE),
  (10, 1, 'student', FALSE), (11, 1, NULL, FALSE), (12, 1, 'admin', TRUE), (13, 1, NULL, FALSE),
  (14, 2, 'admin', TRUE), (15, 2, NULL, FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t323_id(1), 'T323 Fictional organization', 'active'),
  (pg_temp.t323_id(2), 'T323 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t323_id(100 + n), 't323-' || n || '@example.invalid', '{}'::JSONB FROM t323_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t323_id(200 + n), pg_temp.t323_id(100 + n), 'T323 Actor ' || n, 'active', 1 FROM t323_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t323_id(300 + a.n), pg_temp.t323_id(a.org), pg_temp.t323_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t323_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t323_id(300 + n) FROM t323_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t323_id(401), pg_temp.t323_id(1), 'organization', pg_temp.t323_id(1), 1),
  (pg_temp.t323_id(402), pg_temp.t323_id(2), 'organization', pg_temp.t323_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t323_id(1), pg_temp.t323_id(301), pg_temp.t323_id(401), 1, 1, TRUE, 'system', 'T323 synthetic scope', pg_temp.t323_id(601)),
  (pg_temp.t323_id(1), pg_temp.t323_id(312), pg_temp.t323_id(401), 1, 1, TRUE, 'system', 'T323 synthetic scope', pg_temp.t323_id(603)),
  (pg_temp.t323_id(2), pg_temp.t323_id(314), pg_temp.t323_id(402), 1, 1, TRUE, 'system', 'T323 synthetic scope', pg_temp.t323_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES (pg_temp.t323_id(901), pg_temp.t323_id(1), 'T323 Department');

-- Roles in the production shape, through the real API as the Admin of each organization.
CREATE TEMP TABLE t323_roles(role_id UUID PRIMARY KEY, org INTEGER, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO t323_roles VALUES
  (pg_temp.t323_id(1101), 1, 'Full finance', '["finance.read.full"]', 1110),
  (pg_temp.t323_id(1102), 1, 'Summary finance', '["finance.read.summary"]', 1120),
  (pg_temp.t323_id(1103), 1, 'No finance', '["lead.read"]', 1130),
  (pg_temp.t323_id(1104), 2, 'Full finance', '["finance.read.full"]', 1140);
CREATE TEMP TABLE t323_grants(org INTEGER, actor INTEGER, role_id UUID, scope JSONB);
INSERT INTO t323_grants VALUES
  (1, 2, pg_temp.t323_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(1)::TEXT, 'resourceKind', NULL)),
  (1, 3, pg_temp.t323_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
  (1, 4, pg_temp.t323_id(1101), jsonb_build_object('kind', 'direction', 'key', 'CN', 'resourceKind', NULL)),
  (1, 5, pg_temp.t323_id(1101), jsonb_build_object('kind', 'department', 'key', pg_temp.t323_id(901)::TEXT, 'resourceKind', NULL)),
  (1, 7, pg_temp.t323_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(1)::TEXT, 'resourceKind', NULL)),
  (1, 8, pg_temp.t323_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(1)::TEXT, 'resourceKind', NULL)),
  (1, 11, pg_temp.t323_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(1)::TEXT, 'resourceKind', NULL)),
  (1, 13, pg_temp.t323_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(1)::TEXT, 'resourceKind', NULL)),
  (2, 15, pg_temp.t323_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t323_id(2)::TEXT, 'resourceKind', NULL));
CREATE TEMP TABLE t323_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id IN (pg_temp.t323_id(1), pg_temp.t323_id(2));
GRANT SELECT ON t323_roles, t323_grants, t323_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t323_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t323_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t323_admin1_setup \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t323_id(114),
  'claims', jsonb_build_object('sub', pg_temp.t323_id(114), 'role', 'authenticated'))) -> 'claims')::TEXT AS t323_admin2_setup \gset
-- The claims of the two organization Admins are kept as settings of this transaction for the DO block below.
SELECT set_config('t323.admin1', :'t323_admin1_setup', TRUE) IS NOT NULL AND set_config('t323.admin2', :'t323_admin2_setup', TRUE) IS NOT NULL AS t323_cfg \gset
DO $t323_roles$
DECLARE r RECORD; g RECORD; published JSONB; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB; saved TEXT;
BEGIN
  saved := current_setting('request.jwt.claims', TRUE);
  FOR r IN SELECT * FROM t323_roles ORDER BY request_base LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN r.org = 1 THEN current_setting('t323.admin1', TRUE)
      ELSE current_setting('t323.admin2', TRUE) END, TRUE);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM platform.staff_role_command(pg_temp.t323_id(r.org), r.role_id, 0, 'create',
      jsonb_build_object('label', 'T323 ' || r.label, 'description', 'Migration 323 synthetic role',
        'permissionKeys', r.keys), 'T323 create role', pg_temp.t323_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.t323_id(r.org), r.role_id, 1,
      platform.staff_role_impact(pg_temp.t323_id(r.org), r.role_id, 1) ->> 'impactFingerprint',
      'T323 publish role', pg_temp.t323_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
    EXECUTE 'RESET ROLE';
  END LOOP;
  FOR g IN SELECT DISTINCT org, actor FROM t323_grants ORDER BY org, actor LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN g.org = 1 THEN current_setting('t323.admin1', TRUE)
      ELSE current_setting('t323.admin2', TRUE) END, TRUE);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT jsonb_agg(jsonb_build_object('roleId', x.role_id, 'scope', x.scope) ORDER BY x.role_id),
      jsonb_agg(jsonb_build_object('roleId', x.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> x.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY x.role_id)
      INTO items, bindings FROM t323_grants x WHERE x.org = g.org AND x.actor = g.actor;
    PERFORM platform.staff_role_assignments_save(pg_temp.t323_id(g.org), pg_temp.t323_id(300 + g.actor),
      (SELECT access_version FROM t323_versions WHERE membership_id = pg_temp.t323_id(300 + g.actor)), items, bindings,
      'T323 grant role', pg_temp.t323_id(2000 + g.actor));
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
END
$t323_roles$;
-- The record scope has no «real record» to point at in this fixture: the assignment of actor 6 is the same row as an
-- organization one with the scope narrowed to a record (the table constraints still hold; the matcher compares it
-- with the asked resource, which is the organization, so it must never pass).
INSERT INTO platform.staff_role_assignments(organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key, resource_kind)
  SELECT a.organization_id, pg_temp.t323_id(306), a.role_id, a.bundle_id, 'record', pg_temp.t323_id(777)::TEXT, 'student_case'
  FROM platform.staff_role_assignments a WHERE a.membership_id = pg_temp.t323_id(302) AND a.revoked_at IS NULL LIMIT 1;
-- Actor 11's assignment is revoked; the membership of actor 13 goes inactive (claims are minted before that).
INSERT INTO t323_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t323_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.t323_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM t323_actors a;
UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp() WHERE membership_id = pg_temp.t323_id(311);
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t323_id(313);
SELECT pg_temp.t323_assert((SELECT array_agg(scope_kind ORDER BY scope_kind) FROM platform.staff_role_assignments
    WHERE organization_id = pg_temp.t323_id(1) AND revoked_at IS NULL AND membership_id IN (pg_temp.t323_id(302), pg_temp.t323_id(303),
      pg_temp.t323_id(304), pg_temp.t323_id(305), pg_temp.t323_id(306)))
  = ARRAY['department', 'direction', 'organization', 'own', 'record'],
  'fixture: the finance.read.full holders have exactly the five scopes organization / own / direction / department / record');
SELECT pg_temp.t323_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY actor) FROM t323_claims WHERE actor IN (1, 2, 9, 10))
  = ARRAY['admin', 'staff', 'staff', 'student'], 'fixture: the token hook mints admin for the system Admin, staff for invited members, student for the Student');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
    WHERE c.oid = 'platform_private.organization_report_links'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'platform_private.organization_report_links'::regclass)
  AND (SELECT bool_and(NOT has_table_privilege(r.role, 'platform_private.organization_report_links', priv.p))
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) priv(p))
  AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'platform_private.organization_report_links'::regclass AND a.grantee = 0),
  'the table: RLS enabled and forced, no policy, no privilege for PUBLIC or any client role');
SELECT pg_temp.t323_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform'
      AND p.proname IN ('organization_report_link_v1', 'organization_report_link_save_v1'))
  AND (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform'
      AND p.proname IN ('organization_report_link_v1', 'organization_report_link_save_v1'))
  AND (SELECT p.provolatile = 's' FROM pg_proc p WHERE p.oid = 'platform.organization_report_link_v1(uuid,text)'::regprocedure)
  AND (SELECT p.provolatile = 'v' FROM pg_proc p WHERE p.oid = 'platform.organization_report_link_save_v1(uuid,text,bigint,text,text,uuid)'::regprocedure),
  'the two staff functions: SECURITY DEFINER, empty search_path, owner postgres, EXECUTE for authenticated only; the read STABLE, the save VOLATILE');
SELECT pg_temp.t323_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND (SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
        FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role))
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform_private.report_link_finance_org_access(uuid,uuid)'::regprocedure),
  'the private finance helper is closed to PUBLIC and every client role, definer with an empty search_path');
SELECT pg_temp.t323_assert('report.link.change' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('report.link.change' = ANY (platform_private.p7a_safe_audit_actions_pre_report_links()))
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_report_links()) + 1
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_actions_pre_report_links()) x(a)
      WHERE NOT (a = ANY (platform_private.p7a_safe_audit_actions())))
  AND 'organization' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND 'report.link.change' ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$',
  'the journal allowlist grew by exactly report.link.change and kept every earlier action; the object type organization was already allowed');

-- ---------------------------------------------------------------------------
-- 2. Who reads «marketing».
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(1, 'marketing')) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(12, 'marketing')) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(14, 'marketing', 2)) IS NULL,
  '«marketing»: the Admin, a second Admin and the other organization''s own Admin read');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(2, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(3, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(4, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(5, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(6, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(7, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(8, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(9, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(10, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(11, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(13, 'marketing')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(15, 'marketing', 2)) = '42501',
  '«marketing»: the accountant (any scope), the summary holder, a role without finance, no role, a Student, a revoked or inactive member and the other organization''s accountant are refused (42501)');

-- ---------------------------------------------------------------------------
-- 3. Who reads «finance».
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(1, 'finance')) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(12, 'finance')) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(2, 'finance')) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(14, 'finance', 2)) IS NULL
  AND pg_temp.t323_err(pg_temp.t323_read(15, 'finance', 2)) IS NULL,
  '«finance»: the Admin and the holder of finance.read.full over the WHOLE organization read (and the other organization''s own people read their own)');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(3, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(4, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(5, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(6, 'finance')) = '42501',
  '«finance»: the same finance.read.full with the scope own, direction, department or record is refused (42501) — the whole organization is required');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(7, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(8, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(9, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(10, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(11, 'finance')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(13, 'finance')) = '42501',
  '«finance»: finance.read.summary alone, a role without finance, no role, a Student, a revoked assignment and an inactive member are refused (42501)');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(15, 'finance', 1)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(2, 'finance', 2)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(1, 'finance', 2)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_read(14, 'finance', 1)) = '42501',
  '«finance»: an accountant or an Admin asking for the other organization is refused (42501) — the right is the organization''s own');

-- ---------------------------------------------------------------------------
-- 4. The organization and the key.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_as(1, 'SELECT platform.organization_report_link_v1(NULL, ''finance'')')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(1, format('SELECT platform.organization_report_link_v1(%L, ''finance'')', gen_random_uuid()))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(1, format('SELECT platform.organization_report_link_save_v1(NULL, ''finance'', 0, %L, NULL, %L)',
      'abcdefgh12', gen_random_uuid()))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(14, 'finance', 0, 'abcdefgh12', NULL, 1, 1)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', NULL, 2, 2)) = '42501',
  'a NULL, unknown or foreign organization is refused (42501) for read and save, even for an Admin of the other organization');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_read(1, 'reports')) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_as(1, format('SELECT platform.organization_report_link_v1(%L, NULL)', pg_temp.t323_id(1)))) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_read(1, 'Marketing')) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'reports', 0, 'abcdefgh12', NULL, 3)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, NULL, 0, 'abcdefgh12', NULL, 4)) = '22023',
  'an unknown, differently cased or NULL report key is 22023');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 0 AND pg_temp.t323_rows(2) = 0 AND pg_temp.t323_journal(1) = 0,
  'refusals and bad input wrote nothing');

-- ---------------------------------------------------------------------------
-- 5. No row yet.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_read(1, 'finance') AS t323_empty_finance \gset
SELECT pg_temp.t323_read(1, 'marketing') AS t323_empty_marketing \gset
SELECT pg_temp.t323_assert(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t323_empty_finance'::JSONB) k)
    = ARRAY['configured', 'organizationId', 'pageId', 'reportId', 'reportKey', 'schemaVersion', 'updatedAt', 'version']
  AND (:'t323_empty_finance'::JSONB -> 'schemaVersion') = '1'::JSONB
  AND (:'t323_empty_finance'::JSONB ->> 'organizationId')::UUID = pg_temp.t323_id(1)
  AND (:'t323_empty_finance'::JSONB ->> 'reportKey') = 'finance'
  AND (:'t323_empty_finance'::JSONB -> 'configured') = 'false'::JSONB
  AND (:'t323_empty_finance'::JSONB -> 'reportId') = 'null'::JSONB
  AND (:'t323_empty_finance'::JSONB -> 'pageId') = 'null'::JSONB
  AND (:'t323_empty_finance'::JSONB -> 'version') = '0'::JSONB
  AND (:'t323_empty_finance'::JSONB -> 'updatedAt') = 'null'::JSONB
  AND (:'t323_empty_marketing'::JSONB ->> 'reportKey') = 'marketing'
  AND (:'t323_empty_marketing'::JSONB -> 'configured') = 'false'::JSONB
  AND (:'t323_empty_marketing'::JSONB -> 'version') = '0'::JSONB,
  'no row yet: the read answers configured false, version 0, no identifiers, no update time and no name of anyone');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 0 AND pg_temp.t323_journal(1) = 0,
  'reading creates no row and no journal event (the read is STABLE)');
SELECT pg_temp.t323_assert(pg_temp.t323_read(2, 'finance') = :'t323_empty_finance'::JSONB,
  'the accountant reads the same empty answer as the Admin');

-- ---------------------------------------------------------------------------
-- 6. Saving.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_save(2, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 10)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(3, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 11)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(7, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 12)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(9, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 13)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(10, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 14)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(13, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 15)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(15, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 16, 2)) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_save(15, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 17, 1)) = '42501',
  'only the system Admin saves: the accountant (organization scope), the own-scope holder, a role without the admin right, a Student, an inactive member and a foreign accountant are refused (42501)');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 0 AND pg_temp.t323_rows(2) = 0 AND pg_temp.t323_journal(1) = 0,
  'a refused save wrote neither a row nor a journal event');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'short', NULL, 20)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh/ijkl', NULL, 21)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh"ijkl', NULL, 22)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh ijkl', NULL, 23)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh?x=1', NULL, 24)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'https://lookerstudio.google.com/embed/reporting/abcdefgh', NULL, 25)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, repeat('a', 101), NULL, 26)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, E'abcdefgh\n', NULL, 27)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'абвгдежзий', NULL, 28)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, '', NULL, 29)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', 'bad/page', 30)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', '', 31)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', repeat('p', 101), 32)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, NULL, 'y5MR', 33)) = '22023',
  'bad identifiers are 22023: too short or long, a slash, a quote, a space, a query, a whole address, a newline, non-Latin letters, empty, a bad or empty page, and a page without a report');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_save(1, 'finance', NULL, 'abcdefgh12', NULL, 34)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', -1, 'abcdefgh12', NULL, 35)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 9007199254740991, 'abcdefgh12', NULL, 36)) = '22023'
  AND pg_temp.t323_err(pg_temp.t323_as(1, format('SELECT platform.organization_report_link_save_v1(%L, ''finance'', 0, %L, NULL, NULL)',
      pg_temp.t323_id(1), 'abcdefgh12'))) = '22023',
  'a NULL, negative or absurd expected version and a NULL request id are 22023');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 0 AND pg_temp.t323_journal(1) = 0,
  'bad input wrote neither a row nor a journal event');
-- The CHECKs of the table carry the same rules even for a direct write by the owner of the table.
DO $t323_checks$
DECLARE v_failed INTEGER := 0; v_sample TEXT;
BEGIN
  FOREACH v_sample IN ARRAY ARRAY['short', 'abcdefgh/ijkl', 'https://x.example/abcdefgh', 'abcdefgh ijkl'] LOOP
    BEGIN
      INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, version, updated_by_membership_id)
        VALUES (pg_temp.t323_id(2), 'marketing', v_sample, 1, pg_temp.t323_id(314));
    EXCEPTION WHEN check_violation THEN v_failed := v_failed + 1;
    END;
  END LOOP;
  BEGIN
    INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, page_id, version, updated_by_membership_id)
      VALUES (pg_temp.t323_id(2), 'marketing', NULL, 'y5MR', 1, pg_temp.t323_id(314));
  EXCEPTION WHEN check_violation THEN v_failed := v_failed + 1;
  END;
  BEGIN
    INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, version, updated_by_membership_id)
      VALUES (pg_temp.t323_id(2), 'reports', 'abcdefgh12', 1, pg_temp.t323_id(314));
  EXCEPTION WHEN check_violation THEN v_failed := v_failed + 1;
  END;
  BEGIN
    INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, version, updated_by_membership_id)
      VALUES (pg_temp.t323_id(2), 'marketing', 'abcdefgh12', 0, pg_temp.t323_id(314));
  EXCEPTION WHEN check_violation THEN v_failed := v_failed + 1;
  END;
  BEGIN
    -- A member of ANOTHER organization cannot be the one who updated the row.
    INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, version, updated_by_membership_id)
      VALUES (pg_temp.t323_id(2), 'marketing', 'abcdefgh12', 1, pg_temp.t323_id(301));
  EXCEPTION WHEN foreign_key_violation THEN v_failed := v_failed + 1;
  END;
  IF v_failed <> 8 THEN RAISE EXCEPTION 'T323: the table accepted a bad row directly (% of 8 refused)', v_failed; END IF;
END
$t323_checks$;
SELECT pg_temp.t323_assert(pg_temp.t323_rows(2) = 0, 'the rejected direct writes left nothing behind');

-- The first save, the stale and the double «first».
SELECT pg_temp.t323_save(1, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 40) AS t323_first \gset
SELECT pg_temp.t323_assert(
  (:'t323_first'::JSONB ->> 'status') = 'saved'
  AND (:'t323_first'::JSONB -> 'version') = '1'::JSONB
  AND (:'t323_first'::JSONB -> 'configured') = 'true'::JSONB
  AND (:'t323_first'::JSONB ->> 'reportId') = '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq'
  AND (:'t323_first'::JSONB ->> 'pageId') = 'y5MR'
  AND (:'t323_first'::JSONB ->> 'reportKey') = 'finance'
  AND (:'t323_first'::JSONB -> 'replayed') = 'false'::JSONB
  AND (:'t323_first'::JSONB ->> 'organizationId')::UUID = pg_temp.t323_id(1)
  AND NOT (:'t323_first'::JSONB ? 'fingerprint')
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t323_first'::JSONB) k)
    = ARRAY['configured', 'organizationId', 'pageId', 'replayed', 'reportId', 'reportKey', 'schemaVersion', 'status', 'updatedAt', 'version'],
  'the first save (version 0, no row) stores version 1 and answers the exact receipt without the fingerprint');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 1 AND pg_temp.t323_journal(1) = 1
  AND (SELECT version = 1 AND report_id = '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq' AND page_id = 'y5MR'
      AND updated_by_membership_id = pg_temp.t323_id(301) FROM platform_private.organization_report_links
      WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance'),
  'the row exists once, version 1, saved by the Admin; one journal event');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_save(12, 'finance', 0, '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', NULL, 41)) = 'PT409'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', NULL, 42)) = 'PT409'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'marketing', 1, 'abcdefgh12', NULL, 43)) = 'PT409'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'marketing', 5, 'abcdefgh12', NULL, 44)) = 'PT409',
  'a second «first» save (version 0 again), a stale version, and version 1 with no row are all PT409');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 1 AND pg_temp.t323_journal(1) = 1
  AND (SELECT version = 1 AND report_id = '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq' FROM platform_private.organization_report_links
      WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance'),
  'the conflicts changed nothing');
-- The read now shows it, to the Admin and to the accountant; the accountant still cannot read «marketing».
SELECT pg_temp.t323_assert(
  pg_temp.t323_read(1, 'finance') = pg_temp.t323_read(2, 'finance')
  AND (pg_temp.t323_read(2, 'finance') -> 'configured') = 'true'::JSONB
  AND (pg_temp.t323_read(2, 'finance') ->> 'reportId') = '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq'
  AND (pg_temp.t323_read(2, 'finance') ->> 'pageId') = 'y5MR'
  AND (pg_temp.t323_read(2, 'finance') -> 'version') = '1'::JSONB
  AND (pg_temp.t323_read(2, 'finance') ->> 'updatedAt') IS NOT NULL
  AND NOT (pg_temp.t323_read(2, 'finance') ? 'updatedBy')
  AND pg_temp.t323_err(pg_temp.t323_read(3, 'finance')) = '42501'
  AND (pg_temp.t323_read(1, 'marketing') -> 'configured') = 'false'::JSONB
  AND pg_temp.t323_err(pg_temp.t323_read(2, 'marketing')) = '42501',
  'the Admin and the accountant read the same saved «finance» link; «marketing» is untouched and still closed to the accountant');

-- Replay, conflicts of the request id.
SELECT pg_temp.t323_save(1, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 40) AS t323_replay \gset
SELECT pg_temp.t323_assert(
  (:'t323_replay'::JSONB - 'replayed') = (:'t323_first'::JSONB - 'replayed')
  AND (:'t323_replay'::JSONB -> 'replayed') = 'true'::JSONB
  AND pg_temp.t323_journal(1) = 1
  AND (SELECT version FROM platform_private.organization_report_links WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance') = 1,
  'the replay of the same request, input and person returns the first receipt with replayed true: no second version, no second journal row');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 0, 'abcdefgh12', NULL, 40)) = '23505'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 1, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 40)) = '23505'
  AND pg_temp.t323_err(pg_temp.t323_save(12, 'finance', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 40)) = '23505'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'marketing', 0, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 40)) = '23505',
  'the same request id with another report, another version, another person or another key is a conflict (23505)');
SELECT pg_temp.t323_assert(pg_temp.t323_journal(1) = 1
  AND (SELECT version FROM platform_private.organization_report_links WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance') = 1,
  'the conflicting reuse of the request id wrote nothing');

-- Unchanged, a change, the page, the version.
SELECT pg_temp.t323_save(1, 'finance', 1, '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq', 'y5MR', 50) AS t323_same \gset
SELECT pg_temp.t323_assert(
  (:'t323_same'::JSONB ->> 'status') = 'unchanged' AND (:'t323_same'::JSONB -> 'version') = '1'::JSONB
  AND (:'t323_same'::JSONB -> 'configured') = 'true'::JSONB AND (:'t323_same'::JSONB -> 'replayed') = 'false'::JSONB
  AND pg_temp.t323_journal(1) = 1
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.t323_id(6050)),
  'the same input at the current version is `unchanged`: no new version, no journal row, the request id is not consumed');
SELECT pg_temp.t323_save(1, 'finance', 1, '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', NULL, 51) AS t323_second \gset
SELECT pg_temp.t323_assert(
  (:'t323_second'::JSONB ->> 'status') = 'saved' AND (:'t323_second'::JSONB -> 'version') = '2'::JSONB
  AND (:'t323_second'::JSONB ->> 'reportId') = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
  AND (:'t323_second'::JSONB -> 'pageId') = 'null'::JSONB
  AND pg_temp.t323_rows(1) = 1 AND pg_temp.t323_journal(1) = 2
  AND (SELECT page_id IS NULL AND version = 2 AND updated_by_membership_id = pg_temp.t323_id(301)
      FROM platform_private.organization_report_links WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance'),
  'a changed link (a UUID report, no page) makes version 2 by UPDATE: still one row, a second journal row');
SELECT pg_temp.t323_save(12, 'finance', 2, 'p_abcdefgh12', 'p_page_1', 52) AS t323_third \gset
SELECT pg_temp.t323_assert(
  (:'t323_third'::JSONB ->> 'status') = 'saved' AND (:'t323_third'::JSONB -> 'version') = '3'::JSONB
  AND (pg_temp.t323_read(2, 'finance') ->> 'reportId') = 'p_abcdefgh12'
  AND (pg_temp.t323_read(2, 'finance') ->> 'pageId') = 'p_page_1'
  AND (pg_temp.t323_read(2, 'finance') -> 'version') = '3'::JSONB
  AND (SELECT updated_by_membership_id = pg_temp.t323_id(312) FROM platform_private.organization_report_links
      WHERE organization_id = pg_temp.t323_id(1) AND report_key = 'finance'),
  'a second Admin saves the `p_…` form at version 2: version 3 and the row remembers who saved last');
SELECT pg_temp.t323_assert(pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 2, 'abcdefgh99', NULL, 53)) = 'PT409'
  AND pg_temp.t323_err(pg_temp.t323_save(1, 'finance', 4, 'abcdefgh99', NULL, 54)) = 'PT409',
  'an old and a future version are PT409');

-- Remove: the row stays, configured false, version + 1; removing what is gone is unchanged.
SELECT pg_temp.t323_save(1, 'finance', 3, NULL, NULL, 60) AS t323_removed \gset
SELECT pg_temp.t323_assert(
  (:'t323_removed'::JSONB ->> 'status') = 'saved' AND (:'t323_removed'::JSONB -> 'configured') = 'false'::JSONB
  AND (:'t323_removed'::JSONB -> 'reportId') = 'null'::JSONB AND (:'t323_removed'::JSONB -> 'pageId') = 'null'::JSONB
  AND (:'t323_removed'::JSONB -> 'version') = '4'::JSONB
  AND pg_temp.t323_rows(1) = 1 AND pg_temp.t323_journal(1) = 4
  AND (pg_temp.t323_read(1, 'finance') -> 'configured') = 'false'::JSONB
  AND (pg_temp.t323_read(2, 'finance') -> 'version') = '4'::JSONB
  AND (pg_temp.t323_read(2, 'finance') -> 'reportId') = 'null'::JSONB,
  'removing the report keeps the row: configured false, identifiers gone, version 4, a journal row; the accountant reads "not connected"');
SELECT pg_temp.t323_save(1, 'finance', 4, NULL, NULL, 61) AS t323_gone_a \gset
SELECT pg_temp.t323_save(1, 'finance', 4, NULL, NULL, 61) AS t323_gone_b \gset
SELECT pg_temp.t323_save(1, 'marketing', 0, NULL, NULL, 62) AS t323_never_a \gset
SELECT pg_temp.t323_assert(
  (:'t323_gone_a'::JSONB ->> 'status') = 'unchanged' AND (:'t323_gone_a'::JSONB -> 'version') = '4'::JSONB
  AND (:'t323_gone_b'::JSONB ->> 'status') = 'unchanged' AND (:'t323_gone_b'::JSONB -> 'version') = '4'::JSONB
  AND (:'t323_never_a'::JSONB ->> 'status') = 'unchanged' AND (:'t323_never_a'::JSONB -> 'version') = '0'::JSONB
  AND (:'t323_never_a'::JSONB -> 'configured') = 'false'::JSONB
  AND pg_temp.t323_rows(1) = 1 AND pg_temp.t323_journal(1) = 4,
  'removing what is already gone, or never was, is `unchanged` (also when repeated): no version, no row, no journal row');
SELECT pg_temp.t323_save(1, 'finance', 4, 'abcdefgh12', 'y5MR', 63) AS t323_again \gset
SELECT pg_temp.t323_assert((:'t323_again'::JSONB -> 'version') = '5'::JSONB
  AND pg_temp.t323_journal(1) = 5 AND pg_temp.t323_rows(1) = 1,
  'after a removal the link can be set again: version 5 on the same row');

-- The two keys and the two organizations never touch each other.
SELECT pg_temp.t323_save(1, 'marketing', 0, 'abcdefgh34', 'y5MR', 70) AS t323_mkt \gset
SELECT pg_temp.t323_assert((:'t323_mkt'::JSONB ->> 'status') = 'saved'
  AND (pg_temp.t323_read(1, 'marketing') ->> 'reportId') = 'abcdefgh34'
  AND (pg_temp.t323_read(1, 'marketing') -> 'version') = '1'::JSONB
  AND (pg_temp.t323_read(2, 'finance') ->> 'reportId') = 'abcdefgh12'
  AND (pg_temp.t323_read(2, 'finance') -> 'version') = '5'::JSONB
  AND pg_temp.t323_rows(1) = 2 AND pg_temp.t323_rows(2) = 0,
  '«marketing» and «finance» are separate rows with their own versions');
SELECT pg_temp.t323_save(14, 'finance', 0, 'zyxwvuts98', NULL, 71, 2) AS t323_org2 \gset
SELECT pg_temp.t323_assert((:'t323_org2'::JSONB ->> 'status') = 'saved'
  AND (pg_temp.t323_read(15, 'finance', 2) ->> 'reportId') = 'zyxwvuts98'
  AND (pg_temp.t323_read(14, 'marketing', 2) -> 'configured') = 'false'::JSONB
  AND (pg_temp.t323_read(2, 'finance') ->> 'reportId') = 'abcdefgh12'
  AND pg_temp.t323_err(pg_temp.t323_read(15, 'finance', 1)) = '42501'
  AND pg_temp.t323_rows(1) = 2 AND pg_temp.t323_rows(2) = 1,
  'another organization saves and reads its own link; neither side sees or changes the other''s');

-- ---------------------------------------------------------------------------
-- 7. The journal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  (SELECT count(*) = 7 FROM platform.audit_events WHERE action = 'report.link.change')
  AND pg_temp.t323_journal(1) = 6 AND pg_temp.t323_journal(2) = 1
  AND (SELECT bool_and(resource_type = 'organization' AND resource_id = organization_id AND actor_kind = 'user'
        AND actor_membership_id IS NOT NULL AND actor_profile_id IS NOT NULL AND actor_principal LIKE 'auth:%'
        AND resulting_version IS NOT NULL AND reason = 'Ссылка на отчёт Looker Studio изменена'
        AND after_state ->> 'fingerprint' ~ '^[0-9a-f]{64}$')
      FROM platform.audit_events WHERE action = 'report.link.change')
  AND (SELECT array_agg(resulting_version ORDER BY resulting_version) FROM platform.audit_events
      WHERE action = 'report.link.change' AND organization_id = pg_temp.t323_id(1) AND after_state ->> 'reportKey' = 'finance')
    = ARRAY[1, 2, 3, 4, 5]::BIGINT[]
  AND (SELECT before_state ->> 'version' = '0' AND (before_state -> 'configured') = 'false'::JSONB
      FROM platform.audit_events WHERE request_id = pg_temp.t323_id(6040))
  AND (SELECT (before_state ->> 'reportId') = '1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq' AND (after_state ->> 'reportId') = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
      FROM platform.audit_events WHERE request_id = pg_temp.t323_id(6051)),
  'one report.link.change per real change (6 in organization 1, 1 in organization 2): the object organization, the actor, the resulting versions 1..5, the before and after identifiers and the fingerprint in the state');
SELECT pg_temp.t323_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events
    WHERE request_id IN (pg_temp.t323_id(6050), pg_temp.t323_id(6061), pg_temp.t323_id(6062), pg_temp.t323_id(6041), pg_temp.t323_id(6010))),
  'no journal row for unchanged input, a refusal or a conflict');
SELECT pg_temp.t323_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events e
    WHERE e.action = 'report.link.change' AND (e.after_state::TEXT ~* 'https?://' OR e.before_state::TEXT ~* 'https?://')),
  'the journal state carries identifiers only, never an address');

-- ---------------------------------------------------------------------------
-- 8. Direct access.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_as(1, 'SELECT to_jsonb(count(*)) FROM platform_private.organization_report_links')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(2, 'SELECT to_jsonb(count(*)) FROM platform_private.organization_report_links')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(1, format('INSERT INTO platform_private.organization_report_links(organization_id, report_key, report_id, version, updated_by_membership_id) VALUES (%L, ''finance'', ''abcdefgh77'', 1, %L) RETURNING to_jsonb(version)',
      pg_temp.t323_id(1), pg_temp.t323_id(301)))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(1, 'UPDATE platform_private.organization_report_links SET report_id = ''abcdefgh77'' RETURNING to_jsonb(version)')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('anon', '{"role":"anon"}', 'SELECT to_jsonb(count(*)) FROM platform_private.organization_report_links')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('service_role', '{"role":"service_role"}', 'SELECT to_jsonb(count(*)) FROM platform_private.organization_report_links')) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_as(1, 'SELECT to_jsonb(platform_private.report_link_finance_org_access(NULL, NULL))')) = '42501',
  'an Admin and an accountant cannot read or write the table or call the private helper; anon and service_role cannot read it');
SELECT pg_temp.t323_assert(
  pg_temp.t323_err(pg_temp.t323_call('anon', '{"role":"anon"}', format('SELECT platform.organization_report_link_v1(%L, ''finance'')', pg_temp.t323_id(1)))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('service_role', '{"role":"service_role"}', format('SELECT platform.organization_report_link_v1(%L, ''finance'')', pg_temp.t323_id(1)))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('authenticated', '', format('SELECT platform.organization_report_link_v1(%L, ''finance'')', pg_temp.t323_id(1)))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('authenticated', jsonb_build_object('sub', pg_temp.t323_id(199), 'role', 'authenticated')::TEXT,
      format('SELECT platform.organization_report_link_v1(%L, ''finance'')', pg_temp.t323_id(1)))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('anon', '{"role":"anon"}', format('SELECT platform.organization_report_link_save_v1(%L, ''finance'', 0, ''abcdefgh12'', NULL, %L)', pg_temp.t323_id(1), gen_random_uuid()))) = '42501'
  AND pg_temp.t323_err(pg_temp.t323_call('service_role', '{"role":"service_role"}', format('SELECT platform.organization_report_link_save_v1(%L, ''finance'', 0, ''abcdefgh12'', NULL, %L)', pg_temp.t323_id(1), gen_random_uuid()))) = '42501',
  'anon, service_role, a session without claims and a token without a membership cannot call either function');
SELECT pg_temp.t323_assert(pg_temp.t323_rows(1) = 2 AND pg_temp.t323_rows(2) = 1 AND pg_temp.t323_journal(1) = 6 AND pg_temp.t323_journal(2) = 1,
  'the refused direct access wrote nothing');

\echo A323_REPORT_LINKS_SUITE_PASSED
ROLLBACK;
