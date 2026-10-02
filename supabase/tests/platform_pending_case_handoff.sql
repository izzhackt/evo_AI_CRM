\set ON_ERROR_STOP on
-- Boundary suite for migration 258 (issue #1075, owner decision 01.10.2026,
-- option 1: a sale saved from the report into an already open cabinet is a
-- completed handoff). Members are modelled like production after 155 and 244
-- (the fixture of platform_sales_one_truth.sql and platform_case_decline_guard.sql):
-- invited staff have organization_memberships.current_role NULL, so
-- current_actor_authority().platform_role is NULL; permissions come only from
-- scoped role assignments with the production permission keys, and the Sales
-- Manager role is the 208 workflow role (workflow_key = 'sales_manager'). Only
-- the system Admin and the Student carry a coarse role.
--
-- Every case below is created by the REAL commands, never by a fixture insert:
-- platform.create_sales_report_handoff is called as the Sales Manager on a
-- curator-less pending cabinet case (the 208 `pending_case` branch), and the
-- assigned curator answers through the real 182 command
-- platform.respond_student_case_handoff. Proves:
--  1. the sale writes, in its own transaction, exactly one completed 088 row
--     (mode 'sales_report', the lead's gate and workflow versions, the curator
--     as admissions owner), the three 'u6.*' starter tasks with their events
--     and the audit rows (task.create x3, lead.admissions.handoff.completed) —
--     and still exactly ONE report record and no second record-creating
--     audit (134's trigger finds the record the command inserted first);
--  2. the curator can accept, ask to clarify (then accept as revision 2) and
--     decline; a decline puts the case back to pending, keeps the 088 row,
--     the sale and the report record; another curator and a replayed or
--     reused request are refused / idempotent; Lead 360's strip reports
--     acceptance_recordable = true, so the unanswered handoff is the normal
--     «ждёт ответа» (strip v1 and v2);
--  3. replay of the sale returns the same receipt and writes nothing; a second
--     sale of the same lead stays refused (PT409);
--  4. the ordinary branch (a lead without a cabinet, handoff_lead_to_admissions)
--     is unchanged: still exactly one 088 row, three tasks, one record, and the
--     new helper never runs there;
--  5. the helper refuses a case that is not the lead's own and a lead without
--     a sale record (a cabinet-before-sale case never gets a handoff row);
--  6. the backfill (restore_pending_case_sales_handoffs) restores exactly the
--     cases proven by the pipeline snapshot AND the create receipt that have no
--     088 row — shaped like production data of the pre-258 path (the real
--     command's rows with the 088 row and its tasks removed) — with the starter
--     tasks (to the case's current curator), no audit rows, the receipt's date,
--     actor and curator; a record without a receipt is not restored; the
--     second pass finds nothing; the curator can then answer;
--  7. catalog: the sale command keeps its signature, owner, SECURITY DEFINER,
--     search_path and ACL (authenticated only) and is the 215 body plus the
--     one call; the two new helpers are SECURITY DEFINER, empty search_path and
--     executable by no client role.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n258_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n258_auth_role$;

CREATE FUNCTION pg_temp.n258_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n258_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N258: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n258_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n258_id(INTEGER), pg_temp.n258_assert(BOOLEAN, TEXT),
  pg_temp.n258_message(TEXT) TO authenticated, anon, service_role;

SELECT 'N258_PENDING_CASE_HANDOFF_SUITE_START' AS n258_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Catalog: the released command keeps everything but the one call.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n258_assert(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND p.prorettype = 'jsonb'::REGTYPE AND md5(p.prosrc) = '2151ceb8f28993beefb471af86af5a0a'
     AND (length(p.prosrc) - length(replace(p.prosrc, 'platform_private.record_pending_case_sales_handoff(', '')))
       / length('platform_private.record_pending_case_sales_handoff(') = 1
     AND position('platform_private.record_pending_case_sales_handoff(' IN p.prosrc)
       > position('RETURNING * INTO sale;' IN p.prosrc)
     AND position('platform_private.record_pending_case_sales_handoff(' IN p.prosrc)
       < position('platform_private.handoff_lead_to_admissions(' IN p.prosrc)
   FROM pg_proc p WHERE p.oid = 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE),
  'create_sales_report_handoff: SECURITY DEFINER, empty search_path, owner postgres, jsonb, 215 body plus exactly one call in the pending_case branch');
SELECT pg_temp.n258_assert(has_function_privilege('authenticated', 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('supabase_auth_admin', 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE, 'EXECUTE'),
  'create_sales_report_handoff: still executable by authenticated only');
SELECT pg_temp.n258_assert(
  (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
     AND p.proname IN ('record_pending_case_sales_handoff', 'restore_pending_case_sales_handoffs')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')),
  'the two new helpers are SECURITY DEFINER, empty search_path, owner postgres and executable by no client role');

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A, the owner of every lead),
-- 3 Admissions Manager, 4 Admissions A (the curator), 6 Admissions B (another
-- curator); Students 5, 7, 8, 9, 10, 11 (the portal members of cases 1, 2, 3, 5, 6, 8:
-- a cabinet case is opened by the Student's own portal activation, and 126's
-- assignment helper, which the sale runs, requires that membership).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n258_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n258_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL),
  (7, 'student'), (8, 'student'), (9, 'student'), (10, 'student'), (11, 'student');
GRANT SELECT ON n258_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n258_id(1), 'N258 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n258_id(100 + n), 'n258-' || n || '@example.invalid', '{}'::JSONB FROM n258_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n258_id(200 + n), pg_temp.n258_id(100 + n), 'N258 Actor ' || n, 'active', 1 FROM n258_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n258_id(300 + n), pg_temp.n258_id(1), pg_temp.n258_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n258_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n258_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n258_id(401), pg_temp.n258_id(1), 'organization', pg_temp.n258_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n258_id(1), pg_temp.n258_id(301), pg_temp.n258_id(401), 1, 1, TRUE, 'system',
    'N258 synthetic organization scope', pg_temp.n258_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n258_id(901), pg_temp.n258_id(1), 'N258 Sales A'),
  (pg_temp.n258_id(902), pg_temp.n258_id(1), 'N258 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n258_id(1), pg_temp.n258_id(302), pg_temp.n258_id(901)),
  (pg_temp.n258_id(1), pg_temp.n258_id(303), pg_temp.n258_id(902)),
  (pg_temp.n258_id(1), pg_temp.n258_id(304), pg_temp.n258_id(902)),
  (pg_temp.n258_id(1), pg_temp.n258_id(306), pg_temp.n258_id(902));

-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE n258_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n258_roles VALUES
 (pg_temp.n258_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n258_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n258_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n258_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n258_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n258_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n258_grants VALUES
 (302, pg_temp.n258_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n258_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n258_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n258_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n258_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n258_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n258_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n258_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n258_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n258_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n258_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n258_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n258_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n258_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n258_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n258_id(1);
GRANT SELECT ON n258_roles, n258_grants, n258_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n258_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n258_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n258_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n258_admin_setup';
SET LOCAL ROLE authenticated;
DO $n258_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n258_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n258_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N258 ' || r.label, 'description', 'Migration 258 synthetic role',
        'permissionKeys', r.keys), 'N258 create role', pg_temp.n258_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n258_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n258_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N258 publish role', pg_temp.n258_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n258_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n258_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n258_id(1), pg_temp.n258_id(m),
      (SELECT access_version FROM n258_versions WHERE membership_id = pg_temp.n258_id(m)), items, bindings,
      'N258 grant roles', pg_temp.n258_id(2000 + m));
  END LOOP;
END
$n258_roles$;
RESET ROLE;
-- The department Sales Manager role is the 208 workflow role, as bound in production.
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.n258_id(1103);

UPDATE n258_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n258_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n258_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n258_admin FROM n258_actors WHERE n = 1 \gset
SELECT claims AS n258_sales_a FROM n258_actors WHERE n = 2 \gset
SELECT claims AS n258_admissions_manager FROM n258_actors WHERE n = 3 \gset
SELECT claims AS n258_curator_a FROM n258_actors WHERE n = 4 \gset
SELECT claims AS n258_curator_b FROM n258_actors WHERE n = 6 \gset
SELECT pg_temp.n258_assert(platform_private.staff_is_sales_manager(pg_temp.n258_id(1), pg_temp.n258_id(302))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.n258_id(1), pg_temp.n258_id(304))
  AND (SELECT count(*) = 4 FROM platform.organization_memberships
    WHERE organization_id = pg_temp.n258_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL),
  'fixture: Sales Manager A is a 208 Sales Manager, the curator is not; invited members have coarse role and bundle NULL');

-- Eight leads of Sales Manager A, all 'new' and open (the ids are fixed per number k):
--   k = 1, 2, 3, 5, 6  — a curator-less PENDING cabinet case, then a sale into it;
--   k = 4              — no cabinet: the ordinary branch (handoff_lead_to_admissions);
--   k = 7              — an active case and a report record of the pending_case shape
--                        WITHOUT a create receipt (never proven, never restored);
--   k = 8              — a pending cabinet case and NO sale (never handed off).
-- Client k = id(600 + k), lead k = id(620 + k), case k = id(510 + k), its scope
-- id(430 + k).
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, lifecycle_state)
SELECT pg_temp.n258_id(600 + k), pg_temp.n258_id(1), 'N258 Client ' || k,
  platform_private.normalize_person_name('N258 Client ' || k), 'active'
