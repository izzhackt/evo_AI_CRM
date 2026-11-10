\set ON_ERROR_STOP on
-- Boundary suite for migration 358 «Чеки от студента и реквизиты для оплаты» (решение владельца 10.11.2026), on the real chain right after 358
-- inside one transaction that is rolled back. Synthetic organization, members, cases and payments; no bytes, no Storage, no provider, no
-- real person. Staff roles are created through the real role commands (as in 352's suite): actor 4 holds the production «Admissions» key set
-- WITHOUT case.update.append (can read, cannot write money), actor 5 (the case curator) holds the full set; actor 1 is the system Admin.
--
-- Proves: posture (service/user doors, closed tables, journal allowlist); the Student reads only own payments, history and details;
-- details are admin-only versions (keep/replace QR, replay, no text in the journal); the upload target and server record (own payment or
-- none, currency, path, duplicates, other Student/staff refused, money untouched); the staff queue and gates; accept creates a real
-- payment through record_case_payment_v1 (corrected amount, picked payment, totals, file link, replay, refusals change nothing); reject
-- needs a reason, the Student sees it and can attach again; notifications for the curator; append-only guards.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A358_STUDENT_PAYMENT_RECEIPTS_SUITE_START

CREATE FUNCTION pg_temp.a358_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a358_id(INTEGER) TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.a358_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A358: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a358_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
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
CREATE TEMP TABLE a358_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, claims TEXT);
INSERT INTO a358_actors(n, coarse) VALUES (1, 'admin'), (2, 'student'), (3, 'student'), (4, NULL), (5, NULL), (6, NULL);
GRANT SELECT ON a358_actors TO authenticated;
CREATE FUNCTION pg_temp.a358_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_call('authenticated', (SELECT claims FROM a358_actors WHERE n = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a358_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a358_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;

-- Actors: 1 org Admin (positive control, creates the roles), 2 Student A (case 701), 3 Student B (case 702), 4 document-only curator,
-- 5 finance writer, 6 staff member with no role at all.
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a358_id(1), 'A358 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a358_id(100 + n), 'a358-' || n || '@example.invalid', '{}'::JSONB FROM a358_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a358_id(200 + n), pg_temp.a358_id(100 + n), 'A358 Actor ' || n, 'active', 1 FROM a358_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a358_id(300 + n), pg_temp.a358_id(1), pg_temp.a358_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM a358_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a358_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a358_id(401), pg_temp.a358_id(1), 'organization', pg_temp.a358_id(1), 1),
  (pg_temp.a358_id(421), pg_temp.a358_id(1), 'student_case', pg_temp.a358_id(701), 1),
  (pg_temp.a358_id(422), pg_temp.a358_id(1), 'student_case', pg_temp.a358_id(702), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a358_id(1), pg_temp.a358_id(301), pg_temp.a358_id(401), 1, 1, TRUE, 'system', 'A358 synthetic scope', pg_temp.a358_id(601)),
  (pg_temp.a358_id(1), pg_temp.a358_id(302), pg_temp.a358_id(401), 1, 1, TRUE, 'system', 'A358 synthetic scope', pg_temp.a358_id(602)),
  (pg_temp.a358_id(1), pg_temp.a358_id(302), pg_temp.a358_id(421), 1, 1, TRUE, 'system', 'A358 synthetic scope', pg_temp.a358_id(603)),
  (pg_temp.a358_id(1), pg_temp.a358_id(303), pg_temp.a358_id(401), 1, 1, TRUE, 'system', 'A358 synthetic scope', pg_temp.a358_id(604)),
  (pg_temp.a358_id(1), pg_temp.a358_id(303), pg_temp.a358_id(422), 1, 1, TRUE, 'system', 'A358 synthetic scope', pg_temp.a358_id(605));

-- Cases 701 (Student A) and 702 (Student B): active, portal activated.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.a358_id(c.n), pg_temp.a358_id(1), pg_temp.a358_id(301), pg_temp.a358_id(305),
  'synthetic:a358:' || c.n, 'A358 Student ' || c.n, 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.a358_id(c.scope), 1, 'new', pg_temp.a358_id(c.student), clock_timestamp()
FROM (VALUES (701, 421, 302), (702, 422, 303)) AS c(n, scope, student);
SET LOCAL session_replication_role = origin;

-- Staff roles through the real commands (production key set): curator = «Admissions» WITHOUT case.update.append, finance writer = full.
CREATE TEMP TABLE a358_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a358_roles VALUES
  (pg_temp.a358_id(1101), 'Documents only', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1110),
  (pg_temp.a358_id(1102), 'Finance writer', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.update.append", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1120);
CREATE TEMP TABLE a358_grants(membership INTEGER, role_id UUID);
INSERT INTO a358_grants VALUES (304, pg_temp.a358_id(1101)), (305, pg_temp.a358_id(1102));
CREATE TEMP TABLE a358_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id WHERE m.organization_id = pg_temp.a358_id(1);
GRANT SELECT ON a358_roles, a358_grants, a358_versions TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a358_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a358_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a358_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a358_admin_setup';
SET LOCAL ROLE authenticated;
DO $a358_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a358_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a358_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A358 ' || r.label, 'description', 'Migration 352 synthetic role', 'permissionKeys', r.keys),
      'A358 create role', pg_temp.a358_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a358_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a358_id(1), r.role_id, 1) ->> 'impactFingerprint', 'A358 publish role', pg_temp.a358_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a358_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.a358_id(1), 'resourceKind', NULL))),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1))
      INTO items, bindings FROM a358_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a358_id(1), pg_temp.a358_id(m),
      (SELECT access_version FROM a358_versions WHERE membership_id = pg_temp.a358_id(m)), items, bindings, 'A358 grant role', pg_temp.a358_id(2000 + m));
  END LOOP;
