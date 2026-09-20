-- CRM-01: current open-lead stages and a separate, scoped report observation.
-- A Student case is not evidence of a sale. No records or workflow are changed.
BEGIN;

CREATE FUNCTION platform.current_sales_funnel(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  stages JSONB;
  lead_count BIGINT;
  sales_count BIGINT;
  can_read_report BOOLEAN;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_funnel_forbidden' USING ERRCODE = '42501';
  END IF;

  can_read_report := platform_private.staff_has_permission(
    p_organization_id, actor.membership_id, 'sales.register.read');

  -- The same lifecycle and record resolver as staff_sales_lead_page (094/156).
  -- Materialize the full authorized set once; there is no date filter or LIMIT.
  WITH visible_leads AS MATERIALIZED (
    SELECT l.id, l.stage_key FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.lifecycle_state = 'open'
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
  ), stage_keys(position, key) AS (VALUES
    (1, 'new'), (2, 'contacting'), (3, 'qualified'),
    (4, 'meeting_scheduled'), (5, 'meeting_completed'), (6, 'potential')
  ), stage_counts AS (
    SELECT s.position, s.key, count(l.id) AS count
    FROM stage_keys s LEFT JOIN visible_leads l ON l.stage_key = s.key
    GROUP BY s.position, s.key
  )
  SELECT
    (SELECT jsonb_agg(jsonb_build_object('key', s.key, 'count', s.count::TEXT)
      ORDER BY s.position) FROM stage_counts s),
    (SELECT count(*) FROM visible_leads),
    CASE WHEN can_read_report THEN (
      SELECT count(*) FROM platform_private.sales_register r
      JOIN visible_leads l ON l.id = r.lead_id
      WHERE r.organization_id = p_organization_id
        AND r.source_kind = 'pipeline' AND NOT r.archived
        AND platform_private.staff_can_access(
          p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
    ) ELSE NULL END
  INTO stages, lead_count, sales_count;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'lead_count', lead_count::TEXT,
    'stages', stages,
    'sales', jsonb_build_object(
      'status', CASE WHEN can_read_report THEN 'available' ELSE 'denied' END,
      'count', sales_count::TEXT));
END
$$;

REVOKE ALL ON FUNCTION platform.current_sales_funnel(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.current_sales_funnel(UUID) TO authenticated;

COMMIT;
