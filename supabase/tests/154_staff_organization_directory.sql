\set ON_ERROR_STOP on

-- S154: real PostgreSQL commands against isolated, owner-authorized technical
-- identities. Everything below is rolled back. No product function is mocked,
-- no Auth invitation is sent, and no global database role is created/changed.
-- Official PostgreSQL references checked 2026-09-13:
-- https://www.postgresql.org/docs/current/sql-do.html
-- https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html
-- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.s154_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('f1540000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.s154_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'S154: %', message; END IF;
END $$;
CREATE FUNCTION pg_temp.s154_error(statement TEXT, expected_state TEXT, expected_message TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_state TEXT; actual_message TEXT;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    actual_state := SQLSTATE;
    actual_message := SQLERRM;
  END;
  PERFORM pg_temp.s154_assert(actual_state = expected_state,
    format('expected SQLSTATE %s, got %s for %s', expected_state, COALESCE(actual_state, 'success'), statement));
  IF expected_message IS NOT NULL THEN
    PERFORM pg_temp.s154_assert(position(expected_message IN actual_message) > 0,
      format('expected error %s, got %s', expected_message, actual_message));
  END IF;
END $$;
CREATE FUNCTION pg_temp.s154_member(directory JSONB, n INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT item FROM jsonb_array_elements(directory -> 'members') AS item
  WHERE item ->> 'membership_id' = pg_temp.s154_id(300 + n)::TEXT
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s154_id(INTEGER), pg_temp.s154_assert(BOOLEAN, TEXT),
  pg_temp.s154_error(TEXT, TEXT, TEXT), pg_temp.s154_member(JSONB, INTEGER)
  TO authenticated, anon;

-- Self-contained, minimal fixture bundles use real permission keys and real
-- bundle publication. They do not depend on earlier suites' modified bundles
-- and also work on a schema-only copy of the actual Supabase foundation.
INSERT INTO platform.permission_definitions(permission_key, description) VALUES
  ('organization.read', 'S154 isolated organization read'),
  ('membership.read', 'S154 isolated staff directory read'),
  ('audit.read', 'S154 isolated audit read')
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO platform.role_bundle_versions(id, role, version, status, label)
SELECT pg_temp.s154_id(900 + fixture.n), fixture.role::platform.business_role,
  COALESCE((SELECT max(existing.version) FROM platform.role_bundle_versions AS existing
    WHERE existing.role = fixture.role::platform.business_role), 0) + 1,
  'draft', 'S154 isolated ' || fixture.role
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student')) AS fixture(n, role);
INSERT INTO platform.role_bundle_permissions(bundle_id, bundle_role, permission_key)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.id IN (pg_temp.s154_id(901), pg_temp.s154_id(902), pg_temp.s154_id(903), pg_temp.s154_id(904))
  AND (permission.permission_key = 'organization.read'
    OR (bundle.role = 'admin' AND permission.permission_key IN ('membership.read', 'audit.read')));
UPDATE platform.role_bundle_versions SET status = 'published', published_at = clock_timestamp()
WHERE id IN (pg_temp.s154_id(901), pg_temp.s154_id(902), pg_temp.s154_id(903), pg_temp.s154_id(904));

CREATE TEMP TABLE s154_actors(n INTEGER PRIMARY KEY, organization_id UUID, role platform.business_role, claims JSONB);
INSERT INTO s154_actors(n, organization_id, role)
SELECT n, pg_temp.s154_id(CASE WHEN n IN (6, 7) THEN 2 ELSE 1 END), role::platform.business_role
FROM (VALUES (1, 'admin'), (2, 'admin'), (3, 'sales'), (4, 'curator'), (5, 'student'),
  (6, 'admin'), (7, 'sales')) AS fixture(n, role);
INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.s154_id(1), 'S154 isolated organization A'),
  (pg_temp.s154_id(2), 'S154 isolated organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT pg_temp.s154_id(100 + n), 's154-' || n || '@example.invalid', '{}'::JSONB FROM s154_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
SELECT pg_temp.s154_id(200 + n), pg_temp.s154_id(100 + n), 'S154 actor ' || n, 'active', 1 FROM s154_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
SELECT pg_temp.s154_id(300 + n), organization_id, pg_temp.s154_id(200 + n), 'active', role,
  pg_temp.s154_id(CASE role WHEN 'admin' THEN 901 WHEN 'sales' THEN 902 WHEN 'curator' THEN 903 ELSE 904 END)
FROM s154_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key)
VALUES (pg_temp.s154_id(401), pg_temp.s154_id(1), 'organization', pg_temp.s154_id(1)),
  (pg_temp.s154_id(402), pg_temp.s154_id(2), 'organization', pg_temp.s154_id(2));
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id,
  scope_version, assignment_version, granted, actor_kind, reason, request_id)
SELECT organization_id, pg_temp.s154_id(300 + n),
  pg_temp.s154_id(CASE WHEN n IN (6, 7) THEN 402 ELSE 401 END),
  1, 1, TRUE, 'system', 'S154 isolated organization scope', pg_temp.s154_id(600 + n)
FROM s154_actors;
-- Build claims through the actual hook from the stored fixture membership.
UPDATE s154_actors SET claims = platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.s154_id(100 + n),
  'claims', jsonb_build_object('sub', pg_temp.s154_id(100 + n), 'role', 'authenticated')
)) -> 'claims';
SELECT pg_temp.s154_assert(bool_and(claims ->> 'platform_role' = role::TEXT), 'actual hook resolves all fixture roles') FROM s154_actors;
GRANT SELECT ON s154_actors TO authenticated;
CREATE TEMP TABLE s154_state(key TEXT PRIMARY KEY, value JSONB NOT NULL);
GRANT SELECT, INSERT, UPDATE ON s154_state TO authenticated;
CREATE TEMP TABLE s154_authority_before AS
SELECT actor.n, to_jsonb(profile) AS profile, to_jsonb(membership) AS membership,
  (SELECT jsonb_agg(to_jsonb(assignment) ORDER BY assignment.id)
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.membership_id = membership.id) AS scopes
FROM s154_actors AS actor
JOIN platform.profiles AS profile ON profile.id = pg_temp.s154_id(200 + actor.n)
JOIN platform.organization_memberships AS membership ON membership.id = pg_temp.s154_id(300 + actor.n);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', claims::TEXT, TRUE) FROM s154_actors WHERE n = 1 \gset