FROM generate_series(1, 8) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
SELECT pg_temp.n258_id(620 + k), pg_temp.n258_id(1), pg_temp.n258_id(600 + k), pg_temp.n258_id(302), 'new', 'other', 'open'
FROM generate_series(1, 8) AS k;
-- The sale conditions a sale is built from (the lead card saves them; 208 copies them).
INSERT INTO platform_private.lead_sale_conditions(organization_id, lead_id, fields, revision, updated_by_membership_id)
SELECT pg_temp.n258_id(1), pg_temp.n258_id(620 + k),
  jsonb_build_object('signing_date', '2026-09-22', 'service_cost_minor', 150000, 'service_cost_currency', 'USD',
    'service_cost_raw', '1500 USD', 'paid_minor', 60000, 'paid_currency', 'USD', 'paid_raw', '600 USD',
    'service_label', 'N258 synthetic service', 'payment_note', 'N258 synthetic payment'),
  1, pg_temp.n258_id(302)
FROM generate_series(1, 7) AS k;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
SELECT pg_temp.n258_id(430 + k), pg_temp.n258_id(1), 'student_case', pg_temp.n258_id(510 + k), 1
FROM unnest(ARRAY[1, 2, 3, 5, 6, 7, 8]) AS k;
-- New cases start pending with no portal data (042's insert guard); the cabinet
-- approval then activates the portal: the Student's membership and the time.
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, canonical_client_id)
SELECT pg_temp.n258_id(510 + k), pg_temp.n258_id(1), pg_temp.n258_id(302),
  'synthetic:n258:' || k, 'N258 Student ' || k, 'MY', 'Bachelor', 'contract_confirmed', 'pending',
  pg_temp.n258_id(430 + k), 1, 'new', pg_temp.n258_id(620 + k), pg_temp.n258_id(600 + k)
