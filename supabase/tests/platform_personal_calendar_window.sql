\set ON_ERROR_STOP on
-- Suite for migration 369 «окно дат в сборщике личного календаря». Runs on the real chain right after 369 inside one
-- transaction that is rolled back. Synthetic data only.
--
-- Proves: `staff_personal_calendar_page_v1` returns exactly what the pre-369 logic returned (a reference copy of that
-- logic is kept below: unwindowed `personal_calendar_rows_v1()`, then the date window, the cursor and the LIMIT) for an
-- assignee of case and staff tasks, an assignee of staff tasks only, an admin, a second member of the same organisation,
-- a member of another organisation and a member without task permissions (same error), over several windows (day
-- edges at Asia/Bishkek midnight, a month, an empty window), both modes, several page sizes and the whole cursor chain.
-- Also: the permission helpers run only for rows inside the window, invalid arguments are refused as before, the old
-- two-argument builder call of the target function still works, and nothing is callable by client roles.
BEGIN;

\echo A369_PERSONAL_CALENDAR_WINDOW_SUITE_START

CREATE FUNCTION pg_temp.a369_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A369: %', message; END IF;
END
$$;

-- Verbatim copy of the migration 217 rows builder (the pre-369 definition), kept as the reference for the new builder.
CREATE FUNCTION pg_temp.a369_old_rows(
  p_kind TEXT DEFAULT NULL, p_task_id UUID DEFAULT NULL
) RETURNS TABLE(sort_at TIMESTAMPTZ, kind TEXT, task_id UUID, task JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; can_case BOOLEAN; can_staff BOOLEAN;
BEGIN
  SELECT a.organization_id, a.membership_id INTO actor
  FROM platform.current_actor_authority() AS a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) AS i ON TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal calendar is unavailable' USING ERRCODE = '42501';
  END IF;
  can_case := platform_private.staff_has_permission(actor.organization_id, actor.membership_id, 'task.manage');
  can_staff := platform_private.staff_has_permission(actor.organization_id, actor.membership_id, 'staff.task.read');
  IF NOT (can_case OR can_staff) THEN
    RAISE EXCEPTION 'Personal calendar is unavailable' USING ERRCODE = '42501';
  END IF;

  IF can_case AND (p_kind IS NULL OR p_kind = 'case') THEN
    RETURN QUERY
    SELECT deadline.sort_at, 'case'::TEXT, t.id, jsonb_build_object(
      'kind', 'case', 'task_id', t.id, 'organization_id', t.organization_id,
      'version', t.version::TEXT, 'title', t.title, 'details', NULL::TEXT,
      'status', t.status, 'priority', t.priority, 'due_on', t.due_on, 'due_at', t.due_at,
      'sort_at', deadline.sort_at, 'assignee_membership_id', t.assignee_membership_id,
      'assignee_display_name', p.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at,
      'student_case_id', c.id, 'student_display_name', c.student_display_name,
      'case_state', c.state, 'task_type', t.task_type, 'student_visible', t.student_visible)
    FROM platform.case_tasks AS t
    JOIN platform.student_cases AS c ON c.organization_id = t.organization_id AND c.id = t.student_case_id
    JOIN platform.organization_memberships AS m ON m.organization_id = t.organization_id AND m.id = t.assignee_membership_id
    JOIN platform.profiles AS p ON p.id = m.profile_id
    CROSS JOIN LATERAL (SELECT CASE WHEN t.due_at IS NOT NULL THEN t.due_at
      WHEN t.due_on IS NOT NULL THEN t.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ END AS sort_at) AS deadline
    WHERE t.organization_id = actor.organization_id AND t.assignee_membership_id = actor.membership_id
      AND (p_task_id IS NULL OR t.id = p_task_id)
      AND c.state IN ('active', 'closed') AND c.handoff_at IS NOT NULL
      AND platform_private.staff_can_access(t.organization_id, actor.membership_id, 'task.manage', 'task', t.id);
  END IF;

  IF can_staff AND (p_kind IS NULL OR p_kind = 'staff') THEN
    RETURN QUERY
    SELECT deadline.sort_at, 'staff'::TEXT, t.id, jsonb_build_object(
      'kind', 'staff', 'task_id', t.id, 'organization_id', t.organization_id,
      'version', t.version::TEXT, 'title', t.title, 'details', t.description,
      'status', t.status, 'priority', t.priority, 'due_on', t.due_on, 'due_at', t.due_at,
      'sort_at', deadline.sort_at, 'assignee_membership_id', t.assignee_membership_id,
      'assignee_display_name', p.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at)
    FROM platform.staff_tasks AS t
    JOIN platform.organization_memberships AS m ON m.organization_id = t.organization_id AND m.id = t.assignee_membership_id
    JOIN platform.profiles AS p ON p.id = m.profile_id
    CROSS JOIN LATERAL (SELECT CASE WHEN t.due_at IS NOT NULL THEN t.due_at
      WHEN t.due_on IS NOT NULL THEN t.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ END AS sort_at) AS deadline
    WHERE t.organization_id = actor.organization_id AND t.assignee_membership_id = actor.membership_id
      AND (p_task_id IS NULL OR t.id = p_task_id)
      AND platform_private.staff_can_access(t.organization_id, actor.membership_id, 'staff.task.read', 'staff_task', t.id);
  END IF;
