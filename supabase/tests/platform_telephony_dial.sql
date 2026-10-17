\set ON_ERROR_STOP on
-- Boundary suite for migration 299 «Телефония Beeline KG» срез T7 (кнопка «Позвонить»:
-- проверки набора в базе, идемпотентность, лимиты, журнал; docs/EVO_TELEPHONY_PLAN_2026-10-16.md
-- §5.4, §6.4, §6.5, §8, §9.1, §11, §12; ADR 0033). Runs on the real chain right after 299 inside
-- one transaction that is rolled back, with its own synthetic organizations, members (modelled like
-- production: invited staff have coarse role NULL, rights come from scoped role assignments made
-- through the REAL platform.staff_role_command / staff_role_publish / staff_role_assignments_save and
-- from the roles the real T2 provisioning creates), clients, leads and PBX mappings: no provider, no
-- real person, no real phone, no PBX call, no production action. Every number is fictional.
--
-- Proves:
--  1. catalog and grants: the four public functions are SECURITY DEFINER with an empty search_path,
--     options and begin callable by authenticated only, target and finish by service_role only (and
--     refused to the database role service_role without the service claim); the helpers are closed to
--     every client role; the whole platform telephony catalog is the twenty earlier functions, the
--     optional T8 automation tick and exactly these four; the dial table stays closed; the journal
--     allowlist already knows telephony.dial / telephony_dial_request;
--  2. the switch and the rights: no settings row, ui_enabled only, dial_enabled only and
--     outbound_paused all refuse begin (55000, the Admin included) and show no button (options);
--     a plain lead reader, a Student, a member without roles, another organization and anon are refused;
--  3. lead visibility: lead.read decides; an unknown lead and an invisible one answer the same (P0002);
--  4. the number: from the card only; no phone, an ambiguous bare national number, a country outside the
--     allowed prefixes, short / service / premium ranges are refused with a code, recorded as a refused row
--     without number or PBX login and ONE journal row; adding a prefix opens that country;
--  5. the mapping: an employee without an active PBX user is refused (not_mapped); the options show it;
--  6. limits: not more than one dial per gap, the per-employee day, the per-organization hour and day;
--     refusals do not count; windows slide; the hour limit does not look at the day and vice versa;
--  7. idempotency: the same request id of the same employee returns the earlier result and writes
--     nothing; another lead under the same id is a conflict (PT409); another employee has his own id space;
--     a refused request replays as refused; a request that never got its result becomes unconfirmed;
--  8. target and finish: the number and the login are read only by target (service role, the right
--     employee, status requested, fresh); finish is the single transition to sent / unconfirmed / failed /
--     refused with the right fields; a repeat changes nothing and journals nothing;
--  9. the journal: one telephony.dial row per dial, ids and codes only — never a number, a PBX login or a
--     call id; and nothing leaks from any answer.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t299_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t299_auth_role$;

\echo T299_TELEPHONY_DIAL_SUITE_START

CREATE FUNCTION pg_temp.t299_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t299_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T299: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t299_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.t299_code(p_answer JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_answer ? 'error' THEN split_part(p_answer ->> 'error', ':', 1) ELSE 'ok' END
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (active), organization 2 (another tenant).
--   actor 1  org 1 Admin (system admin), not mapped
--   actor 2  org 1 manager A  — «Телефония — менеджер» + lead.read for department A; PBX user u9902
--   actor 3  org 1 manager A2 — the same, department A; NOT mapped at first
--   actor 4  org 1 manager B  — «Телефония — менеджер» + lead.read for department B; PBX user u9904
--   actor 5  org 1 supervisor — «Телефония — руководитель» + lead.read for the organization; PBX user u9905
--   actor 6  org 1 plain lead reader — lead.read for the organization, no telephony right
--   actor 7  org 1 Student
--   actor 8  org 1 staff without any role
--   actor 9  org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t299_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, NULL, FALSE), (7, 1, 'student', FALSE), (8, 1, NULL, FALSE), (9, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t299_id(1), 'T299 Fictional organization', 'active'),
  (pg_temp.t299_id(2), 'T299 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t299_id(100 + n), 't299-' || n || '@example.invalid', '{}'::JSONB FROM t299_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t299_id(200 + n), pg_temp.t299_id(100 + n), 'T299 Actor ' || n, 'active', 1 FROM t299_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t299_id(300 + a.n), pg_temp.t299_id(a.org), pg_temp.t299_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t299_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t299_id(300 + n) FROM t299_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t299_id(401), pg_temp.t299_id(1), 'organization', pg_temp.t299_id(1), 1),
  (pg_temp.t299_id(402), pg_temp.t299_id(2), 'organization', pg_temp.t299_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t299_id(1), pg_temp.t299_id(301), pg_temp.t299_id(401), 1, 1, TRUE, 'system', 'T299 synthetic scope', pg_temp.t299_id(601)),
  (pg_temp.t299_id(2), pg_temp.t299_id(309), pg_temp.t299_id(402), 1, 1, TRUE, 'system', 'T299 synthetic scope', pg_temp.t299_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t299_id(901), pg_temp.t299_id(1), 'T299 Sales A'),
  (pg_temp.t299_id(903), pg_temp.t299_id(1), 'T299 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t299_id(1), pg_temp.t299_id(302), pg_temp.t299_id(901)),
  (pg_temp.t299_id(1), pg_temp.t299_id(303), pg_temp.t299_id(901)),
  (pg_temp.t299_id(1), pg_temp.t299_id(304), pg_temp.t299_id(903));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t299_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t299_admin_setup \gset

-- The real T2 provisioning creates the two telephony roles in every active organization.
SELECT platform_private.telephony_rights_provision('T299 provision') IS NOT NULL AS t299_provisioned \gset
SELECT pg_temp.t299_assert(:'t299_provisioned'::BOOLEAN, 'the T2 provisioning ran');

SELECT pg_temp.t299_assert(
  pg_temp.t299_call('authenticated', :'t299_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T299 create role', %L::UUID)$q$,
    pg_temp.t299_id(1), pg_temp.t299_id(1101),
    jsonb_build_object('label', 'T299 lead access', 'description', 'T299 synthetic lead.read role',
      'permissionKeys', '["lead.read"]'::JSONB),
    pg_temp.t299_id(1111))) ->> 'status' = 'applied',
  'the Admin creates the lead.read role through the real RPC');
