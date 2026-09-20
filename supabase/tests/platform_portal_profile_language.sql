\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 196 (PORT-5a «Профиль портала:
-- язык и запрос удаления аккаунта»). Runs at the 196 checkpoint against the
-- FULL current schema (the 185/192-195 convention). Fixtures are synthetic
-- actors with hook-generated live claims; case snapshots are replica-mode
-- (the p135/p192 convention); every row rolls back at the end.
--
-- Boundary claims proven here:
--   (i)    language get/set touch ONLY the actor's own profile: a second
--          Student stays on the default while the first switches to 'ky';
--          staff admin/sales/curator are denied BOTH read and write;
--   (ii)   existing accounts are unaffected: a pre-196 profile row reads
--          portal_language='ru' from the column DEFAULT, and the update goes
--          through the canonical 053 revision guard (revision+1, no other
--          fact rewritten);
--   (iii)  a legacy Student whose case has NO profile row (the 193-recorded
--          shape) still works: get falls back to 'ru', set creates the
--          minimal D2a-style row with no invented facts;
--   (iv)   the deletion request is idempotent by request_id, at most one
--          OPEN request exists per member (a replay with a NEW request_id
--          returns the original open receipt, no second row), staff-admin
--          reads the queue, sales/curator/students are denied it;
--   (v)    anon and service_role are denied all four RPCs and the private
--          requests table is unreadable directly;
--   (vi)   the Student guard is case-state-independent: the pending-case
--          Student and the active-case Student both pass.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p196_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19600000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p196_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 196 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p196_outcome(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.p196_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p196_id(INTEGER),
  pg_temp.p196_assert(BOOLEAN, TEXT),
  pg_temp.p196_outcome(TEXT),
  pg_temp.p196_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P196_PORTAL_PROFILE_SUITE_START' AS p196_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: one organization; admin/sales/curator staff; Student A with a
-- portal-activated PENDING case AND a pre-existing profile row (the 180
-- анкета shape), Student B with an ACTIVE case and NO profile row (the
-- legacy cabinet shape 193 records).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p196_id(1), 'Migration 196 synthetic organization');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p196_id(101), 'p196-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p196_id(102), 'p196-sales@example.invalid', '{}'::JSONB),
  (pg_temp.p196_id(103), 'p196-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p196_id(104), 'p196-student-pending@example.invalid', '{}'::JSONB),
  (pg_temp.p196_id(105), 'p196-student-active@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p196_id(201), pg_temp.p196_id(101), 'P196 Admin', 'active', 1),
  (pg_temp.p196_id(202), pg_temp.p196_id(102), 'P196 Sales', 'active', 1),
  (pg_temp.p196_id(203), pg_temp.p196_id(103), 'P196 Curator', 'active', 1),
  (pg_temp.p196_id(204), pg_temp.p196_id(104), 'P196 Pending Student', 'active', 1),
  (pg_temp.p196_id(205), pg_temp.p196_id(105), 'P196 Active Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
)
SELECT
  pg_temp.p196_id(300 + actor.n), pg_temp.p196_id(1), pg_temp.p196_id(200 + actor.n),
  'active', actor.role::platform.business_role,
  (
    SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1
  ),
  actor.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student'), (5, 'student'))
  AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p196_id(2), pg_temp.p196_id(1), 'organization', pg_temp.p196_id(1), 1),
  (pg_temp.p196_id(401), pg_temp.p196_id(1), 'student_case', pg_temp.p196_id(501), 1),
  (pg_temp.p196_id(402), pg_temp.p196_id(1), 'student_case', pg_temp.p196_id(502), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p196_id(1), pg_temp.p196_id(300 + n), pg_temp.p196_id(2), 1,
  1, TRUE, 'system', 'P196 synthetic organization scope', pg_temp.p196_id(600 + n)
FROM generate_series(1, 5) AS n;

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
VALUES
  (pg_temp.p196_id(1), pg_temp.p196_id(304), pg_temp.p196_id(401), 1,
   1, TRUE, 'system', 'P196 pending student case scope', pg_temp.p196_id(611)),
  (pg_temp.p196_id(1), pg_temp.p196_id(305), pg_temp.p196_id(402), 1,
   1, TRUE, 'system', 'P196 active student case scope', pg_temp.p196_id(612)),
  (pg_temp.p196_id(1), pg_temp.p196_id(303), pg_temp.p196_id(402), 1,
   1, TRUE, 'system', 'P196 curator handoff case scope', pg_temp.p196_id(613));

-- Case snapshots (replica mode, the p192 fixture shapes).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p196_id(501), pg_temp.p196_id(1), pg_temp.p196_id(304), pg_temp.p196_id(302),
  'synthetic:p196:approved-cabinet', 'P196 Pending Student', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p196_id(401), 1
);
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, contract_confirmation_ref,
  contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p196_id(502), pg_temp.p196_id(1), pg_temp.p196_id(305), pg_temp.p196_id(302),
  pg_temp.p196_id(303), 'synthetic:p196:assisted', 'synthetic:p196:contract',
  clock_timestamp(), 'P196 Active Student', 'China', 'Bachelor',
  'Engineering', '2027', 'approved', 'documents', 'active',
  clock_timestamp(), clock_timestamp(), pg_temp.p196_id(402), 1
);
SET LOCAL session_replication_role = origin;

