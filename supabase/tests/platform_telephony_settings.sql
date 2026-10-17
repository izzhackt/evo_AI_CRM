\set ON_ERROR_STOP on
-- Boundary suite for migration 296 «Телефония Beeline KG» срез T4b («Настройки →
-- Телефония»: чтение, правка настроек, сопоставление пользователей ВАТС;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.5, §6.3, §6.4, §9.1, §11, §12; ADR
-- 0033). Runs on the real chain right after 296 inside one transaction that is
-- rolled back, with its own synthetic organizations, members and PBX users (the
-- roles «Телефония — менеджер/руководитель» come from the real provisioning of
-- migration 291 and are assigned through the REAL platform.staff_role_assignments_save;
-- sessions are the real custom_access_token_hook claims): no PBX call, no real
-- person, no real phone, no production action.
--
-- Proves:
--  1. catalog and grants: three new platform.telephony_*_v1 functions are
--     SECURITY DEFINER with an empty search_path and EXECUTE for authenticated
--     only; the four new private helpers are closed to PUBLIC and every client
--     role; the service health function (293) is still service_role only and
--     answers exactly what the staff snapshot answers;
--  2. who may use them: the Admin and the supervisor («руководитель», no admin
--     rights) read and write; the manager role, a staff member without a role, a
--     Student, an inactive member, another organization's Admin, a wrong or NULL
--     organization, anon, service_role and a session without claims are refused
--     with 42501;
--  3. the overview: the first read creates the default settings row with every
--     flag OFF and version 1, a second read changes nothing, the answer carries
--     the settings, the health snapshot, the PBX users and the staff list (no
--     Student, no inactive member; canManage right), no phone, link or token;
--  4. saving: one versioned patch (PT409 on a stale version), flags, hours, days,
--     callback term, prefixes (collapsed and sorted), limits and ceilings
--     through the table's own CHECKs (22023 with the constraint name only),
--     automation and import need the projection flag (PT412), an escalation
--     recipient must hold telephony.manage now (22023), an unchanged patch moves
--     neither version nor journal, a replay returns the same receipt without a
--     second row, the same request id with another input is a conflict, a bad
--     key, a wrong value kind, an empty patch, NULLs are 22023, a manager is
--     refused with the version untouched, enabling automation clears the ceiling
--     stop mark and enabling something else does not;
--  5. the journal: one telephony.settings.change per real change over the type
--     telephony_settings, the changed field codes and the values in the state, no
--     login, name or number, the replay fingerprint kept out of the receipt;
--  6. the mapping: confirmed by a human against what they saw (PT409 when it
--     changed), a PBX user maps to one active member of the organization at a
--     time (PT409), a Student, an inactive or foreign member are refused (22023),
--     an unknown or foreign PBX user is P0002, a switched-off PBX user cannot be
--     assigned but can be cleared (PT412), an unchanged mapping answers
--     'unchanged' with no journal row, a replay and a conflicting reuse of the
--     request id, the unmapped counter, the journal row without the login, the
--     legs already stored are not reassigned and the screen counts them.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

DO $t296_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t296_auth_role$;

\echo T296_TELEPHONY_SETTINGS_SUITE_START

CREATE FUNCTION pg_temp.t296_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t296_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T296: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": SQLSTATE, "message": ..., "detail": ...}.
CREATE FUNCTION pg_temp.t296_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
  v_state TEXT; v_message TEXT; v_detail TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    result := jsonb_build_object('error', v_state, 'message', v_message, 'detail', v_detail);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.t296_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
