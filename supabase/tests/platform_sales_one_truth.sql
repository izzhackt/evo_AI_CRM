\set ON_ERROR_STOP on
-- Boundary suite for migration 247 (Э2 «Честные числа», решения владельца
-- 26.09.2026). Members are modelled like production after 155 and 244 (the
-- fixture of platform_access_by_permissions.sql): invited staff have
-- organization_memberships.current_role NULL and current_bundle_id NULL, so
-- current_actor_authority().platform_role is NULL; permissions come only from
-- scoped role assignments with the production permission keys. Only the
-- system Admin carries the coarse role.
--
-- The data mirrors production on 26.09: ONE lead handed off to admissions
-- (stage_key still 'new', a completed 088 handoff, its report record
-- ARCHIVED), a cabinet opened for a lead without a sale, report records in
-- and out of the archive, with and without a sale date. Two more leads cover
-- the other paths: a sale saved from the report into an already open cabinet
-- (208: no 088 row, a create receipt) and a closed lead.
--
-- Proves:
--  * the resolver truth table (sales_lead_stage) — the same table the TS
--    mirror src/lib/v3/sales-stage.ts is pinned to;
--  * the four numbers that disagreed now agree: the board (lead page +
--    staff_sales_handoff_facts, resolved like pipeline-source.ts), the funnel
--    (current_sales_funnel), Lead 360 (staff_lead_handoff_strip_v1) and the
--    period «Переданы» (completed handoffs, not linked cases) — and that the
--    old rules gave different numbers on the same data;
--  * «Продажи» = non-archived records by sale date (staff_sales_count_v1),
--    reconciled exactly with the report table of the same month;
--  * the strip's dates and evidence (088 and 208 paths, archived record,
--    curator and the curator's answer); a 208 sale's contract and payment
--    evidence comes from its record (contract number flag, paid amount);
--  * who can answer a handoff, through the real 182 RPC as the assigned
--    curator: on the 208 case every actor gate passes and the call stops at
--    182's 088 precondition (no 088 row is ever written there), and the
--    strip says 'acceptance_recordable' false instead of a pending step
--    nobody can take; on the 088 case the curator's decline is recorded
--    (or, before PR #1074's migration 249, refused only by 042's guard —
--    then the fixture writes the end state 182 intends) and the strip shows
--    that decline without a curator, the handoff still «Переданы»;
--  * read_sales_register_v3: p_sale_slice NULL is v2; each slice opens
--    exactly the records staff_sales_count_v1 names, for every actor;
--  * no widening: counts equal what the actor's own report read shows, a
--    department-scoped Sales Manager does not count or read another
--    department's records or leads, and Admissions, the Student, a caller
--    without a membership and anon are refused.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $n247_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n247_auth_role$;

CREATE FUNCTION pg_temp.n247_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n247_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N247: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n247_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n247_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.n247_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.n247_id(x) ORDER BY pg_temp.n247_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n247_id(INTEGER), pg_temp.n247_assert(BOOLEAN, TEXT),
  pg_temp.n247_error(TEXT), pg_temp.n247_message(TEXT), pg_temp.n247_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N247_SALES_ONE_TRUTH_SUITE_START' AS n247_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. The resolver truth table (the TS mirror is pinned to the same rows).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n247_assert(platform_private.sales_lead_stage(t.lifecycle::platform.lead_lifecycle_state, t.stage, t.handed)
    IS NOT DISTINCT FROM t.expected,
  'sales_lead_stage(' || t.lifecycle || ', ' || t.stage || ', ' || t.handed::TEXT || ') = ' || t.expected)
