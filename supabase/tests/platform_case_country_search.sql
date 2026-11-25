\set ON_ERROR_STOP on
-- Boundary suite for migration 374 «Поиск и фильтр по стране дела понимают слово». Runs on the real chain right after 374 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the first private helper gives the codes of the countries that have a word starting with the typed text («Китай», «китай»,
--     «кит», «Кытай», «china», «arab»), and nothing for a text shorter than three letters (two letters begin too many names),
--     for a text inside a word, a blank text or a word that is no country; the second gives the distinct texts the cases
--     hold for those countries (CN, China, Китай, Кытай), and none for Germany;
--  2. the «Студенты» search (page: Ctrl+K, duplicate hint, task dialog, client base; queue and its counts) finds a case by the word
--     of its country however target_country is written, still finds by name, programme and degree as before, keeps the raw
--     match for a country outside the six, and the counts equal the list;
--  3. the board country filter takes the cases of one country (CN, China, Китай are one) and keeps the exact match outside the six;
--  4. a curator without access to the cases gets nothing from any of the four reads (the rule moved only the search words);
--  5. catalog: both helpers are SECURITY DEFINER with an empty search_path and closed to every API role; the four functions keep
--     their posture and their grants.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A374_CASE_COUNTRY_SEARCH_SUITE_START

CREATE FUNCTION pg_temp.a374_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a374_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A374: %', message; END IF;
END
$$;
-- The case numbers (501..508) a read returns, in order; a read that fails is a failed assertion, not an empty list.
CREATE FUNCTION pg_temp.a374_page(p_query TEXT) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(page.student_case_id::TEXT, 3)::INTEGER ORDER BY page.student_case_id), ARRAY[]::INTEGER[])
  FROM platform.staff_student_case_page(100, NULL, NULL, NULL, p_query) AS page
$$;
CREATE FUNCTION pg_temp.a374_queue(p_query TEXT) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(item ->> 'student_case_id', 3)::INTEGER ORDER BY item ->> 'student_case_id'), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(platform.staff_student_case_queue_v1('active', 100, 'due', NULL, NULL, NULL, NULL, p_query) -> 'rows') AS item
$$;
CREATE FUNCTION pg_temp.a374_total(p_query TEXT) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (platform.staff_student_case_queue_counts_v1('active', NULL, NULL, NULL, p_query) ->> 'total')::INTEGER
$$;
CREATE FUNCTION pg_temp.a374_board(p_country TEXT, p_query TEXT DEFAULT NULL) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(item ->> 'student_case_id', 3)::INTEGER ORDER BY item ->> 'student_case_id'), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(platform.staff_admissions_pipeline_board_v1(NULL, NULL, p_country, p_query) -> 'rows') AS item
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a374_id(INTEGER), pg_temp.a374_assert(BOOLEAN, TEXT), pg_temp.a374_page(TEXT),
  pg_temp.a374_queue(TEXT), pg_temp.a374_total(TEXT), pg_temp.a374_board(TEXT, TEXT) TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 1. The helper over the typed text, as the owner of the chain.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['CN'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'КИТАЙ', 'кит', ' Китай ', 'Кытай', 'кыт', 'China', 'china', 'chi']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['MY'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Малайзия', 'malaysia', 'мал', 'mal']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['AE'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['ОАЭ', 'оаэ', 'БАЭ', 'emirates', 'United Arab Emirates', 'arab', 'uni']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['TR'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Турция', 'Түркия', 'turkey', 'tur']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['IT'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Италия', 'italy', 'ita']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY['CZ'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Чехия', 'czechia', 'cze']) AS q;