-- Calls as an authenticated member of organization 1 (claims by name).
CREATE TEMP TABLE t296_claims(actor INTEGER PRIMARY KEY, claims TEXT);
CREATE FUNCTION pg_temp.t296_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t296_call('authenticated', (SELECT claims FROM t296_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.t296_overview(p_actor INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t296_as(p_actor, format('SELECT platform.telephony_manage_overview_v1(%L)', pg_temp.t296_id(p_org)))
$$;
-- A save: actor, expected version, patch, request id number.
CREATE FUNCTION pg_temp.t296_save(p_actor INTEGER, p_version BIGINT, p_patch JSONB, p_req INTEGER,
  p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t296_as(p_actor, format('SELECT platform.telephony_settings_save_v1(%L, %s, %L::JSONB, %L)',
    pg_temp.t296_id(p_org), COALESCE(p_version::TEXT, 'NULL'), p_patch::TEXT, pg_temp.t296_id(6000 + p_req)))
$$;
CREATE FUNCTION pg_temp.t296_version() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT version FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)
$$;
-- A mapping: actor, PBX user row id, previous member (NULL = none), new member, request id number.
CREATE FUNCTION pg_temp.t296_map(p_actor INTEGER, p_ext UUID, p_prev UUID, p_next UUID, p_req INTEGER,
  p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t296_as(p_actor, format('SELECT platform.telephony_extension_map_v1(%L, %L, %L, %L, %L)',
    pg_temp.t296_id(p_org), p_ext, p_prev, p_next, pg_temp.t296_id(7000 + p_req)))
$$;
CREATE FUNCTION pg_temp.t296_audit(p_action TEXT) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events e WHERE e.action = p_action AND e.organization_id = pg_temp.t296_id(1)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (active), 2 (active).
--   actor 1  org 1 Admin (system admin)            actor 6  org 2 Admin (system admin)
--   actor 2  org 1 supervisor «Телефония — руководитель» (no admin rights)
--   actor 3  org 1 manager «Телефония — менеджер»
--   actor 4  org 1 staff without a role            actor 5  org 1 Student
--   actor 7  org 1 staff, membership later inactive
--   actor 8, 9  org 1 staff without a role (mapping targets)
--   actor 10 org 2 staff without a role
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t296_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t296_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, 'student', FALSE), (6, 2, 'admin', TRUE), (7, 1, NULL, FALSE), (8, 1, NULL, FALSE), (9, 1, NULL, FALSE),
  (10, 2, NULL, FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t296_id(1), 'T296 Fictional organization', 'active'),
  (pg_temp.t296_id(2), 'T296 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t296_id(100 + n), 't296-' || n || '@example.invalid', '{}'::JSONB FROM t296_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t296_id(200 + n), pg_temp.t296_id(100 + n), 'T296 Actor ' || n, 'active', 1 FROM t296_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t296_id(300 + a.n), pg_temp.t296_id(a.org), pg_temp.t296_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t296_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t296_id(300 + n) FROM t296_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t296_id(401), pg_temp.t296_id(1), 'organization', pg_temp.t296_id(1), 1),
  (pg_temp.t296_id(402), pg_temp.t296_id(2), 'organization', pg_temp.t296_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t296_id(1), pg_temp.t296_id(301), pg_temp.t296_id(401), 1, 1, TRUE, 'system', 'T296 synthetic scope', pg_temp.t296_id(601)),
  (pg_temp.t296_id(2), pg_temp.t296_id(306), pg_temp.t296_id(402), 1, 1, TRUE, 'system', 'T296 synthetic scope', pg_temp.t296_id(602));

-- Real provisioning of the two telephony roles (migration 291) and real assignments.
SELECT platform_private.telephony_rights_provision('T296 provision') AS t296_provisioned \gset
CREATE TEMP TABLE t296_roles AS
  SELECT r.id AS role_id, r.organization_id, r.label FROM platform.staff_role_definitions r
  WHERE r.organization_id IN (pg_temp.t296_id(1), pg_temp.t296_id(2))
    AND r.label IN ('Телефония — менеджер', 'Телефония — руководитель');
SELECT pg_temp.t296_assert((SELECT count(*) FROM t296_roles) = 4, 'the provisioning made the two telephony roles in both organizations');
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t296_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t296_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t296_admin1_claims \gset
CREATE FUNCTION pg_temp.t296_assign(p_claims TEXT, p_org INTEGER, p_actor INTEGER, p_label TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_role UUID;
BEGIN
  SELECT role_id INTO v_role FROM t296_roles WHERE organization_id = pg_temp.t296_id(p_org) AND label = p_label;
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t296_id(200 + p_actor);
  SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', 'organization',
      'key', pg_temp.t296_id(p_org)::TEXT, 'resourceKind', NULL))),
    jsonb_agg(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version))
  INTO items, bindings
  FROM platform.staff_role_definitions r
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  WHERE r.id = v_role;
  RETURN pg_temp.t296_call('authenticated', p_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t296_id(p_org), pg_temp.t296_id(300 + p_actor), v_version, items, bindings, 'T296 assign',
    pg_temp.t296_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t296_assert(
  pg_temp.t296_assign(:'t296_admin1_claims', 1, 2, 'Телефония — руководитель', 1) ->> 'status' = 'applied'
  AND pg_temp.t296_assign(:'t296_admin1_claims', 1, 3, 'Телефония — менеджер', 2) ->> 'status' = 'applied',
  'the Admin assigns the supervisor and manager roles through staff_role_assignments_save');
-- The membership of actor 7 goes inactive later; before that it has no role at all.
INSERT INTO t296_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t296_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.t296_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM t296_actors a;

-- PBX directory (as the T4a sync leaves it: nobody assigned), plus one call with a leg
-- of u903 stored before any mapping.
INSERT INTO platform_private.telephony_extensions(id, organization_id, pbx_user, extension, pbx_display_name, membership_id, active,
  last_seen_in_users_at) VALUES
  (pg_temp.t296_id(801), pg_temp.t296_id(1), 'u901', '901', 'T296 PBX user 1', NULL, TRUE, clock_timestamp()),
  (pg_temp.t296_id(802), pg_temp.t296_id(1), 'u902', '902', 'T296 PBX user 2', NULL, TRUE, clock_timestamp()),
  (pg_temp.t296_id(803), pg_temp.t296_id(1), 'u903', '903', 'T296 PBX user 3', NULL, TRUE, clock_timestamp()),
  (pg_temp.t296_id(804), pg_temp.t296_id(1), 'u904', '904', 'T296 PBX user 4 (gone)', NULL, FALSE, clock_timestamp() - INTERVAL '3 days'),
  (pg_temp.t296_id(805), pg_temp.t296_id(2), 'u901', '901', 'T296 PBX user 1 (other organization)', NULL, TRUE, clock_timestamp());
INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, started_at, created_via)
  VALUES (pg_temp.t296_id(901), pg_temp.t296_id(1), 'T296-call-1', 'in', clock_timestamp() - INTERVAL '1 day', 'webhook');
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, leg_started_at, leg_start_source)
  VALUES (pg_temp.t296_id(1), pg_temp.t296_id(901), 'U903', clock_timestamp() - INTERVAL '1 day', 'event'),
    (pg_temp.t296_id(1), pg_temp.t296_id(901), 'u901', clock_timestamp() - INTERVAL '1 day' + INTERVAL '5 seconds', 'event');
-- A stopped automation mark (the ceiling), for the clear test.
INSERT INTO platform_private.telephony_runtime_state(organization_id, automation_stopped_at, automation_stop_code,
  last_event_at, reconcile_cursor_at, last_pbx_ok_at)
  VALUES (pg_temp.t296_id(1), clock_timestamp() - INTERVAL '2 hours', 'tasks_hour', clock_timestamp() - INTERVAL '5 minutes',
    NULL, clock_timestamp() - INTERVAL '1 minute');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t296_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'
      AND p.proname IN ('telephony_manage_overview_v1', 'telephony_settings_save_v1', 'telephony_extension_map_v1'))
  = ARRAY['telephony_extension_map_v1', 'telephony_manage_overview_v1', 'telephony_settings_save_v1'],
  'the three staff functions exist in platform');
SELECT pg_temp.t296_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform'
      AND p.proname IN ('telephony_manage_overview_v1', 'telephony_settings_save_v1', 'telephony_extension_map_v1')),
  'the staff functions: SECURITY DEFINER, empty search_path, owner postgres, VOLATILE, EXECUTE for authenticated only');
SELECT pg_temp.t296_assert((SELECT count(*) = 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'platform_private' AND p.proname IN ('telephony_manage_actor', 'telephony_settings_json',
        'telephony_settings_flat', 'telephony_health_snapshot'))
  AND (SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE')
        AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
      WHERE n.nspname = 'platform_private' AND p.proname IN ('telephony_manage_actor', 'telephony_settings_json',
        'telephony_settings_flat', 'telephony_health_snapshot')),
  'the four private helpers are closed to PUBLIC and every client role, each with an empty search_path');
SELECT pg_temp.t296_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.telephony_integration_health_v1(uuid)'::regprocedure),
  'the service health function (293) keeps its posture: definer, empty search_path, service_role only');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_call('authenticated', :'t296_admin1_claims',
    format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t296_id(1)))) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_call('service_role', '{"role":"authenticated"}',
    format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t296_id(1)))) = '42501',
  'the service health function still refuses a session and a service role without the service claim');

