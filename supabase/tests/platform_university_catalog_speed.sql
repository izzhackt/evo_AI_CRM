\set ON_ERROR_STOP on
-- Boundary suite for migration 364 «скорость раздела Университеты»: the light staff catalogue read
-- `staff_university_catalog_rows_v1`, the set-based `staff_catalog_geography_v1` and the narrow
-- `staff_catalog_institution_geography_v1`. Runs on the real chain right after 364 inside one transaction that is rolled
-- back. Synthetic data only.
--
-- Proves: (1) access is unchanged — for every actor the light read succeeds or fails exactly like the old
-- `staff_university_catalog` (a reader and the Admin are served; staff without catalog.read, another organization, anon and
-- the service role get 42501), and the narrow geography exactly like `staff_catalog_geography_v1` (catalog.import.manage
-- only); (2) the light rows equal, for several filters, the projection of the full cards the old pager returns (latest
-- version only, no draft, no other organization, same order, same filter checks with 22023); more than 1 200 matches give
-- complete = false without rows; (3) `staff_catalog_geography_v1` returns exactly what its 283 body with the per-row
-- helpers returned, and the narrow answer is that answer cut to one institution (nothing of another organization);
-- (4) the posture: SECURITY DEFINER, STABLE, empty search_path, EXECUTE for authenticated only (the builder for nobody),
-- the per-row helpers are gone.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.a364_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a364_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A364: %', message; END IF;
END
$$;
CREATE TEMP TABLE a364_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, claims TEXT);
CREATE FUNCTION pg_temp.a364_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_claims TEXT;
BEGIN
  IF p_who NOT IN ('anon', 'service_role') THEN
    SELECT a.claims INTO v_claims FROM a364_actors a WHERE a.n = p_who::INTEGER;
    IF v_claims IS NULL THEN RAISE EXCEPTION 'A364: no claims for actor %', p_who; END IF;
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
CREATE FUNCTION pg_temp.a364_ok(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a364_call(p_who, p_sql);
  IF NOT r ? 'ok' THEN RAISE EXCEPTION 'A364: % as % failed: %', p_sql, p_who, r; END IF;
  RETURN r -> 'ok';
END
$$;
CREATE FUNCTION pg_temp.a364_state(p_who TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(pg_temp.a364_call(p_who, p_sql) ->> 'error', 'ok')
$$;
CREATE FUNCTION pg_temp.a364_intake(p_label TEXT, p_status TEXT, p_deadline TEXT, p_time TEXT, p_zone TEXT) RETURNS JSONB
LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('label', p_label, 'startDate', NULL, 'startMonth', '2027-09', 'applicationDeadline', p_deadline,
    'deadlineTime', p_time, 'timezone', p_zone, 'status', p_status, 'note', '',
    'sourceUrl', 'https://university.example-a364.edu/intakes', 'verifiedOn', '2026-11-01')
$$;
CREATE FUNCTION pg_temp.a364_program(p_id TEXT, p_level TEXT, p_intakes JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('id', p_id, 'title', 'A364 programme ' || p_id, 'level', p_level, 'duration', '4 years',
    'language', 'English', 'summary', 'Synthetic public program', 'sourceUrl', 'https://university.example-a364.edu/programs/' || p_id,
    'intakes', p_intakes)
$$;
CREATE FUNCTION pg_temp.a364_content(p_name TEXT, p_country TEXT, p_city TEXT, p_photo TEXT, p_programs JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('name', p_name, 'country', p_country, 'city', p_city, 'overview', 'Synthetic overview',
    'websiteUrl', 'https://university.example-a364.edu', 'sourceUrl', 'https://university.example-a364.edu/admissions',
    'verifiedOn', '2026-11-02', 'notes', '', 'photoKey', p_photo, 'programs', p_programs)
$$;
CREATE FUNCTION pg_temp.a364_photo(p_path TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('path', p_path, 'width', 2400, 'height', 1600, 'author', 'A364 Photographer',
    'authorUrl', 'https://www.pexels.com/@a364', 'sourceName', 'Pexels', 'sourceUrl', 'https://www.pexels.com/photo/a364-1/',
    'license', 'Pexels License', 'licenseUrl', 'https://www.pexels.com/license/')
$$;

-- The 283 answer of staff_catalog_geography_v1, kept here as the reference: its body with the two per-row helpers that
-- 364 drops, verbatim apart from the names.
CREATE FUNCTION pg_temp.a364_old_cost_json(c platform.catalog_costs) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'institutionId', c.institution_id, 'programId', c.program_id, 'studyLevel', c.study_level,
    'teachingLanguage', c.teaching_language, 'costKind', c.cost_kind, 'period', c.period,
    'amountMinMinor', c.amount_min_minor, 'amountMaxMinor', c.amount_max_minor, 'currency', c.currency,
    'exponent', platform_private.catalog_currency_exponent(c.currency),
    'academicYear', c.academic_year, 'noteRu', c.note_ru, 'noteKy', c.note_ky,
    'sourceKind', c.source_kind, 'sourceName', c.source_name, 'sourceUrl', c.source_url, 'verifiedOn', c.verified_on,
    'confirmedAt', c.confirmed_at, 'confirmedOn', c.confirmed_on, 'confirmationReason', c.confirmation_reason,
    'confirmedByName', (SELECT p.display_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = c.organization_id AND m.id = c.confirmed_by_membership_id),
    'status', c.status, 'publishedAt', c.published_at, 'version', c.version, 'importKey', c.import_key,
    'createdAt', c.created_at, 'updatedAt', c.updated_at)
$$;
CREATE FUNCTION pg_temp.a364_old_city_json(c platform.catalog_cities) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'key', c.city_key, 'country', c.country_code, 'nameRu', c.name_ru, 'nameKy', c.name_ky, 'nameEn', c.name_en,
    'lat', c.lat, 'lng', c.lng, 'photo', c.photo, 'summaryRu', c.summary_ru, 'summaryKy', c.summary_ky,
    'factRu', c.fact_ru, 'factKy', c.fact_ky, 'factSourceUrl', c.fact_source_url, 'factVerifiedOn', c.fact_verified_on,
    'kyReview', c.ky_review, 'status', c.status, 'publishedAt', c.published_at, 'publishedVia', c.published_via,
    'reviewedByName', (SELECT p.display_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = c.organization_id AND m.id = c.reviewed_by_membership_id),
    'complete', c.photo IS NOT NULL AND c.summary_ru IS NOT NULL AND c.fact_ru IS NOT NULL
      AND c.fact_source_url IS NOT NULL AND c.fact_verified_on IS NOT NULL,
    'version', c.version, 'updatedAt', c.updated_at,
    'institutionCount', (SELECT count(*) FROM platform.catalog_institution_cities l
      WHERE l.organization_id = c.organization_id AND l.city_key = c.city_key))
$$;
CREATE FUNCTION pg_temp.a364_old_geography(p_organization_id UUID) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'countries', (SELECT jsonb_agg(jsonb_build_object(
        'code', s.country_code, 'nameRu', s.name_ru, 'nameKy', s.name_ky, 'nameEn', s.name_en,
        'photo', s.photo, 'summaryRu', s.summary_ru, 'summaryKy', s.summary_ky, 'kyReview', s.ky_review)
      ORDER BY s.sort_order) FROM platform.study_countries s),
    'cities', COALESCE((SELECT jsonb_agg(pg_temp.a364_old_city_json(c)
      ORDER BY s.sort_order, c.name_ru, c.city_key)
      FROM platform.catalog_cities c JOIN platform.study_countries s ON s.country_code = c.country_code
      WHERE c.organization_id = p_organization_id), '[]'::JSONB),
    'institutions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.institution_name, 'country', i.country_code, 'cityLabel', i.city,
        'published', EXISTS (SELECT 1 FROM platform_private.university_catalog_publications p
          WHERE p.organization_id = i.organization_id AND p.institution_id = i.id AND p.status = 'published'),
        'cityKey', l.city_key, 'assignedVia', l.assigned_via, 'assignedAt', l.assigned_at)
      ORDER BY s.sort_order, i.institution_name, i.id)
      FROM platform.catalog_institutions i
      JOIN platform.study_countries s ON s.country_code = i.country_code
      LEFT JOIN platform.catalog_institution_cities l ON l.organization_id = i.organization_id AND l.institution_id = i.id
      WHERE i.organization_id = p_organization_id), '[]'::JSONB),
    'costs', COALESCE((SELECT jsonb_agg(pg_temp.a364_old_cost_json(c)
      ORDER BY c.institution_id, c.cost_kind, c.created_at, c.id)
      FROM platform.catalog_costs c WHERE c.organization_id = p_organization_id), '[]'::JSONB),
    'fxRates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'currency', r.currency, 'asOf', r.as_of, 'unitsPerUsd', r.units_per_usd,
        'sourceName', r.source_name, 'sourceUrl', r.source_url, 'setAt', r.set_at,
        'ageDays', current_date - r.as_of,
        'latest', r.as_of = (SELECT max(x.as_of) FROM platform.catalog_fx_rates x
          WHERE x.organization_id = r.organization_id AND x.currency = r.currency))
      ORDER BY r.currency, r.as_of DESC)
      FROM platform.catalog_fx_rates r WHERE r.organization_id = p_organization_id), '[]'::JSONB))
