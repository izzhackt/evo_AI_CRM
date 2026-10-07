\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 279 «Удаление аккаунта по
-- запросу» (docs/PLAN_CHANGES.md 2026-10-07). Runs at the 279 checkpoint
-- against the full schema. Accounts are created through the REAL анкета path
-- (submit_student_application_v1 + decide_student_application_v1); content a
-- student produces elsewhere is seeded directly (replica mode only for the
-- fixtures, never for the erasure). Every row rolls back at the end.
--
-- Proven here:
--   (i)    who may ask: an approved student (v2 and the released v1), an
--          applicant with a pending анкета, an account without any анкета;
--          staff (system Admin, Sales, Curator) and anon are refused;
--          idempotent by request_id, one open request per account; due_at is
--          the request + 30 days;
--   (ii)   who may process: only account.deletion.process (the system
--          Admin); Sales, Curator, a student, anon and service_role are
--          refused for the queue, the detail, processing and completion;
--   (iii)  processing deletes the portal content, the анкета, the documents
--          and their Storage keys, keeps the contract and payment rows
--          anonymized, closes the active case, anonymizes client and lead,
--          and is re-runnable; completion is refused while the Auth user or a
--          listed Storage object still exists, and the Auth user CAN be
--          deleted afterwards (no foreign key holds it);
--   (iv)   nothing personal is left: the email, phone, full name and passport
--          number of the erased account are found in no text or JSON column
--          of the database, while another student's own data stays intact
--          (only the mention of the erased person in it is replaced);
--   (v)    the guard bypass exists only inside the processing statement;
--   (vi)   every table that names a student case, a student membership or a
--          notification recipient is classified (fails on a new table).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The lightweight Auth bootstrap of the harness (126/185/193 convention):
-- managed Supabase Auth owns these columns, its journal and auth.role();
-- add them transaction-locally where missing, ROLLBACK discards the DDL.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $p279_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$p279_auth_role$;
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID, id UUID PRIMARY KEY, payload JSON, created_at TIMESTAMPTZ, ip_address VARCHAR(64)
);

CREATE FUNCTION pg_temp.p279_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p279_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 279 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p279_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.p279_questionnaire(p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT,
    'firstName', p_first, 'lastName', p_last, 'phone', p_phone,
    'destinationCountries', jsonb_build_array('CN'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18')
$$;

-- Every text/JSON column of every table: how many values match the pattern.
CREATE FUNCTION pg_temp.p279_needles(p_pattern TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
      AND c.udt_name IN ('text', 'varchar', 'jsonb', 'json', '_text')
    ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::TEXT ~* $1', r.s, r.t, r.col) INTO n USING p_pattern;
    IF n > 0 THEN found := found || r.s || '.' || r.t || '.' || r.col || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p279_id(INTEGER), pg_temp.p279_assert(BOOLEAN, TEXT), pg_temp.p279_error(TEXT),
  pg_temp.p279_questionnaire(UUID, TEXT, TEXT, TEXT)
  TO authenticated, anon, service_role;

SELECT 'P279_ACCOUNT_DELETION_SUITE_START' AS p279_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization, staff (system Admin, Sales, Curator), the анкета
-- configuration with an intake owner (the Admin is an eligible lead owner),
-- so the анкета creates the canonical client and lead at submit: the «лид из
-- анкеты» path.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.p279_id(1), 'Migration 279 synthetic organization');
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p279_id(2), pg_temp.p279_id(1), 'organization', pg_temp.p279_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES
  (pg_temp.p279_id(101), 'p279-admin@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(102), 'p279-sales@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(103), 'p279-curator@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(104), 'p279-zarina@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(105), 'p279-bekzat@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(106), 'p279-bare@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(107), 'p279-timur@example.invalid', '{}'::JSONB, statement_timestamp());

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p279_id(201), pg_temp.p279_id(101), 'P279 Admin', 'active', 1),
  (pg_temp.p279_id(202), pg_temp.p279_id(102), 'P279 Sales', 'active', 1),
  (pg_temp.p279_id(203), pg_temp.p279_id(103), 'P279 Curator', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p279_id(300 + a.n), pg_temp.p279_id(1), pg_temp.p279_id(200 + a.n), 'active',
  a.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
     AND status = 'published' ORDER BY version DESC LIMIT 1),
  a.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p279_id(1), pg_temp.p279_id(300 + n), pg_temp.p279_id(2), 1, 1, TRUE, 'system',
  'P279 synthetic organization scope', pg_temp.p279_id(600 + n)
FROM generate_series(1, 3) AS n;

INSERT INTO platform.staff_departments (id, organization_id, name)
VALUES (pg_temp.p279_id(930), pg_temp.p279_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
VALUES (TRUE, pg_temp.p279_id(1), pg_temp.p279_id(930), TRUE, pg_temp.p279_id(301));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_admin \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(102), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_sales \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(103), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_curator \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(105), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_bekzat \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(106),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(106), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_bare \gset

-- ---------------------------------------------------------------------------
-- Real анкеты: Zarina (will be approved and erased), Timur (approved, stays),
-- Bekzat (pending, erased as an applicant). Bare has no анкета at all.
-- ---------------------------------------------------------------------------
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_zarina_pre \gset
SET request.jwt.claims TO :'p279_zarina_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(701),
  pg_temp.p279_questionnaire(pg_temp.p279_id(701), 'Зарина', 'Удалёва', '+996 700 279 279'), 0) ->> 'id')::UUID AS p279_zarina_app \gset
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(107),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(107), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_timur_pre \gset
SET request.jwt.claims TO :'p279_timur_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(702),
  pg_temp.p279_questionnaire(pg_temp.p279_id(702), 'Тимур', 'Остаётся', '+996 700 279 107'), 0) ->> 'id')::UUID AS p279_timur_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_bekzat';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(703),
  pg_temp.p279_questionnaire(pg_temp.p279_id(703), 'Бекзат', 'Анкетов', '+996 700 279 105'), 0) ->> 'id')::UUID AS p279_bekzat_app \gset
