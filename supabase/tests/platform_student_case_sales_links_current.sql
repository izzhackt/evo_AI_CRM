\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 105. The fixture is isolated in
-- one transaction and proves the RPC contract, input bound and both case- and
-- lead-side actor authorization without retaining test data.
BEGIN;

DO $catalog_contract$
DECLARE
  routine_oid OID := pg_catalog.to_regprocedure(
    'platform.staff_student_case_sales_links(uuid,uuid[])'
  )::OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  IF routine_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 105 sales-link RPC signature is missing';
  END IF;

  SELECT routine.*
  INTO STRICT routine_row
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = routine_oid;

  IF NOT routine_row.prosecdef
    OR routine_row.provolatile <> 's'
    OR routine_row.prokind <> 'f'
    OR NOT routine_row.proretset
    OR NOT (
      routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
    )
    OR routine_row.pronargdefaults <> 0
    OR pg_catalog.pg_get_function_result(routine_oid)
      <> 'TABLE(student_case_id uuid, lead_id uuid)'
  THEN
    RAISE EXCEPTION 'Migration 105 hardened sales-link RPC contract drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    routine_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated lacks EXECUTE on migration 105 sales-link RPC';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has EXECUTE on migration 105 sales-link RPC',
        forbidden_role;
    END IF;
  END LOOP;
END
$catalog_contract$;

CREATE OR REPLACE FUNCTION pg_temp.p6b_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'P6B sales-link assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p6b_rejects_sales_link_scope(
  p_organization_id UUID,
  p_student_case_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM *
  FROM platform.staff_student_case_sales_links(
    p_organization_id,
    p_student_case_ids
  );

  RETURN FALSE;
