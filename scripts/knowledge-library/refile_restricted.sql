-- One-off correction of the 2026-09-20 restricted-derivative filing error.
-- Input contains metadata only, from real Admin API reads and verified raw uploads.
-- No grants, impersonation, blob-area updates, deletions or schema migrations.
-- The operator injects set_config('evo.knowledge_refiling_rows', JSON, true)
-- at the marker. Default is a real transaction dry run; see README before COMMIT.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
-- __OPERATOR_INPUT__
CREATE TEMP TABLE kb_refiling_rows ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(current_setting('evo.knowledge_refiling_rows')::jsonb) AS r(
  node_id UUID, organization_id UUID, actor_id UUID, source_key TEXT,
  expected_version INTEGER, old_parent_id UUID, old_blob_id UUID,
  old_source_blob_id UUID, target_parent_id UUID, target_blob_id UUID,
  sha256 TEXT, byte_size BIGINT, review_question TEXT
);

DO $guards$
DECLARE org UUID;
BEGIN
  IF (SELECT count(*) FROM kb_refiling_rows) NOT BETWEEN 1 AND 1415
    OR (SELECT count(DISTINCT node_id) FROM kb_refiling_rows) <> (SELECT count(*) FROM kb_refiling_rows)
    OR (SELECT count(DISTINCT organization_id) FROM kb_refiling_rows) <> 1
    OR (SELECT count(DISTINCT actor_id) FROM kb_refiling_rows) <> 1
    OR EXISTS(SELECT 1 FROM kb_refiling_rows WHERE expected_version <> 1
      OR expected_version IS NULL OR organization_id IS NULL OR actor_id IS NULL
      OR source_key IS NULL OR sha256 IS NULL OR sha256 !~ '^[a-f0-9]{64}$'
      OR byte_size IS NULL OR byte_size < 0
      OR review_question IS NULL OR length(review_question) NOT BETWEEN 1 AND 4000) THEN
    RAISE EXCEPTION 'knowledge_refiling_input_invalid';
  END IF;
  SELECT organization_id INTO org FROM kb_refiling_rows LIMIT 1;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || org::TEXT, 0));
  IF NOT EXISTS(SELECT 1 FROM kb_refiling_rows r
    CROSS JOIN LATERAL platform_private.staff_membership_identity(r.organization_id,r.actor_id) a
    WHERE a.coarse_role='admin') THEN
    RAISE EXCEPTION 'knowledge_refiling_admin_inactive';
  END IF;
  PERFORM n.id FROM platform_private.kb_nodes n JOIN kb_refiling_rows r ON r.node_id=n.id FOR UPDATE OF n;
  IF EXISTS(SELECT 1 FROM kb_refiling_rows r WHERE NOT EXISTS(
    SELECT 1 FROM platform_private.kb_nodes n
    JOIN platform_private.kb_nodes p ON p.id=r.target_parent_id AND p.organization_id=r.organization_id
      AND p.area='raw' AND p.kind='folder' AND p.deleted_at IS NULL AND p.archived_at IS NULL
    JOIN platform_private.kb_blobs b ON b.id=r.target_blob_id AND b.organization_id=r.organization_id
      AND b.area='raw' AND b.state='ready' AND b.sha256=r.sha256 AND b.byte_size=r.byte_size
    JOIN platform_private.kb_blobs old_blob ON old_blob.id=r.old_blob_id
      AND old_blob.organization_id=r.organization_id AND old_blob.area='internal'
      AND old_blob.state='ready' AND old_blob.sha256=r.sha256 AND old_blob.byte_size=r.byte_size
    JOIN platform_private.kb_blobs old_source ON old_source.id=r.old_source_blob_id
      AND old_source.organization_id=r.organization_id AND old_source.area='internal'
      AND old_source.state='ready' AND old_source.sha256=r.sha256 AND old_source.byte_size=r.byte_size
    JOIN platform_private.kb_versions v ON v.node_id=n.id AND v.version=r.expected_version
      AND v.snapshot->>'area'='internal' AND v.snapshot->>'blob_id'=r.old_blob_id::TEXT
      AND v.snapshot->>'source_blob_id'=r.old_source_blob_id::TEXT
    WHERE n.id=r.node_id AND n.organization_id=r.organization_id AND n.source_key=r.source_key
      AND n.kind='file' AND n.client_case_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND n.source->>'classification'='restricted_derivative'
      AND n.source->>'sha256'=r.sha256 AND (n.source->>'byteSize')::BIGINT=r.byte_size
      AND ((n.area='internal' AND n.version=r.expected_version AND n.parent_id=r.old_parent_id
        AND n.blob_id=r.old_blob_id AND n.source_blob_id=r.old_source_blob_id)
        OR (n.area='raw' AND n.version=r.expected_version+1 AND n.parent_id=r.target_parent_id
          AND n.blob_id=r.target_blob_id AND n.source_blob_id=r.target_blob_id
          AND n.review_question=r.review_question))
  )) THEN RAISE EXCEPTION 'knowledge_refiling_snapshot_changed'; END IF;
END $guards$;

CREATE TEMP TABLE kb_refiling_moved ON COMMIT DROP AS
WITH changed AS (
  UPDATE platform_private.kb_nodes n SET area='raw',parent_id=r.target_parent_id,
    blob_id=r.target_blob_id,source_blob_id=r.target_blob_id,review_question=r.review_question,
    source=n.source || jsonb_build_object('filingCorrection','restricted_derivative_to_raw_2026-09-20'),
    version=n.version+1,updated_at=now(),updated_by=r.actor_id
  FROM kb_refiling_rows r WHERE n.id=r.node_id AND n.area='internal'
  RETURNING n.id
) SELECT id FROM changed;

DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM kb_refiling_rows r WHERE NOT EXISTS(
    SELECT 1 FROM platform_private.kb_nodes n
    JOIN platform_private.kb_versions v ON v.node_id=n.id AND v.version=n.version
    WHERE n.id=r.node_id AND n.area='raw' AND n.version=r.expected_version+1
      AND n.parent_id=r.target_parent_id AND n.blob_id=r.target_blob_id
      AND n.source_blob_id=r.target_blob_id AND n.source_key=r.source_key
      AND n.review_question=r.review_question AND v.snapshot=to_jsonb(n)
  )) THEN RAISE EXCEPTION 'knowledge_refiling_readback_failed'; END IF;
END $verify$;

SELECT jsonb_build_object('requested',(SELECT count(*) FROM kb_refiling_rows),
  'moved',(SELECT count(*) FROM kb_refiling_moved),
  'alreadyApplied',(SELECT count(*) FROM kb_refiling_rows)-(SELECT count(*) FROM kb_refiling_moved),
  'identitiesAndHistoryPreserved',true) AS receipt;
ROLLBACK;
