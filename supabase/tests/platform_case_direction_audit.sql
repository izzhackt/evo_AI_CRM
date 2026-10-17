\set ON_ERROR_STOP on
-- Boundary suite for migration 302: the change of a case direction
-- is visible in the Admin «Журнал действий» and in the case «История».
-- The events come from the REAL 292 command (platform.set_student_case_direction_v1) run
-- by a real system Admin on cases made by 281's own command; the rows that no command can
-- produce (an unknown direction code, a malformed pair, neighbours of other actions) are
-- written as the table owner. Proves:
--  J journal: search_audit_events returns the direction event with exactly one extra key,
--    case_direction = {"from", "to"} (a change CN -> MY -> EUROPE, and the first set
--    NULL -> AE with "from" null); an event whose code is not one of the five
--    (IT, a malformed pair) carries case_direction = JSON null; no other action's row has
--    the key, even with the same before/after; the page leaks no version, no raw
--    before/after and no unknown code.
--  H history: staff_student_case_activity returns the same events as 'overview' with a
--    time and direction_change; the unknown ones carry null; no other event has the key;
--    the stream leaks no version, no raw before/after and no unknown code.
--  P posture: the helper and the wrapped/renamed functions are owner-only (no EXECUTE for
--    authenticated, anon, service_role), the allowlist gained the action once and the
--    renamed predecessor does not have it, the helper's code matrix.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.n302_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('30200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n302_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N302: %', message; END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n302_id(INTEGER), pg_temp.n302_assert(BOOLEAN, TEXT) TO authenticated;

SELECT 'N302_CASE_DIRECTION_AUDIT_SUITE_START' AS n302_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with one system Admin (as 292's suite).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n302_id(1), 'N302 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (pg_temp.n302_id(101), 'n302-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n302_id(201), pg_temp.n302_id(101), 'N302 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n302_id(301), pg_temp.n302_id(1), pg_temp.n302_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n302_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n302_id(401), pg_temp.n302_id(1), 'organization', pg_temp.n302_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n302_id(1), pg_temp.n302_id(301), pg_temp.n302_id(401), 1, 1, TRUE, 'system',
    'N302 synthetic organization scope', pg_temp.n302_id(601));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n302_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n302_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n302_admin \gset

-- Cases through the real 281 command: 1 is CN (changed CN -> MY -> EUROPE below), 2 is MY
-- (its direction is cleared, then set for the first time).
SET LOCAL request.jwt.claims TO :'n302_admin';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n302_id(1), pg_temp.n302_id(5001), jsonb_build_object(
  'student', jsonb_build_object('name', 'N302 Student One', 'phone', '+996 555 302 001'),
  'route', jsonb_build_object('country', 'CN'))) AS n302_r1 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n302_id(1), pg_temp.n302_id(5002), jsonb_build_object(
  'student', jsonb_build_object('name', 'N302 Student Two', 'phone', '+996 555 302 002'),
  'route', jsonb_build_object('country', 'MY'))) AS n302_r2 \gset
RESET ROLE;
SELECT :'n302_r1'::JSONB ->> 'student_case_id' AS n302_case1 \gset
SELECT :'n302_r2'::JSONB ->> 'student_case_id' AS n302_case2 \gset
UPDATE platform.student_cases SET admissions_direction = NULL WHERE id = :'n302_case2'::UUID;
SELECT pg_temp.n302_assert((SELECT c.admissions_direction = 'CN' AND c.admissions_version = 0
    FROM platform.student_cases c WHERE c.id = :'n302_case1'::UUID), 'fixture: case 1 reads CN, version 0');
SELECT pg_temp.n302_assert((SELECT c.admissions_direction IS NULL AND c.admissions_version = 0
    FROM platform.student_cases c WHERE c.id = :'n302_case2'::UUID), 'fixture: case 2 has no direction, version 0');