$$;
-- The full answer cut to one institution, as the card panel cuts it.
CREATE FUNCTION pg_temp.a364_cut(g JSONB, p_institution UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'countries', g -> 'countries',
    'cities', COALESCE((SELECT jsonb_agg(c ORDER BY o) FROM jsonb_array_elements(g -> 'cities') WITH ORDINALITY AS t(c, o)
      WHERE c ->> 'country' = (SELECT x ->> 'country' FROM jsonb_array_elements(g -> 'institutions') x WHERE x ->> 'id' = p_institution::TEXT)), '[]'::JSONB),
    'institutions', COALESCE((SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(g -> 'institutions') WITH ORDINALITY AS t(x, o)
      WHERE x ->> 'id' = p_institution::TEXT), '[]'::JSONB),
    'costs', COALESCE((SELECT jsonb_agg(c ORDER BY o) FROM jsonb_array_elements(g -> 'costs') WITH ORDINALITY AS t(c, o)
      WHERE c ->> 'institutionId' = p_institution::TEXT), '[]'::JSONB),
    'fxRates', g -> 'fxRates')
$$;
-- The light rows the old pager implies: the full cards of every page, projected with plain JSON operators.
CREATE FUNCTION pg_temp.a364_expected_rows(p_who TEXT, p_org INTEGER, p_args TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE pages JSONB := '[]'::JSONB; page JSONB; v_offset INTEGER := 0;
BEGIN
  LOOP
    page := pg_temp.a364_ok(p_who, format('platform.staff_university_catalog(%L, %s, NULL, %s)', pg_temp.a364_id(p_org), p_args, v_offset));
    pages := pages || (page -> 'items');
    EXIT WHEN page -> 'nextOffset' = 'null'::JSONB;
    v_offset := v_offset + 30;
  END LOOP;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', it -> 'id', 'version', it -> 'version', 'publishedAt', it -> 'publishedAt',
    'content', jsonb_build_object('name', it -> 'content' -> 'name', 'country', it -> 'content' -> 'country',
      'city', it -> 'content' -> 'city', 'verifiedOn', it -> 'content' -> 'verifiedOn', 'photoKey', it -> 'content' -> 'photoKey'),
    'levels', (SELECT COALESCE(jsonb_object_agg(lv, cnt), '{}'::JSONB)
      FROM (SELECT p ->> 'level' AS lv, count(*) AS cnt FROM jsonb_array_elements(it -> 'content' -> 'programs') p GROUP BY 1) z),
    'deadlinePrograms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p -> 'id', 'level', p -> 'level', 'title', p -> 'title',
        'intakes', (SELECT jsonb_agg(jsonb_build_object('label', i -> 'label', 'applicationDeadline', i -> 'applicationDeadline',
            'deadlineTime', i -> 'deadlineTime', 'timezone', i -> 'timezone', 'status', i -> 'status',
            'verifiedOn', i -> 'verifiedOn', 'sourceUrl', i -> 'sourceUrl') ORDER BY io)
          FROM jsonb_array_elements(p -> 'intakes') WITH ORDINALITY AS u(i, io) WHERE i ->> 'status' IN ('open', 'announced'))) ORDER BY po)
      FROM jsonb_array_elements(it -> 'content' -> 'programs') WITH ORDINALITY AS v(p, po)
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'intakes') i WHERE i ->> 'status' IN ('open', 'announced'))), '[]'::JSONB))
    ORDER BY n) FROM jsonb_array_elements(pages) WITH ORDINALITY AS t(it, n)), '[]'::JSONB);