END
$a358_roles$;
RESET ROLE;
UPDATE a358_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a358_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a358_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a358_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL) FROM a358_actors), 'fixture: every actor got claims from the real hook');

-- Money fixture: case 701 (Student A) has two payments (due 7011 CNY 1000.00, due 7012 USD 500.00), case 702 (Student B) one (7021 CNY 300.00).
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, created_by_membership_id)
SELECT pg_temp.a358_id(o.id), pg_temp.a358_id(1), pg_temp.a358_id(o.c), o.label, 'evo_service_fee', o.amount, o.cur, o.due, pg_temp.a358_id(305)
FROM (VALUES (7011, 701, 'Первый платёж', 100000, 'CNY', now() + INTERVAL '10 days'), (7012, 701, 'Второй платёж', 50000, 'USD', NULL::TIMESTAMPTZ),
  (7021, 702, 'Платёж B', 30000, 'CNY', now() + INTERVAL '5 days')) AS o(id, c, label, amount, cur, due);

CREATE FUNCTION pg_temp.a358_upload(p_student INTEGER, p_case INTEGER, p_due INTEGER, p_amount BIGINT, p_cur TEXT, p_hash TEXT, p_req INTEGER,
  p_object TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_svc(format('SELECT platform.record_student_payment_receipt_v1(%L, %L, %L, %L, %s, %L, %L, %L, %L, 2048, %L, %L, %L)',
    pg_temp.a358_id(1), pg_temp.a358_id(300 + p_student), pg_temp.a358_id(p_case), CASE WHEN p_due IS NULL THEN NULL ELSE pg_temp.a358_id(p_due)::TEXT END,
    p_amount, p_cur, current_date, 'check-' || p_req || '.jpg', 'image/jpeg', repeat(p_hash, 64),
    COALESCE(p_object, format('payment-receipts/%s/%s/%s', pg_temp.a358_id(1), pg_temp.a358_id(p_case), pg_temp.a358_id(9000 + p_req))),
    pg_temp.a358_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a358_center(p_actor INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_as(p_actor, 'SELECT platform.student_portal_payment_center_v1()')
$$;
CREATE FUNCTION pg_temp.a358_due(p_center JSONB, p_due INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT d FROM jsonb_array_elements(p_center -> 'dues') d WHERE d ->> 'obligation_id' = pg_temp.a358_id(p_due)::TEXT
$$;
CREATE FUNCTION pg_temp.a358_events(p_like TEXT) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a358_id(1) AND e.action LIKE p_like
$$;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_assert(
  (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname IN ('record_student_payment_receipt_v1', 'record_payment_details_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 7 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('student_portal_payment_center_v1', 'student_payment_receipt_target_v1', 'staff_payment_receipts_v1',
      'staff_student_receipt_download_target_v1', 'accept_student_payment_receipt_v1', 'reject_student_payment_receipt_v1', 'staff_payment_details_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
    AND p.proname IN ('receipt_staff_can_read', 'receipt_staff_can_review', 'payment_details_is_admin', 'notify_student_receipt')),
  'posture: service functions for service_role only, user functions for authenticated only, helpers closed');
SELECT pg_temp.a358_assert(
  (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c
    WHERE c.oid IN ('platform.student_payment_receipts'::REGCLASS, 'platform.payment_details_versions'::REGCLASS))
  AND NOT has_table_privilege('authenticated', 'platform.student_payment_receipts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform.student_payment_receipts', 'INSERT')
  AND NOT has_table_privilege('service_role', 'platform.student_payment_receipts', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform.payment_details_versions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform.payment_details_versions', 'INSERT'), 'both tables closed with FORCE RLS');
SELECT pg_temp.a358_assert('finance.receipt.accept' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'finance.paymentdetails.update' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'student_payment_receipt' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND 'payment_details' = ANY (platform_private.p7a_safe_audit_resource_types()), 'the journal allowlist knows the new actions and types');
SELECT pg_temp.a358_assert(pg_temp.a358_as(2, 'SELECT count(*)::TEXT::JSONB FROM platform.student_payment_receipts') ->> 'error' = '42501',
  'authenticated cannot read the receipts table directly');

-- ---------------------------------------------------------------------------
-- 2. The Student reads own payments; refused callers.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_center(2) AS a358_c0 \gset
SELECT pg_temp.a358_assert((:'a358_c0'::JSONB ->> 'can_upload')::BOOLEAN AND jsonb_array_length(:'a358_c0'::JSONB -> 'dues') = 2
  AND :'a358_c0'::JSONB -> 'details' = 'null'::JSONB AND jsonb_array_length(:'a358_c0'::JSONB -> 'unassigned') = 0,
  'Student A sees two own payments, no details yet, nothing unassigned: ' || :'a358_c0');
SELECT pg_temp.a358_assert(jsonb_array_length(pg_temp.a358_center(3) -> 'dues') = 1 AND pg_temp.a358_center(3) -> 'dues' -> 0 ->> 'label' = 'Платёж B',
  'Student B sees only own payment');
SELECT pg_temp.a358_assert((pg_temp.a358_center(5) ->> 'can_upload')::BOOLEAN IS FALSE AND jsonb_array_length(pg_temp.a358_center(5) -> 'dues') = 0,
  'a staff member gets an empty center');
SELECT pg_temp.a358_assert(pg_temp.a358_call('anon', '{"role":"anon"}', 'SELECT platform.student_portal_payment_center_v1()') ->> 'error' = '42501'
  AND pg_temp.a358_svc('SELECT platform.student_portal_payment_center_v1()') ->> 'error' = '42501', 'anon and service_role cannot call the Student read');

-- ---------------------------------------------------------------------------
-- 3. Payment details: admin only; the Student sees the current version; QR download kind.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_assert(pg_temp.a358_as(5, 'SELECT platform.staff_payment_details_v1()') ->> 'error' = '42501'
  AND pg_temp.a358_as(2, 'SELECT platform.staff_payment_details_v1()') ->> 'error' = '42501', 'a non-admin and a Student cannot read the editor view');
SELECT pg_temp.a358_assert((pg_temp.a358_as(1, 'SELECT platform.staff_payment_details_v1()') ->> 'version_no')::INTEGER = 0, 'the admin sees an empty editor');
CREATE FUNCTION pg_temp.a358_details(p_member INTEGER, p_text TEXT, p_mode TEXT, p_req INTEGER, p_hash TEXT DEFAULT 'e') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_svc(format('SELECT platform.record_payment_details_v1(%L, %L, %L, %L, %L, %L, 4096, %L, %L, %L)',
    pg_temp.a358_id(1), pg_temp.a358_id(300 + p_member), p_text, p_mode,
    CASE WHEN p_mode = 'replace' THEN 'qr.png' END, CASE WHEN p_mode = 'replace' THEN 'image/png' END, repeat(p_hash, 64),
    CASE WHEN p_mode = 'replace' THEN format('payment-details/%s/%s', pg_temp.a358_id(1), pg_temp.a358_id(9500 + p_req)) END, pg_temp.a358_id(p_req)))
$$;
SELECT pg_temp.a358_assert(pg_temp.a358_details(5, 'IBAN', 'keep', 8001) ->> 'error' = '42501', 'a non-admin cannot save details (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_svc(format('SELECT platform.record_payment_details_v1(%L, %L, %L, %L, %L, %L, 4096, %L, %L, %L)',
  pg_temp.a358_id(1), pg_temp.a358_id(301), 'IBAN', 'replace', 'qr.png', 'image/png', repeat('e', 64), 'payment-details/other/x', pg_temp.a358_id(8003))) ->> 'message' = 'payment_details_invalid',
  'a QR path outside the organization prefix is refused');
SELECT pg_temp.a358_details(1, 'Получатель: EVO Fictional' || E'\n' || 'Счёт: 0000', 'replace', 8004) AS a358_d1 \gset
SELECT pg_temp.a358_assert((:'a358_d1'::JSONB ->> 'version_no')::INTEGER = 1 AND (:'a358_d1'::JSONB ->> 'replayed')::BOOLEAN IS FALSE, 'the admin saves version 1: ' || :'a358_d1');
SELECT pg_temp.a358_details(1, 'Получатель: EVO Fictional' || E'\n' || 'Счёт: 0000', 'replace', 8004) AS a358_d1_again \gset
SELECT pg_temp.a358_assert((:'a358_d1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND (SELECT count(*) = 1 FROM platform.payment_details_versions WHERE organization_id = pg_temp.a358_id(1)),
  'the same request id does not add a second version');
SELECT pg_temp.a358_details(1, 'Получатель: EVO Fictional' || E'\n' || 'Счёт: 1111', 'keep', 8005) AS a358_d2 \gset
SELECT pg_temp.a358_assert((:'a358_d2'::JSONB ->> 'version_no')::INTEGER = 2
  AND (SELECT qr_storage_object_name IS NOT NULL FROM platform.payment_details_versions WHERE version_no = 2 AND organization_id = pg_temp.a358_id(1)), 'a text-only edit keeps the QR and adds version 2');
SELECT pg_temp.a358_center(2) AS a358_c1 \gset
SELECT pg_temp.a358_assert(:'a358_c1'::JSONB -> 'details' ->> 'text' LIKE '%1111%' AND (:'a358_c1'::JSONB -> 'details' ->> 'has_qr')::BOOLEAN
  AND :'a358_c1'::JSONB -> 'details' ->> 'qr_id' = :'a358_d2'::JSONB ->> 'version_id', 'Student A sees the current version with the QR');
SELECT pg_temp.a358_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'payment_details_qr', :'a358_d2'::JSONB ->> 'version_id')) AS a358_qr_ok \gset
SELECT pg_temp.a358_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'payment_details_qr', :'a358_d1'::JSONB ->> 'version_id')) AS a358_qr_old \gset
SELECT pg_temp.a358_assert(NOT (:'a358_qr_ok'::JSONB ? 'error') AND pg_temp.a358_err(:'a358_qr_old'::JSONB) = '42501',
  'the Student resolves the QR of the current version only');
SELECT pg_temp.a358_assert(pg_temp.a358_as(5, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'payment_details_qr', :'a358_d2'::JSONB ->> 'version_id')) ->> 'error' = '42501',
  'a staff member cannot use the Student QR door');
SELECT pg_temp.a358_assert(pg_temp.a358_as(1, format('SELECT platform.staff_payment_details_qr_target_v1(%L)', :'a358_d2'::JSONB ->> 'version_id')) ->> 'storage_object_name' IS NOT NULL
  AND pg_temp.a358_as(5, format('SELECT platform.staff_payment_details_qr_target_v1(%L)', :'a358_d2'::JSONB ->> 'version_id')) ->> 'error' = '42501',
  'the admin resolves the QR for the editor, a non-admin does not');
SELECT pg_temp.a358_assert(pg_temp.a358_events('finance.paymentdetails.update') = 2
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE organization_id = pg_temp.a358_id(1) AND action = 'finance.paymentdetails.update' AND after_state::TEXT LIKE '%1111%'),
  'two journal events for the details, without the details text');

-- ---------------------------------------------------------------------------
-- 4. Upload door: the target check and the server record.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_as(2, format('SELECT platform.student_payment_receipt_target_v1(%L)', pg_temp.a358_id(7011))) AS a358_t_own \gset
SELECT pg_temp.a358_as(2, 'SELECT platform.student_payment_receipt_target_v1(NULL)') AS a358_t_loose \gset
SELECT pg_temp.a358_as(2, format('SELECT platform.student_payment_receipt_target_v1(%L)', pg_temp.a358_id(7021))) AS a358_t_foreign \gset
SELECT pg_temp.a358_as(5, format('SELECT platform.student_payment_receipt_target_v1(%L)', pg_temp.a358_id(7011))) AS a358_t_staff \gset
SELECT pg_temp.a358_assert(:'a358_t_own'::JSONB ->> 'student_case_id' = pg_temp.a358_id(701)::TEXT AND :'a358_t_own'::JSONB ->> 'currency' = 'CNY'
  AND :'a358_t_own'::JSONB ->> 'student_membership_id' = pg_temp.a358_id(302)::TEXT, 'the target resolves an own payment');
SELECT pg_temp.a358_assert(:'a358_t_loose'::JSONB ->> 'student_case_id' = pg_temp.a358_id(701)::TEXT AND :'a358_t_loose'::JSONB -> 'payment_obligation_id' = 'null'::JSONB,
  'without a payment the target is the Student''s own case');
SELECT pg_temp.a358_assert(pg_temp.a358_err(:'a358_t_foreign'::JSONB) = '42501' AND pg_temp.a358_err(:'a358_t_staff'::JSONB) = '42501',
  'another Student''s payment and a staff caller are refused (42501)');

SELECT pg_temp.a358_assert(pg_temp.a358_as(2, format('SELECT platform.record_student_payment_receipt_v1(%L)', 1)) ->> 'error' IN ('42501', '42883'),
  'authenticated cannot call the server record');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, 7011, 40000, 'CNY', 'a', 9101) ->> 'status' = 'pending', 'a receipt for a payment is recorded as pending');
