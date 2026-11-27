\set ON_ERROR_STOP on
-- Boundary suite for migration 380: «мозг компании» - проверенные факты со сроком годности отдельно от инструкций
-- (docs/design/ai-agents/facts-seed-map.md). Runs on the real chain right after 380 inside one transaction that is
-- rolled back, with its own synthetic organizations and members; sessions are the real custom_access_token_hook
-- claims. No provider, no Claude/Anthropic call, no real person, no production action.
--
-- Proves:
--  1. posture: the closed table (FORCE RLS, no policy, no API grants), the three staff functions (authenticated
--     only), the tool (service_role only), the helpers (nobody), the tool schema row, the journal allowlist (+1 action,
--     +1 type, previous lists intact);
--  2. seed: one organization gets all rows, a second run adds nothing, rows carry source / reference / dates, another
--     organization is untouched until it is seeded;
--  3. permissions: the viewer reads and cannot write, the manager writes, the Admin does both, an AI-less staff member,
--     a student, an outsider organization, anon and service_role are refused;
--  4. save: create (verified today in Bishkek by the actor), duplicate topic, verification required for text, unknown
--     keys, bad topic / dates; edit makes a new version (old `retired`, new `supersedes_id`), stale save, date-only edit
--     keeps the old verification, «Проверено» alone makes a version, no-op, replay by request id and its conflict;
--  5. retire and list: filters, history, validity marks (expired / expiring / unlimited), counts, invalid filters;
--  6. tool: only active and unexpired facts (the last valid day counts, yesterday does not), draft / retired / another
--     organization never, prefix, audience, limit and truncated, shape, `agent_disabled`, invalid arguments;
--  7. journal rows: action `ai.fact.change`, object `ai_company_fact`, the actor, no statement text, replay writes none.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A381_COMPANY_FACTS_SUITE_START

CREATE FUNCTION pg_temp.a381_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a381_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A381: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a381_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
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
CREATE TEMP TABLE a381_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a381_claims TO authenticated;
CREATE FUNCTION pg_temp.a381_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_call('authenticated', (SELECT claims FROM a381_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a381_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a381_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a381_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a381_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
-- The staff RPCs as one call: list / save / retire for the actor and organization.
CREATE FUNCTION pg_temp.a381_list(p_actor INTEGER, p_org INTEGER, p_args TEXT DEFAULT '') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_staff(p_actor, format('SELECT platform.ai_company_facts_list_v1(%L%s)', pg_temp.a381_id(p_org),
    CASE WHEN p_args = '' THEN '' ELSE ', ' || p_args END))
$$;
CREATE FUNCTION pg_temp.a381_save(p_actor INTEGER, p_fact UUID, p_patch TEXT, p_request UUID, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_staff(p_actor, format('SELECT platform.ai_company_facts_save_v1(%L, %L, %L::jsonb, %L)',
    pg_temp.a381_id(p_org), p_fact, p_patch, p_request))
$$;
CREATE FUNCTION pg_temp.a381_retire(p_actor INTEGER, p_fact UUID, p_request UUID, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_staff(p_actor, format('SELECT platform.ai_company_facts_retire_v1(%L, %L, %L)',
    pg_temp.a381_id(p_org), p_fact, p_request))
$$;
CREATE FUNCTION pg_temp.a381_tool(p_key TEXT, p_args TEXT DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a381_svc(format('SELECT platform.ai_agent_tool_get_company_facts_v1(%L, %L, %L::jsonb)', pg_temp.a381_id(p_org), p_key, p_args))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a381_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   1 org 1 Admin (system admin)              6 org 2 Admin (system admin)
--   2 org 1 invited staff «Tasks» (no AI rights)    3 org 1 invited staff «AI viewer»  (ai.agent.use)
--   4 org 1 invited staff «AI manager» (ai.agent.manage + use)    5 org 1 Student
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a381_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a381_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, 'student', FALSE), (6, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a381_id(1), 'A381 Fictional organization', 'active'),
  (pg_temp.a381_id(2), 'A381 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a381_id(100 + n), 'a381-' || n || '@example.invalid', '{}'::JSONB FROM a381_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a381_id(200 + n), pg_temp.a381_id(100 + n), 'A381 Actor ' || n, 'active', 1 FROM a381_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a381_id(300 + a.n), pg_temp.a381_id(a.org), pg_temp.a381_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a381_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a381_id(300 + n) FROM a381_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a381_id(401), pg_temp.a381_id(1), 'organization', pg_temp.a381_id(1), 1),
  (pg_temp.a381_id(402), pg_temp.a381_id(2), 'organization', pg_temp.a381_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a381_id(1), pg_temp.a381_id(301), pg_temp.a381_id(401), 1, 1, TRUE, 'system', 'A381 synthetic scope', pg_temp.a381_id(601)),
  (pg_temp.a381_id(2), pg_temp.a381_id(306), pg_temp.a381_id(402), 1, 1, TRUE, 'system', 'A381 synthetic scope', pg_temp.a381_id(602)),
  (pg_temp.a381_id(1), pg_temp.a381_id(302), pg_temp.a381_id(401), 1, 1, TRUE, 'system', 'A381 synthetic scope', pg_temp.a381_id(603));

CREATE FUNCTION pg_temp.a381_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a381_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a381_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a381_claims(actor, claims) SELECT a.n, pg_temp.a381_claims_for(a.n) FROM a381_actors a;

CREATE TEMP TABLE a381_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a381_roles VALUES
  (pg_temp.a381_id(1101), 'AI viewer', '["ai.agent.use","organization.read"]', 1120),
  (pg_temp.a381_id(1102), 'AI manager', '["ai.agent.manage","ai.agent.use","organization.read"]', 1130),
  (pg_temp.a381_id(1103), 'Tasks', '["staff.task.complete","staff.task.edit","staff.task.read"]', 1140);
CREATE TEMP TABLE a381_grants(membership INTEGER, role_id UUID, own BOOLEAN);
INSERT INTO a381_grants VALUES (3, pg_temp.a381_id(1101), FALSE), (4, pg_temp.a381_id(1102), FALSE), (2, pg_temp.a381_id(1103), TRUE);
CREATE TEMP TABLE a381_bundles(role_id UUID, bundle_id UUID);
GRANT SELECT ON a381_roles, a381_grants TO authenticated;
GRANT SELECT, INSERT ON a381_bundles TO authenticated;
CREATE FUNCTION pg_temp.a381_roles_phase() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; m INTEGER; published JSONB; items JSONB; bindings JSONB;
BEGIN
  FOR r IN SELECT * FROM a381_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a381_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A381 ' || r.label, 'description', 'Migration 380 synthetic role',
        'permissionKeys', r.keys), 'A381 create role', pg_temp.a381_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a381_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a381_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'A381 publish role', pg_temp.a381_id(r.request_base + 2));
    INSERT INTO a381_bundles VALUES (r.role_id, (published ->> 'bundleId')::UUID);
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a381_grants ORDER BY 1 LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id,
        'scope', CASE WHEN g.own THEN jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
          ELSE jsonb_build_object('kind', 'organization', 'key', pg_temp.a381_id(1), 'resourceKind', NULL) END) ORDER BY g.role_id), '[]'::JSONB),
      COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', b.bundle_id,
        'bundleVersion', 1) ORDER BY g.role_id), '[]'::JSONB)
    INTO items, bindings FROM a381_grants g JOIN a381_bundles b ON b.role_id = g.role_id WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a381_id(1), pg_temp.a381_id(300 + m),
      (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
        WHERE om.id = pg_temp.a381_id(300 + m)), items, bindings, 'A381 grant roles', pg_temp.a381_id(1200 + m));
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a381_roles_phase() TO authenticated;
SELECT claims AS a381_admin_claims FROM a381_claims WHERE actor = 1 \gset
SET LOCAL request.jwt.claims TO :'a381_admin_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a381_roles_phase();
RESET ROLE;
UPDATE a381_claims c SET claims = pg_temp.a381_claims_for(c.actor);

