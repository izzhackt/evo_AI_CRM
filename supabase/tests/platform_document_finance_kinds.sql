\set ON_ERROR_STOP on
-- Boundary suite for migrations 348-349 «Виды документов дела: Договор, Чек об оплате, Не нужное, Другое» (решение владельца 08.11.2026).
-- Runs on the real chain right after 349 inside one transaction that is rolled back, with its own synthetic organizations, members and
-- cases. Files come through the REAL ingress RPCs (reserve_document_upload_after_ingress_scan / finalize_document_upload_with_scan).
-- No bytes, no Storage copy, no provider, no real person. The server steps (permission gate, Storage copy) are replayed by their
-- database halves: staff_case_agreement_v1.can_write is the gate, finance_document_source_v1 + record_case_contract_file_metadata /
-- record_pending_receipt_v1 are what the server calls with the service key.
--
-- Proves:
--  1. posture: the new table closed to every API role (RLS forced, no DELETE/TRUNCATE, only the one-time allocation UPDATE);
--     source / record functions for service_role only, read / allocate for authenticated only; empty search_path;
--  2. the curator decision accepts contract / other / not_needed (and still the old kinds), refuses an unknown kind;
--  3. finance_document_source_v1: only a clean current version of an active case; refused to authenticated; another case's version refused;
--  4. «Договор»: the gate (can_write) is true for the case's curator and false/refused for an unrelated Sales member; the contract lands as
--     the case's current contract; a repeat with the same request id creates nothing; a different file supersedes (still one current);
--  5. «Чек об оплате»: lands as a pending receipt (a repeat does not duplicate, two receipts per case are allowed), attaches to a payment
--     of the case (two receipts on one payment), never changes money, a foreign / missing payment is refused, a second attach elsewhere
--     is refused, an unrelated Sales member and another organization are refused;
--  6. «Не нужное»: remove_document_slot hides the slot (removed_at) and nothing is deleted; the no-delete trigger still refuses DELETE;
--     an unrelated Sales member is refused; the removed file is no longer a finance source.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A348_DOCUMENT_FINANCE_KINDS_SUITE_START

