\set ON_ERROR_STOP on
-- Boundary suite for migration 253 (Э8.6 «Отчёт продаж», решения владельца
-- 28.09.2026). Members are modelled like production after 155 and 244 (as in
-- platform_sales_one_truth.sql): invited staff have current_role NULL and
-- current_bundle_id NULL; permissions come only from scoped role assignments
-- with the production permission keys; the department Sales Manager role is
-- bound to the 208 workflow key as in production. Only the system Admin
-- carries the coarse role.
--
-- Proves:
--  * catalog: the new reads and commands are SECURITY DEFINER with the empty
--    search_path, callable by authenticated only; helpers and the mapping
--    table are private; the key function trims, collapses spaces, strips
--    trailing dots and lower-cases — and guesses nothing else;
--  * rollback: v1/v2/v3 reads keep their exact v1 row keys even for a record
--    with «Оплачено в валюте договора» — nothing new leaks through `fields`;
--  * row v2: the v1 row + paid_contract, review_reasons (live, only while
--    flagged; import flags only while their field is still not fixed),
--    import_flags (flag strings only, malformed strings dropped, never the
--    snapshot) and manager_key;
--  * v4: manager key filter, manager options with counts and the owner's
--    names, totals with the contract amount, the same visibility as v3;
--  * manage v2: the contract pair only for a record paid in another currency,
--    in its cost currency; a currency difference flags only while that amount
--    is missing; replay, conflicts, stale versions, archive; the same gates
--    as v1 (department Sales Manager only; Admin, the other department,
--    Admissions, the Student, a caller without a membership and anon
--    refused); manage v1 still works and leaves the new columns alone;
--  * «Менеджеры в отчёте»: read and save with sales.register.import at
--    organization scope; optimistic version, replay, unknown key, staff that
--    cannot own report records, a name without a CRM account, clearing; the
--    audit carries no names.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n253_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n253_auth_role$;

CREATE FUNCTION pg_temp.n253_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n253_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N253: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n253_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
-- The row of one record in a read, by id.
CREATE FUNCTION pg_temp.n253_row(p_read JSONB, p_id UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT r FROM jsonb_array_elements(p_read -> 'rows') r WHERE (r ->> 'id')::UUID = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n253_id(INTEGER), pg_temp.n253_assert(BOOLEAN, TEXT),
  pg_temp.n253_message(TEXT), pg_temp.n253_row(JSONB, UUID) TO authenticated, anon, service_role;

SELECT 'N253_SALES_REPORT_V4_SUITE_START' AS n253_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Catalog, the key, and the released reads.
-- ---------------------------------------------------------------------------
DO $n253_catalog$
DECLARE fn REGPROCEDURE; client_role TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE,
    'platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::REGPROCEDURE,
    'platform.read_sales_manager_labels_v1(uuid)'::REGPROCEDURE,
    'platform.save_sales_manager_label_v1(uuid,text,bigint,text,uuid,uuid)'::REGPROCEDURE
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = fn)
      OR NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'N253: % must be SECURITY DEFINER, empty search_path, authenticated', fn; END IF;
    FOREACH client_role IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(client_role, fn, 'EXECUTE') THEN RAISE EXCEPTION 'N253: % exposed to %', fn, client_role; END IF;
    END LOOP;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'platform_private.sales_manager_label_key(text)'::REGPROCEDURE,
    'platform_private.sales_register_row_v2(platform_private.sales_register)'::REGPROCEDURE
  ] LOOP
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(client_role, fn, 'EXECUTE') THEN RAISE EXCEPTION 'N253: private % exposed to %', fn, client_role; END IF;
    END LOOP;
  END LOOP;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
    IF has_table_privilege(client_role, 'platform_private.sales_manager_labels', 'SELECT')
      OR has_table_privilege(client_role, 'platform_private.sales_manager_labels', 'INSERT')
      OR has_table_privilege(client_role, 'platform_private.sales_manager_labels', 'UPDATE') THEN
      RAISE EXCEPTION 'N253: manager labels table exposed to %', client_role; END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'platform_private.sales_manager_labels'::regclass) THEN
    RAISE EXCEPTION 'N253: manager labels must force row level security'; END IF;
  -- The released reads and commands are the pre-253 definitions (rollback).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform.read_sales_register_v3(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure)
      <> '1439fa99ea98aebe86e0a2673ae7e2a5'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.read_sales_register_v2(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text)'::regprocedure)
      <> '818c2db2bc59909b22c13da912ec4da6'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure)
      <> '3b6b19063c5e2d55ce5a226cd94b5540'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform_private.sales_register_row(platform_private.sales_register)'::regprocedure)
      <> '17df8ac76544087f7f93410c26e734cc' THEN
    RAISE EXCEPTION 'N253: a released read or command changed'; END IF;
END
$n253_catalog$;

SELECT pg_temp.n253_assert(platform_private.sales_manager_label_key(k.spelling) IS NOT DISTINCT FROM k.expected,
  'key(' || coalesce(k.spelling, 'NULL') || ') = ' || k.expected)
FROM (VALUES
  ('Санжар Эскизов', 'санжар эскизов'), (' санжар   эскизов. ', 'санжар эскизов'), ('САНЖАР ЭСКИЗОВ...', 'санжар эскизов'),
  ('Санжар Э.', 'санжар э'), ('Санжар Э . .', 'санжар э'), (E'Айдана\tМакетова', 'айдана макетова'),
  ('Ёлка', 'ёлка'), ('Санжар-Эскизов', 'санжар-эскизов'), (' . ', ''), (NULL, '')) AS k(spelling, expected);
