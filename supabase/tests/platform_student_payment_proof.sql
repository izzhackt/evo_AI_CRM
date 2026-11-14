\set ON_ERROR_STOP on
-- Boundary suite for migration 360 «Чек студента к уже принятой оплате» (решение владельца 14.11.2026), on the real chain right after 360 inside
-- one transaction that is rolled back. Synthetic organization, members, cases and payments; no bytes, no Storage, no provider, no real person.
-- Staff roles are created through the real role commands (as in 358's suite): actor 4 holds the production «Admissions» key set WITHOUT
-- case.update.append, actor 5 (the case curator) holds the full set; actor 1 is the system Admin. Payments are recorded by the REAL command
-- record_case_payment_v1 (as the curator), so «an accepted payment recorded by staff without a file» is exactly the production shape.
--
-- Proves: posture (service/user doors, closed helper, closed files table, journal allowlist); the payment center keeps its exact shape and
-- exposes the payment event id as entry_id of a payment; the Student target check (own payment without a file, never a refund, never a
-- foreign payment, never a file that exists); the server record (a real file row by the Student, no new payment, totals and
-- status unchanged, replay by request id, conflict on a reused key, one proof per payment also against a staff file, path and shape
-- checks, foreign and staff authors refused); the Student and CRM both see the file; the journal row; the staff notification (same kind,
-- recipients, the receipt_proof mark and no mark on other notifications); nothing the Student can replace or remove.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A360_STUDENT_PAYMENT_PROOF_SUITE_START

CREATE FUNCTION pg_temp.a360_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a360_id(INTEGER) TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.a360_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A360: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a360_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a360_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, claims TEXT);
INSERT INTO a360_actors(n, coarse) VALUES (1, 'admin'), (2, 'student'), (3, 'student'), (4, NULL), (5, NULL), (6, NULL);
GRANT SELECT ON a360_actors TO authenticated;
CREATE FUNCTION pg_temp.a360_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_call('authenticated', (SELECT claims FROM a360_actors WHERE n = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a360_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a360_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;

-- Actors: 1 org Admin (positive control, creates the roles), 2 Student A (case 701), 3 Student B (case 702), 4 member who reads finance
-- summaries but cannot write money, 5 case curator and finance writer, 6 staff member with no role at all.
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a360_id(1), 'A360 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a360_id(100 + n), 'a360-' || n || '@example.invalid', '{}'::JSONB FROM a360_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a360_id(200 + n), pg_temp.a360_id(100 + n), 'A360 Actor ' || n, 'active', 1 FROM a360_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a360_id(300 + n), pg_temp.a360_id(1), pg_temp.a360_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM a360_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a360_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a360_id(401), pg_temp.a360_id(1), 'organization', pg_temp.a360_id(1), 1),
  (pg_temp.a360_id(421), pg_temp.a360_id(1), 'student_case', pg_temp.a360_id(701), 1),
  (pg_temp.a360_id(422), pg_temp.a360_id(1), 'student_case', pg_temp.a360_id(702), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a360_id(1), pg_temp.a360_id(301), pg_temp.a360_id(401), 1, 1, TRUE, 'system', 'A360 synthetic scope', pg_temp.a360_id(601)),
  (pg_temp.a360_id(1), pg_temp.a360_id(302), pg_temp.a360_id(401), 1, 1, TRUE, 'system', 'A360 synthetic scope', pg_temp.a360_id(602)),
  (pg_temp.a360_id(1), pg_temp.a360_id(302), pg_temp.a360_id(421), 1, 1, TRUE, 'system', 'A360 synthetic scope', pg_temp.a360_id(603)),
  (pg_temp.a360_id(1), pg_temp.a360_id(303), pg_temp.a360_id(401), 1, 1, TRUE, 'system', 'A360 synthetic scope', pg_temp.a360_id(604)),
  (pg_temp.a360_id(1), pg_temp.a360_id(303), pg_temp.a360_id(422), 1, 1, TRUE, 'system', 'A360 synthetic scope', pg_temp.a360_id(605));

-- Cases 701 (Student A) and 702 (Student B): active, portal activated; the curator of both is actor 5.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.a360_id(c.n), pg_temp.a360_id(1), pg_temp.a360_id(301), pg_temp.a360_id(305),
  'synthetic:a360:' || c.n, 'A360 Student ' || c.n, 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.a360_id(c.scope), 1, 'new', pg_temp.a360_id(c.student), clock_timestamp()
FROM (VALUES (701, 421, 302), (702, 422, 303)) AS c(n, scope, student);
SET LOCAL session_replication_role = origin;

-- Staff roles through the real commands (production key set): actor 4 = «Admissions» WITHOUT case.update.append, actor 5 = full.
CREATE TEMP TABLE a360_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a360_roles VALUES
  (pg_temp.a360_id(1101), 'Documents only', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1110),
  (pg_temp.a360_id(1102), 'Finance writer', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.update.append", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1120);
CREATE TEMP TABLE a360_grants(membership INTEGER, role_id UUID);
INSERT INTO a360_grants VALUES (304, pg_temp.a360_id(1101)), (305, pg_temp.a360_id(1102));
CREATE TEMP TABLE a360_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id WHERE m.organization_id = pg_temp.a360_id(1);
GRANT SELECT ON a360_roles, a360_grants, a360_versions TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a360_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a360_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a360_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a360_admin_setup';
SET LOCAL ROLE authenticated;
DO $a360_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a360_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a360_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A360 ' || r.label, 'description', 'Migration 360 synthetic role', 'permissionKeys', r.keys),
      'A360 create role', pg_temp.a360_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a360_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a360_id(1), r.role_id, 1) ->> 'impactFingerprint', 'A360 publish role', pg_temp.a360_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a360_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.a360_id(1), 'resourceKind', NULL))),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1))
      INTO items, bindings FROM a360_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a360_id(1), pg_temp.a360_id(m),
      (SELECT access_version FROM a360_versions WHERE membership_id = pg_temp.a360_id(m)), items, bindings, 'A360 grant role', pg_temp.a360_id(2000 + m));
  END LOOP;
