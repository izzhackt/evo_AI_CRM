\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P5F1 acceptance is entirely synthetic inside disposable PostgreSQL. It
-- proves private durability, staff authority and honest degraded lexical
-- evidence. It does not call Gemini, ingest an embedding, send through WAHA,
-- write amoCRM or create autonomous-send authority.
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
    RAISE EXCEPTION 'P5F1 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Exact private object inventory, owner, forced RLS, zero policies and zero
-- direct browser/service privileges.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(relation.relname ORDER BY relation.relname)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relkind = 'r'
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
  ) = ARRAY[
    'ai_retrieval_evidence',
    'ai_retrieval_requests',
    'approved_knowledge_chunk_embeddings',
    'approved_knowledge_chunk_sets',
    'approved_knowledge_chunks',
    'conversation_ai_control_events',
    'conversation_ai_fact_versions',
    'conversation_ai_memory_versions',
    'conversation_ai_qualification_versions'
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
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
  ),
  'a P5F1 durable table escaped into the browser schema'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 9
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'postgres'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
  ),
  'private table owner, forced RLS or zero-policy contract drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    CROSS JOIN pg_catalog.unnest(ARRAY[
      'anon',
      'authenticated',
      'service_role',
      'supabase_auth_admin'
    ]::TEXT[]) AS checked_role(role_name)
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
      AND (
        pg_catalog.has_table_privilege(
          checked_role.role_name,
          relation.oid,
          'SELECT'
        )
        OR pg_catalog.has_table_privilege(
          checked_role.role_name,
          relation.oid,
          'INSERT'
        )
        OR pg_catalog.has_table_privilege(
          checked_role.role_name,
          relation.oid,
          'UPDATE'
        )
        OR pg_catalog.has_table_privilege(
          checked_role.role_name,
          relation.oid,
          'DELETE'
        )
        OR pg_catalog.has_table_privilege(
          checked_role.role_name,
          relation.oid,
          'TRUNCATE'
        )
      )
  ),
  'a browser or service role has direct P5F1 table authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_memory_fact_key'::REGTYPE
  ) = ARRAY[
    'preferred_country',
    'preferred_program',
    'budget_signal',
    'intake_target',
    'preferred_language',
    'urgency',
    'blockers',
    'promised_follow_up',
    'unanswered_questions'
  ]::NAME[]
  AND (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_memory_fact_status'::REGTYPE
  ) = ARRAY['active', 'retracted']::NAME[]
  AND (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_qualification_status'::REGTYPE
  ) = ARRAY[
    'collecting',
    'ready_for_staff_review',
    'staff_confirmed',
    'not_a_fit'
  ]::NAME[]
  AND (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_control_state'::REGTYPE
  ) = ARRAY['paused', 'staff_takeover', 'staff_only']::NAME[],
  'fact, qualification or control enum contract drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_retrieval_mode'::REGTYPE
  ) = ARRAY['lexical_preview', 'semantic']::NAME[]
  AND (
    SELECT pg_catalog.array_agg(label.enumlabel ORDER BY label.enumsortorder)
    FROM pg_catalog.pg_enum AS label
    WHERE label.enumtypid = 'platform.ai_retrieval_outcome'::REGTYPE
  ) = ARRAY['completed', 'no_match']::NAME[],
  'retrieval enum contract drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 18
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname = ANY(ARRAY[
        'ai_retrieval_evidence',
        'ai_retrieval_requests',
        'approved_knowledge_chunk_embeddings',
        'approved_knowledge_chunk_sets',
        'approved_knowledge_chunks',
        'conversation_ai_control_events',
        'conversation_ai_fact_versions',
        'conversation_ai_memory_versions',
        'conversation_ai_qualification_versions'
      ]::TEXT[])
      AND NOT trigger.tgisinternal
      AND trigger.tgname LIKE '%append_only%'
  ),
  'append-only trigger inventory drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      'platform_private.approved_knowledge_chunk_embeddings'::REGCLASS
      AND attribute.attname = 'embedding'
      AND NOT attribute.attisdropped
  ) = 'vector(1536)'
  AND (
    SELECT attribute.attgenerated = 's'
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      'platform_private.approved_knowledge_chunks'::REGCLASS
      AND attribute.attname = 'search_vector'
      AND NOT attribute.attisdropped
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes AS index_record
    WHERE index_record.schemaname = 'platform_private'
      AND index_record.tablename = 'approved_knowledge_chunks'
      AND index_record.indexdef ILIKE '%USING gin (search_vector)%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes AS index_record
    WHERE index_record.schemaname = 'platform_private'
      AND index_record.tablename =
        'approved_knowledge_chunk_embeddings'
      AND index_record.indexdef ILIKE '%hnsw%'
  ),
  'vector dimension, generated FTS, GIN or no-HNSW contract drifted'
);

