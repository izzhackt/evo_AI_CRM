\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 195 (PORT-3b «Избранное
-- каталога»). Runs at the 195 checkpoint against the FULL current schema,
-- exactly like platform_portal_access_tiers.sql at 192. Fixtures are
-- synthetic actors with hook-generated live claims (the p192 convention) and
-- replica-mode catalogue snapshots (the p135/p192 convention: the one
-- import-provenance FK chain is skipped, every CHECK — including
-- valid_university_content on publication rows — still applies to the rows
-- themselves). Every row rolls back at the end.
--
-- Boundary claims proven here:
--   (i)    a Student CRUDs ONLY their own favourites; a second Student of the
--          same organization sees an empty set and their writes never leak
--          into the first Student's list;
--   (ii)   the double-set replay keeps exactly one row and the double-unset
--          replay stays at the removed state (idempotent by construction);
--   (iii)  set/by_ids refuse a foreign-organization institution id, an
--          unknown id, and (by the same 42501) an id with no published
--          publication; the 30-id cap and NULL shapes fail 22023 BEFORE any
--          existence probing;
--   (iv)   by_ids returns the student_university_catalog row shape
--          (id/version/publishedAt/content), the LATEST published version,
--          deduplicated ids, and no staff/workflow metadata;
--   (v)    staff admin/sales/curator are DENIED all three RPCs (favourites
--          are Student-private, план §8.5), anon and service_role are
--          denied, and the private table is unreadable directly;
--   (vi)   the guard is case-independent: Student A works on a pending
--          portal-activated case, Student B works with NO case at all.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p195_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19500000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p195_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 195 assertion failed: %', p_message;
  END IF;
END
$$;

-- One outcome probe for denials and positives, in the p192 idiom: the exact
-- message matters where the boundary text is part of the contract.
CREATE FUNCTION pg_temp.p195_outcome(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

-- SQLSTATE-only probe for roles whose denial text is PostgreSQL's own
-- (anon/service_role permission denials).
CREATE FUNCTION pg_temp.p195_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

-- Valid public catalogue content (passes valid_university_content), one open
-- intake without timezone; name/country/overview parameterized per fixture.
CREATE FUNCTION pg_temp.p195_content(p_name TEXT, p_country TEXT, p_overview TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name', p_name,
    'country', p_country,
    'city', NULL,
    'overview', p_overview,
    'websiteUrl', 'https://university.example-p195.edu',
    'sourceUrl', 'https://university.example-p195.edu/admissions',
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
      'sourceUrl', 'https://university.example-p195.edu/programs/cs',
      'intakes', jsonb_build_array(jsonb_build_object(
        'label', 'September intake',
        'startDate', '2027-09-01',
        'startMonth', '2027-09',
        'applicationDeadline', '2027-06-30',
        'deadlineTime', NULL,
        'timezone', NULL,
        'status', 'open',
        'note', '',
        'sourceUrl', 'https://university.example-p195.edu/admissions',
        'verifiedOn', '2026-09-19'
      ))
    ))
  )
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p195_id(INTEGER),
  pg_temp.p195_assert(BOOLEAN, TEXT),
  pg_temp.p195_outcome(TEXT),
  pg_temp.p195_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P195_UNIVERSITY_FAVORITES_SUITE_START' AS p195_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization A with admin/sales/curator staff and TWO students --