CREATE FUNCTION pg_temp.a348_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a348_id(INTEGER) TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.a348_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A348: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a348_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a348_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a348_claims TO authenticated;
CREATE FUNCTION pg_temp.a348_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a348_call('authenticated', (SELECT claims FROM a348_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a348_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a348_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a348_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a348_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a348_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;
CREATE FUNCTION pg_temp.a348_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'message' $$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 org 1 Admin, 2 org 1 student with a portal (allowed), 3 org 1 student with a portal (undecided),
-- 4 org 1 student with a portal (declined), 5 org 2 Admin, 6 org 1 Sales member (no document.manage, no case access), 7 org 1 curator
-- with no role assignment and no scope on the cases. Both are refused; the Admin (actor 1) is the positive control throughout.
-- Cases (org 1, active unless noted): 701 no portal, 702 portal allowed, 703 portal undecided, 704 portal declined,
-- 705 no portal but NOT active. Each has one amoCRM-group file; case 701 also has a file in an ordinary group.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a348_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a348_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 1, 'student', FALSE), (4, 1, 'student', FALSE),
  (5, 2, 'admin', TRUE), (6, 1, 'sales', FALSE), (7, 1, 'curator', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a348_id(1), 'A348 Fictional organization', 'active'), (pg_temp.a348_id(2), 'A348 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a348_id(100 + n), 'a348-' || n || '@example.invalid', '{}'::JSONB FROM a348_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a348_id(200 + n), pg_temp.a348_id(100 + n), 'A348 Actor ' || n, 'active', 1 FROM a348_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a348_id(300 + a.n), pg_temp.a348_id(a.org), pg_temp.a348_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a348_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a348_id(300 + n) FROM a348_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a348_id(401), pg_temp.a348_id(1), 'organization', pg_temp.a348_id(1), 1),
  (pg_temp.a348_id(402), pg_temp.a348_id(2), 'organization', pg_temp.a348_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a348_id(1), pg_temp.a348_id(301), pg_temp.a348_id(401), 1, 1, TRUE, 'system', 'A348 synthetic scope', pg_temp.a348_id(601)),
  (pg_temp.a348_id(2), pg_temp.a348_id(305), pg_temp.a348_id(402), 1, 1, TRUE, 'system', 'A348 synthetic scope', pg_temp.a348_id(602));
CREATE FUNCTION pg_temp.a348_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a348_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a348_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a348_claims(actor, claims) SELECT a.n, pg_temp.a348_claims_for(a.n) FROM a348_actors a;
SELECT pg_temp.a348_assert((SELECT count(*) = 7 AND bool_and(claims IS NOT NULL) FROM a348_claims), 'every fixture actor got claims from the real hook');

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, next_action, created_at, updated_at)
SELECT pg_temp.a348_id(c.n), pg_temp.a348_id(1), CASE WHEN c.student IS NULL THEN NULL ELSE pg_temp.a348_id(300 + c.student) END,
  pg_temp.a348_id(301), CASE WHEN c.state = 'active' THEN pg_temp.a348_id(301) END, 'a348-case-' || c.n, 'A348 Fictional Student ' || c.n, 'China', 'bachelor', 'CN', '2027-09',
  'intake', c.state::platform.student_case_state, CASE WHEN c.state = 'active' THEN clock_timestamp() - INTERVAL '3 days' END, NULL,
  pg_temp.a348_id(401), 1, 'CN', 'documents', NULL, clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'
FROM (VALUES (701, NULL::INTEGER, 'active'), (702, NULL::INTEGER, 'active')) AS c(n, student, state);
SET LOCAL session_replication_role = origin;

-- Slots (case 701: a contract file, two receipts, a not-needed file, a third receipt; case 702: one file).
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, created_by_membership_id)
SELECT pg_temp.a348_id(s.slot), pg_temp.a348_id(1), pg_temp.a348_id(s.c), NULL, 'custom', s.label, 'Из amoCRM (не разобрано)', pg_temp.a348_id(301)
FROM (VALUES (821, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000001.png'), (822, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000002.png'),
  (823, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000003.png'), (824, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000004.png'),
  (825, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000005.png'), (827, 701, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000007.png'), (826, 702, 'Файл amoCRM: 00000000-bbbb-4000-8000-000000000006.png'))
  AS s(slot, c, label);
INSERT INTO storage.buckets(id, name, public) VALUES ('platform-documents', 'platform-documents', FALSE) ON CONFLICT DO NOTHING;
CREATE FUNCTION pg_temp.a348_upload(p_slot INTEGER, p_hash CHAR) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE up JSONB;
BEGIN
  up := pg_temp.a348_svc(format('SELECT platform.reserve_document_upload_after_ingress_scan(%L, %L, %L, %L, %L, 128, %L, %L, %L, %L, %L, %L, statement_timestamp(), %L)',
    pg_temp.a348_id(1), pg_temp.a348_id(101), pg_temp.a348_id(p_slot), 'synthetic.png', 'image/png', repeat(p_hash, 64),
    'clean', 'ClamAV', '1.5.3', '27889', 'clamd-zinstream-v1', gen_random_uuid()));
  IF up ? 'error' THEN RAISE EXCEPTION 'A348: reserve failed: %', up; END IF;
  INSERT INTO storage.objects(bucket_id, name, metadata, created_at)
    VALUES (up ->> 'bucket_id', up ->> 'object_name', '{"size":128,"mimetype":"image/png"}', statement_timestamp());
  up := up || pg_temp.a348_svc(format('SELECT platform.finalize_document_upload_with_scan(%L, %L, %L, %L, %L, %L, %L, statement_timestamp(), %L)',
    pg_temp.a348_id(1), up ->> 'upload_reservation_id', 'ClamAV', '1.5.3', '27889', 'clamd-zinstream-v1', repeat(p_hash, 64), gen_random_uuid()));
  IF up ? 'error' THEN RAISE EXCEPTION 'A348: finalize failed: %', up; END IF;
  RETURN (up ->> 'document_version_id')::UUID;