FROM (VALUES
  ('open', 'new', FALSE, 'new'),
  ('open', 'new', TRUE, 'handed_off'),
  ('open', 'qualified', FALSE, 'qualified'),
  ('open', 'potential', TRUE, 'handed_off'),
  ('disqualified', 'contacting', FALSE, 'closed'),
  ('disqualified', 'qualified', TRUE, 'closed'),
  ('converted', 'new', TRUE, 'closed'),
  ('archived', 'new', FALSE, 'closed')) AS t(lifecycle, stage, handed, expected);

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (the curator), 7 Sales Manager B (sales department B); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n247_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n247_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL);
GRANT SELECT ON n247_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n247_id(1), 'N247 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n247_id(100 + n), 'n247-' || n || '@example.invalid', '{}'::JSONB FROM n247_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n247_id(199), 'n247-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n247_id(200 + n), pg_temp.n247_id(100 + n), 'N247 Actor ' || n, 'active', 1 FROM n247_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n247_id(300 + n), pg_temp.n247_id(1), pg_temp.n247_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n247_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n247_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n247_id(401), pg_temp.n247_id(1), 'organization', pg_temp.n247_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n247_id(1), pg_temp.n247_id(301), pg_temp.n247_id(401), 1, 1, TRUE, 'system',
    'N247 synthetic organization scope', pg_temp.n247_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n247_id(901), pg_temp.n247_id(1), 'N247 Sales A'),
  (pg_temp.n247_id(902), pg_temp.n247_id(1), 'N247 Admissions'),
  (pg_temp.n247_id(903), pg_temp.n247_id(1), 'N247 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n247_id(1), pg_temp.n247_id(302), pg_temp.n247_id(901)),
  (pg_temp.n247_id(1), pg_temp.n247_id(303), pg_temp.n247_id(902)),
  (pg_temp.n247_id(1), pg_temp.n247_id(304), pg_temp.n247_id(902)),
  (pg_temp.n247_id(1), pg_temp.n247_id(307), pg_temp.n247_id(903));

-- Leads (all owned by Sales Manager A, created in September 2026):
--   702 — THE production lead: stage_key 'new', a completed 088 handoff on
--         18.09 into case 501 (curator 4, accepted 19.09), contract and first
--         payment confirmed 17.09, its report record ARCHIVED;
--   704 — 'qualified', a cabinet case 502 opened without a sale (pending);
--   706 — 'new', no case;
--   708 — closed ('disqualified'), last stage 'contacting';
--   710 — 'meeting_completed', sold from the report into the already open
--         cabinet case 503 (208: a create receipt on 23.09, no 088 row), the
--         record in September and not archived, curator 4 not answered yet.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n247_id(420 + k), pg_temp.n247_id(1), 'student_case', pg_temp.n247_id(500 + k), 1
  FROM generate_series(1, 3) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  SELECT pg_temp.n247_id(700 + k), pg_temp.n247_id(1), 'N247 Client ' || k, platform_private.normalize_person_name('N247 Client ' || k)
  FROM unnest(ARRAY[1, 3, 5, 7, 9]) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.n247_id(700 + f.k), pg_temp.n247_id(1), pg_temp.n247_id(699 + f.k), pg_temp.n247_id(302), f.stage, 'other',
  f.lifecycle::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES
  (2, 'new', 'open', '2026-09-05 10:00+06'),
  (4, 'qualified', 'open', '2026-09-06 10:00+06'),
  (6, 'new', 'open', '2026-09-07 10:00+06'),
  (8, 'contacting', 'disqualified', '2026-09-08 10:00+06'),
  (10, 'meeting_completed', 'open', '2026-09-09 10:00+06')) AS f(k, stage, lifecycle, created);
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, gate_state)
  SELECT pg_temp.n247_id(1), pg_temp.n247_id(700 + k), 'blocked' FROM unnest(ARRAY[4, 6, 8, 10]) AS k;
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, contract_confirmed, contract_confirmed_by_membership_id,
  contract_confirmed_by_profile_id, contract_confirmed_at, contract_evidence_reference, first_payment_amount,
  first_payment_currency, first_payment_due_date, first_payment_received_date, first_payment_confirmed_by_membership_id,
  first_payment_confirmed_by_profile_id, first_payment_confirmed_at, first_payment_evidence_reference, gate_state, gate_version)
VALUES (pg_temp.n247_id(1), pg_temp.n247_id(702), TRUE, pg_temp.n247_id(302), pg_temp.n247_id(202),
  '2026-09-17 11:00+06', 'N247 synthetic contract', 100, 'USD', DATE '2026-09-20', DATE '2026-09-17',
  pg_temp.n247_id(302), pg_temp.n247_id(202), '2026-09-17 12:00+06', 'N247 synthetic payment', 'satisfied', 3);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, canonical_client_id)
SELECT pg_temp.n247_id(500 + f.k), pg_temp.n247_id(1), pg_temp.n247_id(302),
  CASE WHEN f.state = 'active' THEN pg_temp.n247_id(304) END,
  'synthetic:n247:' || f.k, 'N247 Student ' || f.k, 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'active' THEN f.handoff::TIMESTAMPTZ END,
  pg_temp.n247_id(420 + f.k), 1, 'new', pg_temp.n247_id(700 + f.lead), pg_temp.n247_id(699 + f.lead)
FROM (VALUES (1, 'active', 2, '2026-09-18 11:00+06'), (2, 'pending', 4, NULL), (3, 'active', 10, '2026-09-23 09:00+06'))
  AS f(k, state, lead, handoff);
INSERT INTO platform.sales_admissions_handoffs(id, organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links, handed_off_at)
VALUES (pg_temp.n247_id(801), pg_temp.n247_id(1), pg_temp.n247_id(702), pg_temp.n247_id(701), pg_temp.n247_id(501),
  'canonical-lead:' || pg_temp.n247_id(702)::TEXT, 'normal', 'N247 synthetic handoff',
  pg_temp.n247_id(302), pg_temp.n247_id(202), pg_temp.n247_id(304), 3, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB, '2026-09-18 11:00+06');
INSERT INTO platform.student_case_assignment_events(id, organization_id, student_case_id, event_type,
  previous_curator_membership_id, new_curator_membership_id, previous_scope_id, previous_scope_version,
  new_scope_id, new_scope_version, actor_membership_id, reason, request_id, created_at)
SELECT pg_temp.n247_id(810 + f.k), pg_temp.n247_id(1), pg_temp.n247_id(500 + f.k), 'assigned', NULL, pg_temp.n247_id(304),
  pg_temp.n247_id(420 + f.k), 1, pg_temp.n247_id(430 + f.k), 2, pg_temp.n247_id(301), 'N247 synthetic assignment',
  pg_temp.n247_id(820 + f.k), f.at::TIMESTAMPTZ
