\set ON_ERROR_STOP on

-- Acceptance for the CSCA session calendar refresh migration (313, matched by
-- name *_platform_csca_sessions_refresh.sql). Runs after the whole chain on the
-- database of scripts/test-csca-learning-postgres.sh. Every row the suite
-- writes rolls back.
--
-- Claims proven here:
--   (i)   the newest row of each of the six sessions is the refreshed one: dates
--         as published by 286 (14 and 15.11.2026; 19 and 20.12.2026; 23 and
--         24.01.2027; 13 and 14.03.2027; 24 and 25.04.2027; 26 and 27.06.2027),
--         checked on 21.10.2026, source https://csca.cn/home; the 286 rows are
--         still there (append-only), so the history of the calendar is kept;
--   (ii)  the only registration window is the one csca.cn published, 15.10.2026
--         15:00 to 21.10.2026 23:59 Beijing time, on 2026-11; the other five
--         stay NULL (an unpublished window is never guessed) and the table keeps
--         its rule that opens and closes are both set or both NULL;
--   (iii) the real RPC learning_track_home_v1 serves the refreshed rows to a
--         Student (date of check, source, window, only sessions not yet ended by
--         the Bishkek date, in order of the exam), and the newest row wins: a
--         later correction row of the same session replaces it on the home;
--   (iv)  the rows stay immutable (UPDATE and DELETE refused) and the migration
--         refuses a second run (p313_anchor_rerun).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.c3_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('c5ca0313-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.c3_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CSCA sessions refresh assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.c3_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE FUNCTION pg_temp.c3_message(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$$;

-- (i) and (ii): the newest row of each session, straight from the table.
CREATE TEMP TABLE c3_latest ON COMMIT DROP AS
SELECT DISTINCT ON (session.session_key) session.*
FROM platform_private.csca_exam_sessions session
ORDER BY session.session_key, session.published_at DESC, session.id DESC;

SELECT pg_temp.c3_assert(
  (SELECT count(*) FROM c3_latest) = 6
    AND (SELECT count(*) FROM c3_latest WHERE verified_on = DATE '2026-10-21'
      AND source_url = 'https://csca.cn/home') = 6,
  'six sessions, each with its newest row checked on 21.10.2026 against the csca.cn home page');

SELECT pg_temp.c3_assert(
  (SELECT array_agg(ARRAY[session_key, exam_from::TEXT, exam_to::TEXT] ORDER BY exam_from) FROM c3_latest)
    = ARRAY[
      ARRAY['2026-11', '2026-11-14', '2026-11-15'], ARRAY['2026-12', '2026-12-19', '2026-12-20'],
      ARRAY['2027-01', '2027-01-23', '2027-01-24'], ARRAY['2027-03', '2027-03-13', '2027-03-14'],
      ARRAY['2027-04', '2027-04-24', '2027-04-25'], ARRAY['2027-06', '2027-06-26', '2027-06-27']],
  'the exam dates are the ones csca.cn publishes');

SELECT pg_temp.c3_assert(
  (SELECT registration_opens_at = '2026-10-15T15:00:00+08:00'::TIMESTAMPTZ
      AND registration_closes_at = '2026-10-21T23:59:00+08:00'::TIMESTAMPTZ
      AND registration_closes_at = '2026-10-21T15:59:00+00:00'::TIMESTAMPTZ
    FROM c3_latest WHERE session_key = '2026-11')
    AND (SELECT count(*) FROM c3_latest WHERE session_key <> '2026-11'
      AND registration_opens_at IS NULL AND registration_closes_at IS NULL) = 5,
  'only 2026-11 has the published window (23:59 Beijing = 15:59 UTC); the other five stay unknown');

SELECT pg_temp.c3_assert(
  (SELECT count(*) FROM platform_private.csca_exam_sessions WHERE verified_on = DATE '2026-10-16') = 6
    AND (SELECT count(*) FROM platform_private.csca_exam_sessions WHERE verified_on = DATE '2026-10-21') = 6
    AND NOT EXISTS (SELECT 1 FROM platform_private.csca_exam_sessions older
      JOIN c3_latest ON c3_latest.session_key = older.session_key AND c3_latest.id <> older.id
      WHERE older.exam_from IS DISTINCT FROM c3_latest.exam_from OR older.exam_to IS DISTINCT FROM c3_latest.exam_to
        OR older.registration_opens_at IS DISTINCT FROM c3_latest.registration_opens_at
        OR older.registration_closes_at IS DISTINCT FROM c3_latest.registration_closes_at),
  'the 286 rows stay beside the new ones and carry the same dates and windows');

SELECT pg_temp.c3_assert(
  pg_temp.c3_error($sql$
    INSERT INTO platform_private.csca_exam_sessions (session_key, exam_from, exam_to, registration_opens_at, source_url, verified_on)
    VALUES ('2027-02', '2027-02-06', '2027-02-07', '2027-01-01T00:00:00+08:00', 'https://csca.cn/home', '2026-10-21')
  $sql$) = '23514',
  'a window with only one end is refused by the table');

-- (iii) the real RPC for a Student.
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.c3_id(1), 'CSCA sessions refresh fixture organization');
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (pg_temp.c3_id(104), 'csca-sessions-refresh-student@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES (pg_temp.c3_id(204), pg_temp.c3_id(104), 'CSCA sessions refresh student', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
VALUES (pg_temp.c3_id(304), pg_temp.c3_id(1), pg_temp.c3_id(204), 'active', 'student'::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions
    WHERE role = 'student'::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1), FALSE);
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.c3_id(11), pg_temp.c3_id(1), 'organization', pg_temp.c3_id(1), 1);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
VALUES (pg_temp.c3_id(1), pg_temp.c3_id(304), pg_temp.c3_id(11), 1, 1, TRUE, 'system',
  'CSCA sessions refresh fixture organization scope', pg_temp.c3_id(604));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.c3_id(104),
  'claims', jsonb_build_object('sub', pg_temp.c3_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS c3_student
\gset
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS c3_today \gset

SET request.jwt.claims TO :'c3_student';
SET ROLE authenticated;
SELECT platform.learning_track_home_v1('csca-math') -> 'sessions' AS c3_sessions \gset
RESET ROLE;

-- The home lists the sessions that have not ended by the Bishkek date, in exam order,
-- each with the refreshed date of check and source, the window only on 2026-11.
SELECT pg_temp.c3_assert(
  jsonb_array_length(:'c3_sessions'::JSONB)
      = (SELECT count(*) FROM c3_latest WHERE exam_to >= :'c3_today'::DATE)
    AND COALESCE((SELECT jsonb_agg(entry ->> 'sessionKey' ORDER BY ordinality)
      FROM jsonb_array_elements(:'c3_sessions'::JSONB) WITH ORDINALITY AS item(entry, ordinality)), '[]'::JSONB)
      = COALESCE((SELECT jsonb_agg(session_key ORDER BY exam_from) FROM c3_latest WHERE exam_to >= :'c3_today'::DATE), '[]'::JSONB)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'c3_sessions'::JSONB) entry
      WHERE entry ->> 'verifiedOn' <> '2026-10-21' OR entry ->> 'sourceUrl' <> 'https://csca.cn/home')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'c3_sessions'::JSONB) entry
      WHERE (entry ->> 'sessionKey' = '2026-11')
        <> (entry ->> 'registrationClosesAt' IS NOT NULL AND entry ->> 'registrationOpensAt' IS NOT NULL)),
  'the Student home serves the refreshed rows of the sessions that have not ended, the window only on 2026-11');
