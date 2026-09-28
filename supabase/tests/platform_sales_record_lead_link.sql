\set ON_ERROR_STOP on
-- Boundary suite for migration 254 (Э8.7 «Отчёт продаж»: связь строк отчёта с
-- лидами, owner decision 28.09.2026: «можно связать, но это не рабочее
-- место, просто связать»). Members are modelled like production after 155
-- and 244 (as in platform_sales_one_truth.sql and platform_sales_register_v4.sql):
-- invited staff have current_role NULL and current_bundle_id NULL;
-- permissions come only from scoped role assignments with the production
-- permission keys; the department Sales Manager role is bound to the 208
-- workflow key as in production. Only the system Admin carries the coarse role.
--
-- Proves:
--  * catalog: the new reads and commands are SECURITY DEFINER with the empty
--    search_path, callable by authenticated only, private helpers exposed to
--    nobody; the released reads/commands (v4, manage v2, row v2, strip v1)
--    stay byte-identical;
--  * options: leads with lead.read, any lifecycle, excluding a lead that
--    already has a pipeline sale or is already linked, out-of-scope leads
--    excluded, a query under 2 characters refused;
--  * link/unlink: only an unarchived import record, the same gates as
--    manage_sales_register_v2 plus lead.read on the touched lead; refuses a
--    lead with a pipeline sale, a lead already linked to another record (a
--    double link), a manual or archived record, and a caller without
--    lead.read; optimistic version, request-id replay and conflict, stale
--    version; the audit carries no names;
--  * the panel read: null when unlinked, the lead's name when the actor has
--    lead.read on it, a «linked but not visible» flag otherwise, forbidden
--    for a caller who cannot even read the record;
--  * strip v2: finds the record by lead_id OR linked_lead_id (a pipeline sale
--    wins when, for any reason, both exist) and adds link: 'sale'|'linked';
--    v1 keeps finding only the pipeline sale and its exact six record keys.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n254_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n254_auth_role$;

CREATE FUNCTION pg_temp.n254_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n254_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N254: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n254_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n254_id(INTEGER), pg_temp.n254_assert(BOOLEAN, TEXT), pg_temp.n254_message(TEXT)
  TO authenticated, anon, service_role;

SELECT 'N254_SALES_RECORD_LEAD_LINK_SUITE_START' AS n254_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Catalog and the released reads/commands (rollback proof).
-- ---------------------------------------------------------------------------
DO $n254_catalog$
DECLARE fn REGPROCEDURE; client_role TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform.sales_record_lead_options_v1(uuid,text)'::REGPROCEDURE,
    'platform.link_sales_record_lead_v1(uuid,uuid,bigint,uuid,uuid)'::REGPROCEDURE,
    'platform.sales_record_lead_link_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.staff_lead_handoff_strip_v2(uuid,uuid)'::REGPROCEDURE
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = fn)
      OR NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'N254: % must be SECURITY DEFINER, empty search_path, authenticated', fn; END IF;
    FOREACH client_role IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(client_role, fn, 'EXECUTE') THEN RAISE EXCEPTION 'N254: % exposed to %', fn, client_role; END IF;
    END LOOP;
  END LOOP;
  -- The released reads/commands this migration never touches (byte-identical).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure)
      <> '7089320d801256478819c3c9f6abdf95'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure)
      <> 'ea3f0a2000c65d8aed60cf2be3ec78a8'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::regprocedure)
      <> '1ae50564608769f594cf76c13e52eb9b'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform_private.sales_register_row_v2(platform_private.sales_register)'::regprocedure)
      <> 'be1745aa63531ddad26480ba8c2b2361' THEN
    RAISE EXCEPTION 'N254: a released read or command changed'; END IF;
