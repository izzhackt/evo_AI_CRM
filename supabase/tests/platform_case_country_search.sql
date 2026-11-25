\set ON_ERROR_STOP on
-- Boundary suite for migration 375 «Поиск и фильтр по стране дела понимают слово». Runs on the real chain right after 375 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the first private helper gives the codes of the countries that have a word starting with the typed text («Китай», «китай»,
--     «кит», «Кытай», «china», «arab») or that study_country_from_text recognises in it («КНР», «UAE», «Czech Republic»),
--     and nothing for a text shorter than three letters (two letters begin too many names), for a text inside a word, a blank
--     text or a word that is no country; the second gives the distinct texts the cases of ONE organization hold for those
--     countries (CN, China, Китай, Кытай), none for Germany, none for an empty list, and nothing of another organization;
--  2. the «Студенты» search (page: Ctrl+K, duplicate hint, task dialog, client base; queue and its counts) finds a case by the word
--     of its country however target_country is written, still finds by name, programme and degree as before, keeps the raw
--     match for a country outside the six, and the counts equal the list;
--  3. the board country filter takes the cases of one country (CN, China, Китай are one) and keeps the exact match outside the six;
--  4. nothing opens that was closed: a curator without access to the cases gets nothing from any of the four reads; a seller
--     with summary access gets from the page no more than the summary list he already has (the masked programme stays
--     masked in the search) and is refused by the other three; an administrator of another organization finds only the cases
--     of that organization, and the cases of the first organization never reach his search;
--  5. catalog: both helpers are SECURITY DEFINER with an empty search_path and closed to every API role; the four functions keep
--     their posture and their grants; the comments keep their history.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A375_CASE_COUNTRY_SEARCH_SUITE_START

CREATE FUNCTION pg_temp.a375_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a375_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A375: %', message; END IF;
END
$$;
-- The case numbers (501..508 and 601..603) a read returns, in order; a read that fails is a failed assertion, not an empty list.
CREATE FUNCTION pg_temp.a375_page(p_query TEXT) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(page.student_case_id::TEXT, 3)::INTEGER ORDER BY page.student_case_id), ARRAY[]::INTEGER[])
  FROM platform.staff_student_case_page(100, NULL, NULL, NULL, p_query) AS page
