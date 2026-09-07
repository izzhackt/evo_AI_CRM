\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 124. All rows are synthetic and
-- rolled back; this file is intended for an isolated local PostgreSQL contour.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.p124_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 124 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p124_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN pg_catalog.jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p124_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p124_capture_error(TEXT)
  TO authenticated, service_role;

-- Exposed RPCs stay invoker wrappers; privileged bodies stay private and only
-- authenticated staff may execute either hop.
DO $catalog_contract$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  FOR contract IN
    SELECT * FROM (
      VALUES
        (
          'private.staff_case_task_undated_page(integer,timestamp with time zone,uuid)',
          TRUE
        ),
        (
          'platform.staff_case_task_undated_page(integer,timestamp with time zone,uuid)',
          FALSE
        ),
        (
          'private.staff_application_deadline_page(integer,date,uuid,date,date)',
          TRUE
        ),
        (
          'platform.staff_application_deadline_page(integer,date,uuid,date,date)',
          FALSE
        ),
        ('platform.staff_nearest_application_deadline()', FALSE)
    ) AS expected(signature, must_be_definer)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature);
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 124 routine is missing: %', contract.signature;
    END IF;
    SELECT * INTO STRICT routine_row FROM pg_catalog.pg_proc WHERE oid = routine_oid;
    IF routine_row.prosecdef IS DISTINCT FROM contract.must_be_definer
      OR routine_row.provolatile <> 's'
      OR routine_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    THEN
      RAISE EXCEPTION 'Migration 124 routine security drifted: %', contract.signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', contract.signature;
    END IF;
    FOREACH forbidden_role IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin']
    LOOP
      IF pg_catalog.has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes %', forbidden_role, contract.signature;
      END IF;
    END LOOP;
  END LOOP;
END
$catalog_contract$;

SELECT bundle.id AS p124_admin_bundle, bundle.version AS p124_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p124_sales_bundle, bundle.version AS p124_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p124_curator_bundle, bundle.version AS p124_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p124_student_bundle, bundle.version AS p124_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p124_org 12412400-0000-4000-8000-000000000001
\set p124_foreign_org 12412400-0000-4000-8000-000000000002
\set p124_org_scope 12412400-0000-4000-8000-000000000011
\set p124_case_scope 12412400-0000-4000-8000-000000000012
\set p124_closed_scope 12412400-0000-4000-8000-000000000013
\set p124_foreign_scope 12412400-0000-4000-8000-000000000014
\set p124_foreign_case_scope 12412400-0000-4000-8000-000000000015

\set p124_admin_user 12412400-0000-4000-8000-000000000021
\set p124_sales_user 12412400-0000-4000-8000-000000000022
\set p124_curator_user 12412400-0000-4000-8000-000000000023
\set p124_student_user 12412400-0000-4000-8000-000000000024
\set p124_foreign_sales_user 12412400-0000-4000-8000-000000000025
\set p124_foreign_curator_user 12412400-0000-4000-8000-000000000026
\set p124_foreign_student_user 12412400-0000-4000-8000-000000000027
\set p124_admin_profile 12412400-0000-4000-8000-000000000031
\set p124_sales_profile 12412400-0000-4000-8000-000000000032
\set p124_curator_profile 12412400-0000-4000-8000-000000000033
\set p124_student_profile 12412400-0000-4000-8000-000000000034
\set p124_foreign_sales_profile 12412400-0000-4000-8000-000000000035
\set p124_foreign_curator_profile 12412400-0000-4000-8000-000000000036
\set p124_foreign_student_profile 12412400-0000-4000-8000-000000000037

\set p124_admin_membership 12412400-0000-4000-8000-000000000041
\set p124_sales_membership 12412400-0000-4000-8000-000000000042
\set p124_curator_membership 12412400-0000-4000-8000-000000000043
\set p124_student_membership 12412400-0000-4000-8000-000000000044
\set p124_foreign_sales_membership 12412400-0000-4000-8000-000000000046
\set p124_foreign_curator_membership 12412400-0000-4000-8000-000000000047
\set p124_foreign_student_membership 12412400-0000-4000-8000-000000000048

\set p124_case 12412400-0000-4000-8000-000000000051
\set p124_closed_case 12412400-0000-4000-8000-000000000052
\set p124_foreign_case 12412400-0000-4000-8000-000000000053