FROM (VALUES (1, '2026-09-18 11:05+06'), (3, '2026-09-23 09:00+06')) AS f(k, at);
INSERT INTO platform.student_case_handoff_acknowledgements(id, organization_id, student_case_id, handoff_id,
  assignment_event_id, curator_membership_id, revision, decision, request_id, created_at)
VALUES (pg_temp.n247_id(830), pg_temp.n247_id(1), pg_temp.n247_id(501), pg_temp.n247_id(801), pg_temp.n247_id(811),
  pg_temp.n247_id(304), 1, 'accepted', pg_temp.n247_id(831), '2026-09-19 09:30+06');
-- Report records. Pipeline rows carry their lead; manual rows do not.
--   R702 pipeline, archived, sale 17.09, September            (not a sale)
--   R710 pipeline, sale 22.09, September, 208 receipt          (a sale)
--   M1 sale 05.09 Sep · M2 sale 20.09 Sep · M3 no sale date Sep ·
--   M4 sale 30.08 filed Sep · M5 sale 15.08 Aug · M6 sale 02.09 filed Aug ·
--   M7 archived sale 12.09 Sep · M8 sale 14.09 Sep, owned by Sales Manager B.
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind,
  lead_id, client_id, fields, archived, source_snapshot)
VALUES
  (pg_temp.n247_id(902 + 1000), pg_temp.n247_id(1), DATE '2026-09-01', pg_temp.n247_id(302), 'pipeline',
    pg_temp.n247_id(702), pg_temp.n247_id(701), '{"applicant_name":"N247 R702","signing_date":"2026-09-17","contract_number":"N247-C-1"}', TRUE, '{}'),
  (pg_temp.n247_id(910 + 1000), pg_temp.n247_id(1), DATE '2026-09-01', pg_temp.n247_id(302), 'pipeline',
    -- 208 copies the lead's sale conditions: a signing date and the paid
    -- amount, never a contract number (sales_register_new_snapshot).
    pg_temp.n247_id(710), pg_temp.n247_id(709),
    '{"applicant_name":"N247 R710","signing_date":"2026-09-22","contract_number":"","paid_minor":60000,"paid_currency":"USD"}', FALSE,
    jsonb_build_object('activation', 'pending_case', 'student_case_id', pg_temp.n247_id(503)));
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields, archived)
SELECT pg_temp.n247_id(1950 + f.k), pg_temp.n247_id(1), f.month::DATE, pg_temp.n247_id(f.owner), 'manual',
  jsonb_build_object('applicant_name', 'N247 M' || f.k, 'signing_date', f.sale), f.archived
FROM (VALUES
  (1, '2026-09-01', '2026-09-05', FALSE, 302), (2, '2026-09-01', '2026-09-20', FALSE, 302),
  (3, '2026-09-01', NULL, FALSE, 302), (4, '2026-09-01', '2026-08-30', FALSE, 302),
  (5, '2026-08-01', '2026-08-15', FALSE, 302), (6, '2026-08-01', '2026-09-02', FALSE, 302),
  (7, '2026-09-01', '2026-09-12', TRUE, 302), (8, '2026-09-01', '2026-09-14', FALSE, 307)) AS f(k, month, sale, archived, owner);
INSERT INTO platform_private.sales_report_handoff_requests(organization_id, request_id, actor_membership_id, fingerprint,
  receipt, created_at)
VALUES (pg_temp.n247_id(1), pg_temp.n247_id(840), pg_temp.n247_id(302), 'n247-synthetic',
  jsonb_build_object('organization_id', pg_temp.n247_id(1), 'operation', 'create', 'record_id', pg_temp.n247_id(1910),
    'version', '1', 'request_id', pg_temp.n247_id(840), 'student_case_id', pg_temp.n247_id(503),
    'curator_membership_id', pg_temp.n247_id(304), 'report_month', '2026-09-01'),
  '2026-09-23 09:00+06');
SET LOCAL session_replication_role = origin;

-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE n247_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n247_roles VALUES
 (pg_temp.n247_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n247_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n247_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n247_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n247_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n247_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n247_grants VALUES
 (302, pg_temp.n247_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n247_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n247_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n247_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n247_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n247_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n247_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n247_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n247_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n247_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n247_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n247_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n247_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n247_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n247_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n247_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n247_id(1);
GRANT SELECT ON n247_roles, n247_grants, n247_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n247_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n247_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n247_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n247_admin_setup';
SET LOCAL ROLE authenticated;
DO $n247_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n247_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n247_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N247 ' || r.label, 'description', 'Migration 247 synthetic role',
        'permissionKeys', r.keys), 'N247 create role', pg_temp.n247_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n247_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n247_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N247 publish role', pg_temp.n247_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n247_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n247_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n247_id(1), pg_temp.n247_id(m),
      (SELECT access_version FROM n247_versions WHERE membership_id = pg_temp.n247_id(m)), items, bindings,
      'N247 grant roles', pg_temp.n247_id(2000 + m));
  END LOOP;
END
$n247_roles$;
RESET ROLE;