-- ---------------------------------------------------------------------------
-- 2. Who may use the functions.
-- ---------------------------------------------------------------------------
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t296_id(307);
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_overview(1)) IS NULL
  AND pg_temp.t296_err(pg_temp.t296_overview(2)) IS NULL
  AND pg_temp.t296_err(pg_temp.t296_overview(6, 2)) IS NULL,
  'the Admin, the supervisor (a role holder without admin rights) and the other organization''s own Admin read the overview');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_overview(3)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_overview(4)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_overview(5)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_overview(7)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_overview(10, 2)) = '42501',
  'the manager role, a member without a role, a Student, an inactive member and a member of another organization without the right are refused (42501)');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_overview(1, 2)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_overview(6, 1)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_as(1, 'SELECT platform.telephony_manage_overview_v1(NULL)')) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_manage_overview_v1(%L)', gen_random_uuid()))) = '42501',
  'a wrong, foreign or NULL organization is refused even for an Admin of the other organization');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_call('anon', '{"role":"anon"}', format('SELECT platform.telephony_manage_overview_v1(%L)', pg_temp.t296_id(1)))) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_call('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_manage_overview_v1(%L)', pg_temp.t296_id(1)))) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_call('authenticated', '', format('SELECT platform.telephony_manage_overview_v1(%L)', pg_temp.t296_id(1)))) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_call('anon', '{"role":"anon"}', format('SELECT platform.telephony_settings_save_v1(%L, 1, ''{"uiEnabled":true}'', %L)', pg_temp.t296_id(1), gen_random_uuid()))) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_call('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_extension_map_v1(%L, %L, NULL, NULL, %L)', pg_temp.t296_id(1), pg_temp.t296_id(801), gen_random_uuid()))) = '42501',
  'anon, service_role and a session without claims cannot call any of the three functions');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(3, 1, '{"uiEnabled":true}', 1)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_save(4, 1, '{"uiEnabled":true}', 2)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_save(5, 1, '{"uiEnabled":true}', 3)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_map(3, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 1)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_map(4, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 2)) = '42501'
  AND pg_temp.t296_err(pg_temp.t296_map(5, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 3)) = '42501',
  'neither saving nor mapping works for the manager, a member without a role or a Student');

-- ---------------------------------------------------------------------------
-- 3. The overview.
-- ---------------------------------------------------------------------------
DELETE FROM platform_private.telephony_settings WHERE organization_id IN (pg_temp.t296_id(1), pg_temp.t296_id(2));
SELECT pg_temp.t296_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_settings
    WHERE organization_id = pg_temp.t296_id(1)), 'before the first read the organization has no settings row');
SELECT pg_temp.t296_overview(1) AS t296_ov1 \gset
SELECT pg_temp.t296_assert((SELECT count(*) = 1 AND bool_and(version = 1 AND NOT ui_enabled AND NOT dial_enabled
      AND NOT projection_enabled AND NOT missed_task_enabled AND NOT unknown_lead_enabled AND NOT backfill_enabled
      AND NOT outbound_paused AND updated_by_membership_id IS NULL AND escalation_membership_id IS NULL)
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)),
  'the first read created the settings row: version 1, every flag OFF, no escalation recipient');
SELECT pg_temp.t296_assert(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t296_ov1'::JSONB) k)
    = ARRAY['escalation', 'extensions', 'health', 'now', 'organizationId', 'schemaVersion', 'settings', 'staff']
  AND (:'t296_ov1'::JSONB -> 'schemaVersion') = '1'::JSONB
  AND (:'t296_ov1'::JSONB ->> 'organizationId')::UUID = pg_temp.t296_id(1)
  AND (:'t296_ov1'::JSONB -> 'escalation') = 'null'::JSONB
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t296_ov1'::JSONB -> 'settings') k)
    = ARRAY['ceilings', 'dial', 'escalationMembershipId', 'flags', 'hours', 'updatedAt', 'version']
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t296_ov1'::JSONB -> 'settings' -> 'flags') k)
    = ARRAY['backfillEnabled', 'dialEnabled', 'missedTaskEnabled', 'outboundPaused', 'projectionEnabled', 'uiEnabled', 'unknownLeadEnabled']
  AND (SELECT bool_and(v = 'false'::JSONB) FROM jsonb_each(:'t296_ov1'::JSONB -> 'settings' -> 'flags') f(k, v))
  AND (:'t296_ov1'::JSONB -> 'settings' ->> 'version') = '1'
  AND (:'t296_ov1'::JSONB -> 'settings' -> 'hours') = '{"timezone":"Asia/Bishkek","workingDays":[1,2,3,4,5,6],"workFrom":"10:00","workTo":"20:00","callbackWorkMinutes":15}'::JSONB
  AND (:'t296_ov1'::JSONB -> 'settings' -> 'dial') = '{"prefixes":["+996"],"limitUserDay":150,"limitUserGapSeconds":5,"limitOrgHour":60,"limitOrgDay":400}'::JSONB
  AND (:'t296_ov1'::JSONB -> 'settings' -> 'ceilings') = '{"leadsHour":10,"leadsDay":40,"tasksHour":30,"tasksDay":120}'::JSONB,
  'the overview carries the exact keys and the plan defaults: hours, days, prefixes, limits, ceilings');
