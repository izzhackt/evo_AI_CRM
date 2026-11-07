\set ON_ERROR_STOP on
-- Boundary suite for migration 339 «Продажа ученику, который сам заполнил анкету». Runs on the real chain right after 339
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Members are modelled like production (as in 258's suite): invited staff have coarse role NULL, permissions come only from
-- scoped role assignments with the production permission keys, and the Sales Manager role is the 208 workflow role.
-- Proves (real submit by the account, real approval by the system Admin, real sale by the Sales Manager):
--  1. the approval writes the case's client: the client of its lead; the lead has no owner;
--  2. the sale form search finds the lead without an owner (owner_id null), but not for a seller who may not assign owners;
--  3. a Sales Manager who may not assign owners is refused as before (42501) and nothing changes;
--  4. the sale into the approved cabinet goes through: the seller saving it becomes the lead's owner through the workflow
--     command (one lead.sales.workflow.changed with the derived request id), stage and next step unchanged; the case is
--     active with the curator and the seller; one report record and one 088 handoff;
--  5. the replay returns the same receipt and changes nothing;
--  6. a lead with an owner keeps the owner, and the sale is credited to that owner; a lead without an owner and without a
--     cabinet, with a next step, gets the seller as owner, keeps the next step and is handed off by the ordinary 088 branch;
--  7. the one-time fill (the migration's own statement) restores the client of a pending and an active case only;
--  8. catalog: the three functions keep SECURITY DEFINER, empty search_path, owner postgres and EXECUTE for authenticated.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $a339_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a339_auth_role$;

\echo A339_CABINET_CASE_SALE_SUITE_START

CREATE FUNCTION pg_temp.a339_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a339_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A339: %', message; END IF;
END
$$;
-- The command as that account: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a339_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a339_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a339_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
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
CREATE FUNCTION pg_temp.a339_submit(p_user INTEGER, p_request INTEGER, p_last_name TEXT) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a339_call(p_user, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    pg_temp.a339_id(p_request), jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a339_id(p_request)::TEXT,
      'firstName', 'A339', 'lastName', p_last_name, 'phone', '+99655533900' || (p_user - 110)::TEXT,
      'destinationCountries', '["CN"]'::JSONB, 'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school',
      'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', '["Инженерия"]'::JSONB, 'studyLevels', '["bachelor"]'::JSONB,
      'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
      'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18')));
  PERFORM pg_temp.a339_assert(r ? 'ok', 'анкета submit failed: ' || r::TEXT);
  RETURN (r #>> '{ok,id}')::UUID;
END
$$;
CREATE FUNCTION pg_temp.a339_approve(p_application UUID, p_request INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a339_call(101, format(
    'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''A339 synthetic decision'', %L::UUID)',
    p_application, pg_temp.a339_id(p_request)));
  PERFORM pg_temp.a339_assert(r #>> '{ok,status}' = 'approved', 'approval failed: ' || r::TEXT);
  RETURN (r #>> '{ok,student_case_id}')::UUID;
END
$$;
CREATE FUNCTION pg_temp.a339_sale(p_who INTEGER, p_request INTEGER, p_lead UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a339_call(p_who, format('platform.create_sales_report_handoff(%L::UUID, %L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a339_id(1), pg_temp.a339_id(p_request), p_lead, pg_temp.a339_id(304)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a339_id(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fixture. 101 system Admin (approves анкеты, creates the roles); invited staff with coarse role NULL:
-- 102 Sales Manager (organization), 103 Sales Manager without lead.sales.owner.assign (organization),
-- 104 Admissions (the curator, own scope); applicants 111, 112, 113 with confirmed email.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a339_id(1), 'A339 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a339_id(2), pg_temp.a339_id(1), 'organization', pg_temp.a339_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.a339_id(100 + n), 'a339-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 2, 3, 4, 11, 12, 13]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a339_id(200 + n), pg_temp.a339_id(100 + n), 'A339 Staff ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  VALUES (pg_temp.a339_id(301), pg_temp.a339_id(1), pg_temp.a339_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a339_id(300 + n), pg_temp.a339_id(1), pg_temp.a339_id(200 + n), 'active', NULL, NULL FROM unnest(ARRAY[2, 3, 4]) AS n;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a339_id(1), pg_temp.a339_id(301), pg_temp.a339_id(2), 1, 1, TRUE, 'system', 'A339 synthetic organization scope',
    pg_temp.a339_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.a339_id(930), pg_temp.a339_id(1), 'Отдел сопровождения'),
  (pg_temp.a339_id(931), pg_temp.a339_id(1), 'Отдел продаж');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.a339_id(1), pg_temp.a339_id(302), pg_temp.a339_id(931)),
  (pg_temp.a339_id(1), pg_temp.a339_id(303), pg_temp.a339_id(931)),
  (pg_temp.a339_id(1), pg_temp.a339_id(304), pg_temp.a339_id(930));
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration (singleton, organization_id, review_department_id, enabled,
  intake_owner_membership_id)
  VALUES (TRUE, pg_temp.a339_id(1), pg_temp.a339_id(930), TRUE, NULL);

-- Roles with the production permission keys (as in 258's suite). One workflow role per organization, so the owner assignment
-- of the production Sales Manager is split into 1106 and given only to 102.
CREATE TEMP TABLE a339_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a339_roles VALUES
 (pg_temp.a339_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.a339_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.a339_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.a339_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 (pg_temp.a339_id(1106), 'Lead owner assignment', '["lead.sales.owner.assign"]', 1160);
CREATE TEMP TABLE a339_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO a339_grants VALUES
 (302, pg_temp.a339_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL)),
 (302, pg_temp.a339_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL)),
 (302, pg_temp.a339_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL)),
 (303, pg_temp.a339_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL)),
 (303, pg_temp.a339_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL)),
 (304, pg_temp.a339_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.a339_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.a339_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE a339_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.a339_id(1);
GRANT SELECT ON a339_roles, a339_grants, a339_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a339_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a339_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a339_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a339_admin_setup';
SET LOCAL ROLE authenticated;
DO $a339_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a339_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a339_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A339 ' || r.label, 'description', 'Migration 339 synthetic role',
        'permissionKeys', r.keys), 'A339 create role', pg_temp.a339_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a339_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a339_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'A339 publish role', pg_temp.a339_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a339_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM a339_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a339_id(1), pg_temp.a339_id(m),
      (SELECT access_version FROM a339_versions WHERE membership_id = pg_temp.a339_id(m)), items, bindings,
      'A339 grant roles', pg_temp.a339_id(2000 + m));
  END LOOP;