END
$a360_roles$;
RESET ROLE;
UPDATE a360_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a360_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a360_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a360_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL) FROM a360_actors), 'fixture: every actor got claims from the real hook');

-- Money fixture. Case 701 (Student A): 7011 CNY 1000.00, 7012 USD 500.00. Case 702 (Student B): 7021 CNY 300.00.
-- (An archived payment cannot own a payment event: the archive is one-way and unpaid-only, so there is nothing to refuse there.)
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, created_by_membership_id)
SELECT pg_temp.a360_id(o.id), pg_temp.a360_id(1), pg_temp.a360_id(o.c), o.label, 'evo_service_fee', o.amount, o.cur, o.due, pg_temp.a360_id(305)
FROM (VALUES (7011, 701, 'Первый платёж', 100000, 'CNY', now() + INTERVAL '10 days'), (7012, 701, 'Второй платёж', 50000, 'USD', NULL::TIMESTAMPTZ),
  (7021, 702, 'Платёж B', 30000, 'CNY', now() + INTERVAL '5 days')) AS o(id, c, label, amount, cur, due);

-- The accepted payments are recorded by the REAL staff command, exactly as production does it: no file is attached.
CREATE FUNCTION pg_temp.a360_pay(p_case INTEGER, p_due INTEGER, p_amount BIGINT, p_cur TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_as(5, format('SELECT platform.record_case_payment_v1(%L,%L,%L,%L,%s,%L,%L,%L)', pg_temp.a360_id(1), pg_temp.a360_id(p_req),
    pg_temp.a360_id(p_case), pg_temp.a360_id(p_due), p_amount, p_cur, current_date, 'A360 synthetic payment'))
$$;
SELECT pg_temp.a360_pay(701, 7011, 60000, 'CNY', 8001) AS a360_p1 \gset
SELECT pg_temp.a360_pay(701, 7012, 10000, 'USD', 8002) AS a360_p2 \gset
SELECT pg_temp.a360_pay(702, 7021, 10000, 'CNY', 8003) AS a360_p3 \gset
SELECT pg_temp.a360_pay(701, 7011, 5000, 'CNY', 8005) AS a360_p5 \gset
SELECT pg_temp.a360_assert(NOT (:'a360_p1'::JSONB ? 'error') AND NOT (:'a360_p2'::JSONB ? 'error') AND NOT (:'a360_p3'::JSONB ? 'error')
  AND NOT (:'a360_p5'::JSONB ? 'error'), 'fixture: the curator records four payments through the real command: ' || :'a360_p1');
SELECT :'a360_p1'::JSONB ->> 'payment_event_id' AS a360_e1 \gset
SELECT :'a360_p2'::JSONB ->> 'payment_event_id' AS a360_e2 \gset
SELECT :'a360_p3'::JSONB ->> 'payment_event_id' AS a360_e3 \gset
SELECT :'a360_p5'::JSONB ->> 'payment_event_id' AS a360_e5 \gset
-- A refund event of case 701 (a fixture row: the refund command is outside this suite), and a staff-attached file on payment 2.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, referenced_payment_event_id, amount_minor,
  currency, occurred_at, source_key, actor_membership_id, request_id)
