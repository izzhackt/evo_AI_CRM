\set ON_ERROR_STOP on
-- Boundary suite for migration 370: the «Студенты» queue counts read the set of readable cases once instead of asking
-- private.platform_can_read_student_case for every case of the organization. Nothing may move: for every actor, view and
-- filter combination platform.staff_student_case_queue_counts_v1 must return EXACTLY what the pre-370 definition returned.
-- That definition is kept below as pg_temp.n370_counts_reference (the 241 body with the 242, 244 and 245 changes: the
-- 'pending' view, the student gate, case_queue_flags) and still calls the row-by-row check, so the comparison is against
-- the old logic and not against itself. Isolated synthetic SQL fixtures only -- no Auth invitation, real customer, provider
-- or production action. Fixture style follows platform_case_queue_pending_view.sql (242).
BEGIN;

CREATE FUNCTION pg_temp.n370_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n370_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N370: %', message; END IF;
END
$$;

-- The pre-370 body, verbatim except for its name (taken from the chain at the 369 boundary).
CREATE FUNCTION pg_temp.n370_counts_reference(p_view text, p_direction text, p_curator_membership_id uuid, p_pipeline_stage text, p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $reference$
DECLARE
  a RECORD;
  today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
  q TEXT := NULLIF(btrim(p_query), '');
  result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role IS NOT DISTINCT FROM 'student'
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_view IS NULL OR p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending')
    OR (p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown'))
    OR (p_pipeline_stage IS NOT NULL AND p_pipeline_stage NOT IN ('new', 'shortlist', 'documents',
      'ready_to_submit', 'awaiting_decision', 'confirmed', 'visa', 'predeparture', 'arrived'))
    OR (p_query IS NOT NULL AND char_length(p_query) > 200)
  THEN
    RAISE EXCEPTION 'Invalid student case queue request' USING ERRCODE = '22023';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT c.id, c.state, c.pipeline_stage, c.current_curator_membership_id AS curator_id,
      COALESCE(c.admissions_direction, 'unknown') AS direction_key,
      COALESCE(c.current_curator_membership_id = a.membership_id, FALSE) AS is_mine,
      CASE WHEN c.state IN ('active', 'pending') THEN platform_private.case_queue_flags(c.id) END AS flags,
      platform_private.case_next_action_band(c.next_action, c.next_action_due_on, today) AS band,
      (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction) AS m_direction,
      (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id) AS m_curator,
      (p_pipeline_stage IS NULL OR c.pipeline_stage = p_pipeline_stage) AS m_stage
    FROM platform.student_cases AS c
    WHERE c.organization_id = a.organization_id
      AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,
        c.target_degree, c.program_direction)), lower(q)) > 0)
      AND private.platform_can_read_student_case(c.organization_id, c.id)
  ), viewed AS MATERIALIZED (
    SELECT base.*, platform_private.case_queue_in_view(p_view, base.state, base.is_mine, base.flags) AS in_view
    FROM base
  )
  SELECT jsonb_build_object(
    'view', p_view,
    'today', to_char(today, 'YYYY-MM-DD'),
    'views', (SELECT jsonb_build_object(
      'mine', count(*) FILTER (WHERE platform_private.case_queue_in_view('mine', state, is_mine, flags)),
      'needs_action', count(*) FILTER (WHERE platform_private.case_queue_in_view('needs_action', state, is_mine, flags)),
      'active', count(*) FILTER (WHERE platform_private.case_queue_in_view('active', state, is_mine, flags)),
      'needs_curator', count(*) FILTER (WHERE platform_private.case_queue_in_view('needs_curator', state, is_mine, flags)),
      'closed', count(*) FILTER (WHERE platform_private.case_queue_in_view('closed', state, is_mine, flags)),
      'pending', count(*) FILTER (WHERE platform_private.case_queue_in_view('pending', state, is_mine, flags)))
      FROM base WHERE m_direction AND m_curator AND m_stage),
    'total', (SELECT count(*) FROM viewed WHERE in_view AND m_direction AND m_curator AND m_stage),
    'bands', (SELECT jsonb_build_object(
      'overdue', count(*) FILTER (WHERE band = 'overdue'),
      'today', count(*) FILTER (WHERE band = 'today'),
      'this_week', count(*) FILTER (WHERE band = 'this_week'),
      'later', count(*) FILTER (WHERE band = 'later'),
      'undated', count(*) FILTER (WHERE band = 'undated'),
      'no_step', count(*) FILTER (WHERE band = 'no_step'))
      FROM viewed WHERE in_view AND m_direction AND m_curator AND m_stage),
    'directions', COALESCE((SELECT jsonb_agg(jsonb_build_object('direction', facet.direction_key, 'count', facet.n)
      ORDER BY facet.direction_key)
      FROM (SELECT direction_key, count(*) AS n FROM viewed
        WHERE in_view AND m_curator AND m_stage GROUP BY direction_key) AS facet), '[]'::JSONB),
    'curators', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'membership_id', facet.curator_id, 'display_name', curator_profile.display_name,
        'is_me', facet.curator_id = a.membership_id, 'count', facet.n)
      ORDER BY facet.curator_id = a.membership_id DESC, lower(curator_profile.display_name), facet.curator_id)
      FROM (SELECT curator_id, count(*) AS n FROM viewed
        WHERE in_view AND m_direction AND m_stage AND curator_id IS NOT NULL GROUP BY curator_id) AS facet
      LEFT JOIN platform.organization_memberships AS curator_membership
        ON curator_membership.organization_id = a.organization_id AND curator_membership.id = facet.curator_id
      LEFT JOIN platform.profiles AS curator_profile ON curator_profile.id = curator_membership.profile_id), '[]'::JSONB),
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('pipeline_stage', facet.pipeline_stage, 'count', facet.n)
      ORDER BY array_position(ARRAY['new', 'shortlist', 'documents', 'ready_to_submit', 'awaiting_decision',
        'confirmed', 'visa', 'predeparture', 'arrived']::TEXT[], facet.pipeline_stage))
      FROM (SELECT pipeline_stage, count(*) AS n FROM viewed
        WHERE in_view AND m_direction AND m_curator GROUP BY pipeline_stage) AS facet), '[]'::JSONB)
  ) INTO result;
  RETURN result;
