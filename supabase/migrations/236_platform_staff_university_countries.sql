-- Item 14: countries from the complete published staff university catalogue.
-- Contract: docs/platform/staff-catalog-country-facet.md.
-- Existing readers, publication history and permissions remain unchanged.
BEGIN;

CREATE FUNCTION platform.staff_university_catalog_countries(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  invalid_country BOOLEAN;
  countries JSONB;
BEGIN
  SELECT a.* INTO actor
  FROM platform.current_actor_authority() AS a
  WHERE a.organization_id = p_organization_id
    AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR platform_private.staff_can_access(
    p_organization_id, actor.membership_id,
    'catalog.read', 'organization', p_organization_id
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (p.institution_id)
      p.institution_id, p.content->'country' AS value,
      p.content->>'country' AS country
    FROM platform_private.university_catalog_publications AS p
    JOIN platform.catalog_institutions AS i
      ON i.id = p.institution_id AND i.organization_id = p.organization_id
    WHERE p.organization_id = p_organization_id AND p.status = 'published'
    ORDER BY p.institution_id, p.version DESC
  ), country_codes AS (
    SELECT DISTINCT country COLLATE pg_catalog."C" AS country
    FROM latest
  )
  SELECT EXISTS (
    SELECT 1 FROM latest
    WHERE pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'string'
      OR pg_catalog.length(country) IS DISTINCT FROM 2
      OR (country COLLATE pg_catalog."C" ~ '^[A-Z]{2}$') IS NOT TRUE
  ), COALESCE((
    SELECT pg_catalog.jsonb_agg(country ORDER BY country COLLATE pg_catalog."C")
    FROM country_codes
  ), '[]'::JSONB)
  INTO invalid_country, countries;

  IF invalid_country THEN
    RAISE EXCEPTION 'Published catalogue country is invalid' USING ERRCODE = '22023';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id, 'countries', countries
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_university_catalog_countries(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_university_catalog_countries(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
