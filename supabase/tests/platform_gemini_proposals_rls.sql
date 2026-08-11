\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P5F2 acceptance is synthetic and provider-free. It proves exact-source
-- binding, private append-only audit, service-only mutation and a safe staff
-- projection. It does not call Gemini, send WhatsApp or write amoCRM/memory.
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
    RAISE EXCEPTION 'P5F2 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Exact private inventory, forced RLS, no policies and no direct grants.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(relation.relname ORDER BY relation.relname)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relkind = 'r'
      AND relation.relname = ANY(ARRAY[
        'gemini_proposal_requests',
        'gemini_proposal_results'
      ]::TEXT[])
  ) = ARRAY[
    'gemini_proposal_requests',
    'gemini_proposal_results'
  ]::NAME[],
  'private table inventory drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relkind IN ('r', 'v', 'm')
      AND relation.relname IN (
        'gemini_proposal_requests',
        'gemini_proposal_results'
      )
  ),
  'private proposal audit leaked into the public schema'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname IN (
        'gemini_proposal_requests',
        'gemini_proposal_results'
      )
      AND (
        relation.relowner <> (
          SELECT role.oid
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
        )
        OR NOT relation.relrowsecurity
        OR NOT relation.relforcerowsecurity
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'platform_private'
      AND policy.tablename IN (
        'gemini_proposal_requests',
        'gemini_proposal_results'
      )
  ),
  'owner, forced RLS or zero-policy contract drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'platform_private.gemini_proposal_requests',
      'platform_private.gemini_proposal_results'
    ]::TEXT[]) AS relation(value)
    CROSS JOIN pg_catalog.unnest(ARRAY[
      'anon',
      'authenticated',
      'service_role',
      'supabase_auth_admin'
    ]::TEXT[]) AS checked_role(value)
    WHERE pg_catalog.has_table_privilege(
      checked_role.value,
      relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ),
  'private proposal tables have a direct grant'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.gemini_proposal_outcome'::REGTYPE
  ) = ARRAY['proposal_ready', 'human_review']::NAME[],
  'proposal outcome enum drifted'
);

SELECT pg_temp.assert_true(
  platform_private.gemini_proposal_provider_status_is_valid('completed')
  AND platform_private.gemini_proposal_provider_status_is_valid('incomplete')
  AND platform_private.gemini_proposal_provider_status_is_valid(
    'configuration_error'
  )
  AND platform_private.gemini_proposal_provider_status_is_valid(
    'transport_error'
  )
  AND NOT platform_private.gemini_proposal_provider_status_is_valid(NULL)
  AND NOT platform_private.gemini_proposal_provider_status_is_valid(
    'unknown_status'
  ),
  'private provider-status vocabulary drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 4
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname IN (
        'gemini_proposal_requests',
        'gemini_proposal_results'
      )
      AND NOT trigger.tgisinternal
      AND trigger.tgname LIKE '%append_only%'
  ),
  'append-only trigger inventory drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
      'platform.finish_gemini_proposal(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)'
    ]::TEXT[]) AS signature(value)
    CROSS JOIN pg_catalog.unnest(ARRAY[
      'anon',
      'authenticated',
      'supabase_auth_admin'
    ]::TEXT[]) AS checked_role(value)
    WHERE pg_catalog.has_function_privilege(
      checked_role.value,
      signature.value,
      'EXECUTE'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'anon',
      'service_role',
      'supabase_auth_admin'
    ]::TEXT[]) AS checked_role(value)
    WHERE pg_catalog.has_function_privilege(
      checked_role.value,
      'platform.staff_gemini_proposal(uuid,uuid)',
      'EXECUTE'
    )
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'platform.finish_gemini_proposal(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.staff_gemini_proposal(uuid,uuid)',
    'EXECUTE'
  ),
  'proposal RPC ACL drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname IN (
        'begin_gemini_proposal',
        'finish_gemini_proposal',
        'staff_gemini_proposal'
      )
      AND (
        NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      )
  ),
  'proposal RPC definer/search_path hardening drifted'
);