END
$reference$;

-- A read's outcome as comparable text: the JSON answer, or the SQLSTATE of the refusal.
CREATE FUNCTION pg_temp.n370_outcome(p_reference BOOLEAN, p_view TEXT, p_direction TEXT, p_curator UUID, p_stage TEXT, p_query TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF p_reference THEN
    RETURN pg_temp.n370_counts_reference(p_view, p_direction, p_curator, p_stage, p_query)::TEXT;
  END IF;
  RETURN platform.staff_student_case_queue_counts_v1(p_view, p_direction, p_curator, p_stage, p_query)::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE;
END
$$;

-- Old and new agree on every view and on the filter combinations (each filter alone, all together, a query that
-- matches nothing, an invalid value). Returns how many combinations were compared.
CREATE FUNCTION pg_temp.n370_same(p_label TEXT, p_curator_a UUID, p_curator_b UUID) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v TEXT; f RECORD; compared INTEGER := 0; old_answer TEXT; new_answer TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending', 'bogus', NULL] LOOP
    FOR f IN SELECT * FROM (VALUES
      (NULL, NULL::UUID, NULL, NULL),
      ('CN', NULL, NULL, NULL),
      ('MY', NULL, NULL, NULL),
      ('unknown', NULL, NULL, NULL),
      ('EUROPE', NULL, NULL, NULL),
      (NULL, p_curator_a, NULL, NULL),
      (NULL, p_curator_b, NULL, NULL),
      (NULL, NULL, 'documents', NULL),
      (NULL, NULL, 'new', NULL),
      (NULL, NULL, NULL, 'alpha'),
      (NULL, NULL, NULL, '  BETA  '),
      (NULL, NULL, NULL, 'no such student'),
      ('CN', p_curator_a, 'new', NULL),
      ('CN', NULL, 'documents', 'student'),
      ('BOGUS', NULL, NULL, NULL),
      (NULL, NULL, 'nowhere', NULL)
    ) AS t(direction, curator, stage, query) LOOP
      old_answer := pg_temp.n370_outcome(TRUE, v, f.direction, f.curator, f.stage, f.query);
      new_answer := pg_temp.n370_outcome(FALSE, v, f.direction, f.curator, f.stage, f.query);
      IF old_answer IS DISTINCT FROM new_answer THEN
        RAISE EXCEPTION 'N370: % differs for view=% direction=% curator=% stage=% query=%: old % new %',
          p_label, v, f.direction, f.curator, f.stage, f.query, old_answer, new_answer;
      END IF;
      compared := compared + 1;
    END LOOP;
  END LOOP;
  RETURN compared;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n370_id(INTEGER), pg_temp.n370_assert(BOOLEAN, TEXT),
  pg_temp.n370_counts_reference(TEXT, TEXT, UUID, TEXT, TEXT),
  pg_temp.n370_outcome(BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT), pg_temp.n370_same(TEXT, UUID, UUID)
  TO authenticated, anon, service_role;

SELECT 'N370_QUEUE_COUNTS_SPEED_SUITE_START' AS n370_suite_marker;

-- ---------------------------------------------------------------------------
-- The migration replaced the row-by-row decision and nothing else.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n370_assert(
  (SELECT strpos(p.prosrc, 'private.platform_can_read_student_case') = 0
     AND strpos(p.prosrc, 'staff_readable_case_ids_for_actor_v1') > 0
     AND strpos(p.prosrc, 'platform_private.case_queue_flags(c.id)') > 0
   FROM pg_catalog.pg_proc AS p WHERE p.oid = 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure),
  'counts read the readable set and still compute the flags chain');
SELECT pg_temp.n370_assert(
  (SELECT strpos(p.prosrc, 'private.platform_can_read_student_case(c.organization_id, c.id)') > 0
   FROM pg_catalog.pg_proc AS p WHERE p.oid = 'pg_temp.n370_counts_reference(text,text,uuid,text,text)'::regprocedure),
  'the reference still decides row by row, so the comparison is against the old logic');
SELECT pg_temp.n370_assert(
  (SELECT n.prosecdef AND n.proconfig = o.proconfig AND n.provolatile = o.provolatile AND n.prorettype = o.prorettype
   FROM pg_catalog.pg_proc AS n, pg_catalog.pg_proc AS o
   WHERE n.oid = 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure
     AND o.oid = 'pg_temp.n370_counts_reference(text,text,uuid,text,text)'::regprocedure),
  'same security, volatility and result type as before');
SELECT pg_temp.n370_assert(
  NOT has_function_privilege('anon', 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)', 'EXECUTE'),
  'grants are unchanged: authenticated only');

-- ---------------------------------------------------------------------------
-- Fixture. Organization A: admin (1), sales (2), curator A (3), manager with full case read on the organization (4),
-- curator B (6), a department manager (8) holding case.read.full and case.curator.assign for department D only. Organization B: its own admin (7). Staff roles come through the installed commands.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n370_actors(n INTEGER, org INTEGER, role platform.business_role, claims TEXT);
INSERT INTO n370_actors(n, org, role) VALUES
  (1, 1, 'admin'), (2, 1, 'sales'), (3, 1, 'curator'), (4, 1, NULL), (6, 1, 'curator'), (7, 2, 'admin'), (8, 1, NULL);
GRANT SELECT ON n370_actors TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.n370_id(1), 'N370 Fictional organization A'), (pg_temp.n370_id(2), 'N370 Fictional organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n370_id(100 + n), 'n370-' || n || '@example.invalid', '{}'::JSONB FROM n370_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n370_id(200 + n), pg_temp.n370_id(100 + n), 'N370 Actor ' || n, 'active', 1 FROM n370_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n370_id(300 + n), pg_temp.n370_id(org), pg_temp.n370_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM n370_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n370_id(301), pg_temp.n370_id(307));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n370_id(401), pg_temp.n370_id(1), 'organization', pg_temp.n370_id(1), 1),
  (pg_temp.n370_id(402), pg_temp.n370_id(2), 'organization', pg_temp.n370_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.n370_id(1), pg_temp.n370_id(301), pg_temp.n370_id(401), 1, 1, TRUE, 'system',
    'N370 synthetic organization scope', pg_temp.n370_id(601)),
  (pg_temp.n370_id(2), pg_temp.n370_id(307), pg_temp.n370_id(402), 1, 1, TRUE, 'system',
    'N370 synthetic organization scope', pg_temp.n370_id(602));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n370_id(420 + k), pg_temp.n370_id(CASE WHEN k >= 11 THEN 2 ELSE 1 END), 'student_case', pg_temp.n370_id(500 + k), 1
  FROM generate_series(1, 13) AS k;

CREATE TEMP TABLE n370_today AS SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS d;
GRANT SELECT ON n370_today TO authenticated;

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES (pg_temp.n370_id(801), pg_temp.n370_id(1), 'N370 Department D');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n370_id(1), pg_temp.n370_id(303), pg_temp.n370_id(801)),
  (pg_temp.n370_id(1), pg_temp.n370_id(308), pg_temp.n370_id(801));
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  VALUES (pg_temp.n370_id(810), pg_temp.n370_id(1), 'N370 Client 10', platform_private.normalize_person_name('N370 Client 10'));
INSERT INTO platform.leads(id, organization_id, client_id, stage_key, source_key)
  VALUES (pg_temp.n370_id(811), pg_temp.n370_id(1), pg_temp.n370_id(810), 'new', 'n370');

