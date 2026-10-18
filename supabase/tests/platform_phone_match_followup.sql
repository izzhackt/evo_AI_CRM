\set ON_ERROR_STOP on
-- Boundary suite for the migration «Телефоны: остаточные случаи сопоставления
-- после 281» (issue #1198; docs/PLAN_CHANGES.md «2026-10-17 · Телефоны:
-- остаточные случаи сопоставления после 281 (#1198, миграция 296,
-- запись до кода)»; итоговый номер миграции 303); хук в
-- scripts/test-postgres-authorization.sh привязан к имени файла миграции
-- (*_platform_phone_match_followup.sql), поэтому переименование при слиянии его
-- не ломает. Набор выполняется сразу после этой миграции. Набор 281
-- (platform_admissions_direct_student.sql) выполняется до неё и остаётся как
-- есть: его последняя проверка («сайт открывает лид клиенту дела») верна на
-- срезе 281, здесь она заменена проверками раздела C.
--
-- Members are modelled like production after 155 (as in 281's and 292's
-- suites): invited staff have coarse role NULL and get permissions only from
-- scoped role assignments with the production keys (Admissions, Sales Manager,
-- «общие разделы»). Cases come through 281's own command and import.
--
-- A  ключи: номер другой страны без «+» (10–15 цифр, первая не 0) получает те
--    же три ключа, что у прямого пути (+N, N, 00N), в том числе для 7 701 …
--    (Казахстан), 90 532 … (Турция) и границ длины; правила Кыргызстана,
--    «+»-номера, пустой ввод и короткие номера не изменились; национальный
--    префикс (8 701 …, 0532 …) и 7–8 цифр по-прежнему не угадываются.
-- B  обратный порядок через настоящие команды: после дела на +7 701 … ручной
--    лид продаж в любом написании номера отвечает duplicate и ничего не
--    создаёт, новый номер сохраняется как набран; «8 701 …» и «0532 …»
--    не находятся (зафиксированное ограничение); ручной лид 7 701 … раньше дела
--    по-прежнему блокирует дело (lead_exists); сайт с 905321234567 и
--    77015200002 присоединяется к клиенту, хранящему +90… и +7…, а не создаёт
--    второго.
-- C  заявка с сайта после прямого дела (дело ждёт куратора, дело активно):
--    нового лида продаж нет, квитанция, касание is_repeat и строка журнала
--    стоят на лиде дела (в after_state student_case_id), клиент и дело не
--    меняются, interest_direction лида дела не перезаписывается; повтор того же
--    requestId ничего не добавляет, другое тело — request_conflict; открытый
--    лид по-прежнему главнее дела; закрытое дело открывает новый лид, как
--    раньше.
-- P  posture: одна сигнатура, права и search_path прежние, прежние отказы.
-- Isolated synthetic SQL fixtures only, rolled back: no real person, phone,
-- website request, provider or production action.
BEGIN;

-- The Supabase auth.role() helper receive_website_lead calls first (absent
-- from the bare test image); created inside this transaction only, as in the
-- 262 and 281 suites.
DO $p198_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p198_auth_role$;