END
$a339_roles$;
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
-- The Sales Manager role is the 208 workflow role, as bound in production.
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.a339_id(1103);
SELECT pg_temp.a339_assert(platform_private.staff_is_sales_manager(pg_temp.a339_id(1), pg_temp.a339_id(302))
  AND platform_private.staff_is_sales_manager(pg_temp.a339_id(1), pg_temp.a339_id(303))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.a339_id(1), pg_temp.a339_id(304))
  AND platform_private.staff_has_permission(pg_temp.a339_id(1), pg_temp.a339_id(302), 'lead.sales.owner.assign')
  AND NOT platform_private.staff_has_permission(pg_temp.a339_id(1), pg_temp.a339_id(303), 'lead.sales.owner.assign'),
  'fixture: 102 and 103 are Sales Managers, only 102 may assign owners, the curator is not a Sales Manager');

-- Three self-registered students, approved by the Admin.
SELECT pg_temp.a339_approve(pg_temp.a339_submit(111, 711, 'Первый'), 721) AS a339_case_1,
  pg_temp.a339_approve(pg_temp.a339_submit(112, 712, 'Второй'), 722) AS a339_case_2,
  pg_temp.a339_approve(pg_temp.a339_submit(113, 713, 'Третий'), 723) AS a339_case_3 \gset
SELECT canonical_lead_id AS a339_lead_1 FROM platform.student_cases WHERE id = :'a339_case_1' \gset
SELECT canonical_lead_id AS a339_lead_2 FROM platform.student_cases WHERE id = :'a339_case_2' \gset
SELECT canonical_lead_id AS a339_lead_3 FROM platform.student_cases WHERE id = :'a339_case_3' \gset
-- The sale conditions a sale is built from (the lead card saves them; 208 copies them).
INSERT INTO platform_private.lead_sale_conditions(organization_id, lead_id, fields, revision, updated_by_membership_id)
SELECT pg_temp.a339_id(1), lead_id,
  jsonb_build_object('signing_date', '2026-11-07', 'service_cost_minor', 100000, 'service_cost_currency', 'USD',
    'service_cost_raw', '1000 USD', 'paid_minor', 20000, 'paid_currency', 'USD', 'paid_raw', '200 USD',
    'service_label', 'A339 synthetic service', 'payment_note', 'A339 synthetic payment'),
  1, pg_temp.a339_id(302)
