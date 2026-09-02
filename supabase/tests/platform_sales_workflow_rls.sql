\set ON_ERROR_STOP on

\if :{?u4_seed_pre086}

-- The authorization runner invokes this phase immediately before migration
-- 086 so the forward migration must normalize real U3-era durable truth.
BEGIN;

INSERT INTO platform.organizations (id, name)
VALUES (
  '86009999-0000-4000-8000-000000000001',
  'U4 pre-086 normalization fixture'
);

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES (
  '86009999-0000-4000-8000-000000000004',
  '86009999-0000-4000-8000-000000000001',
  'organization',
  '86009999-0000-4000-8000-000000000001',
  1
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '86009999-0000-4000-8000-000000000005',
  'u4-pre086-admin@example.invalid',
  '{}'
);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES (
  '86009999-0000-4000-8000-000000000006',
  '86009999-0000-4000-8000-000000000005',
  'U4 pre-086 Admin',
  'active',
  1
);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES (
  '86009999-0000-4000-8000-000000000007',
  '86009999-0000-4000-8000-000000000001',
  '86009999-0000-4000-8000-000000000006',
  'active',
  'admin',
  '00000000-0000-4000-8000-000000001101'
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
)
VALUES (
  '86009999-0000-4000-8000-000000000008',
  '86009999-0000-4000-8000-000000000001',
  '86009999-0000-4000-8000-000000000007',
  '86009999-0000-4000-8000-000000000004',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'U4 pre-086 Admin authority fixture',
  '86009999-0000-4000-8000-000000000009'
);

INSERT INTO platform.clients (
  id, organization_id, display_name, normalized_name
)
VALUES (
  '86009999-0000-4000-8000-000000000002',
  '86009999-0000-4000-8000-000000000001',
  'U4 legacy inbound client',
  platform_private.normalize_person_name('U4 legacy inbound client')
);

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  stage_key,
  source_key
)
VALUES (
  '86009999-0000-4000-8000-000000000003',
  '86009999-0000-4000-8000-000000000001',
  '86009999-0000-4000-8000-000000000002',
  'new_inbound',
  'waha_inbound'
);

COMMIT;

SELECT 'platform U4 pre-086 stage-normalization fixture seeded' AS result;

\else