END;
$$;

-- Reference copy of the pre-369 page body (migration 217): build every row, then filter, cursor, limit.
CREATE FUNCTION pg_temp.a369_ref_page(
  p_mode TEXT, p_due_from DATE, p_due_to DATE, p_limit INTEGER,
  p_after_sort_at TIMESTAMPTZ, p_after_kind TEXT, p_after_task_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  WITH eligible AS MATERIALIZED (
    SELECT r.* FROM pg_temp.a369_old_rows() AS r
    WHERE CASE WHEN p_mode = 'undated' THEN r.task->>'due_on' IS NULL AND r.task->>'due_at' IS NULL
      ELSE (r.task->>'due_on' IS NOT NULL OR r.task->>'due_at' IS NOT NULL)
        AND (pg_catalog.timezone('Asia/Bishkek', r.sort_at)::DATE BETWEEN p_due_from AND p_due_to) END
  ), bounded AS MATERIALIZED (
    SELECT e.* FROM eligible AS e
    WHERE p_after_sort_at IS NULL OR (e.sort_at, e.kind, e.task_id) > (p_after_sort_at, p_after_kind, p_after_task_id)
    ORDER BY e.sort_at, e.kind, e.task_id LIMIT p_limit + 1
  ), numbered AS (
    SELECT b.*, row_number() OVER (ORDER BY b.sort_at, b.kind, b.task_id) AS position FROM bounded AS b
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(n.task ORDER BY n.sort_at, n.kind, n.task_id) FROM numbered AS n WHERE n.position <= p_limit), '[]'::JSONB),
    'total_count', (SELECT count(*) FROM eligible),
    'next_cursor', CASE WHEN (SELECT count(*) FROM bounded) > p_limit THEN
      (SELECT jsonb_build_object('sort_at', n.sort_at, 'kind', n.kind, 'task_id', n.task_id) FROM numbered AS n WHERE n.position = p_limit)
      ELSE NULL END) INTO result;
  RETURN result;
END;
$$;

-- Walks the whole cursor chain of both implementations and requires every page to be identical.
-- Returns [pages, rows] so the suite can see that the comparison was not empty.
CREATE FUNCTION pg_temp.a369_compare(p_mode TEXT, p_from DATE, p_to DATE, p_limit INTEGER) RETURNS INTEGER[]
LANGUAGE plpgsql AS $$
DECLARE cursor_value JSONB := NULL; fresh JSONB; reference JSONB; pages INTEGER := 0; total_rows INTEGER := 0;
BEGIN
  LOOP
    fresh := platform.staff_personal_calendar_page_v1(p_mode, p_from, p_to, p_limit,
      (cursor_value->>'sort_at')::TIMESTAMPTZ, cursor_value->>'kind', (cursor_value->>'task_id')::UUID);
    reference := pg_temp.a369_ref_page(p_mode, p_from, p_to, p_limit,
      (cursor_value->>'sort_at')::TIMESTAMPTZ, cursor_value->>'kind', (cursor_value->>'task_id')::UUID);
    IF fresh IS DISTINCT FROM reference THEN
      RAISE EXCEPTION 'A369: page % differs (mode %, % .. %, limit %): new % reference %', pages + 1, p_mode, p_from, p_to, p_limit, fresh, reference;
    END IF;
    pages := pages + 1;
    total_rows := total_rows + jsonb_array_length(fresh->'rows');
    EXIT WHEN jsonb_typeof(fresh->'next_cursor') = 'null';
    cursor_value := fresh->'next_cursor';
    IF pages > 200 THEN RAISE EXCEPTION 'A369: cursor chain does not end'; END IF;
  END LOOP;
  RETURN ARRAY[pages, total_rows];
END
$$;

-- All windows, modes and page sizes for the claims currently set. Returns the dated and undated row totals.
CREATE FUNCTION pg_temp.a369_compare_actor() RETURNS INTEGER[] LANGUAGE plpgsql AS $$
DECLARE win DATE[]; lim INTEGER; got INTEGER[]; dated_rows INTEGER := 0; undated_rows INTEGER := 0; best INTEGER;
BEGIN
  FOREACH lim IN ARRAY ARRAY[1, 2, 3, 7, 100] LOOP
    got := pg_temp.a369_compare('undated', NULL, NULL, lim);
    undated_rows := GREATEST(undated_rows, got[2]);
    FOR win IN SELECT ARRAY[a::DATE, b::DATE] FROM (VALUES
      ('2026-09-07', '2026-09-13'), ('2026-09-06', '2026-09-06'), ('2026-09-07', '2026-09-07'), ('2026-09-10', '2026-09-10'),
      ('2026-09-13', '2026-09-13'), ('2026-09-14', '2026-09-14'), ('2026-09-01', '2026-09-30'), ('2026-12-01', '2026-12-31'),
      ('2026-09-08', '2026-09-09')) AS w(a, b)
    LOOP
      got := pg_temp.a369_compare('dated', win[1], win[2], lim);
      IF win[1] = '2026-09-01' THEN dated_rows := GREATEST(dated_rows, got[2]); END IF;
    END LOOP;
  END LOOP;
  RETURN ARRAY[dated_rows, undated_rows];
END
$$;