FROM unnest(ARRAY[1, 2, 3, 5, 6, 8]) AS k;
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases c SET student_membership_id = pg_temp.n258_id(m.student),
  portal_activated_at = TIMESTAMPTZ '2026-09-20 10:00+00'
FROM (VALUES (1, 305), (2, 307), (3, 308), (5, 309), (6, 310), (8, 311)) AS m(k, student)
WHERE c.id = pg_temp.n258_id(510 + m.k);
SET LOCAL session_replication_role = origin;
-- The Sales owner reads a pending case through its scope (the 'pending' shape of production).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
SELECT pg_temp.n258_id(1), pg_temp.n258_id(302), pg_temp.n258_id(430 + k), 1, 1, TRUE, 'system',
  'N258 synthetic Sales scope', pg_temp.n258_id(700 + k)
FROM unnest(ARRAY[1, 2, 3, 5, 6, 8]) AS k;

SELECT count(*) AS n258_org_handoffs_before FROM platform.sales_admissions_handoffs
  WHERE organization_id = pg_temp.n258_id(1) \gset
SELECT pg_temp.n258_assert(:n258_org_handoffs_before = 0 AND NOT EXISTS (SELECT 1 FROM platform_private.sales_register
    WHERE organization_id = pg_temp.n258_id(1)),
  'fixture: no handoff row and no report record before the first sale');

-- ---------------------------------------------------------------------------
-- 1. The sale into an open cabinet (lead 1, case 1): the 208 branch, as Sales A.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3001), pg_temp.n258_id(621),
  pg_temp.n258_id(304))::TEXT AS n258_sale_1 \gset
RESET ROLE;
SELECT pg_temp.n258_assert((:'n258_sale_1'::JSONB ->> 'student_case_id')::UUID = pg_temp.n258_id(511)
  AND (:'n258_sale_1'::JSONB ->> 'curator_membership_id')::UUID = pg_temp.n258_id(304)
  AND :'n258_sale_1'::JSONB ->> 'operation' = 'create',
  'the 208 branch activated THIS cabinet case for THIS curator: ' || :'n258_sale_1');
SELECT pg_temp.n258_assert((SELECT state::TEXT = 'active' AND current_curator_membership_id = pg_temp.n258_id(304)
    AND handoff_at IS NOT NULL FROM platform.student_cases WHERE id = pg_temp.n258_id(511)),
  'the case is active with the curator');
-- (a) exactly one completed 088 row, every field as the ordinary branch writes it.
SELECT pg_temp.n258_assert((SELECT count(*) = 1 FROM platform.sales_admissions_handoffs
    WHERE organization_id = pg_temp.n258_id(1) AND lead_id = pg_temp.n258_id(621)),
  'exactly one 088 row for the lead');
SELECT pg_temp.n258_assert((SELECT h.handoff_mode = 'sales_report' AND h.handoff_state = 'completed'
    AND h.handoff_source = 'canonical_sales' AND h.reason = 'Sale saved from the report'
    AND h.student_case_id = pg_temp.n258_id(511) AND h.client_id = pg_temp.n258_id(601)
    AND h.source_key = 'canonical-lead:' || pg_temp.n258_id(621)::TEXT
    AND h.actor_membership_id = pg_temp.n258_id(302) AND h.actor_profile_id = pg_temp.n258_id(202)
    AND h.admissions_owner_membership_id = pg_temp.n258_id(304)
    AND h.gate_version = (SELECT g.gate_version FROM platform.lead_admissions_gates g WHERE g.lead_id = pg_temp.n258_id(621))
    AND h.gate_state = (SELECT g.gate_state FROM platform.lead_admissions_gates g WHERE g.lead_id = pg_temp.n258_id(621))
    AND h.workflow_version = (SELECT l.workflow_version FROM platform.leads l WHERE l.id = pg_temp.n258_id(621))
    AND h.sales_context @> jsonb_build_object('lead_id', pg_temp.n258_id(621), 'stage_key', 'new',
      'current_owner_membership_id', pg_temp.n258_id(302))
    AND h.client_context = jsonb_build_object('client_id', pg_temp.n258_id(601), 'display_name', 'N258 Client 1')
    AND jsonb_typeof(h.provenance) = 'array' AND jsonb_typeof(h.conversation_links) = 'array'
   FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(621)),
  '088 row: sales_report / completed / canonical_sales, the lead''s own gate and workflow versions, the curator as owner, the same context shapes');