-- The real 292 command, as the Admin: CN -> MY -> EUROPE on case 1, NULL -> AE on case 2.
SET LOCAL request.jwt.claims TO :'n302_admin';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n302_id(1), :'n302_case1'::UUID, 'MY', 0, pg_temp.n302_id(7001)) AS n302_s1 \gset
SELECT platform.set_student_case_direction_v1(pg_temp.n302_id(1), :'n302_case1'::UUID, 'EUROPE', 1, pg_temp.n302_id(7002)) AS n302_s2 \gset
SELECT platform.set_student_case_direction_v1(pg_temp.n302_id(1), :'n302_case2'::UUID, 'AE', 0, pg_temp.n302_id(7003)) AS n302_s3 \gset
RESET ROLE;
SELECT pg_temp.n302_assert((SELECT count(*) = 3 FROM platform.audit_events a
    WHERE a.action = 'case.direction.set' AND a.request_id IN (pg_temp.n302_id(7001), pg_temp.n302_id(7002), pg_temp.n302_id(7003))),
  'fixture: the real command wrote three case.direction.set events');

-- Rows no command can produce, as the table owner: codes outside the five and a malformed pair on case 1,
-- and neighbours of other actions carrying the very same before/after.
INSERT INTO platform.audit_events(organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
  before_state, after_state, reason, request_id)
VALUES
  (pg_temp.n302_id(1), 'system', 'N302 synthetic actor', 'case.direction.set', 'student_case', :'n302_case1'::UUID,
    '{"admissions_direction":"EUROPE","admissions_version":"2"}'::JSONB, '{"admissions_direction":"IT","admissions_version":"3"}'::JSONB,
    'N302 after is not one of the five', pg_temp.n302_id(7004)),
  (pg_temp.n302_id(1), 'system', 'N302 synthetic actor', 'case.direction.set', 'student_case', :'n302_case1'::UUID,
    '{"admissions_direction":"CZ","admissions_version":"3"}'::JSONB, '{"admissions_direction":"CN","admissions_version":"4"}'::JSONB,
    'N302 before is not one of the five', pg_temp.n302_id(7005)),
  (pg_temp.n302_id(1), 'system', 'N302 synthetic actor', 'case.direction.set', 'student_case', :'n302_case1'::UUID,
    '{}'::JSONB, '{}'::JSONB, 'N302 neither side has a direction', pg_temp.n302_id(7006)),
  (pg_temp.n302_id(1), 'system', 'N302 synthetic actor', 'case.route.change', 'student_case', :'n302_case1'::UUID,
    '{"admissions_direction":"CN","admissions_version":"0"}'::JSONB, '{"admissions_direction":"MY","admissions_version":"1"}'::JSONB,
    'N302 neighbour of another action with the same pair', pg_temp.n302_id(7007)),
  (pg_temp.n302_id(1), 'system', 'N302 synthetic actor', 'case.curator.set', 'student_case', :'n302_case1'::UUID,
    '{"admissions_direction":"CN","admissions_version":"0"}'::JSONB, '{"admissions_direction":"MY","admissions_version":"1"}'::JSONB,
    'N302 allowlisted neighbour with the same pair', pg_temp.n302_id(7008));

-- ---------------------------------------------------------------------------
-- J. «Журнал действий»
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n302_admin';
SET LOCAL ROLE authenticated;
SELECT platform.search_audit_events(NULL, NULL, ARRAY['case.direction.set'], NULL, NULL, 100) AS n302_page \gset
SELECT platform.search_audit_events(NULL, NULL, NULL, NULL, :'n302_case1'::UUID, 100) AS n302_case_page \gset
RESET ROLE;

SELECT pg_temp.n302_assert(jsonb_array_length(:'n302_page'::JSONB -> 'rows') = 6
    AND (SELECT bool_and(r ->> 'action' = 'case.direction.set') FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r),
  'J: the journal returns the six direction events (three real, three hand-written) and nothing else');
SELECT pg_temp.n302_assert((SELECT bool_and(
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
        = ARRAY['action', 'actor_display_label', 'actor_kind', 'audit_event_id', 'case_direction', 'changed_field_codes',
          'created_at', 'reason_code', 'request_id', 'resource_id', 'resource_type'])
    FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r),
  'J: a direction row has the ten safe keys and exactly one more, case_direction');
