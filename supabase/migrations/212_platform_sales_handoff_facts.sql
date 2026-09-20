-- CRM-05: an existing Student case is not a completed admissions handoff.
-- Read only; financial data and case identifiers never leave this projection.
BEGIN;

CREATE FUNCTION platform.staff_sales_handoff_facts(p_organization_id UUID, p_lead_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  visible_count BIGINT;
  facts JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) > 4000
    OR EXISTS (SELECT 1 FROM unnest(p_lead_ids) id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_lead_ids) id) <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_invalid' USING ERRCODE = '22023';
  END IF;

  WITH visible_leads AS MATERIALIZED (
    SELECT l.id, l.client_id FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids)
      AND l.lifecycle_state = 'open'
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
  ), completed AS (
    SELECT h.lead_id, h.handed_off_at AS completed_at
    FROM platform.sales_admissions_handoffs h
    JOIN visible_leads l ON l.id = h.lead_id AND l.client_id = h.client_id
    WHERE h.organization_id = p_organization_id AND h.handoff_state = 'completed'
    UNION ALL
    -- 208 activates a pre-existing cabinet case without inserting an 088 row.
    -- Require BOTH its pipeline provenance and its immutable create receipt.
    -- Archive, current case state and curator do not undo a historical handoff.
    SELECT r.lead_id, request.created_at
    FROM platform_private.sales_register r
    JOIN visible_leads l ON l.id = r.lead_id AND l.client_id = r.client_id
    JOIN platform.student_cases c ON c.organization_id = r.organization_id
      AND c.canonical_lead_id = r.lead_id AND c.canonical_client_id = r.client_id
      AND c.id::TEXT = r.source_snapshot->>'student_case_id'
    JOIN platform_private.sales_report_handoff_requests request
      ON request.organization_id = r.organization_id
      AND request.receipt->>'organization_id' = r.organization_id::TEXT
      AND request.receipt->>'operation' = 'create'
      AND request.receipt->>'record_id' = r.id::TEXT
      AND request.receipt->>'student_case_id' = c.id::TEXT
      AND request.receipt->>'request_id' = request.request_id::TEXT
    WHERE r.organization_id = p_organization_id AND r.source_kind = 'pipeline'
      AND r.source_snapshot->>'activation' = 'pending_case'
  ), handoffs AS (
    SELECT lead_id, min(completed_at) AS completed_at FROM completed GROUP BY lead_id
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
    'lead_id', l.id, 'completed', h.completed_at IS NOT NULL,
    'completed_at', h.completed_at) ORDER BY l.id), '[]'::JSONB)
  INTO visible_count, facts
  FROM visible_leads l LEFT JOIN handoffs h ON h.lead_id = l.id;

  -- Missing, closed and inaccessible IDs all deny the complete batch. Never
  -- turn an omitted record into a false "not handed off" result.
  IF visible_count <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  -- JSON avoids PostgREST's row cap silently clipping a board-sized batch.
  RETURN jsonb_build_object('organization_id', p_organization_id, 'leads', facts);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_handoff_facts(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_sales_handoff_facts(UUID, UUID[]) TO authenticated;

COMMIT;
