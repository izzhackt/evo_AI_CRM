\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 197 (PORT-5b «Запрос
-- консультации»). Runs at the 197 checkpoint against the FULL current schema
-- (the 185/192-196 convention). Fixtures are synthetic actors with
-- hook-generated live claims; case and catalogue snapshots are replica-mode
-- (the p135/p192/p195 convention); the Sales staff grant goes through the
-- REAL staff_role_command/impact/publish/assignments_save sequence (the
-- p185/p188 shape) with claims rebuilt after the grant; every row rolls back
-- at the end.
--
-- Boundary claims proven here:
--   (i)    a Student creates and lists ONLY their own requests; a second
--          Student of the same organization is isolated; the guard is
--          case-independent (Student A has a pending case, Student B none);
--   (ii)   idempotency: an exact request_id replay returns the SAME receipt
--          (in any status); ONE OPEN request per member — a second create
--          with a NEW request_id returns the SAME open receipt and the
--          ledger keeps exactly one row; after handled a new request opens;
--   (iii)  institution validation: a foreign-organization id, an
--          organization-own id with NO published publication and an unknown
--          id all fail '42501 Institution is unavailable' (the 148/195
--          style); NULL request_id, an over-500 note and a control-char
--          note fail 22023; an empty note is stored as NULL;
--   (iv)   staff guard is the REAL «Заявки» queue permission 'lead.read':
--          admin passes with NO explicit grant (the staff_has_permission
--          admin bypass — «admin included»), Sales passes ONLY after a real
--          scoped lead.read grant, curator WITHOUT the grant is denied both
--          read and handle (both directions of the real permission map);
--          students, anon and service_role are denied everywhere;
--   (v)    handle: requested→handled records who/when; a replay with
--          p_expected_status='handled' is an idempotent no-op returning the
--          same receipt; a status mismatch is PT409
--          consultation_request_conflict (the 178/186/194 convention);
--          unknown row 42501; invalid input 22023;
--   (vi)   privacy (план §6 «Тесты»/§14, the 135 pattern): Student A owns a
--          draft english36 attempt whose answers carry a marker string; the
--          staff consultation JSON never contains the marker, every staff
--          row carries EXACTLY the declared key set, and the student
--          assessment read RPC stays denied to the granted Sales actor.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p197_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19700000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p197_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 197 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p197_outcome(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.p197_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

-- Valid public catalogue content (passes valid_university_content), the p195
-- fixture shape.
CREATE FUNCTION pg_temp.p197_content(p_name TEXT, p_country TEXT, p_overview TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name', p_name,
    'country', p_country,
    'city', NULL,
    'overview', p_overview,
    'websiteUrl', 'https://university.example-p197.edu',
    'sourceUrl', 'https://university.example-p197.edu/admissions',
    'verifiedOn', '2026-09-19',
    'notes', '',
    'photoKey', NULL,
    'programs', jsonb_build_array(jsonb_build_object(
      'id', 'cs',
      'title', 'Synthetic computer science',
      'level', 'bachelor',
      'duration', NULL,
      'language', NULL,
      'summary', 'Synthetic public program',
      'sourceUrl', 'https://university.example-p197.edu/programs/cs',
      'intakes', jsonb_build_array(jsonb_build_object(
        'label', 'September intake',
        'startDate', '2027-09-01',
        'startMonth', '2027-09',
        'applicationDeadline', '2027-06-30',
        'deadlineTime', NULL,
        'timezone', NULL,
        'status', 'open',
        'note', '',
        'sourceUrl', 'https://university.example-p197.edu/admissions',
        'verifiedOn', '2026-09-19'
      ))
    ))
  )
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p197_id(INTEGER),
  pg_temp.p197_assert(BOOLEAN, TEXT),
  pg_temp.p197_outcome(TEXT),
  pg_temp.p197_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P197_PORTAL_CONSULTATION_SUITE_START' AS p197_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization A with admin/sales/curator staff and TWO Students --
-- A owns a portal-activated PENDING case, B owns NO case (the Student guard
-- is the 148/195 catalogue guard, deliberately case-independent).
-- Organization B exists only to own the foreign institution.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES
  (pg_temp.p197_id(1), 'Migration 197 synthetic organization A'),
  (pg_temp.p197_id(2), 'Migration 197 synthetic organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p197_id(101), 'p197-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p197_id(102), 'p197-sales@example.invalid', '{}'::JSONB),
  (pg_temp.p197_id(103), 'p197-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p197_id(104), 'p197-student-pending@example.invalid', '{}'::JSONB),
  (pg_temp.p197_id(105), 'p197-student-caseless@example.invalid', '{}'::JSONB),
  (pg_temp.p197_id(106), 'p197-admin-b@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p197_id(201), pg_temp.p197_id(101), 'P197 Admin', 'active', 1),
  (pg_temp.p197_id(202), pg_temp.p197_id(102), 'P197 Sales', 'active', 1),
  (pg_temp.p197_id(203), pg_temp.p197_id(103), 'P197 Curator', 'active', 1),
  (pg_temp.p197_id(204), pg_temp.p197_id(104), 'P197 Pending Student', 'active', 1),
  (pg_temp.p197_id(205), pg_temp.p197_id(105), 'P197 Caseless Student', 'active', 1),
  (pg_temp.p197_id(206), pg_temp.p197_id(106), 'P197 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
)
SELECT
  pg_temp.p197_id(300 + actor.n),
  pg_temp.p197_id(CASE WHEN actor.n = 6 THEN 2 ELSE 1 END),
  pg_temp.p197_id(200 + actor.n),
  'active', actor.role::platform.business_role,
  (
    SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1
  ),
  actor.role = 'admin'
FROM (VALUES
  (1, 'admin'), (2, 'sales'), (3, 'curator'),
  (4, 'student'), (5, 'student'), (6, 'admin')
) AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p197_id(11), pg_temp.p197_id(1), 'organization', pg_temp.p197_id(1), 1),
  (pg_temp.p197_id(12), pg_temp.p197_id(2), 'organization', pg_temp.p197_id(2), 1),
  (pg_temp.p197_id(21), pg_temp.p197_id(1), 'student_case', pg_temp.p197_id(501), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT
  pg_temp.p197_id(CASE WHEN n = 6 THEN 2 ELSE 1 END),
  pg_temp.p197_id(300 + n),
  pg_temp.p197_id(CASE WHEN n = 6 THEN 12 ELSE 11 END),
  1, 1, TRUE, 'system', 'P197 synthetic organization scope', pg_temp.p197_id(600 + n)
FROM generate_series(1, 6) AS n;

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
VALUES
  (pg_temp.p197_id(1), pg_temp.p197_id(304), pg_temp.p197_id(21), 1,
   1, TRUE, 'system', 'P197 pending student case scope', pg_temp.p197_id(611));

-- Student A's portal-activated PENDING case (approved tier): replica-mode
-- snapshot of the 180/185 shape, exactly like the p192/p195/p196 fixtures.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p197_id(501), pg_temp.p197_id(1), pg_temp.p197_id(304), pg_temp.p197_id(302),
  'synthetic:p197:approved-cabinet', 'P197 Pending Student', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p197_id(21), 1
);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Catalogue fixtures: Alpha published in organization A, a published foreign
-- university in organization B, and an organization-A institution with NO
-- publication at all (the "unpublished" refusal probe). Replica mode skips
-- only the import-batch provenance FK; every CHECK still applies.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions (
  id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES
  (pg_temp.p197_id(601), pg_temp.p197_id(1), 'university', 'P197 University Alpha',
   'CN', NULL, pg_temp.p197_id(621), 'synthetic-p197-rev', pg_temp.p197_id(631),
   'rec_' || repeat('a', 32), pg_temp.p197_id(301)),
  (pg_temp.p197_id(603), pg_temp.p197_id(2), 'university', 'P197 Foreign University',
   'CN', NULL, pg_temp.p197_id(623), 'synthetic-p197-rev', pg_temp.p197_id(633),
   'rec_' || repeat('c', 32), pg_temp.p197_id(306)),
  (pg_temp.p197_id(604), pg_temp.p197_id(1), 'university', 'P197 Unpublished University',
   'MY', NULL, pg_temp.p197_id(624), 'synthetic-p197-rev', pg_temp.p197_id(634),
   'rec_' || repeat('d', 32), pg_temp.p197_id(301));

INSERT INTO platform_private.university_catalog_publications (
  id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id,
  reviewed_by_membership_id, reviewed_at
) VALUES
  (pg_temp.p197_id(611), pg_temp.p197_id(1), pg_temp.p197_id(601), 0, 1,
   pg_temp.p197_content('P197 University Alpha', 'CN', 'Alpha overview P197'),
   pg_temp.p197_id(621), 'published', 'P197 synthetic review',
   pg_temp.p197_id(301), pg_temp.p197_id(301), clock_timestamp()),
  (pg_temp.p197_id(613), pg_temp.p197_id(2), pg_temp.p197_id(603), 0, 1,
   pg_temp.p197_content('P197 Foreign University', 'CN', 'Foreign overview P197'),
   pg_temp.p197_id(623), 'published', 'P197 synthetic review',
   pg_temp.p197_id(306), pg_temp.p197_id(306), clock_timestamp());
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Privacy fixture (the 135 pattern): Student A owns a draft english36 attempt
-- whose answers carry a marker string. The consultation surface must never
-- carry it in any form (план §6 «Тесты», §14). The version seed is the p135
-- boundary shape (passes the version-validate trigger); the attempt INSERT is
-- superuser-side (the 135 guard trigger protects UPDATE/DELETE, not seeding).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.student_assessment_versions (
  id, instrument_key, version, locale, metadata, questions, grading_rules, published_at
)
SELECT pg_temp.p197_id(701), 'english36', 'test-197', 'ru',
  '{"title":"Synthetic English P197","interpretationVersion":"test-1"}',
  jsonb_agg(jsonb_build_object('id', 'q'||n, 'prompt', 'Synthetic question '||n,
    'topic', CASE WHEN n <= 12 THEN 'grammar' WHEN n <= 24 THEN 'vocabulary' ELSE 'reading' END,
    'options', jsonb_build_array(jsonb_build_object('id', 'a', 'label', 'A'),
      jsonb_build_object('id', 'b', 'label', 'B'),
      jsonb_build_object('id', 'unknown', 'label', 'Unknown'))) ORDER BY n),
  jsonb_object_agg('q'||n, jsonb_build_object('correctOptionId', 'a',
    'explanation', 'private-answer-explanation',
    'topic', CASE WHEN n <= 12 THEN 'grammar' WHEN n <= 24 THEN 'vocabulary' ELSE 'reading' END)),
  '1900-01-01'::TIMESTAMPTZ
FROM generate_series(1, 36) n;

INSERT INTO platform.student_assessment_attempts (
  id, organization_id, student_membership_id, instrument_key, version_id,
  status, revision, answers
) VALUES (
  pg_temp.p197_id(702), pg_temp.p197_id(1), pg_temp.p197_id(304), 'english36',
  pg_temp.p197_id(701), 'draft', 1,
  jsonb_build_object('q1', 'P197_PRIVATE_ANSWER_MARKER')
);

-- Live JWT claims via the CURRENT production hook (the p192 convention).
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p197_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p197_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p197_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p197_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p197_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p197_curator_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p197_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p197_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p197_student_a_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p197_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p197_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p197_student_b_claims
\gset

-- ---------------------------------------------------------------------------
-- (iv) The REAL Sales grant: one staff role publishing 'lead.read' -- the
-- permission the «Заявки» screen runs on (sales.read ↔ lead.read,
-- src/lib/platform-access.ts; the 173 Sales template carries it) -- assigned
-- to the Sales membership via the ordinary staff_role_command/impact/publish/
-- assignments_save sequence (the p185/p188 shape). The curator deliberately
-- receives NO grant: the denied direction of the same permission map.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p197_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_role_command(
  pg_temp.p197_id(1), pg_temp.p197_id(401), 0, 'create',
  jsonb_build_object(
    'label', 'P197 requests queue readers',
    'description', 'Migration 197 synthetic lead.read role',
    'permissionKeys', jsonb_build_array('lead.read')
  ),
  'P197 create lead.read role', pg_temp.p197_id(411)
) AS p197_role_created
\gset
SELECT pg_temp.p197_assert(
  :'p197_role_created'::JSONB = jsonb_build_object(
    'status', 'applied', 'roleId', pg_temp.p197_id(401), 'version', 1
  ),
  'staff role creation did not apply as expected'
);

SELECT platform.staff_role_impact(pg_temp.p197_id(1), pg_temp.p197_id(401), 1)
  ->> 'impactFingerprint' AS p197_role_impact_fingerprint
\gset
SELECT platform.staff_role_publish(
  pg_temp.p197_id(1), pg_temp.p197_id(401), 1,
  :'p197_role_impact_fingerprint', 'P197 publish lead.read role',
  pg_temp.p197_id(412)
) AS p197_role_published
\gset
SELECT (:'p197_role_published'::JSONB ->> 'bundleId') AS p197_role_bundle_id
\gset

SELECT platform.staff_role_assignments_save(
  pg_temp.p197_id(1), pg_temp.p197_id(302), 1,
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p197_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
  )),
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p197_id(401), 'roleVersion', 2,
    'bundleId', :'p197_role_bundle_id'::UUID, 'bundleVersion', 1
  )),
  'P197 grant Sales the queue permission', pg_temp.p197_id(413)
) AS p197_sales_grant
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p197_assert(
  (:'p197_sales_grant'::JSONB ->> 'status') = 'applied',
  'Sales did not receive the lead.read grant'
);

