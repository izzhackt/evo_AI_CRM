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
--          (only the mention of the erased person by phone is replaced);
--          another person with the SAME full name, a school name and the
--          word «сестра» in another student's note stay untouched (review
--          finding 1: names only clean the subject's own rows);
--   (v)    the guard bypass exists only inside the processing statement;
--   (vi)   every table that names a student case, a student membership, a
--          notification recipient, a lead, a client or a conversation is
--          classified (fails on a new table); conversation tables are erased
--          by the general conversation_id rule;
--   (vii)  the WhatsApp chat of the erased student (REAL WAHA chain: raw
--          webhook event, queue, projection) goes with every dependent row:
--          messages, media and the media file, bindings, AI memory, answer,
--          autosend journal, ticket, amoCRM context, decision question
--          (review finding 2); amoCRM links require the Admin's confirmation
--          before completion;
--   (viii) journal entries about the subject's task or document version that
--          name the case only inside their state lose the first name too
--          (finding 3: found by the ids of the deleted rows).
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
-- sale conditions mention Zarina by her phone (a mention in another record).
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
  ('mother_last_name', 'Удалёва'), ('mobile_phone', '+996 700 279 279'),
  ('education_1_school_name', 'Школа-гимназия №5'), ('emergency_contact_relationship', 'Сестра'),
  ('emergency_contact_name', 'Айнура Удалёва'),
  ('emergency_contact_phone_email', '+996 555 279 000, ainura279@example.invalid'),
  ('permanent_address', 'Бишкек, ул. Синтетическая 279')) AS f(k, v)
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
    'service_label', 'Поступление в Китай', 'payment_note', 'Рекомендация от клиента +996 700 279 279'), 1,
    pg_temp.p279_id(302));
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

-- ---------------------------------------------------------------------------
-- Review fixes (PLAN_CHANGES 2026-10-08).
-- Finding 1: ANOTHER person named «Зарина Удалёва» (client, lead, sales
-- register row, manual lead receipt, journal entry) and a note in Timur's
-- case with Zarina's school and the word «сестра». Finding 3: journal entries
-- about Zarina's task and passport version that name her case only inside
-- their state and her first name only.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(1101), pg_temp.p279_id(1), 'Зарина Удалёва',
  platform_private.normalize_person_name('Зарина Удалёва'), '+996 777 000 111', '+996777000111');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(1102), pg_temp.p279_id(1), pg_temp.p279_id(1101), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(1103), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', pg_temp.p279_id(1102), pg_temp.p279_id(1101),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996777000111', 'notes', 'Сестра платит',
    'contract_number', 'EVO-1103', 'paid_minor', 100000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996777000111', 'notes', ''),
  100000, 'USD');