VALUES (pg_temp.a360_id(9900), pg_temp.a360_id(1), pg_temp.a360_id(701), pg_temp.a360_id(7011), 'refund', :'a360_e1', 100, 'CNY', clock_timestamp(),
  'a360_fixture', pg_temp.a360_id(305), pg_temp.a360_id(9901));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a360_svc(format('SELECT platform.record_payment_receipt_file_metadata(%L,%L,%L,%L,%L,2048,%L,%L,%L)', pg_temp.a360_id(1), :'a360_e2',
  pg_temp.a360_id(305), 'staff-check.pdf', 'application/pdf', repeat('b', 64),
  format('payment-receipts/%s/%s/%s', pg_temp.a360_id(1), pg_temp.a360_id(701), pg_temp.a360_id(9500)), pg_temp.a360_id(9501))) AS a360_staff_file \gset
SELECT pg_temp.a360_assert(NOT (:'a360_staff_file'::JSONB ? 'error'), 'fixture: staff attaches a file to payment 2 through the real command: ' || :'a360_staff_file');

CREATE FUNCTION pg_temp.a360_center(p_actor INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_as(p_actor, 'SELECT platform.student_portal_payment_center_v1()')
$$;
CREATE FUNCTION pg_temp.a360_due(p_center JSONB, p_due INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT d FROM jsonb_array_elements(p_center -> 'dues') d WHERE d ->> 'obligation_id' = pg_temp.a360_id(p_due)::TEXT
$$;
CREATE FUNCTION pg_temp.a360_entry(p_center JSONB, p_due INTEGER, p_event TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT e FROM jsonb_array_elements(pg_temp.a360_due(p_center, p_due) -> 'entries') e WHERE e ->> 'entry_id' = p_event
$$;
CREATE FUNCTION pg_temp.a360_target(p_actor INTEGER, p_event TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_as(p_actor, format('SELECT platform.student_payment_proof_target_v1(%L)', p_event))
$$;
CREATE FUNCTION pg_temp.a360_proof(p_student INTEGER, p_event TEXT, p_hash TEXT, p_req INTEGER, p_case INTEGER DEFAULT 701, p_object TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL, p_mime TEXT DEFAULT 'image/jpeg', p_size BIGINT DEFAULT 2048) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_svc(format('SELECT platform.record_student_payment_proof_v1(%L, %L, %L, %L, %L, %s, %L, %L, %L)',
    pg_temp.a360_id(1), pg_temp.a360_id(300 + p_student), p_event, COALESCE(p_name, 'bank-slip-' || p_req || '.jpg'), p_mime, p_size, repeat(p_hash, 64),
    COALESCE(p_object, format('payment-receipts/%s/%s/%s', pg_temp.a360_id(1), pg_temp.a360_id(p_case), pg_temp.a360_id(9000 + p_req))),
    pg_temp.a360_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a360_events(p_like TEXT) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a360_id(1) AND e.action LIKE p_like
$$;
CREATE TEMP TABLE a360_money_before AS SELECT
  (SELECT count(*) FROM platform.payment_events WHERE organization_id = pg_temp.a360_id(1)) AS events,
  (SELECT sum(total_paid_minor) FROM platform.payment_obligations WHERE organization_id = pg_temp.a360_id(1)) AS paid,
  (SELECT sum(total_refunded_minor) FROM platform.payment_obligations WHERE organization_id = pg_temp.a360_id(1)) AS refunded,
  (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.a360_id(1) AND action = 'finance.payment.record') AS payment_audits;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_assert(
  (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'record_student_payment_proof_v1'
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'student_payment_proof_target_v1'
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND NOT has_function_privilege('authenticated', 'platform_private.notify_student_payment_proof(uuid,uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.notify_student_payment_proof(uuid,uuid,uuid,uuid)'::regprocedure, 'EXECUTE'),
  'posture: the record is for service_role only, the target for authenticated only, the notifier closed');
SELECT pg_temp.a360_assert(
  NOT has_table_privilege('authenticated', 'platform.payment_receipt_files', 'INSERT') AND NOT has_table_privilege('authenticated', 'platform.payment_receipt_files', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'platform.payment_receipt_files', 'DELETE') AND NOT has_table_privilege('service_role', 'platform.payment_receipt_files', 'INSERT')
  AND NOT has_table_privilege('service_role', 'platform.payment_receipt_files', 'UPDATE') AND NOT has_table_privilege('service_role', 'platform.payment_receipt_files', 'DELETE'),
  'the receipt files table is closed for writes to every API role');
SELECT pg_temp.a360_assert('finance.receipt.attach' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('finance.receipt.attach' = ANY (platform_private.p7a_safe_audit_actions_pre_student_payment_proof()))
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_student_payment_proof()) + 1
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_actions_pre_student_payment_proof()) a WHERE NOT (a = ANY (platform_private.p7a_safe_audit_actions())))
  AND 'payment_receipt_file' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND 'finance.receipt.submit' = ANY (platform_private.p7a_safe_audit_actions()), 'the journal allowlist gained exactly finance.receipt.attach and kept the rest');
SELECT pg_temp.a360_assert(pg_temp.a360_as(2, 'SELECT count(*)::TEXT::JSONB FROM platform.payment_receipt_files') ->> 'error' = '42501'
  AND pg_temp.a360_as(2, format('SELECT platform.record_student_payment_proof_v1(%L,%L,%L,%L,%L,1,%L,%L,%L)', pg_temp.a360_id(1), pg_temp.a360_id(302), :'a360_e1',
    'x.jpg', 'image/jpeg', repeat('a', 64), 'payment-receipts/x', pg_temp.a360_id(9700))) ->> 'error' = '42501', 'a Student reads no files table and cannot call the server record');

-- ---------------------------------------------------------------------------
-- 2. The payment center keeps its shape; a payment entry carries the payment event id; the file column is empty until a file exists.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_center(2) AS a360_c0 \gset
SELECT pg_temp.a360_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a360_c0'::JSONB) k) = ARRAY['can_upload', 'details', 'dues', 'unassigned'],
  'the payment center has exactly its four keys: ' || :'a360_c0');
SELECT pg_temp.a360_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1')) k)
  = ARRAY['amount_minor', 'currency', 'entry_id', 'file_id', 'file_kind', 'filename', 'kind', 'on_date', 'reject_reason', 'status'],
  'a payment entry keeps its ten keys (both strict parsers stay valid)');
SELECT pg_temp.a360_assert(pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1') ->> 'kind' = 'payment' AND pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1') ->> 'status' = 'accepted'
  AND pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1') -> 'file_id' = 'null'::JSONB AND pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1') -> 'file_kind' = 'null'::JSONB,
  'entry_id of the accepted payment IS the payment event id, and it has no file yet');
