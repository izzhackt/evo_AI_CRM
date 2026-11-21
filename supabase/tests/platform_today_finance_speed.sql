-- Boundary suite for migration 367 («Скорость Сегодня и Финансов»). Две проверки границы доступа:
--  1. platform.staff_sales_handoff_facts после 367 (проверка lead.read множеством 310) выдаёт ровно то же, что её прежнее тело
--     247 с построчной platform_private.staff_can_access: на одних данных, для каждого участника и нескольких наборов лидов
--     выдача (jsonb) и ошибки (SQLSTATE и текст) равны; множество staff_visible_ids_v1 равно построчному решению, в том числе
--     на подмножествах, чужих и несуществующих id. Прежнее тело вставлено как pg_temp.t367_old_handoff_facts.
--  2. platform.staff_task_lead_refs_v1 отдаёт для списка задач ровно то, что отдали бы две прежние функции на каждую задачу
--     (staff_task_context, затем staff_task_lead_context) под тем же сотрудником; задача, которую он не читает, или лид, которого
--     он не читает, не попадают в ответ и не раскрывают имя клиента; вход вне границ это 22023; студент, аноним и вызов без
--     входа ничего не получают; права функции: EXECUTE только у authenticated.
-- Изолированные синтетические данные; транзакция заканчивается ROLLBACK.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t367_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t367_auth_role$;

CREATE FUNCTION pg_temp.t367_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t367_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T367: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.t367_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.t367_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.t367_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.t367_id(x) ORDER BY pg_temp.t367_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t367_id(INTEGER), pg_temp.t367_assert(BOOLEAN, TEXT),
  pg_temp.t367_error(TEXT), pg_temp.t367_message(TEXT), pg_temp.t367_ids(INTEGER[])
  TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (the curator), 7 Sales Manager B (sales department B); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t367_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO t367_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL);
GRANT SELECT ON t367_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t367_id(1), 'T367 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t367_id(100 + n), 't367-' || n || '@example.invalid', '{}'::JSONB FROM t367_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.t367_id(199), 't367-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t367_id(200 + n), pg_temp.t367_id(100 + n), 'T367 Actor ' || n, 'active', 1 FROM t367_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t367_id(300 + n), pg_temp.t367_id(1), pg_temp.t367_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t367_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.t367_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.t367_id(401), pg_temp.t367_id(1), 'organization', pg_temp.t367_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.t367_id(1), pg_temp.t367_id(301), pg_temp.t367_id(401), 1, 1, TRUE, 'system',
    'T367 synthetic organization scope', pg_temp.t367_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t367_id(901), pg_temp.t367_id(1), 'T367 Sales A'),
  (pg_temp.t367_id(902), pg_temp.t367_id(1), 'T367 Admissions'),
  (pg_temp.t367_id(903), pg_temp.t367_id(1), 'T367 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t367_id(1), pg_temp.t367_id(302), pg_temp.t367_id(901)),
  (pg_temp.t367_id(1), pg_temp.t367_id(303), pg_temp.t367_id(902)),
  (pg_temp.t367_id(1), pg_temp.t367_id(304), pg_temp.t367_id(902)),
  (pg_temp.t367_id(1), pg_temp.t367_id(307), pg_temp.t367_id(903));

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
  SELECT pg_temp.t367_id(420 + k), pg_temp.t367_id(1), 'student_case', pg_temp.t367_id(500 + k), 1
  FROM generate_series(1, 3) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  SELECT pg_temp.t367_id(700 + k), pg_temp.t367_id(1), 'T367 Client ' || k, platform_private.normalize_person_name('T367 Client ' || k)
  FROM unnest(ARRAY[1, 3, 5, 7, 9]) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.t367_id(700 + f.k), pg_temp.t367_id(1), pg_temp.t367_id(699 + f.k), pg_temp.t367_id(302), f.stage, 'other',
  f.lifecycle::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES
  (2, 'new', 'open', '2026-09-05 10:00+06'),
  (4, 'qualified', 'open', '2026-09-06 10:00+06'),
  (6, 'new', 'open', '2026-09-07 10:00+06'),
  (8, 'contacting', 'disqualified', '2026-09-08 10:00+06'),
  (10, 'meeting_completed', 'open', '2026-09-09 10:00+06')) AS f(k, stage, lifecycle, created);
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, gate_state)
  SELECT pg_temp.t367_id(1), pg_temp.t367_id(700 + k), 'blocked' FROM unnest(ARRAY[4, 6, 8, 10]) AS k;
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, contract_confirmed, contract_confirmed_by_membership_id,
  contract_confirmed_by_profile_id, contract_confirmed_at, contract_evidence_reference, first_payment_amount,
  first_payment_currency, first_payment_due_date, first_payment_received_date, first_payment_confirmed_by_membership_id,
  first_payment_confirmed_by_profile_id, first_payment_confirmed_at, first_payment_evidence_reference, gate_state, gate_version)
