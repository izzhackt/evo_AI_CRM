-- Проверка географии и стоимости после миграции 283: только чтение, один
-- SELECT (подходит для read-only запроса Supabase Management API и для
-- psql в транзакции READ ONLY). Персональных данных не читает: только
-- каталог, справочник городов, строки стоимости и курсы.
--
-- Строка на организацию с опубликованными вузами шести стран:
--   published_institutions   опубликованные вузы шести стран (production 16.10.2026: 116);
--   linked_institutions      из них со связью вуз → город;
--   linked_to_published_city из них со связью с опубликованным городом;
--   all_linked               published_institutions = linked_institutions;
--   cities, cities_published города организации, из них опубликованные;
--   costs                    строки стоимости по статусам и опубликованные строки агентств
--                            (подтверждённые и без подтверждения, второе всегда 0 по CHECK);
--   fx_latest                последний курс по каждой валюте и его возраст в днях;
--   by_country               то же по странам;
--   unlinked                 вузы без связи (страна, название), не больше 200.
-- Ожидание для production после сида: all_linked = true, linked_institutions = 116.
WITH codes AS (
  SELECT unnest(platform_private.study_country_codes()) AS country_code
), latest AS (
  SELECT DISTINCT ON (p.organization_id, p.institution_id) p.organization_id, p.institution_id,
    i.country_code, i.institution_name
  FROM platform_private.university_catalog_publications p
  JOIN platform.catalog_institutions i ON i.id = p.institution_id AND i.organization_id = p.organization_id
  WHERE p.status = 'published' AND i.country_code IN (SELECT country_code FROM codes)
  ORDER BY p.organization_id, p.institution_id, p.version DESC
), linked AS (
  SELECT l.organization_id, l.institution_id, l.city_key, c.status AS city_status
  FROM platform.catalog_institution_cities l
  JOIN platform.catalog_cities c ON c.organization_id = l.organization_id AND c.city_key = l.city_key
), per_org AS (
  SELECT u.organization_id,
    count(*) AS published_institutions,
    count(k.institution_id) AS linked_institutions,
    count(k.institution_id) FILTER (WHERE k.city_status = 'published') AS linked_to_published_city
  FROM latest u LEFT JOIN linked k ON k.organization_id = u.organization_id AND k.institution_id = u.institution_id
  GROUP BY u.organization_id
)
SELECT o.organization_id,
  o.published_institutions,
  o.linked_institutions,
  o.linked_to_published_city,
  o.published_institutions = o.linked_institutions AS all_linked,
  (SELECT count(*) FROM platform.catalog_cities c WHERE c.organization_id = o.organization_id) AS cities,
  (SELECT count(*) FROM platform.catalog_cities c WHERE c.organization_id = o.organization_id AND c.status = 'published') AS cities_published,
  (SELECT jsonb_build_object(
      'published', count(*) FILTER (WHERE x.status = 'published'),
      'draft', count(*) FILTER (WHERE x.status = 'draft'),
      'retired', count(*) FILTER (WHERE x.status = 'retired'),
      'publishedAgencyConfirmed', count(*) FILTER (WHERE x.status = 'published' AND x.source_kind = 'agency' AND x.confirmed_at IS NOT NULL),
      'publishedAgencyUnconfirmed', count(*) FILTER (WHERE x.status = 'published' AND x.source_kind = 'agency' AND x.confirmed_at IS NULL),
      'institutionsWithPublished', count(DISTINCT x.institution_id) FILTER (WHERE x.status = 'published'))
    FROM platform.catalog_costs x WHERE x.organization_id = o.organization_id) AS costs,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', r.currency, 'asOf', r.as_of, 'unitsPerUsd', r.units_per_usd,
      'ageDays', current_date - r.as_of) ORDER BY r.currency), '[]'::JSONB)
    FROM (SELECT DISTINCT ON (f.currency) f.* FROM platform.catalog_fx_rates f
      WHERE f.organization_id = o.organization_id ORDER BY f.currency, f.as_of DESC) r) AS fx_latest,
  (SELECT jsonb_object_agg(s.country_code, jsonb_build_object(
      'published', (SELECT count(*) FROM latest u WHERE u.organization_id = o.organization_id AND u.country_code = s.country_code),
      'linked', (SELECT count(*) FROM latest u JOIN linked k ON k.organization_id = u.organization_id AND k.institution_id = u.institution_id
        WHERE u.organization_id = o.organization_id AND u.country_code = s.country_code),
      'citiesPublished', (SELECT count(*) FROM platform.catalog_cities c
        WHERE c.organization_id = o.organization_id AND c.country_code = s.country_code AND c.status = 'published'),
      'hasPhoto', s.photo IS NOT NULL, 'hasSummary', s.summary_ru IS NOT NULL))
    FROM platform.study_countries s) AS by_country,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('country', x.country_code, 'name', x.institution_name)
      ORDER BY x.country_code, x.institution_name), '[]'::JSONB)
    FROM (SELECT u.country_code, u.institution_name FROM latest u
      WHERE u.organization_id = o.organization_id
        AND NOT EXISTS (SELECT 1 FROM linked k WHERE k.organization_id = u.organization_id AND k.institution_id = u.institution_id)
      ORDER BY u.country_code, u.institution_name LIMIT 200) x) AS unlinked
FROM per_org o
ORDER BY o.organization_id;