-- Resolve persistent P2F/P3C fixtures and build exact live claims.
SELECT
  membership.organization_id AS p5f2_org_b,
  membership.id AS p5f2_admin_b_membership,
  profile.access_version AS p5f2_admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.organization_id AS p5f2_org_a,
  profile.access_version AS p5f2_admin_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  conversation.id AS p5f2_conversation_b,
  latest_message.id AS p5f2_source_b,
  conversation.amocrm_account_id AS p5f2_amocrm_account_b,
  conversation.amocrm_contact_id AS p5f2_amocrm_contact_b,
  conversation.amocrm_lead_id AS p5f2_amocrm_lead_b
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT message.id, message.direction
  FROM platform.communication_messages AS message
  WHERE message.organization_id = conversation.organization_id
    AND message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
) AS latest_message ON latest_message.direction = 'inbound'
WHERE conversation.organization_id = :'p5f2_org_b'
  AND conversation.status = 'open'
  AND conversation.amocrm_account_id IS NOT NULL
  AND conversation.amocrm_contact_id IS NOT NULL
  AND conversation.amocrm_lead_id IS NOT NULL
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT
  conversation.id AS p5f2_conversation_a,
  latest_message.id AS p5f2_source_a
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT message.id, message.direction
  FROM platform.communication_messages AS message
  WHERE message.organization_id = conversation.organization_id
    AND message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
) AS latest_message ON latest_message.direction = 'inbound'
WHERE conversation.organization_id = :'p5f2_org_a'
  AND conversation.status = 'open'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT
  knowledge.id AS p5f2_knowledge_b,
  knowledge.knowledge_key AS p5f2_knowledge_key_b,
  knowledge.version AS p5f2_knowledge_version_b
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'p5f2_org_b'
  AND knowledge.status = 'approved'
ORDER BY knowledge.updated_at DESC, knowledge.id
LIMIT 1
\gset

SELECT pg_temp.assert_true(
  :'p5f2_source_b' <> ''
  AND :'p5f2_source_a' <> ''
  AND :'p5f2_knowledge_b' <> '',
  'persistent proposal fixture resolution drifted'
);

SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5f2_admin_b_access_version'::BIGINT
)::TEXT AS p5f2_admin_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5f2_admin_a_access_version'::BIGINT
)::TEXT AS p5f2_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '66000000-0000-4000-8000-00000000ffff',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1
)::TEXT AS p5f2_no_membership_claims
\gset

-- Seed only private, synthetic P5F1/P4R1 context. These rows rollback.
INSERT INTO platform_private.conversation_ai_memory_versions (
  organization_id,
  conversation_id,
  version,
  short_summary,
  long_summary,
  short_summary_sha256,
  long_summary_sha256,
  source_message_id,
  recorded_by_membership_id,
  reason,
  request_id
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  1,
  'Synthetic P5F2 memory.',
  'Synthetic P5F2 bounded long memory for provider-free testing.',
  platform_private.ai_memory_text_sha256('Synthetic P5F2 memory.'),
  platform_private.ai_memory_text_sha256(
    'Synthetic P5F2 bounded long memory for provider-free testing.'
  ),
  :'p5f2_source_b',
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000001'
);

INSERT INTO platform_private.conversation_ai_fact_versions (
  organization_id,
  conversation_id,
  fact_key,
  version,
  status,
  fact_value,
  fact_value_sha256,
  source_message_id,
  recorded_by_membership_id,
  reason,
  request_id
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  'preferred_country',
  1,
  'active',
  '"China"'::JSONB,
  platform_private.ai_memory_json_sha256('"China"'::JSONB),
  :'p5f2_source_b',
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000002'
);

INSERT INTO platform_private.conversation_ai_qualification_versions (
  organization_id,
  conversation_id,
  version,
  status,
  completeness,
  missing_fact_keys,
  notes,
  notes_sha256,
  source_message_id,
  recorded_by_membership_id,
  reason,
  request_id
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  1,
  'collecting',
  25,
  ARRAY['preferred_program']::platform.ai_memory_fact_key[],
  'Synthetic qualification.',
  platform_private.ai_memory_text_sha256('Synthetic qualification.'),
  :'p5f2_source_b',
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000003'
);

INSERT INTO platform_private.conversation_ai_control_events (
  organization_id,
  conversation_id,
  version,
  previous_state,
  new_state,
  recorded_by_membership_id,
  reason,
  request_id
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  1,
  'paused',
  'staff_only',
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000004'
);