SET LOCAL session_replication_role = replica;
-- Organization A (cases 1-10) and organization B (11-13): every state, direction (and none), stage, curator (and none),
-- step band (overdue, today, later, none) and name the filters use.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, closed_at, current_scope_id, current_scope_version,
  admissions_direction, pipeline_stage, next_action, next_action_due_on
)
SELECT pg_temp.n370_id(500 + f.k), pg_temp.n370_id(f.org),
  pg_temp.n370_id(CASE WHEN f.org = 1 THEN 302 ELSE 307 END),
  CASE f.curator WHEN 'a' THEN pg_temp.n370_id(303) WHEN 'b' THEN pg_temp.n370_id(306) WHEN 'm' THEN pg_temp.n370_id(304) WHEN 'x' THEN pg_temp.n370_id(307) END,
  'synthetic:n370:' || f.k, f.student_name, f.country, 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state,
  CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END,
  pg_temp.n370_id(420 + f.k), 1, f.direction, f.stage, f.step,
  CASE WHEN f.due_offset IS NULL THEN NULL ELSE (SELECT d FROM n370_today) + f.due_offset END
FROM (VALUES
  (1, 1, 'active', 'a', 'Alpha Student 1', 'CN', 'CN', 'new', 'Шаг 1', -3),
  (2, 1, 'pending', NULL, 'Beta Student 2', 'MY', 'MY', 'shortlist', NULL, NULL),
  (3, 1, 'pending', NULL, 'Alpha Student 3', 'CN', NULL, 'new', 'Шаг 3', 2),
  (4, 1, 'closed', 'a', 'Gamma Student 4', 'IT', 'EUROPE', 'new', 'Шаг 4', -5),
  (5, 1, 'active', 'b', 'Beta Student 5', 'TR', 'TR', 'new', NULL, NULL),
  (6, 1, 'active', 'b', 'Delta Student 6', 'CN', 'CN', 'documents', 'Шаг 6', 0),
  (7, 1, 'active', 'a', 'Alpha Student 7', 'MY', 'MY', 'documents', 'Шаг 7', 20),
  (8, 1, 'active', 'm', 'Beta Student 8', 'CN', NULL, 'new', NULL, NULL),
  (9, 1, 'pending', NULL, 'Epsilon Student 9', 'AE', 'AE', 'new', 'Шаг 9', 1),
  (10, 1, 'pending', NULL, 'Alpha Student 10', 'CN', NULL, 'new', NULL, NULL),
  (11, 2, 'active', 'x', 'Alpha Student 11', 'CN', 'CN', 'new', 'Шаг 11', -1),
  (12, 2, 'pending', NULL, 'Beta Student 12', 'MY', 'MY', 'new', NULL, NULL),
  (13, 2, 'closed', 'x', 'Zeta Student 13', 'CN', 'CN', 'documents', 'Шаг 13', 3)
) AS f(k, org, state, curator, student_name, country, direction, stage, step, due_offset);
-- Case 10: declined by curator A (lifecycle event 'declined') with a sale behind its lead (a register row), no curator:
-- the case that the case-curator-assignment path (staff_can_take_needs_curator_case) makes readable for a department
-- manager who is not the last curator, although case.read.full alone does not reach it.
UPDATE platform.student_cases SET canonical_lead_id = pg_temp.n370_id(811), canonical_client_id = pg_temp.n370_id(810)
  WHERE id = pg_temp.n370_id(510);