INSERT INTO platform_private.manual_lead_receipts (request_id, organization_id, actor_membership_id, payload, lead_id)
VALUES (pg_temp.p279_id(1104), pg_temp.p279_id(1), pg_temp.p279_id(302),
  jsonb_build_object('displayName', 'Зарина Удалёва', 'phone', '+996 777 000 111', 'school', 'Школа-гимназия №5'),
  pg_temp.p279_id(1102));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES
  (pg_temp.p279_id(1105), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.create', 'lead', pg_temp.p279_id(1102),
   jsonb_build_object('display_name', 'Зарина Удалёва', 'note', 'Сестра Айгуль'), 'P279 homonym lead Зарина Удалёва',
   pg_temp.p279_id(1106)),
  (pg_temp.p279_id(1108), pg_temp.p279_id(1), 'system', 'service:p279', 'task.create', 'case_task', pg_temp.p279_id(891),
   jsonb_build_object('student_case_id', :'p279_zarina_case', 'title', 'Позвонить Зарина'), 'P279 task created',
   pg_temp.p279_id(1109)),
  (pg_temp.p279_id(1110), pg_temp.p279_id(1), 'system', 'service:p279', 'document.version.review', 'document_version',
   pg_temp.p279_id(802), jsonb_build_object('student_case_id', :'p279_zarina_case', 'reason', 'Зарина, паспорт размыт'),
   'P279 document review', pg_temp.p279_id(1112));
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1107), pg_temp.p279_id(1), NULL, :'p279_timur_case',
  'Окончила Школа-гимназия №5; на встречу придёт сестра', pg_temp.p279_id(303));
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Finding 2: Zarina's WhatsApp chat through the REAL WAHA chain (raw webhook
-- event, durable work, projection), bound to her client and lead; a media file
-- in platform-whatsapp-media; AI memory, an AI answer, the autosend journal, a
-- ticket, amoCRM context, a decision question on her case; an amoCRM contact
-- link of her client.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('platform-whatsapp-media', 'platform-whatsapp-media', FALSE)
ON CONFLICT (id) DO NOTHING;
CREATE FUNCTION pg_temp.p279_wa(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.p279_id(1);
  event_id CONSTANT UUID := pg_temp.p279_id(1200 + p_n);
  enq JSONB; claim JSONB; proj JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'p279-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', to_timestamp((p_payload ->> 'timestamp')::BIGINT),
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:p279:' || p_n, lpad(to_hex(2790000 + p_n), 64, '0'),
    pg_temp.p279_id(1300 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('p279-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.p279_id(1400 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'p279', pg_temp.p279_id(1400 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.p279_id(301),
    pg_temp.p279_id(1400 + p_n * 10 + 3));
  PERFORM platform.finish_waha_webhook_work(org, work, attempt,
    (proj ->> 'disposition')::platform.durable_work_finish_outcome, proj ->> 'error_code', proj ->> 'evidence_ref',
    NULL, pg_temp.p279_id(1400 + p_n * 10 + 4));
  RETURN proj;
END
$$;
CREATE TEMP TABLE p279_wa_runs(n INTEGER PRIMARY KEY, result JSONB);
INSERT INTO p279_wa_runs VALUES
  (1, pg_temp.p279_wa(1, jsonb_build_object('id', 'false_996700279279@c.us_P279' || lpad('1', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '30 minutes')::BIGINT,
    'from', '996700279279@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, это Зарина Удалёва, мой номер +996 700 279 279')));
INSERT INTO p279_wa_runs VALUES
  (2, pg_temp.p279_wa(2, jsonb_build_object('id', 'false_996700279279@c.us_P279' || lpad('2', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '29 minutes')::BIGINT,
    'from', '996700279279@c.us', 'fromMe', false, 'source', 'app', 'body', 'Паспорт',
    'hasMedia', true, 'media', jsonb_build_object('mimetype', 'application/pdf',
      'filename', 'Паспорт Зарина Удалёва AN2790279.pdf'))));
INSERT INTO p279_wa_runs VALUES
  (3, pg_temp.p279_wa(3, jsonb_build_object('id', 'true_996700279279@c.us_P279' || lpad('3', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '28 minutes')::BIGINT,
    'from', '79967000000@c.us', 'to', '996700279279@c.us', 'fromMe', true, 'source', 'app',
    'body', 'Зарина, пришлите, пожалуйста, паспорт')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT count(*) = 3 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p279_wa_runs),
  'the three synthetic WhatsApp messages did not project through the real chain: '
    || (SELECT string_agg(result::TEXT, ' ') FROM p279_wa_runs));
SELECT b.conversation_id AS p279_conv FROM platform_private.waha_direct_chat_bindings b
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279279@c.us' \gset
SELECT m.id AS p279_wa_in FROM platform.communication_messages m
WHERE m.conversation_id = :'p279_conv' AND m.direction = 'inbound' ORDER BY m.created_at, m.id LIMIT 1 \gset
SELECT m.id AS p279_wa_media_msg FROM platform.communication_messages m
WHERE m.conversation_id = :'p279_conv' AND m.source_webhook_event_id = pg_temp.p279_id(1202) \gset

-- The chain bound the chat to a client and lead it created from the number
-- («WhatsApp +996 ••• 27 92 79»), not to Zarina's анкета client: the erasure
-- finds the chat by her phone.
SELECT pg_temp.p279_assert((SELECT c.canonical_client_id IS DISTINCT FROM :'p279_zarina_client'::UUID
    AND c.canonical_client_id IS NOT NULL FROM platform.communication_conversations c WHERE c.id = :'p279_conv'),
  'fixture: the WAHA chain did not bind the chat to its own client');
SELECT c.canonical_client_id AS p279_wa_client, c.canonical_lead_id AS p279_wa_lead
FROM platform.communication_conversations c WHERE c.id = :'p279_conv' \gset

-- The archived media of the second message (the archive worker's result).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.communication_message_media (id, organization_id, conversation_id, communication_message_id,
  ordinal, media_kind, mime_type, file_name, file_size_bytes, archival_status, archived_at)
VALUES (pg_temp.p279_id(1500), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_media_msg', 0, 'pdf', 'application/pdf',
  'Паспорт Зарина Удалёва AN2790279.pdf', 2048, 'archived', statement_timestamp());
INSERT INTO platform_private.waha_media_object_bindings (id, organization_id, media_id, communication_message_id,
  source_webhook_event_id, waha_session_name, raw_chat_id, raw_message_id, bucket_id, object_name)
VALUES (pg_temp.p279_id(1501), pg_temp.p279_id(1), pg_temp.p279_id(1500), :'p279_wa_media_msg', pg_temp.p279_id(1202),
  'crm_primary', '996700279279@c.us', 'false_996700279279@c.us_P279' || lpad('2', 15, '0'),
  'platform-whatsapp-media', 'cd/' || repeat('e', 62));
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('platform-whatsapp-media', 'cd/' || repeat('e', 62), '{}'::JSONB);
INSERT INTO platform_private.ai_client_memory (conversation_id, organization_id, interest, summary, covered_message_id,
  covered_count, interest_message_id, interest_updated_at, model, version)
VALUES (:'p279_conv', pg_temp.p279_id(1), 'Китай, инженерия', 'Зарина Удалёва хочет в Китай, телефон +996 700 279 279',
  :'p279_wa_in', 1, :'p279_wa_in', statement_timestamp(), 'gemini-2.5-flash', 1);
INSERT INTO platform_private.conversation_ai_memory_versions (id, organization_id, conversation_id, version,
  short_summary, long_summary, short_summary_sha256, long_summary_sha256, source_message_id,
  recorded_by_membership_id, reason, request_id)
VALUES (pg_temp.p279_id(1502), pg_temp.p279_id(1), :'p279_conv', 1, 'Зарина Удалёва, Китай',
  'Зарина Удалёва, паспорт AN2790279, мама Гульнара Удалёва',
  platform_private.ai_memory_text_sha256('Зарина Удалёва, Китай'),
  platform_private.ai_memory_text_sha256('Зарина Удалёва, паспорт AN2790279, мама Гульнара Удалёва'),
  :'p279_wa_in', pg_temp.p279_id(302), 'P279 память', pg_temp.p279_id(1503));
INSERT INTO platform_private.ai_answers (id, organization_id, conversation_id, source_message_id, intent,
  knowledge_fingerprint, status, result)
VALUES (pg_temp.p279_id(1504), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_in', 'reply', repeat('a', 64), 'ready',
  jsonb_build_object('text', 'Зарина Удалёва, спасибо, ждём паспорт'));
INSERT INTO platform_private.ai_autosend_log (id, organization_id, conversation_id, client_message_id, source_at,
  interval_start, interval_end, status, mode, body)
VALUES (pg_temp.p279_id(1505), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_in', statement_timestamp(),
  statement_timestamp() - INTERVAL '1 hour', statement_timestamp(), 'considering', 'shadow',
  'Зарина Удалёва, номер +996 700 279 279');
INSERT INTO platform_private.ai_tickets (token_sha256, id, organization_id, membership_id, purpose, conversation_id,
  issued_at, expires_at)
VALUES (repeat('b', 64), pg_temp.p279_id(1506), pg_temp.p279_id(1), pg_temp.p279_id(302), 'answer', :'p279_conv',
  statement_timestamp(), statement_timestamp() + INTERVAL '30 seconds');
INSERT INTO platform_private.amocrm_canonical_context_observations (id, organization_id, conversation_id, request_id,
  payload_sha256, observed_state, amocrm_account_id, amocrm_contact_id, amocrm_lead_id, contact_name, lead_name,
  observed_capabilities, adapter_contract_version, projected_state, projected_public_json, projected_version)
VALUES (pg_temp.p279_id(1507), pg_temp.p279_id(1), :'p279_conv', pg_temp.p279_id(1508), repeat('c', 64), 'available',
  279, 279, 279, 'Зарина Удалёва', 'Сделка Зарина Удалёва', '{}', 1, 'available', '{}'::JSONB, 1);
INSERT INTO platform.decision_backlogs (id, organization_id, conversation_id, student_case_id, created_by_profile_id,
  created_by_membership_id)
VALUES (pg_temp.p279_id(1509), pg_temp.p279_id(1), :'p279_conv', :'p279_zarina_case', pg_temp.p279_id(202),
  pg_temp.p279_id(302));
INSERT INTO platform.decision_backlog_versions (id, organization_id, conversation_id, decision_backlog_id,
  effective_version, question, owner_role, status, affected_requirement_kind, input_sha256, created_by_profile_id,
  created_by_membership_id, request_id)
VALUES (pg_temp.p279_id(1510), pg_temp.p279_id(1), :'p279_conv', pg_temp.p279_id(1509), 1,
  'Какой вуз выбрала Зарина Удалёва?', 'sales', 'unresolved', 'general', repeat('d', 64), pg_temp.p279_id(202),
  pg_temp.p279_id(302), pg_temp.p279_id(1511));
INSERT INTO platform_private.amocrm_contact_bindings (organization_id, person_id, contact_id, latest_attempt_id)
VALUES (pg_temp.p279_id(1), :'p279_zarina_client', '279279', pg_temp.p279_id(1512));
SET LOCAL session_replication_role = origin;

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
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
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
  AND (:'p279_detail'::JSONB #>> '{counts,delete,files}')::INT = 3
  AND (:'p279_detail'::JSONB #>> '{counts,delete,chatMessages}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,delete,whatsappChats}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,clients}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,leads}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,paymentObligations}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,salesRecords}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,remain,amocrmContacts}')::INT = 1
  AND (:'p279_detail'::JSONB ->> 'amocrmContacts')::INT = 1
  AND NOT ((:'p279_detail'::JSONB #> '{counts,remain}') ? 'whatsappChats')
  AND (:'p279_detail'::JSONB ->> 'authAccountExists')::BOOLEAN,
  'the detail does not count what will be deleted and kept: ' || :'p279_detail'
);

-- ===========================================================================
-- (iii) Processing Zarina (approved student).
-- ===========================================================================
SELECT platform.process_account_deletion_v1(:'p279_zarina_rid')::TEXT AS p279_processed \gset
SELECT pg_temp.p279_assert(
  :'p279_processed'::JSONB ->> 'status' = 'processing'
  AND (:'p279_processed'::JSONB ->> 'authUserId')::UUID = pg_temp.p279_id(104)
  AND :'p279_processed'::JSONB ->> 'email' = 'p279-zarina@example.invalid'
  AND jsonb_array_length(:'p279_processed'::JSONB -> 'storageObjects') = 3
  AND (:'p279_processed'::JSONB -> 'storageObjects') @> jsonb_build_array(jsonb_build_object(
    'bucket', 'platform-whatsapp-media', 'name', 'cd/' || repeat('e', 62))),
  'processing did not return the Auth user, the address and the three Storage keys (WhatsApp media included)'
);
-- Re-run is safe and returns the same remaining keys.
SELECT pg_temp.p279_assert(
  (platform.process_account_deletion_v1(:'p279_zarina_rid') -> 'storageObjects')
    = (:'p279_processed'::JSONB -> 'storageObjects'),
  'a repeated processing did not return the same remaining Storage keys'
);
-- Completion is refused while the Auth user or the files are still there.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
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
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
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
-- amoCRM is outside the database: without the Admin's confirmation that the
-- contact and the deal are deleted there, the request stays open.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, FALSE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_amocrm_unconfirmed'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, NULL)', :'p279_zarina_rid', 'sent'))
    = '22023 account_deletion_invalid',
  'completion did not require the amoCRM confirmation'
);
SELECT platform.complete_account_deletion_v1(:'p279_zarina_rid', 'sent', TRUE)::TEXT AS p279_completed \gset
SELECT pg_temp.p279_assert(
  :'p279_completed'::JSONB ->> 'status' = 'completed'
  AND :'p279_completed'::JSONB ->> 'confirmationEmailStatus' = 'sent'
  AND platform.complete_account_deletion_v1(:'p279_zarina_rid', 'failed', FALSE) = :'p279_completed'::JSONB
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

-- (vii) The WhatsApp chat is gone with its raw webhook events, durable work,
-- bindings, media file, AI data, amoCRM context and decision question; the
-- amoCRM confirmation is in the summary and the journal.
SELECT pg_temp.p279_assert(
  NOT EXISTS (SELECT 1 FROM platform.communication_conversations x WHERE x.id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.communication_message_media x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.conversation_participants x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events x
    WHERE x.id IN (pg_temp.p279_id(1201), pg_temp.p279_id(1202), pg_temp.p279_id(1203)))
  AND NOT EXISTS (SELECT 1 FROM platform_private.durable_work_items x
    WHERE x.source_webhook_event_id IN (pg_temp.p279_id(1201), pg_temp.p279_id(1202), pg_temp.p279_id(1203)))
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_direct_chat_bindings x
    WHERE x.normalized_chat_id = '996700279279@c.us')
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_message_bindings x WHERE x.raw_message_id LIKE '%996700279279%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_media_object_bindings x WHERE x.id = pg_temp.p279_id(1501))
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.conversation_ai_memory_versions x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_answers x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_tickets x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.amocrm_canonical_context_observations x
    WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.decision_backlogs x WHERE x.id = pg_temp.p279_id(1509))
  AND NOT EXISTS (SELECT 1 FROM platform.decision_backlog_versions x WHERE x.decision_backlog_id = pg_temp.p279_id(1509))
  AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.name = 'cd/' || repeat('e', 62))
  AND (SELECT k.display_name LIKE 'Удалённый пользователь · %' AND k.phone IS NULL AND k.normalized_phone IS NULL
    FROM platform.clients k WHERE k.id = :'p279_wa_client')
  AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_wa_lead')
  AND NOT EXISTS (SELECT 1 FROM platform.external_identifiers x
    WHERE x.client_id = :'p279_wa_client' OR x.lead_id = :'p279_wa_lead')
  AND (SELECT (r.summary #>> '{deleted,whatsappChats}')::INT = 1 AND (r.summary ->> 'amocrmErasureConfirmed')::BOOLEAN
    FROM platform_private.account_deletion_requests r WHERE r.id = :'p279_zarina_rid')
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'account.deletion.complete'
    AND e.resource_id = :'p279_zarina_rid' AND (e.after_state ->> 'amocrm_erasure_confirmed')::BOOLEAN),
  'the WhatsApp chat, its raw events or AI data remain, or the amoCRM confirmation is not recorded'
);

