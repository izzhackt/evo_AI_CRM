\set ON_ERROR_STOP on
-- Boundary suite for migration 327 «Скачивание договора» (docs/PLAN_CHANGES.md «2026-11-02 · Куратор Малайзии:
-- договор, возврат документа, этап подачи»). Runs on the real chain right after 327 inside one transaction that is
-- rolled back. No Storage object, Auth invitation, real person, provider or production action.
--
-- Proves:
--  1. the defect the function replaces: service_role has no SELECT on platform.case_contract_files;
--  2. posture: definer, empty search_path, authenticated only;
--  3. the case's own Sales rep gets the object name of the current and of an older version, with the four keys the
--     route decodes;
--  4. refused 42501: an unknown file, a file of another case the actor can read, another organization's Admin, a staff
--     member without the case, and a Student of the case; anon and service_role cannot execute it.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A327_CASE_CONTRACT_DOWNLOAD_SUITE_START

CREATE FUNCTION pg_temp.a327_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a327_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A327: %', message; END IF;
END
$$;
-- The JSONB result of the target function as a role with the given claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a327_target(p_role TEXT, p_claims TEXT, p_case INTEGER, p_file INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
  v_sql TEXT := format('SELECT platform.staff_case_contract_file_download_target_v1(%L, %L)', pg_temp.a327_id(p_case), pg_temp.a327_id(p_file));
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE v_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a327_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a327_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a327_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 the Sales rep of cases 501 and 502 (invited staff, coarse role NULL); 2 another rep without a case;
-- 3 an Admin of organization 2; 4 the Student of case 501.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a327_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a327_actors VALUES (1, 1, NULL, FALSE), (2, 1, NULL, FALSE), (3, 2, 'admin', TRUE), (4, 1, 'student', FALSE);
INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.a327_id(1), 'A327 Fictional organization'), (pg_temp.a327_id(2), 'A327 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a327_id(100 + n), 'a327-' || n || '@example.invalid', '{}'::JSONB FROM a327_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a327_id(200 + n), pg_temp.a327_id(100 + n), 'A327 Actor ' || n, 'active', 1 FROM a327_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a327_id(300 + a.n), pg_temp.a327_id(a.org), pg_temp.a327_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END, a.sysadmin
  FROM a327_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a327_id(401), pg_temp.a327_id(1), 'student_case', pg_temp.a327_id(501), 1),
  (pg_temp.a327_id(402), pg_temp.a327_id(1), 'student_case', pg_temp.a327_id(502), 1);
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id, source_key,
  student_display_name, operational_stage, state, current_scope_id, current_scope_version) VALUES
  (pg_temp.a327_id(501), pg_temp.a327_id(1), pg_temp.a327_id(304), pg_temp.a327_id(301), 'synthetic:a327:case1', 'A327 Student One', 'intake_review', 'pending', pg_temp.a327_id(401), 1),
  (pg_temp.a327_id(502), pg_temp.a327_id(1), NULL, pg_temp.a327_id(301), 'synthetic:a327:case2', 'A327 Student Two', 'intake_review', 'pending', pg_temp.a327_id(402), 1);
INSERT INTO platform.case_contract_files(id, organization_id, student_case_id, original_filename, declared_mime_type, byte_size, sha256_hex,
  storage_object_name, uploaded_by_membership_id, superseded_at) VALUES
  (pg_temp.a327_id(601), pg_temp.a327_id(1), pg_temp.a327_id(501), 'old.pdf', 'application/pdf', 2048, repeat('a', 64),
    'case-contracts/' || pg_temp.a327_id(1) || '/' || pg_temp.a327_id(501) || '/' || pg_temp.a327_id(701), pg_temp.a327_id(301), clock_timestamp()),
  (pg_temp.a327_id(602), pg_temp.a327_id(1), pg_temp.a327_id(501), 'current.pdf', 'application/pdf', 2048, repeat('b', 64),
    'case-contracts/' || pg_temp.a327_id(1) || '/' || pg_temp.a327_id(501) || '/' || pg_temp.a327_id(702), pg_temp.a327_id(301), NULL),
  (pg_temp.a327_id(603), pg_temp.a327_id(1), pg_temp.a327_id(502), 'other.pdf', 'application/pdf', 2048, repeat('c', 64),
    'case-contracts/' || pg_temp.a327_id(1) || '/' || pg_temp.a327_id(502) || '/' || pg_temp.a327_id(703), pg_temp.a327_id(301), NULL);

SELECT pg_temp.a327_claims(1) AS a327_rep \gset
SELECT pg_temp.a327_claims(2) AS a327_stranger \gset
SELECT pg_temp.a327_claims(3) AS a327_foreign \gset
SELECT pg_temp.a327_claims(4) AS a327_student \gset

-- ---------------------------------------------------------------------------
-- 1. The defect and 2. the posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a327_assert(NOT has_table_privilege('service_role', 'platform.case_contract_files', 'SELECT'),
  'service_role has no direct read of the contract table: the reason this function exists');
SELECT pg_temp.a327_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform.staff_case_contract_file_download_target_v1(uuid,uuid)'::REGPROCEDURE),
  'posture: definer, empty search_path, authenticated only');

-- ---------------------------------------------------------------------------
-- 3. The rep of the case.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a327_target('authenticated', :'a327_rep', 501, 602) AS a327_current \gset
SELECT pg_temp.a327_assert(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a327_current'::JSONB) k) = ARRAY['case_contract_file_id', 'organization_id', 'storage_object_name', 'student_case_id']
  AND (:'a327_current'::JSONB) ->> 'storage_object_name' = 'case-contracts/' || pg_temp.a327_id(1) || '/' || pg_temp.a327_id(501) || '/' || pg_temp.a327_id(702)
  AND (:'a327_current'::JSONB) ->> 'case_contract_file_id' = pg_temp.a327_id(602)::TEXT,
  'the rep gets the current contract with the four keys the route decodes: ' || :'a327_current');
SELECT pg_temp.a327_assert(
  pg_temp.a327_target('authenticated', :'a327_rep', 501, 601) ->> 'storage_object_name' LIKE '%' || pg_temp.a327_id(701)::TEXT,
  'an older version stays downloadable');

-- ---------------------------------------------------------------------------
-- 4. Refusals.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a327_assert(pg_temp.a327_target('authenticated', :'a327_rep', 501, 999) ->> 'error' = '42501', 'an unknown file is refused');
SELECT pg_temp.a327_assert(pg_temp.a327_target('authenticated', :'a327_rep', 501, 603) ->> 'error' = '42501', 'a file of another case is refused under this case');
SELECT pg_temp.a327_assert(pg_temp.a327_target('authenticated', :'a327_stranger', 501, 602) ->> 'error' = '42501', 'a staff member without the case is refused');
SELECT pg_temp.a327_assert(pg_temp.a327_target('authenticated', :'a327_foreign', 501, 602) ->> 'error' = '42501', 'an Admin of another organization is refused');
SELECT pg_temp.a327_assert(pg_temp.a327_target('authenticated', :'a327_student', 501, 602) ->> 'error' = '42501', 'the Student of the case is refused: this is a staff route');
SELECT pg_temp.a327_assert(pg_temp.a327_target('anon', '{"role":"anon"}', 501, 602) ->> 'error' = '42501', 'anon cannot execute it');
SELECT pg_temp.a327_assert(pg_temp.a327_target('service_role', '{"role":"service_role"}', 501, 602) ->> 'error' = '42501', 'service_role cannot execute it');

\echo A327_CASE_CONTRACT_DOWNLOAD_SUITE_PASSED
ROLLBACK;