INSERT INTO platform.organizations (id, name) VALUES
  (:'p124_org', 'Migration 124 Organization'),
  (:'p124_foreign_org', 'Migration 124 Foreign Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p124_org_scope', :'p124_org', 'organization', :'p124_org', 1),
  (:'p124_case_scope', :'p124_org', 'student_case', :'p124_case', 1),
  (:'p124_closed_scope', :'p124_org', 'student_case', :'p124_closed_case', 1),
  (:'p124_foreign_scope', :'p124_foreign_org', 'organization', :'p124_foreign_org', 1),
  (:'p124_foreign_case_scope', :'p124_foreign_org', 'student_case', :'p124_foreign_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p124_admin_user', 'p124-admin@example.invalid', '{}'::JSONB),
  (:'p124_sales_user', 'p124-sales@example.invalid', '{}'::JSONB),
  (:'p124_curator_user', 'p124-curator@example.invalid', '{}'::JSONB),
  (:'p124_student_user', 'p124-student@example.invalid', '{}'::JSONB),
  (:'p124_foreign_sales_user', 'p124-foreign-sales@example.invalid', '{}'::JSONB),
  (:'p124_foreign_curator_user', 'p124-foreign-curator@example.invalid', '{}'::JSONB),
  (:'p124_foreign_student_user', 'p124-foreign-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p124_admin_profile', :'p124_admin_user', 'P124 Admin', 'active', 1),
  (:'p124_sales_profile', :'p124_sales_user', 'P124 Sales', 'active', 1),
  (:'p124_curator_profile', :'p124_curator_user', 'P124 Curator', 'active', 1),
  (:'p124_student_profile', :'p124_student_user', 'P124 Student', 'active', 1),
  (:'p124_foreign_sales_profile', :'p124_foreign_sales_user', 'P124 Foreign Sales', 'active', 1),
  (:'p124_foreign_curator_profile', :'p124_foreign_curator_user', 'P124 Foreign Curator', 'active', 1),
  (:'p124_foreign_student_profile', :'p124_foreign_student_user', 'P124 Foreign Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p124_admin_membership', :'p124_org', :'p124_admin_profile', 'active', 'admin', :'p124_admin_bundle'),
  (:'p124_sales_membership', :'p124_org', :'p124_sales_profile', 'active', 'sales', :'p124_sales_bundle'),
  (:'p124_curator_membership', :'p124_org', :'p124_curator_profile', 'active', 'curator', :'p124_curator_bundle'),
  (:'p124_student_membership', :'p124_org', :'p124_student_profile', 'active', 'student', :'p124_student_bundle'),
  (:'p124_foreign_sales_membership', :'p124_foreign_org', :'p124_foreign_sales_profile', 'active', 'sales', :'p124_sales_bundle'),
  (:'p124_foreign_curator_membership', :'p124_foreign_org', :'p124_foreign_curator_profile', 'active', 'curator', :'p124_curator_bundle'),
  (:'p124_foreign_student_membership', :'p124_foreign_org', :'p124_foreign_student_profile', 'active', 'student', :'p124_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('12412400-0000-4000-8000-000000000061', :'p124_org', :'p124_admin_membership', :'p124_org_scope', 1, 1, TRUE, 'system', NULL, 'P124 admin scope', '12412400-0000-4000-8000-000000000071'),
  ('12412400-0000-4000-8000-000000000062', :'p124_org', :'p124_sales_membership', :'p124_org_scope', 1, 1, TRUE, 'system', NULL, 'P124 sales scope', '12412400-0000-4000-8000-000000000072'),
  ('12412400-0000-4000-8000-000000000063', :'p124_org', :'p124_curator_membership', :'p124_case_scope', 1, 1, TRUE, 'system', NULL, 'P124 curator scope', '12412400-0000-4000-8000-000000000073'),
  ('12412400-0000-4000-8000-000000000064', :'p124_org', :'p124_student_membership', :'p124_case_scope', 1, 1, TRUE, 'system', NULL, 'P124 student scope', '12412400-0000-4000-8000-000000000074');

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p124_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p124_org',
  'platform_membership_id', :'p124_admin_membership',
  'platform_bundle_id', :'p124_admin_bundle',
  'platform_bundle_version', :'p124_admin_version'::INTEGER
)::TEXT AS p124_admin_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p124_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p124_org',
  'platform_membership_id', :'p124_sales_membership',
  'platform_bundle_id', :'p124_sales_bundle',
  'platform_bundle_version', :'p124_sales_version'::INTEGER
)::TEXT AS p124_sales_claims
\gset

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, closed_at, next_action, current_scope_id,
  current_scope_version
) VALUES
  (
    :'p124_case', :'p124_org', :'p124_student_membership',
    :'p124_sales_membership', NULL,
    'synthetic:p124:active', 'contract:p124:active', '2026-09-01 08:00:00+00',
    'P124 Active Student', 'United Kingdom', 'Bachelor', 'Computer Science',
    '2027', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Submit applications',
    :'p124_case_scope', 1
  ),
  (
    :'p124_closed_case', :'p124_org', :'p124_student_membership',
    :'p124_sales_membership', NULL,
    'synthetic:p124:closed', 'contract:p124:closed', '2026-08-01 08:00:00+00',
    'P124 Closed Student', 'United Kingdom', 'Bachelor', 'Business',
    '2026', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, NULL,
    :'p124_closed_scope', 1
  ),
  (
    :'p124_foreign_case', :'p124_foreign_org', :'p124_foreign_student_membership',
    :'p124_foreign_sales_membership', NULL,
    'synthetic:p124:foreign', 'contract:p124:foreign', '2026-09-01 08:00:00+00',
    'P124 Foreign Student', 'United Kingdom', 'Bachelor', 'Economics',
    '2027', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Remain foreign',
    :'p124_foreign_case_scope', 1
  );