SELECT pg_temp.t299_call('authenticated', :'t299_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T299 publish role', %L::UUID)$q$,
    pg_temp.t299_id(1), pg_temp.t299_id(1101), pg_temp.t299_id(1), pg_temp.t299_id(1101), pg_temp.t299_id(1112))) ->> 'status' AS t299_published \gset
SELECT pg_temp.t299_assert(:'t299_published' = 'applied', 'the Admin publishes the lead.read role');

CREATE FUNCTION pg_temp.t299_telrole(p_label TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT id FROM platform.staff_role_definitions WHERE organization_id = pg_temp.t299_id(1) AND label = p_label
$$;
CREATE FUNCTION pg_temp.t299_assign(p_actor INTEGER, p_req INTEGER, p_items JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_claims TEXT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t299_id(200 + p_actor);
  SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', i.kind, 'key', i.scope_key,
      'resourceKind', NULL)) ORDER BY r.id),
    jsonb_agg(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version) ORDER BY r.id)
  INTO items, bindings
  FROM jsonb_to_recordset(p_items) AS i(role_id UUID, kind TEXT, scope_key UUID)
  JOIN platform.staff_role_definitions r ON r.id = i.role_id
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id;
  v_claims := (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(101),
    'claims', jsonb_build_object('sub', pg_temp.t299_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
  RETURN pg_temp.t299_call('authenticated', v_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(300 + p_actor), v_version, items, bindings, 'T299 assign',
    pg_temp.t299_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t299_assert(
  pg_temp.t299_assign(2, 1, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t299_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)),
    jsonb_build_object('role_id', pg_temp.t299_id(1101), 'kind', 'department', 'scope_key', pg_temp.t299_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(3, 2, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t299_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)),
    jsonb_build_object('role_id', pg_temp.t299_id(1101), 'kind', 'department', 'scope_key', pg_temp.t299_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(4, 3, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t299_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)),
    jsonb_build_object('role_id', pg_temp.t299_id(1101), 'kind', 'department', 'scope_key', pg_temp.t299_id(903)))) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(5, 4, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t299_telrole('Телефония — руководитель'), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)),
    jsonb_build_object('role_id', pg_temp.t299_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)))) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(6, 5, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t299_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t299_id(1)))) ->> 'status' = 'applied',
  'the Admin assigns the telephony and lead.read roles through staff_role_assignments_save');

