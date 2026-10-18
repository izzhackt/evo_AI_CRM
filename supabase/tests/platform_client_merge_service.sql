\set ON_ERROR_STOP on
-- Boundary suite for migration 308 (owner 18.10.2026: «Склей подтверждённые пары сам через служебную
-- функцию с dry-run»): platform.merge_clients_owner_confirmed_v1, platform.close_sales_lead_already_student_v1,
-- the shared merge taken out of platform.resolve_client_duplicate, and the closed receipts. Members are
-- modelled like production after 155 and 244 (as in platform_sales_report_withdrawal.sql): only the system
-- Admin carries the coarse role plus is_system_admin and an organization scope; the service calls are made as
-- the service path makes them (service_role, no user JWT, the owner's Admin as the actor). Every identity
-- switch goes through pg_temp.cms_as / cms_json (claims and role local to the transaction, role always reset).
-- Proves:
--  0. catalog and posture: both calls are definer with the empty search_path and callable by service_role
--     only, the helpers by nobody, resolve_client_duplicate keeps its grant (authenticated) and its answer;
--     the receipts are closed (forced RLS, no client privilege, append-only); the candidate basis list
--     is widened by `owner_confirmed` and by nothing else;
--  1. the public resolve_client_duplicate as before: success with exactly the old answer keys, replay,
--     conflict 23505, a non-Admin and the Student refused, a pair that is not the candidate's, a closed candidate;
--  2. merge_clients_owner_confirmed_v1: the service boundary (a `sub` in the claims, authenticated, anon),
--     the Admin actor (not a system Admin, Sales, the Student, a suspended Admin, no membership, another
--     organization), strict parameters, clients of another organization, a missing client, the same client,
--     a client that is not live, a closed candidate, two student cabinets (one cabinet is fine), a lead
--     pinned by a report sale (and the other direction is fine);
--  3. the effect: leads, case and conversation move, the merged client becomes `merged` and an alias, the
--     bystander's candidate goes stale, external identifiers read through the alias, the candidate is made
--     with `owner_confirmed` or the open one of the pair is used;
--  4. contacts: an empty phone / e-mail of the kept client is filled (the unique index of active clients
--     does not interfere), a differing one is kept and noted on the active case (and in the receipt), the same
--     number in another spelling is no conflict, a second merge into the same kept client writes a note and
--     overwrites nothing, a pair another active client already holds is not copied;
--  5. receipts: replay (`replayed`), another body / actor / operation under the key is PT409, the receipt
--     keeps both clients as they were; dry-run (a rolled-back call leaves nothing);
--  6. close_sales_lead_already_student_v1: the service boundary and actor, strict parameters, success (a case in
--     work, a pending case, a case finished as «Поступил», a lead of a merged client after the merge), the
--     lifecycle of 246 (disqualified, stage kept, read by staff_closed_leads_v1 and returned by
--     set_lead_closed_v1), every refusal (no case, a case finished otherwise, a handed-off lead, the lead a case
--     was opened on, a lead that is not open, a missing or foreign lead, a lead without a client), replay and PT409;
--  7. the whole journal: no name, phone, e-mail or note text; the receipts are append-only and shaped.
-- Isolated synthetic SQL fixtures only.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $cms_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$cms_auth_role$;

CREATE FUNCTION pg_temp.cms_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('308e0000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.cms_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CMS: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement ('42501:message'), or 'ok'.
CREATE FUNCTION pg_temp.cms_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The statement as another identity: the claims and the role are local to the transaction and the role is
-- always reset. cms_as answers 'ok' or 'SQLSTATE:message'; cms_json answers the one value (a SELECT yielding
-- JSONB) and lets an error through.
CREATE FUNCTION pg_temp.cms_as(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; answer := 'ok';
  EXCEPTION WHEN OTHERS THEN answer := SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.cms_json(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE answer JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO answer;
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.cms_svc(p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.cms_as('{"role":"service_role"}', 'service_role', p_sql)
$$;
CREATE FUNCTION pg_temp.cms_svc_json(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.cms_json('{"role":"service_role"}', 'service_role', p_sql)
$$;
CREATE FUNCTION pg_temp.cms_keys(j JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k COLLATE "C"), ARRAY[]::TEXT[]) FROM jsonb_object_keys(j) AS k
$$;
-- The grantees of EXECUTE other than the owner ('PUBLIC' for the pseudo-role).
CREATE FUNCTION pg_temp.cms_grantees(p_fn REGPROCEDURE) RETURNS TEXT[] LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END
      ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END), ARRAY[]::TEXT[])
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid = p_fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
$$;
-- The command strings (run through cms_svc / cms_svc_json).
CREATE FUNCTION pg_temp.cms_merge(p_ref TEXT, p_keep UUID, p_merge UUID, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1,
  p_source TEXT DEFAULT 'cms-merge', p_reason TEXT DEFAULT 'CMS synthetic merge') RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.merge_clients_owner_confirmed_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L::UUID, %L)',
    pg_temp.cms_id(p_org), pg_temp.cms_id(p_actor), p_source, p_ref, p_keep, p_merge, p_reason)
$$;
CREATE FUNCTION pg_temp.cms_close(p_ref TEXT, p_lead UUID, p_note TEXT DEFAULT NULL, p_actor INTEGER DEFAULT 301,
  p_org INTEGER DEFAULT 1, p_source TEXT DEFAULT 'cms-close', p_reason TEXT DEFAULT 'CMS synthetic closure')
  RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.close_sales_lead_already_student_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L, %L)',
    pg_temp.cms_id(p_org), pg_temp.cms_id(p_actor), p_source, p_ref, p_lead, p_note, p_reason)
$$;
-- Whether a JSON array holds exactly these ids, in any order.
CREATE FUNCTION pg_temp.cms_same_ids(j JSONB, VARIADIC ids UUID[]) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE((SELECT array_agg(v ORDER BY v) FROM jsonb_array_elements_text(j) v), ARRAY[]::TEXT[])
    = COALESCE((SELECT array_agg(x::TEXT ORDER BY x::TEXT) FROM unnest(ids) x), ARRAY[]::TEXT[])
$$;
GRANT EXECUTE ON FUNCTION pg_temp.cms_id(INTEGER), pg_temp.cms_assert(BOOLEAN, TEXT), pg_temp.cms_error(TEXT),
  pg_temp.cms_keys(JSONB), pg_temp.cms_same_ids(JSONB, UUID[]) TO authenticated, anon, service_role;

SELECT 'CMS_CLIENT_MERGE_SERVICE_SUITE_START' AS cms_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Catalog and posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.cms_assert(f.config = ARRAY['search_path=""'] AND f.secdef AND pg_temp.cms_grantees(f.fn) = f.grantees,
  f.fn::TEXT || ': definer, search_path and grantees as intended (grantees ' || pg_temp.cms_grantees(f.fn)::TEXT || ')')
FROM (
  SELECT x.fn, p.proconfig AS config, p.prosecdef AS secdef, x.grantees
  FROM (VALUES
    ('platform.merge_clients_owner_confirmed_v1(uuid,uuid,text,text,uuid,uuid,text)'::REGPROCEDURE, ARRAY['service_role']),
    ('platform.close_sales_lead_already_student_v1(uuid,uuid,text,text,uuid,text,text)'::REGPROCEDURE, ARRAY['service_role']),
    ('platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE, ARRAY['authenticated']),
    ('platform_private.client_duplicate_open_candidate(uuid,uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.client_duplicate_pair_is_live(uuid,uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.client_duplicate_apply_resolution(uuid,uuid,uuid,text,uuid,uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.client_merge_service_actor(uuid,uuid,text[])'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.client_merge_snapshot(uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.client_has_student_cabinet(uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[])
  ) AS x(fn, grantees) JOIN pg_proc p ON p.oid = x.fn
) AS f;
-- The receipts table is closed.
SELECT pg_temp.cms_assert(c.relrowsecurity AND c.relforcerowsecurity
    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT') AND NOT has_table_privilege('anon', c.oid, 'SELECT')
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT') AND NOT has_table_privilege('service_role', c.oid, 'INSERT')
    AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid),
  'the receipts table: forced RLS, no policy, no client privilege')
FROM pg_class c WHERE c.oid = 'platform_private.client_merge_service_receipts'::regclass;
SELECT pg_temp.cms_assert((SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'platform_private.client_duplicate_candidates'::regclass
      AND conname = 'client_duplicate_candidates_match_basis_check')
  LIKE '%name%email%phone%multiple_weak%owner_confirmed%', 'the candidate basis list gained `owner_confirmed`');
-- The old answer of the public function: its source changed (the middle and the end are the shared helpers).
SELECT pg_temp.cms_assert(md5(prosrc) <> '6a8b40b3bbb26ef0a429a9e6e84157f1'
    AND strpos(prosrc, 'client_duplicate_open_candidate') > 0 AND strpos(prosrc, 'client_duplicate_apply_resolution') > 0,
  'resolve_client_duplicate calls the shared merge')
FROM pg_proc WHERE oid = 'platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)'::regprocedure;
-- One merge: no second copy of the moving statements.
SELECT pg_temp.cms_assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('platform', 'platform_private')
      AND strpos(p.prosrc, 'SET canonical_client_id = p_survivor_client_id') > 0) = 1,
  'only the shared helper moves the cases of a merged client');

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system), 2 second Admin (system), 3 coarse Admin who is not a system Admin,
-- 4 coarse Sales, 5 / 7 / 8 / 9 Students (cabinets), 6 system Admin whose membership is suspended. Organization 2:
-- Admin 20.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE cms_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO cms_actors(n, coarse) VALUES (1, 'admin'), (2, 'admin'), (3, 'admin'), (4, 'sales'), (5, 'student'), (6, 'admin'),
  (7, 'student'), (8, 'student'), (9, 'student');
GRANT SELECT ON cms_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.cms_id(1), 'CMS Fictional organization'),
  (pg_temp.cms_id(2), 'CMS Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.cms_id(100 + n), 'cms-' || n || '@example.invalid', '{}'::JSONB FROM cms_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.cms_id(199), 'cms-none@example.invalid', '{}'::JSONB),
  (pg_temp.cms_id(120), 'cms-org2-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.cms_id(200 + n), pg_temp.cms_id(100 + n), 'CMS Actor ' || n, 'active', 1 FROM cms_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.cms_id(220), pg_temp.cms_id(120), 'CMS Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.cms_id(300 + n), pg_temp.cms_id(1), pg_temp.cms_id(200 + n),
    CASE WHEN a.n = 6 THEN 'suspended'::platform.membership_status ELSE 'active'::platform.membership_status END, a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM cms_actors a;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.cms_id(320), pg_temp.cms_id(2), pg_temp.cms_id(220), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.cms_id(301), pg_temp.cms_id(302), pg_temp.cms_id(306), pg_temp.cms_id(320));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.cms_id(401), pg_temp.cms_id(1), 'organization', pg_temp.cms_id(1), 1),
  (pg_temp.cms_id(402), pg_temp.cms_id(2), 'organization', pg_temp.cms_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.cms_id(1), pg_temp.cms_id(301), pg_temp.cms_id(401), 1, 1, TRUE, 'system', 'CMS synthetic organization scope', pg_temp.cms_id(601)),
  (pg_temp.cms_id(1), pg_temp.cms_id(302), pg_temp.cms_id(401), 1, 1, TRUE, 'system', 'CMS synthetic organization scope', pg_temp.cms_id(602)),
  (pg_temp.cms_id(2), pg_temp.cms_id(320), pg_temp.cms_id(402), 1, 1, TRUE, 'system', 'CMS synthetic organization scope', pg_temp.cms_id(603));

