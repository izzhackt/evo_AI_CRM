\set ON_ERROR_STOP on
-- Boundary suite for migration 352 «Виды документов: доработки» (решение владельца 08.11.2026), on the real chain right after 352 inside
-- one transaction that is rolled back. Synthetic organization, members and cases; no bytes, no Storage, no provider, no real person.
-- Staff roles are created through the real role commands (as in 244's suite): a document-only curator holds the production
-- «Admissions» key set WITHOUT case.update.append (can sort case documents, cannot write money), the finance writer holds the full set.
--
-- Proves:
--  1. posture: record_pending_receipt_v1 for service_role only; the two student reads for authenticated only; the private case helper
--     closed to every API role; SECURITY DEFINER with an empty search_path;
--  2. queueing a receipt is a DOCUMENT action: the document-only curator queues one (and a repeat does not duplicate), the finance writer
--     queues one, a member without document.manage / a student membership / an unknown membership is refused (42501);
--  3. attaching stays a MONEY action: the document-only curator cannot attach (42501) and does not pass staff_case_agreement_v1.can_write,
--     the finance writer does and can; a repeat is safe; a second attach elsewhere is refused;
--  4. the Student reads only own files: the current contract (never the superseded one), attached receipts, pending receipts; exact shape
--     without amounts, payment ids, staff, hashes or storage names; Student B and staff get nothing; another file's id is 42501;
--  5. the Student target function: own contract / receipt / pending receipt resolve; another Student's, a wrong kind, an unknown id and a
--     staff caller are refused (42501), an invalid kind 22023.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A352_DOCUMENT_KIND_FOLLOWUPS_SUITE_START

CREATE FUNCTION pg_temp.a352_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a352_id(INTEGER) TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.a352_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A352: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a352_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a352_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, claims TEXT);
INSERT INTO a352_actors(n, coarse) VALUES (1, 'admin'), (2, 'student'), (3, 'student'), (4, NULL), (5, NULL), (6, NULL);
GRANT SELECT ON a352_actors TO authenticated;
CREATE FUNCTION pg_temp.a352_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a352_call('authenticated', (SELECT claims FROM a352_actors WHERE n = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a352_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a352_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a352_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;

-- Actors: 1 org Admin (positive control, creates the roles), 2 Student A (case 701), 3 Student B (case 702), 4 document-only curator,
-- 5 finance writer, 6 staff member with no role at all.
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a352_id(1), 'A352 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a352_id(100 + n), 'a352-' || n || '@example.invalid', '{}'::JSONB FROM a352_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a352_id(200 + n), pg_temp.a352_id(100 + n), 'A352 Actor ' || n, 'active', 1 FROM a352_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a352_id(300 + n), pg_temp.a352_id(1), pg_temp.a352_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM a352_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a352_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a352_id(401), pg_temp.a352_id(1), 'organization', pg_temp.a352_id(1), 1),
  (pg_temp.a352_id(421), pg_temp.a352_id(1), 'student_case', pg_temp.a352_id(701), 1),
  (pg_temp.a352_id(422), pg_temp.a352_id(1), 'student_case', pg_temp.a352_id(702), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a352_id(1), pg_temp.a352_id(301), pg_temp.a352_id(401), 1, 1, TRUE, 'system', 'A352 synthetic scope', pg_temp.a352_id(601)),
  (pg_temp.a352_id(1), pg_temp.a352_id(302), pg_temp.a352_id(401), 1, 1, TRUE, 'system', 'A352 synthetic scope', pg_temp.a352_id(602)),
  (pg_temp.a352_id(1), pg_temp.a352_id(302), pg_temp.a352_id(421), 1, 1, TRUE, 'system', 'A352 synthetic scope', pg_temp.a352_id(603)),
  (pg_temp.a352_id(1), pg_temp.a352_id(303), pg_temp.a352_id(401), 1, 1, TRUE, 'system', 'A352 synthetic scope', pg_temp.a352_id(604)),
  (pg_temp.a352_id(1), pg_temp.a352_id(303), pg_temp.a352_id(422), 1, 1, TRUE, 'system', 'A352 synthetic scope', pg_temp.a352_id(605));

-- Cases 701 (Student A) and 702 (Student B): active, portal activated.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.a352_id(c.n), pg_temp.a352_id(1), pg_temp.a352_id(301), pg_temp.a352_id(304),
  'synthetic:a352:' || c.n, 'A352 Student ' || c.n, 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.a352_id(c.scope), 1, 'new', pg_temp.a352_id(c.student), clock_timestamp()
FROM (VALUES (701, 421, 302), (702, 422, 303)) AS c(n, scope, student);
-- One checklist file (slot + version) per receipt plus one for a «Не нужное» file that must never reach the Student's money files.
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, created_by_membership_id)
SELECT pg_temp.a352_id(s.slot), pg_temp.a352_id(1), pg_temp.a352_id(s.c), NULL, 'custom', 'Файл ' || s.slot, 'Из amoCRM (не разобрано)', pg_temp.a352_id(301)
FROM (VALUES (821, 701), (822, 701), (823, 701), (824, 702)) AS s(slot, c);
INSERT INTO platform.document_versions(id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id)
SELECT pg_temp.a352_id(s.slot + 100), pg_temp.a352_id(1), pg_temp.a352_id(s.c), pg_temp.a352_id(s.slot), 1, 'a352-' || s.slot || '.png', 'image/png',
  128, repeat(to_hex(s.slot % 16), 64), 'a352-synthetic', pg_temp.a352_id(301)
FROM (VALUES (821, 701), (822, 701), (823, 701), (824, 702)) AS s(slot, c);
SET LOCAL session_replication_role = origin;

-- Staff roles through the real commands (production key set): curator = «Admissions» WITHOUT case.update.append, finance writer = full.
CREATE TEMP TABLE a352_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a352_roles VALUES
  (pg_temp.a352_id(1101), 'Documents only', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1110),
  (pg_temp.a352_id(1102), 'Finance writer', '["ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full", "case.read.summary", "case.route.manage", "case.update.append", "case.workflow.read", "client.read", "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download", "document.extract", "document.manage", "document.read.full", "document.review", "document.upload", "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage", "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign", "task.create", "task.manage", "task.visibility.manage", "visa.manage"]'::JSONB, 1120);
CREATE TEMP TABLE a352_grants(membership INTEGER, role_id UUID);
INSERT INTO a352_grants VALUES (304, pg_temp.a352_id(1101)), (305, pg_temp.a352_id(1102));
CREATE TEMP TABLE a352_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id WHERE m.organization_id = pg_temp.a352_id(1);
GRANT SELECT ON a352_roles, a352_grants, a352_versions TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a352_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a352_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a352_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a352_admin_setup';
SET LOCAL ROLE authenticated;
DO $a352_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a352_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a352_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A352 ' || r.label, 'description', 'Migration 352 synthetic role', 'permissionKeys', r.keys),
      'A352 create role', pg_temp.a352_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a352_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a352_id(1), r.role_id, 1) ->> 'impactFingerprint', 'A352 publish role', pg_temp.a352_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a352_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.a352_id(1), 'resourceKind', NULL))),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1))
      INTO items, bindings FROM a352_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a352_id(1), pg_temp.a352_id(m),
      (SELECT access_version FROM a352_versions WHERE membership_id = pg_temp.a352_id(m)), items, bindings, 'A352 grant role', pg_temp.a352_id(2000 + m));
  END LOOP;
