\set ON_ERROR_STOP on
-- Boundary suite for migrations 263-265 («Маркетинг» М1, docs/EVO_MARKETING_PLAN_2026-10-06.md):
-- source attribution touches, the metki of the website form, the manual sources, the one channel rule,
-- the admin-only marketing reads and the manual spend. Members are modelled like production (as in
-- platform_sales_one_truth.sql after 155 and 244): invited staff have organization_memberships.current_role
-- NULL and current_bundle_id NULL, so current_actor_authority().platform_role is NULL; permissions come
-- only from scoped role assignments with the production permission keys. Only the system Admin carries
-- the coarse role; three more members carry the old coarse roles sales / curator / finance without any
-- scoped assignment.
--
-- Proves, on the REAL paths (the real receive_website_lead as service_role, the real
-- create_manual_sales_lead, record_lead_touch, mutate_sales_lead_workflow and the real admin RPCs):
--  * touches are append-only (UPDATE / DELETE / TRUNCATE refused) and closed to every client role;
--  * receive_website_lead: the OLD call (no attribution) is unchanged and its receipt payload is the legacy
--    payload; marks never enter the payload; bad marks are dropped one by one and never refuse a lead; a
--    touch exists only when something survives; a replay under the same requestId with other marks is a
--    plain «accepted» with ONE touch; a submission from a phone with an open lead attaches to it and adds
--    a touch to it without moving the channel; the sanitizer edges (@, 7+ digits, 100 / 200 / 253 limits,
--    hostnames, utm_id digits, seen_at window) and the touch shape (fbclid is a flag, never a value);
--  * the channel rule table (marks first, then the referrer, AI referrers flagged, else unknown) and the
--    rule itself: the latest staff correction wins and is marked, otherwise the FIRST touch, unknown when
--    there is none; the projection read_lead_channel_v1 carries exactly {channel, basis, corrected, at};
--  * record_lead_touch: allowed on a lead the actor may edit (Sales Manager of the lead's department and the
--    Admin); idempotent on the request id (conflicts 22023); refused for the other department, Admissions,
--    a Student, no membership, anon and a coarse role without scope; create_manual_sales_lead accepts
--    instagram and whatsapp_manual, still refuses whatsapp, and neither enters the «Заявки» queue;
--  * every admin RPC (overview, list, spend add, spend cancel) refuses everyone but platform_role = admin
--    (42501): the NULL-role Sales Manager, both departments, Admissions, coarse sales / curator / finance,
--    a Student, no membership, anon and service_role. (The role-preview mode is invisible to the database:
--    it stays a server-side condition of the route and its actions.);
--  * the overview on a small synthetic dataset: the cohort by channel with every funnel step, the unknown
--    row, the basis counts, the paid chain (case payments, then the confirmed first payment, then the report
--    record; a LINKED record does not prove payment), the sales block by sale date with the flagged linked
--    records and «without lead», the reconciliation with staff_sales_count_v1, the spend inside / partly
--    overlapping / cancelled, repeat submissions, and the same overview over leads made today by the real paths;
--  * the leads list: cohort with names, every filter, paging by (created_at, id), limit ≤ 50, no private field;
--  * manual spend: add, replay, validation, cancel by a referencing row, PT409 / P0002 / 22023, append-only.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person, provider or production action.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $m1_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$m1_auth_role$;

CREATE FUNCTION pg_temp.m1_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.m1_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'M1: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.m1_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.m1_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.m1_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.m1_id(x) ORDER BY pg_temp.m1_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m1_id(INTEGER), pg_temp.m1_assert(BOOLEAN, TEXT),
  pg_temp.m1_error(TEXT), pg_temp.m1_message(TEXT), pg_temp.m1_ids(INTEGER[])
  TO authenticated, anon, service_role;


-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (the curator), 7 Sales Manager B (sales department B); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE m1_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO m1_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, 'sales'), (7, NULL), (8, 'curator'), (9, 'finance');
GRANT SELECT ON m1_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.m1_id(1), 'M1 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.m1_id(100 + n), 'm1-' || n || '@example.invalid', '{}'::JSONB FROM m1_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.m1_id(199), 'm1-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.m1_id(200 + n), pg_temp.m1_id(100 + n), 'M1 Actor ' || n, 'active', 1 FROM m1_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.m1_id(300 + n), pg_temp.m1_id(1), pg_temp.m1_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM m1_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.m1_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.m1_id(401), pg_temp.m1_id(1), 'organization', pg_temp.m1_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.m1_id(1), pg_temp.m1_id(301), pg_temp.m1_id(401), 1, 1, TRUE, 'system',
    'M1 synthetic organization scope', pg_temp.m1_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.m1_id(901), pg_temp.m1_id(1), 'M1 Sales A'),
  (pg_temp.m1_id(902), pg_temp.m1_id(1), 'M1 Admissions'),
  (pg_temp.m1_id(903), pg_temp.m1_id(1), 'M1 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.m1_id(1), pg_temp.m1_id(302), pg_temp.m1_id(901)),
  (pg_temp.m1_id(1), pg_temp.m1_id(303), pg_temp.m1_id(902)),
  (pg_temp.m1_id(1), pg_temp.m1_id(304), pg_temp.m1_id(902)),
  (pg_temp.m1_id(1), pg_temp.m1_id(307), pg_temp.m1_id(903));


-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE m1_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO m1_roles VALUES
 (pg_temp.m1_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.m1_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.m1_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.m1_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.m1_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE m1_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO m1_grants VALUES
 (302, pg_temp.m1_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.m1_id(901), 'resourceKind', NULL)),
 (302, pg_temp.m1_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.m1_id(1), 'resourceKind', NULL)),
 (303, pg_temp.m1_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.m1_id(902), 'resourceKind', NULL)),
 (303, pg_temp.m1_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.m1_id(1), 'resourceKind', NULL)),
 (304, pg_temp.m1_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.m1_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.m1_id(1), 'resourceKind', NULL)),
 (307, pg_temp.m1_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.m1_id(903), 'resourceKind', NULL)),
 (307, pg_temp.m1_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.m1_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE m1_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.m1_id(1);
GRANT SELECT ON m1_roles, m1_grants, m1_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.m1_id(101),
  'claims', jsonb_build_object('sub', pg_temp.m1_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS m1_admin_setup \gset
SET LOCAL request.jwt.claims TO :'m1_admin_setup';
SET LOCAL ROLE authenticated;
DO $m1_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM m1_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.m1_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'M1 ' || r.label, 'description', 'Migration 265 synthetic role',
        'permissionKeys', r.keys), 'M1 create role', pg_temp.m1_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.m1_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.m1_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'M1 publish role', pg_temp.m1_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM m1_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM m1_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.m1_id(1), pg_temp.m1_id(m),
      (SELECT access_version FROM m1_versions WHERE membership_id = pg_temp.m1_id(m)), items, bindings,
      'M1 grant roles', pg_temp.m1_id(2000 + m));
  END LOOP;
END
$m1_roles$;
RESET ROLE;

UPDATE m1_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.m1_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.m1_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS m1_admin FROM m1_actors WHERE n = 1 \gset
SELECT claims AS m1_sales_a FROM m1_actors WHERE n = 2 \gset
SELECT claims AS m1_admissions_manager FROM m1_actors WHERE n = 3 \gset
SELECT claims AS m1_admissions_a FROM m1_actors WHERE n = 4 \gset
SELECT claims AS m1_student FROM m1_actors WHERE n = 5 \gset
SELECT claims AS m1_sales_b FROM m1_actors WHERE n = 7 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.m1_id(199),
  'claims', jsonb_build_object('sub', pg_temp.m1_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS m1_none \gset
SELECT pg_temp.m1_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.m1_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.m1_ids(302, 303, 304, 307))), 'invited members have coarse role and bundle NULL');

SELECT claims AS m1_sales_coarse FROM m1_actors WHERE n = 6 \gset
SELECT claims AS m1_curator_coarse FROM m1_actors WHERE n = 8 \gset
SELECT claims AS m1_finance_coarse FROM m1_actors WHERE n = 9 \gset
SELECT '{"role":"service_role"}' AS m1_service \gset
SELECT '{"role":"anon"}' AS m1_anon \gset
CREATE FUNCTION pg_temp.m1_hash(n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT lpad(n::TEXT, 64, '0') $$;
GRANT EXECUTE ON FUNCTION pg_temp.m1_hash(INTEGER) TO service_role, authenticated, anon;
CREATE FUNCTION pg_temp.m1_keys(j JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k COLLATE "C"), ARRAY[]::TEXT[]) FROM jsonb_object_keys(j) AS k
$$;
-- The Bishkek day of the real clock: the leads made through the real intake path below are "today".
SELECT (now() AT TIME ZONE 'Asia/Bishkek')::DATE - 1 AS m1_dyn_from, (now() AT TIME ZONE 'Asia/Bishkek')::DATE + 1 AS m1_dyn_to \gset

SELECT 'M1_MARKETING_SUITE_START' AS m1_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Objects: the touches table and the spend table are closed to every client role and append-only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m1_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'platform_private'
    AND tablename IN ('lead_attribution_touches', 'marketing_manual_spend'))
  AND (SELECT count(*) FROM pg_class WHERE oid IN ('platform_private.lead_attribution_touches'::REGCLASS,
    'platform_private.marketing_manual_spend'::REGCLASS) AND relrowsecurity AND relforcerowsecurity) = 2
  AND NOT has_table_privilege('authenticated', 'platform_private.lead_attribution_touches', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.lead_attribution_touches', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform_private.marketing_manual_spend', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.marketing_manual_spend', 'INSERT'),
  'both tables: forced RLS, no policy, no client privilege');
-- The old 11-argument receive_website_lead is gone: one signature, service_role only.
SELECT pg_temp.m1_assert((SELECT count(*) FROM pg_proc WHERE pronamespace = 'platform'::REGNAMESPACE AND proname = 'receive_website_lead') = 1
  AND has_function_privilege('service_role', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE'),
  'receive_website_lead: a single signature with p_attribution, service_role only');

-- ---------------------------------------------------------------------------
-- 1. Website intake through the REAL receive_website_lead (service role), today.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_service';
SET LOCAL ROLE service_role;
-- W1: an OLD call (the ten named arguments of the pre-263 app, no university, no attribution).
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5001), p_name => 'M1 Web Old', p_phone => '+996555000001', p_age => 20, p_city => 'Bishkek',
  p_country => 'Malaysia', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(1)) ->> 'status' AS m1_w_old \gset
