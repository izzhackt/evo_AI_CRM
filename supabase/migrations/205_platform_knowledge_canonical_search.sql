-- Read-only Admin search over existing CRM identities and document metadata.
BEGIN;
CREATE FUNCTION platform.kb_search_canonical_v1(p_organization_id UUID,p_query JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE term TEXT:=btrim(coalesce(p_query->>'search',''));
 lim INTEGER:=coalesce((p_query->>'limit')::INTEGER,50); result JSONB;
 after_title TEXT:=p_query->>'afterTitle'; after_kind TEXT:=p_query->>'afterKind';
 after_id UUID:=nullif(p_query->>'afterId','')::UUID;
BEGIN
 PERFORM platform_private.kb_require_admin(p_organization_id);
 IF length(term) NOT BETWEEN 1 AND 240 OR lim NOT BETWEEN 1 AND 200
   OR ((after_title IS NOT NULL OR after_kind IS NOT NULL OR after_id IS NOT NULL)
     AND (after_title IS NULL OR length(after_title)>1024 OR after_kind IS NULL
       OR after_kind NOT IN ('document','company','company_folder','snippet','case') OR after_id IS NULL)) THEN
   RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
 END IF;
 WITH sources AS (
   SELECT 'document'::TEXT AS source_kind,v.id,v.original_filename AS title,
     c.student_display_name||' · Дело '||left(c.id::TEXT,8) AS context,
     c.id AS case_id,NULL::UUID AS folder_id,v.updated_at,
     coalesce(s.display_label,'') AS search_text
   FROM platform.document_slots s
   JOIN platform.student_cases c ON c.id=s.student_case_id AND c.organization_id=s.organization_id
   JOIN platform.document_versions v ON v.id=s.current_version_id AND v.document_slot_id=s.id AND v.organization_id=s.organization_id
   WHERE s.organization_id=p_organization_id AND s.removed_at IS NULL
   UNION ALL
   SELECT 'company',v.id,f.display_name,'Документы компании',NULL,f.folder_id,v.created_at,v.original_filename
   FROM platform.company_files f
   JOIN platform.company_file_versions v ON v.id=f.current_version_id AND v.company_file_id=f.id AND v.organization_id=f.organization_id
   WHERE f.organization_id=p_organization_id AND f.archived_at IS NULL
   UNION ALL
   SELECT 'company_folder',f.id,f.name,'Папка документов компании',NULL,f.id,f.updated_at,''
   FROM platform.company_file_folders f WHERE f.organization_id=p_organization_id AND f.archived_at IS NULL
   UNION ALL
   SELECT 'snippet',s.id,s.title,'Шаблон ответа',NULL,NULL,s.updated_at,s.body
   FROM platform.reply_snippets s WHERE s.organization_id=p_organization_id AND s.archived_at IS NULL
   UNION ALL
   SELECT 'case',c.id,c.student_display_name,'Дело '||left(c.id::TEXT,8),c.id,NULL,c.updated_at,c.id::TEXT
   FROM platform.student_cases c WHERE c.organization_id=p_organization_id
 ), page AS (
   SELECT source_kind,id,title,context,case_id,folder_id,updated_at FROM sources
   WHERE position(lower(term) IN lower(title||' '||context||' '||search_text))>0
     AND (after_id IS NULL OR (title,source_kind,id)>(after_title,after_kind,after_id))
   ORDER BY title,source_kind,id LIMIT lim+1
 )
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY title,source_kind,id),'[]') INTO result FROM page;
 RETURN jsonb_build_object('organizationId',p_organization_id,'items',result,'hasMore',jsonb_array_length(result)>lim);
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_search_canonical_v1(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_search_canonical_v1(UUID,JSONB) TO authenticated;
COMMIT;