-- The last session of the calendar (27.06.2027) is listed until the Bishkek date passes it.
SELECT pg_temp.c3_assert(
  :'c3_today'::DATE > DATE '2027-06-27'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(:'c3_sessions'::JSONB) entry
      WHERE entry ->> 'sessionKey' = '2027-06' AND entry ->> 'examFrom' = '2027-06-26' AND entry ->> 'examTo' = '2027-06-27'
        AND entry ->> 'verifiedOn' = '2026-10-21'),
  'the home lists 2027-06 with the refreshed check date');

-- The newest row of a session wins: a later correction replaces the refreshed row on the home.
INSERT INTO platform_private.csca_exam_sessions (session_key, exam_from, exam_to, source_url, verified_on)
VALUES ('2027-06', '2027-06-26', '2027-06-27', 'https://csca.cn/home', '2099-01-01');
SET request.jwt.claims TO :'c3_student';
SET ROLE authenticated;
SELECT platform.learning_track_home_v1('csca-math') -> 'sessions' AS c3_corrected \gset
RESET ROLE;
SELECT pg_temp.c3_assert(
  :'c3_today'::DATE > DATE '2027-06-27'
    OR (SELECT count(*) FROM jsonb_array_elements(:'c3_corrected'::JSONB) entry WHERE entry ->> 'sessionKey' = '2027-06') = 1
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'c3_corrected'::JSONB) entry
        WHERE entry ->> 'sessionKey' = '2027-06' AND entry ->> 'verifiedOn' = '2099-01-01'),
  'the newest row of a session wins and the session is listed once');

-- (iv) immutability and the refusal of a second run.
SELECT pg_temp.c3_assert(
  pg_temp.c3_error('UPDATE platform_private.csca_exam_sessions SET verified_on = verified_on') = '55000'
    AND pg_temp.c3_error('DELETE FROM platform_private.csca_exam_sessions') = '55000',
  'the refreshed rows are as immutable as the published ones');

SELECT 'CSCA_SESSIONS_REFRESH_SUITE_PASSED' AS c3_suite_marker;
ROLLBACK;
