\set ON_ERROR_STOP on
-- Boundary suite for migration 366 «Имена скачиваемых файлов» (решение владельца 21.11.2026). Runs on the real chain right after 366
-- inside one transaction that is rolled back. Synthetic organizations, members, cases and grant rows; no bytes, no Storage, no provider,
-- no real person.
--
-- Proves:
--  1. posture: four read functions, SECURITY DEFINER, empty search_path, authenticated only; the surname helper closed to every API role;
--  2. document_download_name_v1: only the owner of a LIVE grant gets label / surname / MIME / original name; the surname is the profile
--     `student_last_name` when the profile has it, else the case's display name; another Student, staff without that grant, an Admin of
--     another organization, an expired grant, an unknown id, anon and service_role are refused (42501);
--  3. company_file_download_name_v1: the grantee gets the stored name and MIME; another member and another organization are refused;
--  4. staff_case_file_download_name_v1 (contract): the rep of the case gets «Договор» + surname; a file of another case, a staff member
--     without the case, another organization's Admin and a Student are refused (42501); a bad kind is 22023;
--  5. student_portal_case_file_download_name_v1: the Student gets own contract / pending receipt; another Student's file, a staff caller and
--     an unknown id are refused (42501), a bad kind is 22023;
--  6. nothing returned carries the storage object name.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A366_DOWNLOAD_FILE_NAMES_SUITE_START

CREATE FUNCTION pg_temp.a366_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a366_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A366: %', message; END IF;
END
$$;
-- The JSONB result of a statement as a role with the given claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a366_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
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
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a366_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a366_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a366_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
CREATE FUNCTION pg_temp.a366_as(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a366_call('authenticated', p_claims, p_sql)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 the Sales rep of case 503; 2 another rep without a case; 3 an Admin of organization 2; 4 Student A (case 501);
-- 5 Student B (case 502); 6 an Admin of organization 1 (company file grantee).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a366_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a366_actors VALUES (1, 1, NULL, FALSE), (2, 1, NULL, FALSE), (3, 2, 'admin', TRUE), (4, 1, 'student', FALSE),
  (5, 1, 'student', FALSE), (6, 1, 'admin', TRUE);
INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.a366_id(1), 'A366 Fictional organization'), (pg_temp.a366_id(2), 'A366 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a366_id(100 + n), 'a366-' || n || '@example.invalid', '{}'::JSONB FROM a366_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a366_id(200 + n), pg_temp.a366_id(100 + n), 'A366 Actor ' || n, 'active', 1 FROM a366_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a366_id(300 + a.n), pg_temp.a366_id(a.org), pg_temp.a366_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END, a.sysadmin
  FROM a366_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a366_id(400), pg_temp.a366_id(1), 'organization', pg_temp.a366_id(1), 1),
  (pg_temp.a366_id(401), pg_temp.a366_id(1), 'student_case', pg_temp.a366_id(501), 1),
  (pg_temp.a366_id(402), pg_temp.a366_id(1), 'student_case', pg_temp.a366_id(502), 1),
  (pg_temp.a366_id(403), pg_temp.a366_id(1), 'student_case', pg_temp.a366_id(503), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a366_id(1), pg_temp.a366_id(304), pg_temp.a366_id(400), 1, 1, TRUE, 'system', 'A366 synthetic scope', pg_temp.a366_id(601)),
  (pg_temp.a366_id(1), pg_temp.a366_id(304), pg_temp.a366_id(401), 1, 1, TRUE, 'system', 'A366 synthetic scope', pg_temp.a366_id(602)),
  (pg_temp.a366_id(1), pg_temp.a366_id(305), pg_temp.a366_id(400), 1, 1, TRUE, 'system', 'A366 synthetic scope', pg_temp.a366_id(603)),
  (pg_temp.a366_id(1), pg_temp.a366_id(305), pg_temp.a366_id(402), 1, 1, TRUE, 'system', 'A366 synthetic scope', pg_temp.a366_id(604));

-- Cases: 501 and 502 are active Student cabinets (the shape of the 352 suite); 503 is a pending case of the rep (the shape of the 327 suite).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.a366_id(c.n), pg_temp.a366_id(1), pg_temp.a366_id(301), pg_temp.a366_id(301),
  'synthetic:a366:' || c.n, 'A366 Student ' || c.n, 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.a366_id(c.scope), 1, 'new', pg_temp.a366_id(c.student), clock_timestamp()