INSERT INTO platform_private.approved_knowledge_chunk_sets (
  id,
  organization_id,
  knowledge_version_id,
  chunker_version,
  source_content_sha256,
  chunk_count,
  published_by_membership_id,
  reason,
  request_id
)
SELECT
  '66000000-0000-4000-8000-000000000100',
  :'p5f2_org_b',
  knowledge.id,
  'p5f2-synthetic-v1',
  knowledge.content_sha256,
  1,
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000005'
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'p5f2_org_b'
  AND knowledge.id = :'p5f2_knowledge_b';

INSERT INTO platform_private.approved_knowledge_chunks (
  id,
  organization_id,
  chunk_set_id,
  knowledge_version_id,
  chunk_index,
  start_offset,
  end_offset,
  content_text,
  content_sha256
)
VALUES (
  '66000000-0000-4000-8000-000000000101',
  :'p5f2_org_b',
  '66000000-0000-4000-8000-000000000100',
  :'p5f2_knowledge_b',
  0,
  0,
  44,
  'Synthetic P5F2 grounded admissions evidence.',
  platform_private.ai_memory_text_sha256(
    'Synthetic P5F2 grounded admissions evidence.'
  )
);

INSERT INTO platform_private.ai_retrieval_requests (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  mode,
  outcome,
  query_sha256,
  requested_limit,
  degraded,
  requested_by_membership_id,
  reason,
  request_id
)
VALUES (
  '66000000-0000-4000-8000-000000000110',
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  'lexical_preview',
  'completed',
  platform_private.ai_memory_text_sha256('synthetic p5f2 query'),
  1,
  TRUE,
  :'p5f2_admin_b_membership',
  'p5f2_synthetic_test',
  '66000000-0000-4000-8000-000000000006'
);

INSERT INTO platform_private.ai_retrieval_evidence (
  organization_id,
  conversation_id,
  source_message_id,
  retrieval_request_id,
  knowledge_version_id,
  chunk_id,
  ordinal,
  lexical_score,
  chunk_content_sha256
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000110',
  :'p5f2_knowledge_b',
  '66000000-0000-4000-8000-000000000101',
  1,
  1.0,
  platform_private.ai_memory_text_sha256(
    'Synthetic P5F2 grounded admissions evidence.'
  )
);

INSERT INTO platform_private.amocrm_canonical_context_current (
  organization_id,
  conversation_id,
  amocrm_account_id,
  amocrm_contact_id,
  amocrm_lead_id,
  observed_capabilities,
  state,
  contact_name,
  lead_name,
  responsible_user_resolution,
  pipeline_id,
  pipeline_name,
  status_id,
  status_name,
  provider_observed_at,
  last_attempt_at,
  adapter_contract_version,
  version
)
VALUES (
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_amocrm_account_b',
  :'p5f2_amocrm_contact_b',
  :'p5f2_amocrm_lead_b',
  ARRAY['account.read', 'contact.read', 'lead.read', 'pipeline.read'],
  'available',
  'Synthetic Contact',
  'Synthetic Lead',
  'not_assigned',
  1001,
  'Synthetic Pipeline',
  1002,
  'Synthetic Status',
  statement_timestamp(),
  statement_timestamp(),
  1,
  1
);

SELECT count(*)::TEXT AS p5f2_manual_send_count_before
FROM platform.manual_send_authorizations
\gset
SELECT count(*)::TEXT AS p5f2_memory_count_before
FROM platform_private.conversation_ai_memory_versions
\gset

-- Mutation routines are service-only even if an authenticated actor has the
-- staff permission.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f2_admin_b_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000200',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
);
\set p5f2_authenticated_begin_state :SQLSTATE
SELECT * FROM platform_private.gemini_proposal_requests;
\set p5f2_authenticated_private_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"66000000-0000-4000-8000-000000000999","role":"service_role"}',
  true
);

SELECT *
FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000200',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
)
\gset p5f2_begin_

