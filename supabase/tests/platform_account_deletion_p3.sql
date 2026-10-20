\set ON_ERROR_STOP on

-- Acceptance for migration 313 «Удаление аккаунта (280): доработки P3 после review 15.10»
-- (issue #1192; docs/PLAN_CHANGES.md «2026-10-21 · Удаление аккаунта (280): доработки P3
-- (миграция 313)»). Runs right after the migration, on the full schema. Accounts come through
-- the REAL анкета path (submit/decide_student_application_v1) and the real member
-- provisioning; the Auth server's own work (auth.admin.deleteUser, hard or soft) is the only
-- simulated part, exactly as in platform_account_deletion.sql. Every row rolls back at the end.
--
-- Proven here:
--   SQL-1  the result of the Auth journal erasure is kept: «erased» with the number of entries,
--          or «not_erased» when the function owner may not DELETE from an Auth table (one of
--          the two tables: what may be erased is, the rest is named); the result is in
--          summary.authLog, in the journal row after_state.auth_log and in the Admin's detail;
--          the final complete step overrides the first one;
--   SQL-2  an automatic request in «processing» whose login is only soft-deleted (deleted_at)
--          is closed by complete_account_deletion_v1; an active login still refuses it; an
--          absent one closes it as before;
--   F3     a request in «processing» whose account stopped being simple (a second анкета with
--          an intake owner) reads as manual, is refused by process (account_deletion_not_simple),
--          waits for the login (account_deletion_login_active) and is then closed by
--          mark_account_deletion_done_v1 with the started-automatic evidence; a SIMPLE
--          processing request is still refused by mark (account_deletion_processing), an
--          unprocessed simple one too (account_deletion_automatic_available); the form
--          constraint still demands a note for a manual completion;
--   SQL-3  the five account.deletion.* actions and the account_deletion_request object type
--          are in the journal allowlist (plus exactly five and one; the older entries stay);
--   UI-F4  the queue row says whether an applicant submitted an анкета (open: from the table;
--          started and completed: from the counts of the summary; a student: null);
--   UI-F6  staff_account_deletion_open_count_v1: {open, overdue} for the Admin only, no person
--          data, completed requests are not counted.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $p313_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$p313_auth_role$;
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID, id UUID PRIMARY KEY, payload JSON, created_at TIMESTAMPTZ, ip_address VARCHAR(64)
);
CREATE TABLE IF NOT EXISTS auth.flow_state (id UUID PRIMARY KEY, user_id UUID, auth_code TEXT);

CREATE FUNCTION pg_temp.p313_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p313_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 313 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p313_claims(p_auth_user_id UUID) RETURNS TEXT
LANGUAGE SQL AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', p_auth_user_id,
    'claims', jsonb_build_object('sub', p_auth_user_id, 'role', 'authenticated'))) -> 'claims')::TEXT
$$;

-- Runs one RPC expression as somebody: a user id (its real access-token claims, role
-- authenticated), 'anon' or 'service_role'. {"ok": result} or {"error", "message", "detail"}.
CREATE FUNCTION pg_temp.p313_call(p_who TEXT, p_sql TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_detail TEXT;
BEGIN
  BEGIN
    IF p_who IN ('anon', 'service_role') THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_who)::TEXT, TRUE);
      EXECUTE format('SET LOCAL ROLE %I', p_who);
    ELSE
      PERFORM set_config('request.jwt.claims', pg_temp.p313_claims(p_who::UUID), TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('error', v_state, 'message', v_message, 'detail', NULLIF(v_detail, ''));
  END;
END
$$;

CREATE FUNCTION pg_temp.p313_questionnaire(p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
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

-- A real анкета submitted by the account itself.
CREATE FUNCTION pg_temp.p313_submit(p_auth_user_id UUID, p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.p313_call(p_auth_user_id::TEXT, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    p_request, pg_temp.p313_questionnaire(p_request, p_first, p_last, p_phone)));
  PERFORM pg_temp.p313_assert(r ? 'ok', 'анкета submit failed: ' || r::TEXT);
  RETURN (r #>> '{ok,id}')::UUID;
END
$$;

-- One request of an account, opened by the account itself; returns the request row id.
CREATE FUNCTION pg_temp.p313_request(p_auth_user_id UUID, p_request UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.p313_call(p_auth_user_id::TEXT, format('platform.request_account_deletion_v2(%L::UUID)', p_request));
  PERFORM pg_temp.p313_assert(r ? 'ok', 'the account could not request deletion: ' || r::TEXT);
  RETURN (SELECT d.id FROM platform_private.account_deletion_requests d WHERE d.subject_auth_user_id = p_auth_user_id
    AND d.status IN ('requested', 'acknowledged', 'processing') ORDER BY d.created_at DESC LIMIT 1);
END
$$;

CREATE FUNCTION pg_temp.p313_admin(p_sql TEXT) RETURNS JSONB
LANGUAGE SQL AS $$ SELECT pg_temp.p313_call(pg_temp.p313_id(101)::TEXT, p_sql) $$;

-- ---------------------------------------------------------------------------
-- Seed: organization, staff (system Admin, Sales, Curator), the анкета configuration WITHOUT an
-- intake owner (an анкета then links no lead: the simple applicant).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.p313_id(1), 'Migration 313 synthetic organization');
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p313_id(2), pg_temp.p313_id(1), 'organization', pg_temp.p313_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
SELECT pg_temp.p313_id(100 + n), 'p313-' || k || '@example.invalid', '{}'::JSONB, statement_timestamp()
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'ainur'), (5, 'bare'), (6, 'cora'), (7, 'dara'),
  (8, 'esen'), (9, 'fatima'), (10, 'gulnara'), (11, 'student'), (12, 'hana'), (13, 'ilgiz')) AS a(n, k);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p313_id(201), pg_temp.p313_id(101), 'P313 Admin', 'active', 1),
  (pg_temp.p313_id(202), pg_temp.p313_id(102), 'P313 Sales', 'active', 1),
  (pg_temp.p313_id(203), pg_temp.p313_id(103), 'P313 Curator', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p313_id(300 + a.n), pg_temp.p313_id(1), pg_temp.p313_id(200 + a.n), 'active',
  a.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
     AND status = 'published' ORDER BY version DESC LIMIT 1),
  a.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p313_id(1), pg_temp.p313_id(300 + n), pg_temp.p313_id(2), 1, 1, TRUE, 'system',
  'P313 synthetic organization scope', pg_temp.p313_id(600 + n)
