-- 271_platform_ai_agent_files — «ИИ-агент» P2: файлы «Информации для агента».
-- Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.5, §5, §7, §13, §15 P2.
--
-- Что делает:
--  * приватный bucket platform-ai-agent-knowledge (25 MiB; PDF, DOCX, XLSX,
--    CSV, TXT, MD, PNG, JPEG) и RESTRICTIVE-политика, закрывающая его для anon
--    и authenticated, как platform-knowledge-library (201). Объекты:
--    {org}/{doc}/original, {org}/{doc}/pages/{n}.png, {org}/{doc}/crops/{item}.png.
--    Пишет и читает их только CRM серверным ключом (загрузка и брокер агента);
--  * ai_documents: content_sha256 (SHA-256 UTF-8 байтов content_md), scan_proof
--    (доказательство ClamAV из CRM), personal_override_by/at («Это материал
--    компании — продолжить»), аренда переиндексации reindex_lease_*;
--    ai_document_pages: lines (строки с нормализованными рамками) и ocr;
--    ai_review_items: статус applying, resolution, context_label, error_code;
--  * сотрудники (platform, authenticated): загрузка (manage), документ и
--    страница (use), «Это материал компании» (manage);
--  * сервер CRM (platform, только service_role): разрешение брокера на один
--    объект документа под арендой воркера;
--  * агент (platform_ai_agent, только evo_ai_agent): текст, страницы и пункты
--    «Листа сверки» под арендой; переиндексация живого документа под
--    отдельной арендой; claim/index/retry заменяются с теми же сигнатурами.
--
-- Безопасно для production: новые объекты и столбцы на пустых в production
-- таблицах ai_* (ledger 266, P1 не применён), горячие таблицы не трогаются.
-- Повторный запуск в той же точке цепочки ничего не меняет; запуск после
-- 272/273 откатывается проверкой состава функций (не понижает их версии).
BEGIN;

-- ---------------------------------------------------------------------------
-- Bucket и политика.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-ai-agent-knowledge', 'platform-ai-agent-knowledge', FALSE, 26214400, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
DO $ai271_bucket$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'platform-ai-agent-knowledge'
    AND NOT b.public AND b.file_size_limit = 26214400
    AND b.allowed_mime_types @> ARRAY['application/pdf', 'image/png'] AND cardinality(b.allowed_mime_types) = 8) THEN
    RAISE EXCEPTION 'ai_agent_bucket_drift' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND p.policyname = 'ai_agent_knowledge_server_only') THEN
    -- Даже более широкая политика объектов не откроет этот bucket браузеру.
    CREATE POLICY ai_agent_knowledge_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (bucket_id <> 'platform-ai-agent-knowledge') WITH CHECK (bucket_id <> 'platform-ai-agent-knowledge');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND p.policyname = 'ai_agent_knowledge_server_only' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
    AND p.roles @> ARRAY['anon', 'authenticated']::NAME[]) THEN
    RAISE EXCEPTION 'ai_agent_bucket_policy_drift' USING ERRCODE = '55000';
  END IF;
END
$ai271_bucket$;

