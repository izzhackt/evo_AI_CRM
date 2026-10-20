\set ON_ERROR_STOP on
-- Boundary suite for migration 311: «Подключение WhatsApp» пишет след в журнал платформы
-- (docs/PLAN_CHANGES.md «2026-10-20 · «Подключение WhatsApp» пишет в журнал платформы
-- (миграция 311)»). Runs on the real chain right after 311 inside one transaction that is
-- rolled back, with its own synthetic organizations and members; sessions are the real
-- custom_access_token_hook claims. No WAHA, no phone number, no QR, no provider, no real
-- person, no production action.
--
-- Proves:
--  1. catalog and grants: platform.record_whatsapp_connect_v1(text) is SECURITY DEFINER with
--     an empty search_path, owner postgres, VOLATILE, one parameter (p_kind: no phone, QR or
--     code can be passed), EXECUTE for authenticated only (no PUBLIC entry); the allowlist
--     function and its renamed predecessor are closed to every client role;
--  2. the Admin of the session's organization succeeds: one audit_events row per call, with
--     the actor (profile, membership, auth principal), the organization, the action
--     whatsapp.connect.qr / whatsapp.connect.code, object organization, before_state NULL,
--     after_state exactly {"kind": ...}, a reason, a request id and a time; two calls are two
--     rows with two request ids; the receipt is the stored row's kind and time;
--  3. nothing else may call it: a member without a role, a Sales member, a Student, an
--     inactive Admin, an Admin whose claims point at another organization or another member,
--     a session without claims, anon and service_role are refused and no row appears; the
--     refusal of a non-Admin comes before the kind check;
--  4. a bad kind from the Admin (NULL, empty, wrong case, a trailing space, any other word,
--     a phone-like or code-like string) is 22023 and writes nothing;
--  5. organizations are separate: another organization's Admin writes into its own
--     organization only;
--  6. the journal: the two actions are in p7a_safe_audit_actions(), the old list is intact
--     plus exactly two, and the real search_audit_events() returns the rows as Staff with
--     only the ten safe keys (no kind, no state), the reason hidden, the object organization.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $w311_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$w311_auth_role$;

\echo W311_WHATSAPP_CONNECT_AUDIT_SUITE_START

CREATE FUNCTION pg_temp.w311_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.w311_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'W311: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.w311_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
  v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.w311_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE TEMP TABLE w311_claims(actor INTEGER PRIMARY KEY, claims TEXT);
