\set ON_ERROR_STOP on
-- Boundary suite for migration 368 «скорость Заявок»: the queue `staff_requests_queue_v3` with the visible leads decided once,
-- the review right of applications decided once per direction, the sales-ledger guard without the page, and the batch read of
-- call lines `telephony_lead_calls_batch_v1`. Runs on the real chain right after 368 inside one transaction that is rolled
-- back. Synthetic data only. Members are modelled like production (invited staff: coarse role NULL, permissions only from
-- scoped role assignments), with the fixture of the suite of migration 250 plus: 8 (no lead.read at all), 10 (Admissions
-- Manager reading by DIRECTION MY), 11 (Sales Manager with OWN scope), phone-call leads, applications with several countries.
--
-- Proves: (1) for every actor (the Admin, department / organization / own / direction readers, staff without lead.read, the
-- Student, a caller without a membership), with telephony off and on, for every tab, status, page limit and cursor, the new
-- queue returns EXACTLY what the released body (private.s368_old_queue_v3, md5 pinned) returns, errors included, and the
-- non-vacuous rows are what the roles say; (2) the ledger guard refuses exactly when the released page refuses: a damaged
-- lead breaks the callers who can see it (23514) and nobody else, for a current-state damage and a receipt damage, and the
-- guard equals `private.staff_sales_lead_page(1)` for every actor; (3) the batch read equals the per-lead read of
-- `telephony_lead_calls_v1` lead by lead, for every actor, telephony state and limit: a lead the single read refuses (42501)
-- is absent from the batch, a visible one carries the same object; callers without the organization, invalid parameters;
-- (4) the posture: SECURITY DEFINER, STABLE, empty search_path, EXECUTE as intended, the queue ACL unchanged.
BEGIN;

DO $s368_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$s368_auth_role$;

CREATE FUNCTION pg_temp.s368_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.s368_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'S368: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.s368_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.s368_key(kind TEXT, n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT kind || ':' || pg_temp.s368_id(n)::TEXT
$$;
CREATE FUNCTION pg_temp.s368_keys(VARIADIC keys TEXT[]) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) FROM unnest(keys) AS k
$$;
-- Sorted kind:id of a queue page.
CREATE FUNCTION pg_temp.s368_rows(page JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'kind') || ':' || (r ->> 'id') ORDER BY (r ->> 'kind') || ':' || (r ->> 'id')), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(page -> 'rows') AS r
$$;
-- Sorted lead keys whose row carries «take».
CREATE FUNCTION pg_temp.s368_takes(page JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg('lead:' || (r ->> 'id') ORDER BY r ->> 'id'), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(page -> 'rows') AS r WHERE r -> 'take' IS NOT NULL AND r -> 'take' <> 'null'::JSONB
$$;
CREATE FUNCTION pg_temp.s368_row(page JSONB, n INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT r FROM jsonb_array_elements(page -> 'rows') AS r WHERE r ->> 'id' = pg_temp.s368_id(n)::TEXT
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s368_id(INTEGER), pg_temp.s368_assert(BOOLEAN, TEXT), pg_temp.s368_error(TEXT),
  pg_temp.s368_key(TEXT, INTEGER), pg_temp.s368_keys(TEXT[]), pg_temp.s368_rows(JSONB), pg_temp.s368_takes(JSONB),
  pg_temp.s368_row(JSONB, INTEGER)
  TO authenticated, anon, service_role;


-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (admissions department), 7 Sales Manager B (sales department B), 9 Sales
-- Manager with organization scope; 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE s368_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO s368_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL), (9, NULL),
  (8, NULL), (10, NULL), (11, NULL);
GRANT SELECT ON s368_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.s368_id(1), 'S368 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.s368_id(100 + n), 's368-' || n || '@example.invalid', '{}'::JSONB FROM s368_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.s368_id(199), 's368-none@example.invalid', '{}'::JSONB),
  (pg_temp.s368_id(181), 's368-applicant-1@example.invalid', '{}'::JSONB),
  (pg_temp.s368_id(182), 's368-applicant-2@example.invalid', '{}'::JSONB),
  (pg_temp.s368_id(183), 's368-applicant-3@example.invalid', '{}'::JSONB),
  (pg_temp.s368_id(184), 's368-applicant-4@example.invalid', '{}'::JSONB),
  (pg_temp.s368_id(185), 's368-applicant-5@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.s368_id(200 + n), pg_temp.s368_id(100 + n), 'S368 Actor ' || n, 'active', 1 FROM s368_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.s368_id(300 + n), pg_temp.s368_id(1), pg_temp.s368_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM s368_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.s368_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.s368_id(401), pg_temp.s368_id(1), 'organization', pg_temp.s368_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.s368_id(1), pg_temp.s368_id(301), pg_temp.s368_id(401), 1, 1, TRUE, 'system',
    'S368 synthetic organization scope', pg_temp.s368_id(601)),
  (pg_temp.s368_id(1), pg_temp.s368_id(305), pg_temp.s368_id(401), 1, 1, TRUE, 'system',
    'S368 synthetic Student organization scope', pg_temp.s368_id(604));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.s368_id(901), pg_temp.s368_id(1), 'S368 Sales A'),
  (pg_temp.s368_id(902), pg_temp.s368_id(1), 'S368 Admissions'),
  (pg_temp.s368_id(903), pg_temp.s368_id(1), 'S368 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.s368_id(1), pg_temp.s368_id(302), pg_temp.s368_id(901)),
  (pg_temp.s368_id(1), pg_temp.s368_id(303), pg_temp.s368_id(902)),
  (pg_temp.s368_id(1), pg_temp.s368_id(304), pg_temp.s368_id(902)),
  (pg_temp.s368_id(1), pg_temp.s368_id(307), pg_temp.s368_id(903)),
  (pg_temp.s368_id(1), pg_temp.s368_id(309), pg_temp.s368_id(901));

-- Leads (created_at orders the queue; Bishkek +06):
--   711 website, no owner, new                       -> waiting
--   712 whatsapp, no owner, contacting (next action below, through the command) -> waiting
--   713 website, owner Sales Manager A, qualified     -> taken
--   714 website, owner Sales Manager B               -> taken
--   715 website, no owner, handed off to case 504    -> not waiting, not takeable
--   716 other (manual), no owner                     -> never a request
--   717 website, no owner, closed                    -> never a request
-- Case 504 (pending) carries 715's completed handoff.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.s368_id(424), pg_temp.s368_id(1), 'student_case', pg_temp.s368_id(504), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, admissions_direction)
VALUES (pg_temp.s368_id(504), pg_temp.s368_id(1), pg_temp.s368_id(302), NULL, 'synthetic:s368:4', 'S368 Student 504',
  'MY', 'Bachelor', 'contract_confirmed', 'pending', NULL, pg_temp.s368_id(424), 1, 'new', pg_temp.s368_id(715), 'MY');
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, email)
  SELECT pg_temp.s368_id(1000 + k), pg_temp.s368_id(1), 'S368 Client ' || k,
    platform_private.normalize_person_name('S368 Client ' || k), 's368-client-' || k || '@example.invalid'
  FROM generate_series(711, 720) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.s368_id(f.k), pg_temp.s368_id(1), pg_temp.s368_id(1000 + f.k),
  CASE WHEN f.owner IS NULL THEN NULL ELSE pg_temp.s368_id(f.owner) END, f.stage, f.source,
  f.lifecycle::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES
  (711, NULL, 'new', 'website', 'open', '2026-09-20 09:00+06'),
  (712, NULL, 'contacting', 'whatsapp', 'open', '2026-09-21 10:00+06'),
  (713, 302, 'qualified', 'website', 'open', '2026-09-22 11:00+06'),
  (714, 307, 'new', 'website', 'open', '2026-09-23 12:00+06'),
  (715, NULL, 'qualified', 'website', 'open', '2026-09-19 08:00+06'),
  (716, NULL, 'new', 'other', 'open', '2026-09-24 08:00+06'),
  (717, NULL, 'contacting', 'website', 'disqualified', '2026-09-25 08:00+06'),
  (718, NULL, 'new', 'phone_call', 'open', '2026-09-26 09:00+06'),
  (719, 311, 'new', 'website', 'open', '2026-09-27 09:00+06'),
  (720, 311, 'new', 'phone_call', 'open', '2026-09-28 09:00+06')) AS f(k, owner, stage, source, lifecycle, created);
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links, handed_off_at)
VALUES (pg_temp.s368_id(1), pg_temp.s368_id(715), pg_temp.s368_id(1715), pg_temp.s368_id(504),
  'canonical-lead:' || pg_temp.s368_id(715)::TEXT, 'normal', 'S368 synthetic handoff',
  pg_temp.s368_id(302), pg_temp.s368_id(202), pg_temp.s368_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB, '2026-09-19 12:00+06');