VALUES (pg_temp.t367_id(1), pg_temp.t367_id(702), TRUE, pg_temp.t367_id(302), pg_temp.t367_id(202),
  '2026-09-17 11:00+06', 'T367 synthetic contract', 100, 'USD', DATE '2026-09-20', DATE '2026-09-17',
  pg_temp.t367_id(302), pg_temp.t367_id(202), '2026-09-17 12:00+06', 'T367 synthetic payment', 'satisfied', 3);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, canonical_client_id)
SELECT pg_temp.t367_id(500 + f.k), pg_temp.t367_id(1), pg_temp.t367_id(302),
  CASE WHEN f.state = 'active' THEN pg_temp.t367_id(304) END,
  'synthetic:t367:' || f.k, 'T367 Student ' || f.k, 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'active' THEN f.handoff::TIMESTAMPTZ END,
  pg_temp.t367_id(420 + f.k), 1, 'new', pg_temp.t367_id(700 + f.lead), pg_temp.t367_id(699 + f.lead)
FROM (VALUES (1, 'active', 2, '2026-09-18 11:00+06'), (2, 'pending', 4, NULL), (3, 'active', 10, '2026-09-23 09:00+06'))
  AS f(k, state, lead, handoff);
INSERT INTO platform.sales_admissions_handoffs(id, organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links, handed_off_at)
VALUES (pg_temp.t367_id(801), pg_temp.t367_id(1), pg_temp.t367_id(702), pg_temp.t367_id(701), pg_temp.t367_id(501),
  'canonical-lead:' || pg_temp.t367_id(702)::TEXT, 'normal', 'T367 synthetic handoff',
  pg_temp.t367_id(302), pg_temp.t367_id(202), pg_temp.t367_id(304), 3, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB, '2026-09-18 11:00+06');
INSERT INTO platform.student_case_assignment_events(id, organization_id, student_case_id, event_type,
  previous_curator_membership_id, new_curator_membership_id, previous_scope_id, previous_scope_version,
  new_scope_id, new_scope_version, actor_membership_id, reason, request_id, created_at)
SELECT pg_temp.t367_id(810 + f.k), pg_temp.t367_id(1), pg_temp.t367_id(500 + f.k), 'assigned', NULL, pg_temp.t367_id(304),
  pg_temp.t367_id(420 + f.k), 1, pg_temp.t367_id(430 + f.k), 2, pg_temp.t367_id(301), 'T367 synthetic assignment',
  pg_temp.t367_id(820 + f.k), f.at::TIMESTAMPTZ
FROM (VALUES (1, '2026-09-18 11:05+06'), (3, '2026-09-23 09:00+06')) AS f(k, at);
INSERT INTO platform.student_case_handoff_acknowledgements(id, organization_id, student_case_id, handoff_id,
  assignment_event_id, curator_membership_id, revision, decision, request_id, created_at)
VALUES (pg_temp.t367_id(830), pg_temp.t367_id(1), pg_temp.t367_id(501), pg_temp.t367_id(801), pg_temp.t367_id(811),
  pg_temp.t367_id(304), 1, 'accepted', pg_temp.t367_id(831), '2026-09-19 09:30+06');