-- The three starter tasks with their events.
SELECT pg_temp.n258_assert((SELECT array_agg(t.source_key ORDER BY t.source_key) = ARRAY['u6.document-request-plan', 'u6.sales-context-review', 'u6.study-route-confirmation']
    AND bool_and(t.status = 'open' AND t.assignee_membership_id = pg_temp.n258_id(304) AND NOT t.student_visible
      AND t.task_type = 'admissions_starter' AND t.created_by_membership_id = pg_temp.n258_id(302))
    AND count(*) FILTER (WHERE t.priority = 'high') = 1
   FROM platform.case_tasks t WHERE t.student_case_id = pg_temp.n258_id(511)),
  'exactly the three u6 starter tasks, open, for the curator');
SELECT pg_temp.n258_assert((SELECT count(*) = 3 AND bool_and(e.previous_status IS NULL AND e.new_status = 'open'
      AND e.new_assignee_membership_id = pg_temp.n258_id(304))
    FROM platform.case_task_events e WHERE e.student_case_id = pg_temp.n258_id(511)),
  'one creation event per starter task');
-- Audit as the ordinary branch writes it.
SELECT pg_temp.n258_assert((SELECT count(*) FILTER (WHERE a.action = 'task.create') = 3
    AND count(*) FILTER (WHERE a.action = 'lead.admissions.handoff.completed') = 1
   FROM platform.audit_events a WHERE a.organization_id = pg_temp.n258_id(1)
     AND ((a.action = 'task.create' AND a.resource_id IN (SELECT t.id FROM platform.case_tasks t WHERE t.student_case_id = pg_temp.n258_id(511)))
       OR (a.action = 'lead.admissions.handoff.completed' AND a.resource_id = pg_temp.n258_id(511)))),
  'audit: task.create x3 and lead.admissions.handoff.completed x1 for the case');
SELECT pg_temp.n258_assert((SELECT a.after_state @> jsonb_build_object('handoff_mode', 'sales_report', 'handoff_state', 'completed',
      'starter_task_count', 3, 'created_case', FALSE, 'admissions_owner_membership_id', pg_temp.n258_id(304))
    AND a.actor_membership_id = pg_temp.n258_id(302)
   FROM platform.audit_events a WHERE a.action = 'lead.admissions.handoff.completed' AND a.resource_id = pg_temp.n258_id(511)),
  'the handoff audit says: sales_report, completed, three tasks, no case created, the curator');
-- One report record only: the command's, and 134's trigger wrote no second one.
SELECT pg_temp.n258_assert((SELECT count(*) = 1 FROM platform_private.sales_register r
    WHERE r.organization_id = pg_temp.n258_id(1) AND r.lead_id = pg_temp.n258_id(621)),
  'exactly one report record for the lead');
SELECT pg_temp.n258_assert((SELECT r.source_kind = 'pipeline' AND r.source_snapshot->>'activation' = 'pending_case'
    AND r.source_snapshot->>'student_case_id' = pg_temp.n258_id(511)::TEXT AND r.owner_membership_id = pg_temp.n258_id(302)
    FROM platform_private.sales_register r WHERE r.lead_id = pg_temp.n258_id(621)),
  'the one record is the command''s own (pipeline, pending_case snapshot)');
SELECT pg_temp.n258_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.n258_id(1)
      AND a.action = 'sales.register.pipeline')
  AND (SELECT count(*) = 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.n258_id(1)
      AND a.action = 'sales.register.create'),
  '134''s trigger path wrote nothing (no sales.register.pipeline audit); the command wrote its one sales.register.create');
