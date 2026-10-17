\set ON_ERROR_STOP on
-- Boundary suite for the «Отчёт продаж» row import (platform.import_sales_report_row_v1,
-- migration 299). WRITTEN, NOT RUN: the owner decided on 17.10.2026 to build every task
-- first and to test, review, merge and release them in one pass afterwards.
-- Members are modelled like the 287 suite: invited staff have coarse role NULL, the Admin
-- is a system Admin of its organization. Proves:
--  1. the service-only boundary: authenticated and anon cannot execute it, a service role
--     carrying a user identity (a sub, or an authenticated / anon role claim) is refused,
--     and so is every actor who is not the Admin of THIS organization (a Sales member,
--     invited staff, a Student, an unknown membership, a foreign Admin);
--  2. the strict payload: every wrong key, mode, shape and value is refused by name and a
--     refused call writes nothing (the state fingerprint is unchanged);
--  3. insert: the row (import kind, version 1, no owner, snapshot, fingerprint), the answer,
--     the journal, the receipt; a replay is the same answer with replayed = true and writes
--     nothing; the same key with another body is PT409; the same row again with the same
--     source is `unchanged`, with another source `sales_report_import_conflict`; another
--     actor under the same key is PT409;
--  4. refresh: an untouched row is brought up to a new source (version, before_state in the
--     receipt, journal with field names only), again and again while only this import has
--     written it; the same source is `unchanged`; an archived row, a row with an owner, a row
--     with a hand edit and a missing row are refused and nothing changes; a row laid down by
--     134's own import (version 1, no receipt) is accepted;
--  5. link_lead: the link by 254's rules (version, journal), the same lead again is
--     `unchanged`, another lead on the row, a lead tied to another row, a lead with a
--     pipeline sale (conflict), a foreign or unknown lead, an archived row and a missing row
--     are refused and the whole call is rolled back (a row sent in the same call is not
--     inserted); link_only leaves the row's fields alone; a refresh still works after a link
--     this import made;
--  6. create_lead: client and lead created (E.164 phone, normalized e-mail, interest
--     direction, `converted`, no owner, source `sales_report`, external identifiers and
--     provenance `imported`, the row tied to the new lead), the note kept in the receipt, the
--     lead outside the marketing cohort; a person who already has a lead (by any spelling of
--     the phone, or by e-mail) is `lead_exists`, one who has a case is `case_exists`, and
--     nothing is created; an already tied or archived row refuses; a name-only person; a
--     client with the number in another spelling becomes a phone duplicate candidate;
--  7. the journal: only the service principal, the Admin's profile and membership, request
--     ids derived from the receipt key, existing allowlisted actions, and no name, phone,
--     e-mail, note or field value in any row;
--  8. two organizations are isolated; 9. the posture of the new objects and the receipts.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.sri_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('5a1e0000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.sri_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SRI: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.sri_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- A row of the report as the loader sends it. p_sha is one hex digit (repeated 64 times).
CREATE FUNCTION pg_temp.sri_row(p_key TEXT, p_sha TEXT DEFAULT 'a', p_mode TEXT DEFAULT 'insert',
  p_name TEXT DEFAULT 'SRI Applicant', p_paid BIGINT DEFAULT 100000) RETURNS JSONB
LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', p_mode, 'source_key', p_key, 'source_sheet', 'SRI Sheet', 'source_row', 7,
    'source_sha256', repeat(p_sha, 64), 'report_month', '2026-09-01',
    'source_snapshot', jsonb_build_object('applicant_name', p_name, 'phone', '0555 299 001', 'status_raw', 'Оплачено',
      'review_flags', '[]'::JSONB, 'signing_date_raw', '2026-09-15', 'signing_date_type', 'date',
      'service_cost_raw', '1000 $', 'paid_raw', '1000 $', 'status_column_present', TRUE,
      'source_period_year_inferred', FALSE),
    'fields', jsonb_build_object('signing_date', '2026-09-15', 'applicant_name', p_name, 'phone', '0555 299 001',
      'country', 'Китай', 'university', 'SRI University', 'program', 'SRI Program', 'direction', 'CN',
      'intake', '2027', 'contract_number', 'SRI-1', 'manager_label', 'SRI Manager', 'status_raw', 'Оплачено',
      'service_cost_raw', '1000 $', 'service_cost_minor', 100000, 'service_cost_currency', 'USD',
      'paid_raw', '1000 $', 'paid_minor', p_paid, 'paid_currency', 'USD', 'needs_review', FALSE, 'notes', NULL))
$$;
CREATE FUNCTION pg_temp.sri_pay(p_row JSONB, p_person JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('row', p_row) || CASE WHEN p_person IS NULL THEN '{}'::JSONB ELSE jsonb_build_object('person', p_person) END
$$;
CREATE FUNCTION pg_temp.sri_link(p_lead UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', 'link_lead', 'lead_id', p_lead::TEXT)
$$;
CREATE FUNCTION pg_temp.sri_create(p_name TEXT, p_phone TEXT, p_email TEXT DEFAULT NULL,
  p_direction TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', 'create_lead',
    'client', jsonb_strip_nulls(jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email)),
    'interest_direction', p_direction, 'note', p_note)
$$;
-- The call as the service path makes it: actor n (default the Admin, 301), organization 1.
CREATE FUNCTION pg_temp.sri_call(p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1) RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT platform.import_sales_report_row_v1(pg_temp.sri_id(p_org), pg_temp.sri_id(p_actor), 'sri-report', p_ref,
    p_payload, 'SRI синтетический перенос отчёта')
$$;
CREATE FUNCTION pg_temp.sri_try(p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1) RETURNS TEXT
LANGUAGE SQL AS $$
  SELECT pg_temp.sri_error(format('SELECT pg_temp.sri_call(%L, %L::JSONB, %s, %s)', p_ref, p_payload::TEXT, p_actor, p_org))
$$;
-- The request ids of one call: the base from the receipt key, and the event's suffix.
CREATE FUNCTION pg_temp.sri_base(p_ref TEXT, p_org INTEGER DEFAULT 1) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:sales-report-import:' || pg_temp.sri_id(p_org)::TEXT || ':sri-report:' || p_ref)
$$;
CREATE FUNCTION pg_temp.sri_op(p_ref TEXT, p_op TEXT, p_org INTEGER DEFAULT 1) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5(pg_temp.sri_base(p_ref, p_org), 'sales-report-import:' || p_op)
$$;
-- A fingerprint of everything the import may write; read as the test owner only.
CREATE FUNCTION pg_temp.sri_state() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT concat_ws('/',
    (SELECT count(*) FROM platform_private.sales_register),
    (SELECT md5(COALESCE(string_agg(r.id::TEXT || r.version::TEXT || r.fields::TEXT || COALESCE(r.linked_lead_id::TEXT, '')
      || r.archived::TEXT || COALESCE(r.source_sha256, ''), '|' ORDER BY r.id), '')) FROM platform_private.sales_register r),
    (SELECT count(*) FROM platform_private.sales_report_import_receipts),
    (SELECT count(*) FROM platform.clients),
    (SELECT count(*) FROM platform.leads),
    (SELECT count(*) FROM platform.audit_events WHERE actor_principal = 'service:sales-report-import'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sri_id(INTEGER), pg_temp.sri_assert(BOOLEAN, TEXT), pg_temp.sri_error(TEXT),
  pg_temp.sri_row(TEXT, TEXT, TEXT, TEXT, BIGINT), pg_temp.sri_pay(JSONB, JSONB), pg_temp.sri_link(UUID),
  pg_temp.sri_create(TEXT, TEXT, TEXT, TEXT, TEXT),
  pg_temp.sri_call(TEXT, JSONB, INTEGER, INTEGER), pg_temp.sri_try(TEXT, JSONB, INTEGER, INTEGER),
  pg_temp.sri_base(TEXT, INTEGER), pg_temp.sri_op(TEXT, TEXT, INTEGER)
  TO authenticated, anon, service_role;

SELECT 'SRI_SALES_REPORT_IMPORT_SUITE_START' AS sri_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with 1 and 5 (system Admins), 2 (a Sales member),
-- 3 (invited staff without roles), 4 (a Student); organization 2 with its own
-- Admin (310).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE sri_actors(n INTEGER, coarse platform.business_role);
INSERT INTO sri_actors(n, coarse) VALUES (1, 'admin'), (2, 'sales'), (3, NULL), (4, 'student'), (5, 'admin');
GRANT SELECT ON sri_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.sri_id(1), 'SRI Fictional organization'), (pg_temp.sri_id(2), 'SRI Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.sri_id(100 + n), 'sri-' || n || '@example.invalid', '{}'::JSONB FROM sri_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.sri_id(200 + n), pg_temp.sri_id(100 + n), 'SRI Actor ' || n, 'active', 1 FROM sri_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.sri_id(300 + n), pg_temp.sri_id(1), pg_temp.sri_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM sri_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.sri_id(301), pg_temp.sri_id(305));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.sri_id(401), pg_temp.sri_id(1), 'organization', pg_temp.sri_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.sri_id(1), pg_temp.sri_id(301), pg_temp.sri_id(401), 1, 1, TRUE, 'system',
    'SRI synthetic organization scope', pg_temp.sri_id(601));
-- The second organization and its Admin.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.sri_id(110), 'sri-org2-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.sri_id(210), pg_temp.sri_id(110), 'SRI Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.sri_id(310), pg_temp.sri_id(2), pg_temp.sri_id(210), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.sri_id(310);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.sri_id(402), pg_temp.sri_id(2), 'organization', pg_temp.sri_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.sri_id(2), pg_temp.sri_id(310), pg_temp.sri_id(402), 1, 1, TRUE, 'system',
    'SRI synthetic organization scope', pg_temp.sri_id(602));

SELECT pg_temp.sri_assert(platform_private.staff_has_permission(pg_temp.sri_id(1), pg_temp.sri_id(301), 'sales.register.import')
  AND platform_private.staff_has_permission(pg_temp.sri_id(1), pg_temp.sri_id(305), 'sales.register.import')
  AND platform_private.staff_has_permission(pg_temp.sri_id(2), pg_temp.sri_id(310), 'sales.register.import')
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.sri_id(1), pg_temp.sri_id(301))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.sri_id(1), pg_temp.sri_id(302))) = 'staff',
  'fixture: the system Admins hold sales.register.import, the Sales member is staff');

