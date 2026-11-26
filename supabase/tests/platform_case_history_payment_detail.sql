\set ON_ERROR_STOP on
-- Boundary suite for migration 376 «История» дела называет записанный платёж суммой и названием. Runs on the real chain right
-- after 376 inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the case history read (the «История» tab and the «Лента» of the card) gives `payment_detail` to the administrator and to the
--     reader with finance.read.summary, on the payment and refund events only, with the amount, the currency, the kind and the
--     title of the obligation (a title with a control character or of more than 500 characters comes as null); the reader
--     without finance.read.summary gets no money row and no detail at all; another case's payment never shows; paging by two
--     gives the same events; the administrator of another organisation is refused;
--  2. the knowledge-base export (203, page «История дела») stays what it was before 376 (owner decision of 27.11.2026): it holds
--     the history events as they were, without `payment_detail` and without any amount or title of a payment, on one page of
--     100 events and on two; the page equals the history read with that one key removed (the oracle below);
--  3. posture: both functions keep SECURITY DEFINER and an empty search_path; the export stays closed to every API role, the
--     history read stays open to `authenticated` only; the two bodies carry the checked fragments exactly once.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

\echo A376_CASE_HISTORY_PAYMENT_DETAIL_SUITE_START

DO $r$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END $r$;

CREATE FUNCTION pg_temp.id(n BIGINT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('376e0000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(BIGINT) TO authenticated;

CREATE TEMP TABLE chk(label TEXT, ok BOOLEAN, detail TEXT);
GRANT SELECT, INSERT ON chk TO authenticated;
CREATE FUNCTION pg_temp.ok(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chk VALUES (p_label, COALESCE(p_ok, FALSE), p_detail);
  IF p_ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T376 CHECK FAILED: % (%)', p_label, p_detail; END IF;
END $$;

-- run a statement as another identity, answer its single text/jsonb value ('ERR sqlstate:message' on failure)
CREATE FUNCTION pg_temp.run_as(p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN OTHERS THEN answer := 'ERR ' || SQLSTATE || ':' || SQLERRM; END;
  RESET ROLE;
  RETURN answer;
END $$;

CREATE FUNCTION pg_temp.run_owner(p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN OTHERS THEN answer := 'ERR ' || SQLSTATE || ':' || SQLERRM; END;
  RETURN answer;
END $$;

-- ---------------------------------------------------------------- actors (modelled on supabase/tests/platform_permission_once.sql)
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.id(1), 'T376 Fictional organization'), (pg_temp.id(2), 'T376 Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (pg_temp.id(101), 't376-admin@example.invalid', '{}'), (pg_temp.id(102), 't376-fin@example.invalid', '{}'),
  (pg_temp.id(103), 't376-nofin@example.invalid', '{}'), (pg_temp.id(120), 't376-other-admin@example.invalid', '{}');
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.id(201), pg_temp.id(101), 'T376 Admin', 'active', 1), (pg_temp.id(202), pg_temp.id(102), 'T376 Finance reader', 'active', 1),
  (pg_temp.id(203), pg_temp.id(103), 'T376 Case reader', 'active', 1), (pg_temp.id(220), pg_temp.id(120), 'T376 Other admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id) VALUES
  (pg_temp.id(301), pg_temp.id(1), pg_temp.id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1)),
  (pg_temp.id(302), pg_temp.id(1), pg_temp.id(202), 'active', NULL, NULL),
  (pg_temp.id(303), pg_temp.id(1), pg_temp.id(203), 'active', NULL, NULL),
  (pg_temp.id(320), pg_temp.id(2), pg_temp.id(220), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.id(301), pg_temp.id(320));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.id(401), pg_temp.id(1), 'organization', pg_temp.id(1), 1), (pg_temp.id(402), pg_temp.id(2), 'organization', pg_temp.id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.id(1), pg_temp.id(301), pg_temp.id(401), 1, 1, TRUE, 'system', 'T376 scope', pg_temp.id(601)),
  (pg_temp.id(2), pg_temp.id(320), pg_temp.id(402), 1, 1, TRUE, 'system', 'T376 scope', pg_temp.id(602));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.id(101),
  'claims', jsonb_build_object('sub', pg_temp.id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS admin_claims \gset
SET LOCAL request.jwt.claims TO :'admin_claims';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE bundles(role_id UUID, bundle_id UUID);
GRANT SELECT, INSERT ON bundles TO authenticated;
DO $roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (pg_temp.id(1101), 'T376 Finance reader', '["case.read.full","case.read.summary","case.workflow.read","client.read","finance.read.summary"]'::JSONB, 1100),
    (pg_temp.id(1102), 'T376 Case reader',    '["case.read.full","case.read.summary","case.workflow.read","client.read"]'::JSONB, 1110)) AS t(role_id, label, keys, base)
  LOOP
    PERFORM platform.staff_role_command(pg_temp.id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', r.label, 'description', 'T376 synthetic role', 'permissionKeys', r.keys), 'T376 create role', pg_temp.id(r.base + 1));
    published := platform.staff_role_publish(pg_temp.id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.id(1), r.role_id, 1) ->> 'impactFingerprint', 'T376 publish role', pg_temp.id(r.base + 2));
    INSERT INTO bundles VALUES (r.role_id, (published ->> 'bundleId')::UUID);
  END LOOP;
END $roles$;
DO $assign$
DECLARE m BIGINT; r UUID;
BEGIN
  FOR m, r IN SELECT * FROM (VALUES (302::BIGINT, pg_temp.id(1101)), (303::BIGINT, pg_temp.id(1102))) AS t(m, r) LOOP
    PERFORM platform.staff_role_assignments_save(pg_temp.id(1), pg_temp.id(m),
      (SELECT p.access_version FROM platform.profiles p JOIN platform.organization_memberships mm ON mm.profile_id = p.id WHERE mm.id = pg_temp.id(m)),
      jsonb_build_array(jsonb_build_object('roleId', r, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.id(1), 'resourceKind', NULL))),
      jsonb_build_array(jsonb_build_object('roleId', r, 'roleVersion', 2, 'bundleId', (SELECT b.bundle_id FROM bundles b WHERE b.role_id = r), 'bundleVersion', 1)),
      'T376 grant', pg_temp.id(2000 + m));
  END LOOP;
END $assign$;
RESET ROLE;

CREATE TEMP TABLE claims AS
SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.id(100 + n),
  'claims', jsonb_build_object('sub', pg_temp.id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT AS c
FROM generate_series(1, 3) AS n;
INSERT INTO claims SELECT 20, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.id(120),
  'claims', jsonb_build_object('sub', pg_temp.id(120), 'role', 'authenticated'))) -> 'claims')::TEXT;