CREATE TEMP TABLE t299_claims(n INTEGER PRIMARY KEY, claims TEXT NOT NULL);
INSERT INTO t299_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t299_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 9) n;
CREATE FUNCTION pg_temp.t299_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_call('authenticated', (SELECT c.claims FROM t299_claims c WHERE c.n = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.t299_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_call('service_role', '{"role":"service_role"}', p_sql)
$$;
-- begin: actor, lead number (fixture), request number (fixture), organization number.
CREATE FUNCTION pg_temp.t299_dial(p_actor INTEGER, p_lead INTEGER, p_req INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_as(p_actor, format('SELECT platform.telephony_dial_begin_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(p_org), pg_temp.t299_id(5000 + p_lead), pg_temp.t299_id(9000 + p_req)))
$$;
CREATE FUNCTION pg_temp.t299_options(p_actor INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_as(p_actor, format('SELECT platform.telephony_dial_options_v1(%L::UUID)', pg_temp.t299_id(p_org)))
$$;
CREATE FUNCTION pg_temp.t299_target(p_dial UUID, p_actor INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_svc(format('SELECT platform.telephony_dial_target_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(p_org), p_dial, pg_temp.t299_id(300 + p_actor)))
$$;
CREATE FUNCTION pg_temp.t299_finish(p_dial UUID, p_actor INTEGER, p_outcome TEXT, p_callid TEXT DEFAULT NULL,
  p_http INTEGER DEFAULT NULL, p_error TEXT DEFAULT NULL, p_refusal TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_svc(format('SELECT platform.telephony_dial_finish_v1(%L::UUID, %L::UUID, %L::UUID, %L, %L, %L::INTEGER, %L, %L)',
    pg_temp.t299_id(p_org), p_dial, pg_temp.t299_id(300 + p_actor), p_outcome, p_callid, p_http, p_error, p_refusal))
$$;
-- The id of a dial answer.
CREATE FUNCTION pg_temp.t299_did(p_answer JSONB) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT (p_answer ->> 'dialRequestId')::UUID
$$;
-- Moves every dial row (and so every window) into the past.
CREATE FUNCTION pg_temp.t299_age(p_by INTERVAL) RETURNS VOID LANGUAGE SQL AS $$
  UPDATE platform_private.telephony_dial_requests SET created_at = created_at - p_by, updated_at = updated_at - p_by
$$;
CREATE FUNCTION pg_temp.t299_dials(p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_dial_requests WHERE organization_id = pg_temp.t299_id(p_org)
$$;
CREATE FUNCTION pg_temp.t299_journal() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.dial'
$$;

-- ---------------------------------------------------------------------------
-- Clients and leads. The phone of the client is what the dial uses.
--   lead 1  client 1  +996 700 000 001   owner manager A (department A)   — the lead under test
--   lead 2  client 2  +996 700 000 002   owner manager B (department B)
--   lead 3  client 3  no phone           owner A
--   lead 4  client 4  bare 555 281 777   owner A (a national number without a country: ambiguous)
--   lead 5  client 5  +7 701 123 45 67   owner A (a country outside the default prefixes)
--   lead 6  client 6  +996 900 123 456   owner A (premium range)
--   lead 7  client 7  +996 800 123 456   owner A (service range)
--   lead 8  client 8  +1 900 555 0100    owner A (premium range of a country that may be allowed)
--   lead 9  client 9  +996 700 000 009   owner A (a plain valid number for the limits)
--   lead 10 client 10 +996 700 000 010   org 2
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_cl(n INTEGER PRIMARY KEY, org INTEGER, phone TEXT, owner INTEGER);
INSERT INTO t299_cl VALUES
  (1, 1, '+996 700 000 001', 302), (2, 1, '+996 700 000 002', 304), (3, 1, NULL, 302), (4, 1, '555 281 777', 302),
  (5, 1, '+7 701 123 45 67', 302), (6, 1, '+996 900 123 456', 302), (7, 1, '+996 800 123 456', 302),
  (8, 1, '+1 900 555 0100', 302), (9, 1, '+996 700 000 009', 302), (10, 2, '+996 700 000 010', 309);
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state)
  SELECT pg_temp.t299_id(4000 + n), pg_temp.t299_id(org), 'T299 Client ' || n,
    platform_private.normalize_person_name('T299 Client ' || n), phone,
    CASE WHEN phone IS NULL THEN NULL ELSE platform_private.normalize_person_phone(phone) END, 'active'
  FROM t299_cl;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  SELECT pg_temp.t299_id(5000 + n), pg_temp.t299_id(org), pg_temp.t299_id(4000 + n), pg_temp.t299_id(owner), 'new', 'website', 'open'
  FROM t299_cl;

-- PBX users (§6.3): manager A, manager B and the supervisor are mapped; A2 and the Admin are not.
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id, active) VALUES
  (pg_temp.t299_id(1), 'u9902', '902', 'T299 PBX A', pg_temp.t299_id(302), TRUE),
  (pg_temp.t299_id(1), 'u9904', '904', 'T299 PBX B', pg_temp.t299_id(304), TRUE),
  (pg_temp.t299_id(1), 'u9905', '905', 'T299 PBX S', pg_temp.t299_id(305), TRUE),
  (pg_temp.t299_id(1), 'u9903', '903', 'T299 PBX A2 (not mapped)', NULL, TRUE),
  (pg_temp.t299_id(1), 'u9906', '906', 'T299 PBX old A2', pg_temp.t299_id(303), FALSE);

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('telephony_dial_options_v1', 'telephony_dial_begin_v1',
      'telephony_dial_target_v1', 'telephony_dial_finish_v1')),
  'the four public functions are owner-owned SECURITY DEFINER with an empty search_path');
SELECT pg_temp.t299_assert(
  (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_dial_options_v1(uuid)'::regprocedure) = 's'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)'::regprocedure) = 'v'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_dial_target_v1(uuid,uuid,uuid)'::regprocedure) = 's'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)'::regprocedure) = 'v',
  'options and target are STABLE, begin and finish are VOLATILE');
SELECT pg_temp.t299_assert(
  has_function_privilege('authenticated', 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE')) = 0,
  'options and begin are executable by authenticated only');
SELECT pg_temp.t299_assert(
  has_function_privilege('service_role', 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE')) = 0,
  'target and finish are executable by service_role only');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform_private.telephony_dial_number_blocked(text)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform_private.telephony_dial_record_refusal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE')) = 0
  AND NOT has_function_privilege('public', 'platform_private.telephony_dial_number_blocked(text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.telephony_dial_record_refusal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'the two helpers are closed to PUBLIC and every client role');
SELECT pg_temp.t299_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'
      AND p.proname <> 'telephony_automation_tick_v1')
  = ARRAY['telephony_claim_work_v1', 'telephony_dial_begin_v1', 'telephony_dial_finish_v1', 'telephony_dial_options_v1',
    'telephony_dial_target_v1', 'telephony_erase_person_v1', 'telephony_extension_map_v1', 'telephony_integration_health_v1',
    'telephony_lead_calls_v1', 'telephony_lead_recordings_v1', 'telephony_maintenance_plan_v1', 'telephony_manage_overview_v1',
    'telephony_project_work_v1', 'telephony_purge_evidence_v1', 'telephony_receive_v1', 'telephony_reconcile_apply_v1',
    'telephony_recording_consume_v1', 'telephony_recording_grant_v1', 'telephony_recording_report_v1',
    'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settings_save_v1', 'telephony_settle_calls_v1',
    'telephony_sync_extensions_v1'],
  'platform holds the twenty earlier public telephony functions and exactly these four new ones (the T8 automation tick, when its migration is earlier in the chain, is the only other name allowed)');
SELECT pg_temp.t299_assert('telephony.dial' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'telephony_dial_request' = ANY (platform_private.p7a_safe_audit_resource_types()),
  'the journal allowlist (T2) already knows telephony.dial and telephony_dial_request');
SELECT pg_temp.t299_assert(
  pg_temp.t299_call('authenticated', (SELECT c.claims FROM t299_claims c WHERE c.n = 1),
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_dial_requests') ->> 'error' LIKE '42501:%'
  AND pg_temp.t299_call('service_role', '{"role":"service_role"}',
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_dial_requests') ->> 'error' LIKE '42501:%',
  'the dial table stays closed to authenticated and service_role');
SELECT pg_temp.t299_assert(
  pg_temp.t299_call('service_role', '{"role":"authenticated"}', format(
    'SELECT platform.telephony_dial_target_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(9999), pg_temp.t299_id(302))) ->> 'error' = '42501:Service role is required'
  AND pg_temp.t299_call('service_role', '', format(
    'SELECT platform.telephony_dial_finish_v1(%L::UUID, %L::UUID, %L::UUID, %L, NULL, NULL, NULL, %L)',
    pg_temp.t299_id(1), pg_temp.t299_id(9999), pg_temp.t299_id(302), 'refused', 'pbx_offline')) ->> 'error' = '42501:Service role is required',
  'the role check is inside target and finish: service_role without the service claim is refused');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_as(1, format('SELECT platform.telephony_dial_finish_v1(%L::UUID, %L::UUID, %L::UUID, %L, NULL, NULL, NULL, %L)',
    pg_temp.t299_id(1), pg_temp.t299_id(9999), pg_temp.t299_id(301), 'refused', 'pbx_offline'))) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_as(1, format('SELECT platform.telephony_dial_target_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(9999), pg_temp.t299_id(301)))) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_call('anon', '{"role":"anon"}', format('SELECT platform.telephony_dial_begin_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(5001), pg_temp.t299_id(9001)))) = '42501',
  'an authenticated Admin cannot call target or finish, and anon cannot call begin (no EXECUTE)');

-- ---------------------------------------------------------------------------
-- 2. The switch: no settings row, then each flag alone.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_settings), 'sanity: no settings row exists');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 1) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_dial(1, 1, 2) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_dial(5, 1, 3) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_options(2) = '{"enabled": false, "mapped": false}'::JSONB
  AND pg_temp.t299_options(1) = '{"enabled": false, "mapped": false}'::JSONB,
  'without a settings row everyone, the Admin and the supervisor included, is refused with one text and sees no button');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t299_id(1));
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 1) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_options(2) = '{"enabled": false, "mapped": false}'::JSONB,
  'the default row (every flag off) dials nothing');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 1) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_options(2) = '{"enabled": false, "mapped": false}'::JSONB,
  'ui_enabled alone does not open dialling');