-- Existing people: leads of the CRM (sales source), a pipeline sale, a foreign lead.
SELECT platform_private.create_or_link_client(pg_temp.sri_id(1), 'SRI Existing One', 'sri-one@example.invalid',
  '+996 555 299 701', 'sri-fixture', 'client', 'client-1', 'staff_recorded', statement_timestamp()) AS sri_client1 \gset
SELECT platform_private.create_or_link_lead(pg_temp.sri_id(1), :'sri_client1'::UUID, NULL, 'new', 'office',
  'sri-fixture', 'lead', 'lead-1', 'staff_recorded', statement_timestamp()) AS sri_lead1 \gset
SELECT platform_private.create_or_link_client(pg_temp.sri_id(1), 'SRI Existing Two', NULL,
  '+996 555 299 702', 'sri-fixture', 'client', 'client-2', 'staff_recorded', statement_timestamp()) AS sri_client2 \gset
SELECT platform_private.create_or_link_lead(pg_temp.sri_id(1), :'sri_client2'::UUID, NULL, 'new', 'office',
  'sri-fixture', 'lead', 'lead-2', 'staff_recorded', statement_timestamp()) AS sri_lead2 \gset
SELECT platform_private.create_or_link_client(pg_temp.sri_id(1), 'SRI Existing Three', NULL,
  '+996 555 299 703', 'sri-fixture', 'client', 'client-3', 'staff_recorded', statement_timestamp()) AS sri_client3 \gset
SELECT platform_private.create_or_link_lead(pg_temp.sri_id(1), :'sri_client3'::UUID, NULL, 'new', 'office',
  'sri-fixture', 'lead', 'lead-3', 'staff_recorded', statement_timestamp()) AS sri_lead3 \gset
-- Lead 3 has a sale of its own (a pipeline record): it can never be tied to an imported row.
INSERT INTO platform_private.sales_register(organization_id, report_month, source_kind, lead_id, client_id, fields, source_snapshot)
  VALUES (pg_temp.sri_id(1), DATE '2026-09-01', 'pipeline', :'sri_lead3'::UUID, :'sri_client3'::UUID,
    '{"applicant_name":"SRI Pipeline Sale","needs_review":true}'::JSONB, '{"handoff":"synthetic"}'::JSONB);
-- A client that holds a number and nothing else (no lead, no case).
SELECT platform_private.create_or_link_client(pg_temp.sri_id(1), 'SRI Phone Holder', NULL,
  '0555 299 777', 'sri-fixture', 'client', 'client-holder', 'staff_recorded', statement_timestamp()) AS sri_holder \gset
-- A lead of the second organization.
SELECT platform_private.create_or_link_client(pg_temp.sri_id(2), 'SRI Foreign Person', NULL,
  '+996 555 299 790', 'sri-fixture', 'client', 'client-f', 'staff_recorded', statement_timestamp()) AS sri_client_f \gset
SELECT platform_private.create_or_link_lead(pg_temp.sri_id(2), :'sri_client_f'::UUID, NULL, 'new', 'office',
  'sri-fixture', 'lead', 'lead-f', 'staff_recorded', statement_timestamp()) AS sri_lead_f \gset

-- A student case made by 281's own import (Admin, no curator): the person of case_exists.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT platform.import_admissions_student_case_v1(pg_temp.sri_id(1), pg_temp.sri_id(301), 'sri-direct', 'case-1',
  jsonb_build_object('student', jsonb_build_object('name', 'SRI Case Student', 'phone', '+996 555 299 301',
    'email', 'sri-case@example.invalid'), 'route', jsonb_build_object('country', 'CN')),
  'SRI fixture case') AS sri_case1 \gset
RESET ROLE;
SELECT :'sri_case1'::JSONB ->> 'student_case_id' AS sri_case_id, :'sri_case1'::JSONB ->> 'lead_id' AS sri_case_lead,
  :'sri_case1'::JSONB ->> 'client_id' AS sri_case_client \gset
SELECT pg_temp.sri_assert(:'sri_case1'::JSONB ->> 'status' = 'created' AND :'sri_case_id' IS NOT NULL,
  'fixture: 281 created the student case');

-- ---------------------------------------------------------------------------
-- 1. The service-only boundary and the actor.
-- ---------------------------------------------------------------------------
SELECT pg_temp.sri_state() AS sri_s1 \gset
SET LOCAL request.jwt.claims TO '{"role":"authenticated","sub":"5a1e0000-0000-4000-8000-000000000101"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sri_assert(pg_temp.sri_try('a1', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')))
  LIKE '42501:permission denied for function import_sales_report_row_v1',
  'authenticated, even the Admin, cannot execute the import');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.sri_assert(pg_temp.sri_try('a2', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))) LIKE '42501:permission denied for %',
  'anon cannot execute the import');