-- U4 acceptance uses only transaction-local synthetic rows in the disposable
-- authorization database. It never contacts WhatsApp, WAHA, amoCRM, a managed
-- Supabase project, or a production service.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u4_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U4 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_page()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT pg_catalog.count(*)
  INTO row_count
  FROM platform.staff_sales_lead_page(
    101, NULL, NULL, 'all', 'all', 'all', NULL, 'all', NULL
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'row_count', row_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_detail(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT pg_catalog.count(*)
  INTO row_count
  FROM platform.staff_sales_lead_detail(p_lead_id);

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'row_count', row_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_traverse_filtered_leads(
  p_query TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  cursor_updated_at TIMESTAMPTZ;
  cursor_lead_id UUID;
  previous_updated_at TIMESTAMPTZ;
  previous_lead_id UUID;
  page_row RECORD;
  page_rows INTEGER;
  page_count INTEGER := 0;
  first_page_rows INTEGER;
  last_page_rows INTEGER := 0;
  total_seen BIGINT := 0;
  distinct_seen BIGINT;
  mismatched_rows BIGINT := 0;
  order_violations BIGINT := 0;
  seen_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  LOOP
    page_rows := 0;

    FOR page_row IN
      SELECT lead.*
      FROM platform.staff_sales_lead_page(
        101,
        cursor_updated_at,
        cursor_lead_id,
        'all',
        'all',
        'all',
        NULL,
        'all',
        p_query
      ) AS lead
    LOOP
      page_rows := page_rows + 1;
      total_seen := total_seen + 1;
      seen_ids := pg_catalog.array_append(seen_ids, page_row.lead_id);

      IF page_row.source_key <> p_query THEN
        mismatched_rows := mismatched_rows + 1;
      END IF;

      IF previous_updated_at IS NOT NULL
        AND NOT (
          (previous_updated_at, previous_lead_id)
            > (page_row.sort_at, page_row.lead_id)
        )
      THEN
        order_violations := order_violations + 1;
      END IF;

      previous_updated_at := page_row.sort_at;
      previous_lead_id := page_row.lead_id;
    END LOOP;

    EXIT WHEN page_rows = 0;

    page_count := page_count + 1;
    first_page_rows := COALESCE(first_page_rows, page_rows);
    last_page_rows := page_rows;
    cursor_updated_at := previous_updated_at;
    cursor_lead_id := previous_lead_id;

    EXIT WHEN page_rows < 101;
  END LOOP;

  SELECT pg_catalog.count(DISTINCT seen.lead_id)
  INTO distinct_seen
  FROM pg_catalog.unnest(seen_ids) AS seen(lead_id);

  RETURN pg_catalog.jsonb_build_object(
    'total_seen', total_seen,
    'distinct_seen', distinct_seen,
    'page_count', page_count,
    'first_page_rows', first_page_rows,
    'last_page_rows', last_page_rows,
    'mismatched_rows', mismatched_rows,
    'order_violations', order_violations
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_mutation(
  p_lead_id UUID,
  p_expected_workflow_version BIGINT,
  p_request_id UUID,
  p_stage_key TEXT,
  p_owner_membership_id UUID,
  p_next_action_text TEXT,
  p_next_action_due_date DATE,
  p_clear_next_action BOOLEAN,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  mutation_result JSONB;
BEGIN
  mutation_result := platform.mutate_sales_lead_workflow(
    p_lead_id,
    p_expected_workflow_version,
    p_request_id,
    p_stage_key,
    p_owner_membership_id,
    p_next_action_text,
    p_next_action_due_date,
    p_clear_next_action,
    p_reason
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'result', mutation_result
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_direct_lead_update(
  p_lead_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.leads AS lead
  SET stage_key = lead.stage_key
  WHERE lead.id = p_lead_id;

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

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_direct_audit_insert()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO platform.audit_events DEFAULT VALUES;
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

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_direct_receipt_insert()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO platform_private.sales_lead_workflow_receipts DEFAULT VALUES;
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

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_direct_receipt_select()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT pg_catalog.count(*)
  INTO row_count
  FROM platform_private.sales_lead_workflow_receipts;

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'row_count', row_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_invalid_lead(
  p_id UUID,
  p_organization_id UUID,
  p_client_id UUID,
  p_stage_key TEXT,
  p_next_action_text TEXT,
  p_next_action_due_date DATE,
  p_workflow_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO platform.leads (
    id,
    organization_id,
    client_id,
    stage_key,
    source_key,
    next_action_text,
    next_action_due_date,
    workflow_version
  ) VALUES (
    p_id,
    p_organization_id,
    p_client_id,
    p_stage_key,
    'manual',
    p_next_action_text,
    p_next_action_due_date,
    p_workflow_version
  );

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

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_receipt_update(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform_private.sales_lead_workflow_receipts AS receipt
  SET resulting_workflow_version = receipt.resulting_workflow_version
  WHERE receipt.request_id = p_request_id;

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

CREATE OR REPLACE FUNCTION pg_temp.u4_attempt_audit_update(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.audit_events AS event
  SET reason = event.reason
  WHERE event.request_id = p_request_id;

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

GRANT EXECUTE ON FUNCTION pg_temp.u4_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_page()
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_detail(UUID)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.u4_traverse_filtered_leads(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_mutation(
  UUID, BIGINT, UUID, TEXT, UUID, TEXT, DATE, BOOLEAN, TEXT
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_direct_lead_update(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_direct_audit_insert()
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_direct_receipt_insert()
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u4_attempt_direct_receipt_select()
  TO authenticated;

SELECT pg_temp.u4_assert(
  (
    SELECT lead.stage_key = 'new'
      AND lead.workflow_version = 2
    FROM platform.leads AS lead
    WHERE lead.id = '86009999-0000-4000-8000-000000000003'
      AND lead.organization_id = '86009999-0000-4000-8000-000000000001'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(event.actor_kind = 'system')
      AND pg_catalog.bool_and(
        event.actor_principal = 'migration:086_platform_sales_workflow'
      )
      AND pg_catalog.bool_and(event.action = 'lead.sales.stage.normalized')
      AND pg_catalog.bool_and(event.before_state ->> 'stage_key' = 'new_inbound')
      AND pg_catalog.bool_and(event.before_state ->> 'workflow_version' = '1')
      AND pg_catalog.bool_and(event.after_state ->> 'stage_key' = 'new')
      AND pg_catalog.bool_and(event.after_state ->> 'workflow_version' = '2')
      AND pg_catalog.bool_and(event.resulting_version = 2)
    FROM platform.audit_events AS event
    WHERE event.resource_type = 'lead'
      AND event.resource_id = '86009999-0000-4000-8000-000000000003'
      AND event.action = 'lead.sales.stage.normalized'
  ),
  'migration 086 did not normalize and audit the sole U3 legacy stage'
);

\set u4_org_a '86000000-0000-4000-8000-000000000001'
\set u4_org_b '86000000-0000-4000-8000-000000000002'
\set u4_scope_a '86000000-0000-4000-8000-000000000011'
\set u4_scope_b '86000000-0000-4000-8000-000000000012'

\set u4_admin_user '86000000-0000-4000-8000-000000000101'
\set u4_sales_user '86000000-0000-4000-8000-000000000102'
\set u4_sales_two_user '86000000-0000-4000-8000-000000000103'
\set u4_curator_user '86000000-0000-4000-8000-000000000104'
\set u4_inactive_sales_user '86000000-0000-4000-8000-000000000105'
\set u4_blocked_sales_user '86000000-0000-4000-8000-000000000106'
\set u4_admin_b_user '86000000-0000-4000-8000-000000000107'
\set u4_sales_b_user '86000000-0000-4000-8000-000000000108'

\set u4_admin_profile '86000000-0000-4000-8000-000000000201'
\set u4_sales_profile '86000000-0000-4000-8000-000000000202'
\set u4_sales_two_profile '86000000-0000-4000-8000-000000000203'
\set u4_curator_profile '86000000-0000-4000-8000-000000000204'
\set u4_inactive_sales_profile '86000000-0000-4000-8000-000000000205'
\set u4_blocked_sales_profile '86000000-0000-4000-8000-000000000206'
\set u4_admin_b_profile '86000000-0000-4000-8000-000000000207'
\set u4_sales_b_profile '86000000-0000-4000-8000-000000000208'

\set u4_admin_membership '86000000-0000-4000-8000-000000000301'
\set u4_sales_membership '86000000-0000-4000-8000-000000000302'
\set u4_sales_two_membership '86000000-0000-4000-8000-000000000303'
\set u4_curator_membership '86000000-0000-4000-8000-000000000304'
\set u4_inactive_sales_membership '86000000-0000-4000-8000-000000000305'
\set u4_blocked_sales_membership '86000000-0000-4000-8000-000000000306'
\set u4_admin_b_membership '86000000-0000-4000-8000-000000000307'
\set u4_sales_b_membership '86000000-0000-4000-8000-000000000308'

\set u4_client_new '86000000-0000-4000-8000-000000000501'
\set u4_client_contacting '86000000-0000-4000-8000-000000000502'
\set u4_client_qualified '86000000-0000-4000-8000-000000000503'
\set u4_client_meeting_scheduled '86000000-0000-4000-8000-000000000504'
\set u4_client_meeting_completed '86000000-0000-4000-8000-000000000505'
\set u4_client_potential '86000000-0000-4000-8000-000000000506'
\set u4_client_other_org '86000000-0000-4000-8000-000000000507'

\set u4_lead_new '86000000-0000-4000-8000-000000000601'
\set u4_lead_contacting '86000000-0000-4000-8000-000000000602'
\set u4_lead_qualified '86000000-0000-4000-8000-000000000603'
\set u4_lead_meeting_scheduled '86000000-0000-4000-8000-000000000604'
\set u4_lead_meeting_completed '86000000-0000-4000-8000-000000000605'
\set u4_lead_potential '86000000-0000-4000-8000-000000000606'
\set u4_lead_other_org '86000000-0000-4000-8000-000000000607'
\set u4_lead_converted '86000000-0000-4000-8000-000000000608'
\set u4_lead_disqualified '86000000-0000-4000-8000-000000000609'
\set u4_lead_archived '86000000-0000-4000-8000-000000000610'

INSERT INTO platform.organizations (id, name)
VALUES
  (:'u4_org_a', 'U4 Organization A'),
  (:'u4_org_b', 'U4 Organization B');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'u4_scope_a', :'u4_org_a', 'organization', :'u4_org_a', 1),
  (:'u4_scope_b', :'u4_org_b', 'organization', :'u4_org_b', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'u4_admin_user', 'u4-admin@example.invalid', '{}'),
  (:'u4_sales_user', 'u4-sales@example.invalid', '{}'),
  (:'u4_sales_two_user', 'u4-sales-two@example.invalid', '{}'),
  (:'u4_curator_user', 'u4-curator@example.invalid', '{}'),
  (:'u4_inactive_sales_user', 'u4-inactive@example.invalid', '{}'),
  (:'u4_blocked_sales_user', 'u4-blocked@example.invalid', '{}'),
  (:'u4_admin_b_user', 'u4-admin-b@example.invalid', '{}'),
  (:'u4_sales_b_user', 'u4-sales-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'u4_admin_profile', :'u4_admin_user', 'U4 Admin', 'active', 1),
  (:'u4_sales_profile', :'u4_sales_user', 'U4 Sales', 'active', 1),
  (
    :'u4_sales_two_profile', :'u4_sales_two_user',
    'U4 Sales Two', 'active', 1
  ),
  (:'u4_curator_profile', :'u4_curator_user', 'U4 Curator', 'active', 1),
  (
    :'u4_inactive_sales_profile', :'u4_inactive_sales_user',
    'U4 Inactive Sales', 'active', 1
  ),
  (
    :'u4_blocked_sales_profile', :'u4_blocked_sales_user',
    'U4 Blocked Sales', 'blocked', 1
  ),
  (:'u4_admin_b_profile', :'u4_admin_b_user', 'U4 Admin B', 'active', 1),
  (:'u4_sales_b_profile', :'u4_sales_b_user', 'U4 Sales B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (
    :'u4_admin_membership', :'u4_org_a', :'u4_admin_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'u4_sales_membership', :'u4_org_a', :'u4_sales_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u4_sales_two_membership', :'u4_org_a', :'u4_sales_two_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u4_curator_membership', :'u4_org_a', :'u4_curator_profile',
    'active', 'curator', '00000000-0000-4000-8000-000000001303'
  ),
  (
    :'u4_inactive_sales_membership', :'u4_org_a',
    :'u4_inactive_sales_profile',
    'inactive', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u4_blocked_sales_membership', :'u4_org_a',
    :'u4_blocked_sales_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u4_admin_b_membership', :'u4_org_b', :'u4_admin_b_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'u4_sales_b_membership', :'u4_org_b', :'u4_sales_b_profile',
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
)
SELECT
  fixture.id,
  fixture.organization_id,
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'U4 authorization fixture',
  fixture.request_id
FROM (VALUES
  (
    '86000000-0000-4000-8000-000000000401'::UUID,
    :'u4_org_a'::UUID, :'u4_admin_membership'::UUID, :'u4_scope_a'::UUID,
    '86000000-0000-4000-8000-000000000451'::UUID
  ),
  (
    '86000000-0000-4000-8000-000000000402'::UUID,
    :'u4_org_a'::UUID, :'u4_sales_membership'::UUID, :'u4_scope_a'::UUID,
    '86000000-0000-4000-8000-000000000452'::UUID
  ),
  (
    '86000000-0000-4000-8000-000000000403'::UUID,
    :'u4_org_a'::UUID, :'u4_sales_two_membership'::UUID, :'u4_scope_a'::UUID,
    '86000000-0000-4000-8000-000000000453'::UUID
  ),
  (
    '86000000-0000-4000-8000-000000000404'::UUID,
    :'u4_org_a'::UUID, :'u4_curator_membership'::UUID, :'u4_scope_a'::UUID,
    '86000000-0000-4000-8000-000000000454'::UUID
  ),
  (
    '86000000-0000-4000-8000-000000000407'::UUID,
    :'u4_org_b'::UUID, :'u4_admin_b_membership'::UUID, :'u4_scope_b'::UUID,
    '86000000-0000-4000-8000-000000000457'::UUID
  ),
  (
    '86000000-0000-4000-8000-000000000408'::UUID,
    :'u4_org_b'::UUID, :'u4_sales_b_membership'::UUID, :'u4_scope_b'::UUID,
    '86000000-0000-4000-8000-000000000458'::UUID
  )
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO platform.clients (
  id, organization_id, display_name, normalized_name
)
VALUES
  (
    :'u4_client_new', :'u4_org_a', 'U4 Connected Client',
    platform_private.normalize_person_name('U4 Connected Client')
  ),
  (
    :'u4_client_contacting', :'u4_org_a', 'U4 Same Client Only',
    platform_private.normalize_person_name('U4 Same Client Only')
  ),
  (
    :'u4_client_qualified', :'u4_org_a', 'U4 Other Owner',
    platform_private.normalize_person_name('U4 Other Owner')
  ),
  (
    :'u4_client_meeting_scheduled', :'u4_org_a', 'U4 Stage Sequence',
    platform_private.normalize_person_name('U4 Stage Sequence')
  ),
  (
    :'u4_client_meeting_completed', :'u4_org_a', 'U4 Admin Assignment',
    platform_private.normalize_person_name('U4 Admin Assignment')
  ),
  (
    :'u4_client_potential', :'u4_org_a', 'U4 Overdue Lead',
    platform_private.normalize_person_name('U4 Overdue Lead')
  ),
  (
    :'u4_client_other_org', :'u4_org_b', 'U4 Other Organization',
    platform_private.normalize_person_name('U4 Other Organization')
  );

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  next_action_text,
  next_action_due_date
)
VALUES
  (
    :'u4_lead_new', :'u4_org_a', :'u4_client_new', NULL,
    'new', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_contacting', :'u4_org_a', :'u4_client_contacting',
    :'u4_sales_membership', 'contacting', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_qualified', :'u4_org_a', :'u4_client_qualified',
    :'u4_sales_two_membership', 'qualified', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_meeting_scheduled', :'u4_org_a',
    :'u4_client_meeting_scheduled', NULL,
    'meeting_scheduled', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_meeting_completed', :'u4_org_a',
    :'u4_client_meeting_completed', NULL,
    'meeting_completed', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_potential', :'u4_org_a', :'u4_client_potential', NULL,
    'potential', 'manual', 'Call overdue applicant', '2000-01-01'
  ),
  (
    :'u4_lead_other_org', :'u4_org_b', :'u4_client_other_org', NULL,
    'new', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_converted', :'u4_org_a', NULL, NULL,
    'new', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_disqualified', :'u4_org_a', NULL, NULL,
    'new', 'manual', NULL, NULL
  ),
  (
    :'u4_lead_archived', :'u4_org_a', NULL, NULL,
    'new', 'manual', NULL, NULL
  );

UPDATE platform.leads
SET lifecycle_state = CASE id
  WHEN :'u4_lead_converted'::UUID THEN 'converted'::platform.lead_lifecycle_state
  WHEN :'u4_lead_disqualified'::UUID
    THEN 'disqualified'::platform.lead_lifecycle_state
  WHEN :'u4_lead_archived'::UUID THEN 'archived'::platform.lead_lifecycle_state
  ELSE lifecycle_state
END
WHERE id IN (
  :'u4_lead_converted'::UUID,
  :'u4_lead_disqualified'::UUID,
  :'u4_lead_archived'::UUID
);

INSERT INTO platform_private.provider_webhook_events (
  id,
  organization_id,
  provider,
  provider_account_ref,
  provider_conversation_ref,
  provider_event_variant_ref,
  provider_request_id,
  waha_session_name,
  payload_id,
  event_type,
  provider_occurred_at,
  verification_status,
  raw_payload,
  verification_headers,
  verification_evidence_ref,
  payload_sha256,
  request_id
)
VALUES
  (
    '86000000-0000-4000-8000-000000000701',
    :'u4_org_a',
    'waha',
    'synthetic:u4:waha',
    NULL,
    NULL,
    'synthetic-u4-connected',
    'u4-test-session',
    'synthetic-u4-connected-payload',
    'message.any',
    '2026-08-24 08:00:00+06'::TIMESTAMPTZ,
    'verified',
    '{"event":"synthetic-u4-connected"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:u4:connected',
    repeat('a', 64),
    '86000000-0000-4000-8000-000000000711'
  ),
  (
    '86000000-0000-4000-8000-000000000702',
    :'u4_org_a',
    'waha',
    'synthetic:u4:waha',
    NULL,
    NULL,
    'synthetic-u4-same-client',
    'u4-test-session',
    'synthetic-u4-same-client-payload',
    'message.any',
    '2026-08-24 08:01:00+06'::TIMESTAMPTZ,
    'verified',
    '{"event":"synthetic-u4-same-client"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:u4:same-client',
    repeat('b', 64),
    '86000000-0000-4000-8000-000000000712'
  );

INSERT INTO platform.communication_conversations (
  id,
  organization_id,
  student_case_id,
  responsible_sales_membership_id,
  current_curator_membership_id,
  queue,
  status,
  subject,
  waha_session_name,
  kommo_account_id,
  kommo_conversation_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  current_scope_id,
  current_scope_version,
  created_from_webhook_event_id,
  canonical_client_id,
  canonical_lead_id
)
VALUES
  (
    '86000000-0000-4000-8000-000000000801',
    :'u4_org_a',
    NULL,
    :'u4_sales_membership',
    NULL,
    'sales',
    'open',
    'U4 directly connected conversation',
    'u4-test-session',
    8601,
    NULL,
    8611,
    8621,
    8631,
    :'u4_scope_a',
    1,
    '86000000-0000-4000-8000-000000000701',
    :'u4_client_new',
    :'u4_lead_new'
  ),
  (
    '86000000-0000-4000-8000-000000000802',
    :'u4_org_a',
    NULL,
    :'u4_sales_membership',
    NULL,
    'sales',
    'open',
    'U4 same-client-only conversation',
    'u4-test-session',
    8602,
    NULL,
    8612,
    8622,
    8632,
    :'u4_scope_a',
    1,
    '86000000-0000-4000-8000-000000000702',
    :'u4_client_contacting',
    NULL
  );

SELECT jsonb_build_object(
  'sub', :'u4_admin_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u4_org_a',
  'platform_membership_id', :'u4_admin_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u4_admin_claims,
jsonb_build_object(
  'sub', :'u4_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u4_org_a',
  'platform_membership_id', :'u4_sales_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u4_sales_claims,
jsonb_build_object(
  'sub', :'u4_sales_two_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u4_org_a',
  'platform_membership_id', :'u4_sales_two_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u4_sales_two_claims,
jsonb_build_object(
  'sub', :'u4_curator_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', 1,
  'platform_organization_id', :'u4_org_a',
  'platform_membership_id', :'u4_curator_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001303',
  'platform_bundle_version', 13
)::TEXT AS u4_curator_claims,
jsonb_build_object(
  'sub', :'u4_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u4_org_b',
  'platform_membership_id', :'u4_admin_b_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u4_admin_b_claims
\gset

-- Durable schema, RLS, function hardening and execute-grant posture.
SELECT pg_temp.u4_assert(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'platform_private.sales_lead_workflow_receipts'::REGCLASS
  ),
  'receipt table is not forced-RLS'
);

SELECT pg_temp.u4_assert(
  NOT has_table_privilege(
    'authenticated',
    'platform.leads',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform.audit_events',
    'INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.sales_lead_workflow_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'anon',
    'platform_private.sales_lead_workflow_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.sales_lead_workflow_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'browser or server API role received a direct U4 table path'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 4
      AND pg_catalog.bool_and(procedure.prosecdef)
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname IN (
        'staff_sales_lead_page',
        'staff_sales_lead_detail',
        'staff_sales_owner_options',
        'mutate_sales_lead_workflow'
      )
  ),
  'U4 RPC is missing SECURITY DEFINER or empty search_path'
);

SELECT pg_temp.u4_assert(
  has_function_privilege(
    'authenticated',
    'platform.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_sales_lead_detail(uuid)'::REGPROCEDURE,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_sales_owner_options(integer,text,uuid,text)'::REGPROCEDURE,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.mutate_sales_lead_workflow(uuid,bigint,uuid,text,uuid,text,date,boolean,text)'::REGPROCEDURE,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.mutate_sales_lead_workflow(uuid,bigint,uuid,text,uuid,text,date,boolean,text)'::REGPROCEDURE,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.mutate_sales_lead_workflow(uuid,bigint,uuid,text,uuid,text,date,boolean,text)'::REGPROCEDURE,
    'EXECUTE'
  ),
  'U4 function execute grants are broader or narrower than authenticated-only'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(DISTINCT lead.stage_key) = 6
      AND pg_catalog.array_agg(
        DISTINCT lead.stage_key ORDER BY lead.stage_key
      ) = ARRAY[
        'contacting',
        'meeting_completed',
        'meeting_scheduled',
        'new',
        'potential',
        'qualified'
      ]::TEXT[]
    FROM platform.leads AS lead
    WHERE lead.organization_id = :'u4_org_a'
  ),
  'the exact six U4 stage values were not accepted'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_invalid_lead(
      '86000000-0000-4000-8000-000000000851',
      :'u4_org_a',
      :'u4_client_new',
      'contract_signed',
      NULL,
      NULL,
      1
    ) ->> 'sqlstate'
  ) = '23514'
  AND (
    pg_temp.u4_attempt_invalid_lead(
      '86000000-0000-4000-8000-000000000852',
      :'u4_org_a',
      :'u4_client_new',
      'new_inbound',
      NULL,
      NULL,
      1
    ) ->> 'sqlstate'
  ) = '23514'
  AND (
    pg_temp.u4_attempt_invalid_lead(
      '86000000-0000-4000-8000-000000000853',
      :'u4_org_a',
      :'u4_client_new',
      'new',
      'Missing due date',
      NULL,
      1
    ) ->> 'sqlstate'
  ) = '23514'
  AND (
    pg_temp.u4_attempt_invalid_lead(
      '86000000-0000-4000-8000-000000000854',
      :'u4_org_a',
      :'u4_client_new',
      'new',
      NULL,
      NULL,
      0
    ) ->> 'sqlstate'
  ) = '23514',
  'stage, action-pair, or positive-version database constraint failed open'
);

SELECT pg_temp.u4_assert(
  EXISTS (
    SELECT 1
    FROM platform.communication_conversations AS conversation
    WHERE conversation.id = '86000000-0000-4000-8000-000000000802'
      AND conversation.canonical_client_id = :'u4_client_contacting'
      AND conversation.canonical_lead_id IS NULL
  ),
  'same-client-only conversation fixture accidentally linked the lead'
);

-- The owner catalog must remain reachable after the first application-sized
-- page. These synthetic memberships need no login or scope because they are
-- selectable owner targets only; the live actor remains the existing Admin or
-- Sales fixture and every RPC still resolves that actor from the JWT.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT
  pg_catalog.format(
    '86001000-0000-4000-8000-%s',
    pg_catalog.lpad(series.value::TEXT, 12, '0')
  )::UUID,
  pg_catalog.format('u4-page-owner-%s@example.invalid', series.value),
  '{}'::JSONB
FROM pg_catalog.generate_series(1, 51) AS series(value);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
SELECT
  pg_catalog.format(
    '86002000-0000-4000-8000-%s',
    pg_catalog.lpad(series.value::TEXT, 12, '0')
  )::UUID,
  pg_catalog.format(
    '86001000-0000-4000-8000-%s',
    pg_catalog.lpad(series.value::TEXT, 12, '0')
  )::UUID,
  pg_catalog.format('U4 Page Owner %s', pg_catalog.lpad(series.value::TEXT, 3, '0')),
  'active',
  1
FROM pg_catalog.generate_series(1, 51) AS series(value);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
SELECT
  pg_catalog.format(
    '86003000-0000-4000-8000-%s',
    pg_catalog.lpad(series.value::TEXT, 12, '0')
  )::UUID,
  :'u4_org_a'::UUID,
  pg_catalog.format(
    '86002000-0000-4000-8000-%s',
    pg_catalog.lpad(series.value::TEXT, 12, '0')
  )::UUID,
  'active',
  'sales',
  '00000000-0000-4000-8000-000000001302'::UUID
FROM pg_catalog.generate_series(1, 51) AS series(value);

-- Sales sees only self-owned plus unowned rows. Connected means a direct lead
-- link; a conversation linked to the same client alone remains unconnected.
SET LOCAL request.jwt.claims TO :'u4_sales_claims';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 5
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'all', 'all', 'all', NULL, 'all', NULL
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'all', 'all', 'all', NULL, 'all', NULL
    ) AS lead
    WHERE lead.lead_id = :'u4_lead_qualified'
  ),
  'Sales visibility widened beyond self-owned plus unowned leads'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(lead.is_connected)
      AND pg_catalog.bool_and(lead.lead_id = :'u4_lead_new')
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'connected', 'all', 'all', NULL, 'all', NULL
    ) AS lead
  )
  AND EXISTS (
    SELECT 1
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'unconnected', 'all', 'all', NULL, 'all', NULL
    ) AS lead
    WHERE lead.lead_id = :'u4_lead_contacting'
      AND NOT lead.is_connected
  ),
  'connected truth was inferred from the client instead of direct lead link'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(lead.lead_id = :'u4_lead_potential')
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'all', 'all', 'all', NULL, 'overdue', NULL
    ) AS lead
  ),
  'Bishkek overdue filter did not retain the past calendar date'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        owner.membership_id = :'u4_sales_membership'
      )
    FROM platform.staff_sales_owner_options(101, NULL, NULL, NULL) AS owner
  ),
  'Sales owner options exposed another membership'
);

SELECT pg_temp.u4_assert(
  (pg_temp.u4_attempt_direct_lead_update(:'u4_lead_new') ->> 'sqlstate')
    = '42501'
  AND (pg_temp.u4_attempt_direct_audit_insert() ->> 'sqlstate') = '42501'
  AND (pg_temp.u4_attempt_direct_receipt_insert() ->> 'sqlstate') = '42501'
  AND (pg_temp.u4_attempt_direct_receipt_select() ->> 'sqlstate') = '42501',
  'authenticated received a direct lead, audit, or receipt path'
);

SELECT pg_temp.u4_attempt_mutation(
  :'u4_lead_new',
  1,
  '86000000-0000-4000-8000-000000000901',
  'contacting',
  :'u4_sales_membership',
  '  Call applicant  ',
  '2000-01-01',
  FALSE,
  '   '
) AS u4_claim_attempt
\gset

SELECT pg_temp.u4_assert(
  (:'u4_claim_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u4_claim_attempt'::JSONB #>> '{result,stage_key}') = 'contacting'
  AND (
    :'u4_claim_attempt'::JSONB #>> '{result,current_owner_membership_id}'
  ) = :'u4_sales_membership'
  AND (:'u4_claim_attempt'::JSONB #>> '{result,next_action_text}')
    = 'Call applicant'
  AND (:'u4_claim_attempt'::JSONB #>> '{result,next_action_due_date}')
    = '2000-01-01'
  AND (:'u4_claim_attempt'::JSONB #>> '{result,workflow_version}') = '2',
  'Sales atomic self-claim did not commit the normalized desired snapshot'
);

SELECT pg_temp.u4_attempt_mutation(
  :'u4_lead_new',
  1,
  '86000000-0000-4000-8000-000000000901',
  'contacting',
  :'u4_sales_membership',
  'Call applicant',
  '2000-01-01',
  FALSE,
  NULL
) AS u4_replay_attempt
\gset

SELECT pg_temp.u4_assert(
  (:'u4_replay_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u4_replay_attempt'::JSONB -> 'result')
    = (:'u4_claim_attempt'::JSONB -> 'result'),
  'exact retry did not return the stored receipt before stale checking'
);

SELECT pg_temp.u4_assert(
  (
    WITH attempt AS (
      SELECT pg_temp.u4_attempt_mutation(
        :'u4_lead_new',
        1,
        '86000000-0000-4000-8000-000000000901',
        'qualified',
        :'u4_sales_membership',
        'Call applicant',
        '2000-01-01',
        FALSE,
        NULL
      ) AS result
    )
    SELECT result ->> 'sqlstate' = '23505'
      AND result ->> 'message' = 'request_id_conflict'
    FROM attempt
  ),
  'request UUID reuse with a different payload was not rejected'
);

SELECT pg_temp.u4_assert(
  (
    WITH attempt AS (
      SELECT pg_temp.u4_attempt_mutation(
        :'u4_lead_new',
        1,
        '86000000-0000-4000-8000-000000000902',
        'qualified',
        :'u4_sales_membership',
        'Call applicant',
        '2000-01-01',
        FALSE,
        NULL
      ) AS result
    )
    SELECT result ->> 'sqlstate' = 'PT409'
      AND result ->> 'message' = 'workflow_version_conflict'
    FROM attempt
  ),
  'stale workflow version was not rejected'
);

SELECT pg_temp.u4_assert(
  (
    WITH attempt AS (
      SELECT pg_temp.u4_attempt_mutation(
        :'u4_lead_new',
        2,
        '86000000-0000-4000-8000-000000000903',
        'contacting',
        :'u4_sales_membership',
        'Call applicant',
        '2000-01-01',
        FALSE,
        NULL
      ) AS result
    )
    SELECT result ->> 'sqlstate' = '22000'
      AND result ->> 'message' = 'workflow_no_change'
    FROM attempt
  ),
  'full desired-state no-op was not rejected'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000904',
      'contacting',
      :'u4_sales_membership',
      'Missing date',
      NULL,
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_next_action'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000905',
      'contacting',
      :'u4_sales_membership',
      'Unexpected text while clearing',
      '2000-01-01',
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_next_action'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000906',
      'contract_signed',
      :'u4_sales_membership',
      'Call applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_stage',
  'invalid action pairing or out-of-scope stage did not fail closed'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000907',
      'contacting',
      NULL,
      'Call applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000908',
      'contacting',
      :'u4_sales_two_membership',
      'Call applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_qualified',
      1,
      '86000000-0000-4000-8000-000000000909',
      'qualified',
      :'u4_sales_two_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden',
  'Sales reassignment, relinquish, or other-owner denial failed'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      2,
      '86000000-0000-4000-8000-000000000910',
      'contacting',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_reason_required',
  'removing a populated next action did not require a reason'
);

SELECT pg_temp.u4_attempt_mutation(
  :'u4_lead_new',
  2,
  '86000000-0000-4000-8000-000000000911',
  'contacting',
  :'u4_sales_membership',
  NULL,
  NULL,
  TRUE,
  'Applicant asked to reschedule follow-up'
) AS u4_clear_attempt
\gset

SELECT pg_temp.u4_assert(
  (:'u4_clear_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u4_clear_attempt'::JSONB #>> '{result,workflow_version}') = '3'
  AND (:'u4_clear_attempt'::JSONB #> '{result,next_action_text}') = 'null'
  AND (:'u4_clear_attempt'::JSONB #> '{result,next_action_due_date}') = 'null',
  'explicit reasoned clear did not commit the empty action pair'
);

RESET ROLE;

SELECT pg_temp.u4_assert(
  (
    SELECT lead.workflow_version = 3
      AND lead.stage_key = 'contacting'
      AND lead.current_owner_membership_id = :'u4_sales_membership'
      AND lead.next_action_text IS NULL
      AND lead.next_action_due_date IS NULL
    FROM platform.leads AS lead
    WHERE lead.id = :'u4_lead_new'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
    FROM platform.audit_events AS event
    WHERE event.resource_type = 'lead'
      AND event.resource_id = :'u4_lead_new'
      AND event.action = 'lead.sales.workflow.changed'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
    FROM platform_private.sales_lead_workflow_receipts AS receipt
    WHERE receipt.lead_id = :'u4_lead_new'
  ),
  'negative attempts, replay, or clear created partial durable state'
);

SELECT pg_temp.u4_assert(
  (
    SELECT event.organization_id = :'u4_org_a'
      AND event.actor_kind = 'user'
      AND event.actor_profile_id = :'u4_sales_profile'
      AND event.actor_membership_id = :'u4_sales_membership'
      AND event.actor_principal = 'auth:' || :'u4_sales_user'
      AND event.reason = 'sales_workflow_update'
      AND event.resulting_version = 2
      AND event.before_state ->> 'workflow_version' = '1'
      AND event.after_state ->> 'workflow_version' = '2'
      AND event.created_at IS NOT NULL
      AND receipt.actor_profile_id = event.actor_profile_id
      AND receipt.actor_membership_id = event.actor_membership_id
      AND receipt.resulting_workflow_version = event.resulting_version
      AND receipt.created_at = event.created_at
      AND (receipt.result ->> 'changed_at')::TIMESTAMPTZ = event.created_at
    FROM platform.audit_events AS event
    JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.request_id = event.request_id
    WHERE event.request_id = '86000000-0000-4000-8000-000000000901'
  ),
  'audit/receipt lost durable actor, time, version, or before/after evidence'
);

SELECT pg_temp.u4_assert(
  (pg_temp.u4_attempt_receipt_update(
    '86000000-0000-4000-8000-000000000901'
  ) ->> 'sqlstate') = '55000'
  AND (pg_temp.u4_attempt_audit_update(
    '86000000-0000-4000-8000-000000000901'
  ) ->> 'sqlstate') = '55000',
  'audit or receipt append-only trigger allowed an UPDATE'
);

-- Admin sees every same-organization lead and exactly the two active Sales
-- memberships. Cross-organization and ineligible owner identities stay out.
SET LOCAL request.jwt.claims TO :'u4_admin_claims';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 6
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'all', 'all', 'all', NULL, 'all', NULL
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM platform.staff_sales_lead_detail(:'u4_lead_other_org')
  ),
  'Admin tenant boundary widened outside the current organization'
);

SELECT pg_temp.u4_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_sales_lead_page(
      101, NULL, NULL, 'all', 'all', 'all', NULL, 'all', NULL
    ) AS lead
    WHERE lead.lead_id IN (
      :'u4_lead_converted'::UUID,
      :'u4_lead_disqualified'::UUID,
      :'u4_lead_archived'::UUID
    )
  )
  AND (
    SELECT pg_catalog.count(*)
    FROM platform.staff_sales_lead_detail(:'u4_lead_converted')
  ) = 0
  AND (
    SELECT pg_catalog.count(*)
    FROM platform.staff_sales_lead_detail(:'u4_lead_disqualified')
  ) = 0
  AND (
    SELECT pg_catalog.count(*)
    FROM platform.staff_sales_lead_detail(:'u4_lead_archived')
  ) = 0,
  'converted, disqualified, or archived lead leaked into U4 reads'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 53
      AND pg_catalog.bool_and(
        owner.membership_id IN (
          :'u4_sales_membership'::UUID,
          :'u4_sales_two_membership'::UUID
        )
        OR owner.membership_id::TEXT LIKE
          '86003000-0000-4000-8000-%'
      )
    FROM platform.staff_sales_owner_options(101, NULL, NULL, NULL) AS owner
  ),
  'Admin owner options admitted inactive, blocked, non-Sales, or cross-org rows'
);

SELECT pg_temp.u4_assert(
  (
    WITH first_page AS MATERIALIZED (
      SELECT owner.*
      FROM platform.staff_sales_owner_options(50, NULL, NULL, 'U4') AS owner
    ),
    boundary AS MATERIALIZED (
      SELECT owner.sort_label, owner.membership_id
      FROM first_page AS owner
      ORDER BY owner.sort_label DESC, owner.membership_id DESC
      LIMIT 1
    ),
    second_page AS MATERIALIZED (
      SELECT owner.*
      FROM boundary
      CROSS JOIN LATERAL platform.staff_sales_owner_options(
        50,
        boundary.sort_label,
        boundary.membership_id,
        'U4'
      ) AS owner
    )
    SELECT
      (SELECT pg_catalog.count(*) FROM first_page) = 50
      AND (SELECT pg_catalog.count(*) FROM second_page) = 3
      AND NOT EXISTS (
        SELECT 1
        FROM first_page AS first_owner
        JOIN second_page AS second_owner
          USING (membership_id)
      )
      AND EXISTS (
        SELECT 1
        FROM second_page AS owner
        WHERE owner.membership_id =
          '86003000-0000-4000-8000-000000000051'::UUID
      )
      AND NOT EXISTS (
        SELECT 1
        FROM first_page AS first_owner
        CROSS JOIN second_page AS second_owner
        WHERE (
          second_owner.sort_label,
          second_owner.membership_id
        ) <= (
          first_owner.sort_label,
          first_owner.membership_id
        )
      )
  ),
  'Admin owner search/cursor did not expose the complete stable second page'
);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        owner.membership_id =
          '86003000-0000-4000-8000-000000000051'::UUID
      )
      AND pg_catalog.bool_and(owner.display_label = 'U4 Page Owner 051')
    FROM platform.staff_sales_owner_options(
      2,
      NULL,
      NULL,
      '86003000-0000-4000-8000-000000000051'
    ) AS owner
  ),
  'exact selected-owner UUID did not hydrate its truthful eligible label'
);

SELECT pg_temp.u4_assert(
  (
    WITH attempt AS (
      SELECT pg_temp.u4_attempt_mutation(
        :'u4_lead_new',
        1,
        '86000000-0000-4000-8000-000000000901',
        'contacting',
        :'u4_sales_membership',
        'Call applicant',
        '2000-01-01',
        FALSE,
        NULL
      ) AS result
    )
    SELECT result ->> 'sqlstate' = '23505'
      AND result ->> 'message' = 'request_id_conflict'
    FROM attempt
  ),
  'another actor could replay a Sales request UUID'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_qualified',
      1,
      '86000000-0000-4000-8000-000000000920',
      'qualified',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_reason_required',
  'Admin reassignment without reason was accepted'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_qualified',
      1,
      '86000000-0000-4000-8000-000000000921',
      'qualified',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      'Territory transfer approved by Sales lead'
    ) #>> '{result,workflow_version}'
  ) = '2',
  'reasoned Admin reassignment did not commit'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_qualified',
      2,
      '86000000-0000-4000-8000-000000000922',
      'qualified',
      NULL,
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_reason_required'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_qualified',
      2,
      '86000000-0000-4000-8000-000000000923',
      'qualified',
      NULL,
      NULL,
      NULL,
      TRUE,
      'Lead returned to shared queue'
    ) #>> '{result,workflow_version}'
  ) = '3',
  'Admin unassignment reason rule or committed unassignment failed'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_completed',
      1,
      '86000000-0000-4000-8000-000000000924',
      'meeting_completed',
      :'u4_sales_two_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) #>> '{result,workflow_version}'
  ) = '2',
  'Admin initial assignment to eligible Sales did not commit'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_potential',
      1,
      '86000000-0000-4000-8000-000000000925',
      'potential',
      :'u4_admin_membership',
      'Call overdue applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_potential',
      1,
      '86000000-0000-4000-8000-000000000926',
      'potential',
      :'u4_curator_membership',
      'Call overdue applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_potential',
      1,
      '86000000-0000-4000-8000-000000000927',
      'potential',
      :'u4_inactive_sales_membership',
      'Call overdue applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_potential',
      1,
      '86000000-0000-4000-8000-000000000928',
      'potential',
      :'u4_blocked_sales_membership',
      'Call overdue applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_potential',
      1,
      '86000000-0000-4000-8000-000000000929',
      'potential',
      :'u4_sales_b_membership',
      'Call overdue applicant',
      '2000-01-01',
      FALSE,
      NULL
    ) ->> 'message'
  ) = 'workflow_invalid_owner',
  'Admin could select an ineligible or cross-organization owner'
);