-- Student A's PRE-196 profile row (the 180 анкета shape): inserted without
-- naming portal_language at all -- the column DEFAULT is exactly what an
-- existing production row gets.
INSERT INTO platform.student_profiles (
  id, organization_id, student_case_id, revision, preferred_display_name,
  citizenship_country, consent_status, consent_evidence_ref,
  created_by_membership_id, updated_by_membership_id
) VALUES (
  pg_temp.p196_id(701), pg_temp.p196_id(1), pg_temp.p196_id(501), 1,
  'P196 Pending Student', 'Kyrgyzstan', 'granted',
  'synthetic:p196:consent', pg_temp.p196_id(301), pg_temp.p196_id(301)
);

-- Live JWT claims via the CURRENT production hook (the p192 convention).
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p196_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p196_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p196_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p196_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p196_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p196_sales_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p196_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p196_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p196_curator_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p196_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p196_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p196_student_a_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p196_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p196_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p196_student_b_claims
\gset

-- ===========================================================================
-- (ii)+(vi) Student A (pending case, pre-196 profile row): the default is an
-- untouched 'ru', the set goes through the 053 revision guard.
-- ===========================================================================
SET request.jwt.claims TO :'p196_student_a_claims';
SET ROLE authenticated;

SELECT platform.get_own_portal_profile_v1()::TEXT AS p196_profile_a
\gset
SELECT pg_temp.p196_assert(
  (:'p196_profile_a'::JSONB ->> 'displayName') = 'P196 Pending Student'
    AND (:'p196_profile_a'::JSONB ->> 'email') = 'p196-student-pending@example.invalid'
    AND (:'p196_profile_a'::JSONB ->> 'portalLanguage') = 'ru'
    AND (:'p196_profile_a'::JSONB ->> 'caseState') = 'pending'
    AND (:'p196_profile_a'::JSONB -> 'deletionRequestedAt') = 'null'::JSONB,
  'existing account did not read the untouched default profile'
);

SELECT pg_temp.p196_assert(
  platform.set_own_portal_language_v1('ky') = jsonb_build_object('portalLanguage', 'ky'),
  'student A could not persist the Kyrgyz portal language'
);
SELECT pg_temp.p196_assert(
  (platform.get_own_portal_profile_v1() ->> 'portalLanguage') = 'ky',
  'student A does not read back the persisted language'
);

SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome($sql$SELECT platform.set_own_portal_language_v1('en')$sql$)
    = '22023 Invalid portal language',
  'set accepted a language outside ru/ky'
);
SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.set_own_portal_language_v1(NULL)')
    = '22023 Invalid portal language',
  'set accepted a NULL language'
);

RESET ROLE;

-- Owner-side: the update went through the canonical revision guard and
-- rewrote nothing but the language.
SELECT pg_temp.p196_assert(
  (
    SELECT count(*) = 1 FROM platform.student_profiles sp
    WHERE sp.id = pg_temp.p196_id(701)
      AND sp.revision = 2 AND sp.portal_language = 'ky'
      AND sp.preferred_display_name = 'P196 Pending Student'
      AND sp.citizenship_country = 'Kyrgyzstan'
      AND sp.consent_status = 'granted'
      AND sp.updated_by_membership_id = pg_temp.p196_id(304)
  ),
  'language update bypassed the 053 revision guard or rewrote profile facts'
);

-- ===========================================================================
-- (i)+(iii)+(vi) Student B (active case, NO profile row): isolated from A,
-- reads the honest default, and set creates the minimal D2a row.
-- ===========================================================================
SET request.jwt.claims TO :'p196_student_b_claims';
SET ROLE authenticated;