GRANT SELECT ON claims TO authenticated;
-- 1 = system admin, 2 = case reader WITH finance.read.summary, 3 = case reader WITHOUT it, 20 = admin of another organization

-- ---------------------------------------------------------------- data (replica: skips business triggers, keeps CHECKs and FKs)
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id, source_key, student_display_name, target_country, target_degree, state,
  handoff_at, current_scope_id, current_scope_version, created_at, updated_at) VALUES
  (pg_temp.id(4001), pg_temp.id(1), pg_temp.id(302), pg_temp.id(302), 't376:case:1', 'T376 Student One', 'China', 'Bachelor', 'active', TIMESTAMPTZ '2026-09-15 00:00:00+00', pg_temp.id(401), 1, TIMESTAMPTZ '2026-09-02 00:00:00+00', TIMESTAMPTZ '2026-10-02 00:00:00+00'),
  (pg_temp.id(4002), pg_temp.id(1), pg_temp.id(302), pg_temp.id(302), 't376:case:2', 'T376 Student Two', 'China', 'Bachelor', 'active', TIMESTAMPTZ '2026-09-15 00:00:00+00', pg_temp.id(401), 1, TIMESTAMPTZ '2026-09-02 00:00:00+00', TIMESTAMPTZ '2026-10-02 00:00:00+00');