CREATE FUNCTION pg_temp.p198_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('11980000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p198_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P198: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.p198_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Two key sets are the same set (order- and collation-independent).
CREATE FUNCTION pg_temp.p198_same(a TEXT[], b TEXT[]) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT a @> b AND a <@ b
$$;
-- A 64-character lower-case hex IP hash, one bucket per number (5 enquiries per
-- ten minutes are allowed for one bucket).
CREATE FUNCTION pg_temp.p198_hash(i INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT repeat(to_hex(i), 64)
$$;
-- One website enquiry as the site route calls it (digits only), status only.
CREATE FUNCTION pg_temp.p198_web(p_request INTEGER, p_name TEXT, p_phone TEXT, p_country TEXT, p_hash INTEGER,
  p_attribution JSONB DEFAULT NULL) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT platform.receive_website_lead(pg_temp.p198_id(1), pg_temp.p198_id(302), pg_temp.p198_id(p_request), p_name, p_phone,
    NULL, NULL, p_country, TRUE, pg_temp.p198_hash(p_hash), NULL, p_attribution) ->> 'status'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p198_id(INTEGER), pg_temp.p198_assert(BOOLEAN, TEXT), pg_temp.p198_error(TEXT),
  pg_temp.p198_same(TEXT[], TEXT[]), pg_temp.p198_hash(INTEGER),
  pg_temp.p198_web(INTEGER, TEXT, TEXT, TEXT, INTEGER, JSONB)
  TO authenticated, anon, service_role;

SELECT 'P198_PHONE_MATCH_FOLLOWUP_SUITE_START' AS p198_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with 1 Admin (system); invited staff with coarse role
-- NULL: 2 Sales Manager (sales department, also the website intake owner),
-- 3 Admissions curator (own scope, admissions department).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p198_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO p198_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL);
GRANT SELECT ON p198_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p198_id(1), 'P198 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p198_id(100 + n), 'p198-' || n || '@example.invalid', '{}'::JSONB FROM p198_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p198_id(200 + n), pg_temp.p198_id(100 + n), 'P198 Actor ' || n, 'active', 1 FROM p198_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p198_id(300 + n), pg_temp.p198_id(1), pg_temp.p198_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM p198_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.p198_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p198_id(401), pg_temp.p198_id(1), 'organization', pg_temp.p198_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.p198_id(1), pg_temp.p198_id(301), pg_temp.p198_id(401), 1, 1, TRUE, 'system',
    'P198 synthetic organization scope', pg_temp.p198_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.p198_id(901), pg_temp.p198_id(1), 'P198 Sales'),
  (pg_temp.p198_id(902), pg_temp.p198_id(1), 'P198 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.p198_id(1), pg_temp.p198_id(302), pg_temp.p198_id(901)),
  (pg_temp.p198_id(1), pg_temp.p198_id(303), pg_temp.p198_id(902));

-- Roles with the EXACT production permission keys (as 244's, 290's and 292's suites).
CREATE TEMP TABLE p198_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO p198_roles VALUES
 (pg_temp.p198_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.p198_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.p198_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE p198_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO p198_grants VALUES
 (302, pg_temp.p198_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.p198_id(901), 'resourceKind', NULL)),
 (303, pg_temp.p198_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (303, pg_temp.p198_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.p198_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE p198_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.p198_id(1);
GRANT SELECT ON p198_roles, p198_grants, p198_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p198_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS p198_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p198_admin_setup';
SET LOCAL ROLE authenticated;
DO $p198_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM p198_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p198_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P198 ' || r.label, 'description', 'Phone match follow-up synthetic role',
        'permissionKeys', r.keys), 'P198 create role', pg_temp.p198_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p198_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p198_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P198 publish role', pg_temp.p198_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p198_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id, g.scope::TEXT),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id, g.scope::TEXT)
      INTO items, bindings FROM p198_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.p198_id(1), pg_temp.p198_id(m),
      (SELECT access_version FROM p198_versions WHERE membership_id = pg_temp.p198_id(m)), items, bindings,
      'P198 grant roles', pg_temp.p198_id(2000 + m));
  END LOOP;
END
$p198_roles$;
RESET ROLE;

UPDATE p198_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS p198_admin FROM p198_actors WHERE n = 1 \gset
SELECT claims AS p198_sales FROM p198_actors WHERE n = 2 \gset

-- ---------------------------------------------------------------------------
-- A. The keys
-- ---------------------------------------------------------------------------
-- A1: a number of another country typed without «+» has the three keys the
-- direct path searches and locks (+N, N, 00N), in every typed spelling, and
-- they are exactly the direct path's keys of its E.164 form.
SELECT pg_temp.p198_assert(
  pg_temp.p198_same(platform_private.person_phone_match_keys('7 701 520 0001'), ARRAY['+77015200001', '77015200001', '0077015200001'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('77015200001'), ARRAY['+77015200001', '77015200001', '0077015200001'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('+7 701 520 0001'), ARRAY['+77015200001', '77015200001', '0077015200001'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('007 701 520 0001'), ARRAY['+77015200001', '77015200001', '0077015200001'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('7 (701) 520-00-01'), platform_private.admissions_direct_phone_keys('+77015200001'))
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('90 532 123 45 67'), ARRAY['+905321234567', '905321234567', '00905321234567'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('905321234567'), platform_private.admissions_direct_phone_keys('+905321234567')),
  'A1: every spelling of a number of another country has the keys of its E.164 form');
-- A2: the length bounds of the new rule (10 to 15 digits, the first not 0).
SELECT pg_temp.p198_assert(
  pg_temp.p198_same(platform_private.person_phone_match_keys('2025550123'), ARRAY['+2025550123', '2025550123', '002025550123'])
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('123456789012345'), ARRAY['+123456789012345', '123456789012345', '00123456789012345'])
  AND platform_private.person_phone_match_keys('1234567890123456') = ARRAY['1234567890123456']
  AND platform_private.person_phone_match_keys('12345678') = ARRAY['12345678']
  AND platform_private.person_phone_match_keys('1234567') = ARRAY['1234567'],
  'A2: 10 to 15 digits read as another country; 16, 8 and 7 digits keep their own key only');
-- A3: nothing is guessed: a national prefix is not turned into a country code,
-- and a number never gets the keys of a different number.
SELECT pg_temp.p198_assert(
  pg_temp.p198_same(platform_private.person_phone_match_keys('8 701 520 0001'), ARRAY['+87015200001', '87015200001', '0087015200001'])
  AND NOT (platform_private.person_phone_match_keys('8 701 520 0001') && ARRAY['+77015200001', '77015200001', '0077015200001'])
  AND platform_private.person_phone_match_keys('0532 123 45 67') = ARRAY['05321234567']
  AND NOT (platform_private.person_phone_match_keys('0532 123 45 67') && ARRAY['+905321234567', '905321234567']),
  'A3: 8 701 … and 0532 … keep only their own digits (not found in the other order: documented)');
-- A4: unchanged: the Kyrgyz spellings, the numbers with «+», empty input.
SELECT pg_temp.p198_assert(
  (SELECT bool_and(pg_temp.p198_same(platform_private.person_phone_match_keys(x.p), platform_private.admissions_direct_phone_keys('+996555198001')))
    FROM unnest(ARRAY['+996 555 198 001', '+996555198001', '996555198001', '0555 198 001', '555 198 001', '555198001',
      '00996555198001', '+9960555198001', '9960555198001']) x(p))
  AND pg_temp.p198_same(platform_private.person_phone_match_keys('+7 701 123 45 67'), ARRAY['+77011234567', '77011234567', '0077011234567'])
  AND platform_private.person_phone_match_keys(NULL) = ARRAY[]::TEXT[]
  AND platform_private.person_phone_match_keys('  ') = ARRAY[]::TEXT[]
  AND platform_private.person_phone_match_keys('+') = ARRAY[]::TEXT[],
  'A4: the Kyrgyz spellings, numbers with «+» and empty input have the keys they had in 281');

-- ---------------------------------------------------------------------------
-- B. The other order, through the real commands
-- ---------------------------------------------------------------------------
-- B1: a manual sales lead typed 7 701 … BEFORE the case (stored as typed,
-- 77015200005) blocks a direct case on +7 701 … (the forward order, unchanged).
SET LOCAL request.jwt.claims TO :'p198_sales';
SET LOCAL ROLE authenticated;
SELECT platform.create_manual_sales_lead(pg_temp.p198_id(1), pg_temp.p198_id(5101), 'P198 Manual KZ Early', '7 701 520 0005', NULL,
  'office', pg_temp.p198_id(302)) ->> 'status' AS p198_early \gset
RESET ROLE;
SELECT pg_temp.p198_assert(:'p198_early' = 'saved'
  AND (SELECT c.normalized_phone = '77015200005' FROM platform.clients c WHERE c.display_name = 'P198 Manual KZ Early'),
  'B1 fixture: the lead typed 7 701 520 0005 is saved as typed');
SET LOCAL request.jwt.claims TO :'p198_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p198_assert(pg_temp.p198_error(format('SELECT platform.create_admissions_student_case_v1(%L, %L, %L::JSONB)',
    pg_temp.p198_id(1), pg_temp.p198_id(5001), jsonb_build_object('student',
      jsonb_build_object('name', 'P198 KZ Forward', 'phone', '+7 701 520 0005'), 'route', jsonb_build_object('country', 'CN'))::TEXT))
  = 'PT409:admissions_direct_lead_exists', 'B1: the open sales lead on 77015200005 refuses the direct case on +77015200005');
RESET ROLE;

-- B2: the direct import stores +77015200001; every spelling of that number is
-- a duplicate for a manual sales lead, and a new number is still saved as typed.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT platform.import_admissions_student_case_v1(pg_temp.p198_id(1), pg_temp.p198_id(301), 'p198-import', 'kz-1',
  jsonb_build_object('student', jsonb_build_object('name', 'P198 Imported KZ', 'phone', '+7 701 520 0001'),
    'route', jsonb_build_object('country', 'CN')), 'P198 synthetic import') AS p198_kz \gset
RESET ROLE;
SELECT pg_temp.p198_assert(:'p198_kz'::JSONB ->> 'status' = 'created'
  AND (SELECT c.normalized_phone = '+77015200001' FROM platform.clients c WHERE c.id = (:'p198_kz'::JSONB ->> 'client_id')::UUID),
  'B2 fixture: the import stores +77015200001');
SET LOCAL request.jwt.claims TO :'p198_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p198_assert((SELECT array_agg(platform.create_manual_sales_lead(pg_temp.p198_id(1), pg_temp.p198_id(5110 + x.i::INTEGER),
      'P198 Manual After KZ ' || x.i, x.p, NULL, 'office', pg_temp.p198_id(302)) ->> 'status' ORDER BY x.i)
    FROM unnest(ARRAY['7 701 520 0001', '77015200001', '+7 701 520 0001', '007 701 520 0001', '0077015200001'])
      WITH ORDINALITY AS x(p, i))
  = ARRAY['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate'],
  'B2: after a case on +77015200001 a manual lead typed 7 701 …, 77015200001, +7 …, 007 … or 00 … is a duplicate');