END
$$;
SELECT pg_temp.a348_upload(821, 'a') AS a348_v1 \gset
SELECT pg_temp.a348_upload(822, 'b') AS a348_v2 \gset
SELECT pg_temp.a348_upload(823, 'c') AS a348_v3 \gset
SELECT pg_temp.a348_upload(824, 'd') AS a348_v4 \gset
SELECT pg_temp.a348_upload(825, 'e') AS a348_v5 \gset
SELECT pg_temp.a348_upload(826, 'f') AS a348_v6 \gset
SELECT set_config('a348.org', pg_temp.a348_id(1)::TEXT, FALSE), set_config('a348.case', pg_temp.a348_id(701)::TEXT, FALSE);

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a348_assert(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform.case_pending_receipts'::REGCLASS)
  AND NOT has_table_privilege('authenticated', 'platform.case_pending_receipts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform.case_pending_receipts', 'INSERT')
  AND NOT has_table_privilege('service_role', 'platform.case_pending_receipts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform.case_pending_receipts', 'INSERT')
  AND NOT has_table_privilege('anon', 'platform.case_pending_receipts', 'SELECT'),
  'posture: the pending receipts table is closed to every API role with row security forced');
SELECT pg_temp.a348_assert(
  (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('finance_document_source_v1', 'record_pending_receipt_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 3 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('staff_case_pending_receipts_v1', 'allocate_pending_receipt_v1', 'staff_resolve_document_suggestion_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')),
  'posture: source/record for service_role only; read/allocate/resolve for authenticated only; SECURITY DEFINER with an empty search_path');

-- ---------------------------------------------------------------------------
-- 2. The curator decision: the new kinds, the old ones, an unknown one.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''contract'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v1'::UUID, pg_temp.a348_id(9001))) AS a348_r1 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''payment_receipt'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v2'::UUID, pg_temp.a348_id(9002))) AS a348_r2 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''other'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v5'::UUID, pg_temp.a348_id(9003))) AS a348_r3 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''not_needed'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v4'::UUID, pg_temp.a348_id(9004))) AS a348_r4 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''driving_licence'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v3'::UUID, pg_temp.a348_id(9005))) AS a348_rbad \gset
SELECT pg_temp.a348_as(6, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''contract'', %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v3'::UUID, pg_temp.a348_id(9006))) AS a348_r6 \gset
SELECT pg_temp.a348_assert(:'a348_r1'::JSONB ->> 'chosen_kind_key' = 'contract' AND :'a348_r1'::JSONB ->> 'resolution' = 'chosen_without_suggestion'
  AND :'a348_r2'::JSONB ->> 'chosen_kind_key' = 'payment_receipt' AND :'a348_r3'::JSONB ->> 'chosen_kind_key' = 'other'
  AND :'a348_r4'::JSONB ->> 'chosen_kind_key' = 'not_needed', 'contract / receipt / other / not_needed decisions are recorded');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_rbad'::JSONB) = '22023', 'an unknown kind is refused (22023)');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_r6'::JSONB) = '42501', 'a Sales member with no case access cannot record the decision (42501)');
SELECT pg_temp.a348_assert((SELECT count(*) = 4 FROM platform_private.document_classification_resolutions
  WHERE organization_id = pg_temp.a348_id(1) AND chosen_kind_key IN ('contract', 'payment_receipt', 'other', 'not_needed')), 'four new decisions stored');