$$;
CREATE FUNCTION pg_temp.a375_queue(p_query TEXT) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(item ->> 'student_case_id', 3)::INTEGER ORDER BY item ->> 'student_case_id'), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(platform.staff_student_case_queue_v1('active', 100, 'due', NULL, NULL, NULL, NULL, p_query) -> 'rows') AS item
$$;
CREATE FUNCTION pg_temp.a375_total(p_query TEXT) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (platform.staff_student_case_queue_counts_v1('active', NULL, NULL, NULL, p_query) ->> 'total')::INTEGER
$$;
CREATE FUNCTION pg_temp.a375_board(p_country TEXT, p_query TEXT DEFAULT NULL) RETURNS INTEGER[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(right(item ->> 'student_case_id', 3)::INTEGER ORDER BY item ->> 'student_case_id'), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(platform.staff_admissions_pipeline_board_v1(NULL, NULL, p_country, p_query) -> 'rows') AS item
$$;
-- 'ok' when the statement runs, else its SQLSTATE (the refusals of the roles that may not read cases).
CREATE FUNCTION pg_temp.a375_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a375_id(INTEGER), pg_temp.a375_assert(BOOLEAN, TEXT), pg_temp.a375_page(TEXT),
  pg_temp.a375_queue(TEXT), pg_temp.a375_total(TEXT), pg_temp.a375_board(TEXT, TEXT), pg_temp.a375_state(TEXT)
  TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 1. The helper over the typed text, as the owner of the chain.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['CN'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'КИТАЙ', 'кит', 'Кит', 'КИТ', ' Китай ', 'Кытай', 'кыт', 'Кыт', 'China', 'china', 'chi', 'Chi', 'CHI']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['MY'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Малайзия', 'malaysia', 'мал', 'Мал', 'mal', 'Mal']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['AE'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['ОАЭ', 'оаэ', 'БАЭ', 'emirates', 'Emir', 'United Arab Emirates', 'arab', 'Arab', 'uni']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['TR'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Турция', 'Түркия', 'turkey', 'tur']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['IT'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Италия', 'italy', 'ita']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['CZ'], 'codes for ' || quote_literal(q))
FROM unnest(ARRAY['Чехия', 'czechia', 'cze']) AS q;
-- The spellings the library already understands (284) but that are no word of the table: the typed text is recognised whole.
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['CN'], 'codes for the alias ' || quote_literal(q))
FROM unnest(ARRAY['КНР', 'кнр']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['AE'], 'codes for the alias ' || quote_literal(q))
FROM unnest(ARRAY['UAE', 'uae', 'Объединённые Арабские Эмираты', 'объединенные арабские эмираты', 'Бириккен араб эмираттары']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['TR'], 'codes for the alias ' || quote_literal(q))
FROM unnest(ARRAY['Türkiye', 'turkiye', 'Turkiye']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY['CZ'], 'codes for the alias ' || quote_literal(q))
FROM unnest(ARRAY['Czech Republic', 'Чешская республика']) AS q;
-- Shorter than three letters: the two-letter beginnings of Китай, Малайзия and the codes are also the beginnings of many names.
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes for the short ' || quote_literal(q))
FROM unnest(ARRAY['CN', 'cn', 'ки', 'ch', 'ма', 'my', 'ae', 'it', 'к']) AS q;
-- Inside a word is not the beginning of a word («Marina» holds «ina», «Мирай» holds «ай»).
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes inside a word: ' || quote_literal(q))
FROM unnest(ARRAY['тай', 'ina', 'hina', 'айзия', 'rab']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(q) = ARRAY[]::TEXT[], 'no codes for ' || quote_literal(q))
FROM unnest(ARRAY['', '   ', 'Атлантида', 'Germany', 'Германия', 'Student 17', 'bachelor']) AS q;
SELECT pg_temp.a375_assert(platform_private.case_country_codes_matching(NULL) = ARRAY[]::TEXT[], 'no codes for NULL');

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with admin (1), seller (2), curator A (3) who curates every case, curator B (4) with the same
-- role and no case of his own; eight active cases, one country each, written every way the product writes it.
-- Organization 2 with admin (7) and three cases.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a375_actors(n INTEGER, org INTEGER, role platform.business_role, claims TEXT);
INSERT INTO a375_actors(n, org, role) VALUES
  (1, 1, 'admin'), (2, 1, 'sales'), (3, 1, 'curator'), (4, 1, 'curator'),
  (5, 2, 'sales'), (6, 2, 'curator'), (7, 2, 'admin');

INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.a375_id(1), 'A375 Fictional organization'), (pg_temp.a375_id(2), 'A375 Fictional organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a375_id(100 + n), 'a375-' || n || '@example.invalid', '{}'::JSONB FROM a375_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a375_id(200 + n), pg_temp.a375_id(100 + n), 'A375 Actor ' || n, 'active', 1 FROM a375_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a375_id(300 + n), pg_temp.a375_id(a.org), pg_temp.a375_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM a375_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.a375_id(301), pg_temp.a375_id(307));

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a375_id(401), pg_temp.a375_id(1), 'organization', pg_temp.a375_id(1), 1),
  (pg_temp.a375_id(402), pg_temp.a375_id(2), 'organization', pg_temp.a375_id(2), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a375_id(410 + (n - 500)), pg_temp.a375_id(1), 'student_case', pg_temp.a375_id(n), 1 FROM generate_series(501, 508) AS n;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a375_id(450 + (n - 600)), pg_temp.a375_id(2), 'student_case', pg_temp.a375_id(n), 1 FROM generate_series(601, 603) AS n;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version,
  granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a375_id(1), pg_temp.a375_id(301), pg_temp.a375_id(401), 1, 1, TRUE, 'system', 'A375 synthetic organization scope', pg_temp.a375_id(601)),
  (pg_temp.a375_id(2), pg_temp.a375_id(307), pg_temp.a375_id(402), 1, 1, TRUE, 'system', 'A375 synthetic organization B scope', pg_temp.a375_id(602));
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version,
  granted, actor_kind, reason, request_id)
  SELECT pg_temp.a375_id(1), pg_temp.a375_id(303), pg_temp.a375_id(410 + (n - 500)), 1, 1, TRUE, 'system',
    'A375 curator A case scope', pg_temp.a375_id(620 + (n - 500))
  FROM generate_series(501, 508) AS n;