-- W2: tagged Instagram ad with university context and every field; W3: referrer only, with bad marks mixed in.
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5002), p_name => 'M1 Web Ad', p_phone => '+996555000002', p_age => 19, p_city => NULL,
  p_country => 'China', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(2),
  p_university => '{"slug":"alpha-university","name":"Alpha University"}'::JSONB,
  p_attribution => jsonb_build_object('v', 1, 'utm_source', 'instagram', 'utm_medium', 'paid_social',
    'utm_campaign', 'Весна 2026', 'utm_content', 'video-1', 'utm_term', 'adset-1', 'utm_id', '120210000000000123',
    'has_fbclid', TRUE, 'fbclid', 'IwAR_must_never_be_stored', 'referrer_host', 'l.instagram.com',
    'landing_path', '/ru/universities/alpha/', 'seen_at', to_char(now() - INTERVAL '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'unknown_key', 'dropped')) ->> 'status' AS m1_w_ad \gset
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5003), p_name => 'M1 Web Google', p_phone => '+996555000003', p_age => NULL, p_city => 'Osh',
  p_country => 'Turkey', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(3),
  p_attribution => jsonb_build_object('utm_source', 'a@b.c', 'utm_term', '79991234567', 'referrer_host', 'www.google.com',
    'landing_path', '/ru/?x=1', 'seen_at', to_char(now() + INTERVAL '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ->> 'status' AS m1_w_google \gset
-- W4: an AI assistant referrer. W5: every mark is bad. W6: Taplink as a utm source.
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5004), p_name => 'M1 Web AI', p_phone => '+996555000004', p_age => 25, p_city => NULL,
  p_country => 'Italy', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(4),
  p_attribution => '{"referrer_host":"chatgpt.com"}'::JSONB) ->> 'status' AS m1_w_ai \gset
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5005), p_name => 'M1 Web Bad', p_phone => '+996555000005', p_age => 30, p_city => NULL,
  p_country => 'France', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(5),
  p_attribution => jsonb_build_object('utm_source', 'a b@c', 'utm_medium', repeat('x', 101), 'utm_campaign', 'call 79991234567',
    'utm_id', 'abc', 'referrer_host', 'not a host', 'landing_path', '/x?y=1', 'seen_at', 'yesterday',
    'has_fbclid', 'yes')) ->> 'status' AS m1_w_bad \gset
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5006), p_name => 'M1 Web Taplink', p_phone => '+996555000006', p_age => 22, p_city => NULL,
  p_country => 'Poland', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(6),
  p_attribution => '{"utm_source":"taplink","utm_medium":"bio"}'::JSONB) ->> 'status' AS m1_w_taplink \gset
-- W7: attribution that is not an object at all; the lead is still accepted.
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5007), p_name => 'M1 Web Scalar', p_phone => '+996555000007', p_age => 22, p_city => NULL,
  p_country => 'Germany', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(7), p_attribution => '"instagram"'::JSONB) ->> 'status' AS m1_w_scalar \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_w_old' = 'accepted' AND :'m1_w_ad' = 'accepted' AND :'m1_w_google' = 'accepted'
  AND :'m1_w_ai' = 'accepted' AND :'m1_w_bad' = 'accepted' AND :'m1_w_taplink' = 'accepted' AND :'m1_w_scalar' = 'accepted',
  'every submission is accepted, whatever its marks (no 400 from attribution)');

CREATE TEMP TABLE m1_web AS
  SELECT n, r.request_id, r.lead_id, r.payload FROM (VALUES (1, 5001), (2, 5002), (3, 5003), (4, 5004), (5, 5005), (6, 5006), (7, 5007)) v(n, k)
  JOIN platform_private.website_lead_receipts r ON r.request_id = pg_temp.m1_id(v.k);
GRANT SELECT ON m1_web TO authenticated, anon;
SELECT pg_temp.m1_assert((SELECT count(*) FROM m1_web) = 7 AND (SELECT count(DISTINCT lead_id) FROM m1_web) = 7
  AND (SELECT count(*) FROM platform.leads l JOIN m1_web w ON w.lead_id = l.id WHERE l.source_key = 'website') = 7,
  'seven receipts, seven website leads');
-- The OLD call's payload is the legacy payload, byte for byte: no attribution key anywhere.
SELECT pg_temp.m1_assert((SELECT payload FROM m1_web WHERE n = 1)
  = '{"age":20,"city":"Bishkek","name":"M1 Web Old","phone":"+996555000001","consent":true,"country":"Malaysia"}'::JSONB
  AND (SELECT payload FROM m1_web WHERE n = 2) = '{"age":19,"city":null,"name":"M1 Web Ad","phone":"+996555000002","consent":true,
    "country":"China","university":{"name":"Alpha University","slug":"alpha-university"}}'::JSONB
  AND NOT EXISTS (SELECT 1 FROM m1_web WHERE payload::TEXT ~* '(attribution|utm_|fbclid|referrer|landing|IwAR)'),
  'receipt payload is the legacy payload (plus university): attribution never enters it');
SELECT pg_temp.m1_assert((SELECT count(*) FROM platform_private.lead_attribution_touches) = 4
  AND NOT EXISTS (SELECT 1 FROM platform_private.lead_attribution_touches t JOIN m1_web w ON w.lead_id = t.lead_id WHERE w.n IN (1, 5, 7)),
  'a touch only where something survived: the old call, the all-bad marks and the scalar leave none');
-- W2: the complete touch, no fbclid value anywhere.
SELECT pg_temp.m1_assert((SELECT to_jsonb(t) - 'id' - 'created_at' - 'seen_at' FROM platform_private.lead_attribution_touches t
    JOIN m1_web w ON w.lead_id = t.lead_id WHERE w.n = 2)
  = jsonb_build_object('organization_id', pg_temp.m1_id(1), 'lead_id', (SELECT lead_id FROM m1_web WHERE n = 2),
    'touch_kind', 'website_form', 'evidence', 'utm_tagged', 'staff_channel', NULL, 'utm_source', 'instagram',
    'utm_medium', 'paid_social', 'utm_campaign', 'Весна 2026', 'utm_content', 'video-1', 'utm_term', 'adset-1',
    'utm_id', '120210000000000123', 'has_fbclid', TRUE, 'referrer_host', 'l.instagram.com',
    'landing_path', '/ru/universities/alpha/', 'request_id', pg_temp.m1_id(5002), 'created_by', NULL)
  AND (SELECT seen_at FROM platform_private.lead_attribution_touches t JOIN m1_web w ON w.lead_id = t.lead_id WHERE w.n = 2)
    BETWEEN now() - INTERVAL '25 hours' AND now() - INTERVAL '23 hours'
  AND NOT EXISTS (SELECT 1 FROM platform_private.lead_attribution_touches t WHERE to_jsonb(t)::TEXT ~ 'IwAR'),
  'W2 touch holds exactly the clean marks; fbclid is only a flag');
-- W3: bad marks are dropped one by one, the good one stays (referrer only, evidence referrer).
SELECT pg_temp.m1_assert((SELECT to_jsonb(t) - 'id' - 'created_at' - 'organization_id' - 'lead_id' - 'request_id'
    FROM platform_private.lead_attribution_touches t JOIN m1_web w ON w.lead_id = t.lead_id WHERE w.n = 3)
  = jsonb_build_object('touch_kind', 'website_form', 'evidence', 'referrer', 'staff_channel', NULL, 'utm_source', NULL,
    'utm_medium', NULL, 'utm_campaign', NULL, 'utm_content', NULL, 'utm_term', NULL, 'utm_id', NULL, 'has_fbclid', FALSE,
    'referrer_host', 'www.google.com', 'landing_path', NULL, 'seen_at', NULL, 'created_by', NULL),
  'W3: e-mail like source, phone-like term, a path with a query and a future seen_at are dropped; the referrer stays');
SELECT pg_temp.m1_assert((SELECT count(*) FROM platform_private.lead_attribution_touches t JOIN m1_web w ON w.lead_id = t.lead_id
    WHERE w.n = 4 AND t.referrer_host = 'chatgpt.com' AND t.evidence = 'referrer') = 1
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches t JOIN m1_web w ON w.lead_id = t.lead_id
    WHERE w.n = 6 AND t.utm_source = 'taplink' AND t.utm_medium = 'bio' AND t.evidence = 'utm_tagged') = 1,
  'AI referrer and Taplink touches stored');

-- Replay: the same requestId with different attribution is the normal accepted replay, no second touch.
SET LOCAL request.jwt.claims TO :'m1_service';
SET LOCAL ROLE service_role;
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5002), p_name => 'M1 Web Ad', p_phone => '+996555000002', p_age => 19, p_city => NULL,
  p_country => 'China', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(2),
  p_university => '{"slug":"alpha-university","name":"Alpha University"}'::JSONB,
  p_attribution => '{"utm_source":"google","utm_medium":"organic"}'::JSONB)::TEXT AS m1_replay_other_attribution \gset
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5002), p_name => 'M1 Web Ad', p_phone => '+996555000002', p_age => 19, p_city => NULL,
  p_country => 'China', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(2),
  p_university => '{"slug":"alpha-university","name":"Alpha University"}'::JSONB)::TEXT AS m1_replay_no_attribution \gset
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5002), p_name => 'M1 Web Changed', p_phone => '+996555000002', p_age => 19, p_city => NULL,
  p_country => 'China', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(2),
  p_university => '{"slug":"alpha-university","name":"Alpha University"}'::JSONB)::TEXT AS m1_replay_conflict \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_replay_other_attribution'::JSONB = jsonb_build_object('status', 'accepted', 'request_id', pg_temp.m1_id(5002))
  AND :'m1_replay_no_attribution'::JSONB = :'m1_replay_other_attribution'::JSONB
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches WHERE request_id = pg_temp.m1_id(5002)) = 1
  AND (SELECT utm_source FROM platform_private.lead_attribution_touches WHERE request_id = pg_temp.m1_id(5002)) = 'instagram',
  'replay with other or no attribution: accepted, one touch, the first write wins');
SELECT pg_temp.m1_assert((:'m1_replay_conflict'::JSONB ->> 'status') = 'request_conflict',
  'a changed receipt payload under the same requestId is still request_conflict (unchanged rule)');

-- A new request from a phone with an OPEN lead attaches to that lead (240) and adds a touch to it.
SET LOCAL request.jwt.claims TO :'m1_service';
SET LOCAL ROLE service_role;
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5011), p_name => 'M1 Web Ad Again', p_phone => '+996555000002', p_age => 19, p_city => NULL,
  p_country => 'China', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(11),
  p_attribution => '{"utm_source":"google","utm_medium":"organic","landing_path":"/ru/"}'::JSONB) ->> 'status' AS m1_attach_tagged \gset