SELECT pg_temp.a381_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id')
    FROM a381_claims), 'every fixture actor got real hook claims');
SELECT pg_temp.a381_assert(
  platform_private.staff_has_permission(pg_temp.a381_id(1), pg_temp.a381_id(303), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.a381_id(1), pg_temp.a381_id(303), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.a381_id(1), pg_temp.a381_id(304), 'ai.agent.manage')
  AND NOT platform_private.staff_has_permission(pg_temp.a381_id(1), pg_temp.a381_id(302), 'ai.agent.use'),
  'fixture: 3 uses, 4 manages, the staff member 2 has neither');

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform_private.company_facts'::REGCLASS)
  AND NOT EXISTS (SELECT 1 FROM pg_policies x WHERE x.schemaname = 'platform_private' AND x.tablename = 'company_facts')
  AND NOT has_table_privilege('anon', 'platform_private.company_facts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.company_facts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.company_facts', 'INSERT')
  AND NOT has_table_privilege('service_role', 'platform_private.company_facts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.company_facts', 'UPDATE'),
  'the facts table is closed: FORCE RLS, no policy, no API grants');
SELECT pg_temp.a381_assert(
  (SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
   FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('ai_company_facts_list_v1', 'ai_company_facts_save_v1', 'ai_company_facts_retire_v1', 'ai_agent_tool_get_company_facts_v1'))
  AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
       FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_company\_facts\_%')
  AND NOT has_function_privilege('authenticated', 'platform.ai_agent_tool_get_company_facts_v1(uuid,text,jsonb)'::REGPROCEDURE, 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.ai_agent_tool_get_company_facts_v1(uuid,text,jsonb)'::REGPROCEDURE, 'EXECUTE')
  AND (SELECT count(*) = 3 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND p.prosecdef)
       FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
         AND p.proname IN ('company_facts_today', 'company_fact_json', 'company_facts_seed')),
  'the staff functions go to authenticated, the tool to service_role, the helpers to nobody');
SELECT pg_temp.a381_assert(
  (SELECT kind = 'read' AND audit = 'none' AND input_schema -> 'properties' ? 'topic_prefix'
     AND input_schema ->> 'additionalProperties' = 'false'
   FROM platform_private.ai_agent_tool_schemas WHERE tool = 'get_company_facts')
  AND (SELECT count(*) FROM platform_private.ai_agent_tool_schemas) = (SELECT count(*) FROM pg_proc p
      WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%'),
  'the tool has its schema row, and schemas and tool functions are still paired');
SELECT pg_temp.a381_assert(
  'ai.fact.change' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('ai.fact.change' = ANY (platform_private.p7a_safe_audit_actions_pre_company_facts()))
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_company_facts()) + 1
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_actions_pre_company_facts()) a
    WHERE NOT (a = ANY (platform_private.p7a_safe_audit_actions())))
  AND 'ai_company_fact' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND NOT ('ai_company_fact' = ANY (platform_private.p7a_safe_audit_resource_types_pre_company_facts()))
  AND cardinality(platform_private.p7a_safe_audit_resource_types()) = cardinality(platform_private.p7a_safe_audit_resource_types_pre_company_facts()) + 1
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_resource_types_pre_company_facts()) a
    WHERE NOT (a = ANY (platform_private.p7a_safe_audit_resource_types()))),
  'the journal allowlists gain exactly one action and one object type, the previous lists are intact');

