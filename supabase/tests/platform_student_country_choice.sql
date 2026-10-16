\set ON_ERROR_STOP on
-- Boundary suite for migration 284 «Выбор страны студента» («Путь
-- поступления» на «Главной», S4; docs/PLAN_CHANGES.md 2026-10-16). The runner
-- invokes it right after 284, matched by name so a renumbering keeps the hook.
-- Accounts come through the real анкета path (submit and decide
-- student_application_v1) and the real member provisioning; a case country is
-- set directly (fixture only, replica mode). Proven here:
--   (a) study_country_from_text recognises the six countries by code and by
--       EN, RU, KY name in any case, and nothing else;
--   (b) the default choice: exactly one of the six in the анкета (CN; PL+IT
--       gives IT), else the case target_country (CN+MY анкета, case
--       «Малайзия»; «undecided» анкета, case «Czech Republic»), else none;
--   (c) the signed-in Student writes only its own choice: six codes or
--       UNDECIDED, a replay of a request_id returns the original receipt, a
--       reused request_id with another country, an unknown code, lowercase
--       «undecided» and NULLs are 22023 and write nothing; another Student's
--       choice is untouched;
--   (d) the Admin, Sales, a Curator, an applicant without a membership,
--       service_role and anon are refused (42501) and write nothing; the
--       tables have no client grants; nothing reaches audit_events;
--   (e) account deletion (280) treats the choice and its receipts as own rows:
--       a simple Student with a saved choice stays simple;
--   (f) the posture of the new functions.
-- Isolated synthetic fixtures only, rolled back.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- Lightweight Auth bootstrap (126/185/193/280 convention), transaction-local.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $p284_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p284_auth_role$;