UPDATE platform_private.telephony_settings SET ui_enabled = FALSE, dial_enabled = TRUE WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 1) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_options(2) = '{"enabled": false, "mapped": false}'::JSONB,
  'dial_enabled alone does not open dialling either (the call result and the button are one feature, plan 9.1)');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE, outbound_paused = TRUE WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 1) ->> 'error' = '55000:telephony_dial_disabled'
  AND pg_temp.t299_options(2) = '{"enabled": false, "mapped": false}'::JSONB,
  'outbound_paused switches dialling off entirely (key rotation, plan 5.5)');
SELECT pg_temp.t299_assert(pg_temp.t299_dials() = 0 AND pg_temp.t299_journal() = 0,
  'a switched-off dial writes no row and no journal entry');
UPDATE platform_private.telephony_settings SET outbound_paused = FALSE WHERE organization_id = pg_temp.t299_id(1);
-- Organization 2 has its own settings row: flags are per organization.
INSERT INTO platform_private.telephony_settings(organization_id, ui_enabled, dial_enabled) VALUES (pg_temp.t299_id(2), TRUE, TRUE);

-- ---------------------------------------------------------------------------
-- 3. Rights and options.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  pg_temp.t299_options(2) = '{"enabled": true, "mapped": true}'::JSONB
  AND pg_temp.t299_options(4) = '{"enabled": true, "mapped": true}'::JSONB
  AND pg_temp.t299_options(5) = '{"enabled": true, "mapped": true}'::JSONB
  AND pg_temp.t299_options(3) = '{"enabled": true, "mapped": false}'::JSONB
  AND pg_temp.t299_options(1) = '{"enabled": true, "mapped": false}'::JSONB,
  'options: managers and the supervisor see the button; A2 and the Admin are not mapped (an inactive old mapping does not count)');
SELECT pg_temp.t299_assert(
  pg_temp.t299_options(6) = '{"enabled": false, "mapped": false}'::JSONB
  AND pg_temp.t299_options(8) = '{"enabled": false, "mapped": false}'::JSONB
  AND pg_temp.t299_code(pg_temp.t299_options(7)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_options(9)) = '42501'
  AND pg_temp.t299_options(9, 2) = '{"enabled": true, "mapped": false}'::JSONB
  AND pg_temp.t299_code(pg_temp.t299_options(2, 2)) = '42501',
  'options: a plain lead reader and a member without roles see no button; a Student and a foreign organization are refused (42501); organization 2 has its own switch');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_dial(6, 1, 1)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_dial(7, 1, 1)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_dial(8, 1, 1)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_dial(9, 1, 1)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_dial(2, 1, 1, 2)) = '42501'
  AND pg_temp.t299_dial(6, 1, 1) ->> 'error' = '42501:telephony_dial_forbidden',
  'a plain lead reader (no dial right), a Student, a member without roles, another organization and a foreign organization id are refused with one text');