-- Lead 360: the unanswered handoff is the normal «ждёт ответа» (acceptance can be recorded).
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n258_id(1), pg_temp.n258_id(621))::TEXT AS n258_strip1_v1 \gset
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n258_id(1), pg_temp.n258_id(621))::TEXT AS n258_strip1_v2 \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_strip1_v1'::JSONB @> jsonb_build_object('stage', 'handed_off', 'acceptance', NULL)
  AND (:'n258_strip1_v1'::JSONB #>> '{handoff,acceptance_recordable}') = 'true'
  AND (:'n258_strip1_v1'::JSONB #>> '{handoff,evidence}') IN ('handoff', 'sales_report')
  AND (:'n258_strip1_v1'::JSONB #>> '{curator,display_name}') = 'N258 Actor 4',
  'strip v1: handed off, acceptance_recordable TRUE, the curator, no answer yet: ' || :'n258_strip1_v1');
SELECT pg_temp.n258_assert((:'n258_strip1_v2'::JSONB #>> '{handoff,acceptance_recordable}') = 'true'
  AND (:'n258_strip1_v2'::JSONB -> 'acceptance') = 'null'::JSONB
  AND (:'n258_strip1_v2'::JSONB #>> '{curator,display_name}') = 'N258 Actor 4',
  'strip v2: the same: ' || :'n258_strip1_v2');
SELECT pg_temp.n258_assert((SELECT count(*) = 1 FROM platform_private.sales_lead_handoffs(pg_temp.n258_id(1), ARRAY[pg_temp.n258_id(621)])),
  'the one handoff definition counts the lead once, though it has both a 088 row and the 208 receipt');

-- (3) Replay: the same request returns the same receipt and writes nothing; a second sale is refused.
SELECT count(*) AS n258_rows_before FROM platform.audit_events WHERE organization_id = pg_temp.n258_id(1) \gset
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3001), pg_temp.n258_id(621),
  pg_temp.n258_id(304))::TEXT AS n258_sale_1_replay \gset
SELECT pg_temp.n258_message(format('SELECT platform.create_sales_report_handoff(%L::UUID, %L::UUID, %L::UUID, %L::UUID)',
  pg_temp.n258_id(1), pg_temp.n258_id(3002), pg_temp.n258_id(621), pg_temp.n258_id(304))) AS n258_second_sale \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_sale_1_replay'::JSONB = :'n258_sale_1'::JSONB,
  'replay returns the same receipt: ' || :'n258_sale_1_replay');
SELECT pg_temp.n258_assert(:'n258_second_sale' = 'PT409 sales_register_already_transferred',
  'a second sale of the lead is refused: ' || :'n258_second_sale');
SELECT pg_temp.n258_assert((SELECT count(*) = :n258_rows_before FROM platform.audit_events WHERE organization_id = pg_temp.n258_id(1))
  AND (SELECT count(*) = 1 FROM platform.sales_admissions_handoffs WHERE lead_id = pg_temp.n258_id(621))
  AND (SELECT count(*) = 3 FROM platform.case_tasks WHERE student_case_id = pg_temp.n258_id(511))
  AND (SELECT count(*) = 1 FROM platform_private.sales_register WHERE lead_id = pg_temp.n258_id(621)),
  'replay and the refused second sale write nothing');

-- ---------------------------------------------------------------------------
-- 2. The curator answers through the real 182 command (case 1: accept).
-- ---------------------------------------------------------------------------
SELECT id AS n258_assign_1 FROM platform.student_case_assignment_events
  WHERE student_case_id = pg_temp.n258_id(511) AND new_curator_membership_id = pg_temp.n258_id(304)
  ORDER BY new_scope_version DESC LIMIT 1 \gset
-- Another curator (not assigned) and the Sales owner cannot answer.
SET LOCAL request.jwt.claims TO :'n258_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n258_message(format(
  'SELECT platform.respond_student_case_handoff(%L::UUID, %L::UUID, %L::UUID, NULL, %L, NULL, NULL, %L::UUID)',
  pg_temp.n258_id(1), pg_temp.n258_id(511), :'n258_assign_1', 'accepted', pg_temp.n258_id(3101))) AS n258_other_curator \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n258_message(format(
  'SELECT platform.respond_student_case_handoff(%L::UUID, %L::UUID, %L::UUID, NULL, %L, NULL, NULL, %L::UUID)',
  pg_temp.n258_id(1), pg_temp.n258_id(511), :'n258_assign_1', 'accepted', pg_temp.n258_id(3102))) AS n258_sales_answer \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_other_curator' LIKE '42501 %' AND :'n258_sales_answer' LIKE '42501 %'
  AND NOT EXISTS (SELECT 1 FROM platform.student_case_handoff_acknowledgements WHERE student_case_id = pg_temp.n258_id(511)),
  'another curator and the Sales owner cannot answer; nothing recorded: ' || :'n258_other_curator' || ' / ' || :'n258_sales_answer');
SET LOCAL request.jwt.claims TO :'n258_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(511), :'n258_assign_1'::UUID, NULL,
  'accepted', NULL, NULL, pg_temp.n258_id(3103))::TEXT AS n258_accept_1 \gset
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(511), :'n258_assign_1'::UUID, NULL,
  'accepted', NULL, NULL, pg_temp.n258_id(3103))::TEXT AS n258_accept_1_replay \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_accept_1'::JSONB ->> 'decision' = 'accepted' AND :'n258_accept_1_replay'::JSONB = :'n258_accept_1'::JSONB,
  'the curator accepted, and the replay returned the same receipt: ' || :'n258_accept_1');
SELECT pg_temp.n258_assert((SELECT count(*) = 1 AND bool_and(a.decision = 'accepted' AND a.revision = 1
      AND a.curator_membership_id = pg_temp.n258_id(304) AND a.assignment_event_id = :'n258_assign_1'::UUID
      AND a.handoff_id = (SELECT h.id FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(621)))
    FROM platform.student_case_handoff_acknowledgements a WHERE a.student_case_id = pg_temp.n258_id(511)),
  'one acceptance row, pointing at the sale''s own 088 row');
SET LOCAL request.jwt.claims TO :'n258_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n258_id(1), pg_temp.n258_id(621))::TEXT AS n258_strip1_accepted \gset
RESET ROLE;
SELECT pg_temp.n258_assert((:'n258_strip1_accepted'::JSONB #>> '{acceptance,decision}') = 'accepted'
  AND (:'n258_strip1_accepted'::JSONB #>> '{handoff,acceptance_recordable}') = 'true',
  'Lead 360 shows the acceptance: ' || :'n258_strip1_accepted');

-- Case 2 (lead 2): clarify, then accept as revision 2.
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3011), pg_temp.n258_id(622),
  pg_temp.n258_id(304))::TEXT AS n258_sale_2 \gset
RESET ROLE;
SELECT id AS n258_assign_2 FROM platform.student_case_assignment_events
  WHERE student_case_id = pg_temp.n258_id(512) AND new_curator_membership_id = pg_temp.n258_id(304)
  ORDER BY new_scope_version DESC LIMIT 1 \gset