SELECT pg_temp.n302_assert(
  (SELECT r -> 'case_direction' FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r
     WHERE r ->> 'request_id' = pg_temp.n302_id(7001)::TEXT) = '{"from":"CN","to":"MY"}'::JSONB
  AND (SELECT r -> 'case_direction' FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r
     WHERE r ->> 'request_id' = pg_temp.n302_id(7002)::TEXT) = '{"from":"MY","to":"EUROPE"}'::JSONB
  AND (SELECT r -> 'case_direction' FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r
     WHERE r ->> 'request_id' = pg_temp.n302_id(7003)::TEXT) = '{"from":null,"to":"AE"}'::JSONB,
  'J: CN -> MY, MY -> EUROPE, and the first set (from null) -> AE come from the real command''s before/after');
SELECT pg_temp.n302_assert(
  (SELECT bool_and(r -> 'case_direction' = 'null'::JSONB) FROM jsonb_array_elements(:'n302_page'::JSONB -> 'rows') r
     WHERE r ->> 'request_id' IN (pg_temp.n302_id(7004)::TEXT, pg_temp.n302_id(7005)::TEXT, pg_temp.n302_id(7006)::TEXT)),
  'J: a code outside the five (IT, CZ) or a pair without a direction gives case_direction = null');
SELECT pg_temp.n302_assert(
  (SELECT count(*) >= 2 FROM jsonb_array_elements(:'n302_case_page'::JSONB -> 'rows') r
     WHERE r ->> 'action' IN ('case.route.change', 'case.curator.set'))
  AND (SELECT bool_and(NOT (r ? 'case_direction')) FROM jsonb_array_elements(:'n302_case_page'::JSONB -> 'rows') r
     WHERE r ->> 'action' <> 'case.direction.set'),
  'J: the neighbours of other actions (same before/after) are in the journal and have no case_direction key');
SELECT pg_temp.n302_assert(
  :'n302_page' !~ 'admissions_version|before_state|after_state|"IT"|"CZ"'
  AND :'n302_case_page' !~ 'admissions_version|before_state|after_state|"IT"|"CZ"',
  'J: the journal pages carry no version, no raw before/after and no unknown code');

-- ---------------------------------------------------------------------------
-- H. «История» дела
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n302_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_student_case_activity(:'n302_case1'::UUID, 50, NULL, NULL) AS n302_act1 \gset
SELECT platform.staff_student_case_activity(:'n302_case2'::UUID, 50, NULL, NULL) AS n302_act2 \gset
RESET ROLE;

SELECT pg_temp.n302_assert(
  (SELECT count(*) = 5 FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e WHERE e ->> 'action' = 'case.direction.set')
  AND (SELECT bool_and(e ->> 'target_kind' = 'overview' AND e ->> 'occurred_at' IS NOT NULL AND e ? 'direction_change')
      FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e WHERE e ->> 'action' = 'case.direction.set'),
  'H: case 1 history has its five direction events (two real, three hand-written) as overview events with a time and direction_change');
SELECT pg_temp.n302_assert(
  (SELECT e -> 'direction_change' FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e
     WHERE (e ->> 'id')::UUID = (SELECT a.id FROM platform.audit_events a WHERE a.request_id = pg_temp.n302_id(7001)))
    = '{"from":"CN","to":"MY"}'::JSONB
  AND (SELECT e -> 'direction_change' FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e
     WHERE (e ->> 'id')::UUID = (SELECT a.id FROM platform.audit_events a WHERE a.request_id = pg_temp.n302_id(7002)))
    = '{"from":"MY","to":"EUROPE"}'::JSONB
  AND (SELECT e -> 'direction_change' FROM jsonb_array_elements(:'n302_act2'::JSONB -> 'events') e
     WHERE (e ->> 'id')::UUID = (SELECT a.id FROM platform.audit_events a WHERE a.request_id = pg_temp.n302_id(7003)))
    = '{"from":null,"to":"AE"}'::JSONB,
  'H: the history shows CN -> MY, MY -> EUROPE on case 1 and the first set AE (from null) on case 2');
