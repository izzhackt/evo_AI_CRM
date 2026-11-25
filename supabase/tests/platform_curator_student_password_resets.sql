\set ON_ERROR_STOP on
-- Boundary suite for migration 374 «Пароль студента сбрасывает и его куратор». Runs on the real chain right after 374
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the assigned curator of a case gets a reset permission for the student bound to it; a curator who only reads the
--     case, another curator, a curator of the case without full access to it, a seller, anon and the service get none
--     and nothing is stored; the curator's own case without a cabinet is refused as before; the System Admin keeps the
--     344 permission;
--  2. the server completes the curator's and the Admin's resets: one journal row each in their names, «сотрудником»;
--     a replay writes nothing;
--  3. a curator reassigned, or with another access version, between permission and completion is refused and nothing
--     is written; the reassigned curator's replay is refused; the new curator gets the permission;
--  4. the card still reads the cabinet and the login for the curator of the case only (363 is unchanged);
--  5. an Admin who stops being one between permission and completion is refused and nothing is written;
--  6. catalog: the patched bodies use the new rule and the new journal reason, SECURITY DEFINER with an empty search_path,
--     the new helpers closed to every API role, 344 grants unchanged.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a374_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a374_auth_role$;

\echo A374_CURATOR_STUDENT_PASSWORD_RESETS_SUITE_START