-- The lead with no touch yet (W1, the old call) gets its first touch from a later submission.
SELECT platform.receive_website_lead(p_organization_id => pg_temp.m1_id(1), p_owner_membership_id => pg_temp.m1_id(302),
  p_request_id => pg_temp.m1_id(5012), p_name => 'M1 Web Old Again', p_phone => '+996555000001', p_age => 20, p_city => 'Bishkek',
  p_country => 'Malaysia', p_consent => TRUE, p_ip_hash => pg_temp.m1_hash(12),
  p_attribution => '{"referrer_host":"yandex.ru"}'::JSONB) ->> 'status' AS m1_attach_first \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_attach_tagged' = 'accepted' AND :'m1_attach_first' = 'accepted'
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.m1_id(1) AND source_key = 'website') = 7
  AND (SELECT lead_id FROM platform_private.website_lead_receipts WHERE request_id = pg_temp.m1_id(5011)) = (SELECT lead_id FROM m1_web WHERE n = 2)
  AND (SELECT lead_id FROM platform_private.website_lead_receipts WHERE request_id = pg_temp.m1_id(5012)) = (SELECT lead_id FROM m1_web WHERE n = 1)
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches WHERE lead_id = (SELECT lead_id FROM m1_web WHERE n = 2)) = 2
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches WHERE lead_id = (SELECT lead_id FROM m1_web WHERE n = 1)) = 1,
  'a repeated submission attaches to the open lead (no new lead) and adds a touch to it');

-- A client role can call neither intake nor read touches.
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format($q$SELECT platform.receive_website_lead(%L::UUID,%L::UUID,%L::UUID,'x','+996555000009',20,NULL,'China',TRUE,%L)$q$,
  pg_temp.m1_id(1), pg_temp.m1_id(302), pg_temp.m1_id(5099), pg_temp.m1_hash(99))) AS m1_intake_as_user \gset
SELECT pg_temp.m1_error('SELECT count(*) FROM platform_private.lead_attribution_touches') AS m1_touch_read_as_user \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_service';
SET LOCAL ROLE service_role;
SELECT pg_temp.m1_error('SELECT count(*) FROM platform_private.lead_attribution_touches') AS m1_touch_read_as_service \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_intake_as_user' = '42501' AND :'m1_touch_read_as_user' = '42501' AND :'m1_touch_read_as_service' = '42501',
  'authenticated cannot run the intake; neither authenticated nor service_role can read the touches directly');

-- Append-only: UPDATE, DELETE and TRUNCATE are refused (55000), even for the table owner.
SELECT pg_temp.m1_error($q$UPDATE platform_private.lead_attribution_touches SET utm_source = 'x'$q$) AS m1_touch_update \gset
SELECT pg_temp.m1_error($q$DELETE FROM platform_private.lead_attribution_touches$q$) AS m1_touch_delete \gset
SELECT pg_temp.m1_error($q$TRUNCATE platform_private.lead_attribution_touches$q$) AS m1_touch_truncate \gset
SELECT pg_temp.m1_assert(:'m1_touch_update' = '55000' AND :'m1_touch_delete' = '55000' AND :'m1_touch_truncate' = '55000',
  'touches are append-only: UPDATE, DELETE and TRUNCATE all refused');

-- The sanitizer on its own: the drop rules at their edges.
SELECT pg_temp.m1_assert(
  platform_private.sanitize_lead_attribution('{"utm_campaign":"Spring 2026","utm_content":"a_b-c.d:e~f"}'::JSONB)
    = '{"utm_campaign":"Spring 2026","utm_content":"a_b-c.d:e~f"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_source":"insta gram"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"utm_source":"ok","utm_medium":"1234567"}'::JSONB) = '{"utm_source":"ok"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_source":"ok","utm_medium":"123456"}'::JSONB) = '{"utm_source":"ok","utm_medium":"123456"}'::JSONB
  AND platform_private.sanitize_lead_attribution(jsonb_build_object('utm_source', repeat('a', 100))) IS NOT NULL
  AND platform_private.sanitize_lead_attribution(jsonb_build_object('utm_source', repeat('a', 101))) IS NULL
  AND platform_private.sanitize_lead_attribution('{"utm_id":"120210000000000123"}'::JSONB) = '{"utm_id":"120210000000000123"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_id":"12a"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"landing_path":"/ru/x/#a"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"landing_path":"ru/x/"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution(jsonb_build_object('landing_path', '/' || repeat('a', 200))) IS NULL
  AND platform_private.sanitize_lead_attribution(jsonb_build_object('landing_path', '/' || repeat('a', 199))) IS NOT NULL
  AND platform_private.sanitize_lead_attribution('{"referrer_host":"L.Instagram.COM"}'::JSONB) = '{"referrer_host":"l.instagram.com"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"referrer_host":"https://google.com/x"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"referrer_host":"localhost"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"has_fbclid":false}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"has_fbclid":true}'::JSONB) = '{"has_fbclid":true}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"seen_at":"2026-01-01T00:00:00Z"}'::JSONB) IS NULL
  AND platform_private.sanitize_lead_attribution('{"utm_source":"x","seen_at":"2026-10-01T00:00:00Z"}'::JSONB, TIMESTAMPTZ '2026-10-05 00:00+00')
    = '{"utm_source":"x","seen_at":"2026-10-01T00:00:00+00:00"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_source":"x","seen_at":"2026-09-01T00:00:00Z"}'::JSONB, TIMESTAMPTZ '2026-10-05 00:00+00')
    = '{"utm_source":"x"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_source":"x","seen_at":"2026-10-06T00:00:00Z"}'::JSONB, TIMESTAMPTZ '2026-10-05 00:00+00')
    = '{"utm_source":"x"}'::JSONB
  AND platform_private.sanitize_lead_attribution('{"utm_source":"x","seen_at":"2026-10-04T00:00:00"}'::JSONB, TIMESTAMPTZ '2026-10-05 00:00+00')
    = '{"utm_source":"x"}'::JSONB
  AND platform_private.sanitize_lead_attribution('[]'::JSONB) IS NULL AND platform_private.sanitize_lead_attribution(NULL) IS NULL,
  'sanitizer drop rules at their edges');

-- ---------------------------------------------------------------------------
-- 2. The channel rule on its own (one function for every read): the signal table.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m1_assert((SELECT bool_and((platform_private.attribution_signal(t.s, t.m, t.h)).channel IS NOT DISTINCT FROM t.channel
      AND (platform_private.attribution_signal(t.s, t.m, t.h)).basis IS NOT DISTINCT FROM t.basis
      AND (platform_private.attribution_signal(t.s, t.m, t.h)).ai_assistant IS NOT DISTINCT FROM t.ai)
    FROM (VALUES
      ('instagram', 'paid_social', NULL, 'instagram_ads', 'utm', FALSE),
      ('Instagram', 'CPC', NULL, 'instagram_ads', 'utm', FALSE),
      ('ig', 'paid', NULL, 'instagram_ads', 'utm', FALSE),
      ('instagram', 'social', NULL, 'instagram', 'utm', FALSE),
      ('instagram', NULL, NULL, 'instagram', 'utm', FALSE),
      ('taplink', 'bio', NULL, 'instagram', 'utm', FALSE),
      ('google', 'organic', NULL, 'website_search', 'utm', FALSE),
      ('bing', NULL, NULL, 'website_search', 'utm', FALSE),
      ('yandex', 'organic', NULL, 'website_search', 'utm', FALSE),
      ('google', 'cpc', NULL, 'unknown', 'unknown', FALSE),
      ('newsletter', 'email', 'www.google.com', 'unknown', 'unknown', FALSE),
      (NULL, NULL, 'instagram.com', 'instagram', 'referrer', FALSE),
      (NULL, NULL, 'l.instagram.com', 'instagram', 'referrer', FALSE),
      (NULL, NULL, 'evoadmissions.taplink.ws', 'instagram', 'referrer', FALSE),
      (NULL, NULL, 'www.google.com', 'website_search', 'referrer', FALSE),
      (NULL, NULL, 'google.com.tr', 'website_search', 'referrer', FALSE),
      (NULL, NULL, 'www.bing.com', 'website_search', 'referrer', FALSE),
      (NULL, NULL, 'yandex.ru', 'website_search', 'referrer', FALSE),
      (NULL, NULL, 'duckduckgo.com', 'website_search', 'referrer', FALSE),
      (NULL, NULL, 'chatgpt.com', 'website_search', 'referrer', TRUE),
      (NULL, NULL, 'perplexity.ai', 'website_search', 'referrer', TRUE),
      (NULL, NULL, 'gemini.google.com', 'website_search', 'referrer', TRUE),
      (NULL, NULL, 'copilot.microsoft.com', 'website_search', 'referrer', TRUE),
      (NULL, NULL, 'claude.ai', 'website_search', 'referrer', TRUE),
      (NULL, NULL, 'mail.google.com', 'unknown', 'unknown', FALSE),
      (NULL, NULL, 'evil-instagram.com', 'unknown', 'unknown', FALSE),
      (NULL, NULL, 'example.org', 'unknown', 'unknown', FALSE),
      (NULL, NULL, NULL, 'unknown', 'unknown', FALSE)) AS t(s, m, h, channel, basis, ai)),
  'attribution_signal: every row of the §3.2 mapping table (marks first, then referrer, else unknown; AI referrers flagged)');

-- ---------------------------------------------------------------------------
-- 3. The deterministic September dataset (direct fixtures; touches with explicit times).
--   L1 711 website, handed off (088) with case payments 100.00 USD, sale 10.09 (contract 2 000.00 USD), tag instagram/paid_social «Spring»
--   L2 712 website, referrer l.instagram.com, moved to «qualified» through the real command below
--   L3 713 website, closed (disqualified), no touch at all
--   L4 714 source instagram, no owner; staff said instagram_ads; its report record is only LINKED (import, 12.09, paid 500.00 EUR)
--   L5 715 whatsapp_manual; staff said referral, then two corrections (other, instagram); first payment confirmed 300.00 USD
--   L6 716 website; first touch google/organic, later instagram/paid_social (first wins); sale 02.10 paid 700.00 USD in its record
--   L7 717 website; staff said referral
--   L8 718 created 28.08 (outside), office; staff said other; sale 15.09
-- Records without a lead: M1 05.09, M2 archived 20.09, M3 no sale date, M4 30.08.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone)
SELECT pg_temp.m1_id(700 + k), pg_temp.m1_id(1), 'M1 Client ' || k, platform_private.normalize_person_name('M1 Client ' || k),
  '+99655510' || lpad(k::TEXT, 4, '0'), platform_private.normalize_person_phone('+99655510' || lpad(k::TEXT, 4, '0'))
FROM generate_series(11, 18) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.m1_id(700 + f.k), pg_temp.m1_id(1), pg_temp.m1_id(700 + f.k),
  CASE WHEN f.owner IS NULL THEN NULL ELSE pg_temp.m1_id(f.owner) END, f.stage, f.source,
  f.lifecycle::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES
  (11, 302, 'new', 'website', 'open', '2026-09-03 10:00+06'),
  (12, 302, 'new', 'website', 'open', '2026-09-04 10:00+06'),
  (13, 302, 'contacting', 'website', 'disqualified', '2026-09-05 10:00+06'),
  (14, NULL, 'new', 'instagram', 'open', '2026-09-06 10:00+06'),
  (15, 302, 'new', 'whatsapp_manual', 'open', '2026-09-07 10:00+06'),
  (16, 302, 'new', 'website', 'open', '2026-09-08 10:00+06'),
  (17, 302, 'new', 'website', 'open', '2026-09-20 10:00+06'),
  (18, 302, 'new', 'office', 'open', '2026-08-28 10:00+06')) AS f(k, owner, stage, source, lifecycle, created);
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, gate_state)
  SELECT pg_temp.m1_id(1), pg_temp.m1_id(700 + k), 'blocked' FROM unnest(ARRAY[11, 12, 13, 14, 16, 17, 18]) AS k;