END
$a352_roles$;
RESET ROLE;
UPDATE a352_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a352_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a352_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a352_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL) FROM a352_actors), 'fixture: every actor got claims from the real hook');

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a352_assert(
  (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'record_pending_receipt_v1'
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('student_portal_case_files_v1', 'student_portal_case_file_target_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE AND p.proname = 'student_portal_money_case_v1'
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'posture: record for service_role only; the two Student reads for authenticated only; the case helper closed; empty search_path');
SELECT pg_temp.a352_assert(
  (SELECT p.prosrc LIKE '%document.manage%' FROM pg_proc p WHERE p.oid = 'platform.record_pending_receipt_v1(uuid,uuid,uuid,uuid,text,text,bigint,text,text,uuid)'::REGPROCEDURE)
  AND (SELECT p.prosrc NOT LIKE '%case.update.append%' FROM pg_proc p WHERE p.oid = 'platform.record_pending_receipt_v1(uuid,uuid,uuid,uuid,text,text,bigint,text,text,uuid)'::REGPROCEDURE),
  'queueing asks for document.manage and never for the money write permission');

-- ---------------------------------------------------------------------------
-- 2. Queueing a receipt is a document action.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a352_queue(p_membership INTEGER, p_version INTEGER, p_case INTEGER, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a352_svc(format('SELECT platform.record_pending_receipt_v1(%L, %L, %L, %L, %L, %L, 128, %L, %L, %L)',
    pg_temp.a352_id(1), pg_temp.a352_id(p_case), pg_temp.a352_id(p_version), pg_temp.a352_id(p_membership), 'receipt-' || p_version || '.png', 'image/png',
    repeat(to_hex((p_version - 100) % 16), 64),
    format('payment-receipts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(p_case), pg_temp.a352_id(p_version)), pg_temp.a352_id(p_req)))
$$;
SELECT pg_temp.a352_queue(304, 921, 701, 9201) AS a352_q1 \gset
SELECT pg_temp.a352_queue(304, 921, 701, 9202) AS a352_q1_again \gset
SELECT pg_temp.a352_queue(305, 922, 701, 9203) AS a352_q2 \gset
SELECT pg_temp.a352_queue(306, 923, 701, 9204) AS a352_q_norole \gset
SELECT pg_temp.a352_queue(302, 923, 701, 9205) AS a352_q_student \gset
SELECT pg_temp.a352_svc(format('SELECT platform.record_pending_receipt_v1(%L, %L, %L, %L, %L, %L, 128, %L, %L, %L)',
  pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(923), gen_random_uuid(), 'x.png', 'image/png', repeat('3', 64), 'payment-receipts/x', pg_temp.a352_id(9206))) AS a352_q_unknown \gset
SELECT pg_temp.a352_assert(NOT (:'a352_q1'::JSONB ? 'error') AND (:'a352_q1'::JSONB ->> 'replayed')::BOOLEAN IS FALSE,
  'the document-only curator (document.manage, no case.update.append) queues a receipt');
SELECT pg_temp.a352_assert((:'a352_q1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE
  AND :'a352_q1'::JSONB ->> 'pending_receipt_id' = :'a352_q1_again'::JSONB ->> 'pending_receipt_id', 'queueing the same file twice does not duplicate it');
SELECT pg_temp.a352_assert(NOT (:'a352_q2'::JSONB ? 'error'), 'the finance writer queues a receipt too (document.manage)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_q_norole'::JSONB) = '42501', 'a member without document.manage cannot queue a receipt (42501)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_q_student'::JSONB) = '42501', 'a Student membership cannot queue a receipt (42501)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_q_unknown'::JSONB) = '42501', 'an unknown membership cannot queue a receipt (42501)');
SELECT pg_temp.a352_assert((SELECT count(*) = 2 FROM platform.case_pending_receipts WHERE organization_id = pg_temp.a352_id(1)), 'exactly two pending receipts exist');

-- ---------------------------------------------------------------------------
-- 3. Attaching stays a money action.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a352_as(4, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a352_id(701))) AS a352_ag_cur \gset
SELECT pg_temp.a352_as(5, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a352_id(701))) AS a352_ag_fin \gset
SELECT pg_temp.a352_assert((:'a352_ag_fin'::JSONB ->> 'can_write')::BOOLEAN IS TRUE, 'the finance writer passes the money write gate');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_ag_cur'::JSONB) = '42501' OR (:'a352_ag_cur'::JSONB ->> 'can_write')::BOOLEAN IS NOT TRUE,
  'the document-only curator does not pass the money write gate');
SELECT pg_temp.a352_as(5, format('SELECT platform.save_case_tranche_v1(%L, %L, %L, NULL, 500000, ''USD'', ''2026-12-31''::DATE, ''Транш 1'', FALSE)',
  pg_temp.a352_id(1), pg_temp.a352_id(9301), pg_temp.a352_id(701))) AS a352_tr \gset
SELECT pg_temp.a352_as(5, format('SELECT platform.record_case_payment_v1(%L, %L, %L, %L, 200000, ''USD'', ''2026-09-19''::DATE, NULL)',
  pg_temp.a352_id(1), pg_temp.a352_id(9302), pg_temp.a352_id(701), :'a352_tr'::JSONB ->> 'payment_obligation_id')) AS a352_pay \gset
SELECT pg_temp.a352_assert(NOT (:'a352_pay'::JSONB ? 'error'), 'fixture: the finance writer records a payment of the case');
SELECT (:'a352_pay'::JSONB ->> 'payment_event_id') AS a352_event \gset
SELECT pg_temp.a352_as(4, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a352_id(1), :'a352_q1'::JSONB ->> 'pending_receipt_id', :'a352_event', pg_temp.a352_id(9401))) AS a352_al_cur \gset
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_al_cur'::JSONB) = '42501', 'the document-only curator cannot attach a pending receipt to a payment (42501)');
SELECT pg_temp.a352_assert((SELECT count(*) = 0 FROM platform.payment_receipt_files WHERE organization_id = pg_temp.a352_id(1)), 'the refused attach created no receipt file');
SELECT pg_temp.a352_as(5, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a352_id(1), :'a352_q1'::JSONB ->> 'pending_receipt_id', :'a352_event', pg_temp.a352_id(9402))) AS a352_al_fin \gset
SELECT pg_temp.a352_as(5, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a352_id(1), :'a352_q1'::JSONB ->> 'pending_receipt_id', :'a352_event', pg_temp.a352_id(9403))) AS a352_al_again \gset
SELECT pg_temp.a352_as(5, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a352_id(1), :'a352_q1'::JSONB ->> 'pending_receipt_id', gen_random_uuid(), pg_temp.a352_id(9404))) AS a352_al_other \gset
SELECT pg_temp.a352_assert(NOT (:'a352_al_fin'::JSONB ? 'error') AND (:'a352_al_fin'::JSONB ->> 'replayed')::BOOLEAN IS FALSE, 'the finance writer attaches the pending receipt');
SELECT pg_temp.a352_assert((:'a352_al_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE, 'a repeat attach to the same payment is a safe replay');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_al_other'::JSONB) = '22023', 'a second attach to another payment is refused (22023)');
SELECT pg_temp.a352_assert((SELECT count(*) = 1 FROM platform.payment_receipt_files WHERE organization_id = pg_temp.a352_id(1)), 'exactly one receipt file is attached');