-- Applications: 801 pending (24.09), 802 rejected (18.09). Direction CN.
INSERT INTO platform_private.student_applications(id, organization_id, auth_user_id, normalized_email, questionnaire,
  status, submitted_at, decided_at, decided_by_membership_id, decision_reason)
SELECT pg_temp.s368_id(f.k), pg_temp.s368_id(1), pg_temp.s368_id(f.auth_user), 's368-applicant-' || f.k || '@example.invalid',
  jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.s368_id(f.k + 10)::TEXT, 'firstName', 'S368',
    'lastName', 'Applicant ' || f.k, 'phone', '+996555000' || f.k, 'destinationCountries', f.countries,
    'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school', 'averageGrade', 4.5,
    'gradeScale', '5', 'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
  f.status, f.submitted::TIMESTAMPTZ,
  CASE WHEN f.status = 'rejected' THEN f.submitted::TIMESTAMPTZ + INTERVAL '1 day' END,
  CASE WHEN f.status = 'rejected' THEN pg_temp.s368_id(301) END,
  CASE WHEN f.status = 'rejected' THEN 'S368 synthetic decline' END
FROM (VALUES (801, 181, 'pending', '2026-09-24 12:00+06', '["CN"]'::JSONB), (802, 182, 'rejected', '2026-09-18 12:00+06', '["CN"]'::JSONB),
  (803, 183, 'pending', '2026-09-23 12:00+06', '["MY","FR"]'::JSONB), (804, 184, 'pending', '2026-09-22 12:00+06', '["AE"]'::JSONB),
  (805, 185, 'pending', '2026-09-21 12:00+06', '["DE","CN"]'::JSONB))
  AS f(k, auth_user, status, submitted, countries);
-- Consultations from the Student's cabinet: 851 open (25.09), 852 handled (17.09).
INSERT INTO platform_private.portal_consultation_requests(id, organization_id, membership_id, request_id, note, status,
  created_at, handled_at, handled_by_membership_id)