UPDATE n247_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n247_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n247_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n247_admin FROM n247_actors WHERE n = 1 \gset
SELECT claims AS n247_sales_a FROM n247_actors WHERE n = 2 \gset
SELECT claims AS n247_admissions_manager FROM n247_actors WHERE n = 3 \gset
SELECT claims AS n247_admissions_a FROM n247_actors WHERE n = 4 \gset
SELECT claims AS n247_student FROM n247_actors WHERE n = 5 \gset
SELECT claims AS n247_sales_b FROM n247_actors WHERE n = 7 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n247_id(199),
  'claims', jsonb_build_object('sub', pg_temp.n247_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS n247_none \gset
SELECT pg_temp.n247_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n247_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n247_ids(302, 303, 304, 307))), 'invited members have coarse role and bundle NULL');

-- ---------------------------------------------------------------------------
-- Helpers, evaluated as the calling actor.
-- ---------------------------------------------------------------------------
-- The board exactly as src/lib/v3/pipeline-source.ts builds it: every page of
-- staff_sales_lead_page, then staff_sales_handoff_facts for those leads, then
-- the TS mirror of the resolver (completed ⇒ handed_off, else stage_key).
CREATE FUNCTION pg_temp.n247_board() RETURNS TABLE(lead_id UUID, stage TEXT, linked_cases BIGINT, completed_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE page_ids UUID[]; facts JSONB;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS n247_page(lead_id UUID, stage_key TEXT, linked BIGINT) ON COMMIT DROP;
  DELETE FROM n247_page;
  INSERT INTO n247_page SELECT p.lead_id, p.stage_key, p.linked_student_case_count
    FROM platform.staff_sales_lead_page(100) p WHERE p.organization_id = pg_temp.n247_id(1);
  SELECT COALESCE(array_agg(p.lead_id ORDER BY p.lead_id), ARRAY[]::UUID[]) INTO page_ids FROM n247_page p;
  facts := platform.staff_sales_handoff_facts(pg_temp.n247_id(1), page_ids);
  RETURN QUERY SELECT p.lead_id,
      CASE WHEN (f ->> 'completed')::BOOLEAN THEN 'handed_off' ELSE p.stage_key END,
      p.linked, (f ->> 'completed_at')::TIMESTAMPTZ
    FROM n247_page p JOIN jsonb_array_elements(facts -> 'leads') f ON (f ->> 'lead_id')::UUID = p.lead_id;
END
$$;
CREATE FUNCTION pg_temp.n247_funnel_count(p_funnel JSONB, p_key TEXT) RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
  SELECT (s ->> 'count')::INTEGER FROM jsonb_array_elements(p_funnel -> 'stages') s WHERE s ->> 'key' = p_key
$$;
-- The «Продажи» decomposition must equal the report table of the same month
-- for the same actor: rows filed in the month = sales of the month − sales
-- filed elsewhere + records without a sale date + records with a sale date
-- in another month.
CREATE FUNCTION pg_temp.n247_reconcile(p_label TEXT, p_sales INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE counted JSONB; report JSONB;
BEGIN
  counted := platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30');
  report := platform.read_sales_register_v2(pg_temp.n247_id(1), 2026, 9);
  PERFORM pg_temp.n247_assert((counted ->> 'sales')::INTEGER = p_sales,
    p_label || ': September sales ' || (counted ->> 'sales') || ' = ' || p_sales);
  PERFORM pg_temp.n247_assert((report ->> 'total_count')::INTEGER = (counted ->> 'sales')::INTEGER
      - (counted ->> 'filed_elsewhere')::INTEGER + (counted ->> 'undated')::INTEGER + (counted ->> 'other_sale_date')::INTEGER,
    p_label || ': the report month table ' || (report ->> 'total_count') || ' reconciles with ' || counted::TEXT);
  -- v3 without a slice is v2; each named set opens exactly its records.
  PERFORM pg_temp.n247_assert(platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9) = report,
    p_label || ': read_sales_register_v3 without a slice = v2');
  PERFORM pg_temp.n247_assert(
    (platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => s.slice) ->> 'total_count') = counted ->> s.slice,
    p_label || ': slice ' || s.slice || ' opens the ' || (counted ->> s.slice) || ' records the headline names')
  FROM (VALUES ('undated'), ('other_sale_date'), ('filed_elsewhere')) AS s(slice);
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n247_board(), pg_temp.n247_funnel_count(JSONB, TEXT),
  pg_temp.n247_reconcile(TEXT, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. The four numbers that disagreed now agree (Admin, the production view).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE n247_admin_board ON COMMIT DROP AS SELECT * FROM pg_temp.n247_board();
SELECT platform.current_sales_funnel(pg_temp.n247_id(1))::TEXT AS n247_admin_funnel \gset
RESET ROLE;
-- Board: 702 and 710 in «Переданы», 704 and 706 working, the closed 708 absent.
SELECT pg_temp.n247_assert((SELECT array_agg(lead_id ORDER BY lead_id) FROM n247_admin_board WHERE stage = 'handed_off')
  = pg_temp.n247_ids(702, 710), 'board: 702 and 710 are «Переданы»');
SELECT pg_temp.n247_assert((SELECT array_agg(lead_id || ':' || stage ORDER BY lead_id) FROM n247_admin_board WHERE stage <> 'handed_off')
  = ARRAY[pg_temp.n247_id(704) || ':qualified', pg_temp.n247_id(706) || ':new'], 'board: 704 qualified and 706 new are working');
SELECT pg_temp.n247_assert(NOT EXISTS (SELECT 1 FROM n247_admin_board WHERE lead_id = pg_temp.n247_id(708)),
  'board: the closed lead is never on the board');
-- Funnel: the same working stages and the same «Переданы» as the board.
SELECT pg_temp.n247_assert(pg_temp.n247_funnel_count(:'n247_admin_funnel'::JSONB, s.key)
    = (SELECT count(*) FROM n247_admin_board b WHERE b.stage = s.key),
  'funnel stage ' || s.key || ' = board column')
FROM (VALUES ('new'), ('contacting'), ('qualified'), ('meeting_scheduled'), ('meeting_completed'), ('potential')) AS s(key);
SELECT pg_temp.n247_assert((:'n247_admin_funnel'::JSONB ->> 'lead_count')::INTEGER = 2
  AND (:'n247_admin_funnel'::JSONB ->> 'handed_off')::INTEGER = 2
  AND (:'n247_admin_funnel'::JSONB ->> 'handed_off')::INTEGER = (SELECT count(*) FROM n247_admin_board WHERE stage = 'handed_off'),
  'funnel: 2 working = board title, 2 «Переданы» = board column');
SELECT pg_temp.n247_assert(jsonb_array_length(:'n247_admin_funnel'::JSONB -> 'stages') = 6
  AND (:'n247_admin_funnel'::JSONB -> 'sales') = '{"status": "available", "count": "0"}'::JSONB,
  'funnel keeps its six-stage shape; sales of working leads stay 0 (the only sales belong to handed-off leads)');
-- The rule it replaces (210: raw stage_key over open visible leads) said «Новый 2».
SELECT pg_temp.n247_assert((SELECT count(*) FROM platform.leads l WHERE l.organization_id = pg_temp.n247_id(1)
    AND l.lifecycle_state = 'open' AND l.stage_key = 'new') = 2
  AND pg_temp.n247_funnel_count(:'n247_admin_funnel'::JSONB, 'new') = 1,
  'the old raw stage count (2) disagreed; the funnel now says «Новый 1» like the board');
-- Lead 360: the strip's stage is the board's stage for every lead.
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(
  (platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), b.lead_id) ->> 'stage') = b.stage,
  'Lead 360 stage = board stage for ' || b.lead_id)