RESET ROLE;

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.decide_student_application_v1(:'p279_zarina_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(711))
  ->> 'student_case_id')::UUID AS p279_zarina_case \gset
SELECT (platform.decide_student_application_v1(:'p279_timur_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(712))
  ->> 'student_case_id')::UUID AS p279_timur_case \gset
RESET ROLE;

SELECT sc.student_membership_id AS p279_zarina_member, sc.canonical_lead_id AS p279_zarina_lead,
  l.client_id AS p279_zarina_client, sc.current_scope_id AS p279_zarina_scope
FROM platform.student_cases sc JOIN platform.leads l ON l.id = sc.canonical_lead_id
WHERE sc.id = :'p279_zarina_case' \gset
SELECT sc.student_membership_id AS p279_timur_member, sc.canonical_lead_id AS p279_timur_lead
FROM platform.student_cases sc WHERE sc.id = :'p279_timur_case' \gset
SELECT a.canonical_lead_id AS p279_bekzat_lead FROM platform_private.student_applications a
WHERE a.id = :'p279_bekzat_app' \gset
SELECT m.profile_id AS p279_zarina_profile FROM platform.organization_memberships m WHERE m.id = :'p279_zarina_member' \gset

SELECT pg_temp.p279_assert(
  :'p279_zarina_member' <> '' AND :'p279_zarina_lead' <> '' AND :'p279_bekzat_lead' <> ''
    AND (SELECT count(*) FROM platform.clients k WHERE k.id = :'p279_zarina_client'
      AND k.normalized_email = 'p279-zarina@example.invalid') = 1,
  'the анкета path did not create the membership, case, lead and client'
);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_zarina \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(107),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(107), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_timur \gset

-- ---------------------------------------------------------------------------
-- Zarina's working life: an active case with a curator, documents with a file,
-- chat, a notification, a test, a consultation, a favourite, a profile with a
-- passport number, a contract file, payments, the sales register and sale
-- conditions, staff tasks and notes, Supabase Auth journal entries. Timur's
-- sale conditions mention Zarina by name (a mention in another record).
-- ---------------------------------------------------------------------------
-- The config-provisioned private bucket (the disposable catalog has none).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-documents', 'platform-documents', FALSE, 26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET state = 'active', current_curator_membership_id = pg_temp.p279_id(303),
  handoff_at = statement_timestamp(), next_action = 'Позвонить Зарина Удалёва', operational_stage = 'documents'
WHERE id = :'p279_zarina_case';
INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
  review_state, profile_revision)
SELECT pg_temp.p279_id(1), :'p279_zarina_case', sp.id, f.k, f.v, 'needs_review', sp.revision
FROM platform.student_profiles sp
CROSS JOIN (VALUES ('passport_number', 'AN2790279'), ('mother_first_name', 'Гульнара'),
  ('mother_last_name', 'Удалёва'), ('mobile_phone', '+996 700 279 279')) AS f(k, v)
WHERE sp.student_case_id = :'p279_zarina_case'
ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status,
  current_version_id, current_version_no, created_by_membership_id, intent_kind, display_label, group_label, version)
VALUES (pg_temp.p279_id(801), pg_temp.p279_id(1), :'p279_zarina_case', NULL, 'submitted',
  pg_temp.p279_id(802), 1, pg_temp.p279_id(303), 'custom', 'Паспорт', 'Личные документы', 2);
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id,
  integrity_status, malware_status, malware_scan_attestation_id)
VALUES (pg_temp.p279_id(802), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801), 1,
  'Паспорт Зарина Удалёва AN2790279.jpg', 'image/jpeg', 1000, repeat('a', 64),
  'storage-reservation:' || pg_temp.p279_id(803), :'p279_zarina_member', 'verified', 'clean', pg_temp.p279_id(805));