SELECT pg_temp.n253_assert(platform_private.sales_manager_label_key('Санжар Эскизов') <> platform_private.sales_manager_label_key('Санжар Эскизова')
  AND platform_private.sales_manager_label_key('Ёлка') <> platform_private.sales_manager_label_key('Елка'),
  'the key guesses nothing beyond case, spaces and trailing dots');

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A), 3 Admissions Manager,
-- 7 Sales Manager B (sales department B); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n253_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n253_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (5, 'student'), (7, NULL);
GRANT SELECT ON n253_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n253_id(1), 'N253 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n253_id(100 + n), 'n253-' || n || '@example.invalid', '{}'::JSONB FROM n253_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n253_id(199), 'n253-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n253_id(200 + n), pg_temp.n253_id(100 + n), 'N253 Actor ' || n, 'active', 1 FROM n253_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n253_id(300 + n), pg_temp.n253_id(1), pg_temp.n253_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n253_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n253_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n253_id(401), pg_temp.n253_id(1), 'organization', pg_temp.n253_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n253_id(1), pg_temp.n253_id(301), pg_temp.n253_id(401), 1, 1, TRUE, 'system',
    'N253 synthetic organization scope', pg_temp.n253_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n253_id(901), pg_temp.n253_id(1), 'N253 Sales A'),
  (pg_temp.n253_id(902), pg_temp.n253_id(1), 'N253 Admissions'),
  (pg_temp.n253_id(903), pg_temp.n253_id(1), 'N253 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n253_id(1), pg_temp.n253_id(302), pg_temp.n253_id(901)),
  (pg_temp.n253_id(1), pg_temp.n253_id(303), pg_temp.n253_id(902)),
  (pg_temp.n253_id(1), pg_temp.n253_id(307), pg_temp.n253_id(903));

-- Roles with the production permission keys (as in 247's and 244's suites).
CREATE TEMP TABLE n253_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n253_roles VALUES
 (pg_temp.n253_id(1102), 'Admissions Manager', '["application.manage","case.curator.assign","case.read.full","case.read.summary","case.workflow.read","client.read","document.read.full","lead.read","profile.read.full","staff.task.read","task.create","task.manage"]', 1120),
 (pg_temp.n253_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n253_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140);
CREATE TEMP TABLE n253_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n253_grants VALUES
 (302, pg_temp.n253_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n253_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n253_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n253_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n253_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n253_id(902), 'resourceKind', NULL)),
 (307, pg_temp.n253_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n253_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n253_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n253_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n253_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n253_id(1);
GRANT SELECT ON n253_roles, n253_grants, n253_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n253_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n253_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n253_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n253_admin_setup';
SET LOCAL ROLE authenticated;
DO $n253_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n253_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n253_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N253 ' || r.label, 'description', 'Migration 253 synthetic role',
        'permissionKeys', r.keys), 'N253 create role', pg_temp.n253_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n253_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n253_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N253 publish role', pg_temp.n253_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n253_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n253_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n253_id(1), pg_temp.n253_id(m),
      (SELECT access_version FROM n253_versions WHERE membership_id = pg_temp.n253_id(m)), items, bindings,
      'N253 grant roles', pg_temp.n253_id(2000 + m));
  END LOOP;
END
$n253_roles$;
RESET ROLE;
-- The department Sales Manager role is the 208 workflow role, as bound in production.
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.n253_id(1103);

UPDATE n253_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n253_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n253_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n253_admin FROM n253_actors WHERE n = 1 \gset
SELECT claims AS n253_sales_a FROM n253_actors WHERE n = 2 \gset
SELECT claims AS n253_admissions_manager FROM n253_actors WHERE n = 3 \gset
SELECT claims AS n253_student FROM n253_actors WHERE n = 5 \gset
SELECT claims AS n253_sales_b FROM n253_actors WHERE n = 7 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n253_id(199),
  'claims', jsonb_build_object('sub', pg_temp.n253_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS n253_none \gset
SELECT pg_temp.n253_assert(platform_private.staff_is_sales_manager(pg_temp.n253_id(1), pg_temp.n253_id(302))
  AND platform_private.staff_is_sales_manager(pg_temp.n253_id(1), pg_temp.n253_id(307))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.n253_id(1), pg_temp.n253_id(301)),
  'fixture: both department Sales Managers are 208 Sales Managers; the system Admin is not');

-- September 2026 records (synthetic; amounts in minor units):
--   R1 import, Sales A: 1 500 EUR, paid 135 000 KGS; flags: currency, status
--   R2 import, Sales A: 2 000 USD, paid 2 000 USD; flag: status (still empty)
--   R3 import, Sales A: no sale date, 1 000 USD, paid unknown, no phone;
--      flags: date, paid, phone, a malformed string and a status that was fixed
--   R4 manual (saved through v1 before 253), Sales A: 1 800 USD, paid 45 000
--      KGS, not flagged
--   R5 manual, Sales B: 900 USD, paid 900 USD
--   R6 import, Sales A, AUGUST: the same manager in the third spelling
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint)
SELECT pg_temp.n253_id(1000 + f.k), pg_temp.n253_id(1), f.month::DATE, pg_temp.n253_id(302), 'import', f.fields::JSONB,
  'n253:sheet:' || f.k, repeat('ab', 32), 'N253 synthetic sheet', f.k, f.snapshot::JSONB, 'n253-fingerprint-' || f.k
