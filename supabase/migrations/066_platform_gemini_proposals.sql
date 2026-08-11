-- ============================================================
-- 066_platform_gemini_proposals.sql
--
-- P5F2: a private, append-only audit for stateless Gemini proposal
-- generation. Gemini remains a proposal component only: this migration
-- grants no send, memory-write, amoCRM-write or autonomous authority.
-- ============================================================

BEGIN;

CREATE TYPE platform.gemini_proposal_outcome AS ENUM (
  'proposal_ready',
  'human_review'
);

CREATE OR REPLACE FUNCTION
platform_private.gemini_proposal_failure_code_is_valid(
  p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(p_value IN (
    'configuration_missing',
    'provider_timeout',
    'provider_rate_limited',
    'provider_authentication_failed',
    'provider_unavailable',
    'provider_rejected',
    'provider_error',
    'empty_response',
    'output_truncated',
    'malformed_response',
    'unsupported_language',
    'invalid_proposal',
    'missing_evidence',
    'unsafe_semantics'
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION
platform_private.gemini_proposal_provider_status_is_valid(
  p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(p_value IN (
    'in_progress',
    'requires_action',
    'completed',
    'failed',
    'cancelled',
    'incomplete',
    'budget_exceeded',
    'not_called',
    'local_error',
    'configuration_error',
    'transport_error'
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION
platform_private.gemini_proposal_response_is_valid(
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  item JSONB;
  item_text TEXT;
  seen TEXT[] := ARRAY[]::TEXT[];
  allowed_fact_keys CONSTANT TEXT[] := ARRAY[
    'preferred_country',
    'preferred_program',
    'budget_signal',
    'intake_target',
    'preferred_language',
    'urgency',
    'blockers',
    'promised_follow_up',
    'unanswered_questions'
  ];
  allowed_handoff_reasons CONSTANT TEXT[] := ARRAY[
    'unsupported_language',
    'missing_evidence',
    'low_confidence',
    'complaint_or_anger',
    'payment_or_refund_or_price_exception',
    'legal_or_privacy',
    'guarantee_request',
    'opt_out',
    'unsafe_content',
    'ambiguous_request',
    'staff_takeover',
    'media_only'
  ];
BEGIN
  IF p_value IS NULL
    OR pg_catalog.jsonb_typeof(p_value) <> 'object'
    OR NOT p_value ?& ARRAY[
      'schema_version',
      'language',
      'intent',
      'confidence',
      'risk',
      'handoff_required',
      'handoff_reasons',
      'citations',
      'memory_changes',
      'qualification',
      'reply_text'
    ]
    OR p_value - ARRAY[
      'schema_version',
      'language',
      'intent',
      'confidence',
      'risk',
      'handoff_required',
      'handoff_reasons',
      'citations',
      'memory_changes',
      'qualification',
      'reply_text'
    ] <> '{}'::JSONB
    OR pg_catalog.jsonb_typeof(p_value -> 'schema_version') <> 'number'
    OR p_value ->> 'schema_version' <> '1'
    OR p_value ->> 'language' NOT IN ('ru', 'en')
    OR p_value ->> 'intent' NOT IN (
      'greeting',
      'admissions_discovery',
      'program_or_country',
      'documents',
      'deadline',
      'pricing_or_payment',
      'visa',
      'scholarship',
      'complaint',
      'opt_out',
      'other'
    )
    OR pg_catalog.jsonb_typeof(p_value -> 'confidence') <> 'number'
    OR p_value ->> 'confidence' !~ '^[0-9]{1,3}$'
    OR (p_value ->> 'confidence')::INTEGER NOT BETWEEN 0 AND 100
    OR p_value ->> 'risk' NOT IN ('low', 'medium', 'high')
    OR pg_catalog.jsonb_typeof(p_value -> 'handoff_required') <> 'boolean'
    OR pg_catalog.jsonb_typeof(p_value -> 'handoff_reasons') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value -> 'handoff_reasons') > 8
    OR (
      p_value -> 'handoff_required' = 'false'::JSONB
      AND pg_catalog.jsonb_array_length(p_value -> 'handoff_reasons') <> 0
    )
    OR (
      p_value -> 'handoff_required' = 'true'::JSONB
      AND pg_catalog.jsonb_array_length(p_value -> 'handoff_reasons') = 0
    )
    OR pg_catalog.jsonb_typeof(p_value -> 'citations') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value -> 'citations') > 6
    OR pg_catalog.jsonb_typeof(p_value -> 'memory_changes') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value -> 'memory_changes') > 9
    OR pg_catalog.jsonb_typeof(p_value -> 'qualification') <> 'object'
    OR pg_catalog.jsonb_typeof(p_value -> 'reply_text') <> 'string'
    OR p_value ->> 'reply_text' <> pg_catalog.btrim(p_value ->> 'reply_text')
    OR pg_catalog.char_length(p_value ->> 'reply_text') NOT BETWEEN 1 AND 2000
  THEN
    RETURN FALSE;
  END IF;

  seen := ARRAY[]::TEXT[];
  FOR item IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_value -> 'handoff_reasons')
  LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'string' THEN
      RETURN FALSE;
    END IF;
    item_text := item #>> '{}';
    IF NOT item_text = ANY(allowed_handoff_reasons)
      OR item_text = ANY(seen)
    THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(seen, item_text);
  END LOOP;

  seen := ARRAY[]::TEXT[];
  FOR item IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_value -> 'citations')
  LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'object'
      OR NOT item ?& ARRAY[
        'knowledge_key',
        'knowledge_version',
        'evidence_ordinal'
      ]
      OR item - ARRAY[
        'knowledge_key',
        'knowledge_version',
        'evidence_ordinal'
      ] <> '{}'::JSONB
      OR item ->> 'knowledge_key' !~ '^[a-z][a-z0-9_.-]*$'
      OR pg_catalog.jsonb_typeof(item -> 'knowledge_version') <> 'number'
      OR item ->> 'knowledge_version' !~ '^[1-9][0-9]*$'
      OR pg_catalog.jsonb_typeof(item -> 'evidence_ordinal') <> 'number'
      OR item ->> 'evidence_ordinal' !~ '^[1-9][0-9]*$'
      OR (item ->> 'evidence_ordinal')::INTEGER NOT BETWEEN 1 AND 10
      OR (
        (item ->> 'knowledge_key')
          || ':' || (item ->> 'knowledge_version')
          || ':' || (item ->> 'evidence_ordinal')
      ) = ANY(seen)
    THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(
      seen,
      (item ->> 'knowledge_key')
        || ':' || (item ->> 'knowledge_version')
        || ':' || (item ->> 'evidence_ordinal')
    );
  END LOOP;

  seen := ARRAY[]::TEXT[];
  FOR item IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_value -> 'memory_changes')
  LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'object'
      OR NOT item ?& ARRAY['fact_key', 'action', 'value', 'confidence']
      OR item - ARRAY['fact_key', 'action', 'value', 'confidence']
        <> '{}'::JSONB
      OR NOT (item ->> 'fact_key') = ANY(allowed_fact_keys)
      OR (item ->> 'fact_key') = ANY(seen)
      OR item ->> 'action' NOT IN ('set', 'clear')
      OR pg_catalog.jsonb_typeof(item -> 'confidence') <> 'number'
      OR item ->> 'confidence' !~ '^[0-9]{1,3}$'
      OR (item ->> 'confidence')::INTEGER NOT BETWEEN 0 AND 100
      OR (
        item ->> 'action' = 'set'
        AND (
          pg_catalog.jsonb_typeof(item -> 'value') <> 'string'
          OR item ->> 'value' <> pg_catalog.btrim(item ->> 'value')
          OR pg_catalog.char_length(item ->> 'value') NOT BETWEEN 1 AND 500
        )
      )
      OR (
        item ->> 'action' = 'clear'
        AND pg_catalog.jsonb_typeof(item -> 'value') <> 'null'
      )
    THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(seen, item ->> 'fact_key');
  END LOOP;

  item := p_value -> 'qualification';
  IF NOT item ?& ARRAY[
      'status',
      'completeness',
      'missing_fact_keys',
      'notes'
    ]
    OR item - ARRAY[
      'status',
      'completeness',
      'missing_fact_keys',
      'notes'
    ] <> '{}'::JSONB
    OR item ->> 'status' NOT IN (
      'collecting',
      'ready_for_staff_review',
      'not_a_fit'
    )
    OR pg_catalog.jsonb_typeof(item -> 'completeness') <> 'number'
    OR item ->> 'completeness' !~ '^[0-9]{1,3}$'
    OR (item ->> 'completeness')::INTEGER NOT BETWEEN 0 AND 100
    OR pg_catalog.jsonb_typeof(item -> 'missing_fact_keys') <> 'array'
    OR pg_catalog.jsonb_array_length(item -> 'missing_fact_keys') > 9
    OR (
      pg_catalog.jsonb_typeof(item -> 'notes') NOT IN ('string', 'null')
      OR (
        pg_catalog.jsonb_typeof(item -> 'notes') = 'string'
        AND (
          item ->> 'notes' <> pg_catalog.btrim(item ->> 'notes')
          OR pg_catalog.char_length(item ->> 'notes') NOT BETWEEN 1 AND 1000
        )
      )
    )
  THEN
    RETURN FALSE;
  END IF;

  seen := ARRAY[]::TEXT[];
  FOR item IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(
      p_value -> 'qualification' -> 'missing_fact_keys'
    )
  LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'string' THEN
      RETURN FALSE;
    END IF;
    item_text := item #>> '{}';
    IF NOT item_text = ANY(allowed_fact_keys)
      OR item_text = ANY(seen)
    THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(seen, item_text);
  END LOOP;

  RETURN TRUE;
END
$$;

CREATE TABLE platform_private.gemini_proposal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  model_ref TEXT NOT NULL CHECK (model_ref = 'gemini-3.5-flash'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  prompt_policy_version TEXT NOT NULL CHECK (
    prompt_policy_version = 'p5f2-gemini-proposal-v1'
  ),
  private_context JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(private_context) = 'object'
    AND pg_catalog.char_length(private_context::TEXT) <= 65536
  ),
  context_sha256 TEXT NOT NULL CHECK (
    context_sha256 = platform_private.ai_memory_json_sha256(private_context)
  ),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  human_review_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (
    human_review_required = TRUE
  ),
  autonomous_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    autonomous_authority = FALSE
  ),
  provider_proof_state TEXT NOT NULL DEFAULT 'blocked' CHECK (
    provider_proof_state = 'blocked'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT gemini_proposal_requests_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT gemini_proposal_requests_provenance_key
    UNIQUE (organization_id, id, conversation_id, source_message_id),
  CONSTRAINT gemini_proposal_requests_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_requests_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX gemini_proposal_requests_latest_idx
  ON platform_private.gemini_proposal_requests (
    organization_id,
    conversation_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE platform_private.gemini_proposal_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  proposal_request_id UUID NOT NULL,
  outcome platform.gemini_proposal_outcome NOT NULL,
  failure_code TEXT CHECK (
    failure_code IS NULL
    OR platform_private.gemini_proposal_failure_code_is_valid(failure_code)
  ),
  private_prompt_text TEXT NOT NULL CHECK (
    private_prompt_text = pg_catalog.btrim(private_prompt_text)
    AND pg_catalog.char_length(private_prompt_text) BETWEEN 1 AND 65536
  ),
  prompt_sha256 TEXT NOT NULL CHECK (
    prompt_sha256 = platform_private.ai_memory_text_sha256(private_prompt_text)
  ),
  private_provider_interaction_ref TEXT CHECK (
    private_provider_interaction_ref IS NULL
    OR (
      private_provider_interaction_ref =
        pg_catalog.btrim(private_provider_interaction_ref)
      AND pg_catalog.char_length(private_provider_interaction_ref)
        BETWEEN 1 AND 255
    )
  ),
  private_provider_status TEXT NOT NULL CHECK (
    platform_private.gemini_proposal_provider_status_is_valid(
      private_provider_status
    )
  ),
  private_response_json JSONB,
  response_sha256 TEXT NOT NULL CHECK (
    response_sha256 = platform_private.ai_memory_json_sha256(
      COALESCE(private_response_json, 'null'::JSONB)
    )
  ),
  human_review_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (
    human_review_required = TRUE
  ),
  autonomous_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    autonomous_authority = FALSE
  ),
  provider_proof_state TEXT NOT NULL DEFAULT 'blocked' CHECK (
    provider_proof_state = 'blocked'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT gemini_proposal_results_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT gemini_proposal_results_request_key
    UNIQUE (organization_id, proposal_request_id),
  CONSTRAINT gemini_proposal_results_request_fkey
    FOREIGN KEY (
      organization_id,
      proposal_request_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform_private.gemini_proposal_requests(
      organization_id,
      id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_results_provider_evidence_shape_check CHECK (
    (
      private_provider_status IN (
        'in_progress',
        'requires_action',
        'completed',
        'failed',
        'cancelled',
        'incomplete',
        'budget_exceeded'
      )
      AND private_provider_interaction_ref IS NOT NULL
    )
    OR (
      private_provider_status IN (
        'not_called',
        'local_error',
        'configuration_error',
        'transport_error'
      )
      AND private_provider_interaction_ref IS NULL
    )
  ),
  CONSTRAINT gemini_proposal_results_outcome_shape_check CHECK (
    (
      outcome = 'proposal_ready'
      AND failure_code IS NULL
      AND private_provider_interaction_ref IS NOT NULL
      AND private_provider_status = 'completed'
      AND platform_private.gemini_proposal_response_is_valid(
        private_response_json
      )
    )
    OR (
      outcome = 'human_review'
      AND platform_private.gemini_proposal_failure_code_is_valid(
        failure_code
      )
      AND (
        private_response_json IS NULL
        OR pg_catalog.char_length(private_response_json::TEXT) <= 32768
      )
    )
  )
);

ALTER TABLE platform_private.gemini_proposal_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.gemini_proposal_requests
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.gemini_proposal_results
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.gemini_proposal_results
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER gemini_proposal_requests_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.gemini_proposal_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER gemini_proposal_requests_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.gemini_proposal_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER gemini_proposal_results_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.gemini_proposal_results
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER gemini_proposal_results_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.gemini_proposal_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.begin_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_request_id UUID,
  p_model_ref TEXT,
  p_schema_version INTEGER,
  p_prompt_policy_version TEXT
)
RETURNS TABLE (
  proposal_request_id UUID,
  replayed BOOLEAN,
  completed BOOLEAN,
  outcome TEXT,
  context JSONB
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  source_row platform.communication_messages%ROWTYPE;
  prior_request platform_private.gemini_proposal_requests%ROWTYPE;
  private_context JSONB;
  request_fingerprint TEXT;
  exact_model_ref TEXT := pg_catalog.btrim(p_model_ref);
  exact_prompt_policy_version TEXT :=
    pg_catalog.btrim(p_prompt_policy_version);
  existing_outcome TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR exact_model_ref IS DISTINCT FROM 'gemini-3.5-flash'
    OR p_schema_version IS DISTINCT FROM 1
    OR exact_prompt_policy_version IS DISTINCT FROM
      'p5f2-gemini-proposal-v1'
  THEN
    RAISE EXCEPTION 'Gemini proposal request is invalid'
      USING ERRCODE = '22023';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'model_ref', exact_model_ref,
      'schema_version', p_schema_version,
      'prompt_policy_version', exact_prompt_policy_version
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f2:gemini-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT request.*
  INTO prior_request
  FROM platform_private.gemini_proposal_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF prior_request.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION
        'request_id was already used for another Gemini proposal request'
        USING ERRCODE = '22023';
    END IF;

    SELECT result.outcome::TEXT
    INTO existing_outcome
    FROM platform_private.gemini_proposal_results AS result
    WHERE result.organization_id = prior_request.organization_id
      AND result.proposal_request_id = prior_request.id;

    RETURN QUERY
    SELECT
      prior_request.id,
      TRUE,
      existing_outcome IS NOT NULL,
      existing_outcome,
      prior_request.private_context;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f2:gemini-conversation:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT message.*
  INTO source_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
    AND message.id = p_source_message_id
    AND message.direction = 'inbound'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = message.organization_id
        AND later_message.conversation_id = message.conversation_id
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          message.created_at,
          message.id
        )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Source must be the latest inbound communication message'
      USING ERRCODE = '42501';
  END IF;

  WITH recent_messages AS MATERIALIZED (
    SELECT
      message.id,
      message.direction,
      message.language,
      pg_catalog.left(message.body_text, 2000) AS body_text,
      message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND (
        message.created_at,
        message.id
      ) <= (
        source_row.created_at,
        source_row.id
      )
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 12
  ),
  recent_context AS MATERIALIZED (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'message_id', recent.id,
          'direction', recent.direction::TEXT,
          'language', recent.language::TEXT,
          'body_text', recent.body_text,
          'created_at', recent.created_at
        )
        ORDER BY recent.created_at, recent.id
      ),
      '[]'::JSONB
    ) AS items
    FROM recent_messages AS recent
  ),
  latest_memory AS MATERIALIZED (
    SELECT memory.*
    FROM platform_private.conversation_ai_memory_versions AS memory
    WHERE memory.organization_id = p_organization_id
      AND memory.conversation_id = p_conversation_id
    ORDER BY memory.version DESC
    LIMIT 1
  ),
  current_facts AS MATERIALIZED (
    SELECT DISTINCT ON (fact.fact_key)
      fact.fact_key,
      fact.status,
      fact.fact_value,
      fact.version
    FROM platform_private.conversation_ai_fact_versions AS fact
    WHERE fact.organization_id = p_organization_id
      AND fact.conversation_id = p_conversation_id
    ORDER BY fact.fact_key, fact.version DESC
  ),
  safe_facts AS MATERIALIZED (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'fact_key', fact.fact_key::TEXT,
          'status', fact.status::TEXT,
          'value', fact.fact_value,
          'version', fact.version
        )
        ORDER BY fact.fact_key
      ),
      '[]'::JSONB
    ) AS items
    FROM current_facts AS fact
  ),
  latest_qualification AS MATERIALIZED (
    SELECT qualification.*
    FROM platform_private.conversation_ai_qualification_versions
      AS qualification
    WHERE qualification.organization_id = p_organization_id
      AND qualification.conversation_id = p_conversation_id
    ORDER BY qualification.version DESC
    LIMIT 1
  ),
  latest_control AS MATERIALIZED (
    SELECT control.*
    FROM platform_private.conversation_ai_control_events AS control
    WHERE control.organization_id = p_organization_id
      AND control.conversation_id = p_conversation_id
    ORDER BY control.version DESC
    LIMIT 1
  ),
  latest_retrieval AS MATERIALIZED (
    SELECT retrieval.*
    FROM platform_private.ai_retrieval_requests AS retrieval
    WHERE retrieval.organization_id = p_organization_id
      AND retrieval.conversation_id = p_conversation_id
      AND retrieval.source_message_id = p_source_message_id
    ORDER BY retrieval.created_at DESC, retrieval.id DESC
    LIMIT 1
  ),
  retrieval_evidence AS MATERIALIZED (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'knowledge_key', evidence_row.knowledge_key,
          'knowledge_version', evidence_row.knowledge_version,
          'evidence_ordinal', evidence_row.evidence_ordinal,
          'content_text', evidence_row.content_text
        )
        ORDER BY evidence_row.evidence_ordinal
      ),
      '[]'::JSONB
    ) AS items
    FROM (
      SELECT
        knowledge.knowledge_key,
        knowledge.version AS knowledge_version,
        evidence.ordinal AS evidence_ordinal,
        pg_catalog.left(chunk.content_text, 3000) AS content_text
      FROM latest_retrieval AS retrieval
      JOIN platform_private.ai_retrieval_evidence AS evidence
        ON evidence.organization_id = retrieval.organization_id
       AND evidence.retrieval_request_id = retrieval.id
       AND evidence.conversation_id = retrieval.conversation_id
       AND evidence.source_message_id = retrieval.source_message_id
      JOIN platform_private.approved_knowledge_chunks AS chunk
        ON chunk.organization_id = evidence.organization_id
       AND chunk.id = evidence.chunk_id
       AND chunk.knowledge_version_id = evidence.knowledge_version_id
      JOIN platform.approved_knowledge_versions AS knowledge
        ON knowledge.organization_id = evidence.organization_id
       AND knowledge.id = evidence.knowledge_version_id
       AND knowledge.status = 'approved'
      ORDER BY evidence.ordinal
      LIMIT 6
    ) AS evidence_row
  ),
  safe_amocrm AS MATERIALIZED (
    SELECT context.*
    FROM platform_private.amocrm_canonical_context_current AS context
    WHERE context.organization_id = p_organization_id
      AND context.conversation_id = p_conversation_id
      AND context.amocrm_account_id = conversation_row.amocrm_account_id
      AND context.amocrm_contact_id = conversation_row.amocrm_contact_id
      AND context.amocrm_lead_id = conversation_row.amocrm_lead_id
  )
  SELECT pg_catalog.jsonb_build_object(
    'conversation', pg_catalog.jsonb_build_object(
      'conversation_id', conversation_row.id,
      'status', conversation_row.status::TEXT
    ),
    'source_message', pg_catalog.jsonb_build_object(
      'message_id', source_row.id,
      'direction', source_row.direction::TEXT,
      'language', source_row.language::TEXT,
      'body_text', pg_catalog.left(source_row.body_text, 4000),
      'created_at', source_row.created_at
    ),
    'recent_messages', recent_context.items,
    'memory', pg_catalog.jsonb_build_object(
      'version', COALESCE(memory.version, 0),
      'short_summary', memory.short_summary,
      'long_summary', memory.long_summary,
      'facts', safe_facts.items,
      'qualification', pg_catalog.jsonb_build_object(
        'version', COALESCE(qualification.version, 0),
        'status', COALESCE(qualification.status::TEXT, 'collecting'),
        'completeness', COALESCE(qualification.completeness, 0),
        'missing_fact_keys', COALESCE(
          pg_catalog.to_jsonb(qualification.missing_fact_keys::TEXT[]),
          '[]'::JSONB
        ),
        'notes', qualification.notes
      ),
      'control', pg_catalog.jsonb_build_object(
        'version', COALESCE(control.version, 0),
        'state', COALESCE(control.new_state::TEXT, 'paused')
      )
    ),
    'retrieval', pg_catalog.jsonb_build_object(
      'mode', retrieval.mode::TEXT,
      'outcome', retrieval.outcome::TEXT,
      'degraded', retrieval.degraded,
      'evidence', retrieval_evidence.items
    ),
    'amocrm', CASE
      WHEN amocrm.conversation_id IS NULL THEN NULL::JSONB
      ELSE pg_catalog.jsonb_build_object(
        'state', amocrm.state,
        'reason_code', amocrm.reason_code,
        'contact_name', amocrm.contact_name,
        'lead_name', amocrm.lead_name,
        'responsible_user_name', amocrm.responsible_user_name,
        'responsible_user_active', amocrm.responsible_user_active,
        'responsible_user_resolution', amocrm.responsible_user_resolution,
        'pipeline_name', amocrm.pipeline_name,
        'status_name', amocrm.status_name,
        'provider_observed_at', amocrm.provider_observed_at,
        'adapter_contract_version', amocrm.adapter_contract_version,
        'version', amocrm.version
      )
    END
  )
  INTO private_context
  FROM recent_context
  CROSS JOIN safe_facts
  CROSS JOIN retrieval_evidence
  LEFT JOIN latest_memory AS memory ON TRUE
  LEFT JOIN latest_qualification AS qualification ON TRUE
  LEFT JOIN latest_control AS control ON TRUE
  LEFT JOIN latest_retrieval AS retrieval ON TRUE
  LEFT JOIN safe_amocrm AS amocrm ON TRUE;

  IF private_context IS NULL
    OR pg_catalog.char_length(private_context::TEXT) > 65536
  THEN
    RAISE EXCEPTION 'Gemini proposal context exceeds its safe bound'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform_private.gemini_proposal_requests (
    organization_id,
    conversation_id,
    source_message_id,
    request_id,
    request_fingerprint,
    model_ref,
    schema_version,
    prompt_policy_version,
    private_context,
    context_sha256,
    input_sha256
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_request_id,
    request_fingerprint,
    exact_model_ref,
    p_schema_version,
    exact_prompt_policy_version,
    private_context,
    platform_private.ai_memory_json_sha256(private_context),
    platform_private.ai_memory_json_sha256(
      pg_catalog.jsonb_build_object(
        'request_fingerprint', request_fingerprint,
        'context', private_context
      )
    )
  )
  RETURNING id INTO proposal_request_id;

  replayed := FALSE;
  completed := FALSE;
  outcome := NULL;
  context := private_context;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_proposal_request_id UUID,
  p_outcome TEXT,
  p_failure_code TEXT,
  p_prompt_text TEXT,
  p_provider_interaction_ref TEXT,
  p_provider_status TEXT,
  p_response_json JSONB
)
RETURNS TABLE (
  proposal_request_id UUID,
  replayed BOOLEAN,
  outcome TEXT,
  failure_code TEXT,
  human_review_required BOOLEAN,
  autonomous_authority BOOLEAN,
  provider_proof_state TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row platform_private.gemini_proposal_requests%ROWTYPE;
  result_row platform_private.gemini_proposal_results%ROWTYPE;
  exact_outcome platform.gemini_proposal_outcome;
  exact_failure_code TEXT := NULLIF(pg_catalog.btrim(p_failure_code), '');
  exact_prompt_text TEXT := pg_catalog.btrim(p_prompt_text);
  exact_provider_ref TEXT := NULLIF(
    pg_catalog.btrim(p_provider_interaction_ref),
    ''
  );
  exact_provider_status TEXT := pg_catalog.btrim(p_provider_status);
  prompt_hash TEXT;
  response_hash TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_proposal_request_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome NOT IN ('proposal_ready', 'human_review')
    OR p_prompt_text IS NULL
    OR exact_prompt_text = ''
    OR pg_catalog.char_length(exact_prompt_text) > 65536
    OR NOT platform_private.gemini_proposal_provider_status_is_valid(
      exact_provider_status
    )
    OR (
      exact_provider_ref IS NOT NULL
      AND pg_catalog.char_length(exact_provider_ref) > 255
    )
    OR (
      exact_provider_status IN (
        'in_progress',
        'requires_action',
        'completed',
        'failed',
        'cancelled',
        'incomplete',
        'budget_exceeded'
      )
      AND exact_provider_ref IS NULL
    )
    OR (
      exact_provider_status IN (
        'not_called',
        'local_error',
        'configuration_error',
        'transport_error'
      )
      AND exact_provider_ref IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal result is invalid'
      USING ERRCODE = '22023';
  END IF;

  exact_outcome := p_outcome::platform.gemini_proposal_outcome;
  prompt_hash := platform_private.ai_memory_text_sha256(exact_prompt_text);
  response_hash := platform_private.ai_memory_json_sha256(
    COALESCE(p_response_json, 'null'::JSONB)
  );

  IF (
      exact_outcome = 'proposal_ready'
      AND (
        exact_failure_code IS NOT NULL
        OR exact_provider_ref IS NULL
        OR exact_provider_status <> 'completed'
        OR NOT platform_private.gemini_proposal_response_is_valid(
          p_response_json
        )
      )
    )
    OR (
      exact_outcome = 'human_review'
      AND (
        NOT platform_private.gemini_proposal_failure_code_is_valid(
          exact_failure_code
        )
        OR (
          p_response_json IS NOT NULL
          AND pg_catalog.char_length(p_response_json::TEXT) > 32768
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal result shape is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f2:gemini-result:' || p_proposal_request_id::TEXT,
      0
    )
  );

  SELECT request.*
  INTO request_row
  FROM platform_private.gemini_proposal_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.conversation_id = p_conversation_id
    AND request.source_message_id = p_source_message_id
    AND request.id = p_proposal_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gemini proposal request is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF exact_outcome = 'proposal_ready'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        p_response_json -> 'citations'
      ) AS citation(value)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          request_row.private_context -> 'retrieval' -> 'evidence'
        ) AS evidence(value)
        WHERE evidence.value ->> 'knowledge_key' =
            citation.value ->> 'knowledge_key'
          AND evidence.value ->> 'knowledge_version' =
            citation.value ->> 'knowledge_version'
          AND evidence.value ->> 'evidence_ordinal' =
            citation.value ->> 'evidence_ordinal'
      )
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal citations are not grounded'
      USING ERRCODE = '22023';
  END IF;

  SELECT result.*
  INTO result_row
  FROM platform_private.gemini_proposal_results AS result
  WHERE result.organization_id = p_organization_id
    AND result.proposal_request_id = p_proposal_request_id;

  IF FOUND THEN
    IF result_row.conversation_id <> p_conversation_id
      OR result_row.source_message_id <> p_source_message_id
      OR result_row.outcome <> exact_outcome
      OR result_row.failure_code IS DISTINCT FROM exact_failure_code
      OR result_row.prompt_sha256 <> prompt_hash
      OR result_row.private_provider_interaction_ref
        IS DISTINCT FROM exact_provider_ref
      OR result_row.private_provider_status <> exact_provider_status
      OR result_row.response_sha256 <> response_hash
    THEN
      RAISE EXCEPTION
        'Gemini proposal request already has another result'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      result_row.proposal_request_id,
      TRUE,
      result_row.outcome::TEXT,
      result_row.failure_code,
      result_row.human_review_required,
      result_row.autonomous_authority,
      result_row.provider_proof_state;
    RETURN;
  END IF;

  INSERT INTO platform_private.gemini_proposal_results (
    organization_id,
    conversation_id,
    source_message_id,
    proposal_request_id,
    outcome,
    failure_code,
    private_prompt_text,
    prompt_sha256,
    private_provider_interaction_ref,
    private_provider_status,
    private_response_json,
    response_sha256
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_proposal_request_id,
    exact_outcome,
    exact_failure_code,
    exact_prompt_text,
    prompt_hash,
    exact_provider_ref,
    exact_provider_status,
    p_response_json,
    response_hash
  )
  RETURNING * INTO result_row;

  RETURN QUERY
  SELECT
    result_row.proposal_request_id,
    FALSE,
    result_row.outcome::TEXT,
    result_row.failure_code,
    result_row.human_review_required,
    result_row.autonomous_authority,
    result_row.provider_proof_state;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  proposal_request_id UUID,
  source_message_id UUID,
  outcome TEXT,
  failure_code TEXT,
  model_ref TEXT,
  schema_version INTEGER,
  language TEXT,
  intent TEXT,
  confidence SMALLINT,
  risk TEXT,
  handoff_required BOOLEAN,
  handoff_reasons TEXT[],
  citations JSONB,
  memory_changes JSONB,
  qualification JSONB,
  reply_text TEXT,
  requested_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  human_review_required BOOLEAN,
  autonomous_authority BOOLEAN,
  provider_proof_state TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'ai.draft.review'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH latest_request AS MATERIALIZED (
    SELECT request.*
    FROM platform_private.gemini_proposal_requests AS request
    WHERE request.organization_id = p_organization_id
      AND request.conversation_id = p_conversation_id
    ORDER BY request.created_at DESC, request.id DESC
    LIMIT 1
  )
  SELECT
    request.id,
    request.source_message_id,
    result.outcome::TEXT,
    result.failure_code,
    request.model_ref,
    request.schema_version,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'language'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'intent'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN (result.private_response_json ->> 'confidence')::SMALLINT
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'risk'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN (result.private_response_json ->> 'handoff_required')::BOOLEAN
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN ARRAY(
        SELECT reason.value #>> '{}'
        FROM pg_catalog.jsonb_array_elements(
          result.private_response_json -> 'handoff_reasons'
        ) AS reason(value)
      )
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json -> 'citations'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json -> 'memory_changes'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json -> 'qualification'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'reply_text'
    END,
    request.created_at,
    result.created_at,
    COALESCE(result.human_review_required, TRUE),
    COALESCE(result.autonomous_authority, FALSE),
    COALESCE(result.provider_proof_state, 'blocked')
  FROM latest_request AS request
  LEFT JOIN platform_private.gemini_proposal_results AS result
    ON result.organization_id = request.organization_id
   AND result.proposal_request_id = request.id;