SELECT platform.create_manual_sales_lead(pg_temp.p198_id(1), pg_temp.p198_id(5120), 'P198 Manual KZ New', '7 701 520 0003', NULL,
  'office', pg_temp.p198_id(302)) ->> 'status' AS p198_kz_new \gset
RESET ROLE;
SELECT pg_temp.p198_assert(NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.display_name LIKE 'P198 Manual After KZ %')
  AND :'p198_kz_new' = 'saved'
  AND (SELECT c.normalized_phone = '77015200003' FROM platform.clients c WHERE c.display_name = 'P198 Manual KZ New'),
  'B2: the duplicates created nothing; a new number is saved as typed');

-- B3: Turkey (a client stored as +905321234567 with no lead), and the
-- documented limits: a national prefix is not found in either order.
SELECT platform_private.create_or_link_client(pg_temp.p198_id(1), 'P198 Turkey Client', NULL, '+90 532 123 45 67',
  'p198-fixture', 'client', 'tr-1', 'staff_recorded', statement_timestamp()) AS p198_tr \gset
SELECT pg_temp.p198_assert((SELECT c.normalized_phone = '+905321234567' FROM platform.clients c WHERE c.id = :'p198_tr'::UUID),
  'B3 fixture: the Turkish client is stored as +905321234567');