SELECT pg_temp.t299_assert(pg_temp.t299_dials() = 0 AND pg_temp.t299_journal() = 0, 'refused-by-right dials write nothing');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_as(2, format('SELECT platform.telephony_dial_begin_v1(NULL::UUID, %L::UUID, %L::UUID)',
    pg_temp.t299_id(5001), pg_temp.t299_id(9001)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_as(2, format('SELECT platform.telephony_dial_begin_v1(%L::UUID, NULL::UUID, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(9001)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_as(2, format('SELECT platform.telephony_dial_begin_v1(%L::UUID, %L::UUID, NULL::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(5001)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_as(2, 'SELECT platform.telephony_dial_options_v1(NULL::UUID)')) = '22023',
  'NULL arguments are refused with 22023');

-- ---------------------------------------------------------------------------
-- 4. Lead visibility.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(4, 1, 1) ->> 'error' = 'P0002:telephony_dial_lead_unavailable'
  AND pg_temp.t299_dial(2, 2, 1) ->> 'error' = 'P0002:telephony_dial_lead_unavailable'
  AND pg_temp.t299_dial(2, 10, 1) ->> 'error' = 'P0002:telephony_dial_lead_unavailable'
  AND pg_temp.t299_as(2, format('SELECT platform.telephony_dial_begin_v1(%L::UUID, gen_random_uuid(), %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(9001))) ->> 'error' = 'P0002:telephony_dial_lead_unavailable',
  'lead.read decides: manager B cannot dial lead 1, manager A cannot dial lead 2, a lead of another organization and an unknown lead answer the same text');
SELECT pg_temp.t299_assert(pg_temp.t299_dials() = 0 AND pg_temp.t299_journal() = 0, 'an unavailable lead writes nothing');

-- ---------------------------------------------------------------------------
-- 5. The number and the mapping: refusals are recorded, without number or login.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_r(k TEXT PRIMARY KEY, answer JSONB);
INSERT INTO t299_r VALUES
  ('no_phone', pg_temp.t299_dial(2, 3, 10)),
  ('bare', pg_temp.t299_dial(2, 4, 11)),
  ('country', pg_temp.t299_dial(2, 5, 12)),
  ('premium_kg', pg_temp.t299_dial(2, 6, 13)),
  ('service_kg', pg_temp.t299_dial(2, 7, 14)),
  ('nanp', pg_temp.t299_dial(2, 8, 15));
SELECT pg_temp.t299_assert(
  (SELECT answer ->> 'status' = 'refused' AND answer ->> 'code' = 'lead_no_phone' FROM t299_r WHERE k = 'no_phone')
  AND (SELECT answer ->> 'code' = 'number_invalid' FROM t299_r WHERE k = 'bare')
  AND (SELECT answer ->> 'code' = 'prefix_not_allowed' FROM t299_r WHERE k = 'country')
  AND (SELECT answer ->> 'code' = 'prefix_not_allowed' FROM t299_r WHERE k = 'nanp')
  AND (SELECT answer ->> 'code' = 'number_blocked' FROM t299_r WHERE k = 'premium_kg')
  AND (SELECT answer ->> 'code' = 'number_blocked' FROM t299_r WHERE k = 'service_kg'),
  'no phone, a bare national number, a country outside the allowed prefixes, a premium and a service range are refused with their codes');
SELECT pg_temp.t299_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM (SELECT jsonb_object_keys(answer) k FROM t299_r WHERE k = 'bare') x)
    = ARRAY['code', 'dialRequestId', 'status'],
  'a refusal answer is exactly status, dialRequestId and code');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dials() = 6 AND pg_temp.t299_journal() = 6
  AND (SELECT bool_and(d.status = 'refused' AND d.refusal_code IS NOT NULL AND d.client_phone IS NULL AND d.pbx_user IS NULL
        AND d.pbx_callid IS NULL AND d.membership_id = pg_temp.t299_id(302))
      FROM platform_private.telephony_dial_requests d)
  AND (SELECT bool_and(e.resource_type = 'telephony_dial_request' AND e.actor_membership_id = pg_temp.t299_id(302)
        AND e.after_state ->> 'status' = 'refused' AND e.after_state ->> 'code' IS NOT NULL)
      FROM platform.audit_events e WHERE e.action = 'telephony.dial'),
  'every refusal is one row without number or PBX login and ONE journal row of the dialling employee');
-- Opening the country opens its numbers; the premium range of an opened country stays closed.
UPDATE platform_private.telephony_settings SET dial_prefixes = '{+996,+7,+1}' WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 5, 20) ->> 'status' = 'accepted'
  AND pg_temp.t299_dial(2, 8, 21) ->> 'code' = 'number_blocked',
  'an added prefix opens that country (+7 accepted); a premium range of an opened country (+1 900) stays blocked');
UPDATE platform_private.telephony_settings SET dial_prefixes = '{+996}' WHERE organization_id = pg_temp.t299_id(1);
-- The blocked-range helper itself, on a table of fictional numbers.
SELECT pg_temp.t299_assert(
  (SELECT bool_and(platform_private.telephony_dial_number_blocked(n) = expected)
   FROM (VALUES ('+996700000001', FALSE), ('+996555123456', FALSE), ('+996990123456', FALSE), ('+996312123456', FALSE),
     ('+77011234567', FALSE), ('+12025550100', FALSE), ('+442071838750', FALSE), ('+4915112345678', FALSE),
     ('+971501234567', FALSE), ('+996900123456', TRUE), ('+996800123456', TRUE), ('+78001234567', TRUE),
     ('+78091234567', TRUE), ('+19005550100', TRUE), ('+19765550100', TRUE), ('+449012345678', TRUE),
     ('+447012345678', TRUE), ('+499001234567', TRUE), ('+491371234567', TRUE), ('+491801234567', TRUE),
     ('+491181234567', TRUE), ('+80012345678', TRUE), ('+88213456789', TRUE), ('+87012345678', TRUE),
     ('+97912345678', TRUE), ('+88812345678', TRUE), ('+112', TRUE), ('+1234567', TRUE), ('+99670000', TRUE),
     ('+9967000000012', FALSE), ('996700000001', TRUE), ('+0996700000001', TRUE), ('', TRUE),
     ('+99670000000a', TRUE)) AS t(n, expected))
   AND platform_private.telephony_dial_number_blocked(NULL),
  'short numbers, ITU non-geographic codes and the premium / service ranges are blocked; ordinary numbers are not; a malformed value and NULL are blocked');

-- The mapping: A2 and the Admin have no active PBX user.
SELECT pg_temp.t299_assert(pg_temp.t299_dial(3, 1, 29) ->> 'code' = 'not_mapped',
  'sanity: A2 (department A) can read lead 1 — the dial reaches the mapping check');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(3, 9, 30) ->> 'code' = 'not_mapped'
  AND pg_temp.t299_dial(1, 9, 31) ->> 'code' = 'not_mapped'
  AND pg_temp.t299_dial(3, 9, 30) ->> 'status' = 'replayed',
  'an employee without an active PBX user is refused (not_mapped), the Admin included; the repeat is a replay of the refusal');
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, membership_id, active)
  VALUES (pg_temp.t299_id(1), 'u9907', '907', pg_temp.t299_id(303), TRUE);
SELECT pg_temp.t299_assert(
  pg_temp.t299_options(3) = '{"enabled": true, "mapped": true}'::JSONB
  AND pg_temp.t299_dial(3, 9, 32) ->> 'status' = 'accepted',
  'after the mapping A2 sees mapped = true and dials');
SELECT pg_temp.t299_finish(pg_temp.t299_did(pg_temp.t299_dial(3, 9, 32)), 3, 'failed', NULL, 400, 'pbx_validation_error') AS t299_unused \gset
SELECT pg_temp.t299_age(INTERVAL '2 minutes');

-- ---------------------------------------------------------------------------
-- 6. The accepted dial, target and finish.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_dial(2, 1, 40) AS t299_a1 \gset
SELECT pg_temp.t299_assert(
  :'t299_a1'::JSONB ->> 'status' = 'accepted'
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(:'t299_a1'::JSONB) k) = ARRAY['dialRequestId', 'status']
  AND :'t299_a1'::JSONB::TEXT NOT LIKE '%700000001%' AND :'t299_a1'::JSONB::TEXT NOT LIKE '%u9902%',
  'begin answers exactly status and the dial id — never the number or the PBX login');