-- Shorter than three letters: the two-letter beginnings of Китай, Малайзия and the codes are also the beginnings of many names.
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes for the short ' || quote_literal(q))
FROM unnest(ARRAY['CN', 'cn', 'ки', 'ch', 'ма', 'my', 'ae', 'it', 'к']) AS q;
-- Inside a word is not the beginning of a word («Marina» holds «ina», «Мирай» holds «ай»).
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes inside a word: ' || quote_literal(q))
FROM unnest(ARRAY['тай', 'ina', 'hina', 'айзия', 'rab']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes for ' || quote_literal(q))
FROM unnest(ARRAY['', '   ', 'Атлантида', 'Germany', 'Германия', 'Student 17', 'bachelor']) AS q;
SELECT pg_temp.a374_assert(platform_private.case_country_codes_matching(NULL) = ARRAY[]::TEXT[], 'no codes for NULL');

-- ---------------------------------------------------------------------------
-- Fixture: one organization; admin (1), seller (2), curator A (3) who curates every case, curator B (4) with the same
-- role and no case of his own. Eight active cases, one country each, written every way the product writes it.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a374_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO a374_actors(n, role) VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'curator');

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a374_id(1), 'A374 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a374_id(100 + n), 'a374-' || n || '@example.invalid', '{}'::JSONB FROM a374_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a374_id(200 + n), pg_temp.a374_id(100 + n), 'A374 Actor ' || n, 'active', 1 FROM a374_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a374_id(300 + n), pg_temp.a374_id(1), pg_temp.a374_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM a374_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a374_id(301);

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a374_id(401), pg_temp.a374_id(1), 'organization', pg_temp.a374_id(1), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a374_id(410 + (n - 500)), pg_temp.a374_id(1), 'student_case', pg_temp.a374_id(n), 1 FROM generate_series(501, 508) AS n;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version,
  granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a374_id(1), pg_temp.a374_id(301), pg_temp.a374_id(401), 1, 1, TRUE, 'system', 'A374 synthetic organization scope',
    pg_temp.a374_id(601));
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version,
  granted, actor_kind, reason, request_id)
  SELECT pg_temp.a374_id(1), pg_temp.a374_id(303), pg_temp.a374_id(410 + (n - 500)), 1, 1, TRUE, 'system',
    'A374 curator A case scope', pg_temp.a374_id(620 + (n - 500))
  FROM generate_series(501, 508) AS n;

-- Cases normally come from the sale handoff; here only the insert-time transition trigger is bypassed, every table
-- constraint still holds. 501 CN, 502 China (the application-approval spelling), 503 Китай, 507 Кытай: one country; 504 MY;
-- 508 United Arab Emirates; 505 Germany (outside the six); 506 no country.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version)
SELECT pg_temp.a374_id(c.n), pg_temp.a374_id(1), pg_temp.a374_id(302), pg_temp.a374_id(303), 'synthetic:a374:' || c.n, c.name,
  c.country, c.degree, c.program, 'contract_confirmed', 'active'::platform.student_case_state, clock_timestamp(),
  pg_temp.a374_id(410 + (c.n - 500)), 1
FROM (VALUES
  (501, 'A374 Alpha Code',     'CN',                   'bachelor',    NULL::TEXT),
  (502, 'A374 Beta English',   'China',                'Бакалавриат', NULL),
  (503, 'A374 Gamma Russian',  'Китай',                NULL,          NULL),
  (504, 'A374 Delta Malaysia', 'MY',                   NULL,          'Engineering'),
  (505, 'A374 Epsilon Legacy', 'Germany',              NULL,          NULL),
  (506, 'A374 Zeta Nocountry', NULL,                   NULL,          NULL),
  (507, 'A374 Eta Kyrgyz',     'Кытай',                NULL,          NULL),
  (508, 'A374 Theta Emirates', 'United Arab Emirates', NULL,          NULL)
) AS c(n, name, country, degree, program);
SET LOCAL session_replication_role = origin;

-- 1b. The second helper over the fixture: the distinct texts the cases hold for a country, whichever way they are written.
SELECT pg_temp.a374_assert(platform_private.case_country_spellings(ARRAY['CN']) @> ARRAY['CN', 'China', 'Китай', 'Кытай']
  AND NOT platform_private.case_country_spellings(ARRAY['CN']) && ARRAY['MY', 'United Arab Emirates', 'Germany'],
  'spellings of China: the four written ways and no other country');
SELECT pg_temp.a374_assert(platform_private.case_country_spellings(ARRAY['MY']) @> ARRAY['MY']
  AND NOT platform_private.case_country_spellings(ARRAY['MY']) && ARRAY['CN', 'China'], 'spellings of Malaysia');