-- A request: actor, kind (NULL = SQL NULL).
CREATE FUNCTION pg_temp.w311_record(p_actor INTEGER, p_kind TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.w311_call('authenticated', (SELECT claims FROM w311_claims WHERE actor = p_actor),
    format('SELECT platform.record_whatsapp_connect_v1(%L)', p_kind))
$$;
CREATE FUNCTION pg_temp.w311_rows() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%'
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   actor 1  org 1 Admin (system admin)         actor 5  org 2 Admin (system admin)
--   actor 2  org 1 staff without a role         actor 6  org 1 Admin, membership later inactive
--   actor 3  org 1 Sales                        actor 7  org 1 Curator
--   actor 4  org 1 Student
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE w311_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO w311_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, 'sales', FALSE),
  (4, 1, 'student', FALSE), (5, 2, 'admin', TRUE), (6, 1, 'admin', TRUE), (7, 1, 'curator', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.w311_id(1), 'W311 Fictional organization', 'active'),
  (pg_temp.w311_id(2), 'W311 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.w311_id(100 + n), 'w311-' || n || '@example.invalid', '{}'::JSONB FROM w311_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.w311_id(200 + n), pg_temp.w311_id(100 + n), 'W311 Actor ' || n, 'active', 1 FROM w311_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.w311_id(300 + a.n), pg_temp.w311_id(a.org), pg_temp.w311_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM w311_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.w311_id(300 + n) FROM w311_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.w311_id(401), pg_temp.w311_id(1), 'organization', pg_temp.w311_id(1), 1),
  (pg_temp.w311_id(402), pg_temp.w311_id(2), 'organization', pg_temp.w311_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.w311_id(1), pg_temp.w311_id(301), pg_temp.w311_id(401), 1, 1, TRUE, 'system', 'W311 synthetic scope', pg_temp.w311_id(601)),
  (pg_temp.w311_id(2), pg_temp.w311_id(305), pg_temp.w311_id(402), 1, 1, TRUE, 'system', 'W311 synthetic scope', pg_temp.w311_id(602)),
  (pg_temp.w311_id(1), pg_temp.w311_id(306), pg_temp.w311_id(401), 1, 1, TRUE, 'system', 'W311 synthetic scope', pg_temp.w311_id(603));
INSERT INTO w311_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.w311_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.w311_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM w311_actors a;
-- Actor 6 held a valid session; the membership then goes inactive.
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.w311_id(306);

SELECT pg_temp.w311_assert((SELECT count(*) = 7 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id')
    FROM w311_claims), 'every fixture actor got real hook claims');
SELECT pg_temp.w311_assert(pg_temp.w311_rows() = 0, 'the fixture starts with no WhatsApp journal rows');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_assert((SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'platform' AND p.proname = 'record_whatsapp_connect_v1'),
  'exactly one platform.record_whatsapp_connect_v1 exists');
SELECT pg_temp.w311_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND p.pronargs = 1 AND p.proargnames = ARRAY['p_kind']::TEXT[] AND p.proargtypes::TEXT = '25'
      AND p.prorettype = 'jsonb'::REGTYPE
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.record_whatsapp_connect_v1(text)'::regprocedure),
  'SECURITY DEFINER, empty search_path, owner postgres, VOLATILE, one text parameter p_kind, EXECUTE for authenticated only');
SELECT pg_temp.w311_assert((SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private'
      AND p.proname IN ('p7a_safe_audit_actions', 'p7a_safe_audit_actions_pre_whatsapp_connect_audit')),
  'the allowlist function and its renamed predecessor are closed to every client role');

-- ---------------------------------------------------------------------------
-- 2. The Admin of the session's organization.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_record(1, 'qr') AS w311_qr \gset
SELECT pg_temp.w311_assert(pg_temp.w311_err(:'w311_qr'::JSONB) IS NULL
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'w311_qr'::JSONB) k) = ARRAY['kind', 'recorded_at']
    AND :'w311_qr'::JSONB ->> 'kind' = 'qr' AND pg_temp.w311_rows() = 1,
  'the Admin''s QR request succeeds with a receipt {kind, recorded_at} and leaves one row');
SELECT pg_temp.w311_assert((SELECT count(*) = 1
      AND bool_and(e.organization_id = pg_temp.w311_id(1) AND e.actor_kind = 'user'
        AND e.actor_profile_id = pg_temp.w311_id(201) AND e.actor_membership_id = pg_temp.w311_id(301)
        AND e.actor_principal = 'auth:' || pg_temp.w311_id(101)::TEXT
        AND e.action = 'whatsapp.connect.qr' AND e.resource_type = 'organization'
        AND e.resource_id = pg_temp.w311_id(1) AND e.before_state IS NULL
        AND e.after_state = '{"kind":"qr"}'::JSONB
        AND btrim(e.reason) <> '' AND e.request_id IS NOT NULL
        AND e.created_at = (:'w311_qr'::JSONB ->> 'recorded_at')::TIMESTAMPTZ
        AND e.created_at <= clock_timestamp() AND e.created_at > clock_timestamp() - INTERVAL '5 minutes')
    FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%'),
  'the QR row: actor profile, membership and auth principal, organization, action, object organization, no before, after {kind}, reason, request id, time = receipt');
SELECT pg_temp.w311_record(1, 'pairing_code') AS w311_code \gset
SELECT pg_temp.w311_record(1, 'qr') AS w311_qr2 \gset
SELECT pg_temp.w311_assert(pg_temp.w311_err(:'w311_code'::JSONB) IS NULL AND pg_temp.w311_err(:'w311_qr2'::JSONB) IS NULL
    AND :'w311_code'::JSONB ->> 'kind' = 'pairing_code' AND pg_temp.w311_rows() = 3
    AND (SELECT count(DISTINCT e.request_id) = 3 FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%')
    AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'whatsapp.connect.code'
      AND e.after_state = '{"kind":"pairing_code"}'::JSONB AND e.resource_type = 'organization'
      AND e.resource_id = pg_temp.w311_id(1) AND e.before_state IS NULL)
    AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.action = 'whatsapp.connect.qr'),
  'a pairing code request is a whatsapp.connect.code row with {kind: pairing_code}; each call is its own row with its own request id');