END
$n254_catalog$;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (department A, full role incl. lead.read),
-- 3 Admissions reader (organization-wide lead.read, no sales register),
-- 5 Student, 7 Sales Manager B (department B),
-- 9 Sales Manager A' (department A, sales register only, NO lead.read).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n254_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n254_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (5, 'student'), (7, NULL), (9, NULL);
GRANT SELECT ON n254_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n254_id(1), 'N254 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n254_id(100 + n), 'n254-' || n || '@example.invalid', '{}'::JSONB FROM n254_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n254_id(199), 'n254-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n254_id(200 + n), pg_temp.n254_id(100 + n), 'N254 Actor ' || n, 'active', 1 FROM n254_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n254_id(300 + n), pg_temp.n254_id(1), pg_temp.n254_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n254_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n254_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n254_id(401), pg_temp.n254_id(1), 'organization', pg_temp.n254_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n254_id(1), pg_temp.n254_id(301), pg_temp.n254_id(401), 1, 1, TRUE, 'system',
    'N254 synthetic organization scope', pg_temp.n254_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n254_id(901), pg_temp.n254_id(1), 'N254 Sales A'),
  (pg_temp.n254_id(903), pg_temp.n254_id(1), 'N254 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n254_id(1), pg_temp.n254_id(302), pg_temp.n254_id(901)),
  (pg_temp.n254_id(1), pg_temp.n254_id(307), pg_temp.n254_id(903)),
  (pg_temp.n254_id(1), pg_temp.n254_id(309), pg_temp.n254_id(901));

-- Roles with the production permission keys (as in 247's and 253's suites).
-- Only one role per organization may carry workflow_key='sales_manager'
-- (208), so the sales-register role and the lead-access role are separate,
-- composed exactly like production's Sales Manager (253's fixture composes
-- "Sales Manager" + "Sales common" the same way): membership 309 gets the
-- sales-register role WITHOUT the lead-access role, so it is a 208 Sales
-- Manager with no lead.read at all.
CREATE TEMP TABLE n254_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n254_roles VALUES
 (pg_temp.n254_id(1103), 'Sales Manager', '["sales.register.manage","sales.register.read"]', 1130),
 (pg_temp.n254_id(1104), 'Sales lead access', '["lead.read","lead.sales.workflow.manage"]', 1140),
 (pg_temp.n254_id(1106), 'Admissions lead reader', '["lead.read"]', 1160);
CREATE TEMP TABLE n254_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n254_grants VALUES
 (302, pg_temp.n254_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n254_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n254_id(1104), jsonb_build_object('kind', 'department', 'key', pg_temp.n254_id(901), 'resourceKind', NULL)),
 (307, pg_temp.n254_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n254_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n254_id(1104), jsonb_build_object('kind', 'department', 'key', pg_temp.n254_id(903), 'resourceKind', NULL)),
 (309, pg_temp.n254_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n254_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n254_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.n254_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n254_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n254_id(1);
GRANT SELECT ON n254_roles, n254_grants, n254_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n254_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n254_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n254_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n254_admin_setup';
SET LOCAL ROLE authenticated;
DO $n254_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n254_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n254_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N254 ' || r.label, 'description', 'Migration 254 synthetic role',
        'permissionKeys', r.keys), 'N254 create role', pg_temp.n254_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n254_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n254_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N254 publish role', pg_temp.n254_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n254_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n254_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n254_id(1), pg_temp.n254_id(m),
      (SELECT access_version FROM n254_versions WHERE membership_id = pg_temp.n254_id(m)), items, bindings,
      'N254 grant roles', pg_temp.n254_id(2000 + m));
  END LOOP;
END
$n254_roles$;
RESET ROLE;
-- The department Sales Manager role is the 208 workflow role, as bound in production.
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.n254_id(1103);

UPDATE n254_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n254_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n254_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n254_admin FROM n254_actors WHERE n = 1 \gset
SELECT claims AS n254_sales_a FROM n254_actors WHERE n = 2 \gset
SELECT claims AS n254_admissions FROM n254_actors WHERE n = 3 \gset
SELECT claims AS n254_student FROM n254_actors WHERE n = 5 \gset
SELECT claims AS n254_sales_b FROM n254_actors WHERE n = 7 \gset
SELECT claims AS n254_sales_a_no_lead FROM n254_actors WHERE n = 9 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n254_id(199),
  'claims', jsonb_build_object('sub', pg_temp.n254_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS n254_none \gset
SELECT pg_temp.n254_assert(platform_private.staff_is_sales_manager(pg_temp.n254_id(1), pg_temp.n254_id(302))
  AND platform_private.staff_is_sales_manager(pg_temp.n254_id(1), pg_temp.n254_id(307))
  AND platform_private.staff_is_sales_manager(pg_temp.n254_id(1), pg_temp.n254_id(309))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.n254_id(1), pg_temp.n254_id(301)),
  'fixture: both department Sales Managers and the no-lead.read Sales Manager are 208 Sales Managers; the system Admin is not');
