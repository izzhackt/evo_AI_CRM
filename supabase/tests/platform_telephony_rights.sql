\set ON_ERROR_STOP on
-- Boundary suite for migration 290 «Телефония Beeline KG» срез T2 (права, роли,
-- журнал действий; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §11; ADR 0033). Runs on
-- the real chain right after 290 inside one transaction that is rolled back,
-- with its own synthetic organizations, members and roles (modelled like
-- production: invited staff have coarse role NULL, permissions come from scoped
-- role assignments made through the REAL platform.staff_role_assignments_save):
-- no provider, no real person, no real phone, no production action. The tamper
-- runs that prove the migration rolls itself back are
-- supabase/tests/platform_telephony_rights_pre.sql, run before the apply.
--
-- Proves:
--  1. catalog: exactly six telephony.* definitions, organization-level in both
--     resource and scope kinds, not sensitive, not system-only, group
--     «Телефония», with a staff label and a description;
--  2. provisioning (platform_private.telephony_rights_provision): two roles per
--     active organization («Телефония — менеджер»: dial, listen.own,
--     report.read.own; «Телефония — руководитель»: all six), active, version 1,
--     one published bundle version 1 bound to the role, draft = published keys,
--     nobody assigned, nobody's access version bumped, one migration audit
--     event per role; a suspended organization gets nothing; a role with the
--     same label (any status) is left alone and reported as skipped; a second
--     run changes nothing; a missing reason is refused (22023); the function
--     is closed to every client role;
--  3. no other role gets a telephony key: the only bundles that carry one belong
--     to the two new roles, and listen.all, report.read.all and manage only to
--     «руководитель»;
--  4. rights through the real assignment RPC: manager, supervisor, an org-only
--     «общие разделы»-shaped role, a staff member without a role and a Student
--     see exactly the expected matrix of staff_has_permission and
--     staff_can_access (resource kind organization only); the roles cannot be
--     assigned at own scope or to a member of another organization; a member
--     whose membership is inactive loses every key; a manager of one
--     organization holds nothing in another;
--  5. every system admin holds all six keys with no role at all (this
--     organization, another organization, a second admin), and
--     telephony_rights_verify() accepts the state and refuses (55000) a catalog
--     that drifted (sensitive, system-only, group, widened scope) and a system
--     admin without a key, counting only active admins;
--  6. the journal allowlist: p7a_safe_audit_actions()/p7a_safe_audit_resource_
--     types() equal the previous list plus exactly the six actions and three
--     resource types, nothing else under telephony.*/telephony_*, the previous
--     functions are kept under *_pre_telephony_rights, every function is
--     SECURITY DEFINER with an empty search_path and closed to every client
--     role, and the new actions take the default changed-field code.
BEGIN;

DO $t290_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t290_auth_role$;

\echo T290_TELEPHONY_RIGHTS_SUITE_START

CREATE FUNCTION pg_temp.t290_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t290_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T290: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t290_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
-- 'ok' or the SQLSTATE of a statement (as the session role).
CREATE FUNCTION pg_temp.t290_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- A tamper statement followed by telephony_rights_verify(); the whole attempt is
-- rolled back by the exception, 'SQLSTATE:message' comes back.
CREATE FUNCTION pg_temp.t290_tampered(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  PERFORM platform_private.telephony_rights_verify();
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (active), 2 (active), 3 (active, a role with a
-- telephony label already exists), 4 (suspended).
--   actor 1  org 1 Admin (system admin, coarse admin, organization scope)
--   actor 2  org 1 staff: «Телефония — менеджер»
--   actor 3  org 1 staff: «Телефония — руководитель»
--   actor 4  org 1 staff: an org-only «общие разделы»-shaped role
--   actor 5  org 1 staff without any role
--   actor 6  org 1 Student
--   actor 7  org 1 staff: «Телефония — менеджер», membership later inactive
--   actor 8  org 2 Admin (system admin)
--   actor 9  org 2 staff without any role
--   actor 10 org 1 second system admin
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t290_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t290_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, 'student', FALSE), (7, 1, NULL, FALSE), (8, 2, 'admin', TRUE), (9, 2, NULL, FALSE),
  (10, 1, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t290_id(1), 'T290 Fictional organization', 'active'),
  (pg_temp.t290_id(2), 'T290 Other fictional organization', 'active'),
  (pg_temp.t290_id(3), 'T290 Third fictional organization', 'active'),
  (pg_temp.t290_id(4), 'T290 Suspended fictional organization', 'suspended');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t290_id(100 + n), 't290-' || n || '@example.invalid', '{}'::JSONB FROM t290_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t290_id(200 + n), pg_temp.t290_id(100 + n), 'T290 Actor ' || n, 'active', 1 FROM t290_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t290_id(300 + a.n), pg_temp.t290_id(a.org), pg_temp.t290_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t290_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t290_id(300 + n) FROM t290_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t290_id(401), pg_temp.t290_id(1), 'organization', pg_temp.t290_id(1), 1),
  (pg_temp.t290_id(402), pg_temp.t290_id(2), 'organization', pg_temp.t290_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t290_id(1), pg_temp.t290_id(301), pg_temp.t290_id(401), 1, 1, TRUE, 'system', 'T290 synthetic scope', pg_temp.t290_id(601)),
  (pg_temp.t290_id(2), pg_temp.t290_id(308), pg_temp.t290_id(402), 1, 1, TRUE, 'system', 'T290 synthetic scope', pg_temp.t290_id(602));
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t290_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t290_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t290_admin1 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t290_id(102),
  'claims', jsonb_build_object('sub', pg_temp.t290_id(102), 'role', 'authenticated'))) -> 'claims')::TEXT AS t290_manager \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t290_id(105),
  'claims', jsonb_build_object('sub', pg_temp.t290_id(105), 'role', 'authenticated'))) -> 'claims')::TEXT AS t290_norole \gset