SET LOCAL request.jwt.claims TO :'p198_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p198_assert((SELECT array_agg(platform.create_manual_sales_lead(pg_temp.p198_id(1), pg_temp.p198_id(5130 + x.i::INTEGER),
      'P198 Manual TR ' || x.i, x.p, NULL, 'office', pg_temp.p198_id(302)) ->> 'status' ORDER BY x.i)
    FROM unnest(ARRAY['90 532 123 45 67', '905321234567', '+90 532 123 45 67', '0090 532 123 45 67']) WITH ORDINALITY AS x(p, i))
  = ARRAY['duplicate', 'duplicate', 'duplicate', 'duplicate'],
  'B3: a manual lead typed 90 532 …, 905321234567, +90 …, 0090 … after a client on +905321234567 is a duplicate');
SELECT pg_temp.p198_assert((SELECT array_agg(platform.create_manual_sales_lead(pg_temp.p198_id(1), pg_temp.p198_id(5140 + x.i::INTEGER),
      'P198 Manual Limit ' || x.i, x.p, NULL, 'office', pg_temp.p198_id(302)) ->> 'status' ORDER BY x.i)
    FROM unnest(ARRAY['8 701 520 0001', '0532 123 45 67']) WITH ORDINALITY AS x(p, i))
  = ARRAY['saved', 'saved'],
  'B3: the documented limit: 8 701 … (Kazakhstan) and 0532 … (Turkey) are not found; they are new leads');
RESET ROLE;

-- B4: the website in the other order. A client stored as +77015200002 (no lead,
-- no case) and the Turkish client: an enquiry typed without «+» lands on that
-- client (a new lead on it), and no second client appears.
SELECT platform_private.create_or_link_client(pg_temp.p198_id(1), 'P198 KZ Client Two', NULL, '+7 701 520 0002',
  'p198-fixture', 'client', 'kz-2', 'staff_recorded', statement_timestamp()) AS p198_kz2 \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.p198_web(5201, 'P198 Web KZ', '77015200002', 'Malaysia', 7) AS p198_web_kz2 \gset