-- Exact public routine inventory, definer/search-path hardening and narrow ACL.
SELECT pg_temp.assert_true(
  pg_catalog.to_regprocedure(
    'platform.staff_conversation_ai_memory(uuid,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.record_conversation_ai_memory(uuid,uuid,bigint,text,text,uuid,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.record_conversation_ai_fact(uuid,uuid,text,bigint,text,jsonb,uuid,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.record_conversation_ai_qualification(uuid,uuid,bigint,text,smallint,text[],text,uuid,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.set_conversation_ai_control(uuid,uuid,bigint,text,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.publish_approved_knowledge_chunk_set(uuid,uuid,text,jsonb,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.preview_approved_knowledge_lexical(uuid,uuid,text,integer,text,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.staff_ai_retrieval_evidence(uuid,uuid,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'platform.staff_ai_retrieval_capabilities(uuid,uuid)'
  ) IS NOT NULL,
  'public P5F1 RPC signature drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 9
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname = ANY(ARRAY[
        'preview_approved_knowledge_lexical',
        'publish_approved_knowledge_chunk_set',
        'record_conversation_ai_fact',
        'record_conversation_ai_memory',
        'record_conversation_ai_qualification',
        'set_conversation_ai_control',
        'staff_ai_retrieval_capabilities',
        'staff_ai_retrieval_evidence',
        'staff_conversation_ai_memory'
      ]::TEXT[])
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND (
        procedure.proname ILIKE '%embedding%'
        OR procedure.proname ILIKE '%semantic%'
        OR procedure.proname ILIKE '%provider%ingest%'
      )
  ),
  'P5F1 RPC search_path or no-provider/no-semantic surface drifted'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'platform.staff_conversation_ai_memory(uuid,uuid)',
      'platform.record_conversation_ai_memory(uuid,uuid,bigint,text,text,uuid,text,uuid)',
      'platform.record_conversation_ai_fact(uuid,uuid,text,bigint,text,jsonb,uuid,text,uuid)',
      'platform.record_conversation_ai_qualification(uuid,uuid,bigint,text,smallint,text[],text,uuid,text,uuid)',
      'platform.set_conversation_ai_control(uuid,uuid,bigint,text,text,uuid)',
      'platform.publish_approved_knowledge_chunk_set(uuid,uuid,text,jsonb,text,uuid)',
      'platform.preview_approved_knowledge_lexical(uuid,uuid,text,integer,text,uuid)',
      'platform.staff_ai_retrieval_evidence(uuid,uuid,uuid)',
      'platform.staff_ai_retrieval_capabilities(uuid,uuid)'
    ]::TEXT[]) AS signature(value)
    CROSS JOIN pg_catalog.unnest(ARRAY[
      'anon',
      'service_role',
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
      'platform.staff_conversation_ai_memory(uuid,uuid)',
      'platform.record_conversation_ai_memory(uuid,uuid,bigint,text,text,uuid,text,uuid)',
      'platform.record_conversation_ai_fact(uuid,uuid,text,bigint,text,jsonb,uuid,text,uuid)',
      'platform.record_conversation_ai_qualification(uuid,uuid,bigint,text,smallint,text[],text,uuid,text,uuid)',
      'platform.set_conversation_ai_control(uuid,uuid,bigint,text,text,uuid)',
      'platform.publish_approved_knowledge_chunk_set(uuid,uuid,text,jsonb,text,uuid)',
      'platform.preview_approved_knowledge_lexical(uuid,uuid,text,integer,text,uuid)',
      'platform.staff_ai_retrieval_evidence(uuid,uuid,uuid)',
      'platform.staff_ai_retrieval_capabilities(uuid,uuid)'
    ]::TEXT[]) AS signature(value)
    WHERE NOT pg_catalog.has_function_privilege(
      'authenticated',
      signature.value,
      'EXECUTE'
    )
  ),
  'public P5F1 RPC ACL drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(bundle.role ORDER BY bundle.role::TEXT) = ARRAY[
      'admin',
      'curator',
      'finance',
      'sales',
      'student'
    ]::platform.business_role[]
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 11
      AND bundle.status = 'published'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.permission_definitions AS permission
    WHERE permission.permission_key LIKE 'ai.memory.%'
      OR permission.permission_key LIKE 'ai.retrieval.%'
  )
  AND (
    SELECT count(*) = 4
    FROM platform.permission_definitions AS permission
    WHERE permission.permission_key IN (
      'communication.read.full',
      'ai.draft.review',
      'knowledge.read.approved',
      'knowledge.manage'
    )
  ),
  'canonical v11 bundles or reused P5F1 permissions drifted'
);

-- Resolve persistent synthetic P2F/P3C fixtures and live claims.
SELECT
  membership.organization_id AS p5f1_org_b,
  profile.access_version AS p5f1_admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.organization_id AS p5f1_org_a,
  profile.access_version AS p5f1_admin_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT student_case.id AS p5f1_org_b_case_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'p5f1_org_b'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT conversation.id AS p5f1_conversation_b
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'p5f1_org_b'
  AND conversation.student_case_id = :'p5f1_org_b_case_id'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT message.id AS p5f1_message_b
FROM platform.communication_messages AS message
WHERE message.organization_id = :'p5f1_org_b'
  AND message.conversation_id = :'p5f1_conversation_b'
  AND message.direction = 'inbound'
  AND message.waha_message_id = 'synthetic-waha-message-org-b-inbound'
ORDER BY message.created_at, message.id
LIMIT 1
\gset

SELECT
  knowledge.id AS p5f1_knowledge_b,
  knowledge.knowledge_key AS p5f1_knowledge_b_key,
  knowledge.version AS p5f1_knowledge_b_version,
  knowledge.title AS p5f1_knowledge_b_title,
  knowledge.content_text AS p5f1_knowledge_b_content,
  knowledge.content_sha256 AS p5f1_knowledge_b_sha
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'p5f1_org_b'
  AND knowledge.knowledge_key = 'synthetic.orgb.admissions.general'
  AND knowledge.status = 'approved'
ORDER BY knowledge.version DESC
LIMIT 1
\gset