-- ---------------------------------------------------------------------------
-- 2. Seed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert((SELECT count(*) = 0 FROM platform_private.company_facts WHERE organization_id IN (pg_temp.a381_id(1), pg_temp.a381_id(2))),
  'the fixture organizations appeared after the migration: nothing seeded yet');
SELECT platform_private.company_facts_seed(pg_temp.a381_id(1)) AS a381_seeded \gset
SELECT pg_temp.a381_assert(:a381_seeded >= 60 AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_seeded,
  'the seed inserts every row for the organization');
SELECT platform_private.company_facts_seed(pg_temp.a381_id(1)) AS a381_seeded_again \gset
SELECT pg_temp.a381_assert(:a381_seeded_again = 0
  AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_seeded,
  'a second seed adds nothing');
SELECT pg_temp.a381_assert((SELECT count(*) = 0 FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(2)),
  'another organization is untouched until it is seeded');
SELECT pg_temp.a381_assert(
  (SELECT bool_and(source = 'agent_instruction' AND status = 'active' AND source_ref LIKE 'src/content/ai-agents/%.md#%'
      AND valid_until IS NOT NULL AND valid_until >= verified_at AND verified_by_membership_id IS NULL AND supersedes_id IS NULL
      AND audience IN ('client', 'internal') AND topic ~ '^[a-z0-9]+(\.[a-z0-9_-]+)+$')
   FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1))
  AND (SELECT statement_ru LIKE '%299%' AND statement_ru LIKE '%349%' AND valid_until = DATE '2026-12-31' AND verified_at = DATE '2026-10-23'
       FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) AND topic = 'course.sat.group' AND audience = 'client')
  AND (SELECT statement_ru LIKE '%249%' AND statement_ru LIKE '%299%'
       FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) AND topic = 'course.ielts.group')
  AND (SELECT valid_until = DATE '2027-09-01' FROM platform_private.company_facts
       WHERE organization_id = pg_temp.a381_id(1) AND topic = 'calendar.cn.intake_2027.minor_age_cutoff')
  AND (SELECT count(*) > 5 FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) AND topic LIKE 'calendar.cn.%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)
    AND (statement_ru ~ '[0-9]{9,}' OR statement_ru ~* '@[a-z0-9.-]+\.[a-z]{2,}|https?://|\+996')),
  'seed rows: instruction source and reference, dates, the course prices, the one-day event, no phone, e-mail or link');
SELECT platform_private.company_facts_seed(pg_temp.a381_id(2)) AS a381_seeded_2 \gset
SELECT pg_temp.a381_assert(:a381_seeded_2 = :a381_seeded AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_seeded,
  'the second organization gets its own copy and the first one is unchanged');
-- Direct writes break the table rules (the checks live in the table, not only in the functions).
DO $a381_checks$
DECLARE v_state TEXT;
BEGIN
  FOR v_state IN SELECT unnest(ARRAY[
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'BadTopic', 'x', 'client', 'owner', DATE '2026-11-01', 'active')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'x.y', repeat('я', 1501), 'client', 'owner', DATE '2026-11-01', 'active')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'x.y', 'x', 'everyone', 'owner', DATE '2026-11-01', 'active')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'x.y', 'x', 'client', 'web', DATE '2026-11-01', 'active')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, valid_until, status) VALUES ('38000000-0000-4000-8000-000000000001', 'x.y', 'x', 'client', 'owner', DATE '2026-11-01', DATE '2026-10-01', 'active')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'x.y', 'x', 'client', 'owner', DATE '2026-11-01', 'published')$q$,
    $q$INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, status) VALUES ('38000000-0000-4000-8000-000000000001', 'course.sat.group', 'dup', 'client', 'owner', DATE '2026-11-01', 'active')$q$
  ]) LOOP
    BEGIN
      EXECUTE v_state;
      RAISE EXCEPTION 'A381: a bad row was accepted: %', left(v_state, 120);
    EXCEPTION WHEN check_violation OR unique_violation THEN NULL;
    END;
  END LOOP;
END
$a381_checks$;

-- ---------------------------------------------------------------------------
-- 3. Permissions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert(
  jsonb_array_length(pg_temp.a381_list(1, 1) -> 'facts') = :a381_seeded
  AND (pg_temp.a381_list(1, 1) ->> 'canManage')::BOOLEAN
  AND jsonb_array_length(pg_temp.a381_list(3, 1) -> 'facts') = :a381_seeded
  AND NOT (pg_temp.a381_list(3, 1) ->> 'canManage')::BOOLEAN
  AND (pg_temp.a381_list(4, 1) ->> 'canManage')::BOOLEAN,
  'the Admin and the manager read and manage, the viewer reads only');
SELECT pg_temp.a381_assert(
  pg_temp.a381_err(pg_temp.a381_list(2, 1)) = '42501' AND pg_temp.a381_err(pg_temp.a381_list(5, 1)) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_list(6, 1)) = '42501' AND pg_temp.a381_err(pg_temp.a381_list(1, 2)) = '42501'
  AND jsonb_array_length(pg_temp.a381_list(6, 2) -> 'facts') = :a381_seeded
  AND pg_temp.a381_err(pg_temp.a381_anon(format('SELECT platform.ai_company_facts_list_v1(%L)', pg_temp.a381_id(1)))) IS NOT NULL
  AND pg_temp.a381_err(pg_temp.a381_svc(format('SELECT platform.ai_company_facts_list_v1(%L)', pg_temp.a381_id(1)))) = '42501',
  'no AI right, a student, an outsider organization, anon and service_role are refused');