SELECT pg_temp.a374_assert(platform_private.case_country_spellings(ARRAY['AE']) @> ARRAY['United Arab Emirates'], 'spellings of the Emirates');
SELECT pg_temp.a374_assert(NOT platform_private.case_country_spellings(ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']) && ARRAY['Germany'],
  'Germany is none of the six countries: it is never a spelling of one');
SELECT pg_temp.a374_assert(platform_private.case_country_spellings(ARRAY[]::TEXT[]) = ARRAY[]::TEXT[]
  AND platform_private.case_country_spellings(NULL) = ARRAY[]::TEXT[]
  AND platform_private.case_country_spellings(ARRAY[NULL]::TEXT[]) = ARRAY[]::TEXT[], 'no codes, no spellings');

CREATE FUNCTION pg_temp.a374_claims() RETURNS VOID LANGUAGE SQL AS $$
  UPDATE a374_actors a SET claims = jsonb_build_object(
    'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
    'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
    'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
  )::TEXT
  FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
    JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
  WHERE p.id = pg_temp.a374_id(200 + a.n)
$$;
SELECT pg_temp.a374_claims();
GRANT SELECT ON a374_actors TO authenticated;
SELECT claims AS a374_admin FROM a374_actors WHERE n = 1 \gset

-- One published role «case.read.full + case.update.append» on the own scope for both curators (as in the pipeline board suite): A reads the
-- eight cases, B reads none, so B proves that the new words open nothing.
SET request.jwt.claims TO :'a374_admin';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.a374_id(1), pg_temp.a374_id(701), 0, 'create',
  jsonb_build_object('label', 'A374 Curator casework', 'description', 'Migration 374 synthetic curator casework role',
    'permissionKeys', jsonb_build_array('case.read.full', 'case.update.append')),
  'A374 create curator casework role', pg_temp.a374_id(711)
) AS a374_role_created \gset
SELECT platform.staff_role_impact(pg_temp.a374_id(1), pg_temp.a374_id(701), 1) ->> 'impactFingerprint' AS a374_role_impact \gset
SELECT platform.staff_role_publish(pg_temp.a374_id(1), pg_temp.a374_id(701), 1, :'a374_role_impact',
  'A374 publish curator casework role', pg_temp.a374_id(712)) AS a374_role_published \gset
SELECT (:'a374_role_published'::JSONB ->> 'bundleId') AS a374_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.a374_id(1), pg_temp.a374_id(303), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a374_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a374_id(701), 'roleVersion', 2, 'bundleId', :'a374_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'A374 grant curator A casework', pg_temp.a374_id(713)
) AS a374_curator_a_granted \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.a374_id(1), pg_temp.a374_id(304), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a374_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a374_id(701), 'roleVersion', 2, 'bundleId', :'a374_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'A374 grant curator B casework', pg_temp.a374_id(714)
) AS a374_curator_b_granted \gset
RESET ROLE;

-- The grants bump access versions: rebuild every actor's claims from live rows.
SELECT pg_temp.a374_claims();
SELECT claims AS a374_curator_a FROM a374_actors WHERE n = 3 \gset
SELECT claims AS a374_curator_b FROM a374_actors WHERE n = 4 \gset

-- ---------------------------------------------------------------------------
-- 2. Search of «Студенты» as curator A: page, queue, counts.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'a374_curator_a';
SET LOCAL ROLE authenticated;

