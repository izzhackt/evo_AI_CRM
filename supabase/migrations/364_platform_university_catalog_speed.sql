-- ============================================================
-- 364_platform_university_catalog_speed.sql
--
-- Скорость раздела «Университеты» в CRM (аудит владельца 20.11.2026; docs/PLAN_CHANGES.md, запись «2026-11-20 · Скорость
-- раздела «Университеты» в CRM»). Хук набора в `scripts/test-runners/test-postgres-authorization.sh` привязан к имени
-- файла, а не к номеру. Файл самодостаточен: при смене номера достаточно переименовать его (номер в тексте только в
-- префиксе a364).
--
-- Что измерено на боевой базе (только чтение, роль authenticated с клеймами живых сотрудников, 20.11.2026; 269 вузов,
-- 3 580 программ, 397 опубликованных версий, 2 499 строк стоимости): список, страны, страна и город читают весь каталог
-- с программами страницами по 30 вузов, и каждая страница — отдельный вызов `staff_university_catalog`, который заново
-- проверяет право `current_bw5_actor('catalog.read')` и заново собирает последние версии всех публикаций: на одно
-- открытие списка 11 проверок, 10 сборок и 3,1 МБ. `staff_catalog_geography_v1` (карточка вуза у редактора, «Курсы
-- валют», «Города») зовёт `catalog_cost_staff_json` на каждую строку стоимости и `catalog_city_staff_json` на каждый
-- город (SQL с SECURITY DEFINER и SET search_path не встраивается): 300 мс из ~420, без функции на строку тот же запрос
-- 90 мс; карточка одного вуза при этом получает 2,9 МБ стоимости всех вузов.
--
-- Что делает миграция (только производительность; права и решения о доступе те же):
--  1. `platform.staff_university_catalog_rows_v1(org, query, country, level)`: лёгкие строки каталога для списка, стран,
--     страны и города. Право проверяется один раз — тот же `current_bw5_actor('catalog.read')` и тот же отказ 42501
--     «Catalogue unavailable», что у `staff_university_catalog` (148); последние версии собираются один раз, каждая
--     карточка распаковывается один раз. Фильтры и их проверка (22023) — те же, что у `university_catalog_page`
--     (148, 282). В строке нет программ целиком: число программ по уровням и только открытые и объявленные наборы
--     (из них приложение считает «ближайший срок» тем же правилом). До 1 200 вузов одним ответом; больше —
--     `complete = false` без строк, и приложение читает прежние страницы по названию, как до 364.
--  2. `platform_private.catalog_geography_staff_json(org, institution)`: ответ `staff_catalog_geography_v1` одним
--     запросом без функции на строку. Выражения строк городов и стоимости — дословно прежние
--     `catalog_city_staff_json` и `catalog_cost_staff_json`; `catalog_currency_exponent` зовётся по разу на валюту.
--     С institution — только этот вуз, его стоимость и города его страны (то, что берёт панель карточки).
--  3. `platform.staff_catalog_geography_v1`: та же проверка права, тело зовёт сборщик; ответ прежний.
--  4. `platform.staff_catalog_institution_geography_v1(org, institution)`: узкая география карточки вуза, то же право
--     `catalog.import.manage` и тот же отказ, что у v1.
--  5. Построчные `catalog_cost_staff_json` и `catalog_city_staff_json` удалены: их вызывала только v1.
--
-- Защита от дрейфа: md5 боевого `prosrc` у заменяемой функции, у двух удаляемых (их выражения повторены в сборщике) и у
-- двух, чьи право и фильтры повторяет новое чтение каталога; расхождение прерывает миграцию, ничего не меняя.
-- Forward-only: повтор отказывает a364_already_applied. CREATE OR REPLACE сохраняет владельца и права v1.
-- ============================================================

BEGIN;