SELECT platform.get_own_portal_profile_v1()::TEXT AS p196_profile_b
\gset
SELECT pg_temp.p196_assert(
  (:'p196_profile_b'::JSONB ->> 'portalLanguage') = 'ru'
    AND (:'p196_profile_b'::JSONB ->> 'caseState') = 'active'
    AND (:'p196_profile_b'::JSONB ->> 'displayName') = 'P196 Active Student',
  'profile-less legacy student did not read the honest ru default'
);

SELECT pg_temp.p196_assert(
  platform.set_own_portal_language_v1('ky') = jsonb_build_object('portalLanguage', 'ky'),
  'profile-less legacy student could not persist a language'
);
SELECT pg_temp.p196_assert(
  (platform.get_own_portal_profile_v1() ->> 'portalLanguage') = 'ky',
  'legacy student does not read back the persisted language'
);

RESET ROLE;

-- Owner-side: the created row is minimal -- no invented facts (D2a/159).
SELECT pg_temp.p196_assert(
  (
    SELECT count(*) = 1 FROM platform.student_profiles sp
    WHERE sp.organization_id = pg_temp.p196_id(1)
      AND sp.student_case_id = pg_temp.p196_id(502)
      AND sp.revision = 1 AND sp.portal_language = 'ky'
      AND sp.consent_status = 'not_recorded' AND sp.consent_evidence_ref IS NULL
      AND sp.preferred_display_name IS NULL
      AND sp.citizenship_country IS NULL
      AND sp.created_by_membership_id = pg_temp.p196_id(305)
  ),
  'legacy set did not create the minimal fact-free profile row'
);

-- A's choice stayed A's: no cross-student leak.
SET request.jwt.claims TO :'p196_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p196_assert(
  (platform.get_own_portal_profile_v1() ->> 'portalLanguage') = 'ky'
    AND (platform.get_own_portal_profile_v1() ->> 'caseState') = 'pending',
  'student A profile drifted after student B wrote their own'
);

-- ===========================================================================
-- (iv) Deletion request: idempotent by request_id; one OPEN per member; a
-- NEW request_id during an open request returns the ORIGINAL receipt.
-- ===========================================================================
SELECT platform.request_account_deletion_v1(pg_temp.p196_id(801))::TEXT AS p196_deletion_1
\gset
SELECT pg_temp.p196_assert(
  (:'p196_deletion_1'::JSONB ->> 'status') = 'requested'
    AND (:'p196_deletion_1'::JSONB ->> 'requestId')::UUID = pg_temp.p196_id(801)
    AND (:'p196_deletion_1'::JSONB ->> 'requestedAt') IS NOT NULL,
  'student A could not open a deletion request'
);
SELECT pg_temp.p196_assert(
  platform.request_account_deletion_v1(pg_temp.p196_id(801)) = :'p196_deletion_1'::JSONB,
  'deletion request replay with the same request_id changed the receipt'
);
SELECT pg_temp.p196_assert(
  platform.request_account_deletion_v1(pg_temp.p196_id(802)) = :'p196_deletion_1'::JSONB,
  'a second open deletion request was created for the same member'
);
SELECT pg_temp.p196_assert(
  (platform.get_own_portal_profile_v1() ->> 'deletionRequestedAt') IS NOT NULL,
  'own profile does not surface the open deletion request'
);
SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.request_account_deletion_v1(NULL)')
    = '22023 Invalid deletion request',
  'deletion request accepted a NULL request id'
);
SELECT pg_temp.p196_assert(
  pg_temp.p196_error('SELECT * FROM platform_private.account_deletion_requests') = '42501',
  'authenticated read the private deletion-requests table directly'
);
RESET ROLE;

SELECT pg_temp.p196_assert(
  (
    SELECT count(*) = 1 FROM platform_private.account_deletion_requests r
    WHERE r.organization_id = pg_temp.p196_id(1)
      AND r.membership_id = pg_temp.p196_id(304)
  ),
  'the ledger holds more than one row for student A after replays'
);

-- Student B opens their own request (isolation of the ledger per member).
SET request.jwt.claims TO :'p196_student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p196_assert(
  (platform.request_account_deletion_v1(pg_temp.p196_id(803)) ->> 'requestId')::UUID
    = pg_temp.p196_id(803),
  'student B could not open their own deletion request'
);
-- Students never read the staff queue.
SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.staff_account_deletion_requests_v1()')
    = '42501 Deletion requests unavailable',
  'a student read the staff deletion-request queue'
);
RESET ROLE;

