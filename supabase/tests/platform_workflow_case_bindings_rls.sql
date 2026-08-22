\set ON_ERROR_STOP on

-- Disposable BW2 authorization/replay proof. Identities are reused from the
-- migration-051 boundary suite; values are synthetic and contain no customer
-- PII. No external provider is contacted or claimed.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW2 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

\set bw2_org_a '51000000-0000-4000-8000-000000000001'
\set bw2_org_b '51100000-0000-4000-8000-000000000001'
\set bw2_admin_user '51000000-0000-4000-8000-000000000101'
\set bw2_sales_user '51000000-0000-4000-8000-000000000102'
\set bw2_curator_user '51000000-0000-4000-8000-000000000103'
\set bw2_finance_user '51000000-0000-4000-8000-000000000104'
\set bw2_student_user '51000000-0000-4000-8000-000000000105'
\set bw2_admin_b_user '51100000-0000-4000-8000-000000000101'
\set bw2_admin_membership '51000000-0000-4000-8000-000000000301'
\set bw2_sales_membership '51000000-0000-4000-8000-000000000302'
\set bw2_curator_membership '51000000-0000-4000-8000-000000000303'
\set bw2_finance_membership '51000000-0000-4000-8000-000000000304'
\set bw2_student_membership '51000000-0000-4000-8000-000000000305'

SELECT jsonb_build_object(
  'sub', :'bw2_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1
)::TEXT AS bw2_admin_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw2_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1
)::TEXT AS bw2_sales_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw2_curator_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1
)::TEXT AS bw2_curator_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw2_finance_user', 'role', 'authenticated',
  'platform_role', 'finance', 'platform_access_version', 1
)::TEXT AS bw2_finance_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw2_student_user', 'role', 'authenticated',
  'platform_role', 'student', 'platform_access_version', 1
)::TEXT AS bw2_student_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw2_admin_b_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1
)::TEXT AS bw2_admin_b_claims \gset
SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw2_service_claims \gset

SELECT id::TEXT AS bw2_op_contract_id
FROM platform.workflow_contracts
WHERE organization_id = :'bw2_org_a'
  AND workflow_kind = 'op' \gset
SELECT id::TEXT AS bw2_ozo_contract_id
FROM platform.workflow_contracts
WHERE organization_id = :'bw2_org_a'
  AND workflow_kind = 'ozo' \gset

-- Re-establish current approved OP/OZO versions after BW1 retired its
-- historical proof versions. The source is a reviewed public plan reference,
-- never a customer or provider fixture.
SET request.jwt.claims TO :'bw2_admin_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw2_org_a',
  'src_22222222222222222222222222222222',
  'google_document',
  'https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit',
  'revision20260801bw2',
  'register reviewed BW2 plan source',
  '52000000-0000-4000-8000-000000000601'
)::TEXT AS bw2_source_id \gset
SELECT platform.review_workflow_source(
  :'bw2_org_a', :'bw2_source_id', 'reviewed',
  'approve BW2 plan provenance',
  '52000000-0000-4000-8000-000000000602'
);
SELECT platform.create_workflow_contract_version(
  :'bw2_org_a', :'bw2_op_contract_id', 4,
  ARRAY[
    'new', 'contacting', 'qualified', 'meeting_scheduled',
    'meeting_completed', 'potential', 'contract_signed'
  ],
  ARRAY['no_answer', 'meeting_not_attended'],
  ARRAY['won', 'lost'],
  ARRAY[]::TEXT[],
  'create current BW2 OP version',
  '52000000-0000-4000-8000-000000000603'
)::TEXT AS bw2_op_version_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw2_org_a', :'bw2_op_version_id', :'bw2_source_id',
  'link current BW2 OP provenance',
  '52000000-0000-4000-8000-000000000604'
);
SELECT platform.approve_workflow_contract_version(
  :'bw2_org_a', :'bw2_op_version_id',
  'approve current BW2 OP version',
  '52000000-0000-4000-8000-000000000605'
);
SELECT platform.create_workflow_contract_version(
  :'bw2_org_a', :'bw2_ozo_contract_id', 2,
  ARRAY[
    'intake', 'profile_and_route', 'documents', 'applications', 'decisions',
    'visa_and_predeparture', 'arrival_and_adaptation', 'completed', 'closed'
  ],
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  ARRAY['completed', 'closed'],
  'create current BW2 OZO version',
  '52000000-0000-4000-8000-000000000606'
)::TEXT AS bw2_ozo_version_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw2_org_a', :'bw2_ozo_version_id', :'bw2_source_id',
  'link current BW2 OZO provenance',
  '52000000-0000-4000-8000-000000000607'
);
SELECT platform.approve_workflow_contract_version(
  :'bw2_org_a', :'bw2_ozo_version_id',
  'approve current BW2 OZO version',
  '52000000-0000-4000-8000-000000000608'
);
RESET ROLE;