-- obligations of case 1: 1 normal label, 2 label with a control character, 3 label longer than 500, 4 label of exactly 500, 5 other currency, 6 Cyrillic
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, created_by_membership_id) VALUES
  (pg_temp.id(9501), pg_temp.id(1), pg_temp.id(4001), 'Первый платёж', 'evo_service_fee', 100000, 'USD', pg_temp.id(301)),
  (pg_temp.id(9502), pg_temp.id(1), pg_temp.id(4001), E'Bad' || chr(10) || 'label', 'evo_service_fee', 100000, 'USD', pg_temp.id(301)),
  (pg_temp.id(9503), pg_temp.id(1), pg_temp.id(4001), repeat('x', 501), 'evo_service_fee', 100000, 'USD', pg_temp.id(301)),
  (pg_temp.id(9504), pg_temp.id(1), pg_temp.id(4001), repeat('y', 500), 'evo_service_fee', 100000, 'USD', pg_temp.id(301)),
  (pg_temp.id(9505), pg_temp.id(1), pg_temp.id(4001), 'Второй платёж', 'third_party_cost', 900000000000, 'EUR', pg_temp.id(301)),
  (pg_temp.id(9506), pg_temp.id(1), pg_temp.id(4001), E'Tab' || chr(9) || 'label', 'evo_service_fee', 100000, 'KGS', pg_temp.id(301)),
  -- another case and another organization: their payments must never appear on case 1
  (pg_temp.id(9511), pg_temp.id(1), pg_temp.id(4002), 'Чужое дело', 'evo_service_fee', 100000, 'USD', pg_temp.id(301));
-- payments / refunds of case 1
INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, referenced_payment_event_id, amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id, created_at) VALUES
  (pg_temp.id(9601), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9501), 'payment', NULL, 50000, 'USD', TIMESTAMPTZ '2026-10-10 10:00:00+00', 't376:p1', pg_temp.id(301), pg_temp.id(9701), TIMESTAMPTZ '2026-10-10 10:00:00+00'),
  (pg_temp.id(9602), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9501), 'refund', pg_temp.id(9601), 12050, 'USD', TIMESTAMPTZ '2026-10-11 10:00:00+00', 't376:p2', pg_temp.id(301), pg_temp.id(9702), TIMESTAMPTZ '2026-10-11 10:00:00+00'),
  (pg_temp.id(9603), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9502), 'payment', NULL, 10000, 'USD', TIMESTAMPTZ '2026-10-12 10:00:00+00', 't376:p3', pg_temp.id(301), pg_temp.id(9703), TIMESTAMPTZ '2026-10-12 10:00:00+00'),
  (pg_temp.id(9604), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9503), 'payment', NULL, 10000, 'USD', TIMESTAMPTZ '2026-10-13 10:00:00+00', 't376:p4', pg_temp.id(301), pg_temp.id(9704), TIMESTAMPTZ '2026-10-13 10:00:00+00'),
  (pg_temp.id(9605), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9504), 'payment', NULL, 10000, 'USD', TIMESTAMPTZ '2026-10-14 10:00:00+00', 't376:p5', pg_temp.id(301), pg_temp.id(9705), TIMESTAMPTZ '2026-10-14 10:00:00+00'),
  (pg_temp.id(9606), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9505), 'payment', NULL, 250000, 'EUR', TIMESTAMPTZ '2026-10-15 10:00:00+00', 't376:p6', pg_temp.id(301), pg_temp.id(9706), TIMESTAMPTZ '2026-10-15 10:00:00+00'),
  (pg_temp.id(9607), pg_temp.id(1), pg_temp.id(4001), pg_temp.id(9506), 'payment', NULL, 7, 'KGS', TIMESTAMPTZ '2026-10-16 10:00:00+00', 't376:p7', pg_temp.id(301), pg_temp.id(9707), TIMESTAMPTZ '2026-10-16 10:00:00+00'),
  (pg_temp.id(9611), pg_temp.id(1), pg_temp.id(4002), pg_temp.id(9511), 'payment', NULL, 99999, 'USD', TIMESTAMPTZ '2026-10-17 10:00:00+00', 't376:p8', pg_temp.id(301), pg_temp.id(9711), TIMESTAMPTZ '2026-10-17 10:00:00+00');