VALUES (pg_temp.s368_id(851), pg_temp.s368_id(1), pg_temp.s368_id(305), pg_temp.s368_id(861), 'S368 synthetic note',
    'requested', '2026-09-25 09:00+06', NULL, NULL),
  (pg_temp.s368_id(852), pg_temp.s368_id(1), pg_temp.s368_id(305), pg_temp.s368_id(862), NULL,
    'handled', '2026-09-17 09:00+06', '2026-09-17 15:00+06', pg_temp.s368_id(301));
SET LOCAL session_replication_role = origin;

-- Roles with the EXACT production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE s368_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO s368_roles VALUES
 (pg_temp.s368_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.s368_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.s368_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.s368_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.s368_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 -- Narrow roles for the scopes the production roles do not allow (every key of a bundle must support the scope).
 (pg_temp.s368_id(1106), 'Lead reader', '["lead.read"]', 1160),
 (pg_temp.s368_id(1107), 'Direction applications', '["lead.read","profile.read.full","profile.manage","case.curator.assign"]', 1170);
CREATE TEMP TABLE s368_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO s368_grants VALUES
 (302, pg_temp.s368_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.s368_id(901), 'resourceKind', NULL)),
 (302, pg_temp.s368_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (303, pg_temp.s368_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.s368_id(902), 'resourceKind', NULL)),
 (303, pg_temp.s368_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (304, pg_temp.s368_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.s368_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (307, pg_temp.s368_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.s368_id(903), 'resourceKind', NULL)),
 (307, pg_temp.s368_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (309, pg_temp.s368_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (309, pg_temp.s368_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 -- 308 holds no lead.read at all; 310 reads leads and applications by DIRECTION MY (the case 504 of lead 715); 311 reads leads with OWN scope.
 (308, pg_temp.s368_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL)),
 (310, pg_temp.s368_id(1107), jsonb_build_object('kind', 'direction', 'key', 'MY', 'resourceKind', NULL)),
 (311, pg_temp.s368_id(1106), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (311, pg_temp.s368_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.s368_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE s368_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.s368_id(1);
GRANT SELECT ON s368_roles, s368_grants, s368_versions TO authenticated;

SELECT pg_temp.s368_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM s368_roles)
  = ARRAY[35, 36, 23, 12, 16, 1, 4], 'role bundles have the production key counts 35/36/23/12/16 and the two narrow roles 1/4');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.s368_id(101),
  'claims', jsonb_build_object('sub', pg_temp.s368_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS s368_admin_setup \gset
SET LOCAL request.jwt.claims TO :'s368_admin_setup';
SET LOCAL ROLE authenticated;
DO $s368_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM s368_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.s368_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'S368 ' || r.label, 'description', 'Migration 250 synthetic role',
        'permissionKeys', r.keys), 'S368 create role', pg_temp.s368_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.s368_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.s368_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'S368 publish role', pg_temp.s368_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM s368_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM s368_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.s368_id(1), pg_temp.s368_id(m),
      (SELECT access_version FROM s368_versions WHERE membership_id = pg_temp.s368_id(m)), items, bindings,
      'S368 grant roles', pg_temp.s368_id(2000 + m));
  END LOOP;
END
$s368_roles$;
RESET ROLE;

UPDATE s368_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.s368_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.s368_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT jsonb_build_object('sub', pg_temp.s368_id(199), 'role', 'authenticated')::TEXT AS s368_no_member \gset
SELECT claims AS s368_admin FROM s368_actors WHERE n = 1 \gset

-- 712's next action is written by the real command (a receipt keeps the 111
-- guard of the lead reads consistent); the owner stays empty.
SET LOCAL request.jwt.claims TO :'s368_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.s368_assert((platform.mutate_sales_lead_workflow(pg_temp.s368_id(712), 1, pg_temp.s368_id(3001),
  'contacting', NULL, 'S368 перезвонить', DATE '2026-09-30', FALSE, NULL) ->> 'workflow_version') = '2',
  'setup: the next action of 712 is recorded through the command, owner still empty');
RESET ROLE;

SELECT 'A368_REQUESTS_SPEED_SUITE_START' AS a368_suite_marker;

-- ---------------------------------------------------------------------------
-- The released queue body under a temporary name, and its anchor.
-- ---------------------------------------------------------------------------
\ir platform_requests_speed_old_queue.sql
SELECT pg_temp.s368_assert(md5(p.prosrc) = 'db224f4cbc898a77a59084bb2d89de8b',
  'private.s368_old_queue_v3 is byte-identical to the released staff_requests_queue_v3 (the anchor of migration 368)')
FROM pg_proc p WHERE p.oid = 'private.s368_old_queue_v3(uuid,text,text,integer,jsonb)'::REGPROCEDURE;

-- ---------------------------------------------------------------------------
-- Telephony fixture: a settings row (off), calls on leads 718 (two outcomes), 720, 711 and a call of client 1719 that
-- had no lead yet (it belongs to the feed of lead 719).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.s368_id(1));
CREATE FUNCTION pg_temp.s368_mk(p_k INTEGER, p_dir TEXT, p_outcome TEXT, p_age INTERVAL, p_client INTEGER, p_lead INTEGER,
  p_member INTEGER, p_talk INTEGER DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - p_age;
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, talk_seconds, client_phone, membership_id, client_id, lead_id,
    match_state, created_via)
  VALUES (pg_temp.s368_id(7000 + p_k), pg_temp.s368_id(1), 's368-call-' || p_k, p_dir, 'ended', p_outcome, 'webhook',
    v_start, CASE WHEN p_outcome = 'answered' THEN v_start + INTERVAL '5 seconds' END,
    v_start + INTERVAL '3 minutes', v_start + INTERVAL '4 minutes', p_talk, '+99670000' || lpad(p_k::TEXT, 4, '0'),
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.s368_id(300 + p_member) END,
    pg_temp.s368_id(p_client), CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.s368_id(p_lead) END, 'matched', 'webhook');