SELECT pg_temp.a360_assert(pg_temp.a360_entry(:'a360_c0'::JSONB, 7012, :'a360_e2') ->> 'file_kind' = 'receipt' AND pg_temp.a360_entry(:'a360_c0'::JSONB, 7012, :'a360_e2') ->> 'filename' = 'staff-check.pdf',
  'the staff file shows on its payment');
SELECT pg_temp.a360_assert(pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, pg_temp.a360_id(9900)::TEXT) ->> 'kind' = 'refund', 'a refund is a separate entry of kind refund');

-- ---------------------------------------------------------------------------
-- 3. The Student target check (before any bytes are stored).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_target(2, :'a360_e1') AS a360_t_own \gset
SELECT pg_temp.a360_assert(:'a360_t_own'::JSONB ->> 'student_case_id' = pg_temp.a360_id(701)::TEXT AND :'a360_t_own'::JSONB ->> 'payment_event_id' = :'a360_e1'
  AND :'a360_t_own'::JSONB ->> 'student_membership_id' = pg_temp.a360_id(302)::TEXT AND :'a360_t_own'::JSONB ->> 'organization_id' = pg_temp.a360_id(1)::TEXT
  AND :'a360_t_own'::JSONB ->> 'payment_obligation_id' = pg_temp.a360_id(7011)::TEXT, 'the target resolves an own accepted payment without a file: ' || :'a360_t_own');
SELECT pg_temp.a360_assert(pg_temp.a360_err(pg_temp.a360_target(2, :'a360_e3')) = '42501' AND pg_temp.a360_err(pg_temp.a360_target(3, :'a360_e1')) = '42501',
  'another Student''s payment is refused (42501), both ways');
SELECT pg_temp.a360_assert(pg_temp.a360_err(pg_temp.a360_target(2, pg_temp.a360_id(9900)::TEXT)) = '42501'
  AND pg_temp.a360_err(pg_temp.a360_target(2, pg_temp.a360_id(9999)::TEXT)) = '42501'
  AND pg_temp.a360_err(pg_temp.a360_as(2, 'SELECT platform.student_payment_proof_target_v1(NULL)')) = '42501',
  'a refund, an unknown payment and NULL are refused with the same answer (42501)');
SELECT pg_temp.a360_as(2, format('SELECT platform.student_payment_proof_target_v1(%L)', :'a360_e2')) AS a360_t_has_file \gset
SELECT pg_temp.a360_assert(pg_temp.a360_err(:'a360_t_has_file'::JSONB) = '23505' AND :'a360_t_has_file'::JSONB ->> 'message' = 'proof_exists',
  'a payment that already has a file answers proof_exists: ' || :'a360_t_has_file');
SELECT pg_temp.a360_assert(pg_temp.a360_err(pg_temp.a360_target(1, :'a360_e1')) = '42501' AND pg_temp.a360_err(pg_temp.a360_target(5, :'a360_e1')) = '42501'
  AND pg_temp.a360_err(pg_temp.a360_target(6, :'a360_e1')) = '42501'
  AND pg_temp.a360_call('anon', '{"role":"anon"}', format('SELECT platform.student_payment_proof_target_v1(%L)', :'a360_e1')) ->> 'error' = '42501'
  AND pg_temp.a360_svc(format('SELECT platform.student_payment_proof_target_v1(%L)', :'a360_e1')) ->> 'error' = '42501',
  'staff, the admin, a member with no role, anon and service_role cannot use the Student door');