SELECT count(*)::TEXT AS bw2_contacts_before FROM public.contacts \gset

PREPARE bw2_ingest(
  UUID,
  TEXT,
  TEXT,
  UUID,
  UUID,
  UUID
) AS
SELECT platform.create_pending_student_case_with_handoff(
  $6,
  :'bw2_student_membership',
  :'bw2_sales_membership',
  $2,
  'synthetic-contract-confirmation',
  '2026-08-01T08:00:00Z'::TIMESTAMPTZ,
  'Synthetic BW2 Student',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  'synthetic_intake',
  'synthetic_language',
  'synthetic_funding',
  'intake',
  'Review synthetic route',
  $4,
  $5,
  '{"service_package":"synthetic_standard","fee_currency":"USD"}'::JSONB,
  '["Confirm synthetic route preference"]'::JSONB,
  '["Provide synthetic checklist review"]'::JSONB,
  $3,
  '2026-08-15T08:00:00Z'::TIMESTAMPTZ,
  'curator',
  $1
)::TEXT AS bw2_ingest_result;

SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000620',
  'bw2-synthetic-case-001',
  'Complete synthetic admissions intake',
  :'bw2_op_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
) \gset
RESET ROLE;
SELECT :'bw2_ingest_result'::TEXT AS bw2_first_result \gset
SELECT
  (:'bw2_first_result'::JSONB ->> 'student_case_id') AS bw2_case_id,
  (:'bw2_first_result'::JSONB ->> 'student_case_op_handoff_id')
    AS bw2_handoff_id,
  (:'bw2_first_result'::JSONB ->> 'child_request_id')
    AS bw2_child_request_id
\gset

-- Exact parent request/payload replay returns the original parent audit state.
SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000620',
  'bw2-synthetic-case-001',
  'Complete synthetic admissions intake',
  :'bw2_op_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
) \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_ingest_result'::JSONB = :'bw2_first_result'::JSONB,
  'exact ingest replay did not return the original result'
);

-- Reusing the parent request with a changed normalized payload fails closed.
SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000620',
  'bw2-synthetic-case-001',
  'Changed synthetic next step',
  :'bw2_op_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
);
\set bw2_changed_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw2_changed_replay_state' = '22023',
  'changed ingest replay was not denied'
);
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.student_cases
    WHERE organization_id = :'bw2_org_a'
      AND source_key = 'bw2-synthetic-case-001'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.student_case_op_handoffs
    WHERE organization_id = :'bw2_org_a'
      AND student_case_id = :'bw2_case_id'
  )
  AND (
    SELECT applied_ozo_workflow_contract_version_id = :'bw2_ozo_version_id'
    FROM platform.student_cases
    WHERE id = :'bw2_case_id'
  )
  AND substring(split_part(:'bw2_child_request_id', '-', 3), 1, 1) = '5',
  'atomic case, handoff, OZO binding or UUID-v5 child contract failed'
);
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.audit_events
    WHERE request_id = '52000000-0000-4000-8000-000000000620'
      AND action = 'case.handoff.create'
      AND resource_id = :'bw2_case_id'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.audit_events
    WHERE request_id = :'bw2_child_request_id'
      AND action = 'case.create'
      AND resource_id = :'bw2_case_id'
  ),
  'parent and child audit evidence is incomplete'
);
SELECT count(*)::TEXT AS bw2_contacts_after FROM public.contacts \gset
SELECT pg_temp.assert_true(
  :'bw2_contacts_before' = :'bw2_contacts_after',
  'BW2 ingest mutated the legacy contact authority'
);