SET LOCAL request.jwt.claims TO :'n258_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(512), :'n258_assign_2'::UUID, NULL,
  'clarification_requested', 'N258 synthetic question about the route', NULL, pg_temp.n258_id(3111))::TEXT AS n258_clarify_2 \gset
SELECT (:'n258_clarify_2'::JSONB ->> 'acknowledgement_id') AS n258_ack_2_first \gset
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(512), :'n258_assign_2'::UUID, :'n258_ack_2_first'::UUID,
  'accepted', NULL, NULL, pg_temp.n258_id(3112))::TEXT AS n258_accept_2 \gset
RESET ROLE;
SELECT pg_temp.n258_assert((SELECT array_agg(a.decision || ':' || a.revision ORDER BY a.revision) = ARRAY['clarification_requested:1', 'accepted:2']
    FROM platform.student_case_handoff_acknowledgements a WHERE a.student_case_id = pg_temp.n258_id(512))
  AND (SELECT count(DISTINCT a.handoff_id) = 1 FROM platform.student_case_handoff_acknowledgements a WHERE a.student_case_id = pg_temp.n258_id(512)),
  'the curator asked to clarify, then accepted (revision 2), both on the same 088 row');

-- Case 3 (lead 3): decline.
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3021), pg_temp.n258_id(623),
  pg_temp.n258_id(304))::TEXT AS n258_sale_3 \gset
RESET ROLE;
SELECT id AS n258_assign_3 FROM platform.student_case_assignment_events
  WHERE student_case_id = pg_temp.n258_id(513) AND new_curator_membership_id = pg_temp.n258_id(304)
  ORDER BY new_scope_version DESC LIMIT 1 \gset
SELECT h.id AS n258_handoff_3 FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(623) \gset
SET LOCAL request.jwt.claims TO :'n258_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(513), :'n258_assign_3'::UUID, NULL,
  'declined', 'N258 synthetic decline reason', NULL, pg_temp.n258_id(3121))::TEXT AS n258_decline_3 \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_decline_3'::JSONB ->> 'decision' = 'declined'
  AND (SELECT c.state::TEXT = 'pending' AND c.current_curator_membership_id IS NULL AND c.handoff_at IS NULL
      FROM platform.student_cases c WHERE c.id = pg_temp.n258_id(513))
  AND (SELECT count(*) = 1 AND bool_and(a.decision = 'declined' AND a.handoff_id = :'n258_handoff_3'::UUID)
      FROM platform.student_case_handoff_acknowledgements a WHERE a.student_case_id = pg_temp.n258_id(513))
  AND EXISTS (SELECT 1 FROM platform.student_case_lifecycle_events e
      WHERE e.student_case_id = pg_temp.n258_id(513) AND e.event_type = 'declined' AND e.new_state = 'pending'),
  'the decline commits: the case is pending without a curator, the response points at the 088 row, the lifecycle event is written');
SELECT pg_temp.n258_assert((SELECT count(*) = 1 AND bool_and(h.id = :'n258_handoff_3'::UUID)
      FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(623))
  AND (SELECT count(*) = 1 FROM platform_private.sales_register r WHERE r.lead_id = pg_temp.n258_id(623))
  AND (SELECT count(*) = 3 FROM platform.case_tasks t WHERE t.student_case_id = pg_temp.n258_id(513)),
  'a decline keeps the handoff row, the sale''s report record and the starter tasks (plan §7: the assignment is reverted, never the sale)');
SET LOCAL request.jwt.claims TO :'n258_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n258_id(1), pg_temp.n258_id(623))::TEXT AS n258_strip3 \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_strip3'::JSONB @> jsonb_build_object('stage', 'handed_off')
  AND (:'n258_strip3'::JSONB #>> '{acceptance,decision}') = 'declined'
  AND (:'n258_strip3'::JSONB -> 'curator') = 'null'::JSONB
  AND (:'n258_strip3'::JSONB #>> '{handoff,acceptance_recordable}') = 'true',
  'Lead 360 after a decline: still «Переданы», the decline shown, no curator: ' || :'n258_strip3');

-- ---------------------------------------------------------------------------
-- 4. The ordinary branch is unchanged (lead 4: no cabinet, handoff_lead_to_admissions).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3031), pg_temp.n258_id(624),
  pg_temp.n258_id(304))::TEXT AS n258_sale_4 \gset
RESET ROLE;
SELECT pg_temp.n258_assert((SELECT count(*) = 1 AND bool_and(h.handoff_mode = 'sales_report' AND h.handoff_state = 'completed')
      FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(624))
  AND (SELECT count(*) = 3 FROM platform.case_tasks t
      WHERE t.student_case_id = (:'n258_sale_4'::JSONB ->> 'student_case_id')::UUID)
  AND (SELECT count(*) = 1 FROM platform_private.sales_register r WHERE r.lead_id = pg_temp.n258_id(624))
  AND (SELECT count(*) = 1 FROM platform.audit_events a
      WHERE a.action = 'lead.admissions.handoff.completed' AND a.resource_id = (:'n258_sale_4'::JSONB ->> 'student_case_id')::UUID)
  AND (SELECT (r.source_snapshot ? 'activation') = FALSE FROM platform_private.sales_register r WHERE r.lead_id = pg_temp.n258_id(624)),
  'ordinary branch: one 088 row, three tasks, one record (no pending_case snapshot), one handoff audit — the new helper did not run');