RESET ROLE;
-- The service role carrying a user identity is refused.
SET LOCAL request.jwt.claims TO '{"role":"service_role","sub":"5a1e0000-0000-4000-8000-000000000101"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('a3', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))) = '42501:sales_report_import_forbidden',
  'the service role carrying a user JWT (a sub) is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"authenticated"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('a4', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))) = '42501:sales_report_import_forbidden',
  'an authenticated role claim without a sub is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('a5', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))) = '42501:sales_report_import_forbidden',
  'an anon role claim without a sub is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(ARRAY[
    pg_temp.sri_try('b1', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 302),
    pg_temp.sri_try('b2', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 303),
    pg_temp.sri_try('b3', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 304),
    pg_temp.sri_try('b4', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 999),
    pg_temp.sri_try('b5', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 310, 1),
    pg_temp.sri_try('b6', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1')), 301, 2)
  ] = ARRAY(SELECT '42501:sales_report_import_forbidden' FROM generate_series(1, 6)),
  'a Sales member, invited staff, a Student, an unknown membership and a foreign Admin cannot be the actor');
SELECT pg_temp.sri_assert(pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(NULL, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(301), 'sri-report', 'b7', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))::TEXT, 'SRI'))
  = '42501:sales_report_import_forbidden'
  AND pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(%L, NULL, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(1), 'sri-report', 'b8', pg_temp.sri_pay(pg_temp.sri_row('SRI:B:1'))::TEXT, 'SRI'))
  = '42501:sales_report_import_forbidden',
  'no organization and no actor are refused');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s1', 'the refused calls wrote nothing');

-- ---------------------------------------------------------------------------
-- 2. The strict payload: every refusal names its key; nothing is written.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(
  (SELECT array_agg(pg_temp.sri_try('c' || x.i, x.payload) ORDER BY x.i) FROM (VALUES
    (1, '{}'::JSONB),
    (2, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1')) || '{"extra":1}'::JSONB),
    (3, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') || '{"zzz":1}'::JSONB)),
    (4, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1', 'a', 'delete'))),
    (5, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') - 'source_key')),
    (6, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') || jsonb_build_object('source_sha256', repeat('A', 64)))),
    (7, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') || jsonb_build_object('source_sha256', repeat('a', 63)))),
    (8, pg_temp.sri_pay(jsonb_set(pg_temp.sri_row('SRI:C:1'), '{fields,owner_membership_id}', to_jsonb(pg_temp.sri_id(301)::TEXT)))),
    (9, pg_temp.sri_pay(jsonb_set(pg_temp.sri_row('SRI:C:1'), '{fields,report_month}', '"2026-09-01"'))),
    (10, pg_temp.sri_pay(jsonb_set(pg_temp.sri_row('SRI:C:1'), '{fields,applicant_name}', '""'))),
    (11, pg_temp.sri_pay(jsonb_set(pg_temp.sri_row('SRI:C:1'), '{fields,paid_currency}', '"GBP"'))),
    (12, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') || jsonb_build_object('report_month', '2026-09-02'))),
    (13, pg_temp.sri_pay(jsonb_set(pg_temp.sri_row('SRI:C:1'), '{source_snapshot,not_a_known_key}', '1'))),
    (14, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), '{"mode":"adopt"}'::JSONB)),
    (15, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1', 'a', 'link_only'), '{"mode":"none"}'::JSONB)),
    (16, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), '{"mode":"link_lead"}'::JSONB)),
    (17, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), jsonb_build_object('mode', 'link_lead', 'lead_id', 'not-a-uuid'))),
    (18, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_link(pg_temp.sri_id(1)) || '{"client":{"name":"x"}}'::JSONB)),
    (19, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), '{"mode":"create_lead"}'::JSONB)),
    (20, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), '{"mode":"create_lead","client":{"name":"  "}}'::JSONB)),
    (21, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_create('SRI Bad Phone', '12ab'))),
    (22, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_create('SRI Bad Mail', NULL, 'not-an-email'))),
    (23, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_create('SRI Bad Direction', '+996 555 299 900', NULL, 'XX'))),
    (24, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_create('SRI Long Note', NULL, NULL, NULL, repeat('n', 3501)))),
    (25, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), pg_temp.sri_create('SRI Lead Id', NULL) || jsonb_build_object('lead_id', pg_temp.sri_id(1)::TEXT))),
    (26, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'), '{"mode":"none","note":"x"}'::JSONB)),
    (27, pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1') || jsonb_build_object('source_row', 0)))
  ) AS x(i, payload)) = ARRAY[
    '22023:sales_report_import_invalid:row',
    '22023:sales_report_import_invalid:extra',
    '22023:sales_report_import_invalid:zzz',
    '22023:sales_report_import_invalid:rowMode',
    '22023:sales_report_import_invalid:source_key',
    '22023:sales_report_import_invalid:source_sha256',
    '22023:sales_report_import_invalid:source_sha256',
    '22023:sales_report_import_invalid:owner_membership_id',
    '22023:sales_report_import_invalid:report_month',
    '22023:sales_register_invalid_text',
    '22023:sales_register_invalid_money',
    '22023:sales_report_import_invalid:report_month',
    '22023:sales_report_import_invalid:source_snapshot',
    '22023:sales_report_import_invalid:personMode',
    '22023:sales_report_import_invalid:person',
    '22023:sales_report_import_invalid:lead_id',
    '22023:sales_report_import_invalid:lead_id',
    '22023:sales_report_import_invalid:person',
    '22023:sales_report_import_invalid:client',
    '22023:sales_report_import_invalid:name',
    '22023:sales_report_import_invalid:phone',
    '22023:sales_report_import_invalid:email',
    '22023:sales_report_import_invalid:interest_direction',
    '22023:sales_report_import_invalid:note',
    '22023:sales_report_import_invalid:person',
    '22023:sales_report_import_invalid:person',
    '22023:sales_report_import_invalid:source_row'],
  'every wrong key, mode, shape and value is refused by name');