-- Cases normally come from the sale handoff; here only the insert-time transition trigger is bypassed, every table
-- constraint still holds. Organization 1: 501 CN, 502 China (the application-approval spelling), 503 Китай, 507 Кытай: one
-- country; 504 MY; 508 United Arab Emirates; 505 Germany (outside the six); 506 no country. Organization 2: 601 КНР and
-- 603 China (China, as 284 reads them), 602 the Chinese name (no country the library knows).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version)
SELECT pg_temp.a375_id(c.n), pg_temp.a375_id(c.org), pg_temp.a375_id(c.sales), pg_temp.a375_id(c.curator), 'synthetic:a375:' || c.n, c.name,
  c.country, c.degree, c.program, 'contract_confirmed', 'active'::platform.student_case_state, clock_timestamp(),
  pg_temp.a375_id(CASE WHEN c.org = 1 THEN 410 + (c.n - 500) ELSE 450 + (c.n - 600) END), 1
FROM (VALUES
  (501, 1, 302, 303, 'A375 Alpha Code',     'CN',                   'bachelor',    NULL::TEXT),
  (502, 1, 302, 303, 'A375 Beta English',   'China',                'Бакалавриат', NULL),
  (503, 1, 302, 303, 'A375 Gamma Russian',  'Китай',                NULL,          NULL),
  (504, 1, 302, 303, 'A375 Delta Malaysia', 'MY',                   NULL,          'Engineering'),
  (505, 1, 302, 303, 'A375 Epsilon Legacy', 'Germany',              NULL,          NULL),
  (506, 1, 302, 303, 'A375 Zeta Nocountry', NULL,                   NULL,          NULL),
  (507, 1, 302, 303, 'A375 Eta Kyrgyz',     'Кытай',                NULL,          NULL),
  (508, 1, 302, 303, 'A375 Theta Emirates', 'United Arab Emirates', NULL,          NULL),
  (601, 2, 305, 306, 'A375 OrgB Knr',       'КНР',                  'bachelor',    NULL),
  (602, 2, 305, 306, 'A375 OrgB Hanzi',     '中国',                 NULL,          NULL),
  (603, 2, 305, 306, 'A375 OrgB China',     'China',                NULL,          NULL)
) AS c(n, org, sales, curator, name, country, degree, program);
SET LOCAL session_replication_role = origin;

-- 1b. The second helper over the fixture: the distinct texts the cases of ONE organization hold for a country, whichever way
-- they are written; nothing of the other organization; nothing for an empty list.
SELECT pg_temp.a375_assert(platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['CN']) @> ARRAY['CN', 'China', 'Китай', 'Кытай']
  AND NOT platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['CN']) && ARRAY['MY', 'United Arab Emirates', 'Germany', 'КНР', '中国'],
  'spellings of China in organization 1: the four written ways, no other country, nothing of organization 2');
SELECT pg_temp.a375_assert(platform_private.case_country_spellings(pg_temp.a375_id(2), ARRAY['CN']) @> ARRAY['КНР', 'China']
  AND platform_private.case_country_spellings(pg_temp.a375_id(2), ARRAY['CN']) <@ ARRAY['КНР', 'China'],
  'spellings of China in organization 2: its two, nothing of organization 1, the Chinese name is no spelling the library knows');
SELECT pg_temp.a375_assert(platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['MY']) @> ARRAY['MY']
  AND NOT platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['MY']) && ARRAY['CN', 'China'], 'spellings of Malaysia');
SELECT pg_temp.a375_assert(platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['AE']) @> ARRAY['United Arab Emirates'], 'spellings of the Emirates');
SELECT pg_temp.a375_assert(NOT platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']) && ARRAY['Germany'],
  'Germany is none of the six countries: it is never a spelling of one');
SELECT pg_temp.a375_assert(platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY[]::TEXT[]) = ARRAY[]::TEXT[]
  AND platform_private.case_country_spellings(pg_temp.a375_id(1), NULL) = ARRAY[]::TEXT[]
  AND platform_private.case_country_spellings(pg_temp.a375_id(1), ARRAY[NULL]::TEXT[]) = ARRAY[]::TEXT[]
  AND platform_private.case_country_spellings(NULL, ARRAY['CN']) = ARRAY[]::TEXT[], 'no codes, no spellings; no organization, no spellings');