-- ---------------------------------------------------------------------------
-- Столбцы.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.ai_documents
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS scan_proof JSONB
    CHECK (scan_proof IS NULL OR (jsonb_typeof(scan_proof) = 'object' AND octet_length(scan_proof::TEXT) <= 2048)),
  ADD COLUMN IF NOT EXISTS personal_override_by UUID,
  ADD COLUMN IF NOT EXISTS personal_override_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reindex_lease_owner TEXT CHECK (char_length(reindex_lease_owner) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS reindex_lease_expires_at TIMESTAMPTZ;
ALTER TABLE platform_private.ai_documents
  DROP CONSTRAINT IF EXISTS ai_documents_personal_override_check,
  ADD CONSTRAINT ai_documents_personal_override_check
    CHECK ((personal_override_by IS NULL) = (personal_override_at IS NULL)),
  DROP CONSTRAINT IF EXISTS ai_documents_reindex_lease_check,
  ADD CONSTRAINT ai_documents_reindex_lease_check
    CHECK ((reindex_lease_owner IS NULL) = (reindex_lease_expires_at IS NULL)),
  DROP CONSTRAINT IF EXISTS ai_documents_content_sha_check,
  ADD CONSTRAINT ai_documents_content_sha_check CHECK (content_sha256 IS NULL OR content_md IS NOT NULL);
UPDATE platform_private.ai_documents d
SET content_sha256 = encode(sha256(convert_to(d.content_md, 'UTF8')), 'hex')
WHERE d.content_md IS NOT NULL AND d.content_sha256 IS DISTINCT FROM encode(sha256(convert_to(d.content_md, 'UTF8')), 'hex');

ALTER TABLE platform_private.ai_document_pages
  ADD COLUMN IF NOT EXISTS lines JSONB
    CHECK (lines IS NULL OR (jsonb_typeof(lines) = 'array' AND octet_length(lines::TEXT) <= 2097152)),
  ADD COLUMN IF NOT EXISTS ocr JSONB
    CHECK (ocr IS NULL OR (jsonb_typeof(ocr) = 'object' AND octet_length(ocr::TEXT) <= 65536));

-- «Лист сверки»: «Исправить» ставит applying, переиндексация решает пункт или
-- возвращает его в open с кодом ошибки. resolution — что выбрал сотрудник.
ALTER TABLE platform_private.ai_review_items
  ADD COLUMN IF NOT EXISTS resolution TEXT CHECK (resolution IN ('confirm', 'correct', 'dismiss')),
  ADD COLUMN IF NOT EXISTS context_label TEXT CHECK (char_length(context_label) <= 200),
  ADD COLUMN IF NOT EXISTS error_code TEXT CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$');
UPDATE platform_private.ai_review_items r
SET resolution = CASE r.status WHEN 'resolved' THEN 'confirm' ELSE 'dismiss' END
WHERE r.resolution IS NULL AND r.status IN ('resolved', 'dismissed');
ALTER TABLE platform_private.ai_review_items
  DROP CONSTRAINT IF EXISTS ai_review_items_status_check,
  ADD CONSTRAINT ai_review_items_status_check CHECK (status IN ('open', 'applying', 'resolved', 'dismissed')),
  DROP CONSTRAINT IF EXISTS ai_review_items_resolution_check,
  ADD CONSTRAINT ai_review_items_resolution_check CHECK ((status IN ('open', 'applying')) = (resolved_at IS NULL)),
  DROP CONSTRAINT IF EXISTS ai_review_items_resolution_kind_check,
  ADD CONSTRAINT ai_review_items_resolution_kind_check CHECK (
    (status = 'open' AND resolution IS NULL) OR (status = 'applying' AND resolution = 'correct')
    OR (status = 'resolved' AND resolution IN ('confirm', 'correct'))
    OR (status = 'dismissed' AND resolution = 'dismiss'));
CREATE INDEX IF NOT EXISTS ai_review_items_pending_idx
  ON platform_private.ai_review_items (organization_id, document_id, page_no) WHERE status IN ('open', 'applying');

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.ai_text_sha256(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE encode(sha256(convert_to(p_text, 'UTF8')), 'hex') END
$$;

-- Тип файла и MIME совпадают (расширение и сигнатуру проверяет CRM).
CREATE OR REPLACE FUNCTION platform_private.ai_document_mime_allowed(p_kind TEXT, p_mime_type TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(CASE p_kind
    WHEN 'pdf' THEN p_mime_type = 'application/pdf'
    WHEN 'docx' THEN p_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN p_mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'csv' THEN p_mime_type = 'text/csv'
    WHEN 'text' THEN p_mime_type IN ('text/plain', 'text/markdown')
    WHEN 'image' THEN p_mime_type IN ('image/png', 'image/jpeg')
  END, FALSE)
$$;

-- Ровно одно вхождение (с учётом перекрывающихся).
CREATE OR REPLACE FUNCTION platform_private.ai_occurs_once(p_text TEXT, p_needle TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(p_needle <> '' AND strpos(p_text, p_needle) > 0
    AND strpos(substr(p_text, strpos(p_text, p_needle) + 1), p_needle) = 0, FALSE)
$$;

-- Статус живого документа: review, пока есть open/applying пункты.
CREATE OR REPLACE FUNCTION platform_private.ai_document_review_status(p_document_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM platform_private.ai_review_items r
    WHERE r.document_id = p_document_id AND r.status IN ('open', 'applying')) THEN 'review' ELSE 'ready' END
$$;

-- Проверка фрагментов индексации. Элемент — объект фрагмента (как в 269) или,
-- при p_allow_reuse, {position, reuse}: точная копия прежнего фрагмента этого
-- документа с его ID и вектором. p_require_embedding — у нового фрагмента
-- обязателен вектор 1536.
CREATE OR REPLACE FUNCTION platform_private.ai_chunks_check(p_chunks JSONB, p_allow_reuse BOOLEAN,
  p_require_embedding BOOLEAN)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_chunks IS NULL OR jsonb_typeof(p_chunks) <> 'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 2000
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_chunks) e WHERE jsonb_typeof(e) <> 'object'
      OR jsonb_typeof(e -> 'position') IS DISTINCT FROM 'number' OR (e ->> 'position') !~ '^[0-9]{1,5}$'
      OR CASE WHEN e ? 'reuse' THEN NOT p_allow_reuse OR (e - ARRAY['position', 'reuse']) <> '{}'::JSONB
          OR jsonb_typeof(e -> 'reuse') IS DISTINCT FROM 'number' OR (e ->> 'reuse') !~ '^[0-9]{1,18}$'
        ELSE (e - ARRAY['position', 'sectionPath', 'content', 'context', 'lang', 'indexText', 'pageFrom', 'pageTo',
            'sheetName', 'boxes', 'tokens', 'embedding']) <> '{}'::JSONB
          OR jsonb_typeof(e -> 'content') IS DISTINCT FROM 'string'
          OR (e ? 'embedding' AND jsonb_typeof(e -> 'embedding') <> 'null'
            AND (jsonb_typeof(e -> 'embedding') <> 'array' OR jsonb_array_length(e -> 'embedding') <> 1536))
          OR (p_require_embedding AND jsonb_typeof(e -> 'embedding') IS DISTINCT FROM 'array') END)
    OR (SELECT count(DISTINCT (e ->> 'position')::INTEGER) FROM jsonb_array_elements(p_chunks) e)
      <> jsonb_array_length(p_chunks)
    OR (SELECT count(e ->> 'reuse') <> count(DISTINCT e ->> 'reuse') FROM jsonb_array_elements(p_chunks) e) THEN
    RAISE EXCEPTION 'ai_document_invalid_chunks' USING ERRCODE = '22023';
  END IF;
END
$$;

-- Замена фрагментов документа одной транзакцией. Переиспользованный фрагмент
-- сохраняет свой ID (источники прежних ответов остаются живыми), вектор и
-- контекст; новые получают новые ID.
CREATE OR REPLACE FUNCTION platform_private.ai_chunks_replace(p_organization_id UUID, p_document_id UUID,
  p_chunks JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old platform_private.ai_chunks[]; v_reuse_count INTEGER; v_reused INTEGER; v_new INTEGER;
BEGIN
  SELECT count(*) INTO v_reuse_count FROM jsonb_array_elements(p_chunks) e WHERE e ? 'reuse';
  SELECT COALESCE(array_agg(c), '{}') INTO v_old FROM platform_private.ai_chunks c
  WHERE c.organization_id = p_organization_id AND c.document_id = p_document_id
    AND c.id IN (SELECT (e ->> 'reuse')::BIGINT FROM jsonb_array_elements(p_chunks) e WHERE e ? 'reuse');
  IF cardinality(v_old) <> v_reuse_count THEN
    RAISE EXCEPTION 'ai_document_invalid_chunks' USING ERRCODE = '22023', DETAIL = 'reuse of an unknown chunk';
  END IF;
  DELETE FROM platform_private.ai_chunks c WHERE c.document_id = p_document_id;
  INSERT INTO platform_private.ai_chunks (id, organization_id, document_id, position, section_path, content, context,
    lang, index_text, page_from, page_to, sheet_name, boxes, tokens, embedding, created_at)
  OVERRIDING SYSTEM VALUE
  SELECT o.id, o.organization_id, o.document_id, (e ->> 'position')::INTEGER, o.section_path, o.content, o.context,
    o.lang, o.index_text, o.page_from, o.page_to, o.sheet_name, o.boxes, o.tokens, o.embedding, o.created_at
  FROM jsonb_array_elements(p_chunks) e JOIN unnest(v_old) o ON o.id = (e ->> 'reuse')::BIGINT
  WHERE e ? 'reuse';
  GET DIAGNOSTICS v_reused = ROW_COUNT;
  INSERT INTO platform_private.ai_chunks (organization_id, document_id, position, section_path, content, context,
    lang, index_text, page_from, page_to, sheet_name, boxes, tokens, embedding)
  SELECT p_organization_id, p_document_id, (e ->> 'position')::INTEGER, COALESCE(e ->> 'sectionPath', ''),
    e ->> 'content', COALESCE(e ->> 'context', ''), COALESCE(e ->> 'lang', 'ru'), e ->> 'indexText',
    (e ->> 'pageFrom')::INTEGER, (e ->> 'pageTo')::INTEGER, e ->> 'sheetName',
    CASE WHEN jsonb_typeof(e -> 'boxes') = 'array' THEN e -> 'boxes' END, (e ->> 'tokens')::INTEGER,
    CASE WHEN jsonb_typeof(e -> 'embedding') = 'array' THEN ((e -> 'embedding')::TEXT)::public.halfvec(1536) END
  FROM jsonb_array_elements(p_chunks) e WHERE NOT e ? 'reuse';
  GET DIAGNOSTICS v_new = ROW_COUNT;
  RETURN jsonb_build_object('chunkCount', v_reused + v_new, 'reused', v_reused, 'embedded', v_new);
END
$$;

-- Карточка документа для списка (269 + счётчики «Листа сверки», размер,
-- подтверждение «материал компании»).
CREATE OR REPLACE FUNCTION platform_private.ai_document_json(p_document platform_private.ai_documents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_document.id, 'title', p_document.title, 'kind', p_document.kind,
    'audience', p_document.audience, 'autosendAllowed', p_document.autosend_allowed,
    'status', p_document.status, 'stage', p_document.stage, 'progress', p_document.progress,
    'errorCode', p_document.error_code, 'source', p_document.source,
    'sourceRef', p_document.source_ref - 'root', 'editedInLab', p_document.edited_in_lab,
    'docVersion', p_document.doc_version, 'rowVersion', p_document.row_version,
    'pageCount', p_document.page_count, 'replacesId', p_document.replaces_id,
    'supersededById', p_document.superseded_by_id, 'createdAt', p_document.created_at,
    'updatedAt', p_document.updated_at, 'indexedAt', p_document.indexed_at,
    'mimeType', p_document.mime_type, 'byteSize', p_document.byte_size,
    'personalOverrideAt', p_document.personal_override_at,
    'chunkCount', (SELECT count(*) FROM platform_private.ai_chunks c WHERE c.document_id = p_document.id),
    'openReviewCount', (SELECT count(*) FROM platform_private.ai_review_items r
      WHERE r.document_id = p_document.id AND r.status = 'open'),
    'applyingReviewCount', (SELECT count(*) FROM platform_private.ai_review_items r
      WHERE r.document_id = p_document.id AND r.status = 'applying'))
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_review_item_json(p_item platform_private.ai_review_items)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_item.id, 'documentId', p_item.document_id, 'pageNo', p_item.page_no,
    'kind', p_item.kind, 'bbox', p_item.bbox, 'cropPath', p_item.crop_path, 'hasCrop', p_item.crop_path IS NOT NULL,
    'candidates', p_item.candidates, 'proposed', p_item.proposed, 'value', p_item.value, 'anchor', p_item.anchor,
    'valueIndex', p_item.value_index, 'contextLabel', p_item.context_label, 'status', p_item.status,
    'resolution', p_item.resolution, 'errorCode', p_item.error_code, 'resolvedAt', p_item.resolved_at,
    'resolvedByName', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_item.organization_id AND m.id = p_item.resolved_by),
    'createdAt', p_item.created_at)
$$;

-- Аренда обработки (ingest) у этого воркера; иначе ai_document_gone /
-- ai_document_not_leased, как в 269.
CREATE OR REPLACE FUNCTION platform_private.ai_document_leased(p_document_id UUID, p_worker_ref TEXT)
RETURNS platform_private.ai_documents LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents;
BEGIN
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_gone' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.status <> 'processing' OR p_worker_ref IS NULL OR v_doc.lease_owner IS DISTINCT FROM btrim(p_worker_ref) THEN
    RAISE EXCEPTION 'ai_document_not_leased' USING ERRCODE = '42501';
  END IF;
  RETURN v_doc;
END
$$;

DO $ai271_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_text_sha256', 'ai_document_mime_allowed',
      'ai_occurs_once', 'ai_document_review_status', 'ai_chunks_check', 'ai_chunks_replace', 'ai_document_json',
      'ai_review_item_json', 'ai_document_leased') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai271_private_acl$;