-- Missing, wrong-organization and wrong-kind workflow bindings all fail before
-- a Student Case can be created.
SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000621',
  'bw2-synthetic-case-missing',
  'Synthetic missing workflow denial',
  '52000000-0000-4000-8000-000000009999',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
);
\set bw2_missing_workflow_state :SQLSTATE
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000622',
  'bw2-synthetic-case-wrong-org',
  'Synthetic cross-organization denial',
  :'bw2_op_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_b'
);
\set bw2_wrong_org_state :SQLSTATE
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000623',
  'bw2-synthetic-case-wrong-kind',
  'Synthetic wrong-kind denial',
  :'bw2_ozo_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
);
\set bw2_wrong_kind_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_missing_workflow_state' = '22023'
    AND :'bw2_wrong_org_state' = '22023'
    AND :'bw2_wrong_kind_state' = '22023',
  'missing, cross-organization or wrong-kind workflow denial failed'
);

-- The authenticated caller never receives a mutation grant, while the service
-- principal never receives direct read/write access to the handoff table.
SET request.jwt.claims TO :'bw2_admin_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
UPDATE platform.student_case_op_handoffs
SET next_step = 'forbidden authenticated rewrite'
WHERE id = :'bw2_handoff_id';
\set bw2_authenticated_update_state :SQLSTATE
TRUNCATE platform.student_case_op_handoffs;
\set bw2_authenticated_truncate_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.student_case_op_handoffs;
\set bw2_service_read_state :SQLSTATE
DELETE FROM platform.student_case_op_handoffs WHERE id = :'bw2_handoff_id';
\set bw2_service_delete_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_authenticated_update_state' = '42501'
    AND :'bw2_authenticated_truncate_state' = '42501'
    AND :'bw2_service_read_state' = '42501'
    AND :'bw2_service_delete_state' = '42501',
  'BW2 direct table ACL contract failed'
);

-- Seed bounded admissions work so the fixed queue counts prove persisted SQL
-- data rather than frontend placeholders.
INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, status, student_visible,
  created_by_membership_id
) VALUES (
  '52000000-0000-4000-8000-000000000701',
  :'bw2_org_a', :'bw2_case_id', 'synthetic_follow_up',
  'Synthetic overdue follow-up', :'bw2_sales_membership', 'normal',
  '2026-07-31T08:00:00Z', 'open', FALSE, :'bw2_admin_membership'
);
INSERT INTO platform.payment_obligations (
  id, organization_id, student_case_id, label, category,
  amount_minor, currency, due_at, next_action, created_by_membership_id
) VALUES (
  '52000000-0000-4000-8000-000000000702',
  :'bw2_org_a', :'bw2_case_id', 'Synthetic service installment',
  'evo_service_fee', 10000, 'USD', '2026-07-31T08:00:00Z',
  'Review synthetic payment record', :'bw2_admin_membership'
);

-- Admin sees the pending case and immutable handoff through fixed projections.
SET request.jwt.claims TO :'bw2_admin_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_admin_pending_queue
FROM platform.staff_student_case_queue()
WHERE student_case_id = :'bw2_case_id' \gset
SELECT count(*)::TEXT AS bw2_admin_pending_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id')
WHERE student_case_op_handoff_id = :'bw2_handoff_id'
  AND overdue_task_count = 1
  AND overdue_obligation_count = 1
  AND rejected_document_count = 0 \gset
