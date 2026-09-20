-- Explicit document/folder selections preserve native CRM identities and bytes.
BEGIN;
CREATE FUNCTION platform_private.kb_export_canonical_selection(p_org UUID,p_options JSONB)
RETURNS SETOF JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE selection JSONB:=p_options->'canonical'; key TEXT; c RECORD; d RECORD; f RECORD;
 doc_ids UUID[]; company_ids UUID[]; requested_folders UUID[]; case_ids UUID[];
 selected_folders UUID[]; visible_folders UUID[];
 all_documents BOOLEAN; all_company BOOLEAN;
 history BOOLEAN:=coalesce((p_options->>'includeHistory')::BOOLEAN,FALSE);
 archive BOOLEAN:=coalesce((p_options->>'includeArchive')::BOOLEAN,FALSE);
 trash BOOLEAN:=coalesce((p_options->>'includeTrash')::BOOLEAN,FALSE);
 company_root UUID:=md5(p_org::TEXT||':company')::UUID; document_folder UUID;
BEGIN
 PERFORM platform_private.kb_require_admin(p_org);
 IF NOT(p_options?'canonical') THEN
   RETURN QUERY SELECT * FROM platform_private.kb_canonical_snapshots(p_org,p_options);
   RETURN;
 END IF;
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object'
   OR p_options?'area' OR p_options?'ids' OR p_options?'caseIds' THEN
   RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
 END IF;
 FOR key IN SELECT jsonb_object_keys(selection) LOOP
   IF key IN ('documentVersionIds','companyVersionIds','companyFolderIds','documentCaseIds') THEN
     IF jsonb_typeof(selection->key) IS DISTINCT FROM 'array' THEN
       RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
     END IF;
   ELSIF key IN ('allDocuments','companyRoot') THEN
     IF jsonb_typeof(selection->key) IS DISTINCT FROM 'boolean' THEN
       RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
     END IF;
   ELSE RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
   END IF;
 END LOOP;
 SELECT coalesce(array_agg(value::UUID),'{}') INTO doc_ids FROM jsonb_array_elements_text(coalesce(selection->'documentVersionIds','[]'));
 SELECT coalesce(array_agg(value::UUID),'{}') INTO company_ids FROM jsonb_array_elements_text(coalesce(selection->'companyVersionIds','[]'));
 SELECT coalesce(array_agg(value::UUID),'{}') INTO requested_folders FROM jsonb_array_elements_text(coalesce(selection->'companyFolderIds','[]'));
 SELECT coalesce(array_agg(value::UUID),'{}') INTO case_ids FROM jsonb_array_elements_text(coalesce(selection->'documentCaseIds','[]'));
 all_documents:=coalesce((selection->>'allDocuments')::BOOLEAN,FALSE);
 all_company:=coalesce((selection->>'companyRoot')::BOOLEAN,FALSE);
 IF NOT all_documents AND NOT all_company AND cardinality(doc_ids)+cardinality(company_ids)+cardinality(requested_folders)+cardinality(case_ids)=0 THEN
   RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(doc_ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM platform.document_versions v WHERE v.organization_id=p_org AND v.id=x.id))
   OR EXISTS(SELECT 1 FROM unnest(company_ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM platform.company_file_versions v WHERE v.organization_id=p_org AND v.id=x.id))
   OR EXISTS(SELECT 1 FROM unnest(requested_folders) x(id) WHERE NOT EXISTS(SELECT 1 FROM platform.company_file_folders f WHERE f.organization_id=p_org AND f.id=x.id))
   OR EXISTS(SELECT 1 FROM unnest(case_ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM platform.student_cases c WHERE c.organization_id=p_org AND c.id=x.id)) THEN
   RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002';
 END IF;
 -- Documents only: no overview, chat, activity or unrelated manual materials.
 FOR c IN SELECT sc.* FROM platform.student_cases sc WHERE sc.organization_id=p_org AND (
   all_documents OR sc.id=ANY(case_ids) OR EXISTS(
     SELECT 1 FROM platform.document_versions v JOIN platform.document_slots s ON s.id=v.document_slot_id AND s.organization_id=v.organization_id
     WHERE v.organization_id=p_org AND s.student_case_id=sc.id AND v.id=ANY(doc_ids))) ORDER BY sc.id
 LOOP
   RETURN NEXT platform_private.kb_projection(c.id,p_org,'clients',NULL,'folder',c.student_display_name,c.updated_at);
   document_folder:=md5(c.id::TEXT||':documents')::UUID;
   RETURN NEXT platform_private.kb_projection(document_folder,p_org,'clients',c.id,'folder','Документы',c.updated_at);
   FOR d IN SELECT v.*,s.removed_at,s.current_version_id,u.bucket_id,u.object_name
     FROM platform.document_slots s JOIN platform.document_versions v ON v.organization_id=s.organization_id AND v.document_slot_id=s.id
     LEFT JOIN platform_private.document_upload_finalizations u ON u.organization_id=v.organization_id AND u.document_version_id=v.id
     WHERE s.organization_id=p_org AND s.student_case_id=c.id AND (trash OR s.removed_at IS NULL)
       AND (v.id=ANY(doc_ids)
         OR ((all_documents OR c.id=ANY(case_ids)) AND (history OR v.id=s.current_version_id))
         OR (history AND EXISTS(SELECT 1 FROM platform.document_versions chosen WHERE chosen.organization_id=p_org AND chosen.document_slot_id=s.id AND chosen.id=ANY(doc_ids))))
     ORDER BY s.id,v.version_no
   LOOP
     RETURN NEXT platform_private.kb_projection(d.id,p_org,'clients',document_folder,'file',
       CASE WHEN d.id=d.current_version_id THEN d.original_filename ELSE 'Версия '||d.version_no||' — '||d.original_filename END,d.updated_at,
       jsonb_build_object('version',d.version_no,'deleted_at',d.removed_at,
         'source',jsonb_build_object('kind','crm_document','caseId',c.id,'slotId',d.document_slot_id,'versionId',d.id),
         'exportExternal',jsonb_build_object('kind','document','id',d.id,'bucket',d.bucket_id,'path',d.object_name,'sha256',d.sha256_hex,'byteSize',d.byte_size),
         'exportError',CASE WHEN d.object_name IS NULL OR NOT platform_private.student_document_has_scan_proof(p_org,d.id) THEN 'knowledge_blob_not_ready' END));
   END LOOP;
 END LOOP;
 IF all_company OR cardinality(company_ids)>0 OR cardinality(requested_folders)>0 THEN
   WITH RECURSIVE chosen AS (
     SELECT f.id FROM platform.company_file_folders f WHERE f.organization_id=p_org AND (all_company OR f.id=ANY(requested_folders)) AND (archive OR f.archived_at IS NULL)
     UNION SELECT f.id FROM platform.company_file_folders f JOIN chosen c ON f.parent_folder_id=c.id WHERE f.organization_id=p_org AND (archive OR f.archived_at IS NULL)
   ) SELECT coalesce(array_agg(id),'{}') INTO selected_folders FROM chosen;
   WITH RECURSIVE ancestors AS (
     SELECT f.id,f.parent_folder_id FROM platform.company_file_folders f WHERE f.organization_id=p_org AND (
       f.id=ANY(selected_folders) OR EXISTS(SELECT 1 FROM platform.company_files cf JOIN platform.company_file_versions v ON v.company_file_id=cf.id AND v.organization_id=cf.organization_id
         WHERE cf.organization_id=p_org AND cf.folder_id=f.id AND v.id=ANY(company_ids)))
     UNION SELECT f.id,f.parent_folder_id FROM platform.company_file_folders f JOIN ancestors a ON a.parent_folder_id=f.id WHERE f.organization_id=p_org
   ) SELECT coalesce(array_agg(id),'{}') INTO visible_folders FROM ancestors;
   RETURN NEXT platform_private.kb_projection(company_root,p_org,'internal',NULL,'folder','Документы компании',coalesce((SELECT max(updated_at) FROM platform.company_files WHERE organization_id=p_org),'2000-01-01'::TIMESTAMPTZ));
   FOR f IN SELECT * FROM platform.company_file_folders WHERE organization_id=p_org AND id=ANY(visible_folders) ORDER BY id LOOP
     RETURN NEXT platform_private.kb_projection(f.id,p_org,'internal',coalesce(f.parent_folder_id,company_root),'folder',f.name,f.updated_at,jsonb_build_object('archived_at',f.archived_at));
   END LOOP;
   FOR d IN SELECT v.*,cf.folder_id,cf.display_name,cf.current_version_id,cf.archived_at,u.bucket_id,u.object_name
     FROM platform.company_files cf JOIN platform.company_file_versions v ON v.organization_id=cf.organization_id AND v.company_file_id=cf.id
     LEFT JOIN platform_private.company_file_upload_finalizations u ON u.organization_id=v.organization_id AND u.company_file_version_id=v.id
     WHERE cf.organization_id=p_org AND (archive OR cf.archived_at IS NULL)
       AND (v.id=ANY(company_ids)
         OR ((all_company OR cf.folder_id=ANY(selected_folders)) AND (history OR v.id=cf.current_version_id))
         OR (history AND EXISTS(SELECT 1 FROM platform.company_file_versions chosen WHERE chosen.organization_id=p_org AND chosen.company_file_id=cf.id AND chosen.id=ANY(company_ids))))
     ORDER BY cf.id,v.version_no
   LOOP
     RETURN NEXT platform_private.kb_projection(d.id,p_org,'internal',coalesce(d.folder_id,company_root),'file',
       CASE WHEN d.id=d.current_version_id THEN d.display_name ELSE 'Версия '||d.version_no||' — '||d.original_filename END,d.created_at,
       jsonb_build_object('version',d.version_no,'archived_at',d.archived_at,
         'source',jsonb_build_object('kind','crm_company_file','fileId',d.company_file_id,'versionId',d.id),
         'exportExternal',jsonb_build_object('kind','company','id',d.id,'bucket',d.bucket_id,'path',d.object_name,'sha256',d.sha256_hex,'byteSize',d.byte_size),
         'exportError',CASE WHEN d.object_name IS NULL OR NOT platform_private.company_file_has_scan_proof(p_org,d.id) THEN 'knowledge_blob_not_ready' END));
   END LOOP;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION platform_private.kb_export_canonical_selection(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.kb_export_v1(p_organization_id UUID,p_mode TEXT,p_id UUID DEFAULT NULL,p_options JSONB DEFAULT '{}')
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
     SELECT n.* FROM eligible n WHERE NOT(p_options?'canonical') AND CASE WHEN jsonb_array_length(coalesce(p_options->'ids','[]'))>0
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
     UNION ALL SELECT value FROM platform_private.kb_export_canonical_selection(p_organization_id,p_options) value
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


COMMIT;