SELECT pg_temp.sri_assert(
  pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(%L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(1), pg_temp.sri_id(301), 'Bad Source', 'c40', pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'))::TEXT, 'SRI'))
    = '22023:sales_report_import_invalid:importSource'
  AND pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(%L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(1), pg_temp.sri_id(301), 'sri-report', '  ', pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'))::TEXT, 'SRI'))
    = '22023:sales_report_import_invalid:externalRef'
  AND pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(%L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(1), pg_temp.sri_id(301), 'sri-report', 'c42', pg_temp.sri_pay(pg_temp.sri_row('SRI:C:1'))::TEXT, ' '))
    = '22023:sales_report_import_invalid:reason'
  AND pg_temp.sri_error(format('SELECT platform.import_sales_report_row_v1(%L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.sri_id(1), pg_temp.sri_id(301), 'sri-report', 'c43', '[]', 'SRI'))
    = '22023:sales_report_import_invalid:payload',
  'the import source, the external reference, the reason and the payload shape are checked');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s1', 'the refused payloads wrote nothing');

-- ---------------------------------------------------------------------------
-- 3. insert: the row, the answer, the journal, the receipt; replay and conflicts.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('i1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Alpha'))) AS sri_i1 \gset
RESET ROLE;
SELECT :'sri_i1'::JSONB ->> 'register_id' AS sri_reg1 \gset
SELECT pg_temp.sri_assert(:'sri_i1'::JSONB ->> 'status' = 'inserted' AND :'sri_i1'::JSONB ->> 'row_status' = 'inserted'
  AND :'sri_i1'::JSONB ->> 'person_status' = 'none' AND (:'sri_i1'::JSONB ->> 'replayed')::BOOLEAN = FALSE
  AND :'sri_i1'::JSONB ->> 'register_version' = '1' AND :'sri_i1'::JSONB -> 'lead_id' = 'null'::JSONB
  AND :'sri_i1'::JSONB -> 'client_id' = 'null'::JSONB AND :'sri_i1'::JSONB ->> 'organization_id' = pg_temp.sri_id(1)::TEXT
  AND NOT (:'sri_i1'::JSONB ? 'before_state') AND :'sri_i1'::JSONB -> 'changed' = '[]'::JSONB,
  'insert: the answer');
SELECT pg_temp.sri_assert((SELECT r.source_kind = 'import' AND r.version = 1 AND r.owner_membership_id IS NULL
    AND NOT r.archived AND r.report_month = DATE '2026-09-01' AND r.source_key = 'SRI:Sheet:1'
    AND r.source_sha256 = repeat('a', 64) AND r.source_sheet = 'SRI Sheet' AND r.source_row = 7
    AND r.source_snapshot ->> 'applicant_name' = 'SRI Marker Alpha' AND r.source_fingerprint ~ '^[0-9a-f]{32}$'
    AND r.fields ->> 'applicant_name' = 'SRI Marker Alpha' AND r.fields ->> 'service_cost_minor' = '100000'
    AND r.fields ->> 'service_cost_currency' = 'USD' AND r.fields ->> 'paid_minor' = '100000'
    AND (r.fields ->> 'needs_review')::BOOLEAN = FALSE AND r.lead_id IS NULL AND r.client_id IS NULL
    AND r.linked_lead_id IS NULL
  FROM platform_private.sales_register r WHERE r.id = :'sri_reg1'::UUID AND r.organization_id = pg_temp.sri_id(1)),
  'insert: an import row, version 1, no owner, the snapshot and the validated fields');
SELECT pg_temp.sri_assert((SELECT count(*) = 1 AND bool_and(a.action = 'sales.register.import'
      AND a.actor_principal = 'service:sales-report-import' AND a.actor_kind = 'user'
      AND a.actor_profile_id = pg_temp.sri_id(201) AND a.actor_membership_id = pg_temp.sri_id(301)
      AND a.resource_type = 'sales_register' AND a.resource_id = :'sri_reg1'::UUID
      AND a.after_state ->> 'operation' = 'insert' AND a.before_state IS NULL)
  FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('i1', 'row')),
  'insert: one journal row from the service principal with the Admin as the actor');
SELECT pg_temp.sri_assert((SELECT count(*) = 1 AND bool_and(r.payload_md5 = md5(pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Alpha'))::TEXT)
      AND r.register_id = :'sri_reg1'::UUID AND r.register_version = 1 AND r.actor_membership_id = pg_temp.sri_id(301)
      AND r.before_state = '{}'::JSONB AND r.result ->> 'status' = 'inserted' AND NOT (r.result ? 'replayed'))
  FROM platform_private.sales_report_import_receipts r
  WHERE r.organization_id = pg_temp.sri_id(1) AND r.import_source = 'sri-report' AND r.external_ref = 'i1'),
  'insert: the receipt (payload md5, the record and its version, no replay flag)');
-- Replay: the same call is the same answer and writes nothing.
SELECT pg_temp.sri_state() AS sri_s3 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('i1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Alpha'))) AS sri_i1_replay \gset
RESET ROLE;
SELECT pg_temp.sri_assert((:'sri_i1_replay'::JSONB ->> 'replayed')::BOOLEAN AND :'sri_i1_replay'::JSONB ->> 'register_id' = :'sri_reg1'
  AND :'sri_i1_replay'::JSONB ->> 'status' = 'inserted' AND pg_temp.sri_state() = :'sri_s3',
  'insert: a replay is the same answer with replayed = true and writes nothing');
-- The same key with another body, and another actor under the same key.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('i1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Changed')))
    = 'PT409:sales_report_import_request_conflict'
  AND pg_temp.sri_try('i1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Alpha')), 305)
    = 'PT409:sales_report_import_request_conflict',
  'insert: another body or another actor under the same receipt key is PT409');
-- The same row again under a new key: the same source changes nothing, another source is a conflict.
SELECT pg_temp.sri_call('i2', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'a', 'insert', 'SRI Marker Alpha'))) AS sri_i2 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_i2'::JSONB ->> 'status' = 'unchanged' AND :'sri_i2'::JSONB ->> 'row_status' = 'unchanged'
  AND :'sri_i2'::JSONB ->> 'register_id' = :'sri_reg1' AND :'sri_i2'::JSONB ->> 'register_version' = '1'
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.sri_op('i2', 'row'))
  AND (SELECT r.register_version IS NULL FROM platform_private.sales_report_import_receipts r WHERE r.external_ref = 'i2'
    AND r.organization_id = pg_temp.sri_id(1)),
  'insert: the same row with the same source is unchanged (no journal row, no version left in the receipt)');
SELECT pg_temp.sri_state() AS sri_s3b \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('i3', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'b', 'insert', 'SRI Marker Alpha')))
  = 'PT409:sales_report_import_conflict', 'insert: the same key with another source is a conflict');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s3b'
  AND (SELECT count(*) FROM platform_private.sales_register WHERE source_key = 'SRI:Sheet:1') = 1,
  'insert: the conflict wrote nothing');

-- ---------------------------------------------------------------------------
-- 4. refresh.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r0', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:2', 'c', 'insert', 'SRI Marker Beta'))) AS sri_r0 \gset
RESET ROLE;
SELECT :'sri_r0'::JSONB ->> 'register_id' AS sri_reg2 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:2', 'd', 'refresh', 'SRI Marker Beta', 150000))) AS sri_r1 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_r1'::JSONB ->> 'status' = 'refreshed' AND :'sri_r1'::JSONB ->> 'row_status' = 'refreshed'
  AND :'sri_r1'::JSONB ->> 'register_id' = :'sri_reg2' AND :'sri_r1'::JSONB ->> 'register_version' = '2'
  AND :'sri_r1'::JSONB -> 'changed' = '["paid_minor"]'::JSONB,
  'refresh: refreshed, version 2, the names of the changed fields');
SELECT pg_temp.sri_assert((SELECT r.version = 2 AND r.fields ->> 'paid_minor' = '150000' AND r.source_sha256 = repeat('d', 64)
    AND r.owner_membership_id IS NULL AND NOT r.archived
  FROM platform_private.sales_register r WHERE r.id = :'sri_reg2'::UUID),
  'refresh: the fields and the source checksum are the new ones, the version is raised');
SELECT pg_temp.sri_assert((SELECT x.before_state -> 'register' ->> 'version' = '1'
      AND x.before_state -> 'register' ->> 'source_sha256' = repeat('c', 64)
      AND x.before_state -> 'register' -> 'fields' ->> 'paid_minor' = '100000'
      AND x.before_state -> 'register' -> 'source_snapshot' ->> 'applicant_name' = 'SRI Marker Beta'
      AND x.register_version = 2
    FROM platform_private.sales_report_import_receipts x WHERE x.external_ref = 'r1' AND x.organization_id = pg_temp.sri_id(1))
  AND (SELECT a.before_state ->> 'version' = '1' AND a.after_state ->> 'version' = '2'
      AND a.after_state ->> 'operation' = 'refresh' AND a.after_state -> 'changed' = '["paid_minor"]'::JSONB
    FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('r1', 'row')),
  'refresh: the previous values are kept in the receipt; the journal carries versions and field names only');
-- Again, while only this import has written the row (version 2 is the one the receipt left).
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r2', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:2', 'e', 'refresh', 'SRI Marker Beta', 160000))) AS sri_r2 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_r2'::JSONB ->> 'status' = 'refreshed' AND :'sri_r2'::JSONB ->> 'register_version' = '3'
  AND (SELECT r.version = 3 AND r.fields ->> 'paid_minor' = '160000' FROM platform_private.sales_register r WHERE r.id = :'sri_reg2'::UUID),
  'refresh: a second refresh by the import itself is accepted (version 3)');
