\set ON_ERROR_STOP on
-- Boundary suite for migration 282 «Один список стран для всего продукта»
-- (docs/PLAN_CHANGES.md 2026-10-16). The runner invokes this file twice on
-- the real migration chain, matched by name so a renumbering keeps the hooks:
--  * With -v p282_pre=1, immediately BEFORE 282 (the picture 282 changes):
--    the website receiver accepts the 15 values of the current site with their
--    lead directions and refuses the rest; the student catalog shows a Polish
--    university and a consultation about it is accepted; an анкета may name
--    PL and may not name «undecided».
--  * Without it, immediately AFTER 282:
--    (a) the DB source equals src/lib/study-countries.json (codes, order,
--        website values), and the six-country literals already in the schema
--        (118/190 application commands, 214 preparation, the
--        university_applications CHECK) equal it;
--    (b) the website receiver accepts EXACTLY what it accepted before 282
--        (the same 15-value matrix with the same directions, the same
--        refusals with no write), its payload is unchanged, the old literal
--        list is gone and the legacy values sit in their own helper, and its
--        definer, search_path and service-only ACL are kept;
--    (c) the student catalog, the favourites (list, by-ids, add, count), the
--        recent universities and a new consultation about a university show
--        only the product countries; removing a hidden favourite still works;
--        the hidden favourites are counted for their owner only;
--        staff_university_catalog still sees every country;
--    (d) submit_student_application_v1 still accepts the legacy codes old
--        clients send (plan §4.1, §6.6 item 2: a payload with DE is accepted)
--        and a lone «undecided»; «undecided» with a country is refused; a
--        stored pre-282 анкета with PL stays valid when it is decided, a
--        replay of its requestId returns it, and its owner resubmits it; an
--        «undecided» анкета is visible to the Admin and the review department,
--        not to a CN direction curator, and is approved with no direction;
--    (e) the new helpers are callable by no client role.
-- The website owner is the system Admin (the owner gate itself is 262's
-- suite). Isolated synthetic fixtures only, rolled back: no real person,
-- phone, website request, provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- Lightweight Auth bootstrap (126/185/193/280 convention), transaction-local.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $n282_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n282_auth_role$;

