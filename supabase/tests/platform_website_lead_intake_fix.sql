\set ON_ERROR_STOP on
-- Boundary suite for migration 262 (приём заявок сайта, PLAN_CHANGES
-- 06.10.2026): platform.receive_website_lead declared a PL/pgSQL variable
-- normalized_phone, the name of the column platform.clients.normalized_phone,
-- so its contact lookup raised 42702 «column reference "normalized_phone" is
-- ambiguous» on every valid enquiry and the route answered 503. 262 renames
-- the variable to contact_phone and changes nothing else.
--
-- The runner invokes this file twice on the real migration chain, replaying
-- the website intake route (src/lib/server/website-lead-intake.ts): the
-- service role calls the RPC with the configured organization and owner
-- membership (EVO_PLATFORM_ORGANIZATION_ID, EVO_WEBSITE_INTAKE_OWNER_MEMBERSHIP_ID).
-- The owner is modelled like production after 155: invited staff with coarse
-- role NULL whose only authority is a department-scoped Sales Manager role with
-- the production permission keys (as in 258's suite).
--  * With -v p262_pre=1, immediately BEFORE 262: the 240 body is in place and
--    a valid enquiry fails with 42702 on normalized_phone, leaving no receipt,
--    client, lead, audit event or rate-limit row (the defect, pinned).
--  * Without it, immediately AFTER 262: the same enquiry is accepted and
--    creates exactly one client (the normalized phone), one open 'website'
--    lead owned by the configured owner with its interest direction, one
--    receipt and one 'lead.website.receive' audit event; the owner reads the
--    submission; a replay of the same requestId is accepted without a second
--    write; the same requestId with another payload is request_conflict; a
--    second requestId with the same phone attaches to the existing open lead;
--    an enquiry with a university creates its own lead; an unknown country is
--    still refused 22023 without a write; an owner without the Sales
--    permissions, or none, gets 'unavailable'; an authenticated caller still
--    cannot execute it; and the function is 240's body with only the variable
--    renamed, with its definer, search_path and service-only ACL.
-- Isolated synthetic SQL fixtures only, rolled back: no real person, phone,
-- website request, provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The Supabase auth.role() helper the RPC calls first (absent from the bare
-- test image); created inside this transaction only, as in 258's suite.
DO $n262_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n262_auth_role$;

CREATE FUNCTION pg_temp.n262_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n262_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N262: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'. The handler's
-- subtransaction rolls the failed call back, as PostgREST does for the RPC.
CREATE FUNCTION pg_temp.n262_error(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The route's RPC call: request n, a synthetic name/phone, the given owner,
-- country and university, and one synthetic IP hash.
CREATE FUNCTION pg_temp.n262_receive(p_request INTEGER, p_owner INTEGER, p_phone TEXT,
  p_country TEXT, p_university JSONB DEFAULT NULL, p_name TEXT DEFAULT 'N262 Fictional Applicant')
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.receive_website_lead(
    pg_temp.n262_id(1), pg_temp.n262_id(p_owner), pg_temp.n262_id(p_request),
    p_name, p_phone, 19, 'N262 City', p_country, TRUE, repeat('a', 64), p_university)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n262_id(INTEGER), pg_temp.n262_assert(BOOLEAN, TEXT),
  pg_temp.n262_error(TEXT), pg_temp.n262_receive(INTEGER, INTEGER, TEXT, TEXT, JSONB, TEXT)
  TO authenticated, service_role;

SELECT 'N262_WEBSITE_LEAD_INTAKE_FIX_SUITE_START' AS n262_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 301 Admin (system, sets up the roles); invited staff with coarse
-- role NULL: 302 Sales Manager (department 901) = the configured website
-- intake owner; 304 Admissions (own scope, lead.read but no Sales workflow).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n262_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n262_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (4, NULL);
GRANT SELECT ON n262_actors TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n262_id(1), 'N262 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n262_id(100 + n), 'n262-' || n || '@example.invalid', '{}'::JSONB FROM n262_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n262_id(200 + n), pg_temp.n262_id(100 + n), 'N262 Actor ' || n, 'active', 1 FROM n262_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n262_id(300 + n), pg_temp.n262_id(1), pg_temp.n262_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n262_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n262_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n262_id(401), pg_temp.n262_id(1), 'organization', pg_temp.n262_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n262_id(1), pg_temp.n262_id(301), pg_temp.n262_id(401), 1, 1, TRUE, 'system',
    'N262 synthetic organization scope', pg_temp.n262_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n262_id(901), pg_temp.n262_id(1), 'N262 Sales'),
  (pg_temp.n262_id(902), pg_temp.n262_id(1), 'N262 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n262_id(1), pg_temp.n262_id(302), pg_temp.n262_id(901)),
  (pg_temp.n262_id(1), pg_temp.n262_id(304), pg_temp.n262_id(902));

-- Roles with the production permission keys (26.09 read-only audit, as in 258's suite).
CREATE TEMP TABLE n262_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n262_roles VALUES
 (pg_temp.n262_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n262_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130);
CREATE TEMP TABLE n262_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n262_grants VALUES
 (302, pg_temp.n262_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n262_id(901), 'resourceKind', NULL)),
 (304, pg_temp.n262_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE n262_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n262_id(1);
GRANT SELECT ON n262_roles, n262_grants, n262_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n262_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n262_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n262_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n262_admin_setup';
SET LOCAL ROLE authenticated;
DO $n262_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n262_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n262_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N262 ' || r.label, 'description', 'Migration 262 synthetic role',
        'permissionKeys', r.keys), 'N262 create role', pg_temp.n262_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n262_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n262_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N262 publish role', pg_temp.n262_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n262_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n262_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n262_id(1), pg_temp.n262_id(m),
      (SELECT access_version FROM n262_versions WHERE membership_id = pg_temp.n262_id(m)), items, bindings,
      'N262 grant roles', pg_temp.n262_id(2000 + m));
  END LOOP;
END
$n262_roles$;
RESET ROLE;
RESET request.jwt.claims;
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.n262_id(1103);

UPDATE n262_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n262_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n262_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n262_sales FROM n262_actors WHERE n = 2 \gset
SELECT claims AS n262_admin FROM n262_actors WHERE n = 1 \gset
SELECT jsonb_build_object('role', 'service_role')::TEXT AS n262_service_claims \gset

-- The owner gate the RPC applies: the Sales Manager may receive a new lead,
-- the Admissions member may read leads but not run the Sales workflow.
SELECT pg_temp.n262_assert(
  platform_private.staff_can_receive_assignment(pg_temp.n262_id(1), pg_temp.n262_id(302), 'lead.read', 'lead', NULL)
  AND platform_private.staff_can_receive_assignment(pg_temp.n262_id(1), pg_temp.n262_id(302), 'lead.sales.workflow.manage', 'lead', NULL)
  AND NOT platform_private.staff_can_receive_assignment(pg_temp.n262_id(1), pg_temp.n262_id(304), 'lead.sales.workflow.manage', 'lead', NULL)
  AND (SELECT count(*) = 2 FROM platform.organization_memberships
    WHERE organization_id = pg_temp.n262_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL),
  'fixture: the Sales Manager can receive a website lead, the Admissions member cannot; invited members have coarse role and bundle NULL');

CREATE TEMP VIEW n262_counts AS SELECT
  (SELECT count(*) FROM platform_private.website_lead_receipts WHERE organization_id = pg_temp.n262_id(1)) AS receipts,
  (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.n262_id(1)) AS clients,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n262_id(1)) AS leads,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n262_id(1) AND source_key = 'website') AS website_leads,
  (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n262_id(1)
    AND action = 'lead.website.receive') AS receive_audits,
  (SELECT count(*) FROM platform_private.website_intake_limits WHERE organization_id = pg_temp.n262_id(1)) AS limit_rows;