-- ---------------------------------------------------------------------------
-- 4. The Student reads only own files.
-- ---------------------------------------------------------------------------
-- Contract: one file, then a different file supersedes it (only the current one is shown). Case 702 has its own contract.
SELECT pg_temp.a352_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, 128, %L, %L, %L)',
  pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(304), 'old-contract.png', 'image/png', repeat('a', 64),
  format('case-contracts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(921)), pg_temp.a352_id(9501))) AS a352_c_old \gset
SELECT pg_temp.a352_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, 128, %L, %L, %L)',
  pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(304), 'contract.png', 'image/png', repeat('b', 64),
  format('case-contracts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(922)), pg_temp.a352_id(9502))) AS a352_c_new \gset
SELECT pg_temp.a352_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, 128, %L, %L, %L)',
  pg_temp.a352_id(1), pg_temp.a352_id(702), pg_temp.a352_id(304), 'other-contract.png', 'image/png', repeat('c', 64),
  format('case-contracts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(702), pg_temp.a352_id(924)), pg_temp.a352_id(9503))) AS a352_c_other \gset
SELECT pg_temp.a352_assert(NOT (:'a352_c_old'::JSONB ? 'error') AND NOT (:'a352_c_new'::JSONB ? 'error') AND NOT (:'a352_c_other'::JSONB ? 'error'), 'fixture: contracts recorded');
-- A pending receipt on case 701 (the second one was queued above by the finance writer) and one for Student B.
SELECT pg_temp.a352_queue(304, 924, 702, 9207) AS a352_q_b \gset
SELECT pg_temp.a352_assert(NOT (:'a352_q_b'::JSONB ? 'error'), 'fixture: a pending receipt of Student B');
SELECT pg_temp.a352_as(2, 'SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.file_kind, f.added_at), ''[]''::JSONB) FROM platform.student_portal_case_files_v1() f') AS a352_files_a \gset
SELECT pg_temp.a352_as(3, 'SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.file_kind, f.added_at), ''[]''::JSONB) FROM platform.student_portal_case_files_v1() f') AS a352_files_b \gset
SELECT pg_temp.a352_assert(jsonb_array_length(:'a352_files_a'::JSONB) = 3, 'Student A sees the current contract, one attached receipt and one pending receipt (3 rows)');
SELECT pg_temp.a352_assert((SELECT array_agg(e ->> 'file_kind' ORDER BY e ->> 'file_kind') FROM jsonb_array_elements(:'a352_files_a'::JSONB) e) = ARRAY['contract', 'pending_receipt', 'receipt'],
  'the kinds are contract, pending_receipt and receipt');
SELECT pg_temp.a352_assert((SELECT bool_and(e ?& ARRAY['file_kind', 'file_id', 'original_filename', 'declared_mime_type', 'byte_size', 'added_at'] AND (SELECT count(*) FROM jsonb_object_keys(e)) = 6)
  FROM jsonb_array_elements(:'a352_files_a'::JSONB) e), 'the shape is exactly six keys: no amounts, payment ids, staff, hashes or storage names');
SELECT pg_temp.a352_assert((SELECT count(*) = 1 FROM jsonb_array_elements(:'a352_files_a'::JSONB) e WHERE e ->> 'file_kind' = 'contract' AND e ->> 'original_filename' = 'contract.png'),
  'only the current contract is shown, never the superseded one');
SELECT pg_temp.a352_assert(NOT (:'a352_files_a'::JSONB::TEXT LIKE '%other-contract%') AND NOT (:'a352_files_a'::JSONB::TEXT LIKE '%receipt-924%'), 'Student A never sees Student B files');
SELECT pg_temp.a352_assert(jsonb_array_length(:'a352_files_b'::JSONB) = 2 AND :'a352_files_b'::JSONB::TEXT LIKE '%other-contract%' AND :'a352_files_b'::JSONB::TEXT LIKE '%receipt-924%'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'a352_files_b'::JSONB) e WHERE e ->> 'original_filename' IN ('contract.png', 'old-contract.png')), 'Student B sees only own contract and pending receipt');
SELECT pg_temp.a352_as(4, 'SELECT count(*) FROM platform.student_portal_case_files_v1()') AS a352_files_staff \gset
SELECT pg_temp.a352_as(5, 'SELECT count(*) FROM platform.student_portal_case_files_v1()') AS a352_files_fin \gset
SELECT pg_temp.a352_assert(:'a352_files_staff'::JSONB = '0'::JSONB AND :'a352_files_fin'::JSONB = '0'::JSONB, 'staff members get no Student files from the Student read');
SELECT pg_temp.a352_call('anon', '{"role":"anon"}', 'SELECT count(*) FROM platform.student_portal_case_files_v1()') AS a352_files_anon \gset
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_files_anon'::JSONB) = '42501', 'anon cannot call the Student read (42501)');