SELECT pg_temp.n254_assert(platform_private.staff_has_permission(pg_temp.n254_id(1), pg_temp.n254_id(302), 'lead.read')
  AND NOT platform_private.staff_has_permission(pg_temp.n254_id(1), pg_temp.n254_id(309), 'lead.read'),
  'fixture: Sales Manager A has lead.read; the no-lead.read Sales Manager does not');

-- Clients and leads. L1 plain (linkable); L2 already has a pipeline sale;
-- L3 will already be linked to another record; L4 is Sales B's (out of A's scope).
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, lifecycle_state)
SELECT pg_temp.n254_id(4000 + k), pg_temp.n254_id(1), name, platform_private.normalize_person_name(name), 'active'
FROM (VALUES (1, 'N254 Lead One'), (2, 'N254 Lead Two Pipeline'), (3, 'N254 Lead Three Linked'),
  (4, 'N254 Lead Four Other Dept'), (5, 'N254 Lead Five Linked Only')) AS c(k, name);
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
SELECT pg_temp.n254_id(5000 + k), pg_temp.n254_id(1), pg_temp.n254_id(4000 + k), pg_temp.n254_id(owner), 'new', 'other', 'open'
FROM (VALUES (1, 302), (2, 302), (3, 302), (4, 307), (5, 302)) AS l(k, owner);

-- Sales register rows (direct fixture inserts, as 253's suite does):
--   R1 import, dept A, unarchived: the main link/unlink target.
--   R_other import, dept A: pre-linked to L3 before the write tests.
--   R_pipeline pipeline, dept A: L2's existing sale (lead_id=L2).
--   R_manual manual, dept A: «import rows only» refusal.
--   R_archived import, dept A, archived: refusal.
--   R_dept_b import, dept B: out of A's scope.
--   R5_linked import, dept A: linked to L5, no pipeline sale exists for L5.
--   R2_extra import, dept A: linked to L2 directly (pipeline must still win in strip v2).
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint, archived, lead_id, client_id, linked_lead_id)
VALUES
  (pg_temp.n254_id(6001), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'import', '{}'::JSONB,
    'n254:sheet:1', repeat('ab', 32), 'N254 synthetic sheet', 1, '{}'::JSONB, 'n254-fp-1', FALSE, NULL, NULL, NULL),
  (pg_temp.n254_id(6002), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'import', '{}'::JSONB,
    'n254:sheet:2', repeat('ab', 32), 'N254 synthetic sheet', 2, '{}'::JSONB, 'n254-fp-2', FALSE, NULL, NULL, pg_temp.n254_id(5003)),
  (pg_temp.n254_id(6003), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'pipeline', '{}'::JSONB,
    NULL, NULL, NULL, NULL, '{}'::JSONB, NULL, FALSE, pg_temp.n254_id(5002), pg_temp.n254_id(4002), NULL),
  (pg_temp.n254_id(6004), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'manual', '{}'::JSONB,
    NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NULL, NULL, NULL),
  (pg_temp.n254_id(6005), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'import', '{}'::JSONB,
    'n254:sheet:5', repeat('ab', 32), 'N254 synthetic sheet', 5, '{}'::JSONB, 'n254-fp-5', TRUE, NULL, NULL, NULL),
  (pg_temp.n254_id(6006), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(307), 'import', '{}'::JSONB,
    'n254:sheet:6', repeat('ab', 32), 'N254 synthetic sheet', 6, '{}'::JSONB, 'n254-fp-6', FALSE, NULL, NULL, NULL),
  (pg_temp.n254_id(6007), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'import', '{}'::JSONB,
    'n254:sheet:7', repeat('ab', 32), 'N254 synthetic sheet', 7, '{}'::JSONB, 'n254-fp-7', FALSE, NULL, NULL, pg_temp.n254_id(5005)),
  (pg_temp.n254_id(6008), pg_temp.n254_id(1), '2026-09-01', pg_temp.n254_id(302), 'import', '{}'::JSONB,
    'n254:sheet:8', repeat('ab', 32), 'N254 synthetic sheet', 8, '{}'::JSONB, 'n254-fp-8', FALSE, NULL, NULL, pg_temp.n254_id(5002));