\if :{?p262_pre}

-- ---------------------------------------------------------------------------
-- Before 262: the 240 body is live and a valid enquiry fails with 42702.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n262_assert(
  md5(p.prosrc) = 'a99e227c0eb7020b2e039eff3bd269d9'
    AND strpos(p.prosrc, 'c.normalized_phone=normalized_phone') > 0,
  'the website intake body before 262 is not the 240 body')
FROM pg_proc AS p
WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb)'::regprocedure;

SET request.jwt.claims TO :'n262_service_claims';
SET ROLE service_role;
SELECT pg_temp.n262_error('SELECT pg_temp.n262_receive(701, 302, ''+99900000001'', ''Malaysia'')') AS n262_pre_error \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT :'n262_pre_error' AS n262_pre_262_website_enquiry;
SELECT pg_temp.n262_assert(
  :'n262_pre_error' = '42702:column reference "normalized_phone" is ambiguous',
  'before 262 a valid website enquiry did not fail with 42702 on normalized_phone: ' || :'n262_pre_error');
SELECT pg_temp.n262_assert(
  (SELECT receipts = 0 AND clients = 0 AND leads = 0 AND receive_audits = 0 AND limit_rows = 0 FROM n262_counts),
  'the failed website enquiry left a durable row behind');

\else