SELECT id AS a381_fact_sat FROM platform_private.company_facts
  WHERE organization_id = pg_temp.a381_id(1) AND topic = 'course.sat.group' AND audience = 'client' \gset
SELECT pg_temp.a381_assert(
  pg_temp.a381_err(pg_temp.a381_save(3, :'a381_fact_sat', '{"markVerified": true}', pg_temp.a381_id(7001))) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_save(2, :'a381_fact_sat', '{"markVerified": true}', pg_temp.a381_id(7002))) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_save(6, :'a381_fact_sat', '{"markVerified": true}', pg_temp.a381_id(7003))) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_retire(3, :'a381_fact_sat', pg_temp.a381_id(7004))) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_retire(1, :'a381_fact_sat', pg_temp.a381_id(7005), 2)) = '42501'
  AND pg_temp.a381_err(pg_temp.a381_svc(format('SELECT platform.ai_company_facts_save_v1(%L, NULL, ''{"markVerified":true}''::jsonb, %L)',
        pg_temp.a381_id(1), pg_temp.a381_id(7006)))) = '42501'
  AND (SELECT status = 'active' FROM platform_private.company_facts WHERE id = :'a381_fact_sat'),
  'the viewer, a staff member without the right and an outsider cannot write; nothing changed');

-- ---------------------------------------------------------------------------
-- 4. Save: create, versions, replay.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert(
  pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","statementRu":"Тест"}', pg_temp.a381_id(7101))) = '22023'
  AND pg_temp.a381_msg(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","statementRu":"Тест"}', pg_temp.a381_id(7102))) = 'company_fact_verification_required'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"Bad Topic","audience":"client","statementRu":"Тест","markVerified":true}', pg_temp.a381_id(7103))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"all","statementRu":"Тест","markVerified":true}', pg_temp.a381_id(7104))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","markVerified":true}', pg_temp.a381_id(7105))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","statementRu":"Тест","markVerified":true,"extra":1}', pg_temp.a381_id(7106))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, format('{"topic":"promise.test","audience":"client","statementRu":%s,"markVerified":true}', to_json(repeat('я', 1501))), pg_temp.a381_id(7107))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","statementRu":"Тест","markVerified":true,"validUntil":"2020-01-01"}', pg_temp.a381_id(7108))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"promise.test","audience":"client","statementRu":"Тест","markVerified":true,"validUntil":"2026-02-30"}', pg_temp.a381_id(7109))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{}', pg_temp.a381_id(7110))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, NULL, '{"topic":"course.sat.group","audience":"client","statementRu":"Дубль","markVerified":true}', pg_temp.a381_id(7111))) = '23505'
  AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_seeded,
  'create validations: verification, topic, audience, text, dates, unknown key, duplicate; nothing was written');
SELECT pg_temp.a381_save(4, NULL,
  '{"topic":"promise.test","audience":"internal","statementRu":"Тестовый факт","statementKy":"Тест","source":"owner","sourceRef":"владелец, 28.11.2026","validUntil":"2098-01-31","markVerified":true}',
  pg_temp.a381_id(7120)) AS a381_created \gset
SELECT pg_temp.a381_assert(
  (SELECT t.status = 'active' AND t.verified_at = platform_private.company_facts_today() AND t.verified_by_membership_id = pg_temp.a381_id(304)
      AND t.created_by_membership_id = pg_temp.a381_id(304) AND t.supersedes_id IS NULL AND t.statement_ky = 'Тест' AND t.statement_en IS NULL
      AND t.valid_until = DATE '2098-01-31' AND t.source = 'owner' AND t.audience = 'internal'
   FROM platform_private.company_facts t WHERE t.id = (:'a381_created'::JSONB ->> 'factId')::UUID)
  AND :'a381_created'::JSONB ->> 'status' = 'saved' AND (:'a381_created'::JSONB -> 'changed') = '["created"]'::JSONB,
  'create: active, verified today (Bishkek) by the manager, optional languages, source and dates stored');
SELECT (:'a381_created'::JSONB ->> 'factId') AS a381_fact_new \gset
-- Edit: a new version, the old one retired.
SELECT pg_temp.a381_assert(
  pg_temp.a381_msg(pg_temp.a381_save(4, :'a381_fact_new', '{"statementRu":"Новый текст"}', pg_temp.a381_id(7121))) = 'company_fact_verification_required'
  AND pg_temp.a381_err(pg_temp.a381_save(4, :'a381_fact_new', '{"topic":"promise.other","markVerified":true}', pg_temp.a381_id(7122))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, :'a381_fact_new', '{"statementRu":null,"markVerified":true}', pg_temp.a381_id(7123))) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_save(4, pg_temp.a381_id(9999), '{"markVerified":true}', pg_temp.a381_id(7124))) = 'P0002'
  AND pg_temp.a381_msg(pg_temp.a381_save(4, :'a381_fact_new', '{"validUntil":"2026-11-01","markVerified":true}', pg_temp.a381_id(7125))) = 'company_fact_invalid_dates',
  'edit validations: text needs «Проверено», topic is fixed, Russian text cannot be removed, unknown fact');
