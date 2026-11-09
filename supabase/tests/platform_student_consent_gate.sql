\set ON_ERROR_STOP on
-- Boundary suite for migration 356 «экран согласий при первом входе». Runs on the real chain right after 356 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves: the status RPC says needsDecision for a student with nothing, for old versions and for an undecided AI choice,
-- and not after a decision (including a later revoke); the accept RPC records the policy AND the AI grant in one
-- transaction with one journal event each, is idempotent by request id and conflicts on a changed reuse; versions, source
-- and request id are validated and nothing is written on a refusal; a failure of the AI part rolls the policy back; the
-- policy counts as accepted through a current-version анкета; staff, anon, service_role and no claims are refused; the
-- table is closed to API roles; the journal allowlist and the deletion closure know the new objects.
BEGIN;

\echo A356_STUDENT_CONSENT_GATE_SUITE_START

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $a356_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$a356_auth_role$;

CREATE FUNCTION pg_temp.a356_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a356_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A356: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a356_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a356_claims(student INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a356_claims TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.a356_id(INTEGER) TO authenticated;
CREATE FUNCTION pg_temp.a356_as(p_student INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a356_call('authenticated', (SELECT claims FROM a356_claims WHERE student = p_student), p_sql)
$$;
CREATE FUNCTION pg_temp.a356_status(p_student INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a356_as(p_student, 'SELECT platform.portal_consent_status_v1()')
$$;
CREATE FUNCTION pg_temp.a356_accept(p_student INTEGER, p_policy TEXT, p_ai TEXT, p_source TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a356_as(p_student, format('SELECT platform.portal_consents_accept_v1(%L, %L, %L, %L)', p_policy, p_ai, p_source,
    CASE WHEN p_request IS NULL THEN NULL ELSE pg_temp.a356_id(p_request)::TEXT END))
$$;
CREATE FUNCTION pg_temp.a356_events(p_student INTEGER, p_like TEXT) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.action LIKE p_like AND e.actor_principal = 'auth:' || pg_temp.a356_id(100 + p_student)::TEXT
$$;

-- Fixture: one organization; students 1..4 with an active student membership; 5 a system admin (staff).
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a356_id(1), 'A356 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a356_id(100 + n), 'a356-' || n || '@example.invalid', '{}'::JSONB FROM generate_series(1, 5) n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a356_id(200 + n), pg_temp.a356_id(100 + n), 'A356 Person ' || n, 'active', 1 FROM generate_series(1, 5) n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a356_id(300 + n), pg_temp.a356_id(1), pg_temp.a356_id(200 + n), 'active', 'student',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'student' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 day'
  FROM generate_series(1, 4) n;
-- 5 is staff: a system Admin (a student membership cannot be a system admin).
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  VALUES (pg_temp.a356_id(305), pg_temp.a356_id(1), pg_temp.a356_id(205), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TRUE, TIMESTAMPTZ '2026-01-01 00:00:00+00' + INTERVAL '5 days');
INSERT INTO a356_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a356_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.a356_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 5) n;
SELECT pg_temp.a356_assert((SELECT count(*) = 5 AND bool_and(claims IS NOT NULL) FROM a356_claims), 'every actor got claims from the real hook');

-- 1. posture.
SELECT pg_temp.a356_assert(platform_private.student_privacy_policy_version() = '2026-11-07'
  AND platform_private.student_ai_consent_policy_version() = '2026-10-25', 'current versions');
SELECT pg_temp.a356_assert(
  (SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
   FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname IN ('portal_consent_status_v1', 'portal_consents_accept_v1')),
  'both RPCs are definer, empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.a356_assert(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform_private.student_privacy_consents'::REGCLASS)
  AND NOT has_table_privilege('authenticated', 'platform_private.student_privacy_consents', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.student_privacy_consents', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform_private.student_privacy_consents', 'SELECT'), 'the table is closed with FORCE RLS');
SELECT pg_temp.a356_assert(pg_temp.a356_call('authenticated', (SELECT claims FROM a356_claims WHERE student = 1),
  'SELECT count(*)::INTEGER::TEXT::JSONB FROM platform_private.student_privacy_consents') ->> 'error' = '42501',
  'authenticated cannot read the table directly');
SELECT pg_temp.a356_assert('privacy.policy.accept' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'student_privacy_consent' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_student_consent_gate()) + 1,
  'the journal allowlist knows the action and the resource type');
SELECT pg_temp.a356_assert(strpos(pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::REGPROCEDURE),
  'platform_private.student_privacy_consents') > 0 AND strpos(pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::REGPROCEDURE),
  'platform_private.student_logins') > 0, 'the deletion closure lists the table next to the 346 ones');