-- ---------------------------------------------------------------------------
-- 3. finance_document_source_v1.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a348_svc(format('SELECT platform.finance_document_source_v1(%L, %L, %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v1'::UUID)) AS a348_s1 \gset
SELECT pg_temp.a348_svc(format('SELECT platform.finance_document_source_v1(%L, %L, %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v6'::UUID)) AS a348_s_foreign \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.finance_document_source_v1(%L, %L, %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v1'::UUID)) AS a348_s_auth \gset
SELECT pg_temp.a348_assert(:'a348_s1'::JSONB ->> 'object_name' ~ '^[0-9a-f]{2}/[0-9a-f]{62}$' AND :'a348_s1'::JSONB ->> 'sha256_hex' = repeat('a', 64)
  AND :'a348_s1'::JSONB ->> 'declared_mime_type' = 'image/png', 'the source of a clean current version is returned');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_s_foreign'::JSONB) = '22023', 'a version of another case is not a source (22023)');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_s_auth'::JSONB) = '42501', 'authenticated cannot read the source (42501)');

-- ---------------------------------------------------------------------------
-- 4. «Договор»: gate, contract lands, repeat does not duplicate, a different file supersedes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a348_id(701))) AS a348_ag_admin \gset
SELECT pg_temp.a348_as(6, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a348_id(701))) AS a348_ag_sales \gset
SELECT pg_temp.a348_assert((:'a348_ag_admin'::JSONB ->> 'can_write')::BOOLEAN IS TRUE, 'the case curator passes the finance write gate');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_ag_sales'::JSONB) = '42501' OR (:'a348_ag_sales'::JSONB ->> 'can_write')::BOOLEAN IS NOT TRUE,
  'an unrelated Sales member does not pass the finance write gate (the server then refuses the whole accept)');
SELECT pg_temp.a348_assert(:'a348_ag_admin'::JSONB -> 'contract_current' = 'null'::JSONB, 'no contract before the accept');
SELECT format('case-contracts/%s/%s/%s', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v1') AS a348_obj1 \gset
SELECT pg_temp.a348_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, %s, %L, %L, %L)',
  pg_temp.a348_id(1), pg_temp.a348_id(701), pg_temp.a348_id(301), :'a348_s1'::JSONB ->> 'original_filename', :'a348_s1'::JSONB ->> 'declared_mime_type',
  :'a348_s1'::JSONB ->> 'byte_size', :'a348_s1'::JSONB ->> 'sha256_hex', :'a348_obj1', pg_temp.a348_id(9101))) AS a348_c1 \gset
SELECT pg_temp.a348_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, %s, %L, %L, %L)',
  pg_temp.a348_id(1), pg_temp.a348_id(701), pg_temp.a348_id(301), :'a348_s1'::JSONB ->> 'original_filename', :'a348_s1'::JSONB ->> 'declared_mime_type',
  :'a348_s1'::JSONB ->> 'byte_size', :'a348_s1'::JSONB ->> 'sha256_hex', :'a348_obj1', pg_temp.a348_id(9101))) AS a348_c1_again \gset
SELECT pg_temp.a348_assert(NOT (:'a348_c1'::JSONB ? 'error') AND :'a348_c1'::JSONB = :'a348_c1_again'::JSONB, 'accepting the same file twice returns the same contract');
SELECT pg_temp.a348_assert((SELECT count(*) = 1 AND count(*) FILTER (WHERE superseded_at IS NULL) = 1 FROM platform.case_contract_files
  WHERE organization_id = pg_temp.a348_id(1) AND student_case_id = pg_temp.a348_id(701)), 'exactly one contract exists after the repeat');
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a348_id(701))) AS a348_ag_after \gset
SELECT pg_temp.a348_assert(:'a348_ag_after'::JSONB #>> '{contract_current,case_contract_file_id}' = :'a348_c1'::JSONB ->> 'case_contract_file_id',
  'the Money block shows the accepted file as the current contract');