SELECT pg_temp.t299_assert(
  (SELECT d.status = 'requested' AND d.client_phone = '+996700000001' AND d.pbx_user = 'u9902'
      AND d.membership_id = pg_temp.t299_id(302) AND d.lead_id = pg_temp.t299_id(5001) AND d.client_id = pg_temp.t299_id(4001)
      AND d.request_id = pg_temp.t299_id(9040) AND d.pbx_callid IS NULL AND d.refusal_code IS NULL
    FROM platform_private.telephony_dial_requests d WHERE d.id = pg_temp.t299_did(:'t299_a1'::JSONB))
  AND pg_temp.t299_journal() = (SELECT count(*) FROM platform_private.telephony_dial_requests WHERE status <> 'requested'),
  'the row holds the E.164 number and the login for the server; a dial is journaled once, when it has a result — a requested one is not');
-- Target: the right employee, the server only.
SELECT pg_temp.t299_target(pg_temp.t299_did(:'t299_a1'::JSONB), 2) AS t299_t1 \gset
SELECT pg_temp.t299_assert(
  :'t299_t1'::JSONB = '{"phone": "+996700000001", "pbxUser": "u9902"}'::JSONB,
  'target returns exactly the login and the E.164 number');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(:'t299_a1'::JSONB), 3)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(:'t299_a1'::JSONB), 4)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(:'t299_a1'::JSONB), 2, 2)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_id(9999), 2)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(pg_temp.t299_dial(2, 3, 10)), 2)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_svc(format('SELECT platform.telephony_dial_target_v1(%L::UUID, NULL::UUID, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(302)))) = '22023',
  'target refuses another employee, another organization, an unknown dial and a refused dial (P0002), and a NULL argument (22023)');
-- A dial older than two minutes can no longer be fetched.
SELECT pg_temp.t299_age(INTERVAL '3 minutes');
SELECT pg_temp.t299_assert(pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(:'t299_a1'::JSONB), 2)) = 'P0002',
  'target refuses a requested dial older than two minutes');
SELECT pg_temp.t299_dial(2, 1, 41) AS t299_a2 \gset
-- Finish: the shape of each outcome.
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', NULL)) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'unconfirmed', 'x1', NULL, 'pbx_timeout')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'failed', NULL, 400, NULL)) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'failed', NULL, 400, 'Bad Code')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 'c1', 200, 'pbx_x')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'refused', NULL, NULL, NULL, NULL)) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'refused', NULL, NULL, NULL, 'not_mapped')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 'c1', 200, NULL, 'pbx_offline')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'done', 'c1')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', ' c1 ')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', repeat('c', 201))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 'c1', 99)) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 'c1', 600)) = '22023'
  AND (SELECT d.status FROM platform_private.telephony_dial_requests d WHERE d.id = pg_temp.t299_did(:'t299_a2'::JSONB)) = 'requested',
  'finish refuses every wrong combination of outcome, call id, error code, refusal code and HTTP status — and leaves the row requested');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 3, 'sent', 'c1')) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 'c1', NULL, NULL, NULL, 2)) = 'P0002'
  AND pg_temp.t299_code(pg_temp.t299_finish(pg_temp.t299_id(9999), 2, 'sent', 'c1')) = 'P0002',
  'finish refuses another employee, another organization and an unknown dial');
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 't299-call-001', 200) AS t299_f1 \gset
SELECT pg_temp.t299_assert(
  :'t299_f1'::JSONB = '{"status": "sent", "changed": true}'::JSONB
  AND (SELECT d.status = 'sent' AND d.pbx_callid = 't299-call-001' AND d.pbx_http_status = 200 AND d.pbx_error_code IS NULL
      FROM platform_private.telephony_dial_requests d WHERE d.id = pg_temp.t299_did(:'t299_a2'::JSONB)),
  'finish sent: the call id and the status are stored');
-- A dial that has its result is not handed out again: the number can be fetched only for a requested dial.
SELECT pg_temp.t299_assert(pg_temp.t299_code(pg_temp.t299_target(pg_temp.t299_did(:'t299_a2'::JSONB), 2)) = 'P0002',
  'target refuses a dial that already has its result (the number is fetched once, for a requested dial)');
SELECT pg_temp.t299_journal() AS t299_j_before \gset
SELECT pg_temp.t299_assert(
  pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'sent', 't299-call-001', 200) = '{"status": "sent", "changed": false}'::JSONB
  AND pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'failed', NULL, 500, 'pbx_server_error') = '{"status": "sent", "changed": false}'::JSONB
  AND pg_temp.t299_finish(pg_temp.t299_did(:'t299_a2'::JSONB), 2, 'refused', NULL, NULL, NULL, 'pbx_offline') = '{"status": "sent", "changed": false}'::JSONB
  AND pg_temp.t299_journal() = :t299_j_before,
  'a repeat of finish — also with another outcome — changes nothing and journals nothing');
-- The other outcomes.
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 1, 42) AS t299_a3 \gset
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a3'::JSONB), 2, 'unconfirmed', NULL, NULL, 'pbx_timeout') AS t299_f3 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 1, 43) AS t299_a4 \gset
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a4'::JSONB), 2, 'failed', NULL, 401, 'pbx_invalid_token') AS t299_f4 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 1, 44) AS t299_a5 \gset
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a5'::JSONB), 2, 'refused', NULL, NULL, NULL, 'pbx_offline') AS t299_f5 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 1, 45) AS t299_a6 \gset
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a6'::JSONB), 2, 'refused', NULL, NULL, NULL, 'pbx_user_not_found') AS t299_f6 \gset
SELECT pg_temp.t299_assert(
  (SELECT d.status = 'unconfirmed' AND d.pbx_error_code = 'pbx_timeout' AND d.pbx_callid IS NULL FROM platform_private.telephony_dial_requests d
    WHERE d.id = pg_temp.t299_did(:'t299_a3'::JSONB))
  AND (SELECT d.status = 'failed' AND d.pbx_error_code = 'pbx_invalid_token' AND d.pbx_http_status = 401 AND d.pbx_callid IS NULL
    FROM platform_private.telephony_dial_requests d WHERE d.id = pg_temp.t299_did(:'t299_a4'::JSONB))
  AND (SELECT d.status = 'refused' AND d.refusal_code = 'pbx_offline' AND d.pbx_callid IS NULL FROM platform_private.telephony_dial_requests d
    WHERE d.id = pg_temp.t299_did(:'t299_a5'::JSONB))
  AND (SELECT d.status = 'refused' AND d.refusal_code = 'pbx_user_not_found' FROM platform_private.telephony_dial_requests d
    WHERE d.id = pg_temp.t299_did(:'t299_a6'::JSONB)),
  'unconfirmed (a timeout), failed (the PBX said no) and refused (offline / unknown PBX user) are stored with their codes');

