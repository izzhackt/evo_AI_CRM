-- Э3 (вторая часть) плана редизайна 25.09: «Заявки» — очередь разбора с
-- «Взять себе». docs/PLAN_CHANGES.md «2026-09-27 — Э3 (вторая часть):
-- «Заявки» — очередь разбора с «Взять себе» (миграция 250)».
--
-- Why (26.09 production audit, UXSALES): the requests queue gives no triage
-- signal. platform.staff_requests_queue_v1 (221) returns no lead owner, has
-- no «not taken yet» filter and counts only the selected source, so the
-- page cannot show who took a request, offer «Взять себе» only where the
-- server would accept it, or put honest counts on its tabs. No other read
-- composes into that: the sales board reads every lead in pages of 100 (up
-- to 4000), the lead detail one lead at a time, and neither pages or counts
-- the «waiting» subset.
--
-- platform.staff_requests_queue_v2 is v1 (221, the only and latest
-- definition) plus:
--  a) lead rows carry the owner (membership and display name), whether the
--     lead was handed off (the ONE definition, 247's
--     platform_private.sales_lead_handoffs) and «take»: present only when
--     platform.mutate_sales_lead_workflow (086 as rewritten by 156, the
--     existing owner-assignment command) would accept this actor setting
--     itself as the owner — the lead has no owner, is not handed off, the
--     actor holds lead.sales.workflow.manage and lead.sales.owner.assign on
--     THIS lead and may receive it (staff_can_receive_assignment for
--     lead.read and lead.sales.workflow.manage). «take» carries the version,
--     stage and next action the command requires the caller to repeat — the
--     same fields the board already shows this actor;
--  b) p_status 'waiting' | 'all': waiting = a lead with no owner that is not
--     handed off, an application 'pending', a consultation 'requested';
--  c) counts of every tab (website, whatsapp, application, consultation)
--     under p_status regardless of p_source; NULL (not zero) for a kind the
--     actor cannot read;
--  d) latestAt: the newest request of the selected source in any status.
--
-- Unchanged from v1: the per-kind gates (lead.read plus the 111 guard of
-- private.staff_sales_lead_page, row scope staff_can_access lead.read; the
-- 177 application gate and direction visibility; consultations by
-- lead.read), keyset paging on (sort_at, kind, id) with PostgreSQL C order,
-- the emptied-bookmark route back, one STABLE statement snapshot. The
-- student check is explicit (IS NOT DISTINCT FROM): invited staff have a NULL
-- coarse role. v1 stays: the previous application release reads it until
-- the new release is accepted.
--
-- Functions only: no table, row, owner or grant change on existing objects.
-- SECURITY DEFINER with search_path = ''; EXECUTE to authenticated only.
BEGIN;