-- A different file «Договор» replaces the current one by the 189 rules (the old one goes to history).
SELECT pg_temp.a348_svc(format('SELECT platform.record_case_contract_file_metadata(%L, %L, %L, %L, %L, %s, %L, %L, %L)',
  pg_temp.a348_id(1), pg_temp.a348_id(701), pg_temp.a348_id(301), 'second.png', 'image/png', 128, repeat('9', 64),
  format('case-contracts/%s/%s/%s', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v3'), pg_temp.a348_id(9102))) AS a348_c2 \gset
SELECT pg_temp.a348_assert(NOT (:'a348_c2'::JSONB ? 'error') AND (SELECT count(*) = 2 AND count(*) FILTER (WHERE superseded_at IS NULL) = 1
  FROM platform.case_contract_files WHERE organization_id = pg_temp.a348_id(1) AND student_case_id = pg_temp.a348_id(701)),
  'a different contract supersedes: two rows, one current');

-- ---------------------------------------------------------------------------
-- 5. «Чек об оплате»: pending receipts, two per case, attach to a payment, money untouched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a348_pending(p_version UUID, p_req INTEGER, p_case INTEGER DEFAULT 701) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE src JSONB;
BEGIN
  src := pg_temp.a348_svc(format('SELECT platform.finance_document_source_v1(%L, %L, %L)', pg_temp.a348_id(1), pg_temp.a348_id(p_case), p_version));
  IF src ? 'error' THEN RETURN src; END IF;
  RETURN pg_temp.a348_svc(format('SELECT platform.record_pending_receipt_v1(%L, %L, %L, %L, %L, %L, %s, %L, %L, %L)',
    pg_temp.a348_id(1), pg_temp.a348_id(p_case), p_version, pg_temp.a348_id(301), src ->> 'original_filename', src ->> 'declared_mime_type',
    src ->> 'byte_size', src ->> 'sha256_hex',
    format('payment-receipts/%s/%s/%s', pg_temp.a348_id(1), pg_temp.a348_id(p_case), p_version), pg_temp.a348_id(p_req)));
END
$$;
SELECT pg_temp.a348_pending(:'a348_v2'::UUID, 9201) AS a348_p1 \gset
SELECT pg_temp.a348_pending(:'a348_v2'::UUID, 9202) AS a348_p1_again \gset
SELECT pg_temp.a348_pending(:'a348_v3'::UUID, 9203) AS a348_p2 \gset
SELECT pg_temp.a348_assert(NOT (:'a348_p1'::JSONB ? 'error') AND (:'a348_p1'::JSONB ->> 'replayed')::BOOLEAN IS FALSE
  AND (:'a348_p1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND :'a348_p1'::JSONB ->> 'pending_receipt_id' = :'a348_p1_again'::JSONB ->> 'pending_receipt_id',
  'accepting the same receipt file twice does not duplicate it');
SELECT pg_temp.a348_assert((:'a348_p2'::JSONB ->> 'pending_receipt_id') <> (:'a348_p1'::JSONB ->> 'pending_receipt_id')
  AND (SELECT count(*) = 2 FROM platform.case_pending_receipts WHERE organization_id = pg_temp.a348_id(1) AND student_case_id = pg_temp.a348_id(701)),
  'two receipts per case are allowed');
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_pending_receipts_v1(%L)', pg_temp.a348_id(701))) AS a348_list \gset
SELECT pg_temp.a348_as(6, format('SELECT platform.staff_case_pending_receipts_v1(%L)', pg_temp.a348_id(701))) AS a348_list_sales \gset
SELECT pg_temp.a348_assert(jsonb_array_length(:'a348_list'::JSONB -> 'receipts') = 2, 'the finance read lists both pending receipts');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_list_sales'::JSONB) = '42501', 'an unrelated Sales member cannot read the pending receipts (42501)');
-- A payment of the case (existing 189 commands).
SELECT pg_temp.a348_as(1, format('SELECT platform.save_case_tranche_v1(%L, %L, %L, NULL, 500000, ''USD'', ''2026-12-31''::DATE, ''Транш 1'', FALSE)',
  pg_temp.a348_id(1), pg_temp.a348_id(9301), pg_temp.a348_id(701))) AS a348_tr \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.record_case_payment_v1(%L, %L, %L, %L, 200000, ''USD'', ''2026-09-19''::DATE, NULL)',
  pg_temp.a348_id(1), pg_temp.a348_id(9302), pg_temp.a348_id(701), :'a348_tr'::JSONB ->> 'payment_obligation_id')) AS a348_pay \gset
SELECT pg_temp.a348_assert(NOT (:'a348_pay'::JSONB ? 'error'), 'fixture: a payment of the case is recorded');
SELECT (:'a348_pay'::JSONB ->> 'payment_event_id') AS a348_event \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a348_id(701))) AS a348_ag_before \gset
-- Refusals first: an unrelated Sales member, another organization's admin, a payment that does not exist (a fresh third receipt).
SELECT pg_temp.a348_upload(827, '8') AS a348_v7 \gset
SELECT pg_temp.a348_pending(:'a348_v7'::UUID, 9204) AS a348_p3 \gset
SELECT pg_temp.a348_as(6, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p1'::JSONB ->> 'pending_receipt_id', :'a348_event', pg_temp.a348_id(9401))) AS a348_al_sales \gset
SELECT pg_temp.a348_as(5, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p1'::JSONB ->> 'pending_receipt_id', :'a348_event', pg_temp.a348_id(9402))) AS a348_al_foreign \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p3'::JSONB ->> 'pending_receipt_id', gen_random_uuid(), pg_temp.a348_id(9403))) AS a348_al_missing \gset
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_al_sales'::JSONB) = '42501' AND pg_temp.a348_err(:'a348_al_foreign'::JSONB) = '42501',
  'an unrelated Sales member and another organization cannot attach a receipt (42501)');
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_al_missing'::JSONB) = '22023' AND pg_temp.a348_msg(:'a348_al_missing'::JSONB) = 'payment_event_unavailable',
  'a payment that does not exist is refused (22023)');