-- An administrator-made role with a telephony label in organization 3, archived
-- and without a bundle: the provisioning must leave it alone.
INSERT INTO platform.staff_role_definitions(id, organization_id, label, description, status, draft_permission_keys)
  VALUES (pg_temp.t290_id(1301), pg_temp.t290_id(3), 'Телефония — менеджер', 'T290 made by an administrator',
    'archived', ARRAY['catalog.read']);

-- ---------------------------------------------------------------------------
-- 1. The catalog.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t290_keys(ord INTEGER PRIMARY KEY, k TEXT);
INSERT INTO t290_keys VALUES (1, 'telephony.call.dial'), (2, 'telephony.recording.listen.own'),
  (3, 'telephony.recording.listen.all'), (4, 'telephony.report.read.own'), (5, 'telephony.report.read.all'),
  (6, 'telephony.manage');
SELECT pg_temp.t290_assert((SELECT count(*) FROM platform.permission_definitions WHERE permission_key LIKE 'telephony.%') = 6
  AND (SELECT count(*) FROM platform.permission_definitions d JOIN t290_keys k ON k.k = d.permission_key) = 6,
  'exactly the six telephony permission definitions exist');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM platform.permission_definitions d
    WHERE d.permission_key LIKE 'telephony.%'
      AND NOT (d.staff_resource_kinds = ARRAY['organization']::TEXT[] AND d.staff_scope_kinds = ARRAY['organization']::TEXT[]
        AND NOT d.staff_sensitive AND NOT d.staff_system_only AND d.staff_group = 'Телефония'
        AND btrim(d.staff_label) <> '' AND btrim(d.description) <> '')),
  'every telephony permission is organization-level, not sensitive, not system-only, group «Телефония», labelled');

-- ---------------------------------------------------------------------------
-- 2. System admins hold every key with no role at all; nobody else yet.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t290_expect(actor INTEGER, org INTEGER, pattern TEXT);
SELECT pg_temp.t290_assert((SELECT bool_and(platform_private.staff_has_permission(pg_temp.t290_id(a.org),
      pg_temp.t290_id(300 + a.n), k.k))
    FROM t290_actors a CROSS JOIN t290_keys k WHERE a.sysadmin),
  'before any role exists every system admin (three of them, two organizations) holds all six telephony keys');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_actors a CROSS JOIN t290_keys k
    WHERE NOT a.sysadmin AND platform_private.staff_has_permission(pg_temp.t290_id(a.org), pg_temp.t290_id(300 + a.n), k.k)),
  'before the roles exist no other member holds any telephony key');

-- ---------------------------------------------------------------------------
-- 3. Provisioning.
-- ---------------------------------------------------------------------------
-- An org-only «общие разделы»-shaped role (the shape the 268 template extends), created
-- and published by the Admin BEFORE the provisioning: the provisioning must not touch it.
SELECT pg_temp.t290_assert(
  pg_temp.t290_call('authenticated', :'t290_admin1', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T290 create role', %L::UUID)$q$,
    pg_temp.t290_id(1), pg_temp.t290_id(1101),
    jsonb_build_object('label', 'T290 common sections', 'description', 'T290 org-only role',
      'permissionKeys', '["catalog.read","organization.read","staff.assistant.use","team.chat.general","staff.task.create"]'::JSONB),
    pg_temp.t290_id(1111))) ->> 'status' = 'applied',
  'the Admin creates the common-sections role through the real RPC');
SELECT pg_temp.t290_call('authenticated', :'t290_admin1', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T290 publish role', %L::UUID)$q$,
    pg_temp.t290_id(1), pg_temp.t290_id(1101), pg_temp.t290_id(1), pg_temp.t290_id(1101), pg_temp.t290_id(1112))) ->> 'status' AS t290_published \gset