FROM unnest(ARRAY[:'a339_lead_1', :'a339_lead_2', :'a339_lead_3']::UUID[]) AS lead_id;

-- ---------------------------------------------------------------------------
-- 1. The approval writes the case's client: the client of its lead. The lead has no owner.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a339_assert((SELECT bool_and(c.state = 'pending' AND c.canonical_client_id IS NOT NULL
    AND c.canonical_client_id = l.client_id AND l.current_owner_membership_id IS NULL AND c.responsible_sales_membership_id IS NULL)
  FROM platform.student_cases c JOIN platform.leads l ON l.organization_id = c.organization_id AND l.id = c.canonical_lead_id
  WHERE c.id IN (:'a339_case_1', :'a339_case_2', :'a339_case_3')),
  'the approval writes the client of the lead into the pending case; the lead and the case have no seller yet');

-- ---------------------------------------------------------------------------
-- 2. The sale form search finds the lead without an owner, but only for a seller who can become its owner.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a339_call(102, format('platform.sales_register_intake_options(%L::UUID, %L)', pg_temp.a339_id(1), 'A339'))
  AS a339_search \gset
SELECT pg_temp.a339_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(:'a339_search'::JSONB #> '{ok,leads}') AS lead
    WHERE lead ->> 'id' = :'a339_lead_1' AND lead -> 'owner_id' = 'null'::JSONB)
  AND jsonb_array_length(:'a339_search'::JSONB #> '{ok,leads}') = 3,
  'the search finds all three leads, owner_id null: ' || :'a339_search');
SELECT pg_temp.a339_call(103, format('platform.sales_register_intake_options(%L::UUID, %L)', pg_temp.a339_id(1), 'A339'))
  AS a339_search_103 \gset
SELECT pg_temp.a339_assert(:'a339_search_103'::JSONB ? 'ok'
  AND jsonb_array_length(:'a339_search_103'::JSONB #> '{ok,leads}') = 0,
  'a seller who may not assign owners is not offered a lead without an owner: ' || :'a339_search_103');

-- ---------------------------------------------------------------------------
-- 3. A Sales Manager who may not assign owners is refused as before, and nothing changes.
-- ---------------------------------------------------------------------------
SELECT workflow_version AS a339_lead_1_version FROM platform.leads WHERE id = :'a339_lead_1' \gset
SELECT pg_temp.a339_sale(103, 3001, :'a339_lead_1') AS a339_refused \gset
SELECT pg_temp.a339_assert(:'a339_refused'::JSONB ->> 'error' = '42501'
    AND :'a339_refused'::JSONB ->> 'message' = 'sales_register_forbidden',
  'without lead.sales.owner.assign the sale of a lead without an owner is refused: ' || :'a339_refused');
SELECT pg_temp.a339_assert((SELECT l.current_owner_membership_id IS NULL AND l.workflow_version = :a339_lead_1_version
    FROM platform.leads l WHERE l.id = :'a339_lead_1')
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_register r WHERE r.lead_id = :'a339_lead_1')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.resource_id = :'a339_lead_1'
    AND e.action = 'lead.sales.workflow.changed')
  AND (SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'a339_case_1'),
  'the refused sale left the lead, the report and the case untouched');