-- Every distinct transition among the six values is permitted; this reverse
-- and non-adjacent sequence proves U4 did not invent an adjacency graph.
SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 1,
      '86000000-0000-4000-8000-000000000930',
      'new', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '2'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 2,
      '86000000-0000-4000-8000-000000000931',
      'contacting', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '3'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 3,
      '86000000-0000-4000-8000-000000000932',
      'qualified', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '4'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 4,
      '86000000-0000-4000-8000-000000000933',
      'meeting_completed', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '5'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 5,
      '86000000-0000-4000-8000-000000000934',
      'potential', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '6'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_meeting_scheduled', 6,
      '86000000-0000-4000-8000-000000000935',
      'meeting_scheduled', NULL, NULL, NULL, TRUE, NULL
    ) #>> '{result,workflow_version}'
  ) = '7',
  'one or more distinct transitions among the six U4 stages failed'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_other_org',
      1,
      '86000000-0000-4000-8000-000000000936',
      'new',
      NULL,
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden',
  'cross-organization mutation did not fail as not-found-or-forbidden'
);

SELECT pg_temp.u4_assert(
  (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_converted', 1,
      '86000000-0000-4000-8000-000000000937',
      'contacting', NULL, NULL, NULL, TRUE, NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_disqualified', 1,
      '86000000-0000-4000-8000-000000000938',
      'contacting', NULL, NULL, NULL, TRUE, NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_archived', 1,
      '86000000-0000-4000-8000-000000000939',
      'contacting', NULL, NULL, NULL, TRUE, NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden',
  'a non-open lead remained mutable through the U4 command boundary'
);

RESET ROLE;

-- Prove the filtered queue remains complete beyond PostgREST's common 1,000
-- row ceiling. The four interleaved decoys make the filter part of the proof;
-- the authenticated Sales helper then follows the real keyset cursor through
-- all 1,001 matching rows without duplicates, gaps, or order drift.
INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state,
  created_at,
  updated_at
)
SELECT
  (
    '86001000-0000-4000-8000-'
    || pg_catalog.lpad(series.ordinal::TEXT, 12, '0')
  )::UUID,
  :'u4_org_a',
  NULL,
  NULL,
  'new',
  CASE
    WHEN series.ordinal <= 1001 THEN 'u4_bulk_target'
    ELSE 'u4_bulk_decoy'
  END,
  'open',
  '2026-08-24 18:00:00+00'::TIMESTAMPTZ
    - (series.ordinal * INTERVAL '1 millisecond'),
  '2026-08-24 18:00:00+00'::TIMESTAMPTZ
    - (series.ordinal * INTERVAL '1 millisecond')