-- ===========================================================================
-- Сотрудники (platform, authenticated).
-- ===========================================================================

-- Загрузка: CRM уже проверил размер, расширение, MIME и сигнатуру, посчитал
-- SHA-256, просканировал файл ClamAV и положил его в
-- {org}/{doc}/original без upsert; здесь — строка документа и указатель
-- ingest. При отказе CRM удаляет объект. Замена наследует аудиторию прежней
-- версии; прежняя ищется, пока новая не станет ready/review (269).
CREATE OR REPLACE FUNCTION platform.ai_agent_document_upload_v1(p_organization_id UUID, p_document_id UUID,
  p_title TEXT, p_kind TEXT, p_mime_type TEXT, p_byte_size BIGINT, p_byte_sha256 TEXT, p_audience TEXT,
  p_client_confirmed BOOLEAN, p_company_material BOOLEAN, p_replaces_id UUID, p_replaces_version BIGINT,
  p_scan_proof JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_title TEXT; v_audience TEXT; v_scanned_at TIMESTAMPTZ;
  v_pred platform_private.ai_documents; v_dup TEXT; v_doc platform_private.ai_documents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_title := btrim(p_title);
  IF p_document_id IS NULL OR v_title IS NULL OR char_length(v_title) NOT BETWEEN 1 AND 240 OR v_title ~ '[\x00-\x1F\x7F]'
    OR p_kind IS NULL OR p_kind NOT IN ('text', 'docx', 'xlsx', 'csv', 'pdf', 'image')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR p_byte_sha256 IS NULL OR p_byte_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_audience IS NOT NULL AND p_audience NOT IN ('client', 'internal'))
    OR (p_replaces_id IS NULL AND p_audience IS NULL)
    OR (p_replaces_id IS NULL) <> (p_replaces_version IS NULL) THEN
    RAISE EXCEPTION 'ai_document_invalid_upload' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.ai_document_mime_allowed(p_kind, p_mime_type) THEN
    RAISE EXCEPTION 'ai_document_type_mismatch' USING ERRCODE = '22023';
  END IF;
  -- Галочка «Это материал компании, не документ клиента» обязательна (§7).
  IF p_company_material IS NOT TRUE THEN
    RAISE EXCEPTION 'ai_document_company_material_required' USING ERRCODE = '22023';
  END IF;
  -- Доказательство ClamAV из CRM (clamd-malware-scanner.ts) на эти байты.
  IF p_scan_proof IS NULL OR jsonb_typeof(p_scan_proof) <> 'object'
    OR (p_scan_proof - ARRAY['engine', 'engineVersion', 'signatureVersion', 'protocol', 'scannedAt', 'sha256Hex'])
      <> '{}'::JSONB
    OR p_scan_proof ->> 'engine' IS DISTINCT FROM 'ClamAV'
    OR COALESCE(p_scan_proof ->> 'engineVersion', '') !~ '^[0-9][0-9A-Za-z.+~-]{0,63}$'
    OR COALESCE(p_scan_proof ->> 'signatureVersion', '') !~ '^[1-9][0-9]{0,18}$'
    OR p_scan_proof ->> 'protocol' IS DISTINCT FROM 'clamd-zinstream-v1'
    OR p_scan_proof ->> 'sha256Hex' IS DISTINCT FROM p_byte_sha256
    OR COALESCE(p_scan_proof ->> 'scannedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' THEN
    RAISE EXCEPTION 'ai_document_scan_proof_invalid' USING ERRCODE = '22023';
  END IF;
  v_scanned_at := (p_scan_proof ->> 'scannedAt')::TIMESTAMPTZ;
  IF v_scanned_at NOT BETWEEN clock_timestamp() - INTERVAL '15 minutes' AND clock_timestamp() + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'ai_document_scan_proof_invalid' USING ERRCODE = '22023', DETAIL = 'scan is not fresh';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id, 'title', v_title,
    'kind', p_kind, 'mimeType', p_mime_type, 'byteSize', p_byte_size, 'sha256', p_byte_sha256,
    'audience', p_audience, 'clientConfirmed', p_client_confirmed, 'replacesId', p_replaces_id,
    'replacesVersion', p_replaces_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.upload', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  v_audience := p_audience;
  IF p_replaces_id IS NOT NULL THEN
    SELECT * INTO v_pred FROM platform_private.ai_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_replaces_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_pred.source <> 'upload' THEN
      RAISE EXCEPTION 'ai_document_replacement_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_pred.status NOT IN ('ready', 'review') OR v_pred.superseded_by_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM platform_private.ai_documents s
        WHERE s.organization_id = p_organization_id AND s.replaces_id = v_pred.id
          AND s.status IN ('queued', 'processing', 'failed')) THEN
      RAISE EXCEPTION 'ai_document_replacement_pending' USING ERRCODE = 'PT409';
    END IF;
    IF p_replaces_version IS DISTINCT FROM v_pred.row_version THEN
      RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF p_audience IS NOT NULL AND p_audience <> v_pred.audience THEN
      RAISE EXCEPTION 'ai_document_invalid_upload' USING ERRCODE = '22023', DETAIL = 'a replacement keeps the audience';
    END IF;
    v_audience := v_pred.audience;
  ELSIF v_audience = 'client' AND p_client_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'ai_document_client_confirmation_required' USING ERRCODE = '22023';
  END IF;

  -- Дубликат по SHA-256 среди не заменённых документов (§7): с названием.
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_document_sha:' || p_organization_id::TEXT || ':'
    || p_byte_sha256, 271));
  SELECT d.title INTO v_dup FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.byte_sha256 = p_byte_sha256 AND d.status <> 'superseded'
  ORDER BY d.created_at, d.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ai_document_duplicate' USING ERRCODE = 'PT409', DETAIL = v_dup;
  END IF;
  IF EXISTS (SELECT 1 FROM platform_private.ai_documents d WHERE d.id = p_document_id) THEN
    RAISE EXCEPTION 'ai_document_id_taken' USING ERRCODE = '23505';
  END IF;

  INSERT INTO platform_private.ai_documents (id, organization_id, title, kind, audience, status, storage_path,
    byte_sha256, byte_size, mime_type, replaces_id, source, source_ref, scan_proof, created_by, updated_by)
  VALUES (p_document_id, p_organization_id, v_title, p_kind, v_audience, 'queued',
    p_organization_id::TEXT || '/' || p_document_id::TEXT || '/original', p_byte_sha256, p_byte_size, p_mime_type,
    p_replaces_id, 'upload', jsonb_build_object('kind', 'upload', 'companyMaterial', TRUE,
      'clientConfirmed', v_audience = 'client'), p_scan_proof, v_actor.membership_id, v_actor.membership_id)
  RETURNING * INTO v_doc;
  PERFORM platform_private.ai_enqueue('ingest', v_doc.id);
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.upload', v_fp,
    jsonb_build_object('status', 'queued', 'document', platform_private.ai_document_json(v_doc)),
    'ai.agent.document.upload', 'ai_document', v_doc.id,
    CASE WHEN v_pred.id IS NOT NULL THEN jsonb_build_object('replacesId', v_pred.id,
      'replacesTitle', v_pred.title, 'replacesRowVersion', v_pred.row_version) END,
    'ИИ-агент: загружен документ');