INSERT INTO platform_private.document_upload_reservations (id, request_id, organization_id, student_case_id,
  document_slot_id, document_version_id, uploader_profile_id, uploader_membership_id, uploader_auth_user_id,
  bucket_id, object_name, declared_mime_type, byte_size, sha256_hex, expires_at, ingress_scan_required,
  uploader_access_version)
VALUES (pg_temp.p279_id(803), pg_temp.p279_id(813), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801),
  pg_temp.p279_id(802), :'p279_zarina_profile', :'p279_zarina_member', pg_temp.p279_id(104),
  'platform-documents', 'a1/' || repeat('b', 62), 'image/jpeg', 1000, repeat('a', 64),
  statement_timestamp() + INTERVAL '10 minutes', FALSE, 1);
INSERT INTO platform_private.document_upload_finalizations (id, request_id, organization_id, upload_reservation_id,
  student_case_id, document_version_id, document_slot_id, finalization_audit_event_id, bucket_id, object_name,
  published_version_no, object_created_at, finalized_at)
VALUES (pg_temp.p279_id(804), pg_temp.p279_id(814), pg_temp.p279_id(1), pg_temp.p279_id(803), :'p279_zarina_case',
  pg_temp.p279_id(802), pg_temp.p279_id(801), pg_temp.p279_id(899), 'platform-documents', 'a1/' || repeat('b', 62),
  1, statement_timestamp(), statement_timestamp());
INSERT INTO platform_private.document_malware_scan_attestations (id, request_id, organization_id, student_case_id,
  document_slot_id, document_version_id, upload_finalization_id, scanned_sha256_hex, scanner_engine,
  scanner_engine_version, scanner_signature_version, scanner_protocol, scanned_at, service_principal)
VALUES (pg_temp.p279_id(805), pg_temp.p279_id(815), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801),
  pg_temp.p279_id(802), pg_temp.p279_id(804), repeat('a', 64), 'ClamAV', '1.5.4', '1', 'clamd-zinstream-v1',
  statement_timestamp(), 'service:platform-document-validation');
INSERT INTO platform_private.document_storage_bindings (id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_reservation_id, bucket_id, object_name)
VALUES (pg_temp.p279_id(806), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801), pg_temp.p279_id(802),
  pg_temp.p279_id(803), 'platform-documents', 'a1/' || repeat('b', 62));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES (pg_temp.p279_id(899), pg_temp.p279_id(1), 'system', 'service:p279', 'document.upload.finalize',
  'document_version', pg_temp.p279_id(802),
  jsonb_build_object('original_filename', 'Паспорт Зарина Удалёва AN2790279.jpg', 'email', 'p279-zarina@example.invalid'),
  'P279 synthetic finalize for Зарина Удалёва', pg_temp.p279_id(898));
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('platform-documents', 'a1/' || repeat('b', 62), '{}'::JSONB),
  ('platform-documents', 'contracts/' || pg_temp.p279_id(820)::TEXT, '{}'::JSONB);
INSERT INTO platform.case_contract_files (id, organization_id, student_case_id, original_filename,
  declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
VALUES (pg_temp.p279_id(820), pg_temp.p279_id(1), :'p279_zarina_case', 'Договор Зарина Удалёва.pdf',
  'application/pdf', 2000, repeat('c', 64), 'contracts/' || pg_temp.p279_id(820)::TEXT, pg_temp.p279_id(302));
INSERT INTO platform.case_chat_threads (organization_id, student_case_id, await_state, last_message_at,
  last_message_sequence_id)
VALUES (pg_temp.p279_id(1), :'p279_zarina_case', 'awaiting_student', statement_timestamp(), 2);
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, sequence_id, author_membership_id, body)
OVERRIDING SYSTEM VALUE
VALUES
  (pg_temp.p279_id(831), pg_temp.p279_id(1), :'p279_zarina_case', 1, pg_temp.p279_id(303),
   'Зарина, здравствуйте! Пришлите паспорт.'),
  (pg_temp.p279_id(832), pg_temp.p279_id(1), :'p279_zarina_case', 2, :'p279_zarina_member',
   'Отправила, мой телефон +996 700 279 279');
INSERT INTO platform.notifications (id, organization_id, student_case_id, recipient_membership_id, category, title,
  body, dedupe_key, created_by_membership_id)
VALUES (pg_temp.p279_id(841), pg_temp.p279_id(1), :'p279_zarina_case', :'p279_zarina_member', 'document.review',
  'Document correction required', 'Зарина, проверьте паспорт', 'p279:' || pg_temp.p279_id(841), pg_temp.p279_id(303));
INSERT INTO platform.student_assessment_attempts (id, organization_id, student_membership_id, instrument_key,
  version_id, status, revision, answers)
VALUES (pg_temp.p279_id(851), pg_temp.p279_id(1), :'p279_zarina_member', 'english36', pg_temp.p279_id(852),
  'draft', 1, '{"grammar-01": "b"}'::JSONB);