FROM n247_admin_board b;
SELECT pg_temp.n247_assert(
  (platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(708)) ->> 'stage') = 'closed',
  'Lead 360: the closed lead is «closed», never working');
RESET ROLE;
-- Period «Переданы» (every lead here was created in September): completed
-- handoffs = the board column; the old rule (any linked case) said 3.
SELECT pg_temp.n247_assert((SELECT count(*) FROM n247_admin_board WHERE completed_at IS NOT NULL) = 2
  AND (SELECT count(*) FROM n247_admin_board WHERE linked_cases > 0) = 3,
  'period «Переданы»: 2 completed handoffs (= board) — the old linked-case rule counted the bare cabinet (3)');
SELECT pg_temp.n247_assert((SELECT completed_at FROM n247_admin_board WHERE lead_id = pg_temp.n247_id(704)) IS NULL
  AND (SELECT linked_cases FROM n247_admin_board WHERE lead_id = pg_temp.n247_id(704)) = 1,
  'a cabinet without a sale is a linked case, not a handoff');
-- «Продажи» for September by sale date: M1, M2, R710, M6 (filed in August),
-- M8 = 5; archived R702 and M7 never count; M3 (no date) and M4 (August sale
-- filed in September) are named, not guessed.
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_reconcile('Admin', 5);
SELECT pg_temp.n247_assert(platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')
  = jsonb_build_object('organization_id', pg_temp.n247_id(1), 'from', '2026-09-01', 'to', '2026-09-30',
    'sales', '5', 'undated', '1', 'other_sale_date', '1', 'filed_elsewhere', '1'),
  'Admin September: sales 5, undated 1, other sale date 1, filed elsewhere 1');
