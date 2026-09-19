-- 204_platform_knowledge_exports; KB release coordinated by Astra.
BEGIN;
CREATE TABLE platform_private.kb_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  owner_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  options JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','failed','expired')),
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  entry_count INTEGER NOT NULL DEFAULT 0,
  completed_entries INTEGER NOT NULL DEFAULT 0,
  written_bytes BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_item_id UUID,
  error_title TEXT,
  cleanup_checked_at TIMESTAMPTZ,
  sha256 TEXT,
  parts JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
  UNIQUE(organization_id,owner_membership_id,request_id)
);
CREATE TABLE platform_private.kb_export_entries (
  job_id UUID NOT NULL REFERENCES platform_private.kb_exports(id),
  ordinal INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY(job_id,ordinal)
);
ALTER TABLE platform_private.kb_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_export_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.kb_exports,platform_private.kb_export_entries FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.kb_export_snapshot(p_node JSONB) RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_node||jsonb_build_object('exportCiphertext',(SELECT ciphertext FROM platform_private.kb_sealed_values v WHERE v.node_id=(p_node->>'id')::UUID AND v.version<=(p_node->>'version')::INTEGER ORDER BY v.version DESC LIMIT 1),'exportBlob',
   (SELECT jsonb_build_object('sha256',b.sha256,'byteSize',b.byte_size) FROM platform_private.kb_blobs b WHERE b.id=(p_node->>'blob_id')::UUID),
   'exportSourceBlob',(SELECT jsonb_build_object('sha256',b.sha256,'byteSize',b.byte_size) FROM platform_private.kb_blobs b WHERE b.id=(p_node->>'source_blob_id')::UUID))