-- ---------------------------------------------------------------------------
-- 4. The server record: a real file row, money untouched.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_proof(2, :'a360_e1', 'a', 9101) AS a360_r1 \gset
SELECT pg_temp.a360_assert(NOT (:'a360_r1'::JSONB ? 'error') AND (:'a360_r1'::JSONB ->> 'replayed')::BOOLEAN IS FALSE
  AND :'a360_r1'::JSONB ->> 'payment_event_id' = :'a360_e1' AND :'a360_r1'::JSONB ->> 'original_filename' = 'bank-slip-9101.jpg', 'the Student attaches a file to an accepted payment: ' || :'a360_r1');
SELECT pg_temp.a360_assert((SELECT count(*) = 1 FROM platform.payment_receipt_files f WHERE f.id = (:'a360_r1'::JSONB ->> 'payment_receipt_file_id')::UUID
    AND f.payment_event_id = :'a360_e1'::UUID AND f.payment_obligation_id = pg_temp.a360_id(7011) AND f.student_case_id = pg_temp.a360_id(701)
    AND f.uploaded_by_membership_id = pg_temp.a360_id(302) AND f.declared_mime_type = 'image/jpeg' AND f.byte_size = 2048 AND f.sha256_hex = repeat('a', 64)
    AND f.storage_object_name = format('payment-receipts/%s/%s/%s', pg_temp.a360_id(1), pg_temp.a360_id(701), pg_temp.a360_id(9000 + 9101))),
  'the file row is the same table staff files use, authored by the Student, in the case folder');
SELECT pg_temp.a360_assert((SELECT events = (SELECT count(*) FROM platform.payment_events WHERE organization_id = pg_temp.a360_id(1))
    AND paid = (SELECT sum(total_paid_minor) FROM platform.payment_obligations WHERE organization_id = pg_temp.a360_id(1))
    AND refunded = (SELECT sum(total_refunded_minor) FROM platform.payment_obligations WHERE organization_id = pg_temp.a360_id(1))
    AND payment_audits = (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.a360_id(1) AND action = 'finance.payment.record')
    FROM a360_money_before),
  'proof only: no new payment event, no change of any total, no new payment journal row');
