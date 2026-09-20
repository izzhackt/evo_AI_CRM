-- CRM-03: one scoped, cursor-paged read of the three existing intake kinds.
-- Existing commands, legacy readers and migration-111 integrity checks remain.
BEGIN;

CREATE FUNCTION platform.staff_requests_queue_v1(
  p_organization_id UUID,
  p_source TEXT DEFAULT 'all',
  p_application_status TEXT DEFAULT 'pending',
  p_consultation_status TEXT DEFAULT 'all',
  p_limit INTEGER DEFAULT 50,
  p_cursor JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_state TEXT := 'not-requested';
  application_state TEXT := 'not-requested';
  consultation_state TEXT := 'not-requested';
  application_org UUID;
  cursor_at TIMESTAMPTZ;
  cursor_kind TEXT;
  cursor_id UUID;
  backwards BOOLEAN := FALSE;
  result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.platform_role = 'student'
    OR p_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'requests_queue_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('all','website','whatsapp','platform_application','portal_consultation')
    OR p_application_status IS NULL OR p_application_status NOT IN ('pending','all')
    OR p_consultation_status IS NULL OR p_consultation_status NOT IN ('all','requested','handled')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'requests_queue_invalid_filter' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cursor) k)
      IS DISTINCT FROM ARRAY['applicationStatus','consultationStatus','direction','id','kind','limit','source','timestamp','v']::TEXT[]
      OR p_cursor->'v' IS DISTINCT FROM '1'::JSONB
      OR p_cursor->'limit' IS DISTINCT FROM to_jsonb(p_limit)
      OR p_cursor->'source' IS DISTINCT FROM to_jsonb(p_source)
      OR p_cursor->'applicationStatus' IS DISTINCT FROM to_jsonb(p_application_status)
      OR p_cursor->'consultationStatus' IS DISTINCT FROM to_jsonb(p_consultation_status)
      OR jsonb_typeof(p_cursor->'direction') IS DISTINCT FROM 'string'
      OR p_cursor->>'direction' NOT IN ('next','previous')
      OR jsonb_typeof(p_cursor->'kind') IS DISTINCT FROM 'string'
      OR p_cursor->>'kind' NOT IN ('lead','application','consultation')
      OR jsonb_typeof(p_cursor->'id') IS DISTINCT FROM 'string'
      OR p_cursor->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_cursor->'timestamp') IS DISTINCT FROM 'string'
      OR p_cursor->>'timestamp' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    BEGIN
      cursor_at := (p_cursor->>'timestamp')::TIMESTAMPTZ;
      cursor_id := (p_cursor->>'id')::UUID;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END;
    cursor_kind := p_cursor->>'kind';
    IF p_source<>'all' AND cursor_kind<>(CASE WHEN p_source IN ('website','whatsapp') THEN 'lead'
      WHEN p_source='platform_application' THEN 'application' ELSE 'consultation' END) THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor_kind' USING ERRCODE = '22023';
    END IF;
    backwards := p_cursor->>'direction' = 'previous';
  END IF;

  IF p_source IN ('all','website','whatsapp') THEN
    lead_state := 'forbidden';
    IF platform_private.staff_has_permission(actor.organization_id,actor.membership_id,'lead.read') THEN
      -- Executes the complete 111 receipt/audit/current-workflow guard. The
      -- returned limited row is discarded, never used to aggregate this queue.
      -- In particular, 23514 is NOT caught or relabelled as empty/forbidden.
      PERFORM private.staff_sales_lead_page(1);
      lead_state := 'ready';
    END IF;
  END IF;
  IF p_source IN ('all','platform_application') THEN
    application_state := 'forbidden';
    BEGIN
      application_org := platform_private.student_application_staff_org();
      IF application_org IS DISTINCT FROM actor.organization_id THEN
        RAISE EXCEPTION 'requests_queue_authority_mismatch' USING ERRCODE = '23514';
      END IF;
      application_state := 'ready';
    EXCEPTION WHEN insufficient_privilege THEN
      application_state := 'forbidden';
    END;
  END IF;
  IF p_source IN ('all','portal_consultation') THEN
    consultation_state := CASE WHEN private.platform_has_permission(actor.organization_id,'lead.read')
      THEN 'ready' ELSE 'forbidden' END;
  END IF;

  -- One STABLE statement snapshot; scope/source/status precede page selection.
  WITH scoped AS MATERIALIZED (
    SELECT l.created_at AS sort_at, 'lead'::TEXT COLLATE "C" AS kind, l.id,
      'open'::TEXT AS status
    FROM platform.leads l
    WHERE lead_state='ready' AND l.organization_id=actor.organization_id
      AND l.lifecycle_state='open' AND l.source_key IN ('website','whatsapp')
      AND (p_source='all' OR l.source_key=p_source)
      AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
    UNION ALL
    SELECT a.submitted_at, 'application', a.id, a.status
    FROM platform_private.student_applications a
    WHERE application_state='ready' AND a.organization_id=actor.organization_id
      AND platform_private.student_application_visible(a.organization_id,a.questionnaire)
    UNION ALL
    SELECT r.created_at, 'consultation', r.id, r.status
    FROM platform_private.portal_consultation_requests r
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    WHERE consultation_state='ready' AND r.organization_id=actor.organization_id
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped s
    WHERE (s.kind<>'application' OR p_application_status='all' OR s.status='pending')
      AND (s.kind<>'consultation' OR p_consultation_status='all' OR s.status=p_consultation_status)
  ), page AS MATERIALIZED (
    SELECT * FROM filtered f
    WHERE cursor_at IS NULL
      OR (NOT backwards AND (f.sort_at,f.kind,f.id)<(cursor_at,cursor_kind COLLATE "C",cursor_id))
      OR (backwards AND (f.sort_at,f.kind,f.id)>(cursor_at,cursor_kind COLLATE "C",cursor_id))
    ORDER BY CASE WHEN backwards THEN f.sort_at END ASC,
      CASE WHEN backwards THEN f.kind END ASC, CASE WHEN backwards THEN f.id END ASC,
      f.sort_at DESC,f.kind DESC,f.id DESC LIMIT p_limit
  ), rendered AS (
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source',l.source_key,
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',COALESCE(c.display_name,c.email,c.phone,'Без имени'),
      'email',c.email,'phone',c.phone,'leadId',l.id) AS payload
    FROM page q JOIN platform.leads l ON q.kind='lead' AND l.id=q.id AND l.organization_id=actor.organization_id
    LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','platform_application',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',concat(a.questionnaire->>'firstName',' ',a.questionnaire->>'lastName'),
      'email',a.normalized_email,'leadId',a.canonical_lead_id,
      'application',platform_private.student_application_json(a.id))
    FROM page q JOIN platform_private.student_applications a ON q.kind='application' AND a.id=q.id AND a.organization_id=actor.organization_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','portal_consultation',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',p.display_name,
      'consultation',jsonb_build_object('id',r.id,'status',r.status,'studentName',p.display_name,
        'institutionId',r.institution_id,
        'institutionName',CASE WHEN r.institution_id IS NULL THEN NULL ELSE
          platform_private.portal_consultation_institution_name(r.organization_id,r.institution_id) END,
        'note',r.note,'requestedAt',r.created_at,'handledAt',r.handled_at,'handledByName',hp.display_name))
    FROM page q JOIN platform_private.portal_consultation_requests r ON q.kind='consultation' AND r.id=q.id AND r.organization_id=actor.organization_id
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    LEFT JOIN platform.organization_memberships hm ON hm.organization_id=r.organization_id AND hm.id=r.handled_by_membership_id
    LEFT JOIN platform.profiles hp ON hp.id=hm.profile_id
  ), bounds AS (
    SELECT 'previous'::TEXT AS direction, first_row.sort_at, first_row.kind, first_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at DESC,kind DESC,id DESC LIMIT 1) first_row
    UNION ALL
    SELECT 'next', last_row.sort_at,last_row.kind,last_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at,kind,id LIMIT 1) last_row
    UNION ALL
    -- A status/access change may empty a bookmarked page. Retain a route back
    -- to remaining rows without promising a snapshot across separate reads.
    SELECT CASE WHEN backwards THEN 'next' ELSE 'previous' END,cursor_at,cursor_kind,cursor_id
      WHERE cursor_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM page)
  ), cursors AS (
    SELECT b.direction,jsonb_build_object('v',1,'direction',b.direction,
      'source',p_source,'applicationStatus',p_application_status,'consultationStatus',p_consultation_status,
      'limit',p_limit,'timestamp',to_char(b.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',b.kind,'id',b.id) AS value
    FROM bounds b WHERE EXISTS(SELECT 1 FROM filtered f WHERE
      (b.direction='next' AND (f.sort_at,f.kind,f.id)<(b.sort_at,b.kind COLLATE "C",b.id)) OR
      (b.direction='previous' AND (f.sort_at,f.kind,f.id)>(b.sort_at,b.kind COLLATE "C",b.id)))
  )
  SELECT jsonb_build_object('version',1,'organizationId',actor.organization_id,
    'source',p_source,'applicationStatus',p_application_status,'consultationStatus',p_consultation_status,'limit',p_limit,
    'states',jsonb_build_object('lead',lead_state,'application',application_state,'consultation',consultation_state),
    'counts',jsonb_build_object(
      'lead',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM filtered WHERE kind='lead') END,
      'application',CASE WHEN application_state='ready' THEN (SELECT count(*) FROM filtered WHERE kind='application') END,
      'consultation',CASE WHEN consultation_state='ready' THEN (SELECT count(*) FROM filtered WHERE kind='consultation') END,
      'pendingApplications',CASE WHEN application_state='ready' THEN (SELECT count(*) FROM scoped WHERE kind='application' AND status='pending') END,
      'openConsultations',CASE WHEN consultation_state='ready' THEN (SELECT count(*) FROM scoped WHERE kind='consultation' AND status='requested') END),
    'rows',COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at DESC,kind DESC,id DESC) FROM rendered),'[]'::JSONB),
    'nextCursor',(SELECT value FROM cursors WHERE direction='next'),
    'previousCursor',(SELECT value FROM cursors WHERE direction='previous')) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_requests_queue_v1(UUID,TEXT,TEXT,TEXT,INTEGER,JSONB)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_requests_queue_v1(UUID,TEXT,TEXT,TEXT,INTEGER,JSONB) TO authenticated;
COMMIT;