-- (viii) Journal entries about Zarina's task and passport version lose her first name.
SELECT pg_temp.p279_assert(
  (SELECT e.after_state ->> 'title' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1108))
    = 'Позвонить [удалено]'
  AND (SELECT e.after_state ->> 'reason' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1110))
    = '[удалено], паспорт размыт',
  'journal entries that name the case only in their state kept the first name'
);

-- (iv) The identifiers of the erased student are nowhere. Another person with
-- the same full name, the school and «сестра» in another student's note stay
-- as they were; Timur's own data is intact, the mention of Zarina's phone in
-- his sale conditions is replaced.
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles('(p279-zarina@example\.invalid|996 ?700 ?279 ?279|AN2790279|996 ?555 ?279 ?000|ainura279@example\.invalid)') = '',
  'identifiers of the erased student remain: ' ||
    pg_temp.p279_needles('(p279-zarina@example\.invalid|996 ?700 ?279 ?279|AN2790279|996 ?555 ?279 ?000|ainura279@example\.invalid)')
);
SELECT pg_temp.p279_assert(
  (SELECT k.display_name = 'Зарина Удалёва' AND k.phone = '+996 777 000 111'
    FROM platform.clients k WHERE k.id = pg_temp.p279_id(1101))
  AND (SELECT sr.fields ->> 'applicant_name' = 'Зарина Удалёва' AND sr.fields ->> 'notes' = 'Сестра платит'
      AND sr.source_snapshot ->> 'applicant_name' = 'Зарина Удалёва'
    FROM platform_private.sales_register sr WHERE sr.id = pg_temp.p279_id(1103))
  AND (SELECT x.payload = jsonb_build_object('displayName', 'Зарина Удалёва', 'phone', '+996 777 000 111',
      'school', 'Школа-гимназия №5')
    FROM platform_private.manual_lead_receipts x WHERE x.request_id = pg_temp.p279_id(1104))
  AND (SELECT e.after_state = jsonb_build_object('display_name', 'Зарина Удалёва', 'note', 'Сестра Айгуль')
      AND e.reason = 'P279 homonym lead Зарина Удалёва'
    FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1105))
  AND (SELECT n.body = 'Окончила Школа-гимназия №5; на встречу придёт сестра'
    FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(1107)),
  'another person with the same name, or the school and «сестра» in another student''s note, were touched'
);
SELECT pg_temp.p279_assert(
  (SELECT lc.fields ->> 'payment_note' FROM platform_private.lead_sale_conditions lc
    WHERE lc.lead_id = :'p279_timur_lead') = 'Рекомендация от клиента [удалено]'
  AND EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_timur_app'
    AND a.normalized_email = 'p279-timur@example.invalid' AND a.questionnaire ->> 'lastName' = 'Остаётся')
  AND (SELECT sc.student_display_name = 'Тимур Остаётся' AND sc.state = 'pending'
    FROM platform.student_cases sc WHERE sc.id = :'p279_timur_case')
  AND (SELECT r.status = 'requested' FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(107)),
  'another student''s data was touched beyond the mention of the erased person'
);
-- Names and the address: once the other person's rows are removed (they
-- rightly carry the same name), none of the erased student's is left.
SET LOCAL session_replication_role = replica;
DELETE FROM platform.audit_events WHERE id = pg_temp.p279_id(1105);
DELETE FROM platform_private.manual_lead_receipts WHERE request_id = pg_temp.p279_id(1104);
DELETE FROM platform_private.sales_register WHERE id = pg_temp.p279_id(1103);
DELETE FROM platform.leads WHERE id = pg_temp.p279_id(1102);
DELETE FROM platform.clients WHERE id = pg_temp.p279_id(1101);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles('(Зарина Удалёва|Гульнара Удалёва|Айнура Удалёва|Синтетическая 279)') = '',
  'names or the address of the erased student remain: ' ||
    pg_temp.p279_needles('(Зарина Удалёва|Гульнара Удалёва|Айнура Удалёва|Синтетическая 279)')
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
  (platform.complete_account_deletion_v1(:'p279_bekzat_rid', 'not_configured', FALSE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_bare_rid', 'no_address', FALSE) ->> 'status') = 'completed',
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
-- membership, a notification recipient, a lead, a client or a conversation is
-- either erased, kept anonymized, kept as a link without personal values or
-- staff-only. A table with a uuid conversation_id column is erased by the
-- general rule of account_erasure_conversation_rows (review finding 2).
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
      'previous_student_case_id', 'new_student_case_id', 'lead_id', 'client_id', 'canonical_lead_id',
      'canonical_client_id', 'linked_lead_id', 'person_id', 'conversation_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns cc
      WHERE cc.table_schema = c.table_schema AND cc.table_name = c.table_name
        AND cc.column_name = 'conversation_id' AND cc.udt_name = 'uuid'
        AND c.table_schema IN ('platform', 'platform_private'))
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
      'platform_private.message_media_attachment_uploads',
      'platform_private.partner_packets', 'platform_private.student_applications',
      'platform_private.student_assessment_requests', 'platform_private.student_document_scan_admissions',
      'platform_private.student_portal_overdue_transition_state', 'platform_private.student_portal_provisioning_receipts',
      'platform_private.student_profile_export_attempts',
      'platform.communication_conversations', 'platform.external_identifiers', 'platform.subject_provenance',
      'platform_private.manual_lead_receipts', 'platform_private.staff_lead_task_links',
      'platform_private.website_lead_receipts',
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
      'platform.leads', 'platform.lead_admissions_gates', 'platform_private.lead_admissions_gate_receipts',
      'platform_private.lead_attribution_touches', 'platform_private.lead_sale_conditions',
      'platform_private.sales_lead_workflow_receipts', 'platform_private.sales_register',
      -- kept: links without personal values (client merge aliases; amoCRM
      -- numbers, deleted in amoCRM by the Admin before completion)
      'platform_private.client_aliases', 'platform_private.amocrm_contact_bindings',
      'platform_private.amocrm_lead_bindings')
    ;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 279 classification: unclassified tables %', missing;
  END IF;
END
$p279_classification$;

SELECT 'P279_ACCOUNT_DELETION_SUITE_PASSED' AS p279_suite_marker;
ROLLBACK;