END
$$;

SELECT 'A364_UNIVERSITY_CATALOG_SPEED_SUITE_START' AS a364_suite_marker;

-- Fixture. Organization A (1): 1 system Admin, 2 reader (catalog.read), 3 staff without catalog.read, 4 catalogue manager
-- (catalog.read and catalog.import.manage), 5 Student. Organization B (2): 11 Admin. Organization C (3): 21 Admin.
INSERT INTO a364_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL), (5, 1, 'student'),
  (11, 2, 'admin'), (21, 3, 'admin');
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a364_id(1), 'A364 Fictional organization A'),
  (pg_temp.a364_id(2), 'A364 Fictional organization B'), (pg_temp.a364_id(3), 'A364 Fictional organization C');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a364_id(100 + n), 'a364-' || n || '@example.invalid', '{}'::JSONB FROM a364_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a364_id(200 + n), pg_temp.a364_id(100 + n), 'A364 Actor ' || n, 'active', 1 FROM a364_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a364_id(300 + a.n), pg_temp.a364_id(a.org), pg_temp.a364_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    COALESCE(a.coarse = 'admin', FALSE)
  FROM a364_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a364_id(400 + o), pg_temp.a364_id(o), 'organization', pg_temp.a364_id(o), 1 FROM generate_series(1, 3) o;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a364_id(a.org), pg_temp.a364_id(300 + a.n), pg_temp.a364_id(400 + a.org), 1, 1, TRUE, 'system',
    'A364 synthetic organization scope', pg_temp.a364_id(600 + a.n)
  FROM a364_actors a WHERE a.coarse IS NOT NULL;

CREATE TEMP TABLE a364_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a364_roles VALUES
 (pg_temp.a364_id(1105), 'Reader', '["catalog.read","organization.read"]', 1150),
 (pg_temp.a364_id(1106), 'Catalogue manager', '["catalog.read","catalog.import.manage","organization.read"]', 1160),
 (pg_temp.a364_id(1107), 'Tasks only', '["staff.task.read","staff.task.create"]', 1170);