EXCEPTION WHEN SQLSTATE '22023' THEN
  RETURN TRUE;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p6b_assert(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p6b_rejects_sales_link_scope(UUID, UUID[])
  TO authenticated;

\set p6b_org_a '10500000-0000-4000-8000-000000000001'
\set p6b_org_b '10500000-0000-4000-8000-000000000002'
\set p6b_org_scope_a '10500000-0000-4000-8000-000000000011'
\set p6b_org_scope_b '10500000-0000-4000-8000-000000000012'
\set p6b_case_scope_a '10500000-0000-4000-8000-000000000021'
\set p6b_case_scope_b '10500000-0000-4000-8000-000000000022'

\set p6b_admin_a_user '10500000-0000-4000-8000-000000000101'
\set p6b_sales_a_user '10500000-0000-4000-8000-000000000102'
\set p6b_admin_b_user '10500000-0000-4000-8000-000000000103'
\set p6b_sales_b_user '10500000-0000-4000-8000-000000000104'

\set p6b_admin_a_profile '10500000-0000-4000-8000-000000000201'
\set p6b_sales_a_profile '10500000-0000-4000-8000-000000000202'
\set p6b_admin_b_profile '10500000-0000-4000-8000-000000000203'
\set p6b_sales_b_profile '10500000-0000-4000-8000-000000000204'

\set p6b_admin_a_membership '10500000-0000-4000-8000-000000000301'
\set p6b_sales_a_membership '10500000-0000-4000-8000-000000000302'
\set p6b_admin_b_membership '10500000-0000-4000-8000-000000000303'
\set p6b_sales_b_membership '10500000-0000-4000-8000-000000000304'

\set p6b_client_a '10500000-0000-4000-8000-000000000401'
\set p6b_client_b '10500000-0000-4000-8000-000000000402'
\set p6b_lead_a '10500000-0000-4000-8000-000000000501'
\set p6b_lead_b '10500000-0000-4000-8000-000000000502'
\set p6b_case_a '10500000-0000-4000-8000-000000000601'
\set p6b_case_b '10500000-0000-4000-8000-000000000602'

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p6b_org_a', 'P6B Sales Link Organization A'),
  (:'p6b_org_b', 'P6B Sales Link Organization B');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES
  (:'p6b_org_scope_a', :'p6b_org_a', 'organization', :'p6b_org_a', 1),
  (:'p6b_org_scope_b', :'p6b_org_b', 'organization', :'p6b_org_b', 1),
  (:'p6b_case_scope_a', :'p6b_org_a', 'student_case', :'p6b_case_a', 1),
  (:'p6b_case_scope_b', :'p6b_org_b', 'student_case', :'p6b_case_b', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p6b_admin_a_user', 'p6b-sales-link-admin-a@example.invalid', '{}'),
  (:'p6b_sales_a_user', 'p6b-sales-link-sales-a@example.invalid', '{}'),
  (:'p6b_admin_b_user', 'p6b-sales-link-admin-b@example.invalid', '{}'),
  (:'p6b_sales_b_user', 'p6b-sales-link-sales-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES
  (:'p6b_admin_a_profile', :'p6b_admin_a_user', 'P6B Admin A', 'active', 1),
  (:'p6b_sales_a_profile', :'p6b_sales_a_user', 'P6B Sales A', 'active', 1),
  (:'p6b_admin_b_profile', :'p6b_admin_b_user', 'P6B Admin B', 'active', 1),
  (:'p6b_sales_b_profile', :'p6b_sales_b_user', 'P6B Sales B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES
  (
    :'p6b_admin_a_membership', :'p6b_org_a', :'p6b_admin_a_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'p6b_sales_a_membership', :'p6b_org_a', :'p6b_sales_a_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'p6b_admin_b_membership', :'p6b_org_b', :'p6b_admin_b_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'p6b_sales_b_membership', :'p6b_org_b', :'p6b_sales_b_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  );

INSERT INTO platform.membership_scope_assignments (
  id,
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
) VALUES
  (
    '10500000-0000-4000-8000-000000000701',
    :'p6b_org_a', :'p6b_admin_a_membership', :'p6b_org_scope_a',
    1, 1, TRUE, 'system', NULL, 'P6B Admin A organization scope',
    '10500000-0000-4000-8000-000000000711'
  ),
  (
    '10500000-0000-4000-8000-000000000702',
    :'p6b_org_a', :'p6b_sales_a_membership', :'p6b_org_scope_a',
    1, 1, TRUE, 'system', NULL, 'P6B Sales A organization scope',
    '10500000-0000-4000-8000-000000000712'
  ),
  (
    '10500000-0000-4000-8000-000000000703',
    :'p6b_org_a', :'p6b_sales_a_membership', :'p6b_case_scope_a',
    1, 1, TRUE, 'system', NULL, 'P6B Sales A case scope',
    '10500000-0000-4000-8000-000000000713'
  ),
  (
    '10500000-0000-4000-8000-000000000704',
    :'p6b_org_b', :'p6b_admin_b_membership', :'p6b_org_scope_b',
    1, 1, TRUE, 'system', NULL, 'P6B Admin B organization scope',
    '10500000-0000-4000-8000-000000000714'
  ),
  (
    '10500000-0000-4000-8000-000000000705',
    :'p6b_org_b', :'p6b_sales_b_membership', :'p6b_org_scope_b',
    1, 1, TRUE, 'system', NULL, 'P6B Sales B organization scope',
    '10500000-0000-4000-8000-000000000715'
  ),
  (
    '10500000-0000-4000-8000-000000000706',
    :'p6b_org_b', :'p6b_sales_b_membership', :'p6b_case_scope_b',
    1, 1, TRUE, 'system', NULL, 'P6B Sales B case scope',
    '10500000-0000-4000-8000-000000000716'
  );

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES
  (:'p6b_client_a', :'p6b_org_a', 'P6B Client A', 'p6b client a'),
  (:'p6b_client_b', :'p6b_org_b', 'P6B Client B', 'p6b client b');

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state
) VALUES
  (
    :'p6b_lead_a', :'p6b_org_a', :'p6b_client_a',
    :'p6b_sales_a_membership', 'qualified', 'p6b_sales_link_a', 'open'
  ),
  (
    :'p6b_lead_b', :'p6b_org_b', :'p6b_client_b',
    :'p6b_sales_b_membership', 'qualified', 'p6b_sales_link_b', 'open'
  );

INSERT INTO platform.student_cases (
  id,
  organization_id,
  student_membership_id,
  responsible_sales_membership_id,
  current_curator_membership_id,
  source_key,
  contract_confirmation_ref,
  contract_confirmed_at,
  student_display_name,
  target_country,
  target_degree,
  route_approval_status,
  operational_stage,
  state,
  handoff_at,
  portal_activated_at,
  closed_at,
  next_action,
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id
) VALUES
  (
    :'p6b_case_a', :'p6b_org_a', NULL, :'p6b_sales_a_membership', NULL,
    'canonical-lead:' || :'p6b_lead_a', NULL, NULL, 'P6B Student A',
    NULL, NULL, 'draft', 'sales_handoff_pending', 'pending',
    NULL, NULL, NULL, 'Awaiting audited Admissions handoff',
    :'p6b_case_scope_a', 1, :'p6b_client_a', :'p6b_lead_a'
  ),
  (
    :'p6b_case_b', :'p6b_org_b', NULL, :'p6b_sales_b_membership', NULL,
    'canonical-lead:' || :'p6b_lead_b', NULL, NULL, 'P6B Student B',
    NULL, NULL, 'draft', 'sales_handoff_pending', 'pending',
    NULL, NULL, NULL, 'Awaiting audited Admissions handoff',
    :'p6b_case_scope_b', 1, :'p6b_client_b', :'p6b_lead_b'
  );

SELECT
  admin_bundle.version AS p6b_admin_bundle_version,
  sales_bundle.version AS p6b_sales_bundle_version
FROM platform.role_bundle_versions AS admin_bundle
CROSS JOIN platform.role_bundle_versions AS sales_bundle
WHERE admin_bundle.id = '00000000-0000-4000-8000-000000001301'
  AND sales_bundle.id = '00000000-0000-4000-8000-000000001302'
\gset

SELECT
  pg_catalog.jsonb_build_object(
    'sub', :'p6b_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p6b_org_a',
    'platform_membership_id', :'p6b_admin_a_membership',
    'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
    'platform_bundle_version', :'p6b_admin_bundle_version'::BIGINT
  )::TEXT AS p6b_admin_a_claims,
  pg_catalog.jsonb_build_object(
    'sub', :'p6b_sales_a_user',
    'role', 'authenticated',
    'platform_role', 'sales',
    'platform_access_version', 1,
    'platform_organization_id', :'p6b_org_a',
    'platform_membership_id', :'p6b_sales_a_membership',
    'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
    'platform_bundle_version', :'p6b_sales_bundle_version'::BIGINT
  )::TEXT AS p6b_sales_a_claims,
  pg_catalog.jsonb_build_object(
    'sub', :'p6b_admin_b_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p6b_org_b',
    'platform_membership_id', :'p6b_admin_b_membership',
    'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
    'platform_bundle_version', :'p6b_admin_bundle_version'::BIGINT
  )::TEXT AS p6b_admin_b_claims
\gset

SET ROLE authenticated;
SET request.jwt.claims TO :'p6b_admin_a_claims';

SELECT pg_temp.p6b_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        link.student_case_id = :'p6b_case_a'::UUID
        AND link.lead_id = :'p6b_lead_a'::UUID
      )
    FROM platform.staff_student_case_sales_links(
      :'p6b_org_a',
      ARRAY[:'p6b_case_a', :'p6b_case_b']::UUID[]
    ) AS link
  ),
  'Admin must receive only the requested link inside the active organization'
);