SELECT
  conversation.id AS p5f1_conversation_a,
  message.id AS p5f1_message_a
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT source.id
  FROM platform.communication_messages AS source
  WHERE source.organization_id = conversation.organization_id
    AND source.conversation_id = conversation.id
    AND source.direction = 'inbound'
    AND source.waha_message_id = 'synthetic-waha-message-a-inbound'
  ORDER BY source.created_at, source.id
  LIMIT 1
) AS message ON TRUE
WHERE conversation.organization_id = :'p5f1_org_a'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS p5f1_curator_b_user,
  profile.access_version AS p5f1_curator_b_access_version
FROM platform.communication_conversations AS conversation
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = conversation.organization_id
  AND membership.id = conversation.current_curator_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE conversation.organization_id = :'p5f1_org_b'
  AND conversation.id = :'p5f1_conversation_b'
\gset

SELECT profile.access_version AS p5f1_finance_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000005'
\gset

SELECT profile.access_version AS p5f1_student_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset

SELECT
  knowledge.id AS p5f1_retired_knowledge_a,
  knowledge.content_text AS p5f1_retired_knowledge_a_content,
  knowledge.content_sha256 AS p5f1_retired_knowledge_a_sha
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'p5f1_org_a'
  AND knowledge.knowledge_key = 'synthetic.admissions.general'
  AND knowledge.status = 'retired'
ORDER BY knowledge.version
LIMIT 1
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5f1_admin_b_access_version'::BIGINT
)::TEXT AS p5f1_admin_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5f1_admin_a_access_version'::BIGINT
)::TEXT AS p5f1_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p5f1_curator_b_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'p5f1_curator_b_access_version'::BIGINT
)::TEXT AS p5f1_curator_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'p5f1_finance_a_access_version'::BIGINT
)::TEXT AS p5f1_finance_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'p5f1_student_a_access_version'::BIGINT
)::TEXT AS p5f1_student_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version',
    (:'p5f1_admin_b_access_version'::BIGINT - 1)
)::TEXT AS p5f1_stale_admin_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '65000000-0000-4000-8000-00000000ffff',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1
)::TEXT AS p5f1_no_membership_claims
\gset

SELECT pg_temp.assert_true(
  :'p5f1_message_b' <> ''
  AND :'p5f1_knowledge_b_content' =
    'Synthetic org B approved knowledge v1.',
  'persistent P5F1 fixture resolution drifted'
);

SELECT count(*)::TEXT AS p5f1_manual_send_count_before
FROM platform.manual_send_authorizations
\gset
SELECT count(*)::TEXT AS p5f1_ai_draft_count_before
FROM platform.ai_drafts
\gset
SELECT count(*)::TEXT AS p5f1_work_item_count_before
FROM platform_private.durable_work_items
\gset

SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;

SELECT pg_catalog.to_jsonb(memory)::TEXT AS p5f1_default_memory
FROM platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
) AS memory
\gset

SELECT pg_catalog.to_jsonb(capability)::TEXT AS p5f1_capabilities
FROM platform.staff_ai_retrieval_capabilities(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
) AS capability
\gset

RESET ROLE;

SELECT pg_temp.assert_true(
  (:'p5f1_default_memory'::JSONB ->> 'memory_version')::BIGINT = 0
  AND :'p5f1_default_memory'::JSONB -> 'memory_short_summary' = 'null'::JSONB
  AND :'p5f1_default_memory'::JSONB -> 'memory_long_summary' = 'null'::JSONB
  AND :'p5f1_default_memory'::JSONB -> 'facts' = '[]'::JSONB
  AND (:'p5f1_default_memory'::JSONB
    ->> 'qualification_version')::BIGINT = 0
  AND :'p5f1_default_memory'::JSONB
    ->> 'qualification_status' = 'collecting'
  AND (:'p5f1_default_memory'::JSONB
    ->> 'qualification_completeness')::INTEGER = 0
  AND pg_catalog.jsonb_array_length(
    :'p5f1_default_memory'::JSONB
      -> 'qualification_missing_fact_keys'
  ) = 9
  AND (:'p5f1_default_memory'::JSONB
    ->> 'control_version')::BIGINT = 0
  AND :'p5f1_default_memory'::JSONB ->> 'control_state' = 'paused'
  AND :'p5f1_default_memory'::JSONB
    ->> 'control_reason' = 'no_control_event'
  AND NOT (:'p5f1_default_memory'::JSONB
    ->> 'autonomous_authority')::BOOLEAN,
  'no-row memory/qualification/control defaults are not fail-closed'
);

SELECT pg_temp.assert_true(
  :'p5f1_default_memory'::JSONB - ARRAY[
    'conversation_id',
    'memory_version',
    'memory_short_summary',
    'memory_long_summary',
    'memory_source_message_id',
    'facts',
    'qualification_version',
    'qualification_status',
    'qualification_completeness',
    'qualification_missing_fact_keys',
    'qualification_notes',
    'qualification_source_message_id',
    'control_version',
    'control_state',
    'control_reason',
    'latest_retrieval_request_id',
    'latest_retrieval_outcome',
    'latest_retrieval_created_at',
    'autonomous_authority'
  ]::TEXT[] = '{}'::JSONB
  AND :'p5f1_default_memory' !~*
    '(waha|phone|kommo|amocrm|embedding|score|distance|query|chunk|secret|token)',
  'staff memory public shape leaked a private/provider field'
);