-- The same source again is unchanged: no new version.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r3', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:2', 'e', 'refresh', 'SRI Marker Beta', 160000))) AS sri_r3 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_r3'::JSONB ->> 'status' = 'unchanged' AND :'sri_r3'::JSONB ->> 'register_version' = '3'
  AND (SELECT r.version = 3 FROM platform_private.sales_register r WHERE r.id = :'sri_reg2'::UUID)
  AND (SELECT x.register_version IS NULL FROM platform_private.sales_report_import_receipts x WHERE x.external_ref = 'r3' AND x.organization_id = pg_temp.sri_id(1)),
  'refresh: the same source is unchanged and leaves no version in the receipt');
-- Refused: archived, an owner, a hand edit, a missing row. Nothing changes.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r4a', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:3', 'a', 'insert', 'SRI Marker Archived'))) AS sri_r4a \gset
SELECT pg_temp.sri_call('r4b', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:4', 'a', 'insert', 'SRI Marker Owned'))) AS sri_r4b \gset
SELECT pg_temp.sri_call('r4c', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:5', 'a', 'insert', 'SRI Marker Edited'))) AS sri_r4c \gset
RESET ROLE;
-- What the interface would do: archive (the version rises), assign an owner, edit (the version rises).
UPDATE platform_private.sales_register SET archived = TRUE, version = version + 1 WHERE id = (:'sri_r4a'::JSONB ->> 'register_id')::UUID;
UPDATE platform_private.sales_register SET owner_membership_id = pg_temp.sri_id(301) WHERE id = (:'sri_r4b'::JSONB ->> 'register_id')::UUID;
UPDATE platform_private.sales_register SET version = version + 1 WHERE id = (:'sri_r4c'::JSONB ->> 'register_id')::UUID;
SELECT pg_temp.sri_state() AS sri_s4 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(ARRAY[
    pg_temp.sri_try('r5a', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:3', 'b', 'refresh', 'SRI Marker Archived', 1))),
    pg_temp.sri_try('r5b', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:4', 'b', 'refresh', 'SRI Marker Owned', 1))),
    pg_temp.sri_try('r5c', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:5', 'b', 'refresh', 'SRI Marker Edited', 1)))
  ] = ARRAY(SELECT 'PT409:sales_report_row_edited' FROM generate_series(1, 3)),
  'refresh: an archived row, a row with an owner and a row with a hand edit are refused');
SELECT pg_temp.sri_assert(pg_temp.sri_try('r5d', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:99', 'b', 'refresh', 'SRI Marker Nobody', 1)))
  = 'PT404:sales_report_row_missing', 'refresh: a row that is not there is refused');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s4', 'refresh: the refused calls changed nothing');
-- A hand edit after the import's own writes closes the row (R2 is at version 3, the receipt's version).
UPDATE platform_private.sales_register SET version = version + 1 WHERE id = :'sri_reg2'::UUID;
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('r6', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:2', 'f', 'refresh', 'SRI Marker Beta', 170000)))
  = 'PT409:sales_report_row_edited', 'refresh: an edit after the import''s own writes closes the row');
RESET ROLE;
SELECT pg_temp.sri_assert((SELECT r.version = 4 AND r.fields ->> 'paid_minor' = '160000' FROM platform_private.sales_register r WHERE r.id = :'sri_reg2'::UUID),
  'refresh: the row after the refused refresh is as the edit left it');
-- A row laid down by 134's own import (version 1, no receipt) is brought up too.
INSERT INTO platform_private.sales_register(organization_id, report_month, fields, source_kind, source_key, source_sha256,
  source_sheet, source_row, source_snapshot, source_fingerprint)
  VALUES (pg_temp.sri_id(1), DATE '2026-09-01', '{"applicant_name":"SRI Legacy","needs_review":true}'::JSONB, 'import', 'SRI:Sheet:LEGACY',
    repeat('1', 64), 'SRI Sheet', 3, '{}'::JSONB, repeat('0', 32));
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('r7', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:LEGACY', 'a', 'refresh', 'SRI Marker Legacy'))) AS sri_r7 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_r7'::JSONB ->> 'status' = 'refreshed' AND :'sri_r7'::JSONB ->> 'register_version' = '2'
  AND (SELECT r.fields ->> 'applicant_name' = 'SRI Marker Legacy' AND r.source_sha256 = repeat('a', 64) AND r.source_row = 7
    FROM platform_private.sales_register r WHERE r.source_key = 'SRI:Sheet:LEGACY'),
  'refresh: a row of 134''s own import at version 1 is accepted');

-- ---------------------------------------------------------------------------
-- 5. link_lead and link_only.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('l1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'insert', 'SRI Marker Linked'),
  pg_temp.sri_link(:'sri_lead1'::UUID))) AS sri_l1 \gset
RESET ROLE;
SELECT :'sri_l1'::JSONB ->> 'register_id' AS sri_reg10 \gset
SELECT pg_temp.sri_assert(:'sri_l1'::JSONB ->> 'status' = 'linked' AND :'sri_l1'::JSONB ->> 'row_status' = 'inserted'
  AND :'sri_l1'::JSONB ->> 'person_status' = 'linked' AND :'sri_l1'::JSONB ->> 'lead_id' = :'sri_lead1'
  AND :'sri_l1'::JSONB ->> 'client_id' = :'sri_client1' AND :'sri_l1'::JSONB ->> 'register_version' = '2'
  AND :'sri_l1'::JSONB ->> 'linked_lead_id' = :'sri_lead1'
  AND (SELECT r.linked_lead_id = :'sri_lead1'::UUID AND r.version = 2 AND r.lead_id IS NULL AND r.source_kind = 'import'
    FROM platform_private.sales_register r WHERE r.id = :'sri_reg10'::UUID),
  'link: a new row tied to the lead in one call (version 2, an import row, not a pipeline sale)');
SELECT pg_temp.sri_assert((SELECT a.action = 'sales.register.lead.link' AND a.actor_principal = 'service:sales-report-import'
      AND a.before_state = '{"version":"1","linked":false}'::JSONB
      AND (a.after_state ->> 'version') = '2' AND (a.after_state ->> 'linked')::BOOLEAN
    FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('l1', 'link'))
  AND EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('l1', 'row') AND a.action = 'sales.register.import'),
  'link: the journal has the row event and 254''s link event (versions and a flag, no lead id)');
-- The same lead again is unchanged (no new version, no new link event).
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('l2', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead1'::UUID))) AS sri_l2 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_l2'::JSONB ->> 'status' = 'unchanged' AND :'sri_l2'::JSONB ->> 'person_status' = 'link_unchanged'
  AND :'sri_l2'::JSONB ->> 'row_status' = 'none' AND :'sri_l2'::JSONB ->> 'lead_id' = :'sri_lead1'
  AND :'sri_l2'::JSONB ->> 'register_version' = '2'
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.sri_op('l2', 'link')),
  'link: the same lead again is unchanged');
-- Conflicts: another lead on the row, a lead tied to another row (and the row of that call is not
-- inserted), a lead with a pipeline sale (same), a foreign lead, an unknown lead.
SELECT pg_temp.sri_state() AS sri_s5 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('l3', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead2'::UUID)))
  = 'PT409:sales_report_link_conflict', 'link: another lead on an already tied row is a conflict');
SELECT pg_temp.sri_assert(pg_temp.sri_try('l4', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:11', 'a', 'insert', 'SRI Marker Second'), pg_temp.sri_link(:'sri_lead1'::UUID)))
  = 'PT409:sales_report_link_conflict', 'link: a lead tied to another row is a conflict');
SELECT pg_temp.sri_assert(pg_temp.sri_try('l5', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:12', 'a', 'insert', 'SRI Marker Third'), pg_temp.sri_link(:'sri_lead3'::UUID)))
  = 'PT409:sales_report_link_conflict', 'link: a lead with a sale of its own (pipeline) is a conflict');
SELECT pg_temp.sri_assert(pg_temp.sri_try('l6', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead_f'::UUID)))
    = '22023:sales_report_invalid_lead'
  AND pg_temp.sri_try('l7', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'), pg_temp.sri_link(pg_temp.sri_id(888))))
    = '22023:sales_report_invalid_lead',
  'link: a lead of another organization and an unknown lead are refused');
SELECT pg_temp.sri_assert(pg_temp.sri_try('l8', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:98', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead2'::UUID)))
  = 'PT404:sales_report_row_missing', 'link: link_only on a row that is not there is refused');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s5'
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_register WHERE source_key IN ('SRI:Sheet:11', 'SRI:Sheet:12'))
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts WHERE external_ref IN ('l3', 'l4', 'l5', 'l6', 'l7', 'l8')),
  'link: every refused call rolled back as a whole (the rows sent with it were not inserted, no receipt)');
-- An archived row cannot be tied.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('l9a', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:14', 'a', 'insert', 'SRI Marker Shelved'))) AS sri_l9a \gset
RESET ROLE;
UPDATE platform_private.sales_register SET archived = TRUE, version = version + 1 WHERE id = (:'sri_l9a'::JSONB ->> 'register_id')::UUID;
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('l9', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:14', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead2'::UUID)))
  = 'PT409:sales_report_row_archived', 'link: an archived row is refused');
