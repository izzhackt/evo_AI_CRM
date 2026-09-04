\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 111. All rows are synthetic,
-- exercise the real canonical workflow command where noted, and roll back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p111_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 111 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p111_capture_error(p_statement TEXT)
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

GRANT EXECUTE ON FUNCTION pg_temp.p111_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p111_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  routine_oid OID;
BEGIN
  SELECT pg_catalog.to_regprocedure(
    'platform.staff_sales_stage_entry_cohort(date,date,integer,timestamptz,uuid)'
  )::OID
  INTO routine_oid;

  IF routine_oid IS NULL THEN
    RAISE EXCEPTION 'stage-entry cohort function is missing';
  END IF;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid
  ) THEN
    RAISE EXCEPTION 'stage-entry cohort hardening drifted';
  END IF;

  IF pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin', routine_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'stage-entry cohort execution grants drifted';
  END IF;

  IF pg_catalog.has_table_privilege(
    'authenticated',
    'platform_private.sales_lead_workflow_receipts',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated gained direct receipt access';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p111_admin_bundle, bundle.version AS p111_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p111_sales_bundle, bundle.version AS p111_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p111_curator_bundle, bundle.version AS p111_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p111_org_a 59911100-0000-4000-8000-000000000001
\set p111_org_b 59911100-0000-4000-8000-000000000002
\set p111_scope_a 59911100-0000-4000-8000-000000000011
\set p111_scope_b 59911100-0000-4000-8000-000000000012

\set p111_admin_a_user 59911100-0000-4000-8000-000000000021
\set p111_sales_a_user 59911100-0000-4000-8000-000000000022
\set p111_sales_other_user 59911100-0000-4000-8000-000000000023
\set p111_curator_a_user 59911100-0000-4000-8000-000000000024
\set p111_admin_b_user 59911100-0000-4000-8000-000000000025

\set p111_admin_a_profile 59911100-0000-4000-8000-000000000031
\set p111_sales_a_profile 59911100-0000-4000-8000-000000000032
\set p111_sales_other_profile 59911100-0000-4000-8000-000000000033
\set p111_curator_a_profile 59911100-0000-4000-8000-000000000034
\set p111_admin_b_profile 59911100-0000-4000-8000-000000000035

\set p111_admin_a_membership 59911100-0000-4000-8000-000000000041
\set p111_sales_a_membership 59911100-0000-4000-8000-000000000042
\set p111_sales_other_membership 59911100-0000-4000-8000-000000000043
\set p111_curator_a_membership 59911100-0000-4000-8000-000000000044
\set p111_admin_b_membership 59911100-0000-4000-8000-000000000045

INSERT INTO platform.organizations (id, name) VALUES
  (:'p111_org_a', 'Migration 111 Organization A'),
  (:'p111_org_b', 'Migration 111 Organization B');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p111_scope_a', :'p111_org_a', 'organization', :'p111_org_a', 1),
  (:'p111_scope_b', :'p111_org_b', 'organization', :'p111_org_b', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p111_admin_a_user', 'p111-admin-a@example.invalid', '{}'::JSONB),
  (:'p111_sales_a_user', 'p111-sales-a@example.invalid', '{}'::JSONB),
  (:'p111_sales_other_user', 'p111-sales-other@example.invalid', '{}'::JSONB),
  (:'p111_curator_a_user', 'p111-curator-a@example.invalid', '{}'::JSONB),
  (:'p111_admin_b_user', 'p111-admin-b@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p111_admin_a_profile', :'p111_admin_a_user', 'P111 Admin A', 'active', 1),
  (:'p111_sales_a_profile', :'p111_sales_a_user', 'P111 Sales A', 'active', 1),
  (:'p111_sales_other_profile', :'p111_sales_other_user', 'P111 Sales Other', 'active', 1),
  (:'p111_curator_a_profile', :'p111_curator_a_user', 'P111 Curator A', 'active', 1),
  (:'p111_admin_b_profile', :'p111_admin_b_user', 'P111 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p111_admin_a_membership', :'p111_org_a', :'p111_admin_a_profile', 'active', 'admin', :'p111_admin_bundle'),
  (:'p111_sales_a_membership', :'p111_org_a', :'p111_sales_a_profile', 'active', 'sales', :'p111_sales_bundle'),
  (:'p111_sales_other_membership', :'p111_org_a', :'p111_sales_other_profile', 'active', 'sales', :'p111_sales_bundle'),
  (:'p111_curator_a_membership', :'p111_org_a', :'p111_curator_a_profile', 'active', 'curator', :'p111_curator_bundle'),
  (:'p111_admin_b_membership', :'p111_org_b', :'p111_admin_b_profile', 'active', 'admin', :'p111_admin_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911100-0000-4000-8000-000000000051', :'p111_org_a', :'p111_admin_a_membership', :'p111_scope_a', 1, 1, TRUE, 'system', NULL, 'P111 admin A scope', '59911100-0000-4000-8000-000000000061'),
  ('59911100-0000-4000-8000-000000000052', :'p111_org_a', :'p111_sales_a_membership', :'p111_scope_a', 1, 1, TRUE, 'system', NULL, 'P111 sales A scope', '59911100-0000-4000-8000-000000000062'),
  ('59911100-0000-4000-8000-000000000053', :'p111_org_a', :'p111_sales_other_membership', :'p111_scope_a', 1, 1, TRUE, 'system', NULL, 'P111 other sales scope', '59911100-0000-4000-8000-000000000063'),
  ('59911100-0000-4000-8000-000000000054', :'p111_org_a', :'p111_curator_a_membership', :'p111_scope_a', 1, 1, TRUE, 'system', NULL, 'P111 curator scope', '59911100-0000-4000-8000-000000000064'),
  ('59911100-0000-4000-8000-000000000055', :'p111_org_b', :'p111_admin_b_membership', :'p111_scope_b', 1, 1, TRUE, 'system', NULL, 'P111 admin B scope', '59911100-0000-4000-8000-000000000065');

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p111_admin_a_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p111_org_a',
  'platform_membership_id', :'p111_admin_a_membership',
  'platform_bundle_id', :'p111_admin_bundle',
  'platform_bundle_version', :'p111_admin_version'::INTEGER
)::TEXT AS p111_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p111_sales_a_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p111_org_a',
  'platform_membership_id', :'p111_sales_a_membership',
  'platform_bundle_id', :'p111_sales_bundle',
  'platform_bundle_version', :'p111_sales_version'::INTEGER
)::TEXT AS p111_sales_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p111_sales_other_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p111_org_a',
  'platform_membership_id', :'p111_sales_other_membership',
  'platform_bundle_id', :'p111_sales_bundle',
  'platform_bundle_version', :'p111_sales_version'::INTEGER
)::TEXT AS p111_sales_other_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p111_curator_a_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1,
  'platform_organization_id', :'p111_org_a',
  'platform_membership_id', :'p111_curator_a_membership',
  'platform_bundle_id', :'p111_curator_bundle',
  'platform_bundle_version', :'p111_curator_version'::INTEGER
)::TEXT AS p111_curator_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p111_admin_b_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p111_org_b',
  'platform_membership_id', :'p111_admin_b_membership',
  'platform_bundle_id', :'p111_admin_bundle',
  'platform_bundle_version', :'p111_admin_version'::INTEGER
)::TEXT AS p111_admin_b_claims
\gset