-- ===========================================================================
-- (i)+(iv) Staff: admin reads the queue with case binding; admin/sales/
-- curator are denied every Student-side RPC; sales/curator are denied the
-- queue too.
-- ===========================================================================
SET request.jwt.claims TO :'p196_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_account_deletion_requests_v1()::TEXT AS p196_staff_queue
\gset
SELECT pg_temp.p196_assert(
  jsonb_array_length(:'p196_staff_queue'::JSONB) = 2,
  'staff admin does not see both deletion requests'
);
SELECT pg_temp.p196_assert(
  (
    SELECT entry ->> 'displayName' = 'P196 Pending Student'
      AND entry ->> 'status' = 'requested'
      AND (entry ->> 'studentCaseId')::UUID = pg_temp.p196_id(501)
      AND (entry ->> 'membershipId')::UUID = pg_temp.p196_id(304)
    FROM jsonb_array_elements(:'p196_staff_queue'::JSONB) AS entry
    WHERE (entry ->> 'requestId')::UUID = pg_temp.p196_id(801)
  ),
  'the staff queue entry lost its member, case or status binding'
);

SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.get_own_portal_profile_v1()')
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome($sql$SELECT platform.set_own_portal_language_v1('ky')$sql$)
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome(format(
    'SELECT platform.request_account_deletion_v1(%L)', pg_temp.p196_id(804)
  )) = '42501 Profile unavailable',
  'staff admin was not denied the Student-side profile RPCs'
);
RESET ROLE;

SET request.jwt.claims TO :'p196_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.staff_account_deletion_requests_v1()')
    = '42501 Deletion requests unavailable'
  AND pg_temp.p196_outcome('SELECT platform.get_own_portal_profile_v1()')
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome($sql$SELECT platform.set_own_portal_language_v1('ky')$sql$)
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome(format(
    'SELECT platform.request_account_deletion_v1(%L)', pg_temp.p196_id(805)
  )) = '42501 Profile unavailable',
  'sales was not denied the profile and deletion RPCs'
);
RESET ROLE;

SET request.jwt.claims TO :'p196_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p196_assert(
  pg_temp.p196_outcome('SELECT platform.staff_account_deletion_requests_v1()')
    = '42501 Deletion requests unavailable'
  AND pg_temp.p196_outcome('SELECT platform.get_own_portal_profile_v1()')
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome($sql$SELECT platform.set_own_portal_language_v1('ky')$sql$)
    = '42501 Profile unavailable'
  AND pg_temp.p196_outcome(format(
    'SELECT platform.request_account_deletion_v1(%L)', pg_temp.p196_id(806)
  )) = '42501 Profile unavailable',
  'curator was not denied the profile and deletion RPCs'
);
RESET ROLE;

-- ===========================================================================
-- (v) anon and service_role are denied all four RPCs.
-- ===========================================================================
SET ROLE anon;
SELECT pg_temp.p196_assert(
  pg_temp.p196_error('SELECT platform.get_own_portal_profile_v1()') = '42501'
  AND pg_temp.p196_error($sql$SELECT platform.set_own_portal_language_v1('ky')$sql$) = '42501'
  AND pg_temp.p196_error(format(
    'SELECT platform.request_account_deletion_v1(%L)', pg_temp.p196_id(807)
  )) = '42501'
  AND pg_temp.p196_error('SELECT platform.staff_account_deletion_requests_v1()') = '42501',
  'anon was not denied all four profile RPCs'
);
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.p196_assert(
  pg_temp.p196_error('SELECT platform.get_own_portal_profile_v1()') = '42501'
  AND pg_temp.p196_error($sql$SELECT platform.set_own_portal_language_v1('ky')$sql$) = '42501'
  AND pg_temp.p196_error(format(
    'SELECT platform.request_account_deletion_v1(%L)', pg_temp.p196_id(808)
  )) = '42501'
  AND pg_temp.p196_error('SELECT platform.staff_account_deletion_requests_v1()') = '42501',
  'service_role was not denied all four profile RPCs'
);
RESET ROLE;

SELECT 'P196_PORTAL_PROFILE_SUITE_PASSED' AS p196_suite_marker;

ROLLBACK;