-- The new builder without arguments equals the verbatim 217 builder (same rows, same order), and the kind/task filters too.
CREATE FUNCTION pg_temp.a369_builder_equal() RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fresh JSONB; reference JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO fresh FROM platform_private.personal_calendar_rows_v1() AS r;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO reference FROM pg_temp.a369_old_rows() AS r;
  IF fresh IS DISTINCT FROM reference THEN RETURN FALSE; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO fresh FROM platform_private.personal_calendar_rows_v1('staff') AS r;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO reference FROM pg_temp.a369_old_rows('staff') AS r;
  IF fresh IS DISTINCT FROM reference THEN RETURN FALSE; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO fresh FROM platform_private.personal_calendar_rows_v1('case') AS r;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_at, r.kind, r.task_id), '[]') INTO reference FROM pg_temp.a369_old_rows('case') AS r;
  RETURN fresh IS NOT DISTINCT FROM reference AND jsonb_array_length(fresh) >= 0;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.a369_assert(BOOLEAN, TEXT), pg_temp.a369_ref_page(TEXT, DATE, DATE, INTEGER, TIMESTAMPTZ, TEXT, UUID),
  pg_temp.a369_compare(TEXT, DATE, DATE, INTEGER), pg_temp.a369_compare_actor(), pg_temp.a369_builder_equal()
  TO authenticated, service_role;

\set a369_org 36936900-0000-4000-8000-000000000001
\set a369_foreign_org 36936900-0000-4000-8000-000000000002
\set a369_org_scope 36936900-0000-4000-8000-000000000011
\set a369_case_scope 36936900-0000-4000-8000-000000000012
\set a369_pending_scope 36936900-0000-4000-8000-000000000013
\set a369_foreign_scope 36936900-0000-4000-8000-000000000014

\set a369_admin_user 36936900-0000-4000-8000-000000000021
\set a369_sales_user 36936900-0000-4000-8000-000000000022
\set a369_curator_user 36936900-0000-4000-8000-000000000023
\set a369_student_user 36936900-0000-4000-8000-000000000024
\set a369_curator2_user 36936900-0000-4000-8000-000000000025
\set a369_foreign_admin_user 36936900-0000-4000-8000-000000000026
\set a369_curator3_user 36936900-0000-4000-8000-000000000027
\set a369_admin_profile 36936900-0000-4000-8000-000000000031
\set a369_sales_profile 36936900-0000-4000-8000-000000000032
\set a369_curator_profile 36936900-0000-4000-8000-000000000033
\set a369_student_profile 36936900-0000-4000-8000-000000000034
\set a369_curator2_profile 36936900-0000-4000-8000-000000000035
\set a369_foreign_admin_profile 36936900-0000-4000-8000-000000000036
\set a369_curator3_profile 36936900-0000-4000-8000-000000000037
\set a369_admin_membership 36936900-0000-4000-8000-000000000041
\set a369_sales_membership 36936900-0000-4000-8000-000000000042
\set a369_curator_membership 36936900-0000-4000-8000-000000000043
\set a369_student_membership 36936900-0000-4000-8000-000000000044
\set a369_curator2_membership 36936900-0000-4000-8000-000000000045
\set a369_foreign_admin_membership 36936900-0000-4000-8000-000000000046
\set a369_curator3_membership 36936900-0000-4000-8000-000000000047
\set a369_case 36936900-0000-4000-8000-000000000051
\set a369_pending_case 36936900-0000-4000-8000-000000000052
\set a369_other_case 36936900-0000-4000-8000-000000000053
\set a369_other_scope 36936900-0000-4000-8000-000000000016
\set a369_role_curator 36936900-0000-4000-8000-000000000081
\set a369_role_staff 36936900-0000-4000-8000-000000000082

