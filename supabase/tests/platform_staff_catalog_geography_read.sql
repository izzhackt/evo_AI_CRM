\set ON_ERROR_STOP on
-- Boundary suite for migration 354 «staff_catalog_geography_read_v1»: the read-only staff reader of published cities and
-- institution-to-city links behind the CRM country / city / list / map pages. Runs on the real chain right after 354
-- inside one transaction that is rolled back. Synthetic data only.
--
-- Proves: a catalog.read member (staff role, organization scope) and the system Admin get published cities and the links
-- of published institutions to published cities, in the exact key set, nothing else (no draft city, no editor field, no
-- link of a draft-only institution, none to a draft city); a staff member without catalog.read, a Student, anon, the
-- service role, another organization's Admin (and a reader of another organization) and a NULL organization get 42501;
-- another organization's rows never appear; unpublishing a city removes it; the function is SECURITY DEFINER, STABLE, with
-- an empty search_path and executable only by authenticated; the old staff_catalog_geography_v1 keeps refusing a reader
-- without catalog.import.manage.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.a354_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a354_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A354: %', message; END IF;
END
$$;
CREATE TEMP TABLE a354_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, claims TEXT);
CREATE FUNCTION pg_temp.a354_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_claims TEXT;
BEGIN
  IF p_who NOT IN ('anon', 'service_role') THEN
    SELECT a.claims INTO v_claims FROM a354_actors a WHERE a.n = p_who::INTEGER;
    IF v_claims IS NULL THEN RAISE EXCEPTION 'A354: no claims for actor %', p_who; END IF;
  END IF;
  BEGIN
    IF p_who = 'anon' THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::TEXT, TRUE);
      SET LOCAL ROLE anon;
    ELSIF p_who = 'service_role' THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::TEXT, TRUE);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', v_claims, TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RESET ROLE;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