FROM (VALUES (501, 401, 304), (502, 402, 305)) AS c(n, scope, student);
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id, source_key,
  student_display_name, operational_stage, state, current_scope_id, current_scope_version) VALUES
  (pg_temp.a366_id(503), pg_temp.a366_id(1), NULL, pg_temp.a366_id(301), 'synthetic:a366:case3', 'A366 Student 503', 'intake_review', 'pending', pg_temp.a366_id(403), 1);
-- Surname precedence: confirmed > needs_review > extracted, conflict never. Case 501 has a needs_review, an extracted and a confirmed value
-- (confirmed wins); case 503 has an extracted and a needs_review value (needs_review wins); case 502 has only a conflict (falls back to the
-- display name).
INSERT INTO platform.student_profile_fields(organization_id, student_case_id, student_profile_id, field_key, value, review_state, profile_revision,
  reviewed_at, reviewed_by_membership_id) VALUES
  (pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(951), 'student_last_name', 'Проверяемая', 'needs_review', 1, NULL, NULL),
  (pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(952), 'student_last_name', 'Извлечённая', 'extracted', 1, NULL, NULL),
  (pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(953), 'student_last_name', 'Подтверждённая', 'confirmed', 1, clock_timestamp(), pg_temp.a366_id(301)),
  (pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(954), 'student_last_name', 'Извлечённая', 'extracted', 1, NULL, NULL),
  (pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(955), 'student_last_name', 'Проверяемая', 'needs_review', 1, NULL, NULL),
  (pg_temp.a366_id(1), pg_temp.a366_id(502), pg_temp.a366_id(956), 'student_last_name', 'Спорная', 'conflict', 1, NULL, NULL);
-- Checklist files: slot 821 «Паспорт» (a custom slot has a display label and no requirement), version 921, on case 501.
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, created_by_membership_id)
  VALUES (pg_temp.a366_id(821), pg_temp.a366_id(1), pg_temp.a366_id(501), NULL, 'custom', 'Паспорт', 'A366 synthetic', pg_temp.a366_id(301)),
         (pg_temp.a366_id(822), pg_temp.a366_id(1), pg_temp.a366_id(503), NULL, 'custom', 'Аттестат', 'A366 synthetic', pg_temp.a366_id(301));
INSERT INTO platform.document_versions(id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id) VALUES
  (pg_temp.a366_id(921), pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(821), 1, 'IMG_0001.png', 'image/png', 128, repeat('a', 64), 'a366-synthetic', pg_temp.a366_id(301)),
  (pg_temp.a366_id(922), pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(822), 1, 'scan.pdf', 'application/pdf', 128, repeat('b', 64), 'a366-synthetic', pg_temp.a366_id(301)),
  (pg_temp.a366_id(923), pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(821), 2, 'receipt-photo.png', 'image/png', 128, repeat('c', 64), 'a366-synthetic', pg_temp.a366_id(301));
-- Download grants (only the columns the name functions read matter): 1 Student A on 921 (live); 2 the rep on 922 (live); 3 Student A on 921 (expired).
INSERT INTO platform_private.document_download_grants(id, request_id, organization_id, student_case_id, document_slot_id, document_version_id,
  storage_binding_id, document_access_event_id, grantee_profile_id, grantee_membership_id, grantee_auth_user_id, grantee_role,
  grantee_access_version, access_purpose, expires_in_seconds, expires_at, created_at)
SELECT pg_temp.a366_id(g.id), pg_temp.a366_id(g.id + 10), pg_temp.a366_id(1), pg_temp.a366_id(g.c), pg_temp.a366_id(g.slot), pg_temp.a366_id(g.v),
  pg_temp.a366_id(g.id + 20), pg_temp.a366_id(g.id + 30), pg_temp.a366_id(200 + g.actor), pg_temp.a366_id(300 + g.actor), pg_temp.a366_id(100 + g.actor),
  g.role::platform.business_role, 1, 'A366 synthetic', 60, g.expires_at, g.expires_at - INTERVAL '30 seconds'
FROM (VALUES (1, 501, 821, 921, 4, 'student', clock_timestamp() + INTERVAL '30 seconds'),
             (2, 503, 822, 922, 1, 'admin', clock_timestamp() + INTERVAL '30 seconds'),
             (3, 501, 821, 921, 4, 'student', clock_timestamp() - INTERVAL '1 second')) AS g(id, c, slot, v, actor, role, expires_at);