SELECT bundle.id AS a369_student_bundle FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published' ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name) VALUES (:'a369_org', 'A369 Organization'), (:'a369_foreign_org', 'A369 Foreign Organization');

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (:'a369_org_scope', :'a369_org', 'organization', :'a369_org', 1),
  (:'a369_case_scope', :'a369_org', 'student_case', :'a369_case', 1),
  (:'a369_pending_scope', :'a369_org', 'student_case', :'a369_pending_case', 1),
  (:'a369_other_scope', :'a369_org', 'student_case', :'a369_other_case', 1),
  (:'a369_foreign_scope', :'a369_foreign_org', 'organization', :'a369_foreign_org', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'a369_admin_user', 'a369-admin@example.invalid', '{}'::JSONB),
  (:'a369_sales_user', 'a369-sales@example.invalid', '{}'::JSONB),
  (:'a369_curator_user', 'a369-curator@example.invalid', '{}'::JSONB),
  (:'a369_student_user', 'a369-student@example.invalid', '{}'::JSONB),
  (:'a369_curator2_user', 'a369-curator2@example.invalid', '{}'::JSONB),
  (:'a369_foreign_admin_user', 'a369-foreign-admin@example.invalid', '{}'::JSONB),
  (:'a369_curator3_user', 'a369-curator3@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version) VALUES
  (:'a369_admin_profile', :'a369_admin_user', 'A369 Admin', 'active', 1),
  (:'a369_sales_profile', :'a369_sales_user', 'A369 Staff Only', 'active', 1),
  (:'a369_curator_profile', :'a369_curator_user', 'A369 Curator', 'active', 1),
  (:'a369_student_profile', :'a369_student_user', 'A369 Student', 'active', 1),
  (:'a369_curator2_profile', :'a369_curator2_user', 'A369 Curator Two', 'active', 1),
  (:'a369_foreign_admin_profile', :'a369_foreign_admin_user', 'A369 Foreign Admin', 'active', 1),
  (:'a369_curator3_profile', :'a369_curator3_user', 'A369 Record-scoped Curator', 'active', 1);

-- Invited staff carry no coarse role and get permissions only from scoped role assignments (production shape after 155).
INSERT INTO platform.organization_memberships (id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin) VALUES
  (:'a369_admin_membership', :'a369_org', :'a369_admin_profile', 'active', NULL, NULL, TRUE),
  (:'a369_sales_membership', :'a369_org', :'a369_sales_profile', 'active', NULL, NULL, FALSE),
  (:'a369_curator_membership', :'a369_org', :'a369_curator_profile', 'active', NULL, NULL, FALSE),
  (:'a369_student_membership', :'a369_org', :'a369_student_profile', 'active', 'student', :'a369_student_bundle', FALSE),
  (:'a369_curator2_membership', :'a369_org', :'a369_curator2_profile', 'active', NULL, NULL, FALSE),
  (:'a369_foreign_admin_membership', :'a369_foreign_org', :'a369_foreign_admin_profile', 'active', NULL, NULL, TRUE),
  (:'a369_curator3_membership', :'a369_org', :'a369_curator3_profile', 'active', NULL, NULL, FALSE);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('36936900-0000-4000-8000-000000000061', :'a369_org', :'a369_admin_membership', :'a369_org_scope', 1, 1, TRUE, 'system', NULL, 'A369 admin scope', '36936900-0000-4000-8000-000000000071'),
  ('36936900-0000-4000-8000-000000000064', :'a369_org', :'a369_student_membership', :'a369_case_scope', 1, 1, TRUE, 'system', NULL, 'A369 student scope', '36936900-0000-4000-8000-000000000074');

-- Two roles through the real commands: «curator» (case tasks and staff tasks) and «staff tasks only».
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_admin_user'::UUID,
  'claims', jsonb_build_object('sub', :'a369_admin_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_admin_setup \gset
SET request.jwt.claims TO :'a369_admin_setup';
SET ROLE authenticated;
DO $a369_roles$
DECLARE r RECORD; published JSONB; bundles JSONB := '{}'::JSONB; m RECORD; items JSONB; bindings JSONB;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('36936900-0000-4000-8000-000000000081'::UUID, 'Curator', '["case.read.full","task.manage","task.create","staff.task.read"]'::JSONB, 8100),
    ('36936900-0000-4000-8000-000000000082'::UUID, 'Staff tasks', '["staff.task.read"]'::JSONB, 8200),
    ('36936900-0000-4000-8000-000000000083'::UUID, 'Case tasks only', '["case.read.full","task.manage"]'::JSONB, 8400)) AS v(role_id, label, keys, base)
  LOOP
    PERFORM platform.staff_role_command('36936900-0000-4000-8000-000000000001', r.role_id, 0, 'create',
      jsonb_build_object('label', 'A369 ' || r.label, 'description', 'Migration 369 synthetic role', 'permissionKeys', r.keys),
      'A369 create role', ('36936900-0000-4000-8000-00000000' || (r.base + 1)::TEXT)::UUID);
    published := platform.staff_role_publish('36936900-0000-4000-8000-000000000001', r.role_id, 1,
      platform.staff_role_impact('36936900-0000-4000-8000-000000000001', r.role_id, 1) ->> 'impactFingerprint',
      'A369 publish role', ('36936900-0000-4000-8000-00000000' || (r.base + 2)::TEXT)::UUID);
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT * FROM (VALUES
    ('36936900-0000-4000-8000-000000000043'::UUID, '36936900-0000-4000-8000-000000000081'::UUID, 8301, '{"kind":"own","key":null,"resourceKind":null}'::JSONB),
    ('36936900-0000-4000-8000-000000000045'::UUID, '36936900-0000-4000-8000-000000000081'::UUID, 8302, '{"kind":"own","key":null,"resourceKind":null}'::JSONB),
    ('36936900-0000-4000-8000-000000000042'::UUID, '36936900-0000-4000-8000-000000000082'::UUID, 8303, '{"kind":"own","key":null,"resourceKind":null}'::JSONB))  AS v(membership_id, role_id, base, scope)
  LOOP
    items := jsonb_build_array(jsonb_build_object('roleId', m.role_id, 'scope', m.scope));
    bindings := jsonb_build_array(jsonb_build_object('roleId', m.role_id, 'roleVersion', 2,
      'bundleId', (bundles ->> m.role_id::TEXT)::UUID, 'bundleVersion', 1));
    PERFORM platform.staff_role_assignments_save('36936900-0000-4000-8000-000000000001', m.membership_id,
      (SELECT p.access_version FROM platform.organization_memberships AS om JOIN platform.profiles AS p ON p.id = om.profile_id WHERE om.id = m.membership_id),
      items, bindings, 'A369 grant role', ('36936900-0000-4000-8000-00000000' || m.base::TEXT)::UUID);
  END LOOP;
END
$a369_roles$;
RESET ROLE;
RESET request.jwt.claims;

-- Claims from the live rows after the assignments bumped the access versions.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_admin_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_admin_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_admin_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_sales_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_sales_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_sales_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_curator_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_curator_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_curator_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_curator2_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_curator2_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_curator2_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_student_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_student_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_student_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_foreign_admin_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_foreign_admin_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_foreign_admin_claims \gset

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state, handoff_at, portal_activated_at, closed_at,
  next_action, current_scope_id, current_scope_version
) VALUES
  (:'a369_case', :'a369_org', :'a369_student_membership', :'a369_sales_membership', NULL,
   'synthetic:a369:active', 'contract:a369:active', '2026-09-01 08:00:00+00', 'A369 Active Student', 'United Kingdom', 'Bachelor',
   'Computer Science', '2027', 'approved', 'contract_confirmed', 'pending', NULL, NULL, NULL, 'Submit applications', :'a369_case_scope', 1),
  (:'a369_pending_case', :'a369_org', :'a369_student_membership', :'a369_sales_membership', NULL,
   'synthetic:a369:pending', 'contract:a369:pending', '2026-08-01 08:00:00+00', 'A369 Pending Student', 'United Kingdom', 'Bachelor',
   'Business', '2026', 'approved', 'contract_confirmed', 'pending', NULL, NULL, NULL, NULL, :'a369_pending_scope', 1),
  (:'a369_other_case', :'a369_org', :'a369_student_membership', :'a369_sales_membership', NULL,
   'synthetic:a369:other', 'contract:a369:other', '2026-08-15 08:00:00+00', 'A369 Other Student', 'United Kingdom', 'Bachelor',
   'Law', '2027', 'approved', 'contract_confirmed', 'pending', NULL, NULL, NULL, 'Other curator case', :'a369_other_scope', 1);