INSERT INTO platform_private.portal_consultation_requests (id, organization_id, membership_id, request_id, note)
VALUES (pg_temp.p279_id(861), pg_temp.p279_id(1), :'p279_zarina_member', pg_temp.p279_id(862),
  'Хочу обсудить стипендию');
INSERT INTO platform_private.university_favorites (organization_id, membership_id, institution_id)
VALUES (pg_temp.p279_id(1), :'p279_zarina_member', pg_temp.p279_id(863));
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor,
  currency, next_action, total_paid_minor, total_refunded_minor, created_by_membership_id)
VALUES (pg_temp.p279_id(871), pg_temp.p279_id(1), :'p279_zarina_case', 'Услуги EVO, 1-й платёж',
  'evo_service_fee', 150000, 'USD', 'Напомнить Зарина Удалёва', 150000, 0, pg_temp.p279_id(302));
INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type,
  amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id)
VALUES (pg_temp.p279_id(872), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(871), 'payment',
  150000, 'USD', statement_timestamp(), 'case_agreement', pg_temp.p279_id(302), pg_temp.p279_id(873));
INSERT INTO platform.payment_evidence (id, organization_id, student_case_id, payment_obligation_id,
  payment_event_id, evidence_ref, recorded_by_membership_id)
VALUES (pg_temp.p279_id(874), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(871), pg_temp.p279_id(872),
  'case-agreement:' || pg_temp.p279_id(872), pg_temp.p279_id(302));
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(881), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', :'p279_zarina_lead', :'p279_zarina_client',
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996700279279', 'notes', 'Мама Гульнара',
    'contract_number', 'EVO-279', 'signing_date', '2026-10-01', 'paid_minor', 150000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996700279279', 'notes', ''),
  150000, 'USD');
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
VALUES
  (:'p279_zarina_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 300000,
    'service_label', 'Поступление в Китай', 'payment_note', 'Платит мама Гульнара Удалёва',
    'education_current', 'Школа №5'), 1, pg_temp.p279_id(302)),
  (:'p279_timur_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 200000,
    'service_label', 'Поступление в Китай', 'payment_note', 'Рекомендация от Зарина Удалёва'), 1, pg_temp.p279_id(302));
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id,
  priority, status, student_visible, created_by_membership_id, source_key, version)
VALUES (pg_temp.p279_id(891), pg_temp.p279_id(1), :'p279_zarina_case', 'follow_up', 'Позвонить Зарина Удалёва',
  pg_temp.p279_id(303), 'high', 'open', FALSE, pg_temp.p279_id(303), 'p279.task', 1);
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(892), pg_temp.p279_id(1), :'p279_zarina_lead', NULL, 'Мама Гульнара просит общежитие',
  pg_temp.p279_id(302));
SET LOCAL session_replication_role = origin;

INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
VALUES (NULL, pg_temp.p279_id(951),
  json_build_object('action', 'login', 'actor_id', pg_temp.p279_id(104),
    'actor_username', 'p279-zarina@example.invalid'), statement_timestamp(), '10.2.7.9');

-- ===========================================================================
-- (i) Who may ask.
-- ===========================================================================
SET request.jwt.claims TO :'p279_zarina';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1001))::TEXT AS p279_zarina_receipt \gset
SELECT pg_temp.p279_assert(
  :'p279_zarina_receipt'::JSONB ->> 'status' = 'requested'
    AND (:'p279_zarina_receipt'::JSONB ->> 'requestId')::UUID = pg_temp.p279_id(1001)
    AND (:'p279_zarina_receipt'::JSONB ->> 'dueAt')::TIMESTAMPTZ
      = (:'p279_zarina_receipt'::JSONB ->> 'requestedAt')::TIMESTAMPTZ + INTERVAL '30 days',
  'student request receipt is not requested with a 30-day deadline'
);
SELECT pg_temp.p279_assert(
  platform.request_account_deletion_v2(pg_temp.p279_id(1001)) = :'p279_zarina_receipt'::JSONB
    AND platform.request_account_deletion_v2(pg_temp.p279_id(1002)) = :'p279_zarina_receipt'::JSONB
    AND platform.own_account_deletion_request_v1() = :'p279_zarina_receipt'::JSONB,
  'student request is not idempotent / not one open request per account'
);
RESET ROLE;

SET request.jwt.claims TO :'p279_bekzat';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(platform.own_account_deletion_request_v1() = 'null'::JSONB,
  'an applicant without a request must read null');
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1003))::TEXT AS p279_bekzat_receipt \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_bare';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1004))::TEXT AS p279_bare_receipt \gset
RESET ROLE;
-- Timur uses the RELEASED 196 path; the row gets its subject and deadline.
SET request.jwt.claims TO :'p279_timur';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v1(pg_temp.p279_id(1005))::TEXT AS p279_timur_v1 \gset
SELECT pg_temp.p279_assert(
  (platform.request_account_deletion_v2(pg_temp.p279_id(1006)) ->> 'requestId')::UUID = pg_temp.p279_id(1005),
  'v2 did not return the open request the released v1 created'
);
RESET ROLE;

SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM platform_private.account_deletion_requests r WHERE r.organization_id = pg_temp.p279_id(1)) = 4
  AND (SELECT r.subject_kind || '/' || (r.membership_id IS NULL)::TEXT FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(105)) = 'applicant/true'
  AND (SELECT r.subject_kind || '/' || (r.membership_id IS NULL)::TEXT FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(106)) = 'applicant/true'
  AND (SELECT r.subject_kind || '/' || (r.due_at = r.created_at + INTERVAL '30 days')::TEXT
    FROM platform_private.account_deletion_requests r WHERE r.subject_auth_user_id = pg_temp.p279_id(107)) = 'student/true'
  AND (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'account.deletion.request'
    AND e.organization_id = pg_temp.p279_id(1)) = 3,
  'requests: kinds, deadlines or journal entries are wrong'
);

-- Staff never ask through this path; anon cannot call it.
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501 account_deletion_staff_forbidden', 'the system Admin could request own deletion');
RESET ROLE;
SET request.jwt.claims TO :'p279_sales';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501 account_deletion_staff_forbidden', 'Sales could request own deletion');
RESET ROLE;
SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501%', 'anon could request a deletion');
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.own_account_deletion_request_v1()')
  LIKE '42501%', 'anon could read a deletion status');
RESET ROLE;
RESET request.jwt.claims;

-- ===========================================================================
-- (ii) Who may process.
-- ===========================================================================
SELECT r.id AS p279_zarina_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(104) \gset
SELECT r.id AS p279_bekzat_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(105) \gset
SELECT r.id AS p279_bare_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(106) \gset

SET request.jwt.claims TO :'p279_sales';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.staff_account_deletion_detail_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L)', :'p279_zarina_rid', 'sent'))
    LIKE '42501 account_deletion_forbidden',
  'Sales reached the deletion queue or processing'
);
RESET ROLE;
SET request.jwt.claims TO :'p279_curator';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden',
  'the Curator reached the deletion queue or processing'
);
RESET ROLE;
SET request.jwt.claims TO :'p279_timur';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden',
  'a student reached the deletion queue or processing'
);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid')) LIKE '42501%'
  AND pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501%',
  'service_role could call the staff deletion RPCs'
);
RESET ROLE;
SELECT pg_temp.p279_assert(
  NOT has_function_privilege('anon', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_account_deletion_queue_v1()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.account_deletion_requests', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.account_deletion_storage_objects', 'SELECT'),
  'anon can execute the staff RPCs or authenticated can read the private tables'
);
SELECT pg_temp.p279_assert(
  (SELECT d.staff_system_only AND NOT d.staff_sensitive FROM platform.permission_definitions d
    WHERE d.permission_key = 'account.deletion.process')
  AND platform_private.staff_has_permission(pg_temp.p279_id(1), pg_temp.p279_id(301), 'account.deletion.process')
  AND NOT platform_private.staff_has_permission(pg_temp.p279_id(1), pg_temp.p279_id(302), 'account.deletion.process'),
  'account.deletion.process is not a system-only permission held by the Admin only'
);

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_queue_v1()::TEXT AS p279_queue \gset
SELECT pg_temp.p279_assert(
  jsonb_array_length(:'p279_queue'::JSONB) = 4
  AND (SELECT count(*) FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE q ->> 'status' = 'requested' AND (q ->> 'overdue')::BOOLEAN = FALSE
      AND (q ->> 'dueAt')::TIMESTAMPTZ = (q ->> 'requestedAt')::TIMESTAMPTZ + INTERVAL '30 days') = 4
  AND (SELECT q ->> 'displayName' FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE (q ->> 'id')::UUID = :'p279_zarina_rid') = 'Зарина Удалёва'
  AND (SELECT q ->> 'displayName' FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE (q ->> 'id')::UUID = :'p279_bekzat_rid') = 'Бекзат Анкетов',
  'the Admin queue does not list the four requests with names and deadlines'
);
SELECT platform.staff_account_deletion_detail_v1(:'p279_zarina_rid')::TEXT AS p279_detail \gset
SELECT pg_temp.p279_assert(
  (:'p279_detail'::JSONB #>> '{counts,delete,documents}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,delete,files}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,delete,chatMessages}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,paymentObligations}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,salesRecords}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,remain,whatsappChats}')::INT = 0
  AND (:'p279_detail'::JSONB ->> 'authAccountExists')::BOOLEAN,
  'the detail does not count what will be deleted and kept'
);

-- ===========================================================================
-- (iii) Processing Zarina (approved student).
-- ===========================================================================
SELECT platform.process_account_deletion_v1(:'p279_zarina_rid')::TEXT AS p279_processed \gset
SELECT pg_temp.p279_assert(
  :'p279_processed'::JSONB ->> 'status' = 'processing'
  AND (:'p279_processed'::JSONB ->> 'authUserId')::UUID = pg_temp.p279_id(104)
  AND :'p279_processed'::JSONB ->> 'email' = 'p279-zarina@example.invalid'
  AND jsonb_array_length(:'p279_processed'::JSONB -> 'storageObjects') = 2,
  'processing did not return the Auth user, the address and both Storage keys'
);
-- Re-run is safe and returns the same remaining keys.
SELECT pg_temp.p279_assert(
  (platform.process_account_deletion_v1(:'p279_zarina_rid') -> 'storageObjects')
    = (:'p279_processed'::JSONB -> 'storageObjects'),
  'a repeated processing did not return the same remaining Storage keys'
);
-- Completion is refused while the Auth user or the files are still there.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_auth_user_remains',
  'completion did not wait for the Auth user'
);
RESET ROLE;