END
$$;

REVOKE ALL ON TABLE
  platform_private.gemini_proposal_requests,
  platform_private.gemini_proposal_results
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TYPE platform.gemini_proposal_outcome
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.gemini_proposal_failure_code_is_valid(TEXT),
  platform_private.gemini_proposal_provider_status_is_valid(TEXT),
  platform_private.gemini_proposal_response_is_valid(JSONB),
  platform.begin_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    INTEGER,
    TEXT
  ),
  platform.finish_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    JSONB
  ),
  platform.staff_gemini_proposal(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
)
TO service_role;

GRANT EXECUTE ON FUNCTION platform.finish_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
)
TO service_role;

GRANT EXECUTE ON FUNCTION platform.staff_gemini_proposal(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform_private.gemini_proposal_requests IS
  'Private append-only exact-source context audit for one stateless P5F2 Gemini proposal; no send or autonomy authority.';
COMMENT ON TABLE platform_private.gemini_proposal_results IS
  'Private append-only P5F2 proposal or bounded human-review outcome; provider status, prompts, provider references and raw responses never enter the staff RPC.';
COMMENT ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
) IS
  'Service-only idempotent P5F2 begin operation binding an open conversation to its latest inbound Platform message and a bounded private context.';
COMMENT ON FUNCTION platform.finish_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) IS
  'Service-only idempotent P5F2 finish operation with immutable bounded provider-status evidence; every outcome remains human review with autonomous authority false.';
COMMENT ON FUNCTION platform.staff_gemini_proposal(UUID, UUID) IS
  'Authenticated, conversation-authorized safe read of the latest P5F2 request/result without private context, prompts, hashes or provider identifiers.';

COMMIT;