END
$$;

-- Документ для просмотра: карточка, страницы, ожидающая замена.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_v1(p_organization_id UUID, p_document_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_doc platform_private.ai_documents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('document', platform_private.ai_document_json(v_doc),
    'contentSha256', v_doc.content_sha256,
    'pages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('pageNo', p.page_no, 'sheetName', p.sheet_name,
        'method', p.method, 'confidence', p.confidence, 'width', p.width, 'height', p.height,
        'hasImage', p.image_path IS NOT NULL,
        'openReviewCount', (SELECT count(*) FROM platform_private.ai_review_items r
          WHERE r.document_id = p.document_id AND r.page_no = p.page_no AND r.status IN ('open', 'applying')))
        ORDER BY p.page_no), '[]'::JSONB)
      FROM platform_private.ai_document_pages p WHERE p.document_id = v_doc.id),
    'successor', (SELECT jsonb_build_object('id', s.id, 'status', s.status, 'stage', s.stage,
        'progress', s.progress, 'errorCode', s.error_code, 'createdAt', s.created_at)
      FROM platform_private.ai_documents s
      WHERE s.organization_id = p_organization_id AND s.replaces_id = v_doc.id AND s.status <> 'superseded'
      ORDER BY s.created_at DESC, s.id DESC LIMIT 1),
    'predecessor', (SELECT jsonb_build_object('id', o.id, 'title', o.title, 'status', o.status,
        'docVersion', o.doc_version)
      FROM platform_private.ai_documents o
      WHERE o.organization_id = p_organization_id AND o.id = v_doc.replaces_id),
    'personalOverride', CASE WHEN v_doc.personal_override_at IS NULL THEN NULL ELSE jsonb_build_object(
      'at', v_doc.personal_override_at, 'byName', (SELECT p.display_name FROM platform.organization_memberships m
        JOIN platform.profiles p ON p.id = m.profile_id
        WHERE m.organization_id = p_organization_id AND m.id = v_doc.personal_override_by)) END,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

-- Страница просмотрщика: текст, строки, рамки фрагментов и пункты «Листа
-- сверки». imagePath и cropPath — только для сервера CRM (поток картинки по
-- сессии), браузеру не отдаются. У документа без страниц (текст, знания)
-- страница 1 — его текст.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_page_v1(p_organization_id UUID, p_document_id UUID,
  p_page_no INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_doc platform_private.ai_documents; v_page platform_private.ai_document_pages;
  v_has_pages BOOLEAN; v_page_json JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_page_no IS NULL OR p_page_no NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'ai_document_invalid_page' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_has_pages := EXISTS (SELECT 1 FROM platform_private.ai_document_pages p WHERE p.document_id = v_doc.id);
  SELECT * INTO v_page FROM platform_private.ai_document_pages p WHERE p.document_id = v_doc.id AND p.page_no = p_page_no;
  IF FOUND THEN
    v_page_json := jsonb_build_object('sheetName', v_page.sheet_name, 'method', v_page.method,
      'confidence', v_page.confidence, 'width', v_page.width, 'height', v_page.height, 'textMd', v_page.text_md,
      'lines', v_page.lines, 'imagePath', v_page.image_path);
  ELSIF NOT v_has_pages AND p_page_no = 1 AND v_doc.content_md IS NOT NULL THEN
    v_page_json := jsonb_build_object('sheetName', NULL, 'method', 'text', 'confidence', NULL, 'width', NULL,
      'height', NULL, 'textMd', left(v_doc.content_md, 200000), 'lines', NULL, 'imagePath', NULL);
  ELSE
    RAISE EXCEPTION 'ai_document_page_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('documentId', v_doc.id, 'docVersion', v_doc.doc_version, 'pageNo', p_page_no,
    'pageCount', COALESCE(v_doc.page_count, CASE WHEN v_has_pages THEN NULL ELSE 1 END),
    'page', v_page_json,
    'chunks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('chunkId', c.id, 'position', c.position,
        'sectionPath', c.section_path, 'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name,
        'boxes', c.boxes) ORDER BY c.position), '[]'::JSONB)
      FROM platform_private.ai_chunks c
      WHERE c.document_id = v_doc.id AND ((c.page_from IS NULL AND NOT v_has_pages)
        OR p_page_no BETWEEN c.page_from AND COALESCE(c.page_to, c.page_from))),
    'reviewItems', (SELECT COALESCE(jsonb_agg(platform_private.ai_review_item_json(r)
        ORDER BY r.value_index NULLS LAST, r.created_at, r.id), '[]'::JSONB)
      FROM platform_private.ai_review_items r WHERE r.document_id = v_doc.id AND r.page_no = p_page_no));
END
$$;

-- «Это материал компании — продолжить»: только для документа, остановленного
-- защитой от документов клиента; решение записывается, обработка заново.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_confirm_company_v1(p_organization_id UUID, p_document_id UUID,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_doc platform_private.ai_documents;
  v_new platform_private.ai_documents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.confirm_company', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_doc.row_version THEN
    RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_doc.status <> 'failed' OR v_doc.error_code IS DISTINCT FROM 'personal_document_suspected' THEN
    RAISE EXCEPTION 'ai_document_not_suspected' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_documents d SET status = 'queued', stage = NULL, progress = 0, error_code = NULL,
    attempts = 0, lease_owner = NULL, lease_expires_at = NULL, personal_override_by = v_actor.membership_id,
    personal_override_at = statement_timestamp(), row_version = d.row_version + 1, updated_at = statement_timestamp(),
    updated_by = v_actor.membership_id
  WHERE d.id = v_doc.id RETURNING * INTO v_new;
  PERFORM platform_private.ai_enqueue('ingest', v_doc.id);
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.confirm_company', v_fp,
    jsonb_build_object('status', 'queued', 'document', platform_private.ai_document_json(v_new)),
    'ai.agent.document.override', 'ai_document', v_doc.id,
    jsonb_build_object('status', v_doc.status, 'errorCode', v_doc.error_code, 'rowVersion', v_doc.row_version),
    'ИИ-агент: подтверждено, что это материал компании, а не документ клиента');
END
$$;

-- «Повторить» (269), но не для документа, остановленного защитой от
-- документов клиента: там решает «Это материал компании — продолжить».
CREATE OR REPLACE FUNCTION platform.ai_agent_document_retry_v1(p_organization_id UUID, p_document_id UUID,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_doc platform_private.ai_documents;
  v_new platform_private.ai_documents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.retry', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_doc.row_version THEN
    RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_doc.status <> 'failed' THEN
    RAISE EXCEPTION 'ai_document_not_failed' USING ERRCODE = '22023';
  END IF;
  IF v_doc.error_code = 'personal_document_suspected' THEN
    RAISE EXCEPTION 'ai_document_personal_suspected' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_documents d SET status = 'queued', stage = NULL, progress = 0, error_code = NULL,
    attempts = 0, lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1,
    updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE d.id = v_doc.id RETURNING * INTO v_new;
  PERFORM platform_private.ai_enqueue(CASE v_doc.source WHEN 'seed_kb' THEN 'seed'
    WHEN 'upload' THEN 'ingest' ELSE 'reindex' END, v_doc.id);
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.retry', v_fp,
    jsonb_build_object('status', 'queued', 'document', platform_private.ai_document_json(v_new)),
    'ai.agent.document.retry', 'ai_document', v_doc.id,
    jsonb_build_object('status', v_doc.status, 'errorCode', v_doc.error_code, 'rowVersion', v_doc.row_version),
    'ИИ-агент: повтор обработки документа');