DO $positive_commands$
DECLARE directory JSONB; result JSONB; replay JSONB; member JSONB; department_a UUID; department_b UUID;
BEGIN
  directory := platform.staff_workspace_directory(pg_temp.s154_id(1));
  PERFORM pg_temp.s154_assert(jsonb_array_length(directory -> 'members') = 4,
    'directory includes existing staff without metadata and excludes Student/other organization');
  PERFORM pg_temp.s154_assert(directory -> 'departments' = '[]'::JSONB, 'departments begin empty');
  PERFORM pg_temp.s154_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(directory -> 'members') AS item
    WHERE item -> 'organizational_version' <> '0'::JSONB OR item -> 'department_id' <> 'null'::JSONB
      OR item -> 'job_title' <> 'null'::JSONB OR item -> 'direction_codes' <> '[]'::JSONB
      OR item ?| ARRAY['auth_user_id', 'profile_id', 'email']), 'real absence maps to safe version-zero metadata');

  result := platform.staff_department_command(pg_temp.s154_id(1), NULL, 'create',
    ' S154 Department A ', 'S154 internal description', 0, 'S154 create', pg_temp.s154_id(801));
  department_a := (result ->> 'department_id')::UUID;
  PERFORM pg_temp.s154_assert(result ->> 'status' = 'applied' AND result ->> 'version' = '1'
    AND department_a IS NOT NULL, 'Admin creates a real department');
  replay := platform.staff_department_command(pg_temp.s154_id(1), NULL, 'create',
    ' S154 Department A ', 'S154 internal description', 0, 'S154 create', pg_temp.s154_id(801));
  PERFORM pg_temp.s154_assert(replay = result || '{"status":"replayed"}'::JSONB, 'exact create replay returns the one original identity/version');

  result := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(303),
    department_a, ' S154 Adviser ', ARRAY['MY', 'CN'], 0, 'S154 initial assignment', pg_temp.s154_id(811));
  PERFORM pg_temp.s154_assert(result ->> 'status' = 'applied' AND result ->> 'version' = '1'
    AND result ->> 'organizational_version' = '1', 'Admin creates independent organizational version');
  replay := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(303),
    department_a, ' S154 Adviser ', ARRAY['MY', 'CN'], 0, 'S154 initial assignment', pg_temp.s154_id(811));
  PERFORM pg_temp.s154_assert(replay = result || '{"status":"replayed"}'::JSONB, 'exact metadata replay is stable');
  directory := platform.staff_workspace_directory(pg_temp.s154_id(1));
  member := pg_temp.s154_member(directory, 3);
  PERFORM pg_temp.s154_assert(member ->> 'department_id' = department_a::TEXT
    AND member ->> 'job_title' = 'S154 Adviser' AND member -> 'direction_codes' = '["CN","MY"]'::JSONB
    AND member ->> 'access_version' = '1', 'directory reads persisted normalized details without changing access version');
  PERFORM pg_temp.s154_assert(directory #>> '{departments,0,member_count}' = '1', 'department counts its real assignment');

  result := platform.staff_department_command(pg_temp.s154_id(1), department_a, 'update',
    'S154 Department A renamed', 'S154 revised description', 1, 'S154 rename', pg_temp.s154_id(802));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '2', 'department update advances only department version');
  PERFORM pg_temp.s154_assert(pg_temp.s154_member(platform.staff_workspace_directory(pg_temp.s154_id(1)), 3)
    ->> 'organizational_version' = '1', 'department version is independent of employee version');
  result := platform.staff_department_command(pg_temp.s154_id(1), department_a, 'archive', NULL, NULL,
    2, 'S154 archive', pg_temp.s154_id(803));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '3', 'archive advances department version');
  directory := platform.staff_workspace_directory(pg_temp.s154_id(1));
  PERFORM pg_temp.s154_assert(directory #>> '{departments,0,status}' = 'archived'
    AND directory #>> '{departments,0,member_count}' = '1'
    AND pg_temp.s154_member(directory, 3) ->> 'department_id' = department_a::TEXT,
    'archiving preserves existing employee links and count');
  result := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(303),
    department_a, 'S154 Lead Adviser', ARRAY['TR', 'CN'], 1, 'S154 retained archived department', pg_temp.s154_id(812));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '2', 'existing archived department can be retained during details edit');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,%L,%L,%L,0,%L,%L)',
    pg_temp.s154_id(1), pg_temp.s154_id(304), department_a, 'S154 forbidden assignment', ARRAY['CN']::TEXT[],
    'S154 forbidden archived assignment', pg_temp.s154_id(813)), '22023', 'staff_department_archived');
  PERFORM pg_temp.s154_assert(pg_temp.s154_member(platform.staff_workspace_directory(pg_temp.s154_id(1)), 4)
    ->> 'organizational_version' = '0', 'failed archived assignment leaves absent metadata absent');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,%L,''update'',%L,NULL,3,%L,%L)',
    pg_temp.s154_id(1), department_a, 'S154 forbidden archived rename', 'S154 invalid transition', pg_temp.s154_id(804)),
    '22023', 'staff_department_invalid_transition');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,%L,''archive'',NULL,NULL,3,%L,%L)',
    pg_temp.s154_id(1), department_a, 'S154 repeat archive', pg_temp.s154_id(805)),
    '22023', 'staff_department_invalid_transition');

  result := platform.staff_department_command(pg_temp.s154_id(1), department_a, 'restore', NULL, NULL,
    3, 'S154 restore', pg_temp.s154_id(806));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '4', 'Admin restores the same department');
  result := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(304),
    department_a, 'S154 Admissions Adviser', ARRAY['CN'], 0, 'S154 restored assignment', pg_temp.s154_id(814));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '1', 'restored department accepts a new assignment');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,NULL,''create'',%L,NULL,0,%L,%L)',
    pg_temp.s154_id(1), ' s154 department a renamed ', 'S154 duplicate name', pg_temp.s154_id(807)),
    '23505', 'staff_department_name_exists');

  result := platform.staff_department_command(pg_temp.s154_id(1), NULL, 'create', 'S154 Department B',
    NULL, 0, 'S154 second department', pg_temp.s154_id(808));
  department_b := (result ->> 'department_id')::UUID;
  result := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(303),
    department_b, 'S154 Final Adviser', ARRAY[]::TEXT[], 2, 'S154 move and clear directions', pg_temp.s154_id(815));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '3', 'department move and clearing directions are one atomic version');
  member := pg_temp.s154_member(platform.staff_workspace_directory(pg_temp.s154_id(1)), 3);
  PERFORM pg_temp.s154_assert(member ->> 'department_id' = department_b::TEXT
    AND member -> 'direction_codes' = '[]'::JSONB, 'full replacement clears previous directions');
  result := platform.staff_department_command(pg_temp.s154_id(1), department_a, 'update',
    'S154 Department A final', NULL, 4, 'S154 winning rename', pg_temp.s154_id(809));
  PERFORM pg_temp.s154_assert(result ->> 'version' = '5', 'winning department edit commits its expected version');
  INSERT INTO s154_state VALUES ('department_a', to_jsonb(department_a)), ('department_b', to_jsonb(department_b)),
    ('stable_a_directory', platform.staff_workspace_directory(pg_temp.s154_id(1)));