INSERT INTO platform.student_case_lifecycle_events(organization_id, student_case_id, event_type, previous_state,
  new_state, actor_membership_id, reason, request_id)
  VALUES (pg_temp.n370_id(1), pg_temp.n370_id(510), 'declined', 'active', 'pending', pg_temp.n370_id(303), 'N370 declined',
    pg_temp.n370_id(7001));
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  lead_id, client_id, source_snapshot)
VALUES (pg_temp.n370_id(9100), pg_temp.n370_id(1), DATE '2026-09-01', pg_temp.n370_id(302), 'pipeline',
  jsonb_build_object('applicant_name', 'N370 Sale', 'phone', '', 'signing_date', DATE '2026-09-03', 'manager_label', 'N370 Manager',
    'status_raw', '', 'service_cost_minor', 50000, 'service_cost_currency', 'USD', 'paid_minor', 50000,
    'paid_currency', 'USD', 'needs_review', FALSE),
  pg_temp.n370_id(811), pg_temp.n370_id(810), '{"review_flags":[]}'::JSONB);
-- A chat waiting for staff on case 6 (a flag of 245), so the flags chain is not trivially empty.
INSERT INTO platform.case_chat_threads(organization_id, student_case_id, await_state, last_message_at, last_message_sequence_id)
  VALUES (pg_temp.n370_id(1), pg_temp.n370_id(506), 'needs_reply', clock_timestamp(), 1);
