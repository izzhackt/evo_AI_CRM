\set ON_ERROR_STOP on

-- Disposable BW8B database-runtime proof. The private reservation/binding/
-- finalization rows below are synthetic database fixtures only; they do not
-- claim a real Storage upload, object hash, scanner verdict or provider call.
CREATE OR REPLACE FUNCTION pg_temp.bw8b_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW8B runtime assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bw8b_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

\set bw8b_org_id '51000000-0000-4000-8000-000000000001'
\set bw8b_positive_requirement_id '60000000-0000-4000-8000-000000000201'
\set bw8b_unfinalized_requirement_id '60000000-0000-4000-8000-000000000202'
\set bw8b_superseded_requirement_id '60000000-0000-4000-8000-000000000203'
\set bw8b_extraction_requirement_id '60000000-0000-4000-8000-000000000204'
\set bw8b_positive_slot_id '60000000-0000-4000-8000-000000000211'
\set bw8b_unfinalized_slot_id '60000000-0000-4000-8000-000000000212'
\set bw8b_superseded_slot_id '60000000-0000-4000-8000-000000000213'
\set bw8b_extraction_slot_id '60000000-0000-4000-8000-000000000214'
\set bw8b_positive_version_id '60000000-0000-4000-8000-000000000301'
\set bw8b_unfinalized_version_id '60000000-0000-4000-8000-000000000302'
\set bw8b_superseded_version_id '60000000-0000-4000-8000-000000000303'
\set bw8b_superseding_version_id '60000000-0000-4000-8000-000000000304'
\set bw8b_extraction_version_id '60000000-0000-4000-8000-000000000305'
\set bw8b_positive_reservation_id '60000000-0000-4000-8000-000000000401'
\set bw8b_superseded_reservation_id '60000000-0000-4000-8000-000000000402'
\set bw8b_positive_binding_id '60000000-0000-4000-8000-000000000501'
\set bw8b_superseded_binding_id '60000000-0000-4000-8000-000000000502'
\set bw8b_positive_finalization_id '60000000-0000-4000-8000-000000000601'
\set bw8b_superseded_finalization_id '60000000-0000-4000-8000-000000000602'
\set bw8b_positive_audit_id '60000000-0000-4000-8000-000000000701'
\set bw8b_superseded_audit_id '60000000-0000-4000-8000-000000000702'
\set bw8b_positive_object_name 'aa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set bw8b_superseded_object_name 'cc/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

SELECT student_case.id::TEXT AS bw8b_case_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw8b_org_id'
  AND student_case.source_key = 'bw3-synthetic-case-001'
\gset

SELECT
  membership.id::TEXT AS bw8b_admin_membership_id,
  profile.id::TEXT AS bw8b_admin_profile_id,
  profile.auth_user_id::TEXT AS bw8b_admin_auth_user_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw8b_org_id'
  AND profile.auth_user_id = '51000000-0000-4000-8000-000000000101'
\gset

SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw8b_service_claims
\gset
SELECT jsonb_build_object('role', 'authenticated')::TEXT
  AS bw8b_authenticated_claims
\gset
SELECT jsonb_build_object('role', 'anon')::TEXT
  AS bw8b_anon_claims
\gset

-- Earlier exact-boundary suites intentionally leave their immutable ledger
-- rows behind. Archive any still-active synthetic queue fixtures so this
-- runtime test proves ordering/filter behavior only over the two rows it owns.
-- This is test isolation, not a claim that old ledger rows were completed.
DO $$
DECLARE
  queued RECORD;
  archived BOOLEAN;
BEGIN
  FOR queued IN
    SELECT message.msg_id
    FROM pgmq.q_platform_work_v1 AS message
  LOOP
    SELECT pgmq.archive('platform_work_v1', queued.msg_id) INTO archived;
    IF archived IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'BW8B could not isolate pre-existing synthetic queue row %',
        queued.msg_id;
    END IF;
  END LOOP;
END
$$;