CREATE FUNCTION pg_temp.a374_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a374_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A374: %', message; END IF;
END
$$;
-- A signed-in account (claims from the real token hook): {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a374_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a374_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a374_id(p_who), 'role', 'authenticated',
        'email', 'a374-' || p_who || '@example.invalid'))) -> 'claims')::TEXT, TRUE);
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
-- A bare role (service_role, anon).
CREATE FUNCTION pg_temp.a374_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role)::TEXT, TRUE);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
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
CREATE FUNCTION pg_temp.a374_authorize_sql(p_request INTEGER, p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a374_id(1), pg_temp.a374_id(p_request), pg_temp.a374_id(p_case))
$$;
CREATE FUNCTION pg_temp.a374_reset(p_who INTEGER, p_request INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a374_call(p_who, pg_temp.a374_authorize_sql(p_request, p_case))
$$;
CREATE FUNCTION pg_temp.a374_complete(p_reset TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a374_as('service_role', format('platform.complete_student_password_reset_v1(%L::UUID)', p_reset))
$$;
CREATE FUNCTION pg_temp.a374_cabinet(p_who INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a374_call(p_who, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
    pg_temp.a374_id(1), pg_temp.a374_id(p_case)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a374_id(INTEGER) TO authenticated, anon, service_role;

-- Fixture, members modelled like production (as in the 363 suite): 101 the System Admin (coarse admin, organization
-- scope); 102 and 103 curators without a coarse role, with the production «Admissions» role on their own cases; 102 also
-- reads the whole admissions department («Case reader»); 104 a seller. 111..114 the Auth users of four students.
-- Cases: 401 curated by 102; 402 curated by 103 (102 reads it); 403 curated by 102, reassigned to 103 in section 3;
-- 405 curated by the seller 104, who has no full access to cases — each gets its cabinet through 343 from the Admin;
-- 404 curated by 102 without a cabinet. All five are active.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a374_id(1), 'A374 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a374_id(100 + n), 'a374-' || (100 + n) || '@example.invalid', '{}'::JSONB
  FROM unnest(ARRAY[1, 2, 3, 4, 11, 12, 13, 14]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a374_id(200 + n), pg_temp.a374_id(100 + n), 'A374 Person ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a374_id(300 + n), pg_temp.a374_id(1), pg_temp.a374_id(200 + n), 'active',
    CASE WHEN n = 1 THEN 'admin'::platform.business_role END,
    CASE WHEN n = 1 THEN (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published'
      ORDER BY version DESC LIMIT 1) END,
    n = 1
  FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a374_id(501), pg_temp.a374_id(1), 'organization', pg_temp.a374_id(1), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a374_id(1000 + n), pg_temp.a374_id(1), 'student_case', pg_temp.a374_id(n), 1
  FROM unnest(ARRAY[401, 402, 403, 404, 405]) AS n;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a374_id(1), pg_temp.a374_id(301), pg_temp.a374_id(501), 1, 1, TRUE, 'system',
    'A374 synthetic organization scope', pg_temp.a374_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.a374_id(901), pg_temp.a374_id(1), 'A374 Sales'),
  (pg_temp.a374_id(902), pg_temp.a374_id(1), 'A374 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.a374_id(1), pg_temp.a374_id(302), pg_temp.a374_id(902)),
  (pg_temp.a374_id(1), pg_temp.a374_id(303), pg_temp.a374_id(902)),
  (pg_temp.a374_id(1), pg_temp.a374_id(304), pg_temp.a374_id(901));
-- Cases normally come from the sale handoff; here only the insert-time transition trigger is bypassed, every table
-- constraint still holds.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, student_display_name, target_country, target_degree, program_direction,
  state, handoff_at, current_scope_id, current_scope_version)
SELECT pg_temp.a374_id(c.n), pg_temp.a374_id(1), NULL, pg_temp.a374_id(304), pg_temp.a374_id(c.curator),
  'synthetic:a374:' || c.n, 'A374 Student ' || c.n, 'Malaysia', 'Bachelor', 'Engineering', 'active',
  statement_timestamp(), pg_temp.a374_id(1000 + c.n), 1
FROM (VALUES (401, 302), (402, 303), (403, 302), (404, 302), (405, 304)) AS c(n, curator);
SET LOCAL session_replication_role = origin;

-- Roles with the production permission keys of the curator (the same lists as the 363 suite).
CREATE TEMP TABLE a374_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a374_roles VALUES
 (pg_temp.a374_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.a374_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.a374_id(1106), 'Case reader', '["case.read.full","profile.read.full"]', 1160);
CREATE TEMP TABLE a374_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO a374_grants VALUES
 (302, pg_temp.a374_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (302, pg_temp.a374_id(1106), jsonb_build_object('kind', 'department', 'key', pg_temp.a374_id(902), 'resourceKind', NULL)),
 (303, pg_temp.a374_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.a374_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.a374_id(901), 'resourceKind', NULL));
CREATE TEMP TABLE a374_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.a374_id(1);
GRANT SELECT ON a374_roles, a374_grants, a374_versions TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a374_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a374_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a374_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a374_admin_setup';
SET LOCAL ROLE authenticated;
DO $a374_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM a374_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a374_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A374 ' || r.label, 'description', 'Curator password reset synthetic role',
        'permissionKeys', r.keys), 'A374 create role', pg_temp.a374_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a374_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a374_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'A374 publish role', pg_temp.a374_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a374_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM a374_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a374_id(1), pg_temp.a374_id(m),
      (SELECT access_version FROM a374_versions WHERE membership_id = pg_temp.a374_id(m)), items, bindings,
      'A374 grant roles', pg_temp.a374_id(2000 + m));
  END LOOP;
END
$a374_roles$;
RESET ROLE;
SET LOCAL request.jwt.claims TO '';

SELECT pg_temp.a374_assert(platform_private.staff_can_access(pg_temp.a374_id(1), pg_temp.a374_id(302), 'case.read.full',
    'student_case', pg_temp.a374_id(401))
  AND platform_private.staff_can_access(pg_temp.a374_id(1), pg_temp.a374_id(302), 'case.read.full',
    'student_case', pg_temp.a374_id(402))
  AND NOT platform_private.staff_can_access(pg_temp.a374_id(1), pg_temp.a374_id(303), 'case.read.full',
    'student_case', pg_temp.a374_id(401)),
  'fixture: curator 102 reads his case 401 and case 402 he does not curate; curator 103 does not read 401');

-- Cases 401..403 and 405 get their cabinets through 343 from the Admin, one statement each.
SELECT pg_temp.a374_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
  pg_temp.a374_id(1), pg_temp.a374_id(801), pg_temp.a374_id(401))) #>> '{ok,provisioning_id}' AS a374_open_401 \gset
SELECT pg_temp.a374_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
  :'a374_open_401', pg_temp.a374_id(111), 'nurai.asanova')) AS a374_cabinet_401 \gset
SELECT pg_temp.a374_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
  pg_temp.a374_id(1), pg_temp.a374_id(802), pg_temp.a374_id(402))) #>> '{ok,provisioning_id}' AS a374_open_402 \gset