SELECT pg_temp.p198_web(5202, 'P198 Web TR', '905321234567', 'Turkey', 8) AS p198_web_tr \gset
RESET ROLE;
SELECT pg_temp.p198_assert(:'p198_web_kz2' = 'accepted' AND :'p198_web_tr' = 'accepted', 'B4: the website accepts both enquiries');
SELECT pg_temp.p198_assert((SELECT l.client_id = :'p198_kz2'::UUID AND l.lifecycle_state = 'open' AND l.source_key = 'website'
      AND l.interest_direction = 'MY'
    FROM platform_private.website_lead_receipts r JOIN platform.leads l ON l.id = r.lead_id WHERE r.request_id = pg_temp.p198_id(5201))
  AND (SELECT l.client_id = :'p198_tr'::UUID AND l.lifecycle_state = 'open' AND l.source_key = 'website'
      AND l.interest_direction = 'TR'
    FROM platform_private.website_lead_receipts r JOIN platform.leads l ON l.id = r.lead_id WHERE r.request_id = pg_temp.p198_id(5202))
  AND NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.display_name IN ('P198 Web KZ', 'P198 Web TR')),
  'B4: 77015200002 and 905321234567 from the website land on the clients holding +77015200002 and +905321234567; no second client');

-- ---------------------------------------------------------------------------
-- C. A website enquiry after a direct case
-- ---------------------------------------------------------------------------
-- Cases through 281's command as the Admin: P waits for a curator; A has curator 3
-- (active); X has curator 3 and is closed below; O waits for a curator and gets
-- an open lead below.
SET LOCAL request.jwt.claims TO :'p198_admin';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.p198_id(1), pg_temp.p198_id(5011), jsonb_build_object(
  'student', jsonb_build_object('name', 'P198 Direct Pending', 'phone', '+996 555 198 001'),
  'route', jsonb_build_object('country', 'CN'))) AS p198_rp \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.p198_id(1), pg_temp.p198_id(5012), jsonb_build_object(
  'student', jsonb_build_object('name', 'P198 Direct Active', 'phone', '+996 555 198 002'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.p198_id(303)::TEXT)) AS p198_ra \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.p198_id(1), pg_temp.p198_id(5013), jsonb_build_object(
  'student', jsonb_build_object('name', 'P198 Direct Closed', 'phone', '+996 555 198 003'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.p198_id(303)::TEXT)) AS p198_rx \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.p198_id(1), pg_temp.p198_id(5014), jsonb_build_object(
  'student', jsonb_build_object('name', 'P198 Direct With Open Lead', 'phone', '+996 555 198 004'),
  'route', jsonb_build_object('country', 'CN'))) AS p198_ro \gset
RESET ROLE;
SELECT :'p198_rp'::JSONB ->> 'student_case_id' AS p198_case_p, :'p198_rp'::JSONB ->> 'client_id' AS p198_client_p,
  :'p198_rp'::JSONB ->> 'lead_id' AS p198_lead_p \gset
SELECT :'p198_ra'::JSONB ->> 'student_case_id' AS p198_case_a, :'p198_ra'::JSONB ->> 'client_id' AS p198_client_a,
  :'p198_ra'::JSONB ->> 'lead_id' AS p198_lead_a \gset
SELECT :'p198_rx'::JSONB ->> 'student_case_id' AS p198_case_x, :'p198_rx'::JSONB ->> 'client_id' AS p198_client_x,
  :'p198_rx'::JSONB ->> 'lead_id' AS p198_lead_x \gset
SELECT :'p198_ro'::JSONB ->> 'student_case_id' AS p198_case_o, :'p198_ro'::JSONB ->> 'client_id' AS p198_client_o,
  :'p198_ro'::JSONB ->> 'lead_id' AS p198_lead_o \gset
