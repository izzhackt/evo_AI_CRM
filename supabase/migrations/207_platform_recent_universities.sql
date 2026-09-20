-- First publication comes from immutable history (148), never the latest edit.
-- Additive read contract only: no content/identity changes or timestamp backfill.
BEGIN;

CREATE FUNCTION platform.student_recent_universities_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (p.institution_id) p.institution_id, p.content,
      min(p.reviewed_at) OVER (PARTITION BY p.institution_id) AS first_published_at
    FROM platform_private.university_catalog_publications p
    JOIN platform.catalog_institutions i
      ON i.id = p.institution_id AND i.organization_id = p.organization_id
    WHERE p.organization_id = a.organization_id AND p.status = 'published'
    ORDER BY p.institution_id, p.version DESC
  ), recent AS (
    SELECT * FROM latest
    WHERE first_published_at >= statement_timestamp() - interval '30 days'
      AND first_published_at <= statement_timestamp()
    ORDER BY first_published_at DESC, institution_id
    LIMIT 4
  )
  SELECT jsonb_build_object('items', COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', institution_id,
      'name', content->>'name',
      'country', content->>'country',
      'city', content->>'city',
      'firstPublishedAt', first_published_at
    ) ORDER BY first_published_at DESC, institution_id
  ), '[]'::JSONB)) INTO result FROM recent;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.student_recent_universities_v1()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_recent_universities_v1() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
