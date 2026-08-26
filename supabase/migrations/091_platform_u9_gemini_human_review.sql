BEGIN;

-- U9 extends the existing P5F2 Gemini proposal authority. Historical schema
-- version 1 requests/results remain valid and readable, while every new begin
-- and finish operation is pinned to schema version 2 and gemini-3.7-flash.
-- Human review is a separate append-only decision and grants no send or other
-- operational mutation authority.

ALTER FUNCTION platform_private.gemini_proposal_response_is_valid(JSONB)
  RENAME TO gemini_proposal_response_v1_is_valid;

CREATE OR REPLACE FUNCTION
platform_private.gemini_proposal_response_v2_is_valid(
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
  v1_projection JSONB;
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
      'reply_text',
      'summary',
      'next_action',
      'draft_internal_note',
      'missing_document_suggestion',
      'deadline_warning',
      'limitations',
      'uncertainty'
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
      'reply_text',
      'summary',
      'next_action',
      'draft_internal_note',
      'missing_document_suggestion',
      'deadline_warning',
      'limitations',
      'uncertainty'
    ] <> '{}'::JSONB
    OR pg_catalog.jsonb_typeof(p_value -> 'schema_version') <> 'number'
    OR p_value ->> 'schema_version' <> '2'
    OR pg_catalog.jsonb_typeof(p_value -> 'summary') <> 'string'
    OR p_value ->> 'summary' <> pg_catalog.btrim(p_value ->> 'summary')
    OR pg_catalog.char_length(p_value ->> 'summary') NOT BETWEEN 1 AND 2000
    OR pg_catalog.jsonb_typeof(p_value -> 'next_action') <> 'string'
    OR p_value ->> 'next_action' <> pg_catalog.btrim(p_value ->> 'next_action')
    OR pg_catalog.char_length(p_value ->> 'next_action') NOT BETWEEN 1 AND 1000
    OR pg_catalog.jsonb_typeof(p_value -> 'draft_internal_note') <> 'string'
    OR p_value ->> 'draft_internal_note' <>
      pg_catalog.btrim(p_value ->> 'draft_internal_note')
    OR pg_catalog.char_length(p_value ->> 'draft_internal_note')
      NOT BETWEEN 1 AND 4000
    OR pg_catalog.jsonb_typeof(p_value -> 'missing_document_suggestion')
      NOT IN ('string', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_value -> 'missing_document_suggestion') =
        'string'
      AND (
        p_value ->> 'missing_document_suggestion' <>
          pg_catalog.btrim(p_value ->> 'missing_document_suggestion')
        OR pg_catalog.char_length(
          p_value ->> 'missing_document_suggestion'
        ) NOT BETWEEN 1 AND 1000
      )
    )
    OR pg_catalog.jsonb_typeof(p_value -> 'deadline_warning')
      NOT IN ('string', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_value -> 'deadline_warning') = 'string'
      AND (
        p_value ->> 'deadline_warning' <>
          pg_catalog.btrim(p_value ->> 'deadline_warning')
        OR pg_catalog.char_length(p_value ->> 'deadline_warning')
          NOT BETWEEN 1 AND 1000
      )
    )
    OR pg_catalog.jsonb_typeof(p_value -> 'limitations') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value -> 'limitations')
      NOT BETWEEN 1 AND 8
    OR p_value ->> 'uncertainty' NOT IN ('low', 'medium', 'high')
  THEN
    RETURN FALSE;
  END IF;

  v1_projection := (
    p_value - ARRAY[
      'summary',
      'next_action',
      'draft_internal_note',
      'missing_document_suggestion',
      'deadline_warning',
      'limitations',
      'uncertainty'
    ]
  ) || pg_catalog.jsonb_build_object('schema_version', 1);

  IF NOT platform_private.gemini_proposal_response_v1_is_valid(
    v1_projection
  ) THEN
    RETURN FALSE;
  END IF;

  FOR item IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_value -> 'limitations')
  LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'string' THEN
      RETURN FALSE;
    END IF;
    item_text := item #>> '{}';
    IF item_text <> pg_catalog.btrim(item_text)
      OR pg_catalog.char_length(item_text) NOT BETWEEN 1 AND 500
      OR item_text = ANY(seen)
    THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(seen, item_text);
  END LOOP;

  RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION
