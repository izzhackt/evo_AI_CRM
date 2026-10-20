\set ON_ERROR_STOP on
-- Boundary suite for migration 313: восстановление пароля студента спрашивает у базы, не сотрудник ли
-- пользователь Auth (docs/PLAN_CHANGES.md «2026-10-21 · Восстановление пароля студента: сотрудник любого
-- статуса не получает письмо студента, точечный поиск по адресу (миграция 313)», задача #1195). Runs on the
-- real chain right after 313 inside one transaction that is rolled back, with its own synthetic organizations,
-- members and Auth users; sessions are the real custom_access_token_hook claims. No email, no Auth service,
-- no real person, no production action.
--
-- Proves:
--  1. catalog and grants: platform.auth_user_has_staff_membership_v1(uuid) and
--     platform.auth_user_by_exact_email_v1(text) are SECURITY DEFINER with an empty search_path, owner
--     postgres, STABLE, one named parameter, no PUBLIC entry; EXECUTE for service_role ONLY. anon, a real
--     staff session (authenticated, with the hook claims of the system Admin), supabase_auth_admin and
--     evo_ai_agent cannot call either (the call is refused with 42501 for the roles the suite can assume);
--  2. staff membership in ANY status: the system Admin from bootstrap without any Auth marker, a staff
--     member without a role (the 157 shape), invited, inactive and blocked memberships and a blocked profile
--     are TRUE; a Student (active and inactive), a profile without a membership, an Auth user without a
--     profile, an unknown id and NULL are FALSE; a profile with a Student membership in one organization and
--     a staff membership in another is TRUE;
--  3. exact lookup by address: a mixed-case address and one padded with spaces find the one user; the answer
--     has exactly the eight keys, the staff markers only (no role, provider or other metadata), UTC
--     timestamps with microseconds, and `{}` metadata when there are no markers; no such user is NULL; two
--     users with one address are 21000 (auth_user_email_ambiguous); an empty, blank, overlong or malformed
--     address is 22023 (auth_user_email_invalid); a lookup by address plus the membership question reaches
--     the same verdict the application needs for a staff user without a marker.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $p313_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p313_auth_role$;

-- The lightweight Auth bootstrap of the harness (126/157/280 convention): managed Supabase Auth owns these
-- columns; add them transaction-locally where missing, ROLLBACK discards the DDL.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_app_meta_data JSONB;

\echo PASSWORD_RECOVERY_STAFF_CHECK_SUITE_START

CREATE FUNCTION pg_temp.p313_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p313_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P313: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.p313_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
  v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
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
CREATE FUNCTION pg_temp.p313_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
-- The service-role call the application makes.
CREATE FUNCTION pg_temp.p313_member(p_auth_user_id UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p313_call('service_role', '{"role":"service_role"}',
    format('SELECT to_jsonb(platform.auth_user_has_staff_membership_v1(%L))', p_auth_user_id))
$$;
CREATE FUNCTION pg_temp.p313_lookup(p_email TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p313_call('service_role', '{"role":"service_role"}',
    format('SELECT platform.auth_user_by_exact_email_v1(%L)', p_email))
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   actor 1  system Admin of the bootstrap kind: active, role admin, NO Auth marker
--   actor 2  staff member without a role (157 shape): active, role NULL
--   actor 3  staff invited (status invited, role NULL)
--   actor 4  staff inactive (Sales)             actor 5  staff blocked (Curator)
--   actor 6  Sales active, the PROFILE is blocked
--   actor 7  Student active                     actor 8  Student inactive
--   actor 9  profile without a membership       actor 10 Auth user without a profile
--   actor 11 Student active in org 1 + Curator inactive in org 2
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p313_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role,
  status platform.membership_status, sysadmin BOOLEAN, has_profile BOOLEAN, has_membership BOOLEAN,
  profile_status platform.profile_status);
INSERT INTO p313_actors VALUES
  (1, 1, 'admin', 'active', TRUE, TRUE, TRUE, 'active'),
  (2, 1, NULL, 'active', FALSE, TRUE, TRUE, 'active'),
  (3, 1, NULL, 'invited', FALSE, TRUE, TRUE, 'active'),
  (4, 1, 'sales', 'inactive', FALSE, TRUE, TRUE, 'active'),
  (5, 1, 'curator', 'blocked', FALSE, TRUE, TRUE, 'active'),
  (6, 1, 'sales', 'active', FALSE, TRUE, TRUE, 'blocked'),
  (7, 1, 'student', 'active', FALSE, TRUE, TRUE, 'active'),
  (8, 1, 'student', 'inactive', FALSE, TRUE, TRUE, 'active'),
  (9, 1, NULL, 'active', FALSE, TRUE, FALSE, 'active'),
  (10, 1, NULL, 'active', FALSE, FALSE, FALSE, 'active'),
  (11, 1, 'student', 'active', FALSE, TRUE, TRUE, 'active');
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.p313_id(1), 'P313 Fictional organization', 'active'),
  (pg_temp.p313_id(2), 'P313 Other fictional organization', 'active');
-- No Auth metadata marker for anyone here: the verdict has to come from the membership.
INSERT INTO auth.users(id, email, raw_user_meta_data, raw_app_meta_data)
  SELECT pg_temp.p313_id(100 + n), 'p313-' || n || '@example.invalid', '{}'::JSONB,
    '{"provider":"email","providers":["email"]}'::JSONB FROM p313_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p313_id(200 + n), pg_temp.p313_id(100 + n), 'P313 Actor ' || n, a.profile_status, 1
  FROM p313_actors a WHERE a.has_profile;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p313_id(300 + a.n), pg_temp.p313_id(a.org), pg_temp.p313_id(200 + a.n), a.status, a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM p313_actors a WHERE a.has_membership;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.p313_id(300 + n) FROM p313_actors WHERE sysadmin);