SELECT pg_temp.assert_true(
  :'p5f2_begin_replayed'::BOOLEAN = FALSE
  AND :'p5f2_begin_completed'::BOOLEAN = FALSE
  AND (:'p5f2_begin_context'::JSONB -> 'conversation' ->> 'conversation_id')::UUID
    = :'p5f2_conversation_b'::UUID
  AND :'p5f2_begin_context'::JSONB -> 'source_message' ->> 'direction'
    = 'inbound'
  AND :'p5f2_begin_context'::JSONB -> 'memory' ->> 'short_summary'
    = 'Synthetic P5F2 memory.'
  AND :'p5f2_begin_context'::JSONB -> 'memory' -> 'control' ->> 'state'
    = 'staff_only'
  AND :'p5f2_begin_context'::JSONB -> 'retrieval' ->> 'mode'
    = 'lexical_preview'
  AND :'p5f2_begin_context'::JSONB -> 'retrieval' -> 'evidence' -> 0
      ->> 'content_text'
    = 'Synthetic P5F2 grounded admissions evidence.'
  AND :'p5f2_begin_context'::JSONB -> 'amocrm' ->> 'lead_name'
    = 'Synthetic Lead'
  AND pg_catalog.char_length(:'p5f2_begin_context') <= 65536,
  'begin did not return the exact bounded context'
);

SELECT pg_temp.assert_true(
  NOT (:'p5f2_begin_context'::JSONB)::TEXT ~
    'waha_message_id|waha_session_name|kommo_[a-z_]*id|amocrm_[a-z_]*id|provider_interaction|phone',
  'private context exposed a raw provider identifier key'
);

SELECT *
FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000200',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
)
\gset p5f2_replay_

SELECT pg_temp.assert_true(
  :'p5f2_replay_proposal_request_id' = :'p5f2_begin_proposal_request_id'
  AND :'p5f2_replay_replayed'::BOOLEAN
  AND NOT :'p5f2_replay_completed'::BOOLEAN,
  'begin replay was not exact and pending'
);

\set ON_ERROR_STOP off
SELECT * FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_a',
  '66000000-0000-4000-8000-000000000200',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
);
\set p5f2_reuse_mismatch_state :SQLSTATE
SELECT * FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_a',
  '66000000-0000-4000-8000-000000000201',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
);
\set p5f2_wrong_source_state :SQLSTATE
SELECT * FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000202',
  'gemini-3.6-flash',
  1,
  'p5f2-gemini-proposal-v1'
);
\set p5f2_wrong_model_state :SQLSTATE
SELECT * FROM platform_private.gemini_proposal_requests;
\set p5f2_service_private_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f2_authenticated_begin_state' = '42501'
  AND :'p5f2_authenticated_private_state' = '42501'
  AND :'p5f2_reuse_mismatch_state' = '22023'
  AND :'p5f2_wrong_source_state' = '42501'
  AND :'p5f2_wrong_model_state' = '22023'
  AND :'p5f2_service_private_state' = '42501',
  'service boundary, idempotency or exact source/model binding drifted'
);

SELECT pg_catalog.jsonb_build_object(
  'schema_version', 1,
  'language', 'ru',
  'intent', 'admissions_discovery',
  'confidence', 88,
  'risk', 'low',
  'handoff_required', false,
  'handoff_reasons', '[]'::JSONB,
  'citations', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'knowledge_key', :'p5f2_knowledge_key_b',
      'knowledge_version', :'p5f2_knowledge_version_b'::BIGINT,
      'evidence_ordinal', 1
    )
  ),
  'memory_changes', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'fact_key', 'preferred_program',
      'action', 'set',
      'value', 'Bachelor',
      'confidence', 80
    )
  ),
  'qualification', pg_catalog.jsonb_build_object(
    'status', 'ready_for_staff_review',
    'completeness', 80,
    'missing_fact_keys', pg_catalog.jsonb_build_array('budget_signal'),
    'notes', 'Synthetic review note.'
  ),
  'reply_text', 'Здравствуйте! Уточните, пожалуйста, ваш бюджет.'
)::TEXT AS p5f2_valid_response
\gset

SELECT *
FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic bounded Gemini prompt.',
  'synthetic-provider-interaction-ref',
  'completed',
  :'p5f2_valid_response'::JSONB
)
\gset p5f2_finish_

SELECT pg_temp.assert_true(
  NOT :'p5f2_finish_replayed'::BOOLEAN
  AND :'p5f2_finish_outcome' = 'proposal_ready'
  AND :'p5f2_finish_human_review_required'::BOOLEAN
  AND NOT :'p5f2_finish_autonomous_authority'::BOOLEAN
  AND :'p5f2_finish_provider_proof_state' = 'blocked',
  'proposal finish invented send/provider/autonomy evidence'
);