END
$$;

-- ===========================================================================
-- Сервер CRM (platform, только service_role): брокер хранилища агента.
-- ===========================================================================

-- Один объект {org}/{doc}/… под арендой этого воркера: GET — оригинал или
-- картинка страницы, PUT — картинка страницы или вырезка. Аренда обработки
-- (processing) даёт GET и PUT, аренда переиндексации — только GET. Никаких
-- '..', других документов, LIST, DELETE и подписанных ссылок.
CREATE OR REPLACE FUNCTION platform.ai_agent_storage_authorize_v1(p_organization_id UUID, p_document_id UUID,
  p_worker_ref TEXT, p_op TEXT, p_path TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_prefix TEXT; v_rest TEXT; v_object TEXT; v_page INTEGER;
  v_ingest BOOLEAN; v_reindex BOOLEAN; v_worker TEXT := btrim(p_worker_ref);
BEGIN
  IF p_organization_id IS NULL OR p_document_id IS NULL OR v_worker IS NULL
    OR char_length(v_worker) NOT BETWEEN 1 AND 200 OR p_op IS NULL OR p_op NOT IN ('GET', 'PUT')
    OR p_path IS NULL OR char_length(p_path) > 512 THEN
    RAISE EXCEPTION 'ai_storage_forbidden' USING ERRCODE = '42501';
  END IF;
  v_prefix := p_organization_id::TEXT || '/' || p_document_id::TEXT || '/';
  IF left(p_path, char_length(v_prefix)) IS DISTINCT FROM v_prefix THEN
    RAISE EXCEPTION 'ai_storage_forbidden' USING ERRCODE = '42501';
  END IF;
  v_rest := substr(p_path, char_length(v_prefix) + 1);
  IF v_rest = 'original' THEN
    v_object := 'original';
  ELSIF v_rest ~ '^pages/[1-9][0-9]{0,2}\.png$' THEN
    v_page := substring(v_rest FROM '^pages/([0-9]+)\.png$')::INTEGER;
    v_object := CASE WHEN v_page <= 300 THEN 'page' END;
  ELSIF v_rest ~ '^crops/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$' THEN
    v_object := 'crop';
  END IF;
  IF v_object IS NULL OR (p_op = 'GET' AND v_object = 'crop') OR (p_op = 'PUT' AND v_object = 'original') THEN
    RAISE EXCEPTION 'ai_storage_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_storage_forbidden' USING ERRCODE = '42501';
  END IF;
  v_ingest := COALESCE(v_doc.status = 'processing' AND v_doc.lease_owner = v_worker
    AND v_doc.lease_expires_at > clock_timestamp(), FALSE);
  v_reindex := COALESCE(v_doc.status IN ('ready', 'review') AND v_doc.superseded_by_id IS NULL
    AND v_doc.reindex_lease_owner = v_worker AND v_doc.reindex_lease_expires_at > clock_timestamp(), FALSE);
  IF NOT (v_ingest OR (v_reindex AND p_op = 'GET'))
    OR (v_object = 'original' AND v_doc.storage_path IS DISTINCT FROM p_path) THEN
    RAISE EXCEPTION 'ai_storage_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('allowed', TRUE, 'bucket', 'platform-ai-agent-knowledge', 'path', p_path, 'op', p_op,
    'object', v_object, 'pageNo', v_page,
    'maxBytes', CASE WHEN p_op = 'PUT' THEN 8388608 ELSE COALESCE(v_doc.byte_size, 26214400) END,
    'mimeType', CASE WHEN v_object = 'original' THEN v_doc.mime_type ELSE 'image/png' END);
END
$$;

-- ===========================================================================
-- Агент (platform_ai_agent, только evo_ai_agent).
-- ===========================================================================

-- Аренда документа (269) + решение «материал компании» и SHA текста.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_claim_v1(p_document_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_settings platform_private.ai_settings;
BEGIN
  IF p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_document_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'gone');
  END IF;
  IF v_doc.status IN ('ready', 'review', 'superseded', 'failed') THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', v_doc.status);
  END IF;
  IF v_doc.status = 'processing' AND v_doc.lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    AND v_doc.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'busy');
  END IF;
  IF v_doc.attempts >= 5 THEN
    UPDATE platform_private.ai_documents d SET status = 'failed', error_code = 'attempts_exhausted',
      lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
    WHERE d.id = v_doc.id;
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'failed');
  END IF;
  UPDATE platform_private.ai_documents d SET status = 'processing',
    stage = COALESCE(d.stage, CASE WHEN d.kind = 'knowledge' OR d.edited_in_lab THEN 'chunk' ELSE 'extract' END),
    lease_owner = btrim(p_worker_ref), lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    attempts = d.attempts + 1, row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  v_settings := platform_private.ai_settings_row(v_doc.organization_id);
  RETURN jsonb_build_object('claimed', TRUE, 'documentId', v_doc.id, 'organizationId', v_doc.organization_id,
    'kind', v_doc.kind, 'source', v_doc.source, 'title', v_doc.title, 'audience', v_doc.audience,
    'stage', v_doc.stage, 'attempts', v_doc.attempts,
    'contentMd', CASE WHEN v_doc.kind = 'knowledge' OR v_doc.edited_in_lab THEN v_doc.content_md END,
    'contentSha256', v_doc.content_sha256, 'personalOverride', v_doc.personal_override_at IS NOT NULL,
    'storagePath', v_doc.storage_path, 'mimeType', v_doc.mime_type, 'byteSize', v_doc.byte_size,
    'byteSha256', v_doc.byte_sha256,
    'models', jsonb_build_object('fast', v_settings.fast_model, 'vision', v_settings.vision_model,
      'arbiter', v_settings.arbiter_model, 'arbiterFallback', v_settings.arbiter_fallback_model,
      'embedding', v_settings.embedding_model),
    'leaseExpiresAt', v_doc.lease_expires_at);
END
$$;