SELECT pg_temp.assert_true(
  :'p5f1_capabilities'::JSONB = pg_catalog.jsonb_build_object(
    'embedding_model', 'gemini-embedding-2',
    'embedding_dimensions', 1536,
    'provider_ingestion_enabled', FALSE,
    'semantic_retrieval_enabled', FALSE,
    'lexical_preview_enabled', TRUE,
    'lexical_preview_degraded', TRUE,
    'autonomous_authority', FALSE,
    'provider_proof_state', 'blocked'
  ),
  'fail-closed retrieval capabilities drifted'
);

SET request.jwt.claims TO :'p5f1_curator_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p5f1_assigned_curator_read_count
FROM platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
)
\gset
RESET ROLE;

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p5f1_admin_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
);
\set p5f1_cross_org_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p5f1_stale_admin_b_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
);
\set p5f1_stale_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p5f1_no_membership_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
);
\set p5f1_no_membership_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p5f1_finance_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_a',
  :'p5f1_conversation_a'
);
\set p5f1_finance_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p5f1_student_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_a',
  :'p5f1_conversation_a'
);
\set p5f1_student_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
);
\set p5f1_anon_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f1_assigned_curator_read_count' = '1'
  AND :'p5f1_cross_org_state' = '42501'
  AND :'p5f1_stale_state' = '42501'
  AND :'p5f1_no_membership_state' = '42501'
  AND :'p5f1_finance_state' = '42501'
  AND :'p5f1_student_state' = '42501'
  AND :'p5f1_anon_state' = '42501',
  'staff/cross-org/stale/no-membership/Finance/Student authority drifted'
);

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;
SELECT count(*)
FROM platform_private.conversation_ai_memory_versions;
\set p5f1_authenticated_private_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT count(*)
FROM platform_private.approved_knowledge_chunk_embeddings;
\set p5f1_service_private_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f1_authenticated_private_state' = '42501'
  AND :'p5f1_service_private_state' = '42501',
  'forced RLS/direct ACL containment failed for API roles'
);

-- Optimistic append/replay behavior for summary memory.
SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;
SELECT platform.record_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  0,
  'Synthetic admissions lead memory.',
  'Synthetic admissions lead memory with staff-reviewed durable context.',
  :'p5f1_message_b',
  'Record bounded synthetic P5F1 memory',
  '65000000-0000-4000-8000-000000000001'
)::TEXT AS p5f1_memory_first
\gset

SELECT platform.record_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  0,
  'Synthetic admissions lead memory.',
  'Synthetic admissions lead memory with staff-reviewed durable context.',
  :'p5f1_message_b',
  'Record bounded synthetic P5F1 memory',
  '65000000-0000-4000-8000-000000000001'
)::TEXT AS p5f1_memory_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.record_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  0,
  'Changed memory replay.',
  'Synthetic admissions lead memory with staff-reviewed durable context.',
  :'p5f1_message_b',
  'Record bounded synthetic P5F1 memory',
  '65000000-0000-4000-8000-000000000001'
);
\set p5f1_memory_replay_mismatch_state :SQLSTATE

SELECT platform.record_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  0,
  'Stale expected version.',
  'This independent request must fail its optimistic version check.',
  :'p5f1_message_b',
  'Reject stale synthetic memory',
  '65000000-0000-4000-8000-000000000002'
);
\set p5f1_memory_stale_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  'intake_target',
  0,
  'active',
  pg_catalog.to_jsonb('Fall 2027'::TEXT),
  :'p5f1_message_b',
  'Record exact synthetic intake target',
  '65000000-0000-4000-8000-000000000003'
)::TEXT AS p5f1_fact_first
\gset

SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  'intake_target',
  0,
  'active',
  pg_catalog.to_jsonb('Fall 2027'::TEXT),
  :'p5f1_message_b',
  'Record exact synthetic intake target',
  '65000000-0000-4000-8000-000000000003'
)::TEXT AS p5f1_fact_replay
\gset

SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  'blockers',
  0,
  'active',
  '["missing transcript", "language certificate pending"]'::JSONB,
  :'p5f1_message_b',
  'Record bounded synthetic blockers',
  '65000000-0000-4000-8000-000000000004'
)::TEXT AS p5f1_array_fact
\gset

\set ON_ERROR_STOP off
SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b', :'p5f1_conversation_b', 'country', 0, 'active',
  pg_catalog.to_jsonb('KG'::TEXT), :'p5f1_message_b',
  'Reject unknown fact key', '65000000-0000-4000-8000-000000000005'
);
\set p5f1_bad_fact_key_state :SQLSTATE
SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b', :'p5f1_conversation_b', 'blockers', 1, 'active',
  '{"unsafe":"object"}'::JSONB, :'p5f1_message_b',
  'Reject object fact value', '65000000-0000-4000-8000-000000000006'
);
\set p5f1_bad_fact_value_state :SQLSTATE
SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b', :'p5f1_conversation_b', 'intake_target', 0, 'active',
  pg_catalog.to_jsonb('Changed replay value'::TEXT), :'p5f1_message_b',
  'Record exact synthetic intake target',
  '65000000-0000-4000-8000-000000000003'
);
\set p5f1_fact_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.record_conversation_ai_fact(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  'intake_target',
  1,
  'retracted',
  NULL,
  :'p5f1_message_b',
  'Retract the synthetic intake target',
  '65000000-0000-4000-8000-000000000007'
)::TEXT AS p5f1_fact_retracted
\gset

