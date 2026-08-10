-- ============================================================
-- 065_platform_ai_memory_retrieval.sql
--
-- P5F1: Platform-owned, conversation-scoped AI memory and approved-
-- knowledge retrieval evidence. Every durable row is private and append-only.
-- This migration intentionally provides no Gemini execution, embedding ingest,
-- semantic matcher, WAHA send authority, amoCRM write or autonomy authorization.
-- ============================================================

BEGIN;

CREATE TYPE platform.ai_memory_fact_key AS ENUM (
  'preferred_country',
  'preferred_program',
  'budget_signal',
  'intake_target',
  'preferred_language',
  'urgency',
  'blockers',
  'promised_follow_up',
  'unanswered_questions'
);

CREATE TYPE platform.ai_memory_fact_status AS ENUM (
  'active',
  'retracted'
);

CREATE TYPE platform.ai_qualification_status AS ENUM (
  'collecting',
  'ready_for_staff_review',
  'staff_confirmed',
  'not_a_fit'
);

CREATE TYPE platform.ai_control_state AS ENUM (
  'paused',
  'staff_takeover',
  'staff_only'
);

CREATE TYPE platform.ai_retrieval_mode AS ENUM (
  'lexical_preview',
  'semantic'
);

CREATE TYPE platform.ai_retrieval_outcome AS ENUM (
  'completed',
  'no_match'
);