-- REBUILD: the grant bumped the Sales membership's access_version.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p197_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p197_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p197_sales_claims
\gset

-- ===========================================================================
-- (i)+(ii)+(iii) Student A (pending case): create, exact replay, one-open-
-- per-member, input and institution validation.
-- ===========================================================================
SET request.jwt.claims TO :'p197_student_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p197_assert(
  platform.own_portal_consultation_requests_v1() = '[]'::JSONB,
  'student A did not start with an empty consultation history'
);

SELECT platform.create_portal_consultation_request_v1(
  pg_temp.p197_id(801), pg_temp.p197_id(601), E'Хочу обсудить поступление.\nКогда удобно?'
)::TEXT AS p197_receipt_1
\gset
SELECT pg_temp.p197_assert(
  (:'p197_receipt_1'::JSONB ->> 'status') = 'requested'
    AND (:'p197_receipt_1'::JSONB ->> 'requestId')::UUID = pg_temp.p197_id(801)
    AND (:'p197_receipt_1'::JSONB ->> 'institutionId')::UUID = pg_temp.p197_id(601)
    AND (:'p197_receipt_1'::JSONB ->> 'institutionName') = 'P197 University Alpha'
    AND (:'p197_receipt_1'::JSONB ->> 'note') = E'Хочу обсудить поступление.\nКогда удобно?'
    AND (:'p197_receipt_1'::JSONB ->> 'requestedAt') IS NOT NULL
    AND (:'p197_receipt_1'::JSONB -> 'handledAt') = 'null'::JSONB,
  'student A could not open a consultation request from the university card'
);