-- ---------------------------------------------------------------------------
-- 1. sales_record_lead_options_v1: search for «Связать с лидом».
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.sales_record_lead_options_v1(pg_temp.n254_id(1), 'N254 Lead')::TEXT AS n254_a_options \gset
SELECT platform.sales_record_lead_options_v1(pg_temp.n254_id(1), 'One')::TEXT AS n254_a_one \gset
SELECT pg_temp.n254_message(format('SELECT platform.sales_record_lead_options_v1(%L::UUID, %L)', pg_temp.n254_id(1), 'N')) AS n254_a_short \gset
RESET ROLE;
SELECT pg_temp.n254_assert((SELECT array_agg((o ->> 'id')::UUID ORDER BY o ->> 'id') FROM jsonb_array_elements(:'n254_a_options'::JSONB -> 'options') o)
    = ARRAY[pg_temp.n254_id(5001)],
  'Sales Manager A sees only L1: not L2 (pipeline sale), not L3 (already linked), not L4 (Sales B''s lead): '
    || (:'n254_a_options'::JSONB -> 'options')::TEXT);
SELECT pg_temp.n254_assert((:'n254_a_options'::JSONB -> 'options' -> 0) @> jsonb_build_object('name', 'N254 Lead One', 'stage', 'new')
  AND (:'n254_a_options'::JSONB -> 'options' -> 0 ->> 'created_on') IS NOT NULL,
  'options return id, name, stage word and the created day only: ' || (:'n254_a_options'::JSONB -> 'options' -> 0)::TEXT);
SELECT pg_temp.n254_assert((SELECT array_agg((o ->> 'id')::UUID) FROM jsonb_array_elements(:'n254_a_one'::JSONB -> 'options') o) = ARRAY[pg_temp.n254_id(5001)],
  'a narrower query still finds L1 by name');
SELECT pg_temp.n254_assert(:'n254_a_short' = '22023 sales_register_invalid_query', 'a query under 2 characters is refused: ' || :'n254_a_short');

SET LOCAL request.jwt.claims TO :'n254_admissions';
SET LOCAL ROLE authenticated;
SELECT platform.sales_record_lead_options_v1(pg_temp.n254_id(1), 'N254 Lead')::TEXT AS n254_admissions_options \gset
RESET ROLE;
SELECT pg_temp.n254_assert((SELECT array_agg((o ->> 'id')::UUID ORDER BY o ->> 'id') FROM jsonb_array_elements(:'n254_admissions_options'::JSONB -> 'options') o)
    = ARRAY[pg_temp.n254_id(5001), pg_temp.n254_id(5004)],
  'lead.read alone is enough (no sales register permission needed): organization-wide reader sees L1 and L4, still not L2/L3: '
    || (:'n254_admissions_options'::JSONB -> 'options')::TEXT);

SET LOCAL request.jwt.claims TO :'n254_sales_a_no_lead';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.sales_record_lead_options_v1(%L::UUID, %L)', pg_temp.n254_id(1), 'N254')) AS n254_no_lead_options \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n254_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.sales_record_lead_options_v1(%L::UUID, %L)', pg_temp.n254_id(1), 'N254')) AS n254_student_options \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n254_message(format('SELECT platform.sales_record_lead_options_v1(%L::UUID, %L)', pg_temp.n254_id(1), 'N254')) AS n254_anon_options \gset
RESET ROLE;
SELECT pg_temp.n254_assert(w.result LIKE '42501 %', w.who || ' cannot search without lead.read: ' || w.result)
FROM (VALUES ('a Sales Manager without lead.read', :'n254_no_lead_options'), ('the Student', :'n254_student_options'),
  ('anon', :'n254_anon_options')) AS w(who, result);

-- ---------------------------------------------------------------------------
-- 2. link_sales_record_lead_v1: refusals first, then the guarded save.
-- ---------------------------------------------------------------------------
SELECT count(*) AS n254_audit_before FROM platform.audit_events WHERE organization_id = pg_temp.n254_id(1) \gset