CREATE OR REPLACE FUNCTION platform_private.ai_memory_text_sha256(
  p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_memory_json_sha256(
  p_value JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT platform_private.ai_memory_text_sha256(p_value::TEXT)
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_memory_reason_is_valid(
  p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND p_value = pg_catalog.btrim(p_value)
    AND p_value <> ''
    AND pg_catalog.char_length(p_value) <= 500
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_memory_fact_value_is_valid(
  p_fact_key platform.ai_memory_fact_key,
  p_status platform.ai_memory_fact_status,
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
BEGIN
  IF p_status = 'retracted' THEN
    RETURN p_value IS NULL;
  END IF;

  IF p_value IS NULL
    OR pg_catalog.char_length(p_value::TEXT) > 10000
  THEN
    RETURN FALSE;
  END IF;

  IF p_fact_key IN ('blockers', 'unanswered_questions') THEN
    IF pg_catalog.jsonb_typeof(p_value) <> 'array'
      OR pg_catalog.jsonb_array_length(p_value) NOT BETWEEN 1 AND 20
    THEN
      RETURN FALSE;
    END IF;

    FOR item IN
      SELECT array_item.value
      FROM pg_catalog.jsonb_array_elements(p_value) AS array_item(value)
    LOOP
      IF pg_catalog.jsonb_typeof(item) <> 'string' THEN
        RETURN FALSE;
      END IF;

      item_text := item #>> '{}';
      IF item_text <> pg_catalog.btrim(item_text)
        OR item_text = ''
        OR pg_catalog.char_length(item_text) > 500
        OR item_text = ANY(seen)
      THEN
        RETURN FALSE;
      END IF;
      seen := pg_catalog.array_append(seen, item_text);
    END LOOP;

    RETURN TRUE;
  END IF;

  item_text := p_value #>> '{}';
  RETURN pg_catalog.jsonb_typeof(p_value) = 'string'
    AND item_text = pg_catalog.btrim(item_text)
    AND item_text <> ''
    AND pg_catalog.char_length(item_text) <= 500;
END
$$;

CREATE OR REPLACE FUNCTION
platform_private.ai_memory_missing_fact_keys_are_valid(
  p_keys platform.ai_memory_fact_key[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  fact_key platform.ai_memory_fact_key;
  seen platform.ai_memory_fact_key[] :=
    ARRAY[]::platform.ai_memory_fact_key[];
BEGIN
  IF p_keys IS NULL OR pg_catalog.cardinality(p_keys) > 9 THEN
    RETURN FALSE;
  END IF;

  FOREACH fact_key IN ARRAY p_keys LOOP
    IF fact_key IS NULL OR fact_key = ANY(seen) THEN
      RETURN FALSE;
    END IF;
    seen := pg_catalog.array_append(seen, fact_key);
  END LOOP;

  RETURN TRUE;
END
$$;

CREATE TABLE platform_private.conversation_ai_memory_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  short_summary TEXT NOT NULL CHECK (
    short_summary = btrim(short_summary)
    AND char_length(short_summary) BETWEEN 1 AND 1000
  ),
  long_summary TEXT NOT NULL CHECK (
    long_summary = btrim(long_summary)
    AND char_length(long_summary) BETWEEN 1 AND 6000
  ),
  short_summary_sha256 TEXT NOT NULL CHECK (
    short_summary_sha256 =
      platform_private.ai_memory_text_sha256(short_summary)
  ),
  long_summary_sha256 TEXT NOT NULL CHECK (
    long_summary_sha256 =
      platform_private.ai_memory_text_sha256(long_summary)
  ),
  source_message_id UUID NOT NULL,
  recorded_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_ai_memory_versions_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_ai_memory_versions_scope_version_key
    UNIQUE (organization_id, conversation_id, version),
  CONSTRAINT conversation_ai_memory_versions_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_memory_versions_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_memory_versions_actor_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX conversation_ai_memory_versions_latest_idx
  ON platform_private.conversation_ai_memory_versions (
    organization_id,
    conversation_id,
    version DESC
  );

CREATE TABLE platform_private.conversation_ai_fact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  fact_key platform.ai_memory_fact_key NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.ai_memory_fact_status NOT NULL,
  fact_value JSONB,
  fact_value_sha256 TEXT NOT NULL CHECK (
    fact_value_sha256 = platform_private.ai_memory_json_sha256(
      COALESCE(fact_value, 'null'::JSONB)
    )
  ),
  source_message_id UUID NOT NULL,
  recorded_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_ai_fact_versions_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_ai_fact_versions_scope_version_key
    UNIQUE (organization_id, conversation_id, fact_key, version),
  CONSTRAINT conversation_ai_fact_versions_value_check CHECK (
    platform_private.ai_memory_fact_value_is_valid(
      fact_key,
      status,
      fact_value
    )
  ),
  CONSTRAINT conversation_ai_fact_versions_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_fact_versions_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_fact_versions_actor_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX conversation_ai_fact_versions_latest_idx
  ON platform_private.conversation_ai_fact_versions (
    organization_id,
    conversation_id,
    fact_key,
    version DESC
  );

CREATE TABLE platform_private.conversation_ai_qualification_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.ai_qualification_status NOT NULL,
  completeness SMALLINT NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  missing_fact_keys platform.ai_memory_fact_key[] NOT NULL DEFAULT
    ARRAY[]::platform.ai_memory_fact_key[],
  notes TEXT CHECK (
    notes IS NULL OR (
      notes = btrim(notes)
      AND char_length(notes) BETWEEN 1 AND 2000
    )
  ),
  notes_sha256 TEXT CHECK (
    (notes IS NULL AND notes_sha256 IS NULL)
    OR notes_sha256 = platform_private.ai_memory_text_sha256(notes)
  ),
  source_message_id UUID NOT NULL,
  recorded_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_ai_qualification_versions_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_ai_qualification_scope_version_key
    UNIQUE (organization_id, conversation_id, version),
  CONSTRAINT conversation_ai_qualification_missing_keys_check CHECK (
    platform_private.ai_memory_missing_fact_keys_are_valid(
      missing_fact_keys
    )
  ),
  CONSTRAINT conversation_ai_qualification_confirmed_check CHECK (
    status <> 'staff_confirmed'
    OR (
      completeness = 100
      AND cardinality(missing_fact_keys) = 0
    )
  ),
  CONSTRAINT conversation_ai_qualification_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_qualification_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_qualification_actor_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX conversation_ai_qualification_latest_idx
  ON platform_private.conversation_ai_qualification_versions (
    organization_id,
    conversation_id,
    version DESC
  );

CREATE TABLE platform_private.conversation_ai_control_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  previous_state platform.ai_control_state NOT NULL,
  new_state platform.ai_control_state NOT NULL,
  autonomous_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    autonomous_authority = FALSE
  ),
  recorded_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_ai_control_events_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_ai_control_scope_version_key
    UNIQUE (organization_id, conversation_id, version),
  CONSTRAINT conversation_ai_control_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_ai_control_actor_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX conversation_ai_control_events_latest_idx
  ON platform_private.conversation_ai_control_events (
    organization_id,
    conversation_id,
    version DESC
  );

CREATE TABLE platform_private.approved_knowledge_chunk_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  knowledge_version_id UUID NOT NULL,
  chunker_version TEXT NOT NULL CHECK (
    chunker_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  source_content_sha256 TEXT NOT NULL CHECK (
    source_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 200),
  published_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT approved_knowledge_chunk_sets_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT approved_knowledge_chunk_sets_parent_key
    UNIQUE (organization_id, id, knowledge_version_id),
  CONSTRAINT approved_knowledge_chunk_sets_version_key
    UNIQUE (organization_id, knowledge_version_id),
  CONSTRAINT approved_knowledge_chunk_sets_version_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT approved_knowledge_chunk_sets_actor_fkey
    FOREIGN KEY (organization_id, published_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.approved_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  chunk_set_id UUID NOT NULL,
  knowledge_version_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 199),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
  content_text TEXT NOT NULL CHECK (
    content_text <> '' AND char_length(content_text) <= 4000
  ),
  content_sha256 TEXT NOT NULL CHECK (
    content_sha256 = platform_private.ai_memory_text_sha256(content_text)
  ),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', content_text)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT approved_knowledge_chunks_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT approved_knowledge_chunks_parent_key
    UNIQUE (organization_id, id, knowledge_version_id),
  CONSTRAINT approved_knowledge_chunks_version_index_key
    UNIQUE (organization_id, knowledge_version_id, chunk_index),
  CONSTRAINT approved_knowledge_chunks_set_fkey
    FOREIGN KEY (
      organization_id,
      chunk_set_id,
      knowledge_version_id
    )
    REFERENCES platform_private.approved_knowledge_chunk_sets(
      organization_id,
      id,
      knowledge_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT approved_knowledge_chunks_version_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX approved_knowledge_chunks_fts_idx
  ON platform_private.approved_knowledge_chunks
  USING GIN (search_vector);

CREATE TABLE platform_private.approved_knowledge_chunk_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  knowledge_version_id UUID NOT NULL,
  chunk_id UUID NOT NULL,
  embedding_provider TEXT NOT NULL DEFAULT 'google' CHECK (
    embedding_provider = 'google'
  ),
  embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2' CHECK (
    embedding_model = 'gemini-embedding-2'
  ),
  embedding_dimensions INTEGER NOT NULL DEFAULT 1536 CHECK (
    embedding_dimensions = 1536
  ),
  embedding public.vector(1536) NOT NULL,
  chunk_content_sha256 TEXT NOT NULL CHECK (
    chunk_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  provider_evidence_ref TEXT NOT NULL CHECK (
    provider_evidence_ref = btrim(provider_evidence_ref)
    AND char_length(provider_evidence_ref) BETWEEN 1 AND 255
  ),
  provider_observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT approved_knowledge_chunk_embeddings_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT approved_knowledge_chunk_embeddings_observation_key
    UNIQUE (organization_id, chunk_id, embedding_model),
  CONSTRAINT approved_knowledge_chunk_embeddings_chunk_fkey
    FOREIGN KEY (organization_id, chunk_id, knowledge_version_id)
    REFERENCES platform_private.approved_knowledge_chunks(
      organization_id,
      id,
      knowledge_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT approved_knowledge_chunk_embeddings_version_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.ai_retrieval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  mode platform.ai_retrieval_mode NOT NULL,
  outcome platform.ai_retrieval_outcome NOT NULL,
  query_sha256 TEXT NOT NULL CHECK (query_sha256 ~ '^[0-9a-f]{64}$'),
  requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 1 AND 10),
  degraded BOOLEAN NOT NULL,
  autonomous_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    autonomous_authority = FALSE
  ),
  requested_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    platform_private.ai_memory_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_retrieval_requests_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_retrieval_requests_provenance_key
    UNIQUE (
      organization_id,
      id,
      conversation_id,
      source_message_id
    ),
  CONSTRAINT ai_retrieval_requests_mode_check CHECK (
    (mode = 'lexical_preview' AND degraded = TRUE)
    OR (mode = 'semantic' AND degraded = FALSE)
  ),
  CONSTRAINT ai_retrieval_requests_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_retrieval_requests_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_retrieval_requests_actor_fkey
    FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX ai_retrieval_requests_latest_idx
  ON platform_private.ai_retrieval_requests (
    organization_id,
    conversation_id,
    created_at DESC,
    id
  );

CREATE TABLE platform_private.ai_retrieval_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  retrieval_request_id UUID NOT NULL,
  knowledge_version_id UUID NOT NULL,
  chunk_id UUID NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
  lexical_score REAL NOT NULL CHECK (lexical_score >= 0),
  chunk_content_sha256 TEXT NOT NULL CHECK (
    chunk_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_retrieval_evidence_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_retrieval_evidence_request_ordinal_key
    UNIQUE (organization_id, retrieval_request_id, ordinal),
  CONSTRAINT ai_retrieval_evidence_request_fkey
    FOREIGN KEY (
      organization_id,
      retrieval_request_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform_private.ai_retrieval_requests(
      organization_id,
      id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_retrieval_evidence_chunk_fkey
    FOREIGN KEY (organization_id, chunk_id, knowledge_version_id)
    REFERENCES platform_private.approved_knowledge_chunks(
      organization_id,
      id,
      knowledge_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_retrieval_evidence_version_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX ai_retrieval_evidence_request_idx
  ON platform_private.ai_retrieval_evidence (
    organization_id,
    retrieval_request_id,
    ordinal
  );

ALTER TABLE platform_private.conversation_ai_memory_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_memory_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_fact_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_fact_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_qualification_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_qualification_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_control_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_ai_control_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunk_sets
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunk_sets
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunks
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunks
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunk_embeddings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.approved_knowledge_chunk_embeddings
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.ai_retrieval_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.ai_retrieval_requests
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.ai_retrieval_evidence
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.ai_retrieval_evidence
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER conversation_ai_memory_versions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.conversation_ai_memory_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_ai_memory_versions_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.conversation_ai_memory_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER conversation_ai_fact_versions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.conversation_ai_fact_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_ai_fact_versions_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.conversation_ai_fact_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER conversation_ai_qualification_versions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.conversation_ai_qualification_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_ai_qualification_versions_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.conversation_ai_qualification_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER conversation_ai_control_events_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.conversation_ai_control_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_ai_control_events_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.conversation_ai_control_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER approved_knowledge_chunk_sets_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.approved_knowledge_chunk_sets
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER approved_knowledge_chunk_sets_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.approved_knowledge_chunk_sets
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER approved_knowledge_chunks_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.approved_knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER approved_knowledge_chunks_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.approved_knowledge_chunks
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER approved_knowledge_chunk_embeddings_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.approved_knowledge_chunk_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER approved_knowledge_chunk_embeddings_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.approved_knowledge_chunk_embeddings
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER ai_retrieval_requests_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.ai_retrieval_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_retrieval_requests_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.ai_retrieval_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER ai_retrieval_evidence_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.ai_retrieval_evidence
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_retrieval_evidence_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.ai_retrieval_evidence
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON TABLE
  platform_private.conversation_ai_memory_versions,
  platform_private.conversation_ai_fact_versions,
  platform_private.conversation_ai_qualification_versions,
  platform_private.conversation_ai_control_events,
  platform_private.approved_knowledge_chunk_sets,
  platform_private.approved_knowledge_chunks,
  platform_private.approved_knowledge_chunk_embeddings,
  platform_private.ai_retrieval_requests,
  platform_private.ai_retrieval_evidence
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TYPE
  platform.ai_memory_fact_key,
  platform.ai_memory_fact_status,
  platform.ai_qualification_status,
  platform.ai_control_state,
  platform.ai_retrieval_mode,
  platform.ai_retrieval_outcome
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.ai_memory_text_sha256(TEXT),
  platform_private.ai_memory_json_sha256(JSONB),
  platform_private.ai_memory_reason_is_valid(TEXT),
  platform_private.ai_memory_fact_value_is_valid(
    platform.ai_memory_fact_key,
    platform.ai_memory_fact_status,
    JSONB
  ),
  platform_private.ai_memory_missing_fact_keys_are_valid(
    platform.ai_memory_fact_key[]
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.ai_retrieval_safe_rows(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_retrieval_request_id UUID
)
RETURNS TABLE (
  retrieval_request_id UUID,
  source_message_id UUID,
  retrieval_mode TEXT,
  retrieval_outcome TEXT,
  degraded BOOLEAN,
  provider_proof_state TEXT,
  autonomous_authority BOOLEAN,
  knowledge_key TEXT,
  knowledge_version BIGINT,
  knowledge_title TEXT,
  evidence_ordinal INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    request.id,
    request.source_message_id,
    request.mode::TEXT,
    request.outcome::TEXT,
    request.degraded,
    'blocked'::TEXT,
    FALSE,
    evidence.knowledge_key,
    evidence.knowledge_version,
    evidence.knowledge_title,
    evidence.ordinal,
    request.created_at
  FROM platform_private.ai_retrieval_requests AS request
  LEFT JOIN LATERAL (
    SELECT
      knowledge.knowledge_key,
      knowledge.version AS knowledge_version,
      knowledge.title AS knowledge_title,
      stored.ordinal
    FROM platform_private.ai_retrieval_evidence AS stored
    -- Resolve the immutable version selected by this request. A later approval
    -- for the same key must not rewrite or suppress historical evidence.
    JOIN platform.approved_knowledge_versions AS knowledge
      ON knowledge.organization_id = stored.organization_id
      AND knowledge.id = stored.knowledge_version_id
      AND knowledge.status = 'approved'
    WHERE stored.organization_id = request.organization_id
      AND stored.retrieval_request_id = request.id
    ORDER BY stored.ordinal
  ) AS evidence ON TRUE
  WHERE request.organization_id = p_organization_id
    AND request.conversation_id = p_conversation_id
    AND request.id = p_retrieval_request_id
  ORDER BY evidence.ordinal NULLS FIRST
$$;

REVOKE ALL ON FUNCTION platform_private.ai_retrieval_safe_rows(
  UUID,
  UUID,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.ai_lexical_or_query(
  p_value TEXT
)
RETURNS TSQUERY
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.count(*) = 0 THEN NULL::TSQUERY
    ELSE pg_catalog.to_tsquery(
      'simple',
      pg_catalog.string_agg(
        pg_catalog.quote_literal(lexeme.value),
        ' | '
        ORDER BY lexeme.value
      )
    )
  END
  FROM pg_catalog.unnest(
    pg_catalog.tsvector_to_array(
      pg_catalog.to_tsvector('simple', p_value)
    )
  ) AS lexeme(value)
$$;

REVOKE ALL ON FUNCTION platform_private.ai_lexical_or_query(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.record_conversation_ai_memory(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_expected_version BIGINT,
  p_short_summary TEXT,
  p_long_summary TEXT,
  p_source_message_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  safe_short_summary TEXT;
  safe_long_summary TEXT;
  fixed_reason TEXT;
  current_version BIGINT;
  next_version BIGINT;
  request_fingerprint TEXT;
  replayed JSONB;
  result JSONB;
  recorded_at TIMESTAMPTZ;
BEGIN
  safe_short_summary := pg_catalog.btrim(p_short_summary);
  safe_long_summary := pg_catalog.btrim(p_long_summary);
  fixed_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version < 0
    OR p_short_summary IS NULL
    OR p_long_summary IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR safe_short_summary = ''
    OR pg_catalog.char_length(safe_short_summary) > 1000
    OR safe_long_summary = ''
    OR pg_catalog.char_length(safe_long_summary) > 6000
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Conversation AI memory input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.id = p_source_message_id
  ) THEN
    RAISE EXCEPTION 'Source communication message is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:memory:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'expected_version', p_expected_version,
      'short_summary_sha256',
        platform_private.ai_memory_text_sha256(safe_short_summary),
      'long_summary_sha256',
        platform_private.ai_memory_text_sha256(safe_long_summary),
      'source_message_id', p_source_message_id
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.memory.record',
    'conversation_ai_memory',
    p_conversation_id,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_fingerprint_sha256';
  END IF;

  SELECT COALESCE(pg_catalog.max(memory.version), 0)
  INTO current_version
  FROM platform_private.conversation_ai_memory_versions AS memory
  WHERE memory.organization_id = p_organization_id
    AND memory.conversation_id = p_conversation_id;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION
      'Conversation AI memory version conflict: expected %, current %',
      p_expected_version,
      current_version
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  recorded_at := pg_catalog.statement_timestamp();

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
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    next_version,
    safe_short_summary,
    safe_long_summary,
    platform_private.ai_memory_text_sha256(safe_short_summary),
    platform_private.ai_memory_text_sha256(safe_long_summary),
    p_source_message_id,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    recorded_at
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'version', next_version,
    'source_message_id', p_source_message_id,
    'created_at', recorded_at
  );

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
    'ai.memory.record',
    'conversation_ai_memory',
    p_conversation_id,
    pg_catalog.jsonb_build_object('version', current_version),
    result || pg_catalog.jsonb_build_object(
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_conversation_ai_fact(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_fact_key TEXT,
  p_expected_version BIGINT,
  p_status TEXT,
  p_value JSONB,
  p_source_message_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_fact_key platform.ai_memory_fact_key;
  normalized_status platform.ai_memory_fact_status;
  normalized_value JSONB;
  fixed_reason TEXT;
  current_version BIGINT;
  next_version BIGINT;
  request_fingerprint TEXT;
  replayed JSONB;
  result JSONB;
  recorded_at TIMESTAMPTZ;
BEGIN
  fixed_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_fact_key IS NULL
    OR p_fact_key <> pg_catalog.btrim(p_fact_key)
    OR p_status IS NULL
    OR p_status <> pg_catalog.btrim(p_status)
    OR p_expected_version IS NULL
    OR p_expected_version < 0
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Conversation AI fact input is invalid'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    normalized_fact_key := p_fact_key::platform.ai_memory_fact_key;
    normalized_status := p_status::platform.ai_memory_fact_status;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Conversation AI fact key or status is invalid'
        USING ERRCODE = '22023';
  END;

  normalized_value := CASE
    WHEN normalized_status = 'retracted'
      AND (p_value IS NULL OR p_value = 'null'::JSONB)
      THEN NULL
    ELSE p_value
  END;

  IF NOT platform_private.ai_memory_fact_value_is_valid(
    normalized_fact_key,
    normalized_status,
    normalized_value
  ) THEN
    RAISE EXCEPTION 'Conversation AI fact value is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.id = p_source_message_id
  ) THEN
    RAISE EXCEPTION 'Source communication message is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:fact:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT
        || ':'
        || normalized_fact_key::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'fact_key', normalized_fact_key,
      'expected_version', p_expected_version,
      'status', normalized_status,
      'value_sha256', platform_private.ai_memory_json_sha256(
        COALESCE(normalized_value, 'null'::JSONB)
      ),
      'source_message_id', p_source_message_id
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.fact.record',
    'conversation_ai_fact',
    p_conversation_id,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'fact_key', normalized_fact_key,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_fingerprint_sha256';
  END IF;

  SELECT COALESCE(pg_catalog.max(fact.version), 0)
  INTO current_version
  FROM platform_private.conversation_ai_fact_versions AS fact
  WHERE fact.organization_id = p_organization_id
    AND fact.conversation_id = p_conversation_id
    AND fact.fact_key = normalized_fact_key;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION
      'Conversation AI fact version conflict: expected %, current %',
      p_expected_version,
      current_version
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  recorded_at := pg_catalog.statement_timestamp();

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
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    normalized_fact_key,
    next_version,
    normalized_status,
    normalized_value,
    platform_private.ai_memory_json_sha256(
      COALESCE(normalized_value, 'null'::JSONB)
    ),
    p_source_message_id,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    recorded_at
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'fact_key', normalized_fact_key,
    'status', normalized_status,
    'version', next_version,
    'source_message_id', p_source_message_id,
    'created_at', recorded_at
  );

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
    'ai.fact.record',
    'conversation_ai_fact',
    p_conversation_id,
    pg_catalog.jsonb_build_object(
      'fact_key', normalized_fact_key,
      'version', current_version
    ),
    result || pg_catalog.jsonb_build_object(
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_conversation_ai_qualification(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_expected_version BIGINT,
  p_status TEXT,
  p_completeness SMALLINT,
  p_missing_fact_keys TEXT[],
  p_notes TEXT,
  p_source_message_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_status platform.ai_qualification_status;
  raw_fact_key TEXT;
  normalized_fact_key platform.ai_memory_fact_key;
  supplied_missing platform.ai_memory_fact_key[] :=
    ARRAY[]::platform.ai_memory_fact_key[];
  normalized_missing platform.ai_memory_fact_key[] :=
    ARRAY[]::platform.ai_memory_fact_key[];
  safe_notes TEXT;
  fixed_reason TEXT;
  current_version BIGINT;
  next_version BIGINT;
  request_fingerprint TEXT;
  replayed JSONB;
  result JSONB;
  recorded_at TIMESTAMPTZ;
BEGIN
  fixed_reason := pg_catalog.btrim(p_reason);
  safe_notes := CASE
    WHEN p_notes IS NULL THEN NULL
    ELSE pg_catalog.btrim(p_notes)
  END;

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version < 0
    OR p_status IS NULL
    OR p_status <> pg_catalog.btrim(p_status)
    OR p_completeness IS NULL
    OR p_completeness NOT BETWEEN 0 AND 100
    OR p_missing_fact_keys IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
    OR (
      p_notes IS NOT NULL
      AND (
        safe_notes = ''
        OR pg_catalog.char_length(safe_notes) > 2000
      )
    )
  THEN
    RAISE EXCEPTION 'Conversation AI qualification input is invalid'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    normalized_status := p_status::platform.ai_qualification_status;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Conversation AI qualification status is invalid'
        USING ERRCODE = '22023';
  END;

  FOREACH raw_fact_key IN ARRAY p_missing_fact_keys LOOP
    IF raw_fact_key IS NULL
      OR raw_fact_key <> pg_catalog.btrim(raw_fact_key)
    THEN
      RAISE EXCEPTION 'Missing AI fact key is invalid'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      normalized_fact_key := raw_fact_key::platform.ai_memory_fact_key;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Missing AI fact key is invalid'
          USING ERRCODE = '22023';
    END;
    supplied_missing := pg_catalog.array_append(
      supplied_missing,
      normalized_fact_key
    );
  END LOOP;

  IF NOT platform_private.ai_memory_missing_fact_keys_are_valid(
    supplied_missing
  ) THEN
    RAISE EXCEPTION 'Missing AI fact keys are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(ordered.fact_key ORDER BY ordered.ordinal),
    ARRAY[]::platform.ai_memory_fact_key[]
  )
  INTO normalized_missing
  FROM pg_catalog.unnest(
    pg_catalog.enum_range(NULL::platform.ai_memory_fact_key)
  ) WITH ORDINALITY AS ordered(fact_key, ordinal)
  WHERE ordered.fact_key = ANY(supplied_missing);

  IF normalized_status = 'staff_confirmed'
    AND (
      p_completeness <> 100
      OR pg_catalog.cardinality(normalized_missing) <> 0
    )
  THEN
    RAISE EXCEPTION
      'Staff-confirmed qualification must be complete with no missing facts'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.id = p_source_message_id
  ) THEN
    RAISE EXCEPTION 'Source communication message is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:qualification:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'expected_version', p_expected_version,
      'status', normalized_status,
      'completeness', p_completeness,
      'missing_fact_keys', normalized_missing,
      'notes_sha256', CASE
        WHEN safe_notes IS NULL THEN NULL
        ELSE platform_private.ai_memory_text_sha256(safe_notes)
      END,
      'source_message_id', p_source_message_id
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.qualification.record',
    'conversation_ai_qualification',
    p_conversation_id,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_fingerprint_sha256';
  END IF;

  SELECT COALESCE(pg_catalog.max(qualification.version), 0)
  INTO current_version
  FROM platform_private.conversation_ai_qualification_versions
    AS qualification
  WHERE qualification.organization_id = p_organization_id
    AND qualification.conversation_id = p_conversation_id;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION
      'Conversation AI qualification version conflict: expected %, current %',
      p_expected_version,
      current_version
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  recorded_at := pg_catalog.statement_timestamp();

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
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    next_version,
    normalized_status,
    p_completeness,
    normalized_missing,
    safe_notes,
    CASE
      WHEN safe_notes IS NULL THEN NULL
      ELSE platform_private.ai_memory_text_sha256(safe_notes)
    END,
    p_source_message_id,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    recorded_at
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'status', normalized_status,
    'version', next_version,
    'completeness', p_completeness,
    'missing_fact_keys', normalized_missing,
    'source_message_id', p_source_message_id,
    'created_at', recorded_at
  );

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
    'ai.qualification.record',
    'conversation_ai_qualification',
    p_conversation_id,
    pg_catalog.jsonb_build_object('version', current_version),
    result || pg_catalog.jsonb_build_object(
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.set_conversation_ai_control(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_expected_version BIGINT,
  p_state TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_state platform.ai_control_state;
  previous_state platform.ai_control_state := 'paused';
  fixed_reason TEXT;
  current_version BIGINT;
  next_version BIGINT;
  request_fingerprint TEXT;
  replayed JSONB;
  result JSONB;
  recorded_at TIMESTAMPTZ;
BEGIN
  fixed_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version < 0
    OR p_state IS NULL
    OR p_state <> pg_catalog.btrim(p_state)
    OR p_request_id IS NULL
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Conversation AI control input is invalid'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    normalized_state := p_state::platform.ai_control_state;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Conversation AI control state is invalid'
        USING ERRCODE = '22023';
  END;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:control:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'expected_version', p_expected_version,
      'state', normalized_state
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.control.set',
    'conversation_ai_control',
    p_conversation_id,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_fingerprint_sha256';
  END IF;

  SELECT control.version, control.new_state
  INTO current_version, previous_state
  FROM platform_private.conversation_ai_control_events AS control
  WHERE control.organization_id = p_organization_id
    AND control.conversation_id = p_conversation_id
  ORDER BY control.version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    current_version := 0;
    previous_state := 'paused';
  END IF;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION
      'Conversation AI control version conflict: expected %, current %',
      p_expected_version,
      current_version
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  recorded_at := pg_catalog.statement_timestamp();

  INSERT INTO platform_private.conversation_ai_control_events (
    organization_id,
    conversation_id,
    version,
    previous_state,
    new_state,
    autonomous_authority,
    recorded_by_membership_id,
    reason,
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    next_version,
    previous_state,
    normalized_state,
    FALSE,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    recorded_at
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'version', next_version,
    'state', normalized_state,
    'reason', fixed_reason,
    'created_at', recorded_at,
    'autonomous_authority', FALSE
  );

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
    'ai.control.set',
    'conversation_ai_control',
    p_conversation_id,
    pg_catalog.jsonb_build_object(
      'version', current_version,
      'state', previous_state,
      'autonomous_authority', FALSE
    ),
    result || pg_catalog.jsonb_build_object(
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_conversation_ai_memory(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  memory_version BIGINT,
  memory_short_summary TEXT,
  memory_long_summary TEXT,
  memory_source_message_id UUID,
  facts JSONB,
  qualification_version BIGINT,
  qualification_status TEXT,
  qualification_completeness SMALLINT,
  qualification_missing_fact_keys TEXT[],
  qualification_notes TEXT,
  qualification_source_message_id UUID,
  control_version BIGINT,
  control_state TEXT,
  control_reason TEXT,
  latest_retrieval_request_id UUID,
  latest_retrieval_outcome TEXT,
  latest_retrieval_created_at TIMESTAMPTZ,
  autonomous_authority BOOLEAN
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
    'communication.read.full'
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
  WITH latest_memory AS MATERIALIZED (
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
      fact.version,
      fact.source_message_id,
      fact.created_at
    FROM platform_private.conversation_ai_fact_versions AS fact
    WHERE fact.organization_id = p_organization_id
      AND fact.conversation_id = p_conversation_id
    ORDER BY fact.fact_key, fact.version DESC
  ),
  safe_facts AS MATERIALIZED (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'fact_key', current.fact_key::TEXT,
          'status', current.status::TEXT,
          'value', current.fact_value,
          'version', current.version,
          'source_message_id', current.source_message_id,
          'created_at', current.created_at
        )
        ORDER BY pg_catalog.array_position(
          pg_catalog.enum_range(NULL::platform.ai_memory_fact_key),
          current.fact_key
        )
      ),
      '[]'::JSONB
    ) AS items
    FROM current_facts AS current
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
    ORDER BY retrieval.created_at DESC, retrieval.id DESC
    LIMIT 1
  ),
  all_fact_keys AS MATERIALIZED (
    SELECT pg_catalog.array_agg(key_value.fact_key::TEXT ORDER BY key_value.ordinal)
      AS values
    FROM pg_catalog.unnest(
      pg_catalog.enum_range(NULL::platform.ai_memory_fact_key)
    ) WITH ORDINALITY AS key_value(fact_key, ordinal)
  )
  SELECT
    p_conversation_id,
    COALESCE(memory.version, 0),
    memory.short_summary,
    memory.long_summary,
    memory.source_message_id,
    safe_facts.items,
    COALESCE(qualification.version, 0),
    COALESCE(qualification.status::TEXT, 'collecting'),
    COALESCE(qualification.completeness, 0::SMALLINT),
    COALESCE(
      qualification.missing_fact_keys::TEXT[],
      all_fact_keys.values
    ),
    qualification.notes,
    qualification.source_message_id,
    COALESCE(control.version, 0),
    COALESCE(control.new_state::TEXT, 'paused'),
    COALESCE(control.reason, 'no_control_event'),
    retrieval.id,
    retrieval.outcome::TEXT,
    retrieval.created_at,
    FALSE
  FROM safe_facts
  CROSS JOIN all_fact_keys
  LEFT JOIN latest_memory AS memory ON TRUE
  LEFT JOIN latest_qualification AS qualification ON TRUE
  LEFT JOIN latest_control AS control ON TRUE
  LEFT JOIN latest_retrieval AS retrieval ON TRUE;
END
$$;

CREATE OR REPLACE FUNCTION platform.publish_approved_knowledge_chunk_set(
  p_organization_id UUID,
  p_knowledge_version_id UUID,
  p_chunker_version TEXT,
  p_chunks JSONB,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  chunk_item JSONB;
  chunk_index INTEGER;
  start_offset INTEGER;
  end_offset INTEGER;
  previous_start_offset INTEGER := -1;
  content_text TEXT;
  content_sha256 TEXT;
  expected_chunk_index INTEGER := 0;
  chunk_count INTEGER;
  chunk_set_id UUID := gen_random_uuid();
  safe_chunker_version TEXT;
  fixed_reason TEXT;
  request_fingerprint TEXT;
  replayed JSONB;
  result JSONB;
  published_at TIMESTAMPTZ;
BEGIN
  safe_chunker_version := pg_catalog.btrim(p_chunker_version);
  fixed_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_knowledge_version_id IS NULL
    OR p_request_id IS NULL
    OR safe_chunker_version IS NULL
    OR safe_chunker_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    OR p_chunks IS NULL
    OR pg_catalog.jsonb_typeof(p_chunks) <> 'array'
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Approved knowledge chunk-set input is invalid'
      USING ERRCODE = '22023';
  END IF;

  chunk_count := pg_catalog.jsonb_array_length(p_chunks);
  IF chunk_count NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Approved knowledge chunk count is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR chunk_item IN
    SELECT array_item.value
    FROM pg_catalog.jsonb_array_elements(p_chunks) AS array_item(value)
  LOOP
    IF pg_catalog.jsonb_typeof(chunk_item) <> 'object'
      OR NOT (chunk_item ?& ARRAY[
        'chunk_index',
        'start_offset',
        'end_offset',
        'content_text',
        'content_sha256'
      ]::TEXT[])
      OR chunk_item - ARRAY[
        'chunk_index',
        'start_offset',
        'end_offset',
        'content_text',
        'content_sha256'
      ]::TEXT[] <> '{}'::JSONB
      OR pg_catalog.jsonb_typeof(chunk_item -> 'chunk_index') <> 'number'
      OR pg_catalog.jsonb_typeof(chunk_item -> 'start_offset') <> 'number'
      OR pg_catalog.jsonb_typeof(chunk_item -> 'end_offset') <> 'number'
      OR pg_catalog.jsonb_typeof(chunk_item -> 'content_text') <> 'string'
      OR pg_catalog.jsonb_typeof(chunk_item -> 'content_sha256') <> 'string'
      OR chunk_item ->> 'chunk_index' !~ '^(0|[1-9][0-9]*)$'
      OR chunk_item ->> 'start_offset' !~ '^(0|[1-9][0-9]*)$'
      OR chunk_item ->> 'end_offset' !~ '^(0|[1-9][0-9]*)$'
    THEN
      RAISE EXCEPTION 'Approved knowledge chunk shape is invalid'
        USING ERRCODE = '22023';
    END IF;

    chunk_index := (chunk_item ->> 'chunk_index')::INTEGER;
    start_offset := (chunk_item ->> 'start_offset')::INTEGER;
    end_offset := (chunk_item ->> 'end_offset')::INTEGER;
    content_text := chunk_item ->> 'content_text';
    content_sha256 := chunk_item ->> 'content_sha256';

    IF chunk_index <> expected_chunk_index
      OR start_offset <= previous_start_offset
      OR end_offset <= start_offset
      OR content_text = ''
      OR pg_catalog.char_length(content_text) > 4000
      OR content_sha256 !~ '^[0-9a-f]{64}$'
      OR content_sha256 <>
        platform_private.ai_memory_text_sha256(content_text)
    THEN
      RAISE EXCEPTION 'Approved knowledge chunk content is invalid'
        USING ERRCODE = '22023';
    END IF;

    previous_start_offset := start_offset;
    expected_chunk_index := expected_chunk_index + 1;
  END LOOP;

  SELECT *
  INTO actor
  FROM platform_private.require_p2f_admin_actor(
    p_organization_id,
    'knowledge.manage'
  );

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:knowledge-chunks:'
        || p_organization_id::TEXT
        || ':'
        || p_knowledge_version_id::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'knowledge_version_id', p_knowledge_version_id,
      'chunker_version', safe_chunker_version,
      'chunks_sha256', platform_private.ai_memory_json_sha256(p_chunks),
      'published_by_membership_id', actor.actor_membership_id
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'knowledge.chunkset.publish',
    'approved_knowledge_chunk_set',
    p_knowledge_version_id,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'knowledge_version_id', p_knowledge_version_id,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_fingerprint_sha256';
  END IF;

  SELECT *
  INTO knowledge_row
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.id = p_knowledge_version_id
    AND knowledge.status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.approved_knowledge_versions AS newer
      WHERE newer.organization_id = knowledge.organization_id
        AND newer.knowledge_key = knowledge.knowledge_key
        AND newer.status = 'approved'
        AND newer.version > knowledge.version
    )
  FOR SHARE;

  IF NOT FOUND
    OR knowledge_row.content_sha256 <>
      platform_private.ai_memory_text_sha256(knowledge_row.content_text)
  THEN
    RAISE EXCEPTION 'Current approved knowledge version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  FOR chunk_item IN
    SELECT array_item.value
    FROM pg_catalog.jsonb_array_elements(p_chunks) AS array_item(value)
    ORDER BY (array_item.value ->> 'chunk_index')::INTEGER
  LOOP
    chunk_index := (chunk_item ->> 'chunk_index')::INTEGER;
    start_offset := (chunk_item ->> 'start_offset')::INTEGER;
    end_offset := (chunk_item ->> 'end_offset')::INTEGER;
    content_text := chunk_item ->> 'content_text';
    content_sha256 := chunk_item ->> 'content_sha256';

    IF end_offset > pg_catalog.char_length(knowledge_row.content_text)
      OR pg_catalog.substr(
        knowledge_row.content_text,
        start_offset + 1,
        end_offset - start_offset
      ) <> content_text
    THEN
      RAISE EXCEPTION
        'Approved knowledge chunk must be an exact approved-text substring'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM platform_private.approved_knowledge_chunk_sets AS existing
    WHERE existing.organization_id = p_organization_id
      AND existing.knowledge_version_id = p_knowledge_version_id
  ) THEN
    RAISE EXCEPTION 'Approved knowledge version already has a chunk set'
      USING ERRCODE = '55000';
  END IF;

  published_at := pg_catalog.statement_timestamp();

  INSERT INTO platform_private.approved_knowledge_chunk_sets (
    id,
    organization_id,
    knowledge_version_id,
    chunker_version,
    source_content_sha256,
    chunk_count,
    published_by_membership_id,
    reason,
    request_id,
    created_at
  )
  VALUES (
    chunk_set_id,
    p_organization_id,
    p_knowledge_version_id,
    safe_chunker_version,
    knowledge_row.content_sha256,
    chunk_count,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    published_at
  );

  INSERT INTO platform_private.approved_knowledge_chunks (
    organization_id,
    chunk_set_id,
    knowledge_version_id,
    chunk_index,
    start_offset,
    end_offset,
    content_text,
    content_sha256,
    created_at
  )
  SELECT
    p_organization_id,
    chunk_set_id,
    p_knowledge_version_id,
    (item.value ->> 'chunk_index')::INTEGER,
    (item.value ->> 'start_offset')::INTEGER,
    (item.value ->> 'end_offset')::INTEGER,
    item.value ->> 'content_text',
    item.value ->> 'content_sha256',
    published_at
  FROM pg_catalog.jsonb_array_elements(p_chunks) AS item(value)
  ORDER BY (item.value ->> 'chunk_index')::INTEGER;

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'knowledge_version_id', p_knowledge_version_id,
    'knowledge_key', knowledge_row.knowledge_key,
    'knowledge_version', knowledge_row.version,
    'chunk_count', chunk_count,
    'created_at', published_at
  );

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
    'knowledge.chunkset.publish',
    'approved_knowledge_chunk_set',
    p_knowledge_version_id,
    NULL,
    result || pg_catalog.jsonb_build_object(
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.preview_approved_knowledge_lexical(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_ref TEXT,
  p_limit INTEGER,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS TABLE (
  retrieval_request_id UUID,
  source_message_id UUID,
  retrieval_mode TEXT,
  retrieval_outcome TEXT,
  degraded BOOLEAN,
  provider_proof_state TEXT,
  autonomous_authority BOOLEAN,
  knowledge_key TEXT,
  knowledge_version BIGINT,
  knowledge_title TEXT,
  evidence_ordinal INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  exact_source_message_id UUID;
  source_body TEXT;
  lexical_query TSQUERY;
  query_sha256 TEXT;
  candidates JSONB := '[]'::JSONB;
  candidate JSONB;
  match_count INTEGER;
  stored_outcome platform.ai_retrieval_outcome;
  created_retrieval_id UUID := gen_random_uuid();
  fixed_reason TEXT;
  request_fingerprint TEXT;
  replayed JSONB;
  recorded_at TIMESTAMPTZ;
BEGIN
  fixed_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_ref IS NULL
    OR p_source_message_ref <> pg_catalog.btrim(p_source_message_ref)
    OR p_source_message_ref !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 10
    OR p_request_id IS NULL
    OR NOT platform_private.ai_memory_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Lexical approved-knowledge preview input is invalid'
      USING ERRCODE = '22023';
  END IF;

  exact_source_message_id := p_source_message_ref::UUID;
  IF exact_source_message_id::TEXT <> p_source_message_ref THEN
    RAISE EXCEPTION 'Platform source-message reference is not canonical'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  IF NOT COALESCE(
    private.platform_can_read_approved_knowledge(p_organization_id),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Approved knowledge permission is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT message.body_text
  INTO source_body
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
    AND message.id = exact_source_message_id
    AND message.direction = 'inbound';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inbound Platform source message is unavailable'
      USING ERRCODE = '42501';
  END IF;

  lexical_query := platform_private.ai_lexical_or_query(source_body);
  query_sha256 := platform_private.ai_memory_text_sha256(source_body);

  PERFORM platform_private.lock_p2f_request(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f1:retrieval:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT
        || ':'
        || exact_source_message_id::TEXT,
      0
    )
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', exact_source_message_id,
      'requested_limit', p_limit,
      'query_sha256', query_sha256,
      'requested_by_membership_id', actor.actor_membership_id,
      'mode', 'lexical_preview'
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.retrieval.preview',
    'ai_retrieval_request',
    NULL,
    fixed_reason,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', exact_source_message_id,
      'request_fingerprint_sha256', request_fingerprint
    )
  );
  IF replayed IS NOT NULL THEN
    SELECT request.id
    INTO created_retrieval_id
    FROM platform_private.ai_retrieval_requests AS request
    WHERE request.request_id = p_request_id
      AND request.organization_id = p_organization_id
      AND request.conversation_id = p_conversation_id
      AND request.source_message_id = exact_source_message_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Retrieval replay evidence is unavailable'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT *
    FROM platform_private.ai_retrieval_safe_rows(
      p_organization_id,
      p_conversation_id,
      created_retrieval_id
    );
    RETURN;
  END IF;

  IF lexical_query IS NOT NULL THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'chunk_id', ranked.chunk_id,
          'knowledge_version_id', ranked.knowledge_version_id,
          'content_sha256', ranked.content_sha256,
          'lexical_score', ranked.lexical_score,
          'ordinal', ranked.ordinal
        )
        ORDER BY ranked.ordinal
      ),
      '[]'::JSONB
    )
    INTO candidates
    FROM (
      SELECT
        chunk.id AS chunk_id,
        knowledge.id AS knowledge_version_id,
        chunk.content_sha256,
        pg_catalog.ts_rank_cd(
          chunk.search_vector,
          lexical_query
        )::REAL AS lexical_score,
        pg_catalog.row_number() OVER (
          ORDER BY
            pg_catalog.ts_rank_cd(
              chunk.search_vector,
              lexical_query
            ) DESC,
            knowledge.knowledge_key,
            knowledge.version DESC,
            chunk.chunk_index,
            chunk.id
        )::INTEGER AS ordinal
      FROM platform_private.approved_knowledge_chunks AS chunk
      JOIN platform_private.approved_knowledge_chunk_sets AS chunk_set
        ON chunk_set.organization_id = chunk.organization_id
        AND chunk_set.id = chunk.chunk_set_id
        AND chunk_set.knowledge_version_id = chunk.knowledge_version_id
      JOIN platform.approved_knowledge_versions AS knowledge
        ON knowledge.organization_id = chunk.organization_id
        AND knowledge.id = chunk.knowledge_version_id
        AND knowledge.status = 'approved'
        AND knowledge.content_sha256 = chunk_set.source_content_sha256
      WHERE chunk.organization_id = p_organization_id
        AND chunk.search_vector @@ lexical_query
        AND NOT EXISTS (
          SELECT 1
          FROM platform.approved_knowledge_versions AS newer
          WHERE newer.organization_id = knowledge.organization_id
            AND newer.knowledge_key = knowledge.knowledge_key
            AND newer.status = 'approved'
            AND newer.version > knowledge.version
        )
      ORDER BY
        pg_catalog.ts_rank_cd(
          chunk.search_vector,
          lexical_query
        ) DESC,
        knowledge.knowledge_key,
        knowledge.version DESC,
        chunk.chunk_index,
        chunk.id
      LIMIT p_limit
    ) AS ranked;
  END IF;

  match_count := pg_catalog.jsonb_array_length(candidates);
  stored_outcome := CASE
    WHEN match_count = 0 THEN 'no_match'::platform.ai_retrieval_outcome
    ELSE 'completed'::platform.ai_retrieval_outcome
  END;
  recorded_at := pg_catalog.statement_timestamp();

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
    autonomous_authority,
    requested_by_membership_id,
    reason,
    request_id,
    created_at
  )
  VALUES (
    created_retrieval_id,
    p_organization_id,
    p_conversation_id,
    exact_source_message_id,
    'lexical_preview',
    stored_outcome,
    query_sha256,
    p_limit,
    TRUE,
    FALSE,
    actor.actor_membership_id,
    fixed_reason,
    p_request_id,
    recorded_at
  );

  FOR candidate IN
    SELECT candidate_item.value
    FROM pg_catalog.jsonb_array_elements(candidates)
      AS candidate_item(value)
    ORDER BY (candidate_item.value ->> 'ordinal')::INTEGER
  LOOP
    INSERT INTO platform_private.ai_retrieval_evidence (
      organization_id,
      conversation_id,
      source_message_id,
      retrieval_request_id,
      knowledge_version_id,
      chunk_id,
      ordinal,
      lexical_score,
      chunk_content_sha256,
      created_at
    )
    VALUES (
      p_organization_id,
      p_conversation_id,
      exact_source_message_id,
      created_retrieval_id,
      (candidate ->> 'knowledge_version_id')::UUID,
      (candidate ->> 'chunk_id')::UUID,
      (candidate ->> 'ordinal')::INTEGER,
      (candidate ->> 'lexical_score')::REAL,
      candidate ->> 'content_sha256',
      recorded_at
    );
  END LOOP;

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
    'ai.retrieval.preview',
    'ai_retrieval_request',
    created_retrieval_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'retrieval_request_id', created_retrieval_id,
      'source_message_id', exact_source_message_id,
      'retrieval_mode', 'lexical_preview',
      'retrieval_outcome', stored_outcome,
      'evidence_count', match_count,
      'degraded', TRUE,
      'provider_proof_state', 'blocked',
      'autonomous_authority', FALSE,
      'request_fingerprint_sha256', request_fingerprint
    ),
    fixed_reason,
    p_request_id
  );

  RETURN QUERY
  SELECT *
  FROM platform_private.ai_retrieval_safe_rows(
    p_organization_id,
    p_conversation_id,
    created_retrieval_id
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_ai_retrieval_evidence(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_retrieval_request_id UUID
)
RETURNS TABLE (
  retrieval_request_id UUID,
  source_message_id UUID,
  retrieval_mode TEXT,
  retrieval_outcome TEXT,
  degraded BOOLEAN,
  provider_proof_state TEXT,
  autonomous_authority BOOLEAN,
  knowledge_key TEXT,
  knowledge_version BIGINT,
  knowledge_title TEXT,
  evidence_ordinal INTEGER,
  created_at TIMESTAMPTZ
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
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  )
    OR NOT COALESCE(
      private.platform_can_read_approved_knowledge(p_organization_id),
      FALSE
    )
  THEN
    RAISE EXCEPTION 'Retrieval evidence is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.ai_retrieval_requests AS request
    WHERE request.organization_id = p_organization_id
      AND request.conversation_id = p_conversation_id
      AND request.id = p_retrieval_request_id
  ) THEN
    RAISE EXCEPTION 'Retrieval evidence is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM platform_private.ai_retrieval_safe_rows(
    p_organization_id,
    p_conversation_id,
    p_retrieval_request_id
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_ai_retrieval_capabilities(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  provider_ingestion_enabled BOOLEAN,
  semantic_retrieval_enabled BOOLEAN,
  lexical_preview_enabled BOOLEAN,
  lexical_preview_degraded BOOLEAN,
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
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  )
    OR NOT COALESCE(
      private.platform_can_read_approved_knowledge(p_organization_id),
      FALSE
    )
  THEN
    RAISE EXCEPTION 'AI retrieval capabilities are unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    'gemini-embedding-2'::TEXT,
    1536,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    FALSE,
    'blocked'::TEXT;
END
$$;

REVOKE ALL ON FUNCTION
  platform.record_conversation_ai_memory(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    TEXT,
    UUID,
    TEXT,
    UUID
  ),
  platform.record_conversation_ai_fact(
    UUID,
    UUID,
    TEXT,
    BIGINT,
    TEXT,
    JSONB,
    UUID,
    TEXT,
    UUID
  ),
  platform.record_conversation_ai_qualification(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    SMALLINT,
    TEXT[],
    TEXT,
    UUID,
    TEXT,
    UUID
  ),
  platform.set_conversation_ai_control(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_ai_memory(UUID, UUID),
  platform.publish_approved_knowledge_chunk_set(
    UUID,
    UUID,
    TEXT,
    JSONB,
    TEXT,
    UUID
  ),
  platform.preview_approved_knowledge_lexical(
    UUID,
    UUID,
    TEXT,
    INTEGER,
    TEXT,
    UUID
  ),
  platform.staff_ai_retrieval_evidence(UUID, UUID, UUID),
  platform.staff_ai_retrieval_capabilities(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.record_conversation_ai_memory(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    TEXT,
    UUID,
    TEXT,
    UUID
  ),
  platform.record_conversation_ai_fact(
    UUID,
    UUID,
    TEXT,
    BIGINT,
    TEXT,
    JSONB,
    UUID,
    TEXT,
    UUID
  ),
  platform.record_conversation_ai_qualification(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    SMALLINT,
    TEXT[],
    TEXT,
    UUID,
    TEXT,
    UUID
  ),
  platform.set_conversation_ai_control(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_ai_memory(UUID, UUID),
  platform.publish_approved_knowledge_chunk_set(
    UUID,
    UUID,
    TEXT,
    JSONB,
    TEXT,
    UUID
  ),
  platform.preview_approved_knowledge_lexical(
    UUID,
    UUID,
    TEXT,
    INTEGER,
    TEXT,
    UUID
  ),
  platform.staff_ai_retrieval_evidence(UUID, UUID, UUID),
  platform.staff_ai_retrieval_capabilities(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform_private.conversation_ai_memory_versions IS
  'Private append-only conversation AI memory summaries with exact Platform message provenance; never an autonomous authority.';
COMMENT ON TABLE platform_private.conversation_ai_fact_versions IS
  'Private append-only versions of the nine allowlisted conversation AI facts.';
COMMENT ON TABLE platform_private.conversation_ai_qualification_versions IS
  'Private append-only staff qualification assessments; never an amoCRM stage.';
COMMENT ON TABLE platform_private.conversation_ai_control_events IS
  'Private append-only paused/staff-takeover/staff-only events; every P5F1 state has autonomous_authority=false.';
COMMENT ON TABLE platform_private.approved_knowledge_chunk_embeddings IS
  'Private append-only gemini-embedding-2/1536 observation foundation; migration 065 exposes no insertion or semantic execution RPC.';
COMMENT ON FUNCTION platform.preview_approved_knowledge_lexical(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  UUID
) IS
  'Audited degraded lexical staff preview derived only from one exact inbound Platform message; it never authorizes autonomous behavior.';
COMMENT ON FUNCTION platform.staff_ai_retrieval_capabilities(UUID, UUID) IS
  'Fail-closed P5F1 capability report: provider ingestion and semantic execution disabled, lexical preview degraded, provider proof blocked, autonomous authority false.';

COMMIT;