SELECT pg_temp.t296_assert(
  (SELECT count(*) FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions')) = 4
  AND (SELECT array_agg(e ->> 'login' ORDER BY ord) FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') WITH ORDINALITY x(e, ord))
    = ARRAY['u901', 'u902', 'u903', 'u904']
  AND (SELECT bool_and((e ->> 'active')::BOOLEAN = (e ->> 'login' <> 'u904')) FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') e)
  AND (SELECT bool_and(e -> 'membershipId' = 'null'::JSONB) FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') e)
  AND (SELECT (e ->> 'legsWithoutStaff')::INTEGER FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') e WHERE e ->> 'login' = 'u903') = 1
  AND (SELECT (e ->> 'legsWithoutStaff')::INTEGER FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') e WHERE e ->> 'login' = 'u901') = 1
  AND (SELECT (e ->> 'legsWithoutStaff')::INTEGER FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'extensions') e WHERE e ->> 'login' = 'u902') = 0
  AND NOT (:'t296_ov1'::JSONB::TEXT LIKE '%other organization%'),
  'the PBX users of this organization only, active first, with the count of stored legs without a staff member (matched without case)');
SELECT pg_temp.t296_assert(
  (SELECT array_agg((s ->> 'membershipId')::UUID ORDER BY ord) FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') WITH ORDINALITY x(s, ord))
    @> ARRAY[pg_temp.t296_id(301), pg_temp.t296_id(302), pg_temp.t296_id(303), pg_temp.t296_id(304), pg_temp.t296_id(308), pg_temp.t296_id(309)]
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') s
    WHERE (s ->> 'membershipId')::UUID IN (pg_temp.t296_id(305), pg_temp.t296_id(307), pg_temp.t296_id(306), pg_temp.t296_id(310)))
  AND (SELECT (s ->> 'canManage')::BOOLEAN FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') s WHERE (s ->> 'membershipId')::UUID = pg_temp.t296_id(301))
  AND (SELECT (s ->> 'canManage')::BOOLEAN FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') s WHERE (s ->> 'membershipId')::UUID = pg_temp.t296_id(302))
  AND NOT (SELECT (s ->> 'canManage')::BOOLEAN FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') s WHERE (s ->> 'membershipId')::UUID = pg_temp.t296_id(303))
  AND NOT (SELECT (s ->> 'canManage')::BOOLEAN FROM jsonb_array_elements(:'t296_ov1'::JSONB -> 'staff') s WHERE (s ->> 'membershipId')::UUID = pg_temp.t296_id(304)),
  'the staff list: active non-student members of this organization only (no Student, no inactive member, nobody from another organization); canManage is true for the Admin and the supervisor only');
-- The first read changed only the settings row: a second read is identical.
SELECT pg_temp.t296_overview(1) AS t296_ov2 \gset
SELECT pg_temp.t296_assert(
  (:'t296_ov2'::JSONB -> 'settings') = (:'t296_ov1'::JSONB -> 'settings')
  AND (:'t296_ov2'::JSONB -> 'extensions') = (:'t296_ov1'::JSONB -> 'extensions')
  AND (:'t296_ov2'::JSONB -> 'staff') = (:'t296_ov1'::JSONB -> 'staff')
  AND (SELECT count(*) FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)) = 1
  AND pg_temp.t296_audit('telephony.settings.change') = 0,
  'a second read changes nothing and writes no journal row');
-- Health: the staff snapshot is what the service function answers (no drift).
SELECT pg_temp.t296_call('service_role', '{"role":"service_role"}',
  format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t296_id(1))) AS t296_health_service \gset
SELECT pg_temp.t296_overview(1) -> 'health' AS t296_health_staff \gset
SELECT pg_temp.t296_assert(
  (:'t296_health_service'::JSONB - 'now') = (:'t296_health_staff'::JSONB - 'now')
  AND (:'t296_health_staff'::JSONB ->> 'status') = 'ok'
  AND (:'t296_health_staff' :: JSONB -> 'directory' ->> 'active') = '3'
  AND (:'t296_health_staff' :: JSONB -> 'directory' ->> 'inactive') = '1'
  AND (:'t296_health_staff' :: JSONB -> 'directory' ->> 'unmapped') = '3'
  AND (:'t296_health_staff' :: JSONB -> 'automation_stop' ->> 'code') = 'tasks_hour'
  AND (:'t296_health_staff' :: JSONB -> 'pbx' ->> 'last_error_code') IS NULL,
  'the health snapshot for the screen equals the service health answer (no drift) and reads the directory and the stop mark');
SELECT pg_temp.t296_assert(
  NOT (:'t296_ov1'::JSONB::TEXT ~* '(token|https?://|crm_token|recording|password|secret|996[0-9]{6,})'),
  'the overview holds no token, link, password or phone number');

-- ---------------------------------------------------------------------------
-- 4. Saving settings.
-- ---------------------------------------------------------------------------
-- Argument errors.
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(1, 1, '{}', 10)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"nope":true}', 11)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"uiEnabled":"yes"}', 12)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"limitUserDay":"150"}', 13)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"limitUserDay":1.5}', 14)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"limitUserDay":-1}', 15)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workFrom":"25:00"}', 16)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workTo":"9:00"}', 17)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workingDays":[0]}', 18)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workingDays":[8]}', 19)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workingDays":"1"}', 20)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"workingDays":[]}', 27)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"dialPrefixes":["996"]}', 21)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"dialPrefixes":["+0"]}', 22)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"dialPrefixes":[996]}', 23)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"dialPrefixes":[]}', 24)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"escalationMembershipId":"not-a-uuid"}', 25)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"escalationMembershipId":5}', 26)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_settings_save_v1(%L, NULL, ''{"uiEnabled":true}'', %L)', pg_temp.t296_id(1), gen_random_uuid()))) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_settings_save_v1(%L, 1, ''{"uiEnabled":true}'', NULL)', pg_temp.t296_id(1)))) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_settings_save_v1(%L, 1, NULL, %L)', pg_temp.t296_id(1), gen_random_uuid()))) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_settings_save_v1(%L, 1, ''[1]'', %L)', pg_temp.t296_id(1), gen_random_uuid()))) = '22023'
  AND pg_temp.t296_version() = 1 AND pg_temp.t296_audit('telephony.settings.change') = 0,
  'an empty or unknown patch, a wrong value kind (string for boolean or number, fraction, sign, bad time, day or prefix, a non-UUID recipient), a NULL version, request id or patch are all 22023 and write nothing');
-- Version and ordering.
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(1, 7, '{"uiEnabled":false}', 30)) = 'PT409'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 0, '{"uiEnabled":false}', 31)) = 'PT409'
  AND pg_temp.t296_version() = 1,
  'a stale or wrong expected version is PT409 and the version does not move');
-- Automation and the import need the projection flag (nothing is saved).
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"missedTaskEnabled":true}', 40)) = 'PT412'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"unknownLeadEnabled":true}', 41)) = 'PT412'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"backfillEnabled":true}', 42)) = 'PT412'
  AND pg_temp.t296_version() = 1
  AND (SELECT NOT missed_task_enabled AND NOT unknown_lead_enabled AND NOT backfill_enabled
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)),
  'task automation, lead automation and the first import are refused (PT412) while the projection flag is off, and nothing is saved');
-- The check constraints speak through the constraint name only.
SELECT pg_temp.t296_save(1, 1, '{"workFrom":"20:00","workTo":"10:00"}', 43) AS t296_hours_bad \gset
SELECT pg_temp.t296_save(1, 1, '{"limitOrgHour":500,"limitOrgDay":100}', 44) AS t296_limits_bad \gset
SELECT pg_temp.t296_save(1, 1, '{"ceilingTasksHour":100,"ceilingTasksDay":50}', 45) AS t296_ceil_bad \gset
SELECT pg_temp.t296_save(1, 1, '{"limitUserDay":1001}', 46) AS t296_range_bad \gset
SELECT pg_temp.t296_save(1, 1, '{"callbackWorkMinutes":0}', 47) AS t296_cb_bad \gset
SELECT pg_temp.t296_assert(
  :'t296_hours_bad'::JSONB ->> 'error' = '22023' AND :'t296_hours_bad'::JSONB ->> 'detail' = 'telephony_settings_hours_check'
  AND :'t296_limits_bad'::JSONB ->> 'error' = '22023' AND :'t296_limits_bad'::JSONB ->> 'detail' = 'telephony_settings_dial_limits_check'
  AND :'t296_ceil_bad'::JSONB ->> 'error' = '22023' AND :'t296_ceil_bad'::JSONB ->> 'detail' = 'telephony_settings_ceilings_check'
  AND :'t296_range_bad'::JSONB ->> 'error' = '22023' AND :'t296_range_bad'::JSONB ->> 'detail' LIKE 'telephony_settings_%'
  AND :'t296_cb_bad'::JSONB ->> 'error' = '22023'
  AND NOT (:'t296_hours_bad'::JSONB::TEXT LIKE '%20:00%')
  AND pg_temp.t296_version() = 1 AND pg_temp.t296_audit('telephony.settings.change') = 0,
  'start after end, an hourly limit above the daily one, a ceiling above its daily ceiling, out-of-range numbers and a zero callback term are 22023 with the constraint name only (no value) and write nothing');