-- Two receipts on one payment.
SELECT pg_temp.a348_as(1, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p1'::JSONB ->> 'pending_receipt_id', :'a348_event', pg_temp.a348_id(9404))) AS a348_al1 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p2'::JSONB ->> 'pending_receipt_id', :'a348_event', pg_temp.a348_id(9405))) AS a348_al2 \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p1'::JSONB ->> 'pending_receipt_id', :'a348_event', pg_temp.a348_id(9406))) AS a348_al1_again \gset
SELECT pg_temp.a348_as(1, format('SELECT platform.allocate_pending_receipt_v1(%L, %L, %L, %L)', pg_temp.a348_id(1), :'a348_p1'::JSONB ->> 'pending_receipt_id', gen_random_uuid(), pg_temp.a348_id(9407))) AS a348_al1_other \gset
SELECT pg_temp.a348_assert(NOT (:'a348_al1'::JSONB ? 'error') AND NOT (:'a348_al2'::JSONB ? 'error')
  AND (:'a348_al1_again'::JSONB ->> 'replayed')::BOOLEAN IS TRUE AND :'a348_al1_again'::JSONB ->> 'payment_receipt_file_id' = :'a348_al1'::JSONB ->> 'payment_receipt_file_id',
  'two receipts attach to one payment; a repeat is a replay');
SELECT pg_temp.a348_assert(pg_temp.a348_msg(:'a348_al1_other'::JSONB) = 'receipt_already_allocated', 'an attached receipt cannot be attached elsewhere');
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_agreement_v1(%L)', pg_temp.a348_id(701))) AS a348_ag_final \gset
SELECT pg_temp.a348_assert(jsonb_array_length(:'a348_ag_final'::JSONB -> 'payments' -> 0 -> 'receipts') = 2, 'the payment shows both receipts in the Money block');
SELECT pg_temp.a348_assert(:'a348_ag_final'::JSONB ->> 'paid_minor' = :'a348_ag_before'::JSONB ->> 'paid_minor'
  AND :'a348_ag_final'::JSONB ->> 'remaining_minor' IS NOT DISTINCT FROM :'a348_ag_before'::JSONB ->> 'remaining_minor'
  AND :'a348_ag_final'::JSONB -> 'tranches' = :'a348_ag_before'::JSONB -> 'tranches' AND :'a348_ag_final'::JSONB ->> 'paid_minor' = '200000',
  'attaching receipts never changes money');