-- ---------------------------------------------------------------------------
-- 7. Idempotency.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_dials() AS t299_rows, pg_temp.t299_journal() AS t299_jrows \gset
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 42) = jsonb_build_object('status', 'replayed', 'dialRequestId', pg_temp.t299_did(:'t299_a3'::JSONB),
    'requestStatus', 'unconfirmed', 'code', 'pbx_timeout')
  AND pg_temp.t299_dial(2, 1, 41) = jsonb_build_object('status', 'replayed', 'dialRequestId', pg_temp.t299_did(:'t299_a2'::JSONB),
    'requestStatus', 'sent', 'code', NULL)
  AND pg_temp.t299_dial(2, 1, 44) ->> 'requestStatus' = 'refused' AND pg_temp.t299_dial(2, 1, 44) ->> 'code' = 'pbx_offline'
  AND pg_temp.t299_dial(2, 3, 10) ->> 'status' = 'replayed' AND pg_temp.t299_dial(2, 3, 10) ->> 'requestStatus' = 'refused'
  AND pg_temp.t299_dial(2, 3, 10) ->> 'code' = 'lead_no_phone',
  'the same request id of the same employee replays the earlier result (sent, unconfirmed, refused by the PBX check, refused by a rule)');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dials() = :t299_rows AND pg_temp.t299_journal() = :t299_jrows,
  'a replay writes no row and no journal entry — there is no second dial');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 9, 41) ->> 'error' = 'PT409:telephony_dial_request_conflict'
  AND pg_temp.t299_dial(2, 1, 10) ->> 'error' = 'PT409:telephony_dial_request_conflict',
  'a request id used for another lead is a conflict (PT409), also for a refused one');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(5, 1, 41) ->> 'status' = 'accepted'
  AND pg_temp.t299_dial(5, 1, 41) ->> 'status' = 'replayed',
  'another employee has his own request id space: the same id is a new dial for him and a replay the second time');
-- A request that never got its result: young is "requested", old becomes "unconfirmed" with its own journal row.
SELECT pg_temp.t299_age(INTERVAL '10 seconds');
SELECT pg_temp.t299_dial(2, 1, 46) AS t299_a7 \gset
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 46) = jsonb_build_object('status', 'replayed', 'dialRequestId', pg_temp.t299_did(:'t299_a7'::JSONB),
    'requestStatus', 'requested', 'code', NULL),
  'a young requested dial replays as requested (in progress)');
SELECT pg_temp.t299_journal() AS t299_j7 \gset
SELECT pg_temp.t299_age(INTERVAL '3 minutes');
SELECT pg_temp.t299_dial(2, 1, 46) AS t299_s1 \gset
SELECT pg_temp.t299_journal() AS t299_j8 \gset
SELECT pg_temp.t299_dial(2, 1, 46) AS t299_s2 \gset
SELECT pg_temp.t299_journal() AS t299_j9 \gset
SELECT pg_temp.t299_assert(
  :'t299_s1'::JSONB = jsonb_build_object('status', 'replayed', 'dialRequestId', pg_temp.t299_did(:'t299_a7'::JSONB),
    'requestStatus', 'unconfirmed', 'code', 'finish_lost')
  AND :t299_j8 = :t299_j7 + 1
  AND :'t299_s2'::JSONB ->> 'requestStatus' = 'unconfirmed' AND :t299_j9 = :t299_j8
  AND (SELECT d.status = 'unconfirmed' AND d.pbx_error_code = 'finish_lost' FROM platform_private.telephony_dial_requests d
    WHERE d.id = pg_temp.t299_did(:'t299_a7'::JSONB)),
  'a dial that never got its result becomes unconfirmed (finish_lost) with ONE journal row on the next replay');
SELECT pg_temp.t299_finish(pg_temp.t299_did(:'t299_a7'::JSONB), 2, 'sent', 'late-call') AS t299_late \gset
SELECT pg_temp.t299_assert(:'t299_late'::JSONB = '{"status": "unconfirmed", "changed": false}'::JSONB,
  'a late finish after the conversion changes nothing');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM platform_private.telephony_dial_requests d WHERE d.status = 'refused' AND d.client_phone IS NOT NULL
     AND d.refusal_code NOT IN ('pbx_offline', 'pbx_user_not_found')) = 0,
  'a rule refusal never keeps the number; only the PBX-status refusals (decided after the number was stored) keep it for the erasure function');

-- ---------------------------------------------------------------------------
-- 8. Limits (all windows slide; refusals do not count).
-- ---------------------------------------------------------------------------
-- Start from an empty history so the counts are exact.
DELETE FROM platform_private.telephony_dial_requests;
UPDATE platform_private.telephony_settings
   SET limit_user_gap_seconds = 5, limit_user_day = 150, limit_org_hour = 60, limit_org_day = 400
 WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(2, 1, 50) ->> 'status' = 'accepted'
  AND pg_temp.t299_dial(2, 9, 51) ->> 'code' = 'rate_gap'
  AND pg_temp.t299_dial(4, 2, 52) ->> 'status' = 'accepted',
  'the gap: a second dial of the same employee within the gap is refused (rate_gap); another employee is not held up');
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_assert(pg_temp.t299_dial(2, 9, 53) ->> 'status' = 'accepted',
  'after the gap the employee dials again (a refusal did not start a new gap)');