SELECT pg_temp.a374_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
  :'a374_open_402', pg_temp.a374_id(112), 'temir.bekov')) AS a374_cabinet_402 \gset
SELECT pg_temp.a374_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
  pg_temp.a374_id(1), pg_temp.a374_id(803), pg_temp.a374_id(403))) #>> '{ok,provisioning_id}' AS a374_open_403 \gset
SELECT pg_temp.a374_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
  :'a374_open_403', pg_temp.a374_id(113), 'aliya.sydykova')) AS a374_cabinet_403 \gset
SELECT pg_temp.a374_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
  pg_temp.a374_id(1), pg_temp.a374_id(804), pg_temp.a374_id(405))) #>> '{ok,provisioning_id}' AS a374_open_405 \gset
SELECT pg_temp.a374_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
  :'a374_open_405', pg_temp.a374_id(114), 'bermet.alieva')) AS a374_cabinet_405 \gset
SELECT pg_temp.a374_assert(:'a374_cabinet_401'::JSONB #>> '{ok,login}' = 'nurai.asanova'
    AND :'a374_cabinet_402'::JSONB #>> '{ok,login}' = 'temir.bekov'
    AND :'a374_cabinet_403'::JSONB #>> '{ok,login}' = 'aliya.sydykova'
    AND :'a374_cabinet_405'::JSONB #>> '{ok,login}' = 'bermet.alieva'
    AND (SELECT count(*) = 4 FROM platform.student_cases c
      WHERE c.organization_id = pg_temp.a374_id(1) AND c.student_membership_id IS NOT NULL AND c.portal_activated_at IS NOT NULL)
    AND NOT platform_private.staff_can_access(pg_temp.a374_id(1), pg_temp.a374_id(304), 'case.read.full',
      'student_case', pg_temp.a374_id(405)),
  'fixture: cases 401..403 and 405 have their cabinets, 404 has none; the seller curating 405 has no full access to it');

-- ---------------------------------------------------------------------------
-- 1. Permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_reset(102, 951, 401) AS a374_first \gset
SELECT pg_temp.a374_assert(:'a374_first'::JSONB #>> '{ok,state}' = 'authorized'
    AND :'a374_first'::JSONB #>> '{ok,auth_user_id}' = pg_temp.a374_id(111)::TEXT
    AND (SELECT count(*) = 1 AND bool_and(r.requested_by_membership_id = pg_temp.a374_id(302)
        AND r.requested_by_profile_id = pg_temp.a374_id(202)
        AND r.requested_by_auth_user_id = pg_temp.a374_id(102)
        AND r.requested_by_access_version = (SELECT access_version FROM platform.profiles WHERE id = pg_temp.a374_id(202))
        AND r.student_case_id = pg_temp.a374_id(401) AND r.auth_user_id = pg_temp.a374_id(111))
      FROM platform_private.student_password_resets r WHERE r.organization_id = pg_temp.a374_id(1)),
  'the curator of case 401 gets one reset permission for its student: ' || :'a374_first');
SELECT pg_temp.a374_assert(pg_temp.a374_reset(102, 951, 401) #>> '{ok,reset_id}' = :'a374_first'::JSONB #>> '{ok,reset_id}'
    AND pg_temp.a374_reset(103, 951, 401) ->> 'error' = '42501',
  'a replay returns the same permission; another curator cannot take the request (the rule refuses before the replay)');
SELECT pg_temp.a374_assert(pg_temp.a374_reset(102, 952, 402) ->> 'error' = '42501'
    AND pg_temp.a374_reset(103, 952, 401) ->> 'error' = '42501'
    AND pg_temp.a374_reset(104, 952, 401) ->> 'error' = '42501'
    AND pg_temp.a374_reset(104, 952, 405) ->> 'error' = '42501'
    AND pg_temp.a374_as('anon', pg_temp.a374_authorize_sql(952, 401)) ->> 'error' = '42501'
    AND pg_temp.a374_as('service_role', pg_temp.a374_authorize_sql(952, 401)) ->> 'error' = '42501',
  'a case the curator only reads, another curator, a seller, the seller curating 405 without full access, anon and the service get no permission');