-- Exact request_id replay: the same receipt.
SELECT pg_temp.p197_assert(
  platform.create_portal_consultation_request_v1(
    pg_temp.p197_id(801), pg_temp.p197_id(601), E'Хочу обсудить поступление.\nКогда удобно?'
  ) = :'p197_receipt_1'::JSONB,
  'exact request_id replay changed the receipt'
);

-- ONE OPEN per member: a NEW request_id while one is open returns the SAME
-- open receipt -- no duplicate, honest state.
SELECT pg_temp.p197_assert(
  platform.create_portal_consultation_request_v1(pg_temp.p197_id(802), NULL, NULL)
    = :'p197_receipt_1'::JSONB,
  'a second open consultation request was created for the same member'
);

-- Input validation: NULL request id, over-500 note, control characters.
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome('SELECT platform.create_portal_consultation_request_v1(NULL)')
    = '22023 Invalid consultation request',
  'create accepted a NULL request id'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L, NULL, %L)',
    pg_temp.p197_id(803), repeat('ы', 501)
  )) = '22023 Invalid consultation request',
  'create accepted a note longer than 500 characters'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L, NULL, %L)',
    pg_temp.p197_id(803), 'note' || chr(1)
  )) = '22023 Invalid consultation request',
  'create accepted a control character in the note'
);