SELECT pg_temp.t290_assert(:'t290_published' = 'applied', 'the Admin publishes the common-sections role');

CREATE TEMP TABLE t290_common_before AS
  SELECT r.id, r.version, r.current_bundle_id, r.draft_permission_keys,
    (SELECT array_agg(bp.permission_key ORDER BY bp.permission_key) FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id = r.current_bundle_id) AS bundle_keys
  FROM platform.staff_role_definitions r WHERE r.id = pg_temp.t290_id(1101);
SELECT pg_temp.t290_assert((SELECT count(*) = 1 AND bool_and(version = 2 AND current_bundle_id IS NOT NULL) FROM t290_common_before),
  'the common-sections role is published (version 2) before the provisioning');

CREATE TEMP TABLE t290_versions AS SELECT p.id AS profile_id, p.access_version FROM platform.profiles p;
SELECT count(*) AS t290_roles_before FROM platform.staff_role_definitions
  WHERE organization_id IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 4) g) \gset
SELECT count(*) AS t290_assignments_before FROM platform.staff_role_assignments
  WHERE organization_id IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 4) g) \gset
SELECT platform_private.telephony_rights_provision('T290 provision') AS t290_run \gset

CREATE TEMP TABLE t290_roles AS
  SELECT r.id AS role_id, r.organization_id, r.label, r.status, r.version, r.current_bundle_id, r.draft_permission_keys,
    r.description, b.bundle_version, v.status AS bundle_status,
    (SELECT array_agg(bp.permission_key ORDER BY bp.permission_key) FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id = r.current_bundle_id) AS bundle_keys
  FROM platform.staff_role_definitions r
  LEFT JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  LEFT JOIN platform.role_bundle_versions v ON v.id = b.bundle_id
  WHERE r.organization_id IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 4) g) AND r.id <> pg_temp.t290_id(1301)
    AND r.label IN ('Телефония — менеджер', 'Телефония — руководитель');

SELECT pg_temp.t290_assert((SELECT count(*) FROM t290_roles) = 5
  AND (SELECT count(*) FROM t290_roles WHERE organization_id = pg_temp.t290_id(1)) = 2
  AND (SELECT count(*) FROM t290_roles WHERE organization_id = pg_temp.t290_id(2)) = 2
  AND (SELECT count(*) FROM t290_roles WHERE organization_id = pg_temp.t290_id(3)) = 1
  AND NOT EXISTS (SELECT 1 FROM t290_roles WHERE organization_id = pg_temp.t290_id(4)),
  'two roles for each active organization, one beside the administrator-made role in organization 3, none for the suspended one');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_roles r
    WHERE NOT (r.label IN ('Телефония — менеджер', 'Телефония — руководитель') AND r.status = 'active' AND r.version = 1
      AND r.bundle_version = 1 AND r.bundle_status = 'published' AND btrim(r.description) <> ''
      AND r.draft_permission_keys = r.bundle_keys)),
  'every new role is active, version 1, with a published bundle version 1 bound to it, and its draft equals the published keys');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_roles r
    WHERE r.bundle_keys IS DISTINCT FROM CASE r.label
      WHEN 'Телефония — менеджер' THEN ARRAY['telephony.call.dial', 'telephony.recording.listen.own', 'telephony.report.read.own']
      ELSE ARRAY['telephony.call.dial', 'telephony.manage', 'telephony.recording.listen.all',
        'telephony.recording.listen.own', 'telephony.report.read.all', 'telephony.report.read.own'] END),
  'the manager role holds exactly dial, listen.own, report.read.own; the supervisor role all six');
SELECT pg_temp.t290_assert((SELECT count(*) FROM platform.staff_role_definitions
      WHERE organization_id IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 4) g)) = :t290_roles_before + 5
  AND (SELECT count(*) FROM platform.staff_role_assignments
      WHERE organization_id IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 4) g)) = :t290_assignments_before
  AND NOT EXISTS (SELECT 1 FROM platform.staff_role_assignments a JOIN t290_roles r ON r.role_id = a.role_id),
  'nobody is assigned to a new role');
SELECT pg_temp.t290_assert((SELECT bool_and(p.access_version = v.access_version) FROM platform.profiles p
    JOIN t290_versions v ON v.profile_id = p.id),
  'no access version moved');
SELECT pg_temp.t290_assert((SELECT count(*) = 1 AND bool_and(r.version = b.version AND r.current_bundle_id = b.current_bundle_id
      AND r.draft_permission_keys = b.draft_permission_keys
      AND (SELECT array_agg(bp.permission_key ORDER BY bp.permission_key) FROM platform.role_bundle_permissions bp
        WHERE bp.bundle_id = r.current_bundle_id) = b.bundle_keys)
    FROM platform.staff_role_definitions r JOIN t290_common_before b ON b.id = r.id),
  'the existing common-sections role keeps its version, bundle and keys: no telephony key was added to it');