SELECT platform.record_conversation_ai_qualification(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  0,
  'collecting',
  11,
  ARRAY[
    'preferred_country',
    'preferred_program',
    'budget_signal',
    'preferred_language',
    'urgency',
    'promised_follow_up',
    'unanswered_questions'
  ]::TEXT[],
  'Synthetic qualification is still collecting facts.',
  :'p5f1_message_b',
  'Record collecting synthetic qualification',
  '65000000-0000-4000-8000-000000000008'
)::TEXT AS p5f1_qualification_first
\gset

\set ON_ERROR_STOP off
SELECT platform.record_conversation_ai_qualification(
  :'p5f1_org_b', :'p5f1_conversation_b', 1,
  'staff_confirmed', 90, ARRAY[]::TEXT[],
  'Incomplete confirmation must fail.', :'p5f1_message_b',
  'Reject incomplete confirmation',
  '65000000-0000-4000-8000-000000000009'
);
\set p5f1_bad_confirmation_state :SQLSTATE
SELECT platform.record_conversation_ai_qualification(
  :'p5f1_org_b', :'p5f1_conversation_b', 0,
  'collecting', 12, ARRAY['preferred_country']::TEXT[],
  'Changed replay.', :'p5f1_message_b',
  'Record collecting synthetic qualification',
  '65000000-0000-4000-8000-000000000008'
);
\set p5f1_qualification_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.record_conversation_ai_qualification(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  1,
  'staff_confirmed',
  100,
  ARRAY[]::TEXT[],
  'Staff confirmed the bounded synthetic assessment.',
  :'p5f1_message_b',
  'Confirm bounded synthetic qualification',
  '65000000-0000-4000-8000-000000000010'
)::TEXT AS p5f1_qualification_confirmed
\gset

SELECT platform.set_conversation_ai_control(
  :'p5f1_org_b', :'p5f1_conversation_b', 0, 'paused',
  'Keep synthetic conversation paused',
  '65000000-0000-4000-8000-000000000011'
)::TEXT AS p5f1_control_paused
\gset
SELECT platform.set_conversation_ai_control(
  :'p5f1_org_b', :'p5f1_conversation_b', 1, 'staff_takeover',
  'Assigned staff takes over synthetic conversation',
  '65000000-0000-4000-8000-000000000012'
)::TEXT AS p5f1_control_takeover
\gset
SELECT platform.set_conversation_ai_control(
  :'p5f1_org_b', :'p5f1_conversation_b', 2, 'staff_only',
  'Return synthetic conversation to staff-only handling',
  '65000000-0000-4000-8000-000000000013'
)::TEXT AS p5f1_control_staff_only
\gset

SELECT pg_catalog.to_jsonb(memory)::TEXT AS p5f1_recorded_memory
FROM platform.staff_conversation_ai_memory(
  :'p5f1_org_b',
  :'p5f1_conversation_b'
) AS memory
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f1_memory_first'::JSONB = :'p5f1_memory_replay'::JSONB
  AND (:'p5f1_memory_first'::JSONB ->> 'version')::BIGINT = 1
  AND :'p5f1_memory_replay_mismatch_state' = '22023'
  AND :'p5f1_memory_stale_state' = '40001'
  AND :'p5f1_fact_first'::JSONB = :'p5f1_fact_replay'::JSONB
  AND :'p5f1_bad_fact_key_state' = '22023'
  AND :'p5f1_bad_fact_value_state' = '22023'
  AND :'p5f1_fact_replay_mismatch_state' = '22023'
  AND :'p5f1_bad_confirmation_state' = '22023'
  AND :'p5f1_qualification_replay_mismatch_state' = '22023',
  'memory/fact/qualification optimistic replay or validation drifted'
);

SELECT pg_temp.assert_true(
  (:'p5f1_recorded_memory'::JSONB ->> 'memory_version')::BIGINT = 1
  AND :'p5f1_recorded_memory'::JSONB
    ->> 'memory_source_message_id' = :'p5f1_message_b'
  AND (:'p5f1_recorded_memory'::JSONB
    ->> 'qualification_version')::BIGINT = 2
  AND :'p5f1_recorded_memory'::JSONB
    ->> 'qualification_status' = 'staff_confirmed'
  AND (:'p5f1_recorded_memory'::JSONB
    ->> 'qualification_completeness')::INTEGER = 100
  AND (:'p5f1_recorded_memory'::JSONB
    ->> 'control_version')::BIGINT = 3
  AND :'p5f1_recorded_memory'::JSONB
    ->> 'control_state' = 'staff_only'
  AND NOT (:'p5f1_recorded_memory'::JSONB
    ->> 'autonomous_authority')::BOOLEAN
  AND NOT (:'p5f1_control_paused'::JSONB
    ->> 'autonomous_authority')::BOOLEAN
  AND NOT (:'p5f1_control_takeover'::JSONB
    ->> 'autonomous_authority')::BOOLEAN
  AND NOT (:'p5f1_control_staff_only'::JSONB
    ->> 'autonomous_authority')::BOOLEAN,
  'durable memory/qualification/control projection drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
      AND pg_catalog.bool_and(
        item.value - ARRAY[
          'fact_key',
          'status',
          'value',
          'version',
          'source_message_id',
          'created_at'
        ]::TEXT[] = '{}'::JSONB
      )
    FROM pg_catalog.jsonb_array_elements(
      :'p5f1_recorded_memory'::JSONB -> 'facts'
    ) AS item(value)
  )
  AND (
    SELECT fact.value -> 'value' = 'null'::JSONB
      AND fact.value ->> 'status' = 'retracted'
      AND (fact.value ->> 'version')::BIGINT = 2
    FROM pg_catalog.jsonb_array_elements(
      :'p5f1_recorded_memory'::JSONB -> 'facts'
    ) AS fact(value)
    WHERE fact.value ->> 'fact_key' = 'intake_target'
  ),
  'safe current fact shape/retraction drifted'
);