-- 2. refused callers.
SELECT pg_temp.a356_assert(
  pg_temp.a356_call('anon', '{"role":"anon"}', 'SELECT platform.portal_consent_status_v1()') ->> 'error' = '42501'
  AND pg_temp.a356_call('service_role', '{"role":"service_role"}', 'SELECT platform.portal_consent_status_v1()') ->> 'error' = '42501'
  AND pg_temp.a356_call('authenticated', '', 'SELECT platform.portal_consent_status_v1()') ->> 'message' = 'consent_unavailable'
  AND pg_temp.a356_status(5) ->> 'message' = 'consent_unavailable'
  AND pg_temp.a356_accept(5, '2026-11-07', '2026-10-25', 'portal_web', 50) ->> 'message' = 'consent_unavailable'
  AND pg_temp.a356_call('anon', '{"role":"anon"}', format('SELECT platform.portal_consents_accept_v1(%L,%L,%L,%L)', '2026-11-07', '2026-10-25', 'ios', pg_temp.a356_id(51))) ->> 'error' = '42501'
  AND (SELECT count(*) = 0 FROM platform_private.student_privacy_consents),
  'anon, service_role, no claims and staff are refused; nothing is written');

-- 3. a student with nothing needs a decision.
SELECT pg_temp.a356_assert(
  pg_temp.a356_status(1) = jsonb_build_object('policyVersionCurrent', '2026-11-07', 'policyAcceptedVersion', NULL, 'aiStatus', NULL,
    'aiPolicyVersion', NULL, 'aiPolicyVersionCurrent', '2026-10-25', 'needsDecision', TRUE), 'a new student needs a decision: ' || pg_temp.a356_status(1)::TEXT);

-- 4. refusals write nothing.
SELECT pg_temp.a356_assert(
  pg_temp.a356_accept(1, '2026-09-18', '2026-10-25', 'portal_web', 1) ->> 'message' = 'consent_policy_version_mismatch'
  AND pg_temp.a356_accept(1, '2026-11-07', '2026-01-01', 'portal_web', 1) ->> 'message' = 'consent_ai_policy_version_mismatch'
  AND pg_temp.a356_accept(1, NULL, '2026-10-25', 'portal_web', 1) ->> 'message' = 'consent_policy_version_mismatch'
  AND pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'web', 1) ->> 'message' = 'consent_invalid_source'
  AND pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', NULL, 1) ->> 'message' = 'consent_invalid_source'
  AND pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'portal_web', NULL) ->> 'message' = 'consent_invalid_request'
  AND (SELECT count(*) = 0 FROM platform_private.student_privacy_consents)
  AND (SELECT count(*) = 0 FROM platform_private.student_ai_consents), 'invalid input is refused without writes');

-- 5. a good accept writes both, one event each; a replay changes nothing; a changed reuse conflicts.
SELECT pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'android', 1) AS a356_r1 \gset
SELECT pg_temp.a356_assert(NOT (:'a356_r1'::JSONB ? 'error') AND :'a356_r1'::JSONB ->> 'needsDecision' = 'false'
  AND :'a356_r1'::JSONB ->> 'policyAcceptedVersion' = '2026-11-07' AND :'a356_r1'::JSONB ->> 'aiStatus' = 'granted'
  AND :'a356_r1'::JSONB ->> 'aiPolicyVersion' = '2026-10-25', 'accept answers the new state: ' || :'a356_r1');