-- L5: the first payment confirmed by hand (the gate): 300.00 USD received 09.09.
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, contract_confirmed, contract_confirmed_by_membership_id,
  contract_confirmed_by_profile_id, contract_confirmed_at, contract_evidence_reference, first_payment_amount,
  first_payment_currency, first_payment_due_date, first_payment_received_date, first_payment_confirmed_by_membership_id,
  first_payment_confirmed_by_profile_id, first_payment_confirmed_at, first_payment_evidence_reference, gate_state, gate_version)
VALUES (pg_temp.m1_id(1), pg_temp.m1_id(715), TRUE, pg_temp.m1_id(302), pg_temp.m1_id(202),
  '2026-09-08 11:00+06', 'M1 synthetic contract', 300, 'USD', DATE '2026-09-09', DATE '2026-09-09',
  pg_temp.m1_id(302), pg_temp.m1_id(202), '2026-09-09 12:00+06', 'M1 synthetic payment', 'satisfied', 3);
-- L1: a completed 088 handoff into an active case, with 100.00 USD paid through the case (189's payments).
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.m1_id(421), pg_temp.m1_id(1), 'student_case', pg_temp.m1_id(501), 1);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, canonical_lead_id, canonical_client_id)
VALUES (pg_temp.m1_id(501), pg_temp.m1_id(1), pg_temp.m1_id(302), pg_temp.m1_id(304),
  'synthetic:m1:1', 'M1 Student 1', 'MY', 'Bachelor', 'contract_confirmed', 'active', '2026-09-11 11:00+06',
  pg_temp.m1_id(421), 1, 'new', pg_temp.m1_id(711), pg_temp.m1_id(711));
INSERT INTO platform.sales_admissions_handoffs(id, organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links, handed_off_at)
VALUES (pg_temp.m1_id(801), pg_temp.m1_id(1), pg_temp.m1_id(711), pg_temp.m1_id(711), pg_temp.m1_id(501),
  'canonical-lead:' || pg_temp.m1_id(711)::TEXT, 'normal', 'M1 synthetic handoff',
  pg_temp.m1_id(302), pg_temp.m1_id(202), pg_temp.m1_id(304), 3, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB, '2026-09-11 11:00+06');
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency,
  due_at, next_action, total_paid_minor, created_by_membership_id)
VALUES (pg_temp.m1_id(811), pg_temp.m1_id(1), pg_temp.m1_id(501), 'M1 first tranche', 'evo_service_fee', 100000, 'USD',
  '2026-09-12 10:00+06', 'M1 collect', 10000, pg_temp.m1_id(302));
INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, amount_minor,
  currency, occurred_at, source_key, actor_membership_id, request_id)
VALUES (pg_temp.m1_id(812), pg_temp.m1_id(1), pg_temp.m1_id(501), pg_temp.m1_id(811), 'payment', 10000, 'USD',
  '2026-09-12 12:00+06', 'm1-synthetic', pg_temp.m1_id(302), pg_temp.m1_id(813));
-- Report records. Pipeline rows carry their lead; the import row is only linked to L4.
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind,
  lead_id, client_id, fields, archived, source_snapshot)
VALUES
  (pg_temp.m1_id(1011), pg_temp.m1_id(1), DATE '2026-09-01', pg_temp.m1_id(302), 'pipeline', pg_temp.m1_id(711), pg_temp.m1_id(711),
    '{"applicant_name":"M1 R11","signing_date":"2026-09-10","service_cost_minor":200000,"service_cost_currency":"USD"}', FALSE, '{}'),
  (pg_temp.m1_id(1016), pg_temp.m1_id(1), DATE '2026-10-01', pg_temp.m1_id(302), 'pipeline', pg_temp.m1_id(716), pg_temp.m1_id(716),
    '{"applicant_name":"M1 R16","signing_date":"2026-10-02","paid_minor":70000,"paid_currency":"USD"}', FALSE, '{}'),
  (pg_temp.m1_id(1018), pg_temp.m1_id(1), DATE '2026-09-01', pg_temp.m1_id(302), 'pipeline', pg_temp.m1_id(718), pg_temp.m1_id(718),
    '{"applicant_name":"M1 R18","signing_date":"2026-09-15"}', FALSE, '{}');
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint, archived, linked_lead_id)
VALUES (pg_temp.m1_id(1014), pg_temp.m1_id(1), DATE '2026-09-01', pg_temp.m1_id(302), 'import',
  '{"applicant_name":"M1 R14","signing_date":"2026-09-12","service_cost_minor":150000,"service_cost_currency":"USD","paid_minor":50000,"paid_currency":"EUR"}',
  'm1:sheet:14', repeat('ab', 32), 'M1 synthetic sheet', 14, '{}'::JSONB, 'm1-fp-14', FALSE, pg_temp.m1_id(714));
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields, archived)
SELECT pg_temp.m1_id(1900 + f.k), pg_temp.m1_id(1), f.month::DATE, pg_temp.m1_id(302), 'manual',
  jsonb_build_object('applicant_name', 'M1 M' || f.k) || CASE WHEN f.sale IS NULL THEN '{}'::JSONB ELSE jsonb_build_object('signing_date', f.sale) END,
  f.archived
FROM (VALUES (1, '2026-09-01', '2026-09-05', FALSE), (2, '2026-09-01', '2026-09-20', TRUE),
  (3, '2026-09-01', NULL, FALSE), (4, '2026-08-01', '2026-08-30', FALSE)) AS f(k, month, sale, archived);
-- Touches, with explicit times (the rule orders by the time of the record).
INSERT INTO platform_private.lead_attribution_touches(organization_id, lead_id, touch_kind, evidence, staff_channel, utm_source,
  utm_medium, utm_campaign, referrer_host, landing_path, request_id, created_by, created_at)
VALUES
  (pg_temp.m1_id(1), pg_temp.m1_id(711), 'website_form', 'utm_tagged', NULL, 'instagram', 'paid_social', 'Spring', NULL,
    '/ru/universities/alpha/', pg_temp.m1_id(6001), NULL, '2026-09-03 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(712), 'website_form', 'referrer', NULL, NULL, NULL, NULL, 'l.instagram.com', '/',
    pg_temp.m1_id(6002), NULL, '2026-09-04 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(714), 'staff_manual', 'staff_asserted', 'instagram_ads', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6003), pg_temp.m1_id(302), '2026-09-06 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(715), 'staff_manual', 'staff_asserted', 'referral', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6004), pg_temp.m1_id(302), '2026-09-07 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(715), 'staff_correction', 'staff_asserted', 'other', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6005), pg_temp.m1_id(302), '2026-09-07 12:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(715), 'staff_correction', 'staff_asserted', 'instagram', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6006), pg_temp.m1_id(302), '2026-09-08 09:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(716), 'website_form', 'utm_tagged', NULL, 'google', 'organic', 'Search', NULL, '/ru/',
    pg_temp.m1_id(6007), NULL, '2026-09-08 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(716), 'website_form', 'utm_tagged', NULL, 'instagram', 'paid_social', 'Spring', NULL, '/ru/',
    pg_temp.m1_id(6008), NULL, '2026-09-09 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(717), 'staff_manual', 'staff_asserted', 'referral', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6009), pg_temp.m1_id(302), '2026-09-20 10:00+06'),
  (pg_temp.m1_id(1), pg_temp.m1_id(718), 'staff_manual', 'staff_asserted', 'other', NULL, NULL, NULL, NULL, NULL,
    pg_temp.m1_id(6010), pg_temp.m1_id(302), '2026-08-28 10:00+06');
SET LOCAL session_replication_role = origin;

-- L2 enters «qualified» through the REAL workflow command (a receipt and its audit event).
SET LOCAL request.jwt.claims TO :'m1_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.mutate_sales_lead_workflow(pg_temp.m1_id(712), 1, pg_temp.m1_id(6101), 'qualified', pg_temp.m1_id(302), NULL, NULL, TRUE, NULL) ->> 'stage_key' AS m1_l2_stage \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_l2_stage' = 'qualified', 'L2 moved to qualified by the real command');

-- ---------------------------------------------------------------------------
-- 4. Channel projection (read_lead_channel_v1): rule cases, and nothing raw.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_sales_a';
SET LOCAL ROLE authenticated;
SELECT jsonb_object_agg(k::TEXT, platform.read_lead_channel_v1(pg_temp.m1_id(700 + k)))::TEXT AS m1_channels_owned
  FROM unnest(ARRAY[11, 12, 13, 15, 16, 17, 18]) AS k \gset
SELECT platform.read_lead_channel_v1((SELECT lead_id FROM m1_web WHERE n = 3))::TEXT AS m1_w3_channel \gset
RESET ROLE;
-- L4 has no owner: the department-scoped Sales Manager does not read it, the Admin does.
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.read_lead_channel_v1(pg_temp.m1_id(714))::TEXT AS m1_l4_channel \gset
RESET ROLE;
SELECT (:'m1_channels_owned'::JSONB || jsonb_build_object('14', :'m1_l4_channel'::JSONB))::TEXT AS m1_channels \gset
-- keys exactly {channel, basis, corrected, at}; the touches of L1..L8 resolve by the one rule.
SELECT pg_temp.m1_assert((SELECT bool_and(pg_temp.m1_keys(v) = ARRAY['at', 'basis', 'channel', 'corrected'])
    FROM jsonb_each(:'m1_channels'::JSONB) AS e(k, v)), 'the projection has exactly channel, basis, corrected, at');
SELECT pg_temp.m1_assert((:'m1_channels'::JSONB -> '11' ->> 'channel') = 'instagram_ads' AND (:'m1_channels'::JSONB -> '11' ->> 'basis') = 'utm'
  AND (:'m1_channels'::JSONB -> '12' ->> 'channel') = 'instagram' AND (:'m1_channels'::JSONB -> '12' ->> 'basis') = 'referrer'
  AND (:'m1_channels'::JSONB -> '13' ->> 'channel') = 'unknown' AND (:'m1_channels'::JSONB -> '13' ->> 'basis') = 'unknown'
  AND (:'m1_channels'::JSONB -> '13' -> 'at') = 'null'::JSONB
  AND (:'m1_channels'::JSONB -> '14' ->> 'channel') = 'instagram_ads' AND (:'m1_channels'::JSONB -> '14' ->> 'basis') = 'staff'
  AND (:'m1_channels'::JSONB -> '15' ->> 'channel') = 'instagram' AND (:'m1_channels'::JSONB -> '15' ->> 'basis') = 'corrected'
  AND (:'m1_channels'::JSONB -> '15' -> 'corrected') = 'true'::JSONB
  AND (:'m1_channels'::JSONB -> '16' ->> 'channel') = 'website_search' AND (:'m1_channels'::JSONB -> '16' ->> 'basis') = 'utm'
  AND (:'m1_channels'::JSONB -> '16' -> 'corrected') = 'false'::JSONB
  AND (:'m1_channels'::JSONB -> '17' ->> 'channel') = 'referral' AND (:'m1_channels'::JSONB -> '17' ->> 'basis') = 'staff'
  AND (:'m1_channels'::JSONB -> '18' ->> 'channel') = 'other',
  'channel rule: tag; referrer; no touch = unknown; staff words; the LATEST correction wins and is marked; the FIRST touch wins over a later one; staff words');