-- ---------------------------------------------------------------------------
-- 5. The Student target function.
-- ---------------------------------------------------------------------------
SELECT e ->> 'file_id' AS a352_f_contract FROM jsonb_array_elements(:'a352_files_a'::JSONB) e WHERE e ->> 'file_kind' = 'contract' \gset
SELECT e ->> 'file_id' AS a352_f_receipt FROM jsonb_array_elements(:'a352_files_a'::JSONB) e WHERE e ->> 'file_kind' = 'receipt' \gset
SELECT e ->> 'file_id' AS a352_f_pending FROM jsonb_array_elements(:'a352_files_a'::JSONB) e WHERE e ->> 'file_kind' = 'pending_receipt' \gset
SELECT e ->> 'file_id' AS a352_fb_contract FROM jsonb_array_elements(:'a352_files_b'::JSONB) e WHERE e ->> 'file_kind' = 'contract' \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'contract', :'a352_f_contract')) AS a352_t_contract \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'receipt', :'a352_f_receipt')) AS a352_t_receipt \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'pending_receipt', :'a352_f_pending')) AS a352_t_pending \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'contract', :'a352_fb_contract')) AS a352_t_foreign \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'receipt', :'a352_f_contract')) AS a352_t_wrongkind \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'contract', gen_random_uuid())) AS a352_t_unknown \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'passport', :'a352_f_contract')) AS a352_t_badkind \gset
SELECT pg_temp.a352_as(4, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'contract', :'a352_f_contract')) AS a352_t_staff \gset
SELECT pg_temp.a352_assert(:'a352_t_contract'::JSONB ->> 'storage_object_name' = format('case-contracts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(922))
  AND :'a352_t_receipt'::JSONB ->> 'storage_object_name' = format('payment-receipts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(921))
  AND :'a352_t_pending'::JSONB ->> 'storage_object_name' = format('payment-receipts/%s/%s/%s', pg_temp.a352_id(1), pg_temp.a352_id(701), pg_temp.a352_id(922)),
  'Student A resolves the own contract, attached receipt and pending receipt');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_foreign'::JSONB) = '42501', 'another Student''s file is refused (42501)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_wrongkind'::JSONB) = '42501', 'an own file under the wrong kind is refused (42501)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_unknown'::JSONB) = '42501', 'an unknown file id is refused (42501)');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_badkind'::JSONB) = '22023', 'an invalid kind is 22023');
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_staff'::JSONB) = '42501', 'a staff member cannot resolve a Student file (42501)');
-- A superseded contract is no longer downloadable by the Student.
SELECT id::TEXT AS a352_old_contract FROM platform.case_contract_files WHERE organization_id = pg_temp.a352_id(1) AND student_case_id = pg_temp.a352_id(701) AND superseded_at IS NOT NULL \gset
SELECT pg_temp.a352_as(2, format('SELECT platform.student_portal_case_file_target_v1(%L, %L)', 'contract', :'a352_old_contract')) AS a352_t_old \gset
SELECT pg_temp.a352_assert(pg_temp.a352_err(:'a352_t_old'::JSONB) = '42501', 'a superseded contract is not downloadable by the Student (42501)');

\echo A352_DOCUMENT_KIND_FOLLOWUPS_SUITE_PASSED
ROLLBACK;