-- Case X is closed (as the table owner, as 292's suite does for its closed case);
-- client O gets an open lead of another source on top of its direct case.
UPDATE platform.student_cases SET state = 'closed', closed_at = statement_timestamp() WHERE id = :'p198_case_x'::UUID;
SELECT platform_private.create_or_link_lead(pg_temp.p198_id(1), :'p198_client_o'::UUID, NULL, 'new', 'office',
  'p198-fixture', 'lead', 'open-1', 'staff_recorded', statement_timestamp()) AS p198_open_lead \gset
SELECT pg_temp.p198_assert((SELECT c.state = 'pending' AND c.source_key = 'admissions-direct:' || :'p198_lead_p'
      AND c.canonical_client_id = :'p198_client_p'::UUID FROM platform.student_cases c WHERE c.id = :'p198_case_p'::UUID)
  AND (SELECT c.state = 'active' FROM platform.student_cases c WHERE c.id = :'p198_case_a'::UUID)
  AND (SELECT c.state = 'closed' FROM platform.student_cases c WHERE c.id = :'p198_case_x'::UUID)
  AND (SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'p198_case_o'::UUID)
  AND (SELECT bool_and(l.lifecycle_state = 'converted' AND l.source_key = 'admissions_direct')
      FROM platform.leads l WHERE l.id IN (:'p198_lead_p'::UUID, :'p198_lead_a'::UUID, :'p198_lead_x'::UUID, :'p198_lead_o'::UUID))
  AND (SELECT l.lifecycle_state = 'open' FROM platform.leads l WHERE l.id = :'p198_open_lead'::UUID),
  'C fixture: pending, active, closed and pending-with-an-open-lead cases; the direct leads are converted');

CREATE TEMP TABLE p198_before AS SELECT
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.p198_id(1) AND lifecycle_state = 'open') AS open_leads,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.p198_id(1)) AS leads,
  (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.p198_id(1)) AS clients,
  (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.p198_id(1)) AS cases,
  (SELECT l.interest_direction FROM platform.leads l WHERE l.id = :'p198_lead_p'::UUID) AS direction_p;
SELECT pg_temp.p198_assert((SELECT direction_p = 'CN' FROM p198_before), 'C fixture: the direct lead of case P has direction CN');

-- The site route passes digits only: the E.164 form, the national 0… form and the
-- 996… form of the same number; with and without attribution marks.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.p198_web(5301, 'P198 Web Pending', '+996555198001', 'Malaysia', 1, '{"referrer_host":"chatgpt.com"}'::JSONB) AS p198_w1 \gset
SELECT pg_temp.p198_web(5302, 'P198 Web Pending', '0555198001', 'Malaysia', 2) AS p198_w2 \gset
SELECT pg_temp.p198_web(5303, 'P198 Web Pending', '996555198001', 'Malaysia', 3) AS p198_w3 \gset
SELECT pg_temp.p198_web(5304, 'P198 Web Active', '+996555198002', 'Turkey', 4, '{"referrer_host":"chatgpt.com"}'::JSONB) AS p198_w4 \gset
SELECT pg_temp.p198_web(5305, 'P198 Web Open Lead', '+996555198004', 'Turkey', 5, '{"referrer_host":"chatgpt.com"}'::JSONB) AS p198_w5 \gset
SELECT pg_temp.p198_web(5306, 'P198 Web Closed', '+996555198003', 'Turkey', 6, '{"referrer_host":"chatgpt.com"}'::JSONB) AS p198_w6 \gset
RESET ROLE;
SELECT pg_temp.p198_assert(:'p198_w1' = 'accepted' AND :'p198_w2' = 'accepted' AND :'p198_w3' = 'accepted'
  AND :'p198_w4' = 'accepted' AND :'p198_w5' = 'accepted' AND :'p198_w6' = 'accepted', 'C: the website accepts all six enquiries');

-- C1: a pending direct case. The three spellings join the lead of the case: the
-- receipts stand on it, no sales lead appears, the client and the case are the
-- same, the lead of the case keeps its direction and its state.
SELECT pg_temp.p198_assert((SELECT array_agg(r.lead_id ORDER BY r.request_id) FROM platform_private.website_lead_receipts r
      WHERE r.request_id IN (pg_temp.p198_id(5301), pg_temp.p198_id(5302), pg_temp.p198_id(5303)))
    = ARRAY[:'p198_lead_p'::UUID, :'p198_lead_p'::UUID, :'p198_lead_p'::UUID]
  AND NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.client_id IN (:'p198_client_p'::UUID, :'p198_client_a'::UUID, :'p198_client_o'::UUID)
    AND l.source_key = 'website')
  AND (SELECT l.lifecycle_state = 'converted' AND l.interest_direction = 'CN' AND l.source_key = 'admissions_direct'
      FROM platform.leads l WHERE l.id = :'p198_lead_p'::UUID)
  AND (SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'p198_case_p'::UUID),
  'C1: enquiries on +996555198001 in three spellings join the lead of the pending direct case; no website lead, direction kept');
-- C2: an active direct case joins too.
SELECT pg_temp.p198_assert((SELECT r.lead_id = :'p198_lead_a'::UUID FROM platform_private.website_lead_receipts r
      WHERE r.request_id = pg_temp.p198_id(5304))
  AND (SELECT c.state = 'active' FROM platform.student_cases c WHERE c.id = :'p198_case_a'::UUID),
  'C2: an enquiry on the client of an active direct case joins the lead of that case');