-- Four isolated slots cover finalized/current, unfinalized/current,
-- finalized/superseded and clean extraction-only states.
INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
)
VALUES
  (
    :'bw8b_positive_requirement_id', :'bw8b_org_id', 'Synthetic BW8B',
    'Synthetic Degree', 'runtime', 6001, 'bw8b.runtime.positive',
    'BW8B current finalized input', 'Synthetic database fixture', 'active',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_unfinalized_requirement_id', :'bw8b_org_id', 'Synthetic BW8B',
    'Synthetic Degree', 'runtime', 6001, 'bw8b.runtime.unfinalized',
    'BW8B current unfinalized input', 'Synthetic database fixture', 'active',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_superseded_requirement_id', :'bw8b_org_id', 'Synthetic BW8B',
    'Synthetic Degree', 'runtime', 6001, 'bw8b.runtime.superseded',
    'BW8B superseded finalized input', 'Synthetic database fixture', 'active',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_extraction_requirement_id', :'bw8b_org_id', 'Synthetic BW8B',
    'Synthetic Degree', 'runtime', 6001, 'bw8b.runtime.extraction',
    'BW8B unrelated extraction input', 'Synthetic database fixture', 'active',
    :'bw8b_admin_membership_id'
  );

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
)
VALUES
  (
    :'bw8b_positive_slot_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_positive_requirement_id', 'required',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_unfinalized_slot_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_unfinalized_requirement_id', 'required',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_superseded_slot_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_superseded_requirement_id', 'required',
    :'bw8b_admin_membership_id'
  ),
  (
    :'bw8b_extraction_slot_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_extraction_requirement_id', 'required',
    :'bw8b_admin_membership_id'
  );

INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id, integrity_status,
  malware_status, validation_updated_at
)
VALUES
  (
    :'bw8b_positive_version_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_positive_slot_id', 1, 'bw8b-current.pdf', 'application/pdf',
    2048, repeat('1', 64), 'synthetic://bw8b/current',
    :'bw8b_admin_membership_id', 'pending', 'pending', NULL
  ),
  (
    :'bw8b_unfinalized_version_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_unfinalized_slot_id', 1, 'bw8b-unfinalized.pdf',
    'application/pdf', 3072, repeat('2', 64),
    'synthetic://bw8b/unfinalized', :'bw8b_admin_membership_id',
    'pending', 'pending', NULL
  ),
  (
    :'bw8b_superseded_version_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_superseded_slot_id', 1, 'bw8b-superseded.pdf',
    'application/pdf', 4096, repeat('3', 64),
    'synthetic://bw8b/superseded', :'bw8b_admin_membership_id',
    'pending', 'pending', NULL
  ),
  (
    :'bw8b_superseding_version_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_superseded_slot_id', 2, 'bw8b-new-current.pdf',
    'application/pdf', 5120, repeat('4', 64),
    'synthetic://bw8b/new-current', :'bw8b_admin_membership_id',
    'pending', 'pending', NULL
  ),
  (
    :'bw8b_extraction_version_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_extraction_slot_id', 1, 'bw8b-clean.pdf', 'application/pdf',
    6144, repeat('5', 64), 'synthetic://bw8b/clean',
    :'bw8b_admin_membership_id', 'verified', 'clean',
    statement_timestamp()
  );

UPDATE platform.document_slots
SET status = 'submitted',
    current_version_id = CASE id
      WHEN :'bw8b_positive_slot_id'::UUID
        THEN :'bw8b_positive_version_id'::UUID
      WHEN :'bw8b_unfinalized_slot_id'::UUID
        THEN :'bw8b_unfinalized_version_id'::UUID
      WHEN :'bw8b_superseded_slot_id'::UUID
        THEN :'bw8b_superseding_version_id'::UUID
      ELSE :'bw8b_extraction_version_id'::UUID
    END,
    current_version_no = CASE
      WHEN id = :'bw8b_superseded_slot_id'::UUID THEN 2
      ELSE 1
    END
WHERE organization_id = :'bw8b_org_id'
  AND id IN (
    :'bw8b_positive_slot_id', :'bw8b_unfinalized_slot_id',
    :'bw8b_superseded_slot_id', :'bw8b_extraction_slot_id'
  );