SELECT pg_temp.n247_assert((platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-08-01', DATE '2026-08-31') ->> 'sales') = '2',
  'Admin August: M4 and M5 (by sale date, wherever filed)');
SELECT pg_temp.n247_assert((platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-17', DATE '2026-09-17') ->> 'sales') = '0',
  'the archived sale of the handed-off lead (17.09) is not a sale');
SELECT pg_temp.n247_assert((platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-22', DATE '2026-09-22') ->> 'sales') = '1',
  'the sale saved into the open cabinet (22.09) is a sale');
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-30', DATE '2026-09-01')$$) = '22023'
  AND pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2025-01-01', DATE '2026-09-01')$$) = '22023'
  AND pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), NULL, DATE '2026-09-01')$$) = '22023',
  'a reversed, overlong or open period is 22023');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Lead 360 «Передача»: dates and evidence from real rows.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))::TEXT AS n247_strip_702 \gset
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(710))::TEXT AS n247_strip_710 \gset
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(704))::TEXT AS n247_strip_704 \gset
RESET ROLE;
SELECT pg_temp.n247_assert(:'n247_strip_702'::JSONB = jsonb_build_object(
    'organization_id', pg_temp.n247_id(1), 'lead_id', pg_temp.n247_id(702), 'stage', 'handed_off',
    'handoff', jsonb_build_object('completed_at', '2026-09-18T05:00:00+00:00'::TIMESTAMPTZ, 'evidence', 'handoff',
      'acceptance_recordable', TRUE),
    'contract', jsonb_build_object('confirmed', TRUE, 'confirmed_at', '2026-09-17T05:00:00+00:00'::TIMESTAMPTZ),
    'first_payment', jsonb_build_object('received_date', '2026-09-17'),
    'report', jsonb_build_object('status', 'available', 'record', jsonb_build_object('id', pg_temp.n247_id(1902),
      'report_month', '2026-09-01', 'sale_date', '2026-09-17', 'archived', TRUE, 'has_contract_number', TRUE, 'paid', NULL)),
    'curator', jsonb_build_object('display_name', 'N247 Actor 4', 'assigned_at', '2026-09-18T05:05:00+00:00'::TIMESTAMPTZ),
    'acceptance', jsonb_build_object('decision', 'accepted', 'at', '2026-09-19T03:30:00+00:00'::TIMESTAMPTZ)),
  '702: handed off 18.09 through 088, contract and payment 17.09, the archived record, curator, accepted 19.09: ' || :'n247_strip_702');
SELECT pg_temp.n247_assert(:'n247_strip_710'::JSONB @> jsonb_build_object('stage', 'handed_off',
    'handoff', jsonb_build_object('completed_at', '2026-09-23T03:00:00+00:00'::TIMESTAMPTZ, 'evidence', 'sales_report',
      'acceptance_recordable', FALSE),
    'contract', jsonb_build_object('confirmed', FALSE, 'confirmed_at', NULL),
    'first_payment', jsonb_build_object('received_date', NULL),
    'report', jsonb_build_object('status', 'available', 'record', jsonb_build_object('sale_date', '2026-09-22', 'archived', FALSE,
      'has_contract_number', FALSE, 'paid', jsonb_build_object('minor', '60000', 'currency', 'USD'))),
    'curator', jsonb_build_object('display_name', 'N247 Actor 4'))
  AND (:'n247_strip_710'::JSONB -> 'acceptance') = 'null'::JSONB,
  '710: the 208 handoff is dated by its receipt (23.09); the gate row confirms nothing, the record carries the sale date 22.09 and 600 USD paid; curator assigned, no answer, and none can be recorded: ' || :'n247_strip_710');
SELECT pg_temp.n247_assert(:'n247_strip_704'::JSONB @> jsonb_build_object('stage', 'qualified', 'handoff', NULL,
    'report', jsonb_build_object('status', 'available', 'record', NULL), 'curator', NULL, 'acceptance', NULL),
  '704: a bare cabinet is no handoff, no curator, no record: ' || :'n247_strip_704');

-- ---------------------------------------------------------------------------
-- 3. The facts read keeps 212's contract.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(platform.staff_sales_handoff_facts(pg_temp.n247_id(1), pg_temp.n247_ids(702, 704, 706, 710))
  = jsonb_build_object('organization_id', pg_temp.n247_id(1), 'leads', jsonb_build_array(
    jsonb_build_object('lead_id', pg_temp.n247_id(702), 'completed', TRUE, 'completed_at', '2026-09-18T05:00:00+00:00'::TIMESTAMPTZ),
    jsonb_build_object('lead_id', pg_temp.n247_id(704), 'completed', FALSE, 'completed_at', NULL),
    jsonb_build_object('lead_id', pg_temp.n247_id(706), 'completed', FALSE, 'completed_at', NULL),
    jsonb_build_object('lead_id', pg_temp.n247_id(710), 'completed', TRUE, 'completed_at', '2026-09-23T03:00:00+00:00'::TIMESTAMPTZ))),
  'facts: the same payload as 212 on the same data');
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_handoff_facts(pg_temp.n247_id(1), pg_temp.n247_ids(702, 708))$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform.staff_sales_handoff_facts(pg_temp.n247_id(1), ARRAY[pg_temp.n247_id(702), pg_temp.n247_id(702)])$$) = '22023',
  'facts: a closed lead denies the batch (42501), a duplicate is 22023');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. No widening, refusals.
-- ---------------------------------------------------------------------------
-- Sales Manager A (department A): the same agreement on its own leads; the
-- count skips M8 (Sales Manager B's record) exactly like its report table.
SET LOCAL request.jwt.claims TO :'n247_sales_a';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE n247_sales_a_board ON COMMIT DROP AS SELECT * FROM pg_temp.n247_board();
SELECT platform.current_sales_funnel(pg_temp.n247_id(1))::TEXT AS n247_sales_a_funnel \gset
SELECT pg_temp.n247_reconcile('Sales Manager A', 4);
SELECT pg_temp.n247_assert(
  (platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702)) -> 'report' ->> 'status') = 'available',
  'Sales Manager A reads the record on the strip');
RESET ROLE;
SELECT pg_temp.n247_assert((SELECT array_agg(lead_id || ':' || stage ORDER BY lead_id) FROM n247_sales_a_board)
  = (SELECT array_agg(lead_id || ':' || stage ORDER BY lead_id) FROM n247_admin_board),
  'Sales Manager A sees the same board as the Admin (all leads are in department A)');