-- Pre-link R_other (6002) to L3 (5003) directly, as an already-established
-- link the write tests below must refuse to duplicate.
SELECT pg_temp.n254_assert((SELECT linked_lead_id FROM platform_private.sales_register WHERE id = pg_temp.n254_id(6002)) = pg_temp.n254_id(5003),
  'fixture: R_other is pre-linked to L3');

SELECT format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(5001), pg_temp.n254_id(3001)) AS n254_link_r1_l1 \gset
SET LOCAL request.jwt.claims TO :'n254_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_admin_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n254_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_b_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n254_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_student_write \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_anon_write \gset
RESET ROLE;
SELECT pg_temp.n254_assert(w.result LIKE '42501 %', w.who || ' cannot link: ' || w.result)
FROM (VALUES ('the system Admin (not a Sales Manager)', :'n254_admin_write'), ('Sales Manager B (another department)', :'n254_b_write'),
  ('the Student', :'n254_student_write'), ('anon', :'n254_anon_write')) AS w(who, result);
SELECT pg_temp.n254_assert((SELECT linked_lead_id IS NULL FROM platform_private.sales_register WHERE id = pg_temp.n254_id(6001))
  AND (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n254_id(1)) = :'n254_audit_before'::BIGINT,
  'refused writes change nothing');

SET LOCAL request.jwt.claims TO :'n254_sales_a_no_lead';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_no_lead_write \gset
RESET ROLE;
SELECT pg_temp.n254_assert(:'n254_no_lead_write' LIKE '42501 %', 'sales.register.manage without lead.read still cannot link: ' || :'n254_no_lead_write');

SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6004), pg_temp.n254_id(5001), pg_temp.n254_id(3002))) AS n254_manual_write \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6005), pg_temp.n254_id(5001), pg_temp.n254_id(3003))) AS n254_archived_write \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6006), pg_temp.n254_id(5001), pg_temp.n254_id(3004))) AS n254_dept_b_write \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(5002), pg_temp.n254_id(3005))) AS n254_pipeline_lead_write \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(5003), pg_temp.n254_id(3006))) AS n254_double_link_write \gset
RESET ROLE;
SELECT pg_temp.n254_assert(:'n254_manual_write' = '22023 sales_register_invalid_command', 'a manual record is not linkable: ' || :'n254_manual_write');
SELECT pg_temp.n254_assert(:'n254_archived_write' = '22023 sales_register_invalid_command', 'an archived record is not linkable: ' || :'n254_archived_write');
SELECT pg_temp.n254_assert(:'n254_dept_b_write' LIKE '42501 %', 'another department''s record is refused: ' || :'n254_dept_b_write');
SELECT pg_temp.n254_assert(:'n254_pipeline_lead_write' = 'PT409 sales_register_lead_has_sale', 'a lead with a pipeline sale is refused: ' || :'n254_pipeline_lead_write');
SELECT pg_temp.n254_assert(:'n254_double_link_write' = 'PT409 sales_register_lead_already_linked', 'a lead already linked to another record is refused (double link): ' || :'n254_double_link_write');

-- Success, replay, conflict, stale.
SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(:'n254_link_r1_l1') AS n254_r1_saved \gset
SELECT platform.link_sales_record_lead_v1(pg_temp.n254_id(1), pg_temp.n254_id(6001), 1, pg_temp.n254_id(5001), pg_temp.n254_id(3001))::TEXT AS n254_r1_replay \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, %L::UUID, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(5005), pg_temp.n254_id(3001))) AS n254_r1_conflict \gset
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 1, NULL, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(3009))) AS n254_r1_stale \gset
RESET ROLE;
SELECT pg_temp.n254_assert(:'n254_r1_saved' = 'ok', 'R1 linked to L1: ' || :'n254_r1_saved');
SELECT pg_temp.n254_assert((:'n254_r1_replay'::JSONB) = jsonb_build_object('organization_id', pg_temp.n254_id(1), 'record_id', pg_temp.n254_id(6001),
    'version', '2', 'operation', 'link', 'request_id', pg_temp.n254_id(3001)),
  'the same request replays its receipt: ' || :'n254_r1_replay');