-- Institution validation, the 148/195 style: foreign, unpublished, unknown.
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L, %L, NULL)',
    pg_temp.p197_id(803), pg_temp.p197_id(603)
  )) = '42501 Institution is unavailable',
  'create accepted a foreign-organization institution'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L, %L, NULL)',
    pg_temp.p197_id(803), pg_temp.p197_id(604)
  )) = '42501 Institution is unavailable',
  'create accepted an institution with no published publication'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L, %L, NULL)',
    pg_temp.p197_id(803), pg_temp.p197_id(699)
  )) = '42501 Institution is unavailable',
  'create accepted an unknown institution id'
);

-- Students never reach the staff surface.
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome('SELECT platform.staff_portal_consultation_requests_v1(0)')
    = '42501 Consultation requests unavailable'
  AND pg_temp.p197_outcome(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    pg_temp.p197_id(801), 'requested'
  )) = '42501 Consultation requests unavailable',
  'a student reached the staff consultation surface'
);
RESET ROLE;

-- Ledger truth: exactly ONE row for member A after every replay above.
SELECT pg_temp.p197_assert(
  (
    SELECT count(*) = 1 FROM platform_private.portal_consultation_requests r
    WHERE r.organization_id = pg_temp.p197_id(1)
      AND r.membership_id = pg_temp.p197_id(304)
  ),
  'the ledger holds more than one row for student A after replays'
);
SELECT r.id::TEXT AS p197_row_a
FROM platform_private.portal_consultation_requests r
WHERE r.organization_id = pg_temp.p197_id(1)
  AND r.membership_id = pg_temp.p197_id(304)
  AND r.request_id = pg_temp.p197_id(801)