-- Admin-only literal approved-text chunk publication. The payload contains no
-- embedding and can create only an immutable lexical chunk set.
SELECT pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object(
    'chunk_index', 0,
    'start_offset', 0,
    'end_offset', pg_catalog.char_length(:'p5f1_knowledge_b_content'),
    'content_text', :'p5f1_knowledge_b_content',
    'content_sha256', :'p5f1_knowledge_b_sha'
  )
)::TEXT AS p5f1_chunks_b
\gset

SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;
SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b',
  :'p5f1_knowledge_b',
  'literal-v1',
  :'p5f1_chunks_b'::JSONB,
  'Publish exact synthetic approved-text chunks',
  '65000000-0000-4000-8000-000000000014'
)::TEXT AS p5f1_chunk_set_first
\gset
SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b',
  :'p5f1_knowledge_b',
  'literal-v1',
  :'p5f1_chunks_b'::JSONB,
  'Publish exact synthetic approved-text chunks',
  '65000000-0000-4000-8000-000000000014'
)::TEXT AS p5f1_chunk_set_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b', :'p5f1_knowledge_b', 'changed-v1',
  :'p5f1_chunks_b'::JSONB,
  'Publish exact synthetic approved-text chunks',
  '65000000-0000-4000-8000-000000000014'
);
\set p5f1_chunk_replay_mismatch_state :SQLSTATE

SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b',
  :'p5f1_knowledge_b',
  'literal-v2',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'chunk_index', 0,
      'start_offset', 0,
      'end_offset', 13,
      'content_text', 'Invented text',
      'content_sha256', pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to('Invented text', 'UTF8')
        ),
        'hex'
      )
    )
  ),
  'Reject invented chunk text',
  '65000000-0000-4000-8000-000000000015'
);
\set p5f1_invented_chunk_state :SQLSTATE

SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b',
  :'p5f1_knowledge_b',
  'literal-v2',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'chunk_index', 0,
      'start_offset', 0,
      'end_offset', pg_catalog.char_length(:'p5f1_knowledge_b_content'),
      'content_text', :'p5f1_knowledge_b_content',
      'content_sha256', pg_catalog.repeat('0', 64)
    )
  ),
  'Reject mismatched chunk hash',
  '65000000-0000-4000-8000-000000000016'
);
\set p5f1_bad_chunk_hash_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p5f1_curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b', :'p5f1_knowledge_b', 'literal-v2',
  :'p5f1_chunks_b'::JSONB,
  'Curator must not publish chunks',
  '65000000-0000-4000-8000-000000000017'
);
\set p5f1_curator_chunk_publish_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p5f1_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_b', :'p5f1_knowledge_b', 'literal-v2',
  :'p5f1_chunks_b'::JSONB,
  'Cross-organization Admin must not publish chunks',
  '65000000-0000-4000-8000-000000000018'
);
\set p5f1_cross_org_chunk_publish_state :SQLSTATE

SELECT platform.publish_approved_knowledge_chunk_set(
  :'p5f1_org_a',
  :'p5f1_retired_knowledge_a',
  'literal-v1',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'chunk_index', 0,
      'start_offset', 0,
      'end_offset',
        pg_catalog.char_length(:'p5f1_retired_knowledge_a_content'),
      'content_text', :'p5f1_retired_knowledge_a_content',
      'content_sha256', :'p5f1_retired_knowledge_a_sha'
    )
  ),
  'Retired approved text must not receive chunks',
  '65000000-0000-4000-8000-000000000019'
);
\set p5f1_retired_chunk_publish_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f1_chunk_set_first'::JSONB = :'p5f1_chunk_set_replay'::JSONB
  AND (:'p5f1_chunk_set_first'::JSONB
    ->> 'chunk_count')::INTEGER = 1
  AND :'p5f1_chunk_replay_mismatch_state' = '22023'
  AND :'p5f1_invented_chunk_state' = '22023'
  AND :'p5f1_bad_chunk_hash_state' = '22023'
  AND :'p5f1_curator_chunk_publish_state' = '42501'
  AND :'p5f1_cross_org_chunk_publish_state' = '42501'
  AND :'p5f1_retired_chunk_publish_state' = '42501'
  AND (
    SELECT count(*) = 1
      AND pg_catalog.bool_and(
        chunk.content_text = :'p5f1_knowledge_b_content'
        AND chunk.start_offset = 0
        AND chunk.end_offset =
          pg_catalog.char_length(:'p5f1_knowledge_b_content')
        AND chunk.content_sha256 = :'p5f1_knowledge_b_sha'
      )
    FROM platform_private.approved_knowledge_chunks AS chunk
    WHERE chunk.organization_id = :'p5f1_org_b'
      AND chunk.knowledge_version_id = :'p5f1_knowledge_b'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.approved_knowledge_chunk_embeddings
  ),
  'literal chunk publication, denial or embedding-empty contract drifted'
);

-- Exact-message degraded lexical preview. OR-of-simple lexemes makes the
-- deterministic synthetic shared term sufficient without accepting browser
-- raw query text.
SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;
SELECT pg_catalog.to_jsonb(preview)::TEXT AS p5f1_preview_first
FROM platform.preview_approved_knowledge_lexical(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  :'p5f1_message_b',
  5,
  'Preview exact-message degraded lexical evidence',
  '65000000-0000-4000-8000-000000000020'
) AS preview
\gset

