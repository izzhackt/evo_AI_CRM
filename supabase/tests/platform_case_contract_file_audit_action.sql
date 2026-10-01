\set ON_ERROR_STOP on
-- Boundary suite for migration 256 («Договор и оплата»: файл договора,
-- PLAN_CHANGES 01.10.2026). 189's platform.record_case_contract_file_metadata
-- audits 'case.contract_file.upload', which 041's audit_events_action_check
-- (dot-separated [a-z][a-z0-9]* segments, no underscore) rejects, so every
-- real contract upload rolled back. 256 renames the action to
-- 'case.contract.file.upload', exactly as 230 did for payment receipts.
--
-- The runner invokes this file twice on the real migration chain, replaying
-- the contract upload route (platform-case-agreement-storage-route-handlers.ts):
-- the case's own Sales rep (coarse role NULL, like invited production staff)
-- reads the block with can_write = true, then the service role records the
-- file the route has just stored.
--  * With -v p256_pre=1, immediately BEFORE 256: the canonical 189 body is
--    in place and the service-role call fails with 23514 on
--    audit_events_action_check, leaving neither a contract row nor an audit
--    event, and the block still shows no contract (the defect, pinned).
--  * Without it, immediately AFTER 256: the same call returns the route's
--    five-key result with exactly one current contract row and one
--    'case.contract.file.upload' / 'case_contract_file' system audit event;
--    a replay of the same request_id returns the same result without a second
--    write; a request_id reused for another file is refused 22023; a second
--    upload supersedes the first (exactly one current) and the block shows
--    current plus history; a direct call by an authenticated system Admin is
--    still refused 42501; the function keeps its owner, grants, SECURITY
--    DEFINER, search_path and volatility, and no underscore action remains.
-- Isolated synthetic SQL fixtures only, rolled back: no Storage object, Auth
-- invitation, real person, provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.n256_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n256_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N256: %', message; END IF;
END
$$;
-- SQLSTATE, violated constraint (or '-') and message of a failing statement,
-- or 'ok'. The handler's subtransaction rolls the failed call back, as
-- PostgREST does for the route's RPC request.
CREATE FUNCTION pg_temp.n256_error(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  violated TEXT;
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
  RETURN SQLSTATE || ':' || COALESCE(NULLIF(violated, ''), '-') || ':' || SQLERRM;
END
$$;
-- The route's finalize call for one stored file: request n, sha256 of p_hex.
CREATE FUNCTION pg_temp.n256_upload(p_request INTEGER, p_hex TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.record_case_contract_file_metadata(
    pg_temp.n256_id(1), pg_temp.n256_id(501), pg_temp.n256_id(301),
    'n256-contract-' || p_request || '.pdf', 'application/pdf', 2048, repeat(p_hex, 64),
    'case-contracts/' || pg_temp.n256_id(1) || '/' || pg_temp.n256_id(501) || '/' || pg_temp.n256_id(p_request),
    pg_temp.n256_id(p_request)
  )
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n256_id(INTEGER), pg_temp.n256_assert(BOOLEAN, TEXT),
  pg_temp.n256_error(TEXT), pg_temp.n256_upload(INTEGER, TEXT)
  TO authenticated, service_role;

SELECT 'N256_CASE_CONTRACT_FILE_AUDIT_ACTION_SUITE_START' AS n256_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: 1 the case's own Sales rep, invited staff with coarse role NULL
-- (the uploader); 2 the system Admin. Case 501 is pending with rep 1
-- responsible: 189's resource-scoped door gives rep 1 can_write on it.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n256_id(1), 'N256 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (pg_temp.n256_id(101), 'n256-sales@example.invalid', '{}'::JSONB),
  (pg_temp.n256_id(102), 'n256-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.n256_id(201), pg_temp.n256_id(101), 'N256 Sales rep', 'active', 1),
  (pg_temp.n256_id(202), pg_temp.n256_id(102), 'N256 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
) VALUES
  (pg_temp.n256_id(301), pg_temp.n256_id(1), pg_temp.n256_id(201), 'active', NULL, NULL, FALSE),
  (pg_temp.n256_id(302), pg_temp.n256_id(1), pg_temp.n256_id(202), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions
      WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n256_id(401), pg_temp.n256_id(1), 'student_case', pg_temp.n256_id(501), 1);
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, source_key, student_display_name,
  operational_stage, state, current_scope_id, current_scope_version
) VALUES (
  pg_temp.n256_id(501), pg_temp.n256_id(1), pg_temp.n256_id(301), 'synthetic:n256:case',
  'N256 Student Case', 'intake_review', 'pending', pg_temp.n256_id(401), 1
);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n256_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n256_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS n256_sales_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n256_id(102),
  'claims', jsonb_build_object('sub', pg_temp.n256_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS n256_admin_claims \gset
SELECT jsonb_build_object('role', 'service_role')::TEXT AS n256_service_claims \gset

-- The route's authorization step: the rep reads the block, may write, and
-- no contract is on file yet.
SET request.jwt.claims TO :'n256_sales_claims';
SET ROLE authenticated;
SELECT platform.staff_case_agreement_v1(pg_temp.n256_id(501)) AS n256_block_before \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(
  (:'n256_block_before'::JSONB ->> 'can_write')::BOOLEAN IS TRUE
    AND :'n256_block_before'::JSONB -> 'contract_current' = 'null'::JSONB,
  'the case''s own Sales rep did not get a writable block without a contract');

\if :{?p256_pre}

-- ---------------------------------------------------------------------------
-- Before 256: the canonical 189 body 256 expects, and the defect itself.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n256_assert(
  md5(p.prosrc) = 'b91814be27c0cd4e474a2e65f6cb60eb',
  'the contract-file metadata body before 256 is not the canonical 189 body')
FROM pg_proc AS p
WHERE p.oid = 'platform.record_case_contract_file_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)'::regprocedure;

SET request.jwt.claims TO :'n256_service_claims';
SET ROLE service_role;
SELECT pg_temp.n256_error('SELECT pg_temp.n256_upload(601, ''a'')') AS n256_pre_error \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(
  :'n256_pre_error' LIKE '23514:audit_events_action_check:%',
  'before 256 the service-role contract upload did not fail on audit_events_action_check: '
    || :'n256_pre_error');
SELECT :'n256_pre_error' AS n256_pre_256_contract_upload;
SELECT pg_temp.n256_assert(
  NOT EXISTS (SELECT 1 FROM platform.case_contract_files WHERE student_case_id = pg_temp.n256_id(501))
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.n256_id(601)),
  'the failed contract upload left a durable row behind');

SET request.jwt.claims TO :'n256_sales_claims';
SET ROLE authenticated;
SELECT platform.staff_case_agreement_v1(pg_temp.n256_id(501)) -> 'contract_current' AS n256_pre_current \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(:'n256_pre_current'::JSONB = 'null'::JSONB,
  'the block shows a contract although the upload failed');

\else

-- ---------------------------------------------------------------------------
-- After 256: the same route call succeeds and audits the dotted action.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'n256_service_claims';
SET ROLE service_role;
SELECT pg_temp.n256_upload(601, 'a') AS n256_first \gset
SELECT pg_temp.n256_upload(601, 'a') AS n256_first_replay \gset
SELECT pg_temp.n256_error('SELECT pg_temp.n256_upload(601, ''b'')') AS n256_reused_error \gset
RESET ROLE;
RESET request.jwt.claims;

SELECT (:'n256_first'::JSONB ->> 'case_contract_file_id') AS n256_first_file_id \gset
SELECT pg_temp.n256_assert(
  :'n256_first'::JSONB = jsonb_build_object(
    'organization_id', pg_temp.n256_id(1),
    'student_case_id', pg_temp.n256_id(501),
    'case_contract_file_id', :'n256_first_file_id'::UUID,
    'original_filename', 'n256-contract-601.pdf',
    'sha256_hex', repeat('a', 64)),
  'the contract upload did not return the route''s five-key result: ' || :'n256_first');
SELECT pg_temp.n256_assert(
  (SELECT count(*) FROM platform.case_contract_files AS f
    WHERE f.student_case_id = pg_temp.n256_id(501)) = 1
  AND EXISTS (
    SELECT 1 FROM platform.case_contract_files AS f
    WHERE f.id = :'n256_first_file_id'::UUID
      AND f.organization_id = pg_temp.n256_id(1)
      AND f.student_case_id = pg_temp.n256_id(501)
      AND f.original_filename = 'n256-contract-601.pdf'
      AND f.declared_mime_type = 'application/pdf'
      AND f.byte_size = 2048
      AND f.sha256_hex = repeat('a', 64)
      AND f.storage_object_name = 'case-contracts/' || pg_temp.n256_id(1) || '/'
        || pg_temp.n256_id(501) || '/' || pg_temp.n256_id(601)
      AND f.uploaded_by_membership_id = pg_temp.n256_id(301)
      AND f.superseded_at IS NULL),
  'the contract upload did not persist exactly one current file row');
SELECT pg_temp.n256_assert(
  (SELECT count(*) FROM platform.audit_events AS e WHERE e.request_id = pg_temp.n256_id(601)) = 1
  AND EXISTS (
    SELECT 1 FROM platform.audit_events AS e
    WHERE e.request_id = pg_temp.n256_id(601)
      AND e.organization_id = pg_temp.n256_id(1)
      AND e.action = 'case.contract.file.upload'
      AND e.resource_type = 'case_contract_file'
      AND e.resource_id = :'n256_first_file_id'::UUID
      AND e.actor_kind = 'system'
      AND e.actor_profile_id IS NULL
      AND e.actor_membership_id IS NULL
      AND e.actor_principal = 'service_role:document_ingest'
      AND e.before_state IS NULL
      AND e.after_state = :'n256_first'::JSONB
      AND e.reason = 'Contract file uploaded'),
  'the contract upload did not write exactly one dotted-action system audit event');
SELECT pg_temp.n256_assert(
  :'n256_first_replay'::JSONB = :'n256_first'::JSONB
    AND (SELECT count(*) FROM platform.case_contract_files
      WHERE student_case_id = pg_temp.n256_id(501)) = 1
    AND (SELECT count(*) FROM platform.audit_events
      WHERE request_id = pg_temp.n256_id(601)) = 1,
  'replaying the request_id did not return the same result without a second write');
SELECT pg_temp.n256_assert(
  :'n256_reused_error' LIKE '22023:-:%already used for another mutation%',
  'a request_id reused for another file was not refused 22023: ' || :'n256_reused_error');

-- A newer contract supersedes the current one; the block shows both.
SET request.jwt.claims TO :'n256_service_claims';
SET ROLE service_role;
SELECT pg_temp.n256_upload(602, 'c') ->> 'case_contract_file_id' AS n256_second_file_id \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(
  (SELECT count(*) FROM platform.case_contract_files
    WHERE student_case_id = pg_temp.n256_id(501) AND superseded_at IS NULL) = 1
  AND (SELECT superseded_at IS NULL FROM platform.case_contract_files
    WHERE id = :'n256_second_file_id'::UUID)
  AND (SELECT superseded_at IS NOT NULL FROM platform.case_contract_files
    WHERE id = :'n256_first_file_id'::UUID)
  AND (SELECT count(*) FROM platform.audit_events
    WHERE action = 'case.contract.file.upload'
      AND resource_id IN (:'n256_first_file_id'::UUID, :'n256_second_file_id'::UUID)) = 2,
  'a second contract did not supersede the first with its own audit event');

SET request.jwt.claims TO :'n256_sales_claims';
SET ROLE authenticated;
SELECT platform.staff_case_agreement_v1(pg_temp.n256_id(501)) AS n256_block_after \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(
  :'n256_block_after'::JSONB -> 'contract_current' ->> 'case_contract_file_id' = :'n256_second_file_id'
    AND :'n256_block_after'::JSONB -> 'contract_current' ->> 'uploaded_by_display_name' = 'N256 Sales rep'
    AND jsonb_array_length(:'n256_block_after'::JSONB -> 'contract_history') = 1
    AND :'n256_block_after'::JSONB -> 'contract_history' -> 0 ->> 'case_contract_file_id' = :'n256_first_file_id',
  'the block does not show the uploaded contract and its history');

-- Still service-role only: an authenticated system Admin is refused.
SET request.jwt.claims TO :'n256_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.n256_error('SELECT pg_temp.n256_upload(603, ''d'')') AS n256_admin_error \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n256_assert(
  :'n256_admin_error' LIKE '42501:%'
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.n256_id(603)),
  'an authenticated system Admin was not refused 42501: ' || :'n256_admin_error');

-- Only the two action literals changed.
SELECT pg_temp.n256_assert(
  md5(p.prosrc) = '615067e8d39ab5341fa052157ca6e99f'
    AND strpos(p.prosrc, 'case.contract_file.upload') = 0
    AND (length(p.prosrc) - length(replace(p.prosrc, '''case.contract.file.upload''', '')))
      / length('''case.contract.file.upload''') = 2
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND p.prosecdef
    AND p.provolatile = 'v'
    AND p.proconfig = ARRAY['search_path=""']
    AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) AS acl WHERE acl.grantee = 0)
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'),
  'the repaired contract-file metadata function changed beyond its two action literals')
FROM pg_proc AS p
WHERE p.oid = 'platform.record_case_contract_file_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)'::regprocedure;

\endif

SELECT 'N256_CASE_CONTRACT_FILE_AUDIT_ACTION_SUITE_END' AS n256_suite_marker;

ROLLBACK;