INSERT INTO platform_private.document_upload_reservations (
  id, request_id, organization_id, student_case_id, document_slot_id,
  document_version_id, uploader_profile_id, uploader_membership_id,
  uploader_auth_user_id, bucket_id, object_name, declared_mime_type,
  byte_size, sha256_hex, expires_at, created_at
)
VALUES
  (
    :'bw8b_positive_reservation_id',
    '60000000-0000-4000-8000-000000000801', :'bw8b_org_id',
    :'bw8b_case_id', :'bw8b_positive_slot_id',
    :'bw8b_positive_version_id', :'bw8b_admin_profile_id',
    :'bw8b_admin_membership_id', :'bw8b_admin_auth_user_id',
    'platform-documents', :'bw8b_positive_object_name', 'application/pdf',
    2048, repeat('1', 64), statement_timestamp() + INTERVAL '5 minutes',
    statement_timestamp()
  ),
  (
    :'bw8b_superseded_reservation_id',
    '60000000-0000-4000-8000-000000000802', :'bw8b_org_id',
    :'bw8b_case_id', :'bw8b_superseded_slot_id',
    :'bw8b_superseded_version_id', :'bw8b_admin_profile_id',
    :'bw8b_admin_membership_id', :'bw8b_admin_auth_user_id',
    'platform-documents', :'bw8b_superseded_object_name', 'application/pdf',
    4096, repeat('3', 64), statement_timestamp() + INTERVAL '5 minutes',
    statement_timestamp()
  );

INSERT INTO platform_private.document_storage_bindings (
  id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_reservation_id, bucket_id, object_name
)
VALUES
  (
    :'bw8b_positive_binding_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_positive_slot_id', :'bw8b_positive_version_id',
    :'bw8b_positive_reservation_id', 'platform-documents',
    :'bw8b_positive_object_name'
  ),
  (
    :'bw8b_superseded_binding_id', :'bw8b_org_id', :'bw8b_case_id',
    :'bw8b_superseded_slot_id', :'bw8b_superseded_version_id',
    :'bw8b_superseded_reservation_id', 'platform-documents',
    :'bw8b_superseded_object_name'
  );

INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state,
  reason, request_id
)
VALUES
  (
    :'bw8b_positive_audit_id', :'bw8b_org_id', 'service', NULL,
    'service:bw8b-synthetic-fixture', 'document.upload.finalize',
    'document_version', :'bw8b_positive_version_id', NULL,
    jsonb_build_object('synthetic_fixture', TRUE),
    'Synthetic BW8B database fixture; not Storage proof',
    '60000000-0000-4000-8000-000000000811'
  ),
  (
    :'bw8b_superseded_audit_id', :'bw8b_org_id', 'service', NULL,
    'service:bw8b-synthetic-fixture', 'document.upload.finalize',
    'document_version', :'bw8b_superseded_version_id', NULL,
    jsonb_build_object('synthetic_fixture', TRUE),
    'Synthetic BW8B database fixture; not Storage proof',
    '60000000-0000-4000-8000-000000000812'
  );

INSERT INTO platform_private.document_upload_finalizations (
  id, request_id, organization_id, upload_reservation_id, student_case_id,
  document_version_id, document_slot_id, finalization_audit_event_id,
  bucket_id, object_name, published_version_no, object_created_at,
  finalized_at
)
VALUES
  (
    :'bw8b_positive_finalization_id',
    '60000000-0000-4000-8000-000000000821', :'bw8b_org_id',
    :'bw8b_positive_reservation_id', :'bw8b_case_id',
    :'bw8b_positive_version_id', :'bw8b_positive_slot_id',
    :'bw8b_positive_audit_id', 'platform-documents',
    :'bw8b_positive_object_name', 1, statement_timestamp(),
    statement_timestamp()
  ),
  (
    :'bw8b_superseded_finalization_id',
    '60000000-0000-4000-8000-000000000822', :'bw8b_org_id',
    :'bw8b_superseded_reservation_id', :'bw8b_case_id',
    :'bw8b_superseded_version_id', :'bw8b_superseded_slot_id',
    :'bw8b_superseded_audit_id', 'platform-documents',
    :'bw8b_superseded_object_name', 1, statement_timestamp(),
    statement_timestamp()
  );