-- link_only ties an existing row and leaves its fields alone; a refresh still works after a link this import made.
SELECT pg_temp.sri_call('l10a', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:13', 'a', 'insert', 'SRI Marker Plain'))) AS sri_l10a \gset
RESET ROLE;
SELECT (:'sri_l10a'::JSONB ->> 'register_id')::UUID AS sri_reg13 \gset
SELECT md5(r.fields::TEXT || r.source_sha256 || r.source_snapshot::TEXT) AS sri_reg13_md5 FROM platform_private.sales_register r WHERE r.id = :'sri_reg13'::UUID \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('l10', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:13', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead2'::UUID))) AS sri_l10 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_l10'::JSONB ->> 'status' = 'linked' AND :'sri_l10'::JSONB ->> 'row_status' = 'none'
  AND (SELECT r.linked_lead_id = :'sri_lead2'::UUID AND r.version = 2
      AND md5(r.fields::TEXT || r.source_sha256 || r.source_snapshot::TEXT) = :'sri_reg13_md5'
    FROM platform_private.sales_register r WHERE r.id = :'sri_reg13'::UUID),
  'link: link_only ties the row to the lead and does not touch its fields or source');
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('l11', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:13', 'b', 'refresh', 'SRI Marker Plain', 120000))) AS sri_l11 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_l11'::JSONB ->> 'status' = 'refreshed' AND :'sri_l11'::JSONB ->> 'register_version' = '3'
  AND (SELECT r.linked_lead_id = :'sri_lead2'::UUID AND r.fields ->> 'paid_minor' = '120000'
    FROM platform_private.sales_register r WHERE r.id = :'sri_reg13'::UUID),
  'link: a refresh after a link made by this import is accepted and keeps the link');

-- ---------------------------------------------------------------------------
-- 6. create_lead.
-- ---------------------------------------------------------------------------
SELECT (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.sri_id(1)) AS sri_clients0,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.sri_id(1)) AS sri_leads0 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:20', 'a', 'insert', 'SRI Marker Gamma'),
  pg_temp.sri_create('SRI Marker Gamma', '0555 299 801', 'SRI-Marker@Example.Invalid', 'EUROPE', 'SRI marker note'))) AS sri_cl1 \gset
RESET ROLE;
SELECT :'sri_cl1'::JSONB ->> 'lead_id' AS sri_new_lead, :'sri_cl1'::JSONB ->> 'client_id' AS sri_new_client,
  :'sri_cl1'::JSONB ->> 'register_id' AS sri_reg20 \gset
SELECT pg_temp.sri_assert(:'sri_cl1'::JSONB ->> 'status' = 'lead_created' AND :'sri_cl1'::JSONB ->> 'row_status' = 'inserted'
  AND :'sri_cl1'::JSONB ->> 'person_status' = 'lead_created' AND :'sri_new_lead' IS NOT NULL AND :'sri_new_client' IS NOT NULL
  AND :'sri_cl1'::JSONB ->> 'register_version' = '2' AND :'sri_cl1'::JSONB -> 'student_case_id' = 'null'::JSONB,
  'create_lead: the answer (lead_created, the row inserted and tied)');
SELECT pg_temp.sri_assert((SELECT c.display_name = 'SRI Marker Gamma' AND c.phone = '+996555299801'
      AND c.normalized_phone = '+996555299801' AND c.normalized_email = 'sri-marker@example.invalid'
      AND c.lifecycle_state = 'active'
    FROM platform.clients c WHERE c.id = :'sri_new_client'::UUID AND c.organization_id = pg_temp.sri_id(1))
  AND (SELECT l.lifecycle_state = 'converted' AND l.current_owner_membership_id IS NULL AND l.source_key = 'sales_report'
      AND l.interest_direction = 'EU' AND l.stage_key = 'new' AND l.client_id = :'sri_new_client'::UUID
    FROM platform.leads l WHERE l.id = :'sri_new_lead'::UUID AND l.organization_id = pg_temp.sri_id(1)),
  'create_lead: the client (E.164 phone, normalized e-mail) and the lead (converted, no owner, source sales_report, EUROPE stored as EU)');
SELECT pg_temp.sri_assert((SELECT count(*) = 1 FROM platform.external_identifiers e
      WHERE e.organization_id = pg_temp.sri_id(1) AND e.source_system = 'evo_sales_report' AND e.external_object_type = 'lead'
        AND e.lead_id = :'sri_new_lead'::UUID AND e.source_ref = 'cl1')
  AND (SELECT count(*) = 1 FROM platform.external_identifiers e
      WHERE e.organization_id = pg_temp.sri_id(1) AND e.source_system = 'evo_sales_report' AND e.external_object_type = 'client'
        AND e.client_id = :'sri_new_client'::UUID AND e.source_ref = 'cl1')
  AND (SELECT count(*) = 1 FROM platform.subject_provenance p
      WHERE p.organization_id = pg_temp.sri_id(1) AND p.lead_id = :'sri_new_lead'::UUID AND p.source_system = 'evo_sales_report'
        AND p.evidence_type = 'imported' AND p.source_ref = 'cl1')
  AND (SELECT count(*) = 1 FROM platform.subject_provenance p
      WHERE p.organization_id = pg_temp.sri_id(1) AND p.client_id = :'sri_new_client'::UUID AND p.source_system = 'evo_sales_report'
        AND p.evidence_type = 'imported' AND p.source_ref = 'cl1'),
  'create_lead: external identifiers and provenance (source evo_sales_report, evidence imported, source_ref = the external reference)');
SELECT pg_temp.sri_assert((SELECT r.linked_lead_id = :'sri_new_lead'::UUID AND r.version = 2 AND r.source_kind = 'import'
    FROM platform_private.sales_register r WHERE r.id = :'sri_reg20'::UUID)
  AND (SELECT x.lead_note = 'SRI marker note' AND x.register_version = 2 FROM platform_private.sales_report_import_receipts x
    WHERE x.external_ref = 'cl1' AND x.organization_id = pg_temp.sri_id(1))
  AND (SELECT a.action = 'lead.manual.create' AND a.resource_type = 'lead' AND a.resource_id = :'sri_new_lead'::UUID
      AND a.after_state ->> 'source_key' = 'sales_report' AND a.after_state ->> 'origin' = 'sales_report_import'
      AND a.actor_principal = 'service:sales-report-import'
    FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('cl1', 'lead'))
  AND EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id = pg_temp.sri_op('cl1', 'link') AND a.action = 'sales.register.lead.link'),
  'create_lead: the row is tied to the new lead, the note is kept in the receipt, the journal has the lead and the link events');