SET LOCAL session_replication_role = origin;

-- Staff roles: the curators read their own cases only; the manager reads the whole organization A; Sales holds the
-- summary keys (no case.read.full, so the read refuses it).
CREATE TEMP TABLE n370_roles(role_id UUID, org INTEGER, admin_n INTEGER, membership_id UUID, keys JSONB, request_base INTEGER, scope JSONB);
INSERT INTO n370_roles VALUES
  (pg_temp.n370_id(701), 1, 1, pg_temp.n370_id(303), '["case.read.full","case.route.manage","case.update.append"]', 710,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n370_id(702), 1, 1, pg_temp.n370_id(302), '["lead.read","case.read.summary","document.read.sales","task.create"]', 720,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n370_id(703), 1, 1, pg_temp.n370_id(304), '["case.read.full","case.route.manage","case.update.append"]', 730,
    jsonb_build_object('kind', 'organization', 'key', pg_temp.n370_id(1)::TEXT, 'resourceKind', NULL)),
  (pg_temp.n370_id(704), 1, 1, pg_temp.n370_id(306), '["case.read.full","case.route.manage","case.update.append"]', 740,
    '{"kind": "own", "key": null, "resourceKind": null}'),
  (pg_temp.n370_id(705), 1, 1, pg_temp.n370_id(308), '["case.read.full","case.curator.assign"]', 750,
    jsonb_build_object('kind', 'department', 'key', pg_temp.n370_id(801)::TEXT, 'resourceKind', NULL));
