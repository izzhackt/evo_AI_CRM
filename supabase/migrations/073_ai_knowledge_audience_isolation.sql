-- K2: make the knowledge audience a database-enforced boundary.

ALTER TABLE public.ai_knowledge_documents
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal',
  ADD CONSTRAINT ai_knowledge_documents_audience_check
    CHECK (audience IN ('client', 'internal'));

ALTER TABLE public.ai_knowledge_chunks
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal',
  ADD CONSTRAINT ai_knowledge_chunks_audience_check
    CHECK (audience IN ('client', 'internal'));

-- Every pre-K2 row is deliberately internal. Nothing legacy is promoted to
-- client-visible knowledge by a migration default.
UPDATE public.ai_knowledge_documents SET audience = 'internal';
UPDATE public.ai_knowledge_chunks SET audience = 'internal';

ALTER TABLE public.ai_knowledge_documents
  ADD CONSTRAINT ai_knowledge_documents_identity_unique
    UNIQUE (id, account_id, audience);

ALTER TABLE public.ai_knowledge_chunks
  ADD CONSTRAINT ai_knowledge_chunks_document_audience_fkey
    FOREIGN KEY (document_id, account_id, audience)
    REFERENCES public.ai_knowledge_documents (id, account_id, audience)
    ON DELETE CASCADE;

CREATE INDEX ai_knowledge_documents_account_audience_idx
  ON public.ai_knowledge_documents (account_id, audience);
CREATE INDEX ai_knowledge_chunks_account_audience_idx
  ON public.ai_knowledge_chunks (account_id, audience);

DROP POLICY IF EXISTS ai_knowledge_documents_select
  ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_insert
  ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_update
  ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_delete
  ON public.ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_select
  ON public.ai_knowledge_documents FOR SELECT TO authenticated
  USING (private.is_account_member(account_id, 'agent'));
CREATE POLICY ai_knowledge_documents_insert
  ON public.ai_knowledge_documents FOR INSERT TO authenticated
  WITH CHECK (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );
CREATE POLICY ai_knowledge_documents_update
  ON public.ai_knowledge_documents FOR UPDATE TO authenticated
  USING (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  )
  WITH CHECK (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );
CREATE POLICY ai_knowledge_documents_delete
  ON public.ai_knowledge_documents FOR DELETE TO authenticated
  USING (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );

DROP POLICY IF EXISTS ai_knowledge_chunks_select
  ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_insert
  ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_update
  ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_delete
  ON public.ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_select
  ON public.ai_knowledge_chunks FOR SELECT TO authenticated
  USING (private.is_account_member(account_id, 'agent'));
CREATE POLICY ai_knowledge_chunks_insert
  ON public.ai_knowledge_chunks FOR INSERT TO authenticated
  WITH CHECK (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );
CREATE POLICY ai_knowledge_chunks_update
  ON public.ai_knowledge_chunks FOR UPDATE TO authenticated
  USING (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  )
  WITH CHECK (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );
CREATE POLICY ai_knowledge_chunks_delete
  ON public.ai_knowledge_chunks FOR DELETE TO authenticated
  USING (
    audience = 'internal'
    AND private.is_account_member(account_id, 'admin')
  );

REVOKE ALL PRIVILEGES ON TABLE
  public.ai_knowledge_documents,
  public.ai_knowledge_chunks
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.ai_knowledge_documents,
  public.ai_knowledge_chunks
TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INTEGER);
DROP FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INTEGER);

CREATE FUNCTION public.match_ai_knowledge_fts(
  p_account_id UUID,
  p_audience TEXT,
  p_query TEXT,
  p_match_count INTEGER
)
RETURNS TABLE (id UUID, content TEXT, rank REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT chunk.id,
         chunk.content,
         ts_rank(chunk.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM public.ai_knowledge_chunks AS chunk
  WHERE p_audience IN ('client', 'internal')
    AND chunk.account_id = p_account_id
    AND chunk.audience = p_audience
    AND chunk.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$;

CREATE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id UUID,
  p_audience TEXT,
  p_query_embedding TEXT,
  p_match_count INTEGER
)
RETURNS TABLE (id UUID, content TEXT, distance REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT chunk.id,
         chunk.content,
         (chunk.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM public.ai_knowledge_chunks AS chunk
  WHERE p_audience IN ('client', 'internal')
    AND chunk.account_id = p_account_id
    AND chunk.audience = p_audience
    AND chunk.embedding IS NOT NULL
  ORDER BY chunk.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, TEXT, INTEGER)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, TEXT, INTEGER)
  TO authenticated, service_role;