CREATE FUNCTION pg_temp.a375_claims() RETURNS VOID LANGUAGE SQL AS $$
  UPDATE a375_actors a SET claims = jsonb_build_object(
    'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
    'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
    'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
  )::TEXT
  FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
    JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
  WHERE p.id = pg_temp.a375_id(200 + a.n)
$$;
SELECT pg_temp.a375_claims();
GRANT SELECT ON a375_actors TO authenticated;
SELECT claims AS a375_admin FROM a375_actors WHERE n = 1 \gset
SELECT claims AS a375_admin_b FROM a375_actors WHERE n = 7 \gset

-- One published role «case.read.full + case.update.append + task.manage» on the own scope for both curators (as in the pipeline board
-- suite): A reads the eight cases, B reads none, so B proves that the new words open nothing. One published role of a seller with
-- summary access on the own scope for the seller (the production shape: lead.read, lead.sales.workflow.manage,
-- case.read.summary): he is the responsible seller of the eight cases and reads them in summary mode only.
SET request.jwt.claims TO :'a375_admin';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.a375_id(1), pg_temp.a375_id(701), 0, 'create',
  jsonb_build_object('label', 'A375 Curator casework', 'description', 'Migration 375 synthetic curator casework role',
    'permissionKeys', jsonb_build_array('case.read.full', 'case.update.append', 'task.manage')),
  'A375 create curator casework role', pg_temp.a375_id(711)
) AS a375_role_created \gset
SELECT platform.staff_role_impact(pg_temp.a375_id(1), pg_temp.a375_id(701), 1) ->> 'impactFingerprint' AS a375_role_impact \gset
SELECT platform.staff_role_publish(pg_temp.a375_id(1), pg_temp.a375_id(701), 1, :'a375_role_impact',
  'A375 publish curator casework role', pg_temp.a375_id(712)) AS a375_role_published \gset
SELECT (:'a375_role_published'::JSONB ->> 'bundleId') AS a375_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.a375_id(1), pg_temp.a375_id(303), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(701), 'roleVersion', 2, 'bundleId', :'a375_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'A375 grant curator A casework', pg_temp.a375_id(713)
) AS a375_curator_a_granted \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.a375_id(1), pg_temp.a375_id(304), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(701), 'roleVersion', 2, 'bundleId', :'a375_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'A375 grant curator B casework', pg_temp.a375_id(714)
) AS a375_curator_b_granted \gset
SELECT platform.staff_role_command(
  pg_temp.a375_id(1), pg_temp.a375_id(702), 0, 'create',
  jsonb_build_object('label', 'A375 Seller summary', 'description', 'Migration 375 synthetic seller role with summary access',
    'permissionKeys', jsonb_build_array('lead.read', 'lead.sales.workflow.manage', 'case.read.summary')),
  'A375 create seller role', pg_temp.a375_id(721)
) AS a375_seller_role_created \gset
SELECT platform.staff_role_publish(pg_temp.a375_id(1), pg_temp.a375_id(702), 1,
  platform.staff_role_impact(pg_temp.a375_id(1), pg_temp.a375_id(702), 1) ->> 'impactFingerprint',
  'A375 publish seller role', pg_temp.a375_id(722)) AS a375_seller_role_published \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.a375_id(1), pg_temp.a375_id(302), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(702), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.a375_id(702), 'roleVersion', 2,
    'bundleId', (:'a375_seller_role_published'::JSONB ->> 'bundleId')::UUID, 'bundleVersion', 1)),
  'A375 grant seller summary access', pg_temp.a375_id(723)
) AS a375_seller_granted \gset
RESET ROLE;

-- The grants bump access versions: rebuild every actor's claims from live rows.
SELECT pg_temp.a375_claims();
SELECT claims AS a375_curator_a FROM a375_actors WHERE n = 3 \gset
SELECT claims AS a375_curator_b FROM a375_actors WHERE n = 4 \gset
SELECT claims AS a375_seller FROM a375_actors WHERE n = 2 \gset
SELECT claims AS a375_admin_b FROM a375_actors WHERE n = 7 \gset