UPDATE cms_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.cms_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.cms_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
CREATE TEMP TABLE cms_claims AS SELECT n, claims FROM cms_actors;
INSERT INTO cms_claims VALUES
  (99, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.cms_id(199),
    'claims', jsonb_build_object('sub', pg_temp.cms_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT),
  (20, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.cms_id(120),
    'claims', jsonb_build_object('sub', pg_temp.cms_id(120), 'role', 'authenticated'))) -> 'claims')::TEXT);
GRANT SELECT ON cms_claims TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.cms_user(p_n INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.cms_as((SELECT claims FROM cms_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
CREATE FUNCTION pg_temp.cms_user_json(p_n INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.cms_json((SELECT claims FROM cms_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
CREATE FUNCTION pg_temp.cms_anon(p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.cms_as('', 'anon', p_sql)
$$;

SELECT pg_temp.cms_assert(
  (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.cms_id(1), pg_temp.cms_id(301))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.cms_id(1), pg_temp.cms_id(302))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.cms_id(1), pg_temp.cms_id(303))) = 'staff'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.cms_id(1), pg_temp.cms_id(304))) = 'staff'
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(pg_temp.cms_id(1), pg_temp.cms_id(306)))
  AND platform_private.staff_has_permission(pg_temp.cms_id(1), pg_temp.cms_id(301), 'client.duplicate.resolve')
  AND platform_private.staff_has_permission(pg_temp.cms_id(1), pg_temp.cms_id(301), 'lead.sales.workflow.manage')
  AND platform_private.staff_has_permission(pg_temp.cms_id(1), pg_temp.cms_id(301), 'lead.read'),
  'fixture: members 301 and 302 are system Admins holding the permissions, 303 and 304 are staff, 306 is suspended');

-- People. A client is made the way every intake makes it (create_or_link_client), a lead the same way.
CREATE TEMP TABLE cms_c(k TEXT PRIMARY KEY, id UUID NOT NULL);
CREATE TEMP TABLE cms_l(k TEXT PRIMARY KEY, id UUID NOT NULL);
GRANT SELECT ON cms_c, cms_l TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.cms_mk_client(p_k TEXT, p_name TEXT, p_email TEXT, p_phone TEXT, p_org INTEGER DEFAULT 1) RETURNS UUID
  LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := platform_private.create_or_link_client(pg_temp.cms_id(p_org), p_name, p_email, p_phone, 'cms', 'client', 'cms-client-' || p_k,
    'manual_entry', TIMESTAMPTZ '2026-10-01 08:00:00+00', NULL, 'safe:cms-' || p_k);
  INSERT INTO cms_c VALUES (p_k, v);
  RETURN v;
END
$$;
CREATE FUNCTION pg_temp.cms_mk_lead(p_k TEXT, p_client TEXT, p_org INTEGER DEFAULT 1) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := platform_private.create_or_link_lead(pg_temp.cms_id(p_org), (SELECT id FROM cms_c WHERE k = p_client), NULL,
    'new', 'manual', 'cms', 'lead', 'cms-lead-' || p_k, 'manual_entry', TIMESTAMPTZ '2026-10-01 08:10:00+00', NULL,
    'safe:cms-lead-' || p_k);
  INSERT INTO cms_l VALUES (p_k, v);
  RETURN v;
END
$$;
CREATE FUNCTION pg_temp.cms_cl(p_k TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT id FROM cms_c WHERE k = p_k $$;
CREATE FUNCTION pg_temp.cms_ld(p_k TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT id FROM cms_l WHERE k = p_k $$;

-- Pair A: the kept client has nothing but a name; the merged one has e-mail and phone, two leads (one with a
-- case), a conversation and a bystander candidate.
SELECT pg_temp.cms_mk_client('KA', 'CMS Keep Alpha', NULL, NULL), pg_temp.cms_mk_client('MA', 'CMS Merge Alpha', 'cms-ma@example.invalid', '+996555000101'),
  pg_temp.cms_mk_client('XA', 'CMS Bystander Alpha', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LKA', 'KA'), pg_temp.cms_mk_lead('LKA2', 'KA'), pg_temp.cms_mk_lead('LMA', 'MA'), pg_temp.cms_mk_lead('LMA2', 'MA');
-- Pair B: both have contacts and differ; the kept client has an active case.
SELECT pg_temp.cms_mk_client('KB', 'CMS Keep Bravo', 'cms-kb@example.invalid', '+996555000201'),
  pg_temp.cms_mk_client('MB', 'CMS Merge Bravo', 'cms-mb@example.invalid', '+996555000202');
SELECT pg_temp.cms_mk_lead('LKB', 'KB'), pg_temp.cms_mk_lead('LMB', 'MB');
-- Pair B2: a phone that differs and no active case (the kept client's only case is finished); the merged client's
-- e-mail fills the kept client's empty one.
SELECT pg_temp.cms_mk_client('KB2', 'CMS Keep Bravo Two', NULL, '+996555000211'),
  pg_temp.cms_mk_client('MB2', 'CMS Merge Bravo Two', 'cms-mb2@example.invalid', '+996555000212');
SELECT pg_temp.cms_mk_lead('LKB2', 'KB2'), pg_temp.cms_mk_lead('LMB2', 'MB2');
-- Pair B3: the same phone in another spelling and the same e-mail in another case.
SELECT pg_temp.cms_mk_client('KB3', 'CMS Keep Bravo Three', 'cms-kb3@example.invalid', '+996555000301'),
  pg_temp.cms_mk_client('MB3', 'CMS Merge Bravo Three', 'CMS-KB3@Example.Invalid', '0555000301');
SELECT pg_temp.cms_mk_lead('LKB3', 'KB3'), pg_temp.cms_mk_lead('LMB3', 'MB3');
-- Pair C: two clients merged one after the other into one kept client with an active case.
SELECT pg_temp.cms_mk_client('KC', 'CMS Keep Charlie', NULL, NULL), pg_temp.cms_mk_client('MC1', 'CMS Merge Charlie One', 'cms-mc1@example.invalid', '+996555000401'),
  pg_temp.cms_mk_client('MC2', 'CMS Merge Charlie Two', 'cms-mc2@example.invalid', '+996555000402');
SELECT pg_temp.cms_mk_lead('LKC', 'KC'), pg_temp.cms_mk_lead('LMC1', 'MC1'), pg_temp.cms_mk_lead('LMC2', 'MC2');
-- Pair D: a third active client holds exactly the pair (kept e-mail, merged phone).
SELECT pg_temp.cms_mk_client('KD', 'CMS Keep Delta', 'cms-d@example.invalid', NULL), pg_temp.cms_mk_client('MD', 'CMS Merge Delta', NULL, '+996555000501'),
  pg_temp.cms_mk_client('TD', 'CMS Third Delta', 'cms-d@example.invalid', '+996555000501');
SELECT pg_temp.cms_mk_lead('LKD', 'KD'), pg_temp.cms_mk_lead('LMD', 'MD');
-- Pair F: two clients of the same name: the system made an open candidate for them already (basis `name`).
SELECT pg_temp.cms_mk_client('KF', 'CMS Twin Person', NULL, NULL), pg_temp.cms_mk_client('MF', 'CMS Twin Person', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LKF', 'KF'), pg_temp.cms_mk_lead('LMF', 'MF');
-- Pair G: both have a student cabinet. Pair H: a closed candidate. Pair I: the merged client's lead is pinned.
-- Pair J: a client that is not live.
SELECT pg_temp.cms_mk_client('KG', 'CMS Keep Golf', NULL, NULL), pg_temp.cms_mk_client('MG', 'CMS Merge Golf', NULL, NULL),
  pg_temp.cms_mk_client('KH', 'CMS Keep Hotel', NULL, NULL), pg_temp.cms_mk_client('MH', 'CMS Merge Hotel', NULL, NULL),
  pg_temp.cms_mk_client('KI', 'CMS Keep India', NULL, NULL), pg_temp.cms_mk_client('MI', 'CMS Merge India', NULL, NULL),
  pg_temp.cms_mk_client('KJ', 'CMS Keep Juliet', NULL, NULL), pg_temp.cms_mk_client('MJ', 'CMS Merge Juliet', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LKG', 'KG'), pg_temp.cms_mk_lead('LMG', 'MG'), pg_temp.cms_mk_lead('LKI', 'KI'), pg_temp.cms_mk_lead('LMI', 'MI');
-- Pair K: the merged client's case carries a student cabinet (the case, and the cabinet with it, moves).
SELECT pg_temp.cms_mk_client('KK', 'CMS Keep Kilo', NULL, NULL), pg_temp.cms_mk_client('MK', 'CMS Merge Kilo', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LKK', 'KK'), pg_temp.cms_mk_lead('LMK', 'MK');
-- The public function's pair (R) and a bystander of it.
SELECT pg_temp.cms_mk_client('KR', 'CMS Keep Romeo', NULL, NULL), pg_temp.cms_mk_client('MR', 'CMS Merge Romeo', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LKR', 'KR'), pg_temp.cms_mk_lead('LMR', 'MR');
-- Closure fixtures: N no case, P pending case, E finished «Поступил», D finished «Отказался», Z handed off,
-- Q a lead without a client.
SELECT pg_temp.cms_mk_client('KN', 'CMS Client November', NULL, NULL), pg_temp.cms_mk_client('KP', 'CMS Client Papa', NULL, NULL),
  pg_temp.cms_mk_client('KE', 'CMS Client Echo Enrolled', NULL, NULL), pg_temp.cms_mk_client('KDC', 'CMS Client Declined', NULL, NULL),
  pg_temp.cms_mk_client('KZ', 'CMS Client Zulu', NULL, NULL);
SELECT pg_temp.cms_mk_lead('LN', 'KN'), pg_temp.cms_mk_lead('LP', 'KP'), pg_temp.cms_mk_lead('LE', 'KE'), pg_temp.cms_mk_lead('LDC', 'KDC'),
  pg_temp.cms_mk_lead('LZ', 'KZ'), pg_temp.cms_mk_lead('LP2', 'KP'), pg_temp.cms_mk_lead('LE2', 'KE'), pg_temp.cms_mk_lead('LDC2', 'KDC'),
  pg_temp.cms_mk_lead('LZ2', 'KZ'), pg_temp.cms_mk_lead('LN2', 'KN');
-- Organization 2: a pair and a lead.
SELECT pg_temp.cms_mk_client('K2', 'CMS Org2 Keep', NULL, NULL, 2), pg_temp.cms_mk_client('M2', 'CMS Org2 Merge', NULL, NULL, 2);
SELECT pg_temp.cms_mk_lead('L2', 'M2', 2);

-- Cases, conversations, a handoff and a pipeline sale are laid down as the owner with the triggers off (as 246's
-- suite does); everything that follows runs with them on.
CREATE FUNCTION pg_temp.cms_mk_case(p_n INTEGER, p_client TEXT, p_lead TEXT, p_state TEXT, p_student INTEGER DEFAULT NULL) RETURNS UUID
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
    VALUES (pg_temp.cms_id(7000 + p_n), pg_temp.cms_id(1), 'student_case', pg_temp.cms_id(7500 + p_n), 1);
  INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
    source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
    current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at,
    canonical_client_id, canonical_lead_id, closed_at)
  VALUES (pg_temp.cms_id(7500 + p_n), pg_temp.cms_id(1), pg_temp.cms_id(301),
    CASE WHEN p_state = 'pending' THEN NULL ELSE pg_temp.cms_id(301) END,
    'synthetic:cms:' || p_n, 'CMS Student ' || p_n, 'MY', 'Bachelor', 'contract_confirmed', p_state::platform.student_case_state,
    CASE WHEN p_state = 'pending' THEN NULL ELSE clock_timestamp() END,
    pg_temp.cms_id(7000 + p_n), 1, 'new',
    CASE WHEN p_student IS NULL THEN NULL ELSE pg_temp.cms_id(300 + p_student) END,
    CASE WHEN p_student IS NULL THEN NULL ELSE clock_timestamp() END,
    (SELECT id FROM cms_c WHERE k = p_client), (SELECT id FROM cms_l WHERE k = p_lead),
    CASE WHEN p_state = 'closed' THEN clock_timestamp() END);
  RETURN pg_temp.cms_id(7500 + p_n);
END
$$;
SET LOCAL session_replication_role = replica;
-- 1 KA's own case (with a student cabinet), 2 MA's case, 3 KB's active case, 4 KB2's finished case, 5 KC's active case,
-- 6 KD's active case, 7 / 8 the cases of pair G with a cabinet each, 9 KP's pending case, 10 KE's active case (closed below
-- as «Поступил»), 11 KDC's active case (closed below as «Отказался»), 12 KR's case, 13 MR's case, 14 KZ's case (handed off),
-- 15 KN2... (none), 16 KI's case.
SELECT pg_temp.cms_mk_case(1, 'KA', 'LKA', 'active', 5), pg_temp.cms_mk_case(2, 'MA', 'LMA', 'active'),
  pg_temp.cms_mk_case(3, 'KB', 'LKB', 'active'), pg_temp.cms_mk_case(4, 'KB2', 'LKB2', 'closed'),
  pg_temp.cms_mk_case(5, 'KC', 'LKC', 'active'), pg_temp.cms_mk_case(6, 'KD', 'LKD', 'active'),
  pg_temp.cms_mk_case(7, 'KG', 'LKG', 'active', 7), pg_temp.cms_mk_case(8, 'MG', 'LMG', 'active', 8),
  pg_temp.cms_mk_case(9, 'KP', 'LP', 'pending'), pg_temp.cms_mk_case(10, 'KE', 'LE', 'active'),
  pg_temp.cms_mk_case(11, 'KDC', 'LDC', 'active'), pg_temp.cms_mk_case(12, 'KR', 'LKR', 'active'),
  pg_temp.cms_mk_case(13, 'MR', 'LMR', 'active'), pg_temp.cms_mk_case(14, 'KZ', 'LZ', 'active'),
  pg_temp.cms_mk_case(16, 'KI', 'LKI', 'active'), pg_temp.cms_mk_case(17, 'MK', 'LMK', 'active', 9);
-- Conversations: MA's (moves with the merge) and MR's. Each rests on a stored provider event (the foreign key is
-- checked again when a row laid down in this transaction is updated).
INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256,
  received_at, request_id)
SELECT pg_temp.cms_id(7850 + k), pg_temp.cms_id(1), 'waha', 'waha:crm_primary', NULL, NULL, 'cms-event-' || k, 'crm_primary',
  'cms-event-' || k, 'session.status', TIMESTAMPTZ '2026-10-01 08:00:00+00', 'verified',
  '{"event":"session.status","session":"crm_primary","payload":{"name":"crm_primary","status":"WORKING"}}'::JSONB,
  '{"hmac_verified":true}'::JSONB, 'synthetic:cms:' || k, repeat('3', 64), TIMESTAMPTZ '2026-10-01 08:00:01+00', pg_temp.cms_id(7860 + k)
FROM generate_series(0, 1) AS k;
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id, sales_authority_source, queue,
  status, subject, waha_session_name, canonical_client_id, current_scope_id, current_scope_version, created_from_webhook_event_id)
VALUES (pg_temp.cms_id(7800), pg_temp.cms_id(1), pg_temp.cms_id(301), 'platform_intake', 'sales', 'open', 'CMS subject A', 'crm_primary',
    pg_temp.cms_cl('MA'), pg_temp.cms_id(401), 1, pg_temp.cms_id(7850)),
  (pg_temp.cms_id(7801), pg_temp.cms_id(1), pg_temp.cms_id(301), 'platform_intake', 'sales', 'open', 'CMS subject R', 'crm_primary',
    pg_temp.cms_cl('MR'), pg_temp.cms_id(401), 1, pg_temp.cms_id(7851));
-- A completed 088 handoff of Z's lead on its case, and a pipeline sale that pins I's lead.
INSERT INTO platform.sales_admissions_handoffs(id, organization_id, lead_id, client_id, student_case_id, source_key, handoff_mode,
  reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version, gate_state, workflow_version,
  sales_context, client_context, provenance, conversation_links)
VALUES (pg_temp.cms_id(7900), pg_temp.cms_id(1), pg_temp.cms_ld('LZ'), pg_temp.cms_cl('KZ'), pg_temp.cms_id(7514),
  'canonical-lead:' || pg_temp.cms_ld('LZ'), 'normal', 'CMS handoff', pg_temp.cms_id(301), pg_temp.cms_id(201), pg_temp.cms_id(301),
  1, 'satisfied', 1, '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB);
INSERT INTO platform_private.sales_register(id, organization_id, report_month, source_kind, lead_id, client_id, fields, source_snapshot)
VALUES (pg_temp.cms_id(7950), pg_temp.cms_id(1), DATE '2026-10-01', 'pipeline', pg_temp.cms_ld('LMI'), pg_temp.cms_cl('MI'),
  '{}'::JSONB, '{}'::JSONB);
-- Two calls of the merged client MA: one on its lead (288 follows the lead: ON UPDATE CASCADE), one on the client only.
INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, started_at, match_state, created_via, client_id, lead_id)
VALUES (pg_temp.cms_id(7960), pg_temp.cms_id(1), 'cms-call-1', 'in', TIMESTAMPTZ '2026-10-02 08:00:00+00', 'matched', 'webhook',
    pg_temp.cms_cl('MA'), pg_temp.cms_ld('LMA2')),
  (pg_temp.cms_id(7961), pg_temp.cms_id(1), 'cms-call-2', 'in', TIMESTAMPTZ '2026-10-02 09:00:00+00', 'matched', 'webhook',
    pg_temp.cms_cl('MA'), NULL);
SET LOCAL session_replication_role = origin;

-- Candidates: a bystander of pair A, the stale one of pair H, the public function's (R), and the one the system made for F.
INSERT INTO platform_private.client_duplicate_candidates(id, organization_id, left_client_id, right_client_id, match_basis)
SELECT pg_temp.cms_id(c.n), pg_temp.cms_id(1), LEAST(pg_temp.cms_cl(c.a), pg_temp.cms_cl(c.b)), GREATEST(pg_temp.cms_cl(c.a), pg_temp.cms_cl(c.b)), c.basis
FROM (VALUES (7700, 'MA', 'XA', 'phone'), (7701, 'KH', 'MH', 'email'), (7702, 'KR', 'MR', 'phone'), (7703, 'MR', 'XA', 'name'),
  (7704, 'KG', 'MG', 'name')) AS c(n, a, b, basis);
UPDATE platform_private.client_duplicate_candidates SET status = 'stale', resolved_at = statement_timestamp()
  WHERE id = pg_temp.cms_id(7701);
SELECT pg_temp.cms_assert((SELECT count(*) = 1 AND bool_and(status = 'open' AND match_basis = 'name')
    FROM platform_private.client_duplicate_candidates
    WHERE organization_id = pg_temp.cms_id(1) AND left_client_id = LEAST(pg_temp.cms_cl('KF'), pg_temp.cms_cl('MF'))
      AND right_client_id = GREATEST(pg_temp.cms_cl('KF'), pg_temp.cms_cl('MF'))),
  'fixture: the system made an open `name` candidate for the twins');
SELECT pg_temp.cms_assert(NOT EXISTS (SELECT 1 FROM platform_private.client_duplicate_candidates
    WHERE organization_id = pg_temp.cms_id(1) AND left_client_id = LEAST(pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))
      AND right_client_id = GREATEST(pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))),
  'fixture: pair A has no candidate yet');

-- A fingerprint of everything the calls may write.
CREATE FUNCTION pg_temp.cms_state() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT concat_ws('/',
    (SELECT md5(COALESCE(string_agg(c.id::TEXT || ':' || c.lifecycle_state || ':' || COALESCE(c.phone, '-') || ':' || COALESCE(c.email, '-'),
      '|' ORDER BY c.id), '')) FROM platform.clients c),
    (SELECT md5(COALESCE(string_agg(l.id::TEXT || ':' || COALESCE(l.client_id::TEXT, '-') || ':' || l.lifecycle_state, '|' ORDER BY l.id), ''))
      FROM platform.leads l),
    (SELECT md5(COALESCE(string_agg(s.id::TEXT || ':' || COALESCE(s.canonical_client_id::TEXT, '-') || ':' || s.state, '|' ORDER BY s.id), ''))
      FROM platform.student_cases s),
    (SELECT md5(COALESCE(string_agg(v.id::TEXT || ':' || COALESCE(v.canonical_client_id::TEXT, '-'), '|' ORDER BY v.id), ''))
      FROM platform.communication_conversations v),
    (SELECT md5(COALESCE(string_agg(d.id::TEXT || ':' || d.status, '|' ORDER BY d.id), '')) FROM platform_private.client_duplicate_candidates d),
    (SELECT count(*) FROM platform_private.client_duplicate_resolutions),
    (SELECT count(*) FROM platform_private.client_aliases),
    (SELECT count(*) FROM platform_private.client_merge_service_receipts),
    (SELECT count(*) FROM platform.audit_events),
    (SELECT count(*) FROM platform.case_notes))
$$;

-- ---------------------------------------------------------------------------
-- 1. The public resolve_client_duplicate as before (the Admin as a signed-in user).
-- ---------------------------------------------------------------------------
SELECT pg_temp.cms_state() AS cms_state_before_resolve \gset
-- Not an Admin, the Student, anon: refused as before (the candidate stays open).
SELECT pg_temp.cms_assert(
  pg_temp.cms_user(4, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS reason', pg_temp.cms_id(7710)))
    = '42501:Active Admin duplicate-resolution authority is required'
  AND pg_temp.cms_user(5, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS reason', pg_temp.cms_id(7710)))
    = '42501:Active Admin duplicate-resolution authority is required'
  AND pg_temp.cms_anon(format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS reason', pg_temp.cms_id(7710))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_state() = :'cms_state_before_resolve',
  'resolve_client_duplicate: a Sales member, the Student and anon are refused and nothing changes');
-- Malformed input, a candidate that does not exist, a pair that is not the candidate's.
SELECT pg_temp.cms_assert(
  pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('KR'), 'CMS reason', pg_temp.cms_id(7711))) = '22023:Malformed client duplicate resolution'
  AND pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7799),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS reason', pg_temp.cms_id(7712))) = 'P0002:Duplicate candidate does not exist'
  AND pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('KA'), 'CMS reason', pg_temp.cms_id(7713))) = '23514:Resolution clients do not match the candidate pair'
  AND pg_temp.cms_state() = :'cms_state_before_resolve',
  'resolve_client_duplicate: malformed input, a missing candidate and a foreign pair are refused with the old codes');
SELECT pg_temp.cms_user_json(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
  pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS public reason', pg_temp.cms_id(7714)))::TEXT AS cms_resolve_1 \gset
SELECT pg_temp.cms_assert(pg_temp.cms_keys(:'cms_resolve_1'::JSONB) = ARRAY['candidate_id', 'organization_id', 'request_id',
    'resolution_id', 'resolved_at', 'superseded_client_id', 'survivor_client_id']
  AND :'cms_resolve_1'::JSONB ->> 'survivor_client_id' = pg_temp.cms_cl('KR')::TEXT
  AND :'cms_resolve_1'::JSONB ->> 'superseded_client_id' = pg_temp.cms_cl('MR')::TEXT
  AND :'cms_resolve_1'::JSONB ->> 'candidate_id' = pg_temp.cms_id(7702)::TEXT,
  'resolve_client_duplicate: the answer has exactly the old keys (no `moved`)');
SELECT pg_temp.cms_assert((SELECT lifecycle_state = 'merged' FROM platform.clients WHERE id = pg_temp.cms_cl('MR'))
  AND (SELECT lifecycle_state = 'active' FROM platform.clients WHERE id = pg_temp.cms_cl('KR'))
  AND (SELECT client_id = pg_temp.cms_cl('KR') FROM platform.leads WHERE id = pg_temp.cms_ld('LMR'))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KR') FROM platform.student_cases WHERE id = pg_temp.cms_id(7513))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KR') FROM platform.communication_conversations WHERE id = pg_temp.cms_id(7801))
  AND (SELECT status = 'resolved' FROM platform_private.client_duplicate_candidates WHERE id = pg_temp.cms_id(7702))
  AND (SELECT status = 'stale' FROM platform_private.client_duplicate_candidates WHERE id = pg_temp.cms_id(7703))
  AND (SELECT canonical_client_id FROM platform_private.client_aliases WHERE superseded_client_id = pg_temp.cms_cl('MR')) = pg_temp.cms_cl('KR')
  AND (SELECT reason = 'CMS public reason' AND actor_membership_id = pg_temp.cms_id(301) FROM platform_private.client_duplicate_resolutions
    WHERE request_id = pg_temp.cms_id(7714)),
  'resolve_client_duplicate: lead, case and conversation moved, the merged client is `merged` and an alias, the bystander candidate went stale');