-- A owns a portal-activated PENDING case, B owns NO case at all (the guard
-- is the 148 catalogue guard, deliberately case-independent). Organization B
-- exists only to own the foreign institution.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES
  (pg_temp.p195_id(1), 'Migration 195 synthetic organization A'),
  (pg_temp.p195_id(2), 'Migration 195 synthetic organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p195_id(101), 'p195-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p195_id(102), 'p195-sales@example.invalid', '{}'::JSONB),
  (pg_temp.p195_id(103), 'p195-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p195_id(104), 'p195-student-pending@example.invalid', '{}'::JSONB),
  (pg_temp.p195_id(105), 'p195-student-caseless@example.invalid', '{}'::JSONB),
  (pg_temp.p195_id(106), 'p195-admin-b@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p195_id(201), pg_temp.p195_id(101), 'P195 Admin', 'active', 1),
  (pg_temp.p195_id(202), pg_temp.p195_id(102), 'P195 Sales', 'active', 1),
  (pg_temp.p195_id(203), pg_temp.p195_id(103), 'P195 Curator', 'active', 1),
  (pg_temp.p195_id(204), pg_temp.p195_id(104), 'P195 Pending Student', 'active', 1),
  (pg_temp.p195_id(205), pg_temp.p195_id(105), 'P195 Caseless Student', 'active', 1),
  (pg_temp.p195_id(206), pg_temp.p195_id(106), 'P195 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
)
SELECT
  pg_temp.p195_id(300 + actor.n),
  pg_temp.p195_id(CASE WHEN actor.n = 6 THEN 2 ELSE 1 END),
  pg_temp.p195_id(200 + actor.n),
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
  (pg_temp.p195_id(11), pg_temp.p195_id(1), 'organization', pg_temp.p195_id(1), 1),
  (pg_temp.p195_id(12), pg_temp.p195_id(2), 'organization', pg_temp.p195_id(2), 1),
  (pg_temp.p195_id(401), pg_temp.p195_id(1), 'student_case', pg_temp.p195_id(501), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT
  pg_temp.p195_id(CASE WHEN n = 6 THEN 2 ELSE 1 END),
  pg_temp.p195_id(300 + n),
  pg_temp.p195_id(CASE WHEN n = 6 THEN 12 ELSE 11 END),
  1, 1, TRUE, 'system', 'P195 synthetic organization scope', pg_temp.p195_id(600 + n)
FROM generate_series(1, 6) AS n;

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
VALUES
  (pg_temp.p195_id(1), pg_temp.p195_id(304), pg_temp.p195_id(401), 1,
   1, TRUE, 'system', 'P195 pending student case scope', pg_temp.p195_id(611));

-- Student A's portal-activated PENDING case (approved tier): replica-mode
-- snapshot of the shape 180/185 produce, exactly like p192's fixture. The
-- guard under test must NOT depend on this row -- Student B has none.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p195_id(501), pg_temp.p195_id(1), pg_temp.p195_id(304), pg_temp.p195_id(302),
  'synthetic:p195:approved-cabinet', 'P195 Pending Student', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p195_id(401), 1
);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Catalogue fixtures: two published universities in organization A (Alpha has
-- TWO published versions -- by_ids must return the latest), one published
-- university in organization B (the foreign refusal), plus a DRAFT-only row
-- in organization A (a draft never creates an institution, so "no published
-- publication" is probed through the unknown-id refusal below). Replica mode
-- skips only the import-batch provenance FK; every CHECK still applies,
-- including valid_university_content on each content payload.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions (
  id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES
  (pg_temp.p195_id(601), pg_temp.p195_id(1), 'university', 'P195 University Alpha',
   'CN', NULL, pg_temp.p195_id(621), 'synthetic-p195-rev', pg_temp.p195_id(631),
   'rec_' || repeat('a', 32), pg_temp.p195_id(301)),
  (pg_temp.p195_id(602), pg_temp.p195_id(1), 'university', 'P195 University Beta',
   'MY', NULL, pg_temp.p195_id(622), 'synthetic-p195-rev', pg_temp.p195_id(632),
   'rec_' || repeat('b', 32), pg_temp.p195_id(301)),
  (pg_temp.p195_id(603), pg_temp.p195_id(2), 'university', 'P195 Foreign University',
   'CN', NULL, pg_temp.p195_id(623), 'synthetic-p195-rev', pg_temp.p195_id(633),
   'rec_' || repeat('c', 32), pg_temp.p195_id(306));

INSERT INTO platform_private.university_catalog_publications (
  id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id,
  reviewed_by_membership_id, reviewed_at
) VALUES
  (pg_temp.p195_id(611), pg_temp.p195_id(1), pg_temp.p195_id(601), 0, 1,
   pg_temp.p195_content('P195 University Alpha', 'CN', 'Revision one P195'),
   pg_temp.p195_id(621), 'published', 'P195 synthetic review',
   pg_temp.p195_id(301), pg_temp.p195_id(301), clock_timestamp()),
  (pg_temp.p195_id(614), pg_temp.p195_id(1), pg_temp.p195_id(601), 1, 2,
   pg_temp.p195_content('P195 University Alpha', 'CN', 'Revision two P195'),
   pg_temp.p195_id(621), 'published', 'P195 synthetic review',
   pg_temp.p195_id(301), pg_temp.p195_id(301), clock_timestamp()),
  (pg_temp.p195_id(612), pg_temp.p195_id(1), pg_temp.p195_id(602), 0, 1,
   pg_temp.p195_content('P195 University Beta', 'MY', 'Beta overview P195'),
   pg_temp.p195_id(622), 'published', 'P195 synthetic review',
   pg_temp.p195_id(301), pg_temp.p195_id(301), clock_timestamp()),
  (pg_temp.p195_id(613), pg_temp.p195_id(2), pg_temp.p195_id(603), 0, 1,
   pg_temp.p195_content('P195 Foreign University', 'CN', 'Foreign overview P195'),
   pg_temp.p195_id(623), 'published', 'P195 synthetic review',
   pg_temp.p195_id(306), pg_temp.p195_id(306), clock_timestamp());
SET LOCAL session_replication_role = origin;

-- Live JWT claims via the CURRENT production hook -- never hand-built (the
-- p192 convention), so a claims-shape change fails this suite loudly.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p195_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p195_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p195_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p195_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p195_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p195_sales_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p195_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p195_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p195_curator_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p195_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p195_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p195_student_a_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p195_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p195_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p195_student_b_claims
\gset

-- ===========================================================================
-- (i)+(ii)+(vi) Student A (pending case, approved tier) CRUDs their own set;
-- replays are idempotent by construction.
-- ===========================================================================
SET request.jwt.claims TO :'p195_student_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p195_assert(
  platform.student_university_favorites_v1() = '[]'::JSONB,
  'student A did not start with an empty favourites list'
);

SELECT platform.set_university_favorite_v1(pg_temp.p195_id(601), TRUE)::TEXT AS p195_set_1
\gset
SELECT pg_temp.p195_assert(
  (:'p195_set_1'::JSONB ->> 'favored')::BOOLEAN
    AND (:'p195_set_1'::JSONB ->> 'favoritesCount')::BIGINT = 1
    AND (:'p195_set_1'::JSONB ->> 'institutionId')::UUID = pg_temp.p195_id(601),
  'student A could not favourite a published own-organization university'
);

-- Double-set replay: same resulting state, still one row.
SELECT pg_temp.p195_assert(
  platform.set_university_favorite_v1(pg_temp.p195_id(601), TRUE) = :'p195_set_1'::JSONB,
  'double-set replay changed the favourite state or count'
);

SELECT pg_temp.p195_assert(
  (platform.set_university_favorite_v1(pg_temp.p195_id(602), TRUE) ->> 'favoritesCount')::BIGINT = 2,
  'second favourite did not raise the count to 2'
);

SELECT pg_temp.p195_assert(
  (
    SELECT jsonb_array_length(favourites) = 2
      AND (favourites -> 0 ->> 'institutionId')::UUID = pg_temp.p195_id(602)
      AND (favourites -> 1 ->> 'institutionId')::UUID = pg_temp.p195_id(601)
      AND (favourites -> 0) ?& ARRAY['institutionId', 'createdAt']
    FROM platform.student_university_favorites_v1() AS favourites
  ),
  'favourites list shape or newest-first order is wrong'
);

-- (iv) by_ids: catalogue row shape, LATEST version, dedupe, no staff metadata.
SELECT platform.student_university_catalog_by_ids_v1(
  ARRAY[pg_temp.p195_id(601), pg_temp.p195_id(602)]
)::TEXT AS p195_by_ids
\gset
SELECT pg_temp.p195_assert(
  jsonb_array_length(:'p195_by_ids'::JSONB -> 'items') = 2
    AND (:'p195_by_ids'::JSONB ->> 'nextOffset') IS NULL,
  'by_ids did not return both requested published cards'
);
SELECT pg_temp.p195_assert(
  (
    SELECT item ? 'id' AND item ? 'version' AND item ? 'publishedAt' AND item ? 'content'
      AND NOT item ?| ARRAY['source_registry_id', 'created_by_membership_id', 'reason', 'actorId', 'organizationId']
    FROM jsonb_array_elements(:'p195_by_ids'::JSONB -> 'items') AS item
    WHERE (item ->> 'id')::UUID = pg_temp.p195_id(601)
  ),
  'by_ids row shape leaked staff metadata or lost catalogue fields'
);
SELECT pg_temp.p195_assert(
  (
    SELECT (item ->> 'version')::BIGINT = 2
      AND item #>> '{content,overview}' = 'Revision two P195'
    FROM jsonb_array_elements(:'p195_by_ids'::JSONB -> 'items') AS item
    WHERE (item ->> 'id')::UUID = pg_temp.p195_id(601)
  ),
  'by_ids did not return the latest published version'
);
SELECT pg_temp.p195_assert(
  jsonb_array_length(platform.student_university_catalog_by_ids_v1(
    ARRAY[pg_temp.p195_id(601), pg_temp.p195_id(601)]
  ) -> 'items') = 1,
  'by_ids did not deduplicate a repeated id'
);
SELECT pg_temp.p195_assert(
  platform.student_university_catalog_by_ids_v1('{}'::UUID[])
    = jsonb_build_object('items', '[]'::JSONB, 'nextOffset', NULL),
  'by_ids of an empty list is not an honest empty page'
);

-- (iii) Refusals: foreign org, mixed, unknown id -- 42501 with the 148 text;
-- the cap and NULL shapes -- 22023 BEFORE any existence probing.
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(603)
  )) = '42501 Institution is unavailable',
  'by_ids accepted a foreign-organization id'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID, %L::UUID])',
    pg_temp.p195_id(601), pg_temp.p195_id(603)
  )) = '42501 Institution is unavailable',
  'by_ids accepted a mixed list with a foreign id'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(699)
  )) = '42501 Institution is unavailable',
  'by_ids accepted an unknown id'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(
    'SELECT platform.student_university_catalog_by_ids_v1((' ||
    'SELECT array_agg(pg_temp.p195_id(900 + n)) FROM generate_series(1, 31) AS n))'
  ) = '22023 Invalid catalogue filter',
  'by_ids over the 30-id cap did not fail 22023 before existence probing'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(
    'SELECT platform.student_university_catalog_by_ids_v1(NULL::UUID[])'
  ) = '22023 Invalid catalogue filter',
  'by_ids of NULL did not fail 22023'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID, NULL])',
    pg_temp.p195_id(601)
  )) = '22023 Invalid catalogue filter',
  'by_ids with a NULL element did not fail 22023'
);

SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(603)
  )) = '42501 Institution is unavailable',
  'set accepted a foreign-organization institution'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(699)
  )) = '42501 Institution is unavailable',
  'set accepted an unknown institution'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, NULL)', pg_temp.p195_id(601)
  )) = '22023 Invalid favourite command',
  'set accepted a NULL p_favored'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(
    'SELECT platform.set_university_favorite_v1(NULL, TRUE)'
  ) = '22023 Invalid favourite command',
  'set accepted a NULL institution id'
);

-- (ii) Unset + idempotent unset replay.
SELECT platform.set_university_favorite_v1(pg_temp.p195_id(602), FALSE)::TEXT AS p195_unset
\gset
SELECT pg_temp.p195_assert(
  NOT (:'p195_unset'::JSONB ->> 'favored')::BOOLEAN
    AND (:'p195_unset'::JSONB ->> 'favoritesCount')::BIGINT = 1,
  'unset did not remove the favourite'
);
SELECT pg_temp.p195_assert(
  platform.set_university_favorite_v1(pg_temp.p195_id(602), FALSE) = :'p195_unset'::JSONB,
  'double-unset replay changed the state'
);

-- Direct private-table access stays closed for authenticated.
SELECT pg_temp.p195_assert(
  pg_temp.p195_error('SELECT * FROM platform_private.university_favorites') = '42501',
  'authenticated read the private favourites table directly'
);