-- The new lead is not a marketing lead; a sales lead of the same moment is.
SELECT pg_temp.sri_assert(NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.sri_id(1), DATE '2000-01-01', DATE '2100-01-01') c
      WHERE c.lead_id = :'sri_new_lead'::UUID)
  AND EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.sri_id(1), DATE '2000-01-01', DATE '2100-01-01') c
      WHERE c.lead_id = :'sri_lead1'::UUID),
  'create_lead: a lead made from the report is outside the marketing cohort, an ordinary lead is inside');
-- Replay: the same call writes nothing.
SELECT pg_temp.sri_state() AS sri_s6 \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:20', 'a', 'insert', 'SRI Marker Gamma'),
  pg_temp.sri_create('SRI Marker Gamma', '0555 299 801', 'SRI-Marker@Example.Invalid', 'EUROPE', 'SRI marker note'))) AS sri_cl1_replay \gset
RESET ROLE;
SELECT pg_temp.sri_assert((:'sri_cl1_replay'::JSONB ->> 'replayed')::BOOLEAN AND :'sri_cl1_replay'::JSONB ->> 'lead_id' = :'sri_new_lead'
  AND pg_temp.sri_state() = :'sri_s6', 'create_lead: a replay returns the same lead and creates nothing');
-- lead_exists: the same person by another spelling of the phone (and another name); then by e-mail only.
SELECT pg_temp.sri_state() AS sri_s6b \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl2', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:21', 'a', 'insert', 'SRI Marker Gamma Twin'),
  pg_temp.sri_create('SRI Marker Twin', '996555299801'))) AS sri_cl2 \gset
SELECT pg_temp.sri_call('cl3', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:22', 'a', 'insert', 'SRI Marker One Again'),
  pg_temp.sri_create('SRI Marker Mail Twin', NULL, 'SRI-One@example.invalid'))) AS sri_cl3 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_cl2'::JSONB ->> 'status' = 'lead_exists' AND :'sri_cl2'::JSONB ->> 'person_status' = 'lead_exists'
  AND :'sri_cl2'::JSONB ->> 'row_status' = 'inserted' AND :'sri_cl2'::JSONB ->> 'lead_id' = :'sri_new_lead'
  AND :'sri_cl2'::JSONB ->> 'client_id' = :'sri_new_client'
  AND :'sri_cl3'::JSONB ->> 'status' = 'lead_exists' AND :'sri_cl3'::JSONB ->> 'lead_id' = :'sri_lead1'
  AND :'sri_cl3'::JSONB ->> 'client_id' = :'sri_client1',
  'create_lead: a person who already has a lead (by another spelling of the phone, or by e-mail) is lead_exists with the ids');
SELECT pg_temp.sri_assert((SELECT count(*) = 2 AND bool_and(r.linked_lead_id IS NULL AND r.version = 1)
    FROM platform_private.sales_register r WHERE r.source_key IN ('SRI:Sheet:21', 'SRI:Sheet:22'))
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.sri_id(1)) = :sri_clients0 + 1
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.sri_id(1)) = :sri_leads0 + 1,
  'create_lead: lead_exists creates no client or lead; the row is laid down and is not tied by itself');
-- case_exists: the person of the student case.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl4', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:23', 'a', 'insert', 'SRI Marker Case Row'),
  pg_temp.sri_create('SRI Marker Case Person', '0555 299 301'))) AS sri_cl4 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_cl4'::JSONB ->> 'status' = 'case_exists' AND :'sri_cl4'::JSONB ->> 'student_case_id' = :'sri_case_id'
  AND :'sri_cl4'::JSONB ->> 'lead_id' = :'sri_case_lead' AND :'sri_cl4'::JSONB ->> 'client_id' = :'sri_case_client'
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.sri_id(1)) = :sri_clients0 + 1
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.sri_id(1)) = :sri_leads0 + 1
  AND (SELECT r.linked_lead_id IS NULL FROM platform_private.sales_register r WHERE r.source_key = 'SRI:Sheet:23'),
  'create_lead: a person who already has a case is case_exists with the case, lead and client ids; nothing is created');
-- An already tied row, and an archived row, refuse a new person before anything is created.
SELECT pg_temp.sri_state() AS sri_s6c \gset
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_assert(pg_temp.sri_try('cl5', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'),
      pg_temp.sri_create('SRI Marker Late Person', '0555 299 802'))) = 'PT409:sales_report_link_conflict'
  AND pg_temp.sri_try('cl6', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:14', 'a', 'link_only'),
      pg_temp.sri_create('SRI Marker Shelved Person', '0555 299 803'))) = 'PT409:sales_report_row_archived',
  'create_lead: an already tied row and an archived row are refused');
RESET ROLE;
SELECT pg_temp.sri_assert(pg_temp.sri_state() = :'sri_s6c', 'create_lead: the refused calls created nothing');
-- A person already in the CRM is only reported: a row tied before (a re-run), or shelved, does not fail.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl5b', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'),
  pg_temp.sri_create('SRI Marker Rerun', NULL, 'sri-one@example.invalid'))) AS sri_cl5b \gset
SELECT pg_temp.sri_call('cl6b', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:14', 'a', 'link_only'),
  pg_temp.sri_create('SRI Marker Shelved Twin', NULL, 'sri-one@example.invalid'))) AS sri_cl6b \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_cl5b'::JSONB ->> 'status' = 'lead_exists' AND :'sri_cl5b'::JSONB ->> 'lead_id' = :'sri_lead1'
  AND :'sri_cl5b'::JSONB ->> 'linked_lead_id' = :'sri_lead1' AND :'sri_cl5b'::JSONB ->> 'register_version' = '2'
  AND :'sri_cl6b'::JSONB ->> 'status' = 'lead_exists' AND :'sri_cl6b'::JSONB ->> 'lead_id' = :'sri_lead1'
  AND :'sri_cl6b'::JSONB -> 'linked_lead_id' = 'null'::JSONB
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.sri_id(1)) = :sri_clients0 + 1
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.sri_id(1)) = :sri_leads0 + 1,
  'create_lead: a person already in the CRM is lead_exists even when the row is tied or shelved; nothing changes');
-- A person with a name only, a person whose number a client holds in another spelling.
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('cl7', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:24', 'a', 'insert', 'SRI Name Only Row'),
  pg_temp.sri_create('SRI Name Only', NULL))) AS sri_cl7 \gset
SELECT pg_temp.sri_call('cl8', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:25', 'a', 'insert', 'SRI Marker Spelling Row'),
  pg_temp.sri_create('SRI Marker Spelling', '+996 555 299 777'))) AS sri_cl8 \gset
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_cl7'::JSONB ->> 'status' = 'lead_created'
  AND (SELECT c.phone IS NULL AND c.normalized_phone IS NULL AND c.normalized_email IS NULL
    FROM platform.clients c WHERE c.id = (:'sri_cl7'::JSONB ->> 'client_id')::UUID)
  AND (SELECT l.lifecycle_state = 'converted' AND l.interest_direction IS NULL FROM platform.leads l
    WHERE l.id = (:'sri_cl7'::JSONB ->> 'lead_id')::UUID),
  'create_lead: a person with a name only is created (converted, no direction)');
SELECT pg_temp.sri_assert(:'sri_cl8'::JSONB ->> 'status' = 'lead_created'
  AND :'sri_cl8'::JSONB ->> 'client_id' <> :'sri_holder'
  AND EXISTS (SELECT 1 FROM platform_private.client_duplicate_candidates d
    WHERE d.organization_id = pg_temp.sri_id(1) AND d.match_basis = 'phone'
      AND d.left_client_id = LEAST((:'sri_cl8'::JSONB ->> 'client_id')::UUID, :'sri_holder'::UUID)
      AND d.right_client_id = GREATEST((:'sri_cl8'::JSONB ->> 'client_id')::UUID, :'sri_holder'::UUID)),
  'create_lead: a client holding the number in another spelling (and nothing in work) becomes a phone duplicate candidate');