SELECT pg_temp.a381_save(4, :'a381_fact_new', '{"statementRu":"Новый текст","statementKy":null,"statementEn":"New text","markVerified":true}', pg_temp.a381_id(7126)) AS a381_edit \gset
SELECT (:'a381_edit'::JSONB ->> 'factId') AS a381_fact_v2 \gset
SELECT pg_temp.a381_assert(
  :'a381_fact_v2' <> :'a381_fact_new'
  AND (SELECT status = 'retired' FROM platform_private.company_facts WHERE id = :'a381_fact_new')
  AND (SELECT status = 'active' AND supersedes_id = :'a381_fact_new'::UUID AND statement_ru = 'Новый текст' AND statement_ky IS NULL
        AND statement_en = 'New text' AND topic = 'promise.test' AND audience = 'internal' AND valid_until = DATE '2098-01-31'
        AND verified_by_membership_id = pg_temp.a381_id(304)
      FROM platform_private.company_facts WHERE id = :'a381_fact_v2')
  AND (SELECT count(*) = 1 FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) AND topic = 'promise.test' AND status = 'active')
  AND :'a381_edit'::JSONB -> 'changed' @> '["statementRu","statementKy","statementEn","verified"]'::JSONB,
  'edit: the old row is retired, the new row supersedes it, one active row per topic and audience');
SELECT pg_temp.a381_assert(
  pg_temp.a381_err(pg_temp.a381_save(1, :'a381_fact_new', '{"markVerified":true}', pg_temp.a381_id(7127))) = '40001'
  AND pg_temp.a381_msg(pg_temp.a381_save(1, :'a381_fact_new', '{"markVerified":true}', pg_temp.a381_id(7128))) = 'company_fact_stale',
  'saving the retired version again is stale (40001)');
-- A date-only edit keeps the old verification; a no-op writes nothing; «Проверено» alone makes a version.
UPDATE platform_private.company_facts SET verified_at = DATE '2026-11-01' WHERE id = :'a381_fact_v2';
SELECT pg_temp.a381_save(1, :'a381_fact_v2', '{"validUntil":"2098-02-28"}', pg_temp.a381_id(7129)) AS a381_date_edit \gset
SELECT (:'a381_date_edit'::JSONB ->> 'factId') AS a381_fact_v3 \gset
SELECT pg_temp.a381_assert(
  :'a381_fact_v3' <> :'a381_fact_v2'
  AND (SELECT verified_at = DATE '2026-11-01' AND valid_until = DATE '2098-02-28' AND supersedes_id = :'a381_fact_v2'::UUID
         AND verified_by_membership_id = pg_temp.a381_id(304) AND status = 'active'
      FROM platform_private.company_facts WHERE id = :'a381_fact_v3')
  AND :'a381_date_edit'::JSONB -> 'changed' = '["validUntil"]'::JSONB,
  'a date-only edit keeps the previous verification date and verifier');
SELECT pg_temp.a381_assert(
  pg_temp.a381_save(1, :'a381_fact_v3', '{"validUntil":"2098-02-28"}', pg_temp.a381_id(7130)) ->> 'status' = 'unchanged'
  AND pg_temp.a381_save(1, :'a381_fact_v3', '{"validUntil":"2098-02-28"}', pg_temp.a381_id(7130)) ->> 'factId' = :'a381_fact_v3'
  AND (SELECT status = 'active' FROM platform_private.company_facts WHERE id = :'a381_fact_v3')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.a381_id(7130)),
  'an edit that changes nothing writes no row and no journal entry');
SELECT pg_temp.a381_save(1, :'a381_fact_v3', '{"markVerified":true}', pg_temp.a381_id(7131)) AS a381_verify_only \gset
SELECT (:'a381_verify_only'::JSONB ->> 'factId') AS a381_fact_v4 \gset
SELECT pg_temp.a381_assert(
  (SELECT verified_at = platform_private.company_facts_today() AND verified_by_membership_id = pg_temp.a381_id(301) AND supersedes_id = :'a381_fact_v3'::UUID
      AND statement_ru = 'Новый текст' AND status = 'active'
   FROM platform_private.company_facts WHERE id = :'a381_fact_v4')
  AND (SELECT status = 'retired' FROM platform_private.company_facts WHERE id = :'a381_fact_v3')
  AND :'a381_verify_only'::JSONB -> 'changed' = '["verified"]'::JSONB,
  '«Проверено» alone makes a new version dated today, by the Admin');
SELECT pg_temp.a381_assert(
  pg_temp.a381_msg(pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2020-01-01"}', pg_temp.a381_id(7132))) = 'company_fact_invalid_dates'
  AND pg_temp.a381_msg(pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2026-01-01","markVerified":true}', pg_temp.a381_id(7133))) = 'company_fact_invalid_dates'
  AND (SELECT status = 'active' FROM platform_private.company_facts WHERE id = :'a381_fact_v4'),
  'a valid-until before the verification date is refused and changes nothing');
-- Replay by request id.
SELECT count(*) AS a381_rows_before FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) \gset
SELECT pg_temp.a381_assert(
  pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2098-03-31"}', pg_temp.a381_id(7134)) ->> 'status' = 'saved'
  AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_rows_before + 1
  AND pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2098-03-31"}', pg_temp.a381_id(7134)) ->> 'status' = 'saved'
  AND (SELECT count(*) FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1)) = :a381_rows_before + 1
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.a381_id(7134))
  AND pg_temp.a381_err(pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2098-04-30"}', pg_temp.a381_id(7134))) = '40001'
  AND pg_temp.a381_msg(pg_temp.a381_save(1, :'a381_fact_v4', '{"validUntil":"2098-04-30"}', pg_temp.a381_id(7134))) = 'company_fact_request_conflict'
  AND pg_temp.a381_err(pg_temp.a381_save(3, :'a381_fact_v4', '{"validUntil":"2098-03-31"}', pg_temp.a381_id(7134))) = '42501',
  'the same request id replays the first result without a second row; another patch under it conflicts');

