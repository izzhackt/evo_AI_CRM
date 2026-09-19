-- Draft; apply after the library schema and before export-schema.sql.
-- These are export projections. They do not create another case/document identity.
BEGIN;
CREATE FUNCTION platform_private.kb_projection(p_id UUID,p_org UUID,p_area TEXT,p_parent UUID,p_kind TEXT,p_title TEXT,p_at TIMESTAMPTZ,p_extra JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_id,'organization_id',p_org,'area',p_area,'parent_id',p_parent,
 'kind',p_kind,'title',p_title,'updated_at',p_at,'version',1,'exportSelected',TRUE)||p_extra
$$;
REVOKE ALL ON FUNCTION platform_private.kb_projection(UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.kb_canonical_snapshots(p_org UUID,p_options JSONB)
RETURNS SETOF JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c RECORD; d RECORD; f RECORD; page JSONB; cursor JSONB; previous_cursor JSONB;
 body TEXT; folder UUID; company_root UUID:=md5(p_org::TEXT||':company')::UUID;
 all_clients BOOLEAN:=jsonb_array_length(coalesce(p_options->'ids','[]'))=0 AND jsonb_array_length(coalesce(p_options->'caseIds','[]'))=0 AND (NOT(p_options?'area') OR p_options->>'area'='clients');
 all_company BOOLEAN:=jsonb_array_length(coalesce(p_options->'ids','[]'))=0 AND jsonb_array_length(coalesce(p_options->'caseIds','[]'))=0 AND (NOT(p_options?'area') OR p_options->>'area'='internal');
 include_history BOOLEAN:=coalesce((p_options->>'includeHistory')::BOOLEAN,FALSE);
 include_archive BOOLEAN:=coalesce((p_options->>'includeArchive')::BOOLEAN,FALSE);
 include_trash BOOLEAN:=coalesce((p_options->>'includeTrash')::BOOLEAN,FALSE);
BEGIN
 PERFORM platform_private.kb_require_admin(p_org);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_options->'caseIds','[]')) x(id)
   WHERE NOT EXISTS(SELECT 1 FROM platform.student_cases WHERE organization_id=p_org AND id=x.id::UUID)) THEN
   RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002';
 END IF;
 FOR c IN SELECT sc.* FROM platform.student_cases sc WHERE sc.organization_id=p_org AND (
   all_clients OR sc.id IN (SELECT value::UUID FROM jsonb_array_elements_text(coalesce(p_options->'caseIds','[]'))))
   ORDER BY sc.id
 LOOP
   RETURN NEXT platform_private.kb_projection(c.id,p_org,'clients',NULL,'folder',c.student_display_name,c.updated_at,
     jsonb_build_object('source',jsonb_build_object('kind','crm_case','caseId',c.id)));
   body:='# '||c.student_display_name||E'\n\n```json\n'||jsonb_pretty(jsonb_build_object(
     'caseId',c.id,'country',c.target_country,'degree',c.target_degree,'direction',c.program_direction,
     'intake',c.intake,'stage',c.operational_stage,'state',c.state,'nextAction',c.next_action))||E'\n```\n';
   RETURN NEXT platform_private.kb_projection(md5(c.id::TEXT||':overview')::UUID,p_org,'clients',c.id,'page','Досье',c.updated_at,jsonb_build_object('body',body));
   folder:=md5(c.id::TEXT||':documents')::UUID;
   RETURN NEXT platform_private.kb_projection(folder,p_org,'clients',c.id,'folder','Документы',c.updated_at);
   -- Slot checklist, versions and reviews are read through the existing case RPC.
   IF c.handoff_at IS NOT NULL AND c.state::TEXT IN ('active','closed') THEN
     SELECT platform.staff_student_case_document_workspace(c.id) INTO page;
   ELSE
     page:=jsonb_build_object('caseId',c.id,'status','pending_handoff','note','Рабочий список документов доступен после передачи дела.');
   END IF;
   RETURN NEXT platform_private.kb_projection(md5(c.id::TEXT||':checklist')::UUID,p_org,'clients',folder,'page','Состав документов',c.updated_at,
     jsonb_build_object('body',E'# Состав документов\n\n```json\n'||jsonb_pretty(page)||E'\n```\n'));
   FOR d IN SELECT v.*,s.removed_at,s.current_version_id,u.bucket_id,u.object_name
     FROM platform.document_slots s JOIN platform.document_versions v ON v.organization_id=s.organization_id AND v.document_slot_id=s.id
     LEFT JOIN platform_private.document_upload_finalizations u ON u.organization_id=v.organization_id AND u.document_version_id=v.id
     WHERE s.organization_id=p_org AND s.student_case_id=c.id AND (include_trash OR s.removed_at IS NULL)
       AND (include_history OR v.id=s.current_version_id) ORDER BY s.id,v.version_no
   LOOP
     RETURN NEXT platform_private.kb_projection(d.id,p_org,'clients',folder,'file',
       CASE WHEN d.id=d.current_version_id THEN d.original_filename ELSE 'Версия '||d.version_no||' — '||d.original_filename END,d.updated_at,
       jsonb_build_object('version',d.version_no,'deleted_at',d.removed_at,
         'source',jsonb_build_object('kind','crm_document','caseId',c.id,'slotId',d.document_slot_id,'versionId',d.id),
         'exportExternal',jsonb_build_object('kind','document','id',d.id,'bucket',d.bucket_id,'path',d.object_name,'sha256',d.sha256_hex,'byteSize',d.byte_size),
         'exportError',CASE WHEN d.object_name IS NULL OR NOT platform_private.student_document_has_scan_proof(p_org,d.id) THEN 'knowledge_blob_not_ready' END));
   END LOOP;
   -- Canonical case chat is read-only here: exporting must not mark messages read.
   body:='# Переписка'||E'\n';
   FOR d IN SELECT m.id,m.author_membership_id,m.body,m.quoted_message_id,m.attachment_kind,m.attachment_id,m.created_at
     FROM platform.case_chat_messages m WHERE m.organization_id=p_org AND m.student_case_id=c.id ORDER BY m.sequence_id
   LOOP
     body:=body||E'\n## '||d.created_at::TEXT||E'\n\n'||d.body||E'\n\n';
     body:=body||'Автор: '||d.author_membership_id::TEXT||E'\n\n';
     IF d.attachment_id IS NOT NULL THEN
       IF d.attachment_kind='document' THEN
         SELECT current_version_id INTO folder FROM platform.document_slots WHERE organization_id=p_org AND student_case_id=c.id AND id=d.attachment_id;
         IF folder IS NOT NULL THEN body:=body||'[Документ](/api/v2/document-versions/'||folder::TEXT||E'/download)\n';
         ELSE body:=body||'Документ: '||d.attachment_id::TEXT||E'\n'; END IF;
       ELSE body:=body||'Вложение: '||d.attachment_kind||' '||d.attachment_id::TEXT||E'\n'; END IF;
     END IF;
     IF d.quoted_message_id IS NOT NULL THEN body:=body||'Ответ на: '||d.quoted_message_id::TEXT||E'\n'; END IF;
   END LOOP;
   RETURN NEXT platform_private.kb_projection(md5(c.id::TEXT||':chat')::UUID,p_org,'clients',c.id,'page','Переписка',c.updated_at,jsonb_build_object('body',body));
   body:=E'# История дела\n'; cursor:=NULL;
   LOOP
     page:=platform.staff_student_case_activity(c.id,100,(cursor->>'at')::TIMESTAMPTZ,(cursor->>'id')::UUID);
     body:=body||E'\n```json\n'||jsonb_pretty(page->'events')||E'\n```\n';
     previous_cursor:=cursor; cursor:=page->'next_cursor';
     EXIT WHEN cursor IS NULL OR cursor='null'::JSONB;
     IF cursor=previous_cursor THEN RAISE EXCEPTION 'knowledge_export_structure_invalid'; END IF;
   END LOOP;
   RETURN NEXT platform_private.kb_projection(md5(c.id::TEXT||':history')::UUID,p_org,'clients',c.id,'page','История дела',c.updated_at,jsonb_build_object('body',body));
 END LOOP;
 IF all_company THEN
   RETURN NEXT platform_private.kb_projection(company_root,p_org,'internal',NULL,'folder','Документы компании',coalesce((SELECT max(updated_at) FROM platform.company_files WHERE organization_id=p_org),'2000-01-01'::TIMESTAMPTZ));
   FOR f IN SELECT * FROM platform.company_file_folders WHERE organization_id=p_org AND (include_archive OR archived_at IS NULL) ORDER BY id LOOP
     RETURN NEXT platform_private.kb_projection(f.id,p_org,'internal',coalesce(f.parent_folder_id,company_root),'folder',f.name,f.updated_at,jsonb_build_object('archived_at',f.archived_at));
   END LOOP;
   FOR d IN SELECT v.*,cf.folder_id,cf.display_name,cf.current_version_id,cf.archived_at,u.bucket_id,u.object_name
     FROM platform.company_files cf JOIN platform.company_file_versions v ON v.organization_id=cf.organization_id AND v.company_file_id=cf.id
     LEFT JOIN platform_private.company_file_upload_finalizations u ON u.organization_id=v.organization_id AND u.company_file_version_id=v.id
     WHERE cf.organization_id=p_org AND (include_archive OR cf.archived_at IS NULL) AND (include_history OR v.id=cf.current_version_id)
     ORDER BY cf.id,v.version_no
   LOOP
     RETURN NEXT platform_private.kb_projection(d.id,p_org,'internal',coalesce(d.folder_id,company_root),'file',
       CASE WHEN d.id=d.current_version_id THEN d.display_name ELSE 'Версия '||d.version_no||' — '||d.original_filename END,d.created_at,
       jsonb_build_object('version',d.version_no,'archived_at',d.archived_at,
         'source',jsonb_build_object('kind','crm_company_file','fileId',d.company_file_id,'versionId',d.id),
         'exportExternal',jsonb_build_object('kind','company','id',d.id,'bucket',d.bucket_id,'path',d.object_name,'sha256',d.sha256_hex,'byteSize',d.byte_size),
         'exportError',CASE WHEN d.object_name IS NULL OR NOT platform_private.company_file_has_scan_proof(p_org,d.id) THEN 'knowledge_blob_not_ready' END));
   END LOOP;
   FOR f IN SELECT * FROM platform.reply_snippets WHERE organization_id=p_org AND (include_archive OR archived_at IS NULL) ORDER BY id LOOP
     RETURN NEXT platform_private.kb_projection(f.id,p_org,'internal',NULL,'page',f.title,f.updated_at,jsonb_build_object('body',f.body,'version',f.version,'archived_at',f.archived_at,
       'source',jsonb_build_object('kind','crm_reply_snippet','audience',f.audience)));
   END LOOP;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION platform_private.kb_canonical_snapshots(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
COMMIT;