SELECT pg_temp.cms_assert(pg_temp.cms_user_json(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS public reason', pg_temp.cms_id(7714))) = :'cms_resolve_1'::JSONB,
  'resolve_client_duplicate: an exact replay returns the first answer');
SELECT pg_temp.cms_assert(
  pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS another reason', pg_temp.cms_id(7714))) = '23505:Duplicate resolution request UUID conflicts'
  AND pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7702),
    pg_temp.cms_cl('KR'), pg_temp.cms_cl('MR'), 'CMS reason', pg_temp.cms_id(7715)))
    = '55000:Duplicate candidate is stale or already resolved',
  'resolve_client_duplicate: the same request with another reason is 23505, a resolved candidate is refused');
SELECT pg_temp.cms_assert(
  pg_temp.cms_user(1, format('SELECT platform.resolve_client_duplicate(%L, %L, %L, %L, %L)', pg_temp.cms_id(7703),
    pg_temp.cms_cl('MR'), pg_temp.cms_cl('XA'), 'CMS reason', pg_temp.cms_id(7716))) = '55000:Duplicate candidate is stale or already resolved',
  'resolve_client_duplicate: the stale candidate of the merged client is refused');

-- ---------------------------------------------------------------------------
-- 2. merge_clients_owner_confirmed_v1: the boundary, the actor, strict parameters, the pair rules.
-- ---------------------------------------------------------------------------
SELECT pg_temp.cms_state() AS cms_state_before_refusals \gset
-- The service boundary: a `sub` in the claims (even with the service role), authenticated, anon.
SELECT pg_temp.cms_assert(
  pg_temp.cms_as(format('{"role":"service_role","sub":"%s"}', pg_temp.cms_id(101)), 'service_role',
    pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) = '42501:client_merge_forbidden'
  AND pg_temp.cms_as('{"role":"service_role","sub":""}', 'service_role',
    pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) = '42501:client_merge_forbidden'
  AND pg_temp.cms_as(format('{"role":"authenticated","sub":"%s"}', pg_temp.cms_id(101)), 'authenticated',
    pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_user(1, pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_anon(pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_state() = :'cms_state_before_refusals',
  'merge: a `sub` (also an empty one), authenticated and anon are refused and nothing is written');
-- The actor: only an active system Admin of the organization.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), r.actor)) = '42501:client_merge_forbidden',
  'merge: ' || r.what || ' is refused')