RESET ROLE;

-- Owner-side: the double-set kept exactly one row for Student A.
SELECT pg_temp.p195_assert(
  (
    SELECT count(*) = 1 FROM platform_private.university_favorites f
    WHERE f.organization_id = pg_temp.p195_id(1)
      AND f.membership_id = pg_temp.p195_id(304)
  ),
  'ledger does not hold exactly one row for student A after replays'
);

-- ===========================================================================
-- (i)+(vi) Student B: NO case at all -- the guard must still admit them; the
-- set they see and write is exclusively their own.
-- ===========================================================================
SET request.jwt.claims TO :'p195_student_b_claims';
SET ROLE authenticated;

SELECT pg_temp.p195_assert(
  platform.student_university_favorites_v1() = '[]'::JSONB,
  'student B saw a foreign favourites set'
);
SELECT pg_temp.p195_assert(
  (platform.set_university_favorite_v1(pg_temp.p195_id(601), TRUE) ->> 'favoritesCount')::BIGINT = 1,
  'caseless student B could not favourite (guard is not case-independent)'
);
SELECT pg_temp.p195_assert(
  jsonb_array_length(platform.student_university_catalog_by_ids_v1(
    ARRAY[pg_temp.p195_id(601)]
  ) -> 'items') = 1,
  'caseless student B could not read the published card by id'
);

