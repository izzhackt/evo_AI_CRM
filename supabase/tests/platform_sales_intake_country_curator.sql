\set ON_ERROR_STOP on
-- Boundary suite for migration 335 «Куратор страны подставляется в продаже сам». Runs on the real chain right after 335 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. why the setting is explicit: a curator whose role is scoped to the direction MY is not in the 174 curator list at all, and
--     a curator of the whole organization reads every direction;
--  2. country_curators_v1: the system Admin reads both countries (version 0, no curator) and the curators that may be chosen
--     (the 174 rule); a Student is refused 42501;
--  3. country_curator_save_v1: save, replay by request id, another input under the same id 23505, a stale version PT409, the same
--     input unchanged (no journal row), a curator that may not be chosen and an unknown direction 22023, a Student 42501,
--     clearing to NULL; one journal row per real change, action country.curator.change on the organization;
--  4. sales_register_intake_options_v2: 174's curators and leads unchanged, country_curators names the saved curator, a lead with
--     an анкета carries its first destination country, one without carries NULL; a Student is refused 42501;
--  5. the posture of the three functions and the closed table; 174 is unchanged.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A335_SALES_INTAKE_COUNTRY_CURATOR_SUITE_START

CREATE FUNCTION pg_temp.a335_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33500000-0000-4000-8000-' || lpad((900000 + n)::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a335_id(INTEGER) TO authenticated;
CREATE FUNCTION pg_temp.a335_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A335: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a335_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a335_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a335_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- A read as an actor with their claims: its JSONB result, or {"error": SQLSTATE}.
CREATE FUNCTION pg_temp.a335_as(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    result := jsonb_build_object('error', v_state);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2 curator of MY (role scoped to the direction), 3 curator of the whole organization, 4 Student,
-- 5 an applicant (Auth user only). Leads: 3001 with an анкета (MY first), 3002 without.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a335_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a335_actors VALUES (1, 'admin', TRUE), (2, NULL, FALSE), (3, NULL, FALSE), (4, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a335_id(1), 'A335 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a335_id(100 + n), 'a335-' || n || '@example.invalid', '{}'::JSONB FROM a335_actors
  UNION ALL SELECT pg_temp.a335_id(105), 'a335-5@example.invalid', '{}'::JSONB;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a335_id(200 + n), pg_temp.a335_id(100 + n), 'A335 Actor ' || n, 'active', 1 FROM a335_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a335_id(300 + a.n), pg_temp.a335_id(1), pg_temp.a335_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END, a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a335_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a335_id(401), pg_temp.a335_id(1), 'organization', pg_temp.a335_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a335_id(1), pg_temp.a335_id(300 + n), pg_temp.a335_id(401), 1, 1, TRUE, 'system', 'A335 synthetic organization scope', pg_temp.a335_id(460 + n)
  FROM a335_actors WHERE n IN (1, 4);
SET LOCAL session_replication_role = origin;

-- The curator role is created, published and granted by the real commands as the system Admin.
SELECT pg_temp.a335_claims(1) AS a335_admin \gset
SET LOCAL request.jwt.claims TO :'a335_admin';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE a335_bundle(bundle_id UUID);
GRANT SELECT, INSERT ON a335_bundle TO authenticated;
DO $a335_role$
DECLARE published JSONB;
BEGIN
  PERFORM platform.staff_role_command(pg_temp.a335_id(1), pg_temp.a335_id(1101), 0, 'create',
    jsonb_build_object('label', 'A335 Куратор', 'description', 'Migration 335 synthetic curator role',
      'permissionKeys', '["case.read.full","task.manage"]'::JSONB), 'A335 create role', pg_temp.a335_id(1201));
  published := platform.staff_role_publish(pg_temp.a335_id(1), pg_temp.a335_id(1101), 1,
    platform.staff_role_impact(pg_temp.a335_id(1), pg_temp.a335_id(1101), 1) ->> 'impactFingerprint',
    'A335 publish role', pg_temp.a335_id(1202));
  INSERT INTO a335_bundle VALUES ((published ->> 'bundleId')::UUID);
  PERFORM platform.staff_role_assignments_save(pg_temp.a335_id(1), pg_temp.a335_id(302), 1,
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.a335_id(1101), 'scope', jsonb_build_object('kind', 'direction', 'key', 'MY', 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.a335_id(1101), 'roleVersion', 2, 'bundleId', (SELECT bundle_id FROM a335_bundle), 'bundleVersion', 1)),
    'A335 curator of Malaysia', pg_temp.a335_id(1203));
  PERFORM platform.staff_role_assignments_save(pg_temp.a335_id(1), pg_temp.a335_id(303), 1,
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.a335_id(1101), 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.a335_id(1), 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.a335_id(1101), 'roleVersion', 2, 'bundleId', (SELECT bundle_id FROM a335_bundle), 'bundleVersion', 1)),
    'A335 curator of the organization', pg_temp.a335_id(1204));
END
$a335_role$;
RESET ROLE;

SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  SELECT pg_temp.a335_id(2000 + i), pg_temp.a335_id(1), 'A335 Лид ' || i, platform_private.normalize_person_name('A335 Лид ' || i)
  FROM generate_series(1, 2) AS i;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key)
  SELECT pg_temp.a335_id(3000 + i), pg_temp.a335_id(1), pg_temp.a335_id(2000 + i), pg_temp.a335_id(301), 'new', 'a335'
  FROM generate_series(1, 2) AS i;
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, canonical_lead_id)
VALUES (pg_temp.a335_id(801), pg_temp.a335_id(1), pg_temp.a335_id(105), 'a335-5@example.invalid',
  jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a335_id(901), 'firstName', 'A335', 'lastName', 'Лид',
    'phone', '+996 700 000 000', 'destinationCountries', jsonb_build_array('MY', 'CN'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', jsonb_build_array('Информационные технологии'),
    'studyLevels', jsonb_build_array('bachelor'), 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
  'pending', 1, TIMESTAMPTZ '2026-11-01 10:00:00+00', pg_temp.a335_id(3001));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a335_claims(1) AS a335_admin \gset
SELECT pg_temp.a335_claims(4) AS a335_student \gset

SELECT pg_temp.a335_as(:'a335_admin', format('SELECT platform.sales_register_intake_options(%L, %L)', pg_temp.a335_id(1), 'A335')) AS a335_v1 \gset

-- ---------------------------------------------------------------------------
-- 1. Why the setting is explicit.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a335_assert(NOT (:'a335_v1'::JSONB ? 'error'), 'the Admin reads the 174 list');
SELECT pg_temp.a335_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'a335_v1'::JSONB -> 'curators') c
    WHERE c ->> 'id' = pg_temp.a335_id(302)::TEXT),
  'a curator scoped to the direction MY is not in the 174 curator list');
SELECT pg_temp.a335_assert(platform_private.staff_context_can_access(pg_temp.a335_id(1), pg_temp.a335_id(303), 'case.read.full', 'student_case', NULL,
    pg_temp.a335_id(303), NULL, 'CN') AND platform_private.staff_context_can_access(pg_temp.a335_id(1), pg_temp.a335_id(303), 'case.read.full',
    'student_case', NULL, pg_temp.a335_id(303), NULL, 'MY'),
  'a curator of the organization reads every direction');

-- ---------------------------------------------------------------------------
-- 2. Read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a335_as(:'a335_admin', format('SELECT platform.country_curators_v1(%L)', pg_temp.a335_id(1))) AS a335_read \gset
SELECT pg_temp.a335_assert(:'a335_read'::JSONB -> 'countries' = jsonb_build_array(
    jsonb_build_object('direction', 'CN', 'curatorId', NULL, 'curatorLabel', NULL, 'eligible', FALSE, 'version', 0),
    jsonb_build_object('direction', 'MY', 'curatorId', NULL, 'curatorLabel', NULL, 'eligible', FALSE, 'version', 0)),
  'no row yet: both countries without a curator, version 0');
SELECT pg_temp.a335_assert((SELECT jsonb_agg(c ->> 'id' ORDER BY c ->> 'id') FROM jsonb_array_elements(:'a335_read'::JSONB -> 'curators') c)
    = (SELECT jsonb_agg(c ->> 'id' ORDER BY c ->> 'id') FROM jsonb_array_elements(:'a335_v1'::JSONB -> 'curators') c),
  'the curators that may be chosen are exactly the 174 list');
SELECT pg_temp.a335_assert(pg_temp.a335_as(:'a335_student', format('SELECT platform.country_curators_v1(%L)', pg_temp.a335_id(1))) ->> 'error' = '42501',
  'a Student may not read the setting');

-- ---------------------------------------------------------------------------
-- 3. Save.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a335_save(p_claims TEXT, p_direction TEXT, p_version BIGINT, p_curator UUID, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a335_as(p_claims, format('SELECT platform.country_curator_save_v1(%L, %L, %s, %L, %L)', pg_temp.a335_id(1), p_direction, p_version,
    p_curator, pg_temp.a335_id(p_request)))
$$;
SELECT pg_temp.a335_save(:'a335_admin', 'CN', 0, pg_temp.a335_id(303), 5001) AS a335_saved \gset
SELECT pg_temp.a335_assert(:'a335_saved'::JSONB ->> 'status' = 'saved' AND (:'a335_saved'::JSONB ->> 'version')::INT = 1
    AND :'a335_saved'::JSONB ->> 'curatorId' = pg_temp.a335_id(303)::TEXT AND (:'a335_saved'::JSONB ->> 'replayed')::BOOLEAN = FALSE,
  'the Admin saves the curator of China, version 1');
SELECT pg_temp.a335_assert((pg_temp.a335_save(:'a335_admin', 'CN', 0, pg_temp.a335_id(303), 5001) ->> 'replayed')::BOOLEAN,
  'the same request replays its receipt');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'CN', 0, pg_temp.a335_id(301), 5001) ->> 'error' = '23505',
  'another input under the same request id is refused');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'CN', 0, pg_temp.a335_id(301), 5002) ->> 'error' = 'PT409',
  'a stale version is refused');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'CN', 1, pg_temp.a335_id(303), 5003) ->> 'status' = 'unchanged',
  'the same curator again is unchanged');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'MY', 0, pg_temp.a335_id(302), 5004) ->> 'error' = '22023',
  'a curator outside the 174 list may not be chosen');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'MY', 0, pg_temp.a335_id(304), 5005) ->> 'error' = '22023',
  'a Student may not be chosen as a curator');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'TR', 0, pg_temp.a335_id(303), 5006) ->> 'error' = '22023',
  'an unknown direction is refused');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_student', 'MY', 0, pg_temp.a335_id(303), 5007) ->> 'error' = '42501',
  'a Student may not save');