SELECT pg_catalog.to_jsonb(preview)::TEXT AS p5f1_preview_replay
FROM platform.preview_approved_knowledge_lexical(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  :'p5f1_message_b',
  5,
  'Preview exact-message degraded lexical evidence',
  '65000000-0000-4000-8000-000000000020'
) AS preview
\gset

SELECT pg_catalog.to_jsonb(evidence)::TEXT AS p5f1_evidence_read
FROM platform.staff_ai_retrieval_evidence(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  (:'p5f1_preview_first'::JSONB ->> 'retrieval_request_id')::UUID
) AS evidence
\gset

-- A later approval for the same knowledge key must not make the immutable
-- evidence row re-resolve to the latest version or collapse to nulls.
RESET ROLE;
SELECT pg_catalog.coalesce(pg_catalog.max(knowledge.version), 0) + 1
  AS p5f1_newer_knowledge_b_version
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'p5f1_org_b'
  AND knowledge.knowledge_key = :'p5f1_knowledge_b_key'
\gset

SET request.jwt.claims TO :'p5f1_admin_b_claims';
SET ROLE authenticated;
SELECT platform.publish_approved_knowledge_version(
  :'p5f1_org_b',
  :'p5f1_knowledge_b_key',
  'Synthetic org B approved knowledge newer version',
  :'p5f1_newer_knowledge_b_version'::BIGINT,
  'Synthetic org B approved knowledge newer version.',
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'Synthetic org B approved knowledge newer version.',
        'UTF8'
      )
    ),
    'hex'
  ),
  'synthetic:test:p5f1:newer-approved-version',
  'Approve a newer version to preserve historical retrieval evidence',
  '65000000-0000-4000-8000-000000000023'
)::TEXT AS p5f1_newer_knowledge_b_publish
\gset

SELECT pg_catalog.to_jsonb(evidence)::TEXT
  AS p5f1_evidence_after_newer_approval
FROM platform.staff_ai_retrieval_evidence(
  :'p5f1_org_b',
  :'p5f1_conversation_b',
  (:'p5f1_preview_first'::JSONB ->> 'retrieval_request_id')::UUID
) AS evidence
\gset

\set ON_ERROR_STOP off
SELECT platform.preview_approved_knowledge_lexical(
  :'p5f1_org_b', :'p5f1_conversation_b', :'p5f1_message_b', 4,
  'Preview exact-message degraded lexical evidence',
  '65000000-0000-4000-8000-000000000020'
);
\set p5f1_preview_replay_mismatch_state :SQLSTATE
SELECT platform.preview_approved_knowledge_lexical(
  :'p5f1_org_b', :'p5f1_conversation_b',
  'raw browser query text', 5,
  'Reject arbitrary raw query text',
  '65000000-0000-4000-8000-000000000021'
);
\set p5f1_raw_query_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p5f1_admin_a_claims';
SET ROLE authenticated;
SELECT pg_catalog.to_jsonb(preview)::TEXT AS p5f1_no_match_preview
FROM platform.preview_approved_knowledge_lexical(
  :'p5f1_org_a',
  :'p5f1_conversation_a',
  :'p5f1_message_a',
  5,
  'Prove deterministic current-organization no match',
  '65000000-0000-4000-8000-000000000022'
) AS preview
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f1_preview_first'::JSONB = :'p5f1_preview_replay'::JSONB
  AND :'p5f1_preview_first'::JSONB = :'p5f1_evidence_read'::JSONB
  AND :'p5f1_preview_first'::JSONB =
    :'p5f1_evidence_after_newer_approval'::JSONB
  AND :'p5f1_newer_knowledge_b_publish'::JSONB ->> 'status' = 'approved'
  AND (:'p5f1_newer_knowledge_b_publish'::JSONB
    ->> 'version')::BIGINT = :'p5f1_newer_knowledge_b_version'::BIGINT
  AND :'p5f1_newer_knowledge_b_version'::BIGINT >
    :'p5f1_knowledge_b_version'::BIGINT
  AND :'p5f1_preview_first'::JSONB ->> 'retrieval_mode' =
    'lexical_preview'
  AND :'p5f1_preview_first'::JSONB ->> 'retrieval_outcome' = 'completed'
  AND (:'p5f1_preview_first'::JSONB ->> 'degraded')::BOOLEAN
  AND :'p5f1_preview_first'::JSONB ->> 'provider_proof_state' = 'blocked'
  AND NOT (:'p5f1_preview_first'::JSONB
    ->> 'autonomous_authority')::BOOLEAN
  AND :'p5f1_preview_first'::JSONB ->> 'source_message_id' =
    :'p5f1_message_b'
  AND :'p5f1_preview_first'::JSONB ->> 'knowledge_key' =
    :'p5f1_knowledge_b_key'
  AND (:'p5f1_preview_first'::JSONB
    ->> 'knowledge_version')::BIGINT = :'p5f1_knowledge_b_version'::BIGINT
  AND :'p5f1_preview_first'::JSONB ->> 'knowledge_title' =
    :'p5f1_knowledge_b_title'
  AND (:'p5f1_preview_first'::JSONB
    ->> 'evidence_ordinal')::INTEGER = 1
  AND :'p5f1_preview_replay_mismatch_state' = '22023'
  AND :'p5f1_raw_query_state' = '22023',
  'lexical preview/evidence/replay contract drifted'
);