END $positive_commands$;

-- A separate actual Admin owns organization B; its department cannot leak into
-- A's directory or be assigned through an A-scoped command.
SELECT set_config('request.jwt.claims', claims::TEXT, TRUE) FROM s154_actors WHERE n = 6 \gset
INSERT INTO s154_state SELECT 'foreign_department', platform.staff_department_command(pg_temp.s154_id(2), NULL,
  'create', 'S154 private foreign department', NULL, 0, 'S154 foreign create', pg_temp.s154_id(901)) -> 'department_id';
SELECT set_config('request.jwt.claims', claims::TEXT, TRUE) FROM s154_actors WHERE n = 1 \gset

DO $conflicts_and_boundaries$
DECLARE department_a UUID; department_b UUID; foreign_department UUID; result JSONB; statement TEXT; target INTEGER;
BEGIN
  SELECT (value #>> '{}')::UUID INTO department_a FROM s154_state WHERE key = 'department_a';
  SELECT (value #>> '{}')::UUID INTO department_b FROM s154_state WHERE key = 'department_b';
  SELECT (value #>> '{}')::UUID INTO foreign_department FROM s154_state WHERE key = 'foreign_department';
  -- Two callers may have read the same version. A stale writer must not
  -- overwrite the already committed winner, regardless of its request ID.
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,%L,''update'',%L,NULL,4,%L,%L)',
    pg_temp.s154_id(1), department_a, 'S154 losing rename', 'S154 stale writer', pg_temp.s154_id(810)),
    '40001', 'staff_department_version_conflict');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,%L,%L,%L,2,%L,%L)',
    pg_temp.s154_id(1), pg_temp.s154_id(303), department_a, 'S154 losing title', ARRAY['MY']::TEXT[],
    'S154 stale details writer', pg_temp.s154_id(816)), '40001', 'staff_organizational_version_conflict');
  result := platform.staff_department_command(pg_temp.s154_id(1), NULL, 'create',
    ' S154 Department A ', 'S154 internal description', 0, 'S154 create', pg_temp.s154_id(801));
  PERFORM pg_temp.s154_assert(result ->> 'status' = 'replayed' AND result ->> 'version' = '1'
    AND result ->> 'department_id' = department_a::TEXT, 'historical create replay never rewrites newer department state');
  result := platform.staff_department_command(pg_temp.s154_id(1), department_a, 'update',
    'S154 Department A final', NULL, 4, 'S154 winning rename', pg_temp.s154_id(809));
  PERFORM pg_temp.s154_assert(result ->> 'status' = 'replayed' AND result ->> 'version' = '5', 'exact update replay works after version advancement');
  result := platform.staff_organizational_details_save(pg_temp.s154_id(1), pg_temp.s154_id(303),
    department_b, 'S154 Final Adviser', ARRAY[]::TEXT[], 2, 'S154 move and clear directions', pg_temp.s154_id(815));
  PERFORM pg_temp.s154_assert(result ->> 'status' = 'replayed' AND result ->> 'version' = '3', 'exact metadata replay works after version advancement');

  -- The exact request binds every normalized field, target and expected version.
  FOR statement IN SELECT format('SELECT platform.staff_organizational_details_save(%L,%L,%L,%L,%L,%s,%L,%L)',
    pg_temp.s154_id(1), changed.membership_id, changed.department_id, changed.title,
    changed.directions, changed.version, changed.reason, pg_temp.s154_id(815))
    FROM (VALUES
      (pg_temp.s154_id(303), department_b, 'S154 changed title', ARRAY[]::TEXT[], 2, 'S154 move and clear directions'),
      (pg_temp.s154_id(303), department_a, 'S154 Final Adviser', ARRAY[]::TEXT[], 2, 'S154 move and clear directions'),
      (pg_temp.s154_id(303), department_b, 'S154 Final Adviser', ARRAY['CN']::TEXT[], 2, 'S154 move and clear directions'),
      (pg_temp.s154_id(303), department_b, 'S154 Final Adviser', ARRAY[]::TEXT[], 3, 'S154 move and clear directions'),
      (pg_temp.s154_id(303), department_b, 'S154 Final Adviser', ARRAY[]::TEXT[], 2, 'S154 changed reason'),
      (pg_temp.s154_id(304), department_b, 'S154 Final Adviser', ARRAY[]::TEXT[], 2, 'S154 move and clear directions')
    ) AS changed(membership_id, department_id, title, directions, version, reason)
  LOOP PERFORM pg_temp.s154_error(statement, '22023', 'already used for another mutation'); END LOOP;
  FOR statement IN SELECT format('SELECT platform.staff_department_command(%L,%L,''update'',%L,%L,%s,%L,%L)',
    pg_temp.s154_id(1), department_a, changed.name, changed.description, changed.version,
    'S154 winning rename', pg_temp.s154_id(809))
    FROM (VALUES ('S154 changed name', NULL::TEXT, 4), ('S154 Department A final', 'S154 changed description', 4),
      ('S154 Department A final', NULL::TEXT, 5)) AS changed(name, description, version)
  LOOP PERFORM pg_temp.s154_error(statement, '22023', 'already used for another mutation'); END LOOP;

  PERFORM pg_temp.s154_error(format('SELECT platform.staff_workspace_directory(%L)', pg_temp.s154_id(2)), '42501');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,%L,''update'',%L,NULL,1,%L,%L)',
    pg_temp.s154_id(1), foreign_department, 'S154 foreign takeover', 'S154 foreign denial', pg_temp.s154_id(820)), '42501');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,%L,%L,%L,3,%L,%L)',
    pg_temp.s154_id(1), pg_temp.s154_id(303), foreign_department, 'S154 foreign assignment', ARRAY[]::TEXT[],
    'S154 foreign department denial', pg_temp.s154_id(821)), '42501');
  FOREACH target IN ARRAY ARRAY[305, 307] LOOP
    PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,NULL,%L,%L,0,%L,%L)',
      pg_temp.s154_id(1), pg_temp.s154_id(target), 'S154 forbidden target', ARRAY[]::TEXT[],
      'S154 Student or foreign target', pg_temp.s154_id(830 + target)), '42501', 'staff_organization_member_unavailable');
  END LOOP;
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,NULL,%L,%L,3,%L,%L)',
    pg_temp.s154_id(1), pg_temp.s154_id(303), 'S154 invalid direction', ARRAY['NOT_A_DIRECTION']::TEXT[],
    'S154 invalid direction', pg_temp.s154_id(823)), '22023', 'staff_organization_invalid_direction');

  -- A second authorized Admin in the same organization cannot reuse another
  -- actor's receipt even when the complete business payload is identical.
  PERFORM set_config('request.jwt.claims', (SELECT claims::TEXT FROM s154_actors WHERE n = 2), TRUE);
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,%L,%L,%L,2,%L,%L)',
    pg_temp.s154_id(1), pg_temp.s154_id(303), department_b, 'S154 Final Adviser', ARRAY[]::TEXT[],
    'S154 move and clear directions', pg_temp.s154_id(815)), '22023', 'already used for another mutation');
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,NULL,''create'',%L,%L,0,%L,%L)',
    pg_temp.s154_id(1), ' S154 Department A ', 'S154 internal description', 'S154 create', pg_temp.s154_id(801)),
    '22023', 'already used for another mutation');
  PERFORM set_config('request.jwt.claims', (SELECT claims::TEXT FROM s154_actors WHERE n = 6), TRUE);
  PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,NULL,''create'',%L,%L,0,%L,%L)',
    pg_temp.s154_id(2), ' S154 Department A ', 'S154 internal description', 'S154 create', pg_temp.s154_id(801)),
    '22023', 'already used for another mutation');
  PERFORM pg_temp.s154_assert(jsonb_array_length(platform.staff_workspace_directory(pg_temp.s154_id(2)) -> 'members') = 2,
    'organization B directory contains only its own employees');

  FOREACH target IN ARRAY ARRAY[3, 4, 5] LOOP
    PERFORM set_config('request.jwt.claims', (SELECT claims::TEXT FROM s154_actors WHERE n = target), TRUE);
    PERFORM pg_temp.s154_assert((SELECT count(*) = 1 FROM platform.current_actor_authority()),
      'negative actor is a valid real fixture membership');
    PERFORM pg_temp.s154_error(format('SELECT platform.staff_workspace_directory(%L)', pg_temp.s154_id(1)), '42501');
    PERFORM pg_temp.s154_error(format('SELECT platform.staff_department_command(%L,NULL,''create'',%L,NULL,0,%L,%L)',
      pg_temp.s154_id(1), 'S154 forbidden role create', 'S154 non-Admin denial', pg_temp.s154_id(850 + target)), '42501');
    PERFORM pg_temp.s154_error(format('SELECT platform.staff_organizational_details_save(%L,%L,NULL,%L,%L,3,%L,%L)',
      pg_temp.s154_id(1), pg_temp.s154_id(303), 'S154 forbidden role edit', ARRAY[]::TEXT[],
      'S154 non-Admin details denial', pg_temp.s154_id(860 + target)), '42501');
  END LOOP;
  PERFORM set_config('request.jwt.claims', (SELECT claims::TEXT FROM s154_actors WHERE n = 1), TRUE);
  PERFORM pg_temp.s154_assert(platform.staff_workspace_directory(pg_temp.s154_id(1)) =
    (SELECT value FROM s154_state WHERE key = 'stable_a_directory'), 'all stale writes, denials and replays preserve the exact last committed state');