SELECT pg_temp.a358_upload(2, 701, 7011, 40000, 'CNY', 'a', 9101) AS a358_u1_again \gset
SELECT pg_temp.a358_assert((:'a358_u1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE
  AND (SELECT count(*) = 1 FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9101)), 'the same request id replays');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, 7011, 40000, 'CNY', 'a', 9102) ->> 'message' = 'receipt_duplicate', 'the same file in the same case is a duplicate under a new request id');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, 7011, 40000, 'USD', 'b', 9103) ->> 'message' = 'receipt_currency_mismatch', 'currency must match the payment');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, 7011, 0, 'CNY', 'b', 9104) ->> 'message' = 'receipt_invalid'
  AND pg_temp.a358_upload(2, 701, 7011, 100, 'CNY', 'b', 9105, 'payment-receipts/elsewhere/x') ->> 'message' = 'receipt_invalid', 'zero amount and a foreign storage path are invalid');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(3, 702, 7011, 100, 'CNY', 'c', 9106) ->> 'error' = '42501'
  AND pg_temp.a358_upload(2, 702, 7021, 100, 'CNY', 'c', 9107) ->> 'error' = '42501', 'a Student cannot attach to another Student''s case or payment (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_svc(format('SELECT platform.record_student_payment_receipt_v1(%L,%L,%L,NULL,100,%L,%L,%L,%L,10,%L,%L,%L)',
  pg_temp.a358_id(1), pg_temp.a358_id(305), pg_temp.a358_id(701), 'CNY', current_date + 30, 'x.jpg', 'image/jpeg', repeat('c', 64),
  format('payment-receipts/%s/%s/%s', pg_temp.a358_id(1), pg_temp.a358_id(701), pg_temp.a358_id(9300)), pg_temp.a358_id(9108))) ->> 'message' IN ('receipt_invalid_date', 'receipt_forbidden'),
  'a staff membership cannot be the author and a far-future date is refused');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, NULL, 25000, 'USD', 'd', 9109) ->> 'status' = 'pending', 'a receipt without a payment is recorded (any currency)');
