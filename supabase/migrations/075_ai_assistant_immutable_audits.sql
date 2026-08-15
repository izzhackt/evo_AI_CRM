-- K4: body-free immutable audit evidence for client/internal AI assistants.

CREATE OR REPLACE FUNCTION private.is_valid_ai_assistant_sources(p_sources JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_sources) = 'array'
    AND jsonb_array_length(p_sources) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sources) AS source(value)
      WHERE jsonb_typeof(source.value) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(source.value)) <> 2
        OR NOT (source.value ? 'chunk_id' AND source.value ? 'source_path')
        OR jsonb_typeof(source.value->'chunk_id') <> 'string'
        OR (source.value->>'chunk_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(source.value->'source_path') <> 'string'
        OR source.value->>'source_path' = ''
        OR source.value->>'source_path' <> normalize(source.value->>'source_path', NFC)
        OR source.value->>'source_path' ~ '(^/|\\|(^|/)\.{1,2}(/|$)|(^|/)\.)'
        OR source.value->>'source_path' !~ '\.md$'
    )
    AND (
      SELECT count(*) = count(DISTINCT source.value->>'chunk_id')
      FROM jsonb_array_elements(p_sources) AS source(value)
    );
$$;

REVOKE ALL ON FUNCTION private.is_valid_ai_assistant_sources(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_ai_assistant_sources(JSONB)
  TO service_role;

CREATE TABLE public.ai_assistant_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('client', 'internal')),
  evaluation_case_id TEXT,
  provider TEXT NOT NULL CHECK (btrim(provider) <> ''),
  model TEXT NOT NULL CHECK (btrim(model) <> ''),
  knowledge_sources JSONB NOT NULL CHECK (private.is_valid_ai_assistant_sources(knowledge_sources)),
  response_sha256 TEXT NOT NULL CHECK (response_sha256 ~ '^[0-9a-f]{64}$'),
  handoff BOOLEAN NOT NULL,
  success BOOLEAN NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ai_assistant_audits_case_check CHECK (
    evaluation_case_id IS NULL
    OR (audience = 'client' AND evaluation_case_id = 'client_china_documents')
    OR (audience = 'internal' AND evaluation_case_id = 'internal_malaysia_handoff')
  )
);

CREATE INDEX ai_assistant_audits_account_created_idx
  ON public.ai_assistant_audits (account_id, created_at DESC);

ALTER TABLE public.ai_assistant_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_assistant_audits_select ON public.ai_assistant_audits
  FOR SELECT TO authenticated
  USING (private.is_account_member(account_id, 'agent'));

REVOKE ALL PRIVILEGES ON TABLE public.ai_assistant_audits
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_assistant_audits TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_assistant_audits TO service_role;

CREATE OR REPLACE FUNCTION private.validate_ai_assistant_audit_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matched INTEGER;
BEGIN
  NEW.expires_at := NEW.created_at + interval '90 days';
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = NEW.actor_user_id
      AND account_id = NEW.account_id
      AND account_role IN ('owner', 'admin', 'agent')
  ) THEN
    RAISE EXCEPTION 'Assistant audit actor is not account staff';
  END IF;
  SELECT count(*) INTO v_matched
  FROM jsonb_array_elements(NEW.knowledge_sources) AS source(value)
  JOIN public.ai_knowledge_chunks AS chunk
    ON chunk.id = (source.value->>'chunk_id')::UUID
   AND chunk.account_id = NEW.account_id
   AND chunk.audience = NEW.audience
  JOIN public.ai_knowledge_documents AS document
    ON document.id = chunk.document_id
   AND document.source_path = source.value->>'source_path';
  IF v_matched <> jsonb_array_length(NEW.knowledge_sources) THEN
    RAISE EXCEPTION 'Assistant audit sources are not valid account/audience managed chunks';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_ai_assistant_audit_sources()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ai_assistant_audits_validate_sources
  BEFORE INSERT ON public.ai_assistant_audits
  FOR EACH ROW EXECUTE FUNCTION private.validate_ai_assistant_audit_sources();

CREATE OR REPLACE FUNCTION private.block_ai_assistant_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ai_assistant_audits is immutable';
  END IF;
  IF OLD.expires_at > now() THEN
    RAISE EXCEPTION 'ai_assistant_audits cannot be deleted before expiry';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.block_ai_assistant_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ai_assistant_audits_immutable
  BEFORE UPDATE OR DELETE ON public.ai_assistant_audits
  FOR EACH ROW EXECUTE FUNCTION private.block_ai_assistant_audit_mutation();

CREATE OR REPLACE FUNCTION public.purge_expired_ai_assistant_audits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.ai_assistant_audits WHERE expires_at <= now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_ai_assistant_audits()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_ai_assistant_audits()
  TO service_role;