SELECT pg_temp.a348_as(1, format('SELECT platform.staff_case_pending_receipts_v1(%L)', pg_temp.a348_id(701))) AS a348_list_after \gset
SELECT pg_temp.a348_assert(jsonb_array_length(:'a348_list_after'::JSONB -> 'receipts') = 1, 'only the not yet attached receipt stays in the waiting list');
DO $a348_pending_guard$
BEGIN
  BEGIN
    UPDATE platform.case_pending_receipts SET original_filename = 'changed.png';
    RAISE EXCEPTION 'A348: update of a pending receipt was allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A348:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM platform.case_pending_receipts;
    RAISE EXCEPTION 'A348: delete of a pending receipt was allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A348:%' THEN RAISE; END IF;
  END;
END
$a348_pending_guard$;

-- ---------------------------------------------------------------------------
-- 6. «Не нужное»: hides without deleting.
-- ---------------------------------------------------------------------------
SELECT version::TEXT AS a348_slot4_version FROM platform.document_slots WHERE id = pg_temp.a348_id(824) \gset
SELECT pg_temp.a348_as(6, format('SELECT platform.remove_document_slot(%L, %L, %L, %s, ''Отмечено как не нужное'', %L)',
  pg_temp.a348_id(1), pg_temp.a348_id(701), pg_temp.a348_id(824), :'a348_slot4_version', pg_temp.a348_id(9501))) AS a348_rm_sales \gset
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_rm_sales'::JSONB) = '42501', 'an unrelated Sales member cannot hide a file (42501)');
SELECT pg_temp.a348_as(1, format('SELECT platform.remove_document_slot(%L, %L, %L, %s, ''Отмечено как не нужное'', %L)',
  pg_temp.a348_id(1), pg_temp.a348_id(701), pg_temp.a348_id(824), :'a348_slot4_version', pg_temp.a348_id(9502))) AS a348_rm \gset
SELECT pg_temp.a348_assert(NOT (:'a348_rm'::JSONB ? 'error'), 'the curator hides the file');
SELECT pg_temp.a348_assert((SELECT count(*) = 1 AND bool_and(removed_at IS NOT NULL) FROM platform.document_slots WHERE id = pg_temp.a348_id(824))
  AND (SELECT count(*) = 1 FROM platform.document_versions WHERE id = :'a348_v4'::UUID),
  'the slot is hidden (removed_at) and neither the slot nor its file version is deleted');
DO $a348_no_delete$
BEGIN
  BEGIN
    DELETE FROM platform.document_slots WHERE id = ('34800000-0000-4000-8000-' || lpad('824', 12, '0'))::UUID;
    RAISE EXCEPTION 'A348: delete of a document slot was allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A348:%' THEN RAISE; END IF;
  END;
END
$a348_no_delete$;
SELECT pg_temp.a348_assert((SELECT count(*) = 1 FROM platform.document_slots WHERE id = pg_temp.a348_id(824)), 'the no-delete trigger still refuses DELETE');
SELECT pg_temp.a348_svc(format('SELECT platform.finance_document_source_v1(%L, %L, %L)', pg_temp.a348_id(1), pg_temp.a348_id(701), :'a348_v4'::UUID)) AS a348_s_removed \gset
SELECT pg_temp.a348_assert(pg_temp.a348_err(:'a348_s_removed'::JSONB) = '22023', 'a hidden file is no longer a finance source');

\echo A348_DOCUMENT_FINANCE_KINDS_SUITE_PASSED
ROLLBACK;