$$;
REVOKE ALL ON FUNCTION platform_private.kb_export_snapshot(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform.kb_export_v1(p_organization_id UUID,p_mode TEXT,p_id UUID DEFAULT NULL,p_options JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; j platform_private.kb_exports; count_entries INTEGER;
BEGIN
 actor:=platform_private.kb_require_admin(p_organization_id);
 IF p_mode='list' THEN
   RETURN (SELECT coalesce(jsonb_agg(to_jsonb(t)-'parts'-'lease_id'-'options'),'[]') FROM (
     SELECT * FROM platform_private.kb_exports WHERE organization_id=p_organization_id AND owner_membership_id=actor
     ORDER BY created_at DESC LIMIT 30) t);
 END IF;
 IF p_id IS NULL THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
 IF p_mode='start' THEN
   IF jsonb_typeof(p_options)<>'object' OR octet_length(p_options::TEXT)>65536
     OR (p_options ? 'ids' AND jsonb_typeof(p_options->'ids')<>'array')
     OR (p_options ? 'caseIds' AND jsonb_typeof(p_options->'caseIds')<>'array')
     OR (p_options ? 'area' AND p_options->>'area' NOT IN ('internal','clients','raw','secrets')) THEN
       RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:'||p_organization_id::TEXT,0));
   SELECT * INTO j FROM platform_private.kb_exports WHERE organization_id=p_organization_id AND owner_membership_id=actor AND request_id=p_id;
   IF FOUND THEN
     IF j.options<>p_options THEN RAISE EXCEPTION 'knowledge_request_conflict' USING ERRCODE='PT409'; END IF;
     RETURN to_jsonb(j)-'parts'-'lease_id';
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_options->'ids','[]')) v(id)
     WHERE NOT EXISTS(SELECT 1 FROM platform_private.kb_nodes n WHERE n.organization_id=p_organization_id AND n.id=v.id::UUID)) THEN
       RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002';
   END IF;
   INSERT INTO platform_private.kb_exports(organization_id,owner_membership_id,request_id,options)
     VALUES(p_organization_id,actor,p_id,p_options) RETURNING * INTO j;
   -- The transaction fixes both the selection and each version before work begins.
   WITH RECURSIVE eligible AS (
     SELECT * FROM platform_private.kb_nodes n WHERE n.organization_id=p_organization_id
     AND (coalesce((p_options->>'includeTrash')::BOOLEAN,FALSE) OR n.deleted_at IS NULL)
     AND (coalesce((p_options->>'includeArchive')::BOOLEAN,FALSE) OR n.archived_at IS NULL)
   ), chosen AS (
     SELECT n.* FROM eligible n WHERE CASE WHEN jsonb_array_length(coalesce(p_options->'ids','[]'))>0
       THEN n.id IN (SELECT value::UUID FROM jsonb_array_elements_text(p_options->'ids'))
       ELSE (CASE WHEN jsonb_array_length(coalesce(p_options->'caseIds','[]'))>0 THEN n.client_case_id IN (SELECT value::UUID FROM jsonb_array_elements_text(p_options->'caseIds'))
         ELSE (NOT(p_options ? 'area') OR n.area=p_options->>'area') END) END
     UNION SELECT n.* FROM eligible n JOIN chosen c ON n.parent_id=c.id
   ), bodies AS (SELECT id,body FROM chosen
     UNION ALL SELECT n.id,v.snapshot->>'body' FROM platform_private.kb_versions v JOIN chosen n ON v.node_id=n.id
       WHERE coalesce((p_options->>'includeHistory')::BOOLEAN,FALSE)
   ), attachments AS (
     SELECT DISTINCT a.* FROM bodies c
       CROSS JOIN LATERAL regexp_matches(c.body,'(?:/api/v3/knowledge/download/|/v3/knowledge\?item=)([0-9a-fA-F-]{36})','g') r
       JOIN eligible a ON a.id=r[1]::UUID AND a.kind='file' AND a.area<>'secrets'
   ), selected AS (SELECT * FROM chosen UNION SELECT * FROM attachments), ancestors AS (
     SELECT n.* FROM eligible n WHERE n.id IN (SELECT parent_id FROM selected)
     UNION SELECT n.* FROM eligible n JOIN ancestors a ON n.id=a.parent_id
   ), snapshots AS (
     SELECT to_jsonb(n)||jsonb_build_object('exportSelected',TRUE) AS snapshot FROM selected n
     UNION ALL SELECT to_jsonb(n)||jsonb_build_object('exportSelected',FALSE) FROM ancestors n WHERE n.id NOT IN (SELECT id FROM selected)
     UNION ALL SELECT v.snapshot||jsonb_build_object('exportSelected',TRUE,'exportHistory',TRUE)
       FROM platform_private.kb_versions v JOIN selected n ON v.node_id=n.id
       WHERE coalesce((p_options->>'includeHistory')::BOOLEAN,FALSE) AND v.version<>n.version
   ), combined AS (
     SELECT platform_private.kb_export_snapshot(snapshot) AS snapshot FROM snapshots
     UNION ALL SELECT value FROM platform_private.kb_canonical_snapshots(p_organization_id,p_options) value
   ) INSERT INTO platform_private.kb_export_entries(job_id,ordinal,snapshot)
     SELECT j.id,row_number() OVER(ORDER BY snapshot->>'id',(snapshot->>'version')::INTEGER)::INTEGER,snapshot FROM combined;
   GET DIAGNOSTICS count_entries=ROW_COUNT;
   UPDATE platform_private.kb_exports SET snapshot_hash=(SELECT md5(string_agg(snapshot::TEXT,'' ORDER BY ordinal)) FROM platform_private.kb_export_entries WHERE job_id=j.id) WHERE id=j.id;
   IF count_entries=0 THEN RAISE EXCEPTION 'knowledge_export_empty' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.kb_exports SET entry_count=count_entries WHERE id=j.id RETURNING * INTO j;
 ELSE
   SELECT * INTO j FROM platform_private.kb_exports WHERE id=p_id AND organization_id=p_organization_id AND owner_membership_id=actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
   IF j.expires_at<=now() THEN RAISE EXCEPTION 'knowledge_export_expired' USING ERRCODE='PT409'; END IF;
   IF p_mode='retry' THEN
     IF j.state='failed' OR (j.state='running' AND j.lease_until<now()) THEN
       UPDATE platform_private.kb_exports SET state='queued',error_code=NULL WHERE id=j.id RETURNING * INTO j;
     END IF;
   ELSIF p_mode NOT IN ('status','download') THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_mode='download' THEN
   IF j.state<>'ready' THEN RAISE EXCEPTION 'knowledge_export_not_ready' USING ERRCODE='PT409'; END IF;
   RETURN to_jsonb(j);
 END IF;
 RETURN to_jsonb(j)-'parts'-'lease_id';
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_export_v1(UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_export_v1(UUID,TEXT,UUID,JSONB) TO authenticated;

CREATE FUNCTION platform.kb_export_worker_v1(p_id UUID,p_lease UUID,p_mode TEXT,p_data JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j platform_private.kb_exports; result JSONB; b platform_private.kb_blobs; location JSONB;
BEGIN
 SELECT * INTO j FROM platform_private.kb_exports WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
 IF p_mode='expire' THEN
   IF j.expires_at>now() THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.kb_exports SET state='expired',lease_id=NULL,lease_until=NULL WHERE id=j.id;
   DELETE FROM platform_private.kb_export_entries WHERE job_id=j.id;
   UPDATE platform_private.kb_exports SET parts='[]',options='{}',cleanup_checked_at=now() WHERE id=j.id;
   RETURN jsonb_build_object('id',j.id,'organization_id',j.organization_id);
 END IF;
 -- Revoking Admin or disabling the account also stops work already queued.
 IF j.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(j.organization_id,j.owner_membership_id) i WHERE i.system_role='admin') THEN
   RAISE EXCEPTION 'knowledge_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_mode='claim' THEN
   IF j.state='ready' OR (j.state='running' AND j.lease_until>now()) OR j.state='expired' THEN RETURN 'null'::JSONB; END IF;
   UPDATE platform_private.kb_exports SET state='running',lease_id=p_lease,lease_until=now()+interval '5 minutes',
     completed_entries=0,error_code=NULL,error_item_id=NULL,error_title=NULL WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j);
 END IF;
 IF j.lease_id IS DISTINCT FROM p_lease OR j.state<>'running' OR j.lease_until<=now() THEN
   RAISE EXCEPTION 'knowledge_export_lease_lost' USING ERRCODE='PT409';
 END IF;
 UPDATE platform_private.kb_exports SET lease_until=now()+interval '5 minutes' WHERE id=j.id;
 IF p_mode='entries' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ordinal),'[]') INTO result FROM (
     SELECT ordinal,snapshot FROM platform_private.kb_export_entries WHERE job_id=j.id
       AND ordinal>coalesce((p_data->>'after')::INTEGER,0) ORDER BY ordinal LIMIT 200) t;
   RETURN result;
 ELSIF p_mode='blob' THEN
   IF NOT EXISTS(SELECT 1 FROM platform_private.kb_export_entries WHERE job_id=j.id
     AND ((snapshot->>'blob_id')::UUID=(p_data->>'id')::UUID OR (snapshot->>'source_blob_id')::UUID=(p_data->>'id')::UUID)) THEN
       RAISE EXCEPTION 'knowledge_forbidden' USING ERRCODE='42501';
   END IF;
   SELECT * INTO b FROM platform_private.kb_blobs WHERE organization_id=j.organization_id AND id=(p_data->>'id')::UUID AND state='ready';
   IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_blob_not_ready' USING ERRCODE='PT409'; END IF;
   RETURN to_jsonb(b)||jsonb_build_object('parts',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.part_index),'[]') FROM platform_private.kb_blob_parts p WHERE blob_id=b.id));
 ELSIF p_mode='external' THEN
   SELECT snapshot->'exportExternal' INTO result FROM platform_private.kb_export_entries WHERE job_id=j.id AND snapshot->>'id'=p_data->>'id' AND snapshot ? 'exportExternal';
   IF result IS NULL OR NOT (CASE WHEN result->>'kind'='document' THEN platform_private.student_document_has_scan_proof(j.organization_id,(result->>'id')::UUID)
     WHEN result->>'kind'='company' THEN platform_private.company_file_has_scan_proof(j.organization_id,(result->>'id')::UUID) ELSE FALSE END) THEN
       RAISE EXCEPTION 'knowledge_blob_not_ready' USING ERRCODE='PT409';
   END IF;
   -- Resolve immutable version bytes after a pending upload finalizes, without changing the snapshot.
   IF result->>'kind'='document' THEN
     SELECT jsonb_build_object('bucket',u.bucket_id,'path',u.object_name) INTO location
       FROM platform.document_versions v JOIN platform_private.document_upload_finalizations u
         ON u.organization_id=v.organization_id AND u.document_version_id=v.id
       WHERE v.organization_id=j.organization_id AND v.id=(result->>'id')::UUID
         AND v.sha256_hex=result->>'sha256' AND v.byte_size=(result->>'byteSize')::BIGINT;
   ELSE
     SELECT jsonb_build_object('bucket',u.bucket_id,'path',u.object_name) INTO location
       FROM platform.company_file_versions v JOIN platform_private.company_file_upload_finalizations u
         ON u.organization_id=v.organization_id AND u.company_file_version_id=v.id
       WHERE v.organization_id=j.organization_id AND v.id=(result->>'id')::UUID
         AND v.sha256_hex=result->>'sha256' AND v.byte_size=(result->>'byteSize')::BIGINT;
   END IF;
   IF location IS NULL THEN RAISE EXCEPTION 'knowledge_blob_not_ready' USING ERRCODE='PT409'; END IF;
   result:=result||location;
   RETURN result;
 ELSIF p_mode='progress' THEN
   UPDATE platform_private.kb_exports SET written_bytes=(p_data->>'bytes')::BIGINT,completed_entries=(p_data->>'entries')::INTEGER,parts=p_data->'parts' WHERE id=j.id;
 ELSIF p_mode='ready' THEN
   IF p_data->>'sha256' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_data->'parts')<>'array'
     OR (p_data->>'entries')::INTEGER<>j.entry_count THEN RAISE EXCEPTION 'knowledge_integrity_failed' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.kb_exports SET state='ready',sha256=p_data->>'sha256',parts=p_data->'parts',
     written_bytes=(p_data->>'bytes')::BIGINT,completed_entries=entry_count,lease_until=NULL WHERE id=j.id;
 ELSIF p_mode='failed' THEN
   UPDATE platform_private.kb_exports SET state='failed',error_code=CASE WHEN p_data->>'code' ~ '^knowledge_[a-z_]+$' THEN p_data->>'code' ELSE 'knowledge_export_failed' END,error_item_id=nullif(p_data->>'itemId','')::UUID,error_title=left(p_data->>'title',400),lease_until=NULL WHERE id=j.id;
 ELSE RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
 RETURN '{}'::JSONB;
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_export_worker_v1(UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_export_worker_v1(UUID,UUID,TEXT,JSONB) TO service_role;
CREATE FUNCTION platform.kb_expired_exports_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (
   SELECT id,organization_id FROM platform_private.kb_exports WHERE organization_id=p_organization_id
     AND expires_at<=now() AND (cleanup_checked_at IS NULL OR cleanup_checked_at<now()-interval '1 hour') ORDER BY cleanup_checked_at NULLS FIRST,expires_at LIMIT 10) t
$$;
REVOKE ALL ON FUNCTION platform.kb_expired_exports_v1(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_expired_exports_v1(UUID) TO service_role;
CREATE FUNCTION platform.kb_export_maintenance_v1()
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
   'expiredOrganizations',(SELECT coalesce(jsonb_agg(x.organization_id),'[]') FROM (
     SELECT DISTINCT organization_id FROM platform_private.kb_exports WHERE expires_at<=now() AND (cleanup_checked_at IS NULL OR cleanup_checked_at<now()-interval '1 hour') LIMIT 20) x),
   'jobs',(SELECT coalesce(jsonb_agg(x.id),'[]') FROM (
     SELECT id FROM platform_private.kb_exports e WHERE expires_at>now() AND (state='queued' OR (state='running' AND lease_until<now()))
     AND EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(e.organization_id,e.owner_membership_id) i WHERE i.system_role='admin')
     ORDER BY created_at LIMIT 2) x))
$$;
REVOKE ALL ON FUNCTION platform.kb_export_maintenance_v1() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_export_maintenance_v1() TO service_role;
COMMIT;