RESET ROLE;

-- Student A's list is untouched by B's write.
SET request.jwt.claims TO :'p195_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p195_assert(
  (
    SELECT jsonb_array_length(favourites) = 1
      AND (favourites -> 0 ->> 'institutionId')::UUID = pg_temp.p195_id(601)
    FROM platform.student_university_favorites_v1() AS favourites
  ),
  'student B''s write leaked into student A''s list'
);
RESET ROLE;

-- ===========================================================================
-- (v) Staff admin/sales/curator are denied all three RPCs (favourites are
-- Student-private, план §8.5); anon and service_role are denied.
-- ===========================================================================
SET request.jwt.claims TO :'p195_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(601)
  )) = '42501 Favourites unavailable',
  'staff admin was not denied the favourite write'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome('SELECT platform.student_university_favorites_v1()')
    = '42501 Favourites unavailable',
  'staff admin was not denied the favourites read'
);
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(601)
  )) = '42501 Catalogue unavailable',
  'staff admin was not denied the by-ids catalogue read'
);
RESET ROLE;

SET request.jwt.claims TO :'p195_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(601)
  )) = '42501 Favourites unavailable'
  AND pg_temp.p195_outcome('SELECT platform.student_university_favorites_v1()')
    = '42501 Favourites unavailable'
  AND pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(601)
  )) = '42501 Catalogue unavailable',
  'staff sales was not denied all three favourite RPCs'
);
RESET ROLE;

SET request.jwt.claims TO :'p195_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p195_assert(
  pg_temp.p195_outcome(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(601)
  )) = '42501 Favourites unavailable'
  AND pg_temp.p195_outcome('SELECT platform.student_university_favorites_v1()')
    = '42501 Favourites unavailable'
  AND pg_temp.p195_outcome(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(601)
  )) = '42501 Catalogue unavailable',
  'staff curator was not denied all three favourite RPCs'
);
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.p195_assert(
  pg_temp.p195_error(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(601)
  )) = '42501'
  AND pg_temp.p195_error('SELECT platform.student_university_favorites_v1()') = '42501'
  AND pg_temp.p195_error(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(601)
  )) = '42501',
  'anon was not denied all three favourite RPCs'
);
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.p195_assert(
  pg_temp.p195_error(format(
    'SELECT platform.set_university_favorite_v1(%L, TRUE)', pg_temp.p195_id(601)
  )) = '42501'
  AND pg_temp.p195_error('SELECT platform.student_university_favorites_v1()') = '42501'
  AND pg_temp.p195_error(format(
    'SELECT platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
    pg_temp.p195_id(601)
  )) = '42501',
  'service_role was not denied all three favourite RPCs'
);
RESET ROLE;

SELECT 'P195_UNIVERSITY_FAVORITES_SUITE_PASSED' AS p195_suite_marker;

ROLLBACK;