-- ---------------------------------------------------------------------------
-- 4. The sale into the approved cabinet goes through; the seller becomes the lead's owner.
-- ---------------------------------------------------------------------------
SELECT stage_key AS a339_lead_1_stage FROM platform.leads WHERE id = :'a339_lead_1' \gset
SELECT pg_temp.a339_sale(102, 3002, :'a339_lead_1') AS a339_sale_1 \gset
SELECT pg_temp.a339_assert(:'a339_sale_1'::JSONB ? 'ok'
    AND (:'a339_sale_1'::JSONB #>> '{ok,student_case_id}')::UUID = :'a339_case_1'::UUID
    AND (:'a339_sale_1'::JSONB #>> '{ok,curator_membership_id}')::UUID = pg_temp.a339_id(304),
  'the sale into the approved cabinet goes through: ' || :'a339_sale_1');
SELECT pg_temp.a339_assert((SELECT l.current_owner_membership_id = pg_temp.a339_id(302)
    AND l.workflow_version = :a339_lead_1_version + 1 AND l.stage_key = :'a339_lead_1_stage'
    AND l.next_action_text IS NULL AND l.next_action_due_date IS NULL
    FROM platform.leads l WHERE l.id = :'a339_lead_1'),
  'the seller is the owner now; one workflow step; stage and next step unchanged');
SELECT pg_temp.a339_assert((SELECT count(*) = 1
    AND bool_and(e.request_id = public.uuid_generate_v5(pg_temp.a339_id(3002), 'sales-report:lead-owner')
      AND e.actor_membership_id = pg_temp.a339_id(302) AND e.before_state -> 'current_owner_membership_id' = 'null'::JSONB
      AND (e.after_state ->> 'current_owner_membership_id')::UUID = pg_temp.a339_id(302))
  FROM platform.audit_events e WHERE e.resource_id = :'a339_lead_1' AND e.action = 'lead.sales.workflow.changed'),
  'exactly one workflow audit: the derived request id, the seller, from no owner to the seller');
SELECT pg_temp.a339_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.a339_id(304)
    AND c.responsible_sales_membership_id = pg_temp.a339_id(302)
    FROM platform.student_cases c WHERE c.id = :'a339_case_1')
  AND (SELECT count(*) = 1 AND bool_and(r.owner_membership_id = pg_temp.a339_id(302))
    FROM platform_private.sales_register r WHERE r.lead_id = :'a339_lead_1')
  AND (SELECT count(*) = 1 FROM platform.sales_admissions_handoffs h WHERE h.lead_id = :'a339_lead_1'),
  'the case is active with the curator and the seller; one report record of the seller; one 088 handoff');

-- ---------------------------------------------------------------------------
-- 5. The replay returns the same receipt and changes nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a339_sale(102, 3002, :'a339_lead_1') AS a339_replay \gset
SELECT pg_temp.a339_assert(:'a339_replay'::JSONB -> 'ok' = :'a339_sale_1'::JSONB -> 'ok'
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.resource_id = :'a339_lead_1'
    AND e.action = 'lead.sales.workflow.changed')
  AND (SELECT l.workflow_version = :a339_lead_1_version + 1 FROM platform.leads l WHERE l.id = :'a339_lead_1'),
  'the replay returns the same receipt; no second owner change: ' || :'a339_replay');

-- ---------------------------------------------------------------------------
-- 6. A lead with an owner keeps the owner; the sale is credited to that owner.
-- ---------------------------------------------------------------------------
SELECT workflow_version AS a339_lead_2_version, stage_key AS a339_lead_2_stage FROM platform.leads WHERE id = :'a339_lead_2' \gset
SELECT pg_temp.a339_call(102, format(
  'platform.mutate_sales_lead_workflow(%L::UUID, %s, %L::UUID, %L, %L::UUID, NULL, NULL, TRUE, NULL)',
  :'a339_lead_2', :a339_lead_2_version, pg_temp.a339_id(3101), :'a339_lead_2_stage', pg_temp.a339_id(303))) AS a339_owner_2 \gset
SELECT pg_temp.a339_assert(:'a339_owner_2'::JSONB ? 'ok', 'fixture: 102 makes 103 the owner of lead 2: ' || :'a339_owner_2');
SELECT pg_temp.a339_sale(102, 3003, :'a339_lead_2') AS a339_sale_2 \gset
SELECT pg_temp.a339_assert(:'a339_sale_2'::JSONB ? 'ok'
  AND (SELECT l.current_owner_membership_id = pg_temp.a339_id(303) AND l.workflow_version = :a339_lead_2_version + 1
    FROM platform.leads l WHERE l.id = :'a339_lead_2')
  AND (SELECT r.owner_membership_id = pg_temp.a339_id(303) FROM platform_private.sales_register r WHERE r.lead_id = :'a339_lead_2')
  AND (SELECT c.state = 'active' AND c.responsible_sales_membership_id = pg_temp.a339_id(303)
    FROM platform.student_cases c WHERE c.id = :'a339_case_2')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e
    WHERE e.request_id = public.uuid_generate_v5(pg_temp.a339_id(3003), 'sales-report:lead-owner')),
  'the owner is kept and credited; the sale changes no owner: ' || :'a339_sale_2');