-- ---------------------------------------------------------------------------
-- 5. The helper refuses what is not a sale into the lead's own open case.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n258_message(format(
  'SELECT platform_private.record_pending_case_sales_handoff(%L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L, %L::UUID)',
  pg_temp.n258_id(1), pg_temp.n258_id(628), pg_temp.n258_id(518), pg_temp.n258_id(302), pg_temp.n258_id(202),
  pg_temp.n258_id(102), pg_temp.n258_id(304), 'N258 probe', pg_temp.n258_id(3201))) AS n258_no_sale \gset
SELECT pg_temp.n258_message(format(
  'SELECT platform_private.record_pending_case_sales_handoff(%L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L, %L::UUID)',
  pg_temp.n258_id(1), pg_temp.n258_id(624), pg_temp.n258_id(511), pg_temp.n258_id(302), pg_temp.n258_id(202),
  pg_temp.n258_id(102), pg_temp.n258_id(304), 'N258 probe', pg_temp.n258_id(3202))) AS n258_wrong_case \gset
SELECT pg_temp.n258_assert(:'n258_no_sale' = '22023 pending_case_handoff_requires_sale_record'
  AND :'n258_wrong_case' = '22023 pending_case_handoff_case_mismatch',
  'a cabinet-before-sale case (no record) and another lead''s case are refused: ' || :'n258_no_sale' || ' / ' || :'n258_wrong_case');
SELECT pg_temp.n258_assert(NOT EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs WHERE lead_id = pg_temp.n258_id(628))
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_register WHERE lead_id = pg_temp.n258_id(628)),
  'lead 8 (a cabinet and no sale) has no handoff row and no record');

-- ---------------------------------------------------------------------------
-- 6. The backfill. Two cases of the pre-258 path (5 and 6): the real command's
-- rows with the 088 row and its starter tasks removed, exactly the data
-- production would hold. Lead 7: a record of the pending_case shape with NO
-- create receipt — not proof, never restored.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n258_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3041), pg_temp.n258_id(625),
  pg_temp.n258_id(304))::TEXT AS n258_sale_5 \gset
SELECT platform.create_sales_report_handoff(pg_temp.n258_id(1), pg_temp.n258_id(3051), pg_temp.n258_id(626),
  pg_temp.n258_id(304))::TEXT AS n258_sale_6 \gset
RESET ROLE;
SELECT created_at AS n258_receipt_5_at FROM platform_private.sales_report_handoff_requests
  WHERE organization_id = pg_temp.n258_id(1) AND request_id = pg_temp.n258_id(3041) \gset
SET LOCAL session_replication_role = replica;
DELETE FROM platform.case_task_events WHERE student_case_id IN (pg_temp.n258_id(515), pg_temp.n258_id(516));
DELETE FROM platform.case_tasks WHERE student_case_id IN (pg_temp.n258_id(515), pg_temp.n258_id(516));
DELETE FROM platform.sales_admissions_handoffs WHERE lead_id IN (pg_temp.n258_id(625), pg_temp.n258_id(626));
-- Case 6 was reassigned to the other curator after the sale (the case's current curator is 6).
UPDATE platform.student_cases SET current_curator_membership_id = pg_temp.n258_id(306) WHERE id = pg_temp.n258_id(516);
-- Lead 7: an active case and a pending_case-shaped record, no receipt.
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, canonical_client_id)
VALUES (pg_temp.n258_id(517), pg_temp.n258_id(1), pg_temp.n258_id(302), pg_temp.n258_id(304),
  'synthetic:n258:7', 'N258 Student 7', 'MY', 'Bachelor', 'contract_confirmed', 'active', TIMESTAMPTZ '2026-09-21 10:00+00',
  pg_temp.n258_id(437), 1, 'new', pg_temp.n258_id(627), pg_temp.n258_id(607));
INSERT INTO platform_private.sales_register(organization_id, report_month, owner_membership_id, source_kind, lead_id, client_id,
  fields, source_snapshot)
VALUES (pg_temp.n258_id(1), DATE '2026-09-01', pg_temp.n258_id(302), 'pipeline', pg_temp.n258_id(627), pg_temp.n258_id(607),
  '{"applicant_name":"N258 R7","signing_date":"2026-09-22"}',
  jsonb_build_object('activation', 'pending_case', 'student_case_id', pg_temp.n258_id(517)));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.n258_assert(NOT EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs WHERE lead_id IN
      (pg_temp.n258_id(625), pg_temp.n258_id(626), pg_temp.n258_id(627)))
  AND NOT EXISTS (SELECT 1 FROM platform.case_tasks WHERE student_case_id IN (pg_temp.n258_id(515), pg_temp.n258_id(516), pg_temp.n258_id(517))),
  'fixture: the pre-258 shape — active cases, records, receipts, and no 088 row or starter task');
SELECT count(*) AS n258_audit_before_restore FROM platform.audit_events WHERE organization_id = pg_temp.n258_id(1) \gset
SELECT count(*) AS n258_handoffs_before_restore FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n258_id(1) \gset