SELECT pg_temp.a356_assert(
  (SELECT count(*) = 1 AND bool_and(k.source = 'android' AND k.policy_version = '2026-11-07') FROM platform_private.student_privacy_consents k WHERE k.auth_user_id = pg_temp.a356_id(101))
  AND (SELECT count(*) = 1 AND bool_and(k.source = 'android' AND k.status = 'granted') FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a356_id(101))
  AND pg_temp.a356_events(1, 'privacy.policy.accept') = 1 AND pg_temp.a356_events(1, 'ai.consent.%') = 1, 'one row and one event of each kind');
SELECT pg_temp.a356_assert(pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'android', 1) = :'a356_r1'::JSONB
  AND pg_temp.a356_events(1, 'privacy.policy.accept') = 1 AND pg_temp.a356_events(1, 'ai.consent.%') = 1, 'a replay is idempotent');
SELECT pg_temp.a356_assert(pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'ios', 1) ->> 'message' = 'consent_request_conflict'
  AND pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'ios', 1) ->> 'error' = '55000', 'a changed reuse of the request id conflicts');
-- A new request on the same versions is no change.
SELECT pg_temp.a356_assert(NOT (pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'ios', 2) ? 'error')
  AND pg_temp.a356_events(1, 'privacy.policy.accept') = 1 AND pg_temp.a356_events(1, 'ai.consent.%') = 1, 'a new request on the same decision writes nothing');
SELECT pg_temp.a356_assert((SELECT s.policy_version FROM platform_private.student_privacy_consents s WHERE s.auth_user_id = pg_temp.a356_id(101)) = '2026-11-07'
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_privacy_consents s WHERE s.auth_user_id = pg_temp.a356_id(101) AND s.source <> 'android'), 'the row keeps its source');

-- 6. a later revoke is a decision: no gate; a replay of the old accept does not undo the revoke.
SELECT pg_temp.a356_as(1, format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', 'declined', '2026-10-25', 'portal_web', pg_temp.a356_id(3))) AS a356_rv \gset
SELECT pg_temp.a356_assert(pg_temp.a356_status(1) ->> 'needsDecision' = 'false' AND pg_temp.a356_status(1) ->> 'aiStatus' = 'declined', 'a revoke is a decision, not a gate');
SELECT pg_temp.a356_assert(pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'android', 1) ->> 'aiStatus' = 'declined', 'a replay does not undo the revoke');
-- A fresh accept re-grants (the student agreed again on the screen).
SELECT pg_temp.a356_assert(pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'portal_web', 4) ->> 'aiStatus' = 'granted', 'a fresh accept grants again');

-- 7. an old policy version needs a decision again; accept updates it and journals the change.
UPDATE platform_private.student_privacy_consents SET policy_version = '2026-09-18' WHERE auth_user_id = pg_temp.a356_id(101);
SELECT pg_temp.a356_assert(pg_temp.a356_status(1) ->> 'needsDecision' = 'true' AND pg_temp.a356_status(1) ->> 'policyAcceptedVersion' = '2026-09-18', 'an old version needs a decision');
SELECT pg_temp.a356_accept(1, '2026-11-07', '2026-10-25', 'ios', 5) AS a356_r5 \gset
SELECT pg_temp.a356_assert(:'a356_r5'::JSONB ->> 'needsDecision' = 'false' AND pg_temp.a356_events(1, 'privacy.policy.accept') = 2
  AND (SELECT e.before_state ->> 'policy_version' = '2026-09-18' FROM platform.audit_events e
       WHERE e.action = 'privacy.policy.accept' AND e.before_state IS NOT NULL AND e.actor_principal = 'auth:' || pg_temp.a356_id(101)::TEXT), 'the update is journaled with the old version');

-- 8. an AI decision on an old AI version needs a decision again.
INSERT INTO platform_private.student_privacy_consents(organization_id, auth_user_id, policy_version, source)
  VALUES (pg_temp.a356_id(1), pg_temp.a356_id(102), '2026-11-07', 'ios');