-- Нормализованный текст документа (основа правок «Листа сверки» и
-- Лаборатории) и число страниц.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_content_put_v1(p_document_id UUID, p_worker_ref TEXT,
  p_content_md TEXT, p_page_count INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents;
BEGIN
  IF p_content_md IS NULL OR char_length(p_content_md) > 2000000
    OR (p_page_count IS NOT NULL AND p_page_count NOT BETWEEN 0 AND 300) THEN
    RAISE EXCEPTION 'ai_document_invalid_content' USING ERRCODE = '22023';
  END IF;
  v_doc := platform_private.ai_document_leased(p_document_id, p_worker_ref);
  UPDATE platform_private.ai_documents d SET content_md = p_content_md,
    content_sha256 = platform_private.ai_text_sha256(p_content_md), page_count = p_page_count,
    row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  RETURN jsonb_build_object('contentSha256', v_doc.content_sha256, 'chars', char_length(p_content_md),
    'pageCount', v_doc.page_count);
END
$$;

-- Страницы (не больше 50 за вызов, повтор перезаписывает): текст, строки с
-- рамками 0..1, сведения OCR и путь картинки {org}/{doc}/pages/{n}.png.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_pages_put_v1(p_document_id UUID, p_worker_ref TEXT,
  p_pages JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_prefix TEXT; v_count INTEGER;
BEGIN
  IF p_pages IS NULL OR jsonb_typeof(p_pages) <> 'array' OR jsonb_array_length(p_pages) NOT BETWEEN 1 AND 50
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_pages) e WHERE jsonb_typeof(e) <> 'object'
      OR (e - ARRAY['pageNo', 'sheetName', 'imagePath', 'width', 'height', 'method', 'confidence', 'textMd', 'lines',
        'ocr']) <> '{}'::JSONB
      OR jsonb_typeof(e -> 'pageNo') IS DISTINCT FROM 'number' OR (e ->> 'pageNo') !~ '^[1-9][0-9]{0,2}$'
      OR (e ->> 'pageNo')::INTEGER > 300
      OR (e ->> 'method') IS NULL OR (e ->> 'method') NOT IN ('text', 'ocr')
      OR jsonb_typeof(e -> 'textMd') IS DISTINCT FROM 'string' OR char_length(e ->> 'textMd') > 200000
      OR (e ? 'sheetName' AND jsonb_typeof(e -> 'sheetName') NOT IN ('string', 'null'))
      OR (e ? 'imagePath' AND jsonb_typeof(e -> 'imagePath') NOT IN ('string', 'null'))
      OR (e ? 'width' AND jsonb_typeof(e -> 'width') <> 'null' AND (e ->> 'width') !~ '^[1-9][0-9]{0,5}$')
      OR (e ? 'height' AND jsonb_typeof(e -> 'height') <> 'null' AND (e ->> 'height') !~ '^[1-9][0-9]{0,5}$')
      OR (e ? 'confidence' AND jsonb_typeof(e -> 'confidence') <> 'null' AND (jsonb_typeof(e -> 'confidence') <> 'number'
        OR (e ->> 'confidence')::NUMERIC NOT BETWEEN 0 AND 1))
      OR (e ? 'ocr' AND jsonb_typeof(e -> 'ocr') NOT IN ('object', 'null'))
      OR (e ? 'lines' AND jsonb_typeof(e -> 'lines') <> 'null' AND (jsonb_typeof(e -> 'lines') <> 'array'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'lines') l WHERE jsonb_typeof(l) <> 'object'
          OR (l - ARRAY['text', 'bbox', 'conf']) <> '{}'::JSONB
          OR jsonb_typeof(l -> 'text') IS DISTINCT FROM 'string' OR char_length(l ->> 'text') > 4000
          OR jsonb_typeof(l -> 'bbox') IS DISTINCT FROM 'array' OR jsonb_array_length(l -> 'bbox') <> 4
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(l -> 'bbox') b
            WHERE jsonb_typeof(b) <> 'number' OR b::TEXT::NUMERIC NOT BETWEEN 0 AND 1)))))
    OR (SELECT count(DISTINCT e ->> 'pageNo') FROM jsonb_array_elements(p_pages) e) <> jsonb_array_length(p_pages) THEN
    RAISE EXCEPTION 'ai_document_invalid_pages' USING ERRCODE = '22023';
  END IF;
  v_doc := platform_private.ai_document_leased(p_document_id, p_worker_ref);
  v_prefix := v_doc.organization_id::TEXT || '/' || v_doc.id::TEXT || '/pages/';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_pages) e WHERE jsonb_typeof(e -> 'imagePath') = 'string'
    AND e ->> 'imagePath' <> v_prefix || (e ->> 'pageNo') || '.png') THEN
    RAISE EXCEPTION 'ai_document_invalid_pages' USING ERRCODE = '22023', DETAIL = 'imagePath';
  END IF;
  INSERT INTO platform_private.ai_document_pages AS p (organization_id, document_id, page_no, sheet_name, image_path,
    width, height, method, confidence, text_md, lines, ocr)
  SELECT v_doc.organization_id, v_doc.id, (e ->> 'pageNo')::INTEGER, e ->> 'sheetName', e ->> 'imagePath',
    (e ->> 'width')::INTEGER, (e ->> 'height')::INTEGER, e ->> 'method', (e ->> 'confidence')::NUMERIC,
    e ->> 'textMd', CASE WHEN jsonb_typeof(e -> 'lines') = 'array' THEN e -> 'lines' END,
    CASE WHEN jsonb_typeof(e -> 'ocr') = 'object' THEN e -> 'ocr' END
  FROM jsonb_array_elements(p_pages) e
  ON CONFLICT (document_id, page_no) DO UPDATE SET sheet_name = EXCLUDED.sheet_name, image_path = EXCLUDED.image_path,
    width = EXCLUDED.width, height = EXCLUDED.height, method = EXCLUDED.method, confidence = EXCLUDED.confidence,
    text_md = EXCLUDED.text_md, lines = EXCLUDED.lines, ocr = EXCLUDED.ocr;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE platform_private.ai_documents d SET updated_at = statement_timestamp() WHERE d.id = v_doc.id;
  RETURN jsonb_build_object('pages', v_count);
END
$$;