-- (v) The bypass is gone after processing, even in the same transaction.
SET LOCAL platform.account_erasure_request_id = :'p279_zarina_rid';
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('DELETE FROM platform.audit_events WHERE id = %L', pg_temp.p279_id(899)))
    LIKE '55000%append-only%'
  AND pg_temp.p279_error(format('UPDATE platform.student_cases SET public_application_id = gen_random_uuid() WHERE id = %L',
    :'p279_timur_case')) LIKE '55000%immutable%',
  'a guard let a mutation through outside the processing statement'
);
SET LOCAL platform.account_erasure_request_id = '';

-- The server route: Storage API removes the objects, Auth Admin deletes the
-- user. A plain DELETE as the database owner proves no foreign key holds it.
SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM auth.users u WHERE u.id = pg_temp.p279_id(104)) = 1, 'the Auth user vanished early');
DELETE FROM auth.users WHERE id = pg_temp.p279_id(104);
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_storage_remains',
  'completion did not wait for the Storage objects'
);
RESET ROLE;
DO $p279_storage$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', TRUE);
  DELETE FROM storage.objects o USING platform_private.account_deletion_storage_objects d
  WHERE d.deletion_request_id = (SELECT r.id FROM platform_private.account_deletion_requests r
      WHERE r.subject_auth_user_id = '27900000-0000-4000-8000-000000000104')
    AND o.bucket_id = d.bucket_id AND o.name = d.object_name;
  PERFORM set_config('storage.allow_delete_query', 'false', TRUE);
END
$p279_storage$;
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.complete_account_deletion_v1(:'p279_zarina_rid', 'sent')::TEXT AS p279_completed \gset
SELECT pg_temp.p279_assert(
  :'p279_completed'::JSONB ->> 'status' = 'completed'
  AND :'p279_completed'::JSONB ->> 'confirmationEmailStatus' = 'sent'
  AND platform.complete_account_deletion_v1(:'p279_zarina_rid', 'failed') = :'p279_completed'::JSONB
  AND (platform.process_account_deletion_v1(:'p279_zarina_rid') ->> 'status') = 'completed',
  'completion is not durable and idempotent'
);
SELECT pg_temp.p279_assert(
  (SELECT q ->> 'displayName' FROM jsonb_array_elements(platform.staff_account_deletion_queue_v1()) q
    WHERE (q ->> 'id')::UUID = :'p279_zarina_rid')
    = 'Удалённый пользователь · ' || left(replace(:'p279_zarina_rid', '-', ''), 8)
  AND (SELECT q -> 'email' FROM jsonb_array_elements(platform.staff_account_deletion_queue_v1()) q
    WHERE (q ->> 'id')::UUID = :'p279_zarina_rid') = 'null'::JSONB,
  'a completed request still shows the person'
);
RESET ROLE;