INSERT INTO platform_private.student_ai_consents(organization_id, auth_user_id, status, policy_version, source)
  VALUES (pg_temp.a356_id(1), pg_temp.a356_id(102), 'granted', '2026-08-01', 'ios');
SELECT pg_temp.a356_assert(pg_temp.a356_status(2) ->> 'needsDecision' = 'true', 'an AI decision on an old version needs a decision');
UPDATE platform_private.student_ai_consents SET policy_version = '2026-10-25' WHERE auth_user_id = pg_temp.a356_id(102);
SELECT pg_temp.a356_assert(pg_temp.a356_status(2) ->> 'needsDecision' = 'false', 'both decided on current versions: no gate');
-- Policy accepted but AI never decided -> gate.
INSERT INTO platform_private.student_privacy_consents(organization_id, auth_user_id, policy_version, source)
  VALUES (pg_temp.a356_id(1), pg_temp.a356_id(103), '2026-11-07', 'ios');
SELECT pg_temp.a356_assert(pg_temp.a356_status(3) ->> 'needsDecision' = 'true' AND pg_temp.a356_status(3) ->> 'aiStatus' IS NULL, 'policy only: still a gate');

-- 9. the policy counts as accepted through a current-version анкета; an old-version анкета does not count.
DELETE FROM platform_private.student_privacy_consents WHERE auth_user_id = pg_temp.a356_id(103);
CREATE FUNCTION pg_temp.a356_questionnaire(p_request UUID, p_version TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT, 'firstName', 'A356', 'lastName', 'Applicant', 'phone', '+996555356000',
    'destinationCountries', jsonb_build_array('CN'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', p_version)
$$;
INSERT INTO platform_private.student_applications(id, organization_id, auth_user_id, normalized_email, questionnaire) VALUES
  (pg_temp.a356_id(950), pg_temp.a356_id(1), pg_temp.a356_id(103), 'a356-3@example.invalid', pg_temp.a356_questionnaire(pg_temp.a356_id(900), '2026-11-07')),
  (pg_temp.a356_id(951), pg_temp.a356_id(1), pg_temp.a356_id(104), 'a356-4@example.invalid', pg_temp.a356_questionnaire(pg_temp.a356_id(901), '2026-09-18'));
SELECT pg_temp.a356_assert(pg_temp.a356_status(3) ->> 'policyAcceptedVersion' = '2026-11-07' AND pg_temp.a356_status(3) ->> 'needsDecision' = 'true',
  'a current-version анкета accepts the policy (only the AI choice is missing)');
SELECT pg_temp.a356_assert(pg_temp.a356_status(4) ->> 'policyAcceptedVersion' IS NULL AND pg_temp.a356_status(4) ->> 'needsDecision' = 'true',
  'an old-version анкета does not accept the policy');

-- 10. atomic: when the AI part fails the policy is not recorded (the AI limit of 20 changes an hour).
INSERT INTO platform_private.student_ai_consents(id, organization_id, auth_user_id, status, policy_version, source)
  VALUES (pg_temp.a356_id(960), pg_temp.a356_id(1), pg_temp.a356_id(104), 'declined', '2026-10-25', 'ios');
INSERT INTO platform.audit_events(organization_id, actor_kind, actor_principal, action, resource_type, resource_id, after_state, reason, request_id)
  SELECT pg_temp.a356_id(1), 'system', 'auth:x', 'ai.consent.decline', 'student_ai_consent', pg_temp.a356_id(960), '{}'::JSONB, 'A356 synthetic', pg_temp.a356_id(7000 + n)
  FROM generate_series(1, 20) n;
SELECT pg_temp.a356_assert(pg_temp.a356_accept(4, '2026-11-07', '2026-10-25', 'ios', 60) ->> 'message' = 'ai_consent_rate_limited'
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_privacy_consents s WHERE s.auth_user_id = pg_temp.a356_id(104))
  AND (SELECT status = 'declined' FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a356_id(104)),
  'a failed AI part leaves no policy row and no change');

\echo A356_STUDENT_CONSENT_GATE_SUITE_PASSED

ROLLBACK;