-- Пункты «Листа сверки» (не больше 500 за вызов). ID задаёт воркер (вырезка
-- {org}/{doc}/crops/{id}.png кладётся до вызова); повтор того же ID
-- перезаписывает только открытый пункт этого документа. Значение решает
-- сотрудник, поэтому value воркер не пишет.
CREATE OR REPLACE FUNCTION platform_ai_agent.review_items_put_v1(p_document_id UUID, p_worker_ref TEXT,
  p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_prefix TEXT; v_count INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE jsonb_typeof(e) <> 'object'
      OR (e - ARRAY['id', 'pageNo', 'bbox', 'cropPath', 'kind', 'candidates', 'proposed', 'anchor', 'valueIndex',
        'contextLabel']) <> '{}'::JSONB
      OR COALESCE(e ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(e -> 'pageNo') IS DISTINCT FROM 'number' OR (e ->> 'pageNo') !~ '^[1-9][0-9]{0,2}$'
      OR (e ->> 'pageNo')::INTEGER > 300
      OR (e ->> 'kind') IS NULL OR (e ->> 'kind') NOT IN ('number', 'text')
      OR (e ? 'bbox' AND jsonb_typeof(e -> 'bbox') <> 'null' AND (jsonb_typeof(e -> 'bbox') <> 'array'
        OR jsonb_array_length(e -> 'bbox') <> 4 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'bbox') b
          WHERE jsonb_typeof(b) <> 'number' OR b::TEXT::NUMERIC NOT BETWEEN 0 AND 1)))
      OR (e ? 'cropPath' AND jsonb_typeof(e -> 'cropPath') NOT IN ('string', 'null'))
      OR (e ? 'candidates' AND (jsonb_typeof(e -> 'candidates') <> 'object'
        OR ((e -> 'candidates') - ARRAY['tesseract', 'vision', 'arbiter', 'arbiterModel']) <> '{}'::JSONB
        OR EXISTS (SELECT 1 FROM jsonb_each(e -> 'candidates') c WHERE jsonb_typeof(c.value) NOT IN ('string', 'null')
          OR char_length(c.value #>> '{}') > 2000)))
      OR (e ? 'proposed' AND (jsonb_typeof(e -> 'proposed') NOT IN ('string', 'null') OR char_length(e ->> 'proposed') > 2000))
      OR (e ? 'anchor' AND (jsonb_typeof(e -> 'anchor') NOT IN ('string', 'null') OR char_length(e ->> 'anchor') > 2000))
      OR (e ? 'contextLabel' AND (jsonb_typeof(e -> 'contextLabel') NOT IN ('string', 'null')
        OR char_length(e ->> 'contextLabel') > 200))
      OR (e ? 'valueIndex' AND jsonb_typeof(e -> 'valueIndex') <> 'null' AND (e ->> 'valueIndex') !~ '^[0-9]{1,9}$'))
    OR (SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'ai_review_invalid_items' USING ERRCODE = '22023';
  END IF;
  v_doc := platform_private.ai_document_leased(p_document_id, p_worker_ref);
  v_prefix := v_doc.organization_id::TEXT || '/' || v_doc.id::TEXT || '/crops/';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE jsonb_typeof(e -> 'cropPath') = 'string'
      AND e ->> 'cropPath' <> v_prefix || (e ->> 'id') || '.png')
    OR (v_doc.page_count IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
      WHERE (e ->> 'pageNo')::INTEGER > greatest(v_doc.page_count, 1)))
    OR EXISTS (SELECT 1 FROM platform_private.ai_review_items r
      WHERE r.id IN (SELECT (e ->> 'id')::UUID FROM jsonb_array_elements(p_items) e)
        AND (r.document_id <> v_doc.id OR r.status <> 'open')) THEN
    RAISE EXCEPTION 'ai_review_invalid_items' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform_private.ai_review_items AS r (id, organization_id, document_id, page_no, bbox, crop_path, kind,
    candidates, proposed, anchor, value_index, context_label)
  SELECT (e ->> 'id')::UUID, v_doc.organization_id, v_doc.id, (e ->> 'pageNo')::INTEGER,
    CASE WHEN jsonb_typeof(e -> 'bbox') = 'array' THEN e -> 'bbox' END, e ->> 'cropPath', e ->> 'kind',
    COALESCE(jsonb_strip_nulls(e -> 'candidates'), '{}'::JSONB), e ->> 'proposed', e ->> 'anchor',
    (e ->> 'valueIndex')::INTEGER, e ->> 'contextLabel'
  FROM jsonb_array_elements(p_items) e
  ON CONFLICT (id) DO UPDATE SET page_no = EXCLUDED.page_no, bbox = EXCLUDED.bbox, crop_path = EXCLUDED.crop_path,
    kind = EXCLUDED.kind, candidates = EXCLUDED.candidates, proposed = EXCLUDED.proposed, anchor = EXCLUDED.anchor,
    value_index = EXCLUDED.value_index, context_label = EXCLUDED.context_label
  WHERE r.document_id = EXCLUDED.document_id AND r.status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('items', v_count);
END
$$;

-- Индексация (269): ready, пока нет open/applying пунктов; SHA текста.
-- Замена прежней версии — как в 269: прежняя уходит из поиска только здесь,
-- упавшая новая её не трогает.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_index_v1(p_document_id UUID, p_worker_ref TEXT,
  p_chunks JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_result JSONB; v_knowledge BIGINT;
BEGIN
  PERFORM platform_private.ai_chunks_check(p_chunks, FALSE, FALSE);
  v_doc := platform_private.ai_document_leased(p_document_id, p_worker_ref);
  v_result := platform_private.ai_chunks_replace(v_doc.organization_id, v_doc.id, p_chunks);
  UPDATE platform_private.ai_documents d SET status = platform_private.ai_document_review_status(d.id),
    stage = 'index', progress = 100, error_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
    doc_version = CASE WHEN d.indexed_at IS NULL THEN d.doc_version ELSE d.doc_version + 1 END,
    content_sha256 = platform_private.ai_text_sha256(d.content_md),
    indexed_at = clock_timestamp(), row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  IF v_doc.replaces_id IS NOT NULL THEN
    UPDATE platform_private.ai_documents d SET status = 'superseded', superseded_by_id = v_doc.id,
      autosend_allowed = FALSE, lease_owner = NULL, lease_expires_at = NULL, reindex_lease_owner = NULL,
      reindex_lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
    WHERE d.organization_id = v_doc.organization_id AND d.id = v_doc.replaces_id AND d.status <> 'superseded';
    DELETE FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.replaces_id;
  END IF;
  v_knowledge := platform_private.ai_bump_knowledge(v_doc.organization_id);
  RETURN jsonb_build_object('status', v_doc.status, 'chunkCount', (v_result ->> 'chunkCount')::INTEGER,
    'knowledgeVersion', v_knowledge, 'replacedId', v_doc.replaces_id, 'docVersion', v_doc.doc_version,
    'contentSha256', v_doc.content_sha256);
END
$$;

-- Аренда переиндексации живого документа (ready/review, не заменён): он
-- остаётся в поиске. Отдаёт текст, SHA, страницы, фрагменты (без векторов) и
-- исправления «Листа сверки», ожидающие применения (applying).
CREATE OR REPLACE FUNCTION platform_ai_agent.document_reindex_claim_v1(p_document_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_settings platform_private.ai_settings;
BEGIN
  IF p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_document_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'gone');
  END IF;
  IF v_doc.status NOT IN ('ready', 'review') OR v_doc.superseded_by_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', v_doc.status);
  END IF;
  IF v_doc.reindex_lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    AND v_doc.reindex_lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'busy');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_private.ai_review_items r
    WHERE r.document_id = v_doc.id AND r.status = 'applying') THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'idle');
  END IF;
  IF v_doc.content_md IS NULL THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'no_content');
  END IF;
  UPDATE platform_private.ai_documents d SET reindex_lease_owner = btrim(p_worker_ref),
    reindex_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  v_settings := platform_private.ai_settings_row(v_doc.organization_id);
  RETURN jsonb_build_object('claimed', TRUE, 'documentId', v_doc.id, 'organizationId', v_doc.organization_id,
    'kind', v_doc.kind, 'title', v_doc.title, 'audience', v_doc.audience, 'docVersion', v_doc.doc_version,
    'contentMd', v_doc.content_md, 'contentSha256', v_doc.content_sha256,
    'pages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('pageNo', p.page_no, 'sheetName', p.sheet_name,
        'method', p.method) ORDER BY p.page_no), '[]'::JSONB)
      FROM platform_private.ai_document_pages p WHERE p.document_id = v_doc.id),
    'chunks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('chunkId', c.id, 'position', c.position,
        'sectionPath', c.section_path, 'content', c.content, 'context', c.context, 'lang', c.lang,
        'indexText', c.index_text, 'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name,
        'boxes', c.boxes, 'tokens', c.tokens, 'hasEmbedding', c.embedding IS NOT NULL) ORDER BY c.position), '[]'::JSONB)
      FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.id),
    'decisions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'pageNo', r.page_no, 'kind', r.kind,
        'bbox', r.bbox, 'proposed', r.proposed, 'value', r.value, 'anchor', r.anchor, 'valueIndex', r.value_index,
        'contextLabel', r.context_label) ORDER BY r.page_no, r.value_index NULLS LAST, r.id), '[]'::JSONB)
      FROM platform_private.ai_review_items r WHERE r.document_id = v_doc.id AND r.status = 'applying'),
    'models', jsonb_build_object('fast', v_settings.fast_model, 'embedding', v_settings.embedding_model),
    'leaseExpiresAt', v_doc.reindex_lease_expires_at);
END
$$;