\set p111_lead_own 59911100-0000-4000-8000-000000000101
\set p111_lead_unassigned 59911100-0000-4000-8000-000000000102
\set p111_lead_other 59911100-0000-4000-8000-000000000103
\set p111_lead_before 59911100-0000-4000-8000-000000000104
\set p111_lead_after 59911100-0000-4000-8000-000000000105
\set p111_lead_closed 59911100-0000-4000-8000-000000000106
\set p111_lead_owner_only 59911100-0000-4000-8000-000000000107
\set p111_lead_action_only 59911100-0000-4000-8000-000000000108
\set p111_lead_org_b 59911100-0000-4000-8000-000000000109

INSERT INTO platform.leads (
  id, organization_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at
) VALUES
  (:'p111_lead_own', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-03 18:00:00+00', '2026-09-03 18:00:00+00'),
  (:'p111_lead_unassigned', :'p111_org_a', NULL, 'new', 'p111', 'open', '2026-09-04 17:59:59.999999+00', '2026-09-04 17:59:59.999999+00'),
  (:'p111_lead_other', :'p111_org_a', :'p111_sales_other_membership', 'new', 'p111', 'open', '2026-09-04 06:00:00+00', '2026-09-04 06:00:00+00'),
  (:'p111_lead_before', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-03 17:59:59.999999+00', '2026-09-03 17:59:59.999999+00'),
  (:'p111_lead_after', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-04 18:00:00+00', '2026-09-04 18:00:00+00'),
  (:'p111_lead_closed', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-04 07:00:00+00', '2026-09-04 07:00:00+00'),
  (:'p111_lead_owner_only', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-04 08:00:00+00', '2026-09-04 08:00:00+00'),
  (:'p111_lead_action_only', :'p111_org_a', :'p111_sales_a_membership', 'new', 'p111', 'open', '2026-09-04 09:00:00+00', '2026-09-04 09:00:00+00'),
  (:'p111_lead_org_b', :'p111_org_b', NULL, 'new', 'p111', 'open', '2026-09-04 10:00:00+00', '2026-09-04 10:00:00+00');

-- Exercise the real canonical mutation command. Request 201 is replayed, a
-- no-op is rejected, and requests 203/204 prove re-entry collapses to 201.
SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_own', 1, '59911100-0000-4000-8000-000000000201',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 qualify'
)::TEXT AS p111_first_transition
\gset
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_own', 1, '59911100-0000-4000-8000-000000000201',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 qualify'
)::TEXT AS p111_replay
\gset
SELECT pg_temp.p111_capture_error(format(
  'SELECT platform.mutate_sales_lead_workflow(%L::UUID, 2, %L::UUID, '
    || '%L, %L::UUID, NULL, NULL, TRUE, %L)',
  :'p111_lead_own', '59911100-0000-4000-8000-000000000202',
  'qualified', :'p111_sales_a_membership', 'P111 no-op'
))::TEXT AS p111_noop_error
\gset
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_own', 2, '59911100-0000-4000-8000-000000000203',
  'contacting', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 contact'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_own', 3, '59911100-0000-4000-8000-000000000204',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 requalify'
);

SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_unassigned', 1, '59911100-0000-4000-8000-000000000211',
  'qualified', NULL, NULL, NULL, TRUE, 'P111 unassigned qualify'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_other', 1, '59911100-0000-4000-8000-000000000221',
  'qualified', :'p111_sales_other_membership', NULL, NULL, TRUE, 'P111 other qualify'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_before', 1, '59911100-0000-4000-8000-000000000231',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 before boundary'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_after', 1, '59911100-0000-4000-8000-000000000241',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 after boundary'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_closed', 1, '59911100-0000-4000-8000-000000000251',
  'qualified', :'p111_sales_a_membership', NULL, NULL, TRUE, 'P111 closed later'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_owner_only', 1, '59911100-0000-4000-8000-000000000261',
  'new', :'p111_sales_other_membership', NULL, NULL, TRUE, 'P111 owner only'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_action_only', 1, '59911100-0000-4000-8000-000000000271',
  'new', :'p111_sales_a_membership', 'Call tomorrow', '2026-09-05', FALSE,
  'P111 action only'
);

RESET ROLE;
UPDATE platform.leads
SET lifecycle_state = 'converted'
WHERE id = :'p111_lead_closed';

SET request.jwt.claims TO :'p111_admin_b_claims';
SET ROLE authenticated;
SELECT platform.mutate_sales_lead_workflow(
  :'p111_lead_org_b', 1, '59911100-0000-4000-8000-000000000281',
  'qualified', NULL, NULL, NULL, TRUE, 'P111 cross-organization'
);

RESET ROLE;
SELECT pg_temp.p111_assert(
  :'p111_first_transition'::JSONB = :'p111_replay'::JSONB,
  'idempotent replay did not return the original result'
);
SELECT pg_temp.p111_assert(
  :'p111_noop_error'::JSONB ->> 'sqlstate' = '22000',
  'real workflow no-op was not rejected'
);
SELECT pg_temp.p111_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.sales_lead_workflow_receipts
    WHERE request_id = '59911100-0000-4000-8000-000000000202'
  ),
  'replay/no-op wrote a second receipt'
);

SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p111_assert(
  (SELECT pg_catalog.count(*)
   FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')) = 4,
  'Admin cohort must contain own two stages, unassigned and other-owned stage'
);
SELECT pg_temp.p111_assert(
  (SELECT pg_catalog.count(*)
   FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')
   WHERE stage_key = 'qualified') = 3,
  'Admin qualified cohort must count people, not re-entry attempts'
);
SELECT pg_temp.p111_assert(
  (SELECT request_id
   FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')
   WHERE lead_id = :'p111_lead_own' AND stage_key = 'qualified')
    = '59911100-0000-4000-8000-000000000201',
  'qualified re-entry did not collapse to the first exact proof'
);
SELECT pg_temp.p111_assert(
  EXISTS (
    SELECT 1
    FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')
    WHERE lead_id = :'p111_lead_own'
      AND stage_key = 'qualified'
      AND organization_id = :'p111_org_a'
      AND entered_on = pg_catalog.timezone('Asia/Bishkek', entered_at)::DATE
  ),
  'returned organization or Bishkek entry date drifted'
);
SELECT pg_temp.p111_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')
    WHERE lead_id IN (
      :'p111_lead_before', :'p111_lead_after', :'p111_lead_closed',
      :'p111_lead_owner_only', :'p111_lead_action_only', :'p111_lead_org_b'
    )
  ),
  'boundary, closed, non-stage, or cross-organization evidence leaked'
);
SELECT pg_temp.p111_assert(
  ARRAY(
    SELECT lead_id::TEXT
    FROM platform.staff_sales_stage_entry_cohort(
      '2026-09-04',
      '2026-09-04',
      2
    )
    ORDER BY entered_at ASC, request_id ASC
  ) = ARRAY[
    :'p111_lead_own',
    :'p111_lead_own'
  ]::TEXT[],
  'first bounded page drifted from chronological stage-entry order'
);

