\set ON_ERROR_STOP on

-- P7B1 runs only in the disposable authorization database. It replaces the
-- private clock inside this transaction, inserts synthetic operational rows,
-- and rolls every change back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P7B1 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_plan_uses(
  p_query TEXT,
  p_index_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  plan JSON;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON, COSTS OFF) ' || p_query INTO plan;
  IF pg_catalog.strpos(plan::TEXT, p_index_name) = 0 THEN
    RAISE EXCEPTION
      'P7B1 plan assertion failed: expected index % in %',
      p_index_name,
      plan;
  END IF;
END
$$;

DO $$
DECLARE
  routine REGPROCEDURE :=
    'platform.platform_operational_signals_v1(uuid)'::REGPROCEDURE;
  clock_routine REGPROCEDURE :=
    'platform_private.p7b_observability_clock()'::REGPROCEDURE;
  checked_role NAME;
  private_table REGCLASS;
  routine_record RECORD;
BEGIN
  SELECT
    owner_role.rolname AS owner_name,
    procedure.prosecdef,
    procedure.proconfig
  INTO routine_record
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = procedure.proowner
  WHERE procedure.oid = routine;

  IF routine_record.owner_name <> 'postgres'
    OR NOT routine_record.prosecdef
    OR NOT routine_record.proconfig @> ARRAY[
      'search_path=""',
      'statement_timeout=3000ms',
      'lock_timeout=1000ms'
    ]::TEXT[]
    OR pg_catalog.cardinality(routine_record.proconfig) <> 3
  THEN
    RAISE EXCEPTION
      'P7B1 RPC must be postgres-owned SECURITY DEFINER with only the exact empty search_path and timeout settings; found %',
      routine_record;
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    routine,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P7B1 service_role EXECUTE grant is missing';
  END IF;

  FOREACH checked_role IN ARRAY ARRAY[
    'anon'::NAME,
    'authenticated'::NAME,
    'supabase_auth_admin'::NAME
  ]
  LOOP
    IF pg_catalog.has_function_privilege(checked_role, routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'P7B1 browser/auth role % can execute the RPC', checked_role;
    END IF;

    IF pg_catalog.has_function_privilege(
      checked_role,
      clock_routine,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'P7B1 role % can execute the private clock', checked_role;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
    'service_role',
    clock_routine,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P7B1 service_role can execute the private clock directly';
  END IF;

  FOREACH private_table IN ARRAY ARRAY[
    'platform_private.durable_work_items'::REGCLASS,
    'platform_private.durable_work_dead_letters'::REGCLASS,
    'platform.work_review_cases'::REGCLASS,
    'platform_private.waha_media_archive_work'::REGCLASS,
    'platform_private.autonomous_reply_intents'::REGCLASS,
    'platform_private.autonomous_reply_intent_lifecycle'::REGCLASS,
    'platform_private.messaging_integration_health_events'::REGCLASS,
    'platform.audit_events'::REGCLASS
  ]
  LOOP
    IF pg_catalog.has_table_privilege('service_role', private_table, 'SELECT')
      OR pg_catalog.has_table_privilege(
        'service_role',
        private_table,
        'INSERT'
      )
      OR pg_catalog.has_table_privilege(
        'service_role',
        private_table,
        'UPDATE'
      )
      OR pg_catalog.has_table_privilege(
        'service_role',
        private_table,
        'DELETE'
      )
    THEN
      RAISE EXCEPTION
        'P7B1 widened service_role raw table access on %',
        private_table;
    END IF;
  END LOOP;
END
$$;

SAVEPOINT expect_authenticated_rpc_denied;
SET LOCAL ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.platform_operational_signals_v1(
  '72000000-0000-4000-8000-000000000090'
);
\set p7b_authenticated_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_authenticated_rpc_denied;
RELEASE SAVEPOINT expect_authenticated_rpc_denied;
SELECT pg_temp.assert_true(
  :'p7b_authenticated_rpc_state' = '42501',
  'authenticated execution must fail with insufficient_privilege'
);

SAVEPOINT expect_nil_request_denied;
SET LOCAL ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.platform_operational_signals_v1(
  '00000000-0000-0000-0000-000000000000'
);
\set p7b_nil_request_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_nil_request_denied;
RELEASE SAVEPOINT expect_nil_request_denied;
SELECT pg_temp.assert_true(
  :'p7b_nil_request_state' = '22023',
  'nil request UUID must fail before collection'
);

\set p7b_org_work_id '72000000-0000-4000-8000-000000000001'
\set p7b_work_admin_user_id '72000000-0000-4000-8000-000000000002'
\set p7b_work_admin_profile_id '72000000-0000-4000-8000-000000000003'
\set p7b_work_admin_membership_id '72000000-0000-4000-8000-000000000004'
\set p7b_work_admin_scope_id '72000000-0000-4000-8000-000000000005'

INSERT INTO auth.users (
  id,
  email,
  raw_user_meta_data
)
VALUES (
  :'p7b_work_admin_user_id',
  'p7b-work-admin@example.invalid',
  '{"full_name":"Synthetic P7B Work Admin"}'::JSONB
);

INSERT INTO platform.organizations (id, name, status)
VALUES (
  :'p7b_org_work_id',
  'Synthetic P7B work-only organization',
  'active'
);
INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status
)
VALUES (
  :'p7b_work_admin_profile_id',
  :'p7b_work_admin_user_id',
  'Synthetic P7B Work Admin',
  'active'
);
INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
SELECT
  :'p7b_work_admin_membership_id',
  :'p7b_org_work_id',
  :'p7b_work_admin_profile_id',
  'active',
  'admin',
  bundle.id
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;
INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  is_active
)
VALUES (
  :'p7b_work_admin_scope_id',
  :'p7b_org_work_id',
  'organization',
  :'p7b_org_work_id',
  TRUE
);
INSERT INTO platform.membership_scope_assignments (
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
  :'p7b_org_work_id',
  :'p7b_work_admin_membership_id',
  :'p7b_work_admin_scope_id',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'Synthetic P7B initial Admin scope',
  '72000000-0000-4000-8000-000000000006'
);