SELECT pg_temp.w311_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%'
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.after_state) k) IS DISTINCT FROM ARRAY['kind']::TEXT[]),
  'after_state carries the single key kind: no phone number, QR, code or session data');

-- ---------------------------------------------------------------------------
-- 3. Everyone else is refused and nothing is written.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_assert(
  pg_temp.w311_err(pg_temp.w311_record(2, 'qr')) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(3, 'qr')) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(4, 'qr')) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(7, 'pairing_code')) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(6, 'qr')) = '42501',
  'a member without a role, Sales, a Student, a Curator and an Admin whose membership went inactive are refused (42501)');
SELECT pg_temp.w311_assert(
  pg_temp.w311_err(pg_temp.w311_record(2, 'phone')) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(3, NULL)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_record(4, 'phone')) = '42501',
  'a non-Admin is refused with 42501 even with a bad kind: the right is checked before the kind');
SELECT pg_temp.w311_assert(
  pg_temp.w311_err(pg_temp.w311_call('authenticated',
    (SELECT jsonb_set(claims::JSONB, '{platform_organization_id}', to_jsonb(pg_temp.w311_id(2)::TEXT))::TEXT
      FROM w311_claims WHERE actor = 1),
    $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('authenticated',
    (SELECT jsonb_set(claims::JSONB, '{platform_membership_id}', to_jsonb(pg_temp.w311_id(305)::TEXT))::TEXT
      FROM w311_claims WHERE actor = 1),
    $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('authenticated',
    (SELECT jsonb_set(claims::JSONB, '{platform_membership_id}', to_jsonb(pg_temp.w311_id(301)::TEXT))::TEXT
      FROM w311_claims WHERE actor = 5),
    $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501',
  'an Admin''s claims pointed at another organization, or at another member, or another Admin''s claims on a foreign membership, are refused');
SELECT pg_temp.w311_assert(
  pg_temp.w311_err(pg_temp.w311_call('authenticated', '', $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('authenticated', '{"role":"authenticated"}',
    $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('anon', '{"role":"anon"}', $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('anon', '', $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('service_role', '{"role":"service_role"}',
    $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501'
  AND pg_temp.w311_err(pg_temp.w311_call('service_role',
    (SELECT claims FROM w311_claims WHERE actor = 1), $q$SELECT platform.record_whatsapp_connect_v1('qr')$q$)) = '42501',
  'a session without membership claims, anon and service_role (even with the Admin''s claims) are refused (42501)');
SELECT pg_temp.w311_assert(pg_temp.w311_rows() = 3, 'no refused call left a row');

-- ---------------------------------------------------------------------------
-- 4. A bad kind from the Admin.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_assert(
  pg_temp.w311_err(pg_temp.w311_record(1, NULL)) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, '')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'QR')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'qr ')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'code')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'pairing')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'status')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, '+14155550100')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'KJ4M-9QWX')) = '22023'
  AND pg_temp.w311_err(pg_temp.w311_record(1, 'qr'' OR 1=1 --')) = '22023'
  AND pg_temp.w311_rows() = 3,
  'NULL, empty, wrong case, a trailing space, any other word, a phone-like and a code-like string are 22023 and write nothing');
SELECT pg_temp.w311_assert((pg_temp.w311_record(1, 'bad') ->> 'message') = 'whatsapp_connect_kind_invalid'
  AND (pg_temp.w311_record(2, 'qr') ->> 'message') = 'whatsapp_connect_forbidden',
  'the refusals carry their code words only');

-- ---------------------------------------------------------------------------
-- 5. Organizations are separate.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_record(5, 'qr') AS w311_other \gset
SELECT pg_temp.w311_assert(pg_temp.w311_err(:'w311_other'::JSONB) IS NULL
    AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%'
      AND e.organization_id = pg_temp.w311_id(2) AND e.resource_id = pg_temp.w311_id(2)
      AND e.actor_membership_id = pg_temp.w311_id(305) AND e.actor_profile_id = pg_temp.w311_id(205))
    AND (SELECT count(*) = 3 FROM platform.audit_events e WHERE e.action LIKE 'whatsapp.connect.%'
      AND e.organization_id = pg_temp.w311_id(1)),
  'another organization''s Admin writes into its own organization only; organization 1 still has its three rows');