-- Report records. Pipeline rows carry their lead; manual rows do not.
--   R702 pipeline, archived, sale 17.09, September            (not a sale)
--   R710 pipeline, sale 22.09, September, 208 receipt          (a sale)
--   M1 sale 05.09 Sep · M2 sale 20.09 Sep · M3 no sale date Sep ·
--   M4 sale 30.08 filed Sep · M5 sale 15.08 Aug · M6 sale 02.09 filed Aug ·
--   M7 archived sale 12.09 Sep · M8 sale 14.09 Sep, owned by Sales Manager B.
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind,
  lead_id, client_id, fields, archived, source_snapshot)
VALUES
  (pg_temp.t367_id(902 + 1000), pg_temp.t367_id(1), DATE '2026-09-01', pg_temp.t367_id(302), 'pipeline',
    pg_temp.t367_id(702), pg_temp.t367_id(701), '{"applicant_name":"T367 R702","signing_date":"2026-09-17","contract_number":"T367-C-1"}', TRUE, '{}'),
  (pg_temp.t367_id(910 + 1000), pg_temp.t367_id(1), DATE '2026-09-01', pg_temp.t367_id(302), 'pipeline',
    -- 208 copies the lead's sale conditions: a signing date and the paid
    -- amount, never a contract number (sales_register_new_snapshot).
    pg_temp.t367_id(710), pg_temp.t367_id(709),
    '{"applicant_name":"T367 R710","signing_date":"2026-09-22","contract_number":"","paid_minor":60000,"paid_currency":"USD"}', FALSE,
    jsonb_build_object('activation', 'pending_case', 'student_case_id', pg_temp.t367_id(503)));
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields, archived)
SELECT pg_temp.t367_id(1950 + f.k), pg_temp.t367_id(1), f.month::DATE, pg_temp.t367_id(f.owner), 'manual',
  jsonb_build_object('applicant_name', 'T367 M' || f.k, 'signing_date', f.sale), f.archived
FROM (VALUES
  (1, '2026-09-01', '2026-09-05', FALSE, 302), (2, '2026-09-01', '2026-09-20', FALSE, 302),
  (3, '2026-09-01', NULL, FALSE, 302), (4, '2026-09-01', '2026-08-30', FALSE, 302),
  (5, '2026-08-01', '2026-08-15', FALSE, 302), (6, '2026-08-01', '2026-09-02', FALSE, 302),
  (7, '2026-09-01', '2026-09-12', TRUE, 302), (8, '2026-09-01', '2026-09-14', FALSE, 307)) AS f(k, month, sale, archived, owner);
INSERT INTO platform_private.sales_report_handoff_requests(organization_id, request_id, actor_membership_id, fingerprint,
  receipt, created_at)
VALUES (pg_temp.t367_id(1), pg_temp.t367_id(840), pg_temp.t367_id(302), 't367-synthetic',
  jsonb_build_object('organization_id', pg_temp.t367_id(1), 'operation', 'create', 'record_id', pg_temp.t367_id(1910),
    'version', '1', 'request_id', pg_temp.t367_id(840), 'student_case_id', pg_temp.t367_id(503),
    'curator_membership_id', pg_temp.t367_id(304), 'report_month', '2026-09-01'),
  '2026-09-23 09:00+06');
SET LOCAL session_replication_role = origin;

-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE t367_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO t367_roles VALUES
 (pg_temp.t367_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.t367_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.t367_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.t367_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.t367_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE t367_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO t367_grants VALUES
 (302, pg_temp.t367_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.t367_id(901), 'resourceKind', NULL)),
 (302, pg_temp.t367_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t367_id(1), 'resourceKind', NULL)),
 (303, pg_temp.t367_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.t367_id(902), 'resourceKind', NULL)),
 (303, pg_temp.t367_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t367_id(1), 'resourceKind', NULL)),
 (304, pg_temp.t367_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.t367_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t367_id(1), 'resourceKind', NULL)),
 (307, pg_temp.t367_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.t367_id(903), 'resourceKind', NULL)),
 (307, pg_temp.t367_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t367_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE t367_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.t367_id(1);
GRANT SELECT ON t367_roles, t367_grants, t367_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t367_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t367_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t367_admin_setup \gset
SET LOCAL request.jwt.claims TO :'t367_admin_setup';
SET LOCAL ROLE authenticated;
DO $t367_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM t367_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.t367_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'T367 ' || r.label, 'description', 'Migration 247 synthetic role',
        'permissionKeys', r.keys), 'T367 create role', pg_temp.t367_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.t367_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.t367_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'T367 publish role', pg_temp.t367_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM t367_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM t367_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.t367_id(1), pg_temp.t367_id(m),
      (SELECT access_version FROM t367_versions WHERE membership_id = pg_temp.t367_id(m)), items, bindings,
      'T367 grant roles', pg_temp.t367_id(2000 + m));
  END LOOP;