SELECT pg_temp.t290_assert(
  (SELECT r.status = 'archived' AND r.version = 1 AND r.current_bundle_id IS NULL
      AND r.draft_permission_keys = ARRAY['catalog.read'] AND r.description = 'T290 made by an administrator'
    FROM platform.staff_role_definitions r WHERE r.id = pg_temp.t290_id(1301))
  AND (SELECT count(*) FROM platform.staff_role_definitions r WHERE r.organization_id = pg_temp.t290_id(3)
    AND r.label = 'Телефония — менеджер') = 1
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'t290_run'::JSONB -> 'skipped') s
    WHERE s ->> 'organizationId' = pg_temp.t290_id(3)::TEXT AND s ->> 'label' = 'Телефония — менеджер')
  AND (SELECT label FROM t290_roles WHERE organization_id = pg_temp.t290_id(3)) = 'Телефония — руководитель',
  'an administrator-made role with the same label (even archived) is untouched and reported as skipped');
SELECT pg_temp.t290_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'staff.roles.migrated'
    AND e.actor_principal = 'migration:290' AND e.actor_kind = 'system' AND e.resource_type = 'staff_role'
    AND e.resource_id IN (SELECT role_id FROM t290_roles) AND e.reason = 'T290 provision'
    AND e.after_state -> 'affectedMembershipIds' = '[]'::JSONB
    AND e.after_state -> 'createdPermissionKeys' = (SELECT to_jsonb(r.bundle_keys) FROM t290_roles r WHERE r.role_id = e.resource_id)
    AND e.organization_id = (SELECT r.organization_id FROM t290_roles r WHERE r.role_id = e.resource_id)) = 5,
  'one migration audit event per new role with its organization, keys and reason');
SELECT pg_temp.t290_assert(
  (SELECT count(*) FROM jsonb_array_elements(:'t290_run'::JSONB -> 'roles') e
    WHERE (e ->> 'roleId')::UUID IN (SELECT role_id FROM t290_roles)) = 5,
  'the summary names the five new roles');

-- A second run changes nothing in the fixture organizations.
SELECT count(*) AS t290_defs_1 FROM platform.staff_role_definitions \gset
SELECT count(*) AS t290_bundles_1 FROM platform.role_bundle_versions \gset
SELECT count(*) AS t290_perms_1 FROM platform.role_bundle_permissions \gset
SELECT count(*) AS t290_events_1 FROM platform.audit_events WHERE action = 'staff.roles.migrated' \gset
SELECT platform_private.telephony_rights_provision('T290 provision again') AS t290_again \gset
SELECT pg_temp.t290_assert((SELECT count(*) FROM platform.staff_role_definitions) = :t290_defs_1
  AND (SELECT count(*) FROM platform.role_bundle_versions) = :t290_bundles_1
  AND (SELECT count(*) FROM platform.role_bundle_permissions) = :t290_perms_1
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'staff.roles.migrated') = :t290_events_1
  AND jsonb_array_length(:'t290_again'::JSONB -> 'roles') = 0
  AND (SELECT count(*) FROM jsonb_array_elements(:'t290_again'::JSONB -> 'skipped') s
    WHERE (s ->> 'organizationId')::UUID IN (SELECT pg_temp.t290_id(g) FROM generate_series(1, 3) g)) = 6,
  'a second run creates nothing, writes nothing and reports the six existing roles of the three active fixture organizations as skipped');
SELECT pg_temp.t290_assert(
  pg_temp.t290_state($$SELECT platform_private.telephony_rights_provision(NULL)$$) = '22023'
  AND pg_temp.t290_state($$SELECT platform_private.telephony_rights_provision('')$$) = '22023'
  AND pg_temp.t290_state($$SELECT platform_private.telephony_rights_provision('   ')$$) = '22023'
  AND pg_temp.t290_state(format('SELECT platform_private.telephony_rights_provision(%L)', repeat('я', 501))) = '22023',
  'a missing, blank or over-long reason is refused with 22023');
SELECT pg_temp.t290_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform_private.telephony_rights_provision(text)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform_private.telephony_rights_verify()', 'EXECUTE')) = 0
  AND NOT has_function_privilege('public', 'platform_private.telephony_rights_provision(text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.telephony_rights_verify()', 'EXECUTE')
  AND pg_temp.t290_call('authenticated', :'t290_admin1', 'SELECT to_jsonb(platform_private.telephony_rights_verify())')
    ->> 'error' LIKE '42501:%'
  AND pg_temp.t290_call('service_role', :'t290_admin1', $$SELECT platform_private.telephony_rights_provision('x')$$)
    ->> 'error' LIKE '42501:%',
  'provision and verify are closed to PUBLIC, anon, authenticated, service_role and supabase_auth_admin');