-- Preserve the existing deferred tenant invariant while making this
-- organization's Admin predicate false. Live work below must keep it in the
-- observability union even though its latest organization-scope event denies.
INSERT INTO platform.membership_scope_assignments (
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
  :'p7b_org_work_id',
  :'p7b_work_admin_membership_id',
  :'p7b_work_admin_scope_id',
  1,
  2,
  FALSE,
  'system',
  NULL,
  'Synthetic P7B work-union probe',
  '72000000-0000-4000-8000-000000000007'
);

SELECT pg_catalog.set_config(
  'p7b.test_clock',
  (
    pg_catalog.statement_timestamp() + INTERVAL '30 seconds'
  )::TEXT,
  TRUE
);

CREATE OR REPLACE FUNCTION platform_private.p7b_observability_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.current_setting('p7b.test_clock')::TIMESTAMPTZ
$$;
ALTER FUNCTION platform_private.p7b_observability_clock()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.p7b_observability_clock()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Pin newer local, explicitly non-provider health for every previously active
-- organization.
-- The future test clock makes these rows deterministically newer than fixtures
-- retained by earlier authorization phases. The work-only organization is
-- intentionally excluded until after its missing-evidence proof.
INSERT INTO platform_private.messaging_integration_health_events (
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
SELECT
  organization.id,
  target.value::platform.messaging_integration_target,
  'ready',
  'local_non_provider',
  'Synthetic P7B baseline local-only fixture',
  'synthetic:p7b:baseline-local-only',
  pg_catalog.gen_random_uuid(),
  platform_private.p7b_observability_clock() - INTERVAL '20 seconds'
FROM platform.organizations AS organization
CROSS JOIN (
  VALUES ('waha'), ('ai')
) AS target(value)
WHERE organization.status = 'active'
  AND organization.id <> :'p7b_org_work_id';

-- Earlier authorization suites intentionally leave synthetic queue rows in
-- this shared disposable database. Capture that established global baseline
-- before this work-only organization becomes applicable so the proof below
-- verifies this fixture's exact contribution instead of assuming an empty
-- queue from unrelated phases.
SET LOCAL ROLE service_role;
SELECT platform.platform_operational_signals_v1(
  '72000000-0000-4000-8800-000000000099'
)::TEXT AS p7b_work_union_baseline_signals_text
\gset
RESET ROLE;

-- The third organization has no Admin and no health evidence yet. Its queued,
-- retry-wait, leased and dead-letter rows prove that operational work is a
-- union with the Admin predicate, not filtered out by it.
INSERT INTO platform_private.provider_webhook_events (
  id,
  organization_id,
  provider,
  provider_account_ref,
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
SELECT
  ('72000000-0000-4000-8000-' || pg_catalog.lpad(sequence::TEXT, 12, '0'))::UUID,
  :'p7b_org_work_id',
  'waha',
  'synthetic-p7b-account',
  'synthetic-p7b-request-' || sequence,
  'synthetic-p7b-session',
  'synthetic-p7b-payload-' || sequence,
  'message',
  platform_private.p7b_observability_clock() - INTERVAL '5 minutes',
  'verified',
  '{}'::JSONB,
  '{}'::JSONB,
  'synthetic:p7b:verified',
  pg_catalog.repeat(pg_catalog.to_hex(sequence), 64)::TEXT,
  ('72000000-0000-4000-8100-' || pg_catalog.lpad(sequence::TEXT, 12, '0'))::UUID
FROM pg_catalog.generate_series(10, 13) AS fixture(sequence);

INSERT INTO platform_private.durable_work_items (
  id,
  organization_id,
  kind,
  state,
  source_webhook_event_id,
  business_key_sha256,
  queue_message_id,
  attempt_count,
  max_attempts,
  available_at,
  leased_until,
  completed_at,
  request_id,
  created_at,
  updated_at
)
VALUES
  (
    '72000000-0000-4000-8200-000000000001',
    :'p7b_org_work_id',
    'provider_webhook_process',
    'queued',
    '72000000-0000-4000-8000-000000000010',
    pg_catalog.repeat('1', 64),
    7200000001,
    0,
    3,
    platform_private.p7b_observability_clock() - INTERVAL '120 seconds',
    NULL,
    NULL,
    '72000000-0000-4000-8300-000000000001',
    platform_private.p7b_observability_clock() - INTERVAL '300 seconds',
    platform_private.p7b_observability_clock() - INTERVAL '120 seconds'
  ),
  (
    '72000000-0000-4000-8200-000000000002',
    :'p7b_org_work_id',
    'provider_webhook_process',
    'retry_wait',
    '72000000-0000-4000-8000-000000000011',
    pg_catalog.repeat('2', 64),
    7200000002,
    1,
    3,
    platform_private.p7b_observability_clock() - INTERVAL '60 seconds',
    NULL,
    NULL,
    '72000000-0000-4000-8300-000000000002',
    platform_private.p7b_observability_clock() - INTERVAL '300 seconds',
    platform_private.p7b_observability_clock() - INTERVAL '240 seconds'
  ),
  (
    '72000000-0000-4000-8200-000000000003',
    :'p7b_org_work_id',
    'provider_webhook_process',
    'leased',
    '72000000-0000-4000-8000-000000000012',
    pg_catalog.repeat('3', 64),
    7200000003,
    1,
    3,
    platform_private.p7b_observability_clock() - INTERVAL '60 seconds',
    platform_private.p7b_observability_clock() - INTERVAL '1 second',
    NULL,
    '72000000-0000-4000-8300-000000000003',
    platform_private.p7b_observability_clock() - INTERVAL '300 seconds',
    platform_private.p7b_observability_clock() - INTERVAL '60 seconds'
  ),
  (
    '72000000-0000-4000-8200-000000000004',
    :'p7b_org_work_id',
    'provider_webhook_process',
    'dead_lettered',
    '72000000-0000-4000-8000-000000000013',
    pg_catalog.repeat('4', 64),
    7200000004,
    3,
    3,
    platform_private.p7b_observability_clock() - INTERVAL '300 seconds',
    NULL,
    platform_private.p7b_observability_clock() - INTERVAL '30 seconds',
    '72000000-0000-4000-8300-000000000004',
    platform_private.p7b_observability_clock() - INTERVAL '300 seconds',
    platform_private.p7b_observability_clock() - INTERVAL '30 seconds'
  );

INSERT INTO platform_private.durable_work_dead_letters (
  id,
  organization_id,
  work_item_id,
  attempt_id,
  active_queue_message_id,
  dead_letter_queue_message_id,
  reason_code,
  evidence_ref,
  request_id,
  created_at
)
VALUES (
  '72000000-0000-4000-8400-000000000001',
  :'p7b_org_work_id',
  '72000000-0000-4000-8200-000000000004',
  NULL,
  7200000004,
  7200000099,
  'synthetic_terminal',
  'synthetic:p7b:dead-letter',
  '72000000-0000-4000-8500-000000000001',
  platform_private.p7b_observability_clock() - INTERVAL '30 seconds'
);

SET LOCAL ROLE service_role;
SELECT platform.platform_operational_signals_v1(
  '72000000-0000-4000-8800-000000000000'
)::TEXT AS p7b_work_union_signals_text
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (signals->>'queue_ready_count')::INTEGER =
      (baseline->>'queue_ready_count')::INTEGER + 1
    AND (signals->>'queue_retry_wait_count')::INTEGER =
      (baseline->>'queue_retry_wait_count')::INTEGER + 1
    AND (signals->>'queue_leased_count')::INTEGER =
      (baseline->>'queue_leased_count')::INTEGER + 1
    AND (signals->>'queue_expired_lease_count')::INTEGER =
      (baseline->>'queue_expired_lease_count')::INTEGER + 1
    AND (signals->>'dead_letter_count')::INTEGER =
      (baseline->>'dead_letter_count')::INTEGER + 1
    AND signals->>'waha_readiness' = 'unconfigured'
    AND signals->'waha_evidence_kind' = 'null'::JSONB
    AND signals->'waha_age_seconds' = baseline->'waha_age_seconds'
    AND signals->>'ai_readiness' = 'unconfigured'
    AND signals->'ai_evidence_kind' = 'null'::JSONB
    AND signals->'ai_age_seconds' = baseline->'ai_age_seconds'
    AND signals->>'audit_append_status' = 'ready',
  'work-only active organization must remain applicable without Admin or health evidence'
)
FROM (
  SELECT
    :'p7b_work_union_signals_text'::JSONB AS signals,
    :'p7b_work_union_baseline_signals_text'::JSONB AS baseline
) AS result;

-- Restore the invariant before the outer transaction ends; the test itself
-- still rolls all synthetic rows and the clock replacement back.
INSERT INTO platform.membership_scope_assignments (
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
  :'p7b_org_work_id',
  :'p7b_work_admin_membership_id',
  :'p7b_work_admin_scope_id',
  1,
  3,
  TRUE,
  'system',
  NULL,
  'Synthetic P7B restore Admin scope',
  '72000000-0000-4000-8000-000000000008'
);

-- Complete the work-only organization's local-only evidence. Every previously
-- active organization already received deterministic baseline health above,
-- so the raw health reduction can be exercised without assuming a fixed
-- number of organizations or pretending a provider was observed.
INSERT INTO platform_private.messaging_integration_health_events (
  id,
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
SELECT
  fixture.event_id,
  :'p7b_org_work_id',
  fixture.target::platform.messaging_integration_target,
  'ready',
  'local_non_provider',
  'Synthetic P7B local-only fixture',
  'synthetic:p7b:local-only',
  fixture.request_id,
  platform_private.p7b_observability_clock()
    - pg_catalog.make_interval(secs => fixture.age_seconds)
FROM (
  VALUES
    (
      '72000000-0000-4000-8600-000000000001'::UUID,
      'waha',
      '72000000-0000-4000-8700-000000000001'::UUID,
      30
    ),
    (
      '72000000-0000-4000-8600-000000000002'::UUID,
      'ai',
      '72000000-0000-4000-8700-000000000002'::UUID,
      30
    )
) AS fixture(event_id, target, request_id, age_seconds);

SELECT pg_catalog.count(*) AS p7b_audit_rows_before
FROM platform.audit_events
WHERE request_id = '72000000-0000-4000-8800-000000000001'
\gset

SET LOCAL ROLE service_role;
SELECT platform.platform_operational_signals_v1(
  '72000000-0000-4000-8800-000000000001'
)::TEXT AS p7b_signals_text
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  pg_catalog.array_agg(key ORDER BY key) = ARRAY[
    'ai_age_seconds',
    'ai_evidence_future',
    'ai_evidence_kind',
    'ai_readiness',
    'audit_append_status',
    'autonomy_dispatching_count',
    'autonomy_manual_review_count',
    'autonomy_oldest_dispatching_age_seconds',
    'autonomy_oldest_queued_age_seconds',
    'autonomy_queued_count',
    'autonomy_unknown_count',
    'dead_letter_count',
    'observed_at',
    'private_media_expired_lease_count',
    'private_media_oldest_unarchived_age_seconds',
    'private_media_pending_count',
    'private_media_processing_count',
    'private_media_retryable_error_count',
    'private_media_terminal_error_count',
    'provider_conflict_open_count',
    'queue_expired_lease_count',
    'queue_leased_count',
    'queue_oldest_ready_age_seconds',
    'queue_oldest_retry_wait_age_seconds',
    'queue_ready_count',
    'queue_retry_wait_count',
    'saturated',
    'schema_version',
    'unknown_delivery_open_count',
    'waha_age_seconds',
    'waha_evidence_future',
    'waha_evidence_kind',
    'waha_readiness'
  ]::TEXT[],
  'RPC must return exactly the 33-key P7B v1 DTO'
)
FROM pg_catalog.jsonb_object_keys(:'p7b_signals_text'::JSONB) AS key;

SELECT pg_temp.assert_true(
  signals->>'schema_version' = 'p7b-v1'
    AND (signals->>'queue_ready_count')::INTEGER =
      (baseline->>'queue_ready_count')::INTEGER + 1
    AND (signals->>'queue_retry_wait_count')::INTEGER =
      (baseline->>'queue_retry_wait_count')::INTEGER + 1
    AND (signals->>'queue_leased_count')::INTEGER =
      (baseline->>'queue_leased_count')::INTEGER + 1
    AND (signals->>'queue_expired_lease_count')::INTEGER =
      (baseline->>'queue_expired_lease_count')::INTEGER + 1
    AND (signals->>'queue_oldest_ready_age_seconds')::INTEGER =
      GREATEST(
        COALESCE(
          (baseline->>'queue_oldest_ready_age_seconds')::INTEGER,
          0
        ),
        120
      )
    AND (signals->>'queue_oldest_retry_wait_age_seconds')::INTEGER =
      GREATEST(
        COALESCE(
          (baseline->>'queue_oldest_retry_wait_age_seconds')::INTEGER,
          0
        ),
        240
      )
    AND (signals->>'dead_letter_count')::INTEGER =
      (baseline->>'dead_letter_count')::INTEGER + 1
    AND signals->'unknown_delivery_open_count' =
      baseline->'unknown_delivery_open_count'
    AND signals->'provider_conflict_open_count' =
      baseline->'provider_conflict_open_count'
    AND signals->>'waha_readiness' = 'ready'
    AND signals->>'waha_evidence_kind' = 'local_non_provider'
    AND signals->>'waha_age_seconds' = '30'
    AND signals->>'waha_evidence_future' = 'false'
    AND signals->>'ai_readiness' = 'ready'
    AND signals->>'ai_evidence_kind' = 'local_non_provider'
    AND signals->>'ai_age_seconds' = '30'
    AND signals->>'ai_evidence_future' = 'false'
    AND signals->>'audit_append_status' = 'ready'
    AND signals->'saturated' = baseline->'saturated',
  'safe aggregate values must follow the frozen queue/health/audit contract'
)
FROM (
  SELECT
    :'p7b_signals_text'::JSONB AS signals,
    :'p7b_work_union_baseline_signals_text'::JSONB AS baseline
) AS result;

SELECT pg_temp.assert_true(
  :'p7b_signals_text' !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    AND pg_catalog.strpos(
      :'p7b_signals_text',
      'Synthetic P7B'
    ) = 0
    AND pg_catalog.strpos(
      :'p7b_signals_text',
      'synthetic:p7b'
    ) = 0,
  'global DTO must not disclose tenant UUIDs, reasons or evidence references'
);

SELECT pg_temp.assert_true(
  pg_catalog.count(*) = :'p7b_audit_rows_before'::BIGINT,
  'audit append probe must roll back its sentinel row'
)
FROM platform.audit_events
WHERE request_id = '72000000-0000-4000-8800-000000000001';

-- A newer future provider timestamp is clamped to age zero, explicitly
-- marked future, and raises only the global saturation bit.
INSERT INTO platform_private.messaging_integration_health_events (
  id,
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
VALUES (
  '72000000-0000-4000-8600-000000000007',
  :'p7b_org_work_id',
  'waha',
  'ready',
  'local_non_provider',
  'Synthetic P7B future-evidence fixture',
  'synthetic:p7b:future',
  '72000000-0000-4000-8700-000000000007',
  platform_private.p7b_observability_clock() + INTERVAL '10 seconds'
);

SET LOCAL ROLE service_role;
SELECT platform.platform_operational_signals_v1(
  '72000000-0000-4000-8800-000000000002'
)::TEXT AS p7b_future_signals_text
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  signals->>'waha_readiness' = 'ready'
    AND signals->>'waha_age_seconds' = '20'
    AND signals->>'waha_evidence_future' = 'true'
    AND signals->>'saturated' = 'true',
  'future evidence must be explicit and saturating without a negative age'
)
FROM (SELECT :'p7b_future_signals_text'::JSONB AS signals) AS result;

-- Static/runtime planner evidence pins every new tenant/state/time index to
-- the fixed P7B seek shape. enable_seqscan is local to this rolled-back test.
SET LOCAL enable_seqscan = off;
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT item.available_at
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id =
      '72000000-0000-4000-8000-000000000001'
      AND item.state = 'queued'
    ORDER BY item.available_at, item.id
    LIMIT 1
  $query$,
  'durable_work_items_p7b_ready_idx'
);
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT item.updated_at
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id =
      '72000000-0000-4000-8000-000000000001'
      AND item.state = 'retry_wait'
    ORDER BY item.updated_at, item.id
    LIMIT 1
  $query$,
  'durable_work_items_p7b_retry_wait_idx'
);
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT item.leased_until
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(ARRAY[
      '72000000-0000-4000-8000-000000000001'::UUID
    ])
      AND item.state = 'leased'
      AND item.leased_until IS NOT NULL
    ORDER BY item.leased_until, item.id
    LIMIT 1
  $query$,
  'durable_work_items_p7b_expired_lease_idx'
);
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT item.id
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(ARRAY[
      '72000000-0000-4000-8000-000000000001'::UUID
    ])
      AND item.state = 'leased'
    LIMIT 1000001
  $query$,
  'durable_work_items_p7b_leased_idx'
);
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT media.id
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(ARRAY[
      '72000000-0000-4000-8000-000000000001'::UUID
    ])
      AND media.state = 'pending'
    LIMIT 1000001
  $query$,
  'waha_media_archive_work_p7b_state_idx'
);
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT media.created_at
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id =
      '72000000-0000-4000-8000-000000000001'
      AND media.state <> 'archived'
    ORDER BY media.created_at, media.id
    LIMIT 1
  $query$,
  'waha_media_archive_work_p7b_oldest_idx'
);
-- The shared fixture is intentionally tiny, so PostgreSQL may otherwise
-- prefer the older unique lifecycle index plus an explicit sort. Disable only
-- that planner option inside this rolled-back proof to verify that the new
-- state/time index can satisfy the required ordered seek directly.
SET LOCAL enable_sort = off;
SELECT pg_temp.assert_plan_uses(
  $query$
    SELECT lifecycle.created_at
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id =
      '72000000-0000-4000-8000-000000000001'::UUID
      AND lifecycle.state = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    ORDER BY lifecycle.created_at, lifecycle.id
    LIMIT 1
  $query$,
  'autonomous_reply_lifecycle_p7b_state_time_idx'
);

ROLLBACK;