-- What is gone.
SELECT pg_temp.p279_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_zarina_app')
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_application_receipts x WHERE x.application_id = :'p279_zarina_app')
  AND NOT EXISTS (SELECT 1 FROM platform.document_versions v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.document_slots v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform_private.document_storage_bindings v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_chat_messages v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_chat_threads v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.notifications v WHERE v.recipient_membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform.student_assessment_attempts v WHERE v.student_membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform_private.portal_consultation_requests v WHERE v.membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform_private.university_favorites v WHERE v.membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform.student_profiles v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.student_profile_fields v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_contract_files v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_tasks v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes v WHERE v.lead_id = :'p279_zarina_lead')
  AND NOT EXISTS (SELECT 1 FROM platform.external_identifiers v WHERE v.client_id = :'p279_zarina_client')
  AND NOT EXISTS (SELECT 1 FROM public.accounts v WHERE v.owner_user_id = pg_temp.p279_id(104))
  AND NOT EXISTS (SELECT 1 FROM platform.profiles v WHERE v.auth_user_id = pg_temp.p279_id(104))
  AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.name = 'a1/' || repeat('b', 62)),
  'some personal content of the erased student is still in the database'
);
-- What is kept, anonymized.
SELECT pg_temp.p279_assert(
  (SELECT sc.state = 'closed' AND sc.student_display_name LIKE 'Удалённый пользователь · %'
      AND sc.public_application_id IS NULL AND sc.next_action IS NULL
    FROM platform.student_cases sc WHERE sc.id = :'p279_zarina_case')
  AND (SELECT p.auth_user_id IS NULL AND p.status = 'blocked' AND p.display_name LIKE 'Удалённый пользователь · %'
    FROM platform.profiles p WHERE p.id = :'p279_zarina_profile')
  AND (SELECT m.status = 'inactive' FROM platform.organization_memberships m WHERE m.id = :'p279_zarina_member')
  AND (SELECT k.email IS NULL AND k.phone IS NULL AND k.normalized_email IS NULL
      AND k.display_name LIKE 'Удалённый пользователь · %' AND k.lifecycle_state = 'inactive'
    FROM platform.clients k WHERE k.id = :'p279_zarina_client')
  AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_zarina_lead')
  AND (SELECT o.amount_minor = 150000 AND o.currency = 'USD' AND o.total_paid_minor = 150000 AND o.next_action IS NULL
    FROM platform.payment_obligations o WHERE o.id = pg_temp.p279_id(871))
  AND EXISTS (SELECT 1 FROM platform.payment_events e WHERE e.id = pg_temp.p279_id(872) AND e.amount_minor = 150000)
  AND EXISTS (SELECT 1 FROM platform.payment_evidence e WHERE e.id = pg_temp.p279_id(874))
  AND (SELECT sr.fields ->> 'applicant_name' LIKE 'Удалённый пользователь · %'
      AND sr.fields ->> 'phone' = '' AND sr.fields ->> 'notes' = ''
      AND sr.fields ->> 'contract_number' = 'EVO-279' AND sr.paid_contract_minor = 150000
      AND sr.source_snapshot ->> 'applicant_name' LIKE 'Удалённый пользователь · %'
    FROM platform_private.sales_register sr WHERE sr.id = pg_temp.p279_id(881))
  AND (SELECT lc.fields ->> 'payment_note' = '' AND lc.fields ->> 'education_current' = ''
      AND (lc.fields ->> 'service_cost_minor')::INT = 300000
    FROM platform_private.lead_sale_conditions lc WHERE lc.lead_id = :'p279_zarina_lead')
  AND EXISTS (SELECT 1 FROM platform.student_case_lifecycle_events e
    WHERE e.student_case_id = :'p279_zarina_case' AND e.event_type = 'closed'),
  'the case, contract and payment records are not kept anonymized'
);

-- (iv) Nothing personal is left anywhere; Timur's own data is intact.
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles('(p279-zarina@example\.invalid|996 ?700 ?279 ?279|Зарина Удалёва|AN2790279|Гульнара Удалёва)') = '',
  'personal values of the erased student remain: ' ||
    pg_temp.p279_needles('(p279-zarina@example\.invalid|996 ?700 ?279 ?279|Зарина Удалёва|AN2790279|Гульнара Удалёва)')
);
SELECT pg_temp.p279_assert(
  (SELECT lc.fields ->> 'payment_note' FROM platform_private.lead_sale_conditions lc
    WHERE lc.lead_id = :'p279_timur_lead') = 'Рекомендация от [удалено]'
  AND EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_timur_app'
    AND a.normalized_email = 'p279-timur@example.invalid' AND a.questionnaire ->> 'lastName' = 'Остаётся')
  AND (SELECT sc.student_display_name = 'Тимур Остаётся' AND sc.state = 'pending'
    FROM platform.student_cases sc WHERE sc.id = :'p279_timur_case')
  AND (SELECT r.status = 'requested' FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(107)),
  'another student''s data was touched beyond the mention of the erased person'
);

-- ===========================================================================
-- (iii) Processing Bekzat (pending анкета, lead created from it) and Bare.
-- ===========================================================================
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p279_bekzat_rid')::TEXT AS p279_bekzat_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_bare_rid')::TEXT AS p279_bare_processed \gset
RESET ROLE;
SELECT pg_temp.p279_assert(
  jsonb_array_length(:'p279_bekzat_processed'::JSONB -> 'storageObjects') = 0
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_bekzat_app')
  AND (SELECT k.email IS NULL AND k.display_name LIKE 'Удалённый пользователь · %'
    FROM platform.leads l JOIN platform.clients k ON k.id = l.client_id WHERE l.id = :'p279_bekzat_lead')
  AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_bekzat_lead'),
  'the applicant''s анкета, client and lead were not erased'
);
DELETE FROM auth.users WHERE id IN (pg_temp.p279_id(105), pg_temp.p279_id(106));
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  (platform.complete_account_deletion_v1(:'p279_bekzat_rid', 'not_configured') ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_bare_rid', 'no_address') ->> 'status') = 'completed',
  'applicant requests did not complete'
);
RESET ROLE;
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles('(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат Анкетов)') = '',
  'personal values of the erased applicants remain: ' ||
    pg_temp.p279_needles('(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат Анкетов)')
);
SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.p279_id(1)
    AND e.action IN ('account.deletion.process', 'account.deletion.complete')) >= 6
  AND NOT EXISTS (SELECT 1 FROM platform_private.account_deletion_requests r
    WHERE r.status = 'completed' AND r.confirmation_email IS NOT NULL),
  'processing and completion are not journaled, or a completed request kept the address'
);