platform_private.gemini_proposal_response_is_valid(
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    CASE p_value ->> 'schema_version'
      WHEN '1' THEN
        platform_private.gemini_proposal_response_v1_is_valid(p_value)
      WHEN '2' THEN
        platform_private.gemini_proposal_response_v2_is_valid(p_value)
      ELSE FALSE
    END,
    FALSE
  )
$$;

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
    'privacy_not_approved',
    'provider_timeout',
    'provider_rate_limited',
    'provider_authentication_failed',
    'provider_forbidden',
    'provider_unavailable',
    'provider_rejected',
    'provider_error',
    'empty_response',
    'output_truncated',
    'malformed_response',
    'malformed_output',
    'unsupported_language',
    'invalid_proposal',
    'missing_evidence',
    'unsafe_semantics'
  ), FALSE)
$$;

-- Keep U9 review evidence inside the existing bounded P7A audit projection.
-- The forward migration composes with the prior U1/U5/U6 wrappers instead of
-- copying or editing their historical allowlists.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_u9;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_u9()
      || ARRAY['ai.proposal.review']::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_u9;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(
    DISTINCT allowed.resource_type
    ORDER BY allowed.resource_type
  )
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_u9()
      || ARRAY['gemini_proposal_review']::TEXT[]
  ) AS allowed(resource_type)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_u9;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action = 'ai.proposal.review' THEN
      ARRAY['ai_status', 'review_status']::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_u9(p_action)
  END
$$;

ALTER TABLE platform_private.gemini_proposal_requests
  DROP CONSTRAINT gemini_proposal_requests_model_ref_check,
  DROP CONSTRAINT gemini_proposal_requests_schema_version_check,
  DROP CONSTRAINT gemini_proposal_requests_prompt_policy_version_check;

ALTER TABLE platform_private.gemini_proposal_requests
  ADD CONSTRAINT gemini_proposal_requests_model_ref_check CHECK (
    model_ref IN ('gemini-3.5-flash', 'gemini-3.7-flash')
  ),
  ADD CONSTRAINT gemini_proposal_requests_schema_version_check CHECK (
    schema_version IN (1, 2)
  ),
  ADD CONSTRAINT gemini_proposal_requests_prompt_policy_version_check CHECK (
    prompt_policy_version IN (
      'p5f2-gemini-proposal-v1',
      'p5f2-consultative-sales-v2',
      'u9-gemini-human-review-v1'
    )
  ),
  ADD CONSTRAINT gemini_proposal_requests_version_bundle_check CHECK (
    (
      schema_version = 1
      AND model_ref = 'gemini-3.5-flash'
      AND prompt_policy_version IN (
        'p5f2-gemini-proposal-v1',
        'p5f2-consultative-sales-v2'
      )
    )
    OR (
      schema_version = 2
      AND model_ref = 'gemini-3.7-flash'
      AND prompt_policy_version = 'u9-gemini-human-review-v1'
    )
  );

ALTER TABLE platform_private.gemini_proposal_results
  DROP CONSTRAINT gemini_proposal_results_outcome_shape_check;