FROM (VALUES
  (1, '2026-09-01', '{"applicant_name":"N253 R1","phone":"+10000000001","signing_date":"2026-09-10","manager_label":"Санжар Эскизов","status_raw":"",
     "service_cost_minor":150000,"service_cost_currency":"EUR","paid_minor":13500000,"paid_currency":"KGS","needs_review":true}',
   '{"phone":"N253-SNAPSHOT-SECRET","review_flags":["cost_paid_currency_mismatch","status_unspecified"]}'),
  (2, '2026-09-01', '{"applicant_name":"N253 R2","phone":"+10000000002","signing_date":"2026-09-12","manager_label":"санжар  эскизов.","status_raw":"",
     "service_cost_minor":200000,"service_cost_currency":"USD","paid_minor":200000,"paid_currency":"USD","needs_review":true}',
   '{"review_flags":["status_unspecified"]}'),
  (3, '2026-09-01', '{"applicant_name":"N253 R3","phone":"","signing_date":null,"manager_label":"Айдана Макетова","status_raw":"Оплачено",
     "service_cost_minor":100000,"service_cost_currency":"USD","paid_minor":null,"paid_currency":null,"needs_review":true}',
   '{"review_flags":["signing_date_missing","paid_missing","phone_missing","Bad Flag","x;drop","status_unspecified","phone_missing"]}'),
  (6, '2026-08-01', '{"applicant_name":"N253 R6","phone":"+10000000006","signing_date":"2026-08-20","manager_label":"САНЖАР ЭСКИЗОВ.","status_raw":"Оплачено",
     "service_cost_minor":100000,"service_cost_currency":"USD","paid_minor":100000,"paid_currency":"USD","needs_review":false}',
   '{"review_flags":[]}')) AS f(k, month, fields, snapshot);
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields)
SELECT pg_temp.n253_id(1000 + f.k), pg_temp.n253_id(1), '2026-09-01', pg_temp.n253_id(f.owner), 'manual', f.fields::JSONB
FROM (VALUES
  (4, 302, '{"applicant_name":"N253 R4","phone":"","signing_date":"2026-09-14","manager_label":"Айдана Макетова.","status_raw":"",
     "service_cost_minor":180000,"service_cost_currency":"USD","paid_minor":4500000,"paid_currency":"KGS","needs_review":false}'),
  (5, 307, '{"applicant_name":"N253 R5","phone":"","signing_date":"2026-09-15","manager_label":"Другой Менеджер","status_raw":"",
     "service_cost_minor":90000,"service_cost_currency":"USD","paid_minor":90000,"paid_currency":"USD","needs_review":false}')) AS f(k, owner, fields);

-- ---------------------------------------------------------------------------
-- 1. Row v2 and v4 for Sales Manager A.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_sept \gset
SELECT platform.read_sales_register_v3(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_sept_v3 \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9, p_manager_key => ' Санжар Эскизов. ')::TEXT AS n253_a_sanzhar \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, NULL, p_manager_key => 'санжар эскизов')::TEXT AS n253_a_sanzhar_year \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9, p_record_id => pg_temp.n253_id(1003))::TEXT AS n253_a_selected \gset
RESET ROLE;
SELECT pg_temp.n253_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'n253_a_sept'::JSONB) k)
  = ARRAY['has_more','manager_key','manager_options','month','offset','organization_id','owner_options','query','rows','selected',
    'targets','total_count','totals','unresolved_cost_count','unresolved_paid_count','year'],
  'v4 answers exactly its keys: ' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(:'n253_a_sept'::JSONB) k));
SELECT pg_temp.n253_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.n253_row(:'n253_a_sept'::JSONB, pg_temp.n253_id(1001))) k)
  = (SELECT array_agg(k ORDER BY k) FROM (SELECT jsonb_object_keys(pg_temp.n253_row(:'n253_a_sept_v3'::JSONB, pg_temp.n253_id(1001))) k
      UNION ALL SELECT unnest(ARRAY['paid_contract','review_reasons','import_flags','manager_key'])) keys),
  'row v2 = the v1 row + paid_contract, review_reasons, import_flags, manager_key');
SELECT pg_temp.n253_assert((:'n253_a_sept'::JSONB ->> 'total_count') = '4'
  AND (:'n253_a_sept'::JSONB ->> 'total_count') = (:'n253_a_sept_v3'::JSONB ->> 'total_count')
  AND (SELECT array_agg((r ->> 'id')::UUID ORDER BY r ->> 'id') FROM jsonb_array_elements(:'n253_a_sept'::JSONB -> 'rows') r)
    = (SELECT array_agg((r ->> 'id')::UUID ORDER BY r ->> 'id') FROM jsonb_array_elements(:'n253_a_sept_v3'::JSONB -> 'rows') r),
  'v4 shows Sales Manager A exactly the records v3 shows (R1–R4, not R5 of department B)');
SELECT pg_temp.n253_assert(strpos(:'n253_a_sept', 'N253-SNAPSHOT-SECRET') = 0 AND strpos(:'n253_a_sept', 'source_snapshot') = 0,
  'the import snapshot never leaves the database');
SELECT pg_temp.n253_assert(pg_temp.n253_row(:'n253_a_sept'::JSONB, r.id) @> r.expected
    AND pg_temp.n253_row(:'n253_a_sept'::JSONB, r.id) -> 'review_reasons' = r.expected -> 'review_reasons'
    AND pg_temp.n253_row(:'n253_a_sept'::JSONB, r.id) -> 'import_flags' = r.expected -> 'import_flags',
  'row ' || r.id || ': ' || (pg_temp.n253_row(:'n253_a_sept'::JSONB, r.id))::TEXT)