END
$$;
SELECT pg_temp.s368_mk(1, 'out', 'answered', INTERVAL '1 hour', 1718, 718, 2, 90);
SELECT pg_temp.s368_mk(2, 'in', 'missed', INTERVAL '5 hours', 1718, 718, NULL);
SELECT pg_temp.s368_mk(3, 'in', 'missed', INTERVAL '6 hours', 1718, 718, NULL);
SELECT pg_temp.s368_mk(4, 'in', 'missed', INTERVAL '2 hours', 1720, 720, NULL);
SELECT pg_temp.s368_mk(5, 'out', 'answered', INTERVAL '3 hours', 1711, 711, 2, 40);
SELECT pg_temp.s368_mk(6, 'in', 'answered', INTERVAL '4 hours', 1719, NULL, 2, 30);
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, membership_id, state, status,
  leg_started_at, leg_start_source, accepted_at, webhook_total_seconds, talk_seconds, recording_link, recording_state)
SELECT c.organization_id, c.id, 'u702', c.membership_id, 'completed', 'success', c.started_at, 'history',
  c.started_at + INTERVAL '5 seconds', 95, 90, NULL, 'none'
FROM platform_private.telephony_calls c WHERE c.id = pg_temp.s368_id(7001);

-- ---------------------------------------------------------------------------
-- Runners: the statement as another identity. `authenticated` for the new functions (the real path); the released copy runs
-- as the owner with the same claims (it lives in a schema clients cannot use).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.s368_claims(p_who TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT CASE p_who WHEN 'anon' THEN '{"role":"anon"}' WHEN 'service_role' THEN '{"role":"service_role"}'
    WHEN 'nomember' THEN jsonb_build_object('sub', pg_temp.s368_id(199), 'role', 'authenticated')::TEXT
    ELSE (SELECT a.claims FROM s368_actors a WHERE a.n = p_who::INTEGER) END
$$;
CREATE FUNCTION pg_temp.s368_run(p_who TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.s368_claims(p_who), TRUE);
  IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
  BEGIN
    EXECUTE p_sql INTO answer;
  EXCEPTION WHEN OTHERS THEN answer := 'ERR ' || SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;
-- The role a caller really has: anon and service_role as themselves, everyone else authenticated.
CREATE FUNCTION pg_temp.s368_role(p_who TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_who IN ('anon', 'service_role') THEN p_who ELSE 'authenticated' END
$$;
CREATE TEMP TABLE s368_seen(label TEXT, who TEXT, telephony INTEGER, answer TEXT);
CREATE FUNCTION pg_temp.s368_telephony(p_state INTEGER) RETURNS VOID LANGUAGE SQL AS $$
  UPDATE platform_private.telephony_settings SET ui_enabled = p_state >= 1, dial_enabled = p_state >= 2
  WHERE organization_id = pg_temp.s368_id(1)
$$;
CREATE FUNCTION pg_temp.s368_leads(p_page TEXT) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'id') ORDER BY r ->> 'id'), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(p_page::JSONB -> 'rows') AS r WHERE r ->> 'kind' = 'lead'
$$;
CREATE FUNCTION pg_temp.s368_apps(p_page TEXT) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'id') ORDER BY r ->> 'id'), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(p_page::JSONB -> 'rows') AS r WHERE r ->> 'kind' = 'application'
$$;
CREATE FUNCTION pg_temp.s368_ids(VARIADIC n INTEGER[]) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.s368_id(k)::TEXT ORDER BY pg_temp.s368_id(k)::TEXT), ARRAY[]::TEXT[]) FROM unnest(n) AS k
$$;

-- ---------------------------------------------------------------------------
-- 1. The queue: the new body answers exactly what the released one answers.
-- ---------------------------------------------------------------------------
DO $s368_queue$
DECLARE
  org UUID := pg_temp.s368_id(1);
  who TEXT; tel INTEGER; v RECORD; args TEXT; ans_new TEXT; ans_old TEXT; cursor_value JSONB; steps INTEGER;
  compared INTEGER := 0; errors INTEGER := 0;