-- Browser roles cannot execute the resolver, and even service_role cannot
-- bypass it by selecting the private binding table directly.
SET request.jwt.claims TO :'bw8b_authenticated_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_positive_version_id',
  '60000000-0000-4000-8000-000000000831'
);
\set bw8b_authenticated_resolver_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8b_anon_claims';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT platform.claim_document_validation_work(
  30, 'bw8b-anon-probe', '60000000-0000-4000-8000-000000000832'
);
\set bw8b_anon_claim_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8b_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.document_storage_bindings;
\set bw8b_service_private_select_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- A pending document cannot create an extraction run, and an unfinalized
-- current version cannot be enqueued or resolved for validation.
SET request.jwt.claims TO :'bw8b_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.create_document_extraction_run(
  :'bw8b_org_id', :'bw8b_positive_version_id', 'bw8b-synthetic',
  'bw8b-model-v1', 'bw8b-policy-v1', 1,
  '60000000-0000-4000-8000-000000000833'
);
\set bw8b_pending_extraction_state :SQLSTATE
SELECT platform.enqueue_document_validation_work(
  :'bw8b_org_id', :'bw8b_unfinalized_version_id', repeat('6', 64), 2,
  '60000000-0000-4000-8000-000000000834'
);
\set bw8b_unfinalized_enqueue_state :SQLSTATE
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_unfinalized_version_id',
  '60000000-0000-4000-8000-000000000835'
);
\set bw8b_unfinalized_resolver_state :SQLSTATE
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_superseded_version_id',
  '60000000-0000-4000-8000-000000000836'
);
\set bw8b_superseded_resolver_state :SQLSTATE
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', '60000000-0000-4000-8000-000000009999',
  '60000000-0000-4000-8000-000000000837'
);
\set bw8b_missing_resolver_state :SQLSTATE
\set ON_ERROR_STOP on

-- Enqueue unrelated extraction first, then validation. The filtered worker
-- must skip the earlier unrelated queue row without changing its read count.
SELECT platform.create_document_extraction_run(
  :'bw8b_org_id', :'bw8b_extraction_version_id', 'bw8b-synthetic',
  'bw8b-model-v1', 'bw8b-policy-v1', 1,
  '60000000-0000-4000-8000-000000000841'
)::TEXT AS bw8b_extraction_run_result
\gset
SELECT (:'bw8b_extraction_run_result'::JSONB ->> 'extraction_run_id')
  AS bw8b_extraction_run_id
\gset
SELECT platform.enqueue_document_extraction_work(
  :'bw8b_org_id', :'bw8b_extraction_run_id', repeat('7', 64), 2,
  '60000000-0000-4000-8000-000000000842'
)::TEXT AS bw8b_extraction_enqueue_result
\gset
SELECT platform.enqueue_document_validation_work(
  :'bw8b_org_id', :'bw8b_positive_version_id', repeat('8', 64), 2,
  '60000000-0000-4000-8000-000000000843'
)::TEXT AS bw8b_validation_enqueue_result
\gset

SELECT platform.claim_document_validation_work(
  30, 'bw8b-scanner', '60000000-0000-4000-8000-000000000844'
)::TEXT AS bw8b_validation_claim_result
\gset
SELECT platform.claim_document_validation_work(
  30, 'bw8b-scanner', '60000000-0000-4000-8000-000000000844'
)::TEXT AS bw8b_validation_claim_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.claim_durable_work(
  30, 'bw8b-scanner', '60000000-0000-4000-8000-000000000844'
);
\set bw8b_cross_claim_replay_state :SQLSTATE
\set ON_ERROR_STOP on

RESET ROLE;
SELECT
  item.state::TEXT AS bw8b_unrelated_state_after_filtered_claim,
  item.attempt_count::TEXT AS bw8b_unrelated_attempts_after_filtered_claim,
  queue.read_ct::TEXT AS bw8b_unrelated_read_count_after_filtered_claim
FROM platform_private.durable_work_items AS item
JOIN pgmq.q_platform_work_v1 AS queue
  ON queue.msg_id = item.queue_message_id