FROM (VALUES
  (pg_temp.n253_id(1001), '{"paid_contract":null,"review_reasons":["contract_amount_missing","import:status_unspecified"],
     "import_flags":["cost_paid_currency_mismatch","status_unspecified"],"manager_key":"санжар эскизов"}'::JSONB),
  (pg_temp.n253_id(1002), '{"paid_contract":null,"review_reasons":["import:status_unspecified"],
     "import_flags":["status_unspecified"],"manager_key":"санжар эскизов"}'::JSONB),
  -- The status was fixed after the import; the malformed flag strings are dropped.
  (pg_temp.n253_id(1003), '{"paid_contract":null,"review_reasons":["signing_date_missing","paid_missing","import:phone_missing"],
     "import_flags":["signing_date_missing","paid_missing","phone_missing","status_unspecified"],"manager_key":"айдана макетова"}'::JSONB),
  -- Not flagged: no reasons, whatever the currencies.
  (pg_temp.n253_id(1004), '{"paid_contract":null,"review_reasons":[],"import_flags":[],"manager_key":"айдана макетова"}'::JSONB)
) AS r(id, expected);
SELECT pg_temp.n253_assert((:'n253_a_selected'::JSONB -> 'selected') = pg_temp.n253_row(:'n253_a_sept'::JSONB, pg_temp.n253_id(1003)),
  'the selected record is the same row v2');
-- The manager key filter: two spellings of one person in September, three in the year.
SELECT pg_temp.n253_assert((:'n253_a_sanzhar'::JSONB ->> 'manager_key') = 'санжар эскизов'
  AND (SELECT array_agg(r ->> 'applicant_name' ORDER BY r ->> 'applicant_name') FROM jsonb_array_elements(:'n253_a_sanzhar'::JSONB -> 'rows') r)
    = ARRAY['N253 R1', 'N253 R2']
  AND (SELECT array_agg(r ->> 'applicant_name' ORDER BY r ->> 'applicant_name') FROM jsonb_array_elements(:'n253_a_sanzhar_year'::JSONB -> 'rows') r)
    = ARRAY['N253 R1', 'N253 R2', 'N253 R6'],
  'p_manager_key selects every spelling of the key (September 2, the year 3)');
-- Options: every key A can read, unmapped = most frequent tidy spelling (tie → first),
-- counts = the selection without the manager filter.
SELECT pg_temp.n253_assert((:'n253_a_sept'::JSONB -> 'manager_options') = '[
    {"key":"айдана макетова","name":"Айдана Макетова","count":2},
    {"key":"санжар эскизов","name":"Санжар Эскизов","count":2}]'::JSONB,
  'manager options for A: ' || (:'n253_a_sept'::JSONB -> 'manager_options')::TEXT);
SELECT pg_temp.n253_assert((:'n253_a_sanzhar'::JSONB -> 'manager_options') = (:'n253_a_sept'::JSONB -> 'manager_options'),
  'option counts ignore the manager filter itself');
-- Totals before any contract amount: paid KGS stays KGS.
SELECT pg_temp.n253_assert((:'n253_a_sept'::JSONB -> 'totals') = '[
    {"currency":"EUR","cost_minor":"150000","paid_minor":"0"},
    {"currency":"KGS","cost_minor":"0","paid_minor":"18000000"},
    {"currency":"USD","cost_minor":"480000","paid_minor":"200000"}]'::JSONB,
  'totals before: ' || (:'n253_a_sept'::JSONB -> 'totals')::TEXT);
-- Sales Manager B: only department B, its own options.
SET LOCAL request.jwt.claims TO :'n253_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_assert((platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9) ->> 'total_count') = '1'
  AND (platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9) -> 'manager_options')
    = '[{"key":"другой менеджер","name":"Другой Менеджер","count":1}]'::JSONB
  AND (platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9, p_manager_key => 'Санжар Эскизов') ->> 'total_count') = '0'
  AND pg_temp.n253_message(format('SELECT platform.read_sales_register_v4(%L::UUID, 2026, 9, p_record_id => %L::UUID)',
    pg_temp.n253_id(1), pg_temp.n253_id(1001))) LIKE '42501 %',
  'Sales Manager B sees neither department A''s records nor its managers');
RESET ROLE;
-- Filters refused like v3, plus an empty key.
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_assert(
  pg_temp.n253_message(format('SELECT platform.read_sales_register_v4(%L::UUID, 2026, 9, p_manager_key => %L)', pg_temp.n253_id(1), ' . ')) LIKE '22023 %'
  AND pg_temp.n253_message(format('SELECT platform.read_sales_register_v4(%L::UUID, 2026, 9, p_manager_key => %L)', pg_temp.n253_id(1), E'a\nb')) LIKE '22023 %'
  AND pg_temp.n253_message(format('SELECT platform.read_sales_register_v4(%L::UUID, 2026, 9, p_archived => TRUE, p_sale_slice => %L)', pg_temp.n253_id(1), 'undated')) LIKE '22023 %',
  'v4 refuses an empty or control-character key and a slice over the archive');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. manage v2: «Оплачено в валюте договора».
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n253_fields(p_id UUID, p_changes JSONB) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('report_month', r.report_month::TEXT, 'owner_membership_id', r.owner_membership_id::TEXT)
    || (r.fields - 'needs_review') || jsonb_build_object('needs_review', FALSE) || p_changes
  FROM platform_private.sales_register r WHERE r.id = p_id