FROM pg_catalog.generate_series(1, 1005) AS series(ordinal);

SELECT pg_temp.u4_assert(
  (
    SELECT pg_catalog.count(*) = 1005
      AND pg_catalog.count(*) FILTER (
        WHERE lead.source_key = 'u4_bulk_target'
      ) = 1001
      AND pg_catalog.count(*) FILTER (
        WHERE lead.source_key = 'u4_bulk_decoy'
      ) = 4
    FROM platform.leads AS lead
    WHERE lead.id::TEXT LIKE '86001000-0000-4000-8000-%'
  ),
  'the greater-than-1,000 filtered traversal fixture is incomplete'
);

SET LOCAL request.jwt.claims TO :'u4_sales_claims';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u4_traverse_filtered_leads('u4_bulk_target')
  AS u4_bulk_traversal
\gset

SELECT pg_temp.u4_assert(
  (:'u4_bulk_traversal'::JSONB ->> 'total_seen') = '1001'
  AND (:'u4_bulk_traversal'::JSONB ->> 'distinct_seen') = '1001'
  AND (:'u4_bulk_traversal'::JSONB ->> 'page_count') = '10'
  AND (:'u4_bulk_traversal'::JSONB ->> 'first_page_rows') = '101'
  AND (:'u4_bulk_traversal'::JSONB ->> 'last_page_rows') = '92'
  AND (:'u4_bulk_traversal'::JSONB ->> 'mismatched_rows') = '0'
  AND (:'u4_bulk_traversal'::JSONB ->> 'order_violations') = '0',
  'filtered keyset traversal lost, duplicated, reordered, or leaked a row'
);

