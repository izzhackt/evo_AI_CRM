-- CRM-02e: exact direction labels across all authorized periods/archive states.
-- Separate facet contract; existing v1/v2 readers and business data are unchanged.
BEGIN;

CREATE FUNCTION private.read_sales_register_directions_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  invalid_direction BOOLEAN;
  directions JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);

  WITH scoped AS MATERIALIZED (
    SELECT r.fields->'direction' AS value, r.fields->>'direction' AS label
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id
      AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
        'sales.register.read', 'sales_register', r.id)
  ), labels AS (
    SELECT DISTINCT label COLLATE "C" AS label
    FROM scoped
    WHERE jsonb_typeof(value) = 'string' AND label <> ''
    ORDER BY label COLLATE "C"
    LIMIT 1001
  )
  SELECT EXISTS (
    SELECT 1 FROM scoped
    WHERE value IS NOT NULL AND value <> 'null'::JSONB
      AND (jsonb_typeof(value) <> 'string'
        OR length(label) > 500 OR label ~ '[[:cntrl:]]')
  ), coalesce((SELECT jsonb_agg(label ORDER BY label COLLATE "C") FROM labels), '[]'::JSONB)
  INTO invalid_direction, directions;

  IF invalid_direction THEN
    RAISE EXCEPTION 'sales_register_directions_invalid_value' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(directions) > 1000 THEN
    RAISE EXCEPTION 'sales_register_directions_limit_exceeded' USING ERRCODE = '54000';
  END IF;
  RETURN jsonb_build_object('organization_id', p_organization_id, 'directions', directions);
END
$$;

CREATE FUNCTION platform.read_sales_register_directions_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.read_sales_register_directions_v1(p_organization_id)
$$;

REVOKE ALL ON FUNCTION private.read_sales_register_directions_v1(UUID),
  platform.read_sales_register_directions_v1(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.read_sales_register_directions_v1(UUID),
  platform.read_sales_register_directions_v1(UUID) TO authenticated;
COMMIT;