$$;
CREATE TEMP TABLE n253_commands(label TEXT, fields JSONB);
INSERT INTO n253_commands VALUES
  ('r1', pg_temp.n253_fields(pg_temp.n253_id(1001), '{}')),
  ('r2', pg_temp.n253_fields(pg_temp.n253_id(1002), '{}')),
  ('r4', pg_temp.n253_fields(pg_temp.n253_id(1004), '{}'));
GRANT SELECT ON n253_commands TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.n253_fields(UUID, JSONB) TO authenticated;
SELECT count(*) AS n253_audit_before FROM platform.audit_events WHERE organization_id = pg_temp.n253_id(1) \gset

-- Refusals first: nobody but the record's department Sales Manager writes.
SELECT format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 140000, %L, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1001), (SELECT fields FROM n253_commands WHERE label = 'r1'), 'EUR',
  'N253 contract amount', pg_temp.n253_id(3001)) AS n253_r1_command \gset
SET LOCAL request.jwt.claims TO :'n253_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_admin_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_b_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_admissions_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_student_write \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_none_write \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_anon_write \gset
RESET ROLE;
SELECT pg_temp.n253_assert(w.result LIKE '42501 %', w.who || ' cannot write through manage v2: ' || w.result)
FROM (VALUES ('the system Admin (not a Sales Manager)', :'n253_admin_write'), ('Sales Manager B', :'n253_b_write'),
  ('the Admissions Manager', :'n253_admissions_write'), ('the Student', :'n253_student_write'),
  ('a caller without a membership', :'n253_none_write'), ('anon', :'n253_anon_write')) AS w(who, result);
SELECT pg_temp.n253_assert((SELECT version FROM platform_private.sales_register WHERE id = pg_temp.n253_id(1001)) = 1
  AND (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n253_id(1)) = :'n253_audit_before'::BIGINT,
  'refused writes change nothing');

SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
-- R1: 140 000 KGS … the contract amount 1 400 EUR; nothing else missing → not flagged.
SELECT pg_temp.n253_message(:'n253_r1_command') AS n253_r1_saved \gset
SELECT platform.manage_sales_register_v2(pg_temp.n253_id(1), 'update', pg_temp.n253_id(1001), 1,
  (SELECT fields FROM n253_commands WHERE label = 'r1'), 140000, 'EUR', 'N253 contract amount', pg_temp.n253_id(3001))::TEXT AS n253_r1_replay \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 141000, %L, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1001), (SELECT fields FROM n253_commands WHERE label = 'r1'), 'EUR',
  'N253 contract amount', pg_temp.n253_id(3001))) AS n253_r1_conflict \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, NULL, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1001), (SELECT fields FROM n253_commands WHERE label = 'r1'),
  'N253 stale', pg_temp.n253_id(3002))) AS n253_r1_stale \gset
-- R2 is paid in its own currency: no contract amount.
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 200000, %L, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1002), (SELECT fields FROM n253_commands WHERE label = 'r2'), 'USD',
  'N253 same currency', pg_temp.n253_id(3003))) AS n253_r2_same \gset
-- R4: a contract amount in the paid currency, half a pair, and one on an archive command.
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 4500000, %L, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1004), (SELECT fields FROM n253_commands WHERE label = 'r4'), 'KGS',
  'N253 wrong currency', pg_temp.n253_id(3004))) AS n253_r4_wrong_currency \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 50000, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1004), (SELECT fields FROM n253_commands WHERE label = 'r4'),
  'N253 half pair', pg_temp.n253_id(3005))) AS n253_r4_half \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, 50000, %L, %L, %L::UUID)',
  pg_temp.n253_id(1), 'archive', pg_temp.n253_id(1004), '{}', 'USD', 'N253 archive with amount', pg_temp.n253_id(3006))) AS n253_r4_archive_amount \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, NULL, 0, %L::JSONB, NULL, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'create', (SELECT fields FROM n253_commands WHERE label = 'r4'), 'N253 create', pg_temp.n253_id(3007))) AS n253_create \gset
-- R4 saved WITHOUT the contract amount and without the manual flag: the currency difference flags it.
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, NULL, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1004), (SELECT fields FROM n253_commands WHERE label = 'r4'),
  'N253 no contract amount', pg_temp.n253_id(3008))) AS n253_r4_saved \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_after \gset