FROM (VALUES (303, 'a coarse Admin who is not a system Admin'), (304, 'a Sales member'), (305, 'a Student'),
  (306, 'a system Admin whose membership is suspended'), (399, 'a membership that does not exist'),
  (320, 'the Admin of another organization')) AS r(actor, what);
SELECT pg_temp.cms_assert(
  pg_temp.cms_svc(format('SELECT platform.merge_clients_owner_confirmed_v1(NULL, %L, ''cms-merge'', ''r1'', %L, %L, ''CMS'')',
    pg_temp.cms_id(301), pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) = '42501:client_merge_forbidden'
  AND pg_temp.cms_svc(format('SELECT platform.merge_clients_owner_confirmed_v1(%L, NULL, ''cms-merge'', ''r1'', %L, %L, ''CMS'')',
    pg_temp.cms_id(1), pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) = '42501:client_merge_forbidden',
  'merge: no organization or no actor is refused');
-- Strict parameters: every refusal names its key.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = r.expected, 'merge: ' || r.what)
FROM (VALUES
  ('an import source that is not a label', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'Bad Source'), '22023:client_merge_invalid:importSource'),
  ('an import source of one character', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'x'), '22023:client_merge_invalid:importSource'),
  ('an empty external reference', pg_temp.cms_merge('   ', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA')), '22023:client_merge_invalid:externalRef'),
  ('an external reference of 201 characters', pg_temp.cms_merge(repeat('r', 201), pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA')), '22023:client_merge_invalid:externalRef'),
  ('an external reference with a control character', pg_temp.cms_merge('r' || chr(7), pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA')), '22023:client_merge_invalid:externalRef'),
  ('an empty reason', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'cms-merge', '  '), '22023:client_merge_invalid:reason'),
  ('a reason of 501 characters', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'cms-merge', repeat('x', 501)), '22023:client_merge_invalid:reason'),
  ('a reason with a line break', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'cms-merge', 'two' || chr(10) || 'lines'), '22023:client_merge_invalid:reason'),
  ('no kept client', format('SELECT platform.merge_clients_owner_confirmed_v1(%L, %L, ''cms-merge'', ''r1'', NULL, %L, ''CMS'')',
    pg_temp.cms_id(1), pg_temp.cms_id(301), pg_temp.cms_cl('MA')), '22023:client_merge_invalid:keepClientId'),
  ('no merged client', format('SELECT platform.merge_clients_owner_confirmed_v1(%L, %L, ''cms-merge'', ''r1'', %L, NULL, ''CMS'')',
    pg_temp.cms_id(1), pg_temp.cms_id(301), pg_temp.cms_cl('KA')), '22023:client_merge_invalid:mergeClientId'),
  ('the same client twice', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('KA')), '22023:client_merge_invalid:sameClient')
) AS r(what, sql, expected);
-- Clients: another organization's, a missing one.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = r.expected, 'merge: ' || r.what)
FROM (VALUES
  ('a merged client of another organization', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('M2')), '22023:client_merge_invalid:organization'),
  ('a kept client of another organization', pg_temp.cms_merge('r1', pg_temp.cms_cl('K2'), pg_temp.cms_cl('MA')), '22023:client_merge_invalid:organization'),
  ('two clients of another organization called in this one', pg_temp.cms_merge('r1', pg_temp.cms_cl('K2'), pg_temp.cms_cl('M2')), '22023:client_merge_invalid:organization'),
  ('clients of this organization called in another one (its own Admin)', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 320, 2), '22023:client_merge_invalid:organization'),
  ('a client that does not exist', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_id(7999)), 'PT404:client_merge_client_missing')
) AS r(what, sql, expected);
-- Rules of the pair. J: an inactive client; H: a closed candidate; G: two cabinets; I: a lead a sale pins.
UPDATE platform.clients SET lifecycle_state = 'inactive' WHERE id = pg_temp.cms_cl('MJ');
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = r.expected, 'merge: ' || r.what)
FROM (VALUES
  ('an inactive client is not live', pg_temp.cms_merge('r1', pg_temp.cms_cl('KJ'), pg_temp.cms_cl('MJ')), '55000:client_merge_not_allowed:not_live'),
  ('the same inactive client as the kept one is not live either', pg_temp.cms_merge('r1', pg_temp.cms_cl('MJ'), pg_temp.cms_cl('KJ')), '55000:client_merge_not_allowed:not_live'),
  ('a client the public function already merged cannot be merged again', pg_temp.cms_merge('r1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MR')), '55000:client_merge_not_allowed:not_live'),
  ('a merged client cannot be kept', pg_temp.cms_merge('r1', pg_temp.cms_cl('MR'), pg_temp.cms_cl('KA')), '55000:client_merge_not_allowed:not_live'),
  ('a candidate that is already closed', pg_temp.cms_merge('r1', pg_temp.cms_cl('KH'), pg_temp.cms_cl('MH')), '55000:client_merge_not_allowed:candidate_closed'),
  ('the pair is the same in the other direction', pg_temp.cms_merge('r1', pg_temp.cms_cl('MH'), pg_temp.cms_cl('KH')), '55000:client_merge_not_allowed:candidate_closed'),
  ('two student cabinets', pg_temp.cms_merge('r1', pg_temp.cms_cl('KG'), pg_temp.cms_cl('MG')), '55000:client_merge_not_allowed:student_cabinets'),
  ('two student cabinets in the other direction', pg_temp.cms_merge('r1', pg_temp.cms_cl('MG'), pg_temp.cms_cl('KG')), '55000:client_merge_not_allowed:student_cabinets'),
  ('a lead of the merged client that a pipeline sale pins', pg_temp.cms_merge('r1', pg_temp.cms_cl('KI'), pg_temp.cms_cl('MI')), '55000:client_merge_not_allowed:linked_records')
) AS r(what, sql, expected);
-- The pinned refusal names the constraint (for the operator) and rolls the whole call back.
DO $cms_pinned$
DECLARE detail TEXT;
BEGIN
  BEGIN
    PERFORM platform.merge_clients_owner_confirmed_v1(pg_temp.cms_id(1), pg_temp.cms_id(301), 'cms-merge', 'r1',
      pg_temp.cms_cl('KI'), pg_temp.cms_cl('MI'), 'CMS pinned');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL;
  END;
  IF detail IS DISTINCT FROM 'sales_register_organization_id_client_id_lead_id_fkey' THEN
    RAISE EXCEPTION 'CMS: the pinned refusal names %', detail;
  END IF;
END
$cms_pinned$;
UPDATE platform.clients SET lifecycle_state = 'active' WHERE id = pg_temp.cms_cl('MJ');
SELECT pg_temp.cms_assert(pg_temp.cms_state() = :'cms_state_before_refusals', 'merge: every refusal above left nothing behind (no candidate, receipt, journal row)');