WHERE item.id = (
  :'bw8b_extraction_enqueue_result'::JSONB ->> 'work_item_id'
)::UUID
\gset

SET request.jwt.claims TO :'bw8b_service_claims';
SET ROLE service_role;

SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_positive_version_id',
  '60000000-0000-4000-8000-000000000845'
)::TEXT AS bw8b_resolver_result
\gset
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_positive_version_id',
  '60000000-0000-4000-8000-000000000845'
)::TEXT AS bw8b_resolver_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.resolve_document_validation_input(
  :'bw8b_org_id', :'bw8b_unfinalized_version_id',
  '60000000-0000-4000-8000-000000000845'
);
\set bw8b_resolver_rebind_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.claim_durable_work(
  30, 'bw8b-generic-worker',
  '60000000-0000-4000-8000-000000000846'
)::TEXT AS bw8b_extraction_claim_result
\gset
SELECT platform.claim_durable_work(
  30, 'bw8b-generic-worker',
  '60000000-0000-4000-8000-000000000846'
)::TEXT AS bw8b_extraction_claim_replay
\gset
SELECT platform.finish_durable_work(
  (:'bw8b_extraction_claim_result'::JSONB ->> 'work_item_id')::UUID,
  (:'bw8b_extraction_claim_result'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL, 'synthetic://bw8b/extraction-finished', NULL,
  '60000000-0000-4000-8000-000000000847'
);

-- Exercise the unchanged retry ledger and terminal dead-letter branch through
-- the new filtered claim surface.
SELECT platform.finish_durable_work(
  (:'bw8b_validation_claim_result'::JSONB ->> 'work_item_id')::UUID,
  (:'bw8b_validation_claim_result'::JSONB ->> 'attempt_id')::UUID,
  'retryable_error', 'scanner_unavailable',
  'synthetic://bw8b/scanner-unavailable', 1,
  '60000000-0000-4000-8000-000000000848'
)::TEXT AS bw8b_retry_result
\gset
SELECT pg_sleep(1.1);
SELECT platform.claim_document_validation_work(
  30, 'bw8b-scanner-retry',
  '60000000-0000-4000-8000-000000000849'
)::TEXT AS bw8b_validation_second_claim
\gset
SELECT platform.finish_durable_work(
  (:'bw8b_validation_second_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'bw8b_validation_second_claim'::JSONB ->> 'attempt_id')::UUID,
  'retryable_error', 'scanner_unavailable',
  'synthetic://bw8b/scanner-unavailable-again', 1,
  '60000000-0000-4000-8000-000000000850'
)::TEXT AS bw8b_dead_letter_result
\gset
RESET ROLE;

-- Runtime assertions are evaluated as postgres so service_role receives no
-- private-table capability merely for being the worker principal.
SELECT pg_temp.bw8b_assert(
  :'bw8b_authenticated_resolver_state' = '42501'
    AND :'bw8b_anon_claim_state' = '42501'
    AND :'bw8b_service_private_select_state' = '42501',
  'browser/service direct authorization boundary drifted'
);
SELECT pg_temp.bw8b_assert(
  :'bw8b_pending_extraction_state' = '55000'
    AND :'bw8b_unfinalized_enqueue_state' = '55000'
    AND :'bw8b_unfinalized_resolver_state' = '42501'
    AND :'bw8b_superseded_resolver_state' = '42501'
    AND :'bw8b_missing_resolver_state' = '42501',
  'pending/unfinalized/superseded/missing boundaries did not fail closed'
);
SELECT pg_temp.bw8b_assert(
  :'bw8b_validation_claim_result'::JSONB ->> 'kind'
      = 'document_validation'
    AND :'bw8b_validation_claim_result'::JSONB ->> 'document_version_id'
      = :'bw8b_positive_version_id'
    AND NOT (:'bw8b_validation_claim_result'::JSONB
      ? 'source_document_version_id')
    AND :'bw8b_validation_claim_result'::JSONB
      = :'bw8b_validation_claim_replay'::JSONB
    AND :'bw8b_cross_claim_replay_state' = '22023',
  'filtered claim pointer alias or replay contract drifted'
);
SELECT pg_temp.bw8b_assert(
  (
    SELECT item.state = 'succeeded'
      AND item.attempt_count = 1
    FROM platform_private.durable_work_items AS item
    WHERE item.id = (
      :'bw8b_extraction_enqueue_result'::JSONB ->> 'work_item_id'
    )::UUID
  )
  AND :'bw8b_extraction_claim_result'::JSONB
    = :'bw8b_extraction_claim_replay'::JSONB
  AND :'bw8b_extraction_claim_result'::JSONB ->> 'kind'
    = 'document_extraction'
  AND :'bw8b_extraction_claim_result'::JSONB
      ->> 'document_extraction_run_id' = :'bw8b_extraction_run_id'
  AND :'bw8b_unrelated_state_after_filtered_claim' = 'queued'
  AND :'bw8b_unrelated_attempts_after_filtered_claim' = '0'
  AND :'bw8b_unrelated_read_count_after_filtered_claim' = '0',
  'generic claim behavior/replay or extraction source alias drifted'
);
SELECT pg_temp.bw8b_assert(
  :'bw8b_resolver_result'::JSONB = :'bw8b_resolver_replay'::JSONB
    AND :'bw8b_resolver_rebind_state' = '22023'
    AND :'bw8b_resolver_result'::JSONB ->> 'bucket_id'
      = 'platform-documents'
    AND :'bw8b_resolver_result'::JSONB ->> 'object_name'
      = :'bw8b_positive_object_name'
    AND :'bw8b_resolver_result'::JSONB ->> 'expected_original_filename'
      = 'bw8b-current.pdf'
    AND :'bw8b_resolver_result'::JSONB ->> 'expected_mime_type'
      = 'application/pdf'
    AND (:'bw8b_resolver_result'::JSONB ->> 'expected_byte_size')::BIGINT
      = 2048
    AND :'bw8b_resolver_result'::JSONB ->> 'expected_sha256_hex'
      = repeat('1', 64)
    AND (
      SELECT array_agg(key ORDER BY key)
      FROM jsonb_object_keys(:'bw8b_resolver_result'::JSONB) AS key
    ) = ARRAY[
      'bucket_id', 'document_slot_id', 'document_version_id',
      'document_version_no', 'expected_byte_size', 'expected_mime_type',
      'expected_original_filename', 'expected_sha256_hex', 'object_name',
      'organization_id', 'student_case_id'
    ]::TEXT[],
  'resolver returned wrong metadata, replay or extra fields'
);
SELECT pg_temp.bw8b_assert(
  :'bw8b_retry_result'::JSONB ->> 'state' = 'retry_wait'
    AND (:'bw8b_retry_result'::JSONB ->> 'same_queue_message_retained')::BOOLEAN
    AND (:'bw8b_validation_second_claim'::JSONB ->> 'attempt_number')::INTEGER
      = 2
    AND :'bw8b_dead_letter_result'::JSONB ->> 'state' = 'dead_lettered'
    AND NOT (
      :'bw8b_dead_letter_result'::JSONB
        ->> 'automatic_retry_allowed'
    )::BOOLEAN
    AND (
      SELECT count(*) = 1
      FROM platform_private.durable_work_dead_letters AS dead_letter
      WHERE dead_letter.work_item_id = (
        :'bw8b_validation_enqueue_result'::JSONB ->> 'work_item_id'
      )::UUID
    ),
  'filtered claim retry/dead-letter compatibility drifted'
);
SELECT pg_temp.bw8b_assert(
  (
    SELECT count(*) = 0
    FROM platform.document_extraction_runs AS run
    WHERE run.organization_id = :'bw8b_org_id'
      AND run.document_version_id = :'bw8b_positive_version_id'
  ) AND (
    SELECT count(*) = 0
    FROM platform_private.durable_work_items AS item
    JOIN platform.document_extraction_runs AS run
      ON run.organization_id = item.organization_id
      AND run.id = item.source_extraction_run_id
    WHERE run.document_version_id = :'bw8b_positive_version_id'
  ),
  'extraction was created or enqueued before verified+clean'
);

SELECT 'platform document intake runtime RLS passed' AS result;