SELECT pg_temp.n247_assert(:'n247_sales_a_funnel'::JSONB - 'sales' = :'n247_admin_funnel'::JSONB - 'sales',
  'Sales Manager A: the same funnel');
-- Sales Manager B (department B): none of these leads; its own record only.
SET LOCAL request.jwt.claims TO :'n247_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))$$) = '42501',
  'Sales Manager B cannot read another department''s lead strip');
SELECT pg_temp.n247_reconcile('Sales Manager B', 1);
SELECT pg_temp.n247_assert((platform.current_sales_funnel(pg_temp.n247_id(1)) ->> 'handed_off') = '0'
  AND (platform.current_sales_funnel(pg_temp.n247_id(1)) ->> 'lead_count') = '0',
  'Sales Manager B: no leads of department A in the funnel');
RESET ROLE;
-- Admissions (no sales.register.read): no «Продажи» count; the strip works
-- exactly where lead.read reaches the lead, and never shows the record.
CREATE TEMP TABLE n247_admissions_lead_access ON COMMIT DROP AS
  SELECT l.id, platform_private.staff_can_access(l.organization_id, pg_temp.n247_id(304), 'lead.read', 'lead', l.id) AS readable
  FROM platform.leads l WHERE l.organization_id = pg_temp.n247_id(1);
GRANT SELECT ON n247_admissions_lead_access TO authenticated;
SET LOCAL request.jwt.claims TO :'n247_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')$$) = '42501',
  'Admissions A: no sales count');
SELECT pg_temp.n247_assert(
  CASE WHEN a.readable
    THEN (platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), a.id) -> 'report') = '{"status": "denied", "record": null}'::JSONB
    ELSE pg_temp.n247_error(format('SELECT platform.staff_lead_handoff_strip_v1(%L, %L)', pg_temp.n247_id(1), a.id)) = '42501' END,
  'Admissions A strip for ' || a.id || ' follows lead.read and hides the record')
FROM n247_admissions_lead_access a;
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n247_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')$$) = '42501',
  'Admissions Manager: no sales count');
RESET ROLE;
-- The Student, a caller without a membership and anon are refused everywhere.
SET LOCAL request.jwt.claims TO :'n247_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform.current_sales_funnel(pg_temp.n247_id(1))$$) = '42501',
  'the Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n247_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))$$) = '42501',
  'a caller without a membership is refused');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-09-01', DATE '2026-09-30')$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))$$) = '42501'
  AND pg_temp.n247_error($$SELECT platform_private.sales_lead_handoffs(pg_temp.n247_id(1), ARRAY[pg_temp.n247_id(702)])$$) = '42501',
  'anon cannot execute the reads or the private helpers');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(pg_temp.n247_error($$SELECT platform_private.sales_lead_stage('open', 'new', TRUE)$$) = '42501'
  AND pg_temp.n247_error($$SELECT * FROM platform_private.sales_lead_handoffs(pg_temp.n247_id(1), ARRAY[pg_temp.n247_id(702)])$$) = '42501',
  'no client role calls the private helpers directly');
RESET ROLE;

-- read_sales_register_v3 refuses what v2 refuses, and a slice over the
-- archive or an unknown slice.
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(
  pg_temp.n247_error($$SELECT platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_archived => TRUE, p_sale_slice => 'undated')$$) = '22023'
  AND pg_temp.n247_error($$SELECT platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => 'archived')$$) = '22023',
  'v3: a slice over the archive or an unknown slice is 22023');
SELECT pg_temp.n247_assert(
  (SELECT array_agg(r ->> 'applicant_name' ORDER BY r ->> 'applicant_name')
    FROM jsonb_array_elements(platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => 'filed_elsewhere') -> 'rows') r)
    = ARRAY['N247 M6']
  AND (SELECT array_agg(r ->> 'applicant_name' ORDER BY r ->> 'applicant_name')
    FROM jsonb_array_elements(platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => 'undated') -> 'rows') r)
    = ARRAY['N247 M3']
  AND (SELECT array_agg(r ->> 'applicant_name' ORDER BY r ->> 'applicant_name')
    FROM jsonb_array_elements(platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => 'other_sale_date') -> 'rows') r)
    = ARRAY['N247 M4'],
  'v3 September: filed elsewhere = M6 (August report), undated = M3, other sale date = M4');
SELECT pg_temp.n247_assert(
  (platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, NULL, p_sale_slice => 'filed_elsewhere') ->> 'total_count') = '0'
  AND (platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, NULL, p_sale_slice => 'undated') ->> 'total_count')
    = (platform.staff_sales_count_v1(pg_temp.n247_id(1), DATE '2026-01-01', DATE '2026-12-31') ->> 'undated'),
  'v3 whole year: nothing is filed outside the year; undated = the year count');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n247_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_assert(
  pg_temp.n247_error($$SELECT platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9, p_sale_slice => 'undated')$$) = '42501',
  'Admissions A: no report read through v3');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n247_assert(
  pg_temp.n247_error($$SELECT platform.read_sales_register_v3(pg_temp.n247_id(1), 2026, 9)$$) = '42501',
  'anon cannot execute read_sales_register_v3');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Who can answer a handoff — through the real 182 RPC as the curator.