FROM generate_series(1, 3) AS n;

INSERT INTO platform.staff_departments (id, organization_id, name)
VALUES (pg_temp.p313_id(930), pg_temp.p313_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
VALUES (TRUE, pg_temp.p313_id(1), pg_temp.p313_id(930), TRUE, NULL);

SELECT pg_temp.p313_id(101)::TEXT AS p313_admin, pg_temp.p313_id(102)::TEXT AS p313_sales,
  pg_temp.p313_id(103)::TEXT AS p313_curator, pg_temp.p313_id(104)::TEXT AS p313_ainur,
  pg_temp.p313_id(105)::TEXT AS p313_bare, pg_temp.p313_id(106)::TEXT AS p313_cora,
  pg_temp.p313_id(107)::TEXT AS p313_dara, pg_temp.p313_id(108)::TEXT AS p313_esen,
  pg_temp.p313_id(109)::TEXT AS p313_fatima, pg_temp.p313_id(110)::TEXT AS p313_gulnara,
  pg_temp.p313_id(111)::TEXT AS p313_student, pg_temp.p313_id(112)::TEXT AS p313_hana,
  pg_temp.p313_id(113)::TEXT AS p313_ilgiz \gset

-- ---------------------------------------------------------------------------
-- Accounts. Simple applicants with a pending анкета: Айнур, Кора, Дара, Эсен, Фатима, Гульнара,
-- Хана, Ильгиз. «Bare» signed up without an анкета. A student membership without any case.
-- Auth journal entries and PKCE flows of Айнур, Кора and Хана (and a bystander's that must stay).
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_submit(:'p313_ainur', pg_temp.p313_id(701), 'Айнур', 'Первая', '+996 700 313 104') AS p313_ainur_app \gset
SELECT pg_temp.p313_submit(:'p313_cora', pg_temp.p313_id(702), 'Кора', 'Вторая', '+996 700 313 106') AS p313_cora_app \gset
SELECT pg_temp.p313_submit(:'p313_dara', pg_temp.p313_id(703), 'Дара', 'Третья', '+996 700 313 107') AS p313_dara_app \gset
SELECT pg_temp.p313_submit(:'p313_esen', pg_temp.p313_id(704), 'Эсен', 'Четвёртый', '+996 700 313 108') AS p313_esen_app \gset
SELECT pg_temp.p313_submit(:'p313_fatima', pg_temp.p313_id(705), 'Фатима', 'Пятая', '+996 700 313 109') AS p313_fatima_app \gset
SELECT pg_temp.p313_submit(:'p313_gulnara', pg_temp.p313_id(706), 'Гульнара', 'Шестая', '+996 700 313 110') AS p313_gulnara_app \gset
SELECT pg_temp.p313_submit(:'p313_hana', pg_temp.p313_id(707), 'Хана', 'Седьмая', '+996 700 313 112') AS p313_hana_app \gset
SELECT pg_temp.p313_submit(:'p313_ilgiz', pg_temp.p313_id(708), 'Ильгиз', 'Восьмой', '+996 700 313 113') AS p313_ilgiz_app \gset
SELECT pg_temp.p313_assert((SELECT count(*) FROM platform_private.student_applications a
  WHERE a.id IN (:'p313_ainur_app', :'p313_cora_app', :'p313_dara_app', :'p313_esen_app', :'p313_fatima_app',
    :'p313_gulnara_app', :'p313_hana_app', :'p313_ilgiz_app') AND a.canonical_lead_id IS NULL) = 8,
  'without an intake owner the анкеты must link no lead');

SELECT platform_private.provision_member_authorized_e1(pg_temp.p313_id(1), :'p313_student', 'Студент Порталов',
  'student', 'P313 student without a case', pg_temp.p313_id(721), pg_temp.p313_id(201), :'p313_admin') ->> 'membership_id'
  AS p313_student_member \gset
SELECT platform_private.assign_organization_scope_authorized_e1(pg_temp.p313_id(1), :'p313_student_member',
  'P313 student without a case', pg_temp.p313_id(722), pg_temp.p313_id(201), :'p313_admin') IS NOT NULL AS p313_ok \gset

-- Auth journal entries (a bystander's one stays) and PKCE flows.
INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
VALUES
  (NULL, pg_temp.p313_id(951), json_build_object('action', 'login', 'actor_id', :'p313_ainur'), statement_timestamp(), '10.3.1.1'),
  (NULL, pg_temp.p313_id(952), json_build_object('action', 'login', 'actor_id', :'p313_ainur'), statement_timestamp(), '10.3.1.2'),
  (NULL, pg_temp.p313_id(953), json_build_object('action', 'login', 'actor_id', :'p313_cora'), statement_timestamp(), '10.3.1.3'),
  (NULL, pg_temp.p313_id(954), json_build_object('action', 'login', 'actor_id', :'p313_hana'), statement_timestamp(), '10.3.1.4'),
  (NULL, pg_temp.p313_id(955), json_build_object('action', 'login', 'actor_id', :'p313_gulnara'), statement_timestamp(), '10.3.1.5');
INSERT INTO auth.flow_state (id, user_id, auth_code) VALUES
  (pg_temp.p313_id(961), :'p313_ainur', 'p313-flow-1'), (pg_temp.p313_id(962), :'p313_cora', 'p313-flow-2'),
  (pg_temp.p313_id(963), :'p313_hana', 'p313-flow-3');

-- Requests (each account asks for itself).
SELECT pg_temp.p313_request(:'p313_ainur', pg_temp.p313_id(1001)) AS p313_ainur_req \gset
SELECT pg_temp.p313_request(:'p313_bare', pg_temp.p313_id(1002)) AS p313_bare_req \gset
SELECT pg_temp.p313_request(:'p313_cora', pg_temp.p313_id(1003)) AS p313_cora_req \gset
SELECT pg_temp.p313_request(:'p313_dara', pg_temp.p313_id(1004)) AS p313_dara_req \gset
SELECT pg_temp.p313_request(:'p313_esen', pg_temp.p313_id(1005)) AS p313_esen_req \gset
SELECT pg_temp.p313_request(:'p313_fatima', pg_temp.p313_id(1006)) AS p313_fatima_req \gset
SELECT pg_temp.p313_request(:'p313_gulnara', pg_temp.p313_id(1007)) AS p313_gulnara_req \gset
SELECT pg_temp.p313_request(:'p313_student', pg_temp.p313_id(1008)) AS p313_student_req \gset
SELECT pg_temp.p313_request(:'p313_hana', pg_temp.p313_id(1009)) AS p313_hana_req \gset
SELECT pg_temp.p313_request(:'p313_ilgiz', pg_temp.p313_id(1010)) AS p313_ilgiz_req \gset

-- ---------------------------------------------------------------------------
-- UI-F4: the queue row says whether an applicant submitted an анкета.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin('platform.staff_account_deletion_queue_v1()') -> 'ok' AS p313_queue \gset
SELECT pg_temp.p313_assert(jsonb_typeof(:'p313_queue'::JSONB) = 'array', 'the Admin cannot read the queue: ' || :'p313_queue');
SELECT pg_temp.p313_assert(
  (SELECT z ->> 'kind' = 'applicant' AND (z -> 'applicationSubmitted') = 'true'::JSONB
    FROM jsonb_array_elements(:'p313_queue'::JSONB) z WHERE z ->> 'id' = :'p313_ainur_req'),
  'an applicant with an анкета must read applicationSubmitted = true');
SELECT pg_temp.p313_assert(
  (SELECT z ->> 'kind' = 'applicant' AND (z -> 'applicationSubmitted') = 'false'::JSONB
    FROM jsonb_array_elements(:'p313_queue'::JSONB) z WHERE z ->> 'id' = :'p313_bare_req'),
  'an applicant without an анкета must read applicationSubmitted = false');
SELECT pg_temp.p313_assert(
  (SELECT z ->> 'kind' = 'student' AND (z -> 'applicationSubmitted') = 'null'::JSONB
    FROM jsonb_array_elements(:'p313_queue'::JSONB) z WHERE z ->> 'id' = :'p313_student_req'),
  'a student must read applicationSubmitted = null');

-- ---------------------------------------------------------------------------
-- UI-F6: the open count. Admin only; nothing else; no person data.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin('platform.staff_account_deletion_open_count_v1()') -> 'ok' AS p313_count_1 \gset
SELECT pg_temp.p313_assert((:'p313_count_1'::JSONB) = '{"open": 10, "overdue": 0}'::JSONB,
  'the open count of ten fresh requests: ' || :'p313_count_1');
-- One request is overdue.
UPDATE platform_private.account_deletion_requests SET due_at = statement_timestamp() - INTERVAL '1 day'
WHERE id = :'p313_bare_req';
SELECT pg_temp.p313_admin('platform.staff_account_deletion_open_count_v1()') -> 'ok' AS p313_count_2 \gset
SELECT pg_temp.p313_assert((:'p313_count_2'::JSONB) = '{"open": 10, "overdue": 1}'::JSONB,
  'the overdue request is not counted: ' || :'p313_count_2');
DO $p313_count_gate$
DECLARE who TEXT; r JSONB;
BEGIN
  FOREACH who IN ARRAY ARRAY[pg_temp.p313_id(102)::TEXT, pg_temp.p313_id(103)::TEXT, pg_temp.p313_id(104)::TEXT,
      pg_temp.p313_id(111)::TEXT, 'anon', 'service_role'] LOOP
    r := pg_temp.p313_call(who, 'platform.staff_account_deletion_open_count_v1()');
    PERFORM pg_temp.p313_assert(r ->> 'error' = '42501', who || ' may not read the open count: ' || r::TEXT);
  END LOOP;
  PERFORM pg_temp.p313_assert(has_function_privilege('authenticated', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE'),
    'the grants of the open count');
END
$p313_count_gate$;

-- ---------------------------------------------------------------------------
-- SQL-1. Айнур: the Auth journal is erased and the result is kept.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_ainur_req')) AS p313_ainur_process \gset
SELECT pg_temp.p313_assert((:'p313_ainur_process'::JSONB) #>> '{ok,status}' = 'processing',
  'Айнур: processing failed ' || :'p313_ainur_process');
SELECT pg_temp.p313_assert(
  (SELECT d.summary #>> '{authLog,status}' = 'erased' AND (d.summary #>> '{authLog,entries}')::INT = 2
      AND d.summary ? 'counts'
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_ainur_req')
  AND NOT EXISTS (SELECT 1 FROM auth.audit_log_entries e WHERE e.payload ->> 'actor_id' = :'p313_ainur')
  AND NOT EXISTS (SELECT 1 FROM auth.flow_state f WHERE f.user_id = :'p313_ainur')
  AND (SELECT count(*) FROM auth.audit_log_entries e WHERE e.payload ->> 'actor_id' = :'p313_gulnara') = 1
  AND (SELECT e.after_state ->> 'auth_log' = 'erased' FROM platform.audit_events e
    WHERE e.resource_id = :'p313_ainur_req' AND e.action = 'account.deletion.process'),
  'Айнур: the erased result and its two entries are not recorded in the summary and the journal');
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'authLog' = 'erased' AND r -> 'ok' ->> 'status' = 'processing'
      AND (r -> 'ok' -> 'applicationSubmitted') = 'true'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_ainur_req')) r),
  'Айнур: the Admin''s detail does not show authLog erased (a started request still says it had an анкета)');
-- The Auth server deletes the user; deleteUser writes its own entry; completion erases it too.
DELETE FROM auth.users WHERE id = :'p313_ainur';
INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
VALUES (NULL, pg_temp.p313_id(956), json_build_object('action', 'user_deleted', 'actor_id', :'p313_ainur'),
  statement_timestamp(), '10.3.1.6');
SELECT pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_ainur_req')) AS p313_ainur_complete \gset
SELECT pg_temp.p313_assert((:'p313_ainur_complete'::JSONB) #>> '{ok,status}' = 'completed'
    AND (:'p313_ainur_complete'::JSONB) #>> '{ok,mode}' = 'automatic'
  AND NOT EXISTS (SELECT 1 FROM auth.audit_log_entries e WHERE e.payload ->> 'actor_id' = :'p313_ainur')
  AND (SELECT d.summary #>> '{authLog,status}' = 'erased' AND (d.summary #>> '{authLog,entries}')::INT = 1
      AND d.summary ? 'counts'
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_ainur_req')
  AND (SELECT e.after_state ->> 'auth_log' = 'erased' AND e.after_state ->> 'login' = 'absent'
    FROM platform.audit_events e WHERE e.resource_id = :'p313_ainur_req' AND e.action = 'account.deletion.complete'),
  'Айнур: completion did not erase the entry deleteUser wrote or did not record the result');
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'authLog' = 'erased' AND r -> 'ok' ->> 'status' = 'completed' AND r -> 'ok' ->> 'login' = 'absent'
      AND (r -> 'ok' -> 'applicationSubmitted') = 'true'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_ainur_req')) r),
  'Айнур: a completed request does not show authLog erased and that it had an анкета');

-- ---------------------------------------------------------------------------
-- SQL-1, privilege lost. Кора: the function owner may not DELETE from auth.audit_log_entries:
-- the processing does not fail, the entries stay and the result says «not_erased».
-- ---------------------------------------------------------------------------
REVOKE DELETE ON auth.audit_log_entries FROM postgres;
SELECT pg_temp.p313_assert(NOT has_table_privilege('postgres', 'auth.audit_log_entries', 'DELETE'),
  'the test could not take DELETE away from the function owner');
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_cora_req')) AS p313_cora_process \gset
SELECT pg_temp.p313_assert((:'p313_cora_process'::JSONB) #>> '{ok,status}' = 'processing',
  'Кора: processing must not fail when the Auth journal cannot be erased: ' || :'p313_cora_process');
SELECT pg_temp.p313_assert(
  (SELECT d.summary #>> '{authLog,status}' = 'not_erased' AND (d.summary #>> '{authLog,entries}')::INT = 0
      AND d.status = 'processing'
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_cora_req')
  AND EXISTS (SELECT 1 FROM auth.audit_log_entries e WHERE e.payload ->> 'actor_id' = :'p313_cora')
  AND (SELECT e.after_state ->> 'auth_log' = 'not_erased' FROM platform.audit_events e
    WHERE e.resource_id = :'p313_cora_req' AND e.action = 'account.deletion.process')
  AND (SELECT r -> 'ok' ->> 'authLog' = 'not_erased'
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_cora_req')) r),
  'Кора: the lost privilege is not recorded (summary, journal row, detail)');
-- The records of the account itself are gone all the same: the privilege is only for the Auth journal.
SELECT pg_temp.p313_assert(NOT EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.auth_user_id = :'p313_cora'),
  'Кора: the own rows must be deleted although the Auth journal could not be');
-- The Auth server deletes the user; completion cannot erase the entry either: still not_erased.
DELETE FROM auth.users WHERE id = :'p313_cora';
SELECT pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_cora_req')) AS p313_cora_complete \gset
SELECT pg_temp.p313_assert((:'p313_cora_complete'::JSONB) #>> '{ok,status}' = 'completed'
  AND (SELECT d.summary #>> '{authLog,status}' = 'not_erased' FROM platform_private.account_deletion_requests d
    WHERE d.id = :'p313_cora_req')
  AND (SELECT e.after_state ->> 'auth_log' = 'not_erased' FROM platform.audit_events e
    WHERE e.resource_id = :'p313_cora_req' AND e.action = 'account.deletion.complete')
  AND (SELECT r -> 'ok' ->> 'authLog' = 'not_erased' AND r -> 'ok' ->> 'status' = 'completed'
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_cora_req')) r),
  'Кора: a completed request must still say the Auth journal was not erased');
GRANT DELETE ON auth.audit_log_entries TO postgres;

-- Only the flow table is not deletable (the audit table is): what may be erased is, the rest is
-- named by the status «not_erased».
REVOKE DELETE ON auth.flow_state FROM postgres;
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_hana_req')) AS p313_hana_process \gset
SELECT pg_temp.p313_assert((:'p313_hana_process'::JSONB) #>> '{ok,status}' = 'processing'
  AND (SELECT d.summary #>> '{authLog,status}' = 'not_erased' AND (d.summary #>> '{authLog,entries}')::INT = 1
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_hana_req')
  AND NOT EXISTS (SELECT 1 FROM auth.audit_log_entries e WHERE e.payload ->> 'actor_id' = :'p313_hana')
  AND EXISTS (SELECT 1 FROM auth.flow_state f WHERE f.user_id = :'p313_hana'),
  'Хана: a flow table that cannot be erased must say not_erased while the journal entries are erased');
GRANT DELETE ON auth.flow_state TO postgres;
-- Privilege back: a repeat of the processing erases the rest and the result becomes «erased».
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_hana_req')) AS p313_hana_again \gset
SELECT pg_temp.p313_assert((:'p313_hana_again'::JSONB) #>> '{ok,status}' = 'processing'
  AND (SELECT d.summary #>> '{authLog,status}' = 'erased' AND (d.summary #>> '{authLog,entries}')::INT = 0
      AND d.summary ? 'counts'
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_hana_req')
  AND NOT EXISTS (SELECT 1 FROM auth.flow_state f WHERE f.user_id = :'p313_hana'),
  'Хана: the repeat with the privilege back did not erase the flow and record «erased»');

-- ---------------------------------------------------------------------------
-- SQL-2. Дара: processed, her login only soft-deleted (deleted_at): complete closes the request.
-- Эсен: the login is still active: refused; then the user is gone: closed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_dara_req')) AS p313_dara_process \gset
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_esen_req')) AS p313_esen_process \gset
SELECT pg_temp.p313_assert((:'p313_dara_process'::JSONB) #>> '{ok,status}' = 'processing'
  AND (:'p313_esen_process'::JSONB) #>> '{ok,status}' = 'processing', 'Дара and Эсен: processing failed');
SELECT pg_temp.p313_assert(
  (SELECT r ->> 'message' = 'account_deletion_auth_user_exists'
    FROM pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_dara_req')) r)
  AND (SELECT r ->> 'message' = 'account_deletion_auth_user_exists'
    FROM pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_esen_req')) r),
  'an active login must still refuse the completion');
UPDATE auth.users SET deleted_at = statement_timestamp() WHERE id = :'p313_dara';
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'login' = 'disabled' AND r -> 'ok' ->> 'mode' = 'automatic' AND r -> 'ok' ->> 'status' = 'processing'
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_dara_req')) r),
  'Дара: the detail must say the login is disabled and the request is automatic');
SELECT pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_dara_req')) AS p313_dara_complete \gset
SELECT pg_temp.p313_assert((:'p313_dara_complete'::JSONB) #>> '{ok,status}' = 'completed'
    AND (:'p313_dara_complete'::JSONB) #>> '{ok,mode}' = 'automatic'
  AND (SELECT e.after_state ->> 'login' = 'disabled' AND e.after_state ->> 'auth_log' IS NOT NULL
    FROM platform.audit_events e WHERE e.resource_id = :'p313_dara_req' AND e.action = 'account.deletion.complete')
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = :'p313_dara'),
  'Дара: a soft-deleted login must close the automatic request (and the Auth row stays, as the Auth server left it)');
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'login' = 'disabled' AND r -> 'ok' ->> 'status' = 'completed'
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_dara_req')) r),
  'Дара: a completed request must keep saying the login is only disabled');
DELETE FROM auth.users WHERE id = :'p313_esen';
SELECT pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_esen_req')) AS p313_esen_complete \gset
SELECT pg_temp.p313_assert((:'p313_esen_complete'::JSONB) #>> '{ok,status}' = 'completed'
  AND (SELECT e.after_state ->> 'login' = 'absent' FROM platform.audit_events e
    WHERE e.resource_id = :'p313_esen_req' AND e.action = 'account.deletion.complete'),
  'Эсен: an absent login must still close the request');

-- ---------------------------------------------------------------------------
-- F3. Фатима: processed (simple), then she submits a second анкета under an intake owner
-- (a lead and a client appear): the request is no longer simple.
-- Гульнара: simple, requested, then processed: mark refuses both times, by name.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_assert(
  (SELECT r ->> 'message' = 'account_deletion_automatic_available'
    FROM pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p313_gulnara_req', 'Всё удалено вручную по списку')) r),
  'a simple, unprocessed request was marked done manually');
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_gulnara_req')) AS p313_gulnara_process \gset
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_fatima_req')) AS p313_fatima_process \gset
SELECT pg_temp.p313_assert((:'p313_gulnara_process'::JSONB) #>> '{ok,status}' = 'processing'
  AND (:'p313_fatima_process'::JSONB) #>> '{ok,status}' = 'processing', 'Гульнара and Фатима: processing failed');
SELECT pg_temp.p313_assert(
  (SELECT r ->> 'message' = 'account_deletion_processing'
    FROM pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p313_gulnara_req', 'Всё удалено вручную по списку')) r)
  AND (SELECT r -> 'ok' ->> 'mode' = 'automatic' AND r -> 'ok' -> 'reasons' = '[]'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_gulnara_req')) r),
  'Гульнара: a simple processing request must be refused by mark and stay automatic');
-- Even with a soft-deleted login a simple processing request is closed by complete, not by mark.
UPDATE auth.users SET deleted_at = statement_timestamp() WHERE id = :'p313_gulnara';
SELECT pg_temp.p313_assert(
  (SELECT r ->> 'message' = 'account_deletion_processing'
    FROM pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p313_gulnara_req', 'Всё удалено вручную по списку')) r),
  'Гульнара: mark must refuse a simple processing request whose login is disabled');
UPDATE auth.users SET deleted_at = NULL WHERE id = :'p313_gulnara';

-- Фатима: the account stops being simple.
UPDATE platform_private.student_application_configuration SET intake_owner_membership_id = pg_temp.p313_id(301);
SELECT pg_temp.p313_submit(:'p313_fatima', pg_temp.p313_id(709), 'Фатима', 'Пятая', '+996 700 313 109') AS p313_fatima_app2 \gset
SELECT pg_temp.p313_assert((SELECT a.canonical_lead_id IS NOT NULL FROM platform_private.student_applications a
  WHERE a.id = :'p313_fatima_app2'), 'the second анкета must link a lead under an intake owner');
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'mode' = 'manual' AND r -> 'ok' ->> 'status' = 'processing'
      AND r -> 'ok' -> 'reasons' = '["lead", "client"]'::JSONB AND r -> 'ok' ->> 'login' = 'active'
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_fatima_req')) r)
  AND (SELECT z ->> 'mode' = 'manual' AND z ->> 'status' = 'processing'
    FROM jsonb_array_elements(pg_temp.p313_admin('platform.staff_account_deletion_queue_v1()') -> 'ok') z
    WHERE z ->> 'id' = :'p313_fatima_req'),
  'Фатима: a processing request that is no longer simple must read as manual in the queue and the detail');
SELECT pg_temp.p313_assert(
  (SELECT r ->> 'message' = 'account_deletion_not_simple' AND r ->> 'detail' = 'lead,client'
    FROM pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_fatima_req')) r)
  AND (SELECT r ->> 'message' = 'account_deletion_auth_user_exists'
    FROM pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_fatima_req')) r)
  AND (SELECT r ->> 'message' = 'account_deletion_login_active'
    FROM pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p313_fatima_req', 'Лид, клиент, файлы и чат удалены; вход отключён')) r),
  'Фатима: process refuses (not simple), complete waits for the login, mark waits for the login');
-- The form constraint still demands a note for a manual completion.
SELECT set_config('p313.fatima_req', :'p313_fatima_req', FALSE) IS NOT NULL AS p313_ok \gset
DO $p313_shape$
BEGIN
  BEGIN
    UPDATE platform_private.account_deletion_requests SET status = 'completed', completion_mode = 'manual',
      completed_at = statement_timestamp(), completed_by_membership_id = pg_temp.p313_id(301)
    WHERE id = current_setting('p313.fatima_req', FALSE)::UUID;
    RAISE EXCEPTION 'p313 the shape check accepted a manual completion without a note';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$p313_shape$;
-- The technical administrator soft-deletes the login; now the Admin may mark it done.
UPDATE auth.users SET deleted_at = statement_timestamp() WHERE id = :'p313_fatima';
SELECT pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
  :'p313_fatima_req', '  Лид, клиент, файлы и чат удалены; вход отключён  ')) AS p313_fatima_manual \gset
SELECT pg_temp.p313_assert((:'p313_fatima_manual'::JSONB) #>> '{ok,status}' = 'completed'
    AND (:'p313_fatima_manual'::JSONB) #>> '{ok,mode}' = 'manual'
  AND (SELECT d.status = 'completed' AND d.completion_mode = 'manual' AND d.processing_started_at IS NOT NULL
      AND d.manual_note = 'Лид, клиент, файлы и чат удалены; вход отключён'
      AND d.completed_by_membership_id = pg_temp.p313_id(301)
    FROM platform_private.account_deletion_requests d WHERE d.id = :'p313_fatima_req')
  AND (SELECT e.after_state ->> 'started_automatic' = 'true' AND e.after_state -> 'reasons' = '["lead", "client"]'::JSONB
      AND e.after_state ->> 'login' = 'disabled'
    FROM platform.audit_events e WHERE e.resource_id = :'p313_fatima_req' AND e.action = 'account.deletion.manual.complete')
  AND (SELECT r -> 'ok' ->> 'mode' = 'manual' AND r -> 'ok' ->> 'status' = 'completed'
      AND r -> 'ok' ->> 'manualNote' IS NOT NULL AND (r -> 'ok' -> 'applicationSubmitted') = 'true'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_fatima_req')) r),
  'Фатима: the started request that stopped being simple was not closed manually with its evidence');
-- Idempotent.
SELECT pg_temp.p313_assert((SELECT r -> 'ok' ->> 'status' = 'completed'
  FROM pg_temp.p313_admin(format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
    :'p313_fatima_req', 'Другая заметка при повторе')) r), 'a repeated manual completion failed');
-- The processed-and-simple account is still closed the automatic way (Гульнара).
DELETE FROM auth.users WHERE id = :'p313_gulnara';
SELECT pg_temp.p313_assert((SELECT r -> 'ok' ->> 'status' = 'completed' AND r -> 'ok' ->> 'mode' = 'automatic'
  FROM pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_gulnara_req')) r),
  'Гульнара: the automatic path must still close a simple processed request');

-- ---------------------------------------------------------------------------
-- UI-F4 after processing: a completed bare account says «no анкета», a completed one with an
-- анкета says «had one»; a started request keeps it from the counts (the rows are gone).
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin(format('platform.process_account_deletion_v1(%L::UUID)', :'p313_bare_req')) AS p313_bare_process \gset
DELETE FROM auth.users WHERE id = :'p313_bare';
SELECT pg_temp.p313_assert(
  (SELECT r -> 'ok' ->> 'status' = 'processing' AND (r -> 'ok' -> 'applicationSubmitted') = 'false'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_bare_req')) r),
  'Bare: a started request without an анкета must keep saying so');
SELECT pg_temp.p313_admin(format('platform.complete_account_deletion_v1(%L::UUID)', :'p313_bare_req')) AS p313_bare_complete \gset
SELECT pg_temp.p313_assert((:'p313_bare_complete'::JSONB) #>> '{ok,status}' = 'completed'
  AND (SELECT r -> 'ok' ->> 'status' = 'completed' AND (r -> 'ok' -> 'applicationSubmitted') = 'false'::JSONB
    FROM pg_temp.p313_admin(format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p313_bare_req')) r),
  'Bare: a completed request without an анкета must keep saying so');

-- ---------------------------------------------------------------------------
-- UI-F6, after the work: completed requests are not counted. Open: the student and Ильгиз
-- (never processed), Хана (processing). Фатима, Гульнара, Дара, Эсен, Айнур, Кора, Bare: completed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_admin('platform.staff_account_deletion_open_count_v1()') -> 'ok' AS p313_count_3 \gset
SELECT pg_temp.p313_assert((:'p313_count_3'::JSONB) = '{"open": 3, "overdue": 0}'::JSONB,
  'completed requests must not be counted: ' || :'p313_count_3');
SELECT pg_temp.p313_assert((SELECT count(*) FROM platform_private.account_deletion_requests d
  WHERE d.status <> 'completed') = 3, 'the open requests the count is checked against');

-- ---------------------------------------------------------------------------
-- SQL-3. The five actions and the object type are in the journal allowlist; the older ones stay.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_assert(
  ARRAY['account.deletion.complete', 'account.deletion.email', 'account.deletion.manual.complete',
    'account.deletion.process', 'account.deletion.request']::TEXT[]
    <@ platform_private.p7a_safe_audit_actions()
  AND NOT (ARRAY['account.deletion.complete', 'account.deletion.email', 'account.deletion.manual.complete',
    'account.deletion.process', 'account.deletion.request']::TEXT[]
    && platform_private.p7a_safe_audit_actions_pre_account_deletion_journal())
  AND cardinality(platform_private.p7a_safe_audit_actions())
    = cardinality(platform_private.p7a_safe_audit_actions_pre_account_deletion_journal()) + 5
  AND 'case.direction.set' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'account_deletion_request' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND NOT ('account_deletion_request' = ANY (platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal()))
  AND cardinality(platform_private.p7a_safe_audit_resource_types())
    = cardinality(platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal()) + 1
  AND NOT has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform_private.p7a_safe_audit_resource_types()', 'EXECUTE'),
  'the journal allowlist: five actions, one object type, older entries intact, helpers closed');
-- The safe row of a real deletion event carries no personal value.
SELECT pg_temp.p313_assert(
  (SELECT bool_and(platform_private.p7a_safe_audit_row(e)::TEXT !~* 'p313-|Айнур|Кора|Фатима|auth:')
      AND count(*) >= 20
    FROM platform.audit_events e
    WHERE e.organization_id = pg_temp.p313_id(1) AND e.action LIKE 'account.deletion.%'
      AND e.resource_type = 'account_deletion_request'),
  'a safe journal row of a deletion event names a person or an Auth id');

SELECT 'P313_ACCOUNT_DELETION_P3_SUITE_PASSED' AS result;
ROLLBACK;