-- ---------------------------------------------------------------------------
-- 3. Pair A: the dry-run, then the merge. KA has a name only; MA has e-mail and phone, two leads (one with a case), a
-- conversation and a bystander candidate; KA's own case has a student cabinet (one cabinet is no obstacle).
-- ---------------------------------------------------------------------------
SAVEPOINT cms_dry_merge;
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA')))::TEXT AS cms_dry_a \gset
SELECT pg_temp.cms_assert((SELECT count(*) = 1 FROM platform_private.client_merge_service_receipts WHERE external_ref = 'a1')
  AND (SELECT lifecycle_state = 'merged' FROM platform.clients WHERE id = pg_temp.cms_cl('MA')),
  'dry-run: inside the transaction the call has its full effect');
ROLLBACK TO SAVEPOINT cms_dry_merge;
SELECT pg_temp.cms_assert(pg_temp.cms_state() = :'cms_state_before_refusals'
  AND NOT EXISTS (SELECT 1 FROM platform_private.client_merge_service_receipts WHERE organization_id = pg_temp.cms_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform_private.client_duplicate_candidates WHERE organization_id = pg_temp.cms_id(1) AND match_basis = 'owner_confirmed')
  AND (SELECT lifecycle_state = 'active' FROM platform.clients WHERE id = pg_temp.cms_cl('MA')),
  'dry-run: after ROLLBACK there is no receipt, no candidate, no resolution, no journal row and the clients are as they were');
SELECT pg_temp.cms_assert(pg_temp.cms_keys(:'cms_dry_a'::JSONB) = ARRAY['candidate_created', 'candidate_id', 'carried_by_alias',
    'contacts', 'external_ref', 'import_source', 'keep_client_id', 'merge_client_id', 'moved', 'operation', 'organization_id',
    'replayed', 'resolution_id', 'status']
  AND :'cms_dry_a'::JSONB -> 'moved' = '{"leads": 2, "student_cases": 1, "conversations": 1, "candidates_staled": 1}'::JSONB
  AND :'cms_dry_a'::JSONB -> 'contacts' = jsonb_build_object('phone', 'copied', 'email', 'copied', 'blocked_by_other_client', FALSE,
    'notes_written', 0, 'note_case_id', NULL)
  AND :'cms_dry_a'::JSONB ->> 'status' = 'merged' AND (:'cms_dry_a'::JSONB -> 'replayed') = 'false'::JSONB
  AND (:'cms_dry_a'::JSONB -> 'candidate_created') = 'true'::JSONB,
  'dry-run: the answer lists what would move and what happens to the contacts');

SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA')))::TEXT AS cms_merge_a \gset
SELECT pg_temp.cms_assert(:'cms_merge_a'::JSONB - 'resolution_id' - 'candidate_id' = :'cms_dry_a'::JSONB - 'resolution_id' - 'candidate_id',
  'the real call answers as the dry-run did');
SELECT pg_temp.cms_assert((:'cms_merge_a'::JSONB -> 'carried_by_alias' ->> 'external_identifiers')::INTEGER = 1
  AND (:'cms_merge_a'::JSONB -> 'carried_by_alias' ->> 'provenance')::INTEGER >= 1
  AND :'cms_merge_a'::JSONB ->> 'keep_client_id' = pg_temp.cms_cl('KA')::TEXT
  AND :'cms_merge_a'::JSONB ->> 'merge_client_id' = pg_temp.cms_cl('MA')::TEXT,
  'the answer counts the identifiers and provenance that stay on the merged client');
-- Effect.
SELECT pg_temp.cms_assert(
  (SELECT lifecycle_state = 'merged' FROM platform.clients WHERE id = pg_temp.cms_cl('MA'))
  AND (SELECT lifecycle_state = 'active' FROM platform.clients WHERE id = pg_temp.cms_cl('KA'))
  AND (SELECT array_agg(client_id::TEXT ORDER BY id) = ARRAY[pg_temp.cms_cl('KA')::TEXT, pg_temp.cms_cl('KA')::TEXT]
    FROM platform.leads WHERE id IN (pg_temp.cms_ld('LMA'), pg_temp.cms_ld('LMA2')))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KA') FROM platform.student_cases WHERE id = pg_temp.cms_id(7502))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KA') FROM platform.communication_conversations WHERE id = pg_temp.cms_id(7800))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KA') FROM platform_private.client_aliases WHERE superseded_client_id = pg_temp.cms_cl('MA'))
  AND (SELECT status = 'stale' FROM platform_private.client_duplicate_candidates WHERE id = pg_temp.cms_id(7700))
  AND (SELECT status = 'resolved' AND match_basis = 'owner_confirmed' FROM platform_private.client_duplicate_candidates
    WHERE id = (:'cms_merge_a'::JSONB ->> 'candidate_id')::UUID)
  AND (SELECT reason = 'CMS synthetic merge' AND actor_membership_id = pg_temp.cms_id(301) AND survivor_client_id = pg_temp.cms_cl('KA')
      AND superseded_client_id = pg_temp.cms_cl('MA') FROM platform_private.client_duplicate_resolutions
    WHERE id = (:'cms_merge_a'::JSONB ->> 'resolution_id')::UUID),
  'merge A: leads, case and conversation moved, MA is `merged` and an alias, the bystander candidate is stale, the owner-confirmed candidate is resolved');
SELECT pg_temp.cms_assert((SELECT client_id = pg_temp.cms_cl('KA') FROM platform.leads WHERE id = pg_temp.cms_ld('LKA'))
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KA') FROM platform.student_cases WHERE id = pg_temp.cms_id(7501)),
  'merge A: the kept client''s own lead and case are untouched');
-- What follows the lead and what keeps the merged client''s id (read through the alias): a call on a moved lead follows it
-- (288), a call with a client only, the external identifier and the provenance stay on the merged client.
SELECT pg_temp.cms_assert((SELECT client_id = pg_temp.cms_cl('KA') AND lead_id = pg_temp.cms_ld('LMA2')
      FROM platform_private.telephony_calls WHERE id = pg_temp.cms_id(7960))
  AND (SELECT client_id = pg_temp.cms_cl('MA') AND lead_id IS NULL FROM platform_private.telephony_calls WHERE id = pg_temp.cms_id(7961))
  AND (SELECT count(*) = 1 FROM platform.external_identifiers WHERE client_id = pg_temp.cms_cl('MA'))
  AND (SELECT count(*) = 0 FROM platform.external_identifiers WHERE client_id = pg_temp.cms_cl('KA')
      AND external_identifier = 'cms-client-MA'),
  'merge A: a call on a moved lead follows it; rows keyed by the merged client (a call without a lead, the identifier, the provenance) keep its id');
-- The identifiers of the merged client read through the alias.
SELECT pg_temp.cms_assert(platform_private.create_or_link_client(pg_temp.cms_id(1), 'CMS Merge Alpha', NULL, NULL, 'cms', 'client',
    'cms-client-MA', 'manual_entry', TIMESTAMPTZ '2026-10-05 08:00:00+00', NULL, 'safe:cms-alias') = pg_temp.cms_cl('KA'),
  'merge A: the external identifier of the merged client resolves to the kept client (read through the alias)');
-- Contacts: filled, and the unique index of active clients does not mind.
SELECT pg_temp.cms_assert((SELECT phone = '+996555000101' AND normalized_phone = '+996555000101' AND email = 'cms-ma@example.invalid'
      AND normalized_email = 'cms-ma@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KA'))
  AND (SELECT count(*) = 1 FROM platform.clients WHERE organization_id = pg_temp.cms_id(1) AND lifecycle_state = 'active'
      AND normalized_email = 'cms-ma@example.invalid' AND normalized_phone = '+996555000101')
  AND (SELECT phone = '+996555000101' AND email = 'cms-ma@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('MA')),
  'merge A: the empty phone and e-mail of KA are filled from MA (the pair is held by the active client only); MA keeps its own');
-- Journal and receipt.
SELECT pg_temp.cms_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'client.duplicate.merge' AND resource_id = pg_temp.cms_cl('KA')
      AND resource_type = 'client' AND actor_principal = 'service:client-merge' AND actor_membership_id = pg_temp.cms_id(301)
      AND reason = 'CMS synthetic merge' AND after_state ->> 'superseded_client_id' = pg_temp.cms_cl('MA')::TEXT
      AND after_state -> 'moved' = '{"leads": 2, "student_cases": 1, "conversations": 1, "candidates_staled": 1}'::JSONB
      AND after_state -> 'contacts' = '{"phone": "copied", "email": "copied", "notes_written": 0}'::JSONB)
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE organization_id = pg_temp.cms_id(1) AND action = 'note.create'),
  'merge A: one journal row with ids and numbers, no note (nothing differed)');
SELECT pg_temp.cms_assert((SELECT before_state -> 'keep' ->> 'client_id' = pg_temp.cms_cl('KA')::TEXT
      AND before_state -> 'merge' ->> 'client_id' = pg_temp.cms_cl('MA')::TEXT
      AND before_state -> 'keep' -> 'phone' = 'null'::JSONB AND before_state -> 'keep' -> 'email' = 'null'::JSONB
      AND before_state -> 'merge' ->> 'phone' = '+996555000101' AND before_state -> 'merge' ->> 'email' = 'cms-ma@example.invalid'
      AND before_state -> 'keep' ->> 'lifecycle_state' = 'active' AND before_state -> 'merge' ->> 'lifecycle_state' = 'active'
      AND pg_temp.cms_same_ids(before_state -> 'keep' -> 'lead_ids', pg_temp.cms_ld('LKA'), pg_temp.cms_ld('LKA2'))
      AND pg_temp.cms_same_ids(before_state -> 'merge' -> 'lead_ids', pg_temp.cms_ld('LMA'), pg_temp.cms_ld('LMA2'))
      AND pg_temp.cms_same_ids(before_state -> 'keep' -> 'student_case_ids', pg_temp.cms_id(7501))
      AND pg_temp.cms_same_ids(before_state -> 'merge' -> 'student_case_ids', pg_temp.cms_id(7502))
      AND pg_temp.cms_same_ids(before_state -> 'merge' -> 'conversation_ids', pg_temp.cms_id(7800))
      AND pg_temp.cms_same_ids(before_state -> 'merge' -> 'open_candidate_ids', pg_temp.cms_id(7700))
      AND (before_state -> 'merge' ->> 'external_identifier_count')::INTEGER = 1
      AND result = :'cms_merge_a'::JSONB - 'replayed' AND payload_md5 ~ '^[0-9a-f]{32}$'
      AND keep_client_id = pg_temp.cms_cl('KA') AND merge_client_id = pg_temp.cms_cl('MA') AND lead_id IS NULL AND note IS NULL
      AND operation = 'merge' AND actor_membership_id = pg_temp.cms_id(301)
    FROM platform_private.client_merge_service_receipts WHERE import_source = 'cms-merge' AND external_ref = 'a1'),
  'merge A: the receipt keeps both clients as they were (ids of leads, cases, conversations and candidates, the contacts) and the answer');
-- Replay and conflicts.
SELECT pg_temp.cms_state() AS cms_state_after_a \gset
SELECT pg_temp.cms_assert(pg_temp.cms_svc_json(pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'))) = :'cms_merge_a'::JSONB || '{"replayed": true}'::JSONB
  AND pg_temp.cms_state() = :'cms_state_after_a', 'merge A: the same body again is `replayed` and writes nothing');
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = 'PT409:client_merge_request_conflict' AND pg_temp.cms_state() = :'cms_state_after_a',
  'merge A: ' || r.what || ' under the same key is PT409')