-- A real save: the projection flag, the supervisor writes.
SELECT pg_temp.t296_save(2, 1, '{"projectionEnabled":true}', 50) AS t296_s1 \gset
SELECT pg_temp.t296_assert(
  :'t296_s1'::JSONB ->> 'status' = 'saved' AND (:'t296_s1'::JSONB ->> 'version') = '2'
  AND (:'t296_s1'::JSONB -> 'changed') = '["projectionEnabled"]'::JSONB
  AND (:'t296_s1'::JSONB -> 'replayed') = 'false'::JSONB
  AND (:'t296_s1'::JSONB -> 'settings' -> 'flags' ->> 'projectionEnabled') = 'true'
  AND (:'t296_s1'::JSONB -> 'settings' ->> 'version') = '2'
  AND NOT (:'t296_s1'::JSONB ? 'fingerprint')
  AND pg_temp.t296_version() = 2
  AND (SELECT projection_enabled AND NOT ui_enabled AND updated_by_membership_id = pg_temp.t296_id(302)
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1))
  AND pg_temp.t296_audit('telephony.settings.change') = 1,
  'the supervisor (no admin rights) saves a flag: version 2, the changed code, no fingerprint in the receipt, the writer recorded, one journal row');
-- Replay: same request id, same input.
SELECT pg_temp.t296_save(2, 1, '{"projectionEnabled":true}', 50) AS t296_s1_replay \gset
SELECT pg_temp.t296_assert(
  (:'t296_s1_replay'::JSONB - 'replayed') = (:'t296_s1'::JSONB - 'replayed')
  AND (:'t296_s1_replay'::JSONB -> 'replayed') = 'true'::JSONB
  AND pg_temp.t296_version() = 2 AND pg_temp.t296_audit('telephony.settings.change') = 1,
  'the exact replay returns the original receipt marked replayed and adds nothing');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(2, 1, '{"projectionEnabled":false}', 50)) = '23505'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"projectionEnabled":true}', 50)) = '23505'
  AND pg_temp.t296_err(pg_temp.t296_save(2, 2, '{"projectionEnabled":true}', 50)) = '23505'
  AND pg_temp.t296_version() = 2 AND pg_temp.t296_audit('telephony.settings.change') = 1,
  'the same request id with another patch, another person or another expected version is a conflict (23505)');
-- Unchanged: same values again, no version or journal movement.
SELECT pg_temp.t296_save(2, 2, '{"projectionEnabled":true,"limitUserDay":150}', 51) AS t296_same \gset
SELECT pg_temp.t296_assert(
  :'t296_same'::JSONB ->> 'status' = 'unchanged' AND (:'t296_same'::JSONB ->> 'version') = '2'
  AND (:'t296_same'::JSONB -> 'changed') = '[]'::JSONB
  AND pg_temp.t296_version() = 2 AND pg_temp.t296_audit('telephony.settings.change') = 1,
  'a patch that changes nothing answers unchanged: no version bump and no journal row');
-- Now automation works; one patch with several fields.
SELECT pg_temp.t296_save(1, 2, '{"uiEnabled":true,"missedTaskEnabled":true,"callbackWorkMinutes":20,"dialPrefixes":["+7","+996","+7"],"workingDays":[5,1,3,3],"workFrom":"09:30","workTo":"19:15","limitUserDay":120,"limitUserGapSeconds":10,"limitOrgHour":50,"limitOrgDay":300,"ceilingLeadsHour":5,"ceilingLeadsDay":20,"ceilingTasksHour":15,"ceilingTasksDay":60}', 52) AS t296_s2 \gset
SELECT pg_temp.t296_assert(
  :'t296_s2'::JSONB ->> 'status' = 'saved' AND (:'t296_s2'::JSONB ->> 'version') = '3'
  AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_array_elements_text(:'t296_s2'::JSONB -> 'changed') x)
    = ARRAY['callbackWorkMinutes', 'ceilingLeadsDay', 'ceilingLeadsHour', 'ceilingTasksDay', 'ceilingTasksHour', 'dialPrefixes',
      'limitOrgDay', 'limitOrgHour', 'limitUserDay', 'limitUserGapSeconds', 'missedTaskEnabled', 'uiEnabled', 'workFrom', 'workTo', 'workingDays']::TEXT[]
  AND (:'t296_s2'::JSONB -> 'settings' -> 'dial' -> 'prefixes') = '["+7","+996"]'::JSONB
  AND (:'t296_s2'::JSONB -> 'settings' -> 'hours' -> 'workingDays') = '[1,3,5]'::JSONB
  AND (:'t296_s2'::JSONB -> 'settings' -> 'hours' ->> 'workFrom') = '09:30'
  AND (:'t296_s2'::JSONB -> 'settings' -> 'hours' ->> 'workTo') = '19:15'
  AND (:'t296_s2'::JSONB -> 'settings' -> 'hours' ->> 'callbackWorkMinutes') = '20'
  AND (:'t296_s2'::JSONB -> 'settings' -> 'dial' ->> 'limitOrgDay') = '300'
  AND (:'t296_s2'::JSONB -> 'settings' -> 'ceilings' ->> 'tasksDay') = '60'
  AND pg_temp.t296_version() = 3
  AND (SELECT ui_enabled AND missed_task_enabled AND projection_enabled AND NOT dial_enabled AND NOT unknown_lead_enabled
      AND dial_prefixes = ARRAY['+7', '+996'] AND working_days = ARRAY[1, 3, 5]::SMALLINT[]
      AND work_from = TIME '09:30' AND work_to = TIME '19:15' AND callback_work_minutes = 20
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)),
  'one patch changes flags, hours, days (sorted, collapsed), term, prefixes (sorted, collapsed), limits and ceilings; the receipt lists the changed codes');
-- The projection cannot be dropped under running automation.
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(1, 3, '{"projectionEnabled":false}', 53)) = 'PT412'
  AND pg_temp.t296_version() = 3,
  'projection cannot be switched off while task automation is on (PT412)');
SELECT pg_temp.t296_save(1, 3, '{"projectionEnabled":false,"missedTaskEnabled":false}', 54) AS t296_s3 \gset
SELECT pg_temp.t296_assert(
  :'t296_s3'::JSONB ->> 'status' = 'saved' AND (:'t296_s3'::JSONB ->> 'version') = '4'
  AND (SELECT NOT projection_enabled AND NOT missed_task_enabled FROM platform_private.telephony_settings
    WHERE organization_id = pg_temp.t296_id(1)),
  'switching the automation off together with the projection is allowed');
SELECT pg_temp.t296_save(1, 4, '{"projectionEnabled":true}', 55) AS t296_s4 \gset
SELECT pg_temp.t296_assert(:'t296_s4'::JSONB ->> 'version' = '5', 'the projection is on again (version 5)');