END
$t367_roles$;
RESET ROLE;

UPDATE t367_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.t367_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.t367_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS t367_admin FROM t367_actors WHERE n = 1 \gset
SELECT claims AS t367_sales_a FROM t367_actors WHERE n = 2 \gset
SELECT claims AS t367_admissions_manager FROM t367_actors WHERE n = 3 \gset
SELECT claims AS t367_admissions_a FROM t367_actors WHERE n = 4 \gset
SELECT claims AS t367_student FROM t367_actors WHERE n = 5 \gset
SELECT claims AS t367_sales_b FROM t367_actors WHERE n = 7 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t367_id(199),
  'claims', jsonb_build_object('sub', pg_temp.t367_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS t367_none \gset
SELECT pg_temp.t367_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.t367_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.t367_ids(302, 303, 304, 307))), 'invited members have coarse role and bundle NULL');

-- Old body of platform.staff_sales_handoff_facts (migration 247), verbatim, under another name.
CREATE FUNCTION pg_temp.t367_old_handoff_facts(p_organization_id UUID, p_lead_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  visible_count BIGINT;
  facts JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) > 4000
    OR EXISTS (SELECT 1 FROM unnest(p_lead_ids) id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_lead_ids) id) <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_invalid' USING ERRCODE = '22023';
  END IF;

  WITH visible_leads AS MATERIALIZED (
    SELECT l.id FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids)
      AND l.lifecycle_state = 'open'
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
  ), handoffs AS MATERIALIZED (
    SELECT h.lead_id, h.completed_at
    FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY(SELECT v.id FROM visible_leads v)) h
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
    'lead_id', l.id, 'completed', h.completed_at IS NOT NULL,
    'completed_at', h.completed_at) ORDER BY l.id), '[]'::JSONB)
  INTO visible_count, facts
  FROM visible_leads l LEFT JOIN handoffs h ON h.lead_id = l.id;

  -- Missing, closed and inaccessible IDs all deny the complete batch. Never
  -- turn an omitted record into a false "not handed off" result.
  IF visible_count <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  -- JSON avoids PostgREST's row cap silently clipping a board-sized batch.
  RETURN jsonb_build_object('organization_id', p_organization_id, 'leads', facts);
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t367_old_handoff_facts(UUID, UUID[]) TO authenticated, anon, service_role;

SELECT 'A367_TODAY_FINANCE_SPEED_SUITE_START' AS a367_suite_marker;