FROM (VALUES
  ('another reason', pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 301, 1, 'cms-merge', 'CMS another reason')),
  ('another actor (the second Admin)', pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 302)),
  ('another kept client', pg_temp.cms_merge('a1', pg_temp.cms_cl('KB'), pg_temp.cms_cl('MA'))),
  ('the pair the other way round', pg_temp.cms_merge('a1', pg_temp.cms_cl('MA'), pg_temp.cms_cl('KA')))
) AS r(what, sql);
-- A merged client is out; the same key with other clients is a conflict first.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_merge('a2', pg_temp.cms_cl('KB'), pg_temp.cms_cl('MA'))) = '55000:client_merge_not_allowed:not_live'
  AND pg_temp.cms_svc(pg_temp.cms_merge('a3', pg_temp.cms_cl('MA'), pg_temp.cms_cl('KB'))) = '55000:client_merge_not_allowed:not_live'
  AND pg_temp.cms_state() = :'cms_state_after_a', 'merge A: a merged client is neither merged again nor kept');
-- The second Admin, another source: the same pair is not live any more.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_merge('a1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('MA'), 302, 1, 'cms-merge-two'))
    = '55000:client_merge_not_allowed:not_live', 'merge A: a second run under another source finds the pair already merged');

-- ---------------------------------------------------------------------------
-- 4. Contacts and the candidate.
-- ---------------------------------------------------------------------------
-- Pair F: the open `name` candidate of the pair is used, not a new one.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('f1', pg_temp.cms_cl('KF'), pg_temp.cms_cl('MF')))::TEXT AS cms_merge_f \gset
SELECT pg_temp.cms_assert((:'cms_merge_f'::JSONB -> 'candidate_created') = 'false'::JSONB
  AND (SELECT status = 'resolved' AND match_basis = 'name' FROM platform_private.client_duplicate_candidates
    WHERE id = (:'cms_merge_f'::JSONB ->> 'candidate_id')::UUID)
  AND (SELECT count(*) = 1 FROM platform_private.client_duplicate_candidates
    WHERE left_client_id = LEAST(pg_temp.cms_cl('KF'), pg_temp.cms_cl('MF')) AND right_client_id = GREATEST(pg_temp.cms_cl('KF'), pg_temp.cms_cl('MF')))
  AND :'cms_merge_f'::JSONB -> 'contacts' ->> 'phone' = 'none' AND :'cms_merge_f'::JSONB -> 'contacts' ->> 'email' = 'none',
  'merge F: the open candidate the system made is used (no second row), the contacts are untouched');
-- Pair B: both differ, the kept client has an active case: a note per contact, the kept client unchanged.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('b1', pg_temp.cms_cl('KB'), pg_temp.cms_cl('MB')))::TEXT AS cms_merge_b \gset
SELECT pg_temp.cms_assert(:'cms_merge_b'::JSONB -> 'contacts' = jsonb_build_object('phone', 'conflict', 'email', 'conflict',
    'blocked_by_other_client', FALSE, 'notes_written', 2, 'note_case_id', pg_temp.cms_id(7503))
  AND (SELECT phone = '+996555000201' AND email = 'cms-kb@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KB'))
  AND (SELECT array_agg(body ORDER BY body) = ARRAY['Вторая почта (из склеенного клиента): cms-mb@example.invalid',
      'Второй телефон (из склеенного клиента): +996555000202']
    FROM platform.case_notes WHERE student_case_id = pg_temp.cms_id(7503) AND created_by_membership_id = pg_temp.cms_id(301))
  AND (SELECT count(*) = 2 FROM platform.case_notes WHERE organization_id = pg_temp.cms_id(1))
  AND (SELECT client_id = pg_temp.cms_cl('KB') FROM platform.leads WHERE id = pg_temp.cms_ld('LMB')),
  'merge B: differing contacts stay with the merged client, KB is unchanged and the active case gets a note for each');
SELECT pg_temp.cms_assert((SELECT count(*) = 2 FROM platform.audit_events WHERE action = 'note.create' AND resource_type = 'student_case'
      AND resource_id = pg_temp.cms_id(7503) AND actor_principal = 'service:client-merge'
      AND after_state ->> 'case_note_id' IS NOT NULL AND (after_state ->> 'body_chars')::INTEGER > 0)
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE organization_id = pg_temp.cms_id(1) AND action = 'note.create' AND after_state::TEXT ~ '\+996|example\.invalid|Втор'),
  'merge B: the journal names the notes and their length, never their text');
SELECT pg_temp.cms_assert((SELECT before_state -> 'merge' ->> 'phone' = '+996555000202' AND before_state -> 'merge' ->> 'email' = 'cms-mb@example.invalid'
      AND before_state -> 'keep' ->> 'phone' = '+996555000201' AND before_state -> 'keep' ->> 'email' = 'cms-kb@example.invalid'
    FROM platform_private.client_merge_service_receipts WHERE external_ref = 'b1'),
  'merge B: the receipt keeps the contacts of both clients (the value that was not copied is there)');
-- Pair B2: the phone differs but there is no active case (the only case is finished): no note, the receipt has the value;
-- the e-mail fills the empty one.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('b2', pg_temp.cms_cl('KB2'), pg_temp.cms_cl('MB2')))::TEXT AS cms_merge_b2 \gset
SELECT pg_temp.cms_assert(:'cms_merge_b2'::JSONB -> 'contacts' = jsonb_build_object('phone', 'conflict', 'email', 'copied',
    'blocked_by_other_client', FALSE, 'notes_written', 0, 'note_case_id', NULL)
  AND (SELECT phone = '+996555000211' AND email = 'cms-mb2@example.invalid' AND normalized_email = 'cms-mb2@example.invalid'
    FROM platform.clients WHERE id = pg_temp.cms_cl('KB2'))
  AND (SELECT count(*) = 2 FROM platform.case_notes WHERE organization_id = pg_temp.cms_id(1))
  AND (SELECT before_state -> 'merge' ->> 'phone' = '+996555000212' FROM platform_private.client_merge_service_receipts WHERE external_ref = 'b2'),
  'merge B2: without an active case the differing phone is only in the receipt, the empty e-mail is filled');
-- Pair B3: the same phone in another spelling and the same e-mail in another case are no conflict.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('b3', pg_temp.cms_cl('KB3'), pg_temp.cms_cl('MB3')))::TEXT AS cms_merge_b3 \gset
SELECT pg_temp.cms_assert(:'cms_merge_b3'::JSONB -> 'contacts' = jsonb_build_object('phone', 'same', 'email', 'same',
    'blocked_by_other_client', FALSE, 'notes_written', 0, 'note_case_id', NULL)
  AND (SELECT phone = '+996555000301' AND email = 'cms-kb3@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KB3'))
  AND (SELECT count(*) = 2 FROM platform.case_notes WHERE organization_id = pg_temp.cms_id(1)),
  'merge B3: the same number and e-mail written differently change nothing and note nothing');
-- Pair C: two merges into one kept client; the second is a note, nothing is overwritten.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('c1', pg_temp.cms_cl('KC'), pg_temp.cms_cl('MC1')))::TEXT AS cms_merge_c1 \gset
SELECT pg_temp.cms_assert(:'cms_merge_c1'::JSONB -> 'contacts' ->> 'phone' = 'copied' AND :'cms_merge_c1'::JSONB -> 'contacts' ->> 'email' = 'copied'
  AND (SELECT phone = '+996555000401' AND email = 'cms-mc1@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KC')),
  'merge C1: the first merge fills the empty contacts of KC');
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('c2', pg_temp.cms_cl('KC'), pg_temp.cms_cl('MC2')))::TEXT AS cms_merge_c2 \gset
SELECT pg_temp.cms_assert(:'cms_merge_c2'::JSONB -> 'contacts' = jsonb_build_object('phone', 'conflict', 'email', 'conflict',
    'blocked_by_other_client', FALSE, 'notes_written', 2, 'note_case_id', pg_temp.cms_id(7505))
  AND (SELECT phone = '+996555000401' AND email = 'cms-mc1@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KC'))
  AND (SELECT array_agg(body ORDER BY body) = ARRAY['Вторая почта (из склеенного клиента): cms-mc2@example.invalid',
      'Второй телефон (из склеенного клиента): +996555000402']
    FROM platform.case_notes WHERE student_case_id = pg_temp.cms_id(7505))
  AND (SELECT count(*) = 2 FROM platform.leads WHERE client_id = pg_temp.cms_cl('KC') AND id IN (pg_temp.cms_ld('LMC1'), pg_temp.cms_ld('LMC2')))
  AND (SELECT count(*) = 2 FROM platform_private.client_aliases WHERE canonical_client_id = pg_temp.cms_cl('KC')),
  'merge C2: the second merge into the same client leaves the first one''s contacts and writes the new ones as notes');
-- Pair D: a third active client already holds the pair the copy would make.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('d1', pg_temp.cms_cl('KD'), pg_temp.cms_cl('MD')))::TEXT AS cms_merge_d \gset
SELECT pg_temp.cms_assert(:'cms_merge_d'::JSONB -> 'contacts' = jsonb_build_object('phone', 'conflict', 'email', 'none',
    'blocked_by_other_client', TRUE, 'notes_written', 1, 'note_case_id', pg_temp.cms_id(7506))
  AND (SELECT phone IS NULL AND email = 'cms-d@example.invalid' FROM platform.clients WHERE id = pg_temp.cms_cl('KD'))
  AND (SELECT body = 'Второй телефон (из склеенного клиента): +996555000501' FROM platform.case_notes WHERE student_case_id = pg_temp.cms_id(7506))
  AND (SELECT lifecycle_state = 'merged' FROM platform.clients WHERE id = pg_temp.cms_cl('MD')),
  'merge D: a pair another active client holds is not copied (the unique index is kept); the phone goes to the note, the merge itself is done');
-- Pair I the other way round: the pinned lead stays with the kept client, the other client's lead and case move.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('i1', pg_temp.cms_cl('MI'), pg_temp.cms_cl('KI')))::TEXT AS cms_merge_i \gset
SELECT pg_temp.cms_assert(:'cms_merge_i'::JSONB -> 'moved' = '{"leads": 1, "student_cases": 1, "conversations": 0, "candidates_staled": 0}'::JSONB
  AND (SELECT client_id = pg_temp.cms_cl('MI') FROM platform.leads WHERE id = pg_temp.cms_ld('LKI'))
  AND (SELECT client_id = pg_temp.cms_cl('MI') FROM platform.leads WHERE id = pg_temp.cms_ld('LMI')),
  'merge I: with the pinned lead on the kept side the merge goes through');
-- Pair K: the merged client's case has the student cabinet; it moves, the cabinet stays as it was.
SELECT pg_temp.cms_svc_json(pg_temp.cms_merge('k1', pg_temp.cms_cl('KK'), pg_temp.cms_cl('MK')))::TEXT AS cms_merge_k \gset
SELECT pg_temp.cms_assert(:'cms_merge_k'::JSONB -> 'moved' = '{"leads": 1, "student_cases": 1, "conversations": 0, "candidates_staled": 0}'::JSONB
  AND (SELECT canonical_client_id = pg_temp.cms_cl('KK') AND student_membership_id = pg_temp.cms_id(309) AND portal_activated_at IS NOT NULL
      AND state = 'active' FROM platform.student_cases WHERE id = pg_temp.cms_id(7517))
  AND (SELECT status = 'active' FROM platform.organization_memberships WHERE id = pg_temp.cms_id(309))
  AND platform_private.client_has_student_cabinet(pg_temp.cms_id(1), pg_temp.cms_cl('KK')),
  'merge K: the case with a student cabinet moves to the kept client and the cabinet is untouched (the student keeps the login)');