SELECT
  page.entered_at::TEXT AS p111_page_cursor_entered_at,
  page.request_id::TEXT AS p111_page_cursor_request_id
FROM platform.staff_sales_stage_entry_cohort(
  '2026-09-04',
  '2026-09-04',
  2
) AS page
ORDER BY page.entered_at ASC, page.request_id ASC
OFFSET 1
LIMIT 1
\gset

SELECT pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object(
    'lead_id', page.lead_id,
    'stage_key', page.stage_key,
    'entered_at', page.entered_at,
    'request_id', page.request_id
  )
  ORDER BY page.entered_at ASC, page.request_id ASC
) AS p111_second_page_debug
FROM platform.staff_sales_stage_entry_cohort(
  '2026-09-04',
  '2026-09-04',
  2,
  :'p111_page_cursor_entered_at'::TIMESTAMPTZ,
  :'p111_page_cursor_request_id'::UUID
) AS page;

SELECT pg_temp.p111_assert(
  ARRAY(
    SELECT lead_id::TEXT
    FROM platform.staff_sales_stage_entry_cohort(
      '2026-09-04',
      '2026-09-04',
      2,
      :'p111_page_cursor_entered_at'::TIMESTAMPTZ,
      :'p111_page_cursor_request_id'::UUID
    )
    ORDER BY entered_at ASC, request_id ASC
  ) = ARRAY[
    :'p111_lead_unassigned',
    :'p111_lead_other'
  ]::TEXT[],
  'cursor page did not continue after the last kept row'
);

