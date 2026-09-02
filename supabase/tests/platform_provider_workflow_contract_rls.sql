\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P5A acceptance is provider-free and transaction-local. It proves that
-- authenticated staff intent is required before Gemini service work and that
-- WAHA reconciliation exposes only one narrow staff/service RPC contour.
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
    RAISE EXCEPTION 'P5A assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Exact inventory, hardening and replace-not-layer surface.
SELECT pg_temp.assert_true(
  to_regclass('platform_private.gemini_proposal_request_receipts') IS NOT NULL
  AND to_regclass(
    'platform_private.manual_whatsapp_reconciliation_requests'
  ) IS NOT NULL
  AND to_regclass(
    'platform_private.manual_whatsapp_reconciliation_results'
  ) IS NOT NULL,
  'P5A append-only ledgers are missing'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      'platform_private.gemini_proposal_request_receipts'::REGCLASS,
      'platform_private.manual_whatsapp_reconciliation_requests'::REGCLASS,
      'platform_private.manual_whatsapp_reconciliation_results'::REGCLASS
    )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ),
  'P5A private ledgers are not forced-RLS'
);

SELECT pg_temp.assert_true(
  to_regprocedure(
    'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.manual_whatsapp_reconciliation_context(uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid)'
  ) IS NULL
  AND to_regprocedure(
    'platform.finish_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text,text,platform.waha_ack_state,timestamptz)'
  ) IS NULL,
  'P5A RPC signatures or removed draft overload inventory drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname LIKE '%pre_p5a%'
  ),
  'A renamed pre-P5A helper remains exposed in platform'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'platform_private.gemini_proposal_request_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.manual_whatsapp_reconciliation_requests',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.manual_whatsapp_reconciliation_results',
    'SELECT'
  ),
  'A private P5A ledger has a direct browser/service table grant'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.manual_whatsapp_reconciliation_context(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.manual_whatsapp_reconciliation_context(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform_private.staff_gemini_proposal_pre_p5a_internal(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform_private.review_gemini_proposal_pre_p5a_internal(uuid,uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'P5A RPC least-privilege grants drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid IN (
      'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'::REGPROCEDURE,
      'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE,
      'platform.staff_gemini_proposal(uuid,uuid)'::REGPROCEDURE,
      'platform.review_gemini_proposal(uuid,uuid,uuid,uuid,text,jsonb,text)'::REGPROCEDURE,
      'platform.staff_gemini_proposal_reviews(uuid,uuid,integer)'::REGPROCEDURE,
      'platform.staff_latest_manual_whatsapp_send_attempt(uuid,uuid)'::REGPROCEDURE,
      'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)'::REGPROCEDURE,
      'platform.manual_whatsapp_reconciliation_context(uuid)'::REGPROCEDURE,
      'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)'::REGPROCEDURE
    )
      AND (
        NOT routine.prosecdef
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      )
  ),
  'P5A RPC SECURITY DEFINER/search_path hardening drifted'
);

SELECT pg_temp.assert_true(
  NOT (
    SELECT routine.proargnames && ARRAY[
      'provider_message_id',
      'raw_message_id',
      'raw_chat_id',
      'waha_session_name',
      'recipient_sha256'
    ]::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'platform.staff_latest_manual_whatsapp_send_attempt(uuid,uuid)'::REGPROCEDURE
  )
  AND (
    SELECT pg_catalog.pg_get_functiondef(routine.oid)
      !~ '(pgmq[.]send|claim_manual_whatsapp_send|finish_manual_whatsapp_send)'
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)'::REGPROCEDURE
  ),
  'Browser projection leaked provider identity or reconciliation gained send authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.pg_get_functiondef(routine.oid)
      ~ 'gemini_proposal_is_staff_bound'
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'platform.staff_gemini_proposal_reviews(uuid,uuid,integer)'::REGPROCEDURE
  ),
  'Historical unbound Gemini reviews are not filtered from the staff list'
);

-- Resolve persistent staff/conversation fixtures created by earlier suites.
SELECT
  membership.organization_id AS p5a_org_b,
  membership.id AS p5a_admin_b_membership,
  profile.id AS p5a_admin_b_profile,
  profile.access_version AS p5a_admin_b_access_version,
  membership.current_bundle_id AS p5a_admin_b_bundle,
  bundle.version AS p5a_admin_b_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.organization_id AS p5a_org_a,
  membership.id AS p5a_admin_a_membership,
  profile.access_version AS p5a_admin_a_access_version,
  membership.current_bundle_id AS p5a_admin_a_bundle,
  bundle.version AS p5a_admin_a_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  conversation.id AS p5a_conversation_b,
  latest_message.id AS p5a_source_b
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT message.id, message.direction
  FROM platform.communication_messages AS message
  WHERE message.organization_id = conversation.organization_id
    AND message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
) AS latest_message ON latest_message.direction = 'inbound'
WHERE conversation.organization_id = :'p5a_org_b'
  AND conversation.status = 'open'
ORDER BY conversation.created_at, conversation.id
LIMIT 1
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5a_admin_b_access_version'::BIGINT,
  'platform_organization_id', :'p5a_org_b',
  'platform_membership_id', :'p5a_admin_b_membership',
  'platform_bundle_id', :'p5a_admin_b_bundle',
  'platform_bundle_version', :'p5a_admin_b_bundle_version'::BIGINT
)::TEXT AS p5a_admin_b_claims,
pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5a_admin_a_access_version'::BIGINT,
  'platform_organization_id', :'p5a_org_a',
  'platform_membership_id', :'p5a_admin_a_membership',
  'platform_bundle_id', :'p5a_admin_a_bundle',
  'platform_bundle_version', :'p5a_admin_a_bundle_version'::BIGINT
)::TEXT AS p5a_admin_a_claims
\gset

