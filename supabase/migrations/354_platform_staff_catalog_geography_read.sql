-- ============================================================
-- 354_platform_staff_catalog_geography_read.sql
--
-- «Университеты по странам, городам и на карте» в CRM (владелец, 08.11.2026): страницы страны, города, списка и карты
-- группируют вузы по ключу города и показывают фото городов ВСЕМ сотрудникам с правом чтения каталога. Прежний
-- `platform.staff_catalog_geography_v1` отдаёт справочник только `catalog.import.manage` и несёт поля редактора, он
-- не меняется (живое приложение разбирает его точно).
--
-- Новая функция только читает и отдаёт ровно то, что нужно страницам просмотра: ОПУБЛИКОВАННЫЕ города организации
-- (ключ, страна, названия ru/ky/en, координаты, фото, текст ru) и связи «вуз -> ключ города» опубликованных вузов с
-- опубликованным городом. Черновые города, поля редактора (проверяющий, ky_review, источники факта, версии, даты) и
-- чужие организации не отдаются. Право то же, что у `staff_university_catalog_countries` (236): живой сотрудник
-- организации (не студент) с `catalog.read` в области организации, иначе 42501. SECURITY DEFINER, пустой search_path,
-- доступ только `authenticated`. Данные и прежние функции не трогаются. Forward-only: повтор отказывает
-- a354_already_applied. Файл самодостаточен: при смене номера достаточно переименовать его (в тексте номер только в
-- префиксе a354).
-- ============================================================

BEGIN;

DO $a354$
BEGIN
  IF to_regprocedure('platform.staff_catalog_geography_read_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a354_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.staff_catalog_geography_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION 'a354_prerequisite: migration 283 is missing' USING ERRCODE = '55000';
  END IF;
END
$a354$;

CREATE FUNCTION platform.staff_catalog_geography_read_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
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

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', c.city_key, 'country', c.country_code,
        'nameRu', c.name_ru, 'nameKy', c.name_ky, 'nameEn', c.name_en,
        'lat', c.lat, 'lng', c.lng, 'photo', c.photo, 'summaryRu', c.summary_ru)
        ORDER BY s.sort_order, c.name_ru, c.city_key)
      FROM platform.catalog_cities c
      JOIN platform.study_countries s ON s.country_code = c.country_code
      WHERE c.organization_id = p_organization_id AND c.status = 'published'
    ), '[]'::JSONB),
    'institutions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.institution_id, 'cityKey', l.city_key)
        ORDER BY l.city_key, l.institution_id)
      FROM platform.catalog_institution_cities l
      JOIN platform.catalog_cities c
        ON c.organization_id = l.organization_id AND c.city_key = l.city_key AND c.status = 'published'
      WHERE l.organization_id = p_organization_id
        AND EXISTS (
          SELECT 1 FROM platform_private.university_catalog_publications p
          WHERE p.organization_id = l.organization_id AND p.institution_id = l.institution_id
            AND p.status = 'published')
    ), '[]'::JSONB));
END
$$;

REVOKE ALL ON FUNCTION platform.staff_catalog_geography_read_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.staff_catalog_geography_read_v1(UUID) TO authenticated;

COMMENT ON FUNCTION platform.staff_catalog_geography_read_v1(UUID) IS
  'Migration 354: published cities and institution-to-city links for the staff browse pages, read-only, catalog.read; no drafts and no editor fields.';

NOTIFY pgrst, 'reload schema';

COMMIT;