-- Company file 701 with one version 711 and a live grant 5 for Admin 6.
INSERT INTO platform.company_files(id, organization_id, display_name, current_version_id, created_by_membership_id, updated_by_membership_id)
  VALUES (pg_temp.a366_id(701), pg_temp.a366_id(1), 'Прайс', pg_temp.a366_id(711), pg_temp.a366_id(306), pg_temp.a366_id(306));
INSERT INTO platform.company_file_versions(id, organization_id, company_file_id, version_no, original_filename, declared_mime_type, byte_size,
  sha256_hex, submitted_by_membership_id, submitted_by_profile_id)
  VALUES (pg_temp.a366_id(711), pg_temp.a366_id(1), pg_temp.a366_id(701), 1, 'Прайс 2026.pdf', 'application/pdf', 128, repeat('d', 64),
    pg_temp.a366_id(306), pg_temp.a366_id(206));
INSERT INTO platform_private.company_file_download_grants(id, request_id, organization_id, company_file_id, company_file_version_id, storage_binding_id,
  grantee_profile_id, grantee_membership_id, grantee_auth_user_id, grantee_role, access_purpose, expires_at, created_at)
  VALUES (pg_temp.a366_id(5), pg_temp.a366_id(15), pg_temp.a366_id(1), pg_temp.a366_id(701), pg_temp.a366_id(711), pg_temp.a366_id(25),
    pg_temp.a366_id(206), pg_temp.a366_id(306), pg_temp.a366_id(106), 'admin', 'A366 synthetic', clock_timestamp() + INTERVAL '30 seconds',
    clock_timestamp() - INTERVAL '30 seconds');
-- Contract and receipt files.
INSERT INTO platform.case_contract_files(id, organization_id, student_case_id, original_filename, declared_mime_type, byte_size, sha256_hex,
  storage_object_name, uploaded_by_membership_id, superseded_at) VALUES
  (pg_temp.a366_id(631), pg_temp.a366_id(1), pg_temp.a366_id(501), 'contract-a.pdf', 'application/pdf', 2048, repeat('e', 64), 'case-contracts/a366/a', pg_temp.a366_id(301), NULL),
  (pg_temp.a366_id(632), pg_temp.a366_id(1), pg_temp.a366_id(502), 'contract-b.pdf', 'application/pdf', 2048, repeat('f', 64), 'case-contracts/a366/b', pg_temp.a366_id(301), NULL),
  (pg_temp.a366_id(633), pg_temp.a366_id(1), pg_temp.a366_id(503), 'contract-c.jpg', 'image/jpeg', 2048, repeat('1', 64), 'case-contracts/a366/c', pg_temp.a366_id(301), NULL);
INSERT INTO platform.case_pending_receipts(id, organization_id, student_case_id, source_document_version_id, original_filename, declared_mime_type,
  byte_size, sha256_hex, storage_object_name, queued_by_membership_id) VALUES
  (pg_temp.a366_id(641), pg_temp.a366_id(1), pg_temp.a366_id(501), pg_temp.a366_id(923), 'receipt-photo.png', 'image/png', 128, repeat('c', 64),
    'payment-receipts/a366/p', pg_temp.a366_id(301));
-- Staff receipts: payment events 741 (case 503) and 744 (case 502), receipt files 742 / 743; a Student receipt 761 on case 503.
INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, amount_minor, currency, occurred_at,
  source_key, actor_membership_id, request_id) VALUES
  (pg_temp.a366_id(741), pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(751), 'payment', 100, 'USD', clock_timestamp(), 'a366:741', pg_temp.a366_id(301), pg_temp.a366_id(791)),
  (pg_temp.a366_id(744), pg_temp.a366_id(1), pg_temp.a366_id(502), pg_temp.a366_id(752), 'payment', 100, 'USD', clock_timestamp(), 'a366:744', pg_temp.a366_id(301), pg_temp.a366_id(792));
INSERT INTO platform.payment_receipt_files(id, organization_id, student_case_id, payment_obligation_id, payment_event_id, original_filename,
  declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id) VALUES
  (pg_temp.a366_id(742), pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(751), pg_temp.a366_id(741), 'receipt-503.jpg', 'image/jpeg', 128, repeat('2', 64), 'payment-receipts/a366/r503', pg_temp.a366_id(301)),
  (pg_temp.a366_id(743), pg_temp.a366_id(1), pg_temp.a366_id(502), pg_temp.a366_id(752), pg_temp.a366_id(744), 'receipt-502.jpg', 'image/jpeg', 128, repeat('3', 64), 'payment-receipts/a366/r502', pg_temp.a366_id(301));