-- ---------------------------------------------------------------------------
-- 2. Search of «Студенты» as curator A: page, queue, counts.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'a375_curator_a';
SET LOCAL ROLE authenticated;

-- Sanity: A reads all eight cases through every read; without a query nothing is filtered.
SELECT pg_temp.a375_assert(pg_temp.a375_page(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'page without a query reads all eight');
SELECT pg_temp.a375_assert(pg_temp.a375_page('') = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'page with an empty query reads all eight');
SELECT pg_temp.a375_assert(pg_temp.a375_queue(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'queue without a query reads all eight');
SELECT pg_temp.a375_assert(pg_temp.a375_total(NULL) = 8, 'counts without a query count eight');

-- One country, however it is written: «Китай», its lower case, a fragment, the Kyrgyz and the English name.
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[501, 502, 503, 507], 'page finds China cases by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'КИТАЙ', 'кит', 'Кит', 'Кытай', 'кыт', 'china', 'China', 'chi', 'Chi', 'КНР', 'кнр']) AS q;
SELECT pg_temp.a375_assert(pg_temp.a375_queue(q) = ARRAY[501, 502, 503, 507], 'queue finds China cases by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'кит', 'Кытай', 'china', 'КНР']) AS q;
SELECT pg_temp.a375_assert(pg_temp.a375_total(q) = 4, 'counts follow the list for ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'китай', 'кит', 'Кытай', 'china', 'КНР']) AS q;
-- Two letters and the code are not expanded to the country: they find what the case holds as written, as before. A fragment
-- inside a word is the same: «тай» finds the two cases that hold «Китай» and «Кытай» as written, not the CN and China ones.
SELECT pg_temp.a375_assert(pg_temp.a375_page('CN') = ARRAY[501] AND pg_temp.a375_page('cn') = ARRAY[501]
  AND pg_temp.a375_queue('CN') = ARRAY[501] AND pg_temp.a375_total('cn') = 1, 'the code finds what is written as the code');
SELECT pg_temp.a375_assert(pg_temp.a375_page('ки') = ARRAY[503] AND pg_temp.a375_queue('ки') = ARRAY[503] AND pg_temp.a375_total('ки') = 1,
  'two letters are not expanded to the country');
SELECT pg_temp.a375_assert(pg_temp.a375_page('тай') = ARRAY[503, 507] AND pg_temp.a375_queue('тай') = ARRAY[503, 507] AND pg_temp.a375_total('тай') = 2,
  'a fragment inside a word is not expanded to the country');

-- The other countries.
SELECT pg_temp.a375_assert(pg_temp.a375_page('Малайзия') = ARRAY[504] AND pg_temp.a375_page('malaysia') = ARRAY[504]
  AND pg_temp.a375_page('мал') = ARRAY[504]
  AND pg_temp.a375_queue('Малайзия') = ARRAY[504] AND pg_temp.a375_total('Малайзия') = 1, 'Malaysia by name');
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[508] AND pg_temp.a375_queue(q) = ARRAY[508] AND pg_temp.a375_total(q) = 1,
  'United Arab Emirates by ' || quote_literal(q))
FROM unnest(ARRAY['ОАЭ', 'оаэ', 'БАЭ', 'emirates', 'arab', 'UAE', 'uae', 'Объединённые Арабские Эмираты']) AS q;
-- A country the library knows but no case of this organization carries finds nothing, not everything.
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[]::INTEGER[] AND pg_temp.a375_queue(q) = ARRAY[]::INTEGER[] AND pg_temp.a375_total(q) = 0,
  'no case carries ' || quote_literal(q))
FROM unnest(ARRAY['Türkiye', 'Турция', 'Czech Republic', 'Италия']) AS q;

-- What the search matched before still matches: the name, the programme, the degree as written, the raw country outside the six.
SELECT pg_temp.a375_assert(pg_temp.a375_page('Alpha') = ARRAY[501] AND pg_temp.a375_queue('Alpha') = ARRAY[501] AND pg_temp.a375_total('Alpha') = 1,
  'a name still finds its case');
SELECT pg_temp.a375_assert(pg_temp.a375_page('Engineering') = ARRAY[504] AND pg_temp.a375_queue('engineering') = ARRAY[504],
  'the programme still finds its case');
SELECT pg_temp.a375_assert(pg_temp.a375_page('bachelor') = ARRAY[501] AND pg_temp.a375_page('Бакалавриат') = ARRAY[502],
  'the degree as written still finds its case');
SELECT pg_temp.a375_assert(pg_temp.a375_page('germany') = ARRAY[505] AND pg_temp.a375_queue('Germany') = ARRAY[505] AND pg_temp.a375_total('germany') = 1,
  'a country outside the six is still found by the text as written');
-- A country outside the six has no words: the Russian name of Germany finds nothing, and so does a word no case carries.
SELECT pg_temp.a375_assert(pg_temp.a375_page('Германия') = ARRAY[]::INTEGER[] AND pg_temp.a375_page('Атлантида') = ARRAY[]::INTEGER[]
  AND pg_temp.a375_queue('Атлантида') = ARRAY[]::INTEGER[] AND pg_temp.a375_total('Атлантида') = 0, 'a word that no case carries finds nothing');

-- ---------------------------------------------------------------------------
-- 3. Board filter as curator A.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a375_assert(pg_temp.a375_board(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'board without a filter shows all eight');
SELECT pg_temp.a375_assert(pg_temp.a375_board(c) = ARRAY[501, 502, 503, 507], 'board filter ' || quote_literal(c) || ' is one country')
FROM unnest(ARRAY['CN', 'cn', 'China', 'Китай', 'Кытай', 'КНР']) AS c;
SELECT pg_temp.a375_assert(pg_temp.a375_board('MY') = ARRAY[504] AND pg_temp.a375_board('Malaysia') = ARRAY[504], 'board filter MY');
SELECT pg_temp.a375_assert(pg_temp.a375_board('AE') = ARRAY[508] AND pg_temp.a375_board('ОАЭ') = ARRAY[508], 'board filter AE');
-- Outside the six the comparison is exact, as before; no equivalence is invented.
SELECT pg_temp.a375_assert(pg_temp.a375_board('Germany') = ARRAY[505] AND pg_temp.a375_board('DE') = ARRAY[]::INTEGER[]
  AND pg_temp.a375_board('germany') = ARRAY[]::INTEGER[], 'a country outside the six keeps the exact match');
SELECT pg_temp.a375_assert(pg_temp.a375_board('CN', 'Alpha') = ARRAY[501] AND pg_temp.a375_board('MY', 'Alpha') = ARRAY[]::INTEGER[],
  'the board name search still works together with the country filter');
SELECT pg_temp.a375_assert(pg_temp.a375_board(NULL, 'Китай') = ARRAY[]::INTEGER[], 'the board query is still a name search only');

-- ---------------------------------------------------------------------------
-- 4. Nothing opens that was closed.
-- ---------------------------------------------------------------------------
-- 4a. Curator B has no case: the new words open nothing.
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a375_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a375_assert(pg_temp.a375_page(NULL) = ARRAY[]::INTEGER[] AND pg_temp.a375_queue(NULL) = ARRAY[]::INTEGER[]
  AND pg_temp.a375_total(NULL) = 0 AND pg_temp.a375_board(NULL) = ARRAY[]::INTEGER[], 'curator B sees nothing without a query');
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[]::INTEGER[] AND pg_temp.a375_queue(q) = ARRAY[]::INTEGER[]
  AND pg_temp.a375_total(q) = 0, 'curator B gets nothing by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'CN', 'china', 'ОАЭ', 'germany', 'КНР']) AS q;
SELECT pg_temp.a375_assert(pg_temp.a375_board(c) = ARRAY[]::INTEGER[], 'curator B gets nothing from the board filter ' || quote_literal(c))
FROM unnest(ARRAY['CN', 'China', 'Китай', 'MY', 'Germany']) AS c;
RESET ROLE;

-- 4b. The seller with summary access: the page lists the eight cases in summary mode (the country is part of that summary), so the
-- country word adds nothing he could not read already; the masked programme stays masked in the search; the queue, the counts
-- and the board need full access and refuse him as before.
SET LOCAL request.jwt.claims TO :'a375_seller';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a375_assert(pg_temp.a375_page(NULL) = ARRAY[501, 502, 503, 504, 505, 506, 507, 508], 'the seller reads the eight cases in summary mode');
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) <@ pg_temp.a375_page(NULL), 'the seller search never goes beyond his list: ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'КНР', 'china', 'ОАЭ', 'UAE', 'germany', 'Engineering']) AS q;
SELECT pg_temp.a375_assert(pg_temp.a375_page('Китай') = ARRAY[501, 502, 503, 507] AND pg_temp.a375_page('ОАЭ') = ARRAY[508],
  'the seller finds by the country word what the summary already shows him (the country is not masked)');
SELECT pg_temp.a375_assert(pg_temp.a375_page('Engineering') = ARRAY[]::INTEGER[],
  'the programme is masked in the summary and stays masked in the search');
SELECT pg_temp.a375_assert(pg_temp.a375_state('SELECT pg_temp.a375_queue(NULL)') = '42501'
  AND pg_temp.a375_state('SELECT pg_temp.a375_queue(''Китай'')') = '42501'
  AND pg_temp.a375_state('SELECT pg_temp.a375_total(''Китай'')') = '42501'
  AND pg_temp.a375_state('SELECT pg_temp.a375_board(''CN'')') = '42501',
  'the seller is refused by the queue, the counts and the board, with or without a country word');
RESET ROLE;

-- 4c. Another organization: its administrator finds only its own cases by the same words, and what organization 1 writes
-- never reaches him; organization 1 never sees the cases of organization 2.
SET LOCAL request.jwt.claims TO :'a375_admin_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a375_assert(pg_temp.a375_page(NULL) = ARRAY[601, 602, 603], 'the administrator of organization 2 reads its three cases');
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[601, 603], 'organization 2 finds its China cases by ' || quote_literal(q))
FROM unnest(ARRAY['Китай', 'КНР', 'china', 'кит']) AS q;
SELECT pg_temp.a375_assert(pg_temp.a375_page('中国') = ARRAY[602] AND pg_temp.a375_page('Alpha') = ARRAY[]::INTEGER[]
  AND pg_temp.a375_page('Кытай') = ARRAY[601, 603], 'organization 2 sees none of organization 1 and the Chinese name is found as written');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'a375_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a375_assert(pg_temp.a375_page(q) = ARRAY[501, 502, 503, 507], 'organization 1 finds only its own cases by ' || quote_literal(q))
FROM unnest(ARRAY['КНР', 'China', 'Китай']) AS q;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a375_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'],
  'the helpers are SECURITY DEFINER, STABLE, with an empty search_path: ' || p.oid::regprocedure::TEXT)