SELECT platform.read_sales_register_v3(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_after_v3 \gset
RESET ROLE;
SELECT pg_temp.n253_assert(:'n253_r1_saved' = 'ok', 'R1 saved: ' || :'n253_r1_saved');
SELECT pg_temp.n253_assert((:'n253_r1_replay'::JSONB) = jsonb_build_object('organization_id', pg_temp.n253_id(1), 'record_id', pg_temp.n253_id(1001),
    'version', '2', 'operation', 'update', 'request_id', pg_temp.n253_id(3001)),
  'the same request replays its receipt: ' || :'n253_r1_replay');
SELECT pg_temp.n253_assert(:'n253_r1_conflict' = '22023 sales_register_request_id_conflict', 'another amount under the same request id: ' || :'n253_r1_conflict');
SELECT pg_temp.n253_assert(:'n253_r1_stale' = 'PT409 sales_register_stale', 'a stale version: ' || :'n253_r1_stale');
SELECT pg_temp.n253_assert(:'n253_r2_same' = '22023 sales_register_invalid_contract_amount', 'same currency: ' || :'n253_r2_same');
SELECT pg_temp.n253_assert(:'n253_r4_wrong_currency' = '22023 sales_register_invalid_contract_amount', 'not the cost currency: ' || :'n253_r4_wrong_currency');
SELECT pg_temp.n253_assert(:'n253_r4_half' = '22023 sales_register_invalid_command', 'half a pair: ' || :'n253_r4_half');
SELECT pg_temp.n253_assert(:'n253_r4_archive_amount' = '22023 sales_register_invalid_command', 'an amount on archive: ' || :'n253_r4_archive_amount');
SELECT pg_temp.n253_assert(:'n253_create' = '22023 sales_register_curator_required', 'no create through the report command: ' || :'n253_create');
SELECT pg_temp.n253_assert(:'n253_r4_saved' = 'ok', 'R4 saved: ' || :'n253_r4_saved');
SELECT pg_temp.n253_assert((SELECT paid_contract_minor = 140000 AND paid_contract_currency = 'EUR' AND version = 2
    AND fields->>'needs_review' = 'false' FROM platform_private.sales_register WHERE id = pg_temp.n253_id(1001)),
  'R1: 1 400 EUR paid in the contract currency; a currency difference alone no longer flags it');
SELECT pg_temp.n253_assert((SELECT paid_contract_minor IS NULL AND version = 2 AND fields->>'needs_review' = 'true'
    FROM platform_private.sales_register WHERE id = pg_temp.n253_id(1004)),
  'R4: paid in KGS without the contract amount — flagged by the currency rule');
SELECT pg_temp.n253_assert(pg_temp.n253_row(:'n253_a_after'::JSONB, pg_temp.n253_id(1001))
    @> '{"paid_contract":{"minor":140000,"currency":"EUR"},"review_reasons":[],"needs_review":false}'::JSONB
  AND pg_temp.n253_row(:'n253_a_after'::JSONB, pg_temp.n253_id(1004)) -> 'review_reasons' = '["contract_amount_missing"]'::JSONB,
  'row v2 after the saves: R1 checked with its contract amount; R4 names the missing amount');
-- Totals: R1's paid side is 1 400 EUR now, not 135 000 KGS.
SELECT pg_temp.n253_assert((:'n253_a_after'::JSONB -> 'totals') = '[
    {"currency":"EUR","cost_minor":"150000","paid_minor":"140000"},
    {"currency":"KGS","cost_minor":"0","paid_minor":"4500000"},
    {"currency":"USD","cost_minor":"480000","paid_minor":"200000"}]'::JSONB,
  'totals after: ' || (:'n253_a_after'::JSONB -> 'totals')::TEXT);
-- Rollback: v3 keeps the v1 row keys (no contract amount, no reasons).
SELECT pg_temp.n253_assert(NOT (pg_temp.n253_row(:'n253_a_after_v3'::JSONB, pg_temp.n253_id(1001)) ?| ARRAY['paid_contract','review_reasons','import_flags','manager_key'])
  AND (:'n253_a_after_v3'::JSONB -> 'totals') = (:'n253_a_sept_v3'::JSONB -> 'totals'),
  'v3 after the saves: the same v1 row keys and v3''s own totals');
SELECT pg_temp.n253_assert((SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n253_id(1)
    AND action = 'sales.register.update' AND resource_id IN (pg_temp.n253_id(1001), pg_temp.n253_id(1004))) = 2
  AND (SELECT after_state FROM platform.audit_events WHERE request_id = pg_temp.n253_id(3001))
    = '{"version":"2","archived":false,"paid_contract_set":true}'::JSONB
  AND (SELECT reason FROM platform_private.sales_register_requests WHERE request_id = pg_temp.n253_id(3001)) = 'N253 contract amount',
  'one audit event per save, no free text in the audit; the reason stays in the private request history');

-- manage v1 (rollback path) still edits the record and leaves the contract amount alone;
-- a cost currency changed there makes the stale amount a reason, never a total.
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v1(%L::UUID, %L, %L::UUID, 2, %L::JSONB, %L, %L::UUID)',
  pg_temp.n253_id(1), 'update', pg_temp.n253_id(1001),
  (SELECT fields FROM n253_commands WHERE label = 'r1') || '{"service_cost_currency":"USD","needs_review":true}'::JSONB,
  'N253 v1 edit', pg_temp.n253_id(3010))) AS n253_v1_saved \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_stale \gset
RESET ROLE;
SELECT pg_temp.n253_assert(:'n253_v1_saved' = 'ok'
  AND (SELECT paid_contract_minor = 140000 AND paid_contract_currency = 'EUR' AND version = 3 FROM platform_private.sales_register WHERE id = pg_temp.n253_id(1001))
  AND pg_temp.n253_row(:'n253_a_stale'::JSONB, pg_temp.n253_id(1001)) -> 'review_reasons' = '["contract_amount_missing","import:status_unspecified"]'::JSONB
  AND (:'n253_a_stale'::JSONB -> 'totals') @> '[{"currency":"KGS","cost_minor":"0","paid_minor":"18000000"}]'::JSONB
  AND NOT ((:'n253_a_stale'::JSONB -> 'totals') @> '[{"currency":"EUR"}]'::JSONB),
  'v1 edit keeps the columns; the stale EUR amount is a reason and stays out of the totals: ' || (:'n253_a_stale'::JSONB -> 'totals')::TEXT);