-- ---------------------------------------------------------------------------
-- 208 (lead 710, case 503): every actor gate of respond_student_case_handoff
-- passes and it stops at its 088 precondition, so no answer can ever be
-- recorded for this case; the strip reports it instead of «ждёт ответа».
SET LOCAL request.jwt.claims TO :'n247_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_message(format(
  'SELECT platform.respond_student_case_handoff(%L::UUID, %L::UUID, %L::UUID, NULL, %L, NULL, NULL, %L::UUID)',
  pg_temp.n247_id(1), pg_temp.n247_id(503), pg_temp.n247_id(813), 'accepted', pg_temp.n247_id(850))) AS n247_answer_208 \gset
RESET ROLE;
SELECT pg_temp.n247_assert(:'n247_answer_208' = '42501 Completed handoff is required',
  '208: the assigned curator cannot record an answer (182 needs a 088 row): ' || :'n247_answer_208');
SELECT pg_temp.n247_assert(NOT EXISTS (SELECT 1 FROM platform.student_case_handoff_acknowledgements
    WHERE student_case_id = pg_temp.n247_id(503))
  AND (:'n247_strip_710'::JSONB #>> '{handoff,acceptance_recordable}') = 'false',
  '208: no answer row, and the strip says it cannot be recorded');
-- 088 (lead 702, case 501): the same curator declines through the same RPC.
-- 182 then reverts the case to 'pending' and clears handoff_at and the
-- curator; the strip keeps the handoff («Переданы») and shows the decline
-- without a curator. Until 042's guard admits that UPDATE (PR #1074,
-- migration 249) it refuses it with 55000 and nothing changes; then the
-- fixture writes the end state 182 intends (triggers bypassed for the
-- fixture only). Either way the strip read is proven. Rolled back.
SAVEPOINT n247_decline;
SET LOCAL request.jwt.claims TO :'n247_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n247_message(format(
  'SELECT platform.respond_student_case_handoff(%L::UUID, %L::UUID, %L::UUID, %L::UUID, %L, %L, NULL, %L::UUID)',
  pg_temp.n247_id(1), pg_temp.n247_id(501), pg_temp.n247_id(811), pg_temp.n247_id(830), 'declined',
  'N247 synthetic decline reason', pg_temp.n247_id(851))) AS n247_decline_088 \gset
RESET ROLE;
SELECT pg_temp.n247_assert(:'n247_decline_088' IN ('ok', '55000 First student-case handoff timestamp is immutable'),
  '088: the curator''s decline is recorded, or refused only by 042''s guard: ' || :'n247_decline_088');
SELECT (:'n247_decline_088' <> 'ok') AS n247_decline_refused \gset
\if :n247_decline_refused
SELECT pg_temp.n247_assert((SELECT state::TEXT FROM platform.student_cases WHERE id = pg_temp.n247_id(501)) = 'active',
  '088: the refused decline changed nothing');
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_case_handoff_acknowledgements(id, organization_id, student_case_id, handoff_id,
  assignment_event_id, curator_membership_id, revision, decision, clarification, request_id, created_at)
VALUES (pg_temp.n247_id(832), pg_temp.n247_id(1), pg_temp.n247_id(501), pg_temp.n247_id(801), pg_temp.n247_id(811),
  pg_temp.n247_id(304), 2, 'declined', 'N247 synthetic decline reason', pg_temp.n247_id(833), '2026-09-20 10:00+06');
UPDATE platform.student_cases SET state = 'pending', current_curator_membership_id = NULL, handoff_at = NULL
WHERE id = pg_temp.n247_id(501);
SET LOCAL session_replication_role = origin;
\endif
SET LOCAL request.jwt.claims TO :'n247_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_lead_handoff_strip_v1(pg_temp.n247_id(1), pg_temp.n247_id(702))::TEXT AS n247_strip_declined \gset
RESET ROLE;
SELECT pg_temp.n247_assert(:'n247_strip_declined'::JSONB @> jsonb_build_object('stage', 'handed_off',
    'handoff', jsonb_build_object('completed_at', '2026-09-18T05:00:00+00:00'::TIMESTAMPTZ, 'evidence', 'handoff',
      'acceptance_recordable', TRUE),
    'acceptance', jsonb_build_object('decision', 'declined'))
  AND (:'n247_strip_declined'::JSONB #>> '{acceptance,at}') IS NOT NULL
  AND (:'n247_strip_declined'::JSONB -> 'curator') = 'null'::JSONB
  AND (SELECT state::TEXT FROM platform.student_cases WHERE id = pg_temp.n247_id(501)) = 'pending',
  'declined: still «Переданы», no curator, the decline shown with its time: ' || :'n247_strip_declined');
ROLLBACK TO SAVEPOINT n247_decline;
SELECT pg_temp.n247_assert((SELECT state::TEXT FROM platform.student_cases WHERE id = pg_temp.n247_id(501)) = 'active',
  'the decline probe is rolled back');

SELECT 'N247_SALES_ONE_TRUTH_SUITE_OK' AS n247_suite_marker;
ROLLBACK;
