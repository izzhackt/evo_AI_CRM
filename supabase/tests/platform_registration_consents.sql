\set ON_ERROR_STOP on
-- Boundary suite for migration 345 «Согласия при регистрации». Runs on the real chain right after 345 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves (real submit by the account, real approval by the system Admin):
--  1. the анкета accepts the new consent version 2026-11-07 (consent plus the Privacy Policy) and still the old 2026-09-18
--     (stored анкеты, a tab opened before the release, iPhone builds); any other version is refused and nothing is written;
--  2. the approval writes the consent evidence with the анкета's own version, for both versions;
--  3. catalog: both functions keep SECURITY DEFINER and an empty search_path; the evidence no longer pins 2026-09-18.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $a345_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a345_auth_role$;

\echo A345_REGISTRATION_CONSENTS_SUITE_START

CREATE FUNCTION pg_temp.a345_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a345_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A345: %', message; END IF;
END
$$;
-- The command as that account: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a345_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a345_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a345_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
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
CREATE FUNCTION pg_temp.a345_submit(p_user INTEGER, p_request INTEGER, p_version TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a345_call(p_user, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    pg_temp.a345_id(p_request), jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a345_id(p_request)::TEXT,
      'firstName', 'A345', 'lastName', 'Applicant ' || p_user, 'phone', '+99655534500' || (p_user - 110)::TEXT,
      'destinationCountries', '["CN"]'::JSONB, 'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school',
      'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', '["Инженерия"]'::JSONB, 'studyLevels', '["bachelor"]'::JSONB,
      'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
      'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', p_version)))
$$;
CREATE FUNCTION pg_temp.a345_approve(p_application UUID, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a345_call(101, format(
    'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''A345 synthetic decision'', %L::UUID)',
    p_application, pg_temp.a345_id(p_request)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a345_id(INTEGER) TO authenticated;

-- Fixture: one organization; 101 the system Admin (reviews анкеты); the review department and the анкета configuration;
-- applicants 111, 112, 113 with confirmed e-mail and no membership.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a345_id(1), 'A345 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a345_id(2), pg_temp.a345_id(1), 'organization', pg_temp.a345_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.a345_id(100 + n), 'a345-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 11, 12, 13]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a345_id(201), pg_temp.a345_id(101), 'A345 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  VALUES (pg_temp.a345_id(301), pg_temp.a345_id(1), pg_temp.a345_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a345_id(1), pg_temp.a345_id(301), pg_temp.a345_id(2), 1, 1, TRUE, 'system', 'A345 synthetic organization scope',
    pg_temp.a345_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name)
  VALUES (pg_temp.a345_id(930), pg_temp.a345_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
  VALUES (TRUE, pg_temp.a345_id(1), pg_temp.a345_id(930), TRUE, NULL);

-- ---------------------------------------------------------------------------
-- 1. Consent versions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a345_submit(111, 711, '2026-11-07') AS a345_new \gset
SELECT pg_temp.a345_submit(112, 712, '2026-09-18') AS a345_old \gset
SELECT pg_temp.a345_submit(113, 713, '2026-01-01') AS a345_unknown \gset
SELECT pg_temp.a345_assert(:'a345_new'::JSONB ? 'ok' AND :'a345_old'::JSONB ? 'ok'
    AND :'a345_unknown'::JSONB ->> 'error' = '22023'
    AND NOT EXISTS (SELECT 1 FROM platform_private.student_applications WHERE auth_user_id = pg_temp.a345_id(113)),
  'the new and the old consent version are accepted, any other is refused and nothing is written: '
    || :'a345_new' || ' / ' || :'a345_old' || ' / ' || :'a345_unknown');

-- ---------------------------------------------------------------------------
-- 2. The consent evidence carries the анкета's own version.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a345_approve((:'a345_new'::JSONB #>> '{ok,id}')::UUID, 721) AS a345_new_decision \gset
SELECT pg_temp.a345_approve((:'a345_old'::JSONB #>> '{ok,id}')::UUID, 722) AS a345_old_decision \gset
SELECT pg_temp.a345_assert(:'a345_new_decision'::JSONB #>> '{ok,status}' = 'approved'
    AND :'a345_old_decision'::JSONB #>> '{ok,status}' = 'approved',
  'both анкеты are approved: ' || :'a345_new_decision' || ' / ' || :'a345_old_decision');
SELECT pg_temp.a345_assert(
    (SELECT consent_status::TEXT = 'granted' AND consent_evidence_ref = 'student_application:'
        || (:'a345_new'::JSONB #>> '{ok,id}') || ':consent:2026-11-07'
      FROM platform.student_profiles
      WHERE student_case_id = (:'a345_new_decision'::JSONB #>> '{ok,student_case_id}')::UUID)
    AND (SELECT consent_evidence_ref = 'student_application:' || (:'a345_old'::JSONB #>> '{ok,id}') || ':consent:2026-09-18'
      FROM platform.student_profiles
      WHERE student_case_id = (:'a345_old_decision'::JSONB #>> '{ok,student_case_id}')::UUID),
  'the approval records the consent version the student actually accepted');

-- ---------------------------------------------------------------------------
-- 3. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a345_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p WHERE p.oid IN ('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)'::regprocedure,
      'platform.submit_student_application_v1(uuid,jsonb,bigint)'::regprocedure))
    AND strpos(pg_get_functiondef('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)'::regprocedure),
      ':consent:2026-09-18') = 0
    AND strpos(pg_get_functiondef('platform_private.student_application_questionnaire_valid(jsonb)'::regprocedure),
      '''2026-09-18'', ''2026-11-07''') > 0,
  'the functions keep their security settings; the evidence follows the анкета, the CHECK knows both versions');
-- Review 07.11: the patched CHECK helper itself keeps IMMUTABLE, the empty search_path and stays closed to API roles.
SELECT pg_temp.a345_assert((SELECT p.provolatile = 'i' AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'platform_private.student_application_questionnaire_valid(jsonb)'::regprocedure),
  'the CHECK helper stays IMMUTABLE with an empty search_path and closed to API roles');

\echo A345_REGISTRATION_CONSENTS_SUITE_PASSED

ROLLBACK;
