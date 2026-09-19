\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 189 (OTH-4 «Uni & knowledge
-- base»). The synthetic organization, identities and case exist only inside
-- this rolled-back transaction -- same convention as
-- platform_university_application_geography.sql (118) and
-- platform_university_application_details.sql (112), which this suite is
-- modeled on. NOT executed by this session (the docker migration-boundary
-- suite is explicitly out of scope for this slice); read carefully before
-- trusting it green.
BEGIN;

CREATE FUNCTION pg_temp.p189_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 189 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p189_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The OLD platform.staff_application_page (118) is untouched by 189: its
-- exact OUT column set (26 columns, no author facts) must survive byte-for-
-- byte. This is a pure catalog check, no actors needed.
-- ---------------------------------------------------------------------------
DO $old_projection_contract$
DECLARE columns TEXT[]; rpc_name TEXT;
BEGIN
  SELECT array_agg(parameter_name ORDER BY ordinal_position)
  INTO columns
  FROM information_schema.parameters AS parameter
  JOIN information_schema.routines AS routine
    ON routine.specific_schema = parameter.specific_schema
   AND routine.specific_name = parameter.specific_name
  WHERE routine.routine_schema = 'platform'
    AND routine.routine_name = 'staff_application_page'
    AND parameter.parameter_mode = 'OUT';

  IF columns IS DISTINCT FROM ARRAY[
    'organization_id', 'university_application_id', 'version',
    'student_case_id', 'student_display_name', 'target_country',
    'target_degree', 'program_direction', 'intake', 'institution_name',
    'program_name', 'status', 'latest_evidence_reference', 'is_primary',
    'university_deadline_on', 'country', 'degree', 'created_at',
    'updated_at', 'responsible_sales_display_name',
    'current_curator_display_name', 'document_count', 'open_document_count',
    'task_count', 'open_task_count', 'payment_obligation_count',
    'outstanding_payment_obligation_count'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'platform.staff_application_page column set drifted from its pre-189 shape: %',
      columns;
  END IF;

  IF (
    SELECT count(*) FROM information_schema.routines
    WHERE routine_schema = 'platform' AND routine_name = 'staff_application_page'
  ) <> 1 THEN
    RAISE EXCEPTION 'platform.staff_application_page must still exist exactly once';
  END IF;

  -- The new v2 projection adds exactly the two author columns, at the end,
  -- on top of the same 26.
  SELECT array_agg(parameter_name ORDER BY ordinal_position)
  INTO columns
  FROM information_schema.parameters AS parameter
  JOIN information_schema.routines AS routine
    ON routine.specific_schema = parameter.specific_schema
   AND routine.specific_name = parameter.specific_name
  WHERE routine.routine_schema = 'platform'
    AND routine.routine_name = 'staff_application_page_v2'
    AND parameter.parameter_mode = 'OUT';

  IF columns IS DISTINCT FROM ARRAY[
    'organization_id', 'university_application_id', 'version',
    'student_case_id', 'student_display_name', 'target_country',
    'target_degree', 'program_direction', 'intake', 'institution_name',
    'program_name', 'status', 'latest_evidence_reference', 'is_primary',
    'university_deadline_on', 'country', 'degree', 'created_at',
    'updated_at', 'responsible_sales_display_name',
    'current_curator_display_name', 'document_count', 'open_document_count',
    'task_count', 'open_task_count', 'payment_obligation_count',
    'outstanding_payment_obligation_count', 'created_by_membership_id',
    'created_by_display_name'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'platform.staff_application_page_v2 column set drifted: %', columns;
  END IF;

  FOREACH rpc_name IN ARRAY ARRAY[
    'staff_application_page', 'staff_application_page_v2',
    'staff_application_snapshot', 'staff_application_snapshot_v2'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = rpc_name
        AND has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'authenticated must keep EXECUTE on platform.%', rpc_name;
    END IF;
  END LOOP;
END
$old_projection_contract$;

-- ---------------------------------------------------------------------------
-- Seed: one organization, one admin (is_system_admin) staff actor, one
-- student actor, one active case with NO catalog step needed (manual
-- institution_name path) -- same direct-INSERT shape
-- platform_university_application_details.sql (112) uses.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p189_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('18900000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p189_id(INTEGER) TO authenticated, service_role;

INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p189_id(1), 'Migration 189 organization');

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p189_id(2), pg_temp.p189_id(1), 'organization', pg_temp.p189_id(1), 1),
  (pg_temp.p189_id(3), pg_temp.p189_id(1), 'student_case', pg_temp.p189_id(20), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p189_id(101), 'p189-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p189_id(102), 'p189-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p189_id(201), pg_temp.p189_id(101), 'P189 Admin', 'active', 1),
  (pg_temp.p189_id(202), pg_temp.p189_id(102), 'P189 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
) VALUES
  (
    pg_temp.p189_id(301), pg_temp.p189_id(1), pg_temp.p189_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TRUE
  ),
  (
    pg_temp.p189_id(302), pg_temp.p189_id(1), pg_temp.p189_id(202), 'active', 'student',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'student' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  pg_temp.p189_id(401), pg_temp.p189_id(1), pg_temp.p189_id(301), pg_temp.p189_id(2),
  1, 1, TRUE, 'system', NULL, 'P189 admin org scope', pg_temp.p189_id(501)
);

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p189_id(20), pg_temp.p189_id(1), NULL,
  pg_temp.p189_id(301), NULL,
  'synthetic:p189:case', 'contract:p189', '2026-09-19T09:00:00Z',
  'P189 Student', 'Malaysia', 'Bachelor', 'Computer Science',
  '2027', 'approved', 'contract_confirmed', 'pending', NULL,
  NULL, 'Add a university from the catalog', pg_temp.p189_id(3), 1
);

-- Live JWT claims via the CURRENT production hook, never hand-built (same
-- convention as platform_cabinet_invites.sql / 185).
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p189_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p189_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p189_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p189_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p189_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p189_student_claims
\gset

-- ---------------------------------------------------------------------------
-- create with NULL program succeeds (OTH-4 part a).
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p189_admin_claims';
SET ROLE authenticated;

SELECT platform.create_university_application(
  pg_temp.p189_id(1), pg_temp.p189_id(20), 'Migration 189 University',
  NULL, 'preparation', NULL, NULL, TRUE, NULL, 'MY', 'bachelor', 0,
  pg_temp.p189_id(601)
) AS p189_create_result
\gset

RESET ROLE;
SELECT pg_temp.p189_assert(
  (:'p189_create_result'::JSONB ->> 'program_name') IS NULL,
  'NULL program was not accepted/echoed by create_university_application'
);
SELECT (:'p189_create_result'::JSONB ->> 'university_application_id')::UUID
  AS p189_application_id
\gset
SELECT pg_temp.p189_assert(
  (
    SELECT a.program_name IS NULL AND a.created_by_membership_id = pg_temp.p189_id(301)
    FROM platform.university_applications a WHERE a.id = :'p189_application_id'
  ),
  'stored row does not have a NULL program and the admin as author'
);

-- ---------------------------------------------------------------------------
-- v2 page/snapshot surface created_by_membership_id/created_by_display_name
-- for an authorized staff actor (OTH-4 part b); the OLD page must NOT.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p189_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p189_assert(
  EXISTS (
    SELECT 1 FROM platform.staff_application_page_v2(10, NULL, NULL, NULL, pg_temp.p189_id(20), NULL) AS page
    WHERE page.university_application_id = :'p189_application_id'
      AND page.created_by_membership_id = pg_temp.p189_id(301)
      AND page.created_by_display_name = 'P189 Admin'
      AND page.program_name IS NULL
  ),
  'staff_application_page_v2 did not surface the author for an authorized staff actor'
);
SELECT pg_temp.p189_assert(
  EXISTS (
    SELECT 1 FROM platform.staff_application_snapshot_v2(:'p189_application_id') AS snapshot
    WHERE snapshot.created_by_membership_id = pg_temp.p189_id(301)
      AND snapshot.created_by_display_name = 'P189 Admin'
  ),
  'staff_application_snapshot_v2 did not surface the author for an authorized staff actor'
);
SELECT pg_temp.p189_assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name ~ '^staff_application_page$'
  ),
  'staff_application_page is a function, not a table -- sanity guard for the check above'
);
SELECT pg_temp.p189_assert(
  (
    SELECT to_jsonb(page) ? 'created_by_membership_id'
    FROM platform.staff_application_page(10, NULL, NULL, NULL, pg_temp.p189_id(20), NULL) AS page
    WHERE page.university_application_id = :'p189_application_id'
  ) IS NOT TRUE,
  'the OLD staff_application_page unexpectedly gained the new author column'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Student role denied: the same application id is invisible to a Student
-- actor through the staff-only v2 page (private.platform_can_read_student_case
-- requires case.read.full, a staff-bundle permission a Student never holds).
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p189_student_claims';
SET ROLE authenticated;

SELECT pg_temp.p189_assert(
  NOT EXISTS (
    SELECT 1 FROM platform.staff_application_page_v2(10, NULL, NULL, NULL, NULL, :'p189_application_id') AS page
  ),
  'a Student actor unexpectedly read an application through staff_application_page_v2'
);
SELECT pg_temp.p189_assert(
  NOT EXISTS (
    SELECT 1 FROM platform.staff_application_snapshot_v2(:'p189_application_id') AS snapshot
  ),
  'a Student actor unexpectedly read an application through staff_application_snapshot_v2'
);

RESET ROLE;

SELECT 'P189_APPLICATION_AUTHOR_SUITE_OK' AS p189_suite_marker;

ROLLBACK;