SELECT pg_temp.n254_assert(:'n254_r1_conflict' = '22023 sales_register_request_id_conflict', 'another lead under the same request id: ' || :'n254_r1_conflict');
SELECT pg_temp.n254_assert(:'n254_r1_stale' = 'PT409 sales_register_stale', 'a stale version: ' || :'n254_r1_stale');
SELECT pg_temp.n254_assert((SELECT linked_lead_id = pg_temp.n254_id(5001) AND version = 2 FROM platform_private.sales_register WHERE id = pg_temp.n254_id(6001)),
  'R1 is now linked to L1 at version 2');
SELECT pg_temp.n254_assert((SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n254_id(1)
    AND action = 'sales.register.lead.link' AND resource_id = pg_temp.n254_id(6001)) = 1
  AND (SELECT after_state FROM platform.audit_events WHERE request_id = pg_temp.n254_id(3001)) = '{"linked":true,"version":"2"}'::JSONB
  AND strpos((SELECT after_state::TEXT FROM platform.audit_events WHERE request_id = pg_temp.n254_id(3001)), 'N254 Lead One') = 0,
  'one audit event, no personal data in the shared audit projection');

-- ---------------------------------------------------------------------------
-- 3. sales_record_lead_link_v1: the panel's small read.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.sales_record_lead_link_v1(pg_temp.n254_id(1), pg_temp.n254_id(6004))::TEXT AS n254_unlinked_read \gset
SELECT platform.sales_record_lead_link_v1(pg_temp.n254_id(1), pg_temp.n254_id(6001))::TEXT AS n254_a_link_read \gset
RESET ROLE;
SELECT pg_temp.n254_assert((:'n254_unlinked_read'::JSONB ->> 'link') IS NULL, 'no link: ' || :'n254_unlinked_read');
SELECT pg_temp.n254_assert((:'n254_a_link_read'::JSONB -> 'link') = jsonb_build_object('visible', TRUE, 'lead_id', pg_temp.n254_id(5001), 'name', 'N254 Lead One'),
  'Sales Manager A sees the linked lead''s name: ' || :'n254_a_link_read');

SET LOCAL request.jwt.claims TO :'n254_sales_a_no_lead';
SET LOCAL ROLE authenticated;
SELECT platform.sales_record_lead_link_v1(pg_temp.n254_id(1), pg_temp.n254_id(6001))::TEXT AS n254_no_lead_read \gset
RESET ROLE;
SELECT pg_temp.n254_assert((:'n254_no_lead_read'::JSONB -> 'link') = jsonb_build_object('visible', FALSE, 'lead_id', NULL, 'name', NULL),
  'linked but not visible without lead.read on that lead, never a name or a guess: ' || :'n254_no_lead_read');

SET LOCAL request.jwt.claims TO :'n254_admissions';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.sales_record_lead_link_v1(%L::UUID, %L::UUID)', pg_temp.n254_id(1), pg_temp.n254_id(6001))) AS n254_admissions_read \gset
RESET ROLE;
SELECT pg_temp.n254_assert(:'n254_admissions_read' LIKE '42501 %', 'a caller who cannot read the report record at all is refused: ' || :'n254_admissions_read');

-- ---------------------------------------------------------------------------
-- 4. Unlink.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.link_sales_record_lead_v1(%L::UUID, %L::UUID, 2, NULL, %L::UUID)',
  pg_temp.n254_id(1), pg_temp.n254_id(6001), pg_temp.n254_id(3010))) AS n254_unlinked \gset
SELECT platform.sales_record_lead_link_v1(pg_temp.n254_id(1), pg_temp.n254_id(6001))::TEXT AS n254_after_unlink_read \gset
RESET ROLE;
SELECT pg_temp.n254_assert(:'n254_unlinked' = 'ok', 'R1 unlinked: ' || :'n254_unlinked');
SELECT pg_temp.n254_assert((SELECT linked_lead_id IS NULL AND version = 3 FROM platform_private.sales_register WHERE id = pg_temp.n254_id(6001)),
  'R1 has no link and its version moved on');
SELECT pg_temp.n254_assert((:'n254_after_unlink_read'::JSONB ->> 'link') IS NULL, 'the panel read agrees: ' || :'n254_after_unlink_read');
SELECT pg_temp.n254_assert((SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n254_id(1)
    AND action = 'sales.register.lead.unlink' AND resource_id = pg_temp.n254_id(6001)) = 1,
  'the unlink has its own audit action');

