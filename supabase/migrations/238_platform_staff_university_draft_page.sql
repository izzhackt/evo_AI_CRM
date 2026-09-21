BEGIN;

-- Additive manage queue reader. Existing detail readers and commands are unchanged.
CREATE FUNCTION platform.staff_university_catalog_draft_page(
 p_organization_id UUID, p_query TEXT DEFAULT '',
 p_cursor_created_at TEXT DEFAULT NULL, p_cursor_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; cursor_time TIMESTAMPTZ;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage',TRUE) a WHERE a.actor_organization_id=p_organization_id) THEN
  RAISE EXCEPTION 'Drafts unavailable' USING ERRCODE='42501';
 END IF;
 IF p_query IS NULL OR char_length(p_query)>200 OR p_query ~ '[[:cntrl:]]' OR p_query<>btrim(p_query)
 OR ((p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)) THEN
  RAISE EXCEPTION 'Invalid draft query' USING ERRCODE='22023';
 END IF;
 IF p_cursor_created_at IS NOT NULL THEN
  IF p_cursor_created_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
  OR p_cursor_created_at LIKE '0000%' OR p_cursor_id::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid draft cursor' USING ERRCODE='22023';
  END IF;
  BEGIN
   cursor_time:=p_cursor_created_at::TIMESTAMPTZ;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
   RAISE EXCEPTION 'Invalid draft cursor' USING ERRCODE='22023';
  END;
  IF to_char(cursor_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_cursor_created_at THEN
   RAISE EXCEPTION 'Invalid draft cursor' USING ERRCODE='22023';
  END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT d.* FROM platform_private.university_catalog_publications d
  WHERE d.organization_id=p_organization_id AND d.status='draft'
   AND (p_query='' OR strpos(lower(d.content->>'name'),lower(p_query))>0)
   AND (cursor_time IS NULL OR d.created_at<cursor_time OR (d.created_at=cursor_time AND d.id>p_cursor_id))
  ORDER BY d.created_at DESC,d.id ASC LIMIT 51
 ), page AS (
  SELECT * FROM candidates ORDER BY created_at DESC,id ASC LIMIT 50
 )
 SELECT jsonb_build_object('organizationId',p_organization_id,'query',p_query,
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'institutionId',institution_id,'baseVersion',base_version,
   'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'content',content,'reason',reason,'status','draft','reviewKind',review_kind
  ) ORDER BY created_at DESC,id ASC) FROM page),'[]'::JSONB),
  'nextCursor',CASE WHEN (SELECT count(*) FROM candidates)>50 THEN
   (SELECT jsonb_build_object('createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',id)
    FROM page ORDER BY created_at ASC,id DESC LIMIT 1) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.staff_university_catalog_draft_page(UUID,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_university_catalog_draft_page(UUID,TEXT,TEXT,UUID) TO authenticated;
COMMIT;