GRANT SELECT ON n370_roles TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n370_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n370_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n370_admin \gset
SET LOCAL request.jwt.claims TO :'n370_admin';
SET LOCAL ROLE authenticated;
DO $n370_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM n370_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n370_id(r.org), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N370 role ' || r.request_base, 'description', 'Migration 370 synthetic role',
        'permissionKeys', r.keys), 'N370 create role', pg_temp.n370_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n370_id(r.org), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n370_id(r.org), r.role_id, 1) ->> 'impactFingerprint',
      'N370 publish role', pg_temp.n370_id(r.request_base + 2));
    PERFORM platform.staff_role_assignments_save(pg_temp.n370_id(r.org), r.membership_id,
      (SELECT p.access_version FROM platform.organization_memberships AS m JOIN platform.profiles AS p ON p.id = m.profile_id
       WHERE m.id = r.membership_id),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'scope', r.scope)),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'roleVersion', 2,
        'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'N370 grant role', pg_temp.n370_id(r.request_base + 3));
  END LOOP;
END
$n370_roles$;
RESET ROLE;

UPDATE n370_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n370_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n370_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n370_admin FROM n370_actors WHERE n = 1 \gset
SELECT claims AS n370_sales FROM n370_actors WHERE n = 2 \gset
SELECT claims AS n370_curator_a FROM n370_actors WHERE n = 3 \gset
SELECT claims AS n370_manager FROM n370_actors WHERE n = 4 \gset
SELECT claims AS n370_curator_b FROM n370_actors WHERE n = 6 \gset
SELECT claims AS n370_admin_b FROM n370_actors WHERE n = 7 \gset
SELECT claims AS n370_dept FROM n370_actors WHERE n = 8 \gset
SELECT pg_temp.n370_assert((SELECT count(*) = 7 FROM n370_actors
  WHERE claims::JSONB ->> 'platform_membership_id' = pg_temp.n370_id(300 + n)::TEXT), 'staff claims resolve to their memberships');

-- The case-curator-assignment path is really exercised: the department manager (8) reads declined case 10 through it and
-- not through case.read.full, and the pre-370 row check agrees.
SELECT pg_temp.n370_assert(
  pg_temp.n370_id(510) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.n370_id(1), pg_temp.n370_id(308)) AS v(id)))
  AND NOT pg_temp.n370_id(510) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_v1(pg_temp.n370_id(1), pg_temp.n370_id(308), 'case.read.full', 'student_case') AS v(id)))
  AND platform_private.staff_can_take_needs_curator_case(pg_temp.n370_id(1), pg_temp.n370_id(308), pg_temp.n370_id(510)),
  'case 10 is readable for the department manager only through the needs-curator path');

-- ---------------------------------------------------------------------------
-- Admin of A: every state, filter and view equals the old answer; the numbers are not vacuous.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n370_assert(pg_temp.n370_same('admin A', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'admin A: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'active')::INTEGER = 5,
  'admin A reads the five active cases of its own organization (and none of B)');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 4,
  'admin A: four pending cases');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'needs_action')::INTEGER > 0,
  'the flags chain produces flags: the needs_action tab is not empty');
SELECT pg_temp.n370_assert(jsonb_array_length(platform.staff_student_case_queue_counts_v1('active') -> 'directions') >= 3
  AND jsonb_array_length(platform.staff_student_case_queue_counts_v1('active') -> 'curators') = 3
  AND jsonb_array_length(platform.staff_student_case_queue_counts_v1('active') -> 'stages') >= 2,
  'facets are populated, so direction, curator and stage filters are exercised');