-- Activate the case through the real lifecycle (handoff_at set); the pending case stays out of every calendar.
SET request.jwt.claims TO :'a369_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(:'a369_org', :'a369_case', :'a369_curator_membership',
  'Activate the isolated migration 369 case through the real lifecycle', '36936900-0000-4000-8000-000000000075');
SELECT platform.assign_student_case_curator(:'a369_org', :'a369_other_case', :'a369_curator2_membership',
  'Hand the second isolated migration 369 case to the other curator', '36936900-0000-4000-8000-000000000076');
RESET ROLE;
RESET request.jwt.claims;
-- Record scope needs the case to exist: the same case-task permissions, but only inside the first case.
SELECT r.current_bundle_id AS a369_record_bundle FROM platform.staff_role_definitions AS r WHERE r.id = '36936900-0000-4000-8000-000000000083' \gset
SELECT set_config('a369.record_bundle', :'a369_record_bundle', FALSE);
SET request.jwt.claims TO :'a369_admin_claims';
SET ROLE authenticated;
DO $a369_record$
DECLARE bundle_id UUID := current_setting('a369.record_bundle')::UUID;
BEGIN
  PERFORM platform.staff_role_assignments_save('36936900-0000-4000-8000-000000000001', '36936900-0000-4000-8000-000000000047',
    (SELECT p.access_version FROM platform.organization_memberships AS om JOIN platform.profiles AS p ON p.id = om.profile_id WHERE om.id = '36936900-0000-4000-8000-000000000047'),
    jsonb_build_array(jsonb_build_object('roleId', '36936900-0000-4000-8000-000000000083',
      'scope', jsonb_build_object('kind', 'record', 'key', '36936900-0000-4000-8000-000000000051', 'resourceKind', 'student_case'))),
    jsonb_build_array(jsonb_build_object('roleId', '36936900-0000-4000-8000-000000000083', 'roleVersion', 2, 'bundleId', bundle_id, 'bundleVersion', 1)),
    'A369 grant record-scoped role', '36936900-0000-4000-8000-000000008304');
END
$a369_record$;
RESET ROLE;
RESET request.jwt.claims;
-- The assignment bumps access versions: take the claims again.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_curator3_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_curator3_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_curator3_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_curator_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_curator_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_curator_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_admin_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_admin_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_admin_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', :'a369_sales_user'::UUID, 'claims', jsonb_build_object('sub', :'a369_sales_user', 'role', 'authenticated'))) -> 'claims')::TEXT AS a369_sales_claims \gset

-- Deadlines around the Asia/Bishkek midnight edges (UTC+6): 18:00 UTC is already the next local day.
-- Case tasks of the curator: undated x4, due_on, due_at on the day edges, one more on the same day as staff tasks.
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id, priority, due_at, due_on, status, student_visible, created_by_membership_id)
SELECT ('36936900-0000-4000-8000-0000000001' || lpad(n::TEXT, 2, '0'))::UUID, :'a369_org', :'a369_case', 'follow_up', 'A369 case task ' || n,
  :'a369_curator_membership', 'normal', due_at::TIMESTAMPTZ, due_on::DATE, 'open', FALSE, :'a369_curator_membership'