-- The ceiling stop mark: enabling task automation in step 52 cleared it.
SELECT pg_temp.t296_assert(
  (:'t296_s2'::JSONB -> 'automationStopCleared') = 'true'::JSONB
  AND (SELECT automation_stopped_at IS NULL AND automation_stop_code IS NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t296_id(1))
  AND (SELECT last_event_at IS NOT NULL AND last_pbx_ok_at IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t296_id(1)),
  'enabling task automation cleared the "stopped by the ceiling" mark and left the other run marks alone');
-- Re-arm the mark: a flag that is not automation leaves it; turning automation on clears it.
UPDATE platform_private.telephony_runtime_state SET automation_stopped_at = clock_timestamp() - INTERVAL '1 hour',
  automation_stop_code = 'leads_day' WHERE organization_id = pg_temp.t296_id(1);
SELECT pg_temp.t296_save(1, 5, '{"dialEnabled":true}', 56) AS t296_s5a \gset
SELECT pg_temp.t296_assert(
  :'t296_s5a'::JSONB ->> 'version' = '6' AND (:'t296_s5a'::JSONB -> 'automationStopCleared') = 'false'::JSONB
  AND (SELECT automation_stop_code = 'leads_day' FROM platform_private.telephony_runtime_state
    WHERE organization_id = pg_temp.t296_id(1)),
  'switching the dial flag on leaves the automation stop mark in place');
SELECT pg_temp.t296_save(1, 6, '{"unknownLeadEnabled":true}', 57) AS t296_s5b \gset
SELECT pg_temp.t296_assert(
  :'t296_s5b'::JSONB ->> 'version' = '7' AND (:'t296_s5b'::JSONB -> 'automationStopCleared') = 'true'::JSONB
  AND (SELECT automation_stopped_at IS NULL FROM platform_private.telephony_runtime_state
    WHERE organization_id = pg_temp.t296_id(1)),
  'switching lead automation on clears it (the Admin checked and enables again)');
-- Switching an automation flag OFF never touches the mark.
UPDATE platform_private.telephony_runtime_state SET automation_stopped_at = clock_timestamp(),
  automation_stop_code = 'tasks_day' WHERE organization_id = pg_temp.t296_id(1);
SELECT pg_temp.t296_save(1, 7, '{"unknownLeadEnabled":false,"dialEnabled":false}', 58) AS t296_s5c \gset
SELECT pg_temp.t296_assert(
  :'t296_s5c'::JSONB ->> 'version' = '8' AND (:'t296_s5c'::JSONB -> 'automationStopCleared') = 'false'::JSONB
  AND (SELECT automation_stop_code = 'tasks_day' FROM platform_private.telephony_runtime_state
    WHERE organization_id = pg_temp.t296_id(1)),
  'switching automation off leaves the stop mark in place');
UPDATE platform_private.telephony_runtime_state SET automation_stopped_at = NULL, automation_stop_code = NULL
  WHERE organization_id = pg_temp.t296_id(1);

-- Escalation recipient: holds telephony.manage now (version is 8).
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(303))::JSONB, 60)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(304))::JSONB, 61)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(305))::JSONB, 62)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(307))::JSONB, 63)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(306))::JSONB, 64)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', gen_random_uuid())::JSONB, 65)) = '22023'
  AND pg_temp.t296_version() = 8
  AND (SELECT escalation_membership_id IS NULL FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)),
  'the recipient must hold telephony.manage: the manager, a member without a role, a Student, an inactive member, another organization''s Admin and an unknown id are refused (22023)');
SELECT pg_temp.t296_save(1, 8, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(302))::JSONB, 66) AS t296_e1 \gset
SELECT pg_temp.t296_save(2, 9, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(301))::JSONB, 67) AS t296_e2 \gset
SELECT pg_temp.t296_assert(
  :'t296_e1'::JSONB ->> 'status' = 'saved' AND :'t296_e2'::JSONB ->> 'status' = 'saved'
  AND (:'t296_e2'::JSONB -> 'settings' ->> 'escalationMembershipId')::UUID = pg_temp.t296_id(301)
  AND (SELECT escalation_membership_id = pg_temp.t296_id(301) FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1)),
  'the supervisor and then the Admin are accepted as the recipient');
SELECT pg_temp.t296_overview(1) AS t296_ov3 \gset
SELECT pg_temp.t296_assert(
  (:'t296_ov3'::JSONB -> 'escalation') = jsonb_build_object('membershipId', pg_temp.t296_id(301), 'name', 'T296 Actor 1', 'allowed', TRUE),
  'the overview names the recipient and says the right still holds');
-- The recipient (the supervisor) stops being a member: the overview says so, other edits still work.
SELECT pg_temp.t296_save(1, 10, format('{"escalationMembershipId":"%s"}', pg_temp.t296_id(302))::JSONB, 68) AS t296_e3 \gset
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t296_id(302);
SELECT pg_temp.t296_overview(1) AS t296_ov4 \gset
SELECT pg_temp.t296_save(1, 11, '{"callbackWorkMinutes":25}', 69) AS t296_e4 \gset
SELECT pg_temp.t296_assert(
  (:'t296_ov4'::JSONB -> 'escalation' ->> 'allowed') = 'false'
  AND (:'t296_ov4'::JSONB -> 'escalation' ->> 'name') = 'T296 Actor 2'
  AND :'t296_e4'::JSONB ->> 'status' = 'saved'
  AND (:'t296_e4'::JSONB -> 'settings' ->> 'escalationMembershipId')::UUID = pg_temp.t296_id(302),
  'a recipient who lost the right is shown as not allowed, and the other fields can still be saved without touching the recipient');
UPDATE platform.organization_memberships SET status = 'active' WHERE id = pg_temp.t296_id(302);
SELECT pg_temp.t296_save(2, 12, '{"escalationMembershipId":null}', 70) AS t296_e5 \gset
SELECT pg_temp.t296_assert(
  :'t296_e5'::JSONB ->> 'status' = 'saved' AND (:'t296_e5'::JSONB -> 'settings' -> 'escalationMembershipId') = 'null'::JSONB
  AND (SELECT escalation_membership_id IS NULL FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(1))
  AND pg_temp.t296_overview(1) -> 'escalation' = 'null'::JSONB,
  'the recipient can be cleared (NULL)');

-- A manager cannot change a thing; the version is the same afterwards.
SELECT pg_temp.t296_version() AS t296_v_before \gset
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_save(3, :t296_v_before, '{"uiEnabled":false}', 71)) = '42501'
  AND pg_temp.t296_version() = :t296_v_before,
  'a manager''s save is refused and changes nothing');
-- Another organization's settings are its own row.
SELECT pg_temp.t296_save(6, 1, '{"uiEnabled":true}', 72, 2) AS t296_o2 \gset
SELECT pg_temp.t296_assert(
  :'t296_o2'::JSONB ->> 'status' = 'saved'
  AND (SELECT ui_enabled FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t296_id(2))
  AND pg_temp.t296_version() = :t296_v_before
  AND pg_temp.t296_err(pg_temp.t296_save(1, 1, '{"uiEnabled":false}', 73, 2)) = '42501'
  AND (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'telephony.settings.change'
    AND e.organization_id = pg_temp.t296_id(2)) = 1,
  'the other organization''s Admin writes only its own row; an Admin of this organization cannot write it');