INSERT INTO platform.student_payment_receipts(id, organization_id, student_case_id, student_membership_id, declared_amount_minor, declared_currency,
  declared_paid_on, original_filename, declared_mime_type, byte_size, sha256_hex, storage_object_name, submit_request_id) VALUES
  (pg_temp.a366_id(761), pg_temp.a366_id(1), pg_temp.a366_id(503), pg_temp.a366_id(304), 100, 'USD', DATE '2026-11-01', 'student-receipt.pdf', 'application/pdf', 128,
    repeat('4', 64), 'payment-receipts/a366/s503', pg_temp.a366_id(793));
-- Payment details with a QR (organization 1, current version).
INSERT INTO platform.payment_details_versions(id, organization_id, version_no, details_text, qr_original_filename, qr_mime_type, qr_byte_size,
  qr_sha256_hex, qr_storage_object_name, updated_by_membership_id) VALUES
  (pg_temp.a366_id(771), pg_temp.a366_id(1), 1, 'A366 synthetic details', 'qr-code.png', 'image/png', 128, repeat('5', 64), 'payment-details/a366/qr', pg_temp.a366_id(306));
SET LOCAL session_replication_role = origin;

SELECT pg_temp.a366_claims(1) AS a366_rep \gset
SELECT pg_temp.a366_claims(2) AS a366_stranger \gset
SELECT pg_temp.a366_claims(3) AS a366_foreign \gset
SELECT pg_temp.a366_claims(4) AS a366_student_a \gset
SELECT pg_temp.a366_claims(5) AS a366_student_b \gset
SELECT pg_temp.a366_claims(6) AS a366_admin \gset

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.oid IN (
    'platform.document_download_name_v1(uuid)'::REGPROCEDURE, 'platform.company_file_download_name_v1(uuid)'::REGPROCEDURE,
    'platform.staff_case_file_download_name_v1(text,uuid,uuid)'::REGPROCEDURE, 'platform.student_portal_case_file_download_name_v1(text,uuid)'::REGPROCEDURE)),
  'posture: four definer functions, empty search_path, authenticated only');
SELECT pg_temp.a366_assert(NOT has_function_privilege('authenticated', 'platform_private.download_name_surname_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.download_name_surname_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform_private.download_name_surname_v1(uuid,uuid)', 'EXECUTE'),
  'the surname helper is closed to every API role');

-- ---------------------------------------------------------------------------
-- 2. Documents by grant.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_as(:'a366_student_a', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) AS a366_doc_a \gset
SELECT pg_temp.a366_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a366_doc_a'::JSONB) k) = ARRAY['label', 'mime_type', 'original_filename', 'student_surname']
  AND (:'a366_doc_a'::JSONB) ->> 'label' = 'Паспорт' AND (:'a366_doc_a'::JSONB) ->> 'student_surname' = 'Подтверждённая'
  AND (:'a366_doc_a'::JSONB) ->> 'mime_type' = 'image/png' AND (:'a366_doc_a'::JSONB) ->> 'original_filename' = 'IMG_0001.png',
  'the owner of the live grant gets label, profile surname, MIME and original name: ' || :'a366_doc_a');
SELECT pg_temp.a366_as(:'a366_rep', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(2))) AS a366_doc_rep \gset
SELECT pg_temp.a366_assert((:'a366_doc_rep'::JSONB) ->> 'label' = 'Аттестат' AND (:'a366_doc_rep'::JSONB) ->> 'student_surname' = 'Проверяемая',
  'the surname is the best-ranked profile value (needs_review over extracted): ' || :'a366_doc_rep');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_b', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) ->> 'error' = '42501',
  'another Student cannot read the name of the grant');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) ->> 'error' = '42501',
  'staff holding no such grant is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_stranger', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(2))) ->> 'error' = '42501',
  'another staff member cannot read a rep''s grant');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_foreign', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) ->> 'error' = '42501',
  'an Admin of another organization is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_a', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(3))) ->> 'error' = '42501',
  'an expired grant is refused even for its owner');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_a', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(999))) ->> 'error' = '42501',
  'an unknown grant is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_call('anon', '{"role":"anon"}', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) ->> 'error' = '42501',
  'anon cannot execute it');