SELECT count(*)::TEXT AS bw2_admin_op_contract
FROM platform.staff_op_workflow_contract()
WHERE workflow_contract_version_id = :'bw2_op_version_id' \gset
SELECT platform.assign_student_case_curator(
  :'bw2_org_a', :'bw2_case_id', :'bw2_curator_membership',
  'assign synthetic BW2 Curator',
  '52000000-0000-4000-8000-000000000624'
);
RESET ROLE;
-- Assignment intentionally revokes the old case scope and bumps the affected
-- Sales, Curator and Student access versions. Refresh the synthetic JWT claims
-- exactly as a real session refresh must do before any post-handoff read.
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version
)::TEXT AS bw2_sales_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw2_sales_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw2_curator_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw2_curator_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version
)::TEXT AS bw2_student_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw2_student_user' \gset
SELECT pg_temp.assert_true(
  :'bw2_admin_pending_queue' = '1'
    AND :'bw2_admin_pending_snapshot' = '1'
    AND :'bw2_admin_op_contract' = '1',
  'Admin fixed projection failed'
);

-- Assigned Curator owns full post-handoff access and persists an application
-- through the existing migration-042 RPCs.
SET request.jwt.claims TO :'bw2_curator_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_curator_queue
FROM platform.staff_student_case_queue()
WHERE student_case_id = :'bw2_case_id' \gset
SELECT count(*)::TEXT AS bw2_curator_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id')
WHERE approved_commercial_fields ->> 'service_package' = 'synthetic_standard'
  AND handoff_responsible_role = 'curator' \gset
SELECT count(*)::TEXT AS bw2_curator_direct_handoff
FROM platform.student_case_op_handoffs
WHERE id = :'bw2_handoff_id' \gset
SELECT platform.create_university_application(
  :'bw2_org_a', :'bw2_case_id',
  'Synthetic University', 'Synthetic Program', 'preparation',
  NULL, 'create synthetic application',
  '52000000-0000-4000-8000-000000000625'
)::TEXT AS bw2_application_result \gset
RESET ROLE;
SELECT (:'bw2_application_result'::JSONB ->> 'university_application_id')
  AS bw2_application_id \gset
SET request.jwt.claims TO :'bw2_curator_claims';
SET ROLE authenticated;
SELECT platform.change_university_application(
  :'bw2_org_a', :'bw2_application_id', 'submitted',
  'synthetic-evidence:submission-001',
  'persist synthetic submission status',
  '52000000-0000-4000-8000-000000000626'
);
SELECT count(*)::TEXT AS bw2_curator_application_queue
FROM platform.staff_application_queue()
WHERE university_application_id = :'bw2_application_id'
  AND status = 'submitted'
  AND latest_evidence_reference = 'synthetic-evidence:submission-001'
  AND task_count = 1
  AND payment_obligation_count = 1 \gset
SELECT count(*)::TEXT AS bw2_curator_application_snapshot
FROM platform.staff_application_snapshot(:'bw2_application_id')
WHERE status = 'submitted'
  AND open_task_count = 1
  AND outstanding_payment_obligation_count = 1 \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_curator_queue' = '1'
    AND :'bw2_curator_snapshot' = '1'
    AND :'bw2_curator_direct_handoff' = '1'
    AND :'bw2_curator_application_queue' = '1'
    AND :'bw2_curator_application_snapshot' = '1',
  'Curator case/application repository projection failed'
);

-- Admin also receives the full post-handoff application projection.
SET request.jwt.claims TO :'bw2_admin_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_admin_application_snapshot
FROM platform.staff_application_snapshot(:'bw2_application_id')
WHERE status = 'submitted' \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_admin_application_snapshot' = '1',
  'Admin application snapshot failed'
);

-- Former Sales receives only the existing safe migration-042 summary. The
-- fixed case/application snapshots and direct handoff payload stay empty.
SET request.jwt.claims TO :'bw2_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_sales_case_queue
FROM platform.staff_student_case_queue()
WHERE student_case_id = :'bw2_case_id' \gset
SELECT count(*)::TEXT AS bw2_sales_case_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id') \gset
SELECT count(*)::TEXT AS bw2_sales_application_snapshot
FROM platform.staff_application_snapshot(:'bw2_application_id') \gset
SELECT count(*)::TEXT AS bw2_sales_direct_handoff
FROM platform.student_case_op_handoffs
WHERE id = :'bw2_handoff_id' \gset
SELECT count(*)::TEXT AS bw2_sales_safe_summary
FROM platform.sales_handoff_summaries()
WHERE case_id = :'bw2_case_id' \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_sales_case_queue' = '0'
    AND :'bw2_sales_case_snapshot' = '0'
    AND :'bw2_sales_application_snapshot' = '0'
    AND :'bw2_sales_direct_handoff' = '0'
    AND :'bw2_sales_safe_summary' = '1',
  'post-handoff Sales secret boundary or safe summary failed'
);