-- ---------------------------------------------------------------------------
-- 5. The journal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t296_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'telephony.settings.change'
      AND e.organization_id = pg_temp.t296_id(1)) = 12
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.settings.change'
    AND NOT (e.resource_type = 'telephony_settings' AND e.resource_id = e.organization_id AND e.actor_kind = 'user'
      AND e.actor_profile_id IS NOT NULL AND e.actor_principal LIKE 'auth:%'
      AND e.reason = 'Телефония: настройки изменены'
      AND e.before_state ? 'version' AND e.before_state ? 'values'
      AND e.after_state ? 'changed' AND e.after_state ? 'values' AND e.after_state ? 'fingerprint'
      AND e.after_state ->> 'status' = 'saved'
      AND jsonb_array_length(e.after_state -> 'changed') > 0)),
  'one journal row per real change (12 in this run: replays, unchanged patches and refusals write none), each over the type telephony_settings with the organization as the object');
SELECT pg_temp.t296_assert(
  (SELECT e.before_state = '{"version":1,"values":{"projectionEnabled":false}}'::JSONB
      AND (e.after_state - 'fingerprint' - 'settings') = '{"status":"saved","version":2,"changed":["projectionEnabled"],"values":{"projectionEnabled":true},"automationStopCleared":false}'::JSONB
      AND e.actor_profile_id = pg_temp.t296_id(202) AND e.request_id = pg_temp.t296_id(6050)
    FROM platform.audit_events e WHERE e.request_id = pg_temp.t296_id(6050)),
  'the first row carries the version and the values before and after, the writer (the supervisor) and the request id');
SELECT pg_temp.t296_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action IN ('telephony.settings.change', 'telephony.mapping.change')
    AND to_jsonb(e)::TEXT ~* '(T296 Actor|T296 PBX|u90[0-9]|token|https?://|@example|996[0-9]{6,})')
  AND (SELECT (e.after_state ->> 'fingerprint') ~ '^[0-9a-f]{64}$' FROM platform.audit_events e WHERE e.request_id = pg_temp.t296_id(6050)),
  'no journal row holds a name, login, phone, token or link; the replay fingerprint is a hash');
SELECT pg_temp.t296_assert(
  'telephony.settings.change' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'telephony.mapping.change' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'telephony_settings' = ANY (platform_private.p7a_safe_audit_resource_types()),
  'both actions and the object type are in the journal allowlist of migration 291');

-- ---------------------------------------------------------------------------
-- 6. The mapping.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(999), NULL, pg_temp.t296_id(308), 1)) = 'P0002'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(805), NULL, pg_temp.t296_id(308), 2)) = 'P0002'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_extension_map_v1(%L, NULL, NULL, %L, %L)',
    pg_temp.t296_id(1), pg_temp.t296_id(308), gen_random_uuid()))) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_as(1, format('SELECT platform.telephony_extension_map_v1(%L, %L, NULL, %L, NULL)',
    pg_temp.t296_id(1), pg_temp.t296_id(801), pg_temp.t296_id(308)))) = '22023'
  AND pg_temp.t296_audit('telephony.mapping.change') = 0,
  'an unknown PBX user, another organization''s PBX user (P0002) and a NULL PBX user or request id (22023) change nothing');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(305), 3)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(307), 4)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(310), 5)) = '22023'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, gen_random_uuid(), 6)) = '22023'
  AND pg_temp.t296_audit('telephony.mapping.change') = 0
  AND (SELECT bool_and(membership_id IS NULL) FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t296_id(1)),
  'a Student, an inactive member, a member of another organization and an unknown id cannot be chosen (22023)');
SELECT pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 7) AS t296_m1 \gset
SELECT pg_temp.t296_assert(
  :'t296_m1'::JSONB ->> 'status' = 'saved' AND (:'t296_m1'::JSONB ->> 'extensionId')::UUID = pg_temp.t296_id(801)
  AND (:'t296_m1'::JSONB ->> 'membershipId')::UUID = pg_temp.t296_id(308)
  AND (:'t296_m1'::JSONB ->> 'unmapped') = '2' AND (:'t296_m1'::JSONB -> 'replayed') = 'false'::JSONB
  AND NOT (:'t296_m1'::JSONB ? 'fingerprint')
  AND (SELECT membership_id = pg_temp.t296_id(308) FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(801))
  AND pg_temp.t296_audit('telephony.mapping.change') = 1,
  'the Admin maps PBX user 1 to a member: the receipt names both and counts the two still unmapped, one journal row');
SELECT pg_temp.t296_assert(
  (SELECT e.resource_type = 'telephony_settings' AND e.resource_id = e.organization_id
      AND e.reason = 'Телефония: сопоставление пользователя ВАТС изменено'
      AND e.before_state = jsonb_build_object('extensionId', pg_temp.t296_id(801), 'membershipId', NULL)
      AND (e.after_state - 'fingerprint') = :'t296_m1'::JSONB - 'replayed'
    FROM platform.audit_events e WHERE e.action = 'telephony.mapping.change' AND e.request_id = pg_temp.t296_id(7007)),
  'the journal row is over telephony_settings with the ids and the receipt, no login or name');
SELECT pg_temp.t296_overview(1) AS t296_ov5 \gset
SELECT pg_temp.t296_assert(
  (SELECT (e ->> 'membershipId')::UUID = pg_temp.t296_id(308) AND e ->> 'membershipName' = 'T296 Actor 8'
    FROM jsonb_array_elements(:'t296_ov5'::JSONB -> 'extensions') e WHERE e ->> 'login' = 'u901')
  AND (:'t296_ov5'::JSONB -> 'health' -> 'directory' ->> 'unmapped') = '2',
  'the overview shows the assignment with the member''s name and the health counts two unmapped');
-- Replay and conflicts on the request id.
SELECT pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 7) AS t296_m1r \gset
SELECT pg_temp.t296_assert(
  (:'t296_m1r'::JSONB - 'replayed') = (:'t296_m1'::JSONB - 'replayed') AND (:'t296_m1r'::JSONB -> 'replayed') = 'true'::JSONB
  AND pg_temp.t296_audit('telephony.mapping.change') = 1
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(309), 7)) = '23505'
  AND pg_temp.t296_err(pg_temp.t296_map(2, pg_temp.t296_id(801), NULL, pg_temp.t296_id(308), 7)) = '23505'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(802), NULL, pg_temp.t296_id(308), 7)) = '23505'
  AND pg_temp.t296_err(pg_temp.t296_call('authenticated', :'t296_admin1_claims',
    format('SELECT platform.telephony_settings_save_v1(%L, 1, ''{"uiEnabled":true}'', %L)', pg_temp.t296_id(1), pg_temp.t296_id(7007)))) = '23505',
  'the exact replay returns the first receipt; the same request id with another PBX user, member or person (or reused by a settings save) is a conflict');