-- Переиндексация одной транзакцией: текст на прежнем SHA (иначе PT409
-- ai_document_content_changed), фрагменты ({position, reuse} — копия с тем же
-- ID и вектором, новые — с вектором), применённые исправления → resolved,
-- неприменимые → open с кодом (anchor_ambiguous и т.п.). Каждый названный
-- пункт должен быть applying этого документа (иначе PT409 ai_review_changed).
-- Без текста (p_content_md NULL) — только неприменимые пункты, без
-- фрагментов. Версия документа и knowledge_version растут, только если
-- изменились текст или фрагменты.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_reindex_v1(p_document_id UUID, p_worker_ref TEXT,
  p_base_sha TEXT, p_content_md TEXT, p_chunks JSONB, p_applied JSONB, p_failed JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_result JSONB; v_ids UUID[]; v_sha TEXT; v_changed BOOLEAN;
  v_applied INTEGER := 0; v_failed INTEGER := 0; v_knowledge BIGINT; v_old_count INTEGER;
BEGIN
  IF p_base_sha IS NULL OR p_base_sha !~ '^[0-9a-f]{64}$'
    OR (p_content_md IS NULL) <> (p_chunks IS NULL)
    OR (p_content_md IS NOT NULL AND char_length(p_content_md) > 2000000)
    OR p_applied IS NULL OR jsonb_typeof(p_applied) <> 'array' OR jsonb_array_length(p_applied) > 500
    OR p_failed IS NULL OR jsonb_typeof(p_failed) <> 'array' OR jsonb_array_length(p_failed) > 500
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_applied) e WHERE jsonb_typeof(e) <> 'string'
      OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_failed) e WHERE jsonb_typeof(e) <> 'object'
      OR (e - ARRAY['id', 'code']) <> '{}'::JSONB
      OR COALESCE(e ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR COALESCE(e ->> 'code', '') !~ '^[a-z][a-z0-9_]{0,63}$')
    OR (p_content_md IS NULL AND jsonb_array_length(p_applied) > 0)
    OR jsonb_array_length(p_applied) + jsonb_array_length(p_failed) = 0 AND p_content_md IS NULL THEN
    RAISE EXCEPTION 'ai_document_invalid_reindex' USING ERRCODE = '22023';
  END IF;
  IF p_chunks IS NOT NULL THEN
    PERFORM platform_private.ai_chunks_check(p_chunks, TRUE, TRUE);
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM (
    SELECT (e #>> '{}')::UUID AS id FROM jsonb_array_elements(p_applied) e
    UNION ALL SELECT (e ->> 'id')::UUID FROM jsonb_array_elements(p_failed) e) x;
  IF v_ids IS NOT NULL AND cardinality(v_ids) <> (SELECT count(DISTINCT i) FROM unnest(v_ids) i) THEN
    RAISE EXCEPTION 'ai_document_invalid_reindex' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_gone' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.status NOT IN ('ready', 'review') OR v_doc.superseded_by_id IS NOT NULL
    OR v_doc.reindex_lease_owner IS DISTINCT FROM btrim(p_worker_ref) THEN
    RAISE EXCEPTION 'ai_document_not_leased' USING ERRCODE = '42501';
  END IF;
  IF v_doc.content_sha256 IS DISTINCT FROM p_base_sha THEN
    RAISE EXCEPTION 'ai_document_content_changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_ids IS NOT NULL AND (SELECT count(*) FROM platform_private.ai_review_items r
      WHERE r.id = ANY (v_ids) AND r.document_id = v_doc.id AND r.status = 'applying') <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'ai_review_changed' USING ERRCODE = 'PT409';
  END IF;

  v_sha := COALESCE(platform_private.ai_text_sha256(p_content_md), v_doc.content_sha256);
  SELECT count(*) INTO v_old_count FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.id;
  IF p_chunks IS NOT NULL THEN
    v_result := platform_private.ai_chunks_replace(v_doc.organization_id, v_doc.id, p_chunks);
  END IF;
  -- Изменение знаний: другой текст, новый фрагмент или выпавший прежний.
  v_changed := v_sha IS DISTINCT FROM v_doc.content_sha256 OR (p_chunks IS NOT NULL
    AND ((v_result ->> 'embedded')::INTEGER > 0 OR (v_result ->> 'reused')::INTEGER <> v_old_count));
  UPDATE platform_private.ai_review_items r SET status = 'resolved', resolved_at = clock_timestamp(), error_code = NULL
  WHERE r.document_id = v_doc.id AND r.id IN (SELECT (e #>> '{}')::UUID FROM jsonb_array_elements(p_applied) e);
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  UPDATE platform_private.ai_review_items r SET status = 'open', resolution = NULL, resolved_by = NULL,
    resolved_at = NULL, error_code = f.code
  FROM (SELECT (e ->> 'id')::UUID AS id, e ->> 'code' AS code FROM jsonb_array_elements(p_failed) e) f
  WHERE r.document_id = v_doc.id AND r.id = f.id;
  GET DIAGNOSTICS v_failed = ROW_COUNT;
  UPDATE platform_private.ai_documents d SET content_md = COALESCE(p_content_md, d.content_md), content_sha256 = v_sha,
    doc_version = CASE WHEN v_changed THEN d.doc_version + 1 ELSE d.doc_version END,
    indexed_at = CASE WHEN v_changed THEN clock_timestamp() ELSE d.indexed_at END,
    status = platform_private.ai_document_review_status(d.id), reindex_lease_owner = NULL,
    reindex_lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  IF v_changed THEN
    v_knowledge := platform_private.ai_bump_knowledge(v_doc.organization_id);
  END IF;
  RETURN jsonb_build_object('status', v_doc.status, 'docVersion', v_doc.doc_version,
    'contentSha256', v_doc.content_sha256, 'changed', v_changed,
    'chunkCount', (v_result ->> 'chunkCount')::INTEGER, 'reused', (v_result ->> 'reused')::INTEGER,
    'embedded', (v_result ->> 'embedded')::INTEGER, 'applied', v_applied, 'failed', v_failed,
    'knowledgeVersion', v_knowledge);
END
$$;

-- ===========================================================================
-- Гранты и состав функций.
-- ===========================================================================
DO $ai271_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%\_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', f,
      CASE WHEN f = 'platform.ai_agent_storage_authorize_v1(uuid,uuid,text,text,text)'::REGPROCEDURE
        THEN 'service_role' ELSE 'authenticated' END);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_ai_agent' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO evo_ai_agent', f);
  END LOOP;
END
$ai271_acl$;

-- Точный состав обеих поверхностей после 271; лишняя функция — ошибка.
DO $ai271_inventory$
DECLARE v_staff TEXT[]; v_agent TEXT[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_staff FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_agent FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_ai_agent';
  IF v_staff IS DISTINCT FROM ARRAY['ai_agent_answer_current_v1', 'ai_agent_answer_insert_v1',
      'ai_agent_consent_record_v1', 'ai_agent_document_confirm_company_v1', 'ai_agent_document_delete_v1',
      'ai_agent_document_page_v1', 'ai_agent_document_retry_v1', 'ai_agent_document_update_v1',
      'ai_agent_document_upload_v1', 'ai_agent_document_v1', 'ai_agent_documents_v1', 'ai_agent_rules_confirm_v1',
      'ai_agent_rules_save_v1', 'ai_agent_rules_v1', 'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1',
      'ai_agent_settings_v1', 'ai_agent_spend_v1', 'ai_agent_storage_authorize_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1',
      'document_content_put_v1', 'document_index_v1', 'document_pages_put_v1', 'document_reindex_claim_v1',
      'document_reindex_v1', 'document_stage_v1', 'maintenance_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1',
      'review_items_put_v1', 'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1',
      'work_finish_v1'] THEN
    RAISE EXCEPTION 'ai_agent_function_inventory_drift' USING ERRCODE = '55000',
      DETAIL = format('staff=%s agent=%s', v_staff, v_agent);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform_ai_agent' OR (n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%'))
      AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig))))
  THEN
    RAISE EXCEPTION 'ai_agent_function_not_hardened' USING ERRCODE = '55000';
  END IF;
  IF has_function_privilege('authenticated', 'platform.ai_agent_storage_authorize_v1(uuid,uuid,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'platform.ai_agent_storage_authorize_v1(uuid,uuid,text,text,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.ai_agent_document_upload_v1(uuid,uuid,text,text,text,bigint,text,text,boolean,boolean,uuid,bigint,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ai_agent_function_acl_drift' USING ERRCODE = '55000';
  END IF;
END
$ai271_inventory$;

COMMENT ON FUNCTION platform.ai_agent_document_upload_v1(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, BOOLEAN,
  BOOLEAN, UUID, BIGINT, JSONB, UUID) IS
  'AI agent P2: register an uploaded company file stored by the CRM at {org}/{doc}/original (ClamAV proof, company-material and client confirmations, duplicate PT409 with the title, replacement keeps the audience) and queue ingest.';
COMMENT ON FUNCTION platform.ai_agent_storage_authorize_v1(UUID, UUID, TEXT, TEXT, TEXT) IS
  'AI agent P2: service_role only. Authorize one broker request for one object of one document under the worker lease (GET original/pages, PUT pages/crops).';
COMMENT ON FUNCTION platform_ai_agent.document_reindex_v1(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB) IS
  'AI agent P2: apply «Лист сверки» corrections to a live document in one transaction on the base SHA; reused chunks keep their IDs and vectors.';

NOTIFY pgrst, 'reload schema';
COMMIT;