-- Actor 11 is also a (disabled) Curator of the other organization.
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.p313_id(411), pg_temp.p313_id(2), pg_temp.p313_id(211), 'inactive', 'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published'
      ORDER BY version DESC LIMIT 1));

SELECT pg_temp.p313_assert((SELECT count(*) = 11 FROM auth.users WHERE email LIKE 'p313-%@example.invalid')
    AND (SELECT count(*) = 10 FROM platform.profiles WHERE display_name LIKE 'P313 Actor %')
    AND (SELECT count(*) = 9 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE p.display_name LIKE 'P313 Actor %' AND m.organization_id = pg_temp.p313_id(1))
    AND (SELECT count(*) = 1 FROM platform.organization_memberships WHERE id = pg_temp.p313_id(411)),
  'the fixture has 11 Auth users, 10 profiles and the expected memberships');
SELECT pg_temp.p313_assert(NOT EXISTS (SELECT 1 FROM auth.users u
      WHERE u.id IN (SELECT pg_temp.p313_id(100 + n) FROM p313_actors)
        AND (u.raw_app_meta_data ? 'evo_staff_password_request_id' OR u.raw_user_meta_data ? 'evo_staff_invitation_request_id')),
  'no fixture user carries a staff marker: the verdict must come from the membership');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_assert((SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'platform' AND p.proname = 'auth_user_has_staff_membership_v1')
    AND (SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'platform' AND p.proname = 'auth_user_by_exact_email_v1'),
  'exactly one of each function exists in platform');
SELECT pg_temp.p313_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 's'
      AND p.pronargs = 1 AND p.proargnames = ARRAY['p_auth_user_id']::TEXT[] AND p.proargtypes::TEXT = '2950'
      AND p.prorettype = 'boolean'::REGTYPE
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND (SELECT count(*) = 2 FROM aclexplode(p.proacl) a)
    FROM pg_proc p WHERE p.oid = 'platform.auth_user_has_staff_membership_v1(uuid)'::regprocedure),
  'auth_user_has_staff_membership_v1: definer, empty search_path, owner postgres, STABLE, one uuid parameter, EXECUTE for service_role only (owner + service_role in the ACL, no PUBLIC)');