-- C3: nothing else was created: the same number of leads, clients and cases,
-- except the one new lead below (the closed case).
SELECT pg_temp.p198_assert((SELECT (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.p198_id(1)) = b.clients
    AND (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.p198_id(1)) = b.cases
    AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.p198_id(1)) = b.leads + 1
    AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.p198_id(1) AND lifecycle_state = 'open') = b.open_leads + 1
  FROM p198_before b)
  AND NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.display_name LIKE 'P198 Web %'),
  'C3: the six enquiries created no client and no case, and exactly one lead (the closed case)');
-- C4: the attribution touch of a joined enquiry is a repeat on the lead of the case;
-- an enquiry without marks writes no touch.
SELECT pg_temp.p198_assert((SELECT t.lead_id = :'p198_lead_p'::UUID AND t.is_repeat AND t.touch_kind = 'website_form'
      FROM platform_private.lead_attribution_touches t WHERE t.request_id = pg_temp.p198_id(5301))
  AND (SELECT t.lead_id = :'p198_lead_a'::UUID AND t.is_repeat FROM platform_private.lead_attribution_touches t
      WHERE t.request_id = pg_temp.p198_id(5304))
  AND NOT EXISTS (SELECT 1 FROM platform_private.lead_attribution_touches t
      WHERE t.request_id IN (pg_temp.p198_id(5302), pg_temp.p198_id(5303))),
  'C4: the touch of a joined enquiry is a repeat on the lead of the case; no marks, no touch');
-- C5: one journal row per enquiry, on the lead of the case, carrying the case.
SELECT pg_temp.p198_assert((SELECT count(*) = 3 AND bool_and(e.resource_type = 'lead' AND e.resource_id = :'p198_lead_p'::UUID
      AND e.after_state ->> 'student_case_id' = :'p198_case_p' AND e.after_state ->> 'source_key' = 'website'
      AND e.actor_kind = 'service' AND e.actor_principal = 'evo-website'
      AND e.reason = 'Website inquiry received with consent; the person has a direct-admissions case in work, no sales lead opened')
    FROM platform.audit_events e WHERE e.action = 'lead.website.receive'
      AND e.request_id IN (pg_temp.p198_id(5301), pg_temp.p198_id(5302), pg_temp.p198_id(5303)))
  AND (SELECT e.resource_id = :'p198_lead_a'::UUID AND e.after_state ->> 'student_case_id' = :'p198_case_a'
    FROM platform.audit_events e WHERE e.action = 'lead.website.receive' AND e.request_id = pg_temp.p198_id(5304)),
  'C5: the journal row stands on the lead of the case and names the case');
-- C6: an open lead is still joined first, as before 303; the journal row is the plain one.
SELECT pg_temp.p198_assert((SELECT r.lead_id = :'p198_open_lead'::UUID FROM platform_private.website_lead_receipts r
      WHERE r.request_id = pg_temp.p198_id(5305))
  AND (SELECT t.lead_id = :'p198_open_lead'::UUID AND t.is_repeat FROM platform_private.lead_attribution_touches t
      WHERE t.request_id = pg_temp.p198_id(5305))
  AND (SELECT e.resource_id = :'p198_open_lead'::UUID AND NOT (e.after_state ? 'student_case_id')
      AND e.reason = 'Website inquiry received with consent'
    FROM platform.audit_events e WHERE e.action = 'lead.website.receive' AND e.request_id = pg_temp.p198_id(5305)),
  'C6: with an open lead on the client the enquiry joins that lead, not the case');
-- C7: a closed direct case changes nothing: the enquiry opens a new website lead
-- on the client, with its direction, a first (not repeat) touch and the plain journal row.
SELECT pg_temp.p198_assert((SELECT l.client_id = :'p198_client_x'::UUID AND l.lifecycle_state = 'open' AND l.source_key = 'website'
      AND l.interest_direction = 'TR' AND l.current_owner_membership_id = pg_temp.p198_id(302) AND l.id <> :'p198_lead_x'::UUID
    FROM platform_private.website_lead_receipts r JOIN platform.leads l ON l.id = r.lead_id WHERE r.request_id = pg_temp.p198_id(5306))
  AND (SELECT NOT t.is_repeat AND t.lead_id <> :'p198_lead_x'::UUID FROM platform_private.lead_attribution_touches t
      WHERE t.request_id = pg_temp.p198_id(5306))
  AND (SELECT NOT (e.after_state ? 'student_case_id') AND e.reason = 'Website inquiry received with consent'
    FROM platform.audit_events e WHERE e.action = 'lead.website.receive' AND e.request_id = pg_temp.p198_id(5306)),
  'C7: a closed direct case opens a new website lead as before');