-- ---------------------------------------------------------------------------
-- After 262: the same enquiry is accepted and lands as a website lead.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'n262_service_claims';
SET ROLE service_role;
SELECT pg_temp.n262_receive(701, 302, '+99900000001', 'Malaysia') AS n262_first \gset
SELECT pg_temp.n262_receive(701, 302, '+99900000001', 'Malaysia') AS n262_replay \gset
SELECT pg_temp.n262_receive(701, 302, '+99900000001', 'China') AS n262_conflict \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT :'n262_first' AS n262_post_262_website_enquiry;

SELECT pg_temp.n262_assert(
  :'n262_first'::JSONB = jsonb_build_object('status', 'accepted', 'request_id', pg_temp.n262_id(701)),
  'the website enquiry was not accepted with its request id: ' || :'n262_first');
SELECT id AS n262_client_id FROM platform.clients WHERE organization_id = pg_temp.n262_id(1) \gset
SELECT id AS n262_lead_id FROM platform.leads WHERE organization_id = pg_temp.n262_id(1) \gset
SELECT pg_temp.n262_assert(
  (SELECT receipts = 1 AND clients = 1 AND leads = 1 AND website_leads = 1 AND receive_audits = 1 FROM n262_counts)
  AND EXISTS (SELECT 1 FROM platform.clients c WHERE c.id = :'n262_client_id'::UUID
    AND c.normalized_phone = '+99900000001' AND c.lifecycle_state = 'active')
  AND EXISTS (SELECT 1 FROM platform.leads l WHERE l.id = :'n262_lead_id'::UUID
    AND l.client_id = :'n262_client_id'::UUID AND l.source_key = 'website' AND l.stage_key = 'new'
    AND l.lifecycle_state = 'open' AND l.current_owner_membership_id = pg_temp.n262_id(302)
    AND l.interest_direction = 'MY')
  AND EXISTS (SELECT 1 FROM platform_private.website_lead_receipts r
    WHERE r.request_id = pg_temp.n262_id(701) AND r.organization_id = pg_temp.n262_id(1)
      AND r.lead_id = :'n262_lead_id'::UUID
      AND r.payload = jsonb_build_object('name', 'N262 Fictional Applicant', 'phone', '+99900000001',
        'age', 19, 'city', 'N262 City', 'country', 'Malaysia', 'consent', TRUE))
  AND EXISTS (SELECT 1 FROM platform.audit_events e
    WHERE e.request_id = pg_temp.n262_id(701) AND e.action = 'lead.website.receive'
      AND e.resource_type = 'lead' AND e.resource_id = :'n262_lead_id'::UUID
      AND e.actor_kind = 'service' AND e.actor_principal = 'evo-website'),
  'the accepted enquiry did not create exactly one client, open website lead, receipt and audit event');

-- The owner sees the submission on the lead.
SET request.jwt.claims TO :'n262_sales';
SET ROLE authenticated;
SELECT platform.read_lead_website_submissions(pg_temp.n262_id(1), :'n262_lead_id'::UUID) AS n262_submissions \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n262_assert(
  jsonb_array_length(:'n262_submissions'::JSONB) = 1
    AND :'n262_submissions'::JSONB -> 0 ->> 'request_id' = pg_temp.n262_id(701)::TEXT
    AND :'n262_submissions'::JSONB -> 0 ->> 'phone' = '+99900000001'
    AND :'n262_submissions'::JSONB -> 0 ->> 'country' = 'Malaysia',
  'the lead owner does not read the website submission: ' || :'n262_submissions');

-- Replay and conflict of the same requestId.
SELECT pg_temp.n262_assert(
  :'n262_replay'::JSONB = :'n262_first'::JSONB
    AND (SELECT receipts = 1 AND clients = 1 AND leads = 1 AND receive_audits = 1 FROM n262_counts),
  'replaying the requestId was not accepted without a second write: ' || :'n262_replay');
SELECT pg_temp.n262_assert(
  :'n262_conflict'::JSONB = jsonb_build_object('status', 'request_conflict')
    AND (SELECT receipts = 1 AND clients = 1 AND leads = 1 AND receive_audits = 1 FROM n262_counts),
  'the requestId reused with another payload was not a request_conflict: ' || :'n262_conflict');