FROM pg_proc p WHERE p.oid IN ('platform_private.case_country_codes_matching(text)'::regprocedure,
  'platform_private.case_country_spellings(uuid,text[])'::regprocedure);
SELECT pg_temp.a375_assert(NOT has_function_privilege(r, h, 'EXECUTE'), 'the helper is closed to ' || r || ': ' || h)
FROM unnest(ARRAY['authenticated', 'anon', 'service_role', 'supabase_auth_admin']) AS r,
  unnest(ARRAY['platform_private.case_country_codes_matching(text)', 'platform_private.case_country_spellings(uuid,text[])']) AS h;
SELECT pg_temp.a375_assert(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'],
  'the four reads keep SECURITY DEFINER, STABLE and the empty search_path: ' || p.oid::regprocedure::TEXT)
FROM pg_proc p WHERE p.oid IN (
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::regprocedure,
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure,
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure,
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure);
SELECT pg_temp.a375_assert(has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE'),
  'the four reads keep their grants: ' || f)
FROM unnest(ARRAY[
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)']) AS f;
-- The comments keep their history and add the 375 note.
SELECT pg_temp.a375_assert(obj_description(f::regprocedure, 'pg_proc') LIKE '%375:%', 'the 375 note is in the comment of ' || f)
FROM unnest(ARRAY[
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
  'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
  'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)']) AS f;
SELECT pg_temp.a375_assert(obj_description('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure, 'pg_proc') LIKE 'Curator admissions board.%',
  'the board comment keeps its history');

\echo A375_CASE_COUNTRY_SEARCH_SUITE_PASSED

ROLLBACK;