BEGIN
  FOR tel IN 0..1 LOOP
    PERFORM pg_temp.s368_telephony(tel);
    FOREACH who IN ARRAY ARRAY['1','2','3','4','5','7','8','9','10','11','nomember'] LOOP
      FOR v IN SELECT * FROM (VALUES
        ('all', 'waiting', 50), ('all', 'all', 50), ('website', 'all', 50), ('website', 'waiting', 50),
        ('whatsapp', 'waiting', 50), ('whatsapp', 'all', 50), ('phone_call', 'all', 50), ('phone_call', 'waiting', 50),
        ('platform_application', 'all', 50), ('platform_application', 'waiting', 50),
        ('portal_consultation', 'all', 50), ('portal_consultation', 'waiting', 50),
        ('all', 'all', 1), ('all', 'waiting', 2)) AS t(source, status, lim) LOOP
        args := format('%L, %L, %L, %s', org, v.source, v.status, v.lim);
        ans_new := pg_temp.s368_run(who, 'authenticated', format('SELECT platform.staff_requests_queue_v3(%s)::TEXT', args));
        ans_old := pg_temp.s368_run(who, NULL, format('SELECT private.s368_old_queue_v3(%s)::TEXT', args));
        IF ans_new IS DISTINCT FROM ans_old THEN
          RAISE EXCEPTION 'S368: queue % % % (limit %) telephony % for actor %: new <> old: % <> %', v.source, v.status, v.lim, v.lim, tel, who, ans_new, ans_old;
        END IF;
        compared := compared + 1;
        IF ans_new LIKE 'ERR %' THEN errors := errors + 1; END IF;
        IF v.source = 'all' AND v.status = 'all' AND v.lim = 50 THEN INSERT INTO s368_seen VALUES ('queue', who, tel, ans_new); END IF;
        -- Paging: follow the next cursors of the new answer; the released body must answer every page the same way.
        IF v.lim IN (1, 2) AND ans_new NOT LIKE 'ERR %' THEN
          cursor_value := ans_new::JSONB -> 'nextCursor';
          steps := 0;
          WHILE cursor_value IS NOT NULL AND cursor_value <> 'null'::JSONB AND steps < 12 LOOP
            args := format('%L, %L, %L, %s, %L::JSONB', org, v.source, v.status, v.lim, cursor_value::TEXT);
            ans_new := pg_temp.s368_run(who, 'authenticated', format('SELECT platform.staff_requests_queue_v3(%s)::TEXT', args));
            ans_old := pg_temp.s368_run(who, NULL, format('SELECT private.s368_old_queue_v3(%s)::TEXT', args));
            IF ans_new IS DISTINCT FROM ans_old THEN
              RAISE EXCEPTION 'S368: queue page % for actor % telephony %: new <> old: % <> %', steps + 2, who, tel, ans_new, ans_old;
            END IF;
            compared := compared + 1;
            cursor_value := ans_new::JSONB -> 'nextCursor';
            steps := steps + 1;
          END LOOP;
        END IF;
      END LOOP;
      -- Refusals and bad input: the same SQLSTATE and message.
      FOR v IN SELECT * FROM (VALUES
        (format('%L, %L, %L, %s', pg_temp.s368_id(99), 'all', 'all', 50)),
        (format('%L, %L, %L, %s', org, 'nonsense', 'all', 50)),
        (format('%L, %L, %L, %s', org, 'all', 'nonsense', 50)),
        (format('%L, %L, %L, %s', org, 'all', 'all', 0)),
        (format('%L, %L, %L, %s', org, 'all', 'all', 51)),
        (format('%L, %L, %L, %s, %L::JSONB', org, 'all', 'all', 50, '{"v":3}')),
        (format('NULL, %L, %L, %s', 'all', 'all', 50))) AS t(a) LOOP
        ans_new := pg_temp.s368_run(who, 'authenticated', format('SELECT platform.staff_requests_queue_v3(%s)::TEXT', v.a));
        ans_old := pg_temp.s368_run(who, NULL, format('SELECT private.s368_old_queue_v3(%s)::TEXT', v.a));
        IF ans_new IS DISTINCT FROM ans_old THEN
          RAISE EXCEPTION 'S368: queue bad input (%) for actor %: new <> old: % <> %', v.a, who, ans_new, ans_old;
        END IF;
        compared := compared + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s368_telephony(0);
  PERFORM pg_temp.s368_assert(compared > 500 AND errors > 50, format('queue: %s answers compared, %s of them refusals', compared, errors));
END
$s368_queue$;

-- The rows are what the roles say (so equality above is not two empty answers).
SELECT pg_temp.s368_assert(
  pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '1' AND telephony = 0))
    = pg_temp.s368_ids(711, 712, 713, 714, 715, 719)
  AND pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '1' AND telephony = 1))
    = pg_temp.s368_ids(711, 712, 713, 714, 715, 718, 719, 720)
  AND pg_temp.s368_apps((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '1' AND telephony = 0))
    = pg_temp.s368_ids(801, 802, 803, 804, 805),
  'the Admin sees every open lead (calls only with telephony on) and every application');
SELECT pg_temp.s368_assert(
  pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '11' AND telephony = 0)) = pg_temp.s368_ids(719)
  AND pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '11' AND telephony = 1)) = pg_temp.s368_ids(719, 720),
  'the own-scope Sales Manager sees only the leads he owns');
SELECT pg_temp.s368_assert(
  pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '10' AND telephony = 0)) = pg_temp.s368_ids(715)
  AND pg_temp.s368_apps((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '10' AND telephony = 0)) = pg_temp.s368_ids(803),
  'the direction reader sees the lead of his direction and exactly the applications that name it');
SELECT pg_temp.s368_assert(
  pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '2' AND telephony = 0)) = pg_temp.s368_ids(713)
  AND (SELECT answer::JSONB -> 'states' ->> 'lead' FROM s368_seen WHERE label = 'queue' AND who = '8' AND telephony = 0) = 'forbidden'
  AND pg_temp.s368_leads((SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '8' AND telephony = 0)) = ARRAY[]::TEXT[]
  AND (SELECT answer FROM s368_seen WHERE label = 'queue' AND who = '5' AND telephony = 0) LIKE 'ERR 42501:requests_queue_forbidden',
  'the department manager sees his own department''s lead; staff without lead.read have no lead state; the Student is refused');
SELECT pg_temp.s368_assert(
  (SELECT answer::JSONB -> 'counts' -> 'website' FROM s368_seen WHERE label = 'queue' AND who = '11' AND telephony = 0) = '1'::JSONB
  AND EXISTS (SELECT 1 FROM s368_seen s CROSS JOIN LATERAL jsonb_array_elements(s.answer::JSONB -> 'rows') r
    WHERE s.label = 'queue' AND s.who = '1' AND s.telephony = 0 AND jsonb_typeof(r -> 'take') = 'object'),
  'counts follow the readable scope; «take» is still computed on the rows of the page');