SET request.jwt.claims TO :'p124_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p124_org',
  :'p124_case',
  :'p124_curator_membership',
  'Activate the isolated migration 124 case through the real lifecycle',
  '12412400-0000-4000-8000-000000000075'
);
RESET ROLE;
RESET request.jwt.claims;

\set p124_task_a 12412400-0000-4000-8000-000000000101
\set p124_task_b 12412400-0000-4000-8000-000000000102
\set p124_task_dated 12412400-0000-4000-8000-000000000103
\set p124_task_foreign 12412400-0000-4000-8000-000000000104

INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, due_on, status,
  student_visible, created_by_membership_id
) VALUES
  (:'p124_task_a', :'p124_org', :'p124_case', 'follow_up', 'P124 undated A', :'p124_curator_membership', 'normal', NULL, NULL, 'open', FALSE, :'p124_curator_membership'),
  (:'p124_task_b', :'p124_org', :'p124_case', 'follow_up', 'P124 undated B', :'p124_curator_membership', 'normal', NULL, NULL, 'open', FALSE, :'p124_curator_membership'),
  (:'p124_task_dated', :'p124_org', :'p124_case', 'follow_up', 'P124 dated', :'p124_curator_membership', 'normal', NULL, '2026-09-10', 'open', FALSE, :'p124_curator_membership'),
  (:'p124_task_foreign', :'p124_foreign_org', :'p124_foreign_case', 'follow_up', 'P124 foreign', :'p124_foreign_curator_membership', 'normal', NULL, NULL, 'open', FALSE, :'p124_foreign_curator_membership');

\set p124_app_past 12412400-0000-4000-8000-000000000201
\set p124_app_range_a 12412400-0000-4000-8000-000000000202
\set p124_app_range_b 12412400-0000-4000-8000-000000000203
\set p124_app_null 12412400-0000-4000-8000-000000000204
\set p124_app_rejected 12412400-0000-4000-8000-000000000205
\set p124_app_closed 12412400-0000-4000-8000-000000000206
\set p124_app_foreign 12412400-0000-4000-8000-000000000207

INSERT INTO platform.university_applications (
  id, organization_id, student_case_id, institution_name, program_name,
  status, latest_evidence_reference, created_by_membership_id,
  university_deadline_on
) VALUES
  (:'p124_app_past', :'p124_org', :'p124_case', 'Past University', 'Past Program', 'preparation', NULL, :'p124_curator_membership', '2026-08-31'),
  (:'p124_app_range_a', :'p124_org', :'p124_case', 'Alpha University', 'Alpha Program', 'preparation', NULL, :'p124_curator_membership', '2026-09-10'),
  (:'p124_app_range_b', :'p124_org', :'p124_case', 'Beta University', 'Beta Program', 'offer', 'evidence:p124:offer', :'p124_curator_membership', '2026-09-10'),
  (:'p124_app_null', :'p124_org', :'p124_case', 'Null University', 'Null Program', 'preparation', NULL, :'p124_curator_membership', NULL),
  (:'p124_app_rejected', :'p124_org', :'p124_case', 'Rejected University', 'Rejected Program', 'rejected', 'evidence:p124:rejected', :'p124_curator_membership', '2026-09-09'),
  (:'p124_app_closed', :'p124_org', :'p124_closed_case', 'Closed University', 'Closed Program', 'preparation', NULL, :'p124_curator_membership', '2026-09-08'),
  (:'p124_app_foreign', :'p124_foreign_org', :'p124_foreign_case', 'Foreign University', 'Foreign Program', 'preparation', NULL, :'p124_foreign_curator_membership', '2026-09-07');