SELECT pg_temp.a360_proof(2, :'a360_e1', 'a', 9101) AS a360_r1_again \gset
SELECT pg_temp.a360_assert((:'a360_r1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND :'a360_r1_again'::JSONB ->> 'payment_receipt_file_id' = :'a360_r1'::JSONB ->> 'payment_receipt_file_id'
  AND :'a360_r1_again'::JSONB ->> 'original_filename' = 'bank-slip-9101.jpg'
  AND (SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE payment_event_id = :'a360_e1'::UUID), 'the same request id replays and adds no second file');
-- A retry after a lost answer reaches the target first: the file exists, so a plain check says proof_exists, but the same request (key, Student,
-- payment, hash) gets its earlier result back and nothing is uploaded again; a reused key with another file is a conflict.
CREATE FUNCTION pg_temp.a360_target_key(p_actor INTEGER, p_event TEXT, p_req INTEGER, p_hash TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a360_as(p_actor, format('SELECT platform.student_payment_proof_target_v1(%L, %L, %L)', p_event, pg_temp.a360_id(p_req), repeat(p_hash, 64)))
$$;
SELECT pg_temp.a360_target_key(2, :'a360_e1', 9101, 'a') AS a360_t_replay \gset
SELECT pg_temp.a360_assert(NOT (:'a360_t_replay'::JSONB ? 'error') AND :'a360_t_replay'::JSONB -> 'replay' ->> 'payment_receipt_file_id' = :'a360_r1'::JSONB ->> 'payment_receipt_file_id'
  AND :'a360_t_replay'::JSONB -> 'replay' ->> 'original_filename' = 'bank-slip-9101.jpg' AND :'a360_t_replay'::JSONB ->> 'student_case_id' = pg_temp.a360_id(701)::TEXT,
  'the target answers a retry of the same request with the earlier result: ' || :'a360_t_replay');
SELECT pg_temp.a360_assert(pg_temp.a360_target_key(2, :'a360_e1', 9101, 'c') ->> 'message' = 'request_conflict'
  AND pg_temp.a360_target_key(2, :'a360_e1', 9199, 'a') ->> 'message' = 'proof_exists'
  AND pg_temp.a360_as(2, format('SELECT platform.student_payment_proof_target_v1(%L, %L)', :'a360_e1', pg_temp.a360_id(9101))) -> 'replay' ->> 'payment_receipt_file_id' = :'a360_r1'::JSONB ->> 'payment_receipt_file_id'
  AND pg_temp.a360_err(pg_temp.a360_target_key(3, :'a360_e1', 9101, 'a')) = '42501'
  AND (SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE payment_event_id = :'a360_e1'::UUID),
  'the same key with another file is a conflict, a new key is proof_exists, no hash still replays, another Student is refused, and no file was added');
SELECT pg_temp.a360_assert(pg_temp.a360_proof(2, :'a360_e1', 'c', 9101) ->> 'message' = 'request_conflict'
  AND pg_temp.a360_proof(2, :'a360_e5', 'a', 9101) ->> 'message' = 'request_conflict'
  AND pg_temp.a360_proof(3, :'a360_e1', 'a', 9101, 701) ->> 'message' = 'request_conflict', 'a reused key with another file, payment or Student is a conflict');
SELECT pg_temp.a360_assert(pg_temp.a360_proof(2, :'a360_e1', 'd', 9102) ->> 'message' = 'proof_exists' AND pg_temp.a360_proof(2, :'a360_e1', 'a', 9103) ->> 'message' = 'proof_exists'
  AND (SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE payment_event_id = :'a360_e1'::UUID), 'one proof per payment: a second file under a new key is refused (proof_exists)');
SELECT pg_temp.a360_assert(pg_temp.a360_proof(2, :'a360_e2', 'e', 9104) ->> 'message' = 'proof_exists'
  AND (SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE payment_event_id = :'a360_e2'::UUID), 'a payment that already has a staff file is refused (proof_exists), the staff file stays alone');
SELECT pg_temp.a360_assert(pg_temp.a360_err(pg_temp.a360_proof(2, :'a360_e3', 'f', 9105)) = '42501' AND pg_temp.a360_err(pg_temp.a360_proof(3, :'a360_e5', 'f', 9106, 702)) = '42501'
  AND pg_temp.a360_err(pg_temp.a360_proof(2, pg_temp.a360_id(9900)::TEXT, 'f', 9107)) = '42501' AND pg_temp.a360_err(pg_temp.a360_proof(2, pg_temp.a360_id(9999)::TEXT, 'f', 9108)) = '42501'
  , 'another Student''s payment, a refund and an unknown payment are refused (42501)');
SELECT pg_temp.a360_assert(pg_temp.a360_err(pg_temp.a360_proof(5, :'a360_e5', 'f', 9110)) = '42501' AND pg_temp.a360_err(pg_temp.a360_proof(1, :'a360_e5', 'f', 9111)) = '42501',
  'a staff or admin membership cannot be the author (42501)');
SELECT pg_temp.a360_assert(pg_temp.a360_proof(2, :'a360_e5', 'f', 9112, 701, 'payment-receipts/elsewhere/x') ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_proof(2, :'a360_e5', 'f', 9113, 702) ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_proof(2, :'a360_e5', 'f', 9114, 701, NULL, NULL, 'text/html') ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_proof(2, :'a360_e5', 'f', 9115, 701, NULL, NULL, 'image/jpeg', 0) ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_proof(2, :'a360_e5', 'f', 9116, 701, NULL, NULL, 'image/jpeg', 26214401) ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_proof(2, :'a360_e5', 'f', 9117, 701, NULL, '   ') ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_svc(format('SELECT platform.record_student_payment_proof_v1(%L,%L,%L,%L,%L,10,%L,%L,%L)', pg_temp.a360_id(1), pg_temp.a360_id(302), :'a360_e5',
    'x.jpg', 'image/jpeg', 'not-a-hash', 'payment-receipts/x', pg_temp.a360_id(9118))) ->> 'message' = 'proof_invalid'
  AND pg_temp.a360_svc(format('SELECT platform.record_student_payment_proof_v1(%L,%L,%L,NULL,%L,10,%L,%L,%L)', pg_temp.a360_id(1), pg_temp.a360_id(302), :'a360_e5',
    'image/jpeg', repeat('f', 64), 'payment-receipts/x', pg_temp.a360_id(9119))) ->> 'message' = 'proof_invalid'
  AND NOT EXISTS (SELECT 1 FROM platform.payment_receipt_files WHERE payment_event_id = :'a360_e5'::UUID),
  'a foreign path, another case folder, a wrong type, empty and oversize files, a blank name, a bad hash and NULLs are invalid and write nothing');
-- A control character in the name never reaches the Student page, the CRM or the journal.
SELECT pg_temp.a360_proof(2, :'a360_e5', '7', 9120, 701, NULL, chr(7) || repeat('я', 300) || chr(27) || '.png', 'image/png') AS a360_r5 \gset
SELECT pg_temp.a360_assert((SELECT char_length(original_filename) = 255 AND original_filename !~ E'[\\x01-\\x1f\\x7f]' FROM platform.payment_receipt_files
    WHERE id = (:'a360_r5'::JSONB ->> 'payment_receipt_file_id')::UUID), 'the stored file name has no control characters and is cut to 255 characters: ' || :'a360_r5');

-- ---------------------------------------------------------------------------
-- 5. Student and CRM both see the file; the Student cannot change or remove it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_center(2) AS a360_c1 \gset
SELECT pg_temp.a360_assert(pg_temp.a360_entry(:'a360_c1'::JSONB, 7011, :'a360_e1') ->> 'file_kind' = 'receipt'
  AND pg_temp.a360_entry(:'a360_c1'::JSONB, 7011, :'a360_e1') ->> 'file_id' = :'a360_r1'::JSONB ->> 'payment_receipt_file_id'
  AND pg_temp.a360_entry(:'a360_c1'::JSONB, 7011, :'a360_e1') ->> 'filename' = 'bank-slip-9101.jpg'
  AND pg_temp.a360_entry(:'a360_c1'::JSONB, 7011, :'a360_e1') ->> 'status' = 'accepted'
  AND (pg_temp.a360_due(:'a360_c1'::JSONB, 7011) ->> 'paid_minor')::BIGINT = 65000
  AND (pg_temp.a360_due(:'a360_c1'::JSONB, 7011) ->> 'outstanding_minor')::BIGINT = 35000
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.a360_entry(:'a360_c1'::JSONB, 7011, :'a360_e1')) k)
    = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.a360_entry(:'a360_c0'::JSONB, 7011, :'a360_e1')) k),
  'the Student row now carries the file with an unchanged status, totals and the same key set: ' || :'a360_c1');