-- The statement as another identity (claims and role are local to the transaction); a stable text answer:
-- the statement's value, or 'ERR SQLSTATE:message'.
CREATE FUNCTION pg_temp.t367_run(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
  BEGIN
    EXECUTE p_sql INTO answer;
  EXCEPTION WHEN OTHERS THEN answer := 'ERR ' || SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;

-- The participants: name, claims, membership number (NULL = no membership).
CREATE TEMP TABLE t367_who(label TEXT, claims TEXT, n INTEGER);
INSERT INTO t367_who
  SELECT 'admin', :'t367_admin', 1 UNION ALL SELECT 'sales A', :'t367_sales_a', 2 UNION ALL
  SELECT 'admissions manager', :'t367_admissions_manager', 3 UNION ALL SELECT 'admissions A', :'t367_admissions_a', 4 UNION ALL
  SELECT 'student', :'t367_student', 5 UNION ALL SELECT 'sales B', :'t367_sales_b', 7 UNION ALL
  SELECT 'no membership', :'t367_none', NULL;

-- ---------------------------------------------------------------------------
-- 1. staff_sales_handoff_facts: the 310 set replaces the per-row check; answers equal the 247 body.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t367_sets(label TEXT, ids UUID[]);
INSERT INTO t367_sets VALUES
  ('all visible-looking leads', pg_temp.t367_ids(702, 704, 706, 710)),
  ('one lead', pg_temp.t367_ids(702)),
  ('with the closed lead', pg_temp.t367_ids(702, 708)),
  ('with a missing id', ARRAY[pg_temp.t367_id(702), pg_temp.t367_id(999)]),
  ('empty', ARRAY[]::UUID[]),
  ('duplicate id', ARRAY[pg_temp.t367_id(702), pg_temp.t367_id(702)]),
  ('null element', ARRAY[pg_temp.t367_id(702), NULL]::UUID[]),
  ('null array', NULL);

DO $t367_facts$
DECLARE w RECORD; s RECORD; new_answer TEXT; old_answer TEXT; distinct_answers TEXT[] := ARRAY[]::TEXT[]; ok_count INTEGER := 0;
BEGIN
  FOR w IN SELECT * FROM t367_who LOOP
    FOR s IN SELECT * FROM t367_sets LOOP
      new_answer := pg_temp.t367_run(w.claims, 'authenticated', format(
        'SELECT platform.staff_sales_handoff_facts(%L, %L)::JSONB::TEXT', pg_temp.t367_id(1), s.ids));
      old_answer := pg_temp.t367_run(w.claims, 'authenticated', format(
        'SELECT pg_temp.t367_old_handoff_facts(%L, %L)::JSONB::TEXT', pg_temp.t367_id(1), s.ids));
      PERFORM pg_temp.t367_assert(new_answer IS NOT DISTINCT FROM old_answer,
        format('handoff facts differ for %s / %s: new=%s old=%s', w.label, s.label, new_answer, old_answer));
      IF new_answer NOT LIKE 'ERR %' THEN ok_count := ok_count + 1; END IF;
      distinct_answers := distinct_answers || (w.label || '|' || s.label || '|' || left(md5(new_answer), 6));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t367_assert(ok_count >= 6, 'the comparison is not vacuous: some actors read facts (' || ok_count || ')');
END
$t367_facts$;
-- Concrete expectations on top of the oracle.
SELECT pg_temp.t367_assert(
  pg_temp.t367_run(:'t367_sales_a', 'authenticated', format('SELECT jsonb_array_length(platform.staff_sales_handoff_facts(%L, %L) -> ''leads'')::TEXT',
    pg_temp.t367_id(1), pg_temp.t367_ids(702, 704, 706, 710))) = '4'
  AND pg_temp.t367_run(:'t367_sales_b', 'authenticated', format('SELECT platform.staff_sales_handoff_facts(%L, %L)::TEXT',
    pg_temp.t367_id(1), pg_temp.t367_ids(702))) LIKE 'ERR 42501:%'
  AND pg_temp.t367_run(:'t367_student', 'authenticated', format('SELECT platform.staff_sales_handoff_facts(%L, %L)::TEXT',
    pg_temp.t367_id(1), pg_temp.t367_ids(702))) LIKE 'ERR 42501:%'
  AND pg_temp.t367_run(:'t367_sales_a', 'authenticated', format('SELECT platform.staff_sales_handoff_facts(%L, %L)::TEXT',
    pg_temp.t367_id(1), pg_temp.t367_ids(702, 708))) LIKE 'ERR 42501:%',
  'sales A reads its own leads, sales B / the student / a closed lead are refused');

-- The set equals the per-row decision (the 310 mirror), also on subsets, foreign and missing ids.
DO $t367_set$
DECLARE w RECORD; s RECORD; per_row UUID[]; as_set UUID[];
BEGIN
  FOR w IN SELECT * FROM t367_who WHERE n IS NOT NULL LOOP
    FOR s IN SELECT * FROM (VALUES
      (NULL::UUID[]),
      (pg_temp.t367_ids(702, 704, 706, 708, 710)),
      (ARRAY[pg_temp.t367_id(702), pg_temp.t367_id(999)]),
      (ARRAY[]::UUID[])) AS v(ids) LOOP
      SELECT COALESCE(array_agg(l.id ORDER BY l.id), ARRAY[]::UUID[]) INTO per_row
      FROM platform.leads l
      WHERE l.organization_id = pg_temp.t367_id(1) AND (s.ids IS NULL OR l.id = ANY (s.ids))
        AND platform_private.staff_can_access(pg_temp.t367_id(1), pg_temp.t367_id(300 + w.n), 'lead.read', 'lead', l.id);
      SELECT COALESCE(array_agg(v.id ORDER BY v.id), ARRAY[]::UUID[]) INTO as_set
      FROM platform_private.staff_visible_ids_v1(pg_temp.t367_id(1), pg_temp.t367_id(300 + w.n), 'lead.read', 'lead', s.ids) AS v(id);
      PERFORM pg_temp.t367_assert(per_row = as_set, format('lead.read set differs from the per-row check for %s', w.label));
    END LOOP;
  END LOOP;
END
$t367_set$;

-- ---------------------------------------------------------------------------
-- 2. staff_task_lead_refs_v1 equals the two per-task reads.
-- Tasks (title as the telephony migration 298 writes it):
--   801 sales A for sales A, lead 702 (sales A's own lead)          811 sales A -> admissions A, lead 704
--   812 sales A for sales A, no lead                                 813 sales B for sales B, lead 706 (a lead sales B cannot read)
--   814 admissions manager for admissions manager, closed lead 708
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title)
SELECT pg_temp.t367_id(f.task), pg_temp.t367_id(1), pg_temp.t367_id(f.creator), pg_temp.t367_id(f.assignee), 'Перезвонить клиенту'
FROM (VALUES (1801, 302, 302), (1811, 302, 304), (1812, 302, 302), (1813, 307, 307), (1814, 303, 303)) AS f(task, creator, assignee);
INSERT INTO platform_private.staff_lead_task_links(request_id, organization_id, actor_membership_id, staff_task_id, lead_id, input, result)
SELECT pg_temp.t367_id(1900 + f.k), pg_temp.t367_id(1), pg_temp.t367_id(f.actor), pg_temp.t367_id(f.task), pg_temp.t367_id(f.lead),
  '{}'::JSONB, '{}'::JSONB
FROM (VALUES (1, 302, 1801, 702), (2, 302, 1811, 704), (3, 307, 1813, 706), (4, 303, 1814, 708)) AS f(k, actor, task, lead);
SET LOCAL session_replication_role = origin;

-- What the page did before: two reads per task under the employee's session, any failure = no entry.
CREATE FUNCTION pg_temp.t367_refs_old(p_claims TEXT, p_ids UUID[]) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE t UUID; context JSONB; lead JSONB; refs JSONB := '[]'::JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH t IN ARRAY p_ids LOOP
    BEGIN
      context := platform.staff_task_context(pg_temp.t367_id(1), t);
      CONTINUE WHEN context ->> 'lead_id' IS NULL;
      lead := platform.staff_task_lead_context(pg_temp.t367_id(1), (context ->> 'lead_id')::UUID);
      refs := refs || jsonb_build_array(jsonb_build_object('task_id', t, 'lead_id', lead ->> 'lead_id', 'client_name', lead ->> 'client_name'));
    EXCEPTION WHEN OTHERS THEN CONTINUE;
    END;
  END LOOP;
  RESET ROLE;
  RETURN refs::TEXT;
END
$$;

CREATE TEMP TABLE t367_task_sets(label TEXT, ids UUID[]);
INSERT INTO t367_task_sets VALUES
  ('all tasks', pg_temp.t367_ids(1801, 1811, 1812, 1813, 1814)),
  ('single', pg_temp.t367_ids(1801)),
  ('with a missing task', ARRAY[pg_temp.t367_id(1801), pg_temp.t367_id(1999)]),
  ('empty', ARRAY[]::UUID[]);
CREATE TEMP TABLE t367_seen(label TEXT, refs INTEGER);

DO $t367_refs$
DECLARE w RECORD; s RECORD; batch TEXT; old_refs TEXT;
BEGIN
  FOR w IN SELECT * FROM t367_who LOOP
    FOR s IN SELECT * FROM t367_task_sets LOOP
      batch := pg_temp.t367_run(w.claims, 'authenticated', format(
        'SELECT (platform.staff_task_lead_refs_v1(%L, %L) -> ''refs'')::TEXT', pg_temp.t367_id(1), s.ids));
      old_refs := pg_temp.t367_refs_old(w.claims, s.ids);
      PERFORM pg_temp.t367_assert(batch::JSONB = old_refs::JSONB, format('lead refs differ for %s / %s: batch=%s old=%s', w.label, s.label, batch, old_refs));
      IF s.label = 'all tasks' THEN INSERT INTO t367_seen VALUES (w.label, jsonb_array_length(batch::JSONB)); END IF;
    END LOOP;
  END LOOP;
END
$t367_refs$;
-- Not vacuous, and no private data for the wrong person.
SELECT pg_temp.t367_assert(
  (SELECT refs FROM t367_seen WHERE label = 'sales A') = 2
  AND (SELECT refs FROM t367_seen WHERE label = 'sales B') = 0
  AND (SELECT refs FROM t367_seen WHERE label = 'student') = 0
  AND (SELECT refs FROM t367_seen WHERE label = 'no membership') = 0
  AND (SELECT refs FROM t367_seen WHERE label = 'admin') >= 2,
  'sales A names two clients, sales B (task visible, lead not) none, student and anonymous none, admin at least two: '
  || (SELECT string_agg(label || '=' || refs, ', ') FROM t367_seen));
SELECT pg_temp.t367_assert(
  (pg_temp.t367_run(:'t367_sales_a', 'authenticated', format('SELECT (platform.staff_task_lead_refs_v1(%L, %L) -> ''refs'' -> 0 ->> ''client_name'')',
    pg_temp.t367_id(1), pg_temp.t367_ids(1801)))) = 'T367 Client 1',
  'the client name comes from the lead the actor may read');

-- Input bounds and rights.
SELECT pg_temp.t367_assert(
  pg_temp.t367_run(:'t367_admin', 'authenticated', 'SELECT platform.staff_task_lead_refs_v1(NULL, NULL)::TEXT') LIKE 'ERR 22023:%'
  AND pg_temp.t367_run(:'t367_admin', 'authenticated', format('SELECT platform.staff_task_lead_refs_v1(%L, NULL)::TEXT', pg_temp.t367_id(1))) LIKE 'ERR 22023:%'
  AND pg_temp.t367_run(:'t367_admin', 'authenticated', format('SELECT platform.staff_task_lead_refs_v1(%L, %L)::TEXT', pg_temp.t367_id(1),
    ARRAY[pg_temp.t367_id(1801), pg_temp.t367_id(1801)])) LIKE 'ERR 22023:%'
  AND pg_temp.t367_run(:'t367_admin', 'authenticated', format('SELECT platform.staff_task_lead_refs_v1(%L, %L)::TEXT', pg_temp.t367_id(1),
    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)))) LIKE 'ERR 22023:%'
  AND pg_temp.t367_run(:'t367_admin', 'authenticated', format('SELECT platform.staff_task_lead_refs_v1(%L, %L)::TEXT', pg_temp.t367_id(1),
    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 50)))) = '{"refs": []}',
  'null, duplicate and 51 ids are 22023; 50 unknown ids are an empty answer');
SELECT pg_temp.t367_assert(
  has_function_privilege('authenticated', 'platform.staff_task_lead_refs_v1(uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_task_lead_refs_v1(uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.staff_task_lead_refs_v1(uuid,uuid[])', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
    FROM pg_proc p WHERE p.oid = 'platform.staff_task_lead_refs_v1(uuid,uuid[])'::REGPROCEDURE),
  'the batch read is SECURITY DEFINER, STABLE, with an empty search_path, executable by authenticated only');
SELECT pg_temp.t367_assert(
  pg_temp.t367_run(NULL, 'anon', format('SELECT platform.staff_task_lead_refs_v1(%L, %L)::TEXT', pg_temp.t367_id(1), pg_temp.t367_ids(1801))) LIKE 'ERR 42501:%',
  'anon cannot call the batch read');

SELECT 'A367_TODAY_FINANCE_SPEED_SUITE_PASSED' AS a367_suite_marker;
ROLLBACK;