SELECT *
FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic bounded Gemini prompt.',
  'synthetic-provider-interaction-ref',
  'completed',
  :'p5f2_valid_response'::JSONB
)
\gset p5f2_finish_replay_

SELECT pg_temp.assert_true(
  :'p5f2_finish_replay_replayed'::BOOLEAN
  AND :'p5f2_finish_replay_proposal_request_id' =
    :'p5f2_begin_proposal_request_id',
  'finish exact replay drifted'
);

\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_begin_proposal_request_id',
  'human_review',
  'provider_error',
  'Synthetic bounded Gemini prompt.',
  NULL,
  'transport_error',
  NULL
);
\set p5f2_finish_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT result.private_provider_status = 'completed'
    FROM platform_private.gemini_proposal_results AS result
    WHERE result.proposal_request_id = :'p5f2_begin_proposal_request_id'
  ),
  'proposal-ready provider completion evidence was not persisted privately'
);

-- Authenticated staff sees only the exact safe DTO.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f2_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(proposal.*)::TEXT AS p5f2_staff_json
FROM platform.staff_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b'
) AS proposal
\gset

SELECT pg_temp.assert_true(
  :'p5f2_staff_json'::JSONB ->> 'outcome' = 'proposal_ready'
  AND :'p5f2_staff_json'::JSONB ->> 'intent' = 'admissions_discovery'
  AND :'p5f2_staff_json'::JSONB ->> 'reply_text' =
    'Здравствуйте! Уточните, пожалуйста, ваш бюджет.'
  AND (:'p5f2_staff_json'::JSONB ->> 'human_review_required')::BOOLEAN
  AND NOT (:'p5f2_staff_json'::JSONB ->> 'autonomous_authority')::BOOLEAN
  AND :'p5f2_staff_json'::JSONB ->> 'provider_proof_state' = 'blocked'
  AND NOT :'p5f2_staff_json' ~
    'private|prompt|provider_interaction|response_json|sha256|waha|kommo|amocrm|phone|secret|token',
  'staff projection leaked private evidence or lost review-only state'
);

\set ON_ERROR_STOP off
SELECT * FROM platform.staff_gemini_proposal(
  :'p5f2_org_a',
  :'p5f2_conversation_a'
);
\set p5f2_cross_tenant_read_state :SQLSTATE
SELECT * FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic bounded Gemini prompt.',
  'synthetic-provider-interaction-ref',
  'completed',
  :'p5f2_valid_response'::JSONB
);
\set p5f2_authenticated_finish_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f2_cross_tenant_read_state' = '42501'
  AND :'p5f2_authenticated_finish_state' = '42501'
  AND :'p5f2_finish_mismatch_state' = '22023',
  'safe no-row, tenant or mutation authority drifted'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f2_admin_a_claims', true);
SELECT count(*)::TEXT AS p5f2_absent_count
FROM platform.staff_gemini_proposal(
  :'p5f2_org_a',
  :'p5f2_conversation_a'
)
\gset
SELECT pg_temp.assert_true(
  :'p5f2_absent_count' = '0',
  'conversation without a request did not return zero rows'
);
RESET ROLE;