SELECT pg_temp.t290_assert((SELECT count(*) = 2 AND bool_and(COALESCE(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
        AND p.proowner = 'postgres'::regrole, FALSE))
    FROM pg_proc p WHERE p.oid IN ('platform_private.telephony_rights_provision(text)'::regprocedure,
      'platform_private.telephony_rights_verify()'::regprocedure))
  AND (SELECT provolatile FROM pg_proc WHERE oid = 'platform_private.telephony_rights_provision(text)'::regprocedure) = 'v'
  AND (SELECT provolatile FROM pg_proc WHERE oid = 'platform_private.telephony_rights_verify()'::regprocedure) = 's',
  'provision and verify are owner-owned SECURITY DEFINER with an empty search_path, volatile and stable');

-- No other role carries a telephony key; the three wide keys only the supervisor role.
SELECT pg_temp.t290_assert(NOT EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions bp
    LEFT JOIN platform.staff_role_bundle_bindings b ON b.bundle_id = bp.bundle_id
    LEFT JOIN platform.staff_role_definitions r ON r.organization_id = b.organization_id AND r.id = b.role_id
    WHERE bp.permission_key LIKE 'telephony.%'
      AND (r.id IS NULL OR r.label NOT IN ('Телефония — менеджер', 'Телефония — руководитель'))),
  'only the two telephony roles carry a telephony key: no fixed 041 bundle and no «общие разделы» role has one');
SELECT pg_temp.t290_assert(NOT EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions bp
    JOIN platform.staff_role_bundle_bindings b ON b.bundle_id = bp.bundle_id
    JOIN platform.staff_role_definitions r ON r.organization_id = b.organization_id AND r.id = b.role_id
    WHERE bp.permission_key IN ('telephony.recording.listen.all', 'telephony.report.read.all', 'telephony.manage')
      AND r.label <> 'Телефония — руководитель'),
  'listen.all, report.read.all and manage live only in the supervisor role');

-- ---------------------------------------------------------------------------
-- 4. Rights through the real role and assignment functions.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t290_assign(p_claims TEXT, p_org INTEGER, p_actor INTEGER, p_roles UUID[], p_scope_kind TEXT,
  p_req INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t290_id(200 + p_actor);
  SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', p_scope_kind,
      'key', CASE WHEN p_scope_kind = 'own' THEN NULL ELSE pg_temp.t290_id(p_org)::TEXT END, 'resourceKind', NULL)) ORDER BY r.id),
    jsonb_agg(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version) ORDER BY r.id)
  INTO items, bindings
  FROM platform.staff_role_definitions r
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  WHERE r.id = ANY (p_roles);
  RETURN pg_temp.t290_call('authenticated', p_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t290_id(p_org), pg_temp.t290_id(300 + p_actor), v_version, items, bindings, 'T290 assign',
    pg_temp.t290_id(5000 + p_req)));
END
$$;

CREATE FUNCTION pg_temp.t290_role(p_org INTEGER, p_label TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT role_id FROM t290_roles WHERE organization_id = pg_temp.t290_id(p_org) AND label = p_label
$$;
SELECT pg_temp.t290_assert(
  pg_temp.t290_assign(:'t290_admin1', 1, 2, ARRAY[pg_temp.t290_role(1, 'Телефония — менеджер')], 'organization', 1) ->> 'status' = 'applied'
  AND pg_temp.t290_assign(:'t290_admin1', 1, 3, ARRAY[pg_temp.t290_role(1, 'Телефония — руководитель')], 'organization', 2) ->> 'status' = 'applied'
  AND pg_temp.t290_assign(:'t290_admin1', 1, 4, ARRAY[pg_temp.t290_id(1101)], 'organization', 3) ->> 'status' = 'applied'
  AND pg_temp.t290_assign(:'t290_admin1', 1, 7, ARRAY[pg_temp.t290_role(1, 'Телефония — менеджер')], 'organization', 4) ->> 'status' = 'applied',
  'the Admin assigns the manager, supervisor and common-sections roles through staff_role_assignments_save');
SELECT pg_temp.t290_assert(
  (pg_temp.t290_assign(:'t290_admin1', 1, 5, ARRAY[pg_temp.t290_role(1, 'Телефония — менеджер')], 'own', 5) ->> 'error') LIKE '22023:%'
  AND (pg_temp.t290_assign(:'t290_admin1', 1, 5, ARRAY[pg_temp.t290_role(1, 'Телефония — руководитель')], 'own', 6) ->> 'error') LIKE '22023:%'
  AND NOT EXISTS (SELECT 1 FROM platform.staff_role_assignments a WHERE a.membership_id = pg_temp.t290_id(305)),
  'the telephony roles cannot be assigned at own scope: refused with 22023, nothing assigned');
SELECT pg_temp.t290_assert(
  pg_temp.t290_assign(:'t290_admin1', 1, 9, ARRAY[pg_temp.t290_role(1, 'Телефония — менеджер')], 'organization', 7) ->> 'error' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM platform.staff_role_assignments a WHERE a.membership_id = pg_temp.t290_id(309)),
  'a role of one organization cannot be given to a member of another');