SELECT pg_temp.m1_assert((:'m1_w3_channel'::JSONB ->> 'channel') = 'website_search' AND (:'m1_w3_channel'::JSONB ->> 'basis') = 'referrer',
  'W3 (referrer google.com after its bad marks were dropped) is «Сайт и поиск» by referrer');
-- Raw marks stay out of reach: sales read neither the table nor any raw field through the projection.
SELECT pg_temp.m1_assert(:'m1_channels'::TEXT !~* '(utm_|landing|referrer_host|instagram\.com|Spring|/ru/)',
  'the projection carries no raw mark, page or referrer');
SET LOCAL request.jwt.claims TO :'m1_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.read_lead_channel_v1(%L::UUID)', pg_temp.m1_id(711))) AS m1_channel_b \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.read_lead_channel_v1(%L::UUID)', pg_temp.m1_id(711))) AS m1_channel_student \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.read_lead_channel_v1(%L::UUID)', pg_temp.m1_id(711))) AS m1_channel_none \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_anon';
SET LOCAL ROLE anon;
SELECT pg_temp.m1_error(format('SELECT platform.read_lead_channel_v1(%L::UUID)', pg_temp.m1_id(711))) AS m1_channel_anon \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_channel_b' = '42501' AND :'m1_channel_student' = '42501' AND :'m1_channel_none' = '42501' AND :'m1_channel_anon' = '42501',
  'read_lead_channel_v1: the other department, a Student, a caller without membership and anon are refused (42501)');
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.read_lead_channel_v1(%L::UUID)', pg_temp.m1_id(999))) AS m1_channel_missing \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_channel_missing' = '42501', 'read_lead_channel_v1: an unknown lead is a plain refusal, not a leak');

-- ---------------------------------------------------------------------------
-- 5. record_lead_touch: the right to edit the lead's sales workflow, idempotent, append-only.
--    (W1 and W2 are the website leads of section 1; every lead is owned by Sales Manager A.)
-- ---------------------------------------------------------------------------
SELECT lead_id AS m1_w1 FROM m1_web WHERE n = 1 \gset
SELECT lead_id AS m1_w2 FROM m1_web WHERE n = 2 \gset
SELECT lead_id AS m1_w5 FROM m1_web WHERE n = 5 \gset
SET LOCAL request.jwt.claims TO :'m1_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.record_lead_touch(:'m1_w1'::UUID, 'instagram', 'staff_correction', pg_temp.m1_id(7001))::TEXT AS m1_touch_1 \gset
SELECT platform.record_lead_touch(:'m1_w1'::UUID, 'instagram', 'staff_correction', pg_temp.m1_id(7001))::TEXT AS m1_touch_1_replay \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_correction', pg_temp.m1_id(7001))) AS m1_touch_conflict \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w2', 'instagram', 'staff_correction', pg_temp.m1_id(7001))) AS m1_touch_other_lead \gset
SELECT platform.record_lead_touch(:'m1_w1'::UUID, 'other', 'staff_correction', pg_temp.m1_id(7002))::TEXT AS m1_touch_2 \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'instagram', 'website_form', pg_temp.m1_id(7090))) AS m1_touch_bad_kind \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'facebook', 'staff_manual', pg_temp.m1_id(7091))) AS m1_touch_bad_channel \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,NULL)', :'m1_w1', 'other', 'staff_manual')) AS m1_touch_null_request \gset
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', pg_temp.m1_id(999), 'other', 'staff_manual', pg_temp.m1_id(7092))) AS m1_touch_missing_lead \gset
RESET ROLE;
SELECT pg_temp.m1_assert((:'m1_touch_1'::JSONB ->> 'status') = 'saved' AND (:'m1_touch_1'::JSONB ->> 'kind') = 'staff_correction'
  AND (:'m1_touch_1'::JSONB ->> 'channel') = 'instagram' AND (:'m1_touch_1'::JSONB ->> 'lead_id') = :'m1_w1'
  AND (:'m1_touch_1'::JSONB -> 'resolved' ->> 'channel') = 'instagram' AND (:'m1_touch_1'::JSONB -> 'resolved' ->> 'basis') = 'corrected'
  AND (:'m1_touch_1'::JSONB -> 'resolved' -> 'corrected') = 'true'::JSONB
  AND (SELECT created_by FROM platform_private.lead_attribution_touches WHERE id = (:'m1_touch_1'::JSONB ->> 'touch_id')::UUID) = pg_temp.m1_id(302)
  AND (SELECT evidence FROM platform_private.lead_attribution_touches WHERE id = (:'m1_touch_1'::JSONB ->> 'touch_id')::UUID) = 'staff_asserted',
  'record_lead_touch: the correction is written with its author and resolves to «instagram, исправлено»');
SELECT pg_temp.m1_assert((:'m1_touch_1_replay'::JSONB ->> 'touch_id') = (:'m1_touch_1'::JSONB ->> 'touch_id')
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches WHERE request_id = pg_temp.m1_id(7001)) = 1,
  'record_lead_touch: a replay by request id returns the same touch, writes nothing');
SELECT pg_temp.m1_assert(:'m1_touch_conflict' = '22023' AND :'m1_touch_other_lead' = '22023',
  'record_lead_touch: the same request id with another channel or lead is a conflict (22023)');
SELECT pg_temp.m1_assert((:'m1_touch_2'::JSONB -> 'resolved' ->> 'channel') = 'other'
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches WHERE lead_id = :'m1_w1'::UUID) = 3,
  'a later correction wins; the earlier touches (the later form touch, the first correction) all stay');
SELECT pg_temp.m1_assert(:'m1_touch_bad_kind' = '22023' AND :'m1_touch_bad_channel' = '22023' AND :'m1_touch_null_request' = '22023'
  AND :'m1_touch_missing_lead' = '42501',
  'record_lead_touch: an unknown kind or channel and a missing request id are 22023; an unknown lead is 42501');
-- Who may not: another department, Admissions (lead.read only), the Admissions Manager, a Student, no membership, anon, a coarse role without scoped access.
SET LOCAL request.jwt.claims TO :'m1_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7101))) AS m1_t_sales_b \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7102))) AS m1_t_admissions \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7103))) AS m1_t_admissions_manager \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7104))) AS m1_t_student \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7105))) AS m1_t_none \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_sales_coarse';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7106))) AS m1_t_coarse_sales \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_anon';
SET LOCAL ROLE anon;
SELECT pg_temp.m1_error(format('SELECT platform.record_lead_touch(%L::UUID,%L,%L,%L::UUID)', :'m1_w1', 'other', 'staff_manual', pg_temp.m1_id(7107))) AS m1_t_anon \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_t_sales_b' = '42501' AND :'m1_t_admissions' = '42501' AND :'m1_t_admissions_manager' = '42501'
  AND :'m1_t_student' = '42501' AND :'m1_t_none' = '42501' AND :'m1_t_coarse_sales' = '42501' AND :'m1_t_anon' = '42501'
  AND NOT EXISTS (SELECT 1 FROM platform_private.lead_attribution_touches WHERE request_id BETWEEN pg_temp.m1_id(7101) AND pg_temp.m1_id(7107)),
  'record_lead_touch: refused (42501) for the other department, Admissions, a Student, no membership, a coarse role without scope and anon; nothing written');
-- The Admin passes (the lead sales workflow key is held by the system admin everywhere).
-- A staff_manual touch AFTER an existing first touch is recorded but does not change the channel (the first touch rules);
-- on a lead that had no touch (W5) it IS the first touch, and «Не известно» stays «unknown».
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.record_lead_touch(:'m1_w2'::UUID, 'referral', 'staff_manual', pg_temp.m1_id(7201))::TEXT AS m1_admin_touch_after_first \gset
SELECT platform.record_lead_touch(:'m1_w5'::UUID, 'unknown', 'staff_manual', pg_temp.m1_id(7202))::TEXT AS m1_admin_touch_first \gset
RESET ROLE;
SELECT pg_temp.m1_assert((:'m1_admin_touch_after_first'::JSONB -> 'resolved' ->> 'channel') = 'instagram_ads'
  AND (:'m1_admin_touch_after_first'::JSONB -> 'resolved' ->> 'basis') = 'utm'
  AND (:'m1_admin_touch_first'::JSONB -> 'resolved' ->> 'channel') = 'unknown'
  AND (:'m1_admin_touch_first'::JSONB -> 'resolved' ->> 'basis') = 'unknown',
  'the first touch rules: a later staff_manual does not move the channel; «Не известно» stays unknown');

-- ---------------------------------------------------------------------------
-- 6. Manual sources: instagram and whatsapp_manual join the allowlist; whatsapp and the rest stay out.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_sales_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_manual_sales_lead(pg_temp.m1_id(1), pg_temp.m1_id(8001), 'M1 Manual Instagram', '+996555000091', NULL,
  'instagram', pg_temp.m1_id(302))::TEXT AS m1_manual_ig \gset
SELECT platform.create_manual_sales_lead(pg_temp.m1_id(1), pg_temp.m1_id(8002), 'M1 Manual WhatsApp', '+996555000092', NULL,
  'whatsapp_manual', pg_temp.m1_id(302))::TEXT AS m1_manual_wa \gset
SELECT platform.create_manual_sales_lead(pg_temp.m1_id(1), pg_temp.m1_id(8003), 'M1 Manual Office', '+996555000093', NULL,
  'office', pg_temp.m1_id(302))::TEXT AS m1_manual_office \gset
SELECT pg_temp.m1_error(format('SELECT platform.create_manual_sales_lead(%L::UUID,%L::UUID,%L,%L,NULL,%L,%L::UUID)',
  pg_temp.m1_id(1), pg_temp.m1_id(8004), 'M1 Manual Bad', '+996555000094', 'whatsapp', pg_temp.m1_id(302))) AS m1_manual_whatsapp \gset
SELECT pg_temp.m1_error(format('SELECT platform.create_manual_sales_lead(%L::UUID,%L::UUID,%L,%L,NULL,%L,%L::UUID)',
  pg_temp.m1_id(1), pg_temp.m1_id(8005), 'M1 Manual Bad', '+996555000095', 'telegram', pg_temp.m1_id(302))) AS m1_manual_telegram \gset