CREATE FUNCTION pg_temp.p284_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p284_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P284: %', message; END IF;
END
$$;
-- One RPC expression as somebody: a user id (its real hook claims, role
-- authenticated), 'anon' or 'service_role'. {"ok": result} or {"error": sqlstate, "message": ...}.
CREATE FUNCTION pg_temp.p284_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    IF p_who IN ('anon', 'service_role') THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_who)::TEXT, TRUE);
      EXECUTE format('SET LOCAL ROLE %I', p_who);
    ELSE
      PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
        'user_id', p_who::UUID, 'claims', jsonb_build_object('sub', p_who::UUID, 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
CREATE FUNCTION pg_temp.p284_get(p_user INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p284_call(pg_temp.p284_id(p_user)::TEXT, 'platform.student_country_choice_v1()')
$$;
CREATE FUNCTION pg_temp.p284_set(p_user INTEGER, p_country TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p284_call(pg_temp.p284_id(p_user)::TEXT, format('platform.set_student_country_choice_v1(%L, %L::UUID)',
    p_country, CASE WHEN p_request IS NULL THEN NULL ELSE pg_temp.p284_id(p_request) END))
$$;
CREATE FUNCTION pg_temp.p284_questionnaire(p_request UUID, p_countries JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT,
    'firstName', 'P284', 'lastName', 'Applicant', 'phone', '+996555284000',
    'destinationCountries', p_countries, 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18')
$$;
-- A real анкета submission by the account itself; returns the анкета id.
CREATE FUNCTION pg_temp.p284_submit(p_user INTEGER, p_request INTEGER, p_countries JSONB) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.p284_call(pg_temp.p284_id(p_user)::TEXT, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    pg_temp.p284_id(p_request), pg_temp.p284_questionnaire(pg_temp.p284_id(p_request), p_countries)));
  PERFORM pg_temp.p284_assert(r ? 'ok', 'анкета submit failed: ' || r::TEXT);
  RETURN (r #>> '{ok,id}')::UUID;
END
$$;
-- The Admin approves an анкета; returns the new case id.
CREATE FUNCTION pg_temp.p284_approve(p_application UUID, p_request INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.p284_call(pg_temp.p284_id(101)::TEXT, format(
    'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''P284 synthetic decision'', %L::UUID)',
    p_application, pg_temp.p284_id(p_request)));
  PERFORM pg_temp.p284_assert(r #>> '{ok,status}' = 'approved', 'approval failed: ' || r::TEXT);
  RETURN (r #>> '{ok,student_case_id}')::UUID;
END
$$;

SELECT 'P284_STUDENT_COUNTRY_CHOICE_SUITE_START' AS p284_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization; staff 101 system Admin, 102 Sales, 103 Curator;
-- applicants 111..115 with confirmed email; 116 a Student membership without
-- a case or an анкета (real provisioning).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p284_id(1), 'P284 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p284_id(2), pg_temp.p284_id(1), 'organization', pg_temp.p284_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.p284_id(100 + n), 'p284-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 2, 3, 11, 12, 13, 14, 15, 16]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.p284_id(201), pg_temp.p284_id(101), 'P284 Admin', 'active', 1),
  (pg_temp.p284_id(202), pg_temp.p284_id(102), 'P284 Sales', 'active', 1),
  (pg_temp.p284_id(203), pg_temp.p284_id(103), 'P284 Curator', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.p284_id(300 + a.n), pg_temp.p284_id(1), pg_temp.p284_id(200 + a.n), 'active', a.role::platform.business_role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
       AND status = 'published' ORDER BY version DESC LIMIT 1),
    a.role = 'admin'
  FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p284_id(1), pg_temp.p284_id(300 + n), pg_temp.p284_id(2), 1, 1, TRUE, 'system',
    'P284 synthetic organization scope', pg_temp.p284_id(600 + n)
  FROM generate_series(1, 3) AS n;
INSERT INTO platform.staff_departments(id, organization_id, name)
  VALUES (pg_temp.p284_id(930), pg_temp.p284_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
  VALUES (TRUE, pg_temp.p284_id(1), pg_temp.p284_id(930), TRUE, NULL);

-- Анкеты: 111 CN; 112 CN+MY; 113 «undecided»; 114 PL+IT; 115 CN, pending.
SELECT pg_temp.p284_approve(pg_temp.p284_submit(111, 711, '["CN"]'::JSONB), 721) AS p284_case_111,
  pg_temp.p284_approve(pg_temp.p284_submit(112, 712, '["CN", "MY"]'::JSONB), 722) AS p284_case_112,
  pg_temp.p284_approve(pg_temp.p284_submit(113, 713, '["undecided"]'::JSONB), 723) AS p284_case_113,
  pg_temp.p284_approve(pg_temp.p284_submit(114, 714, '["PL", "IT"]'::JSONB), 724) AS p284_case_114,
  pg_temp.p284_submit(115, 715, '["CN"]'::JSONB) AS p284_app_115 \gset
SELECT platform_private.provision_member_authorized_e1(pg_temp.p284_id(1), pg_temp.p284_id(116), 'P284 Student without a case',
  'student', 'P284 student without a case', pg_temp.p284_id(731), pg_temp.p284_id(201), pg_temp.p284_id(101)) ->> 'membership_id'
  AS p284_member_116 \gset
SELECT platform_private.assign_organization_scope_authorized_e1(pg_temp.p284_id(1), :'p284_member_116',
  'P284 student without a case', pg_temp.p284_id(732), pg_temp.p284_id(201), pg_temp.p284_id(101)) IS NOT NULL AS p284_ok \gset
SELECT pg_temp.p284_assert(
  (SELECT count(*) FROM platform.student_cases c WHERE c.id IN (:'p284_case_111', :'p284_case_112', :'p284_case_113', :'p284_case_114')
     AND c.portal_activated_at IS NOT NULL AND c.target_country IS NULL) = 4
  AND NOT EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.student_membership_id = :'p284_member_116'),
  'the анкета path did not create four activated cases without a country, or 116 has a case');

-- The case of 112 names «Малайзия» (free text, as staff type it).
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET target_country = 'Малайзия' WHERE id = :'p284_case_112';
SET LOCAL session_replication_role = origin;

SELECT (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.p284_id(1)) AS p284_audit_before \gset

-- ---------------------------------------------------------------------------
-- (a) Recognition of a country in free text.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(bool_and(platform_private.study_country_from_text(x.input) IS NOT DISTINCT FROM x.expected),
  'study_country_from_text: ' || string_agg(x.input || '=' || COALESCE(platform_private.study_country_from_text(x.input), 'NULL'), ', ')
    FILTER (WHERE platform_private.study_country_from_text(x.input) IS DISTINCT FROM x.expected))
FROM (VALUES
  ('CN', 'CN'), ('cn', 'CN'), (' China ', 'CN'), ('Китай', 'CN'), ('КИТАЙ', 'CN'), ('Кытай', 'CN'),
  ('Malaysia', 'MY'), ('малайзия', 'MY'),
  ('United Arab Emirates', 'AE'), ('UAE', 'AE'), ('ОАЭ', 'AE'), ('БАЭ', 'AE'), ('Объединённые Арабские Эмираты', 'AE'),
  ('Turkey', 'TR'), ('Türkiye', 'TR'), ('Турция', 'TR'), ('Түркия', 'TR'),
  ('Italy', 'IT'), ('Италия', 'IT'),
  ('Czechia', 'CZ'), ('Czech Republic', 'CZ'), ('Чехия', 'CZ'),
  ('Poland', NULL), ('PL', NULL), ('Europe', NULL), ('UNDECIDED', NULL), ('undecided', NULL), ('', NULL), (NULL, NULL)
) AS x(input, expected);

-- ---------------------------------------------------------------------------
-- (b) Default choice and its source.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(pg_temp.p284_get(111) = '{"ok": {"country": "CN", "source": "application", "savedAt": null}}'::JSONB,
  'CN анкета: ' || pg_temp.p284_get(111)::TEXT);
SELECT pg_temp.p284_assert(pg_temp.p284_get(112) = '{"ok": {"country": "MY", "source": "case", "savedAt": null}}'::JSONB,
  'CN+MY анкета, case Малайзия: ' || pg_temp.p284_get(112)::TEXT);
SELECT pg_temp.p284_assert(pg_temp.p284_get(113) = '{"ok": {"country": null, "source": "none", "savedAt": null}}'::JSONB,
  'undecided анкета, case without a country: ' || pg_temp.p284_get(113)::TEXT);
SELECT pg_temp.p284_assert(pg_temp.p284_get(114) = '{"ok": {"country": "IT", "source": "application", "savedAt": null}}'::JSONB,
  'PL+IT анкета: ' || pg_temp.p284_get(114)::TEXT);
SELECT pg_temp.p284_assert(pg_temp.p284_get(116) = '{"ok": {"country": null, "source": "none", "savedAt": null}}'::JSONB,
  'Student without a case or анкета: ' || pg_temp.p284_get(116)::TEXT);
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET target_country = 'Czech Republic' WHERE id = :'p284_case_113';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p284_assert(pg_temp.p284_get(113) = '{"ok": {"country": "CZ", "source": "case", "savedAt": null}}'::JSONB,
  'undecided анкета, case Czech Republic: ' || pg_temp.p284_get(113)::TEXT);

-- ---------------------------------------------------------------------------
-- (d) Refusals before any write: staff, an applicant without a membership,
-- service_role, anon. Nothing is written.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(bool_and(r.result ->> 'error' = '42501'),
  'a non-Student reached the country choice: ' || string_agg(r.who || ' ' || r.rpc || ' ' || r.result::TEXT, '; ')
    FILTER (WHERE r.result ->> 'error' IS DISTINCT FROM '42501'))
FROM (
  SELECT w.who, x.rpc, pg_temp.p284_call(w.who, x.rpc) AS result
  FROM (VALUES (pg_temp.p284_id(101)::TEXT), (pg_temp.p284_id(102)::TEXT), (pg_temp.p284_id(103)::TEXT),
      (pg_temp.p284_id(115)::TEXT), ('service_role'), ('anon')) AS w(who)
  CROSS JOIN (VALUES ('platform.student_country_choice_v1()'),
      (format('platform.set_student_country_choice_v1(%L, %L::UUID)', 'CN', pg_temp.p284_id(801)))) AS x(rpc)
) r;
SELECT pg_temp.p284_assert(
  (SELECT count(*) FROM platform_private.student_country_choices WHERE organization_id = pg_temp.p284_id(1)) = 0
  AND (SELECT count(*) FROM platform_private.student_country_choice_requests WHERE organization_id = pg_temp.p284_id(1)) = 0,
  'a refused call wrote a choice or a receipt');

-- ---------------------------------------------------------------------------
-- (c) The Student writes its own choice.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_set(111, 'IT', 811) AS p284_saved_it \gset
SELECT pg_temp.p284_assert(:'p284_saved_it'::JSONB #>> '{ok,country}' = 'IT'
    AND :'p284_saved_it'::JSONB #>> '{ok,source}' = 'saved'
    AND (:'p284_saved_it'::JSONB #>> '{ok,savedAt}')::TIMESTAMPTZ IS NOT NULL
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'p284_saved_it'::JSONB -> 'ok') k) = ARRAY['country', 'savedAt', 'source'],
  'saving IT did not answer {country: IT, source: saved, savedAt}: ' || :'p284_saved_it');
SELECT pg_temp.p284_assert(pg_temp.p284_get(111) = :'p284_saved_it'::JSONB,
  'the read does not return the saved choice: ' || pg_temp.p284_get(111)::TEXT);
-- A replay of the same request returns the original receipt and writes nothing.
SELECT pg_temp.p284_assert(pg_temp.p284_set(111, 'IT', 811) = :'p284_saved_it'::JSONB
    AND (SELECT count(*) FROM platform_private.student_country_choice_requests WHERE organization_id = pg_temp.p284_id(1)) = 1,
  'a replay of the same request_id is not idempotent');
-- Invalid input: 22023 and nothing changes.
SELECT pg_temp.p284_assert(bool_and(r.result ->> 'error' = '22023'),
  'invalid input was not refused with 22023: ' || string_agg(r.label || ' ' || r.result::TEXT, '; ')
    FILTER (WHERE r.result ->> 'error' IS DISTINCT FROM '22023'))
FROM (VALUES
  ('reused request with another country', pg_temp.p284_set(111, 'MY', 811)),
  ('PL', pg_temp.p284_set(111, 'PL', 812)),
  ('lowercase undecided', pg_temp.p284_set(111, 'undecided', 813)),
  ('lowercase code', pg_temp.p284_set(111, 'cn', 814)),
  ('NULL country', pg_temp.p284_set(111, NULL, 815)),
  ('NULL request', pg_temp.p284_set(111, 'CN', NULL))
) AS r(label, result);
SELECT pg_temp.p284_assert(pg_temp.p284_get(111) = :'p284_saved_it'::JSONB
    AND (SELECT count(*) FROM platform_private.student_country_choice_requests WHERE organization_id = pg_temp.p284_id(1)) = 1,
  'a refused write changed the choice or added a receipt');
-- «Пока не решил» with a new request; the old request still replays its own receipt.
SELECT pg_temp.p284_set(111, 'UNDECIDED', 816) AS p284_saved_undecided \gset
SELECT pg_temp.p284_assert(:'p284_saved_undecided'::JSONB #>> '{ok,country}' = 'UNDECIDED'
    AND :'p284_saved_undecided'::JSONB #>> '{ok,source}' = 'saved'
    AND pg_temp.p284_get(111) = :'p284_saved_undecided'::JSONB
    AND pg_temp.p284_set(111, 'IT', 811) = :'p284_saved_it'::JSONB
    AND pg_temp.p284_get(111) = :'p284_saved_undecided'::JSONB,
  'UNDECIDED was not saved, or a replay of the earlier request changed the current choice');
-- Every product code is accepted (114 cycles through them).
SELECT pg_temp.p284_assert(bool_and(pg_temp.p284_set(114, c.code, (820 + c.n)::INTEGER) #>> '{ok,country}' = c.code),
  'a product country code was refused')
FROM unnest(ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']) WITH ORDINALITY AS c(code, n);
SELECT pg_temp.p284_assert(pg_temp.p284_get(114) #>> '{ok,country}' = 'CZ', 'the last saved code is not the current choice');
-- Another Student is untouched; the same request_id belongs to each Student separately.
SELECT pg_temp.p284_assert(pg_temp.p284_get(112) = '{"ok": {"country": "MY", "source": "case", "savedAt": null}}'::JSONB
    AND pg_temp.p284_set(112, 'TR', 811) #>> '{ok,country}' = 'TR'
    AND pg_temp.p284_get(111) = :'p284_saved_undecided'::JSONB,
  'one Student''s choice or request_id leaked into another''s');

-- ---------------------------------------------------------------------------
-- (d) Privacy: no client grants on the tables, a direct read is refused,
-- staff see nothing, nothing in audit_events.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(bool_and(NOT has_table_privilege(r.role, t.tbl, p.priv)),
  'a client role holds a table privilege on the country choice tables')
FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
CROSS JOIN unnest(ARRAY['platform_private.student_country_choices', 'platform_private.student_country_choice_requests']) AS t(tbl)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv);
SELECT pg_temp.p284_assert(c.relrowsecurity AND c.relforcerowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = c.relname),
  c.relname || ' lost forced RLS or gained a policy')
FROM pg_class c
WHERE c.oid IN ('platform_private.student_country_choices'::REGCLASS, 'platform_private.student_country_choice_requests'::REGCLASS);
SELECT pg_temp.p284_assert(
  pg_temp.p284_call(pg_temp.p284_id(111)::TEXT, '(SELECT count(*) FROM platform_private.student_country_choices)') ->> 'error' = '42501'
  AND pg_temp.p284_call(pg_temp.p284_id(101)::TEXT, '(SELECT count(*) FROM platform_private.student_country_choice_requests)') ->> 'error' = '42501',
  'a direct table read was not refused');
SELECT pg_temp.p284_assert(
  (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.p284_id(1)) = :p284_audit_before,
  'a country choice call wrote audit_events');

-- ---------------------------------------------------------------------------
-- (e) Account deletion: the choice and its receipt are own rows of a simple
-- Student (no case), so the account stays simple and nothing is «other».
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(pg_temp.p284_set(116, 'CN', 841) #>> '{ok,country}' = 'CN', 'the Student without a case could not save');
SELECT platform_private.account_deletion_closure(pg_temp.p284_id(1), pg_temp.p284_id(116))::TEXT AS p284_closure \gset
SELECT pg_temp.p284_assert(
  jsonb_array_length(:'p284_closure'::JSONB #> '{rows,platform_private.student_country_choices}') = 1
  AND jsonb_array_length(:'p284_closure'::JSONB #> '{rows,platform_private.student_country_choice_requests}') = 1
  AND :'p284_closure'::JSONB -> 'other' = '[]'::JSONB
  AND cardinality(platform_private.account_deletion_blockers(pg_temp.p284_id(1), pg_temp.p284_id(116), :'p284_closure'::JSONB)) = 0,
  'the saved choice made the simple Student manual or was not part of its own rows: ' || :'p284_closure');

-- ---------------------------------------------------------------------------
-- (f) Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p284_assert(bool_and(p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.pronamespace = 'platform'::REGNAMESPACE)
    AND (p.pronamespace <> 'platform'::REGNAMESPACE OR (p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'))) AND count(*) = 4,
  'a 284 function lost its search_path, definer or grants')
FROM pg_proc p
WHERE p.oid IN ('platform_private.study_country_from_text(text)'::regprocedure,
  'platform_private.student_country_choice_payload(uuid,uuid,uuid)'::regprocedure,
  'platform.student_country_choice_v1()'::regprocedure,
  'platform.set_student_country_choice_v1(text,uuid)'::regprocedure);

SELECT 'P284_STUDENT_COUNTRY_CHOICE_SUITE_END' AS p284_suite_marker;

ROLLBACK;