-- Archive and restore through v2.
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 1, %L::JSONB, NULL, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'archive', pg_temp.n253_id(1002), '{}', 'N253 archive', pg_temp.n253_id(3011))) AS n253_archived \gset
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9, p_archived => TRUE)::TEXT AS n253_a_archive \gset
SELECT pg_temp.n253_message(format('SELECT platform.manage_sales_register_v2(%L::UUID, %L, %L::UUID, 2, %L::JSONB, NULL, NULL, %L, %L::UUID)',
  pg_temp.n253_id(1), 'restore', pg_temp.n253_id(1002), '{}', 'N253 restore', pg_temp.n253_id(3012))) AS n253_restored \gset
RESET ROLE;
SELECT pg_temp.n253_assert(:'n253_archived' = 'ok' AND :'n253_restored' = 'ok'
  AND (SELECT array_agg(r ->> 'applicant_name') FROM jsonb_array_elements(:'n253_a_archive'::JSONB -> 'rows') r) = ARRAY['N253 R2']
  AND (:'n253_a_archive'::JSONB -> 'totals') = '[]'::JSONB
  AND (SELECT NOT archived AND version = 3 FROM platform_private.sales_register WHERE id = pg_temp.n253_id(1002)),
  'archive and restore through v2; the archive has no totals');

-- ---------------------------------------------------------------------------
-- 3. «Менеджеры в отчёте».
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n253_admin';
SET LOCAL ROLE authenticated;
SELECT platform.read_sales_manager_labels_v1(pg_temp.n253_id(1))::TEXT AS n253_labels \gset
RESET ROLE;
SELECT pg_temp.n253_assert((:'n253_labels'::JSONB ->> 'organization_id')::UUID = pg_temp.n253_id(1)
  AND (SELECT array_agg(l ->> 'key' ORDER BY l ->> 'key') FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'labels') l)
    = ARRAY['айдана макетова', 'другой менеджер', 'санжар эскизов']
  AND (SELECT l FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'labels') l WHERE l ->> 'key' = 'санжар эскизов')
    @> '{"record_count":3,"mapping":null}'::JSONB
  AND (SELECT l FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'labels') l WHERE l ->> 'key' = 'санжар эскизов')
    = '{"key":"санжар эскизов","tidy":"Санжар Эскизов","mapping":null,"record_count":3,"spellings":[
        {"count":1,"spelling":"санжар  эскизов."},{"count":1,"spelling":"Санжар Эскизов"},{"count":1,"spelling":"САНЖАР ЭСКИЗОВ."}]}'::JSONB
  AND (SELECT l FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'labels') l WHERE l ->> 'key' = 'айдана макетова')
    = '{"key":"айдана макетова","tidy":"Айдана Макетова","mapping":null,"record_count":2,"spellings":[
        {"count":1,"spelling":"Айдана Макетова"},{"count":1,"spelling":"Айдана Макетова."}]}'::JSONB,
  'the Admin reads every key with its raw spellings and record count: ' || :'n253_labels');
SELECT pg_temp.n253_assert((SELECT array_agg((s ->> 'id')::UUID ORDER BY s ->> 'id') FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'staff_options') s)
    @> ARRAY[pg_temp.n253_id(302), pg_temp.n253_id(307)]
  AND NOT ((SELECT array_agg((s ->> 'id')::UUID) FROM jsonb_array_elements(:'n253_labels'::JSONB -> 'staff_options') s)
    && ARRAY[pg_temp.n253_id(303), pg_temp.n253_id(305)]),
  'staff options: those who can own report records, not Admissions or the Student');

SET LOCAL request.jwt.claims TO :'n253_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, %L::UUID, %L::UUID)',
  pg_temp.n253_id(1), 'санжар эскизов', ' Санжар Эскизов (синтетический) ', pg_temp.n253_id(302), pg_temp.n253_id(4001))) AS n253_map_saved \gset
SELECT platform.save_sales_manager_label_v1(pg_temp.n253_id(1), 'санжар эскизов', 0, ' Санжар Эскизов (синтетический) ',
  pg_temp.n253_id(302), pg_temp.n253_id(4001))::TEXT AS n253_map_replay \gset
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, NULL, %L::UUID)',
  pg_temp.n253_id(1), 'санжар эскизов', 'Другое имя', pg_temp.n253_id(4002))) AS n253_map_stale \gset
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, NULL, %L::UUID)',
  pg_temp.n253_id(1), 'нет такого', 'Нет такого', pg_temp.n253_id(4003))) AS n253_map_unknown \gset
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, NULL, %L::UUID)',
  pg_temp.n253_id(1), 'Айдана Макетова', 'Айдана', pg_temp.n253_id(4004))) AS n253_map_not_key \gset
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, %L::UUID, %L::UUID)',
  pg_temp.n253_id(1), 'айдана макетова', 'Айдана Макетова', pg_temp.n253_id(303), pg_temp.n253_id(4005))) AS n253_map_admissions \gset
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, NULL, %L::UUID, %L::UUID)',
  pg_temp.n253_id(1), 'айдана макетова', pg_temp.n253_id(302), pg_temp.n253_id(4006))) AS n253_map_member_no_name \gset
-- A person without a CRM account: a name only.
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 0, %L, NULL, %L::UUID)',
  pg_temp.n253_id(1), 'айдана макетова', 'Айдана Макетова (без аккаунта)', pg_temp.n253_id(4007))) AS n253_map_name_only \gset