END $conflicts_and_boundaries$;

DO $direct_access$
DECLARE statement TEXT;
BEGIN
  FOREACH statement IN ARRAY ARRAY[
    'SELECT * FROM platform.staff_departments',
    'INSERT INTO platform.staff_departments(organization_id,name) VALUES(pg_temp.s154_id(1),''S154 direct insert'')',
    'UPDATE platform.staff_departments SET name=''S154 direct update''',
    'DELETE FROM platform.staff_departments',
    'SELECT * FROM platform.staff_organizational_details',
    'INSERT INTO platform.staff_organizational_details(organization_id,membership_id) VALUES(pg_temp.s154_id(1),pg_temp.s154_id(301))',
    'UPDATE platform.staff_organizational_details SET job_title=''S154 direct update''',
    'DELETE FROM platform.staff_organizational_details',
    'SELECT * FROM platform.staff_direction_assignments',
    'INSERT INTO platform.staff_direction_assignments(organization_id,membership_id,direction_code) VALUES(pg_temp.s154_id(1),pg_temp.s154_id(303),''CN'')',
    'UPDATE platform.staff_direction_assignments SET direction_code=''MY''',
    'DELETE FROM platform.staff_direction_assignments'
  ] LOOP PERFORM pg_temp.s154_error(statement, '42501'); END LOOP;