SELECT pg_temp.p313_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 's'
      AND p.pronargs = 1 AND p.proargnames = ARRAY['p_email']::TEXT[] AND p.proargtypes::TEXT = '25'
      AND p.prorettype = 'jsonb'::REGTYPE
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND (SELECT count(*) = 2 FROM aclexplode(p.proacl) a)
    FROM pg_proc p WHERE p.oid = 'platform.auth_user_by_exact_email_v1(text)'::regprocedure),
  'auth_user_by_exact_email_v1: definer, empty search_path, owner postgres, STABLE, one text parameter, EXECUTE for service_role only');

-- A real staff session (the hook claims of the system Admin) and anon cannot call either function.
CREATE TEMP TABLE p313_admin_claims AS
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p313_id(101),
    'claims', jsonb_build_object('sub', pg_temp.p313_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS claims;
SELECT pg_temp.p313_assert((SELECT claims::JSONB ? 'platform_membership_id' FROM p313_admin_claims),
  'the system Admin got real hook claims');
SELECT pg_temp.p313_assert(
  pg_temp.p313_err(pg_temp.p313_call('authenticated', (SELECT claims FROM p313_admin_claims),
    format('SELECT to_jsonb(platform.auth_user_has_staff_membership_v1(%L))', pg_temp.p313_id(101)))) = '42501'
  AND pg_temp.p313_err(pg_temp.p313_call('authenticated', (SELECT claims FROM p313_admin_claims),
    $q$SELECT platform.auth_user_by_exact_email_v1('p313-1@example.invalid')$q$)) = '42501'
  AND pg_temp.p313_err(pg_temp.p313_call('anon', '{"role":"anon"}',
    format('SELECT to_jsonb(platform.auth_user_has_staff_membership_v1(%L))', pg_temp.p313_id(101)))) = '42501'
  AND pg_temp.p313_err(pg_temp.p313_call('anon', '{"role":"anon"}',
    $q$SELECT platform.auth_user_by_exact_email_v1('p313-1@example.invalid')$q$)) = '42501'
  AND pg_temp.p313_err(pg_temp.p313_call('supabase_auth_admin', '{"role":"supabase_auth_admin"}',
    format('SELECT to_jsonb(platform.auth_user_has_staff_membership_v1(%L))', pg_temp.p313_id(101)))) = '42501'
  AND pg_temp.p313_err(pg_temp.p313_call('supabase_auth_admin', '{"role":"supabase_auth_admin"}',
    $q$SELECT platform.auth_user_by_exact_email_v1('p313-1@example.invalid')$q$)) = '42501',
  'a staff session, anon and supabase_auth_admin are refused (42501) on both functions');

-- ---------------------------------------------------------------------------
-- 2. Staff membership in any status.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(101)) = 'true'::JSONB,
  'the system Admin from bootstrap, with no Auth marker, is staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(102)) = 'true'::JSONB,
  'a staff member without a role (157 shape) is staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(103)) = 'true'::JSONB
  AND pg_temp.p313_member(pg_temp.p313_id(104)) = 'true'::JSONB
  AND pg_temp.p313_member(pg_temp.p313_id(105)) = 'true'::JSONB,
  'invited, inactive and blocked staff memberships are staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(106)) = 'true'::JSONB,
  'active staff membership of a blocked profile is staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(107)) = 'false'::JSONB
  AND pg_temp.p313_member(pg_temp.p313_id(108)) = 'false'::JSONB,
  'a Student, active or inactive, is not staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(109)) = 'false'::JSONB
  AND pg_temp.p313_member(pg_temp.p313_id(110)) = 'false'::JSONB
  AND pg_temp.p313_member(pg_temp.p313_id(9999)) = 'false'::JSONB
  AND pg_temp.p313_call('service_role', '{"role":"service_role"}',
    'SELECT to_jsonb(platform.auth_user_has_staff_membership_v1(NULL::uuid))') = 'false'::JSONB,
  'a profile without a membership, an Auth user without a profile, an unknown id and NULL are not staff');