-- ===========================================================================
-- (vi) Classification: every table naming a student case, a student
-- membership or a notification recipient is either erased, kept anonymized,
-- part of the WhatsApp correspondence (not touched, reported) or staff-only.
-- ===========================================================================
DO $p279_classification$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(DISTINCT c.table_schema || '.' || c.table_name, ', ') INTO missing
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema IN ('platform', 'platform_private', 'private')
    AND c.column_name IN ('student_case_id', 'student_membership_id', 'recipient_membership_id', 'client_case_id',
      'previous_student_case_id', 'new_student_case_id')
    AND (c.table_schema || '.' || c.table_name) NOT IN (
      -- erased
      'platform.case_chat_messages', 'platform.case_chat_threads', 'platform.case_help_requests',
      'platform.case_notes', 'platform.case_task_events', 'platform.case_tasks', 'platform.case_contract_files',
      'platform.payment_receipt_files', 'platform.student_case_contract_drafts', 'platform.document_access_events',
      'platform.document_reviews', 'platform.document_slot_case_links', 'platform.document_slots',
      'platform.document_validation_events', 'platform.document_versions', 'platform.learning_lesson_attempts',
      'platform.notification_delivery_intents', 'platform.notification_events', 'platform.notifications',
      'platform.staff_notifications', 'platform.student_assessment_attempts',
      'platform.student_portal_notification_projection_v1', 'platform.student_portal_overdue_notification_projection_v1',
      'platform.student_profile_field_proposals', 'platform.student_profile_field_reviews',
      'platform.student_profile_fields', 'platform.student_profiles', 'platform.student_case_updates',
      'platform.university_application_events', 'platform.university_applications', 'platform.visa_case_events',
      'platform.visa_cases', 'platform_private.application_document_download_contexts',
      'platform_private.application_document_submission_reviews', 'platform_private.application_document_submissions',
      'platform_private.application_document_upload_contexts', 'platform_private.application_package_items',
      'platform_private.application_package_reviews', 'platform_private.application_package_submissions',
      'platform_private.application_requirement_items', 'platform_private.application_requirement_revisions',
      'platform_private.case_chat_read_positions', 'platform_private.catalog_preparation_bindings',
      'platform_private.docs_student_intake_requests', 'platform_private.document_download_grants',
      'platform_private.document_export_artifacts', 'platform_private.document_malware_scan_attestations',
      'platform_private.document_recognition_jobs', 'platform_private.document_storage_bindings',
      'platform_private.document_upload_finalizations', 'platform_private.document_upload_reservations',
      'platform_private.kb_nodes', 'platform_private.learning_requests',
      'platform_private.message_media_attachment_intents', 'platform_private.message_media_attachment_uploads',
      'platform_private.partner_packets', 'platform_private.student_applications',
      'platform_private.student_assessment_requests', 'platform_private.student_document_scan_admissions',
      'platform_private.student_portal_overdue_transition_state', 'platform_private.student_portal_provisioning_receipts',
      'platform_private.student_profile_export_attempts',
      -- kept anonymized (contract, payments, lifecycle, journal-like records)
      'platform.student_cases', 'platform.payment_events', 'platform.payment_evidence',
      'platform.payment_obligations', 'platform.stop_factor_events', 'platform.stop_factors',
      'platform.post_contract_items', 'platform.post_contract_reports', 'platform.sales_admissions_handoffs',
      'platform.student_case_assignment_events', 'platform.student_case_handoff_acknowledgements',
      'platform.student_case_lifecycle_events', 'platform.student_case_op_handoffs',
      'platform.pilot_cohort_membership_events', 'platform_private.pilot_cohort_membership_receipts',
      'platform_private.admissions_events', 'platform_private.sales_admissions_handoff_receipts',
      'platform_private.amocrm_command_attempts', 'platform_private.amocrm_command_receipts',
      'platform_private.case_curator_coverages', 'platform_private.sales_handoff_owner_sync_receipts',
      -- WhatsApp sales correspondence and its AI (not touched, reported)
      'platform.communication_conversations', 'platform.communication_messages',
      'platform.conversation_handoff_events', 'platform.ai_draft_requests', 'platform.ai_drafts',
      'platform.decision_backlogs')
    ;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 279 classification: unclassified tables %', missing;
  END IF;
END
$p279_classification$;

SELECT 'P279_ACCOUNT_DELETION_SUITE_PASSED' AS p279_suite_marker;
ROLLBACK;