\gset

-- ===========================================================================
-- (i) Student B (caseless): own request without an institution, empty note
-- normalizes to NULL, isolation from Student A.
-- ===========================================================================
SET request.jwt.claims TO :'p197_student_b_claims';
SET ROLE authenticated;

SELECT platform.create_portal_consultation_request_v1(
  pg_temp.p197_id(811), NULL, '   '
)::TEXT AS p197_receipt_b
\gset
SELECT pg_temp.p197_assert(
  (:'p197_receipt_b'::JSONB ->> 'requestId')::UUID = pg_temp.p197_id(811)
    AND (:'p197_receipt_b'::JSONB ->> 'status') = 'requested'
    AND (:'p197_receipt_b'::JSONB -> 'institutionId') = 'null'::JSONB
    AND (:'p197_receipt_b'::JSONB -> 'institutionName') = 'null'::JSONB
    AND (:'p197_receipt_b'::JSONB -> 'note') = 'null'::JSONB,
  'caseless student B could not open a profile consultation request'
);
SELECT pg_temp.p197_assert(
  (
    SELECT jsonb_array_length(history) = 1
      AND (history -> 0 ->> 'requestId')::UUID = pg_temp.p197_id(811)
    FROM platform.own_portal_consultation_requests_v1() AS history
  ),
  'student B history is not exactly their own request'
);
RESET ROLE;