CREATE TEMP TABLE a364_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO a364_grants VALUES
 (302, pg_temp.a364_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.a364_id(1), 'resourceKind', NULL)),
 (303, pg_temp.a364_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.a364_id(1), 'resourceKind', NULL)),
 (304, pg_temp.a364_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.a364_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE a364_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.a364_id(1);
GRANT SELECT ON a364_roles, a364_grants, a364_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a364_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a364_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a364_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a364_admin_setup';
SET LOCAL ROLE authenticated;
DO $a364_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a364_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command('36400000-0000-4000-8000-000000000001'::UUID, r.role_id, 0, 'create',
      jsonb_build_object('label', 'A364 ' || r.label, 'description', 'Migration 364 synthetic role',
        'permissionKeys', r.keys), 'A364 create role',
      ('36400000-0000-4000-8000-' || lpad((r.request_base + 1)::TEXT, 12, '0'))::UUID);
    published := platform.staff_role_publish('36400000-0000-4000-8000-000000000001'::UUID, r.role_id, 1,
      platform.staff_role_impact('36400000-0000-4000-8000-000000000001'::UUID, r.role_id, 1) ->> 'impactFingerprint',
      'A364 publish role', ('36400000-0000-4000-8000-' || lpad((r.request_base + 2)::TEXT, 12, '0'))::UUID);
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a364_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM a364_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save('36400000-0000-4000-8000-000000000001'::UUID,
      ('36400000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID,
      (SELECT access_version FROM a364_versions WHERE membership_id = ('36400000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID),
      items, bindings, 'A364 grant roles', ('36400000-0000-4000-8000-' || lpad((2000 + m)::TEXT, 12, '0'))::UUID);
  END LOOP;
END
$a364_roles$;
RESET ROLE;
UPDATE a364_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.a364_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a364_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a364_assert(platform_private.staff_has_permission(pg_temp.a364_id(1), pg_temp.a364_id(302), 'catalog.read')
    AND NOT platform_private.staff_has_permission(pg_temp.a364_id(1), pg_temp.a364_id(302), 'catalog.import.manage')
    AND NOT platform_private.staff_has_permission(pg_temp.a364_id(1), pg_temp.a364_id(303), 'catalog.read')
    AND platform_private.staff_has_permission(pg_temp.a364_id(1), pg_temp.a364_id(304), 'catalog.import.manage'),
  'fixture: 2 reads only, 3 has no catalog.read, 4 manages the catalogue');

-- Catalogue (replica mode skips triggers and the import-provenance FK; every CHECK, including the content check, applies).
-- Org A: 701 Alpha (CN, two published versions), 702 Beta (MY, no city), 703 draft only, 704 Gamma (TR), 705 outside the
-- six countries (US); org B: 711. Programmes mix every level and every intake status.
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE a364_cards(n INTEGER, org INTEGER, version INTEGER, status TEXT, content JSONB);
INSERT INTO a364_cards VALUES
 (1, 1, 1, 'published', pg_temp.a364_content('A364 Alpha University (old name)', 'CN', 'Alpha City', NULL, jsonb_build_array(
    pg_temp.a364_program('old', 'bachelor', '[]'::JSONB)))),
 (1, 1, 2, 'published', pg_temp.a364_content('A364 Alpha University', 'CN', 'Alpha City', 'sunway', jsonb_build_array(
    pg_temp.a364_program('cs', 'bachelor', jsonb_build_array(
      pg_temp.a364_intake('Autumn 2026', 'closed', '2026-06-01', NULL, 'Asia/Shanghai'),
      pg_temp.a364_intake('Autumn 2027', 'open', '2027-03-01', '23:59', 'Asia/Shanghai'))),
    pg_temp.a364_program('mba', 'master', jsonb_build_array(pg_temp.a364_intake('Spring 2027', 'announced', NULL, NULL, NULL))),
    pg_temp.a364_program('lang', 'language', '[]'::JSONB),
    pg_temp.a364_program('ee', 'bachelor', jsonb_build_array(pg_temp.a364_intake('Rolling', 'unknown', NULL, NULL, NULL)))))),
 (2, 1, 1, 'published', pg_temp.a364_content('A364 Beta Institute', 'MY', NULL, NULL, jsonb_build_array(
    pg_temp.a364_program('fdn', 'foundation', jsonb_build_array(pg_temp.a364_intake('January', 'needs_reconfirmation', '2027-01-10', NULL, 'Asia/Kuala_Lumpur'))),
    pg_temp.a364_program('dip', 'diploma', jsonb_build_array(pg_temp.a364_intake('May', 'open', '2027-04-30', NULL, 'Asia/Kuala_Lumpur')))))),
 (3, 1, NULL, 'draft', pg_temp.a364_content('A364 Draft Only', 'CN', 'Alpha City', NULL, jsonb_build_array(
    pg_temp.a364_program('cs', 'bachelor', jsonb_build_array(pg_temp.a364_intake('Autumn 2027', 'open', '2027-02-01', NULL, 'Asia/Shanghai')))))),
 (4, 1, 1, 'published', pg_temp.a364_content('a364 gamma college', 'TR', 'Istanbul', 'mmu', jsonb_build_array(
    pg_temp.a364_program('phd', 'doctorate', jsonb_build_array(
      pg_temp.a364_intake('Fall', 'open', NULL, NULL, NULL),
      pg_temp.a364_intake('Spring', 'announced', '2027-01-15', NULL, 'Europe/Istanbul')))))),
 (5, 1, 1, 'published', pg_temp.a364_content('A364 Outside University', 'US', 'Boston', NULL, jsonb_build_array(
    pg_temp.a364_program('ms', 'master', '[]'::JSONB)))),
 (11, 2, 1, 'published', pg_temp.a364_content('A364 Foreign University', 'CN', 'Alpha City', NULL, jsonb_build_array(
    pg_temp.a364_program('cs', 'bachelor', jsonb_build_array(pg_temp.a364_intake('Autumn 2027', 'open', '2027-03-01', NULL, 'Asia/Shanghai'))))));
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
  SELECT DISTINCT ON (c.n) pg_temp.a364_id(700 + c.n), pg_temp.a364_id(c.org), 'university', c.content ->> 'name', c.content ->> 'country',
    c.content ->> 'city', pg_temp.a364_id(720 + c.n), 'synthetic-a364-rev', pg_temp.a364_id(740 + c.n),
    'rec_' || md5('a364-' || c.n), pg_temp.a364_id(CASE c.org WHEN 1 THEN 301 ELSE 311 END)
  FROM a364_cards c ORDER BY c.n, c.version DESC NULLS LAST;
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
  SELECT pg_temp.a364_id(5000 + c.n * 10 + COALESCE(c.version, 0)), pg_temp.a364_id(c.org), pg_temp.a364_id(700 + c.n),
    COALESCE(c.version, 1) - 1, c.version, c.content, pg_temp.a364_id(720 + c.n), c.status, 'A364 synthetic review',
    pg_temp.a364_id(CASE c.org WHEN 1 THEN 301 ELSE 311 END),
    CASE WHEN c.status = 'published' THEN pg_temp.a364_id(CASE c.org WHEN 1 THEN 301 ELSE 311 END) END,
    CASE WHEN c.status = 'published' THEN TIMESTAMPTZ '2026-11-10 08:00:00+00' + c.n * INTERVAL '1 hour' + COALESCE(c.version, 0) * INTERVAL '1 minute' END
  FROM a364_cards c;

INSERT INTO platform.catalog_cities(organization_id, city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo,
  summary_ru, summary_ky, fact_ru, fact_ky, fact_source_url, fact_verified_on, ky_review, status, published_at, published_via,
  reviewed_by_membership_id)
  SELECT pg_temp.a364_id(c.org), c.key, c.country, c.name, c.name, 'A364 ' || c.key, 30.27, 120.15,
    pg_temp.a364_photo('geography/cities/' || lower(c.country) || '-' || c.key || '-0123456789ab.jpg'),
    'Синтетический город ' || c.key, 'Шаар ' || c.key, 'Синтетический факт.', 'Синтетикалык факт.',
    'https://en.wikipedia.org/wiki/A364', DATE '2026-11-08', 'pending', 'published', TIMESTAMPTZ '2026-11-09 10:00:00+00', 'migration',
    c.reviewer
  FROM (VALUES (1, 'alpha-city', 'CN', 'Альфа город', pg_temp.a364_id(301)), (1, 'beta-city', 'MY', 'Бета город', NULL::UUID),
    (2, 'foreign-city', 'CN', 'Чужой город', NULL::UUID)) AS c(org, key, country, name, reviewer);
INSERT INTO platform.catalog_cities(organization_id, city_key, country_code, name_ru, name_ky, name_en, status)
  VALUES (pg_temp.a364_id(1), 'draft-city', 'CN', 'Черновой город', 'Черновой город', 'A364 draft-city', 'draft');
INSERT INTO platform.catalog_institution_cities(institution_id, organization_id, city_key, assigned_via, assigned_by_membership_id) VALUES
  (pg_temp.a364_id(701), pg_temp.a364_id(1), 'alpha-city', 'migration', NULL),
  (pg_temp.a364_id(702), pg_temp.a364_id(1), 'beta-city', 'staff', pg_temp.a364_id(304)),
  (pg_temp.a364_id(703), pg_temp.a364_id(1), 'draft-city', 'migration', NULL),
  (pg_temp.a364_id(711), pg_temp.a364_id(2), 'foreign-city', 'migration', NULL);
INSERT INTO platform.catalog_costs(id, organization_id, institution_id, program_id, study_level, cost_kind, period,
  amount_min_minor, amount_max_minor, currency, source_kind, source_name, source_url, verified_on, confirmed_by_membership_id,
  confirmed_at, confirmed_on, confirmation_reason, status, published_at, published_by_membership_id, request_id, import_key,
  created_by_membership_id, created_at, updated_by_membership_id, updated_at)
  SELECT pg_temp.a364_id(800 + k.n), pg_temp.a364_id(k.org), pg_temp.a364_id(700 + k.inst), k.program, k.level, k.kind, 'year',
    k.amount, k.amount_max, k.currency, k.source, 'A364 source', 'https://university.example-a364.edu/fees', DATE '2026-11-01',
    k.confirmer, CASE WHEN k.confirmer IS NOT NULL THEN TIMESTAMPTZ '2026-11-05 09:00:00+00' END,
    CASE WHEN k.confirmer IS NOT NULL THEN DATE '2026-11-05' END, CASE WHEN k.confirmer IS NOT NULL THEN 'A364 confirmed by phone' END,
    k.status, CASE WHEN k.status = 'published' THEN TIMESTAMPTZ '2026-11-06 09:00:00+00' END,
    CASE WHEN k.status = 'published' THEN pg_temp.a364_id(CASE k.org WHEN 1 THEN 301 ELSE 311 END) END,
    pg_temp.a364_id(900 + k.n), CASE WHEN k.n = 1 THEN 'a364:import:1' END,
    pg_temp.a364_id(CASE k.org WHEN 1 THEN 301 ELSE 311 END), TIMESTAMPTZ '2026-11-01 08:00:00+00' + k.n * INTERVAL '1 minute',
    pg_temp.a364_id(CASE k.org WHEN 1 THEN 301 ELSE 311 END), TIMESTAMPTZ '2026-11-02 08:00:00+00' + k.n * INTERVAL '1 minute'
  FROM (VALUES
    (1, 1, 1, 'cs', 'bachelor', 'tuition', 2500000, NULL::BIGINT, 'CNY', 'official', NULL::UUID, 'published'),
    (2, 1, 1, NULL, NULL, 'accommodation', 120000, 180000, 'JPY', 'official', NULL::UUID, 'draft'),
    (3, 1, 4, NULL, 'doctorate', 'tuition', 1500000, NULL::BIGINT, 'KWD', 'agency', pg_temp.a364_id(301), 'published'),
    (4, 1, 5, NULL, NULL, 'application_fee', 10000, NULL::BIGINT, 'USD', 'official', NULL::UUID, 'retired'),
    (5, 1, 2, 'dip', 'diploma', 'tuition', 3000000, NULL::BIGINT, 'MYR', 'official', NULL::UUID, 'published'),
    (6, 2, 11, NULL, NULL, 'tuition', 2000000, NULL::BIGINT, 'CNY', 'official', NULL::UUID, 'published'))
    AS k(n, org, inst, program, level, kind, amount, amount_max, currency, source, confirmer, status);
INSERT INTO platform.catalog_fx_rates(organization_id, currency, as_of, units_per_usd, source_name, source_url, set_by_membership_id,
  set_at, request_id) VALUES
  (pg_temp.a364_id(1), 'CNY', DATE '2026-10-01', 7.1, 'A364 bank', 'https://university.example-a364.edu/fx', pg_temp.a364_id(301), TIMESTAMPTZ '2026-10-01 09:00:00+00', pg_temp.a364_id(951)),
  (pg_temp.a364_id(1), 'CNY', DATE '2026-11-01', 7.2, 'A364 bank', NULL, pg_temp.a364_id(301), TIMESTAMPTZ '2026-11-01 09:00:00+00', pg_temp.a364_id(952)),
  (pg_temp.a364_id(1), 'MYR', DATE '2026-11-01', 4.4, 'A364 bank', NULL, pg_temp.a364_id(301), TIMESTAMPTZ '2026-11-01 09:00:00+00', pg_temp.a364_id(953)),
  (pg_temp.a364_id(2), 'CNY', DATE '2026-11-01', 7.0, 'A364 bank', NULL, pg_temp.a364_id(311), TIMESTAMPTZ '2026-11-01 09:00:00+00', pg_temp.a364_id(954));
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- 1. Access is unchanged.
-- ===========================================================================
DO $a364_access$
DECLARE who TEXT; org INTEGER; old_state TEXT; new_state TEXT;
BEGIN
  FOREACH who IN ARRAY ARRAY['1', '2', '3', '4', '5', '11', '21', 'anon', 'service_role'] LOOP
    FOREACH org IN ARRAY ARRAY[1, 2] LOOP
      old_state := pg_temp.a364_state(who, format('platform.staff_university_catalog(%L)', pg_temp.a364_id(org)));
      new_state := pg_temp.a364_state(who, format('platform.staff_university_catalog_rows_v1(%L)', pg_temp.a364_id(org)));
      PERFORM pg_temp.a364_assert(old_state = new_state, format('catalogue access of %s to org %s moved: %s -> %s', who, org, old_state, new_state));
      old_state := pg_temp.a364_state(who, format('platform.staff_catalog_geography_v1(%L)', pg_temp.a364_id(org)));
      new_state := pg_temp.a364_state(who, format('platform.staff_catalog_institution_geography_v1(%L, %L)', pg_temp.a364_id(org), pg_temp.a364_id(701)));
      PERFORM pg_temp.a364_assert(old_state = new_state, format('geography access of %s to org %s moved: %s -> %s', who, org, old_state, new_state));
    END LOOP;
  END LOOP;
END
$a364_access$;
SELECT pg_temp.a364_assert(pg_temp.a364_state('1', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = 'ok'
    AND pg_temp.a364_state('2', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = 'ok',
  'the Admin and a catalog.read member read the light rows');
SELECT pg_temp.a364_assert(pg_temp.a364_state('3', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = '42501',
  'staff without catalog.read was served the light rows');
SELECT pg_temp.a364_assert(pg_temp.a364_state('11', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = '42501'
    AND pg_temp.a364_state('2', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000002'')') = '42501',
  'another organization was served');
SELECT pg_temp.a364_assert(pg_temp.a364_state('anon', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = '42501'
    AND pg_temp.a364_state('service_role', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') = '42501'
    AND pg_temp.a364_state('1', 'platform.staff_university_catalog_rows_v1(NULL)') = '42501',
  'anon, the service role or a NULL organization was served');
SELECT pg_temp.a364_assert(pg_temp.a364_state('4', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', ''36400000-0000-4000-8000-000000000701'')') = 'ok'
    AND pg_temp.a364_state('2', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', ''36400000-0000-4000-8000-000000000701'')') = '42501'
    AND pg_temp.a364_state('3', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', ''36400000-0000-4000-8000-000000000701'')') = '42501'
    AND pg_temp.a364_state('1', 'platform.staff_catalog_institution_geography_v1(NULL, ''36400000-0000-4000-8000-000000000701'')') = '42501',
  'the narrow geography: the manager is served, a reader, a staff member and a NULL organization are not');
SELECT pg_temp.a364_assert(pg_temp.a364_state('1', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', NULL)') = '22023',
  'a NULL institution is an invalid request');
-- The same filter checks as the old pager.
SELECT pg_temp.a364_assert(pg_temp.a364_state('2', format('platform.staff_university_catalog_rows_v1(%L, %L)', pg_temp.a364_id(1), repeat('x', 101))) = '22023'
    AND pg_temp.a364_state('2', format('platform.staff_university_catalog(%L, %L)', pg_temp.a364_id(1), repeat('x', 101))) = '22023'
    AND pg_temp.a364_state('2', format('platform.staff_university_catalog_rows_v1(%L, NULL, %L)', pg_temp.a364_id(1), 'cn')) = '22023'
    AND pg_temp.a364_state('2', format('platform.staff_university_catalog_rows_v1(%L, NULL, NULL, %L)', pg_temp.a364_id(1), 'phd')) = '22023'
    AND pg_temp.a364_state('2', format('platform.staff_university_catalog_rows_v1(%L, %L)', pg_temp.a364_id(1), repeat('x', 100))) = 'ok',
  'filter checks differ from the old pager');

-- ===========================================================================
-- 2. The light rows are the projection of the full cards.
-- ===========================================================================
DO $a364_rows$
DECLARE args TEXT; answer JSONB; expected JSONB;
BEGIN
  FOREACH args IN ARRAY ARRAY['NULL, NULL, NULL', ''''', NULL, NULL', '''a364'', NULL, NULL', '''ALPHA'', NULL, NULL',
    'NULL, ''CN'', NULL', 'NULL, ''MY'', NULL', 'NULL, ''US'', NULL', 'NULL, NULL, ''bachelor''', 'NULL, NULL, ''doctorate''',
    'NULL, ''CN'', ''master''', '''nothing-matches'', NULL, NULL', 'NULL, ''XX'', NULL', '''college'', ''TR'', ''doctorate'''] LOOP
    answer := pg_temp.a364_ok('2', format('platform.staff_university_catalog_rows_v1(%L, %s)', pg_temp.a364_id(1), args));
    expected := pg_temp.a364_expected_rows('2', 1, args);
    PERFORM pg_temp.a364_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(answer) k) = ARRAY['complete', 'items', 'organizationId']
      AND answer ->> 'organizationId' = pg_temp.a364_id(1)::TEXT AND answer -> 'complete' = 'true'::JSONB,
      format('light answer envelope for (%s): %s', args, answer));
    PERFORM pg_temp.a364_assert(answer -> 'items' = expected,
      format('light rows for (%s) differ from the full cards: %s vs %s', args, answer -> 'items', expected));
  END LOOP;
END
$a364_rows$;
SELECT pg_temp.a364_ok('1', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000001'')') AS a364_all \gset
-- The order itself is the old pager's (proved above for every filter); here the set.
SELECT pg_temp.a364_assert((SELECT array_agg(i -> 'content' ->> 'name' ORDER BY i -> 'content' ->> 'name' COLLATE "C")
      FROM jsonb_array_elements(:'a364_all'::JSONB -> 'items') i)
    = ARRAY['A364 Alpha University', 'A364 Beta Institute', 'A364 Outside University', 'a364 gamma college'],
  'latest versions only, no draft-only card and nothing of organization B');
SELECT pg_temp.a364_assert((SELECT i -> 'levels' FROM jsonb_array_elements(:'a364_all'::JSONB -> 'items') i WHERE i ->> 'id' = pg_temp.a364_id(701)::TEXT)
    = '{"bachelor": 2, "master": 1, "language": 1}'::JSONB
  AND (SELECT jsonb_path_query_array(i -> 'deadlinePrograms', '$[*].id') FROM jsonb_array_elements(:'a364_all'::JSONB -> 'items') i
    WHERE i ->> 'id' = pg_temp.a364_id(701)::TEXT) = '["cs", "mba"]'::JSONB
  AND (SELECT jsonb_path_query_array(i -> 'deadlinePrograms', '$[0].intakes[*].label') FROM jsonb_array_elements(:'a364_all'::JSONB -> 'items') i
    WHERE i ->> 'id' = pg_temp.a364_id(701)::TEXT) = '["Autumn 2027"]'::JSONB,
  'counts by level; only programmes with an open or announced intake, only those intakes');
SELECT pg_temp.a364_assert((:'a364_all'::TEXT) !~ '(Synthetic overview|Synthetic public program|programs/|old name|Draft Only|Foreign)',
  'no overview, summary, programme link, older version, draft or foreign card in the light rows');

-- More than 1 200 matches: no rows and complete = false (the application then reads the old pages by name).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
  SELECT ('36400000-0000-4000-9000-' || lpad(g::TEXT, 12, '0'))::UUID, pg_temp.a364_id(3), 'university', 'A364 Bulk ' || g, 'CN', NULL,
    pg_temp.a364_id(731), 'synthetic-a364-rev', pg_temp.a364_id(751), 'rec_' || md5('a364-bulk-' || g), pg_temp.a364_id(321)
  FROM generate_series(1, 1201) g;
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
  SELECT ('36400000-0000-4000-a000-' || lpad(g::TEXT, 12, '0'))::UUID, pg_temp.a364_id(3), ('36400000-0000-4000-9000-' || lpad(g::TEXT, 12, '0'))::UUID,
    0, 1, pg_temp.a364_content('A364 Bulk ' || g, 'CN', NULL, NULL, jsonb_build_array(pg_temp.a364_program('cs', 'bachelor', '[]'::JSONB))),
    pg_temp.a364_id(731), 'published', 'A364 synthetic review', pg_temp.a364_id(321), pg_temp.a364_id(321), TIMESTAMPTZ '2026-11-10 08:00:00+00'
  FROM generate_series(1, 1201) g;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a364_assert(pg_temp.a364_ok('21', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000003'')')
    = jsonb_build_object('organizationId', pg_temp.a364_id(3), 'complete', FALSE, 'items', '[]'::JSONB),
  '1 201 matches give complete = false without rows');
SELECT pg_temp.a364_assert(r -> 'complete' = 'true'::JSONB
    AND jsonb_array_length(r -> 'items') = (SELECT count(*) FROM generate_series(1, 1201) g WHERE ('A364 Bulk ' || g) LIKE '%Bulk 12%'),
  'a filter that fits under the limit returns every match of the large catalogue')
FROM pg_temp.a364_ok('21', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000003'', ''Bulk 12'')') r;
-- Exactly 1 200: still complete.
SET LOCAL session_replication_role = replica;
DELETE FROM platform_private.university_catalog_publications WHERE id = '36400000-0000-4000-a000-000000001201';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a364_assert(r -> 'complete' = 'true'::JSONB AND jsonb_array_length(r -> 'items') = 1200,
  '1 200 matches are one complete answer')
FROM pg_temp.a364_ok('21', 'platform.staff_university_catalog_rows_v1(''36400000-0000-4000-8000-000000000003'')') r;

-- ===========================================================================
-- 3. Geography: the same answer as the 283 body; the narrow answer is that answer cut to one institution.
-- ===========================================================================
SELECT pg_temp.a364_assert(pg_temp.a364_ok('1', 'platform.staff_catalog_geography_v1(''36400000-0000-4000-8000-000000000001'')')
    = pg_temp.a364_old_geography(pg_temp.a364_id(1)),
  'staff_catalog_geography_v1 answer changed');
SELECT pg_temp.a364_assert(pg_temp.a364_ok('4', 'platform.staff_catalog_geography_v1(''36400000-0000-4000-8000-000000000001'')')
    = pg_temp.a364_old_geography(pg_temp.a364_id(1))
  AND pg_temp.a364_ok('11', 'platform.staff_catalog_geography_v1(''36400000-0000-4000-8000-000000000002'')')
    = pg_temp.a364_old_geography(pg_temp.a364_id(2)),
  'the manager and organization B read the 283 answer');
SELECT pg_temp.a364_assert(jsonb_array_length(g -> 'costs') = 5 AND jsonb_array_length(g -> 'cities') = 3
    AND (SELECT count(*) FROM jsonb_array_elements(g -> 'costs') c WHERE c ->> 'confirmedByName' = 'A364 Actor 1') = 1
    AND (SELECT jsonb_agg(DISTINCT c -> 'exponent') FROM jsonb_array_elements(g -> 'costs') c) = '[0, 2, 3]'::JSONB
    AND (SELECT c ->> 'reviewedByName' FROM jsonb_array_elements(g -> 'cities') c WHERE c ->> 'key' = 'alpha-city') = 'A364 Actor 1'
    AND (SELECT c -> 'institutionCount' FROM jsonb_array_elements(g -> 'cities') c WHERE c ->> 'key' = 'alpha-city') = '1'::JSONB,
  'the fixture reaches every expression: names, exponents 0/2/3, link counts')
FROM pg_temp.a364_old_geography(pg_temp.a364_id(1)) g;
DO $a364_narrow$
DECLARE inst INTEGER; full_answer JSONB := pg_temp.a364_old_geography(pg_temp.a364_id(1)); narrow JSONB;
BEGIN
  FOREACH inst IN ARRAY ARRAY[701, 702, 703, 704, 705, 711, 799] LOOP
    narrow := pg_temp.a364_ok('4', format('platform.staff_catalog_institution_geography_v1(%L, %L)', pg_temp.a364_id(1), pg_temp.a364_id(inst)));
    PERFORM pg_temp.a364_assert(narrow = pg_temp.a364_cut(full_answer, pg_temp.a364_id(inst)),
      format('narrow geography of %s is not the full answer cut to it: %s', inst, narrow));
  END LOOP;
END
$a364_narrow$;
SELECT pg_temp.a364_assert(jsonb_array_length(n -> 'institutions') = 1 AND jsonb_array_length(n -> 'costs') = 2
    AND (SELECT array_agg(c ->> 'key') FROM jsonb_array_elements(n -> 'cities') c) = ARRAY['alpha-city', 'draft-city'],
  'the narrow answer of Alpha: one institution, its two cost rows, the cities of China')
FROM pg_temp.a364_ok('1', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', ''36400000-0000-4000-8000-000000000701'')') n;
SELECT pg_temp.a364_assert(n -> 'institutions' = '[]'::JSONB AND n -> 'costs' = '[]'::JSONB AND n -> 'cities' = '[]'::JSONB,
  'an institution of another organization leaks nothing')
FROM pg_temp.a364_ok('1', 'platform.staff_catalog_institution_geography_v1(''36400000-0000-4000-8000-000000000001'', ''36400000-0000-4000-8000-000000000711'')') n;

-- ===========================================================================
-- 4. Posture.
-- ===========================================================================
SELECT pg_temp.a364_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
    AND p.proowner = (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_university_catalog(uuid,text,text,text,uuid,integer)'::REGPROCEDURE)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    AND (p.oid = 'platform.staff_catalog_geography_v1(uuid)'::REGPROCEDURE OR NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0),
  p.oid::REGPROCEDURE || ': SECURITY DEFINER, STABLE, empty search_path, executable by authenticated only')
FROM pg_catalog.pg_proc p WHERE p.oid IN ('platform.staff_university_catalog_rows_v1(uuid,text,text,text)'::REGPROCEDURE,
  'platform.staff_catalog_institution_geography_v1(uuid,uuid)'::REGPROCEDURE, 'platform.staff_catalog_geography_v1(uuid)'::REGPROCEDURE);
SELECT pg_temp.a364_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'),
  'the builder is private')
FROM pg_catalog.pg_proc p WHERE p.oid = 'platform_private.catalog_geography_staff_json(uuid,uuid)'::REGPROCEDURE;
SELECT pg_temp.a364_assert(to_regprocedure('platform_private.catalog_cost_staff_json(platform.catalog_costs)') IS NULL
    AND to_regprocedure('platform_private.catalog_city_staff_json(platform.catalog_cities)') IS NULL,
  'the per-row helpers are gone');

SELECT 'A364_UNIVERSITY_CATALOG_SPEED_SUITE_PASSED' AS a364_suite_marker;
ROLLBACK;