SELECT platform_private.restore_pending_case_sales_handoffs() AS n258_restored \gset
SELECT pg_temp.n258_assert(:n258_restored = 2, 'the backfill restores exactly the two proven cases: ' || :n258_restored::TEXT);
SELECT pg_temp.n258_assert((SELECT count(*) = :n258_handoffs_before_restore + 2 FROM platform.sales_admissions_handoffs
      WHERE organization_id = pg_temp.n258_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs WHERE lead_id = pg_temp.n258_id(627)),
  'two rows written; the receipt-less record (lead 7) is not restored');
SELECT pg_temp.n258_assert((SELECT h.handoff_mode = 'sales_report' AND h.handoff_state = 'completed'
    AND h.student_case_id = pg_temp.n258_id(515) AND h.handed_off_at = :'n258_receipt_5_at'::TIMESTAMPTZ
    AND h.actor_membership_id = pg_temp.n258_id(302) AND h.actor_profile_id = pg_temp.n258_id(202)
    AND h.admissions_owner_membership_id = pg_temp.n258_id(304)
    AND h.reason = 'Sale saved from the report; handoff record restored by migration 258'
    AND h.source_key = 'canonical-lead:' || pg_temp.n258_id(625)::TEXT
   FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.n258_id(625)),
  'restored row: dated by the receipt, the receipt''s actor and curator, the restore reason');
SELECT pg_temp.n258_assert((SELECT array_agg(t.source_key ORDER BY t.source_key) = ARRAY['u6.document-request-plan', 'u6.sales-context-review', 'u6.study-route-confirmation']
    AND bool_and(t.status = 'open' AND t.assignee_membership_id = pg_temp.n258_id(304))
   FROM platform.case_tasks t WHERE t.student_case_id = pg_temp.n258_id(515))
  AND (SELECT count(*) = 3 AND bool_and(t.assignee_membership_id = pg_temp.n258_id(306) AND t.status = 'open')
   FROM platform.case_tasks t WHERE t.student_case_id = pg_temp.n258_id(516))
  AND (SELECT h.admissions_owner_membership_id = pg_temp.n258_id(304) FROM platform.sales_admissions_handoffs h
      WHERE h.lead_id = pg_temp.n258_id(626))
  AND (SELECT count(*) = 6 FROM platform.case_task_events e WHERE e.student_case_id IN (pg_temp.n258_id(515), pg_temp.n258_id(516))),
  'three open starter tasks each; the reassigned case''s tasks go to its current curator, the row keeps the receipt''s curator');
SELECT pg_temp.n258_assert((SELECT count(*) = :n258_audit_before_restore FROM platform.audit_events WHERE organization_id = pg_temp.n258_id(1)),
  'the backfill writes no audit rows (no signed-in actor)');
SELECT pg_temp.n258_assert((SELECT count(*) = 1 FROM platform_private.sales_register WHERE lead_id = pg_temp.n258_id(625))
  AND (SELECT count(*) = 1 FROM platform_private.sales_register WHERE lead_id = pg_temp.n258_id(626)),
  'the backfill creates no report record (134''s trigger finds the existing one)');
-- Idempotent: a second pass finds nothing.
SELECT platform_private.restore_pending_case_sales_handoffs() AS n258_restored_again \gset
SELECT pg_temp.n258_assert(:n258_restored_again = 0
  AND (SELECT count(*) = :n258_handoffs_before_restore + 2 FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n258_id(1))
  AND (SELECT count(*) = 3 FROM platform.case_tasks WHERE student_case_id = pg_temp.n258_id(515)),
  'a second pass restores nothing and writes nothing');
-- The curator of a restored case can now answer, and Lead 360 says it can.
SELECT id AS n258_assign_5 FROM platform.student_case_assignment_events
  WHERE student_case_id = pg_temp.n258_id(515) AND new_curator_membership_id = pg_temp.n258_id(304)
  ORDER BY new_scope_version DESC LIMIT 1 \gset
SET LOCAL request.jwt.claims TO :'n258_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.respond_student_case_handoff(pg_temp.n258_id(1), pg_temp.n258_id(515), :'n258_assign_5'::UUID, NULL,
  'accepted', NULL, NULL, pg_temp.n258_id(3141))::TEXT AS n258_accept_5 \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n258_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n258_id(1), pg_temp.n258_id(625))::TEXT AS n258_strip5 \gset
SELECT platform.staff_lead_handoff_strip_v2(pg_temp.n258_id(1), pg_temp.n258_id(627))::TEXT AS n258_strip7 \gset
RESET ROLE;
SELECT pg_temp.n258_assert(:'n258_accept_5'::JSONB ->> 'decision' = 'accepted'
  AND (:'n258_strip5'::JSONB #>> '{acceptance,decision}') = 'accepted'
  AND (:'n258_strip5'::JSONB #>> '{handoff,acceptance_recordable}') = 'true',
  'the restored case''s curator accepts; Lead 360 shows it: ' || :'n258_strip5');
-- A record of the pending_case shape without its create receipt proves nothing: no handoff, no restore.
SELECT pg_temp.n258_assert((:'n258_strip7'::JSONB -> 'handoff') = 'null'::JSONB AND (:'n258_strip7'::JSONB ->> 'stage') = 'new',
  'an unproven record (lead 7) is not a handoff for Lead 360 either: ' || :'n258_strip7');

SELECT 'N258_PENDING_CASE_HANDOFF_SUITE_OK' AS n258_suite_marker;
ROLLBACK;