SELECT pg_temp.assert_true(
  :'p5f1_no_match_preview'::JSONB
    ->> 'retrieval_mode' = 'lexical_preview'
  AND :'p5f1_no_match_preview'::JSONB
    ->> 'retrieval_outcome' = 'no_match'
  AND (:'p5f1_no_match_preview'::JSONB ->> 'degraded')::BOOLEAN
  AND :'p5f1_no_match_preview'::JSONB
    ->> 'provider_proof_state' = 'blocked'
  AND NOT (:'p5f1_no_match_preview'::JSONB
    ->> 'autonomous_authority')::BOOLEAN
  AND :'p5f1_no_match_preview'::JSONB -> 'knowledge_key' = 'null'::JSONB
  AND :'p5f1_no_match_preview'::JSONB
    -> 'evidence_ordinal' = 'null'::JSONB,
  'deterministic no-match row is not explicit and fail-closed'
);

SELECT pg_temp.assert_true(
  :'p5f1_preview_first'::JSONB - ARRAY[
    'retrieval_request_id',
    'source_message_id',
    'retrieval_mode',
    'retrieval_outcome',
    'degraded',
    'provider_proof_state',
    'autonomous_authority',
    'knowledge_key',
    'knowledge_version',
    'knowledge_title',
    'evidence_ordinal',
    'created_at'
  ]::TEXT[] = '{}'::JSONB
  AND NOT (:'p5f1_preview_first'::JSONB ? 'knowledge_version_id')
  AND :'p5f1_preview_first' !~*
    '(waha|phone|kommo|amocrm|embedding|score|distance|query|hash|chunk|secret|token)',
  'retrieval public result leaked a private/provider field'
);

-- Retrieval is evidence only: no provider observation, embedding, AI draft,
-- outbox work or manual-send authority is created.
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
      AND pg_catalog.bool_and(request.mode = 'lexical_preview')
      AND pg_catalog.bool_and(request.degraded)
      AND pg_catalog.bool_and(NOT request.autonomous_authority)
    FROM platform_private.ai_retrieval_requests AS request
    WHERE request.request_id IN (
      '65000000-0000-4000-8000-000000000020',
      '65000000-0000-4000-8000-000000000022'
    )
  )
  AND (
    SELECT count(*) = 1
    FROM platform_private.ai_retrieval_evidence AS evidence
    WHERE evidence.retrieval_request_id =
      (:'p5f1_preview_first'::JSONB ->> 'retrieval_request_id')::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.approved_knowledge_chunk_embeddings
  )
  AND (
    SELECT count(*)::TEXT FROM platform.manual_send_authorizations
  ) = :'p5f1_manual_send_count_before'
  AND (
    SELECT count(*)::TEXT FROM platform.ai_drafts
  ) = :'p5f1_ai_draft_count_before'
  AND (
    SELECT count(*)::TEXT FROM platform_private.durable_work_items
  ) = :'p5f1_work_item_count_before'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000003',
      '65000000-0000-4000-8000-000000000004',
      '65000000-0000-4000-8000-000000000007',
      '65000000-0000-4000-8000-000000000008',
      '65000000-0000-4000-8000-000000000010',
      '65000000-0000-4000-8000-000000000011',
      '65000000-0000-4000-8000-000000000012',
      '65000000-0000-4000-8000-000000000013',
      '65000000-0000-4000-8000-000000000014',
      '65000000-0000-4000-8000-000000000020',
      '65000000-0000-4000-8000-000000000022'
    )
      AND audit.action NOT IN (
        'ai.memory.record',
        'ai.fact.record',
        'ai.qualification.record',
        'ai.control.set',
        'knowledge.chunkset.publish',
        'ai.retrieval.preview'
      )
  ),
  'P5F1 unexpectedly created provider/send/draft/work authority'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000003',
      '65000000-0000-4000-8000-000000000004',
      '65000000-0000-4000-8000-000000000007',
      '65000000-0000-4000-8000-000000000008',
      '65000000-0000-4000-8000-000000000010',
      '65000000-0000-4000-8000-000000000014',
      '65000000-0000-4000-8000-000000000020',
      '65000000-0000-4000-8000-000000000022'
    )
      AND (
        COALESCE(audit.before_state::TEXT, '')
          || audit.after_state::TEXT
      ) ~* (
        'Synthetic admissions lead memory with|Fall 2027|missing transcript|'
        || 'Synthetic org B approved knowledge v1|query_sha256|content_text|'
        || 'fact_value|provider_evidence_ref'
      )
  ),
  'audit metadata contains raw memory/fact/query/chunk/provider content'
);

-- Owner-level mutation attempts prove immutable versions/evidence. API roles
-- were already denied before reaching these triggers.
\set ON_ERROR_STOP off
UPDATE platform_private.conversation_ai_memory_versions
SET short_summary = 'Forbidden rewrite'
WHERE request_id = '65000000-0000-4000-8000-000000000001';
\set p5f1_owner_update_state :SQLSTATE
DELETE FROM platform_private.ai_retrieval_evidence
WHERE retrieval_request_id =
  (:'p5f1_preview_first'::JSONB ->> 'retrieval_request_id')::UUID;
\set p5f1_owner_delete_state :SQLSTATE
TRUNCATE TABLE platform_private.approved_knowledge_chunks;
\set p5f1_owner_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5f1_owner_update_state' = '55000'
  AND :'p5f1_owner_delete_state' = '55000'
  AND :'p5f1_owner_truncate_state' = '55000',
  'append-only owner mutation guard drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform AI memory and retrieval RLS passed' AS result;