-- ---------------------------------------------------------------------------
-- 2. The ledger guard refuses exactly when the released page refuses (a damaged ledger of a lead the caller can read).
-- ---------------------------------------------------------------------------
-- The released refusal, for one actor: the page of «Воронка» with limit 1 (what the queue called), or 'ok'.
CREATE FUNCTION pg_temp.s368_page_answer(p_who TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT CASE WHEN a LIKE 'ERR %' THEN substr(a, 5) ELSE 'ok' END
  FROM (SELECT pg_temp.s368_run(p_who, NULL, 'SELECT count(*)::TEXT FROM private.staff_sales_lead_page(1)') AS a) x
$$;
-- The guard for one actor: his visible leads, then the guard, as the queue does.
CREATE FUNCTION pg_temp.s368_guard_answer(p_who TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT CASE WHEN a LIKE 'ERR %' THEN substr(a, 5) ELSE 'ok' END
  FROM (SELECT pg_temp.s368_run(p_who, NULL, format(
    'SELECT platform_private.staff_requests_ledger_guard_v1(%L, ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_for_actor_v1(%L, ''lead.read'', ''lead'') AS v(id)))::TEXT',
    pg_temp.s368_id(1), pg_temp.s368_id(1))) AS a) x
$$;
CREATE FUNCTION pg_temp.s368_queue_answer(p_who TEXT, p_new BOOLEAN) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT CASE WHEN a LIKE 'ERR %' THEN substr(a, 5) ELSE 'ok' END
  FROM (SELECT CASE WHEN p_new THEN pg_temp.s368_run(p_who, 'authenticated',
      format('SELECT platform.staff_requests_queue_v3(%L, ''all'', ''all'', 50)::TEXT', pg_temp.s368_id(1)))
    ELSE pg_temp.s368_run(p_who, NULL, format('SELECT private.s368_old_queue_v3(%L, ''all'', ''all'', 50)::TEXT', pg_temp.s368_id(1))) END AS a) x
$$;
CREATE TEMP TABLE s368_guard_log(damage TEXT, who TEXT, page_answer TEXT, guard_answer TEXT, queue_new TEXT, queue_old TEXT);
CREATE FUNCTION pg_temp.s368_observe(p_damage TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE who TEXT;
BEGIN
  FOREACH who IN ARRAY ARRAY['1','2','3','4','7','8','9','10','11'] LOOP
    INSERT INTO s368_guard_log VALUES (p_damage, who, pg_temp.s368_page_answer(who), pg_temp.s368_guard_answer(who),
      pg_temp.s368_queue_answer(who, TRUE), pg_temp.s368_queue_answer(who, FALSE));
  END LOOP;
END
$$;
-- Healthy ledger: everything passes.
SELECT pg_temp.s368_observe('none');
-- Damage 1, current state: lead 711 (nobody owns it, baseline version 1) carries a next action no receipt wrote.
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET next_action_text = 'S368 damaged next action', next_action_due_date = DATE '2026-10-01' WHERE id = pg_temp.s368_id(711);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.s368_observe('current_state');
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET next_action_text = NULL, next_action_due_date = NULL WHERE id = pg_temp.s368_id(711);
-- Damage 2, receipt: the receipt written for lead 712 says another stage than the lead has.
UPDATE platform_private.sales_lead_workflow_receipts SET desired_stage_key = 'qualified' WHERE lead_id = pg_temp.s368_id(712);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.s368_observe('receipt');
SET LOCAL session_replication_role = replica;
UPDATE platform_private.sales_lead_workflow_receipts SET desired_stage_key = 'contacting' WHERE lead_id = pg_temp.s368_id(712);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.s368_observe('restored');

SELECT pg_temp.s368_assert((SELECT count(*) FROM s368_guard_log) = 36
  AND NOT EXISTS (SELECT 1 FROM s368_guard_log WHERE who <> '8' AND guard_answer IS DISTINCT FROM page_answer),
  'the guard refuses exactly when the released page does, for every actor with lead.read and every damage');
-- Staff without lead.read: the page says sales_workflow_forbidden, which the queue never reaches (it asks lead.read first);
-- the queue answers them without a lead state, as before.
SELECT pg_temp.s368_assert(NOT EXISTS (SELECT 1 FROM s368_guard_log WHERE who = '8'
    AND (page_answer <> '42501:sales_workflow_forbidden' OR queue_new <> 'ok' OR queue_old <> 'ok')),
  'without lead.read the page refuses and the queue answers: the guard is never called for them');
SELECT pg_temp.s368_assert(NOT EXISTS (SELECT 1 FROM s368_guard_log WHERE queue_new IS DISTINCT FROM queue_old),
  'the new queue refuses or answers exactly as the released one, for every actor and every damage');
SELECT pg_temp.s368_assert(NOT EXISTS (SELECT 1 FROM s368_guard_log WHERE who <> '8' AND damage IN ('none', 'restored') AND page_answer <> 'ok'),
  'a healthy and a restored ledger pass for everyone who can read leads');
SELECT pg_temp.s368_assert(
  (SELECT array_agg(who ORDER BY who) FROM s368_guard_log
    WHERE damage = 'current_state' AND page_answer = '23514:sales_stage_entry_evidence_inconsistent') = ARRAY['1', '9']
  AND (SELECT array_agg(who ORDER BY who) FROM s368_guard_log
    WHERE damage = 'receipt' AND page_answer = '23514:sales_stage_entry_evidence_inconsistent') = ARRAY['1', '9'],
  'a damaged lead stops exactly the callers who can read it (the Admin and the organization-scoped manager), and nobody else');
SELECT pg_temp.s368_assert(
  (SELECT bool_and(page_answer = 'ok') FROM s368_guard_log WHERE who IN ('2', '10', '11') AND damage <> 'none'),
  'readers of other leads are not stopped by it');

-- ---------------------------------------------------------------------------
-- 3. The batch read equals the single read, lead by lead.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.s368_batch_ids() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'ARRAY[' || string_agg(quote_literal(pg_temp.s368_id(k)::TEXT) || '::UUID', ', ' ORDER BY k) || ', '
    || quote_literal('36800000-0000-4000-8000-0000000fffff') || '::UUID, '
    || quote_literal('00000000-0000-0000-0000-000000000000') || '::UUID]'
  FROM generate_series(711, 720) AS k
$$;
CREATE TEMP TABLE s368_batch_log(who TEXT, state INTEGER, lim INTEGER, answer JSONB);
DO $s368_batch$
DECLARE
  org UUID := pg_temp.s368_id(1);
  who TEXT; state INTEGER; lim INTEGER; lead_k INTEGER; lead_id UUID; got TEXT; single TEXT; expected JSONB; entry JSONB;
  checked INTEGER := 0; absent INTEGER := 0;
BEGIN
  FOR state IN 0..2 LOOP
    PERFORM pg_temp.s368_telephony(state);
    FOREACH who IN ARRAY ARRAY['1','2','3','4','7','8','9','10','11'] LOOP
      FOREACH lim IN ARRAY ARRAY[1, 2, 5, 100] LOOP
        got := pg_temp.s368_run(who, 'authenticated',
          format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, %s)::TEXT', org, pg_temp.s368_batch_ids(), lim));
        IF got LIKE 'ERR %' THEN RAISE EXCEPTION 'S368: batch for actor % failed: %', who, got; END IF;
        expected := '{}'::JSONB;
        FOR lead_k IN 711..722 LOOP
          lead_id := CASE WHEN lead_k = 721 THEN '36800000-0000-4000-8000-0000000fffff'::UUID
            WHEN lead_k = 722 THEN '00000000-0000-0000-0000-000000000000'::UUID ELSE pg_temp.s368_id(lead_k) END;
          single := pg_temp.s368_run(who, 'authenticated',
            format('SELECT platform.telephony_lead_calls_v1(%L, %L, %s, NULL, NULL)::TEXT', org, lead_id, lim));
          IF single LIKE 'ERR %' THEN
            IF single NOT LIKE 'ERR 42501:telephony_calls_forbidden' THEN
              RAISE EXCEPTION 'S368: the single read of % for actor % failed unexpectedly: %', lead_id, who, single;
            END IF;
            absent := absent + 1;
          ELSE
            expected := expected || jsonb_build_object(lead_id::TEXT, single::JSONB);
          END IF;
          checked := checked + 1;
        END LOOP;
        IF got::JSONB IS DISTINCT FROM expected THEN
          RAISE EXCEPTION 'S368: batch <> single reads for actor % telephony % limit %: % <> %', who, state, lim, got, expected;
        END IF;
        INSERT INTO s368_batch_log VALUES (who, state, lim, got::JSONB);
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s368_telephony(0);
  PERFORM pg_temp.s368_assert(checked = 3 * 9 * 4 * 12 AND absent > 100, format('batch: %s single reads compared, %s refused', checked, absent));
END
$s368_batch$;

-- The answers are not empty by accident.
SELECT pg_temp.s368_assert(
  (SELECT answer -> pg_temp.s368_id(718)::TEXT ->> 'hasMore' FROM s368_batch_log WHERE who = '1' AND state = 2 AND lim = 1) = 'true'
  AND jsonb_array_length((SELECT answer -> pg_temp.s368_id(718)::TEXT -> 'calls' FROM s368_batch_log WHERE who = '1' AND state = 2 AND lim = 1)) = 1
  AND (SELECT answer -> pg_temp.s368_id(718)::TEXT -> 'calls' -> 0 ->> 'callId' FROM s368_batch_log WHERE who = '1' AND state = 2 AND lim = 1)
    = pg_temp.s368_id(7001)::TEXT
  AND jsonb_array_length((SELECT answer -> pg_temp.s368_id(718)::TEXT -> 'calls' FROM s368_batch_log WHERE who = '1' AND state = 2 AND lim = 5)) = 3
  AND (SELECT answer -> pg_temp.s368_id(718)::TEXT ->> 'hasMore' FROM s368_batch_log WHERE who = '1' AND state = 2 AND lim = 5) = 'false'
  AND (SELECT answer -> pg_temp.s368_id(719)::TEXT -> 'calls' -> 0 ->> 'callId' FROM s368_batch_log WHERE who = '1' AND state = 1 AND lim = 1)
    = pg_temp.s368_id(7006)::TEXT
  AND (SELECT answer -> pg_temp.s368_id(718)::TEXT ->> 'enabled' FROM s368_batch_log WHERE who = '1' AND state = 0 AND lim = 1) = 'false',
  'the Admin reads the newest call of a phone lead, the count and «more», a call from before the lead existed, and «off» without telephony');
SELECT pg_temp.s368_assert(
  (SELECT answer FROM s368_batch_log WHERE who = '11' AND state = 1 AND lim = 1)
    ?& ARRAY[pg_temp.s368_id(719)::TEXT, pg_temp.s368_id(720)::TEXT]
  AND NOT (SELECT answer FROM s368_batch_log WHERE who = '11' AND state = 1 AND lim = 1) ? pg_temp.s368_id(718)::TEXT
  AND (SELECT answer FROM s368_batch_log WHERE who = '8' AND state = 1 AND lim = 1) = '{}'::JSONB
  AND (SELECT answer FROM s368_batch_log WHERE who = '2' AND state = 1 AND lim = 1) = jsonb_build_object(pg_temp.s368_id(713)::TEXT,
    (SELECT answer -> pg_temp.s368_id(713)::TEXT FROM s368_batch_log WHERE who = '2' AND state = 1 AND lim = 1)),
  'a reader gets only his own leads (the department manager''s whole answer is his department''s lead); staff without lead.read get nothing');

-- Callers and parameters.
SELECT pg_temp.s368_assert(
  pg_temp.s368_run('5', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, 1)::TEXT', pg_temp.s368_id(1), pg_temp.s368_batch_ids()))
    = 'ERR 42501:telephony_calls_forbidden'
  AND pg_temp.s368_run('nomember', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, 1)::TEXT', pg_temp.s368_id(1), pg_temp.s368_batch_ids()))
    = 'ERR 42501:telephony_calls_forbidden'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, 1)::TEXT', pg_temp.s368_id(99), pg_temp.s368_batch_ids()))
    = 'ERR 42501:telephony_calls_forbidden'
  AND pg_temp.s368_run('anon', 'anon', format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, 1)::TEXT', pg_temp.s368_id(1), pg_temp.s368_batch_ids())) LIKE 'ERR 42501:%'
  AND pg_temp.s368_run('service_role', 'service_role', format('SELECT platform.telephony_lead_calls_batch_v1(%L, %s, 1)::TEXT', pg_temp.s368_id(1), pg_temp.s368_batch_ids())) LIKE 'ERR 42501:%',
  'the Student, a caller without a membership and a caller of another organization are refused as by the single read; anon and the service role cannot call it');
SELECT pg_temp.s368_assert(
  pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, ARRAY[]::UUID[], 1)::TEXT', pg_temp.s368_id(1))) = '{}'
  AND pg_temp.s368_run('1', 'authenticated', 'SELECT platform.telephony_lead_calls_batch_v1(NULL, ARRAY[]::UUID[], 1)::TEXT') = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, NULL, 1)::TEXT', pg_temp.s368_id(1))) = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, ARRAY[NULL]::UUID[], 1)::TEXT', pg_temp.s368_id(1))) = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, ARRAY[]::UUID[], 0)::TEXT', pg_temp.s368_id(1))) = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, ARRAY[]::UUID[], 101)::TEXT', pg_temp.s368_id(1))) = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, ARRAY[]::UUID[], NULL)::TEXT', pg_temp.s368_id(1))) = 'ERR 22023:telephony_calls_invalid'
  AND pg_temp.s368_run('1', 'authenticated', format('SELECT platform.telephony_lead_calls_batch_v1(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)), 1)::TEXT', pg_temp.s368_id(1)))
    = 'ERR 22023:telephony_calls_invalid',
  'an empty list answers nothing; bad parameters are 22023; more than 50 leads are refused');

