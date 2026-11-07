\set ON_ERROR_STOP on
-- Boundary suite for migration 340 «Вход студента по логину». Runs on the real chain right after 340 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the service gives the first free login of base, base2, ...; a user keeps the login it already has;
--  2. the service finds the sign-in email by login in any case; an unknown, deleted or banned user is not found;
--  3. a signed-in user reads only the own login;
--  4. browser roles can neither claim nor resolve, a malformed base is refused, the table is closed to every role.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A340_STUDENT_LOGINS_SUITE_START

CREATE FUNCTION pg_temp.a340_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a340_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A340: %', message; END IF;
END
$$;
-- A call as a role with its claims: the result as text, or the SQLSTATE of the refusal.
CREATE FUNCTION pg_temp.a340_as(p_role TEXT, p_sub UUID, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT; v_state TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role, 'sub', p_sub)::TEXT, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    result := 'error:' || v_state;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;

-- The lightweight Auth bootstrap of the harness (126/185/193/280 convention): managed Supabase Auth owns these
-- columns; add them transaction-locally where missing, ROLLBACK discards the DDL.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT pg_temp.a340_id(100 + n), 'a340-' || n || '@example.invalid', '{}'::JSONB FROM generate_series(1, 4) n;
UPDATE auth.users SET deleted_at = clock_timestamp() WHERE id = pg_temp.a340_id(103);
UPDATE auth.users SET banned_until = clock_timestamp() + INTERVAL '1 day' WHERE id = pg_temp.a340_id(104);

-- ---------------------------------------------------------------------------
-- 1. Claims.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(101), 'aidai.chynarova')) = 'aidai.chynarova',
  'the first user gets the base');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(102), 'aidai.chynarova')) = 'aidai.chynarova2',
  'the second user with the same name gets base2');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(101), 'other.name')) = 'aidai.chynarova',
  'a user keeps the login it already has');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(103), 'deleted.user')) = 'deleted.user'
  AND pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(104), 'banned.user')) = 'banned.user',
  'deleted and banned fixtures get logins too');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(101), 'Bad Login')) = 'error:22023'
  AND pg_temp.a340_as('service_role', NULL,
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(101), 'admin')) = 'error:22023',
  'a malformed base and the admin alias are refused');

-- ---------------------------------------------------------------------------
-- 2. Resolution.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    'SELECT platform.student_login_email_v1('' Aidai.Chynarova2 '')') = 'a340-2@example.invalid',
  'the email is found by login in any case');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL,
    'SELECT platform.student_login_email_v1(''nobody.here'')') IS NULL,
  'an unknown login finds nothing');
SELECT pg_temp.a340_assert(pg_temp.a340_as('service_role', NULL, 'SELECT platform.student_login_email_v1(''deleted.user'')') IS NULL
  AND pg_temp.a340_as('service_role', NULL, 'SELECT platform.student_login_email_v1(''banned.user'')') IS NULL,
  'deleted and banned users are not found');

-- ---------------------------------------------------------------------------
-- 3. The own login.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a340_assert(pg_temp.a340_as('authenticated', pg_temp.a340_id(102),
    'SELECT platform.own_student_login_v1()') = 'aidai.chynarova2',
  'a signed-in user reads the own login');

-- ---------------------------------------------------------------------------
-- 4. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a340_assert(pg_temp.a340_as('authenticated', pg_temp.a340_id(101),
    'SELECT platform.student_login_email_v1(''aidai.chynarova'')') = 'error:42501'
  AND pg_temp.a340_as('authenticated', pg_temp.a340_id(101),
    format('SELECT platform.claim_student_login_v1(%L, %L)', pg_temp.a340_id(101), 'x.y')) = 'error:42501'
  AND pg_temp.a340_as('anon', NULL, 'SELECT platform.student_login_email_v1(''aidai.chynarova'')') = 'error:42501',
  'browser roles can neither resolve nor claim');
SELECT pg_temp.a340_assert(NOT has_table_privilege('service_role', 'platform_private.student_logins', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'platform_private.student_logins', 'SELECT')
    AND NOT has_table_privilege('anon', 'platform_private.student_logins', 'SELECT'),
  'the table is closed to every role');
SELECT pg_temp.a340_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      to_regprocedure('platform.claim_student_login_v1(uuid,text)'),
      to_regprocedure('platform.student_login_email_v1(text)'),
      to_regprocedure('platform.own_student_login_v1()'))),
  'SECURITY DEFINER with an empty search_path');

\echo A340_STUDENT_LOGINS_SUITE_PASSED
ROLLBACK;