SELECT pg_temp.a374_assert(NOT EXISTS (SELECT 1 FROM platform_private.student_password_resets r
    WHERE r.request_id = pg_temp.a374_id(952)),
  'a refused request stores nothing');
SELECT pg_temp.a374_reset(102, 953, 404) AS a374_no_cabinet \gset
SELECT pg_temp.a374_assert(:'a374_no_cabinet'::JSONB ->> 'error' = 'PT409'
    AND :'a374_no_cabinet'::JSONB ->> 'message' = 'student_case_no_cabinet',
  'the curator''s own case without a cabinet is refused as before: ' || :'a374_no_cabinet');
SELECT pg_temp.a374_reset(101, 954, 402) AS a374_admin \gset
SELECT pg_temp.a374_assert(:'a374_admin'::JSONB #>> '{ok,state}' = 'authorized'
    AND :'a374_admin'::JSONB #>> '{ok,auth_user_id}' = pg_temp.a374_id(112)::TEXT,
  'the System Admin keeps the 344 permission, also for a case he does not curate: ' || :'a374_admin');

-- ---------------------------------------------------------------------------
-- 2. The server completes the curator's and the Admin's resets.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_complete(:'a374_first'::JSONB #>> '{ok,reset_id}') AS a374_done \gset
SELECT pg_temp.a374_complete(:'a374_first'::JSONB #>> '{ok,reset_id}') AS a374_again \gset
SELECT pg_temp.a374_complete(:'a374_admin'::JSONB #>> '{ok,reset_id}') AS a374_admin_done \gset
SELECT pg_temp.a374_assert(:'a374_done'::JSONB #>> '{ok,state}' = 'completed'
    AND :'a374_again'::JSONB #>> '{ok,state}' = 'completed'
    AND :'a374_admin_done'::JSONB #>> '{ok,state}' = 'completed'
    AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'student_case' AND e.resource_id = pg_temp.a374_id(401)
        AND e.actor_profile_id = pg_temp.a374_id(202) AND e.reason = 'Пароль студента сброшен сотрудником'
        AND e.after_state = jsonb_build_object('auth_user_id', pg_temp.a374_id(111)))
      FROM platform.audit_events e WHERE e.organization_id = pg_temp.a374_id(1) AND e.action = 'student.password.reset'
        AND e.request_id = pg_temp.a374_id(951))
    AND (SELECT count(*) = 1 AND bool_and(e.resource_id = pg_temp.a374_id(402) AND e.actor_profile_id = pg_temp.a374_id(201)
        AND e.reason = 'Пароль студента сброшен сотрудником')
      FROM platform.audit_events e WHERE e.organization_id = pg_temp.a374_id(1) AND e.action = 'student.password.reset'
        AND e.request_id = pg_temp.a374_id(954))
    AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a374_id(1)
      AND e.action = 'student.password.reset'),
  'one journal row for each reset, in the curator''s and the Admin''s names; a replay writes nothing');