-- ---------------------------------------------------------------------------
-- 4. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.s368_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND p.provolatile = 's'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.pronamespace = 'platform'::REGNAMESPACE))
    FROM pg_proc p WHERE p.oid IN (
      'platform_private.staff_requests_ledger_guard_v1(uuid,uuid[])'::REGPROCEDURE,
      'platform.telephony_lead_calls_batch_v1(uuid,uuid[],integer)'::REGPROCEDURE,
      'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::REGPROCEDURE)),
  'definer, STABLE, empty search_path, owner-owned; the guard for nobody, the batch read and the queue for authenticated only');
SELECT pg_temp.s368_assert(
  (SELECT p.proacl::TEXT FROM pg_proc p WHERE p.oid = 'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::REGPROCEDURE)
    = (SELECT p.proacl::TEXT FROM pg_proc p WHERE p.oid = 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)'::REGPROCEDURE),
  'the queue keeps the owner and authenticated grants it had (the same ACL as its sibling read)');
SELECT pg_temp.s368_assert(
  (SELECT p.prosrc !~ 'staff_sales_lead_page' AND p.prosrc !~ 'student_application_visible'
    AND p.prosrc !~ 'staff_can_access\(l\.organization_id,actor\.membership_id,''lead\.read''' AND p.prosrc ~ 'staff_requests_ledger_guard_v1'
    FROM pg_proc p WHERE p.oid = 'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::REGPROCEDURE),
  'the queue no longer runs the whole page, a lead.read check per lead or an application check per application');
SELECT pg_temp.s368_assert(
  to_regprocedure('platform.staff_requests_queue_v2(uuid,text,text,integer,jsonb)') IS NOT NULL
  AND to_regprocedure('platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)') IS NOT NULL
  AND to_regprocedure('private.staff_sales_lead_page(integer,timestamptz,uuid,text,text,text,uuid,text,text)') IS NOT NULL,
  'the released v2 queue, the single call read and the funnel page stay as they were');

SELECT 'A368_REQUESTS_SPEED_SUITE_PASSED' AS a368_suite_marker;
ROLLBACK;