SELECT pg_temp.a360_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'receipt', :'a360_r1'::JSONB ->> 'payment_receipt_file_id')) AS a360_dl_own \gset
SELECT pg_temp.a360_as(3, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'receipt', :'a360_r1'::JSONB ->> 'payment_receipt_file_id')) AS a360_dl_other \gset
SELECT pg_temp.a360_assert(NOT (:'a360_dl_own'::JSONB ? 'error') AND :'a360_dl_own'::JSONB ->> 'storage_object_name' LIKE 'payment-receipts/%'
  AND pg_temp.a360_err(:'a360_dl_other'::JSONB) = '42501', 'the Student opens the own file, another Student cannot (42501)');
SELECT pg_temp.a360_as(5, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a360_id(701))) AS a360_crm \gset
SELECT pg_temp.a360_assert((:'a360_crm'::JSONB ->> 'can_write')::BOOLEAN IS TRUE
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'a360_crm'::JSONB -> 'payments') p, jsonb_array_elements(p -> 'receipts') r
      WHERE p ->> 'payment_event_id' = :'a360_e1' AND r ->> 'payment_receipt_file_id' = :'a360_r1'::JSONB ->> 'payment_receipt_file_id'
        AND r ->> 'original_filename' = 'bank-slip-9101.jpg'),
  'the CRM payment row data lists the Student file under its payment, with no new code on the staff side: ' || :'a360_crm');
SELECT pg_temp.a360_as(5, format('SELECT platform.staff_payment_receipt_download_target_v1(%L, %L)', pg_temp.a360_id(701), :'a360_r1'::JSONB ->> 'payment_receipt_file_id')) AS a360_crm_dl \gset
SELECT pg_temp.a360_assert(:'a360_crm_dl'::JSONB ->> 'storage_object_name' LIKE 'payment-receipts/%', 'the curator opens the Student file through the staff door: ' || :'a360_crm_dl');
SELECT pg_temp.a360_assert(pg_temp.a360_as(2, format('SELECT platform.staff_payment_receipt_download_target_v1(%L, %L)', pg_temp.a360_id(701), :'a360_r1'::JSONB ->> 'payment_receipt_file_id')) ->> 'error' = '42501',
  'the staff door stays closed to the Student');
DO $a360_closed$
DECLARE blocked INTEGER := 0;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN UPDATE platform.payment_receipt_files SET original_filename = 'x'; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM platform.payment_receipt_files; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  BEGIN UPDATE platform.payment_receipt_files SET original_filename = 'x'; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM platform.payment_receipt_files; EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  RESET ROLE;
  IF blocked <> 4 THEN RAISE EXCEPTION 'A360: the Student and the service role could change % of 4 file mutations', 4 - blocked; END IF;
END
$a360_closed$;
SELECT pg_temp.a360_assert((SELECT count(*) = 2 FROM platform.payment_receipt_files WHERE payment_event_id IN (:'a360_e1'::UUID, :'a360_e5'::UUID))
  AND (SELECT original_filename = 'bank-slip-9101.jpg' FROM platform.payment_receipt_files WHERE id = (:'a360_r1'::JSONB ->> 'payment_receipt_file_id')::UUID),
  'the files are still there, untouched');