FROM (VALUES
  (1, NULL, NULL), (2, NULL, NULL), (3, NULL, NULL), (4, NULL, NULL),
  (5, NULL, '2026-09-05'), (6, NULL, '2026-09-07'), (7, NULL, '2026-09-10'), (8, NULL, '2026-09-10'), (9, NULL, '2026-09-13'), (10, NULL, '2026-09-14'),
  (11, '2026-09-06 17:59:59+00', NULL), (12, '2026-09-06 18:00:00+00', NULL), (13, '2026-09-10 09:30:00+00', NULL),
  (14, '2026-09-13 17:59:59+00', NULL), (15, '2026-09-13 18:00:00+00', NULL), (16, '2026-10-20 05:00:00+00', NULL)
) AS v(n, due_at, due_on);
-- A task of the curator in the case without handoff, and a task assigned to somebody else in the same case: never in the calendar.
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id, priority, due_at, due_on, status, student_visible, created_by_membership_id) VALUES
  ('36936900-0000-4000-8000-000000000181', :'a369_org', :'a369_pending_case', 'follow_up', 'A369 pending case task', :'a369_curator_membership', 'normal', NULL, '2026-09-10', 'open', FALSE, :'a369_curator_membership'),
  ('36936900-0000-4000-8000-000000000182', :'a369_org', :'a369_case', 'follow_up', 'A369 task of the other curator', :'a369_curator2_membership', 'normal', NULL, '2026-09-10', 'open', FALSE, :'a369_curator_membership');

-- The record-scoped curator owns two tasks on 2026-09-10: one in the case of their scope, one in the other case. The
-- second passes every cheap predicate (assignee, handoff, window) but staff_can_access refuses it.
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id, priority, due_at, due_on, status, student_visible, created_by_membership_id) VALUES
  ('36936900-0000-4000-8000-000000000184', :'a369_org', :'a369_other_case', 'follow_up', 'A369 refused case task', :'a369_curator3_membership', 'normal', NULL, '2026-09-10', 'open', FALSE, :'a369_curator2_membership'),
  ('36936900-0000-4000-8000-000000000185', :'a369_org', :'a369_case', 'follow_up', 'A369 allowed case task', :'a369_curator3_membership', 'normal', NULL, '2026-09-10', 'open', FALSE, :'a369_curator2_membership'),
  ('36936900-0000-4000-8000-000000000186', :'a369_org', :'a369_other_case', 'follow_up', 'A369 refused undated case task', :'a369_curator3_membership', 'normal', NULL, NULL, 'open', FALSE, :'a369_curator2_membership');

-- Staff tasks for every assignee (the same day edges), one per pattern, plus an undated pair for each.
INSERT INTO platform.staff_tasks (id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority, due_on, due_at)
SELECT ('36936900-0000-4000-8000-0000000002' || lpad((a.idx * 20 + v.n)::TEXT, 2, '0'))::UUID, a.org, a.assignee, a.assignee,
  'A369 staff task ' || a.idx || '/' || v.n, 'open', 'normal', v.due_on::DATE, v.due_at::TIMESTAMPTZ
FROM (VALUES
  (0, :'a369_org'::UUID, :'a369_curator_membership'::UUID), (1, :'a369_org'::UUID, :'a369_sales_membership'::UUID),
  (2, :'a369_org'::UUID, :'a369_admin_membership'::UUID), (3, :'a369_org'::UUID, :'a369_curator2_membership'::UUID),
  (4, :'a369_foreign_org'::UUID, :'a369_foreign_admin_membership'::UUID)
) AS a(idx, org, assignee)
CROSS JOIN (VALUES
  (1, NULL, NULL), (2, NULL, NULL), (3, NULL, NULL),
  (4, NULL, '2026-09-10'), (5, NULL, '2026-09-13'), (6, NULL, '2026-09-08'),
  (7, '2026-09-06 18:00:00+00', NULL), (8, '2026-09-13 17:59:59+00', NULL), (9, '2026-09-10 09:30:00+00', NULL)
) AS v(n, due_at, due_on);

-- Each actor: identical pages in both implementations, non-empty where the actor owns tasks.
SET request.jwt.claims TO :'a369_curator_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_curator_dated, (pg_temp.a369_compare_actor())[2] AS a369_curator_undated \gset
SELECT pg_temp.a369_assert(:a369_curator_dated > 0 AND :a369_curator_undated > 0, 'the curator comparison covered dated and undated rows');
SELECT pg_temp.a369_assert(pg_temp.a369_builder_equal(), 'the unwindowed builder equals the verbatim 217 builder for the curator');
SELECT pg_temp.a369_assert(
  platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 100)->>'total_count' = '7',
  'curator undated total: 4 case + 3 staff tasks');
SELECT pg_temp.a369_assert(
  platform.staff_personal_calendar_page_v1('dated', '2026-09-07', '2026-09-13', 100)->>'total_count' = '13',
  'curator dated week 2026-09-07..13 total: Bishkek day edges');
SELECT pg_temp.a369_assert(
  (SELECT string_agg(r->>'title', ',' ORDER BY ord) FROM jsonb_array_elements(
     platform.staff_personal_calendar_page_v1('dated', '2026-09-07', '2026-09-07', 100)->'rows') WITH ORDINALITY AS t(r, ord))
  = 'A369 case task 6,A369 case task 12,A369 staff task 0/7',
  'the 18:00 UTC deadline belongs to the next Bishkek day, 17:59:59 UTC to the previous one');
RESET ROLE;