SELECT r.id::TEXT AS p197_row_b
FROM platform_private.portal_consultation_requests r
WHERE r.organization_id = pg_temp.p197_id(1)
  AND r.membership_id = pg_temp.p197_id(305)
\gset

-- Student A still sees only their own single request.
SET request.jwt.claims TO :'p197_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p197_assert(
  (
    SELECT jsonb_array_length(history) = 1
      AND (history -> 0 ->> 'requestId')::UUID = pg_temp.p197_id(801)
    FROM platform.own_portal_consultation_requests_v1() AS history
  ),
  'student B write leaked into student A history'
);
RESET ROLE;

-- ===========================================================================
-- (iv)+(vi) Admin (NO explicit grant -- the admin bypass) reads the queue:
-- both rows, the EXACT declared key set, no assessment marker anywhere.
-- ===========================================================================
SET request.jwt.claims TO :'p197_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_portal_consultation_requests_v1(0)::TEXT AS p197_staff_page
\gset
SELECT pg_temp.p197_assert(
  jsonb_array_length(:'p197_staff_page'::JSONB -> 'items') = 2
    AND (:'p197_staff_page'::JSONB ->> 'openCount')::BIGINT = 2
    AND (:'p197_staff_page'::JSONB -> 'nextOffset') = 'null'::JSONB,
  'staff admin does not see both open consultation requests'
);
SELECT pg_temp.p197_assert(
  (
    SELECT item ->> 'studentName' = 'P197 Pending Student'
      AND (item ->> 'institutionId')::UUID = pg_temp.p197_id(601)
      AND item ->> 'institutionName' = 'P197 University Alpha'
      AND item ->> 'note' = E'Хочу обсудить поступление.\nКогда удобно?'
      AND item ->> 'status' = 'requested'
      AND (item ->> 'requestedAt') IS NOT NULL
    FROM jsonb_array_elements(:'p197_staff_page'::JSONB -> 'items') AS item
    WHERE (item ->> 'id')::UUID = :'p197_row_a'::UUID
  ),
  'the staff row lost the student name, chosen university or note context'
);
-- The declared key set, nothing else (план §6/§14: no test results in any
-- form, no personal learning progress, no indirect export).
SELECT pg_temp.p197_assert(
  (
    SELECT bool_and(
      (SELECT string_agg(key, ',' ORDER BY key) FROM jsonb_object_keys(item) AS key)
        = 'handledAt,handledByName,id,institutionId,institutionName,note,requestedAt,status,studentName'
    )
    FROM jsonb_array_elements(:'p197_staff_page'::JSONB -> 'items') AS item
  ),
  'a staff consultation row carries keys outside the declared set'
);
SELECT pg_temp.p197_assert(
  position('P197_PRIVATE_ANSWER_MARKER' IN :'p197_staff_page') = 0,
  'the staff consultation JSON leaked assessment content'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome('SELECT platform.staff_portal_consultation_requests_v1(-1)')
    = '22023 Invalid consultation page'
  AND pg_temp.p197_outcome('SELECT platform.staff_portal_consultation_requests_v1(NULL)')
    = '22023 Invalid consultation page',
  'the staff page accepted a negative or NULL offset'
);
-- Staff are denied the Student-side RPCs.
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L)', pg_temp.p197_id(821)
  )) = '42501 Consultation unavailable'
  AND pg_temp.p197_outcome('SELECT platform.own_portal_consultation_requests_v1()')
    = '42501 Consultation unavailable',
  'staff admin was not denied the Student-side consultation RPCs'
);
RESET ROLE;