SELECT pg_temp.p313_assert(
  pg_temp.p313_member(pg_temp.p313_id(111)) = 'true'::JSONB,
  'a Student of one organization who also holds a staff membership of another is staff (conservative)');
SELECT pg_temp.p313_assert(
  (SELECT count(*) = 7 FROM p313_actors a
    WHERE pg_temp.p313_member(pg_temp.p313_id(100 + a.n)) = 'true'::JSONB),
  'exactly seven fixture users are staff: actors 1-6 and actor 11 (through its inactive Curator membership of the other organization)');

-- ---------------------------------------------------------------------------
-- 3. Exact lookup by address.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email, raw_user_meta_data, raw_app_meta_data, invited_at, confirmation_sent_at,
    email_confirmed_at, confirmed_at)
  VALUES (pg_temp.p313_id(121), 'P313.Mixed.Case@Example.Invalid',
    '{"evo_staff_invitation_request_id":"p313-invite-request","role":"admin","secret":"must-not-leave"}'::JSONB,
    '{"provider":"email","providers":["email"],"evo_staff_password_request_id":"p313-password-request","note":"must-not-leave"}'::JSONB,
    TIMESTAMPTZ '2026-09-07 10:00:00.123456+05', TIMESTAMPTZ '2026-09-07 11:30:15.5+05',
    TIMESTAMPTZ '2026-09-08 00:00:00+00', TIMESTAMPTZ '2026-09-08 00:00:00+00'),
  (pg_temp.p313_id(122), 'p313-bare@example.invalid', NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.p313_id(123), 'p313-dup@example.invalid', '{}'::JSONB, '{}'::JSONB, NULL, NULL, NULL, NULL),
  (pg_temp.p313_id(124), 'P313-DUP@example.invalid', '{}'::JSONB, '{}'::JSONB, NULL, NULL, NULL, NULL);

SELECT pg_temp.p313_lookup('p313.mixed.case@example.invalid') AS p313_found \gset
SELECT pg_temp.p313_assert(pg_temp.p313_err(:'p313_found'::JSONB) IS NULL
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'p313_found'::JSONB) k)
      = ARRAY['app_metadata', 'confirmation_sent_at', 'confirmed_at', 'email', 'email_confirmed_at', 'id', 'invited_at', 'user_metadata']
    AND :'p313_found'::JSONB ->> 'id' = pg_temp.p313_id(121)::TEXT
    AND :'p313_found'::JSONB ->> 'email' = 'P313.Mixed.Case@Example.Invalid',
  'the lookup finds the user case-insensitively and answers exactly the eight keys, with the stored address');
SELECT pg_temp.p313_assert(
    :'p313_found'::JSONB -> 'app_metadata' = '{"evo_staff_password_request_id":"p313-password-request"}'::JSONB
    AND :'p313_found'::JSONB -> 'user_metadata' = '{"evo_staff_invitation_request_id":"p313-invite-request"}'::JSONB
    AND :'p313_found'::TEXT NOT LIKE '%must-not-leave%' AND :'p313_found'::TEXT NOT LIKE '%provider%'
    AND :'p313_found'::TEXT NOT LIKE '%"role"%',
  'only the two staff markers leave the metadata: no role, provider or other value');