-- User day limit: 3 per rolling 24 hours.
DELETE FROM platform_private.telephony_dial_requests;
UPDATE platform_private.telephony_settings SET limit_user_day = 3 WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_dial(2, 9, 60) ->> 'status' AS t299_u1 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 9, 61) ->> 'status' AS t299_u2 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_dial(2, 9, 62) ->> 'status' AS t299_u3 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_assert(:'t299_u1' = 'accepted' AND :'t299_u2' = 'accepted' AND :'t299_u3' = 'accepted'
  AND pg_temp.t299_dial(2, 9, 63) ->> 'code' = 'limit_user_day'
  AND pg_temp.t299_dial(5, 9, 64) ->> 'status' = 'accepted',
  'the per-employee day limit: the fourth dial is refused (limit_user_day), a colleague is not');
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_assert(pg_temp.t299_dial(2, 9, 65) ->> 'code' = 'limit_user_day',
  'refused rows do not count, but the three real dials still do');
SELECT pg_temp.t299_age(INTERVAL '24 hours');
SELECT pg_temp.t299_assert(pg_temp.t299_dial(2, 9, 66) ->> 'status' = 'accepted',
  'the window slides: after 24 hours the employee dials again');
-- Org hour limit: 2 per rolling hour; the day limit is larger.
DELETE FROM platform_private.telephony_dial_requests;
UPDATE platform_private.telephony_settings SET limit_user_day = 150, limit_org_hour = 2, limit_org_day = 4
 WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_dial(2, 9, 70) ->> 'status' AS t299_h1 \gset
SELECT pg_temp.t299_dial(4, 2, 71) ->> 'status' AS t299_h2 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_assert(:'t299_h1' = 'accepted' AND :'t299_h2' = 'accepted'
  AND pg_temp.t299_dial(5, 9, 72) ->> 'code' = 'limit_org_hour',
  'the organization hour limit: the third dial within an hour is refused (limit_org_hour) whoever dials');
SELECT pg_temp.t299_age(INTERVAL '2 hours');
SELECT pg_temp.t299_dial(5, 9, 73) ->> 'status' AS t299_h3 \gset
SELECT pg_temp.t299_dial(2, 9, 74) ->> 'status' AS t299_h4 \gset
SELECT pg_temp.t299_age(INTERVAL '1 minute');
SELECT pg_temp.t299_assert(:'t299_h3' = 'accepted' AND :'t299_h4' = 'accepted'
  AND pg_temp.t299_dial(5, 9, 75) ->> 'code' = 'limit_org_hour',
  'after two hours the hour window is empty again: two more dials, then the hour limit again');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM platform_private.telephony_dial_requests WHERE status <> 'refused') = 4
  AND pg_temp.t299_dial(5, 9, 76) ->> 'code' = 'limit_org_hour',
  'sanity: four real dials within 24 hours, the hour limit still bites');
SELECT pg_temp.t299_age(INTERVAL '90 minutes');
SELECT pg_temp.t299_assert(
  pg_temp.t299_dial(5, 9, 77) ->> 'code' = 'limit_org_day',
  'the organization day limit: the hour window is free but four dials already stand in the day (limit_org_day)');
SELECT pg_temp.t299_age(INTERVAL '24 hours');
SELECT pg_temp.t299_assert(pg_temp.t299_dial(5, 9, 78) ->> 'status' = 'accepted',
  'the day window slides too');
UPDATE platform_private.telephony_settings
   SET limit_user_gap_seconds = 5, limit_user_day = 150, limit_org_hour = 60, limit_org_day = 400
 WHERE organization_id = pg_temp.t299_id(1);

-- ---------------------------------------------------------------------------
-- 9. The journal and what must never leak.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'telephony.dial') > 0
  AND (SELECT bool_and(e.resource_type = 'telephony_dial_request' AND e.resource_id IS NOT NULL
        AND (e.after_state ->> 'status') IN ('refused', 'sent', 'unconfirmed', 'failed')
        AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(e.after_state) k)
          <@ ARRAY['code', 'dialRequestId', 'httpStatus', 'leadId', 'status'])
      FROM platform.audit_events e WHERE e.action = 'telephony.dial'),
  'every journal row of a dial is over telephony_dial_request and carries only status, code, httpStatus, leadId and dialRequestId');
SELECT pg_temp.t299_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.dial'
    AND (to_jsonb(e)::TEXT LIKE '%700000%' OR to_jsonb(e)::TEXT LIKE '%u99%' OR to_jsonb(e)::TEXT LIKE '%t299-call%'
      OR to_jsonb(e)::TEXT LIKE '%late-call%' OR to_jsonb(e)::TEXT LIKE '%T299 Client%' OR to_jsonb(e)::TEXT LIKE '%@%')),
  'no journal row holds a number, a PBX login, a call id, a client name or an e-mail');
-- The number is read by target only: the other three functions never name the dial row''s phone column.
SELECT pg_temp.t299_assert(
  (SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_dial\_%' AND pg_get_functiondef(p.oid) ILIKE '%client_phone%')
  = ARRAY['telephony_dial_begin_v1', 'telephony_dial_target_v1'],
  'the dial-row phone column is named only by begin (writes it) and target (the single reader)');
SELECT pg_temp.t299_assert(
  (SELECT d NOT ILIKE '%phone%' AND d NOT ILIKE '%.pbx_user%'
    FROM (SELECT pg_get_functiondef('platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)'::regprocedure) AS d) x)
  AND (SELECT d NOT ILIKE '%phone%' AND d NOT ILIKE '%.pbx_user%'
    FROM (SELECT pg_get_functiondef('platform.telephony_dial_options_v1(uuid)'::regprocedure) AS d) x),
  'finish and options never name the number or the PBX login of a dial row');
-- The earlier telephony functions keep their ACL.
SELECT pg_temp.t299_assert(
  has_function_privilege('authenticated', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE'),
  'the earlier telephony functions keep their ACL');

\echo T299_TELEPHONY_DIAL_SUITE_END
SELECT 'T299_TELEPHONY_DIAL_SUITE_PASSED' AS t299_suite_marker;
ROLLBACK;