-- «Откуда узнал» is a separate call right after: the creation signature did not change.
SELECT platform.record_lead_touch((:'m1_manual_ig'::JSONB ->> 'lead_id')::UUID, 'instagram_ads', 'staff_manual', pg_temp.m1_id(8101))::TEXT AS m1_manual_touch \gset
SELECT platform.read_lead_channel_v1((:'m1_manual_ig'::JSONB ->> 'lead_id')::UUID)::TEXT AS m1_manual_channel \gset
RESET ROLE;
SELECT pg_temp.m1_assert((:'m1_manual_ig'::JSONB ->> 'status') = 'saved' AND (:'m1_manual_wa'::JSONB ->> 'status') = 'saved'
  AND (:'m1_manual_office'::JSONB ->> 'status') = 'saved'
  AND (SELECT source_key FROM platform.leads WHERE id = (:'m1_manual_ig'::JSONB ->> 'lead_id')::UUID) = 'instagram'
  AND (SELECT source_key FROM platform.leads WHERE id = (:'m1_manual_wa'::JSONB ->> 'lead_id')::UUID) = 'whatsapp_manual'
  AND (SELECT source_key FROM platform.leads WHERE id = (:'m1_manual_office'::JSONB ->> 'lead_id')::UUID) = 'office',
  'create_manual_sales_lead: instagram and whatsapp_manual are accepted, office still is');
SELECT pg_temp.m1_assert(:'m1_manual_whatsapp' = '22023' AND :'m1_manual_telegram' = '22023',
  'create_manual_sales_lead: whatsapp itself and an unknown source are still refused (22023)');
SELECT pg_temp.m1_assert((:'m1_manual_channel'::JSONB ->> 'channel') = 'instagram_ads' AND (:'m1_manual_channel'::JSONB ->> 'basis') = 'staff',
  'the manual Instagram lead with «Откуда узнал» = instagram_ads reads «со слов клиента»');
-- Neither new key enters the «Заявки» queue (221/250 keep website and whatsapp only); a website lead does.
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_requests_queue_v2(pg_temp.m1_id(1), 'all', 'all', 50)::TEXT AS m1_queue \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_queue' ~ (:'m1_w2')
  AND :'m1_queue' !~ (:'m1_manual_ig'::JSONB ->> 'lead_id') AND :'m1_queue' !~ (:'m1_manual_wa'::JSONB ->> 'lead_id'),
  'the requests queue still shows website leads and none of the manual instagram / whatsapp_manual leads');

-- ---------------------------------------------------------------------------
-- 7. Authorization of every admin RPC: positive platform_role = admin, nothing else passes.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.m1_admin_matrix() RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN concat_ws(',',
    pg_temp.m1_error('SELECT platform.marketing_overview_v1(DATE ''2026-09-01'', DATE ''2026-09-30'')'),
    pg_temp.m1_error('SELECT platform.marketing_leads_v1(DATE ''2026-09-01'', DATE ''2026-09-30'')'),
    pg_temp.m1_error(format('SELECT platform.marketing_spend_add_v1(%L::UUID, DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''USD'')', pg_temp.m1_id(9990))),
    pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(9991), pg_temp.m1_id(9992))));
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m1_admin_matrix() TO authenticated, anon, service_role;
SET LOCAL request.jwt.claims TO :'m1_sales_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_sales_a \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_sales_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_sales_b \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_admissions_manager \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_admissions \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_sales_coarse';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_coarse_sales \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_curator_coarse';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_coarse_curator \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_finance_coarse';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_coarse_finance \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_student \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_none';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_none \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_anon';
SET LOCAL ROLE anon;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_anon \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'m1_service';
SET LOCAL ROLE service_role;
SELECT pg_temp.m1_admin_matrix() AS m1_matrix_service \gset
RESET ROLE;
SELECT pg_temp.m1_assert((SELECT bool_and(v = '42501,42501,42501,42501') FROM (VALUES
    (:'m1_matrix_sales_a'), (:'m1_matrix_sales_b'), (:'m1_matrix_admissions_manager'), (:'m1_matrix_admissions'),
    (:'m1_matrix_coarse_sales'), (:'m1_matrix_coarse_curator'), (:'m1_matrix_coarse_finance'), (:'m1_matrix_student'),
    (:'m1_matrix_none'), (:'m1_matrix_anon'), (:'m1_matrix_service')) AS t(v)),
  'overview, list, spend add and spend cancel: refused with 42501 for the NULL-role Sales Manager (both departments), Admissions, the Admissions Manager, coarse sales / curator / finance, a Student, no membership, anon and service_role');
-- No privilege to the underlying tables either.
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.m1_error('SELECT count(*) FROM platform_private.marketing_manual_spend') AS m1_spend_read_as_admin \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_spend_read_as_admin' = '42501', 'even the Admin cannot read the spend table directly: only the RPCs');

-- ---------------------------------------------------------------------------
-- 8. Manual spend (Admin): add, idempotent replay, validation, cancel by a referencing row.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8201), DATE '2026-09-01', DATE '2026-09-30', 40000, 'USD', 'Spring', 'введено вручную')::TEXT AS m1_s1 \gset
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8201), DATE '2026-09-01', DATE '2026-09-30', 40000, 'USD', ' Spring ', 'введено вручную')::TEXT AS m1_s1_replay \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_add_v1(%L::UUID, DATE ''2026-09-01'', DATE ''2026-09-30'', 40001, ''USD'', ''Spring'', ''введено вручную'')', pg_temp.m1_id(8201))) AS m1_s1_conflict \gset
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8202), DATE '2026-08-20', DATE '2026-09-10', 100000, 'KGS')::TEXT AS m1_s2 \gset
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8203), DATE '2026-09-05', DATE '2026-09-06', 5000, 'USD', NULL, 'будет отменён')::TEXT AS m1_s3 \gset
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8204), DATE '2026-10-01', DATE '2026-10-05', 7000, 'USD')::TEXT AS m1_s4 \gset
SELECT platform.marketing_spend_add_v1(pg_temp.m1_id(8205), DATE '2026-09-10', DATE '2026-09-12', 2500, 'EUR', 'Retarget')::TEXT AS m1_s5 \gset
-- Validation: every bad value is 22023 and writes nothing.
SELECT string_agg(pg_temp.m1_error(format('SELECT platform.marketing_spend_add_v1(%L::UUID, %s)', pg_temp.m1_id(8300 + n), a)), ',' ORDER BY n) AS m1_spend_invalid
  FROM (VALUES
    (1, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 0, ''USD'''),
    (2, 'DATE ''2026-09-01'', DATE ''2026-09-30'', -5, ''USD'''),
    (3, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 1000000000001, ''USD'''),
    (4, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''usd'''),
    (5, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''US'''),
    (6, 'DATE ''2026-09-30'', DATE ''2026-09-01'', 100, ''USD'''),
    (7, 'DATE ''2026-01-01'', DATE ''2027-01-03'', 100, ''USD'''),
    (8, 'NULL, DATE ''2026-09-01'', 100, ''USD'''),
    (9, 'DATE ''2026-09-01'', DATE ''2026-09-30'', NULL, ''USD'''),
    (10, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''USD'', ' || quote_literal(repeat('c', 101))),
    (11, 'DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''USD'', NULL, ' || quote_literal(E'a\nb'))) AS v(n, a) \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_spend_add_v1(NULL, DATE ''2026-09-01'', DATE ''2026-09-30'', 100, ''USD'')') AS m1_spend_null_request \gset
-- Cancel: a referencing row; replay is the same answer; a second cancel and a cancel of a cancel are refused.
SELECT platform.marketing_spend_cancel_v1(pg_temp.m1_id(8401), (:'m1_s3'::JSONB ->> 'spend_id')::UUID)::TEXT AS m1_c3 \gset
SELECT platform.marketing_spend_cancel_v1(pg_temp.m1_id(8401), (:'m1_s3'::JSONB ->> 'spend_id')::UUID)::TEXT AS m1_c3_replay \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(8402), :'m1_s3'::JSONB ->> 'spend_id')) AS m1_c3_again \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(8403), pg_temp.m1_id(999))) AS m1_c_missing \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(8404), :'m1_c3'::JSONB ->> 'cancel_id')) AS m1_c_of_cancel \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(8401), :'m1_s1'::JSONB ->> 'spend_id')) AS m1_c_request_reused \gset
SELECT pg_temp.m1_error(format('SELECT platform.marketing_spend_cancel_v1(%L::UUID, %L::UUID)', pg_temp.m1_id(8201), :'m1_s1'::JSONB ->> 'spend_id')) AS m1_c_with_add_request \gset
RESET ROLE;
SELECT pg_temp.m1_assert((:'m1_s1'::JSONB ->> 'status') = 'saved' AND (:'m1_s1'::JSONB ->> 'amount_minor') = '40000'
  AND (:'m1_s1'::JSONB ->> 'currency') = 'USD' AND (:'m1_s1'::JSONB ->> 'campaign') = 'Spring'
  AND (:'m1_s1_replay'::JSONB ->> 'spend_id') = (:'m1_s1'::JSONB ->> 'spend_id')
  AND (SELECT count(*) FROM platform_private.marketing_manual_spend WHERE request_id = pg_temp.m1_id(8201)) = 1
  AND (SELECT created_by FROM platform_private.marketing_manual_spend WHERE request_id = pg_temp.m1_id(8201)) = pg_temp.m1_id(301)
  AND :'m1_s1_conflict' = '22023',
  'spend add: saved with its author; the replay returns the same entry; another amount under the same request id is a conflict');
SELECT pg_temp.m1_assert(:'m1_spend_invalid' = '22023,22023,22023,22023,22023,22023,22023,22023,22023,22023,22023' AND :'m1_spend_null_request' = '22023'
  AND (SELECT count(*) FROM platform_private.marketing_manual_spend WHERE request_id BETWEEN pg_temp.m1_id(8301) AND pg_temp.m1_id(8311)) = 0,
  'spend add: zero, negative or huge amounts, bad currency, reversed or over-long periods, nulls, a long campaign and a control character are all 22023, nothing written: '
    || :'m1_spend_invalid' || ' / ' || :'m1_spend_null_request');
SELECT pg_temp.m1_assert((:'m1_c3'::JSONB ->> 'status') = 'cancelled' AND (:'m1_c3'::JSONB ->> 'spend_id') = (:'m1_s3'::JSONB ->> 'spend_id')
  AND :'m1_c3_replay'::JSONB = :'m1_c3'::JSONB
  AND (SELECT count(*) FROM platform_private.marketing_manual_spend WHERE cancels_spend_id = (:'m1_s3'::JSONB ->> 'spend_id')::UUID) = 1
  AND (SELECT (amount_minor, currency, period_start, period_end)::TEXT FROM platform_private.marketing_manual_spend
    WHERE cancels_spend_id = (:'m1_s3'::JSONB ->> 'spend_id')::UUID)
    = (SELECT (amount_minor, currency, period_start, period_end)::TEXT FROM platform_private.marketing_manual_spend
    WHERE id = (:'m1_s3'::JSONB ->> 'spend_id')::UUID),
  'spend cancel: one referencing row copying the entry; the replay is the same answer');