-- ---------------------------------------------------------------------------
-- 5. staff_lead_handoff_strip_v2: lead_id OR linked_lead_id, pipeline first.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n254_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n254_id(1), pg_temp.n254_id(5005))::TEXT AS n254_v1_linked_only \gset
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n254_id(1), pg_temp.n254_id(5005))::TEXT AS n254_v2_linked_only \gset
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n254_id(1), pg_temp.n254_id(5002))::TEXT AS n254_v1_pipeline \gset
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n254_id(1), pg_temp.n254_id(5002))::TEXT AS n254_v2_pipeline \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n254_sales_a_no_lead';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n254_message(format('SELECT platform.staff_lead_handoff_strip_v1(%L::UUID, %L::UUID)', pg_temp.n254_id(1), pg_temp.n254_id(5005))) AS n254_v1_no_lead \gset
SELECT pg_temp.n254_message(format('SELECT platform.staff_lead_handoff_strip_v2(%L::UUID, %L::UUID)', pg_temp.n254_id(1), pg_temp.n254_id(5005))) AS n254_v2_no_lead \gset
RESET ROLE;

-- L5 has only a linked import record (R5_linked, 6007): v1 finds nothing (it
-- only looks at lead_id); v2 finds it with link: 'linked'.
SELECT pg_temp.n254_assert((:'n254_v1_linked_only'::JSONB -> 'report' ->> 'record') IS NULL,
  'v1 (lead_id only) sees no record for a lead with only a linked import row: ' || :'n254_v1_linked_only');
SELECT pg_temp.n254_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'n254_v1_linked_only'::JSONB -> 'report') k) = ARRAY['record', 'status'],
  'v1''s report shape is unchanged');
SELECT pg_temp.n254_assert((:'n254_v2_linked_only'::JSONB -> 'report' -> 'record') @> jsonb_build_object('id', pg_temp.n254_id(6007), 'link', 'linked'),
  'v2 finds the linked import row and names it "linked": ' || (:'n254_v2_linked_only'::JSONB -> 'report' -> 'record')::TEXT);
SELECT pg_temp.n254_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'n254_v2_linked_only'::JSONB -> 'report' -> 'record') k)
    = ARRAY['archived', 'has_contract_number', 'id', 'link', 'paid', 'report_month', 'sale_date'],
  'v2''s record adds exactly one key, link: ' || (:'n254_v2_linked_only'::JSONB -> 'report' -> 'record')::TEXT);

-- L2 has both a pipeline sale (6003) and, directly for this test, a linked
-- import row (R2_extra, 6008): both v1 and v2 must find the pipeline sale,
-- never the merely linked row, and v2 names it "sale".
SELECT pg_temp.n254_assert((:'n254_v1_pipeline'::JSONB -> 'report' -> 'record' ->> 'id') = pg_temp.n254_id(6003)::TEXT,
  'v1 finds the pipeline sale, not the linked row: ' || :'n254_v1_pipeline');
SELECT pg_temp.n254_assert((:'n254_v2_pipeline'::JSONB -> 'report' -> 'record') @> jsonb_build_object('id', pg_temp.n254_id(6003), 'link', 'sale'),
  'v2 prefers the pipeline sale over the linked row and names it "sale": ' || (:'n254_v2_pipeline'::JSONB -> 'report' -> 'record')::TEXT);
-- Every other key of the record is identical between v1 and v2 for the same match.
SELECT pg_temp.n254_assert((:'n254_v1_pipeline'::JSONB -> 'report' -> 'record') = (:'n254_v2_pipeline'::JSONB -> 'report' -> 'record') - 'link',
  'v2''s record is v1''s record plus link only: ' || (:'n254_v2_pipeline'::JSONB -> 'report' -> 'record')::TEXT);

SELECT pg_temp.n254_assert(:'n254_v1_no_lead' LIKE '42501 %' AND :'n254_v2_no_lead' LIKE '42501 %',
  'both strips still refuse a caller without lead.read: v1=' || :'n254_v1_no_lead' || ' v2=' || :'n254_v2_no_lead');

SELECT 'N254_SALES_RECORD_LEAD_LINK_SUITE_OK' AS n254_suite_marker;
ROLLBACK;