CREATE FUNCTION platform.staff_requests_queue_v2(
  p_organization_id UUID,
  p_source TEXT DEFAULT 'all',
  p_status TEXT DEFAULT 'waiting',
  p_limit INTEGER DEFAULT 50,
  p_cursor JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_state TEXT := 'forbidden';
  application_state TEXT := 'forbidden';
  consultation_state TEXT := 'forbidden';
  application_org UUID;
  cursor_at TIMESTAMPTZ;
  cursor_kind TEXT;
  cursor_id UUID;
  backwards BOOLEAN := FALSE;
  result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.platform_role IS NOT DISTINCT FROM 'student'
    OR p_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'requests_queue_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('all','website','whatsapp','platform_application','portal_consultation')
    OR p_status IS NULL OR p_status NOT IN ('waiting','all')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'requests_queue_invalid_filter' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cursor) k)
      IS DISTINCT FROM ARRAY['direction','id','kind','limit','source','status','timestamp','v']::TEXT[]
      OR p_cursor->'v' IS DISTINCT FROM '2'::JSONB
      OR p_cursor->'limit' IS DISTINCT FROM to_jsonb(p_limit)
      OR p_cursor->'source' IS DISTINCT FROM to_jsonb(p_source)
      OR p_cursor->'status' IS DISTINCT FROM to_jsonb(p_status)
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

  -- Every kind is evaluated whatever the tab: the tabs carry their counts.
  IF platform_private.staff_has_permission(actor.organization_id,actor.membership_id,'lead.read') THEN
    -- The complete 111 receipt/audit/current-workflow guard, as in v1. The
    -- returned limited row is discarded; 23514 is NOT caught or relabelled.
    PERFORM private.staff_sales_lead_page(1);
    lead_state := 'ready';
  END IF;
  BEGIN
    application_org := platform_private.student_application_staff_org();
    IF application_org IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'requests_queue_authority_mismatch' USING ERRCODE = '23514';
    END IF;
    application_state := 'ready';
  EXCEPTION WHEN insufficient_privilege THEN
    application_state := 'forbidden';
  END;
  consultation_state := CASE WHEN private.platform_has_permission(actor.organization_id,'lead.read')
    THEN 'ready' ELSE 'forbidden' END;

  -- One STABLE statement snapshot; scope/source/status precede page selection.
  WITH lead_scope AS MATERIALIZED (
    SELECT l.id, l.created_at, l.source_key::TEXT AS source, l.current_owner_membership_id
    FROM platform.leads l
    WHERE lead_state='ready' AND l.organization_id=actor.organization_id
      AND l.lifecycle_state='open' AND l.source_key IN ('website','whatsapp')
      AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
  ), handed AS MATERIALIZED (
    SELECT h.lead_id FROM platform_private.sales_lead_handoffs(actor.organization_id,
      ARRAY(SELECT s.id FROM lead_scope s)) h
  ), scoped AS MATERIALIZED (
    SELECT s.created_at AS sort_at, 'lead'::TEXT COLLATE "C" AS kind, s.id, s.source,
      (s.current_owner_membership_id IS NULL AND NOT EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=s.id)) AS waiting
    FROM lead_scope s
    UNION ALL
    SELECT a.submitted_at, 'application', a.id, 'platform_application', a.status='pending'
    FROM platform_private.student_applications a
    WHERE application_state='ready' AND a.organization_id=actor.organization_id
      AND platform_private.student_application_visible(a.organization_id,a.questionnaire)
    UNION ALL
    SELECT r.created_at, 'consultation', r.id, 'portal_consultation', r.status='requested'
    FROM platform_private.portal_consultation_requests r
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    WHERE consultation_state='ready' AND r.organization_id=actor.organization_id
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped s
    WHERE (p_source='all' OR s.source=p_source) AND (p_status='all' OR s.waiting)
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
      'email',c.email,'phone',c.phone,'leadId',l.id,
      'owner',CASE WHEN l.current_owner_membership_id IS NULL THEN NULL
        ELSE jsonb_build_object('membershipId',l.current_owner_membership_id,'name',op.display_name) END,
      'handedOff',EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=l.id),
      -- Exactly the owner checks of platform.mutate_sales_lead_workflow (156).
      'take',CASE WHEN q.waiting
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.owner.assign','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        THEN jsonb_build_object('workflowVersion',l.workflow_version::TEXT,'stageKey',l.stage_key,
          'nextActionText',l.next_action_text,'nextActionDueDate',to_char(l.next_action_due_date,'YYYY-MM-DD'))
        END) AS payload
    FROM page q JOIN platform.leads l ON q.kind='lead' AND l.id=q.id AND l.organization_id=actor.organization_id
    LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    LEFT JOIN platform.organization_memberships om ON om.organization_id=l.organization_id AND om.id=l.current_owner_membership_id
    LEFT JOIN platform.profiles op ON op.id=om.profile_id
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
    SELECT b.direction,jsonb_build_object('v',2,'direction',b.direction,
      'source',p_source,'status',p_status,
      'limit',p_limit,'timestamp',to_char(b.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',b.kind,'id',b.id) AS value
    FROM bounds b WHERE EXISTS(SELECT 1 FROM filtered f WHERE
      (b.direction='next' AND (f.sort_at,f.kind,f.id)<(b.sort_at,b.kind COLLATE "C",b.id)) OR
      (b.direction='previous' AND (f.sort_at,f.kind,f.id)>(b.sort_at,b.kind COLLATE "C",b.id)))
  )
  SELECT jsonb_build_object('version',2,'organizationId',actor.organization_id,
    'source',p_source,'status',p_status,'limit',p_limit,
    'states',jsonb_build_object('lead',lead_state,'application',application_state,'consultation',consultation_state),
    'counts',jsonb_build_object(
      'website',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='website' AND (p_status='all' OR s.waiting)) END,
      'whatsapp',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='whatsapp' AND (p_status='all' OR s.waiting)) END,
      'application',CASE WHEN application_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='application' AND (p_status='all' OR s.waiting)) END,
      'consultation',CASE WHEN consultation_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='consultation' AND (p_status='all' OR s.waiting)) END),
    'latestAt',(SELECT to_char(max(s.sort_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM scoped s WHERE p_source='all' OR s.source=p_source),
    'rows',COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at DESC,kind DESC,id DESC) FROM rendered),'[]'::JSONB),
    'nextCursor',(SELECT value FROM cursors WHERE direction='next'),
    'previousCursor',(SELECT value FROM cursors WHERE direction='previous')) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_requests_queue_v2(UUID,TEXT,TEXT,INTEGER,JSONB)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_requests_queue_v2(UUID,TEXT,TEXT,INTEGER,JSONB) TO authenticated;

COMMENT ON FUNCTION platform.staff_requests_queue_v2(UUID,TEXT,TEXT,INTEGER,JSONB) IS
  'Э3 «Заявки» (250): v1 (221) plus the lead owner, the 247 handoff flag, «take» exactly when mutate_sales_lead_workflow (156) would accept the actor as the new owner, the waiting/all state, every tab''s count (NULL for an unreadable kind) and the newest request of the source.';
COMMIT;