-- A private receipt without its exact audit event must stop the whole visible
-- projection instead of silently reducing the product funnel.
RESET ROLE;
SAVEPOINT p111_missing_audit_event;
INSERT INTO platform_private.sales_lead_workflow_receipts (
  request_id,
  organization_id,
  actor_membership_id,
  actor_profile_id,
  lead_id,
  expected_workflow_version,
  desired_stage_key,
  desired_owner_membership_id,
  desired_next_action_text,
  desired_next_action_due_date,
  clear_next_action,
  requested_reason,
  resulting_workflow_version,
  result,
  created_at
) VALUES (
  '59911100-0000-4000-8000-000000000291',
  :'p111_org_a',
  :'p111_admin_a_membership',
  :'p111_admin_a_profile',
  :'p111_lead_own',
  4,
  'contacting',
  :'p111_sales_a_membership',
  NULL,
  NULL,
  TRUE,
  'P111 missing audit proof',
  5,
  pg_catalog.jsonb_build_object(
    'request_id', '59911100-0000-4000-8000-000000000291'::UUID,
    'organization_id', :'p111_org_a'::UUID,
    'lead_id', :'p111_lead_own'::UUID,
    'stage_key', 'contacting',
    'current_owner_membership_id', :'p111_sales_a_membership'::UUID,
    'next_action_text', NULL,
    'next_action_due_date', NULL,
    'workflow_version', 5,
    'changed_at', '2026-09-04 12:00:00+00'::TIMESTAMPTZ
  ),
  '2026-09-04 12:00:00+00'::TIMESTAMPTZ
);
SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'')'
)::TEXT AS p111_missing_audit_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p111_missing_audit_event;
SELECT pg_temp.p111_assert(
  :'p111_missing_audit_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p111_missing_audit_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a visible receipt without its audit event did not fail closed'
);

-- The same fail-closed contract applies when the audit exists but its receipt
-- result is not the exact committed result. All other pair fields deliberately
-- agree so this assertion isolates the durable-result comparison.
SAVEPOINT p111_mismatched_receipt_result;
INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id,
  created_at,
  actor_membership_id,
  resulting_version
) VALUES (
  :'p111_org_a',
  'user',
  :'p111_admin_a_profile',
  'auth:' || :'p111_admin_a_user'::TEXT,
  'lead.sales.workflow.changed',
  'lead',
  :'p111_lead_own',
  pg_catalog.jsonb_build_object(
    'stage_key', 'qualified',
    'current_owner_membership_id', :'p111_sales_a_membership'::UUID,
    'next_action_text', NULL,
    'next_action_due_date', NULL,
    'workflow_version', 4
  ),
  pg_catalog.jsonb_build_object(
    'stage_key', 'contacting',
    'current_owner_membership_id', :'p111_sales_a_membership'::UUID,
    'next_action_text', NULL,
    'next_action_due_date', NULL,
    'workflow_version', 5
  ),
  'P111 mismatched result proof',
  '59911100-0000-4000-8000-000000000292',
  '2026-09-04 12:01:00+00'::TIMESTAMPTZ,
  :'p111_admin_a_membership',
  5
);
INSERT INTO platform_private.sales_lead_workflow_receipts (
  request_id,
  organization_id,
  actor_membership_id,
  actor_profile_id,
  lead_id,
  expected_workflow_version,
  desired_stage_key,
  desired_owner_membership_id,
  desired_next_action_text,
  desired_next_action_due_date,
  clear_next_action,
  requested_reason,
  resulting_workflow_version,
  result,
  created_at
) VALUES (
  '59911100-0000-4000-8000-000000000292',
  :'p111_org_a',
  :'p111_admin_a_membership',
  :'p111_admin_a_profile',
  :'p111_lead_own',
  4,
  'contacting',
  :'p111_sales_a_membership',
  NULL,
  NULL,
  TRUE,
  'P111 mismatched result proof',
  5,
  pg_catalog.jsonb_build_object(
    'request_id', '59911100-0000-4000-8000-000000000292'::UUID,
    'organization_id', :'p111_org_a'::UUID,
    'lead_id', :'p111_lead_own'::UUID,
    'stage_key', 'qualified',
    'current_owner_membership_id', :'p111_sales_a_membership'::UUID,
    'next_action_text', NULL,
    'next_action_due_date', NULL,
    'workflow_version', 5,
    'changed_at', '2026-09-04 12:01:00+00'::TIMESTAMPTZ
  ),
  '2026-09-04 12:01:00+00'::TIMESTAMPTZ
);
SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'')'
)::TEXT AS p111_mismatched_result_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p111_mismatched_receipt_result;
SELECT pg_temp.p111_assert(
  :'p111_mismatched_result_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p111_mismatched_result_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a mismatched receipt result did not fail closed'
);