-- A provider/configuration failure is durable but exposes only its bounded
-- failure code to staff; private prompt/response evidence stays private.
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"66000000-0000-4000-8000-000000000999","role":"service_role"}',
  true
);
SELECT *
FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000205',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
)
\gset p5f2_failure_begin_
\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_failure_begin_proposal_request_id',
  'human_review',
  'output_truncated',
  'Synthetic bounded failed prompt.',
  'synthetic-nonclean-interaction-ref',
  'unknown_status',
  '{"stage":"synthetic_provider_free_test"}'::JSONB
);
\set p5f2_invalid_provider_status_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT *
FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_failure_begin_proposal_request_id',
  'human_review',
  'output_truncated',
  'Synthetic bounded failed prompt.',
  'synthetic-nonclean-interaction-ref',
  'incomplete',
  '{"stage":"synthetic_provider_free_test"}'::JSONB
)
\gset p5f2_failure_finish_
SELECT pg_temp.assert_true(
  :'p5f2_failure_finish_outcome' = 'human_review'
  AND :'p5f2_failure_finish_failure_code' = 'output_truncated'
  AND :'p5f2_failure_finish_human_review_required'::BOOLEAN
  AND NOT :'p5f2_failure_finish_autonomous_authority'::BOOLEAN
  AND :'p5f2_failure_finish_provider_proof_state' = 'blocked',
  'provider failure did not finish as bounded human review'
);
\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  :'p5f2_failure_begin_proposal_request_id',
  'human_review',
  'output_truncated',
  'Synthetic bounded failed prompt.',
  'synthetic-nonclean-interaction-ref',
  'budget_exceeded',
  '{"stage":"synthetic_provider_free_test"}'::JSONB
);
\set p5f2_provider_status_conflict_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f2_invalid_provider_status_state' = '22023'
  AND :'p5f2_provider_status_conflict_state' = '22023'
  AND (
    SELECT result.private_provider_status = 'incomplete'
    FROM platform_private.gemini_proposal_results AS result
    WHERE result.proposal_request_id =
      :'p5f2_failure_begin_proposal_request_id'
  ),
  'invalid/non-clean provider status or replay conflict evidence drifted'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f2_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(proposal.*)::TEXT AS p5f2_failure_staff_json
FROM platform.staff_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b'
) AS proposal
\gset
SELECT pg_temp.assert_true(
  :'p5f2_failure_staff_json'::JSONB ->> 'outcome' = 'human_review'
  AND :'p5f2_failure_staff_json'::JSONB ->> 'failure_code' =
    'output_truncated'
  AND :'p5f2_failure_staff_json'::JSONB -> 'reply_text' = 'null'::JSONB
  AND NOT :'p5f2_failure_staff_json' ~
    'synthetic_provider_free_test|failed prompt|private_provider|provider_status|incomplete',
  'human-review staff projection exposed private failure evidence'
);
RESET ROLE;

-- A pending replay remains visibly review-only without exposing context.
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"66000000-0000-4000-8000-000000000999","role":"service_role"}',
  true
);
SELECT *
FROM platform.begin_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b',
  :'p5f2_source_b',
  '66000000-0000-4000-8000-000000000210',
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1'
)
\gset p5f2_pending_
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f2_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(proposal.*)::TEXT AS p5f2_pending_staff_json
FROM platform.staff_gemini_proposal(
  :'p5f2_org_b',
  :'p5f2_conversation_b'
) AS proposal
\gset
SELECT pg_temp.assert_true(
  :'p5f2_pending_staff_json'::JSONB -> 'outcome' = 'null'::JSONB
  AND :'p5f2_pending_staff_json'::JSONB -> 'reply_text' = 'null'::JSONB
  AND (:'p5f2_pending_staff_json'::JSONB ->> 'human_review_required')::BOOLEAN
  AND NOT (:'p5f2_pending_staff_json'::JSONB ->> 'autonomous_authority')::BOOLEAN
  AND :'p5f2_pending_staff_json'::JSONB ->> 'provider_proof_state' = 'blocked',
  'pending staff row was not safe and review-only'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT count(*)::TEXT FROM platform.manual_send_authorizations) =
    :'p5f2_manual_send_count_before'
  AND (SELECT count(*)::TEXT
       FROM platform_private.conversation_ai_memory_versions) =
    :'p5f2_memory_count_before',
  'P5F2 wrote send authority or durable memory'
);

-- Even the owner cannot mutate or truncate the append-only audit.
\set ON_ERROR_STOP off
UPDATE platform_private.gemini_proposal_requests
SET model_ref = model_ref
WHERE id = :'p5f2_begin_proposal_request_id';
\set p5f2_owner_update_state :SQLSTATE
DELETE FROM platform_private.gemini_proposal_results
WHERE proposal_request_id = :'p5f2_begin_proposal_request_id';
\set p5f2_owner_delete_state :SQLSTATE
TRUNCATE TABLE platform_private.gemini_proposal_requests;
\set p5f2_owner_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f2_owner_update_state' = '55000'
  AND :'p5f2_owner_delete_state' = '55000'
  AND :'p5f2_owner_truncate_state' = '55000',
  'append-only owner mutation guard drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform Gemini proposal RLS passed' AS result;