-- ===========================================================================
-- (iv)+(v) Sales with the REAL lead.read grant: reads the queue, handles
-- Student A's request; the handled replay is idempotent; a stale expected
-- status is PT409; invalid input 22023; unknown row 42501. The granted Sales
-- actor still cannot read the student's assessment attempt (the 135 mirror).
-- ===========================================================================
SET request.jwt.claims TO :'p197_sales_claims';
SET ROLE authenticated;

SELECT pg_temp.p197_assert(
  (platform.staff_portal_consultation_requests_v1(0) ->> 'openCount')::BIGINT = 2,
  'granted Sales cannot read the consultation queue'
);

SELECT platform.handle_portal_consultation_request_v1(
  :'p197_row_a'::UUID, 'requested'
)::TEXT AS p197_handled_a
\gset
SELECT pg_temp.p197_assert(
  (:'p197_handled_a'::JSONB ->> 'status') = 'handled'
    AND (:'p197_handled_a'::JSONB ->> 'handledAt') IS NOT NULL
    AND (:'p197_handled_a'::JSONB ->> 'id')::UUID = :'p197_row_a'::UUID,
  'granted Sales could not handle an open consultation request'
);
-- Idempotent replay: the handled state replays unchanged.
SELECT pg_temp.p197_assert(
  platform.handle_portal_consultation_request_v1(:'p197_row_a'::UUID, 'handled')
    = :'p197_handled_a'::JSONB,
  'the handled replay rewrote the receipt'
);
-- Status mismatch: PT409, the non-retryable business conflict.
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    :'p197_row_a'::UUID, 'requested'
  )) = 'PT409 consultation_request_conflict',
  'a stale expected status did not surface PT409'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    :'p197_row_b'::UUID, 'nonsense'
  )) = '22023 Invalid consultation command'
  AND pg_temp.p197_outcome(
    'SELECT platform.handle_portal_consultation_request_v1(NULL, ''requested'')'
  ) = '22023 Invalid consultation command',
  'handle accepted an invalid command'
);
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    pg_temp.p197_id(899), 'requested'
  )) = '42501 Consultation requests unavailable',
  'handle did not refuse an unknown row id'
);
-- The 135 privacy mirror: the granted queue reader still cannot open the
-- student's assessment attempt through the assessment surface.
SELECT pg_temp.p197_assert(
  pg_temp.p197_error(format(
    'SELECT platform.student_assessment_attempt_v1(%L)', pg_temp.p197_id(702)
  )) = '42501',
  'the granted Sales actor read a student assessment attempt'
);
RESET ROLE;

-- Sales-side truth: who/when recorded once.
SELECT pg_temp.p197_assert(
  (
    SELECT count(*) = 1 FROM platform_private.portal_consultation_requests r
    WHERE r.id = :'p197_row_a'::UUID AND r.status = 'handled'
      AND r.handled_by_membership_id = pg_temp.p197_id(302)
      AND r.handled_at IS NOT NULL
  ),
  'the handled row did not record who and when exactly once'
);

-- ===========================================================================
-- (ii) After handled: a NEW request opens for Student A; the exact replay of
-- the OLD request_id returns the handled receipt; history is newest-first
-- with both statuses.
-- ===========================================================================
SET request.jwt.claims TO :'p197_student_a_claims';
SET ROLE authenticated;