-- ---------------------------------------------------------------------------
-- 6. Journal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_assert(pg_temp.a360_events('finance.receipt.attach') = 2
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.action = 'finance.receipt.attach' AND e.resource_type = 'payment_receipt_file'
      AND e.actor_membership_id = pg_temp.a360_id(302) AND e.actor_kind = 'user' AND e.actor_principal = 'auth:' || pg_temp.a360_id(102)::TEXT
      AND e.request_id IN (platform_private.p3c_request_child_id(pg_temp.a360_id(9101), 'audit'), platform_private.p3c_request_child_id(pg_temp.a360_id(9120), 'audit')))
  AND (SELECT e.after_state ->> 'payment_event_id' = :'a360_e1' AND e.after_state ->> 'payment_receipt_file_id' = e.resource_id::TEXT
      FROM platform.audit_events e WHERE e.action = 'finance.receipt.attach' AND e.request_id = platform_private.p3c_request_child_id(pg_temp.a360_id(9101), 'audit')),
  'two journal rows: author the Student, object the file, the payment event id in the state; refusals and the replay wrote none');

-- ---------------------------------------------------------------------------
-- 7. Staff notification: same kind, same recipients, a mark that only this notification carries.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a360_assert((SELECT count(*) = 1 FROM platform.staff_notifications WHERE kind = 'student_receipt' AND recipient_membership_id = pg_temp.a360_id(305)
      AND event_key = 'student-proof:' || (:'a360_r1'::JSONB ->> 'payment_receipt_file_id') AND student_case_id = pg_temp.a360_id(701) AND actor_membership_id = pg_temp.a360_id(302))
  AND (SELECT count(*) = 0 FROM platform.staff_notifications WHERE event_key LIKE 'student-proof:%' AND recipient_membership_id IN
      (pg_temp.a360_id(302), pg_temp.a360_id(303), pg_temp.a360_id(304), pg_temp.a360_id(306))),
  'the case curator is notified (kind student_receipt, key student-proof:<file>); a Student, a read-only member and a member without a role never');
SELECT pg_temp.a360_assert((SELECT count(*) = 2 FROM platform.staff_notifications WHERE event_key LIKE 'student-proof:%' AND recipient_membership_id = pg_temp.a360_id(305)),
  'one notification per attached file, none for refusals, none for the replay');
-- A pending Student receipt (358) produces the old notification; its page row must NOT carry the mark.
SELECT pg_temp.a360_svc(format('SELECT platform.record_student_payment_receipt_v1(%L,%L,%L,NULL,100,%L,%L,%L,%L,10,%L,%L,%L)', pg_temp.a360_id(1), pg_temp.a360_id(302), pg_temp.a360_id(701),
  'USD', current_date, 'old-flow.jpg', 'image/jpeg', repeat('9', 64), format('payment-receipts/%s/%s/%s', pg_temp.a360_id(1), pg_temp.a360_id(701), pg_temp.a360_id(9600)), pg_temp.a360_id(9601))) AS a360_old \gset
SELECT pg_temp.a360_assert(:'a360_old'::JSONB ->> 'status' = 'pending', 'fixture: a pending Student receipt of the 358 flow: ' || :'a360_old');
SELECT pg_temp.a360_as(5, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.a360_id(1))) AS a360_page \gset
SELECT pg_temp.a360_assert(NOT (:'a360_page'::JSONB ? 'error')
  AND (SELECT count(*) = 2 FROM jsonb_array_elements(:'a360_page'::JSONB -> 'items') i WHERE i ->> 'kind' = 'student_receipt' AND (i -> 'receipt_proof') = 'true'::JSONB)
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'a360_page'::JSONB -> 'items') i WHERE i ->> 'kind' = 'student_receipt' AND NOT (i ? 'receipt_proof'))
  AND (SELECT count(*) = 0 FROM jsonb_array_elements(:'a360_page'::JSONB -> 'items') i WHERE i ->> 'kind' <> 'student_receipt' AND (i ? 'receipt_proof')),
  'the staff page marks exactly the two proof notifications; the old receipt notification and every other row keep their exact keys: ' || :'a360_page');
SELECT pg_temp.a360_assert((SELECT bool_and((i ->> 'student_display_name') = 'A360 Student 701' AND (i ->> 'actor_display_name') = 'A360 Actor 2')
    FROM jsonb_array_elements(:'a360_page'::JSONB -> 'items') i WHERE i ->> 'kind' = 'student_receipt' AND (i ? 'receipt_proof')),
  'the proof notification names the Student and the case');
SELECT pg_temp.a360_assert(pg_temp.a360_as(4, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.a360_id(1))) -> 'items' = '[]'::JSONB
  AND pg_temp.a360_err(pg_temp.a360_as(2, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.a360_id(1)))) = '42501'
  AND pg_temp.a360_as(6, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.a360_id(1))) -> 'items' = '[]'::JSONB,
  'a member who got no notification sees none, a Student cannot read the staff page');

\echo A360_STUDENT_PAYMENT_PROOF_SUITE_PASSED
ROLLBACK;