SELECT pg_temp.m1_assert(:'m1_c3_again' = 'PT409' AND :'m1_c_missing' = 'P0002' AND :'m1_c_of_cancel' = '22023'
  AND :'m1_c_request_reused' = '22023' AND :'m1_c_with_add_request' = '22023',
  'spend cancel: a second cancel is PT409, an unknown entry P0002, a cancel of a cancel and a reused request id 22023');
SELECT pg_temp.m1_assert(pg_temp.m1_error($q$UPDATE platform_private.marketing_manual_spend SET amount_minor = 1$q$) = '55000'
  AND pg_temp.m1_error($q$DELETE FROM platform_private.marketing_manual_spend$q$) = '55000'
  AND pg_temp.m1_error($q$TRUNCATE platform_private.marketing_manual_spend$q$) = '55000',
  'the spend table is append-only');

-- ---------------------------------------------------------------------------
-- 9. Overview of September: block A (cohort), block B (sales), spend, reconciliation.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.m1_row(p_overview JSONB, p_block TEXT, p_key TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT e FROM jsonb_array_elements(p_overview -> p_block -> 'channels') e WHERE e ->> 'channel' = p_key
$$;
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.marketing_overview_v1(DATE '2026-09-01', DATE '2026-09-30')::TEXT AS m1_ov \gset
SELECT platform.staff_sales_count_v1(pg_temp.m1_id(1), DATE '2026-09-01', DATE '2026-09-30')::TEXT AS m1_count \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_overview_v1(DATE ''2026-09-30'', DATE ''2026-09-01'')') AS m1_ov_reversed \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_overview_v1(NULL, DATE ''2026-09-01'')') AS m1_ov_null \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_overview_v1(DATE ''2025-01-01'', DATE ''2026-09-01'')') AS m1_ov_long \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_overview_v1(DATE ''2025-09-01'', DATE ''2026-08-31'')') AS m1_ov_365 \gset
RESET ROLE;
SELECT pg_temp.m1_assert(:'m1_ov_reversed' = '22023' AND :'m1_ov_null' = '22023' AND :'m1_ov_long' = '22023' AND :'m1_ov_365' = 'ok',
  'overview: a reversed, open or over-366-day period is 22023; 365 days after the start is fine');
-- Block A: the cohort. Channel rows in the fixed order, an «unknown» row, the numbers of the dataset.
SELECT pg_temp.m1_assert((SELECT array_agg(e ->> 'channel') FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'cohort' -> 'channels') e)
    = ARRAY['instagram_ads', 'instagram', 'website_search', 'referral', 'other', 'unknown']
  AND (:'m1_ov'::JSONB ->> 'time_zone') = 'Asia/Bishkek'
  AND (:'m1_ov'::JSONB -> 'cohort' ->> 'total') = '7' AND (:'m1_ov'::JSONB -> 'cohort' ->> 'open_count') = '6'
  AND (:'m1_ov'::JSONB -> 'cohort' -> 'source_keys') = '{"website": 5, "instagram": 1, "whatsapp_manual": 1}'::JSONB
  AND (:'m1_ov'::JSONB -> 'cohort' ->> 'repeat_submissions') = '0'
  AND (SELECT sum((e ->> 'leads')::INTEGER) FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'cohort' -> 'channels') e) = 7,
  'cohort: 7 leads of September (L8 of August is out, the closed L3 is in), 6 of them open, every lead in exactly one channel row');
SELECT pg_temp.m1_assert((:'m1_ov'::JSONB -> 'cohort' -> 'totals') = '{"leads": 7, "qualified": 2, "handed_off": 1, "contract": 3,
    "contract_linked": 1, "paid": 3, "paid_without_amount": 0}'::JSONB,
  'cohort totals: qualified = L1 (handed off) + L2 (entered qualified); contract = L1, L4 (linked), L6; paid = L1 case, L5 gate, L6 report');
SELECT pg_temp.m1_assert(pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'instagram_ads') = '{"channel":"instagram_ads","leads":2,"qualified":1,
    "handed_off":1,"contract":2,"contract_linked":1,"paid":1,"paid_without_amount":0,"ai_assistant":0,
    "paid_amounts":[{"currency":"USD","amount_minor":"10000","leads":1}],
    "basis":{"utm":1,"referrer":0,"staff":1,"corrected":0,"unknown":0}}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'instagram') = '{"channel":"instagram","leads":2,"qualified":1,
    "handed_off":0,"contract":0,"contract_linked":0,"paid":1,"paid_without_amount":0,"ai_assistant":0,
    "paid_amounts":[{"currency":"USD","amount_minor":"30000","leads":1}],
    "basis":{"utm":0,"referrer":1,"staff":0,"corrected":1,"unknown":0}}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'website_search') = '{"channel":"website_search","leads":1,"qualified":0,
    "handed_off":0,"contract":1,"contract_linked":0,"paid":1,"paid_without_amount":0,"ai_assistant":0,
    "paid_amounts":[{"currency":"USD","amount_minor":"70000","leads":1}],
    "basis":{"utm":1,"referrer":0,"staff":0,"corrected":0,"unknown":0}}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'referral') = '{"channel":"referral","leads":1,"qualified":0,
    "handed_off":0,"contract":0,"contract_linked":0,"paid":0,"paid_without_amount":0,"ai_assistant":0,"paid_amounts":[],
    "basis":{"utm":0,"referrer":0,"staff":1,"corrected":0,"unknown":0}}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'other') = '{"channel":"other","leads":0,"qualified":0,
    "handed_off":0,"contract":0,"contract_linked":0,"paid":0,"paid_without_amount":0,"ai_assistant":0,"paid_amounts":[],
    "basis":{"utm":0,"referrer":0,"staff":0,"corrected":0,"unknown":0}}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'cohort', 'unknown') = '{"channel":"unknown","leads":1,"qualified":0,
    "handed_off":0,"contract":0,"contract_linked":0,"paid":0,"paid_without_amount":0,"ai_assistant":0,"paid_amounts":[],
    "basis":{"utm":0,"referrer":0,"staff":0,"corrected":0,"unknown":1}}'::JSONB,
  'cohort by channel: qualified, handed off, contract (L4 only LINKED), paid in each currency, and the basis of each channel');
-- Block B: the sales of the period by their own date, by the channel of their lead (linked_lead_id counts, flagged), plus «without lead».
SELECT pg_temp.m1_assert((:'m1_ov'::JSONB -> 'sales' ->> 'total') = '4'
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'sales', 'instagram_ads') = '{"channel":"instagram_ads","contracts":2,"linked_manually":1,
    "amount_missing":0,"amounts":[{"currency":"USD","amount_minor":"350000","contracts":2}]}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'sales', 'other') = '{"channel":"other","contracts":1,"linked_manually":0,
    "amount_missing":1,"amounts":[]}'::JSONB
  AND pg_temp.m1_row(:'m1_ov'::JSONB, 'sales', 'without_lead') = '{"channel":"without_lead","contracts":1,"linked_manually":0,
    "amount_missing":1,"amounts":[]}'::JSONB
  AND (SELECT sum((e ->> 'contracts')::INTEGER) FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'sales' -> 'channels') e) = 4
  AND (SELECT array_agg(e ->> 'channel') FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'sales' -> 'channels') e)
    = ARRAY['instagram_ads', 'instagram', 'website_search', 'referral', 'other', 'unknown', 'without_lead'],
  'sales of the period by sale date: L1 and the LINKED L4 to instagram_ads, L8 (an August lead) to other, the lead-less M1 to «without lead»; L6 (02.10) and the archived, undated and August records are not September sales');
SELECT pg_temp.m1_assert((:'m1_ov'::JSONB -> 'sales' -> 'reconciliation') = jsonb_build_object('by_channel_plus_without_lead', 4,
    'report_sales', (:'m1_count'::JSONB ->> 'sales')::INTEGER, 'difference', 0, 'matches', TRUE)
  AND (:'m1_count'::JSONB ->> 'sales') = '4',
  'reconciliation: by channel + without lead = staff_sales_count_v1 (the report «Продажи»), difference 0');
-- Spend: inside the period, partly overlapping (listed apart, never prorated), the cancelled and the outside ones absent.
SELECT pg_temp.m1_assert((SELECT array_agg((e ->> 'currency') || ':' || (e ->> 'amount_minor') ORDER BY e ->> 'currency')
      FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'spend' -> 'inside_totals') e) = ARRAY['EUR:2500', 'USD:40000']
  AND (SELECT array_agg((e ->> 'amount_minor') || (e ->> 'currency') ORDER BY e ->> 'created_at')
      FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'spend' -> 'inside_period') e) = ARRAY['40000USD', '2500EUR']
  AND (SELECT array_agg((e ->> 'amount_minor') || (e ->> 'currency')) FROM jsonb_array_elements(:'m1_ov'::JSONB -> 'spend' -> 'partially_overlapping') e)
    = ARRAY['100000KGS']
  AND NOT (:'m1_ov'::JSONB::TEXT ~ (:'m1_s3'::JSONB ->> 'spend_id')) AND NOT (:'m1_ov'::JSONB::TEXT ~ (:'m1_s4'::JSONB ->> 'spend_id'))
  AND (:'m1_ov'::JSONB -> 'spend' -> 'inside_period' -> 0 ->> 'id') = (:'m1_s1'::JSONB ->> 'spend_id'),
  'spend: 400.00 USD and 25.00 EUR inside, 1 000.00 KGS only partly overlapping (listed apart), the cancelled and the October entries absent, currencies never summed');
-- The overview carries counts and aggregates only: no name, phone or free text of a lead.
SELECT pg_temp.m1_assert(:'m1_ov'::TEXT !~* '(M1 Client|M1 Web|996555|lead_id|"name")', 'the overview holds no name, phone or lead id');

-- ---------------------------------------------------------------------------
-- 10. The leads list: the cohort with names, filters, paging by (created_at, id), nothing private.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30')::TEXT AS m1_all \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_limit => 3)::TEXT AS m1_p1 \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_limit => 3,
  p_cursor_created_at => (:'m1_p1'::JSONB -> 'next_cursor' ->> 'created_at')::TIMESTAMPTZ, p_cursor_id => (:'m1_p1'::JSONB -> 'next_cursor' ->> 'id')::UUID)::TEXT AS m1_p2 \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_limit => 3,
  p_cursor_created_at => (:'m1_p2'::JSONB -> 'next_cursor' ->> 'created_at')::TIMESTAMPTZ, p_cursor_id => (:'m1_p2'::JSONB -> 'next_cursor' ->> 'id')::UUID)::TEXT AS m1_p3 \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_channel => 'instagram_ads')::TEXT AS m1_f_channel \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_unknown_only => TRUE)::TEXT AS m1_f_unknown \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_campaign => 'Spring')::TEXT AS m1_f_campaign \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_stage => 'qualified')::TEXT AS m1_f_qualified \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_stage => 'handed_off')::TEXT AS m1_f_handed \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_stage => 'closed')::TEXT AS m1_f_closed \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_has_contract => TRUE)::TEXT AS m1_f_contract \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_has_contract => FALSE)::TEXT AS m1_f_nocontract \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_no_owner => TRUE)::TEXT AS m1_f_noowner \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_channel => 'instagram', p_has_contract => FALSE)::TEXT AS m1_f_combined \gset