SELECT pg_temp.a335_assert((SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a335_id(1)
    AND e.action = 'country.curator.change' AND e.resource_type = 'organization' AND e.resource_id = pg_temp.a335_id(1)) = 1,
  'one journal row for the one real change');

-- ---------------------------------------------------------------------------
-- 4. The sales form read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a335_as(:'a335_admin', format('SELECT platform.sales_register_intake_options_v2(%L, %L)', pg_temp.a335_id(1), 'A335')) AS a335_v2 \gset
SELECT pg_temp.a335_assert(:'a335_v2'::JSONB -> 'curators' = :'a335_v1'::JSONB -> 'curators'
    AND (SELECT jsonb_agg(l - 'application_country') FROM jsonb_array_elements(:'a335_v2'::JSONB -> 'leads') l) IS NOT DISTINCT FROM (:'a335_v1'::JSONB -> 'leads')
    AND (:'a335_v2'::JSONB ->> 'organization_id') = pg_temp.a335_id(1)::TEXT,
  'v2 keeps the 174 curators and leads');
SELECT pg_temp.a335_assert(:'a335_v2'::JSONB -> 'country_curators' = jsonb_build_object('CN', pg_temp.a335_id(303), 'MY', NULL),
  'country_curators names the curator of China, none for Malaysia');
SELECT pg_temp.a335_assert((SELECT l ->> 'application_country' FROM jsonb_array_elements(:'a335_v2'::JSONB -> 'leads') l
    WHERE l ->> 'id' = pg_temp.a335_id(3001)::TEXT) = 'MY',
  'a lead with an анкета carries its first destination country');
SELECT pg_temp.a335_assert((SELECT l -> 'application_country' FROM jsonb_array_elements(:'a335_v2'::JSONB -> 'leads') l
    WHERE l ->> 'id' = pg_temp.a335_id(3002)::TEXT) = 'null'::JSONB,
  'a lead without an анкета carries NULL');
SELECT pg_temp.a335_assert(pg_temp.a335_as(:'a335_student',
    format('SELECT platform.sales_register_intake_options_v2(%L, %L)', pg_temp.a335_id(1), 'A335')) ->> 'error' = '42501',
  'a Student is refused the sales form read');
SELECT pg_temp.a335_assert((pg_temp.a335_as(:'a335_admin', format('SELECT platform.country_curators_v1(%L)', pg_temp.a335_id(1))) -> 'countries' -> 0)
    = jsonb_build_object('direction', 'CN', 'curatorId', pg_temp.a335_id(303), 'curatorLabel', 'A335 Actor 3', 'eligible', TRUE, 'version', 1),
  'the setting reads back with the curator name');
SELECT pg_temp.a335_assert(pg_temp.a335_save(:'a335_admin', 'CN', 1, NULL, 5008) ->> 'status' = 'saved'
    AND pg_temp.a335_as(:'a335_admin', format('SELECT platform.sales_register_intake_options_v2(%L, %L)', pg_temp.a335_id(1), 'A335'))
      -> 'country_curators' = jsonb_build_object('CN', NULL, 'MY', NULL),
  'clearing the curator of China removes it from the sales form');

-- ---------------------------------------------------------------------------
-- 5. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a335_assert(bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND count(*) = 3,
  'the three functions: SECURITY DEFINER, empty search_path, authenticated only')
FROM pg_catalog.pg_proc p WHERE p.oid IN (to_regprocedure('platform.country_curators_v1(uuid)'),
  to_regprocedure('platform.country_curator_save_v1(uuid,text,bigint,uuid,uuid)'), to_regprocedure('platform.sales_register_intake_options_v2(uuid,text)'));
SELECT pg_temp.a335_assert(NOT has_table_privilege('authenticated', 'platform_private.country_curators', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'platform_private.country_curators', 'UPDATE'),
  'the table is closed to clients');
SELECT pg_temp.a335_assert((SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('platform.sales_register_intake_options(uuid,text)')) = '9762e2fd5aabfcc6056918b0518448e1',
  '174 is unchanged');

\echo A335_SALES_INTAKE_COUNTRY_CURATOR_SUITE_PASSED
ROLLBACK;