SELECT pg_temp.a358_upload(3, 702, 7021, 30000, 'CNY', 'f', 9110) AS a358_u_b \gset
SELECT pg_temp.a358_assert(:'a358_u_b'::JSONB ->> 'status' = 'pending', 'Student B records their own receipt');
SELECT pg_temp.a358_assert(NOT EXISTS (SELECT 1 FROM platform.payment_events WHERE organization_id = pg_temp.a358_id(1))
  AND (SELECT sum(total_paid_minor) = 0 FROM platform.payment_obligations WHERE organization_id = pg_temp.a358_id(1)), 'recording a receipt moves no money');
SELECT pg_temp.a358_center(2) AS a358_c2 \gset
SELECT pg_temp.a358_assert(jsonb_array_length(pg_temp.a358_due(:'a358_c2'::JSONB, 7011) -> 'entries') = 1
  AND pg_temp.a358_due(:'a358_c2'::JSONB, 7011) -> 'entries' -> 0 ->> 'status' = 'review'
  AND (pg_temp.a358_due(:'a358_c2'::JSONB, 7011) ->> 'paid_minor')::BIGINT = 0
  AND jsonb_array_length(:'a358_c2'::JSONB -> 'unassigned') = 1
  AND :'a358_c2'::JSONB -> 'unassigned' -> 0 ->> 'file_kind' = 'student_receipt',
  'Student A sees the pending entry under the payment and the loose one; paid is still 0: ' || :'a358_c2');
SELECT pg_temp.a358_assert(NOT (pg_temp.a358_center(3)::TEXT LIKE '%check-9101%'), 'Student B does not see Student A''s receipts');
SELECT pg_temp.a358_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'student_receipt',
  (SELECT id FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9101)))) AS a358_f_own \gset