-- The admin confirms against what they saw.
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), NULL, pg_temp.t296_id(309), 8)) = 'PT409'
  AND pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(801), pg_temp.t296_id(309), pg_temp.t296_id(304), 9)) = 'PT409'
  AND (SELECT membership_id = pg_temp.t296_id(308) FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(801)),
  'a stale "previous member" is PT409: someone changed the mapping since the screen was read');
SELECT pg_temp.t296_map(1, pg_temp.t296_id(801), pg_temp.t296_id(308), pg_temp.t296_id(308), 10) AS t296_m2 \gset
SELECT pg_temp.t296_assert(
  :'t296_m2'::JSONB ->> 'status' = 'unchanged' AND pg_temp.t296_audit('telephony.mapping.change') = 1,
  'confirming the same assignment answers unchanged and writes no journal row');
-- One member, one active PBX user.
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(802), NULL, pg_temp.t296_id(308), 11)) = 'PT409'
  AND (SELECT membership_id IS NULL FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(802)),
  'a member already mapped to another active PBX user cannot take a second one (PT409)');
-- The supervisor maps too; a switched-off PBX user cannot be assigned, but can be cleared.
SELECT pg_temp.t296_map(2, pg_temp.t296_id(802), NULL, pg_temp.t296_id(309), 12) AS t296_m3 \gset
SELECT pg_temp.t296_assert(
  :'t296_m3'::JSONB ->> 'status' = 'saved' AND (:'t296_m3'::JSONB ->> 'unmapped') = '1',
  'the supervisor maps PBX user 2; one active PBX user is still unmapped');
SELECT pg_temp.t296_assert(
  pg_temp.t296_err(pg_temp.t296_map(1, pg_temp.t296_id(804), NULL, pg_temp.t296_id(304), 13)) = 'PT412'
  AND (SELECT membership_id IS NULL FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(804)),
  'a PBX user switched off in the PBX cannot be assigned (PT412)');
UPDATE platform_private.telephony_extensions SET membership_id = pg_temp.t296_id(304) WHERE id = pg_temp.t296_id(804);
SELECT pg_temp.t296_map(1, pg_temp.t296_id(804), pg_temp.t296_id(304), NULL, 14) AS t296_m4 \gset
SELECT pg_temp.t296_assert(
  :'t296_m4'::JSONB ->> 'status' = 'saved' AND (:'t296_m4'::JSONB -> 'membershipId') = 'null'::JSONB
  AND (SELECT membership_id IS NULL FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(804)),
  'the assignment of a switched-off PBX user can be cleared');
-- Reassignment, release and the legs already stored.
SELECT pg_temp.t296_map(1, pg_temp.t296_id(801), pg_temp.t296_id(308), pg_temp.t296_id(304), 15) AS t296_m5 \gset
SELECT pg_temp.t296_map(1, pg_temp.t296_id(803), NULL, pg_temp.t296_id(308), 16) AS t296_m6 \gset
SELECT pg_temp.t296_assert(
  :'t296_m5'::JSONB ->> 'status' = 'saved' AND :'t296_m6'::JSONB ->> 'status' = 'saved'
  AND (:'t296_m6'::JSONB ->> 'unmapped') = '0'
  AND (SELECT array_agg(pbx_user ORDER BY pbx_user) FILTER (WHERE membership_id IS NOT NULL)
    FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t296_id(1)) = ARRAY['u901', 'u902', 'u903'],
  'a PBX user moves to another member, and the member it left is free for another PBX user');
SELECT pg_temp.t296_assert(
  (SELECT count(*) FROM platform_private.telephony_call_legs WHERE organization_id = pg_temp.t296_id(1) AND membership_id IS NOT NULL) = 0
  AND (SELECT (e ->> 'legsWithoutStaff')::INTEGER FROM jsonb_array_elements(pg_temp.t296_overview(1) -> 'extensions') e WHERE e ->> 'login' = 'u903') = 1,
  'legs stored before the mapping are not reassigned, and the screen still counts them');
SELECT pg_temp.t296_assert(
  (SELECT o_membership_id = pg_temp.t296_id(304) AND o_is_employee FROM platform_private.telephony_resolve_user(pg_temp.t296_id(1), 'U901'))
  AND (SELECT o_membership_id = pg_temp.t296_id(308) FROM platform_private.telephony_resolve_user(pg_temp.t296_id(1), 'u903'))
  AND (SELECT o_membership_id = pg_temp.t296_id(309) FROM platform_private.telephony_resolve_user(pg_temp.t296_id(1), 'u902')),
  'the ingest resolver sees the new assignments, for calls that come after the mapping');
SELECT pg_temp.t296_map(1, pg_temp.t296_id(803), pg_temp.t296_id(308), NULL, 17) AS t296_m7 \gset
SELECT pg_temp.t296_assert(
  :'t296_m7'::JSONB ->> 'status' = 'saved' AND (:'t296_m7'::JSONB -> 'membershipId') = 'null'::JSONB
  AND (:'t296_m7'::JSONB ->> 'unmapped') = '1',
  'the assignment can be removed; the counter goes back up');
SELECT pg_temp.t296_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'telephony.mapping.change'
      AND e.organization_id = pg_temp.t296_id(1)) = 6
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.mapping.change'
    AND NOT (e.resource_type = 'telephony_settings' AND e.resource_id = e.organization_id AND e.actor_kind = 'user'
      AND e.after_state ? 'fingerprint' AND e.after_state ->> 'status' = 'saved')),
  'six journal rows for six real mapping changes (this run), none for unchanged, replayed or refused calls');
-- The other organization's PBX user with the same login is a different row.
SELECT pg_temp.t296_assert(
  (SELECT membership_id IS NULL FROM platform_private.telephony_extensions WHERE id = pg_temp.t296_id(805)),
  'the other organization''s PBX user with the same login was never touched');

-- ---------------------------------------------------------------------------
-- 7. Nothing else moved: no call, leg or evidence row was written by any of it,
-- and the T4a maintenance plan still sees the settings the screen saved.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t296_assert(
  (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t296_id(1)) = 1
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE organization_id = pg_temp.t296_id(1)) = 2
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE organization_id = pg_temp.t296_id(1)) = 0
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE organization_id = pg_temp.t296_id(1)) = 0,
  'no call, leg, evidence or work row was written by reading, saving or mapping');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE) AS t296_service_claim \gset
SELECT pg_temp.t296_assert(
  (SELECT (platform.telephony_maintenance_plan_v1(pg_temp.t296_id(1)) ->> 'status') = 'ok'),
  'the service maintenance plan reads the row the screen saved');

\echo T296_TELEPHONY_SETTINGS_SUITE_PASSED
ROLLBACK;