SELECT platform.marketing_leads_v1(DATE '2026-09-01', DATE '2026-09-30', p_limit => 50)::TEXT AS m1_limit50 \gset
SELECT string_agg(pg_temp.m1_error(format('SELECT platform.marketing_leads_v1(DATE ''2026-09-01'', DATE ''2026-09-30'', %s)', a)), ',' ORDER BY n) AS m1_list_invalid
  FROM (VALUES (1, 'p_limit => 51'), (2, 'p_limit => 0'), (3, 'p_limit => NULL'),
    (4, 'p_cursor_created_at => now()'), (5, 'p_cursor_id => ' || quote_literal(pg_temp.m1_id(1))),
    (6, 'p_channel => ''facebook'''), (7, 'p_stage => ''won'''), (8, 'p_campaign => ' || quote_literal(repeat('c', 101)))) AS v(n, a) \gset
SELECT pg_temp.m1_error('SELECT platform.marketing_leads_v1(DATE ''2026-09-30'', DATE ''2026-09-01'')') AS m1_list_reversed \gset
RESET ROLE;
-- Paging: newest first, three pages of 3 + 3 + 1, no row twice, the cursor is exactly (created_at, id).
SELECT pg_temp.m1_assert((SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(717), pg_temp.m1_id(716), pg_temp.m1_id(715), pg_temp.m1_id(714), pg_temp.m1_id(713), pg_temp.m1_id(712), pg_temp.m1_id(711)]::TEXT[]
  AND (:'m1_all'::JSONB ->> 'total') = '7' AND (:'m1_all'::JSONB -> 'has_more') = 'false'::JSONB
  AND (:'m1_all'::JSONB -> 'next_cursor') = 'null'::JSONB AND (:'m1_limit50'::JSONB ->> 'total') = '7',
  'the whole September cohort, newest first, closed and unknown leads included (limit 50 is the maximum and fine)');
SELECT pg_temp.m1_assert((SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_p1'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(717), pg_temp.m1_id(716), pg_temp.m1_id(715)]::TEXT[]
  AND (:'m1_p1'::JSONB -> 'has_more') = 'true'::JSONB AND (:'m1_p1'::JSONB ->> 'total') = '7'
  AND (:'m1_p1'::JSONB -> 'next_cursor' ->> 'id') = pg_temp.m1_id(715)::TEXT
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_p2'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(714), pg_temp.m1_id(713), pg_temp.m1_id(712)]::TEXT[]
  AND (:'m1_p2'::JSONB -> 'has_more') = 'true'::JSONB AND (:'m1_p2'::JSONB -> 'next_cursor' ->> 'id') = pg_temp.m1_id(712)::TEXT
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_p3'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(711)]::TEXT[]
  AND (:'m1_p3'::JSONB -> 'has_more') = 'false'::JSONB AND (:'m1_p3'::JSONB -> 'next_cursor') = 'null'::JSONB,
  'paging by (created_at, id): pages of 3, 3 and 1, the cursor names the last row of the page, the last page closes it');
SELECT pg_temp.m1_assert(:'m1_list_invalid' = '22023,22023,22023,22023,22023,22023,22023,22023' AND :'m1_list_reversed' = '22023',
  'list: a limit over 50 or under 1, a half cursor, an unknown channel or stage, a long campaign and a reversed period are 22023');
-- Filters.
SELECT pg_temp.m1_assert((SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_channel'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(714), pg_temp.m1_id(711)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_unknown'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(713)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_campaign'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(711)]::TEXT[]
  AND (:'m1_f_campaign'::JSONB ->> 'total') = '1'
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_qualified'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(712)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_handed'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(711)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_closed'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(713)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_contract'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(716), pg_temp.m1_id(714), pg_temp.m1_id(711)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_nocontract'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(717), pg_temp.m1_id(715), pg_temp.m1_id(713), pg_temp.m1_id(712)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_noowner'::JSONB -> 'rows') e) = ARRAY[pg_temp.m1_id(714)]::TEXT[]
  AND (SELECT array_agg(e ->> 'lead_id') FROM jsonb_array_elements(:'m1_f_combined'::JSONB -> 'rows') e)
    = ARRAY[pg_temp.m1_id(715), pg_temp.m1_id(712)]::TEXT[],
  'filters: channel, «источник не известен», campaign, stage (qualified / handed_off / closed), has contract, no owner, and a combination');
-- Rows: exactly the allowed keys; no message, note, document, case or curator field.
SELECT pg_temp.m1_assert((SELECT bool_and(pg_temp.m1_keys(e) = ARRAY['ai_assistant', 'basis', 'campaign', 'channel',
        'contract_linked_manually', 'contract_signed_on', 'corrected', 'created_at', 'landing_path', 'lead_id', 'lifecycle_state', 'name',
        'owner', 'paid', 'phone', 'source_key', 'stage'])
      FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e)
  AND :'m1_all'::TEXT !~* '(message|note|document|curator|student_case|email|"text")', 'a row has exactly the agreed keys and no private field');
-- Row values.
SELECT pg_temp.m1_assert((SELECT e FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(711)::TEXT)
  = jsonb_build_object('lead_id', pg_temp.m1_id(711), 'name', 'M1 Client 11', 'phone', '+996555100011',
    'created_at', TIMESTAMPTZ '2026-09-03 10:00+06', 'source_key', 'website', 'channel', 'instagram_ads', 'basis', 'utm',
    'corrected', FALSE, 'ai_assistant', FALSE, 'campaign', 'Spring', 'landing_path', '/ru/universities/alpha/',
    'stage', 'handed_off', 'lifecycle_state', 'open', 'contract_signed_on', '2026-09-10', 'contract_linked_manually', FALSE,
    'paid', jsonb_build_object('amount_minor', '10000', 'currency', 'USD', 'source', 'case'),
    'owner', jsonb_build_object('membership_id', pg_temp.m1_id(302), 'name', 'M1 Actor 2')),
  'row L1: tag and campaign, landing page, handed off, contract date, paid through the case in its own currency, owner');
SELECT pg_temp.m1_assert((SELECT e ->> 'paid' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(714)::TEXT) IS NULL
  AND (SELECT e -> 'paid' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(714)::TEXT) = 'null'::JSONB
  AND (SELECT e -> 'contract_linked_manually' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(714)::TEXT) = 'true'::JSONB
  AND (SELECT e ->> 'contract_signed_on' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(714)::TEXT) = '2026-09-12'
  AND (SELECT e -> 'owner' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(714)::TEXT) = 'null'::JSONB,
  'row L4: contract through the LINKED record is flagged «связано вручную»; the linked record does not prove payment (the strip''s rule); no owner');
SELECT pg_temp.m1_assert((SELECT e -> 'paid' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(715)::TEXT)
    = '{"amount_minor":"30000","currency":"USD","source":"gate"}'::JSONB
  AND (SELECT e -> 'paid' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(716)::TEXT)
    = '{"amount_minor":"70000","currency":"USD","source":"report"}'::JSONB
  AND (SELECT e ->> 'basis' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(715)::TEXT) = 'corrected'
  AND (SELECT e -> 'corrected' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(715)::TEXT) = 'true'::JSONB
  AND (SELECT e ->> 'stage' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(713)::TEXT) = 'closed'
  AND (SELECT e ->> 'lifecycle_state' FROM jsonb_array_elements(:'m1_all'::JSONB -> 'rows') e WHERE e ->> 'lead_id' = pg_temp.m1_id(713)::TEXT) = 'disqualified',
  'paid chain order and sources: case payments, then the confirmed first payment (gate), then the report record; a closed lead shows «closed» and its lifecycle');

-- ---------------------------------------------------------------------------
-- 11. The same overview over the leads made today through the real paths (intake, manual form, record_lead_touch).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'m1_admin';
SET LOCAL ROLE authenticated;
SELECT platform.marketing_overview_v1(:'m1_dyn_from'::DATE, :'m1_dyn_to'::DATE)::TEXT AS m1_ov_today \gset
SELECT platform.marketing_leads_v1(:'m1_dyn_from'::DATE, :'m1_dyn_to'::DATE, p_unknown_only => TRUE)::TEXT AS m1_unknown_today \gset
RESET ROLE;
SELECT pg_temp.m1_assert((:'m1_ov_today'::JSONB -> 'cohort' ->> 'total') = '10' AND (:'m1_ov_today'::JSONB -> 'cohort' ->> 'open_count') = '10'
  AND (:'m1_ov_today'::JSONB -> 'cohort' ->> 'repeat_submissions') = '2'
  AND (:'m1_ov_today'::JSONB -> 'cohort' -> 'source_keys') = '{"website": 7, "instagram": 1, "whatsapp_manual": 1, "office": 1}'::JSONB
  AND (SELECT jsonb_object_agg(e ->> 'channel', (e ->> 'leads')::INTEGER) FROM jsonb_array_elements(:'m1_ov_today'::JSONB -> 'cohort' -> 'channels') e)
    = '{"instagram_ads": 2, "instagram": 1, "website_search": 2, "referral": 0, "other": 1, "unknown": 4}'::JSONB
  AND (pg_temp.m1_row(:'m1_ov_today'::JSONB, 'cohort', 'website_search') ->> 'ai_assistant') = '1'
  AND (pg_temp.m1_row(:'m1_ov_today'::JSONB, 'cohort', 'other') -> 'basis' ->> 'corrected') = '1'
  AND (pg_temp.m1_row(:'m1_ov_today'::JSONB, 'cohort', 'unknown') -> 'basis' ->> 'unknown') = '4',
  'today: the intake leads and the manual leads land in their channels by the one rule (W2 keeps its tag after later touches, W1 is corrected to «other», W5 stays unknown, the AI referrer is flagged), 2 repeat submissions');
SELECT pg_temp.m1_assert((SELECT count(*) FROM jsonb_array_elements(:'m1_unknown_today'::JSONB -> 'rows') e) = 4
  AND (SELECT bool_and(e ->> 'channel' = 'unknown') FROM jsonb_array_elements(:'m1_unknown_today'::JSONB -> 'rows') e),
  'the «источник не известен» filter is the work queue of leads still to be asked');

SELECT 'M1_MARKETING_SUITE_OK' AS m1_suite_marker;
ROLLBACK;