-- ---------------------------------------------------------------------------
-- 5. Retire and list.
-- ---------------------------------------------------------------------------
SELECT id AS a381_fact_live FROM platform_private.company_facts
  WHERE organization_id = pg_temp.a381_id(1) AND topic = 'promise.test' AND status = 'active' \gset
SELECT pg_temp.a381_assert(
  pg_temp.a381_retire(4, :'a381_fact_live', pg_temp.a381_id(7140)) = jsonb_build_object('factId', :'a381_fact_live'::UUID, 'status', 'retired')
  AND (SELECT status = 'retired' FROM platform_private.company_facts WHERE id = :'a381_fact_live')
  AND pg_temp.a381_retire(4, :'a381_fact_live', pg_temp.a381_id(7140)) ->> 'status' = 'retired'
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.a381_id(7140))
  AND pg_temp.a381_msg(pg_temp.a381_retire(4, :'a381_fact_live', pg_temp.a381_id(7141))) = 'company_fact_stale'
  AND pg_temp.a381_err(pg_temp.a381_retire(4, pg_temp.a381_id(9998), pg_temp.a381_id(7142))) = 'P0002'
  AND pg_temp.a381_msg(pg_temp.a381_save(4, :'a381_fact_live', '{"markVerified":true}', pg_temp.a381_id(7143))) = 'company_fact_stale',
  'retire: the fact is retired once, replay is quiet, a second retire and a save are stale, an unknown fact is not found');
SELECT pg_temp.a381_assert(
  (SELECT count(*) = 0 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''promise.test''') -> 'facts'))
  AND (SELECT count(*) = 5 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''promise.test'', ''retired''') -> 'facts'))
  AND (SELECT count(*) = 5 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''promise.test'', ''all''') -> 'facts'))
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''promise.test'', ''retired'', NULL, 1') -> 'facts'))
  AND (pg_temp.a381_list(3, 1, '''promise.test'', ''retired'', NULL, 1') ->> 'truncated')::BOOLEAN
  AND NOT (pg_temp.a381_list(3, 1, '''promise.test'', ''retired''') ->> 'truncated')::BOOLEAN
  AND (SELECT count(*) = 2 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''course.'', ''active'', ''client''') -> 'facts') f
        WHERE f ->> 'topic' IN ('course.sat.group', 'course.ielts.group'))
  AND (SELECT bool_and(f ->> 'audience' = 'internal') FROM jsonb_array_elements(pg_temp.a381_list(3, 1, 'NULL, ''active'', ''internal''') -> 'facts') f)
  AND pg_temp.a381_err(pg_temp.a381_list(3, 1, 'NULL, ''bogus''')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_list(3, 1, 'NULL, ''active'', ''everyone''')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_list(3, 1, '''BAD PREFIX''')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_list(3, 1, 'NULL, ''active'', NULL, 0')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_list(3, 1, 'NULL, ''active'', NULL, 501')) = '22023',
  'list: the five versions are history, filters by prefix, audience, status and limit, invalid filters refused');