SELECT pg_temp.a358_as(3, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'student_receipt',
  (SELECT id FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9101)))) AS a358_f_other \gset
SELECT pg_temp.a358_assert(NOT (:'a358_f_own'::JSONB ? 'error') AND pg_temp.a358_err(:'a358_f_other'::JSONB) = '42501',
  'the Student downloads own pending receipt, another Student cannot (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_events('finance.receipt.submit') = 3, 'three submit events in the journal');
SELECT pg_temp.a358_assert((SELECT count(*) FROM platform.staff_notifications WHERE kind = 'student_receipt' AND recipient_membership_id = pg_temp.a358_id(305)) = 3
  AND (SELECT count(*) FROM platform.staff_notifications WHERE kind = 'student_receipt' AND recipient_membership_id = pg_temp.a358_id(305)
    AND student_case_id = pg_temp.a358_id(701)) = 2
  AND (SELECT count(*) FROM platform.staff_notifications WHERE kind = 'student_receipt' AND recipient_membership_id IN (pg_temp.a358_id(302), pg_temp.a358_id(303))) = 0
  AND (SELECT count(*) FROM platform.staff_notifications WHERE kind = 'student_receipt' AND recipient_membership_id IN (pg_temp.a358_id(304), pg_temp.a358_id(306))) = 0,
  'the curator (also a full finance reader) is notified for every receipt, a student and a member without finance access never');

-- ---------------------------------------------------------------------------
-- 5. Staff queue and gates.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_as(1, 'SELECT platform.staff_payment_receipts_v1()') AS a358_q_admin \gset
SELECT pg_temp.a358_as(5, 'SELECT platform.staff_payment_receipts_v1()') AS a358_q_cur \gset
SELECT pg_temp.a358_as(5, format('SELECT platform.staff_payment_receipts_v1(%L)', pg_temp.a358_id(701))) AS a358_q_cur_case \gset
SELECT pg_temp.a358_as(2, 'SELECT platform.staff_payment_receipts_v1()') AS a358_q_student \gset
SELECT pg_temp.a358_as(6, 'SELECT platform.staff_payment_receipts_v1()') AS a358_q_norole \gset
SELECT pg_temp.a358_assert((:'a358_q_admin'::JSONB ->> 'total')::INTEGER = 3, 'the admin sees all three pending receipts: ' || :'a358_q_admin');
SELECT pg_temp.a358_assert((:'a358_q_cur'::JSONB ->> 'total')::INTEGER = 3 AND (:'a358_q_cur_case'::JSONB ->> 'total')::INTEGER = 2
  AND NOT (:'a358_q_cur_case'::JSONB::TEXT LIKE '%Student 702%'), 'the curator (org-wide case access in this fixture) sees all; the per-case filter narrows: ' || :'a358_q_cur');
SELECT pg_temp.a358_assert(pg_temp.a358_err(:'a358_q_student'::JSONB) = '42501' AND (pg_temp.a358_err(:'a358_q_norole'::JSONB) = '42501' OR (:'a358_q_norole'::JSONB ->> 'total')::INTEGER = 0),
  'a Student is refused; a member without finance access sees nothing');
SELECT pg_temp.a358_assert((SELECT bool_and((r ->> 'can_review')::BOOLEAN) FROM jsonb_array_elements(:'a358_q_cur'::JSONB -> 'receipts') r)
  AND jsonb_array_length((:'a358_q_cur'::JSONB -> 'receipts' -> 0) -> 'dues') >= 1, 'the curator may review and gets the payment choices');
SELECT pg_temp.a358_as(4, 'SELECT platform.staff_payment_receipts_v1()') AS a358_q_doc \gset
SELECT pg_temp.a358_assert((:'a358_q_doc'::JSONB ->> 'total')::INTEGER = 3 AND NOT (SELECT bool_or((r ->> 'can_review')::BOOLEAN) FROM jsonb_array_elements(:'a358_q_doc'::JSONB -> 'receipts') r),
  'a member who can read but not write money sees the queue with can_review false');
SELECT id AS a358_r1 FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9101) \gset
SELECT id AS a358_r_loose FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9109) \gset
SELECT id AS a358_r_b FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9110) \gset
SELECT pg_temp.a358_as(4, format('SELECT platform.accept_student_payment_receipt_v1(%L,%L,NULL,40000,%L,%L,%L)', pg_temp.a358_id(1), :'a358_r1',
  'CNY', current_date, pg_temp.a358_id(9201))) AS a358_a_doc \gset
SELECT pg_temp.a358_assert(pg_temp.a358_err(:'a358_a_doc'::JSONB) = '42501', 'a member without case.update.append cannot accept (42501): ' || :'a358_a_doc');
SELECT pg_temp.a358_assert(pg_temp.a358_as(5, format('SELECT platform.staff_student_receipt_download_target_v1(%L)', :'a358_r1')) ->> 'storage_object_name' LIKE 'payment-receipts/%'
  AND pg_temp.a358_as(6, format('SELECT platform.staff_student_receipt_download_target_v1(%L)', :'a358_r_b')) ->> 'error' = '42501'
  AND pg_temp.a358_as(2, format('SELECT platform.staff_student_receipt_download_target_v1(%L)', :'a358_r1')) ->> 'error' = '42501',
  'the curator downloads a receipt, a member without finance access and a Student cannot');