CREATE FUNCTION pg_temp.n282_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n282_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N282: %', message; END IF;
END
$$;
-- One RPC expression as somebody: a user id (its real hook claims, role
-- authenticated) or 'service_role'. {"ok": result} or {"error": sqlstate, "message": ...}.
CREATE FUNCTION pg_temp.n282_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    IF p_who = 'service_role' THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::TEXT, TRUE);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
        'user_id', p_who::UUID, 'claims', jsonb_build_object('sub', p_who::UUID, 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
-- The website route's RPC call (src/lib/server/website-lead-intake.ts) for
-- request n with its own phone and IP hash, so rate limits never mix in.
CREATE FUNCTION pg_temp.n282_receive(p_request INTEGER, p_country TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.n282_call('service_role', format(
    'platform.receive_website_lead(%L::UUID, %L::UUID, %L::UUID, %L, %L, 19, %L, %L, TRUE, %L, NULL, NULL)',
    pg_temp.n282_id(1), pg_temp.n282_id(301), pg_temp.n282_id(p_request), 'N282 Fictional Applicant',
    '+9990000' || lpad(p_request::TEXT, 5, '0'), 'N282 City', p_country, lpad(to_hex(p_request), 64, '0')))
$$;
CREATE FUNCTION pg_temp.n282_questionnaire(p_request UUID, p_countries JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT,
    'firstName', 'N282', 'lastName', 'Applicant', 'phone', '+996555282000',
    'destinationCountries', p_countries, 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18')
$$;
-- A real анкета submission by the account itself.
CREATE FUNCTION pg_temp.n282_submit(p_applicant INTEGER, p_request INTEGER, p_countries JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.n282_call(pg_temp.n282_id(p_applicant)::TEXT, format(
    'platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    pg_temp.n282_id(p_request), pg_temp.n282_questionnaire(pg_temp.n282_id(p_request), p_countries)))
$$;
CREATE FUNCTION pg_temp.n282_content(p_name TEXT, p_country TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name', p_name, 'country', p_country, 'city', NULL, 'overview', 'N282 synthetic overview',
    'websiteUrl', 'https://university.example-n282.edu', 'sourceUrl', 'https://university.example-n282.edu/admissions',
    'verifiedOn', '2026-10-16', 'notes', '', 'photoKey', NULL,
    'programs', jsonb_build_array(jsonb_build_object(
      'id', 'cs', 'title', 'Synthetic computer science', 'level', 'bachelor', 'duration', NULL, 'language', NULL,
      'summary', 'Synthetic public program', 'sourceUrl', 'https://university.example-n282.edu/programs/cs',
      'intakes', jsonb_build_array())))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n282_id(INTEGER), pg_temp.n282_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT 'N282_SINGLE_COUNTRY_LIST_SUITE_START' AS n282_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization; 301 system Admin (the website intake owner and
-- the анкета reviewer); 302 a CN direction curator and 303 a member of the
-- review department (invited staff, roles below); 304 a Student (catalog
-- reader, no case); applicants 111..119 with confirmed email and no
-- membership; the анкета configuration.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n282_id(1), 'N282 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n282_id(2), pg_temp.n282_id(1), 'organization', pg_temp.n282_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.n282_id(100 + n), 'n282-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.n282_id(201), pg_temp.n282_id(101), 'N282 Admin', 'active', 1),
  (pg_temp.n282_id(202), pg_temp.n282_id(102), 'N282 CN Curator', 'active', 1),
  (pg_temp.n282_id(203), pg_temp.n282_id(103), 'N282 Review Department', 'active', 1),
  (pg_temp.n282_id(204), pg_temp.n282_id(104), 'N282 Student', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.n282_id(300 + a.n), pg_temp.n282_id(1), pg_temp.n282_id(200 + a.n), 'active', a.role::platform.business_role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
       AND status = 'published' ORDER BY version DESC LIMIT 1),
    a.role IS NOT DISTINCT FROM 'admin'
  FROM (VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, 'student')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.n282_id(1), pg_temp.n282_id(300 + n), pg_temp.n282_id(2), 1, 1, TRUE, 'system',
    'N282 synthetic organization scope', pg_temp.n282_id(600 + n)
  FROM unnest(ARRAY[1, 4]) AS n;
INSERT INTO platform.staff_departments(id, organization_id, name)
  VALUES (pg_temp.n282_id(930), pg_temp.n282_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
  VALUES (TRUE, pg_temp.n282_id(1), pg_temp.n282_id(930), TRUE, NULL);
-- The анкета review keys (177 student_application_can_manage) as one role:
-- 302 holds it for the CN direction, 303 for the review department.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n282_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n282_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n282_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n282_admin_setup';
SET LOCAL ROLE authenticated;
DO $n282_roles$
DECLARE published JSONB; m RECORD;
BEGIN
  PERFORM platform.staff_role_command(pg_temp.n282_id(1), pg_temp.n282_id(1001), 0, 'create',
    jsonb_build_object('label', 'N282 Application review', 'description', 'Migration 282 synthetic review role',
      'permissionKeys', jsonb_build_array('profile.read.full', 'profile.manage', 'case.curator.assign')),
    'N282 create role', pg_temp.n282_id(1011));
  published := platform.staff_role_publish(pg_temp.n282_id(1), pg_temp.n282_id(1001), 1,
    platform.staff_role_impact(pg_temp.n282_id(1), pg_temp.n282_id(1001), 1) ->> 'impactFingerprint',
    'N282 publish role', pg_temp.n282_id(1012));
  FOR m IN SELECT * FROM (VALUES (302, 'direction', 'CN'), (303, 'department', pg_temp.n282_id(930)::TEXT)) AS x(n, kind, key) LOOP
    PERFORM platform.staff_role_assignments_save(pg_temp.n282_id(1), pg_temp.n282_id(m.n), 1,
      jsonb_build_array(jsonb_build_object('roleId', pg_temp.n282_id(1001),
        'scope', jsonb_build_object('kind', m.kind, 'key', m.key, 'resourceKind', NULL))),
      jsonb_build_array(jsonb_build_object('roleId', pg_temp.n282_id(1001), 'roleVersion', 2,
        'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'N282 grant review role', pg_temp.n282_id(1020 + m.n));
  END LOOP;
END
$n282_roles$;
RESET ROLE;
SET LOCAL request.jwt.claims TO '';

-- Catalogue: replica mode skips only the import-provenance FK (the 195
-- convention); valid_university_content still checks every payload. Polish
-- and Cypriot cards stay in the staff catalogue; CN and PL are recent.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
  SELECT pg_temp.n282_id(700 + u.n), pg_temp.n282_id(1), 'university', u.name, u.country, NULL,
    pg_temp.n282_id(720 + u.n), 'synthetic-n282-rev', pg_temp.n282_id(740 + u.n), 'rec_' || repeat(u.letter, 32), pg_temp.n282_id(301)
  FROM (VALUES (1, 'N282 Alpha China', 'CN', 'a'), (2, 'N282 Beta Italy', 'IT', 'b'), (3, 'N282 Gamma Turkey', 'TR', 'c'),
    (4, 'N282 Delta Poland', 'PL', 'd'), (5, 'N282 Epsilon Cyprus', 'CY', 'e')) AS u(n, name, country, letter);
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
  SELECT pg_temp.n282_id(760 + u.n), pg_temp.n282_id(1), pg_temp.n282_id(700 + u.n), 0, 1, pg_temp.n282_content(u.name, u.country),
    pg_temp.n282_id(720 + u.n), 'published', 'N282 synthetic review', pg_temp.n282_id(301), pg_temp.n282_id(301),
    CASE WHEN u.recent THEN statement_timestamp() - interval '1 day' ELSE statement_timestamp() - interval '90 days' END
  FROM (VALUES (1, 'N282 Alpha China', 'CN', TRUE), (2, 'N282 Beta Italy', 'IT', FALSE), (3, 'N282 Gamma Turkey', 'TR', FALSE),
    (4, 'N282 Delta Poland', 'PL', TRUE), (5, 'N282 Epsilon Cyprus', 'CY', FALSE)) AS u(n, name, country, recent);
SET LOCAL session_replication_role = origin;
-- The Student favoured China and Poland before 282.
INSERT INTO platform_private.university_favorites(organization_id, membership_id, institution_id)
  VALUES (pg_temp.n282_id(1), pg_temp.n282_id(304), pg_temp.n282_id(701)),
         (pg_temp.n282_id(1), pg_temp.n282_id(304), pg_temp.n282_id(704));

SELECT pg_temp.n282_id(101)::TEXT AS n282_admin, pg_temp.n282_id(102)::TEXT AS n282_curator,
  pg_temp.n282_id(103)::TEXT AS n282_review, pg_temp.n282_id(104)::TEXT AS n282_student \gset

CREATE TEMP VIEW n282_counts AS SELECT
  (SELECT count(*) FROM platform_private.website_lead_receipts WHERE organization_id = pg_temp.n282_id(1)) AS receipts,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n282_id(1)) AS leads,
  (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n282_id(1) AND action = 'lead.website.receive') AS audits;

-- ---------------------------------------------------------------------------
-- Website receiver matrix (both runs): the 15 values of the current site are
-- accepted with these lead directions; nothing else is.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n282_website(n INTEGER, country TEXT, direction TEXT);
INSERT INTO n282_website VALUES
  (801, 'China', 'CN'), (802, 'Malaysia', 'MY'), (803, 'United Arab Emirates', 'AE'), (804, 'Turkey', 'TR'),
  (805, 'Italy', 'EU'), (806, 'Czechia', 'EU'), (807, 'Undecided', NULL),
  (811, 'Europe', 'EU'), (812, 'Germany', 'EU'), (813, 'United Kingdom', 'EU'), (814, 'Netherlands', 'EU'),
  (815, 'France', 'EU'), (816, 'Poland', 'EU'), (817, 'Austria', 'EU'), (818, 'Cyprus', 'EU');
CREATE TEMP TABLE n282_website_result AS
  SELECT w.n, w.country, w.direction, pg_temp.n282_receive(w.n, w.country) AS result FROM n282_website w;
SELECT pg_temp.n282_assert(bool_and(r.result = jsonb_build_object('ok', jsonb_build_object('status', 'accepted', 'request_id', pg_temp.n282_id(r.n)))),
  'a value of the current site was not accepted: ' || string_agg(r.country || '=' || r.result::TEXT, '; '))
FROM n282_website_result r;
SELECT pg_temp.n282_assert(count(*) = 15, 'every accepted value did not open its own lead with the expected direction and stored payload')
FROM n282_website w
JOIN platform_private.website_lead_receipts rc ON rc.request_id = pg_temp.n282_id(w.n)
JOIN platform.leads l ON l.id = rc.lead_id
WHERE l.source_key = 'website' AND l.interest_direction IS NOT DISTINCT FROM w.direction
  AND rc.payload = jsonb_build_object('name', 'N282 Fictional Applicant', 'phone', '+9990000' || lpad(w.n::TEXT, 5, '0'),
    'age', 19, 'city', 'N282 City', 'country', w.country, 'consent', TRUE);
SELECT pg_temp.n282_assert((SELECT receipts = 15 AND leads = 15 AND audits = 15 FROM n282_counts),
  'the matrix did not write exactly one receipt, lead and audit event per value');
CREATE TEMP TABLE n282_refused AS
  SELECT v.n, v.country, pg_temp.n282_receive(v.n, v.country) AS result
  FROM (VALUES (821, 'Mars'), (822, 'Spain'), (823, 'Hungary'), (824, 'china'), (825, 'Czech Republic'),
    (826, ''), (827, 'Undecided '), (828, NULL::TEXT)) AS v(n, country);
SELECT pg_temp.n282_assert(bool_and(r.result = '{"error":"22023","message":"website_intake_invalid"}'::JSONB),
  'a value outside the site list was not refused 22023: ' || string_agg(coalesce(r.country, 'NULL') || '=' || r.result::TEXT, '; '))
FROM n282_refused r;
SELECT pg_temp.n282_assert((SELECT receipts = 15 AND leads = 15 AND audits = 15 FROM n282_counts),
  'a refused website value wrote a receipt, lead or audit event');
SELECT pg_temp.n282_assert(pg_temp.n282_receive(801, 'China') = jsonb_build_object('ok', jsonb_build_object('status', 'accepted', 'request_id', pg_temp.n282_id(801)))
    AND pg_temp.n282_receive(816, 'Czechia') = '{"ok":{"status":"request_conflict"}}'::JSONB
    AND (SELECT receipts = 15 AND leads = 15 FROM n282_counts),
  'a replay was not accepted without a write, or a reused requestId with another country was not a conflict');

\if :{?p282_pre}

-- ---------------------------------------------------------------------------
-- Before 282: Poland is in the student catalogue, an анкета may name PL and
-- may not name «undecided».
-- ---------------------------------------------------------------------------
SELECT pg_temp.n282_assert(to_regprocedure('platform_private.study_country_codes()') IS NULL,
  'the pre-282 run found the 282 source already in place');
SELECT pg_temp.n282_assert(
  (pg_temp.n282_call(:'n282_student', 'platform.student_university_catalog()') #> '{ok,items}') @> jsonb_build_array(jsonb_build_object('id', pg_temp.n282_id(704))),
  'before 282 the student catalogue did not show the Polish university');
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', format('platform.create_portal_consultation_request_v1(%L::UUID, %L::UUID)',
    pg_temp.n282_id(1101), pg_temp.n282_id(704))) #>> '{ok,status}' = 'requested',
  'before 282 a consultation about the Polish university was not accepted');
SELECT pg_temp.n282_assert(pg_temp.n282_submit(111, 901, '["PL"]'::JSONB) #>> '{ok,status}' = 'pending',
  'before 282 an анкета naming PL was not accepted');
SELECT pg_temp.n282_assert(pg_temp.n282_submit(112, 902, '["undecided"]'::JSONB) = '{"error":"22023","message":"student_application_invalid"}'::JSONB,
  'before 282 an «undecided» анкета was not refused');

\else

-- ---------------------------------------------------------------------------
-- (a) One source: the DB list equals src/lib/study-countries.json, and the
-- six-country literals already in the schema equal it.
-- ---------------------------------------------------------------------------
\set n282_json `cat /workspace/src/lib/study-countries.json`
SELECT pg_temp.n282_assert(
  platform_private.study_country_codes() = ARRAY(SELECT c ->> 'code' FROM jsonb_array_elements(:'n282_json'::JSONB -> 'countries') WITH ORDINALITY AS x(c, i) ORDER BY i)
    AND platform_private.study_country_codes() = ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']::TEXT[],
  'platform_private.study_country_codes() is not the list of study-countries.json');
SELECT pg_temp.n282_assert(
  platform_private.website_enquiry_country_values() =
    ARRAY(SELECT c ->> 'website' FROM jsonb_array_elements(:'n282_json'::JSONB -> 'countries') WITH ORDINALITY AS x(c, i) ORDER BY i)
      || (:'n282_json'::JSONB #>> '{undecided,website}')
    AND (:'n282_json'::JSONB #>> '{undecided,code}') = 'undecided',
  'the website values are not the website values of study-countries.json');
SELECT pg_temp.n282_assert(
  NOT (platform_private.website_enquiry_legacy_country_values() && platform_private.website_enquiry_country_values())
    AND cardinality(platform_private.website_enquiry_legacy_country_values()) = 8,
  'the legacy website values overlap the current ones');
SELECT
  array_to_string(ARRAY(SELECT quote_literal(c) FROM unnest(platform_private.study_country_codes()) c), ',') AS n282_tight,
  array_to_string(ARRAY(SELECT quote_literal(c) FROM unnest(platform_private.study_country_codes()) c), ', ') AS n282_spaced,
  array_to_string(ARRAY(SELECT quote_literal(c) || '::text' FROM unnest(platform_private.study_country_codes()) c), ', ') AS n282_typed \gset
SELECT pg_temp.n282_assert(count(*) = 5 AND bool_and(strpos(p.prosrc, :'n282_tight') > 0 OR strpos(p.prosrc, :'n282_spaced') > 0),
  'an application or preparation command no longer holds the product country list')
FROM pg_proc p
WHERE p.oid IN (
  'private.platform_create_university_application(uuid,uuid,text,text,platform.application_status,text,text,boolean,date,text,text,bigint,uuid)'::regprocedure,
  'private.platform_create_catalog_university_application(uuid,uuid,uuid,text,platform.application_status,text,text,boolean,date,text,text,bigint,uuid)'::regprocedure,
  'private.platform_update_university_application_details(uuid,uuid,boolean,date,text,text,bigint,uuid)'::regprocedure,
  'platform_private.guard_catalog_preparation_insert()'::regprocedure,
  'platform_private.select_catalog_intake(uuid,uuid,uuid,text,uuid,bigint,uuid,boolean)'::regprocedure);
SELECT pg_temp.n282_assert(strpos(pg_get_constraintdef(c.oid), 'ARRAY[' || :'n282_typed' || ']') > 0,
  'the university_applications country CHECK is not the product country list')
FROM pg_constraint c
WHERE c.conrelid = 'platform.university_applications'::regclass AND c.conname = 'university_applications_country_check';

-- ---------------------------------------------------------------------------
-- (b) The website receiver: same acceptance (the matrix above), the old
-- literal list replaced by the two helpers, posture kept.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n282_assert(
  strpos(p.prosrc, '''Austria'',''Cyprus''') = 0
    AND strpos(p.prosrc, 'p_country=ANY(platform_private.website_enquiry_country_values())') > 0
    AND strpos(p.prosrc, 'p_country=ANY(platform_private.website_enquiry_legacy_country_values())') > 0
    -- The lead direction mapping is untouched.
    AND strpos(p.prosrc, 'WHEN ''italy'' THEN ''EU''') > 0 AND strpos(p.prosrc, 'WHEN ''czechia'' THEN ''EU''') > 0
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND (SELECT count(*) = 1 FROM pg_proc q WHERE q.pronamespace = 'platform'::REGNAMESPACE AND q.proname = 'receive_website_lead'),
  'the website receiver body or posture is not the 282 shape')
FROM pg_proc p
WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure;

-- ---------------------------------------------------------------------------
-- (c) Student catalogue: only the product countries.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n282_call(:'n282_student', 'platform.student_university_catalog()') AS n282_all \gset
SELECT pg_temp.n282_assert(
  ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(:'n282_all'::JSONB #> '{ok,items}') x ORDER BY x #>> '{content,name}')
    = ARRAY[pg_temp.n282_id(701)::TEXT, pg_temp.n282_id(702)::TEXT, pg_temp.n282_id(703)::TEXT]
    AND :'n282_all'::JSONB #> '{ok,nextOffset}' = 'null'::JSONB,
  'the student catalogue is not exactly the China, Italy and Turkey cards: ' || :'n282_all');
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', 'platform.student_university_catalog(p_country => ''PL'')') = '{"ok":{"items":[],"nextOffset":null}}'::JSONB
    AND pg_temp.n282_call(:'n282_student', format('platform.student_university_catalog(p_institution_id => %L::UUID)', pg_temp.n282_id(704)))
      = '{"ok":{"items":[],"nextOffset":null}}'::JSONB
    AND jsonb_array_length(pg_temp.n282_call(:'n282_student', 'platform.student_university_catalog(p_country => ''IT'')') #> '{ok,items}') = 1,
  'a Polish filter or the Polish card still reached the student, or the Italian filter broke');
SELECT pg_temp.n282_assert(
  jsonb_array_length(pg_temp.n282_call(:'n282_admin', format('platform.staff_university_catalog(%L::UUID)', pg_temp.n282_id(1))) #> '{ok,items}') = 5
    AND jsonb_array_length(pg_temp.n282_call(:'n282_admin', format('platform.staff_university_catalog(%L::UUID, p_country => ''CY'')', pg_temp.n282_id(1))) #> '{ok,items}') = 1,
  'the staff catalogue no longer sees every country');
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', 'platform.student_university_favorites_v1()') #> '{ok}'
      = jsonb_build_array(jsonb_build_object('institutionId', pg_temp.n282_id(701),
          'createdAt', (SELECT to_jsonb(f.created_at) FROM platform_private.university_favorites f WHERE f.institution_id = pg_temp.n282_id(701)))),
  'the favourites list still shows the Polish university');
SELECT pg_temp.n282_assert(
  jsonb_array_length(pg_temp.n282_call(:'n282_student', format('platform.student_university_catalog_by_ids_v1(ARRAY[%L]::UUID[])', pg_temp.n282_id(701))) #> '{ok,items}') = 1
    AND pg_temp.n282_call(:'n282_student', format('platform.student_university_catalog_by_ids_v1(ARRAY[%L, %L]::UUID[])', pg_temp.n282_id(701), pg_temp.n282_id(704)))
      = '{"error":"42501","message":"Institution is unavailable"}'::JSONB,
  'by-ids did not refuse a Polish id like any unavailable id');
-- The hidden Polish favourite is counted for its owner only, without naming it.
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', 'platform.student_hidden_university_favorites_v1()') = '{"ok":{"hiddenCount":1}}'::JSONB
    AND pg_temp.n282_call(:'n282_admin', 'platform.student_hidden_university_favorites_v1()') = '{"error":"42501","message":"Favourites unavailable"}'::JSONB,
  'the hidden favourite count is not 1 for the Student or is readable by staff');
-- One command per statement: each sees the previous one's write.
SELECT pg_temp.n282_call(:'n282_student', format('platform.set_university_favorite_v1(%L::UUID, TRUE)', pg_temp.n282_id(705))) AS n282_fav_cy \gset
SELECT pg_temp.n282_call(:'n282_student', format('platform.set_university_favorite_v1(%L::UUID, TRUE)', pg_temp.n282_id(702))) AS n282_fav_it \gset
SELECT pg_temp.n282_call(:'n282_student', format('platform.set_university_favorite_v1(%L::UUID, FALSE)', pg_temp.n282_id(704))) AS n282_unfav_pl \gset
SELECT pg_temp.n282_assert(
  :'n282_fav_cy'::JSONB = '{"error":"42501","message":"Institution is unavailable"}'::JSONB
    -- China and Italy are visible; the hidden Polish row is not counted.
    AND :'n282_fav_it'::JSONB = jsonb_build_object('ok', jsonb_build_object('institutionId', pg_temp.n282_id(702), 'favored', TRUE, 'favoritesCount', 2))
    AND :'n282_unfav_pl'::JSONB = jsonb_build_object('ok', jsonb_build_object('institutionId', pg_temp.n282_id(704), 'favored', FALSE, 'favoritesCount', 2))
    AND NOT EXISTS (SELECT 1 FROM platform_private.university_favorites f WHERE f.institution_id IN (pg_temp.n282_id(704), pg_temp.n282_id(705))),
  'adding a Cypriot favourite was not refused, the count is not the visible list, or removing the hidden Polish favourite failed: '
    || :'n282_fav_cy' || ' ' || :'n282_fav_it' || ' ' || :'n282_unfav_pl');
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', 'platform.student_recent_universities_v1()') #> '{ok,items}'
    = jsonb_build_array(jsonb_build_object('id', pg_temp.n282_id(701), 'name', 'N282 Alpha China', 'country', 'CN', 'city', NULL,
        'firstPublishedAt', (SELECT to_jsonb(p.reviewed_at) FROM platform_private.university_catalog_publications p WHERE p.id = pg_temp.n282_id(761)))),
  'the recent universities still show the recent Polish card');
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_student', 'platform.student_hidden_university_favorites_v1()') = '{"ok":{"hiddenCount":0}}'::JSONB,
  'removing the hidden Polish favourite did not clear the hidden count');
-- A new consultation names only a product-country university; one without a
-- university is unchanged.
SELECT pg_temp.n282_call(:'n282_student', format('platform.create_portal_consultation_request_v1(%L::UUID, %L::UUID)',
  pg_temp.n282_id(1101), pg_temp.n282_id(704))) AS n282_consult_pl \gset
SELECT pg_temp.n282_call(:'n282_student', format('platform.create_portal_consultation_request_v1(%L::UUID, %L::UUID)',
  pg_temp.n282_id(1102), pg_temp.n282_id(702))) AS n282_consult_it \gset
SELECT pg_temp.n282_assert(
  :'n282_consult_pl'::JSONB = '{"error":"42501","message":"Institution is unavailable"}'::JSONB
    AND :'n282_consult_it'::JSONB #>> '{ok,status}' = 'requested'
    AND :'n282_consult_it'::JSONB #>> '{ok,institutionName}' = 'N282 Beta Italy'
    AND (SELECT count(*) = 1 FROM platform_private.portal_consultation_requests r WHERE r.organization_id = pg_temp.n282_id(1)),
  'a consultation about the Polish university was not refused, or one about the Italian university failed: '
    || :'n282_consult_pl' || ' ' || :'n282_consult_it');

-- ---------------------------------------------------------------------------
-- (d) анкета: the product countries, a lone «undecided» and the legacy codes
-- old clients send are accepted; «undecided» with a country is not.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n282_submit(111, 901, '["CN", "IT"]'::JSONB) AS n282_cn_it,
  pg_temp.n282_submit(112, 902, '["undecided"]'::JSONB) AS n282_undecided,
  pg_temp.n282_submit(113, 903, '["PL"]'::JSONB) AS n282_pl,
  pg_temp.n282_submit(114, 904, '["CN", "undecided"]'::JSONB) AS n282_mixed,
  pg_temp.n282_submit(115, 905, '["DE", "CZ"]'::JSONB) AS n282_de,
  pg_temp.n282_submit(117, 908, '["undecided", "undecided"]'::JSONB) AS n282_twice \gset
SELECT pg_temp.n282_assert(:'n282_cn_it'::JSONB #>> '{ok,status}' = 'pending'
    AND :'n282_cn_it'::JSONB #> '{ok,questionnaire,destinationCountries}' = '["CN", "IT"]'::JSONB
    AND :'n282_undecided'::JSONB #>> '{ok,status}' = 'pending'
    AND :'n282_undecided'::JSONB #> '{ok,questionnaire,destinationCountries}' = '["undecided"]'::JSONB,
  'an анкета with product countries or a lone «undecided» was not accepted: ' || :'n282_cn_it' || ' ' || :'n282_undecided');
-- Old iPhone builds (0.1.0, 1.0) and a tab opened before the release still
-- offer the 15 countries: the same RPC keeps accepting them (plan §4.1).
SELECT pg_temp.n282_assert(:'n282_pl'::JSONB #>> '{ok,status}' = 'pending'
    AND :'n282_pl'::JSONB #> '{ok,questionnaire,destinationCountries}' = '["PL"]'::JSONB
    AND :'n282_de'::JSONB #>> '{ok,status}' = 'pending'
    AND :'n282_de'::JSONB #> '{ok,questionnaire,destinationCountries}' = '["DE", "CZ"]'::JSONB,
  'a legacy-country анкета from an old client was refused: ' || :'n282_pl' || ' ' || :'n282_de');
SELECT pg_temp.n282_assert(:'n282_mixed'::JSONB = '{"error":"22023","message":"student_application_invalid"}'::JSONB
    AND :'n282_twice'::JSONB = '{"error":"22023","message":"student_application_invalid"}'::JSONB
    AND NOT EXISTS (SELECT 1 FROM platform_private.student_applications a
      WHERE a.auth_user_id IN (pg_temp.n282_id(114), pg_temp.n282_id(117))),
  '«undecided» with a country or twice was not refused without a row: ' || :'n282_mixed' || ' ' || :'n282_twice');

-- A pre-282 анкета with PL (its row and receipt as 180 wrote them): the CHECK
-- still accepts it, a replay of its requestId returns it, the Admin sees and
-- rejects it (an UPDATE re-checks the row), and its owner resubmits it.
INSERT INTO platform_private.student_applications(id, organization_id, auth_user_id, normalized_email, questionnaire)
  VALUES (pg_temp.n282_id(950), pg_temp.n282_id(1), pg_temp.n282_id(116), 'n282-16@example.invalid',
    pg_temp.n282_questionnaire(pg_temp.n282_id(906), '["PL", "CN"]'::JSONB));
INSERT INTO platform_private.student_application_receipts(request_id, application_id, actor_auth_user_id, command, input)
  VALUES (pg_temp.n282_id(906), pg_temp.n282_id(950), pg_temp.n282_id(116), 'submit',
    jsonb_build_object('questionnaire', pg_temp.n282_questionnaire(pg_temp.n282_id(906), '["PL", "CN"]'::JSONB), 'expected_revision', 0));
SELECT pg_temp.n282_assert(pg_temp.n282_submit(116, 906, '["PL", "CN"]'::JSONB) #>> '{ok,id}' = pg_temp.n282_id(950)::TEXT,
  'a replay of a pre-282 requestId did not return the stored анкета');

-- Who sees what: the Admin and the review department see every анкета; the
-- CN curator sees those naming a CN country, not the «undecided» one (no
-- direction) nor the PL and DE+CZ ones (EUROPE).
SELECT pg_temp.n282_call(:'n282_admin', 'platform.staff_student_applications_v1()') AS n282_queue,
  pg_temp.n282_call(:'n282_review', 'platform.staff_student_applications_v1()') AS n282_queue_review,
  pg_temp.n282_call(:'n282_curator', 'platform.staff_student_applications_v1()') AS n282_queue_curator \gset
CREATE TEMP TABLE n282_ids AS SELECT * FROM (VALUES
  ('cn_it', :'n282_cn_it'::JSONB #>> '{ok,id}'), ('undecided', :'n282_undecided'::JSONB #>> '{ok,id}'),
  ('pl', :'n282_pl'::JSONB #>> '{ok,id}'), ('de', :'n282_de'::JSONB #>> '{ok,id}'),
  ('legacy', pg_temp.n282_id(950)::TEXT)) AS x(label, id);
CREATE FUNCTION pg_temp.n282_seen(p_queue JSONB) RETURNS TEXT[] LANGUAGE SQL STABLE AS $$
  SELECT ARRAY(SELECT i.label FROM n282_ids i
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_queue #> '{ok,applications}') x WHERE x ->> 'id' = i.id)
    ORDER BY i.label)
$$;
SELECT pg_temp.n282_assert(pg_temp.n282_seen(:'n282_queue'::JSONB) = ARRAY['cn_it', 'de', 'legacy', 'pl', 'undecided']
    AND pg_temp.n282_seen(:'n282_queue_review'::JSONB) = ARRAY['cn_it', 'de', 'legacy', 'pl', 'undecided']
    AND pg_temp.n282_seen(:'n282_queue_curator'::JSONB) = ARRAY['cn_it', 'legacy'],
  'queue visibility is not Admin/review department = all, CN curator = CN only: admin '
    || pg_temp.n282_seen(:'n282_queue'::JSONB)::TEXT || ' review ' || pg_temp.n282_seen(:'n282_queue_review'::JSONB)::TEXT
    || ' curator ' || pg_temp.n282_seen(:'n282_queue_curator'::JSONB)::TEXT);
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_curator', format('platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''N282 synthetic decision'', %L::UUID)',
    :'n282_undecided'::JSONB #>> '{ok,id}', pg_temp.n282_id(909))) = '{"error":"42501","message":"student_application_forbidden"}'::JSONB,
  'the CN curator could decide the «undecided» анкета');

-- The «undecided» анкета is approved: the case has no country and no
-- direction; Admissions chooses them later (180).
SELECT pg_temp.n282_call(:'n282_admin', format('platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''N282 synthetic decision'', %L::UUID)',
  :'n282_undecided'::JSONB #>> '{ok,id}', pg_temp.n282_id(910))) AS n282_approved \gset
SELECT pg_temp.n282_assert(:'n282_approved'::JSONB #>> '{ok,status}' = 'approved'
    AND :'n282_approved'::JSONB #>> '{ok,admissions_direction}' IS NULL
    AND (SELECT c.target_country IS NULL FROM platform.student_cases c
      WHERE c.id = (:'n282_approved'::JSONB #>> '{ok,student_case_id}')::UUID),
  'the «undecided» анкета was not approved into a case without country and direction: ' || :'n282_approved');

SELECT pg_temp.n282_assert(
  pg_temp.n282_call(:'n282_admin', format('platform.decide_student_application_v1(%L::UUID, 1, ''reject'', ''N282 synthetic decision'', %L::UUID)',
    pg_temp.n282_id(950), pg_temp.n282_id(907))) #>> '{ok,status}' = 'rejected',
  'the Admin could not decide a stored pre-282 анкета');
-- The rejected owner resubmits the same countries with a new requestId.
SELECT pg_temp.n282_assert(
  pg_temp.n282_call(pg_temp.n282_id(116)::TEXT, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 2)',
    pg_temp.n282_id(911), pg_temp.n282_questionnaire(pg_temp.n282_id(911), '["PL", "CN"]'::JSONB))) #>> '{ok,status}' = 'pending',
  'the owner of a rejected pre-282 анкета could not resubmit it');

-- ---------------------------------------------------------------------------
-- (e) Posture of the new helpers.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n282_assert(bool_and(p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) AND count(*) = 4,
  'a 282 helper is callable by a client role or lost its search_path')
FROM pg_proc p
WHERE p.oid IN ('platform_private.study_country_codes()'::regprocedure,
  'platform_private.website_enquiry_country_values()'::regprocedure,
  'platform_private.website_enquiry_legacy_country_values()'::regprocedure,
  'platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])'::regprocedure);
SELECT pg_temp.n282_assert(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    -- submit_student_application_v1 is not touched by 282.
    AND strpos((SELECT prosrc FROM pg_proc WHERE oid = 'platform.submit_student_application_v1(uuid,jsonb,bigint)'::regprocedure),
      'study_country_codes') = 0,
  'the hidden favourites RPC is not a Student-only definer, or 282 changed submit_student_application_v1')
FROM pg_proc p
WHERE p.oid = 'platform.student_hidden_university_favorites_v1()'::regprocedure;

\endif

SELECT 'N282_SINGLE_COUNTRY_LIST_SUITE_END' AS n282_suite_marker;

ROLLBACK;
