\set ON_ERROR_STOP on
-- Boundary suite for migration 355 «источник android у согласия на ИИ-помощников». Runs on the real chain right after 355
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves: `android` is accepted by portal_ai_consent_set_v1 and stored in the row and the journal event; an unknown,
-- near-miss and NULL source is still refused (22023 ai_consent_invalid_source) and the CHECK itself refuses a direct
-- write of one; `portal_web` and `ios` behave as before (stored, journaled); the same request replayed is idempotent and
-- a changed reuse conflicts (55000); a changed source on the same status and version is no change; the function keeps
-- SECURITY DEFINER, an empty search_path, VOLATILE and EXECUTE for authenticated only; the constraint lists exactly
-- three sources.
BEGIN;

\echo A355_AI_CONSENT_ANDROID_SOURCE_SUITE_START

-- Lightweight Auth bootstrap of the harness (see platform_student_ai_consent.sql), transaction-local.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $a355_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$a355_auth_role$;

CREATE FUNCTION pg_temp.a355_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a355_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A355: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a355_call(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
  SET LOCAL ROLE authenticated;
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
CREATE TEMP TABLE a355_claims(student INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a355_claims TO authenticated;
-- The decision RPC as student n; request number r.
CREATE FUNCTION pg_temp.a355_set(p_student INTEGER, p_status TEXT, p_source TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a355_call(
    (SELECT claims FROM a355_claims WHERE student = p_student),
    format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', p_status, '2026-10-25', p_source,
      CASE WHEN p_request IS NULL THEN NULL ELSE pg_temp.a355_id(p_request)::TEXT END))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a355_id(INTEGER) TO authenticated;

-- Fixture: one organization, four student accounts with an active student membership (claims from the real hook).
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a355_id(1), 'A355 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a355_id(100 + n), 'a355-' || n || '@example.invalid', '{}'::JSONB FROM generate_series(1, 4) n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a355_id(200 + n), pg_temp.a355_id(100 + n), 'A355 Student ' || n, 'active', 1 FROM generate_series(1, 4) n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a355_id(300 + n), pg_temp.a355_id(1), pg_temp.a355_id(200 + n), 'active', 'student',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'student' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 day'
  FROM generate_series(1, 4) n;
INSERT INTO a355_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a355_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.a355_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 4) n;
SELECT pg_temp.a355_assert((SELECT count(*) = 4 AND bool_and(claims IS NOT NULL) FROM a355_claims), 'every student got claims from the real hook');

-- 1. posture: three sources in the constraint, the function is still a closed definer function.
SELECT pg_temp.a355_assert(
  (SELECT pg_get_constraintdef(c.oid) LIKE '%portal_web%' AND pg_get_constraintdef(c.oid) LIKE '%ios%'
     AND pg_get_constraintdef(c.oid) LIKE '%android%'
     AND (length(pg_get_constraintdef(c.oid)) - length(replace(pg_get_constraintdef(c.oid), '::text', ''))) / 6 = 3
   FROM pg_constraint c WHERE c.conrelid = 'platform_private.student_ai_consents'::REGCLASS AND c.conname = 'student_ai_consents_source_check'),
  'the constraint lists exactly portal_web, ios, android');
SELECT pg_temp.a355_assert(
  (SELECT p.prosecdef AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=""']
     AND p.proowner = (SELECT c.relowner FROM pg_class c WHERE c.oid = 'platform_private.student_ai_consents'::REGCLASS)
   FROM pg_proc p WHERE p.oid = 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE),
  'the RPC stays SECURITY DEFINER, VOLATILE, empty search_path, owned like the table');
SELECT pg_temp.a355_assert(
  has_function_privilege('authenticated', 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE, 'EXECUTE'),
  'EXECUTE stays with authenticated only');
SELECT pg_temp.a355_assert(
  (SELECT pg_get_functiondef(p.oid) LIKE '%p_source NOT IN (''portal_web'', ''ios'', ''android'')%'
   FROM pg_proc p WHERE p.oid = 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE),
  'the guard lists the three sources');

-- 2. android is accepted and stored, with one journal event naming the source.
SELECT pg_temp.a355_set(1, 'granted', 'android', 1) AS a355_r1 \gset
SELECT pg_temp.a355_assert(:'a355_r1'::JSONB ->> 'status' = 'granted' AND NOT (:'a355_r1'::JSONB ? 'error'), 'android grant answers granted');
SELECT pg_temp.a355_assert(
  (SELECT count(*) = 1 AND bool_and(k.status = 'granted' AND k.source = 'android')
   FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(101)),
  'the row stores android');
SELECT pg_temp.a355_assert(
  (SELECT count(*) = 1 AND bool_and(e.after_state ->> 'source' = 'android' AND e.action = 'ai.consent.grant')
   FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
   WHERE k.auth_user_id = pg_temp.a355_id(101) AND e.action LIKE 'ai.consent.%'),
  'one journal event names android');

-- 3. idempotent replay of the same request, and a changed reuse of the request id conflicts.
SELECT pg_temp.a355_assert(pg_temp.a355_set(1, 'granted', 'android', 1) = :'a355_r1'::JSONB, 'replay returns the same answer');
SELECT pg_temp.a355_assert(
  (SELECT count(*) = 1 FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
   WHERE k.auth_user_id = pg_temp.a355_id(101) AND e.action LIKE 'ai.consent.%'),
  'replay adds no journal event');
SELECT pg_temp.a355_assert(
  pg_temp.a355_set(1, 'granted', 'ios', 1) ->> 'message' = 'ai_consent_request_conflict'
  AND pg_temp.a355_set(1, 'granted', 'ios', 1) ->> 'error' = '55000',
  'the same request id with another source conflicts');
-- A new request with the same status and version but another source is no change: no update, no event.
SELECT pg_temp.a355_set(1, 'granted', 'ios', 2) AS a355_r2 \gset
SELECT pg_temp.a355_assert(NOT (:'a355_r2'::JSONB ? 'error')
  AND (SELECT k.source = 'android' FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(101))
  AND (SELECT count(*) = 1 FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
       WHERE k.auth_user_id = pg_temp.a355_id(101) AND e.action LIKE 'ai.consent.%'),
  'the same decision from another source is no change');
-- A real change from android works and records the new source.
SELECT pg_temp.a355_set(1, 'declined', 'android', 3) AS a355_r3 \gset
SELECT pg_temp.a355_assert(:'a355_r3'::JSONB ->> 'status' = 'declined'
  AND (SELECT k.status = 'declined' AND k.source = 'android' FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(101))
  AND (SELECT count(*) = 2 FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
       WHERE k.auth_user_id = pg_temp.a355_id(101) AND e.action LIKE 'ai.consent.%'),
  'a decline from android is stored and journaled');

-- 4. unknown, near-miss and NULL sources are refused by the RPC and by the CHECK.
SELECT pg_temp.a355_assert(
  pg_temp.a355_set(2, 'granted', x.src, 10) ->> 'message' = 'ai_consent_invalid_source'
  AND pg_temp.a355_set(2, 'granted', x.src, 10) ->> 'error' = '22023',
  'source ' || COALESCE(x.src, 'NULL') || ' is refused')
FROM (VALUES ('windows'), ('Android'), ('android '), ('web'), ('portal'), (''), (NULL::TEXT)) AS x(src);
SELECT pg_temp.a355_assert(NOT EXISTS (SELECT 1 FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(102)),
  'a refused source leaves no row');
DO $a355_check$
BEGIN
  BEGIN
    INSERT INTO platform_private.student_ai_consents (organization_id, auth_user_id, status, policy_version, source)
    VALUES (pg_temp.a355_id(1), pg_temp.a355_id(102), 'granted', '2026-10-25', 'windows');
    RAISE EXCEPTION 'A355: the CHECK accepted an unknown source';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$a355_check$;

-- 5. portal_web and ios are unchanged: stored and journaled with their own source.
SELECT pg_temp.a355_set(3, 'granted', 'portal_web', 20) AS a355_r4 \gset
SELECT pg_temp.a355_set(4, 'declined', 'ios', 21) AS a355_r5 \gset
SELECT pg_temp.a355_assert(NOT (:'a355_r4'::JSONB ? 'error') AND NOT (:'a355_r5'::JSONB ? 'error')
  AND (SELECT k.source = 'portal_web' AND k.status = 'granted' FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(103))
  AND (SELECT k.source = 'ios' AND k.status = 'declined' FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a355_id(104))
  AND (SELECT bool_and(e.after_state ->> 'source' = CASE k.auth_user_id WHEN pg_temp.a355_id(103) THEN 'portal_web' ELSE 'ios' END)
       FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
       WHERE k.auth_user_id IN (pg_temp.a355_id(103), pg_temp.a355_id(104)) AND e.action LIKE 'ai.consent.%'),
  'portal_web and ios still work and are journaled');
-- Other guards of the function are untouched.
SELECT pg_temp.a355_assert(
  pg_temp.a355_set(3, 'maybe', 'android', 22) ->> 'message' = 'ai_consent_invalid_status'
  AND pg_temp.a355_call(jsonb_build_object('sub', pg_temp.a355_id(103), 'role', 'authenticated')::TEXT,
    format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', 'granted', '2026-01-01', 'android', pg_temp.a355_id(23))) ->> 'message'
    = 'ai_consent_policy_version_mismatch',
  'status and policy version guards are unchanged');

\echo A355_AI_CONSENT_ANDROID_SOURCE_SUITE_PASSED

ROLLBACK;