-- ---------------------------------------------------------------------------
-- 6. Accept: a real payment, totals recompute, only additions.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a358_accept(p_actor INTEGER, p_receipt UUID, p_due INTEGER, p_amount BIGINT, p_cur TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_as(p_actor, format('SELECT platform.accept_student_payment_receipt_v1(%L,%L,%s,%s,%L,%L,%L)', pg_temp.a358_id(1), p_receipt,
    CASE WHEN p_due IS NULL THEN 'NULL' ELSE quote_literal(pg_temp.a358_id(p_due)) END, p_amount, p_cur, current_date, pg_temp.a358_id(p_req)))
$$;
SELECT pg_temp.a358_assert(pg_temp.a358_accept(6, :'a358_r_b', NULL, 100, 'CNY', 9202) ->> 'error' = '42501', 'a member without finance access cannot accept (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_accept(2, :'a358_r1', NULL, 100, 'CNY', 9203) ->> 'error' = '42501', 'a Student cannot accept (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_accept(5, :'a358_r1', NULL, 0, 'CNY', 9204) ->> 'message' = 'receipt_invalid', 'a zero amount is invalid');
SELECT pg_temp.a358_assert(pg_temp.a358_accept(5, :'a358_r_loose', NULL, 25000, 'USD', 9205) ->> 'message' = 'receipt_obligation_required',
  'a receipt without a payment needs the payment to be picked');
SELECT pg_temp.a358_assert(pg_temp.a358_accept(5, :'a358_r1', NULL, 40000, 'USD', 9206) ->> 'message' = 'case_agreement_invalid',
  'a currency that differs from the payment is refused by the payment command');
SELECT pg_temp.a358_assert(pg_temp.a358_accept(5, :'a358_r1', NULL, 100001, 'CNY', 9207) ->> 'message' = 'case_agreement_exceeds_balance',
  'an amount above the balance is refused by the payment command');
SELECT pg_temp.a358_assert((SELECT status = 'pending' FROM platform.student_payment_receipts WHERE id = :'a358_r1') AND NOT EXISTS (SELECT 1 FROM platform.payment_events WHERE organization_id = pg_temp.a358_id(1)),
  'refusals changed nothing');
-- Staff corrects the amount (the Student wrote 400.00, the bank shows 399.50).
SELECT pg_temp.a358_accept(5, :'a358_r1', NULL, 39950, 'CNY', 9208) AS a358_acc \gset
SELECT pg_temp.a358_assert(:'a358_acc'::JSONB ->> 'status' = 'accepted' AND (:'a358_acc'::JSONB ->> 'replayed')::BOOLEAN IS FALSE, 'the curator accepts with a corrected amount: ' || :'a358_acc');
SELECT pg_temp.a358_assert((SELECT total_paid_minor = 39950 FROM platform.payment_obligations WHERE id = pg_temp.a358_id(7011))
  AND (SELECT count(*) = 1 FROM platform.payment_events WHERE payment_obligation_id = pg_temp.a358_id(7011) AND amount_minor = 39950 AND event_type = 'payment')
  AND (SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE payment_event_id = (:'a358_acc'::JSONB ->> 'payment_event_id')::UUID
     AND uploaded_by_membership_id = pg_temp.a358_id(302))
  AND (SELECT status = 'accepted' AND accepted_amount_minor = 39950 AND declared_amount_minor = 40000 FROM platform.student_payment_receipts WHERE id = :'a358_r1'),
  'a real payment exists, the total recomputed, the file is linked, the Student''s declaration is kept');
SELECT pg_temp.a358_accept(5, :'a358_r1', NULL, 39950, 'CNY', 9208) AS a358_acc_again \gset
SELECT pg_temp.a358_assert((:'a358_acc_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND (SELECT count(*) = 1 FROM platform.payment_events WHERE organization_id = pg_temp.a358_id(1))
  AND pg_temp.a358_accept(5, :'a358_r1', NULL, 39950, 'CNY', 9209) ->> 'message' = 'receipt_not_pending', 'a repeat is safe, a second accept under a new request is refused');
-- A receipt without a payment: the curator picks the payment.
SELECT pg_temp.a358_accept(5, :'a358_r_loose', 7012, 25000, 'USD', 9210) AS a358_acc2 \gset
SELECT pg_temp.a358_assert(:'a358_acc2'::JSONB ->> 'status' = 'accepted' AND (SELECT total_paid_minor = 25000 FROM platform.payment_obligations WHERE id = pg_temp.a358_id(7012)),
  'a loose receipt is accepted onto a payment picked by staff');
-- The admin (not the curator) also accepts: Student B.
SELECT pg_temp.a358_accept(1, :'a358_r_b', NULL, 30000, 'CNY', 9211) AS a358_acc_admin \gset
SELECT pg_temp.a358_assert(:'a358_acc_admin'::JSONB ->> 'status' = 'accepted' AND (SELECT total_paid_minor = 30000 FROM platform.payment_obligations WHERE id = pg_temp.a358_id(7021)),
  'the admin accepts a receipt of any case: ' || :'a358_acc_admin');
SELECT pg_temp.a358_center(2) AS a358_c3 \gset
SELECT pg_temp.a358_assert((pg_temp.a358_due(:'a358_c3'::JSONB, 7011) ->> 'paid_minor')::BIGINT = 39950
  AND (pg_temp.a358_due(:'a358_c3'::JSONB, 7011) ->> 'outstanding_minor')::BIGINT = 60050
  AND pg_temp.a358_due(:'a358_c3'::JSONB, 7011) -> 'entries' -> 0 ->> 'status' = 'accepted'
  AND pg_temp.a358_due(:'a358_c3'::JSONB, 7011) -> 'entries' -> 0 ->> 'file_kind' = 'receipt'
  AND jsonb_array_length(pg_temp.a358_due(:'a358_c3'::JSONB, 7011) -> 'entries') = 1
  AND jsonb_array_length(:'a358_c3'::JSONB -> 'unassigned') = 0, 'the Student sees the accepted payment once, with the receipt, totals recomputed: ' || :'a358_c3');
SELECT pg_temp.a358_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'receipt',
  pg_temp.a358_due(:'a358_c3'::JSONB, 7011) -> 'entries' -> 0 ->> 'file_id')) AS a358_f_acc \gset
SELECT pg_temp.a358_assert(NOT (:'a358_f_acc'::JSONB ? 'error'), 'the accepted receipt downloads as a payment receipt');
SELECT pg_temp.a358_assert(pg_temp.a358_events('finance.receipt.accept') = 3 AND pg_temp.a358_events('finance.payment.record') = 3, 'journal: three accepts and three payments');

-- ---------------------------------------------------------------------------
-- 7. Reject: a reason is required; the Student sees it and uploads again.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_upload(2, 701, 7011, 10000, 'CNY', '1', 9111) AS a358_u7 \gset
SELECT id AS a358_r7 FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9111) \gset
CREATE FUNCTION pg_temp.a358_reject(p_actor INTEGER, p_receipt UUID, p_reason TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_as(p_actor, format('SELECT platform.reject_student_payment_receipt_v1(%L,%L,%L,%L)', pg_temp.a358_id(1), p_receipt, p_reason, pg_temp.a358_id(p_req)))
$$;
SELECT pg_temp.a358_assert(pg_temp.a358_reject(5, :'a358_r7', '  ', 9301) ->> 'message' = 'receipt_invalid'
  AND pg_temp.a358_reject(2, :'a358_r7', 'я сам', 9302) ->> 'error' = '42501'
  AND pg_temp.a358_reject(4, :'a358_r7', 'нет права', 9303) ->> 'error' = '42501', 'no reason, a Student and a member without write access cannot reject');
SELECT pg_temp.a358_reject(5, :'a358_r7', 'Не видно сумму на фото', 9304) AS a358_rej \gset
SELECT pg_temp.a358_assert(:'a358_rej'::JSONB ->> 'status' = 'rejected' AND (SELECT status = 'rejected' AND reject_reason = 'Не видно сумму на фото' FROM platform.student_payment_receipts WHERE id = :'a358_r7')
  AND (SELECT sum(total_paid_minor) = 39950 + 25000 + 30000 FROM platform.payment_obligations WHERE organization_id = pg_temp.a358_id(1)), 'the curator rejects with a reason and no money moves');
SELECT pg_temp.a358_reject(5, :'a358_r7', 'Не видно сумму на фото', 9304) AS a358_rej_again \gset
SELECT pg_temp.a358_assert((:'a358_rej_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND pg_temp.a358_reject(5, :'a358_r7', 'Другая', 9305) ->> 'message' = 'receipt_not_pending',
  'a repeat is safe, a rejected receipt cannot be decided again');
SELECT pg_temp.a358_center(2) AS a358_c4 \gset
SELECT pg_temp.a358_assert((SELECT e ->> 'reject_reason' FROM jsonb_array_elements(pg_temp.a358_due(:'a358_c4'::JSONB, 7011) -> 'entries') e WHERE e ->> 'status' = 'rejected') = 'Не видно сумму на фото',
  'the Student sees the rejected entry with the reason');
SELECT pg_temp.a358_assert(pg_temp.a358_upload(2, 701, 7011, 10000, 'CNY', '1', 9112) ->> 'status' = 'pending', 'the same file can be attached again after a rejection');
SELECT pg_temp.a358_assert(pg_temp.a358_events('finance.receipt.reject') = 1, 'one reject event in the journal');

-- ---------------------------------------------------------------------------
-- 7b. «Создать платёж на эту сумму»: платёж и принятие чека одним шагом.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_upload(2, 701, NULL, 7777, 'EUR', '2', 9113) AS a358_u_eur \gset
SELECT id AS a358_r_eur FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9113) \gset
CREATE FUNCTION pg_temp.a358_accept_new(p_actor INTEGER, p_receipt UUID, p_label TEXT, p_amount BIGINT, p_cur TEXT, p_req INTEGER, p_due INTEGER DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a358_as(p_actor, format('SELECT platform.accept_student_payment_receipt_v1(%L,%L,%s,%s,%L,%L,%L,%L)', pg_temp.a358_id(1), p_receipt,
    CASE WHEN p_due IS NULL THEN 'NULL' ELSE quote_literal(pg_temp.a358_id(p_due)) END, p_amount, p_cur, current_date, pg_temp.a358_id(p_req), p_label))
$$;
SELECT pg_temp.a358_assert(pg_temp.a358_accept_new(4, :'a358_r_eur', 'Сервисный сбор', 7777, 'EUR', 9401) ->> 'error' = '42501', 'a member without write access cannot create a payment (42501)');
SELECT pg_temp.a358_assert(pg_temp.a358_accept_new(5, :'a358_r_eur', 'Сервисный сбор', 7777, 'EUR', 9402, 7011) ->> 'message' = 'receipt_invalid',
  'a new payment label together with an existing payment is invalid');
SELECT pg_temp.a358_assert(NOT EXISTS (SELECT 1 FROM platform.payment_obligations WHERE student_case_id = pg_temp.a358_id(701) AND currency = 'EUR')
  AND (SELECT status = 'pending' FROM platform.student_payment_receipts WHERE id = :'a358_r_eur'), 'refusals created nothing');
SELECT pg_temp.a358_accept_new(5, :'a358_r_eur', 'Сервисный сбор', 7777, 'EUR', 9403) AS a358_new \gset
SELECT pg_temp.a358_assert(:'a358_new'::JSONB ->> 'status' = 'accepted' AND :'a358_new'::JSONB ? 'created_payment_obligation_id', 'accepted against a new payment: ' || :'a358_new');
SELECT pg_temp.a358_assert((SELECT amount_minor = 7777 AND total_paid_minor = 7777 AND label = 'Сервисный сбор' AND currency = 'EUR'
    FROM platform.payment_obligations WHERE id = (:'a358_new'::JSONB ->> 'created_payment_obligation_id')::UUID)
  AND (SELECT accepted_payment_obligation_id = (:'a358_new'::JSONB ->> 'created_payment_obligation_id')::UUID FROM platform.student_payment_receipts WHERE id = :'a358_r_eur')
  AND pg_temp.a358_events('case.tranche.save') >= 1, 'the new payment exists, is fully paid, is the receipt''s payment and went through the tranche journal');
SELECT pg_temp.a358_accept_new(5, :'a358_r_eur', 'Сервисный сбор', 7777, 'EUR', 9403) AS a358_new_again \gset
SELECT pg_temp.a358_assert((:'a358_new_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE
  AND (SELECT count(*) = 1 FROM platform.payment_obligations WHERE student_case_id = pg_temp.a358_id(701) AND currency = 'EUR'), 'a repeat creates no second payment');

-- ---------------------------------------------------------------------------
-- 7c. The Student is told in «Что нового»: accepted (amount) and rejected (reason); only their own; readable once.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_as(2, 'SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at), ''[]''::JSONB) FROM platform.student_portal_notifications_v2() n WHERE n.category = ''payment.receipt''') AS a358_feed \gset
SELECT pg_temp.a358_assert(jsonb_array_length(:'a358_feed'::JSONB) = 4
  AND (SELECT count(*) = 3 FROM jsonb_array_elements(:'a358_feed'::JSONB) e WHERE e ->> 'event_code' = 'payment_receipt_accepted')
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'a358_feed'::JSONB) e WHERE e ->> 'event_code' = 'payment_receipt_rejected' AND e ->> 'subject_label' = 'Не видно сумму на фото')
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'a358_feed'::JSONB) e WHERE e ->> 'subject_label' = '399.50 CNY'), 'the Student feed shows accepted amounts and the rejection reason: ' || :'a358_feed');
SELECT pg_temp.a358_as(3, 'SELECT count(*)::TEXT::JSONB FROM platform.student_portal_notifications_v2() n WHERE n.category = ''payment.receipt''') AS a358_feed_b \gset
SELECT pg_temp.a358_assert((:'a358_feed_b'::JSONB)::TEXT::INTEGER = 1, 'Student B sees only the own decision');
SELECT e ->> 'notification_id' AS a358_note FROM jsonb_array_elements(:'a358_feed'::JSONB) e LIMIT 1 \gset
SELECT pg_temp.a358_as(2, format('SELECT platform.mark_own_student_portal_notification_read_v2(%L, %L)', :'a358_note', gen_random_uuid())) AS a358_marked \gset
SELECT pg_temp.a358_assert(NOT (:'a358_marked'::JSONB ? 'error'), 'the Student marks a receipt notification as read: ' || :'a358_marked');
SELECT pg_temp.a358_assert(pg_temp.a358_as(3, format('SELECT platform.mark_own_student_portal_notification_read_v2(%L, %L)', :'a358_note', gen_random_uuid())) ->> 'error' = '42501',
  'another Student cannot mark it (42501)');