-- Authenticated staff initiation: exact replay, conflict, tenant denial and
-- immutable real actor identity even while Admin previews a role interface.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', :'p5a_admin_b_claims', true);
SELECT * FROM platform.request_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000001',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1',
  'P5A staff-request binding acceptance'
) \gset p5a_staff_request_

SELECT * FROM platform.request_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000001',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1',
  'P5A staff-request binding acceptance'
) \gset p5a_staff_replay_

\set ON_ERROR_STOP off
SELECT * FROM platform.request_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000001',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1',
  'Changed reason must conflict'
);
\set p5a_staff_conflict_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_catalog.set_config('request.jwt.claims', :'p5a_admin_a_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.request_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000002',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1',
  'Cross-tenant request must fail'
);
\set p5a_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT :'p5a_staff_request_replayed'::BOOLEAN
  AND :'p5a_staff_replay_replayed'::BOOLEAN
  AND :'p5a_staff_request_proposal_request_receipt_id' =
    :'p5a_staff_replay_proposal_request_receipt_id'
  AND :'p5a_staff_conflict_state' = '22023'
  AND :'p5a_cross_org_state' = '42501',
  'Gemini staff initiation replay/conflict/tenant contract failed'
);

-- Service begin is impossible without the staff ledger, then exact begin
-- replay binds the sole proposal request to that receipt.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.begin_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000003',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
);
\set p5a_uninitiated_begin_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT * FROM platform.begin_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000001',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
) \gset p5a_begin_
SELECT * FROM platform.begin_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000001',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
) \gset p5a_begin_replay_
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_uninitiated_begin_state' = '42501'
  AND NOT :'p5a_begin_replayed'::BOOLEAN
  AND :'p5a_begin_replay_replayed'::BOOLEAN
  AND EXISTS (
    SELECT 1
    FROM platform_private.gemini_proposal_requests AS request
    WHERE request.id = :'p5a_begin_proposal_request_id'
      AND request.staff_binding_required
      AND request.staff_request_receipt_id =
        :'p5a_staff_request_proposal_request_receipt_id'
  ),
  'Gemini service begin did not require and bind exact staff intent'
);

-- A simulated pre-096 unbound row remains historical but cannot become new
-- authority through finish/read/review after migration 096.
INSERT INTO platform_private.gemini_proposal_requests (
  id, organization_id, conversation_id, source_message_id, request_id,
  request_fingerprint, model_ref, schema_version, prompt_policy_version,
  private_context, context_sha256, input_sha256,
  staff_binding_required, staff_request_receipt_id
) VALUES (
  '96500000-0000-4000-8000-000000000010',
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000011', repeat('a', 64),
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1',
  '{}'::JSONB, platform_private.ai_memory_json_sha256('{}'::JSONB),
  repeat('b', 64), FALSE, NULL
);

SET LOCAL ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b', :'p5a_source_b',
  '96500000-0000-4000-8000-000000000010',
  'human_review', 'privacy_not_approved',
  'P5A unbound finish must fail.', NULL, 'not_called', NULL
);
\set p5a_unbound_finish_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', :'p5a_admin_b_claims', true);
SELECT pg_catalog.count(*)::TEXT AS p5a_unbound_latest_count
FROM platform.staff_gemini_proposal(:'p5a_org_b', :'p5a_conversation_b')
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform.review_gemini_proposal(
  :'p5a_org_b', :'p5a_conversation_b',
  '96500000-0000-4000-8000-000000000010',
  '96500000-0000-4000-8000-000000000012',
  'rejected', NULL, 'Unbound historical proposal'
);
\set p5a_unbound_review_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_unbound_finish_state' = '42501'
  AND :'p5a_unbound_latest_count' = '0'
  AND :'p5a_unbound_review_state' = '42501',
  'Unbound schema-v2 Gemini history became active authority'
);

-- Null/ambiguous reconciliation inputs fail before any request lookup. These
-- cases specifically guard PL/pgSQL three-valued boolean validation.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT platform.finish_manual_whatsapp_reconciliation(
  '96500000-0000-4000-8000-000000000020',
  'evo-inbox', '996555096000@c.us', repeat('c', 64),
  NULL, NULL, NULL, NULL, NULL, NULL,
  '96500000-0000-4000-8000-000000000021'
);
\set p5a_null_match_count_state :SQLSTATE
SELECT platform.finish_manual_whatsapp_reconciliation(
  '96500000-0000-4000-8000-000000000020',
  'evo-inbox', '996555096000@c.us', NULL,
  0, NULL, NULL, NULL, NULL, NULL,
  '96500000-0000-4000-8000-000000000022'
);
\set p5a_null_final_hash_state :SQLSTATE
SELECT platform.finish_manual_whatsapp_reconciliation(
  '96500000-0000-4000-8000-000000000020',
  'evo-inbox', '996555096000@c.us', repeat('c', 64),
  2, 'ambiguous-provider-message', 'api', 'server',
  statement_timestamp(), statement_timestamp(),
  '96500000-0000-4000-8000-000000000023'
);
\set p5a_ambiguous_match_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_null_match_count_state' = '22023'
  AND :'p5a_null_final_hash_state' = '22023'
  AND :'p5a_ambiguous_match_state' = '22023',
  'WAHA reconciliation null/ambiguity validation did not fail closed'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform migration 096 provider workflow contract passed' AS result;