SELECT pg_temp.a366_assert(pg_temp.a366_call('service_role', '{"role":"service_role"}', format('SELECT platform.document_download_name_v1(%L)', pg_temp.a366_id(1))) ->> 'error' = '42501',
  'service_role cannot execute it');

-- ---------------------------------------------------------------------------
-- 3. Company file by grant.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_as(:'a366_admin', format('SELECT platform.company_file_download_name_v1(%L)', pg_temp.a366_id(5))) AS a366_company \gset
SELECT pg_temp.a366_assert((:'a366_company'::JSONB) ->> 'original_filename' = 'Прайс 2026.pdf' AND (:'a366_company'::JSONB) ->> 'mime_type' = 'application/pdf'
  AND (SELECT count(*) FROM jsonb_object_keys(:'a366_company'::JSONB)) = 2, 'the grantee gets the stored name and MIME only: ' || :'a366_company');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.company_file_download_name_v1(%L)', pg_temp.a366_id(5))) ->> 'error' = '42501',
  'another member cannot read a company file grant');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_foreign', format('SELECT platform.company_file_download_name_v1(%L)', pg_temp.a366_id(5))) ->> 'error' = '42501',
  'an Admin of another organization is refused');

-- ---------------------------------------------------------------------------
-- 4. Staff contract.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(633), pg_temp.a366_id(503))) AS a366_staff_contract \gset
SELECT pg_temp.a366_assert((:'a366_staff_contract'::JSONB) ->> 'label' = 'Договор' AND (:'a366_staff_contract'::JSONB) ->> 'student_surname' = 'Проверяемая'
  AND (:'a366_staff_contract'::JSONB) ->> 'mime_type' = 'image/jpeg' AND (:'a366_staff_contract'::JSONB) ->> 'original_filename' = 'contract-c.jpg',
  'the rep of the case gets «Договор» with the case name: ' || :'a366_staff_contract');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(633), pg_temp.a366_id(502))) ->> 'error' = '42501',
  'a file under another case id is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_stranger', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(633), pg_temp.a366_id(503))) ->> 'error' = '42501',
  'a staff member without the case is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_foreign', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(633), pg_temp.a366_id(503))) ->> 'error' = '42501',
  'an Admin of another organization is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_a', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(631), pg_temp.a366_id(501))) ->> 'error' = '42501',
  'a Student is refused on the staff function');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'bogus', pg_temp.a366_id(633), pg_temp.a366_id(503))) ->> 'error' = '22023',
  'an unknown kind is 22023');
SELECT pg_temp.a366_assert(pg_temp.a366_call('anon', '{"role":"anon"}', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'contract', pg_temp.a366_id(633), pg_temp.a366_id(503))) ->> 'error' = '42501',
  'anon cannot execute it');

-- Staff receipts (the p_student_case_id given for 'receipt', taken from the row for 'student_receipt').
SELECT pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'receipt', pg_temp.a366_id(742), pg_temp.a366_id(503))) AS a366_staff_receipt \gset
SELECT pg_temp.a366_assert((:'a366_staff_receipt'::JSONB) ->> 'label' = 'Чек' AND (:'a366_staff_receipt'::JSONB) ->> 'student_surname' = 'Проверяемая'
  AND (:'a366_staff_receipt'::JSONB) ->> 'mime_type' = 'image/jpeg' AND (:'a366_staff_receipt'::JSONB) ->> 'original_filename' = 'receipt-503.jpg',
  'the rep gets the attached receipt named «Чек»: ' || :'a366_staff_receipt');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'receipt', pg_temp.a366_id(743), pg_temp.a366_id(503))) ->> 'error' = '42501',
  'a receipt file of another case is refused under this case');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_stranger', format('SELECT platform.staff_case_file_download_name_v1(%L, %L, %L)', 'receipt', pg_temp.a366_id(742), pg_temp.a366_id(503))) ->> 'error' = '42501',
  'a staff member without the case is refused on a receipt');