-- ---------------------------------------------------------------------------
-- 3. Between permission and completion: the curator is reassigned, or his access version changes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_reset(102, 961, 403) AS a374_moved \gset
SELECT pg_temp.a374_reset(103, 962, 402) AS a374_versioned \gset
SELECT pg_temp.a374_assert(:'a374_moved'::JSONB #>> '{ok,state}' = 'authorized'
    AND :'a374_versioned'::JSONB #>> '{ok,state}' = 'authorized',
  'fixture: permissions for case 403 (curator 102) and case 402 (curator 103)');
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET current_curator_membership_id = pg_temp.a374_id(303) WHERE id = pg_temp.a374_id(403);
SET LOCAL session_replication_role = origin;
UPDATE platform.profiles SET access_version = access_version + 1 WHERE id = pg_temp.a374_id(203);
SELECT pg_temp.a374_complete(:'a374_moved'::JSONB #>> '{ok,reset_id}') AS a374_moved_done \gset
SELECT pg_temp.a374_complete(:'a374_versioned'::JSONB #>> '{ok,reset_id}') AS a374_versioned_done \gset
SELECT pg_temp.a374_assert(:'a374_moved_done'::JSONB ->> 'error' = '42501'
    AND :'a374_versioned_done'::JSONB ->> 'error' = '42501'
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events e
      WHERE e.request_id IN (pg_temp.a374_id(961), pg_temp.a374_id(962))),
  'a reassigned curator and a curator with another access version are refused and nothing is written: '
    || :'a374_moved_done' || ' ' || :'a374_versioned_done');
SELECT pg_temp.a374_assert(pg_temp.a374_reset(102, 961, 403) ->> 'error' = '42501'
    AND pg_temp.a374_reset(103, 963, 403) #>> '{ok,state}' = 'authorized',
  'the reassigned curator''s replay is refused; the new curator gets the permission');

-- ---------------------------------------------------------------------------
-- 4. The card (363) is unchanged.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_assert(pg_temp.a374_cabinet(102, 401) #>> '{ok,state}' = 'open'
    AND pg_temp.a374_cabinet(102, 401) #>> '{ok,login}' = 'nurai.asanova'
    AND pg_temp.a374_cabinet(101, 402) #>> '{ok,login}' = 'temir.bekov'
    AND pg_temp.a374_cabinet(102, 402) ->> 'error' = '42501'
    AND pg_temp.a374_cabinet(104, 401) ->> 'error' = '42501',
  'the card shows the cabinet and the login to the curator of the case and the Admin only');

-- ---------------------------------------------------------------------------
-- 5. An Admin who stops being one between permission and completion.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_reset(101, 971, 401) AS a374_demoted \gset
SELECT pg_temp.a374_assert(:'a374_demoted'::JSONB #>> '{ok,state}' = 'authorized', 'fixture: an Admin permission for case 401');
SET LOCAL session_replication_role = replica;
UPDATE platform.organization_memberships SET is_system_admin = FALSE WHERE id = pg_temp.a374_id(301);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a374_complete(:'a374_demoted'::JSONB #>> '{ok,reset_id}') AS a374_demoted_done \gset
SELECT pg_temp.a374_assert(:'a374_demoted_done'::JSONB ->> 'error' = '42501'
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.a374_id(971)),
  'an Admin who is no longer one (and does not curate the case) is refused at completion: ' || :'a374_demoted_done');

-- ---------------------------------------------------------------------------
-- 6. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a374_assert(
    position('require_student_password_reset_actor' IN pg_get_functiondef('platform.authorize_student_password_reset_v1(uuid,uuid,uuid)'::regprocedure)) > 0
    AND position('require_admin_actor' IN pg_get_functiondef('platform.authorize_student_password_reset_v1(uuid,uuid,uuid)'::regprocedure)) = 0
    AND position('student_password_reset_allowed' IN pg_get_functiondef('platform.complete_student_password_reset_v1(uuid)'::regprocedure)) > 0
    AND position('Пароль студента сброшен сотрудником' IN pg_get_functiondef('platform.complete_student_password_reset_v1(uuid)'::regprocedure)) > 0
    AND position('администратором' IN pg_get_functiondef('platform.complete_student_password_reset_v1(uuid)'::regprocedure)) = 0,
  'the patched bodies use the new rule and the new journal reason, and no admin-only check is left');
SELECT pg_temp.a374_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p WHERE p.oid IN ('platform_private.student_password_reset_allowed(uuid,uuid,uuid)'::regprocedure,
      'platform_private.require_student_password_reset_actor(uuid,uuid)'::regprocedure,
      'platform.authorize_student_password_reset_v1(uuid,uuid,uuid)'::regprocedure,
      'platform.complete_student_password_reset_v1(uuid)'::regprocedure)),
  'all four functions are SECURITY DEFINER with an empty search_path');
SELECT pg_temp.a374_assert(NOT has_function_privilege('authenticated', 'platform_private.student_password_reset_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform_private.student_password_reset_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform_private.student_password_reset_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform_private.require_student_password_reset_actor(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform_private.require_student_password_reset_actor(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform_private.require_student_password_reset_actor(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'platform.authorize_student_password_reset_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform.authorize_student_password_reset_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.complete_student_password_reset_v1(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.complete_student_password_reset_v1(uuid)', 'EXECUTE'),
  'grants: the helpers are closed, the 344 grants are unchanged');

\echo A374_CURATOR_STUDENT_PASSWORD_RESETS_SUITE_PASSED

ROLLBACK;