-- the audit rows (one per obligation / payment), plus a payment audit row pointing at case 2's payment but written "for" case 1 (must not show)
INSERT INTO platform.audit_events(id, organization_id, actor_kind, actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
SELECT pg_temp.id(9800 + n), pg_temp.id(1), 'system', 't376:fixture', a.action, a.rtype, a.rid, NULL, '{}'::JSONB, 'T376 fixture', pg_temp.id(9900 + n), a.at
FROM (VALUES
  (1,  'finance.obligation.create', 'payment_obligation', pg_temp.id(9501), TIMESTAMPTZ '2026-10-09 09:00:00+00'),
  (2,  'finance.payment.record', 'payment_event', pg_temp.id(9601), TIMESTAMPTZ '2026-10-10 10:00:01+00'),
  (3,  'finance.payment.record', 'payment_event', pg_temp.id(9602), TIMESTAMPTZ '2026-10-11 10:00:01+00'),
  (4,  'finance.payment.record', 'payment_event', pg_temp.id(9603), TIMESTAMPTZ '2026-10-12 10:00:01+00'),
  (5,  'finance.payment.record', 'payment_event', pg_temp.id(9604), TIMESTAMPTZ '2026-10-13 10:00:01+00'),
  (6,  'finance.payment.record', 'payment_event', pg_temp.id(9605), TIMESTAMPTZ '2026-10-14 10:00:01+00'),
  (7,  'finance.payment.record', 'payment_event', pg_temp.id(9606), TIMESTAMPTZ '2026-10-15 10:00:01+00'),
  (8,  'finance.payment.record', 'payment_event', pg_temp.id(9607), TIMESTAMPTZ '2026-10-16 10:00:01+00'),
  (9,  'finance.payment.record', 'payment_event', pg_temp.id(9611), TIMESTAMPTZ '2026-10-17 10:00:01+00'),   -- case 2's payment: not case 1's
  (10, 'case.create', 'student_case', pg_temp.id(4001), TIMESTAMPTZ '2026-10-01 00:00:00+00')
) AS a(n, action, rtype, rid, at);

-- extra cases of PR #1601 fix: case 3 = 130 payments (the export walks the history in pages of 100: two pages); case 4 = no events at all
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id, source_key, student_display_name, target_country, target_degree, state,
  handoff_at, current_scope_id, current_scope_version, created_at, updated_at) VALUES
  (pg_temp.id(4003), pg_temp.id(1), pg_temp.id(302), pg_temp.id(302), 't376:case:3', 'T376 Student Three', 'China', 'Bachelor', 'active', TIMESTAMPTZ '2026-09-15 00:00:00+00', pg_temp.id(401), 1, TIMESTAMPTZ '2026-09-02 00:00:00+00', TIMESTAMPTZ '2026-10-02 00:00:00+00'),
  (pg_temp.id(4004), pg_temp.id(1), pg_temp.id(302), pg_temp.id(302), 't376:case:4', 'T376 Student Four', 'China', 'Bachelor', 'active', TIMESTAMPTZ '2026-09-15 00:00:00+00', pg_temp.id(401), 1, TIMESTAMPTZ '2026-09-02 00:00:00+00', TIMESTAMPTZ '2026-10-02 00:00:00+00');
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, created_by_membership_id) VALUES
  (pg_temp.id(9521), pg_temp.id(1), pg_temp.id(4003), 'Рассрочка', 'evo_service_fee', 100000000, 'USD', pg_temp.id(301));
INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, referenced_payment_event_id, amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id, created_at)
SELECT pg_temp.id(20000 + n), pg_temp.id(1), pg_temp.id(4003), pg_temp.id(9521), 'payment', NULL, 1000 + n, 'USD',
  TIMESTAMPTZ '2026-10-20 10:00:00+00' + n * INTERVAL '1 minute', 't376:bulk:' || n, pg_temp.id(301), pg_temp.id(30000 + n), TIMESTAMPTZ '2026-10-20 10:00:00+00' + n * INTERVAL '1 minute'