-- A second enquiry with the same phone attaches to the existing open lead;
-- an enquiry with a university creates its own client and lead.
SET request.jwt.claims TO :'n262_service_claims';
SET ROLE service_role;
SELECT pg_temp.n262_receive(702, 302, '+99900000001', 'Germany') AS n262_second \gset
SELECT pg_temp.n262_receive(703, 302, '+99900000002', 'Germany',
  '{"slug":"n262-university","name":"N262 University"}'::JSONB) AS n262_university \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n262_assert(
  :'n262_second'::JSONB = jsonb_build_object('status', 'accepted', 'request_id', pg_temp.n262_id(702))
    AND EXISTS (SELECT 1 FROM platform_private.website_lead_receipts r
      WHERE r.request_id = pg_temp.n262_id(702) AND r.lead_id = :'n262_lead_id'::UUID)
    AND (SELECT interest_direction = 'MY' FROM platform.leads WHERE id = :'n262_lead_id'::UUID)
    AND (SELECT count(*) = 1 FROM platform.leads WHERE client_id = :'n262_client_id'::UUID),
  'a second enquiry with the same phone did not attach to the existing open lead: ' || :'n262_second');
SELECT pg_temp.n262_assert(
  :'n262_university'::JSONB = jsonb_build_object('status', 'accepted', 'request_id', pg_temp.n262_id(703))
    AND EXISTS (SELECT 1 FROM platform_private.website_lead_receipts r
      JOIN platform.leads l ON l.id = r.lead_id
      JOIN platform.clients c ON c.id = l.client_id
      WHERE r.request_id = pg_temp.n262_id(703) AND l.id <> :'n262_lead_id'::UUID
        AND l.source_key = 'website' AND l.interest_direction = 'EU'
        AND l.current_owner_membership_id = pg_temp.n262_id(302)
        AND c.normalized_phone = '+99900000002'
        AND r.payload -> 'university' = '{"slug":"n262-university","name":"N262 University"}'::JSONB)
    AND (SELECT receipts = 3 AND clients = 2 AND leads = 2 AND website_leads = 2 AND receive_audits = 3 FROM n262_counts),
  'an enquiry with a university did not create its own website lead: ' || :'n262_university');

-- Validation and owner gate are unchanged; an authenticated caller is refused.
SET request.jwt.claims TO :'n262_service_claims';
SET ROLE service_role;
SELECT pg_temp.n262_error('SELECT pg_temp.n262_receive(704, 302, ''+99900000003'', ''Mars'')') AS n262_invalid \gset
SELECT pg_temp.n262_receive(705, 304, '+99900000004', 'China') AS n262_owner_without_sales \gset
SELECT pg_temp.n262_receive(706, 999, '+99900000005', 'China') AS n262_owner_unknown \gset
RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'n262_admin';
SET ROLE authenticated;
SELECT pg_temp.n262_error('SELECT pg_temp.n262_receive(707, 302, ''+99900000006'', ''China'')') AS n262_authenticated \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.n262_assert(
  :'n262_invalid' = '22023:website_intake_invalid',
  'an unknown country was not refused 22023 website_intake_invalid: ' || :'n262_invalid');
SELECT pg_temp.n262_assert(
  :'n262_owner_without_sales'::JSONB = '{"status":"unavailable"}'::JSONB
    AND :'n262_owner_unknown'::JSONB = '{"status":"unavailable"}'::JSONB,
  'an owner without the Sales permissions, or an unknown owner, was not unavailable');
SELECT pg_temp.n262_assert(
  :'n262_authenticated' LIKE '42501:permission denied for function receive_website_lead%',
  'an authenticated caller was not refused 42501: ' || :'n262_authenticated');
SELECT pg_temp.n262_assert(
  (SELECT receipts = 3 AND clients = 2 AND leads = 2 AND receive_audits = 3 FROM n262_counts),
  'a refused or unavailable enquiry wrote a receipt, client, lead or audit event');

-- Only the variable changed; definer, search_path and service-only ACL kept.
SELECT pg_temp.n262_assert(
  md5(p.prosrc) = '7dc77f2607cc62b1f644572481d850e6'
    -- Renaming the variable back yields exactly the 240 body.
    AND md5(replace(p.prosrc, 'contact_phone', 'normalized_phone')) = 'a99e227c0eb7020b2e039eff3bd269d9'
    AND strpos(p.prosrc, 'c.normalized_phone=contact_phone') > 0
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND p.prosecdef
    AND p.provolatile = 'v'
    AND p.proconfig = ARRAY['search_path=""']
    AND p.proacl = ARRAY['postgres=X/postgres', 'service_role=X/postgres']::aclitem[]
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'),
  'the repaired website intake function changed beyond the variable rename')
FROM pg_proc AS p
WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb)'::regprocedure;

\endif

SELECT 'N262_WEBSITE_LEAD_INTAKE_FIX_SUITE_END' AS n262_suite_marker;

ROLLBACK;