SELECT pg_temp.p6b_assert(
  pg_temp.p6b_rejects_sales_link_scope(
    NULL,
    ARRAY[:'p6b_case_a']::UUID[]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(
    '00000000-0000-0000-0000-000000000000',
    ARRAY[:'p6b_case_a']::UUID[]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(:'p6b_org_a', NULL)
  AND pg_temp.p6b_rejects_sales_link_scope(
    :'p6b_org_a',
    ARRAY[]::UUID[]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(
    :'p6b_org_a',
    ARRAY[NULL::UUID]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(
    :'p6b_org_a',
    ARRAY['00000000-0000-0000-0000-000000000000'::UUID]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(
    :'p6b_org_a',
    ARRAY[:'p6b_case_a', :'p6b_case_a']::UUID[]
  )
  AND pg_temp.p6b_rejects_sales_link_scope(
    :'p6b_org_a',
    ARRAY(
      SELECT :'p6b_case_a'::UUID
      FROM pg_catalog.generate_series(1, 101)
    )
  ),
  'RPC must reject null, nil, duplicate, empty or oversized scopes'
);

SET request.jwt.claims TO :'p6b_sales_a_claims';

SELECT pg_temp.p6b_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        link.student_case_id = :'p6b_case_a'::UUID
        AND link.lead_id = :'p6b_lead_a'::UUID
      )
    FROM platform.staff_student_case_sales_links(
      :'p6b_org_a',
      ARRAY[:'p6b_case_a']::UUID[]
    ) AS link
  ),
  'Assigned Sales must receive the case link for its visible canonical lead'
);

SELECT pg_temp.p6b_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_student_case_sales_links(
      :'p6b_org_a',
      ARRAY[:'p6b_case_b']::UUID[]
    )
  ),
  'Sales must not receive a link for a requested case from another organization'
);

SET request.jwt.claims TO :'p6b_admin_b_claims';

SELECT pg_temp.p6b_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_student_case_sales_links(
      :'p6b_org_a',
      ARRAY[:'p6b_case_a']::UUID[]
    )
  ),
  'Cross-organization Admin request must fail closed without link leakage'
);

RESET ROLE;
ROLLBACK;

SELECT 'platform migration 105 student-case sales-link contract passed' AS result;