SELECT pg_temp.a381_assert(
  (SELECT f ->> 'supersedesId' IS NOT NULL AND f ->> 'verifiedByName' IS NOT NULL
   FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''promise.test'', ''retired''') -> 'facts') f
   WHERE f ->> 'id' = :'a381_fact_v4'),
  'the list names the previous version and the verifier');
-- Validity marks and counts (rows written directly with controlled dates).
SELECT platform_private.company_facts_today() AS a381_today \gset
INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, verified_at, valid_until, status) VALUES
  (pg_temp.a381_id(1), 'mark.expired', 'Просрочено', 'client', 'owner', :'a381_today'::DATE - 20, :'a381_today'::DATE - 1, 'active'),
  (pg_temp.a381_id(1), 'mark.today', 'Последний день', 'client', 'owner', :'a381_today'::DATE - 20, :'a381_today'::DATE, 'active'),
  (pg_temp.a381_id(1), 'mark.soon', 'Скоро', 'client', 'owner', :'a381_today'::DATE - 20, :'a381_today'::DATE + 30, 'active'),
  (pg_temp.a381_id(1), 'mark.later', 'Позже', 'client', 'owner', :'a381_today'::DATE - 20, :'a381_today'::DATE + 31, 'active'),
  (pg_temp.a381_id(1), 'mark.open', 'Без срока', 'client', 'owner', :'a381_today'::DATE - 20, NULL, 'active'),
  (pg_temp.a381_id(1), 'mark.draft', 'Черновик', 'client', 'owner', :'a381_today'::DATE - 20, NULL, 'draft'),
  (pg_temp.a381_id(1), 'mark.retired', 'Снято', 'client', 'owner', :'a381_today'::DATE - 20, NULL, 'retired'),
  (pg_temp.a381_id(1), 'mark.internal', 'Только для своих', 'internal', 'owner', :'a381_today'::DATE - 20, NULL, 'active'),
  (pg_temp.a381_id(2), 'mark.other', 'Чужая организация', 'client', 'owner', :'a381_today'::DATE - 20, NULL, 'active');
SELECT count(*) FILTER (WHERE valid_until < :'a381_today'::DATE) AS a381_expired_all,
  count(*) FILTER (WHERE valid_until >= :'a381_today'::DATE AND valid_until <= :'a381_today'::DATE + 30) AS a381_expiring_all
  FROM platform_private.company_facts WHERE organization_id = pg_temp.a381_id(1) AND status = 'active' \gset
SELECT pg_temp.a381_assert(
  (SELECT string_agg(f ->> 'validity', ',' ORDER BY f ->> 'topic') = 'expired,unlimited,ok,unlimited,expiring,expiring'
   FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''mark.''') -> 'facts') f)
  AND (SELECT (f ->> 'daysLeft')::INTEGER = -1 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''mark.expired''') -> 'facts') f)
  AND (SELECT (f ->> 'daysLeft')::INTEGER = 0 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''mark.today''') -> 'facts') f)
  AND (SELECT f ->> 'daysLeft' IS NULL FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''mark.open''') -> 'facts') f)
  AND (pg_temp.a381_list(3, 1) -> 'counts' ->> 'expired')::INTEGER = :a381_expired_all AND :a381_expired_all >= 1
  AND (pg_temp.a381_list(3, 1) -> 'counts' ->> 'expiring')::INTEGER = :a381_expiring_all AND :a381_expiring_all >= 2
  AND (pg_temp.a381_list(3, 1) -> 'counts' ->> 'active')::INTEGER = (SELECT count(*) FROM platform_private.company_facts
      WHERE organization_id = pg_temp.a381_id(1) AND status = 'active')
  AND (pg_temp.a381_list(3, 1) ->> 'today') = :'a381_today',
  'validity marks: expired yesterday, last day and +30 expiring, +31 ok, no limit; counts and today are reported');

-- ---------------------------------------------------------------------------
-- 6. The tool.
-- ---------------------------------------------------------------------------
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a381_id(1));
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a381_id(2));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id IN (pg_temp.a381_id(1), pg_temp.a381_id(2)) AND key IN ('sales', 'curator-cn');
SELECT pg_temp.a381_assert(
  pg_temp.a381_msg(pg_temp.a381_tool('curator-my')) = 'agent_disabled' AND pg_temp.a381_err(pg_temp.a381_tool('curator-my')) = '55000'
  AND pg_temp.a381_err(pg_temp.a381_tool('no-such-agent')) = 'P0002'
  AND pg_temp.a381_err(pg_temp.a381_tool('sales', '{"limit":51}')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_tool('sales', '{"limit":0}')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_tool('sales', '{"audience":"all"}')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_tool('sales', '{"topic_prefix":"Course!"}')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_tool('sales', '{"query":"x"}')) = '22023'
  AND pg_temp.a381_err(pg_temp.a381_staff(3, format('SELECT platform.ai_agent_tool_get_company_facts_v1(%L, %L, ''{}''::jsonb)', pg_temp.a381_id(1), 'sales'))) IS NOT NULL
  AND pg_temp.a381_err(pg_temp.a381_anon(format('SELECT platform.ai_agent_tool_get_company_facts_v1(%L, %L, ''{}''::jsonb)', pg_temp.a381_id(1), 'sales'))) IS NOT NULL,
  'tool: a disabled agent, an unknown agent, bad arguments and non-service callers are refused');
SELECT pg_temp.a381_assert(
  (SELECT string_agg(f ->> 'topic', ',' ORDER BY f ->> 'topic') = 'mark.internal,mark.later,mark.open,mark.soon,mark.today'
      FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","limit":50}') -> 'facts') f)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","audience":"both"}') -> 'facts') f
      WHERE f ->> 'topic' IN ('mark.expired', 'mark.draft', 'mark.retired', 'mark.other')),
  'tool: expired, draft, retired and other-organization facts are not returned');
SELECT least(50, count(*)) AS a381_expect50, count(*) > 50 AS a381_over50 FROM platform_private.company_facts
  WHERE organization_id = pg_temp.a381_id(1) AND status = 'active' AND (valid_until IS NULL OR valid_until >= :'a381_today'::DATE) \gset
SELECT pg_temp.a381_assert(
  (SELECT string_agg(f ->> 'topic', ',' ORDER BY f ->> 'topic') = 'mark.later,mark.open,mark.soon,mark.today'
   FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","audience":"client"}') -> 'facts') f)
  AND (SELECT string_agg(f ->> 'topic', ',') = 'mark.internal'
       FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","audience":"internal"}') -> 'facts') f)
  AND (pg_temp.a381_tool('sales', '{"topic_prefix":"mark."}') ->> 'today') = :'a381_today'
  AND jsonb_array_length(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","limit":2}') -> 'facts') = 2
  AND (pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","limit":2}') ->> 'truncated')::BOOLEAN
  AND NOT (pg_temp.a381_tool('sales', '{"topic_prefix":"mark.","limit":50}') ->> 'truncated')::BOOLEAN
  AND jsonb_array_length(pg_temp.a381_tool('sales', '{"topic_prefix":"nothing."}') -> 'facts') = 0
  AND jsonb_array_length(pg_temp.a381_tool('curator-cn', '{"limit":50}') -> 'facts') = :a381_expect50
  AND (pg_temp.a381_tool('curator-cn', '{"limit":50}') ->> 'truncated')::BOOLEAN = :'a381_over50'::BOOLEAN
  AND (SELECT string_agg(f ->> 'topic', ',') = 'mark.other'
       FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"mark.other"}', 2) -> 'facts') f),
  'tool: the last valid day counts, audience and prefix filters, limit and truncated, one organization at a time');
-- Shape: the fields an agent needs, nothing internal. The price fact is kept valid far ahead so the suite does not depend on its day.
UPDATE platform_private.company_facts SET valid_until = DATE '2099-12-31' WHERE organization_id = pg_temp.a381_id(1) AND topic = 'course.sat.group';
SELECT pg_temp.a381_assert(
  (SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(f) k) = ARRAY['audience', 'fact_id', 'source', 'statement', 'topic', 'valid_until', 'verified_at']
      AND f -> 'statement' ? 'ru' AND NOT f -> 'statement' ? 'ky' AND NOT f -> 'statement' ? 'en'
      AND f ->> 'topic' = 'course.sat.group' AND f ->> 'verified_at' = '2026-10-23' AND f ->> 'valid_until' = '2099-12-31'
      AND f ->> 'source' = 'agent_instruction' AND f ->> 'audience' = 'client' AND (f -> 'statement' ->> 'ru') LIKE '%299%'
   FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"course.sat"}') -> 'facts') f),
  'tool: the shape is fact_id, topic, statement{ru}, audience, source, verified_at, valid_until');
-- A fact with the optional languages shows them; after it expires the tool stops returning it, with no other change.
INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, statement_ky, statement_en, audience, source, verified_at, valid_until, status)
VALUES (pg_temp.a381_id(1), 'lang.test', 'Русский', 'Кыргызча', 'English', 'client', 'owner', :'a381_today'::DATE - 5, :'a381_today'::DATE + 1, 'active');
SELECT pg_temp.a381_assert(
  (SELECT f -> 'statement' = '{"ru":"Русский","ky":"Кыргызча","en":"English"}'::JSONB
   FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"lang."}') -> 'facts') f),
  'tool: the optional Kyrgyz and English texts are returned when present');
UPDATE platform_private.company_facts SET valid_until = :'a381_today'::DATE - 1, verified_at = :'a381_today'::DATE - 6 WHERE topic = 'lang.test';
SELECT pg_temp.a381_assert(
  jsonb_array_length(pg_temp.a381_tool('sales', '{"topic_prefix":"lang."}') -> 'facts') = 0
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(pg_temp.a381_list(3, 1, '''lang.''') -> 'facts') f WHERE f ->> 'validity' = 'expired'),
  'tool: once the valid-until passes the fact is not given to agents, while the staff list still shows it as expired');
-- The staff edit of an expired fact brings it back only with a new valid-until and «Проверено».
SELECT id AS a381_fact_lang FROM platform_private.company_facts WHERE topic = 'lang.test' AND organization_id = pg_temp.a381_id(1) \gset
SELECT pg_temp.a381_save(4, :'a381_fact_lang', format('{"validUntil":"%s","markVerified":true}', (:'a381_today'::DATE + 90)::TEXT), pg_temp.a381_id(7150)) AS a381_renewed \gset
SELECT pg_temp.a381_assert(
  jsonb_array_length(pg_temp.a381_tool('sales', '{"topic_prefix":"lang."}') -> 'facts') = 1
  AND (SELECT f -> 'statement' ->> 'ky' = 'Кыргызча' FROM jsonb_array_elements(pg_temp.a381_tool('sales', '{"topic_prefix":"lang."}') -> 'facts') f),
  'renewing an expired fact (new date + «Проверено») gives it back to the agents with its other texts kept');
-- A disabled agent gets no facts even when facts exist.
UPDATE platform_private.ai_agents SET enabled = FALSE WHERE organization_id = pg_temp.a381_id(1) AND key = 'sales';
SELECT pg_temp.a381_assert(pg_temp.a381_msg(pg_temp.a381_tool('sales')) = 'agent_disabled', 'tool: switching the agent off stops the facts too');
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id = pg_temp.a381_id(1) AND key = 'sales';

-- ---------------------------------------------------------------------------
-- 7. Journal rows.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert(
  (SELECT count(*) = 7 FROM platform.audit_events WHERE organization_id = pg_temp.a381_id(1) AND action = 'ai.fact.change')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a381_id(1) AND e.action = 'ai.fact.change'
      AND (e.resource_type <> 'ai_company_fact' OR e.actor_kind <> 'user' OR e.actor_membership_id IS NULL
        OR e.before_state::TEXT LIKE '%Новый текст%' OR e.after_state::TEXT LIKE '%Новый текст%' OR e.after_state::TEXT LIKE '%Тестовый факт%'
        OR e.after_state::TEXT LIKE '%New text%' OR e.after_state::TEXT LIKE '%Кыргызча%'))
  AND (SELECT e.actor_membership_id = pg_temp.a381_id(304) AND e.after_state ->> 'op' = 'create' AND e.after_state ->> 'topic' = 'promise.test'
        AND e.after_state -> 'changed' = '["created"]'::JSONB AND e.resource_id = (:'a381_fact_new')::UUID
      FROM platform.audit_events e WHERE e.request_id = pg_temp.a381_id(7120))
  AND (SELECT e.after_state ->> 'op' = 'retire' AND e.resource_id = :'a381_fact_live'::UUID AND e.before_state ->> 'status' = 'active'
      FROM platform.audit_events e WHERE e.request_id = pg_temp.a381_id(7140)),
  'journal: one row per change with the actor, the object type and no statement text; replays and refusals write none');

-- ---------------------------------------------------------------------------
-- The same facts are visible to the real journal reader by object type.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a381_assert(
  platform_private.p7a_changed_field_codes('ai.fact.change') = ARRAY['ai_status']::TEXT[],
  'the journal derives changed-field codes for the new action');

\echo A381_COMPANY_FACTS_SUITE_PASSED
ROLLBACK;