SET request.jwt.claims TO :'p124_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p124_assert(
  ARRAY(
    SELECT page.case_task_id
    FROM platform.staff_case_task_undated_page(10) AS page
  ) = ARRAY[:'p124_task_a'::UUID, :'p124_task_b'::UUID]
  AND NOT EXISTS (
    SELECT 1 FROM platform.staff_case_task_undated_page(10) AS page
    WHERE page.due_at IS NOT NULL
      OR page.due_on IS NOT NULL
      OR page.sort_at <> '9999-12-31 00:00:00+00'::TIMESTAMPTZ
  ),
  'undated projection leaked dated/foreign work or drifted from sentinel order'
);

SELECT pg_temp.p124_assert(
  ARRAY(
    SELECT page.case_task_id
    FROM platform.staff_case_task_undated_page(
      10,
      '9999-12-31 00:00:00+00'::TIMESTAMPTZ,
      :'p124_task_a'
    ) AS page
  ) = ARRAY[:'p124_task_b'::UUID],
  'undated sentinel cursor did not continue after exact task id'
);

SELECT pg_temp.p124_assert(
  ARRAY(
    SELECT page.application_id
    FROM platform.staff_application_deadline_page(
      10, NULL, NULL, '2026-09-01', '2026-09-30'
    ) AS page
  ) = ARRAY[:'p124_app_range_a'::UUID, :'p124_app_range_b'::UUID],
  'deadline range leaked null, inactive-status, closed-case or foreign rows'
);

SELECT pg_temp.p124_assert(
  ARRAY(
    SELECT page.application_id
    FROM platform.staff_application_deadline_page(
      10, '2026-09-10', :'p124_app_range_a', '2026-09-01', '2026-09-30'
    ) AS page
  ) = ARRAY[:'p124_app_range_b'::UUID],
  'deadline keyset did not continue after exact date/id pair'
);

SELECT pg_temp.p124_assert(
  (
    SELECT pg_catalog.to_jsonb(nearest)
    FROM platform.staff_nearest_application_deadline() AS nearest
  ) = pg_catalog.jsonb_build_object(
    'application_id', :'p124_app_past'::UUID,
    'student_case_id', :'p124_case'::UUID,
    'student_display_name', 'P124 Active Student',
    'university_name', 'Past University',
    'program_name', 'Past Program',
    'application_status', 'preparation',
    'deadline', '2026-08-31'
  ),
  'global nearest deadline was coupled to the selected September range'
);

SELECT pg_temp.p124_capture_error(
  'SELECT * FROM platform.staff_case_task_undated_page('
    || '10, TIMESTAMPTZ ''2026-09-10 00:00:00+00'', '
    || quote_literal(:'p124_task_a') || '::UUID)'
)::TEXT AS p124_bad_sentinel
\gset
SELECT pg_temp.p124_capture_error(
  'SELECT * FROM platform.staff_application_deadline_page('
    || '10, DATE ''2026-09-10'', NULL, NULL, NULL)'
)::TEXT AS p124_bad_deadline_cursor
\gset
SELECT pg_temp.p124_assert(
  (:'p124_bad_sentinel'::JSONB ->> 'sqlstate') = '22023'
  AND (:'p124_bad_deadline_cursor'::JSONB ->> 'sqlstate') = '22023',
  'invalid cursor shapes did not fail closed'
);

RESET ROLE;
SET request.jwt.claims TO :'p124_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p124_capture_error(
  'SELECT * FROM platform.staff_application_deadline_page('
    || '10, NULL, NULL, NULL, NULL)'
)::TEXT AS p124_sales_deadline
\gset
SELECT pg_temp.p124_capture_error(
  'SELECT * FROM platform.staff_case_task_undated_page(10, NULL, NULL)'
)::TEXT AS p124_sales_undated
\gset
SELECT pg_temp.p124_assert(
  (:'p124_sales_deadline'::JSONB ->> 'ok')::BOOLEAN IS FALSE
  AND (:'p124_sales_undated'::JSONB ->> 'ok')::BOOLEAN IS FALSE,
  'Sales unexpectedly acquired Calendar projection authority'
);

RESET ROLE;
RESET request.jwt.claims;
ROLLBACK;