DO $a364_guard$
DECLARE pinned RECORD; actual TEXT;
BEGIN
  IF to_regprocedure('platform.staff_university_catalog_rows_v1(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'a364_already_applied' USING ERRCODE = '55000';
  END IF;
  FOR pinned IN SELECT * FROM (VALUES
    ('platform.staff_catalog_geography_v1(uuid)', '62c10157cb130ce949a05a4c80e4c113'),
    ('platform_private.catalog_cost_staff_json(platform.catalog_costs)', '04aa5c8701b8eb92faad579f5db67afd'),
    ('platform_private.catalog_city_staff_json(platform.catalog_cities)', 'aea6248bbd9c4d81d08e2fe29db0c071'),
    ('platform.staff_university_catalog(uuid,text,text,text,uuid,integer)', 'bbdfa489ec889c68d85650a203ab71a6'),
    ('platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])', 'e6ef793fa7883bac3dbcde91abdd3878')
  ) AS t(signature, source_md5) LOOP
    SELECT md5(p.prosrc) INTO actual FROM pg_catalog.pg_proc AS p WHERE p.oid = to_regprocedure(pinned.signature);
    IF actual IS DISTINCT FROM pinned.source_md5 THEN
      RAISE EXCEPTION 'a364_drift: % has % (expected %)', pinned.signature, actual, pinned.source_md5;
    END IF;
  END LOOP;
END
$a364_guard$;

-- ---------------------------------------------------------------------------
-- 1. Лёгкие строки каталога сотрудника: одна проверка права, одна сборка последних версий.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_university_catalog_rows_v1(
  p_organization_id UUID, p_query TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_level TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  -- Право и отказ — как у staff_university_catalog (148), но один раз на запрос, а не на страницу из 30 вузов.
  IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.read') a
    WHERE a.actor_organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;
  -- Фильтры и их проверка — как у university_catalog_page (148, 282); смещения нет: строки приходят все.
  IF length(COALESCE(p_query, '')) > 100
    OR (p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$')
    OR (p_level IS NOT NULL AND p_level NOT IN ('foundation', 'diploma', 'bachelor', 'master', 'doctorate', 'language')) THEN
    RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE = '22023';
  END IF;
  WITH latest AS (
    SELECT DISTINCT ON (p.institution_id) p.institution_id, p.version, p.content, p.reviewed_at
    FROM platform_private.university_catalog_publications p
    JOIN platform.catalog_institutions i ON i.id = p.institution_id AND i.organization_id = p.organization_id
    WHERE p.organization_id = p_organization_id AND p.status = 'published'
    ORDER BY p.institution_id, p.version DESC
  ), card AS (
    -- Карточка распаковывается один раз: поля и программы берутся одним проходом.
    SELECT l.institution_id, l.version, l.reviewed_at, c.name, c.country, c.city, c."verifiedOn", c."photoKey", c.programs
    FROM latest l
    CROSS JOIN LATERAL jsonb_to_record(l.content)
      AS c(name TEXT, country TEXT, city TEXT, "verifiedOn" TEXT, "photoKey" TEXT, programs JSONB)
  ), filtered AS (
    SELECT * FROM card
    WHERE (COALESCE(p_query, '') = '' OR strpos(lower(name), lower(p_query)) > 0)
      AND (p_country IS NULL OR country = p_country)
      AND (p_level IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(programs) pr WHERE pr ->> 'level' = p_level))
    ORDER BY name, institution_id
    LIMIT 1201
  )
  SELECT jsonb_build_object(
    'organizationId', p_organization_id,
    'complete', count(*) <= 1200,
    'items', CASE WHEN count(*) <= 1200 THEN COALESCE(jsonb_agg(jsonb_build_object(
      'id', f.institution_id, 'version', f.version, 'publishedAt', f.reviewed_at,
      'content', jsonb_build_object('name', f.name, 'country', f.country, 'city', f.city,
        'verifiedOn', f."verifiedOn", 'photoKey', f."photoKey"),
      -- Число программ по уровням: уровня без программ в объекте нет.
      'levels', (SELECT COALESCE(jsonb_object_agg(x.level, x.n), '{}'::JSONB)
        FROM (SELECT pr ->> 'level' AS level, count(*) AS n FROM jsonb_array_elements(f.programs) pr GROUP BY 1) x),
      -- Программы с открытым или объявленным набором и только эти наборы, в порядке карточки.
      'deadlinePrograms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', po.pr -> 'id', 'level', po.pr -> 'level', 'title', po.pr -> 'title', 'intakes', live.intakes)
          ORDER BY po.ord)
        FROM jsonb_array_elements(f.programs) WITH ORDINALITY AS po(pr, ord)
        CROSS JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
            'label', t.i -> 'label', 'applicationDeadline', t.i -> 'applicationDeadline',
            'deadlineTime', t.i -> 'deadlineTime', 'timezone', t.i -> 'timezone', 'status', t.i -> 'status',
            'verifiedOn', t.i -> 'verifiedOn', 'sourceUrl', t.i -> 'sourceUrl') ORDER BY t.ord) AS intakes
          FROM jsonb_array_elements(po.pr -> 'intakes') WITH ORDINALITY AS t(i, ord)
          WHERE t.i ->> 'status' IN ('open', 'announced')) live
        WHERE live.intakes IS NOT NULL), '[]'::JSONB))
      ORDER BY f.name, f.institution_id), '[]'::JSONB) ELSE '[]'::JSONB END)
  INTO result
  FROM filtered f;
  RETURN result;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Сборщик географии: тот же ответ, что у 283, одним запросом.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.catalog_geography_staff_json(p_organization_id UUID, p_institution_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_country TEXT;
BEGIN
  -- Узкий ответ: страна вуза из той же выборки, что у списка вузов ниже (вузы шести стран кабинета).
  IF p_institution_id IS NOT NULL THEN
    SELECT i.country_code INTO v_country
    FROM platform.catalog_institutions i
    JOIN platform.study_countries s ON s.country_code = i.country_code
    WHERE i.organization_id = p_organization_id AND i.id = p_institution_id;
  END IF;
  RETURN jsonb_build_object(
    'countries', (SELECT jsonb_agg(jsonb_build_object(
        'code', s.country_code, 'nameRu', s.name_ru, 'nameKy', s.name_ky, 'nameEn', s.name_en,
        'photo', s.photo, 'summaryRu', s.summary_ru, 'summaryKy', s.summary_ky, 'kyReview', s.ky_review)
      ORDER BY s.sort_order) FROM platform.study_countries s),
    -- Строка города — дословно catalog_city_staff_json (283).
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', c.city_key, 'country', c.country_code, 'nameRu', c.name_ru, 'nameKy', c.name_ky, 'nameEn', c.name_en,
        'lat', c.lat, 'lng', c.lng, 'photo', c.photo, 'summaryRu', c.summary_ru, 'summaryKy', c.summary_ky,
        'factRu', c.fact_ru, 'factKy', c.fact_ky, 'factSourceUrl', c.fact_source_url, 'factVerifiedOn', c.fact_verified_on,
        'kyReview', c.ky_review, 'status', c.status, 'publishedAt', c.published_at, 'publishedVia', c.published_via,
        'reviewedByName', (SELECT p.display_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
          WHERE m.organization_id = c.organization_id AND m.id = c.reviewed_by_membership_id),
        'complete', c.photo IS NOT NULL AND c.summary_ru IS NOT NULL AND c.fact_ru IS NOT NULL
          AND c.fact_source_url IS NOT NULL AND c.fact_verified_on IS NOT NULL,
        'version', c.version, 'updatedAt', c.updated_at,
        'institutionCount', (SELECT count(*) FROM platform.catalog_institution_cities l
          WHERE l.organization_id = c.organization_id AND l.city_key = c.city_key))
      ORDER BY s.sort_order, c.name_ru, c.city_key)
      FROM platform.catalog_cities c JOIN platform.study_countries s ON s.country_code = c.country_code
      WHERE c.organization_id = p_organization_id
        AND (p_institution_id IS NULL OR c.country_code = v_country)), '[]'::JSONB),
    'institutions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.institution_name, 'country', i.country_code, 'cityLabel', i.city,
        'published', EXISTS (SELECT 1 FROM platform_private.university_catalog_publications p
          WHERE p.organization_id = i.organization_id AND p.institution_id = i.id AND p.status = 'published'),
        'cityKey', l.city_key, 'assignedVia', l.assigned_via, 'assignedAt', l.assigned_at)
      ORDER BY s.sort_order, i.institution_name, i.id)
      FROM platform.catalog_institutions i
      JOIN platform.study_countries s ON s.country_code = i.country_code
      LEFT JOIN platform.catalog_institution_cities l ON l.organization_id = i.organization_id AND l.institution_id = i.id
      WHERE i.organization_id = p_organization_id
        AND (p_institution_id IS NULL OR i.id = p_institution_id)), '[]'::JSONB),
    -- Строка стоимости — дословно catalog_cost_staff_json (283); знаков валюты — по разу на валюту.
    'costs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'institutionId', c.institution_id, 'programId', c.program_id, 'studyLevel', c.study_level,
        'teachingLanguage', c.teaching_language, 'costKind', c.cost_kind, 'period', c.period,
        'amountMinMinor', c.amount_min_minor, 'amountMaxMinor', c.amount_max_minor, 'currency', c.currency,
        'exponent', e.exponent,
        'academicYear', c.academic_year, 'noteRu', c.note_ru, 'noteKy', c.note_ky,
        'sourceKind', c.source_kind, 'sourceName', c.source_name, 'sourceUrl', c.source_url, 'verifiedOn', c.verified_on,
        'confirmedAt', c.confirmed_at, 'confirmedOn', c.confirmed_on, 'confirmationReason', c.confirmation_reason,
        'confirmedByName', (SELECT p.display_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
          WHERE m.organization_id = c.organization_id AND m.id = c.confirmed_by_membership_id),
        'status', c.status, 'publishedAt', c.published_at, 'version', c.version, 'importKey', c.import_key,
        'createdAt', c.created_at, 'updatedAt', c.updated_at)
      ORDER BY c.institution_id, c.cost_kind, c.created_at, c.id)
      FROM platform.catalog_costs c
      JOIN (SELECT x.currency, platform_private.catalog_currency_exponent(x.currency) AS exponent
        FROM (SELECT DISTINCT k.currency FROM platform.catalog_costs k WHERE k.organization_id = p_organization_id) x) e
        ON e.currency = c.currency
      WHERE c.organization_id = p_organization_id
        AND (p_institution_id IS NULL OR c.institution_id = p_institution_id)), '[]'::JSONB),
    'fxRates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'currency', r.currency, 'asOf', r.as_of, 'unitsPerUsd', r.units_per_usd,
        'sourceName', r.source_name, 'sourceUrl', r.source_url, 'setAt', r.set_at,
        'ageDays', current_date - r.as_of,
        'latest', r.as_of = (SELECT max(x.as_of) FROM platform.catalog_fx_rates x
          WHERE x.organization_id = r.organization_id AND x.currency = r.currency))
      ORDER BY r.currency, r.as_of DESC)
      FROM platform.catalog_fx_rates r WHERE r.organization_id = p_organization_id), '[]'::JSONB));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. staff_catalog_geography_v1: прежнее право и прежний ответ, тело зовёт сборщик.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.staff_catalog_geography_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Та же проверка права, что у команд, без блокировок (чтение).
  BEGIN
    IF p_organization_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage') a
      WHERE a.actor_organization_id = p_organization_id) THEN
      RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
  END;
  -- 364: ответ собирается одним запросом, без функции на строку.
  RETURN platform_private.catalog_geography_staff_json(p_organization_id, NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Узкая география карточки вуза: то же право, только этот вуз.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_catalog_institution_geography_v1(p_organization_id UUID, p_institution_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Та же проверка права, что у staff_catalog_geography_v1.
  BEGIN
    IF p_organization_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage') a
      WHERE a.actor_organization_id = p_organization_id) THEN
      RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
  END;
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'catalog_geography_institution_required' USING ERRCODE = '22023';
  END IF;
  RETURN platform_private.catalog_geography_staff_json(p_organization_id, p_institution_id);
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Построчные помощники 283 больше никто не зовёт.
-- ---------------------------------------------------------------------------
DROP FUNCTION platform_private.catalog_cost_staff_json(platform.catalog_costs);
DROP FUNCTION platform_private.catalog_city_staff_json(platform.catalog_cities);

REVOKE ALL ON FUNCTION
  platform.staff_university_catalog_rows_v1(UUID, TEXT, TEXT, TEXT),
  platform.staff_catalog_institution_geography_v1(UUID, UUID),
  platform_private.catalog_geography_staff_json(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.staff_university_catalog_rows_v1(UUID, TEXT, TEXT, TEXT),
  platform.staff_catalog_institution_geography_v1(UUID, UUID)
TO authenticated;

COMMENT ON FUNCTION platform.staff_university_catalog_rows_v1(UUID, TEXT, TEXT, TEXT) IS
  'Migration 364: light published catalogue rows for the staff list, countries, country and city pages; catalog.read checked once; programme counts by level and open or announced intakes only.';
COMMENT ON FUNCTION platform.staff_catalog_institution_geography_v1(UUID, UUID) IS
  'Migration 364: the staff_catalog_geography_v1 answer narrowed to one institution, its costs and the cities of its country; catalog.import.manage.';
COMMENT ON FUNCTION platform_private.catalog_geography_staff_json(UUID, UUID) IS
  'Private 364 builder of the staff geography answer in one set-based query; NULL institution means the whole organization.';

NOTIFY pgrst, 'reload schema';

COMMIT;