-- Sanity: A reads all eight cases through every read; without a query nothing is filtered.
SELECT pg_temp.a374_assert(pg_temp.a374_page(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'page without a query reads all eight');
SELECT pg_temp.a374_assert(pg_temp.a374_page('') = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'page with an empty query reads all eight');
SELECT pg_temp.a374_assert(pg_temp.a374_queue(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'queue without a query reads all eight');
SELECT pg_temp.a374_assert(pg_temp.a374_total(NULL) = 8, 'counts without a query count eight');

-- One country, however it is written: «Китай», its lower case, a fragment, the Kyrgyz and the English name, the code.
SELECT pg_temp.a374_assert(pg_temp.a374_page(q) = ARRAY[501, 502, 503, 507], 'page finds China cases by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'КИТАЙ', 'кит', 'Кытай', 'кыт', 'china', 'China', 'chi']) AS q;
SELECT pg_temp.a374_assert(pg_temp.a374_queue(q) = ARRAY[501, 502, 503, 507], 'queue finds China cases by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'кит', 'Кытай', 'china']) AS q;
SELECT pg_temp.a374_assert(pg_temp.a374_total(q) = 4, 'counts follow the list for ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'кит', 'Кытай', 'china']) AS q;
-- Two letters and the code are not expanded to the country: they find what the case holds as written, as before. A fragment
-- inside a word is the same: «тай» finds the two cases that hold «Китай» and «Кытай» as written, not the CN and China ones.
SELECT pg_temp.a374_assert(pg_temp.a374_page('CN') = ARRAY[501] AND pg_temp.a374_page('cn') = ARRAY[501]
  AND pg_temp.a374_queue('CN') = ARRAY[501] AND pg_temp.a374_total('cn') = 1, 'the code finds what is written as the code');
SELECT pg_temp.a374_assert(pg_temp.a374_page('ки') = ARRAY[503] AND pg_temp.a374_queue('ки') = ARRAY[503] AND pg_temp.a374_total('ки') = 1,
  'two letters are not expanded to the country');
SELECT pg_temp.a374_assert(pg_temp.a374_page('тай') = ARRAY[503, 507] AND pg_temp.a374_queue('тай') = ARRAY[503, 507] AND pg_temp.a374_total('тай') = 2,
  'a fragment inside a word is not expanded to the country');

-- The other countries.
SELECT pg_temp.a374_assert(pg_temp.a374_page('Малайзия') = ARRAY[504] AND pg_temp.a374_page('malaysia') = ARRAY[504]
  AND pg_temp.a374_page('мал') = ARRAY[504]
  AND pg_temp.a374_queue('Малайзия') = ARRAY[504] AND pg_temp.a374_total('Малайзия') = 1, 'Malaysia by name');
SELECT pg_temp.a374_assert(pg_temp.a374_page(q) = ARRAY[508] AND pg_temp.a374_queue(q) = ARRAY[508] AND pg_temp.a374_total(q) = 1,
  'United Arab Emirates by ' || quote_literal(q))
FROM unnest(ARRAY['ОАЭ', 'оаэ', 'БАЭ', 'emirates', 'arab']) AS q;

-- What the search matched before still matches: the name, the programme, the degree as written, the raw country outside the six.
SELECT pg_temp.a374_assert(pg_temp.a374_page('Alpha') = ARRAY[501] AND pg_temp.a374_queue('Alpha') = ARRAY[501] AND pg_temp.a374_total('Alpha') = 1,
  'a name still finds its case');
SELECT pg_temp.a374_assert(pg_temp.a374_page('Engineering') = ARRAY[504] AND pg_temp.a374_queue('engineering') = ARRAY[504],
  'the programme still finds its case');
SELECT pg_temp.a374_assert(pg_temp.a374_page('bachelor') = ARRAY[501] AND pg_temp.a374_page('Бакалавриат') = ARRAY[502],
  'the degree as written still finds its case');
SELECT pg_temp.a374_assert(pg_temp.a374_page('germany') = ARRAY[505] AND pg_temp.a374_queue('Germany') = ARRAY[505] AND pg_temp.a374_total('germany') = 1,
  'a country outside the six is still found by the text as written');
-- A country outside the six has no words: the Russian name of Germany finds nothing, and so does a word no case carries.
SELECT pg_temp.a374_assert(pg_temp.a374_page('Германия') = ARRAY[]::INTEGER[] AND pg_temp.a374_page('Атлантида') = ARRAY[]::INTEGER[]
  AND pg_temp.a374_queue('Атлантида') = ARRAY[]::INTEGER[] AND pg_temp.a374_total('Атлантида') = 0, 'a word that no case carries finds nothing');
-- ---------------------------------------------------------------------------
-- 3. Board filter as curator A.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_assert(pg_temp.a374_board(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'board without a filter shows all eight');
SELECT pg_temp.a374_assert(pg_temp.a374_board(c) = ARRAY[501, 502, 503, 507], 'board filter ' || quote_literal(c) || ' is one country')
FROM unnest(ARRAY['CN', 'cn', 'China', 'Китай', 'Кытай']) AS c;
SELECT pg_temp.a374_assert(pg_temp.a374_board('MY') = ARRAY[504] AND pg_temp.a374_board('Malaysia') = ARRAY[504], 'board filter MY');
SELECT pg_temp.a374_assert(pg_temp.a374_board('AE') = ARRAY[508] AND pg_temp.a374_board('ОАЭ') = ARRAY[508], 'board filter AE');
-- Outside the six the comparison is exact, as before; no equivalence is invented.
SELECT pg_temp.a374_assert(pg_temp.a374_board('Germany') = ARRAY[505] AND pg_temp.a374_board('DE') = ARRAY[]::INTEGER[]
  AND pg_temp.a374_board('germany') = ARRAY[]::INTEGER[], 'a country outside the six keeps the exact match');
SELECT pg_temp.a374_assert(pg_temp.a374_board('CN', 'Alpha') = ARRAY[501] AND pg_temp.a374_board('MY', 'Alpha') = ARRAY[]::INTEGER[],
  'the board name search still works together with the country filter');
SELECT pg_temp.a374_assert(pg_temp.a374_board(NULL, 'Китай') = ARRAY[]::INTEGER[], 'the board query is still a name search only');

-- ---------------------------------------------------------------------------
-- 4. Curator B has no case: the new words open nothing.
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a374_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a374_assert(pg_temp.a374_page(NULL) = ARRAY[]::INTEGER[] AND pg_temp.a374_queue(NULL) = ARRAY[]::INTEGER[]
  AND pg_temp.a374_total(NULL) = 0 AND pg_temp.a374_board(NULL) = ARRAY[]::INTEGER[], 'curator B sees nothing without a query');
SELECT pg_temp.a374_assert(pg_temp.a374_page(q) = ARRAY[]::INTEGER[] AND pg_temp.a374_queue(q) = ARRAY[]::INTEGER[]
  AND pg_temp.a374_total(q) = 0, 'curator B gets nothing by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'CN', 'china', 'ОАЭ', 'germany']) AS q;
SELECT pg_temp.a374_assert(pg_temp.a374_board(c) = ARRAY[]::INTEGER[], 'curator B gets nothing from the board filter ' || quote_literal(c))
FROM unnest(ARRAY['CN', 'China', 'Китай', 'MY', 'Germany']) AS c;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'],
  'the helpers are SECURITY DEFINER, STABLE, with an empty search_path: ' || p.oid::regprocedure::TEXT)
FROM pg_proc p WHERE p.oid IN ('platform_private.case_country_codes_matching(text)'::regprocedure,
  'platform_private.case_country_spellings(text[])'::regprocedure);
SELECT pg_temp.a374_assert(NOT has_function_privilege(r, h, 'EXECUTE'), 'the helper is closed to ' || r || ': ' || h)
FROM unnest(ARRAY['authenticated', 'anon', 'service_role', 'supabase_auth_admin']) AS r,
  unnest(ARRAY['platform_private.case_country_codes_matching(text)', 'platform_private.case_country_spellings(text[])']) AS h;
SELECT pg_temp.a374_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'],
  'the four reads keep SECURITY DEFINER, STABLE and the empty search_path: ' || p.oid::regprocedure::TEXT)
FROM pg_proc p WHERE p.oid IN (
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::regprocedure,
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure,
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure,
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure);
SELECT pg_temp.a374_assert(has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE'),
  'the four reads keep their grants: ' || f)
FROM unnest(ARRAY[
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)']) AS f;
-- The comments keep their history and add the 374 note.
SELECT pg_temp.a374_assert(obj_description(f::regprocedure, 'pg_proc') LIKE '%374:%', 'the 374 note is in the comment of ' || f)
FROM unnest(ARRAY[
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)']) AS f;
SELECT pg_temp.a374_assert(obj_description('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure, 'pg_proc') LIKE 'Curator admissions board.%',
  'the board comment keeps its history');

\echo A374_CASE_COUNTRY_SEARCH_SUITE_PASSED

ROLLBACK;