-- One cabinet is fine: pair A already merged a client with a cabinet (KA) and one without (MA).
SELECT pg_temp.cms_assert(platform_private.client_has_student_cabinet(pg_temp.cms_id(1), pg_temp.cms_cl('KA'))
  AND NOT platform_private.client_has_student_cabinet(pg_temp.cms_id(1), pg_temp.cms_cl('MB'))
  AND platform_private.client_has_student_cabinet(pg_temp.cms_id(1), pg_temp.cms_cl('KG'))
  AND platform_private.client_has_student_cabinet(pg_temp.cms_id(1), pg_temp.cms_cl('MG')),
  'the cabinet rule reads the bound, active student membership of a case of the client');

-- ---------------------------------------------------------------------------
-- 5. The receipts are append-only and shaped.
-- ---------------------------------------------------------------------------
SELECT pg_temp.cms_assert(pg_temp.cms_error($q$UPDATE platform_private.client_merge_service_receipts SET note = 'x'$q$)
    = '55000:platform.client_merge_service_receipts is append-only; UPDATE is forbidden'
  AND pg_temp.cms_error($q$DELETE FROM platform_private.client_merge_service_receipts$q$)
    = '55000:platform.client_merge_service_receipts is append-only; DELETE is forbidden'
  AND (SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid = 'platform_private.client_merge_service_receipts'::regclass AND NOT tgisinternal
      AND tgname IN ('client_merge_service_receipts_append_only', 'client_merge_service_receipts_no_truncate'))
  AND (SELECT count(*) = 10 FROM platform_private.client_merge_service_receipts WHERE operation = 'merge'),
  'the receipts cannot be updated or deleted, and truncate is guarded');
SELECT pg_temp.cms_assert(pg_temp.cms_error(format($q$INSERT INTO platform_private.client_merge_service_receipts(organization_id, operation,
    import_source, external_ref, actor_membership_id, payload_md5, keep_client_id, merge_client_id, lead_id, result, before_state)
    VALUES (%L, %L, 'cms-shape', 'x', %L, %L, %L, %L, %L, '{}', '{}')$q$, pg_temp.cms_id(1), r.operation, pg_temp.cms_id(301),
    repeat('a', 32), r.keep, r.merge, r.lead)) LIKE '23514:%client_merge_service_receipts_shape%',
  'a receipt of the wrong shape is refused: ' || r.what)
FROM (VALUES
  ('a merge without the merged client', 'merge', pg_temp.cms_cl('KA'), NULL::UUID, NULL::UUID),
  ('a merge that names a lead', 'merge', pg_temp.cms_cl('KA'), pg_temp.cms_cl('KB'), pg_temp.cms_ld('LKA')),
  ('a merge of a client with itself', 'merge', pg_temp.cms_cl('KA'), pg_temp.cms_cl('KA'), NULL),
  ('a closure without a lead', 'close_lead', NULL, NULL, NULL),
  ('a closure that names clients', 'close_lead', pg_temp.cms_cl('KA'), NULL, pg_temp.cms_ld('LKA'))
) AS r(what, operation, keep, merge, lead);
SELECT pg_temp.cms_assert(pg_temp.cms_error(format($q$INSERT INTO platform_private.client_merge_service_receipts(organization_id, operation,
    import_source, external_ref, actor_membership_id, payload_md5, lead_id, result, before_state)
    VALUES (%L, 'close_lead', 'Bad Source', 'x', %L, %L, %L, '{}', '{}')$q$, pg_temp.cms_id(1), pg_temp.cms_id(301),
    repeat('a', 32), pg_temp.cms_ld('LKA'))) LIKE '23514:%',
  'a receipt with a source that is not a label is refused');

-- ---------------------------------------------------------------------------
-- 6. close_sales_lead_already_student_v1.
-- ---------------------------------------------------------------------------
-- A lead without a client, and the real closing of two cases (the Admin as a signed-in user, 246's command): 7510 as
-- «Поступил», 7511 as «Отказался».
INSERT INTO platform.leads(id, organization_id, client_id, stage_key, source_key)
  VALUES (pg_temp.cms_id(7970), pg_temp.cms_id(1), NULL, 'new', 'manual');
SELECT pg_temp.cms_assert(pg_temp.cms_user_json(1, format('SELECT platform.set_student_case_closed_v1(%L, %L, 0, TRUE, %L, NULL, %L)',
    pg_temp.cms_id(1), pg_temp.cms_id(7510), 'enrolled', pg_temp.cms_id(7980))) ->> 'outcome' = 'enrolled'
  AND pg_temp.cms_user_json(1, format('SELECT platform.set_student_case_closed_v1(%L, %L, 0, TRUE, %L, NULL, %L)',
    pg_temp.cms_id(1), pg_temp.cms_id(7511), 'declined', pg_temp.cms_id(7981))) ->> 'outcome' = 'declined',
  'fixture: case 10 is finished as «Поступил», case 11 as «Отказался»');
SELECT pg_temp.cms_state() AS cms_state_before_close \gset
SELECT l.k, l.id, v.workflow_version, v.stage_key, v.lifecycle_state::TEXT AS lifecycle FROM cms_l l JOIN platform.leads v ON v.id = l.id
  WHERE l.k = 'LKA2' \gset cms_a2_
-- The service boundary and the actor.
SELECT pg_temp.cms_assert(
  pg_temp.cms_as(format('{"role":"service_role","sub":"%s"}', pg_temp.cms_id(101)), 'service_role',
    pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'))) = '42501:client_merge_forbidden'
  AND pg_temp.cms_as(format('{"role":"authenticated","sub":"%s"}', pg_temp.cms_id(101)), 'authenticated',
    pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_user(1, pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'))) LIKE '42501:permission denied for %'
  AND pg_temp.cms_anon(pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'))) LIKE '42501:permission denied for %',
  'close: a `sub`, authenticated and anon are refused');
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), NULL, r.actor)) = '42501:client_merge_forbidden',
  'close: ' || r.what || ' is refused')
FROM (VALUES (303, 'a coarse Admin who is not a system Admin'), (304, 'a Sales member'), (305, 'a Student'),
  (306, 'a system Admin whose membership is suspended'), (399, 'a membership that does not exist'),
  (320, 'the Admin of another organization')) AS r(actor, what);
-- Strict parameters.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = r.expected, 'close: ' || r.what)
FROM (VALUES
  ('an import source that is not a label', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), NULL, 301, 1, 'Bad Source'), '22023:lead_close_invalid:importSource'),
  ('an empty external reference', pg_temp.cms_close(' ', pg_temp.cms_ld('LKA2')), '22023:lead_close_invalid:externalRef'),
  ('a control character in the reference', pg_temp.cms_close('c' || chr(7), pg_temp.cms_ld('LKA2')), '22023:lead_close_invalid:externalRef'),
  ('an empty reason', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), NULL, 301, 1, 'cms-close', ' '), '22023:lead_close_invalid:reason'),
  ('a reason of 501 characters', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), NULL, 301, 1, 'cms-close', repeat('x', 501)), '22023:lead_close_invalid:reason'),
  ('no lead', format('SELECT platform.close_sales_lead_already_student_v1(%L, %L, ''cms-close'', ''c1'', NULL, NULL, ''CMS'')',
    pg_temp.cms_id(1), pg_temp.cms_id(301)), '22023:lead_close_invalid:leadId'),
  ('a note of two lines', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), 'two' || chr(10) || 'lines'), '22023:lead_close_invalid:note'),
  ('a note of 501 characters', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), repeat('n', 501)), '22023:lead_close_invalid:note')
) AS r(what, sql, expected);
-- The rules: a lead is closed only when the person is already a student.
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_close('c-' || r.ref, r.lead, NULL, 301, r.org)) = r.expected, 'close: ' || r.what)
FROM (VALUES
  ('a client without any case', 'n', pg_temp.cms_ld('LN'), 1, '55000:lead_close_not_allowed:no_student_case'),
  ('the second lead of a client without any case', 'n2', pg_temp.cms_ld('LN2'), 1, '55000:lead_close_not_allowed:no_student_case'),
  ('a lead without a client', 'q', pg_temp.cms_id(7970), 1, '55000:lead_close_not_allowed:no_student_case'),
  ('the lead a case was opened on (active case)', 'ka', pg_temp.cms_ld('LKA'), 1, '55000:lead_close_not_allowed:case_of_this_lead'),
  ('the lead a case was opened on (pending case)', 'p', pg_temp.cms_ld('LP'), 1, '55000:lead_close_not_allowed:case_of_this_lead'),
  ('a lead with a completed handoff (a sale)', 'z', pg_temp.cms_ld('LZ'), 1, '55000:lead_close_not_allowed:handed_off'),
  ('a client whose only case was finished as «Отказался»', 'dc2', pg_temp.cms_ld('LDC2'), 1, '55000:lead_close_not_allowed:no_student_case'),
  ('a client whose only case was closed outside the closing command', 'kb2', pg_temp.cms_ld('LMB2'), 1, '55000:lead_close_not_allowed:no_student_case'),
  ('a lead that does not exist', 'x', pg_temp.cms_id(7999), 1, 'PT404:lead_close_lead_missing'),
  ('a lead of another organization', 'l2', pg_temp.cms_ld('L2'), 1, 'PT404:lead_close_lead_missing')
) AS r(what, ref, lead, org, expected);
SELECT pg_temp.cms_assert(pg_temp.cms_svc(pg_temp.cms_close('c-l2b', pg_temp.cms_ld('L2'), NULL, 320, 2)) = '55000:lead_close_not_allowed:no_student_case'
  AND pg_temp.cms_svc(pg_temp.cms_close('c-l2c', pg_temp.cms_ld('LKA2'), NULL, 320, 2)) = 'PT404:lead_close_lead_missing',
  'close: the other organization''s Admin works in his own organization only');
SELECT pg_temp.cms_assert(pg_temp.cms_state() = :'cms_state_before_close', 'close: every refusal above left nothing behind');
-- The handoff fact is the board's own (212 over 247): the refused lead is the one the read calls completed.
SELECT pg_temp.cms_assert((SELECT bool_and((f ->> 'completed')::BOOLEAN = (f ->> 'lead_id' = pg_temp.cms_ld('LZ')::TEXT))
    FROM jsonb_array_elements(pg_temp.cms_user_json(1, format('SELECT platform.staff_sales_handoff_facts(%L, ARRAY[%L, %L]::UUID[])',
      pg_temp.cms_id(1), pg_temp.cms_ld('LZ'), pg_temp.cms_ld('LZ2'))) -> 'leads') f),
  'the board''s handoff read agrees: Z''s lead is completed, its second lead is not');

