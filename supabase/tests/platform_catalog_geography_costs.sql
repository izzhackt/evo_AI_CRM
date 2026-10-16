\set ON_ERROR_STOP on
-- Boundary suite for migration 283 «Университеты v2: география и стоимость»
-- (docs/PLAN_CHANGES.md 2026-10-16; contract docs/catalog/geography-costs-contract.md).
-- The runner calls this file twice, matched by name so a renumbering keeps
-- the hooks:
--  * with -v p283_pre=1 immediately BEFORE 283: it prints one line
--    «N283_OLD_RPCS <md5>» over the definitions and ACLs of the catalogue,
--    favourite, preparation and consultation RPCs that old iPhone builds call;
--  * without it immediately AFTER 283 (with -v n283_old_rpcs_md5=<that md5>):
--    (a) those RPCs are byte-identical and keep their response shape;
--    (b) the student index and detail show only published data of the six
--        countries of the student's own organization; another organization's
--        student, staff of every kind and anon get 42501; notModified works
--        and the version moves when published data moves;
--    (c) the detail answers in one call what the page read in four (card,
--        favourite, preparations in the student_catalog_preparations_v1 form,
--        open consultation) plus country, published city and published costs
--        with rates; the agency name and URL never reach the student;
--    (d) staff RPCs pass for the catalogue publication right and the system
--        Admin and refuse Sales, the curator, the student and anon; agency
--        confirmation is Admin only; the service role needs a named live Admin;
--    (e) the CHECK refuses a published unconfirmed agency row (direct UPDATE,
--        publish RPC, import); an edit returns a row to draft;
--    (f) request_id idempotency (replay, reuse with another input, another
--        operation), version conflicts, re-import by importKey;
--    (g) city rules: only a complete card publishes, a city keeps its country,
--        a university links only to a city of its country;
--    (h) no client role reads the new tables or calls the private helpers.
-- Members are modelled like production (coarse role NULL, permissions only
-- from scoped staff roles, as 281's suite). Isolated synthetic fixtures only,
-- rolled back.

\set n283_snapshot_sql 'SELECT md5(string_agg(p.oid::REGPROCEDURE::TEXT || md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::TEXT, ''''), ''|'' ORDER BY p.oid::REGPROCEDURE::TEXT)) FROM pg_catalog.pg_proc p WHERE p.oid IN (''platform.student_university_catalog(text,text,text,uuid,integer)''::REGPROCEDURE, ''platform.student_university_catalog_by_ids_v1(uuid[])''::REGPROCEDURE, ''platform.student_university_favorites_v1()''::REGPROCEDURE, ''platform.set_university_favorite_v1(uuid,boolean)''::REGPROCEDURE, ''platform.student_recent_universities_v1()''::REGPROCEDURE, ''platform.student_catalog_preparations_v1(uuid)''::REGPROCEDURE, ''platform.own_portal_consultation_requests_v1()''::REGPROCEDURE, ''platform.staff_university_catalog(uuid,text,text,text,uuid,integer)''::REGPROCEDURE, ''platform.staff_university_catalog_countries(uuid)''::REGPROCEDURE, ''platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])''::REGPROCEDURE)'

\if :{?p283_pre}
SELECT 'N283_OLD_RPCS ' || (:n283_snapshot_sql) AS n283_pre_snapshot \gset
\echo :n283_pre_snapshot
\quit
\endif

BEGIN;
SET LOCAL TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n283_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n283_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N283: %', message; END IF;
END
$$;
CREATE TEMP TABLE n283_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, claims TEXT);
-- One RPC expression as somebody: an actor number (its live hook claims, role
-- authenticated), 'anon' or 'service_role'. {"ok": result} or {"error": sqlstate, "message": text}.
CREATE FUNCTION pg_temp.n283_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_claims TEXT;
BEGIN
  IF p_who NOT IN ('anon', 'service_role') THEN
    SELECT a.claims INTO v_claims FROM n283_actors a WHERE a.n = p_who::INTEGER;
    IF v_claims IS NULL THEN RAISE EXCEPTION 'N283: no claims for actor %', p_who; END IF;
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
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
CREATE FUNCTION pg_temp.n283_ok(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.n283_call(p_who, p_sql);
  IF NOT r ? 'ok' THEN RAISE EXCEPTION 'N283: % as % failed: %', p_sql, p_who, r; END IF;
  RETURN r -> 'ok';
END
$$;
CREATE FUNCTION pg_temp.n283_state(p_who TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(pg_temp.n283_call(p_who, p_sql) ->> 'error', 'ok')
$$;
-- A valid catalogue card (passes valid_university_content).
CREATE FUNCTION pg_temp.n283_content(p_name TEXT, p_country TEXT, p_overview TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name', p_name, 'country', p_country, 'city', 'N283 raw city', 'overview', p_overview,
    'websiteUrl', 'https://university.example-n283.edu', 'sourceUrl', 'https://university.example-n283.edu/admissions',
    'verifiedOn', '2026-10-16', 'notes', '', 'photoKey', NULL,
    'programs', jsonb_build_array(
      jsonb_build_object('id', 'cs', 'title', 'Synthetic computer science', 'level', 'bachelor', 'duration', NULL,
        'language', NULL, 'summary', 'Synthetic public program', 'sourceUrl', 'https://university.example-n283.edu/programs/cs',
        'intakes', jsonb_build_array(
          jsonb_build_object('label', 'September', 'startDate', '2027-09-01', 'startMonth', '2027-09',
            'applicationDeadline', '2027-06-30', 'deadlineTime', NULL, 'timezone', NULL, 'status', 'open', 'note', '',
            'sourceUrl', 'https://university.example-n283.edu/admissions', 'verifiedOn', '2026-10-16'),
          jsonb_build_object('label', 'Closed', 'startDate', NULL, 'startMonth', '2026-02',
            'applicationDeadline', NULL, 'deadlineTime', NULL, 'timezone', NULL, 'status', 'closed', 'note', '',
            'sourceUrl', 'https://university.example-n283.edu/admissions', 'verifiedOn', '2026-10-16'))),
      jsonb_build_object('id', 'lang', 'title', 'Synthetic language year', 'level', 'language', 'duration', NULL,
        'language', NULL, 'summary', '', 'sourceUrl', 'https://university.example-n283.edu/programs/lang',
        'intakes', jsonb_build_array())))
$$;
CREATE FUNCTION pg_temp.n283_photo(p_path TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('path', p_path, 'width', 2400, 'height', 1600, 'author', 'N283 Photographer',
    'authorUrl', 'https://www.pexels.com/@n283', 'sourceName', 'Pexels', 'sourceUrl', 'https://www.pexels.com/photo/n283-1/',
    'license', 'Pexels License', 'licenseUrl', 'https://www.pexels.com/license/')
$$;
CREATE FUNCTION pg_temp.n283_city(p_key TEXT, p_country TEXT, p_name TEXT, p_complete BOOLEAN) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('key', p_key, 'country', p_country, 'nameRu', p_name, 'nameKy', p_name, 'nameEn', 'N283 ' || p_key,
    'lat', 30.27, 'lng', 120.15,
    'photo', CASE WHEN p_complete THEN pg_temp.n283_photo('geography/cities/' || lower(p_country) || '-' || p_key || '-0123456789ab.jpg') ELSE NULL END,
    'summaryRu', 'Синтетический город для проверки.', 'summaryKy', 'Текшерүү үчүн шаар.',
    'factRu', CASE WHEN p_complete THEN 'Синтетический факт.' END, 'factKy', CASE WHEN p_complete THEN 'Синтетикалык факт.' END,
    'factSourceUrl', CASE WHEN p_complete THEN 'https://en.wikipedia.org/wiki/N283' END,
    'factVerifiedOn', CASE WHEN p_complete THEN '2026-10-16' END, 'kyReview', 'pending')
$$;
CREATE FUNCTION pg_temp.n283_cost(p_id UUID, p_institution UUID, p_kind TEXT, p_min BIGINT, p_max BIGINT, p_currency TEXT,
  p_source TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('id', p_id, 'institutionId', p_institution, 'programId', NULL, 'studyLevel', 'bachelor',
    'teachingLanguage', 'en', 'costKind', p_kind, 'period', 'year', 'amountMinMinor', p_min, 'amountMaxMinor', p_max,
    'currency', p_currency, 'academicYear', '2026/27', 'noteRu', NULL, 'noteKy', NULL, 'sourceKind', p_source,
    'sourceName', CASE p_source WHEN 'agency' THEN 'N283 Agency' WHEN 'official' THEN 'N283 University' ELSE 'N283 EVO' END,
    'sourceUrl', CASE p_source WHEN 'agency' THEN 'https://agency.example-n283.org/fees' WHEN 'official' THEN 'https://university.example-n283.edu/fees' END,
    'verifiedOn', '2026-10-16')
$$;

SELECT 'N283_CATALOG_GEOGRAPHY_COSTS_SUITE_START' AS n283_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. Organization A (1): 1 system Admin, 2 catalogue editor (a staff
-- role with catalog.read and catalog.import.manage in organization scope),
-- 3 Sales Manager, 4 curator (Admissions, own scope), both with the common
-- role that holds catalog.read; 5 Student with a portal-activated pending
-- case; 6 Student without a case. Organization B (2): 11 Admin, 15 Student.
-- ---------------------------------------------------------------------------
INSERT INTO n283_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL),
  (5, 1, 'student'), (6, 1, 'student'), (11, 2, 'admin'), (15, 2, 'student');
INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.n283_id(1), 'N283 Fictional organization A'), (pg_temp.n283_id(2), 'N283 Fictional organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n283_id(100 + n), 'n283-' || n || '@example.invalid', '{}'::JSONB FROM n283_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n283_id(200 + n), pg_temp.n283_id(100 + n), 'N283 Actor ' || n, 'active', 1 FROM n283_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.n283_id(300 + a.n), pg_temp.n283_id(a.org), pg_temp.n283_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    COALESCE(a.coarse = 'admin', FALSE)
  FROM n283_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n283_id(401), pg_temp.n283_id(1), 'organization', pg_temp.n283_id(1), 1),
  (pg_temp.n283_id(402), pg_temp.n283_id(2), 'organization', pg_temp.n283_id(2), 1),
  (pg_temp.n283_id(403), pg_temp.n283_id(1), 'student_case', pg_temp.n283_id(501), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.n283_id(a.org), pg_temp.n283_id(300 + a.n), pg_temp.n283_id(400 + a.org), 1, 1, TRUE, 'system',
    'N283 synthetic organization scope', pg_temp.n283_id(600 + a.n)
  FROM n283_actors a WHERE a.coarse IS NOT NULL;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n283_id(1), pg_temp.n283_id(305), pg_temp.n283_id(403), 1, 1, TRUE, 'system',
    'N283 student case scope', pg_temp.n283_id(650));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n283_id(901), pg_temp.n283_id(1), 'N283 Sales'), (pg_temp.n283_id(902), pg_temp.n283_id(1), 'N283 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n283_id(1), pg_temp.n283_id(303), pg_temp.n283_id(901)),
  (pg_temp.n283_id(1), pg_temp.n283_id(304), pg_temp.n283_id(902));

-- Student 5's portal-activated pending case (the 195 fixture shape).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state,
  portal_activated_at, current_scope_id, current_scope_version)
VALUES (pg_temp.n283_id(501), pg_temp.n283_id(1), pg_temp.n283_id(305), pg_temp.n283_id(303),
  'synthetic:n283:approved-cabinet', 'N283 Student', 'China', 'Bachelor', 'Engineering', 'intake_review', 'pending',
  clock_timestamp(), pg_temp.n283_id(403), 1);
SET LOCAL session_replication_role = origin;

-- Staff roles with production keys (281's lists) plus the catalogue editor.
CREATE TEMP TABLE n283_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n283_roles VALUES
 (pg_temp.n283_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n283_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n283_id(1105), 'Common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 (pg_temp.n283_id(1106), 'Catalogue editor', '["catalog.read","catalog.import.manage"]', 1160);
CREATE TEMP TABLE n283_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n283_grants VALUES
 (302, pg_temp.n283_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.n283_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n283_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n283_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n283_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n283_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n283_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n283_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n283_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n283_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n283_id(1);
GRANT SELECT ON n283_roles, n283_grants, n283_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n283_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n283_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n283_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n283_admin_setup';
SET LOCAL ROLE authenticated;
DO $n283_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n283_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command('28300000-0000-4000-8000-000000000001'::UUID, r.role_id, 0, 'create',
      jsonb_build_object('label', 'N283 ' || r.label, 'description', 'Migration 283 synthetic role',
        'permissionKeys', r.keys), 'N283 create role',
      ('28300000-0000-4000-8000-' || lpad((r.request_base + 1)::TEXT, 12, '0'))::UUID);
    published := platform.staff_role_publish('28300000-0000-4000-8000-000000000001'::UUID, r.role_id, 1,
      platform.staff_role_impact('28300000-0000-4000-8000-000000000001'::UUID, r.role_id, 1) ->> 'impactFingerprint',
      'N283 publish role', ('28300000-0000-4000-8000-' || lpad((r.request_base + 2)::TEXT, 12, '0'))::UUID);
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n283_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n283_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save('28300000-0000-4000-8000-000000000001'::UUID,
      ('28300000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID,
      (SELECT access_version FROM n283_versions WHERE membership_id = ('28300000-0000-4000-8000-' || lpad(m::TEXT, 12, '0'))::UUID),
      items, bindings, 'N283 grant roles', ('28300000-0000-4000-8000-' || lpad((2000 + m)::TEXT, 12, '0'))::UUID);
  END LOOP;
END
$n283_roles$;
RESET ROLE;
UPDATE n283_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n283_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n283_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.n283_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n283_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'student', 'admin', 'student'], 'claims: admin, staff and student');
SELECT pg_temp.n283_assert(platform_private.staff_has_permission(pg_temp.n283_id(1), pg_temp.n283_id(302), 'catalog.import.manage')
    AND NOT platform_private.staff_has_permission(pg_temp.n283_id(1), pg_temp.n283_id(303), 'catalog.import.manage')
    AND NOT platform_private.staff_has_permission(pg_temp.n283_id(1), pg_temp.n283_id(304), 'catalog.import.manage')
    AND platform_private.staff_has_permission(pg_temp.n283_id(1), pg_temp.n283_id(303), 'catalog.read')
    AND platform_private.staff_has_permission(pg_temp.n283_id(1), pg_temp.n283_id(304), 'catalog.read'),
  'fixture: only the editor holds the publication right; Sales and the curator read the catalogue');

-- Catalogue (replica mode skips only the import-provenance FK; every CHECK,
-- valid_university_content included, still applies). Org A: 701 CN, 702 MY,
-- 703 PL (outside the six), 704 IT with a draft only, 705 TR; org B: 711 CN.
-- 701 has two published versions: the latest must be served.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code, city,
  source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
  SELECT pg_temp.n283_id(700 + u.n), pg_temp.n283_id(u.org), 'university', u.name, u.country, 'N283 raw city',
    pg_temp.n283_id(720 + u.n), 'synthetic-n283-rev', pg_temp.n283_id(740 + u.n), 'rec_' || repeat(u.letter, 32),
    pg_temp.n283_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END)
  FROM (VALUES (1, 1, 'N283 Alpha China', 'CN', 'a'), (2, 1, 'N283 Beta Malaysia', 'MY', 'b'),
    (3, 1, 'N283 Gamma Poland', 'PL', 'c'), (4, 1, 'N283 Delta Italy', 'IT', 'd'), (5, 1, 'N283 Epsilon Turkey', 'TR', 'e'),
    (11, 2, 'N283 Foreign China', 'CN', 'f')) AS u(n, org, name, country, letter);
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version, content,
  source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
  SELECT pg_temp.n283_id(760 + u.n), pg_temp.n283_id(u.org), pg_temp.n283_id(700 + u.i), u.base, u.version,
    pg_temp.n283_content(u.name, u.country, u.overview), pg_temp.n283_id(720 + u.i), u.status, 'N283 synthetic review',
    pg_temp.n283_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END),
    CASE WHEN u.status = 'published' THEN pg_temp.n283_id(CASE u.org WHEN 1 THEN 301 ELSE 311 END) END,
    CASE WHEN u.status = 'published' THEN statement_timestamp() END
  FROM (VALUES (1, 1, 1, 'N283 Alpha China', 'CN', 'Alpha one', 0, 1, 'published'),
    (2, 1, 1, 'N283 Alpha China', 'CN', 'Alpha two', 1, 2, 'published'),
    (3, 1, 2, 'N283 Beta Malaysia', 'MY', 'Beta', 0, 1, 'published'),
    (4, 1, 3, 'N283 Gamma Poland', 'PL', 'Gamma', 0, 1, 'published'),
    (5, 1, 4, 'N283 Delta Italy', 'IT', 'Delta', 0, NULL, 'draft'),
    (6, 1, 5, 'N283 Epsilon Turkey', 'TR', 'Epsilon', 0, 1, 'published'),
    (11, 2, 11, 'N283 Foreign China', 'CN', 'Foreign', 0, 1, 'published'))
    AS u(n, org, i, name, country, overview, base, version, status);
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (a) Prior RPCs: byte-identical (the md5 the pre-run printed) and the same
-- response shape.
-- ===========================================================================
\if :{?n283_old_rpcs_md5}
SELECT (:n283_snapshot_sql) AS n283_post_snapshot \gset
SELECT pg_temp.n283_assert('N283_OLD_RPCS ' || :'n283_post_snapshot' = :'n283_old_rpcs_md5',
  'a catalogue, favourite, preparation or consultation RPC that old iPhone builds call changed in 283');
\else
\echo 'N283: no pre-283 snapshot passed (standalone run): md5 identity of the prior RPCs not checked'
\endif
SELECT pg_temp.n283_ok('5', 'platform.student_university_catalog()') AS n283_old_page \gset
SELECT pg_temp.n283_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'n283_old_page'::JSONB) k) = ARRAY['items', 'nextOffset']
    AND (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(i) k) = ARRAY['content', 'id', 'publishedAt', 'version'])
      FROM jsonb_array_elements(:'n283_old_page'::JSONB -> 'items') i)
    AND (SELECT array_agg((i ->> 'id')::UUID ORDER BY i ->> 'id') FROM jsonb_array_elements(:'n283_old_page'::JSONB -> 'items') i)
      = ARRAY[pg_temp.n283_id(701), pg_temp.n283_id(702), pg_temp.n283_id(705)],
  'student_university_catalog changed its shape or its six-country list');

-- ===========================================================================
-- (h) Posture: no client role reads the tables or calls the helpers; anon
-- calls nothing new.
-- ===========================================================================
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state(w.who, 'SELECT count(*) FROM ' || t.name) = '42501'),
  'a client role read a 283 table directly')
FROM (VALUES ('platform.study_countries'), ('platform.catalog_cities'), ('platform.catalog_institution_cities'),
  ('platform.catalog_costs'), ('platform.catalog_fx_rates'), ('platform_private.catalog_geography_requests')) AS t(name)
CROSS JOIN (VALUES ('anon'), ('service_role'), ('1'), ('5')) AS w(who);
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state(w.who, f.call) = '42501'), 'a client role called a 283 helper')
FROM (VALUES ('platform_private.catalog_student_index(''28300000-0000-4000-8000-000000000001''::UUID)'),
  ('platform_private.catalog_student_costs(''28300000-0000-4000-8000-000000000001''::UUID, ''28300000-0000-4000-8000-000000000701''::UUID)'),
  ('platform_private.catalog_geo_actor(''28300000-0000-4000-8000-000000000001''::UUID, FALSE, NULL)'),
  ('platform_private.catalog_photo_valid(''{}''::JSONB, ''cities'')')) AS f(call)
CROSS JOIN (VALUES ('anon'), ('service_role'), ('1'), ('5')) AS w(who);
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state('anon', f.call) = '42501'), 'anon called a 283 RPC: ' || string_agg(f.call, '; '))
FROM (VALUES ('platform.student_university_index_v1()'),
  ('platform.student_university_detail_v1(''28300000-0000-4000-8000-000000000701''::UUID)'),
  ('platform.staff_catalog_geography_v1(''28300000-0000-4000-8000-000000000001''::UUID)'),
  ('platform.staff_catalog_cost_import_v1(''28300000-0000-4000-8000-000000000001''::UUID, ''[]''::JSONB, gen_random_uuid())'),
  ('platform.staff_catalog_fx_rate_set_v1(''28300000-0000-4000-8000-000000000001''::UUID, ''CNY'', current_date, 7, ''x'', NULL, gen_random_uuid())')) AS f(call);
SELECT pg_temp.n283_assert((SELECT array_agg(s.country_code || ':' || s.name_ru || ':' || s.name_ky ORDER BY s.sort_order) FROM platform.study_countries s)
  = ARRAY['CN:Китай:Кытай', 'MY:Малайзия:Малайзия', 'AE:ОАЭ:БАЭ', 'TR:Турция:Түркия', 'IT:Италия:Италия', 'CZ:Чехия:Чехия'],
  'study_countries is not the six product countries with the names of src/lib/study-countries.json');
\set n283_json `cat /workspace/src/lib/study-countries.json`
SELECT pg_temp.n283_assert((SELECT array_agg(s.country_code || ':' || s.name_ru || ':' || s.name_ky ORDER BY s.sort_order) FROM platform.study_countries s)
  = ARRAY(SELECT (c ->> 'code') || ':' || (c ->> 'ru') || ':' || (c ->> 'ky')
      FROM jsonb_array_elements(:'n283_json'::JSONB -> 'countries') WITH ORDINALITY AS x(c, i) ORDER BY i),
  'study_countries differs from src/lib/study-countries.json');

-- ===========================================================================
-- (d, g) Staff: the editor builds geography; the gates.
-- ===========================================================================
-- Every staff RPC refuses Sales, the curator, both students and anon (42501).
CREATE TEMP TABLE n283_staff_calls(call TEXT);
INSERT INTO n283_staff_calls VALUES
  ('platform.staff_catalog_geography_v1(''28300000-0000-4000-8000-000000000001''::UUID)'),
  (format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())', pg_temp.n283_id(1), pg_temp.n283_city('denied', 'CN', 'Отказ', FALSE))),
  ('platform.staff_catalog_city_publish_v1(''28300000-0000-4000-8000-000000000001''::UUID, ''hangzhou'', TRUE, 1, gen_random_uuid())'),
  ('platform.staff_catalog_institution_city_set_v1(''28300000-0000-4000-8000-000000000001''::UUID, ''28300000-0000-4000-8000-000000000701''::UUID, NULL, gen_random_uuid())'),
  (format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())', pg_temp.n283_id(1),
    pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official'))),
  ('platform.staff_catalog_cost_confirm_v1(''28300000-0000-4000-8000-000000000001''::UUID, gen_random_uuid(), 1, ''N283 reason'', gen_random_uuid())'),
  ('platform.staff_catalog_cost_publish_v1(''28300000-0000-4000-8000-000000000001''::UUID, gen_random_uuid(), ''published'', 1, gen_random_uuid())'),
  (format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid())', pg_temp.n283_id(1),
    jsonb_build_array(pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') - 'id' - 'institutionId'
      || jsonb_build_object('importKey', 'denied', 'institutionId', pg_temp.n283_id(701))))),
  ('platform.staff_catalog_fx_rate_set_v1(''28300000-0000-4000-8000-000000000001''::UUID, ''CNY'', current_date, 7.1, ''N283 bank'', NULL, gen_random_uuid())');
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state(w.who, c.call) = '42501'),
  'a staff RPC was not refused 42501 to ' || string_agg(DISTINCT w.who, ',') || ': ' || string_agg(c.call || '=' || pg_temp.n283_state(w.who, c.call), '; ')
    FILTER (WHERE pg_temp.n283_state(w.who, c.call) <> '42501'))
FROM n283_staff_calls c CROSS JOIN (VALUES ('3'), ('4'), ('5'), ('6'), ('15'), ('11'), ('anon')) AS w(who);
SELECT pg_temp.n283_assert((SELECT count(*) FROM platform.catalog_cities) = 0 AND (SELECT count(*) FROM platform.catalog_costs) = 0
    AND (SELECT count(*) FROM platform.catalog_fx_rates) = 0 AND (SELECT count(*) FROM platform_private.catalog_geography_requests) = 0,
  'a refused staff call wrote something');

-- The editor creates a complete Hangzhou and an incomplete Kuala Lumpur.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)',
  pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'CN', 'Ханчжоу', TRUE), pg_temp.n283_id(3001))) AS n283_city_receipt \gset
SELECT pg_temp.n283_assert(:'n283_city_receipt'::JSONB = jsonb_build_object('requestId', pg_temp.n283_id(3001), 'cityKey', 'hangzhou',
  'version', 1, 'status', 'draft'), 'city upsert receipt');
SELECT pg_temp.n283_assert(pg_temp.n283_ok('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'CN', 'Ханчжоу', TRUE), pg_temp.n283_id(3001))) = :'n283_city_receipt'::JSONB
    AND (SELECT version FROM platform.catalog_cities WHERE city_key = 'hangzhou') = 1,
  'a city upsert replay was not the same receipt without a write');
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'CN', 'Ханчжоу 2', TRUE), pg_temp.n283_id(3001))) = '23505',
  'a reused request id with another city was not 23505');
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'CN', 'Ханчжоу', TRUE), pg_temp.n283_id(3002))) = '40001',
  'a second create of an existing city (base 0) was not a version conflict');
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 1, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'MY', 'Ханчжоу', TRUE), pg_temp.n283_id(3003))) = '22023',
  'a city changed its country');
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())',
    pg_temp.n283_id(1), v.city)) = '22023'), 'an invalid city was not refused 22023')
FROM (VALUES (pg_temp.n283_city('Bad Key', 'CN', 'Плохой', FALSE)), (pg_temp.n283_city('warsaw', 'PL', 'Варшава', FALSE)),
  (pg_temp.n283_city('agency', 'CN', 'Агентство', TRUE) || jsonb_build_object('photo',
    pg_temp.n283_photo('geography/cities/cn-agency-0123456789ab.jpg') || '{"sourceUrl":"https://www.eduprchina.com/photo/1"}'::JSONB)),
  (pg_temp.n283_city('no-author', 'CN', 'Без автора', TRUE) || jsonb_build_object('photo',
    pg_temp.n283_photo('geography/cities/cn-no-author-0123456789ab.jpg') - 'author')),
  -- Источник назван Pexels, а адрес Unsplash: веб отверг бы весь индекс.
  (pg_temp.n283_city('mismatch', 'CN', 'Чужой хост', TRUE) || jsonb_build_object('photo',
    pg_temp.n283_photo('geography/cities/cn-mismatch-0123456789ab.jpg') || '{"sourceUrl":"https://unsplash.com/photos/abc"}'::JSONB)),
  (pg_temp.n283_city('long', 'CN', 'Длинный', FALSE) || jsonb_build_object('summaryRu', repeat('я', 301))),
  (pg_temp.n283_city('extra', 'CN', 'Лишний', FALSE) || '{"rating": 5}'::JSONB)) AS v(city);
-- Источник и хост сходятся попарно, как PHOTO_HOSTS разбора веба: хост из
-- общего списка, но другого источника, фото не делает.
SELECT pg_temp.n283_assert(bool_and(platform_private.catalog_photo_valid(
    pg_temp.n283_photo('geography/cities/cn-host-0123456789ab.jpg') || v.patch::JSONB, 'cities') = v.valid),
  'a photo source and its host were not matched pairwise: ' || string_agg(v.patch, '; '))
FROM (VALUES ('{}', TRUE),
  ('{"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/abc"}', TRUE),
  ('{"sourceName":"Wikimedia Commons","sourceUrl":"https://upload.wikimedia.org/wikipedia/commons/a/ab/N283.jpg"}', TRUE),
  ('{"sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:N283.jpg"}', TRUE),
  ('{"sourceUrl":"https://unsplash.com/photos/abc"}', FALSE),
  ('{"sourceName":"Unsplash","sourceUrl":"https://www.pexels.com/photo/n283-1/"}', FALSE),
  ('{"sourceName":"Wikimedia Commons","sourceUrl":"https://www.pexels.com/photo/n283-1/"}', FALSE),
  ('{"sourceName":"Pexels","sourceUrl":"https://commons.wikimedia.org/wiki/File:N283.jpg"}', FALSE)) AS v(patch, valid);
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)',
  pg_temp.n283_id(1), pg_temp.n283_city('kuala-lumpur', 'MY', 'Куала-Лумпур', FALSE), pg_temp.n283_id(3004)));
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_city_publish_v1(%L::UUID, %L, TRUE, 1, %L::UUID)',
    pg_temp.n283_id(1), 'kuala-lumpur', pg_temp.n283_id(3005))) = '22023', 'an incomplete city card was published');
-- (A mutating call and a read of its rows go in separate statements: one
-- statement reads one snapshot.)
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_city_publish_v1(%L::UUID, %L, TRUE, 1, %L::UUID)',
    pg_temp.n283_id(1), 'hangzhou', pg_temp.n283_id(3006))) ->> 'status' AS n283_publish_status \gset
SELECT pg_temp.n283_assert(:'n283_publish_status' = 'published'
    AND (SELECT status = 'published' AND published_via = 'staff' AND reviewed_by_membership_id = pg_temp.n283_id(302) AND version = 2
      FROM platform.catalog_cities WHERE city_key = 'hangzhou'),
  'the editor could not publish a complete city or the reviewer was not recorded');
-- A published card stays complete: removing its fact fails the CHECK.
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 2, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_city('hangzhou', 'CN', 'Ханчжоу', FALSE)
      || jsonb_build_object('photo', pg_temp.n283_photo('geography/cities/cn-hangzhou-0123456789ab.jpg')), pg_temp.n283_id(3007))) = '23514',
  'a published city became incomplete');

-- Links: own country only; the trigger holds for a direct insert too.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, %L, %L::UUID)',
  pg_temp.n283_id(1), pg_temp.n283_id(701), 'hangzhou', pg_temp.n283_id(3010)));
SELECT pg_temp.n283_ok('1', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, %L, %L::UUID)',
  pg_temp.n283_id(1), pg_temp.n283_id(702), 'kuala-lumpur', pg_temp.n283_id(3011)));
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, %L, gen_random_uuid())',
    pg_temp.n283_id(1), pg_temp.n283_id(705), 'hangzhou')) = '22023'
    AND pg_temp.n283_state('2', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, %L, gen_random_uuid())',
      pg_temp.n283_id(1), pg_temp.n283_id(703), 'hangzhou')) = '42501'
    AND pg_temp.n283_state('2', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, %L, gen_random_uuid())',
      pg_temp.n283_id(1), pg_temp.n283_id(711), 'hangzhou')) = '42501',
  'a university linked to a city of another country, a Polish university or another organization''s university');
DO $n283_trigger$
BEGIN
  BEGIN
    INSERT INTO platform.catalog_institution_cities(institution_id, organization_id, city_key, assigned_via)
    VALUES (pg_temp.n283_id(705), pg_temp.n283_id(1), 'hangzhou', 'migration');
    RAISE EXCEPTION 'N283: a direct insert linked a Turkish university to a Chinese city';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE platform.catalog_cities SET country_code = 'MY' WHERE city_key = 'hangzhou';
    RAISE EXCEPTION 'N283: a city changed its country by a direct update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$n283_trigger$;

-- ===========================================================================
-- (b) Student index before costs
-- ===========================================================================
SELECT pg_temp.n283_ok('5', 'platform.student_university_index_v1()') AS n283_index \gset
SELECT pg_temp.n283_assert(
    (SELECT array_agg(c ->> 'code' ORDER BY i) FROM jsonb_array_elements(:'n283_index'::JSONB -> 'countries') WITH ORDINALITY x(c, i))
      = ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']
    AND (SELECT array_agg((c ->> 'universityCount') || '/' || (c ->> 'cityCount') ORDER BY i)
      FROM jsonb_array_elements(:'n283_index'::JSONB -> 'countries') WITH ORDINALITY x(c, i))
      = ARRAY['1/1', '1/0', '0/0', '1/0', '0/0', '0/0']
    AND (SELECT array_agg((u ->> 'id')::UUID ORDER BY u ->> 'name') FROM jsonb_array_elements(:'n283_index'::JSONB -> 'universities') u)
      = ARRAY[pg_temp.n283_id(701), pg_temp.n283_id(702), pg_temp.n283_id(705)]
    AND (SELECT array_agg(c ->> 'key') FROM jsonb_array_elements(:'n283_index'::JSONB -> 'cities') c) = ARRAY['hangzhou']
    AND (:'n283_index'::JSONB ->> 'notModified')::BOOLEAN IS FALSE
    AND :'n283_index'::JSONB ->> 'version' ~ '^g1\.[0-9a-f]{32}$',
  'the index is not the published six-country picture of organization A: ' || :'n283_index');
SELECT pg_temp.n283_assert((SELECT u = jsonb_build_object('id', pg_temp.n283_id(701), 'name', 'N283 Alpha China', 'country', 'CN',
      'cityKey', 'hangzhou', 'cityLabel', 'N283 raw city', 'levels', '["language", "bachelor"]'::JSONB, 'photoKey', NULL,
      'intakes', '[{"start": "2027-09-01", "deadline": "2027-06-30", "startMonth": "2027-09"}]'::JSONB, 'hasCosts', FALSE)
    FROM jsonb_array_elements(:'n283_index'::JSONB -> 'universities') u WHERE u ->> 'id' = pg_temp.n283_id(701)::TEXT)
    AND (SELECT u -> 'cityKey' = 'null'::JSONB FROM jsonb_array_elements(:'n283_index'::JSONB -> 'universities') u
      WHERE u ->> 'id' = pg_temp.n283_id(702)::TEXT)
    AND (SELECT c = jsonb_build_object('key', 'hangzhou', 'country', 'CN', 'name', jsonb_build_object('ru', 'Ханчжоу', 'ky', 'Ханчжоу'),
        'photo', pg_temp.n283_photo('geography/cities/cn-hangzhou-0123456789ab.jpg'),
        'summary', jsonb_build_object('ru', 'Синтетический город для проверки.', 'ky', 'Текшерүү үчүн шаар.'),
        'fact', jsonb_build_object('ru', 'Синтетический факт.', 'ky', 'Синтетикалык факт.',
          'sourceUrl', 'https://en.wikipedia.org/wiki/N283', 'verifiedOn', '2026-10-16'),
        'universityCount', 1)
      FROM jsonb_array_elements(:'n283_index'::JSONB -> 'cities') c),
  'index row shapes (latest version, levels, open intakes only, draft city hidden, city card)');
SELECT pg_temp.n283_assert(pg_temp.n283_ok('5', format('platform.student_university_index_v1(%L)', :'n283_index'::JSONB ->> 'version'))
    = jsonb_build_object('notModified', TRUE, 'version', :'n283_index'::JSONB ->> 'version')
    AND pg_temp.n283_ok('6', format('platform.student_university_index_v1(%L)', :'n283_index'::JSONB ->> 'version'))
      = jsonb_build_object('notModified', TRUE, 'version', :'n283_index'::JSONB ->> 'version')
    AND (pg_temp.n283_ok('5', 'platform.student_university_index_v1(''g1.stale'')') ->> 'notModified')::BOOLEAN IS FALSE,
  'notModified did not answer the matching version (or answered a stale one)');
SELECT pg_temp.n283_assert(pg_temp.n283_state('5', format('platform.student_university_index_v1(%L)', repeat('x', 101))) = '22023',
  'an oversized version was not 22023');
SELECT pg_temp.n283_ok('15', 'platform.student_university_index_v1()') AS n283_index_b \gset
SELECT pg_temp.n283_assert((SELECT array_agg((u ->> 'id')::UUID) FROM jsonb_array_elements(:'n283_index_b'::JSONB -> 'universities') u)
      = ARRAY[pg_temp.n283_id(711)]
    AND jsonb_array_length(:'n283_index_b'::JSONB -> 'cities') = 0
    AND :'n283_index_b'::JSONB ->> 'version' <> :'n283_index'::JSONB ->> 'version',
  'organization B''s student saw organization A''s data');
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state(w.who, 'platform.student_university_index_v1()') = '42501'
    AND pg_temp.n283_state(w.who, 'platform.student_university_detail_v1(''28300000-0000-4000-8000-000000000701''::UUID)') = '42501'),
  'staff or service role read the student index or detail')
FROM (VALUES ('1'), ('2'), ('3'), ('4'), ('11'), ('service_role')) AS w(who);

-- ===========================================================================
-- (d, e, f) Costs and rates
-- ===========================================================================
-- Official tuition (editor), agency accommodation (editor, draft), an EVO
-- document fee, a CNY rate.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)', pg_temp.n283_id(1),
  pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 2500000, 3500000, 'CNY', 'official'), pg_temp.n283_id(3101))) ->> 'costId' AS n283_official \gset
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)', pg_temp.n283_id(1),
  pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'accommodation', 800000, NULL, 'CNY', 'agency'), pg_temp.n283_id(3102))) ->> 'costId' AS n283_agency \gset
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)', pg_temp.n283_id(1),
  pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'application_fee', 0, NULL, 'USD', 'evo_document'), pg_temp.n283_id(3103))) ->> 'costId' AS n283_evo \gset
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, %L::UUID)', pg_temp.n283_id(1),
  pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'insurance', 50000, NULL, 'CNY', 'official'), pg_temp.n283_id(3104))) ->> 'costId' AS n283_draft \gset
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())',
    pg_temp.n283_id(1), v.cost)) = v.state), 'an invalid cost row was not refused: ' || string_agg(v.state || ' ' || v.cost::TEXT, '; '))
FROM (VALUES
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, 50, 'CNY', 'official'), '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'cny', 'official'), '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"academicYear": "2026/28"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"academicYear": "26/27"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"academicYear": "2026-27"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"sourceUrl": null}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"programId": "missing"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"programId": "cs", "studyLevel": "master"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'rating', 100, NULL, 'CNY', 'official'), '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"verifiedOn": "2999-01-01"}', '22023'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(703), 'tuition', 100, NULL, 'PLN', 'official'), '42501'),
  (pg_temp.n283_cost(NULL, pg_temp.n283_id(711), 'tuition', 100, NULL, 'CNY', 'official'), '42501')) AS v(cost, state);
SELECT pg_temp.n283_assert((SELECT count(*) FROM platform.catalog_costs) = 4, 'a refused cost row was written');
-- A source without a year keeps academicYear null (never invented); a
-- calendar intake year (Malaysia) is accepted. Rolled back in a subtransaction.
DO $n283_years$
DECLARE outcome TEXT;
BEGIN
  BEGIN
    outcome := pg_temp.n283_state('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())',
      pg_temp.n283_id(1), pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"academicYear": null}'));
    outcome := outcome || ',' || pg_temp.n283_state('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())',
      pg_temp.n283_id(1), pg_temp.n283_cost(NULL, pg_temp.n283_id(701), 'tuition', 100, NULL, 'CNY', 'official') || '{"academicYear": "2026"}'));
    outcome := outcome || ',' || COALESCE((SELECT string_agg(COALESCE(c.academic_year, 'null'), '|' ORDER BY c.academic_year NULLS FIRST)
      FROM platform.catalog_costs c WHERE c.amount_min_minor = 100), 'no rows');
    RAISE EXCEPTION USING ERRCODE = 'N2831', MESSAGE = outcome;
  EXCEPTION WHEN SQLSTATE 'N2831' THEN
    outcome := SQLERRM;
  END;
  PERFORM pg_temp.n283_assert(outcome = 'ok,ok,null|2026', 'a null or calendar academic year was refused: ' || outcome);
  PERFORM pg_temp.n283_assert((SELECT count(*) FROM platform.catalog_costs) = 4, 'the academic year probe was not rolled back');
END
$n283_years$;

-- The CHECK: an unconfirmed agency row is never published.
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 1, gen_random_uuid())',
    pg_temp.n283_id(1), :'n283_agency', 'published')) = '23514'
    AND pg_temp.n283_state('1', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 1, gen_random_uuid())',
    pg_temp.n283_id(1), :'n283_agency', 'published')) = '23514',
  'an unconfirmed agency row was published through the RPC');
SELECT set_config('n283.agency', :'n283_agency', TRUE) AS n283_agency_setting \gset
DO $n283_check$
BEGIN
  UPDATE platform.catalog_costs SET status = 'published', published_at = clock_timestamp(),
    published_by_membership_id = pg_temp.n283_id(301) WHERE id = current_setting('n283.agency')::UUID;
  RAISE EXCEPTION 'N283: a direct update published an unconfirmed agency row';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%catalog_costs_agency_published_confirmed%' THEN RAISE; END IF;
END
$n283_check$;
-- Agency confirmation: the editor is refused, the system Admin confirms.
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_cost_confirm_v1(%L::UUID, %L::UUID, 1, %L, gen_random_uuid())',
    pg_temp.n283_id(1), :'n283_agency', 'N283 owner confirmation')) = '42501',
  'the catalogue editor confirmed an agency row');
SELECT pg_temp.n283_assert(pg_temp.n283_state('1', format('platform.staff_catalog_cost_confirm_v1(%L::UUID, %L::UUID, 1, %L, gen_random_uuid())',
    pg_temp.n283_id(1), :'n283_official', 'N283 owner confirmation')) = '22023',
  'an official row was "confirmed" as agency data');
SELECT pg_temp.n283_ok('1', format('platform.staff_catalog_cost_confirm_v1(%L::UUID, %L::UUID, 1, %L, %L::UUID)',
    pg_temp.n283_id(1), :'n283_agency', 'Владелец подтвердил данные агентств 16.10.2026', pg_temp.n283_id(3110))) ->> 'version' AS n283_confirm_version \gset
SELECT pg_temp.n283_assert(:'n283_confirm_version' = '2'
    AND (SELECT confirmed_by_membership_id = pg_temp.n283_id(301) AND confirmed_on = current_date
        AND confirmation_reason = 'Владелец подтвердил данные агентств 16.10.2026' AND status = 'draft'
      FROM platform.catalog_costs WHERE id = :'n283_agency'::UUID),
  'the Admin confirmation was not recorded or it published the row');
-- Publish: official by the editor, confirmed agency by the editor, EVO fee.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 1, gen_random_uuid())',
  pg_temp.n283_id(1), :'n283_official', 'published'));
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 2, gen_random_uuid())',
  pg_temp.n283_id(1), :'n283_agency', 'published'));
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 1, gen_random_uuid())',
  pg_temp.n283_id(1), :'n283_evo', 'published'));
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_cost_publish_v1(%L::UUID, %L::UUID, %L, 1, gen_random_uuid())',
    pg_temp.n283_id(1), :'n283_evo', 'retired')) = '40001', 'a stale base version was not 40001');
-- A rate for CNY (editor), replay, reuse, a USD rate refused.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, %L::DATE, 7.1234, %L, %L, %L::UUID)',
  pg_temp.n283_id(1), 'CNY', current_date - 3, 'N283 National Bank', 'https://bank.example-n283.org/rates', pg_temp.n283_id(3120))) AS n283_fx \gset
SELECT pg_temp.n283_assert(pg_temp.n283_ok('2', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, %L::DATE, 7.1234, %L, %L, %L::UUID)',
    pg_temp.n283_id(1), 'CNY', current_date - 3, 'N283 National Bank', 'https://bank.example-n283.org/rates', pg_temp.n283_id(3120))) = :'n283_fx'::JSONB
    AND pg_temp.n283_state('2', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, %L::DATE, 7.5, %L, NULL, %L::UUID)',
      pg_temp.n283_id(1), 'CNY', current_date - 3, 'N283 National Bank', pg_temp.n283_id(3120))) = '23505'
    AND pg_temp.n283_state('2', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, current_date, 1, %L, NULL, gen_random_uuid())',
      pg_temp.n283_id(1), 'USD', 'N283')) = '22023'
    AND pg_temp.n283_state('2', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, current_date + 1, 7, %L, NULL, gen_random_uuid())',
      pg_temp.n283_id(1), 'CNY', 'N283')) = '22023'
    AND (SELECT count(*) FROM platform.catalog_fx_rates) = 1,
  'fx rate set: replay, reuse, USD or a future date');
-- A request id reused for another operation.
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_institution_city_set_v1(%L::UUID, %L::UUID, NULL, %L::UUID)',
    pg_temp.n283_id(1), pg_temp.n283_id(701), pg_temp.n283_id(3120))) = '23505', 'a request id was reused across operations');

-- ===========================================================================
-- (c) Student detail
-- ===========================================================================
SELECT pg_temp.n283_ok('5', format('platform.set_university_favorite_v1(%L::UUID, TRUE)', pg_temp.n283_id(701)));
SELECT pg_temp.n283_ok('5', format('platform.create_portal_consultation_request_v1(%L::UUID, %L::UUID, %L)',
  pg_temp.n283_id(3201), pg_temp.n283_id(701), 'N283 synthetic note')) AS n283_consultation \gset
SELECT pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) AS n283_detail \gset
SELECT pg_temp.n283_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'n283_detail'::JSONB) k)
    = ARRAY['city', 'costs', 'country', 'favored', 'openConsultation', 'preparations', 'university'],
  'detail keys');
SELECT pg_temp.n283_assert(:'n283_detail'::JSONB -> 'university'
    = (SELECT i FROM jsonb_array_elements(pg_temp.n283_ok('5', format('platform.student_university_catalog_by_ids_v1(ARRAY[%L::UUID])',
      pg_temp.n283_id(701))) -> 'items') i)
    AND (:'n283_detail'::JSONB #>> '{university,version}') = '2'
    AND :'n283_detail'::JSONB -> 'country' = '{"code": "CN", "name": {"ky": "Кытай", "ru": "Китай"}}'::JSONB
    AND :'n283_detail'::JSONB #>> '{city,key}' = 'hangzhou'
    AND (:'n283_detail'::JSONB ->> 'favored')::BOOLEAN
    AND :'n283_detail'::JSONB -> 'openConsultation' = :'n283_consultation'::JSONB
    AND :'n283_detail'::JSONB -> 'openConsultation'
      = (pg_temp.n283_ok('5', 'platform.own_portal_consultation_requests_v1()') -> 0)
    AND :'n283_detail'::JSONB -> 'preparations' = jsonb_build_object('studentCaseId', pg_temp.n283_id(501),
      'items', COALESCE((SELECT jsonb_agg(i) FROM jsonb_array_elements(pg_temp.n283_ok('5', format(
        'platform.student_catalog_preparations_v1(%L::UUID)', pg_temp.n283_id(501)))) i
        WHERE i ->> 'institutionId' = pg_temp.n283_id(701)::TEXT), '[]'::JSONB)),
  'detail does not equal the four reads it replaces: ' || :'n283_detail');
SELECT pg_temp.n283_assert(:'n283_detail'::JSONB -> 'costs' = jsonb_build_object(
  'rows', jsonb_build_array(
    jsonb_build_object('id', :'n283_official'::UUID, 'kind', 'tuition', 'period', 'year', 'studyLevel', 'bachelor', 'programId', NULL,
      'teachingLanguage', 'en', 'currency', 'CNY', 'exponent', 2, 'amountMinMinor', 2500000, 'amountMaxMinor', 3500000,
      'usdApproxMin', 3510, 'usdApproxMax', 4910, 'academicYear', '2026/27', 'note', NULL,
      'source', '{"kind": "official", "url": "https://university.example-n283.edu/fees"}'::JSONB, 'verifiedOn', '2026-10-16'),
    jsonb_build_object('id', :'n283_agency'::UUID, 'kind', 'accommodation', 'period', 'year', 'studyLevel', 'bachelor', 'programId', NULL,
      'teachingLanguage', 'en', 'currency', 'CNY', 'exponent', 2, 'amountMinMinor', 800000, 'amountMaxMinor', NULL,
      'usdApproxMin', 1120, 'usdApproxMax', NULL, 'academicYear', '2026/27', 'note', NULL,
      'source', '{"kind": "agency", "url": null}'::JSONB, 'verifiedOn', '2026-10-16'),
    jsonb_build_object('id', :'n283_evo'::UUID, 'kind', 'application_fee', 'period', 'year', 'studyLevel', 'bachelor', 'programId', NULL,
      'teachingLanguage', 'en', 'currency', 'USD', 'exponent', 2, 'amountMinMinor', 0, 'amountMaxMinor', NULL,
      'usdApproxMin', NULL, 'usdApproxMax', NULL, 'academicYear', '2026/27', 'note', NULL,
      'source', '{"kind": "evo_document", "url": null}'::JSONB, 'verifiedOn', '2026-10-16')),
  'fxRates', jsonb_build_array(jsonb_build_object('currency', 'CNY', 'unitsPerUsd', 7.1234, 'asOf', current_date - 3,
    'sourceName', 'N283 National Bank'))),
  'detail costs are not the published rows with rates (draft hidden, agency anonymous, USD rounding): ' || (:'n283_detail'::JSONB -> 'costs')::TEXT);
SELECT pg_temp.n283_assert(position('N283 Agency' IN :'n283_detail') = 0 AND position('agency.example-n283' IN :'n283_detail') = 0,
  'the agency name or URL reached the student');
SELECT pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(702))) AS n283_detail_my \gset
SELECT pg_temp.n283_assert(:'n283_detail_my'::JSONB -> 'city' = 'null'::JSONB AND :'n283_detail_my'::JSONB -> 'costs' = 'null'::JSONB
    AND NOT (:'n283_detail_my'::JSONB ->> 'favored')::BOOLEAN
    AND :'n283_detail_my'::JSONB -> 'preparations' = jsonb_build_object('studentCaseId', pg_temp.n283_id(501), 'items', '[]'::JSONB),
  'a draft city or an empty cost block reached the student, or the favourite flag leaked');
SELECT pg_temp.n283_assert(pg_temp.n283_ok('6', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) -> 'preparations' = 'null'::JSONB
    AND NOT (pg_temp.n283_ok('6', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) ->> 'favored')::BOOLEAN
    AND pg_temp.n283_ok('6', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) -> 'openConsultation' = 'null'::JSONB,
  'a student without a case got preparations, or another student''s favourite or consultation');
SELECT pg_temp.n283_assert(bool_and(pg_temp.n283_state(v.who, format('platform.student_university_detail_v1(%L::UUID)', v.id)) = v.state),
  'detail refusal matrix: ' || string_agg(v.who || ' ' || v.id || '=' || pg_temp.n283_state(v.who, format('platform.student_university_detail_v1(%L::UUID)', v.id)), '; '))
FROM (VALUES ('5', pg_temp.n283_id(703), '42501'), ('5', pg_temp.n283_id(704), '42501'), ('5', pg_temp.n283_id(711), '42501'),
  ('5', pg_temp.n283_id(799), '42501'), ('15', pg_temp.n283_id(701), '42501'), ('15', pg_temp.n283_id(711), 'ok'),
  ('anon', pg_temp.n283_id(701), '42501')) AS v(who, id, state);
SELECT pg_temp.n283_assert(pg_temp.n283_state('5', 'platform.student_university_detail_v1(NULL)') = '22023', 'NULL id was not 22023');

-- The index moved with the published data: hasCosts and a new version.
SELECT pg_temp.n283_ok('5', format('platform.student_university_index_v1(%L)', :'n283_index'::JSONB ->> 'version')) AS n283_index2 \gset
SELECT pg_temp.n283_assert((:'n283_index2'::JSONB ->> 'notModified')::BOOLEAN IS FALSE
    AND :'n283_index2'::JSONB ->> 'version' <> :'n283_index'::JSONB ->> 'version'
    AND (SELECT (u ->> 'hasCosts')::BOOLEAN FROM jsonb_array_elements(:'n283_index2'::JSONB -> 'universities') u WHERE u ->> 'id' = pg_temp.n283_id(701)::TEXT),
  'publishing costs did not change the index version and hasCosts');

-- (e) An edit returns a confirmed, published agency row to draft without its confirmation.
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_upsert_v1(%L::UUID, %L::JSONB, 3, gen_random_uuid())', pg_temp.n283_id(1),
    pg_temp.n283_cost(:'n283_agency'::UUID, pg_temp.n283_id(701), 'accommodation', 900000, NULL, 'CNY', 'agency'))) ->> 'status' AS n283_edit_status \gset
SELECT pg_temp.n283_assert(:'n283_edit_status' = 'draft'
    AND (SELECT status = 'draft' AND confirmed_at IS NULL AND confirmation_reason IS NULL AND amount_min_minor = 900000 AND version = 4
      FROM platform.catalog_costs WHERE id = :'n283_agency'::UUID)
    AND jsonb_array_length(pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) #> '{costs,rows}') = 2,
  'an edited agency row kept its confirmation or stayed visible');

-- ===========================================================================
-- (d, f) Import: editor without confirmations, Admin with them, service role
-- with a named Admin, idempotency, re-import by importKey, tolerance.
-- ===========================================================================
CREATE TEMP TABLE n283_import AS SELECT jsonb_build_array(
  jsonb_build_object('importKey', 'n283:beta:tuition', 'country', 'MY', 'institutionName', 'N283 Beta Malaysia', 'programId', NULL,
    'studyLevel', 'bachelor', 'teachingLanguage', 'en', 'costKind', 'tuition', 'period', 'year', 'amountMinMinor', 3000000,
    'amountMaxMinor', NULL, 'currency', 'MYR', 'academicYear', '2026/27', 'noteRu', 'Без налога SST 6 %.', 'noteKy', 'SST 6 % салыгы кошулган эмес.',
    'sourceKind', 'official', 'sourceName', 'N283 Beta', 'sourceUrl', 'https://university.example-n283.edu/fees', 'verifiedOn', '2026-10-16',
    'publish', TRUE),
  jsonb_build_object('importKey', 'n283:missing', 'country', 'CN', 'institutionName', 'N283 Not In This Database',
    'costKind', 'tuition', 'period', 'year', 'amountMinMinor', 100, 'currency', 'CNY', 'academicYear', '2026/27',
    'sourceKind', 'official', 'sourceName', 'N283', 'sourceUrl', 'https://university.example-n283.edu/fees', 'verifiedOn', '2026-10-16'),
  jsonb_build_object('importKey', 'n283:poland', 'country', 'PL', 'institutionName', 'N283 Gamma Poland',
    'costKind', 'tuition', 'period', 'year', 'amountMinMinor', 100, 'currency', 'PLN', 'academicYear', '2026/27',
    'sourceKind', 'official', 'sourceName', 'N283', 'sourceUrl', 'https://university.example-n283.edu/fees', 'verifiedOn', '2026-10-16')) AS rows;
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, %L::UUID)',
  pg_temp.n283_id(1), (SELECT rows FROM n283_import), pg_temp.n283_id(3301))) AS n283_import_receipt \gset
SELECT pg_temp.n283_assert((:'n283_import_receipt'::JSONB ->> 'created')::INT = 1 AND (:'n283_import_receipt'::JSONB ->> 'institutionMissing')::INT = 2
    AND (SELECT array_agg(r ->> 'status' ORDER BY r ->> 'importKey') FROM jsonb_array_elements(:'n283_import_receipt'::JSONB -> 'rows') r)
      = ARRAY['created', 'institution_missing', 'institution_missing']
    AND (SELECT status = 'published' AND published_by_membership_id = pg_temp.n283_id(302) AND request_id = md5(pg_temp.n283_id(3301)::TEXT || ':1')::UUID
      FROM platform.catalog_costs WHERE import_key = 'n283:beta:tuition'),
  'the editor import (tolerant of a missing and a non-product university) did not create and publish the official row');
SELECT pg_temp.n283_assert(pg_temp.n283_ok('2', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, %L::UUID)',
    pg_temp.n283_id(1), (SELECT rows FROM n283_import), pg_temp.n283_id(3301))) = :'n283_import_receipt'::JSONB
    AND (SELECT count(*) FROM platform.catalog_costs WHERE import_key IS NOT NULL) = 1,
  'an import replay was not the same receipt without a write');
SELECT pg_temp.n283_assert((pg_temp.n283_ok('2', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid())',
    pg_temp.n283_id(1), (SELECT rows FROM n283_import))) -> 'rows' -> 0 ->> 'status') = 'exists'
    AND (SELECT count(*) FROM platform.catalog_costs WHERE import_key IS NOT NULL) = 1,
  'a re-import under a new request id created a duplicate row');
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, %L::UUID)',
    pg_temp.n283_id(1), (SELECT rows FROM n283_import) - 2, pg_temp.n283_id(3301))) = '23505',
  'an import request id reused with other rows was not 23505');
-- Agency rows: unconfirmed publish refused; confirmation by the editor
-- refused; by the Admin accepted; by the service role only with a named Admin.
CREATE TEMP TABLE n283_agency_rows AS SELECT
  jsonb_build_object('importKey', 'n283:alpha:agency-tuition', 'institutionId', pg_temp.n283_id(701), 'studyLevel', 'bachelor',
    'teachingLanguage', 'zh', 'costKind', 'tuition', 'period', 'year', 'amountMinMinor', 2000000, 'currency', 'CNY',
    'academicYear', '2026/27', 'sourceKind', 'agency', 'sourceName', 'N283 Agency', 'sourceUrl', 'https://agency.example-n283.org/fees',
    'verifiedOn', '2026-10-16', 'publish', TRUE) AS row_value;
SELECT pg_temp.n283_assert(pg_temp.n283_state('1', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid())',
    pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows)))) = '23514',
  'an import published an unconfirmed agency row');
SELECT pg_temp.n283_assert(pg_temp.n283_state('2', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid())',
    pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || jsonb_build_object('confirmation',
      jsonb_build_object('confirmedOn', '2026-10-16', 'reason', 'N283'))))) = '42501',
  'the editor imported an agency confirmation');
SELECT pg_temp.n283_assert(pg_temp.n283_state('service_role', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid())',
    pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || '{"publish": false}'))) = '42501'
    AND pg_temp.n283_state('service_role', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid(), %L::UUID)',
      pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || '{"publish": false}'), pg_temp.n283_id(302))) = '42501'
    AND pg_temp.n283_state('service_role', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid(), %L::UUID)',
      pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || '{"publish": false}'), pg_temp.n283_id(311))) = '42501'
    AND pg_temp.n283_state('1', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, gen_random_uuid(), %L::UUID)',
      pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || '{"publish": false}'), pg_temp.n283_id(301))) = '42501'
    AND pg_temp.n283_state('service_role', format('platform.staff_catalog_city_upsert_v1(%L::UUID, %L::JSONB, 0, gen_random_uuid())',
      pg_temp.n283_id(1), pg_temp.n283_city('svc', 'CN', 'Сервис', FALSE))) = '42501',
  'the service role acted without a named live Admin of the organization, or an authenticated caller named an actor');
SELECT pg_temp.n283_ok('service_role', format('platform.staff_catalog_cost_import_v1(%L::UUID, %L::JSONB, %L::UUID, %L::UUID)',
  pg_temp.n283_id(1), jsonb_build_array((SELECT row_value FROM n283_agency_rows) || jsonb_build_object('confirmation',
    jsonb_build_object('confirmedOn', '2026-10-16', 'reason', 'Владелец подтвердил данные агентств в чате 16.10.2026'))),
  pg_temp.n283_id(3302), pg_temp.n283_id(301))) AS n283_svc_import \gset
SELECT pg_temp.n283_assert((:'n283_svc_import'::JSONB ->> 'created')::INT = 1
    AND (SELECT status = 'published' AND confirmed_by_membership_id = pg_temp.n283_id(301) AND confirmed_on = DATE '2026-10-16'
        AND confirmation_reason = 'Владелец подтвердил данные агентств в чате 16.10.2026' AND created_by_membership_id = pg_temp.n283_id(301)
      FROM platform.catalog_costs WHERE import_key = 'n283:alpha:agency-tuition')
    AND (SELECT actor_membership_id = pg_temp.n283_id(301) FROM platform_private.catalog_geography_requests WHERE request_id = pg_temp.n283_id(3302)),
  'the service-role import with the named Admin did not record the owner confirmation');
SELECT pg_temp.n283_ok('service_role', format('platform.staff_catalog_fx_rate_set_v1(%L::UUID, %L, current_date, 4.2, %L, NULL, gen_random_uuid(), %L::UUID)',
  pg_temp.n283_id(1), 'MYR', 'N283 National Bank', pg_temp.n283_id(301)));
SELECT pg_temp.n283_assert(position('N283 Agency' IN pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701)))::TEXT) = 0
    AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(701))) #> '{costs,rows}') r
      WHERE r #>> '{source,kind}' = 'agency' AND r -> 'source' -> 'url' = 'null'::JSONB) = 1
    AND (pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(702))) #>> '{costs,rows,0,usdApproxMin}') = '7140'
    AND (pg_temp.n283_ok('5', format('platform.student_university_detail_v1(%L::UUID)', pg_temp.n283_id(702))) #> '{costs,rows,0,note}')
      = jsonb_build_object('ru', 'Без налога SST 6 %.', 'ky', 'SST 6 % салыгы кошулган эмес.'),
  'imported costs did not reach the student as anonymous agency data or with the MYR rate');

-- ===========================================================================
-- (d) Staff read: the editor and the Admin; another organization's Admin no.
-- ===========================================================================
SELECT pg_temp.n283_ok('2', format('platform.staff_catalog_geography_v1(%L::UUID)', pg_temp.n283_id(1))) AS n283_geo \gset
SELECT pg_temp.n283_assert(jsonb_array_length(:'n283_geo'::JSONB -> 'countries') = 6
    AND (SELECT array_agg(c ->> 'key' || ':' || (c ->> 'status') || ':' || (c ->> 'complete') || ':' || (c ->> 'institutionCount') ORDER BY c ->> 'key')
      FROM jsonb_array_elements(:'n283_geo'::JSONB -> 'cities') c) = ARRAY['hangzhou:published:true:1', 'kuala-lumpur:draft:false:1']
    AND (SELECT array_agg(i ->> 'name' ORDER BY i ->> 'name') FROM jsonb_array_elements(:'n283_geo'::JSONB -> 'institutions') i)
      = ARRAY['N283 Alpha China', 'N283 Beta Malaysia', 'N283 Delta Italy', 'N283 Epsilon Turkey']
    AND (SELECT (i ->> 'published')::BOOLEAN IS FALSE FROM jsonb_array_elements(:'n283_geo'::JSONB -> 'institutions') i WHERE i ->> 'name' = 'N283 Delta Italy')
    AND jsonb_array_length(:'n283_geo'::JSONB -> 'costs') = 6
    AND (SELECT c ->> 'sourceName' FROM jsonb_array_elements(:'n283_geo'::JSONB -> 'costs') c WHERE c ->> 'id' = :'n283_agency') = 'N283 Agency'
    AND (SELECT array_agg((r ->> 'currency') || ':' || (r ->> 'ageDays') || ':' || (r ->> 'latest') ORDER BY r ->> 'currency')
      FROM jsonb_array_elements(:'n283_geo'::JSONB -> 'fxRates') r) = ARRAY['CNY:3:true', 'MYR:0:true'],
  'staff geography read: ' || :'n283_geo');
SELECT pg_temp.n283_assert(pg_temp.n283_ok('1', format('platform.staff_catalog_geography_v1(%L::UUID)', pg_temp.n283_id(1))) = :'n283_geo'::JSONB
    AND pg_temp.n283_state('11', format('platform.staff_catalog_geography_v1(%L::UUID)', pg_temp.n283_id(1))) = '42501'
    AND jsonb_array_length(pg_temp.n283_ok('11', format('platform.staff_catalog_geography_v1(%L::UUID)', pg_temp.n283_id(2))) -> 'cities') = 0,
  'the Admin reads the same, another organization''s Admin reads only its own');

SELECT 'N283_CATALOG_GEOGRAPHY_COSTS_SUITE_PASSED' AS n283_suite_marker;
ROLLBACK;