-- The record-scoped curator: refused rows stay out of the pages and out of total_count, exactly as in the reference.
SELECT count(*) AS a369_refused_candidates FROM platform.case_tasks AS t JOIN platform.student_cases AS c ON c.id = t.student_case_id
WHERE t.id IN ('36936900-0000-4000-8000-000000000184', '36936900-0000-4000-8000-000000000186') AND t.assignee_membership_id = :'a369_curator3_membership'
  AND c.state IN ('active', 'closed') AND c.handoff_at IS NOT NULL \gset
SELECT pg_temp.a369_assert(:a369_refused_candidates = 2, 'the refused tasks are real candidates (assignee, handoff) that only staff_can_access can drop');
SET request.jwt.claims TO :'a369_curator3_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_curator3_dated, (pg_temp.a369_compare_actor())[2] AS a369_curator3_undated \gset
SELECT pg_temp.a369_assert(pg_temp.a369_builder_equal(), 'the unwindowed builder equals the verbatim 217 builder for the record-scoped curator');
SELECT pg_temp.a369_assert(:a369_curator3_dated = 1 AND :a369_curator3_undated = 0, 'only the allowed task is visible (dated 1, undated 0)');
SELECT pg_temp.a369_assert(
  (SELECT string_agg(r->>'task_id', ',') FROM jsonb_array_elements(platform.staff_personal_calendar_page_v1('dated', '2026-09-10', '2026-09-10', 100)->'rows') AS r)
    = '36936900-0000-4000-8000-000000000185'
  AND platform.staff_personal_calendar_page_v1('dated', '2026-09-10', '2026-09-10', 100)->>'total_count' = '1'
  AND platform.staff_personal_calendar_page_v1('dated', '2026-09-10', '2026-09-10', 100)
    = pg_temp.a369_ref_page('dated', '2026-09-10', '2026-09-10', 100, NULL, NULL, NULL)
  AND platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 100)->>'total_count' = '0'
  AND platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 100)
    = pg_temp.a369_ref_page('undated', NULL, NULL, 100, NULL, NULL, NULL),
  'a task refused by staff_can_access inside the window is absent and total_count equals the reference');
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'a369_sales_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_sales_dated, (pg_temp.a369_compare_actor())[2] AS a369_sales_undated \gset
SELECT pg_temp.a369_assert(:a369_sales_dated > 0 AND :a369_sales_undated > 0, 'the staff-tasks-only member comparison covered rows');
SELECT pg_temp.a369_assert(pg_temp.a369_builder_equal(), 'the unwindowed builder equals the verbatim 217 builder for the staff-tasks-only member');
SELECT pg_temp.a369_assert(NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(platform.staff_personal_calendar_page_v1('dated', '2026-01-01', '2026-12-31', 100)->'rows') AS r
  WHERE r->>'kind' <> 'staff'), 'a member without task.manage sees staff tasks only');
RESET ROLE;

SET request.jwt.claims TO :'a369_admin_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_admin_dated \gset
SELECT pg_temp.a369_assert(:a369_admin_dated > 0, 'the admin comparison covered rows');
SELECT pg_temp.a369_assert(pg_temp.a369_builder_equal(), 'the unwindowed builder equals the verbatim 217 builder for the admin');
RESET ROLE;

SET request.jwt.claims TO :'a369_curator2_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_curator2_dated \gset
SELECT pg_temp.a369_assert(:a369_curator2_dated > 0, 'the second curator comparison covered rows');
SELECT pg_temp.a369_assert(NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(platform.staff_personal_calendar_page_v1('dated', '2026-01-01', '2026-12-31', 100)->'rows') AS r
  WHERE r->>'assignee_membership_id' <> :'a369_curator2_membership'), 'a member sees only tasks assigned to them');
RESET ROLE;

SET request.jwt.claims TO :'a369_foreign_admin_claims';
SET ROLE authenticated;
SELECT (pg_temp.a369_compare_actor())[1] AS a369_foreign_dated \gset
SELECT pg_temp.a369_assert(:a369_foreign_dated > 0, 'the other-organisation comparison covered rows');
SELECT pg_temp.a369_assert(NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(platform.staff_personal_calendar_page_v1('dated', '2026-01-01', '2026-12-31', 100)->'rows') AS r
  WHERE r->>'organization_id' <> :'a369_foreign_org'), 'another organisation sees only its own tasks');
RESET ROLE;