FROM generate_series(1, 130) AS n;
INSERT INTO platform.audit_events(id, organization_id, actor_kind, actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
SELECT pg_temp.id(40000 + n), pg_temp.id(1), 'system', 't376:fixture', 'finance.payment.record', 'payment_event', pg_temp.id(20000 + n), NULL, '{}'::JSONB, 'T376 fixture', pg_temp.id(50000 + n),
  TIMESTAMPTZ '2026-10-20 10:00:01+00' + n * INTERVAL '1 minute'
FROM generate_series(1, 130) AS n;

SET LOCAL session_replication_role = origin;


-- ---------------------------------------------------------------- 1. the history read (now carrying payment_detail)
CREATE TEMP TABLE after_read AS
SELECT n, pg_temp.run_as(c, format('SELECT platform.staff_student_case_activity(%L::uuid, 100)::text', pg_temp.id(4001)))::JSONB AS r FROM claims WHERE n IN (1, 2, 3);
GRANT SELECT ON after_read TO authenticated;

-- 2. who gets the field
SELECT pg_temp.ok('after 376: every payment/refund event of admin and of the finance reader has a payment_detail object; nothing else has the key',
  (SELECT count(*) FROM after_read a, jsonb_array_elements(a.r -> 'events') e WHERE a.n IN (1, 2) AND e ->> 'action' = 'finance.payment.record' AND jsonb_typeof(e -> 'payment_detail') = 'object') = 14
  AND (SELECT count(*) FROM after_read a, jsonb_array_elements(a.r -> 'events') e WHERE e ? 'payment_detail' AND e ->> 'action' <> 'finance.payment.record') = 0
  AND (SELECT count(*) FROM after_read a, jsonb_array_elements(a.r -> 'events') e WHERE e ? 'payment_detail' AND e ->> 'target_kind' <> 'money') = 0);
SELECT pg_temp.ok('after 376: the reader WITHOUT finance.read.summary gets no money row and no payment_detail anywhere (amounts do not leak)',
  (SELECT count(*) FROM after_read a, jsonb_array_elements(a.r -> 'events') e WHERE a.n = 3 AND (e ->> 'target_kind' = 'money' OR e ? 'payment_detail')) = 0
  AND position('amount_minor' IN (SELECT r::text FROM after_read WHERE n = 3)) = 0
  AND position('Первый платёж' IN (SELECT r::text FROM after_read WHERE n = 3)) = 0);
-- 3. values
CREATE TEMP TABLE detail AS
SELECT (e ->> 'id')::UUID AS audit_id, e -> 'payment_detail' AS d, e ->> 'occurred_at' AS at
FROM after_read a, jsonb_array_elements(a.r -> 'events') e WHERE a.n = 1 AND e ->> 'action' = 'finance.payment.record';
SELECT 'DETAIL ' || at || ' ' || d::text AS line FROM detail ORDER BY at;
SELECT pg_temp.ok('payment: amount 50000 USD, kind payment, label «Первый платёж»',
  (SELECT d FROM detail WHERE audit_id = pg_temp.id(9802)) = '{"kind":"payment","label":"Первый платёж","currency":"USD","amount_minor":50000}'::JSONB);
SELECT pg_temp.ok('refund: amount 12050 (positive), kind refund, label of the obligation of the refunded payment',
  (SELECT d FROM detail WHERE audit_id = pg_temp.id(9803)) = '{"kind":"refund","label":"Первый платёж","currency":"USD","amount_minor":12050}'::JSONB);
SELECT pg_temp.ok('label with a newline -> null (text check of the Оплата block)', (SELECT d -> 'label' FROM detail WHERE audit_id = pg_temp.id(9804)) = 'null'::JSONB);
SELECT pg_temp.ok('label of 501 characters -> null', (SELECT d -> 'label' FROM detail WHERE audit_id = pg_temp.id(9805)) = 'null'::JSONB);
SELECT pg_temp.ok('label of exactly 500 characters -> kept', (SELECT length(d ->> 'label') FROM detail WHERE audit_id = pg_temp.id(9806)) = 500);
SELECT pg_temp.ok('second currency EUR, label «Второй платёж»', (SELECT d FROM detail WHERE audit_id = pg_temp.id(9807)) = '{"kind":"payment","label":"Второй платёж","currency":"EUR","amount_minor":250000}'::JSONB);
SELECT pg_temp.ok('label with a TAB -> null; smallest amount 7 minor units KGS kept', (SELECT d FROM detail WHERE audit_id = pg_temp.id(9808)) = '{"kind":"payment","label":null,"currency":"KGS","amount_minor":7}'::JSONB);
SELECT pg_temp.ok('case 2 payment is not shown on case 1 (no detail row for audit 9809)', NOT EXISTS (SELECT 1 FROM detail WHERE audit_id = pg_temp.id(9809)));
SELECT pg_temp.ok('amount_minor is a JSON number, not a string',
  (SELECT bool_and(jsonb_typeof(d -> 'amount_minor') = 'number') FROM detail));

-- 4. paging: limit 2 pages through the 7 payment rows, each page carries its payment_detail, cursor chain unchanged
CREATE TEMP TABLE paged(page INTEGER, r JSONB);
DO $paging$
DECLARE cur_at TIMESTAMPTZ; cur_id UUID; res JSONB; i INTEGER := 0; claims_text TEXT;
BEGIN
  SELECT c INTO claims_text FROM claims WHERE n = 1;
  LOOP
    i := i + 1;
    res := pg_temp.run_as(claims_text, format('SELECT platform.staff_student_case_activity(%L::uuid, 2, %L::timestamptz, %L::uuid)::text', pg_temp.id(4001), cur_at, cur_id))::JSONB;
    INSERT INTO paged VALUES (i, res);
    EXIT WHEN res -> 'next_cursor' = 'null'::JSONB OR i > 20;
    cur_at := (res -> 'next_cursor' ->> 'at')::TIMESTAMPTZ; cur_id := (res -> 'next_cursor' ->> 'id')::UUID;
  END LOOP;
END $paging$;
SELECT pg_temp.ok('paging by 2: the pages together hold the same events (with payment_detail) as one page of 100',
  (SELECT jsonb_agg(e ORDER BY p.page, ord) FROM paged p, jsonb_array_elements(p.r -> 'events') WITH ORDINALITY AS t(e, ord))
  = (SELECT r -> 'events' FROM after_read WHERE n = 1), (SELECT count(*)::TEXT FROM paged) || ' pages');

-- 5. another organization's admin cannot read the case at all
SELECT pg_temp.ok('admin of another organization is refused (42501), nothing returned',
  pg_temp.run_as((SELECT c FROM claims WHERE n = 20), format('SELECT platform.staff_student_case_activity(%L::uuid, 100)::text', pg_temp.id(4001))) LIKE 'ERR 42501:%');


-- ---------------------------------------------------------------- 2. the knowledge-base export keeps its text
-- the whole output of the export function as one text (as the system administrator, owner session)
CREATE FUNCTION pg_temp.kb_text(p_options TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', (SELECT c FROM claims WHERE n = 1), TRUE);
  SELECT coalesce(string_agg(s::text, E'\n' ORDER BY s ->> 'id', s::text), '') INTO answer
  FROM platform_private.kb_canonical_snapshots(pg_temp.id(1), p_options::JSONB) AS s;
  RETURN answer;
END $$;
-- the body of the page «История дела» of one case, exactly as exported
CREATE FUNCTION pg_temp.kb_history(p_case UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', (SELECT c FROM claims WHERE n = 1), TRUE);
  SELECT string_agg(s ->> 'body', E'\n---\n') INTO answer
  FROM platform_private.kb_canonical_snapshots(pg_temp.id(1), jsonb_build_object('caseIds', jsonb_build_array(p_case))) AS s
  WHERE s ->> 'title' = 'История дела';
  RETURN answer;
END $$;
-- the oracle: the page as 203 builds it (events as the history read gives them, pages of 100), but with the one key removed
CREATE FUNCTION pg_temp.expected_history(p_case UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE page_text TEXT := E'# История дела\n'; page JSONB; cur JSONB := NULL; prev JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', (SELECT c FROM claims WHERE n = 1), TRUE);
  LOOP
    page := platform.staff_student_case_activity(p_case, 100, (cur ->> 'at')::TIMESTAMPTZ, (cur ->> 'id')::UUID);
    page_text := page_text || E'\n```json\n' || jsonb_pretty(coalesce((SELECT jsonb_agg(e - 'payment_detail' ORDER BY ord)
      FROM jsonb_array_elements(page -> 'events') WITH ORDINALITY AS t(e, ord)), '[]'::JSONB)) || E'\n```\n';
    prev := cur; cur := page -> 'next_cursor';
    EXIT WHEN cur IS NULL OR cur = 'null'::JSONB;
    IF cur = prev THEN RAISE EXCEPTION 'expected_history: the cursor does not move'; END IF;
  END LOOP;
  RETURN page_text;
END $$;
CREATE FUNCTION pg_temp.occurs(p_text TEXT, p_token TEXT) RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT ((length(p_text) - length(replace(p_text, p_token, ''))) / length(p_token))::INTEGER $$;

CREATE TEMP TABLE kbsave AS
SELECT 'all'::TEXT AS label, pg_temp.kb_text('{}') AS txt
UNION ALL SELECT 'h1', pg_temp.kb_history(pg_temp.id(4001))
UNION ALL SELECT 'h3', pg_temp.kb_history(pg_temp.id(4003))
UNION ALL SELECT 'h4', pg_temp.kb_history(pg_temp.id(4004));
SELECT pg_temp.run_as((SELECT c FROM claims WHERE n = 1), format('SELECT platform.staff_student_case_activity(%L::uuid, 100)::text', pg_temp.id(4001))) AS read_c1 \gset
SELECT pg_temp.ok('the history read itself carries payment_detail on the 7 payments of case 1 (so there is something to keep out of the export)',
  (SELECT count(*) FROM jsonb_array_elements((:'read_c1'::JSONB) -> 'events') e WHERE e ? 'payment_detail') = 7);
SELECT pg_temp.ok('EXPORT: the page «История дела» equals the history read with only payment_detail removed (case 1: payments and refund; case 3: 130 payments on two pages; case 4: no events)',
  (SELECT txt FROM kbsave WHERE label = 'h1') = pg_temp.expected_history(pg_temp.id(4001))
  AND (SELECT txt FROM kbsave WHERE label = 'h3') = pg_temp.expected_history(pg_temp.id(4003))
  AND (SELECT txt FROM kbsave WHERE label = 'h4') = pg_temp.expected_history(pg_temp.id(4004))
  AND (SELECT txt FROM kbsave WHERE label = 'h4') = E'# История дела\n\n```json\n[\n]\n```\n');
SELECT pg_temp.ok('EXPORT still lists the payments themselves: 7 on case 1, 130 on case 3 over two pages',
  pg_temp.occurs((SELECT txt FROM kbsave WHERE label = 'h1'), 'finance.payment.record') = 7
  AND pg_temp.occurs((SELECT txt FROM kbsave WHERE label = 'h3'), 'finance.payment.record') = 130
  AND pg_temp.occurs((SELECT txt FROM kbsave WHERE label = 'h3'), '```json') = 2);
SELECT pg_temp.ok('EXPORT of the whole organisation carries no payment detail: no payment_detail, amount_minor, currency, label, no title of a payment',
  (SELECT bool_and(position(token IN txt) = 0)
   FROM kbsave, unnest(ARRAY['payment_detail', 'amount_minor', '"currency"', '"label"', 'Первый платёж', 'Второй платёж', 'Рассрочка']) AS token
   WHERE label IN ('all', 'h1', 'h3')));
-- the app's own entry point (platform.kb_export_v1) as the system administrator
SELECT pg_temp.run_as((SELECT c FROM claims WHERE n = 1), format($q$SELECT platform.kb_export_v1(%L::uuid, 'start', %L::uuid, %L)::text$q$,
  pg_temp.id(1), pg_temp.id(70001), format('{"caseIds":["%s","%s"]}', pg_temp.id(4001), pg_temp.id(4003)))) AS job \gset
SELECT pg_temp.ok('kb_export_v1 start answered with a job, not an error', :'job' NOT LIKE 'ERR %', left(:'job', 120));
SELECT pg_temp.ok('EXPORT through kb_export_v1: both history pages are in the job, and nothing of the payment detail',
  (SELECT count(*) FROM platform_private.kb_export_entries e JOIN platform_private.kb_exports j ON j.id = e.job_id
     WHERE j.request_id = pg_temp.id(70001) AND e.snapshot ->> 'title' = 'История дела') = 2
  AND NOT EXISTS (SELECT 1 FROM platform_private.kb_export_entries e JOIN platform_private.kb_exports j ON j.id = e.job_id
     WHERE j.request_id = pg_temp.id(70001) AND (position('payment_detail' IN e.snapshot::TEXT) > 0 OR position('amount_minor' IN e.snapshot::TEXT) > 0)));

-- ---------------------------------------------------------------- 3. posture and the checked fragments
SELECT pg_temp.ok('the export function: SECURITY DEFINER, empty search_path, closed to PUBLIC and every API role',
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.oid = 'platform_private.kb_canonical_snapshots(uuid,jsonb)'::regprocedure));
SELECT pg_temp.ok('the history read: SECURITY DEFINER, empty search_path, open to authenticated only',
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.oid = 'private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure));
SELECT pg_temp.ok('the bodies carry the checked fragments exactly once: the export strips the key and no longer calls jsonb_pretty on the raw events; the history read adds the key',
  pg_temp.occurs(pg_get_functiondef('platform_private.kb_canonical_snapshots(uuid,jsonb)'::regprocedure), '- ''payment_detail''') = 1
  AND pg_temp.occurs(pg_get_functiondef('platform_private.kb_canonical_snapshots(uuid,jsonb)'::regprocedure), 'jsonb_pretty(page->''events'')') = 0
  AND pg_temp.occurs(pg_get_functiondef('private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure), '''payment_detail''') = 1);

\echo A376_CASE_HISTORY_PAYMENT_DETAIL_SUITE_PASSED

ROLLBACK;