-- ---------------------------------------------------------------------------
-- 6. The journal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w311_assert(
  'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'whatsapp.connect.code' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()))
  AND NOT ('whatsapp.connect.code' = ANY (platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()))
  AND cardinality(platform_private.p7a_safe_audit_actions())
    = cardinality(platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()) + 2
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()) a
    WHERE NOT (a = ANY (platform_private.p7a_safe_audit_actions())))
  AND 'organization' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND platform_private.p7a_changed_field_codes('whatsapp.connect.qr') = ARRAY['record_status']::TEXT[]
  AND platform_private.p7a_changed_field_codes('whatsapp.connect.code') = ARRAY['record_status']::TEXT[],
  'the allowlist gains exactly the two actions and keeps every earlier one; the type organization is allowlisted; the field codes take the default');
SELECT pg_temp.w311_call('authenticated', (SELECT claims FROM w311_claims WHERE actor = 1),
  $q$SELECT platform.search_audit_events(NULL, NULL, ARRAY['whatsapp.connect.qr', 'whatsapp.connect.code'], NULL, NULL, 50)$q$) AS w311_page \gset
SELECT pg_temp.w311_assert(pg_temp.w311_err(:'w311_page'::JSONB) IS NULL
    AND jsonb_array_length(:'w311_page'::JSONB -> 'rows') = 3
    AND (SELECT count(*) FILTER (WHERE r ->> 'action' = 'whatsapp.connect.qr') = 2
        AND count(*) FILTER (WHERE r ->> 'action' = 'whatsapp.connect.code') = 1
        AND bool_and(r ->> 'resource_type' = 'organization' AND r ->> 'actor_display_label' = 'Staff'
          AND r ->> 'actor_kind' = 'user' AND r ->> 'reason_code' = 'restricted'
          AND r -> 'changed_field_codes' = '["record_status"]'::JSONB
          AND (r ->> 'resource_id')::UUID = pg_temp.w311_id(1)
          AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) = ARRAY['action', 'actor_display_label',
            'actor_kind', 'audit_event_id', 'changed_field_codes', 'created_at', 'reason_code', 'request_id',
            'resource_id', 'resource_type'])
      FROM jsonb_array_elements(:'w311_page'::JSONB -> 'rows') r),
  'the Admin reads the three rows through search_audit_events() as Staff with only the ten safe keys; nothing of the state leaves');
SELECT pg_temp.w311_call('authenticated', (SELECT claims FROM w311_claims WHERE actor = 5),
  $q$SELECT platform.search_audit_events(NULL, NULL, ARRAY['whatsapp.connect.qr', 'whatsapp.connect.code'], NULL, NULL, 50)$q$) AS w311_page2 \gset
SELECT pg_temp.w311_assert(pg_temp.w311_err(:'w311_page2'::JSONB) IS NULL
    AND jsonb_array_length(:'w311_page2'::JSONB -> 'rows') = 1,
  'the other organization''s Admin sees only its own row in the journal');

\echo W311_WHATSAPP_CONNECT_AUDIT_SUITE_PASSED
ROLLBACK;