END $direct_access$;

-- A stale access claim remains denied even though organizational edits did
-- not require reauthentication. This deliberately invalid token is test-only.
SELECT set_config('request.jwt.claims', (claims || '{"platform_access_version":0}'::JSONB)::TEXT, TRUE)
FROM s154_actors WHERE n = 1 \gset
SELECT pg_temp.s154_error('SELECT platform.staff_workspace_directory(pg_temp.s154_id(1))', '42501');
SET LOCAL ROLE anon;
SELECT pg_temp.s154_error('SELECT platform.staff_workspace_directory(pg_temp.s154_id(1))', '42501');
SELECT pg_temp.s154_error('SELECT platform.staff_department_command(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)', '42501');
SELECT pg_temp.s154_error('SELECT platform.staff_organizational_details_save(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)', '42501');
RESET ROLE;

DO $stored_authority_and_audit$
DECLARE event platform.audit_events%ROWTYPE; safe JSONB; actions TEXT[]; result_count INTEGER;
BEGIN
  PERFORM pg_temp.s154_assert(NOT EXISTS (
    SELECT 1 FROM s154_authority_before AS original
    JOIN platform.profiles AS profile ON profile.id = pg_temp.s154_id(200 + original.n)
    JOIN platform.organization_memberships AS membership ON membership.id = pg_temp.s154_id(300 + original.n)
    WHERE to_jsonb(profile) IS DISTINCT FROM original.profile OR to_jsonb(membership) IS DISTINCT FROM original.membership
      OR (SELECT jsonb_agg(to_jsonb(assignment) ORDER BY assignment.id)
        FROM platform.membership_scope_assignments AS assignment WHERE assignment.membership_id = membership.id)
        IS DISTINCT FROM original.scopes
  ), 'profile/access_version, membership role/bundle and scope authority are unchanged');
  PERFORM pg_temp.s154_assert((SELECT count(*) = 2 FROM platform.staff_organizational_details
    WHERE organization_id = pg_temp.s154_id(1)), 'only two explicitly saved employees received metadata');
  PERFORM pg_temp.s154_assert((SELECT count(*) = 3 FROM platform.staff_departments
    WHERE organization_id IN (pg_temp.s154_id(1), pg_temp.s154_id(2))), 'three real creates and no replay duplicates');
  SELECT count(*), array_agg(DISTINCT action ORDER BY action) INTO result_count, actions
    FROM platform.audit_events WHERE organization_id IN (pg_temp.s154_id(1), pg_temp.s154_id(2))
      AND action LIKE 'staff.%';
  PERFORM pg_temp.s154_assert(result_count = 11, 'exactly eleven successful mutations audited once; rejected/replayed calls add none');
  PERFORM pg_temp.s154_assert(actions = ARRAY['staff.department.archive', 'staff.department.create',
    'staff.department.restore', 'staff.department.update', 'staff.organization.details.change'],
    'all five new audit actions were exercised');
  FOR event IN SELECT * FROM platform.audit_events
    WHERE organization_id IN (pg_temp.s154_id(1), pg_temp.s154_id(2)) AND action LIKE 'staff.%'
  LOOP
    safe := platform_private.p7a_safe_audit_row(event);
    PERFORM pg_temp.s154_assert(safe ->> 'reason_code' = 'restricted' AND safe ->> 'actor_display_label' = 'Staff'
      AND NOT safe ?| ARRAY['before_state', 'after_state', 'reason', 'name', 'job_title', 'description', 'input_fingerprint']
      AND safe::TEXT NOT LIKE '%S154%', 'actual safe audit projection omits organization/person/free-text payload');
    PERFORM pg_temp.s154_assert(safe -> 'changed_field_codes' = CASE
      WHEN event.action = 'staff.organization.details.change' THEN '["assignment"]'::JSONB
      ELSE '["record_status"]'::JSONB END, 'actual audit categories match the shipped manifest');
    PERFORM pg_temp.s154_assert(event.after_state ->> 'input_fingerprint' ~ '^[0-9a-f]{64}$'
      AND event.after_state ->> 'actor_membership_id' = CASE WHEN event.organization_id = pg_temp.s154_id(1)
        THEN pg_temp.s154_id(301)::TEXT ELSE pg_temp.s154_id(306)::TEXT END,
      'receipt stores the bound actor and SHA-256 fingerprint');
  END LOOP;
  SELECT * INTO event FROM platform.audit_events WHERE request_id = pg_temp.s154_id(815);
  PERFORM pg_temp.s154_assert(event.before_state ->> 'organizational_version' = '2'
    AND event.after_state ->> 'organizational_version' = '3'
    AND event.before_state -> 'direction_codes' = '["CN","TR"]'::JSONB
    AND event.after_state -> 'direction_codes' = '[]'::JSONB,
    'canonical audit preserves before/after assignment history');
END $stored_authority_and_audit$;

ROLLBACK;
\echo 'S154 PASS: real Admin department/details lifecycle, replay/version conflicts, authority preservation, role/tenant/direct denials and safe audit; isolated rows rolled back.'