RESET ROLE;

-- Curator, anonymous and service-role callers do not receive a U4 read or
-- mutation path. service_role BYPASSRLS does not imply function EXECUTE.
SET LOCAL request.jwt.claims TO :'u4_curator_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.u4_assert(
  (pg_temp.u4_attempt_page() ->> 'sqlstate') = '42501'
  AND (pg_temp.u4_attempt_page() ->> 'message') = 'sales_workflow_forbidden'
  AND (
    pg_temp.u4_attempt_detail(:'u4_lead_new') ->> 'sqlstate'
  ) = '42501'
  AND (
    pg_temp.u4_attempt_detail(:'u4_lead_new') ->> 'message'
  ) = 'sales_workflow_forbidden'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      3,
      '86000000-0000-4000-8000-000000000940',
      'qualified',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'message'
  ) = 'workflow_not_found_or_forbidden',
  'Curator received a U4 Sales read or mutation path'
);
RESET ROLE;

SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.u4_assert(
  (pg_temp.u4_attempt_page() ->> 'sqlstate') = '42501'
  AND (
    pg_temp.u4_attempt_detail(:'u4_lead_new') ->> 'sqlstate'
  ) = '42501'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      3,
      '86000000-0000-4000-8000-000000000941',
      'qualified',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'sqlstate'
  ) = '42501',
  'anonymous caller received U4 function EXECUTE'
);
RESET ROLE;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.u4_assert(
  (pg_temp.u4_attempt_page() ->> 'sqlstate') = '42501'
  AND (
    pg_temp.u4_attempt_detail(:'u4_lead_new') ->> 'sqlstate'
  ) = '42501'
  AND (
    pg_temp.u4_attempt_mutation(
      :'u4_lead_new',
      3,
      '86000000-0000-4000-8000-000000000942',
      'qualified',
      :'u4_sales_membership',
      NULL,
      NULL,
      TRUE,
      NULL
    ) ->> 'sqlstate'
  ) = '42501',
  'service_role BYPASSRLS leaked U4 function EXECUTE'
);
RESET ROLE;

