-- ============================================================
-- 105_platform_student_case_sales_links.sql
--
-- Restore the bounded Student Case -> Sales lead link needed by the current
-- Supabase-backed staff shell without exposing raw case or lead tables.
-- Both sides of a returned link must be visible to the current actor.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.staff_student_case_sales_links(
  p_organization_id UUID,
  p_student_case_ids UUID[]
)
RETURNS TABLE (
  student_case_id UUID,
  lead_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR p_organization_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'Invalid student-case sales-link organization'
      USING ERRCODE = '22023';
  END IF;

  IF p_student_case_ids IS NULL
    OR pg_catalog.cardinality(p_student_case_ids) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope must contain 1 to 100 ids'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_ndims(p_student_case_ids) <> 1 THEN
    RAISE EXCEPTION 'Student-case sales-link scope must be one-dimensional'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_position(p_student_case_ids, NULL::UUID) IS NOT NULL
    OR pg_catalog.array_position(
      p_student_case_ids,
      '00000000-0000-0000-0000-000000000000'::UUID
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope contains an invalid id'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM (
      SELECT DISTINCT requested.student_case_id
      FROM pg_catalog.unnest(p_student_case_ids)
        AS requested(student_case_id)
    ) AS unique_requested_cases
  ) <> pg_catalog.cardinality(p_student_case_ids)
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope contains duplicate ids'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH visible_leads AS MATERIALIZED (
    SELECT
      visible.organization_id,
      visible.lead_id
    FROM platform_private.visible_canonical_leads() AS visible
    WHERE visible.organization_id = p_organization_id
  )
  SELECT
    student_case.id,
    visible_lead.lead_id
  FROM platform.current_actor_authority() AS actor
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = actor.organization_id
   AND student_case.organization_id = p_organization_id
  JOIN visible_leads AS visible_lead
    ON visible_lead.organization_id = student_case.organization_id
   AND visible_lead.lead_id = student_case.canonical_lead_id
  WHERE student_case.id = ANY (p_student_case_ids)
    AND COALESCE(
      private.platform_can_read_student_case(
        student_case.organization_id,
        student_case.id
      ),
      FALSE
    )
  ORDER BY student_case.id;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_sales_links(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform.staff_student_case_sales_links(UUID, UUID[])
  TO authenticated;

COMMENT ON FUNCTION platform.staff_student_case_sales_links(UUID, UUID[]) IS
  'Returns at most 100 current-actor-visible Student Case to canonical Sales lead links for one organization.';

COMMIT;