SELECT pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L)', 'student_receipt', pg_temp.a366_id(761))) AS a366_staff_student_receipt \gset
SELECT pg_temp.a366_assert((:'a366_staff_student_receipt'::JSONB) ->> 'label' = 'Чек' AND (:'a366_staff_student_receipt'::JSONB) ->> 'student_surname' = 'Проверяемая'
  AND (:'a366_staff_student_receipt'::JSONB) ->> 'mime_type' = 'application/pdf' AND (:'a366_staff_student_receipt'::JSONB) ->> 'original_filename' = 'student-receipt.pdf',
  'the rep gets the Student receipt, the case taken from the row: ' || :'a366_staff_student_receipt');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_stranger', format('SELECT platform.staff_case_file_download_name_v1(%L, %L)', 'student_receipt', pg_temp.a366_id(761))) ->> 'error' = '42501',
  'a staff member without the case is refused on a Student receipt');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.staff_case_file_download_name_v1(%L, %L)', 'student_receipt', pg_temp.a366_id(999))) ->> 'error' = '42501',
  'an unknown Student receipt is refused');

-- ---------------------------------------------------------------------------
-- 5. Student contract and receipt.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_as(:'a366_student_a', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'contract', pg_temp.a366_id(631))) AS a366_student_contract \gset
SELECT pg_temp.a366_assert((:'a366_student_contract'::JSONB) ->> 'label' = 'Договор' AND (:'a366_student_contract'::JSONB) ->> 'student_surname' = 'Подтверждённая'
  AND (:'a366_student_contract'::JSONB) ->> 'mime_type' = 'application/pdf', 'the Student gets own contract with the profile surname: ' || :'a366_student_contract');
SELECT pg_temp.a366_as(:'a366_student_a', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'pending_receipt', pg_temp.a366_id(641))) AS a366_student_receipt \gset
SELECT pg_temp.a366_assert((:'a366_student_receipt'::JSONB) ->> 'label' = 'Чек' AND (:'a366_student_receipt'::JSONB) ->> 'original_filename' = 'receipt-photo.png',
  'the Student gets own receipt named «Чек»: ' || :'a366_student_receipt');
SELECT pg_temp.a366_as(:'a366_student_a', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'payment_details_qr', pg_temp.a366_id(771))) AS a366_student_qr \gset
SELECT pg_temp.a366_assert((:'a366_student_qr'::JSONB) ->> 'label' = 'Реквизиты' AND (:'a366_student_qr'::JSONB) ->> 'student_surname' IS NULL
  AND (:'a366_student_qr'::JSONB) ->> 'mime_type' = 'image/png' AND (:'a366_student_qr'::JSONB) ->> 'original_filename' = 'qr-code.png',
  'the Student gets the payment details QR named «Реквизиты» with no surname: ' || :'a366_student_qr');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'payment_details_qr', pg_temp.a366_id(771))) ->> 'error' = '42501',
  'a staff caller is refused on the QR');
SELECT pg_temp.a366_as(:'a366_student_b', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'contract', pg_temp.a366_id(632))) AS a366_student_b_contract \gset
SELECT pg_temp.a366_assert((:'a366_student_b_contract'::JSONB) ->> 'student_surname' = 'A366 Student 502', 'Student B falls back to the case display name');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_b', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'contract', pg_temp.a366_id(631))) ->> 'error' = '42501',
  'another Student''s contract is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_b', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'pending_receipt', pg_temp.a366_id(641))) ->> 'error' = '42501',
  'another Student''s receipt is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_rep', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'contract', pg_temp.a366_id(631))) ->> 'error' = '42501',
  'a staff caller is refused on the Student function');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_a', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'contract', pg_temp.a366_id(999))) ->> 'error' = '42501',
  'an unknown file is refused');
SELECT pg_temp.a366_assert(pg_temp.a366_as(:'a366_student_a', format('SELECT platform.student_portal_case_file_download_name_v1(%L, %L)', 'bogus', pg_temp.a366_id(631))) ->> 'error' = '22023',
  'an invalid kind is 22023');

-- ---------------------------------------------------------------------------
-- 6. No storage key leaves through any answer.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a366_assert(NOT (:'a366_doc_a' || :'a366_company' || :'a366_staff_contract' || :'a366_student_contract' || :'a366_student_receipt' || :'a366_staff_receipt' || :'a366_staff_student_receipt' || :'a366_student_qr') ~ 'case-contracts|payment-receipts|payment-details|storage_object_name',
  'no answer carries a storage object name');

\echo A366_DOWNLOAD_FILE_NAMES_SUITE_PASSED
ROLLBACK;