-- ---------------------------------------------------------------------------
-- Curator A (own scope): sees only the cases assigned to them; old and new agree, and the set really narrows the numbers.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_curator_a';
SELECT pg_temp.n370_assert(pg_temp.n370_same('curator A', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'curator A: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'active')::INTEGER = 2
  AND (platform.staff_student_case_queue_counts_v1('closed') -> 'views' ->> 'closed')::INTEGER = 1,
  'curator A counts only own cases: two active, one closed');

-- ---------------------------------------------------------------------------
-- Curator B (own scope), and the manager with full case read on the organization (reads unassigned pending cases too).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_curator_b';
SELECT pg_temp.n370_assert(pg_temp.n370_same('curator B', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'curator B: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'active')::INTEGER = 2,
  'curator B counts only own cases');
SET LOCAL request.jwt.claims TO :'n370_manager';
SELECT pg_temp.n370_assert(pg_temp.n370_same('manager', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'manager: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 4,
  'the manager with the organization scope reads the unassigned pending cases');

-- ---------------------------------------------------------------------------
-- The department manager (case.read.full and case.curator.assign for department D): the needs-curator path adds case 10 to
-- what the department scope gives; old and new agree everywhere, and the manager sees fewer cases than the admin.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_dept';
SELECT pg_temp.n370_assert(pg_temp.n370_same('department manager', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16,
  'department manager: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 1
  AND (platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'needs_curator')::INTEGER = 1
  AND (platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'active')::INTEGER = 2
  AND (platform.staff_student_case_queue_counts_v1('closed') -> 'views' ->> 'closed')::INTEGER = 1,
  'the department manager reads the declined case 10 (a needs_curator flag, the only pending case) and the department''s own cases (curator A: two active, one closed), nothing else');

-- ---------------------------------------------------------------------------
-- A member without case read (Sales): refused before any case is touched, exactly as before.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_sales';
SELECT pg_temp.n370_assert(pg_temp.n370_outcome(FALSE, 'active', NULL, NULL, NULL, NULL) = 'ERR:42501'
  AND pg_temp.n370_outcome(TRUE, 'active', NULL, NULL, NULL, NULL) = 'ERR:42501', 'Sales is refused by old and new alike');
SELECT pg_temp.n370_assert(pg_temp.n370_same('sales', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'Sales: all combinations compared');

-- ---------------------------------------------------------------------------
-- Another organization: its admin reads only B (3 cases); A's numbers never include it and B's never include A.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n370_admin_b';
SELECT pg_temp.n370_assert(pg_temp.n370_same('admin B', pg_temp.n370_id(303), pg_temp.n370_id(306)) = 8 * 16, 'admin B: all combinations compared');
SELECT pg_temp.n370_assert((platform.staff_student_case_queue_counts_v1('active') -> 'views' ->> 'active')::INTEGER = 1
  AND (platform.staff_student_case_queue_counts_v1('pending') -> 'views' ->> 'pending')::INTEGER = 1
  AND (platform.staff_student_case_queue_counts_v1('closed') -> 'views' ->> 'closed')::INTEGER = 1,
  'admin B reads exactly the three cases of organization B');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- No identity: refused by both.
-- ---------------------------------------------------------------------------
RESET request.jwt.claims;
SET LOCAL ROLE anon;
SELECT pg_temp.n370_assert(pg_temp.n370_outcome(FALSE, 'active', NULL, NULL, NULL, NULL) = 'ERR:42501'
  AND pg_temp.n370_outcome(TRUE, 'active', NULL, NULL, NULL, NULL) = 'ERR:42501', 'anon is refused by old and new alike');
RESET ROLE;

SELECT 'N370_QUEUE_COUNTS_SPEED_SUITE_PASSED' AS n370_suite_marker;
ROLLBACK;