CREATE FUNCTION pg_temp.a354_ok(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a354_call(p_who, p_sql);
  IF NOT r ? 'ok' THEN RAISE EXCEPTION 'A354: % as % failed: %', p_sql, p_who, r; END IF;
  RETURN r -> 'ok';
END
$$;
CREATE FUNCTION pg_temp.a354_state(p_who TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(pg_temp.a354_call(p_who, p_sql) ->> 'error', 'ok')
$$;
CREATE FUNCTION pg_temp.a354_content(p_name TEXT, p_country TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name', p_name, 'country', p_country, 'city', 'A354 raw city', 'overview', 'Synthetic overview',
    'websiteUrl', 'https://university.example-a354.edu', 'sourceUrl', 'https://university.example-a354.edu/admissions',
    'verifiedOn', '2026-11-08', 'notes', '', 'photoKey', NULL,
    'programs', jsonb_build_array(
      jsonb_build_object('id', 'cs', 'title', 'Synthetic computer science', 'level', 'bachelor', 'duration', NULL,
        'language', NULL, 'summary', 'Synthetic public program', 'sourceUrl', 'https://university.example-a354.edu/programs/cs',
        'intakes', jsonb_build_array())))
$$;
CREATE FUNCTION pg_temp.a354_photo(p_path TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('path', p_path, 'width', 2400, 'height', 1600, 'author', 'A354 Photographer',
    'authorUrl', 'https://www.pexels.com/@a354', 'sourceName', 'Pexels', 'sourceUrl', 'https://www.pexels.com/photo/a354-1/',
    'license', 'Pexels License', 'licenseUrl', 'https://www.pexels.com/license/')
$$;

SELECT 'A354_STAFF_CATALOG_GEOGRAPHY_READ_SUITE_START' AS a354_suite_marker;

-- Fixture. Organization A (1): 1 system Admin, 2 reader (staff role with catalog.read, organization scope), 3 staff with a
-- role that does NOT hold catalog.read, 5 Student. Organization B (2): 11 Admin.
INSERT INTO a354_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (5, 1, 'student'), (11, 2, 'admin');
INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.a354_id(1), 'A354 Fictional organization A'), (pg_temp.a354_id(2), 'A354 Fictional organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a354_id(100 + n), 'a354-' || n || '@example.invalid', '{}'::JSONB FROM a354_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a354_id(200 + n), pg_temp.a354_id(100 + n), 'A354 Actor ' || n, 'active', 1 FROM a354_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a354_id(300 + a.n), pg_temp.a354_id(a.org), pg_temp.a354_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    COALESCE(a.coarse = 'admin', FALSE)
  FROM a354_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a354_id(401), pg_temp.a354_id(1), 'organization', pg_temp.a354_id(1), 1),
  (pg_temp.a354_id(402), pg_temp.a354_id(2), 'organization', pg_temp.a354_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a354_id(a.org), pg_temp.a354_id(300 + a.n), pg_temp.a354_id(400 + a.org), 1, 1, TRUE, 'system',
    'A354 synthetic organization scope', pg_temp.a354_id(600 + a.n)
  FROM a354_actors a WHERE a.coarse IS NOT NULL;

CREATE TEMP TABLE a354_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a354_roles VALUES
 (pg_temp.a354_id(1105), 'Reader', '["catalog.read","organization.read"]', 1150),
 (pg_temp.a354_id(1107), 'Tasks only', '["staff.task.read","staff.task.create"]', 1170);
CREATE TEMP TABLE a354_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO a354_grants VALUES
 (302, pg_temp.a354_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.a354_id(1), 'resourceKind', NULL)),
 (303, pg_temp.a354_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.a354_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE a354_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.a354_id(1);
GRANT SELECT ON a354_roles, a354_grants, a354_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a354_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a354_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a354_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a354_admin_setup';
SET LOCAL ROLE authenticated;
DO $a354_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a354_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command('35400000-0000-4000-8000-000000000001'::UUID, r.role_id, 0, 'create',
      jsonb_build_object('label', 'A354 ' || r.label, 'description', 'Migration 354 synthetic role',
        'permissionKeys', r.keys), 'A354 create role',
      ('35400000-0000-4000-8000-' || lpad((r.request_base + 1)::TEXT, 12, '0'))::UUID);
    published := platform.staff_role_publish('35400000-0000-4000-8000-000000000001'::UUID, r.role_id, 1,
      platform.staff_role_impact('35400000-0000-4000-8000-000000000001'::UUID, r.role_id, 1) ->> 'impactFingerprint',
      'A354 publish role', ('35400000-0000-4000-8000-' || lpad((r.request_base + 2)::TEXT, 12, '0'))::UUID);
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a354_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM a354_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save('35400000-0000-4000-8000-000000000001'::UUID,
      ('35400000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID,
      (SELECT access_version FROM a354_versions WHERE membership_id = ('35400000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID),
      items, bindings, 'A354 grant roles', ('35400000-0000-4000-8000-' || lpad((2000 + m)::TEXT, 12, '0'))::UUID);
  END LOOP;
END
$a354_roles$;
RESET ROLE;
UPDATE a354_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.a354_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a354_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a354_assert(platform_private.staff_has_permission(pg_temp.a354_id(1), pg_temp.a354_id(302), 'catalog.read')
    AND NOT platform_private.staff_has_permission(pg_temp.a354_id(1), pg_temp.a354_id(302), 'catalog.import.manage')
    AND NOT platform_private.staff_has_permission(pg_temp.a354_id(1), pg_temp.a354_id(303), 'catalog.read'),
  'fixture: the reader holds catalog.read only; the other staff member does not');

-- Catalogue (replica mode skips triggers and the import-provenance FK; every CHECK still applies).
-- Org A: cities alpha-city, beta-city (published), draft-city (draft); institutions 701 published -> alpha-city,
-- 702 published -> draft-city, 703 draft-only -> alpha-city, 704 published without a link. Org B: foreign-city, 711.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
  SELECT pg_temp.a354_id(700 + u.n), pg_temp.a354_id(u.org), 'university', u.name, 'CN', 'A354 raw city',
    pg_temp.a354_id(720 + u.n), 'synthetic-a354-rev', pg_temp.a354_id(740 + u.n), 'rec_' || repeat(u.letter, 32),
    pg_temp.a354_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END)
  FROM (VALUES (1, 1, 'A354 Alpha', 'a'), (2, 1, 'A354 Beta', 'b'), (3, 1, 'A354 Draft only', 'c'),
    (4, 1, 'A354 Unlinked', 'd'), (11, 2, 'A354 Foreign', 'f')) AS u(n, org, name, letter);
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
  SELECT pg_temp.a354_id(760 + u.n), pg_temp.a354_id(u.org), pg_temp.a354_id(700 + u.n), 0,
    CASE WHEN u.status = 'published' THEN 1 END, pg_temp.a354_content(u.name, 'CN'), pg_temp.a354_id(720 + u.n), u.status,
    'A354 synthetic review', pg_temp.a354_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END),
    CASE WHEN u.status = 'published' THEN pg_temp.a354_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END) END,
    CASE WHEN u.status = 'published' THEN statement_timestamp() END
  FROM (VALUES (1, 1, 'A354 Alpha', 'published'), (2, 1, 'A354 Beta', 'published'), (3, 1, 'A354 Draft only', 'draft'),
    (4, 1, 'A354 Unlinked', 'published'), (11, 2, 'A354 Foreign', 'published')) AS u(n, org, name, status);
INSERT INTO platform.catalog_cities(organization_id, city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo,
  summary_ru, summary_ky, fact_ru, fact_ky, fact_source_url, fact_verified_on, ky_review, status, published_at, published_via)
  SELECT pg_temp.a354_id(c.org), c.key, 'CN', c.name, c.name, 'A354 ' || c.key, 30.27, 120.15,
    pg_temp.a354_photo('geography/cities/cn-' || c.key || '-0123456789ab.jpg'),
    'Синтетический город ' || c.key, 'Шаар ' || c.key, 'Синтетический факт.', 'Синтетикалык факт.',
    'https://en.wikipedia.org/wiki/A354', DATE '2026-11-08', 'pending', 'published', statement_timestamp(), 'migration'
  FROM (VALUES (1, 'beta-city', 'Бета город'), (1, 'alpha-city', 'Альфа город'), (2, 'foreign-city', 'Чужой город')) AS c(org, key, name);
INSERT INTO platform.catalog_cities(organization_id, city_key, country_code, name_ru, name_ky, name_en, status)
  VALUES (pg_temp.a354_id(1), 'draft-city', 'CN', 'Черновой город', 'Черновой город', 'A354 draft-city', 'draft');
INSERT INTO platform.catalog_institution_cities(institution_id, organization_id, city_key, assigned_via) VALUES
  (pg_temp.a354_id(701), pg_temp.a354_id(1), 'alpha-city', 'migration'),
  (pg_temp.a354_id(702), pg_temp.a354_id(1), 'draft-city', 'migration'),
  (pg_temp.a354_id(703), pg_temp.a354_id(1), 'alpha-city', 'migration'),
  (pg_temp.a354_id(711), pg_temp.a354_id(2), 'foreign-city', 'migration');
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- Allowed: the reader and the system Admin get published cities and links of published institutions.
-- ===========================================================================
SELECT pg_temp.a354_ok('2', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') AS a354_reader \gset
SELECT pg_temp.a354_ok('1', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') AS a354_admin \gset
SELECT pg_temp.a354_assert(:'a354_reader'::JSONB = :'a354_admin'::JSONB, 'the reader and the Admin read the same data');
SELECT pg_temp.a354_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a354_reader'::JSONB) k)
    = ARRAY['cities', 'institutions', 'organizationId']
  AND :'a354_reader'::JSONB ->> 'organizationId' = pg_temp.a354_id(1)::TEXT, 'top-level keys');
SELECT pg_temp.a354_assert((SELECT array_agg(c ->> 'key' ORDER BY ord) FROM jsonb_array_elements(:'a354_reader'::JSONB -> 'cities') WITH ORDINALITY x(c, ord))
    = ARRAY['alpha-city', 'beta-city'], 'published cities only, in name order (no draft city, no other organization)');
SELECT pg_temp.a354_assert((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c) k)
      = ARRAY['country', 'key', 'lat', 'lng', 'nameEn', 'nameKy', 'nameRu', 'photo', 'summaryRu'])
    FROM jsonb_array_elements(:'a354_reader'::JSONB -> 'cities') c), 'a city carries exactly the browse fields, no editor field');
SELECT pg_temp.a354_assert((SELECT bool_and(c -> 'photo' ->> 'path' LIKE 'geography/cities/cn-%' AND c ->> 'summaryRu' IS NOT NULL)
    FROM jsonb_array_elements(:'a354_reader'::JSONB -> 'cities') c), 'photo and Russian text reach the reader');
SELECT pg_temp.a354_assert(:'a354_reader'::JSONB -> 'institutions'
    = jsonb_build_array(jsonb_build_object('id', pg_temp.a354_id(701), 'cityKey', 'alpha-city')),
  'only the published institution linked to a published city: not the draft-only one, not one linked to a draft city, not an unlinked one');
SELECT pg_temp.a354_assert((:'a354_reader'::TEXT) !~ '(kyReview|summaryKy|factRu|factKy|factSource|reviewedBy|publishedAt|version|draft-city|foreign-city)',
  'no editor field, draft city or foreign row in the payload');

-- Another organization sees only its own rows.
SELECT pg_temp.a354_ok('11', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000002'')') AS a354_foreign \gset
SELECT pg_temp.a354_assert((SELECT array_agg(c ->> 'key') FROM jsonb_array_elements(:'a354_foreign'::JSONB -> 'cities') c) = ARRAY['foreign-city']
  AND :'a354_foreign'::JSONB -> 'institutions' = jsonb_build_array(jsonb_build_object('id', pg_temp.a354_id(711), 'cityKey', 'foreign-city')),
  'organization B reads only its own city and link');

-- ===========================================================================
-- Refused with 42501.
-- ===========================================================================
SELECT pg_temp.a354_assert(pg_temp.a354_state('3', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'staff without catalog.read was served');
SELECT pg_temp.a354_assert(pg_temp.a354_state('5', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'a Student was served');
SELECT pg_temp.a354_assert(pg_temp.a354_state('anon', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'anon was served');
SELECT pg_temp.a354_assert(pg_temp.a354_state('service_role', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'the service role was served');
SELECT pg_temp.a354_assert(pg_temp.a354_state('11', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'another organization''s Admin read organization A');
SELECT pg_temp.a354_assert(pg_temp.a354_state('2', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000002'')') = '42501',
  'a reader of A read organization B');
SELECT pg_temp.a354_assert(pg_temp.a354_state('1', 'platform.staff_catalog_geography_read_v1(NULL)') = '42501', 'a NULL organization was served');
-- The old editor read keeps its own, narrower gate and shape.
SELECT pg_temp.a354_assert(pg_temp.a354_state('2', 'platform.staff_catalog_geography_v1(''35400000-0000-4000-8000-000000000001'')') = '42501',
  'staff_catalog_geography_v1 started serving a member without catalog.import.manage');

-- ===========================================================================
-- Unpublishing removes a city and its links; posture of the function.
-- ===========================================================================
SET LOCAL session_replication_role = replica;
UPDATE platform.catalog_cities SET status = 'draft', published_at = NULL, published_via = NULL, reviewed_by_membership_id = NULL
  WHERE organization_id = pg_temp.a354_id(1) AND city_key = 'alpha-city';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a354_ok('2', 'platform.staff_catalog_geography_read_v1(''35400000-0000-4000-8000-000000000001'')') AS a354_after \gset
SELECT pg_temp.a354_assert((SELECT array_agg(c ->> 'key') FROM jsonb_array_elements(:'a354_after'::JSONB -> 'cities') c) = ARRAY['beta-city']
  AND :'a354_after'::JSONB -> 'institutions' = '[]'::JSONB, 'an unpublished city and its links are gone');

SELECT pg_temp.a354_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0),
  'SECURITY DEFINER, STABLE, empty search_path, executable by authenticated only')
FROM pg_catalog.pg_proc p WHERE p.oid = 'platform.staff_catalog_geography_read_v1(uuid)'::REGPROCEDURE;

SELECT 'A354_STAFF_CATALOG_GEOGRAPHY_READ_SUITE_PASSED' AS a354_suite_marker;
ROLLBACK;