-- A member without task permissions: the same refusal from both implementations.
SET request.jwt.claims TO :'a369_student_claims';
SET ROLE authenticated;
DO $a369_student$
DECLARE fresh_state TEXT; reference_state TEXT;
BEGIN
  BEGIN PERFORM platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 10);
  EXCEPTION WHEN OTHERS THEN fresh_state := SQLSTATE; END;
  BEGIN PERFORM pg_temp.a369_ref_page('undated', NULL, NULL, 10, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN reference_state := SQLSTATE; END;
  PERFORM pg_temp.a369_assert(fresh_state = '42501' AND reference_state = '42501',
    'a member without task permissions is refused with 42501 (new ' || COALESCE(fresh_state, 'none') || ', reference ' || COALESCE(reference_state, 'none') || ')');
END
$a369_student$;
RESET ROLE;
RESET request.jwt.claims;

-- The per-row permission helper runs only for rows inside the window: count its calls in this transaction.
SET track_functions = 'all';
SELECT 'platform_private.staff_can_access(uuid,uuid,text,text,uuid)'::regprocedure::OID AS a369_helper \gset
SET request.jwt.claims TO :'a369_curator_claims';
SET ROLE authenticated;
SELECT COALESCE(pg_catalog.pg_stat_get_xact_function_calls(:a369_helper), 0) AS a369_calls_before \gset
SELECT jsonb_array_length(platform.staff_personal_calendar_page_v1('dated', '2026-09-07', '2026-09-07', 100)->'rows') AS a369_day_rows \gset
SELECT COALESCE(pg_catalog.pg_stat_get_xact_function_calls(:a369_helper), 0) - :a369_calls_before AS a369_day_calls \gset
SELECT pg_temp.a369_assert(:a369_day_rows = 3 AND :a369_day_calls = 3,
  'a one-day window checks permissions for its 3 rows only, not for all 25 tasks (rows ' || :a369_day_rows || ', helper calls ' || :a369_day_calls || ')');
SELECT COALESCE(pg_catalog.pg_stat_get_xact_function_calls(:a369_helper), 0) AS a369_calls_before \gset
SELECT platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 100)->>'total_count' AS a369_undated_total \gset
SELECT COALESCE(pg_catalog.pg_stat_get_xact_function_calls(:a369_helper), 0) - :a369_calls_before AS a369_undated_calls \gset
SELECT pg_temp.a369_assert(:a369_undated_total::INTEGER = 7 AND :a369_undated_calls = 7,
  'the undated call checks permissions for its 7 rows only (helper calls ' || :a369_undated_calls || ')');
RESET ROLE;
RESET request.jwt.claims;
RESET track_functions;

-- Invalid arguments are refused exactly as before (22023), also from the new path.
SET request.jwt.claims TO :'a369_curator_claims';
SET ROLE authenticated;
DO $a369_invalid$
DECLARE bad TEXT[]; state TEXT;
BEGIN
  FOREACH bad SLICE 1 IN ARRAY ARRAY[
    ARRAY['week', NULL, NULL, '10'], ARRAY['dated', NULL, NULL, '10'], ARRAY['dated', '2026-09-10', '2026-09-01', '10'],
    ARRAY['undated', '2026-09-01', NULL, '10'], ARRAY['undated', NULL, NULL, '0'], ARRAY['undated', NULL, NULL, '101']
  ] LOOP
    state := NULL;
    BEGIN PERFORM platform.staff_personal_calendar_page_v1(bad[1], bad[2]::DATE, bad[3]::DATE, bad[4]::INTEGER);
    EXCEPTION WHEN OTHERS THEN state := SQLSTATE; END;
    PERFORM pg_temp.a369_assert(state = '22023', 'invalid page arguments ' || bad::TEXT || ' are refused with 22023, got ' || COALESCE(state, 'none'));
  END LOOP;
  state := NULL;
  BEGIN PERFORM platform.staff_personal_calendar_page_v1('undated', NULL, NULL, 10, now(), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN state := SQLSTATE; END;
  PERFORM pg_temp.a369_assert(state = '22023', 'a partial cursor is refused with 22023');
END
$a369_invalid$;
RESET ROLE;
RESET request.jwt.claims;

-- The target function still reaches its row through the unchanged two-argument call and keeps its ownership boundary.
SET request.jwt.claims TO :'a369_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.a369_assert(
  (platform.staff_personal_calendar_target_v1('staff', '36936900-0000-4000-8000-000000000201', NULL)->'task'->>'kind') = 'staff',
  'the target function finds the actor''s own staff task');
DO $a369_target$
DECLARE state TEXT;
BEGIN
  BEGIN PERFORM platform.staff_personal_calendar_target_v1('case', '36936900-0000-4000-8000-000000000182', '36936900-0000-4000-8000-000000000051');
  EXCEPTION WHEN OTHERS THEN state := SQLSTATE; END;
  PERFORM pg_temp.a369_assert(state = '42501', 'the target of a task assigned to somebody else stays refused');
END
$a369_target$;
RESET ROLE;
RESET request.jwt.claims;

-- The builder keeps its contract: SECURITY DEFINER, STABLE, empty search_path, and no grant for any client role.
SELECT pg_temp.a369_assert(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']::TEXT[]
   FROM pg_catalog.pg_proc AS p WHERE p.oid = 'platform_private.personal_calendar_rows_v1(text,uuid,text,date,date)'::regprocedure),
  'the builder keeps SECURITY DEFINER, STABLE and an empty search_path');
SELECT pg_temp.a369_assert(to_regprocedure('platform_private.personal_calendar_rows_v1(text,uuid)') IS NULL, 'the old two-argument builder is replaced, not layered');
SELECT pg_temp.a369_assert(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) AS role_name
  WHERE has_function_privilege(role_name, 'platform_private.personal_calendar_rows_v1(text,uuid,text,date,date)'::regprocedure, 'EXECUTE')),
  'no client role executes the builder');
SELECT pg_temp.a369_assert(
  has_function_privilege('authenticated', 'platform.staff_personal_calendar_page_v1(text,date,date,integer,timestamptz,text,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_personal_calendar_page_v1(text,date,date,integer,timestamptz,text,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.staff_personal_calendar_page_v1(text,date,date,integer,timestamptz,text,uuid)'::regprocedure, 'EXECUTE'),
  'only authenticated executes the page function');

\echo A369_PERSONAL_CALENDAR_WINDOW_SUITE_PASSED
ROLLBACK;
