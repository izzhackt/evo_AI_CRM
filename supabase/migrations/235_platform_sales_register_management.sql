-- CRM-02f: management authority and the requested department target share one snapshot.
-- Contract: docs/EVO_SALES_MANAGEMENT_STATE_PLAN_2026-09-21.md.
-- Existing v1/v2 readers, commands, permissions and business rows are unchanged.
-- PostgreSQL17: https://www.postgresql.org/docs/17/xfunc-volatility.html
-- SECURITY DEFINER/ACL: https://www.postgresql.org/docs/17/sql-createfunction.html
BEGIN;

CREATE FUNCTION private.read_sales_register_management_v1(
  p_organization_id UUID, p_report_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  can_manage_target BOOLEAN;
  can_import BOOLEAN;
  department_target JSONB := NULL;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_has_permission(
    p_organization_id, actor.membership_id, 'sales.register.read'
  ) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_report_month IS NOT NULL AND (
    NOT isfinite(p_report_month)
    OR p_report_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01'
    OR extract(day FROM p_report_month) <> 1
  ) THEN
    RAISE EXCEPTION 'sales_register_invalid_month' USING ERRCODE = '22023';
  END IF;

  can_manage_target := platform_private.staff_can_access(
    p_organization_id, actor.membership_id,
    'sales.register.target.manage', 'organization', p_organization_id
  );
  can_import := platform_private.staff_can_access(
    p_organization_id, actor.membership_id,
    'sales.register.import', 'organization', p_organization_id
  );

  IF can_manage_target AND p_report_month IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', t.id, 'version', t.version::TEXT, 'report_month', t.report_month,
      'manager_label', t.manager_label, 'target_count', t.target_count
    ) INTO department_target
    FROM platform_private.sales_register_targets t
    WHERE t.organization_id = p_organization_id
      AND t.report_month = p_report_month AND t.manager_label IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1, 'organization_id', p_organization_id,
    'report_month', p_report_month, 'can_manage_target', can_manage_target,
    'can_import', can_import, 'target', department_target
  );
END
$$;

CREATE FUNCTION platform.read_sales_register_management_v1(
  p_organization_id UUID, p_report_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.read_sales_register_management_v1(p_organization_id, p_report_month)
$$;

REVOKE ALL ON FUNCTION private.read_sales_register_management_v1(UUID, DATE),
  platform.read_sales_register_management_v1(UUID, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.read_sales_register_management_v1(UUID, DATE),
  platform.read_sales_register_management_v1(UUID, DATE) TO authenticated;
COMMIT;