SELECT pg_temp.p313_assert(
    :'p313_found'::JSONB ->> 'invited_at' = '2026-09-07T05:00:00.123456Z'
    AND :'p313_found'::JSONB ->> 'confirmation_sent_at' = '2026-09-07T06:30:15.500000Z'
    AND :'p313_found'::JSONB ->> 'email_confirmed_at' = '2026-09-08T00:00:00.000000Z'
    AND :'p313_found'::JSONB ->> 'confirmed_at' = '2026-09-08T00:00:00.000000Z',
  'timestamps are UTC with microseconds and a Z');
SELECT pg_temp.p313_assert(
    pg_temp.p313_lookup('  P313.MIXED.CASE@EXAMPLE.INVALID ') = :'p313_found'::JSONB,
  'case and spaces around the address do not change the answer');
SELECT pg_temp.p313_lookup('p313-bare@example.invalid') AS p313_bare \gset
SELECT pg_temp.p313_assert(
    :'p313_bare'::JSONB -> 'app_metadata' = '{}'::JSONB AND :'p313_bare'::JSONB -> 'user_metadata' = '{}'::JSONB
    AND :'p313_bare'::JSONB -> 'invited_at' = 'null'::JSONB AND :'p313_bare'::JSONB -> 'confirmation_sent_at' = 'null'::JSONB,
  'a user without metadata or times answers {} metadata and null times');
SELECT pg_temp.p313_lookup('p313-1@example.invalid') AS p313_admin \gset
SELECT pg_temp.p313_assert(
    :'p313_admin'::JSONB ->> 'id' = pg_temp.p313_id(101)::TEXT
    AND :'p313_admin'::JSONB -> 'app_metadata' = '{}'::JSONB AND :'p313_admin'::JSONB -> 'user_metadata' = '{}'::JSONB,
  'the bootstrap Admin is found by address and carries no marker');
SELECT pg_temp.p313_assert(
    pg_temp.p313_lookup('p313-nobody@example.invalid') = 'null'::JSONB,
  'an address nobody has answers NULL (JSON null)');
SELECT pg_temp.p313_assert(
    pg_temp.p313_err(pg_temp.p313_lookup('p313-dup@example.invalid')) = '21000'
    AND pg_temp.p313_lookup('p313-dup@example.invalid') ->> 'message' = 'auth_user_email_ambiguous',
  'two users with one address are 21000 auth_user_email_ambiguous, never a guess');
SELECT pg_temp.p313_assert(
    pg_temp.p313_err(pg_temp.p313_call('service_role', '{"role":"service_role"}',
      'SELECT platform.auth_user_by_exact_email_v1(NULL::text)')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup('')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup('   ')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup('no-at-sign')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup('two words@example.invalid')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup(E'tab\t@example.invalid')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup(repeat('a', 400) || '@example.invalid')) = '22023'
    AND pg_temp.p313_err(pg_temp.p313_lookup('ab')) = '22023'
    AND pg_temp.p313_lookup('') ->> 'message' = 'auth_user_email_invalid',
  'a NULL, empty, blank, space-bearing, control-character, overlong or at-less address is 22023 auth_user_email_invalid');

-- The two answers together give the application the verdict it needs: the bootstrap Admin is found by
-- address, carries no marker, and the membership question still says staff; a Student is found and is not.
SELECT pg_temp.p313_assert(
    pg_temp.p313_member((pg_temp.p313_lookup('p313-1@example.invalid') ->> 'id')::UUID) = 'true'::JSONB
    AND pg_temp.p313_member((pg_temp.p313_lookup('p313-7@example.invalid') ->> 'id')::UUID) = 'false'::JSONB
    AND pg_temp.p313_member((pg_temp.p313_lookup('p313-3@example.invalid') ->> 'id')::UUID) = 'true'::JSONB
    AND pg_temp.p313_lookup('p313-7@example.invalid') -> 'app_metadata' = '{}'::JSONB,
  'address lookup then membership question: bootstrap Admin and an invited member are staff, a Student is not');

\echo PASSWORD_RECOVERY_STAFF_CHECK_SUITE_PASSED

ROLLBACK;