-- ---------------------------------------------------------------------------
-- 6b. A lead without an owner and without a cabinet, with a next step: the owner block, then the ordinary 088 branch.
-- ---------------------------------------------------------------------------
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, lifecycle_state)
  VALUES (pg_temp.a339_id(604), pg_temp.a339_id(1), 'A339 Четвёртый', platform_private.normalize_person_name('A339 Четвёртый'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  next_action_text, next_action_due_date)
  VALUES (pg_temp.a339_id(624), pg_temp.a339_id(1), pg_temp.a339_id(604), NULL, 'potential', 'other', 'open',
    'A339 позвонить', DATE '2026-11-10');
INSERT INTO platform_private.lead_sale_conditions(organization_id, lead_id, fields, revision, updated_by_membership_id)
  VALUES (pg_temp.a339_id(1), pg_temp.a339_id(624), jsonb_build_object('signing_date', '2026-11-07', 'service_cost_minor', 100000,
    'service_cost_currency', 'USD', 'service_cost_raw', '1000 USD', 'paid_minor', 20000, 'paid_currency', 'USD', 'paid_raw', '200 USD',
    'service_label', 'A339 synthetic service', 'payment_note', 'A339 synthetic payment'), 1, pg_temp.a339_id(302));
SELECT workflow_version AS a339_lead_4_version FROM platform.leads WHERE id = pg_temp.a339_id(624) \gset
SELECT pg_temp.a339_sale(102, 3004, pg_temp.a339_id(624)) AS a339_sale_4 \gset
SELECT pg_temp.a339_assert(:'a339_sale_4'::JSONB ? 'ok'
  AND (SELECT l.current_owner_membership_id = pg_temp.a339_id(302) AND l.workflow_version = :a339_lead_4_version + 1
    AND l.stage_key = 'potential' AND l.next_action_text = 'A339 позвонить' AND l.next_action_due_date = DATE '2026-11-10'
    FROM platform.leads l WHERE l.id = pg_temp.a339_id(624))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.resource_id = pg_temp.a339_id(624)
    AND e.action = 'lead.sales.workflow.changed'
    AND e.request_id = public.uuid_generate_v5(pg_temp.a339_id(3004), 'sales-report:lead-owner'))
  AND (SELECT c.current_curator_membership_id = pg_temp.a339_id(304) AND c.canonical_client_id = pg_temp.a339_id(604)
    AND c.responsible_sales_membership_id = pg_temp.a339_id(302)
    FROM platform.student_cases c WHERE c.id = (:'a339_sale_4'::JSONB #>> '{ok,student_case_id}')::UUID)
  AND (SELECT count(*) = 1 AND bool_and(h.handoff_mode = 'sales_report')
    FROM platform.sales_admissions_handoffs h WHERE h.lead_id = pg_temp.a339_id(624)),
  'without a cabinet: the seller becomes the owner, the next step stays, the 088 branch opens the case: ' || :'a339_sale_4');

-- ---------------------------------------------------------------------------
-- 7. The one-time fill: the statement of the migration's step 2 (copied here; keep both the same) restores the client
--    of a pending and an active case only.
-- ---------------------------------------------------------------------------
SELECT updated_at AS a339_case_2_updated FROM platform.student_cases WHERE id = :'a339_case_2' \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET canonical_client_id = NULL WHERE id IN (:'a339_case_1', :'a339_case_3');
SET LOCAL session_replication_role = origin;
UPDATE platform.student_cases AS student_case
SET canonical_client_id = lead.client_id
FROM platform.leads AS lead
WHERE lead.organization_id = student_case.organization_id
  AND lead.id = student_case.canonical_lead_id
  AND student_case.canonical_client_id IS NULL;
SELECT pg_temp.a339_assert((SELECT bool_and(c.canonical_client_id = l.client_id)
    FROM platform.student_cases c JOIN platform.leads l ON l.id = c.canonical_lead_id
    WHERE c.id IN (:'a339_case_1', :'a339_case_3'))
  AND (SELECT c.updated_at = :'a339_case_2_updated'::TIMESTAMPTZ FROM platform.student_cases c WHERE c.id = :'a339_case_2')
  AND NOT EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.canonical_lead_id IS NOT NULL AND c.canonical_client_id IS NULL),
  'the fill restores the active and the pending case and leaves a complete case alone');

-- ---------------------------------------------------------------------------
-- 8. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a339_assert(bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) AND count(*) = 3,
  'the three functions keep SECURITY DEFINER, empty search_path, owner postgres, EXECUTE for authenticated only')
FROM pg_proc p WHERE p.oid IN ('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)'::REGPROCEDURE,
  'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE,
  'platform.sales_register_intake_options(uuid,text)'::REGPROCEDURE);

\echo A339_CABINET_CASE_SALE_SUITE_PASSED
ROLLBACK;
