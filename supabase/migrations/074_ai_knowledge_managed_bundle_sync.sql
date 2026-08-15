-- K3: atomically synchronize deterministic Obsidian knowledge bundles.

ALTER TABLE public.ai_knowledge_documents
  ADD COLUMN source_path TEXT,
  ADD COLUMN source_sha256 TEXT,
  ADD COLUMN managed_by TEXT,
  ADD CONSTRAINT ai_knowledge_documents_managed_shape_check CHECK (
    (
      managed_by IS NULL
      AND source_path IS NULL
      AND source_sha256 IS NULL
    ) OR (
      managed_by = 'evo_obsidian_sync'
      AND source_path IS NOT NULL
      AND source_path <> ''
      AND source_path = normalize(source_path, NFC)
      AND source_path !~ '(^/|\\|(^|/)\.{1,2}(/|$)|(^|/)\.)'
      AND source_path !~ '(^|/)(Сырой архив ЭВО|Секреты и доступы ЭВО)(/|$)'
      AND source_path ~ '\.md$'
      AND source_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX ai_knowledge_documents_managed_identity_idx
  ON public.ai_knowledge_documents (account_id, audience, source_path)
  WHERE managed_by = 'evo_obsidian_sync';

CREATE TABLE public.ai_knowledge_bundle_revisions (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('client', 'internal')),
  bundle_sha256 TEXT NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  document_count INTEGER NOT NULL CHECK (document_count >= 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, audience)
);

ALTER TABLE public.ai_knowledge_bundle_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ai_knowledge_bundle_revisions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_knowledge_bundle_revisions
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_ai_knowledge_bundle(
  p_account_id UUID,
  p_audience TEXT,
  p_bundle_sha256 TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document JSONB;
  v_chunk JSONB;
  v_document_count INTEGER;
  v_deleted_count INTEGER;
  v_chunk_count INTEGER;
  v_expected_index INTEGER;
  v_source_path TEXT;
  v_document_id UUID;
  v_embedding_text TEXT;
BEGIN
  IF p_account_id IS NULL
     OR p_audience NOT IN ('client', 'internal')
     OR p_bundle_sha256 !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_payload) <> 'object'
     OR NOT (p_payload ? 'version' AND p_payload ? 'documents')
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload)) <> 2
     OR p_payload->'version' <> '1'::jsonb
     OR jsonb_typeof(p_payload->'documents') <> 'array'
     OR jsonb_array_length(p_payload->'documents') = 0 THEN
    RAISE EXCEPTION 'Invalid closed knowledge bundle payload';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Unknown knowledge bundle account';
  END IF;

  IF EXISTS (
    SELECT value->>'source_path'
    FROM jsonb_array_elements(p_payload->'documents') AS input(value)
    GROUP BY value->>'source_path'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate managed source path';
  END IF;

  FOR v_document IN SELECT value FROM jsonb_array_elements(p_payload->'documents') AS input(value)
  LOOP
    IF jsonb_typeof(v_document) <> 'object'
       OR NOT (
         v_document ? 'source_path'
         AND v_document ? 'source_sha256'
         AND v_document ? 'title'
         AND v_document ? 'content'
         AND v_document ? 'chunks'
       )
       OR (SELECT count(*) FROM jsonb_object_keys(v_document)) <> 5
       OR jsonb_typeof(v_document->'source_path') <> 'string'
       OR jsonb_typeof(v_document->'source_sha256') <> 'string'
       OR jsonb_typeof(v_document->'title') <> 'string'
       OR jsonb_typeof(v_document->'content') <> 'string'
       OR jsonb_typeof(v_document->'chunks') <> 'array'
       OR jsonb_array_length(v_document->'chunks') = 0
       OR v_document->>'source_path' = ''
       OR v_document->>'source_path' <> normalize(v_document->>'source_path', NFC)
       OR v_document->>'source_path' ~ '(^/|\\|(^|/)\.{1,2}(/|$)|(^|/)\.)'
       OR v_document->>'source_path' ~ '(^|/)(Сырой архив ЭВО|Секреты и доступы ЭВО)(/|$)'
       OR v_document->>'source_path' !~ '\.md$'
       OR v_document->>'source_sha256' !~ '^[0-9a-f]{64}$'
       OR encode(sha256(convert_to(v_document->>'content', 'UTF8')), 'hex')
          <> v_document->>'source_sha256'
       OR btrim(v_document->>'title') = ''
       OR btrim(v_document->>'content') = '' THEN
      RAISE EXCEPTION 'Invalid managed knowledge document';
    END IF;

    v_expected_index := 0;
    FOR v_chunk IN SELECT value FROM jsonb_array_elements(v_document->'chunks') AS input(value)
    LOOP
      IF jsonb_typeof(v_chunk) <> 'object'
         OR NOT (
           v_chunk ? 'chunk_index'
           AND v_chunk ? 'content'
           AND v_chunk ? 'content_sha256'
           AND v_chunk ? 'embedding'
         )
         OR (SELECT count(*) FROM jsonb_object_keys(v_chunk)) <> 4
         OR jsonb_typeof(v_chunk->'chunk_index') <> 'number'
         OR (v_chunk->>'chunk_index')::INTEGER <> v_expected_index
         OR jsonb_typeof(v_chunk->'content') <> 'string'
         OR btrim(v_chunk->>'content') = ''
         OR jsonb_typeof(v_chunk->'content_sha256') <> 'string'
         OR v_chunk->>'content_sha256' !~ '^[0-9a-f]{64}$'
         OR encode(sha256(convert_to(v_chunk->>'content', 'UTF8')), 'hex')
            <> v_chunk->>'content_sha256'
         OR jsonb_typeof(v_chunk->'embedding') <> 'array'
         OR jsonb_array_length(v_chunk->'embedding') <> 1536
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_chunk->'embedding') AS coordinate(value)
           WHERE jsonb_typeof(coordinate.value) <> 'number'
              OR lower(coordinate.value::TEXT) IN ('nan', 'infinity', '-infinity')
         ) THEN
        RAISE EXCEPTION 'Invalid managed knowledge chunk';
      END IF;
      v_expected_index := v_expected_index + 1;
    END LOOP;
  END LOOP;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::TEXT || chr(31) || p_audience, 0)
  );

  SELECT count(*) INTO v_document_count
  FROM jsonb_array_elements(p_payload->'documents');
  SELECT coalesce(sum(jsonb_array_length(value->'chunks')), 0)::INTEGER
  INTO v_chunk_count
  FROM jsonb_array_elements(p_payload->'documents') AS input(value);

  SELECT count(*) INTO v_deleted_count
  FROM public.ai_knowledge_documents AS document
  WHERE document.account_id = p_account_id
    AND document.audience = p_audience
    AND document.managed_by = 'evo_obsidian_sync'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_payload->'documents') AS input(value)
      WHERE input.value->>'source_path' = document.source_path
    );

  DELETE FROM public.ai_knowledge_documents AS document
  WHERE document.account_id = p_account_id
    AND document.audience = p_audience
    AND document.managed_by = 'evo_obsidian_sync'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_payload->'documents') AS input(value)
      WHERE input.value->>'source_path' = document.source_path
    );

  FOR v_document IN SELECT value FROM jsonb_array_elements(p_payload->'documents') AS input(value)
  LOOP
    v_source_path := v_document->>'source_path';
    INSERT INTO public.ai_knowledge_documents (
      account_id,
      audience,
      title,
      content,
      source_path,
      source_sha256,
      managed_by
    ) VALUES (
      p_account_id,
      p_audience,
      v_document->>'title',
      v_document->>'content',
      v_source_path,
      v_document->>'source_sha256',
      'evo_obsidian_sync'
    )
    ON CONFLICT (account_id, audience, source_path)
      WHERE managed_by = 'evo_obsidian_sync'
    DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      source_sha256 = EXCLUDED.source_sha256
    RETURNING id INTO v_document_id;

    DELETE FROM public.ai_knowledge_chunks WHERE document_id = v_document_id;
    FOR v_chunk IN SELECT value FROM jsonb_array_elements(v_document->'chunks') AS input(value)
    LOOP
      v_embedding_text := (v_chunk->'embedding')::TEXT;
      INSERT INTO public.ai_knowledge_chunks (
        document_id,
        account_id,
        audience,
        chunk_index,
        content,
        embedding
      ) VALUES (
        v_document_id,
        p_account_id,
        p_audience,
        (v_chunk->>'chunk_index')::INTEGER,
        v_chunk->>'content',
        v_embedding_text::public.vector(1536)
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.ai_knowledge_bundle_revisions (
    account_id, audience, bundle_sha256, document_count, chunk_count, synced_at
  ) VALUES (
    p_account_id, p_audience, p_bundle_sha256, v_document_count, v_chunk_count, now()
  )
  ON CONFLICT (account_id, audience) DO UPDATE SET
    bundle_sha256 = EXCLUDED.bundle_sha256,
    document_count = EXCLUDED.document_count,
    chunk_count = EXCLUDED.chunk_count,
    synced_at = EXCLUDED.synced_at;

  RETURN jsonb_build_object(
    'version', 1,
    'account_id', p_account_id,
    'audience', p_audience,
    'bundle_sha256', p_bundle_sha256,
    'documents_upserted', v_document_count,
    'documents_deleted', v_deleted_count,
    'chunks_replaced', v_chunk_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_ai_knowledge_bundle(UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_ai_knowledge_bundle(UUID, TEXT, TEXT, JSONB)
  TO service_role;