ALTER TABLE platform_private.gemini_proposal_results
  ADD CONSTRAINT gemini_proposal_results_outcome_shape_check CHECK (
    (
      outcome = 'proposal_ready'
      AND failure_code IS NULL
      AND private_provider_interaction_ref IS NOT NULL
      AND private_provider_status = 'completed'
      AND pg_catalog.char_length(private_response_json::TEXT) <= 32768
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
  );

ALTER TABLE platform_private.gemini_proposal_results
  ADD CONSTRAINT gemini_proposal_results_review_reference_key UNIQUE (
    organization_id,
    id,
    proposal_request_id,
    conversation_id,
    source_message_id
  );

CREATE TYPE platform.gemini_proposal_review_decision AS ENUM (
  'accepted',
  'edited',
  'rejected'
);

CREATE TABLE platform.gemini_proposal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  proposal_request_id UUID NOT NULL,
  proposal_result_id UUID NOT NULL,
  review_request_id UUID NOT NULL UNIQUE,
  decision platform.gemini_proposal_review_decision NOT NULL,
  reviewed_payload JSONB,
  reviewed_payload_sha256 TEXT,
  reason TEXT,
  reviewed_by_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  reviewed_by_membership_id UUID NOT NULL,
  reviewed_by_name TEXT NOT NULL CHECK (
    reviewed_by_name = pg_catalog.btrim(reviewed_by_name)
    AND pg_catalog.char_length(reviewed_by_name) BETWEEN 1 AND 200
    AND reviewed_by_name !~ '[[:cntrl:]]'
  ),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT gemini_proposal_reviews_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT gemini_proposal_reviews_result_key
    UNIQUE (organization_id, proposal_result_id),
  CONSTRAINT gemini_proposal_reviews_result_fkey
    FOREIGN KEY (
      organization_id,
      proposal_result_id,
      proposal_request_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform_private.gemini_proposal_results(
      organization_id,
      id,
      proposal_request_id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_reviews_reviewer_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_reviews_reason_check CHECK (
    reason IS NULL
    OR (
      reason = pg_catalog.btrim(reason)
      AND pg_catalog.char_length(reason) BETWEEN 1 AND 1000
      AND reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT gemini_proposal_reviews_payload_check CHECK (
    (
      decision IN ('accepted', 'edited')
      AND platform_private.gemini_proposal_response_v2_is_valid(
        reviewed_payload
      )
      AND reviewed_payload_sha256 =
        platform_private.ai_memory_json_sha256(reviewed_payload)
    )
    OR (
      decision = 'rejected'
      AND reviewed_payload IS NULL
      AND reviewed_payload_sha256 IS NULL
      AND reason IS NOT NULL
    )
  )
);

CREATE INDEX gemini_proposal_reviews_conversation_latest_idx
  ON platform.gemini_proposal_reviews (
    organization_id,
    conversation_id,
    reviewed_at DESC,
    id DESC
  );
CREATE INDEX gemini_proposal_reviews_reviewer_membership_idx
  ON platform.gemini_proposal_reviews (
    organization_id,
    reviewed_by_membership_id
  );
CREATE INDEX gemini_proposal_reviews_reviewer_profile_idx
  ON platform.gemini_proposal_reviews (reviewed_by_profile_id);

ALTER TABLE platform.gemini_proposal_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.gemini_proposal_reviews FORCE ROW LEVEL SECURITY;

CREATE TRIGGER gemini_proposal_reviews_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform.gemini_proposal_reviews
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER gemini_proposal_reviews_append_only_truncate
  BEFORE TRUNCATE
  ON platform.gemini_proposal_reviews
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
  existing_outcome TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR p_model_ref IS DISTINCT FROM 'gemini-3.7-flash'
    OR p_schema_version IS DISTINCT FROM 2
    OR p_prompt_policy_version IS DISTINCT FROM
      'u9-gemini-human-review-v1'
  THEN
    RAISE EXCEPTION 'Gemini proposal request is invalid'
      USING ERRCODE = '22023';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'model_ref', p_model_ref,
      'schema_version', p_schema_version,
      'prompt_policy_version', p_prompt_policy_version
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT request.*
  INTO prior_request
  FROM platform_private.gemini_proposal_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF prior_request.request_fingerprint <> request_fingerprint
      OR prior_request.model_ref <> 'gemini-3.7-flash'
      OR prior_request.schema_version <> 2
      OR prior_request.prompt_policy_version <>
        'u9-gemini-human-review-v1'
    THEN
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
      'evo:u9:gemini-conversation:'
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

  WITH current_knowledge AS MATERIALIZED (
    SELECT DISTINCT ON (knowledge.knowledge_key)
      knowledge.knowledge_key,
      knowledge.version,
      knowledge.title,
      knowledge.content_text,
      knowledge.approved_at,
      knowledge.id
    FROM platform.approved_knowledge_versions AS knowledge
    WHERE knowledge.organization_id = p_organization_id
      AND knowledge.status = 'approved'
    ORDER BY
      knowledge.knowledge_key,
      knowledge.version DESC,
      knowledge.id DESC
  ),
  selected_knowledge AS MATERIALIZED (
    SELECT
      knowledge.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          knowledge.approved_at DESC,
          knowledge.knowledge_key,
          knowledge.version DESC,
          knowledge.id
      )::INTEGER AS evidence_ordinal
    FROM current_knowledge AS knowledge
    ORDER BY
      knowledge.approved_at DESC,
      knowledge.knowledge_key,
      knowledge.version DESC,
      knowledge.id
    LIMIT 6
  ),
  knowledge_context AS MATERIALIZED (
    SELECT
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'source_ref', pg_catalog.jsonb_build_object(
              'knowledge_key', selected.knowledge_key,
              'knowledge_version', selected.version,
              'evidence_ordinal', selected.evidence_ordinal
            ),
            'title', pg_catalog.left(
              pg_catalog.btrim(selected.title),
              500
            ),
            'content_text', pg_catalog.left(
              pg_catalog.btrim(selected.content_text),
              4000
            )
          )
          ORDER BY selected.evidence_ordinal
        ),
        '[]'::JSONB
      ) AS items,
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'knowledge_key', selected.knowledge_key,
            'knowledge_version', selected.version,
            'evidence_ordinal', selected.evidence_ordinal
          )
          ORDER BY selected.evidence_ordinal
        ),
        '[]'::JSONB
      ) AS allowed_citations
    FROM selected_knowledge AS selected
  )
  SELECT pg_catalog.jsonb_build_object(
    'conversation', pg_catalog.jsonb_build_object(
      'conversation_id', conversation_row.id,
      'student_case_id', conversation_row.student_case_id,
      'status', conversation_row.status::TEXT
    ),
    'source_message', pg_catalog.jsonb_build_object(
      'message_id', source_row.id,
      'direction', source_row.direction::TEXT,
      'language', source_row.language::TEXT,
      'body_text', pg_catalog.left(
        pg_catalog.btrim(source_row.body_text),
        4000
      ),
      'created_at', source_row.created_at
    ),
    'approved_knowledge', knowledge_context.items,
    'allowed_citations', knowledge_context.allowed_citations
  )
  INTO private_context
  FROM knowledge_context;

  IF private_context IS NULL
    OR pg_catalog.char_length(private_context::TEXT) > 32768
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
    p_model_ref,
    p_schema_version,
    p_prompt_policy_version,
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-result:' || p_proposal_request_id::TEXT,
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

  IF NOT FOUND
    OR request_row.model_ref <> 'gemini-3.7-flash'
    OR request_row.schema_version <> 2
    OR request_row.prompt_policy_version <>
      'u9-gemini-human-review-v1'
  THEN
    RAISE EXCEPTION 'Gemini proposal request is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF (
      exact_outcome = 'proposal_ready'
      AND (
        exact_failure_code IS NOT NULL
        OR exact_provider_ref IS NULL
        OR exact_provider_status <> 'completed'
        OR NOT platform_private.gemini_proposal_response_v2_is_valid(
          p_response_json
        )
        OR pg_catalog.char_length(p_response_json::TEXT) > 32768
      )
    )
    OR (
      exact_outcome = 'human_review'
      AND (
        NOT platform_private.gemini_proposal_failure_code_is_valid(
          exact_failure_code
        )
        OR p_response_json IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal result shape is invalid'
      USING ERRCODE = '22023';
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
          request_row.private_context -> 'allowed_citations'
        ) AS allowed(value)
        WHERE allowed.value = citation.value
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

DROP FUNCTION platform.staff_gemini_proposal(UUID, UUID);

CREATE FUNCTION platform.staff_gemini_proposal(
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
  summary TEXT,
  next_action TEXT,
  draft_internal_note TEXT,
  missing_document_suggestion TEXT,
  deadline_warning TEXT,
  limitations JSONB,
  uncertainty TEXT,
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
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'summary'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'next_action'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'draft_internal_note'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'missing_document_suggestion'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'deadline_warning'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json -> 'limitations'
    END,
    CASE WHEN result.outcome = 'proposal_ready'
      THEN result.private_response_json ->> 'uncertainty'
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

CREATE OR REPLACE FUNCTION platform.review_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_proposal_request_id UUID,
  p_review_request_id UUID,
  p_decision TEXT,
  p_reviewed_payload JSONB,
  p_reason TEXT
)
RETURNS TABLE (
  review_id UUID,
  proposal_request_id UUID,
  decision TEXT,
  reviewed_payload JSONB,
  reviewed_payload_sha256 TEXT,
  reason TEXT,
  reviewed_by_membership_id UUID,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  replayed BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  request_row platform_private.gemini_proposal_requests%ROWTYPE;
  result_row platform_private.gemini_proposal_results%ROWTYPE;
  prior_review platform.gemini_proposal_reviews%ROWTYPE;
  created_review platform.gemini_proposal_reviews%ROWTYPE;
  exact_decision TEXT := pg_catalog.btrim(p_decision);
  exact_reason TEXT := NULLIF(pg_catalog.btrim(p_reason), '');
  exact_payload JSONB;
  exact_payload_hash TEXT;
  safe_reviewer_name TEXT;
  audit_reason TEXT;
  replayed_audit JSONB;
  expected_audit JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_proposal_request_id IS NULL
    OR p_review_request_id IS NULL
    OR p_decision IS NULL
    OR p_decision IS DISTINCT FROM exact_decision
    OR exact_decision NOT IN ('accepted', 'edited', 'rejected')
    OR (
      exact_reason IS NOT NULL
      AND (
        pg_catalog.char_length(exact_reason) > 1000
        OR exact_reason ~ '[[:cntrl:]]'
      )
    )
    OR (exact_decision = 'rejected' AND exact_reason IS NULL)
  THEN
    RAISE EXCEPTION 'Gemini proposal review is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-review-request:' || p_review_request_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-review-result:' || p_proposal_request_id::TEXT,
      0
    )
  );

  SELECT request.*
  INTO request_row
  FROM platform_private.gemini_proposal_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.conversation_id = p_conversation_id
    AND request.id = p_proposal_request_id
    AND request.model_ref = 'gemini-3.7-flash'
    AND request.schema_version = 2
    AND request.prompt_policy_version = 'u9-gemini-human-review-v1';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gemini proposal is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT result.*
  INTO result_row
  FROM platform_private.gemini_proposal_results AS result
  WHERE result.organization_id = p_organization_id
    AND result.conversation_id = p_conversation_id
    AND result.source_message_id = request_row.source_message_id
    AND result.proposal_request_id = request_row.id
    AND result.outcome = 'proposal_ready'
  FOR UPDATE;

  IF NOT FOUND
    OR NOT platform_private.gemini_proposal_response_v2_is_valid(
      result_row.private_response_json
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal is not ready for review'
      USING ERRCODE = '55000';
  END IF;

  IF exact_decision = 'accepted' THEN
    IF p_reviewed_payload IS NOT NULL
      AND p_reviewed_payload IS DISTINCT FROM
        result_row.private_response_json
    THEN
      RAISE EXCEPTION 'Accepted payload must match the generated proposal'
        USING ERRCODE = '22023';
    END IF;
    exact_payload := result_row.private_response_json;
  ELSIF exact_decision = 'edited' THEN
    IF NOT platform_private.gemini_proposal_response_v2_is_valid(
        p_reviewed_payload
      )
      OR p_reviewed_payload IS NOT DISTINCT FROM
        result_row.private_response_json
      OR p_reviewed_payload - ARRAY[
        'reply_text',
        'summary',
        'next_action',
        'draft_internal_note',
        'missing_document_suggestion',
        'deadline_warning',
        'limitations',
        'uncertainty'
      ] IS DISTINCT FROM result_row.private_response_json - ARRAY[
        'reply_text',
        'summary',
        'next_action',
        'draft_internal_note',
        'missing_document_suggestion',
        'deadline_warning',
        'limitations',
        'uncertainty'
      ]
    THEN
      RAISE EXCEPTION
        'Edited payload is invalid or changes immutable model evidence'
        USING ERRCODE = '22023';
    END IF;
    exact_payload := p_reviewed_payload;
  ELSE
    IF p_reviewed_payload IS NOT NULL THEN
      RAISE EXCEPTION 'Rejected proposal cannot include reviewed content'
        USING ERRCODE = '22023';
    END IF;
    exact_payload := NULL;
  END IF;

  exact_payload_hash := CASE
    WHEN exact_payload IS NULL THEN NULL
    ELSE platform_private.ai_memory_json_sha256(exact_payload)
  END;

  SELECT CASE
    WHEN profile.display_name = pg_catalog.btrim(profile.display_name)
      AND pg_catalog.char_length(profile.display_name) BETWEEN 1 AND 200
      AND profile.display_name !~ '[[:cntrl:]]'
    THEN profile.display_name
    ELSE 'Staff'
  END
  INTO safe_reviewer_name
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id;

  IF safe_reviewer_name IS NULL THEN
    RAISE EXCEPTION 'Reviewer identity is unavailable'
      USING ERRCODE = '42501';
  END IF;

  audit_reason := COALESCE(
    exact_reason,
    CASE exact_decision
      WHEN 'accepted' THEN 'Gemini proposal accepted'
      WHEN 'edited' THEN 'Gemini proposal edited'
    END
  );

  SELECT review.*
  INTO prior_review
  FROM platform.gemini_proposal_reviews AS review
  WHERE review.review_request_id = p_review_request_id;

  IF FOUND THEN
    expected_audit := pg_catalog.jsonb_build_object(
      'review_id', prior_review.id,
      'proposal_request_id', prior_review.proposal_request_id,
      'proposal_result_id', prior_review.proposal_result_id,
      'conversation_id', prior_review.conversation_id,
      'decision', prior_review.decision::TEXT,
      'reviewed_payload_sha256', prior_review.reviewed_payload_sha256,
      'reviewed_by_membership_id', prior_review.reviewed_by_membership_id
    );
    replayed_audit := platform_private.replay_audit(
      p_review_request_id,
      'ai.proposal.review',
      'gemini_proposal_review',
      prior_review.id,
      audit_reason,
      expected_audit
    );

    IF replayed_audit IS NULL
      OR prior_review.organization_id <> p_organization_id
      OR prior_review.conversation_id <> p_conversation_id
      OR prior_review.proposal_request_id <> p_proposal_request_id
      OR prior_review.proposal_result_id <> result_row.id
      OR prior_review.decision::TEXT <> exact_decision
      OR prior_review.reviewed_payload IS DISTINCT FROM exact_payload
      OR prior_review.reviewed_payload_sha256
        IS DISTINCT FROM exact_payload_hash
      OR prior_review.reason IS DISTINCT FROM exact_reason
      OR prior_review.reviewed_by_profile_id <> actor.actor_profile_id
      OR prior_review.reviewed_by_membership_id <>
        actor.actor_membership_id
    THEN
      RAISE EXCEPTION
        'review_request_id was already used for another review'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      prior_review.id,
      prior_review.proposal_request_id,
      prior_review.decision::TEXT,
      prior_review.reviewed_payload,
      prior_review.reviewed_payload_sha256,
      prior_review.reason,
      prior_review.reviewed_by_membership_id,
      prior_review.reviewed_by_name,
      prior_review.reviewed_at,
      TRUE;
    RETURN;
  END IF;

  expected_audit := pg_catalog.jsonb_build_object(
    'proposal_request_id', p_proposal_request_id,
    'proposal_result_id', result_row.id,
    'conversation_id', p_conversation_id,
    'decision', exact_decision,
    'reviewed_payload_sha256', exact_payload_hash,
    'reviewed_by_membership_id', actor.actor_membership_id
  );
  replayed_audit := platform_private.replay_audit(
    p_review_request_id,
    'ai.proposal.review',
    'gemini_proposal_review',
    NULL,
    audit_reason,
    expected_audit
  );
  IF replayed_audit IS NOT NULL THEN
    RAISE EXCEPTION 'Gemini proposal review audit is inconsistent'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.gemini_proposal_reviews AS review
    WHERE review.organization_id = p_organization_id
      AND review.proposal_result_id = result_row.id
  ) THEN
    RAISE EXCEPTION 'Gemini proposal already has a final review'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.gemini_proposal_reviews (
    organization_id,
    conversation_id,
    source_message_id,
    proposal_request_id,
    proposal_result_id,
    review_request_id,
    decision,
    reviewed_payload,
    reviewed_payload_sha256,
    reason,
    reviewed_by_profile_id,
    reviewed_by_membership_id,
    reviewed_by_name
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    request_row.source_message_id,
    p_proposal_request_id,
    result_row.id,
    p_review_request_id,
    exact_decision::platform.gemini_proposal_review_decision,
    exact_payload,
    exact_payload_hash,
    exact_reason,
    actor.actor_profile_id,
    actor.actor_membership_id,
    safe_reviewer_name
  )
  RETURNING * INTO created_review;

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
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.proposal.review',
    'gemini_proposal_review',
    created_review.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'review_id', created_review.id,
      'proposal_request_id', created_review.proposal_request_id,
      'proposal_result_id', created_review.proposal_result_id,
      'conversation_id', created_review.conversation_id,
      'decision', created_review.decision::TEXT,
      'reviewed_payload_sha256', created_review.reviewed_payload_sha256,
      'reviewed_by_membership_id',
        created_review.reviewed_by_membership_id
    ),
    audit_reason,
    p_review_request_id
  );

  RETURN QUERY
  SELECT
    created_review.id,
    created_review.proposal_request_id,
    created_review.decision::TEXT,
    created_review.reviewed_payload,
    created_review.reviewed_payload_sha256,
    created_review.reason,
    created_review.reviewed_by_membership_id,
    created_review.reviewed_by_name,
    created_review.reviewed_at,
    FALSE;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_gemini_proposal_reviews(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  review_id UUID,
  proposal_request_id UUID,
  decision TEXT,
  reviewed_payload JSONB,
  reviewed_payload_sha256 TEXT,
  reason TEXT,
  reviewed_by_membership_id UUID,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'Organization, conversation and limit are required'
      USING ERRCODE = '22023';
  END IF;

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
  SELECT
    review.id,
    review.proposal_request_id,
    review.decision::TEXT,
    review.reviewed_payload,
    review.reviewed_payload_sha256,
    review.reason,
    review.reviewed_by_membership_id,
    review.reviewed_by_name,
    review.reviewed_at
  FROM platform.gemini_proposal_reviews AS review
  WHERE review.organization_id = p_organization_id
    AND review.conversation_id = p_conversation_id
  ORDER BY review.reviewed_at DESC, review.id DESC
  LIMIT p_limit;
END
$$;

REVOKE ALL ON TABLE platform.gemini_proposal_reviews
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON TYPE platform.gemini_proposal_review_decision
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.gemini_proposal_response_v1_is_valid(JSONB),
  platform_private.gemini_proposal_response_v2_is_valid(JSONB),
  platform_private.gemini_proposal_response_is_valid(JSONB),
  platform_private.gemini_proposal_failure_code_is_valid(TEXT),
  platform_private.p7a_safe_audit_actions_pre_u9(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_u9(),
  platform_private.p7a_safe_audit_resource_types(),
  platform_private.p7a_changed_field_codes_pre_u9(TEXT),
  platform_private.p7a_changed_field_codes(TEXT),
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
  platform.staff_gemini_proposal(UUID, UUID),
  platform.review_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    JSONB,
    TEXT
  ),
  platform.staff_gemini_proposal_reviews(UUID, UUID, INTEGER)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
) TO service_role;
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
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.staff_gemini_proposal(UUID, UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION platform.review_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.staff_gemini_proposal_reviews(UUID, UUID, INTEGER)
TO authenticated;

COMMENT ON TABLE platform.gemini_proposal_reviews IS
  'U9 append-only staff Accept/Edit/Reject decision for one exact successful schema-v2 Gemini proposal; it grants no send or operational mutation authority.';
COMMENT ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
) IS
  'Service-only U9 begin operation pinned to gemini-3.7-flash/schema 2 and a latest inbound message plus bounded approved knowledge; no history, secrets, attachments, amoCRM or send authority.';
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
  'Service-only U9 completion for an exact pending schema-v2 request; validates strict structured output, bounded failure codes and grounded citations.';
COMMENT ON FUNCTION platform.staff_gemini_proposal(UUID, UUID) IS
  'Authenticated conversation-authorized U9 projection of one latest safe proposal, including bounded schema-v2 review fields but no prompt, provider reference or raw response.';
COMMENT ON FUNCTION platform.review_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB,
  TEXT
) IS
  'Authenticated conversation-authorized idempotent U9 Accept/Edit/Reject evidence; generated content remains immutable and no external or operational mutation is performed.';
COMMENT ON FUNCTION
  platform.staff_gemini_proposal_reviews(UUID, UUID, INTEGER) IS
  'Authenticated conversation-authorized newest-first bounded U9 review history without prompts, provider identifiers or private generation context.';

COMMIT;