RESET ROLE;
SELECT pg_temp.n253_assert(:'n253_map_saved' = 'ok', 'mapping saved: ' || :'n253_map_saved');
SELECT pg_temp.n253_assert(:'n253_map_replay'::JSONB = jsonb_build_object('organization_id', pg_temp.n253_id(1), 'operation', 'manager_label',
    'label_key', 'санжар эскизов', 'version', '1', 'request_id', pg_temp.n253_id(4001)), 'mapping replay: ' || :'n253_map_replay');
SELECT pg_temp.n253_assert(:'n253_map_stale' = 'PT409 sales_manager_label_stale', 'mapping stale: ' || :'n253_map_stale');
SELECT pg_temp.n253_assert(:'n253_map_unknown' = '22023 sales_manager_label_unknown', 'a key with no record: ' || :'n253_map_unknown');
SELECT pg_temp.n253_assert(:'n253_map_not_key' = '22023 sales_manager_label_invalid', 'a spelling is not a key: ' || :'n253_map_not_key');
SELECT pg_temp.n253_assert(:'n253_map_admissions' = '22023 sales_manager_label_invalid_membership', 'Admissions cannot own records: ' || :'n253_map_admissions');
SELECT pg_temp.n253_assert(:'n253_map_member_no_name' = '22023 sales_manager_label_invalid', 'a staff member needs a name: ' || :'n253_map_member_no_name');
SELECT pg_temp.n253_assert(:'n253_map_name_only' = 'ok', 'a name without a CRM account: ' || :'n253_map_name_only');
SELECT pg_temp.n253_assert((SELECT display_name = 'Санжар Эскизов (синтетический)' AND membership_id = pg_temp.n253_id(302)
    AND version = 1 AND updated_by = pg_temp.n253_id(301)
    FROM platform_private.sales_manager_labels WHERE organization_id = pg_temp.n253_id(1) AND label_key = 'санжар эскизов'),
  'the stored mapping is trimmed, names the staff member and who saved it');
-- The report names the key by the owner's mapping; the filter is unchanged.
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_assert((platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9) -> 'manager_options')
    @> '[{"key":"санжар эскизов","name":"Санжар Эскизов (синтетический)","count":2},
         {"key":"айдана макетова","name":"Айдана Макетова (без аккаунта)","count":2}]'::JSONB,
  'v4 options carry the mapped names');
-- Sales Manager A reads the report but not the mapping screen.
SELECT pg_temp.n253_assert(pg_temp.n253_message(format('SELECT platform.read_sales_manager_labels_v1(%L::UUID)', pg_temp.n253_id(1))) LIKE '42501 %'
  AND pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 1, %L, NULL, %L::UUID)',
    pg_temp.n253_id(1), 'санжар эскизов', 'Чужое имя', pg_temp.n253_id(4010))) LIKE '42501 %',
  'Sales Manager A: no mapping without sales.register.import');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.read_sales_manager_labels_v1(%L::UUID)', pg_temp.n253_id(1))) AS n253_labels_admissions \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.read_sales_manager_labels_v1(%L::UUID)', pg_temp.n253_id(1))) AS n253_labels_student \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.read_sales_manager_labels_v1(%L::UUID)', pg_temp.n253_id(1))) AS n253_labels_none \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n253_message(format('SELECT platform.read_sales_manager_labels_v1(%L::UUID)', pg_temp.n253_id(1))) AS n253_labels_anon \gset
RESET ROLE;
SELECT pg_temp.n253_assert(w.result LIKE '42501 %', w.who || ' cannot read the mapping: ' || w.result)
FROM (VALUES ('the Admissions Manager', :'n253_labels_admissions'), ('the Student', :'n253_labels_student'),
  ('a caller without a membership', :'n253_labels_none'), ('anon', :'n253_labels_anon')) AS w(who, result);
-- Clearing keeps the row and its version; the report falls back to the spelling.
SET LOCAL request.jwt.claims TO :'n253_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n253_message(format('SELECT platform.save_sales_manager_label_v1(%L::UUID, %L, 1, NULL, NULL, %L::UUID)',
  pg_temp.n253_id(1), 'санжар эскизов', pg_temp.n253_id(4011))) AS n253_map_cleared \gset
SELECT platform.read_sales_manager_labels_v1(pg_temp.n253_id(1))::TEXT AS n253_labels_after \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n253_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.read_sales_register_v4(pg_temp.n253_id(1), 2026, 9)::TEXT AS n253_a_cleared \gset
RESET ROLE;
SELECT pg_temp.n253_assert(:'n253_map_cleared' = 'ok'
  AND (SELECT l -> 'mapping' FROM jsonb_array_elements(:'n253_labels_after'::JSONB -> 'labels') l WHERE l ->> 'key' = 'санжар эскизов')
    @> '{"display_name":null,"membership_id":null,"version":"2"}'::JSONB
  AND NOT ((:'n253_a_cleared'::JSONB -> 'manager_options') @> '[{"name":"Санжар Эскизов (синтетический)"}]'::JSONB),
  'a cleared mapping keeps its version; the report names the key by a spelling again');
SELECT pg_temp.n253_assert((SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n253_id(1)
    AND action = 'sales.register.manager.label') = 3
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE organization_id = pg_temp.n253_id(1)
    AND action = 'sales.register.manager.label' AND (before_state::TEXT LIKE '%Санжар%' OR after_state::TEXT LIKE '%Айдана%')),
  'three mapping saves, three audit events, no names in them');

SELECT 'N253_SALES_REPORT_V4_SUITE_OK' AS n253_suite_marker;
ROLLBACK;