-- Student, Finance and another organization have no full-case/handoff secret.
SET request.jwt.claims TO :'bw2_student_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_student_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id') \gset
SELECT count(*)::TEXT AS bw2_student_handoff
FROM platform.student_case_op_handoffs
WHERE id = :'bw2_handoff_id' \gset
RESET ROLE;
SET request.jwt.claims TO :'bw2_finance_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_finance_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id') \gset
SELECT count(*)::TEXT AS bw2_finance_handoff
FROM platform.student_case_op_handoffs
WHERE id = :'bw2_handoff_id' \gset
RESET ROLE;
SET request.jwt.claims TO :'bw2_admin_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw2_cross_org_case_snapshot
FROM platform.staff_student_case_snapshot(:'bw2_case_id') \gset
SELECT count(*)::TEXT AS bw2_cross_org_application_snapshot
FROM platform.staff_application_snapshot(:'bw2_application_id') \gset
SELECT count(*)::TEXT AS bw2_cross_org_handoff
FROM platform.student_case_op_handoffs
WHERE id = :'bw2_handoff_id' \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_student_snapshot' = '0'
    AND :'bw2_student_handoff' = '0'
    AND :'bw2_finance_snapshot' = '0'
    AND :'bw2_finance_handoff' = '0'
    AND :'bw2_cross_org_case_snapshot' = '0'
    AND :'bw2_cross_org_application_snapshot' = '0'
    AND :'bw2_cross_org_handoff' = '0',
  'student, Finance or cross-organization handoff isolation failed'
);

-- Append-only rows and the applied OZO version resist owner-level rewrite,
-- delete and truncate; retired definitions cannot create new cases.
\set ON_ERROR_STOP off
UPDATE platform.student_case_op_handoffs
SET next_step = 'forbidden owner rewrite'
WHERE id = :'bw2_handoff_id';
\set bw2_owner_update_state :SQLSTATE
DELETE FROM platform.student_case_op_handoffs WHERE id = :'bw2_handoff_id';
\set bw2_owner_delete_state :SQLSTATE
TRUNCATE platform.student_case_op_handoffs;
\set bw2_owner_truncate_state :SQLSTATE
UPDATE platform.student_cases
SET applied_ozo_workflow_contract_version_id = NULL
WHERE id = :'bw2_case_id';
\set bw2_ozo_clear_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw2_owner_update_state' = '55000'
    AND :'bw2_owner_delete_state' = '55000'
    AND :'bw2_owner_truncate_state' = '55000'
    AND :'bw2_ozo_clear_state' = '55000',
  'handoff or OZO binding immutability failed'
);

SET request.jwt.claims TO :'bw2_admin_claims';
SET ROLE authenticated;
SELECT platform.retire_workflow_contract_version(
  :'bw2_org_a', :'bw2_op_version_id',
  'retire current BW2 OP proof version',
  '52000000-0000-4000-8000-000000000627'
);
RESET ROLE;
SET request.jwt.claims TO :'bw2_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
EXECUTE bw2_ingest(
  '52000000-0000-4000-8000-000000000628',
  'bw2-synthetic-case-retired',
  'Synthetic retired workflow denial',
  :'bw2_op_version_id',
  :'bw2_ozo_version_id',
  :'bw2_org_a'
);
\set bw2_retired_workflow_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw2_retired_workflow_state' = '22023'
    AND NOT EXISTS (
      SELECT 1 FROM platform.student_cases
      WHERE source_key = 'bw2-synthetic-case-retired'
    ),
  'retired workflow version created a Student Case'
);

DEALLOCATE bw2_ingest;

SELECT 'platform workflow case bindings RLS passed' AS result;