-- The expected matrix, in key order dial, listen.own, listen.all, report.own, report.all, manage.
INSERT INTO t290_expect VALUES
  (1, 1, 'TTTTTT'), (10, 1, 'TTTTTT'), (8, 2, 'TTTTTT'),
  (2, 1, 'TTFTFF'), (7, 1, 'TTFTFF'), (3, 1, 'TTTTTT'),
  (4, 1, 'FFFFFF'), (5, 1, 'FFFFFF'), (6, 1, 'FFFFFF'), (9, 2, 'FFFFFF');
CREATE TEMP TABLE t290_cells AS
  SELECT e.actor, e.org, k.k, substr(e.pattern, k.ord, 1) = 'T' AS expected
  FROM t290_expect e CROSS JOIN t290_keys k;
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_cells c
    WHERE platform_private.staff_has_permission(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k) IS DISTINCT FROM c.expected),
  'staff_has_permission matches the expected matrix for the Admin, manager, supervisor, common-role, no-role and Student members: '
    || COALESCE((SELECT string_agg('actor ' || c.actor || ' ' || c.k, ', ') FROM t290_cells c
      WHERE platform_private.staff_has_permission(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k)
        IS DISTINCT FROM c.expected), ''));
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_cells c
    WHERE platform_private.staff_can_access(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k, 'organization',
      pg_temp.t290_id(c.org)) IS DISTINCT FROM c.expected),
  'staff_can_access on the organization resource matches the same matrix');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_cells c
    WHERE platform_private.staff_context_can_access(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k,
      'organization', pg_temp.t290_id(c.org), NULL, NULL, NULL) IS DISTINCT FROM c.expected)
  AND NOT EXISTS (SELECT 1 FROM t290_cells c CROSS JOIN (VALUES ('lead'), ('student_case'), ('conversation'),
      ('staff_task'), ('company_file')) kind(name)
    WHERE platform_private.staff_context_can_access(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k, kind.name,
      pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), NULL, NULL)),
  'the matcher agrees on the organization resource, and the telephony keys open no other resource kind, not even for the Admin');
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_cells c
    WHERE platform_private.staff_can_access(pg_temp.t290_id(c.org), pg_temp.t290_id(300 + c.actor), c.k, 'organization',
      pg_temp.t290_id(CASE c.org WHEN 1 THEN 2 ELSE 1 END))
      OR platform_private.staff_has_permission(pg_temp.t290_id(CASE c.org WHEN 1 THEN 2 ELSE 1 END),
        pg_temp.t290_id(300 + c.actor), c.k)),
  'a member holds nothing in another organization, by resource or by membership');

-- The manager's session itself sees the permission the same way (JWT path).
SELECT pg_temp.t290_assert(
  (pg_temp.t290_call('authenticated', :'t290_manager', format(
    $q$SELECT to_jsonb(platform_private.staff_has_permission(%L::UUID, %L::UUID, 'telephony.call.dial'))$q$,
    pg_temp.t290_id(1), pg_temp.t290_id(302))) ->> 'error') LIKE '42501:%',
  'platform_private stays closed to a signed-in member: the check runs only inside the database functions');

-- An inactive membership loses every key; the others are not affected.
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t290_id(307);
SELECT pg_temp.t290_assert(NOT EXISTS (SELECT 1 FROM t290_keys k
    WHERE platform_private.staff_has_permission(pg_temp.t290_id(1), pg_temp.t290_id(307), k.k))
  AND platform_private.staff_has_permission(pg_temp.t290_id(1), pg_temp.t290_id(302), 'telephony.call.dial'),
  'an inactive membership holds no telephony key, the other manager still does');
UPDATE platform.organization_memberships SET status = 'active' WHERE id = pg_temp.t290_id(307);

-- Archiving the supervisor role takes its keys away (the real archive command).
-- The command runs in its own statement: the checks below must see its effect.
SELECT pg_temp.t290_call('authenticated', :'t290_admin1', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 1, 'archive', %L::JSONB, 'T290 archive', %L::UUID)$q$,
    pg_temp.t290_id(1), pg_temp.t290_role(1, 'Телефония — руководитель'),
    jsonb_build_object('replacementRoleId', NULL, 'revokeAssignments', TRUE, 'expectedImpactFingerprint',
      platform_private.staff_role_archive_impact_fingerprint(pg_temp.t290_id(1),
        pg_temp.t290_role(1, 'Телефония — руководитель'), NULL, TRUE)),
    pg_temp.t290_id(5100)))::TEXT AS t290_archive \gset