-- An exact workflow audit without its private receipt is equally incomplete.
SAVEPOINT p111_missing_receipt;
INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id,
  created_at,
  actor_membership_id,
  resulting_version
) VALUES (
  :'p111_org_a',
  'user',
  :'p111_admin_a_profile',
  'auth:' || :'p111_admin_a_user'::TEXT,
  'lead.sales.workflow.changed',
  'lead',
  :'p111_lead_own',
  pg_catalog.jsonb_build_object(
    'stage_key', 'qualified',
    'workflow_version', 4
  ),
  pg_catalog.jsonb_build_object(
    'stage_key', 'contacting',
    'workflow_version', 5
  ),
  'P111 missing receipt proof',
  '59911100-0000-4000-8000-000000000293',
  '2026-09-04 12:02:00+00'::TIMESTAMPTZ,
  :'p111_admin_a_membership',
  5
);
SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'')'
)::TEXT AS p111_missing_receipt_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p111_missing_receipt;
SELECT pg_temp.p111_assert(
  :'p111_missing_receipt_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p111_missing_receipt_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a visible workflow audit without its receipt did not fail closed'
);

SET request.jwt.claims TO :'p111_admin_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform_private.sales_lead_workflow_receipts LIMIT 1'
)::TEXT AS p111_receipt_error
\gset
SELECT pg_temp.p111_assert(
  :'p111_receipt_error'::JSONB ->> 'sqlstate' = '42501',
  'authenticated direct receipt read did not fail closed'
);

SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(NULL, DATE ''2026-09-04'')'
)::TEXT AS p111_null_error
\gset
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-05'', DATE ''2026-09-04'')'
)::TEXT AS p111_reverse_error
\gset
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2025-09-03'', DATE ''2026-09-04'')'
)::TEXT AS p111_wide_error
\gset
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'', 0)'
)::TEXT AS p111_limit_error
\gset
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'', 2, TIMESTAMPTZ ''2026-09-04 06:00:00+00'', NULL)'
)::TEXT AS p111_cursor_error
\gset
SELECT pg_temp.p111_assert(
  :'p111_null_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p111_reverse_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p111_wide_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p111_limit_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p111_cursor_error'::JSONB ->> 'sqlstate' = '22023',
  'invalid range, limit, or cursor inputs did not fail closed'
);
SELECT pg_temp.p111_assert(
  (SELECT pg_catalog.count(*)
   FROM platform.staff_sales_stage_entry_cohort('2025-09-04', '2026-09-04')) = 5,
  'inclusive 365-day difference (366 dates) was rejected or changed results'
);

RESET ROLE;
SET request.jwt.claims TO :'p111_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_assert(
  (SELECT pg_catalog.count(*)
   FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')) = 3,
  'Sales must see only current own and unassigned stage entries'
);
SELECT pg_temp.p111_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')
    WHERE lead_id = :'p111_lead_other'
  ),
  'Sales saw another owner''s lead'
);

RESET ROLE;
SET request.jwt.claims TO :'p111_sales_other_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_assert(
  (SELECT pg_catalog.count(*)
   FROM platform.staff_sales_stage_entry_cohort('2026-09-04', '2026-09-04')) = 2,
  'Other Sales must see current own plus unassigned and no owner-only event'
);

RESET ROLE;
SET request.jwt.claims TO :'p111_curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'')'
)::TEXT AS p111_curator_error
\gset
SELECT pg_temp.p111_assert(
  :'p111_curator_error'::JSONB ->> 'sqlstate' = '42501',
  'Curator stage-entry read did not fail closed'
);

RESET ROLE;
SET request.jwt.claims TO '{}';
SET ROLE authenticated;
SELECT pg_temp.p111_capture_error(
  'SELECT * FROM platform.staff_sales_stage_entry_cohort(DATE ''2026-09-04'', DATE ''2026-09-04'')'
)::TEXT AS p111_no_actor_error
\gset
SELECT pg_temp.p111_assert(
  :'p111_no_actor_error'::JSONB ->> 'sqlstate' = '42501',
  'missing actor authority did not fail closed'
);

RESET ROLE;
ROLLBACK;

SELECT 'platform migration 111 sales stage-entry projection checks passed'
  AS result;