-- ---------------------------------------------------------------------------
-- 7d. Control characters never reach a Student page: details text is refused, file names are cleaned.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a358_assert(pg_temp.a358_details(1, 'IBAN' || chr(7) || '0000', 'keep', 8101) ->> 'message' = 'payment_details_invalid'
  AND pg_temp.a358_details(1, 'Строка' || chr(10) || 'Таб' || chr(9) || 'ok', 'keep', 8102) ->> 'version_no' IS NOT NULL, 'bell is refused, new lines and tabs are kept');
SELECT pg_temp.a358_svc(format('SELECT platform.record_student_payment_receipt_v1(%L,%L,%L,NULL,100,%L,%L,%L,%L,10,%L,%L,%L)',
  pg_temp.a358_id(1), pg_temp.a358_id(302), pg_temp.a358_id(701), 'USD', current_date, chr(7) || repeat('я', 300) || chr(27) || '.png', 'image/png', repeat('7', 64),
  format('payment-receipts/%s/%s/%s', pg_temp.a358_id(1), pg_temp.a358_id(701), pg_temp.a358_id(9500)), pg_temp.a358_id(9114))) AS a358_odd \gset
SELECT pg_temp.a358_assert((SELECT char_length(original_filename) = 255 AND original_filename !~ E'[\\x01-\\x1f\\x7f]' FROM platform.student_payment_receipts WHERE submit_request_id = pg_temp.a358_id(9114)),
  'the file name has no control characters and is cut to 255 characters: ' || :'a358_odd');

-- ---------------------------------------------------------------------------
-- 8. Append-only.
-- ---------------------------------------------------------------------------
DO $a358_immutable$
DECLARE blocked INTEGER := 0;
BEGIN
  BEGIN UPDATE platform.student_payment_receipts SET declared_amount_minor = 1 WHERE id = (SELECT id FROM platform.student_payment_receipts LIMIT 1);
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN UPDATE platform.student_payment_receipts SET status = 'pending' WHERE status = 'accepted';
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM platform.student_payment_receipts; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN TRUNCATE platform.student_payment_receipts; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN UPDATE platform.payment_details_versions SET details_text = 'x'; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM platform.payment_details_versions; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  IF blocked <> 6 THEN RAISE EXCEPTION 'A358: append-only guards let % of 6 mutations through', 6 - blocked; END IF;
END
$a358_immutable$;

\echo A358_STUDENT_PAYMENT_RECEIPTS_SUITE_PASSED
ROLLBACK;