SELECT pg_temp.t290_assert(:'t290_archive'::JSONB ->> 'status' = 'applied', 'the Admin archives the supervisor role: ' || :'t290_archive');
SELECT pg_temp.t290_assert(
  NOT EXISTS (SELECT 1 FROM t290_keys k
    WHERE platform_private.staff_has_permission(pg_temp.t290_id(1), pg_temp.t290_id(303), k.k))
  AND platform_private.staff_has_permission(pg_temp.t290_id(1), pg_temp.t290_id(301), 'telephony.manage'),
  'archiving the supervisor role takes every telephony key from its holder; the system Admin keeps all six');

-- ---------------------------------------------------------------------------
-- 5. The final check.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t290_assert(pg_temp.t290_state('SELECT platform_private.telephony_rights_verify()') = 'ok',
  'telephony_rights_verify accepts the state (every system admin holds all six)');
ALTER TABLE platform.permission_definitions DISABLE TRIGGER permission_definitions_append_only_rows;
SELECT pg_temp.t290_assert(
  pg_temp.t290_tampered($$UPDATE platform.permission_definitions SET staff_sensitive = TRUE WHERE permission_key = 'telephony.manage'$$)
    = '55000:telephony_permission_catalog_drift'
  AND pg_temp.t290_tampered($$UPDATE platform.permission_definitions SET staff_system_only = TRUE WHERE permission_key = 'telephony.report.read.all'$$)
    = '55000:telephony_permission_catalog_drift'
  AND pg_temp.t290_tampered($$UPDATE platform.permission_definitions SET staff_group = 'Прочее' WHERE permission_key = 'telephony.call.dial'$$)
    = '55000:telephony_permission_catalog_drift'
  AND pg_temp.t290_tampered($$UPDATE platform.permission_definitions SET staff_scope_kinds = ARRAY['own', 'organization'] WHERE permission_key = 'telephony.report.read.own'$$)
    = '55000:telephony_permission_catalog_drift'
  AND pg_temp.t290_tampered($$UPDATE platform.permission_definitions SET staff_resource_kinds = ARRAY['organization', 'lead'] WHERE permission_key = 'telephony.recording.listen.own'$$)
    = '55000:telephony_permission_catalog_drift',
  'a sensitive, system-only, regrouped, widened-scope or widened-resource telephony definition makes the final check refuse with 55000');
ALTER TABLE platform.permission_definitions ENABLE TRIGGER permission_definitions_append_only_rows;
SELECT pg_temp.t290_assert(
  (SELECT count(*) FROM platform.permission_definitions WHERE permission_key LIKE 'telephony.%'
    AND staff_resource_kinds = ARRAY['organization']::TEXT[] AND staff_scope_kinds = ARRAY['organization']::TEXT[]
    AND NOT staff_sensitive AND NOT staff_system_only AND staff_group = 'Телефония') = 6
  AND pg_temp.t290_state('SELECT platform_private.telephony_rights_verify()') = 'ok',
  'the tamper attempts left the catalog untouched');

SELECT count(*) AS t290_active_admins FROM platform.organization_memberships m
  WHERE m.is_system_admin AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id)) \gset
SELECT pg_temp.t290_assert(:t290_active_admins >= 3, 'the fixture has at least three active system admins');
SELECT pg_temp.t290_assert(
  pg_temp.t290_tampered($$CREATE OR REPLACE FUNCTION platform_private.staff_has_permission(
      p_organization_id UUID, p_membership_id UUID, p_permission_key TEXT)
    RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS
    'SELECT p_permission_key <> ''telephony.manage''' $$)
    = '55000:telephony_rights_admin_missing: ' || :t290_active_admins,
  'a key that is not effective for a system admin makes the final check refuse, naming the number of active system admins');
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t290_id(310);
SELECT pg_temp.t290_assert(
  pg_temp.t290_tampered($$CREATE OR REPLACE FUNCTION platform_private.staff_has_permission(
      p_organization_id UUID, p_membership_id UUID, p_permission_key TEXT)
    RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS
    'SELECT p_permission_key <> ''telephony.manage''' $$)
    = '55000:telephony_rights_admin_missing: ' || (:t290_active_admins - 1)
  AND pg_temp.t290_state('SELECT platform_private.telephony_rights_verify()') = 'ok',
  'an inactive system admin is not counted by the final check');
UPDATE platform.organization_memberships SET status = 'active' WHERE id = pg_temp.t290_id(310);

-- ---------------------------------------------------------------------------
-- 6. The journal allowlist.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t290_new_actions(a TEXT PRIMARY KEY);
INSERT INTO t290_new_actions VALUES ('telephony.recording.listen'), ('telephony.dial'), ('telephony.result.set'),
  ('telephony.settings.change'), ('telephony.mapping.change'), ('telephony.automation.stop');