SELECT platform.create_portal_consultation_request_v1(
  pg_temp.p197_id(805), NULL, 'Ещё один вопрос.'
)::TEXT AS p197_receipt_2
\gset
SELECT pg_temp.p197_assert(
  (:'p197_receipt_2'::JSONB ->> 'requestId')::UUID = pg_temp.p197_id(805)
    AND (:'p197_receipt_2'::JSONB ->> 'status') = 'requested',
  'a new consultation request did not open after the previous one was handled'
);
SELECT pg_temp.p197_assert(
  (platform.create_portal_consultation_request_v1(pg_temp.p197_id(801)) ->> 'status')
    = 'handled',
  'the old request_id replay does not return the handled receipt'
);
SELECT pg_temp.p197_assert(
  (
    SELECT jsonb_array_length(history) = 2
      AND (history -> 0 ->> 'requestId')::UUID = pg_temp.p197_id(805)
      AND (history -> 0 ->> 'status') = 'requested'
      AND (history -> 1 ->> 'requestId')::UUID = pg_temp.p197_id(801)
      AND (history -> 1 ->> 'status') = 'handled'
      AND (history -> 1 ->> 'handledAt') IS NOT NULL
    FROM platform.own_portal_consultation_requests_v1() AS history
  ),
  'own history does not show both statuses newest-first'
);
RESET ROLE;

-- Admin handles Student B's request too («admin included», the write side).
SET request.jwt.claims TO :'p197_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p197_assert(
  (platform.handle_portal_consultation_request_v1(:'p197_row_b'::UUID, 'requested')
    ->> 'status') = 'handled',
  'admin could not handle a consultation request without an explicit grant'
);
RESET ROLE;

-- ===========================================================================
-- (iv) Curator WITHOUT the lead.read grant: denied BOTH read and handle --
-- the other direction of the same permission map. Also denied the
-- Student-side RPCs.
-- ===========================================================================
SET request.jwt.claims TO :'p197_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p197_assert(
  pg_temp.p197_outcome('SELECT platform.staff_portal_consultation_requests_v1(0)')
    = '42501 Consultation requests unavailable'
  AND pg_temp.p197_outcome(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    :'p197_row_b'::UUID, 'handled'
  )) = '42501 Consultation requests unavailable'
  AND pg_temp.p197_outcome(format(
    'SELECT platform.create_portal_consultation_request_v1(%L)', pg_temp.p197_id(822)
  )) = '42501 Consultation unavailable'
  AND pg_temp.p197_outcome('SELECT platform.own_portal_consultation_requests_v1()')
    = '42501 Consultation unavailable',
  'curator without lead.read was not denied the consultation surface'
);
RESET ROLE;

-- ===========================================================================
-- (iv) anon and service_role are denied all four RPCs; the private table is
-- unreadable directly by authenticated.
-- ===========================================================================
SET request.jwt.claims TO :'p197_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p197_assert(
  pg_temp.p197_error('SELECT * FROM platform_private.portal_consultation_requests') = '42501',
  'authenticated read the private consultation table directly'
);
RESET ROLE;
RESET request.jwt.claims;

SET ROLE anon;
SELECT pg_temp.p197_assert(
  pg_temp.p197_error(format(
    'SELECT platform.create_portal_consultation_request_v1(%L)', pg_temp.p197_id(831)
  )) = '42501'
  AND pg_temp.p197_error('SELECT platform.own_portal_consultation_requests_v1()') = '42501'
  AND pg_temp.p197_error('SELECT platform.staff_portal_consultation_requests_v1(0)') = '42501'
  AND pg_temp.p197_error(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    :'p197_row_b'::UUID, 'handled'
  )) = '42501',
  'anon was not denied all four consultation RPCs'
);
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.p197_assert(
  pg_temp.p197_error(format(
    'SELECT platform.create_portal_consultation_request_v1(%L)', pg_temp.p197_id(832)
  )) = '42501'
  AND pg_temp.p197_error('SELECT platform.own_portal_consultation_requests_v1()') = '42501'
  AND pg_temp.p197_error('SELECT platform.staff_portal_consultation_requests_v1(0)') = '42501'
  AND pg_temp.p197_error(format(
    'SELECT platform.handle_portal_consultation_request_v1(%L, %L)',
    :'p197_row_b'::UUID, 'handled'
  )) = '42501',
  'service_role was not denied all four consultation RPCs'
);
RESET ROLE;

SELECT 'P197_PORTAL_CONSULTATION_SUITE_PASSED' AS p197_suite_marker;

ROLLBACK;