-- C8: replay and conflict. The same request id with the same payload is accepted
-- and writes nothing; another payload under it is request_conflict.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.p198_web(5301, 'P198 Web Pending', '+996555198001', 'Malaysia', 1, '{"referrer_host":"chatgpt.com"}'::JSONB) AS p198_replay \gset
SELECT pg_temp.p198_web(5301, 'P198 Web Pending Other', '+996555198001', 'Malaysia', 9) AS p198_conflict \gset
RESET ROLE;
SELECT pg_temp.p198_assert(:'p198_replay' = 'accepted' AND :'p198_conflict' = 'request_conflict'
  AND (SELECT count(*) = 1 FROM platform_private.website_lead_receipts r WHERE r.request_id = pg_temp.p198_id(5301))
  AND (SELECT count(*) = 1 FROM platform_private.lead_attribution_touches t WHERE t.request_id = pg_temp.p198_id(5301))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'lead.website.receive' AND e.request_id = pg_temp.p198_id(5301))
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.p198_id(1)) = (SELECT leads + 1 FROM p198_before),
  'C8: a replay writes nothing; another body under the same request id is request_conflict');
-- C9: the direct cases and their leads are exactly as the Admin left them.
SELECT pg_temp.p198_assert((SELECT bool_and(l.lifecycle_state = 'converted' AND l.source_key = 'admissions_direct')
      FROM platform.leads l WHERE l.id IN (:'p198_lead_p'::UUID, :'p198_lead_a'::UUID, :'p198_lead_x'::UUID, :'p198_lead_o'::UUID))
  AND (SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'p198_case_p'::UUID)
  AND (SELECT c.state = 'active' FROM platform.student_cases c WHERE c.id = :'p198_case_a'::UUID)
  AND (SELECT c.state = 'closed' FROM platform.student_cases c WHERE c.id = :'p198_case_x'::UUID)
  AND (SELECT count(*) = 1 FROM platform.student_cases c WHERE c.canonical_client_id = :'p198_client_p'::UUID),
  'C9: the direct leads stay converted, each client keeps its one case');

-- ---------------------------------------------------------------------------
-- P. Posture and the refusals that did not change
-- ---------------------------------------------------------------------------
SELECT pg_temp.p198_assert(
  (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'receive_website_lead')
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE AND p.proname = 'person_phone_match_keys')
  AND has_function_privilege('service_role', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 'v'
    FROM pg_proc p WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure)
  AND (SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 'i'
    FROM pg_proc p WHERE p.oid = 'platform_private.person_phone_match_keys(text)'::regprocedure)
  AND (SELECT p.proowner FROM pg_proc p WHERE p.oid = 'platform_private.person_phone_match_keys(text)'::regprocedure)
    = (SELECT p.proowner FROM pg_proc p WHERE p.oid = 'platform_private.admissions_direct_phone_keys(text)'::regprocedure)
  AND NOT has_function_privilege('anon', 'platform_private.person_phone_match_keys(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.person_phone_match_keys(text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.person_phone_match_keys(text)', 'EXECUTE'),
  'P: one signature each, receive_website_lead service-only definer VOLATILE, the key function closed to every client role');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.p198_assert(pg_temp.p198_error(format('SELECT pg_temp.p198_web(5401, %L, %L, %L, 10)', 'P198 Web Bad Country', '+996555198099', 'Atlantis'))
  = '22023:website_intake_invalid', 'P: an unknown country is still refused 22023 website_intake_invalid');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p198_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p198_assert(pg_temp.p198_error(format('SELECT pg_temp.p198_web(5402, %L, %L, %L, 11)', 'P198 Web Forbidden', '+996555198098', 'China'))
  LIKE '42501:permission denied for function receive_website_lead', 'P: an authenticated caller still cannot execute the website receiver');
RESET ROLE;
SELECT pg_temp.p198_assert(NOT EXISTS (SELECT 1 FROM platform_private.website_lead_receipts r
    WHERE r.request_id IN (pg_temp.p198_id(5401), pg_temp.p198_id(5402)))
  AND NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.display_name IN ('P198 Web Bad Country', 'P198 Web Forbidden')),
  'P: the refused enquiries wrote nothing');

SELECT 'P198_PHONE_MATCH_FOLLOWUP_SUITE_PASSED' AS p198_suite_marker;
ROLLBACK;