CREATE TEMP TABLE t290_new_types(t TEXT PRIMARY KEY);
INSERT INTO t290_new_types VALUES ('telephony_call'), ('telephony_dial_request'), ('telephony_settings');
SELECT pg_temp.t290_assert(
  (SELECT array_agg(a ORDER BY a) FROM unnest(platform_private.p7a_safe_audit_actions()) a)
    = (SELECT array_agg(DISTINCT a ORDER BY a) FROM (
        SELECT unnest(platform_private.p7a_safe_audit_actions_pre_telephony_rights()) AS a
        UNION ALL SELECT a FROM t290_new_actions) u)
  AND cardinality(platform_private.p7a_safe_audit_actions())
    = cardinality(platform_private.p7a_safe_audit_actions_pre_telephony_rights()) + 6
  AND NOT (platform_private.p7a_safe_audit_actions_pre_telephony_rights() && ARRAY(SELECT a FROM t290_new_actions)),
  'the action allowlist is the previous list plus exactly the six telephony actions');
SELECT pg_temp.t290_assert(
  (SELECT array_agg(t ORDER BY t) FROM unnest(platform_private.p7a_safe_audit_resource_types()) t)
    = (SELECT array_agg(DISTINCT t ORDER BY t) FROM (
        SELECT unnest(platform_private.p7a_safe_audit_resource_types_pre_telephony_rights()) AS t
        UNION ALL SELECT t FROM t290_new_types) u)
  AND cardinality(platform_private.p7a_safe_audit_resource_types())
    = cardinality(platform_private.p7a_safe_audit_resource_types_pre_telephony_rights()) + 3
  AND NOT (platform_private.p7a_safe_audit_resource_types_pre_telephony_rights() && ARRAY(SELECT t FROM t290_new_types)),
  'the resource-type allowlist is the previous list plus exactly the three telephony types');
SELECT pg_temp.t290_assert(
  (SELECT array_agg(a ORDER BY a) FROM unnest(platform_private.p7a_safe_audit_actions()) a WHERE a LIKE 'telephony.%')
    = (SELECT array_agg(a ORDER BY a) FROM t290_new_actions)
  AND (SELECT array_agg(t ORDER BY t) FROM unnest(platform_private.p7a_safe_audit_resource_types()) t WHERE t LIKE 'telephony\_%')
    = (SELECT array_agg(t ORDER BY t) FROM t290_new_types),
  'nothing else under telephony.* or telephony_* is allowlisted: the automatic intake events and the other tables stay out of the journal');
SELECT pg_temp.t290_assert(
  platform_private.p7a_safe_audit_actions_pre_telephony_rights() @> ARRAY['team.chat.post', 'staff.role.publish',
    'document.export.ready', 'membership.permission.change', 'audit.export', 'case.create']
  AND platform_private.p7a_safe_audit_actions_pre_journal_widen() @> ARRAY['audit.export', 'case.create']
  AND platform_private.p7a_safe_audit_resource_types_pre_telephony_rights() @> ARRAY['staff_role', 'document_export',
    'student_case', 'membership']
  AND NOT (platform_private.p7a_safe_audit_actions() && ARRAY['staff.roles.migrated', 'work.claim', 'communication.webhook.persist']),
  'the earlier wrappers are kept and the migration action of the roles stays out of the journal');
SELECT pg_temp.t290_assert((SELECT count(*) = 4 AND bool_and(COALESCE(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
        AND p.provolatile = 'i' AND p.proowner = 'postgres'::regrole AND pg_get_function_result(p.oid) = 'text[]', FALSE))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('p7a_safe_audit_actions', 'p7a_safe_audit_actions_pre_telephony_rights',
      'p7a_safe_audit_resource_types', 'p7a_safe_audit_resource_types_pre_telephony_rights')),
  'the four allowlist functions are owner-owned, SECURITY DEFINER, IMMUTABLE, with an empty search_path');
SELECT pg_temp.t290_assert(NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')) r(role_name)
    WHERE n.nspname = 'platform_private' AND p.proname IN ('p7a_safe_audit_actions', 'p7a_safe_audit_actions_pre_telephony_rights',
      'p7a_safe_audit_resource_types', 'p7a_safe_audit_resource_types_pre_telephony_rights')
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE'))
  AND NOT has_function_privilege('public', 'platform_private.p7a_safe_audit_actions()', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.p7a_safe_audit_resource_types()', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.p7a_safe_audit_actions_pre_telephony_rights()', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.p7a_safe_audit_resource_types_pre_telephony_rights()', 'EXECUTE'),
  'the allowlist functions are closed to PUBLIC and every client role');
SELECT pg_temp.t290_assert((SELECT bool_and(platform_private.p7a_changed_field_codes(a) = ARRAY['record_status']::TEXT[])
    FROM t290_new_actions),
  'the new actions take the default changed-field code record_status');

SELECT 'T290_TELEPHONY_RIGHTS_SUITE_PASS' AS t290_suite_marker;
ROLLBACK;