-- Successes. Dry-run first (the pending case: LP2).
SAVEPOINT cms_dry_close;
SELECT pg_temp.cms_svc_json(pg_temp.cms_close('p2', pg_temp.cms_ld('LP2')))::TEXT AS cms_dry_p2 \gset
SELECT pg_temp.cms_assert((SELECT lifecycle_state = 'disqualified' FROM platform.leads WHERE id = pg_temp.cms_ld('LP2')), 'dry-run (close): the effect is there inside the transaction');
ROLLBACK TO SAVEPOINT cms_dry_close;
SELECT pg_temp.cms_assert(pg_temp.cms_state() = :'cms_state_before_close'
  AND (SELECT lifecycle_state = 'open' FROM platform.leads WHERE id = pg_temp.cms_ld('LP2')),
  'dry-run (close): after ROLLBACK nothing is left');
SELECT pg_temp.cms_svc_json(pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), '  CMS private note  '))::TEXT AS cms_close_a2 \gset
SELECT pg_temp.cms_assert(pg_temp.cms_keys(:'cms_close_a2'::JSONB) = ARRAY['client_id', 'external_ref', 'import_source', 'lead_id', 'lifecycle',
      'operation', 'organization_id', 'reason', 'replayed', 'stage_key', 'status', 'student_case_ids', 'workflow_version']
  AND :'cms_close_a2'::JSONB ->> 'status' = 'closed' AND :'cms_close_a2'::JSONB ->> 'lifecycle' = 'closed'
  AND :'cms_close_a2'::JSONB ->> 'reason' = 'duplicate' AND :'cms_close_a2'::JSONB ->> 'client_id' = pg_temp.cms_cl('KA')::TEXT
  AND :'cms_close_a2'::JSONB -> 'student_case_ids' = jsonb_build_array(pg_temp.cms_id(7501), pg_temp.cms_id(7502))
  AND :'cms_close_a2'::JSONB ->> 'workflow_version' = :'cms_a2_workflow_version'
  AND (SELECT lifecycle_state = 'disqualified' AND stage_key = :'cms_a2_stage_key'
      AND workflow_version::TEXT = :'cms_a2_workflow_version' FROM platform.leads WHERE id = pg_temp.cms_ld('LKA2')),
  'close A2: the lead of KA (cases 1 and 2, the second one moved by the merge) is closed as «Дубликат»; stage and workflow version stay');
SELECT pg_temp.cms_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'lead.lifecycle.change' AND resource_type = 'lead'
      AND resource_id = pg_temp.cms_ld('LKA2') AND actor_principal = 'service:lead-already-student' AND actor_membership_id = pg_temp.cms_id(301)
      AND reason = 'CMS synthetic closure'
      AND before_state ->> 'lifecycle' = 'open' AND after_state ->> 'lifecycle' = 'closed'
      AND after_state ->> 'lifecycle_state' = 'disqualified' AND after_state ->> 'reason' = 'duplicate'
      AND after_state -> 'note' = 'null'::JSONB AND after_state ->> 'stage_key' = :'cms_a2_stage_key')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE after_state::TEXT LIKE '%CMS private note%'),
  'close A2: the journal row is 246''s lifecycle event; the caller''s own note is not in it');
SELECT pg_temp.cms_assert((SELECT note = 'CMS private note' AND lead_id = pg_temp.cms_ld('LKA2') AND operation = 'close_lead'
      AND keep_client_id IS NULL AND merge_client_id IS NULL AND result = :'cms_close_a2'::JSONB - 'replayed'
      AND before_state ->> 'lifecycle_state' = 'open' AND before_state ->> 'client_id' = pg_temp.cms_cl('KA')::TEXT
      AND pg_temp.cms_same_ids(before_state -> 'student_case_ids', pg_temp.cms_id(7501), pg_temp.cms_id(7502))
    FROM platform_private.client_merge_service_receipts WHERE import_source = 'cms-close' AND external_ref = 'c1'),
  'close A2: the receipt has the caller''s note, the answer and the lead as it was');
-- 246 reads it: the closed list names the reason; 246''s own command returns it to work.
SELECT pg_temp.cms_user_json(1, format('SELECT platform.staff_closed_leads_v1(50, NULL, %L)', pg_temp.cms_ld('LKA2')))::TEXT AS cms_closed_a2 \gset
SELECT pg_temp.cms_assert(jsonb_array_length(:'cms_closed_a2'::JSONB -> 'rows') = 1
  AND :'cms_closed_a2'::JSONB -> 'rows' -> 0 ->> 'reason' = 'duplicate' AND :'cms_closed_a2'::JSONB -> 'rows' -> 0 -> 'note' = 'null'::JSONB
  AND :'cms_closed_a2'::JSONB -> 'rows' -> 0 ->> 'closed_by_display_name' = 'CMS Actor 1'
  AND (:'cms_closed_a2'::JSONB -> 'rows' -> 0 ->> 'closed_at') IS NOT NULL,
  'close A2: «Закрытые» shows the lead with the reason «duplicate», the date and who closed it');
SELECT pg_temp.cms_user_json(1, format('SELECT platform.set_lead_closed_v1(%L, %L, %s, FALSE, NULL, NULL, %L)',
  pg_temp.cms_id(1), pg_temp.cms_ld('LKA2'), :'cms_a2_workflow_version', pg_temp.cms_id(7990)))::TEXT AS cms_return_a2 \gset
SELECT pg_temp.cms_assert(:'cms_return_a2'::JSONB ->> 'lifecycle' = 'open'
  AND (SELECT lifecycle_state = 'open' AND stage_key = :'cms_a2_stage_key' FROM platform.leads WHERE id = pg_temp.cms_ld('LKA2')),
  'close A2: set_lead_closed_v1 (246) returns the lead to work at its stage');
-- Replay, conflicts, the lead that is not open.
SELECT pg_temp.cms_assert(pg_temp.cms_svc_json(pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), '  CMS private note  ')) = :'cms_close_a2'::JSONB || '{"replayed": true}'::JSONB,
  'close A2: the same call again is `replayed` even after the lead was returned to work');
SELECT pg_temp.cms_assert(pg_temp.cms_svc(r.sql) = r.expected, 'close A2: ' || r.what)
FROM (VALUES
  ('another note under the same key', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), 'CMS other note'), 'PT409:lead_close_request_conflict'),
  ('no note under the same key', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2')), 'PT409:lead_close_request_conflict'),
  ('another actor under the same key', pg_temp.cms_close('c1', pg_temp.cms_ld('LKA2'), '  CMS private note  ', 302), 'PT409:lead_close_request_conflict'),
  ('another lead under the same key', pg_temp.cms_close('c1', pg_temp.cms_ld('LMA2'), '  CMS private note  '), 'PT409:lead_close_request_conflict'),
  ('a merge call under a closure''s key', pg_temp.cms_merge('c1', pg_temp.cms_cl('KA'), pg_temp.cms_cl('KB'), 301, 1, 'cms-close'), 'PT409:client_merge_request_conflict')
) AS r(what, sql, expected);
SELECT pg_temp.cms_svc(pg_temp.cms_close('ma2', pg_temp.cms_ld('LMA2'))) AS cms_close_ma2_first \gset
SELECT pg_temp.cms_svc(pg_temp.cms_close('ma2b', pg_temp.cms_ld('LMA2'))) AS cms_close_ma2_again \gset
SELECT pg_temp.cms_assert(:'cms_close_ma2_first' = 'ok' AND :'cms_close_ma2_again' = 'PT409:lead_close_state_conflict',
  'close: the lead of the client merged in A (now KA''s) closes once; a second key finds it closed (state conflict)');
-- The lead returned to work is closed again under a new key.
SELECT pg_temp.cms_svc(pg_temp.cms_close('c1b', pg_temp.cms_ld('LKA2'))) AS cms_close_a2_again \gset
SELECT pg_temp.cms_assert(:'cms_close_a2_again' = 'ok'
  AND (SELECT lifecycle_state = 'disqualified' FROM platform.leads WHERE id = pg_temp.cms_ld('LKA2')),
  'close A2: a lead returned to work can be closed again under a new key');
-- The other cases: pending, finished as «Поступил», a second lead of a handed-off client.
SELECT pg_temp.cms_svc_json(pg_temp.cms_close('p2', pg_temp.cms_ld('LP2')))::TEXT AS cms_close_p2 \gset
SELECT pg_temp.cms_assert(:'cms_close_p2'::JSONB - 'replayed' = :'cms_dry_p2'::JSONB - 'replayed'
  AND :'cms_close_p2'::JSONB -> 'student_case_ids' = jsonb_build_array(pg_temp.cms_id(7509)),
  'close P2: a case waiting for a curator (pending) makes the person a student; the real call answers as the dry-run did');
SELECT pg_temp.cms_svc_json(pg_temp.cms_close('e2', pg_temp.cms_ld('LE2')))::TEXT AS cms_close_e2 \gset
SELECT pg_temp.cms_svc_json(pg_temp.cms_close('z2', pg_temp.cms_ld('LZ2')))::TEXT AS cms_close_z2 \gset
SELECT pg_temp.cms_assert(:'cms_close_e2'::JSONB -> 'student_case_ids' = jsonb_build_array(pg_temp.cms_id(7510))
  AND :'cms_close_z2'::JSONB -> 'student_case_ids' = jsonb_build_array(pg_temp.cms_id(7514))
  AND (SELECT count(*) = 5 FROM platform.leads WHERE organization_id = pg_temp.cms_id(1) AND lifecycle_state = 'disqualified'),
  'close E2 and Z2: a case finished as «Поступил» counts, and a handed-off client''s other lead is a separate enquiry');
SELECT pg_temp.cms_assert((SELECT count(*) = 6 FROM platform_private.client_merge_service_receipts WHERE operation = 'close_lead'),
  'close: six accepted calls, six receipts (the dry-run left none)');

-- ---------------------------------------------------------------------------
-- 7. The whole journal: no name, phone, e-mail or note text anywhere in it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.cms_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events e
    WHERE e.organization_id = pg_temp.cms_id(1) AND e.actor_principal IN ('service:client-merge', 'service:lead-already-student')
      AND (coalesce(e.before_state::TEXT, '') || e.after_state::TEXT || e.reason || e.action || e.resource_type)
        ~* '\+996|0555|example\.invalid|CMS (Keep|Merge|Client|Twin|Third)|private note|Втор'),
  'the journal rows of both calls hold no name, phone, e-mail or note text');
SELECT pg_temp.cms_assert((SELECT count(*) = 10 FROM platform.audit_events WHERE organization_id = pg_temp.cms_id(1) AND action = 'client.duplicate.merge')
  AND (SELECT count(*) = 5 FROM platform.audit_events WHERE organization_id = pg_temp.cms_id(1) AND action = 'note.create' AND actor_principal = 'service:client-merge')
  AND (SELECT count(*) = 6 FROM platform.audit_events WHERE organization_id = pg_temp.cms_id(1) AND action = 'lead.lifecycle.change' AND actor_principal = 'service:lead-already-student')
  AND (SELECT count(DISTINCT request_id) = count(*) FROM platform.audit_events WHERE actor_principal IN ('service:client-merge', 'service:lead-already-student')),
  'the journal: ten merges, five notes, six closures; every row has its own request id');
SELECT pg_temp.cms_assert((SELECT count(*) = 1 FROM platform_private.client_merge_service_receipts r
      WHERE r.operation = 'merge' AND r.before_state::TEXT LIKE '%+996555000202%')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE (coalesce(before_state::TEXT, '') || after_state::TEXT) LIKE '%+996555000202%'),
  'the value of a contact that was not copied lives in the closed receipt and nowhere in the journal');

SELECT 'CMS_CLIENT_MERGE_SERVICE_SUITE_PASSED' AS cms_suite_marker;
ROLLBACK;