SELECT pg_temp.u4_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id IN (
      '86000000-0000-4000-8000-000000000902',
      '86000000-0000-4000-8000-000000000903',
      '86000000-0000-4000-8000-000000000904',
      '86000000-0000-4000-8000-000000000905',
      '86000000-0000-4000-8000-000000000906',
      '86000000-0000-4000-8000-000000000907',
      '86000000-0000-4000-8000-000000000908',
      '86000000-0000-4000-8000-000000000909',
      '86000000-0000-4000-8000-000000000910',
      '86000000-0000-4000-8000-000000000920',
      '86000000-0000-4000-8000-000000000922',
      '86000000-0000-4000-8000-000000000925',
      '86000000-0000-4000-8000-000000000926',
      '86000000-0000-4000-8000-000000000927',
      '86000000-0000-4000-8000-000000000928',
      '86000000-0000-4000-8000-000000000929',
      '86000000-0000-4000-8000-000000000936',
      '86000000-0000-4000-8000-000000000937',
      '86000000-0000-4000-8000-000000000938',
      '86000000-0000-4000-8000-000000000939',
      '86000000-0000-4000-8000-000000000940',
      '86000000-0000-4000-8000-000000000941',
      '86000000-0000-4000-8000-000000000942'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.sales_lead_workflow_receipts AS receipt
    WHERE receipt.request_id IN (
      '86000000-0000-4000-8000-000000000902',
      '86000000-0000-4000-8000-000000000903',
      '86000000-0000-4000-8000-000000000904',
      '86000000-0000-4000-8000-000000000905',
      '86000000-0000-4000-8000-000000000906',
      '86000000-0000-4000-8000-000000000907',
      '86000000-0000-4000-8000-000000000908',
      '86000000-0000-4000-8000-000000000909',
      '86000000-0000-4000-8000-000000000910',
      '86000000-0000-4000-8000-000000000920',
      '86000000-0000-4000-8000-000000000922',
      '86000000-0000-4000-8000-000000000925',
      '86000000-0000-4000-8000-000000000926',
      '86000000-0000-4000-8000-000000000927',
      '86000000-0000-4000-8000-000000000928',
      '86000000-0000-4000-8000-000000000929',
      '86000000-0000-4000-8000-000000000936',
      '86000000-0000-4000-8000-000000000937',
      '86000000-0000-4000-8000-000000000938',
      '86000000-0000-4000-8000-000000000939',
      '86000000-0000-4000-8000-000000000940',
      '86000000-0000-4000-8000-000000000941',
      '86000000-0000-4000-8000-000000000942'
    )
  ),
  'a denied, invalid, stale, collision, or no-op request wrote evidence'
);

ROLLBACK;

SELECT 'platform U4 Sales workflow RLS and durable mutation checks passed'
  AS result;

\endif