SELECT pg_temp.n302_assert(
  (SELECT bool_and(e -> 'direction_change' = 'null'::JSONB) FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e
     WHERE (e ->> 'id')::UUID IN (SELECT a.id FROM platform.audit_events a
       WHERE a.request_id IN (pg_temp.n302_id(7004), pg_temp.n302_id(7005), pg_temp.n302_id(7006)))),
  'H: a code outside the five or a pair without a direction gives direction_change = null');
SELECT pg_temp.n302_assert(
  (SELECT count(*) >= 1 FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e WHERE e ->> 'action' = 'case.route.change')
  AND (SELECT bool_and(NOT (e ? 'direction_change')) FROM jsonb_array_elements(:'n302_act1'::JSONB -> 'events') e
     WHERE e ->> 'action' <> 'case.direction.set'),
  'H: the other events of the stream are unchanged: no direction_change key');
SELECT pg_temp.n302_assert(
  :'n302_act1' !~ 'admissions_version|before_state|after_state|"IT"|"CZ"'
  AND :'n302_act2' !~ 'admissions_version|before_state|after_state|"IT"|"CZ"',
  'H: the history carries no version, no raw before/after and no unknown code');

-- ---------------------------------------------------------------------------
-- P. Posture and the helper's code matrix.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n302_assert(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'platform_private.case_direction_change(jsonb,jsonb)',
      'platform_private.p7a_safe_audit_row(platform.audit_events)',
      'platform_private.p7a_safe_audit_row_pre_case_direction_audit(platform.audit_events)',
      'platform_private.p7a_safe_audit_actions()',
      'platform_private.p7a_safe_audit_actions_pre_case_direction_audit()'
    ]) AS fn(signature), unnest(ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) AS grantee(role_name)
    WHERE has_function_privilege(grantee.role_name, to_regprocedure(fn.signature), 'EXECUTE')),
  'P: the helper, the wrapped row function, the allowlist and their predecessors have no EXECUTE for API roles');
SELECT pg_temp.n302_assert(
  'case.direction.set' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT 'case.direction.set' = ANY (platform_private.p7a_safe_audit_actions_pre_case_direction_audit())
  AND (SELECT count(*) = 1 FROM unnest(platform_private.p7a_safe_audit_actions()) a WHERE a = 'case.direction.set')
  AND platform_private.p7a_changed_field_codes('case.direction.set') = ARRAY['record_status']::TEXT[],
  'P: the allowlist gained the action once and its predecessor does not have it; the field codes keep the default branch');
SELECT pg_temp.n302_assert(
  platform_private.case_direction_change('{"admissions_direction":"TR"}'::JSONB, '{"admissions_direction":"EUROPE"}'::JSONB)
    = '{"from":"TR","to":"EUROPE"}'::JSONB
  AND platform_private.case_direction_change('{"admissions_direction":null}'::JSONB, '{"admissions_direction":"CN"}'::JSONB)
    = '{"from":null,"to":"CN"}'::JSONB
  AND platform_private.case_direction_change(NULL, '{"admissions_direction":"MY"}'::JSONB) = '{"from":null,"to":"MY"}'::JSONB
  AND platform_private.case_direction_change('{"admissions_direction":"CN"}'::JSONB, '{"admissions_direction":"IT"}'::JSONB) IS NULL
  AND platform_private.case_direction_change('{"admissions_direction":"cn"}'::JSONB, '{"admissions_direction":"MY"}'::JSONB) IS NULL
  AND platform_private.case_direction_change('{"admissions_direction":"CN"}'::JSONB, '{"admissions_direction":"CN"}'::JSONB) IS NULL
  AND platform_private.case_direction_change('[]'::JSONB, '"MY"'::JSONB) IS NULL
  AND platform_private.case_direction_change(NULL, NULL) IS NULL,
  'P: the helper passes only the five codes, keeps the first set, and returns NULL for anything else');

SELECT 'N302_CASE_DIRECTION_AUDIT_SUITE_PASSED' AS n302_suite_marker;
ROLLBACK;