-- Every lead this import created is converted and ownerless (never a sales enquiry).
SELECT pg_temp.sri_assert(NOT EXISTS (SELECT 1 FROM platform.leads l
      WHERE l.source_key = 'sales_report' AND (l.lifecycle_state <> 'converted' OR l.current_owner_membership_id IS NOT NULL))
  AND (SELECT count(*) FROM platform.leads l WHERE l.source_key = 'sales_report' AND l.organization_id = pg_temp.sri_id(1)) = 3,
  'create_lead: every lead of the report is converted and without a sales owner');

-- ---------------------------------------------------------------------------
-- 7. The journal: the principal, the actor, the request ids, no personal data.
-- ---------------------------------------------------------------------------
SELECT pg_temp.sri_assert((SELECT count(*) >= 15 FROM platform.audit_events a WHERE a.actor_principal = 'service:sales-report-import'),
  'journal: the import wrote its events');
SELECT pg_temp.sri_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.actor_principal = 'service:sales-report-import'
      AND (a.actor_kind <> 'user' OR a.actor_membership_id NOT IN (pg_temp.sri_id(301), pg_temp.sri_id(305), pg_temp.sri_id(310))
        OR NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
          WHERE m.id = a.actor_membership_id AND m.profile_id = a.actor_profile_id AND m.organization_id = a.organization_id)
        OR a.action NOT IN ('sales.register.import', 'sales.register.lead.link', 'lead.manual.create'))),
  'journal: every row is from the service principal with the Admin''s profile and membership and an existing allowlisted action');
SELECT pg_temp.sri_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.actor_principal = 'service:sales-report-import' AND a.organization_id = pg_temp.sri_id(1)
      AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts r
        CROSS JOIN (VALUES ('row'), ('link'), ('lead')) v(op)
        WHERE r.organization_id = a.organization_id AND pg_temp.sri_op(r.external_ref, v.op) = a.request_id)),
  'journal: every request id is derived from a receipt key (uuid v5 by event name)');
SELECT pg_temp.sri_assert(
  EXISTS (SELECT 1 FROM platform_private.sales_register r WHERE r.source_snapshot::TEXT ~ 'SRI Marker Alpha')
  AND EXISTS (SELECT 1 FROM platform.clients c WHERE c.phone = '+996555299801')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.actor_principal = 'service:sales-report-import'
      AND concat_ws(' ', a.before_state::TEXT, a.after_state::TEXT, a.reason)
        ~* '(SRI Marker|SRI Existing|SRI Applicant|SRI Name Only|SRI Case|SRI Legacy|555 ?299|example\.invalid|marker note|Оплачено|Китай|SRI University|SRI Manager)'),
  'journal: no name, phone, e-mail, note or field value is in any row (and the markers do exist in the private tables)');
SELECT pg_temp.sri_assert(NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts r
    WHERE r.result::TEXT ~* '(SRI Marker|example\.invalid|555 ?299|marker note)'),
  'journal: the answer kept in the receipts carries ids and statuses only (the note has its own column)');

-- ---------------------------------------------------------------------------
-- 8. Two organizations are isolated.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.sri_call('o1', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'b', 'insert', 'SRI Marker Org Two')), 310, 2) AS sri_o1 \gset
SELECT pg_temp.sri_assert(pg_temp.sri_try('o2', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:1', 'b', 'link_only'), pg_temp.sri_link(:'sri_lead1'::UUID)), 310, 2)
    = '22023:sales_report_invalid_lead'
  AND pg_temp.sri_try('o3', pg_temp.sri_pay(pg_temp.sri_row('SRI:Sheet:10', 'a', 'link_only'), pg_temp.sri_link(:'sri_lead_f'::UUID)), 310, 2)
    = 'PT404:sales_report_row_missing',
  'organizations: a foreign lead and a foreign row are not reachable');
RESET ROLE;
SELECT pg_temp.sri_assert(:'sri_o1'::JSONB ->> 'status' = 'inserted' AND :'sri_o1'::JSONB ->> 'register_id' <> :'sri_reg1'
  AND (SELECT count(*) = 2 FROM platform_private.sales_register WHERE source_key = 'SRI:Sheet:1')
  AND (SELECT r.source_sha256 = repeat('a', 64) AND r.version = 1 FROM platform_private.sales_register r WHERE r.id = :'sri_reg1'::UUID)
  AND (SELECT r.organization_id = pg_temp.sri_id(2) FROM platform_private.sales_register r WHERE r.id = (:'sri_o1'::JSONB ->> 'register_id')::UUID)
  AND EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.sri_id(2)
    AND a.request_id = pg_temp.sri_op('o1', 'row', 2) AND a.actor_membership_id = pg_temp.sri_id(310)),
  'organizations: the same source key in the other organization is its own row, journaled for its own Admin');

-- ---------------------------------------------------------------------------
-- 9. Posture of the new objects.
-- ---------------------------------------------------------------------------
SELECT pg_temp.sri_assert(
  has_function_privilege('service_role', 'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.sales_report_import_text(jsonb,text,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.sales_report_import_text(jsonb,text,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.sales_report_import_object(jsonb,text,text[])', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.sales_report_import_snapshot_ok(jsonb)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.sales_report_import_receipts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.sales_report_import_receipts', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform_private.sales_report_import_receipts', 'SELECT'),
  'grants: the import for service_role only; the helpers and the receipts table for nobody');
SELECT pg_temp.sri_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p
  WHERE p.oid = 'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)'::regprocedure),
  'SECURITY DEFINER with the empty search_path');
SELECT pg_temp.sri_assert((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid = 'platform_private.sales_report_import_receipts'::regclass), 'receipts: forced RLS');
SELECT pg_temp.sri_assert(pg_temp.sri_error('UPDATE platform_private.sales_report_import_receipts SET external_ref = ''forged''') <> 'ok'
  AND pg_temp.sri_error('DELETE FROM platform_private.sales_report_import_receipts') <> 'ok'
  AND pg_temp.sri_error('TRUNCATE platform_private.sales_report_import_receipts') <> 'ok'
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts WHERE external_ref = 'forged'),
  'receipts are append-only');
SELECT pg_temp.sri_assert((SELECT bool_and(r.payload_md5 ~ '^[0-9a-f]{32}$' AND jsonb_typeof(r.result) = 'object'
      AND NOT (r.result ? 'replayed') AND jsonb_typeof(r.before_state) = 'object')
    FROM platform_private.sales_report_import_receipts r)
  AND (SELECT count(*) FROM platform_private.sales_report_import_receipts) >= 20
  AND pg_temp.sri_error(format('INSERT INTO platform_private.sales_report_import_receipts (organization_id, import_source, external_ref, actor_membership_id, payload_md5, result, before_state) VALUES (%L, %L, %L, %L, %L, %L::JSONB, NULL)',
    pg_temp.sri_id(1), 'sri-report', 'x', pg_temp.sri_id(301), repeat('a', 32), '{}')) LIKE '23502:%'
  AND pg_temp.sri_error(format('INSERT INTO platform_private.sales_report_import_receipts (organization_id, import_source, external_ref, actor_membership_id, payload_md5, result, before_state) VALUES (%L, %L, %L, %L, %L, %L::JSONB, %L::JSONB)',
    pg_temp.sri_id(1), 'sri-report', 'i1', pg_temp.sri_id(301), repeat('a', 32), '{}', '{}')) LIKE '23505:%',
  'each accepted call left one receipt; before_state is NOT NULL; the key (organization, source, reference) is unique');

SELECT 'SRI_SALES_REPORT_IMPORT_SUITE_PASSED' AS sri_suite_marker;
ROLLBACK;
