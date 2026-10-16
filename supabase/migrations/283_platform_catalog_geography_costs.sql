-- 283: университеты v2, география и стоимость (поток S3 плана
-- docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md, раздел 7.2; запись
-- docs/PLAN_CHANGES.md «Университеты v2: миграция 283 (география и
-- стоимость)»). Контракт для веба и iPhone: docs/catalog/geography-costs-contract.md.
--
--  a) platform.study_countries: карточки шести стран продукта (ключ по
--     platform_private.study_country_codes() из 282, названия RU и KY как в
--     src/lib/study-countries.json). Общие для продукта, меняются миграцией.
--  b) platform.catalog_cities, platform.catalog_institution_cities,
--     platform.catalog_costs, platform.catalog_fx_rates: по организации.
--     Без табличных грантов: доступ только через RPC ниже.
--  c) Студент (веб и iPhone): student_university_index_v1 (вся география и
--     краткие карточки вузов шести стран одной выдачей, notModified по
--     версии) и student_university_detail_v1 (страница вуза одним вызовом).
--     Авторизация та же, что у student_university_catalog: студент
--     организации с portal.read.self; только опубликованное; только шесть
--     стран; иначе 42501.
--  d) Сотрудник: право публикации каталога (catalog.import.manage в охвате
--     организации, как stage/review 148) или системный Admin; подтверждение
--     строк агентств только системный Admin; остальные 42501. Команды
--     идемпотентны по request_id (platform_private.catalog_geography_requests).
--     Импорт стоимости и запись курса принимают и сервисную роль, но только с
--     явным членством живого системного Admin организации.
--  e) Прежние RPC каталога, избранного, подготовок и консультаций не
--     меняются (проверка md5 в конце миграции): старые сборки iPhone
--     получают прежние ответы.
--  f) Сид: раздел в конце, генерируется scripts/catalog/generate-geography-seed.mjs.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Предусловия и снимок прежних RPC
-- ---------------------------------------------------------------------------
DO $a283_pre$
BEGIN
  IF to_regprocedure('platform_private.study_country_codes()') IS NULL
    OR platform_private.study_country_codes() IS DISTINCT FROM ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']::TEXT[] THEN
    RAISE EXCEPTION 'a283_requires_282: platform_private.study_country_codes() is missing or changed';
  END IF;
  IF to_regclass('platform.study_countries') IS NOT NULL OR to_regclass('platform.catalog_cities') IS NOT NULL THEN
    RAISE EXCEPTION 'a283_already_applied';
  END IF;
END
$a283_pre$;

CREATE TEMP TABLE a283_old_rpcs ON COMMIT DROP AS
  SELECT p.oid::REGPROCEDURE::TEXT AS signature, md5(pg_get_functiondef(p.oid)) AS definition_md5,
    p.proacl::TEXT AS acl
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    'platform.student_university_catalog(text,text,text,uuid,integer)'::REGPROCEDURE,
    'platform.student_university_catalog_by_ids_v1(uuid[])'::REGPROCEDURE,
    'platform.student_university_favorites_v1()'::REGPROCEDURE,
    'platform.set_university_favorite_v1(uuid,boolean)'::REGPROCEDURE,
    'platform.student_recent_universities_v1()'::REGPROCEDURE,
    'platform.student_catalog_preparations_v1(uuid)'::REGPROCEDURE,
    'platform.own_portal_consultation_requests_v1()'::REGPROCEDURE,
    'platform.staff_university_catalog(uuid,text,text,text,uuid,integer)'::REGPROCEDURE,
    'platform.staff_university_catalog_countries(uuid)'::REGPROCEDURE,
    'platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])'::REGPROCEDURE);

-- ---------------------------------------------------------------------------
-- 1. Проверки значений
-- ---------------------------------------------------------------------------
-- Текст для студента: непустой, без управляющих символов, не длиннее max.
CREATE FUNCTION platform_private.catalog_text_ok(p_value TEXT, p_max INTEGER)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT p_value IS NOT NULL AND btrim(p_value) <> '' AND p_value = btrim(p_value)
    AND char_length(p_value) <= p_max AND p_value !~ '[[:cntrl:]]'
$$;

-- Источник фото стран и городов (решение Р3): только Unsplash, Pexels и
-- Wikimedia Commons. Фото агентств (EDUPRCHINA и похожих) не берём.
CREATE FUNCTION platform_private.catalog_photo_source_allowed(p_url TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT p_url IS NOT NULL AND platform_private.university_public_url(p_url)
    AND lower(substring(p_url FROM '^https://([^/?#]+)')) IN (
      'unsplash.com', 'www.unsplash.com', 'pexels.com', 'www.pexels.com',
      'commons.wikimedia.org', 'upload.wikimedia.org')
$$;

-- Фото карточки страны (p_scope = 'countries') или города ('cities'): объект в
-- бакете portal-university-photos под geography/, путь с 12 знаками sha256
-- файла; автор, источник и лицензия обязательны. Хост sourceUrl принадлежит
-- именно названному источнику (sourceName): то же правило, что у разбора веба
-- (PHOTO_HOSTS в src/lib/portal/university-index.ts), иначе одна такая запись
-- сделала бы весь индекс студента нечитаемым.
CREATE FUNCTION platform_private.catalog_photo_valid(p_photo JSONB, p_scope TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE keys CONSTANT TEXT[] := ARRAY['path', 'width', 'height', 'author', 'authorUrl',
  'sourceName', 'sourceUrl', 'license', 'licenseUrl'];
BEGIN
  RETURN jsonb_typeof(p_photo) = 'object' AND p_photo ?& keys AND p_photo - keys = '{}'::JSONB
    AND p_scope IN ('countries', 'cities')
    AND COALESCE(p_photo ->> 'path', '') ~ ('^geography/' || p_scope || '/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}\.(jpg|png|webp|avif)$')
    AND jsonb_typeof(p_photo -> 'width') = 'number' AND (p_photo ->> 'width') ~ '^[1-9][0-9]{0,4}$'
    AND jsonb_typeof(p_photo -> 'height') = 'number' AND (p_photo ->> 'height') ~ '^[1-9][0-9]{0,4}$'
    AND jsonb_typeof(p_photo -> 'author') = 'string' AND platform_private.catalog_text_ok(p_photo ->> 'author', 200)
    AND (p_photo -> 'authorUrl' = 'null'::JSONB OR platform_private.university_public_url(p_photo ->> 'authorUrl'))
    AND p_photo ->> 'sourceName' IN ('Unsplash', 'Pexels', 'Wikimedia Commons')
    AND platform_private.catalog_photo_source_allowed(p_photo ->> 'sourceUrl')
    AND lower(substring(p_photo ->> 'sourceUrl' FROM '^https://([^/?#]+)')) = ANY (CASE p_photo ->> 'sourceName'
      WHEN 'Unsplash' THEN ARRAY['unsplash.com', 'www.unsplash.com']
      WHEN 'Pexels' THEN ARRAY['pexels.com', 'www.pexels.com']
      WHEN 'Wikimedia Commons' THEN ARRAY['commons.wikimedia.org', 'upload.wikimedia.org']
      ELSE ARRAY[]::TEXT[] END)
    AND jsonb_typeof(p_photo -> 'license') = 'string' AND platform_private.catalog_text_ok(p_photo ->> 'license', 120)
    AND (p_photo -> 'licenseUrl' = 'null'::JSONB OR platform_private.university_public_url(p_photo ->> 'licenseUrl'))
    AND lower(p_photo::TEXT) !~ 'eduprchina';
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END
$$;

-- Учебный год вида 2026/27 или календарный год набора вида 2026 (вузы
-- Малайзии публикуют цены по году набора). Год, которого нет в источнике,
-- не придумывается: колонка допускает NULL.
CREATE FUNCTION platform_private.catalog_academic_year_ok(p_value TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value ~ '^20[0-9]{2}$' THEN TRUE
    WHEN p_value ~ '^20[0-9]{2}/[0-9]{2}$' THEN right(p_value, 2)::INTEGER = (left(p_value, 4)::INTEGER + 1) % 100
    ELSE FALSE END
$$;

-- Минорные единицы валюты по ISO 4217 (для валют шести стран и USD это 2).
CREATE FUNCTION platform_private.catalog_currency_exponent(p_currency TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
      'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 0
    WHEN p_currency IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 3
    ELSE 2 END
$$;

-- Ориентир в USD: сумма / курс, округление до 10 USD; ненулевая сумма даёт
-- не меньше 10. Нет курса или строка уже в USD: NULL.
CREATE FUNCTION platform_private.catalog_usd_approx(p_minor BIGINT, p_currency TEXT, p_units_per_usd NUMERIC)
RETURNS BIGINT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_minor IS NULL OR p_currency = 'USD' OR p_units_per_usd IS NULL OR p_units_per_usd <= 0 THEN NULL
    WHEN p_minor = 0 THEN 0
    ELSE GREATEST(10, (round(p_minor::NUMERIC
      / power(10::NUMERIC, platform_private.catalog_currency_exponent(p_currency))
      / p_units_per_usd / 10) * 10)::BIGINT) END
$$;

REVOKE ALL ON FUNCTION
  platform_private.catalog_text_ok(TEXT, INTEGER),
  platform_private.catalog_photo_source_allowed(TEXT),
  platform_private.catalog_photo_valid(JSONB, TEXT),
  platform_private.catalog_academic_year_ok(TEXT),
  platform_private.catalog_currency_exponent(TEXT),
  platform_private.catalog_usd_approx(BIGINT, TEXT, NUMERIC)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 2. Таблицы
-- ---------------------------------------------------------------------------
CREATE TABLE platform.study_countries (
  country_code TEXT PRIMARY KEY CHECK (country_code = ANY (platform_private.study_country_codes())),
  sort_order SMALLINT NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 50),
  name_ru TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_ru, 100)),
  name_ky TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_ky, 100)),
  name_en TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_en, 100)),
  photo JSONB CHECK (photo IS NULL OR platform_private.catalog_photo_valid(photo, 'countries')),
  summary_ru TEXT CHECK (summary_ru IS NULL OR platform_private.catalog_text_ok(summary_ru, 300)),
  summary_ky TEXT CHECK (summary_ky IS NULL OR platform_private.catalog_text_ok(summary_ky, 300)),
  ky_review TEXT NOT NULL DEFAULT 'pending' CHECK (ky_review IN ('pending', 'done')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((summary_ru IS NULL) = (summary_ky IS NULL))
);

CREATE TABLE platform.catalog_cities (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  city_key TEXT NOT NULL CHECK (char_length(city_key) BETWEEN 2 AND 64 AND city_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_code TEXT NOT NULL REFERENCES platform.study_countries(country_code),
  name_ru TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_ru, 100)),
  name_ky TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_ky, 100)),
  name_en TEXT NOT NULL CHECK (platform_private.catalog_text_ok(name_en, 100)),
  lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  photo JSONB CHECK (photo IS NULL OR platform_private.catalog_photo_valid(photo, 'cities')),
  summary_ru TEXT CHECK (summary_ru IS NULL OR platform_private.catalog_text_ok(summary_ru, 300)),
  summary_ky TEXT CHECK (summary_ky IS NULL OR platform_private.catalog_text_ok(summary_ky, 300)),
  fact_ru TEXT CHECK (fact_ru IS NULL OR platform_private.catalog_text_ok(fact_ru, 200)),
  fact_ky TEXT CHECK (fact_ky IS NULL OR platform_private.catalog_text_ok(fact_ky, 200)),
  fact_source_url TEXT CHECK (fact_source_url IS NULL OR platform_private.university_public_url(fact_source_url)),
  fact_verified_on DATE CHECK (fact_verified_on IS NULL OR fact_verified_on >= DATE '2000-01-01'),
  ky_review TEXT NOT NULL DEFAULT 'pending' CHECK (ky_review IN ('pending', 'done')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_via TEXT CHECK (published_via IN ('migration', 'staff')),
  reviewed_by_membership_id UUID,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740990),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by_membership_id UUID,
  PRIMARY KEY (organization_id, city_key),
  UNIQUE (organization_id, country_code, name_ru),
  FOREIGN KEY (organization_id, reviewed_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, updated_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  CHECK ((lat IS NULL) = (lng IS NULL)),
  CHECK ((summary_ru IS NULL) = (summary_ky IS NULL) AND (fact_ru IS NULL) = (fact_ky IS NULL)),
  -- Карточка города публикуется только полной (план 7.1).
  CONSTRAINT catalog_cities_published_complete CHECK (status = 'draft' OR (
    photo IS NOT NULL AND summary_ru IS NOT NULL AND fact_ru IS NOT NULL
    AND fact_source_url IS NOT NULL AND fact_verified_on IS NOT NULL
    AND published_at IS NOT NULL AND published_via IS NOT NULL
    AND (published_via = 'migration' OR reviewed_by_membership_id IS NOT NULL))),
  CHECK (status = 'published' OR (published_at IS NULL AND published_via IS NULL AND reviewed_by_membership_id IS NULL))
);

CREATE TABLE platform.catalog_institution_cities (
  institution_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  city_key TEXT NOT NULL,
  assigned_via TEXT NOT NULL CHECK (assigned_via IN ('migration', 'staff')),
  assigned_by_membership_id UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, institution_id) REFERENCES platform.catalog_institutions(organization_id, id),
  FOREIGN KEY (organization_id, city_key) REFERENCES platform.catalog_cities(organization_id, city_key),
  FOREIGN KEY (organization_id, assigned_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  CHECK ((assigned_via = 'staff') = (assigned_by_membership_id IS NOT NULL))
);
CREATE INDEX catalog_institution_cities_city_idx ON platform.catalog_institution_cities(organization_id, city_key);

CREATE TABLE platform.catalog_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  institution_id UUID NOT NULL,
  program_id TEXT CHECK (program_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  study_level TEXT CHECK (study_level IN ('language', 'foundation', 'diploma', 'bachelor', 'master', 'doctorate')),
  teaching_language TEXT CHECK (teaching_language ~ '^[a-z]{2}$'),
  cost_kind TEXT NOT NULL CHECK (cost_kind IN ('tuition', 'accommodation', 'application_fee', 'insurance', 'other')),
  period TEXT NOT NULL CHECK (period IN ('year', 'semester', 'month', 'week', 'day', 'once', 'program')),
  amount_min_minor BIGINT NOT NULL CHECK (amount_min_minor BETWEEN 0 AND 1000000000000000),
  amount_max_minor BIGINT CHECK (amount_max_minor IS NULL OR amount_max_minor BETWEEN amount_min_minor + 1 AND 1000000000000000),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  academic_year TEXT CHECK (academic_year IS NULL OR platform_private.catalog_academic_year_ok(academic_year)),
  note_ru TEXT CHECK (note_ru IS NULL OR platform_private.catalog_text_ok(note_ru, 300)),
  note_ky TEXT CHECK (note_ky IS NULL OR platform_private.catalog_text_ok(note_ky, 300)),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('official', 'agency', 'evo_document')),
  source_name TEXT NOT NULL CHECK (platform_private.catalog_text_ok(source_name, 200)),
  source_url TEXT CHECK (source_url IS NULL OR platform_private.university_public_url(source_url)),
  verified_on DATE NOT NULL CHECK (verified_on >= DATE '2000-01-01'),
  confirmed_by_membership_id UUID,
  confirmed_at TIMESTAMPTZ,
  confirmed_on DATE,
  confirmation_reason TEXT CHECK (confirmation_reason IS NULL OR platform_private.catalog_text_ok(confirmation_reason, 500)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  published_at TIMESTAMPTZ,
  published_by_membership_id UUID,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740990),
  request_id UUID NOT NULL UNIQUE,
  import_key TEXT CHECK (import_key IS NULL OR (char_length(import_key) BETWEEN 1 AND 200 AND import_key ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]*$')),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by_membership_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, import_key),
  FOREIGN KEY (organization_id, institution_id) REFERENCES platform.catalog_institutions(organization_id, id),
  FOREIGN KEY (organization_id, confirmed_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, published_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, updated_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  CHECK ((note_ru IS NULL) = (note_ky IS NULL)),
  CHECK (source_kind = 'evo_document' OR source_url IS NOT NULL),
  CHECK ((confirmed_at IS NULL) = (confirmed_by_membership_id IS NULL)
    AND (confirmed_at IS NULL) = (confirmed_on IS NULL)
    AND (confirmed_at IS NULL) = (confirmation_reason IS NULL)),
  CHECK (confirmed_at IS NULL OR source_kind = 'agency'),
  -- Строка агентства публикуется только после подтверждения владельцем (план 4.5).
  CONSTRAINT catalog_costs_agency_published_confirmed CHECK (
    status <> 'published' OR source_kind <> 'agency' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND published_by_membership_id IS NOT NULL))
);
CREATE INDEX catalog_costs_institution_idx ON platform.catalog_costs(organization_id, institution_id, status);

CREATE TABLE platform.catalog_fx_rates (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'USD'),
  as_of DATE NOT NULL CHECK (as_of >= DATE '2000-01-01'),
  -- «1 USD = units_per_usd <валюта>», как в строке под таблицей.
  units_per_usd NUMERIC NOT NULL CHECK (units_per_usd > 0 AND units_per_usd < 1000000000),
  source_name TEXT NOT NULL CHECK (platform_private.catalog_text_ok(source_name, 200)),
  source_url TEXT CHECK (source_url IS NULL OR platform_private.university_public_url(source_url)),
  set_by_membership_id UUID NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_id UUID NOT NULL UNIQUE,
  PRIMARY KEY (organization_id, currency, as_of),
  FOREIGN KEY (organization_id, set_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);

CREATE TABLE platform_private.catalog_geography_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('city_upsert', 'city_publish', 'institution_city_set',
    'cost_upsert', 'cost_confirm', 'cost_publish', 'cost_import', 'fx_rate_set')),
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, request_id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);
CREATE TRIGGER catalog_geography_requests_immutable
  BEFORE UPDATE OR DELETE ON platform_private.catalog_geography_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Город не меняет организацию, ключ и страну; вуз связывается только с
-- городом своей страны.
CREATE FUNCTION platform_private.guard_catalog_city_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.city_key IS DISTINCT FROM OLD.city_key
    OR NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    RAISE EXCEPTION 'catalog_city_identity_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER catalog_cities_identity BEFORE UPDATE ON platform.catalog_cities
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_catalog_city_identity();

CREATE FUNCTION platform_private.guard_catalog_institution_city()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform.catalog_institutions i
    JOIN platform.catalog_cities c ON c.organization_id = i.organization_id AND c.city_key = NEW.city_key
    WHERE i.organization_id = NEW.organization_id AND i.id = NEW.institution_id
      AND i.country_code = c.country_code
  ) THEN
    RAISE EXCEPTION 'catalog_city_country_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER catalog_institution_cities_country BEFORE INSERT OR UPDATE ON platform.catalog_institution_cities
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_catalog_institution_city();

ALTER TABLE platform.study_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.study_countries FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_cities FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_institution_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_institution_cities FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_costs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_fx_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.catalog_geography_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.catalog_geography_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  platform.study_countries, platform.catalog_cities, platform.catalog_institution_cities,
  platform.catalog_costs, platform.catalog_fx_rates, platform_private.catalog_geography_requests
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.guard_catalog_city_identity(),
  platform_private.guard_catalog_institution_city()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Шесть стран продукта в порядке продукта; названия как в src/lib/study-countries.json.
INSERT INTO platform.study_countries (country_code, sort_order, name_ru, name_ky, name_en) VALUES
  ('CN', 1, 'Китай', 'Кытай', 'China'),
  ('MY', 2, 'Малайзия', 'Малайзия', 'Malaysia'),
  ('AE', 3, 'ОАЭ', 'БАЭ', 'United Arab Emirates'),
  ('TR', 4, 'Турция', 'Түркия', 'Turkey'),
  ('IT', 5, 'Италия', 'Италия', 'Italy'),
  ('CZ', 6, 'Чехия', 'Чехия', 'Czechia');

-- ---------------------------------------------------------------------------
-- 3. Общие помощники чтения
-- ---------------------------------------------------------------------------
-- Последняя опубликованная карточка каждого вуза организации в шести странах
-- (страна и в идентичности вуза, и в карточке: строже обоих прежних чтений).
CREATE FUNCTION platform_private.catalog_student_latest(p_organization_id UUID)
RETURNS TABLE (institution_id UUID, version BIGINT, content JSONB, reviewed_at TIMESTAMPTZ, country_code TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT latest.institution_id, latest.version, latest.content, latest.reviewed_at, latest.country_code
  FROM (
    SELECT DISTINCT ON (p.institution_id) p.institution_id, p.version, p.content, p.reviewed_at, i.country_code
    FROM platform_private.university_catalog_publications p
    JOIN platform.catalog_institutions i ON i.id = p.institution_id AND i.organization_id = p.organization_id
    WHERE p.organization_id = p_organization_id AND p.status = 'published'
    ORDER BY p.institution_id, p.version DESC
  ) latest
  WHERE latest.country_code = ANY (platform_private.study_country_codes())
    AND latest.content ->> 'country' = latest.country_code
$$;

-- Уровни программ карточки в порядке продукта.
CREATE FUNCTION platform_private.catalog_content_levels(p_content JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(x.level ORDER BY array_position(
    ARRAY['language', 'foundation', 'diploma', 'bachelor', 'master', 'doctorate'], x.level)), '[]'::JSONB)
  FROM (SELECT DISTINCT p ->> 'level' AS level FROM jsonb_array_elements(p_content -> 'programs') p) x
$$;

-- Даты открытых и объявленных наборов: ближайший считает клиент (выдача не
-- зависит от текущей даты, версия индекса не меняется каждый день).
CREATE FUNCTION platform_private.catalog_content_intakes(p_content JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('deadline', x.deadline, 'start', x.start, 'startMonth', x.start_month)
    ORDER BY x.deadline NULLS LAST, x.start NULLS LAST, x.start_month NULLS LAST), '[]'::JSONB)
  FROM (
    SELECT DISTINCT i ->> 'applicationDeadline' AS deadline, i ->> 'startDate' AS start, i ->> 'startMonth' AS start_month
    FROM jsonb_array_elements(p_content -> 'programs') p
    CROSS JOIN LATERAL jsonb_array_elements(p -> 'intakes') i
    WHERE i ->> 'status' IN ('open', 'announced')
      AND (i ->> 'applicationDeadline' IS NOT NULL OR i ->> 'startDate' IS NOT NULL OR i ->> 'startMonth' IS NOT NULL)
  ) x
$$;

-- Город для студента: только опубликованная карточка.
CREATE FUNCTION platform_private.catalog_city_student_json(c platform.catalog_cities)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'key', c.city_key, 'country', c.country_code,
    'name', jsonb_build_object('ru', c.name_ru, 'ky', c.name_ky),
    'photo', c.photo,
    'summary', jsonb_build_object('ru', c.summary_ru, 'ky', c.summary_ky),
    'fact', jsonb_build_object('ru', c.fact_ru, 'ky', c.fact_ky,
      'sourceUrl', c.fact_source_url, 'verifiedOn', c.fact_verified_on))
  WHERE c.status = 'published'
$$;

-- Весь индекс организации без версии.
CREATE FUNCTION platform_private.catalog_student_index(p_organization_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT * FROM platform_private.catalog_student_latest(p_organization_id)
  ), universities AS (
    SELECT l.institution_id, l.content, l.country_code, city.city_key,
      EXISTS (SELECT 1 FROM platform.catalog_costs cost
        WHERE cost.organization_id = p_organization_id AND cost.institution_id = l.institution_id
          AND cost.status = 'published') AS has_costs
    FROM latest l
    LEFT JOIN LATERAL (
      SELECT c.city_key FROM platform.catalog_institution_cities link
      JOIN platform.catalog_cities c ON c.organization_id = link.organization_id AND c.city_key = link.city_key
      WHERE link.organization_id = p_organization_id AND link.institution_id = l.institution_id
        AND c.status = 'published'
    ) city ON TRUE
  ), cities AS (
    SELECT c, s.sort_order, counts.n
    FROM (SELECT u.city_key, count(*) AS n FROM universities u WHERE u.city_key IS NOT NULL GROUP BY u.city_key) counts
    JOIN platform.catalog_cities c ON c.organization_id = p_organization_id AND c.city_key = counts.city_key
    JOIN platform.study_countries s ON s.country_code = c.country_code
  )
  SELECT jsonb_build_object(
    'countries', (
      SELECT jsonb_agg(jsonb_build_object(
        'code', s.country_code,
        'name', jsonb_build_object('ru', s.name_ru, 'ky', s.name_ky),
        'photo', s.photo,
        'summary', CASE WHEN s.summary_ru IS NULL THEN NULL
          ELSE jsonb_build_object('ru', s.summary_ru, 'ky', s.summary_ky) END,
        'universityCount', (SELECT count(*) FROM universities u WHERE u.country_code = s.country_code),
        'cityCount', (SELECT count(*) FROM cities x WHERE (x.c).country_code = s.country_code)
      ) ORDER BY s.sort_order)
      FROM platform.study_countries s),
    'cities', COALESCE((
      SELECT jsonb_agg(platform_private.catalog_city_student_json(x.c) || jsonb_build_object('universityCount', x.n)
        ORDER BY x.sort_order, x.n DESC, (x.c).name_ru, (x.c).city_key)
      FROM cities x), '[]'::JSONB),
    'universities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.institution_id,
        'name', u.content -> 'name',
        'country', u.country_code,
        'cityKey', u.city_key,
        'cityLabel', u.content -> 'city',
        'levels', platform_private.catalog_content_levels(u.content),
        'photoKey', u.content -> 'photoKey',
        'intakes', platform_private.catalog_content_intakes(u.content),
        'hasCosts', u.has_costs
      ) ORDER BY u.content ->> 'name', u.institution_id)
      FROM universities u), '[]'::JSONB))
$$;

-- Опубликованная стоимость вуза с курсами или NULL («нет данных, нет блока»).
-- Название и адрес агентства студенту не отдаются; адрес официального
-- источника отдаётся.
CREATE FUNCTION platform_private.catalog_student_costs(p_organization_id UUID, p_institution_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH costs AS (
    SELECT c.* FROM platform.catalog_costs c
    WHERE c.organization_id = p_organization_id AND c.institution_id = p_institution_id AND c.status = 'published'
  ), rates AS (
    SELECT DISTINCT ON (r.currency) r.currency, r.as_of, r.units_per_usd, r.source_name
    FROM platform.catalog_fx_rates r
    WHERE r.organization_id = p_organization_id AND r.currency IN (SELECT currency FROM costs)
    ORDER BY r.currency, r.as_of DESC
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM costs) THEN NULL ELSE jsonb_build_object(
    'rows', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'kind', c.cost_kind,
        'period', c.period,
        'studyLevel', c.study_level,
        'programId', c.program_id,
        'teachingLanguage', c.teaching_language,
        'currency', c.currency,
        'exponent', platform_private.catalog_currency_exponent(c.currency),
        'amountMinMinor', c.amount_min_minor,
        'amountMaxMinor', c.amount_max_minor,
        'usdApproxMin', platform_private.catalog_usd_approx(c.amount_min_minor, c.currency, r.units_per_usd),
        'usdApproxMax', platform_private.catalog_usd_approx(c.amount_max_minor, c.currency, r.units_per_usd),
        'academicYear', c.academic_year,
        'note', CASE WHEN c.note_ru IS NULL THEN NULL ELSE jsonb_build_object('ru', c.note_ru, 'ky', c.note_ky) END,
        'source', jsonb_build_object('kind', c.source_kind,
          'url', CASE WHEN c.source_kind = 'official' THEN c.source_url END),
        'verifiedOn', c.verified_on
      ) ORDER BY array_position(ARRAY['tuition', 'accommodation', 'application_fee', 'insurance', 'other'], c.cost_kind),
        array_position(ARRAY['language', 'foundation', 'diploma', 'bachelor', 'master', 'doctorate'], c.study_level) NULLS FIRST,
        c.program_id NULLS FIRST, c.teaching_language NULLS FIRST,
        array_position(ARRAY['year', 'semester', 'month', 'week', 'day', 'once', 'program'], c.period),
        c.amount_min_minor, c.id)
      FROM costs c LEFT JOIN rates r ON r.currency = c.currency),
    'fxRates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', r.currency, 'unitsPerUsd', r.units_per_usd,
        'asOf', r.as_of, 'sourceName', r.source_name) ORDER BY r.currency)
      FROM rates r), '[]'::JSONB)
  ) END
$$;

REVOKE ALL ON FUNCTION
  platform_private.catalog_student_latest(UUID),
  platform_private.catalog_content_levels(JSONB),
  platform_private.catalog_content_intakes(JSONB),
  platform_private.catalog_city_student_json(platform.catalog_cities),
  platform_private.catalog_student_index(UUID),
  platform_private.catalog_student_costs(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 4. RPC студента
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.student_university_index_v1(p_known_version TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; body JSONB; current_version TEXT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_known_version IS NOT NULL AND (char_length(p_known_version) > 100 OR p_known_version ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'Invalid catalogue version' USING ERRCODE = '22023';
  END IF;
  body := platform_private.catalog_student_index(a.organization_id);
  current_version := 'g1.' || md5(body::TEXT);
  IF p_known_version = current_version THEN
    RETURN jsonb_build_object('notModified', TRUE, 'version', current_version);
  END IF;
  RETURN jsonb_build_object('notModified', FALSE, 'version', current_version) || body;
END
$$;

CREATE FUNCTION platform.student_university_detail_v1(p_institution_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; u RECORD; portal_case UUID; portal_case_count INTEGER;
  country JSONB; city JSONB; favored BOOLEAN; open_request JSONB; preparations JSONB; items JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE = '22023';
  END IF;
  -- Чужой, неизвестный, неопубликованный вуз и вуз страны вне списка
  -- неразличимы (стиль 148/195/282).
  SELECT * INTO u FROM platform_private.catalog_student_latest(a.organization_id) l
  WHERE l.institution_id = p_institution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('code', s.country_code, 'name', jsonb_build_object('ru', s.name_ru, 'ky', s.name_ky))
  INTO country FROM platform.study_countries s WHERE s.country_code = u.country_code;
  SELECT platform_private.catalog_city_student_json(c) INTO city
  FROM platform.catalog_institution_cities link
  JOIN platform.catalog_cities c ON c.organization_id = link.organization_id AND c.city_key = link.city_key
  WHERE link.organization_id = a.organization_id AND link.institution_id = p_institution_id AND c.status = 'published';
  favored := EXISTS (SELECT 1 FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
      AND f.institution_id = p_institution_id);
  -- Открытый запрос консультации (один на участника, индекс 197): та же
  -- форма, что у own_portal_consultation_requests_v1.
  SELECT platform_private.portal_consultation_receipt(r) INTO open_request
  FROM platform_private.portal_consultation_requests r
  WHERE r.organization_id = a.organization_id AND r.membership_id = a.membership_id AND r.status = 'requested'
  ORDER BY r.created_at DESC, r.id LIMIT 1;
  -- Подготовки этого вуза в деле кабинета: та же проверка и та же форма
  -- строк, что у student_catalog_preparations_v1; дело не читается: NULL.
  SELECT count(*), min(c.case_id::TEXT)::UUID INTO portal_case_count, portal_case FROM platform.student_portal_cases() c;
  IF portal_case_count = 1 THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(x.item ORDER BY x.position), '[]'::JSONB) INTO items
      FROM jsonb_array_elements(platform_private.catalog_preparations_for_case(a.organization_id, portal_case, TRUE))
        WITH ORDINALITY AS x(item, position)
      WHERE x.item ->> 'institutionId' = p_institution_id::TEXT;
      preparations := jsonb_build_object('studentCaseId', portal_case, 'items', items);
    EXCEPTION WHEN insufficient_privilege THEN
      preparations := NULL;
    END;
  END IF;
  RETURN jsonb_build_object(
    'university', jsonb_build_object('id', u.institution_id, 'version', u.version,
      'publishedAt', u.reviewed_at, 'content', u.content),
    'country', country,
    'city', city,
    'favored', favored,
    'openConsultation', open_request,
    'preparations', preparations,
    'costs', platform_private.catalog_student_costs(a.organization_id, p_institution_id));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Сотрудник: актор, идемпотентность, проверка входа
-- ---------------------------------------------------------------------------
-- Право публикации каталога (catalog.import.manage в охвате организации, как
-- stage/review 148) или системный Admin. p_require_admin: только системный
-- Admin. p_service_actor: только сервисная роль может назвать актора, и это
-- должен быть живой системный Admin организации.
CREATE FUNCTION platform_private.catalog_geo_actor(p_organization_id UUID, p_require_admin BOOLEAN, p_service_actor UUID)
RETURNS TABLE (membership_id UUID, is_admin BOOLEAN)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims JSONB; actor_membership UUID; actor_admin BOOLEAN;
BEGIN
  IF p_organization_id IS NULL OR p_require_admin IS NULL THEN
    RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_service_actor IS NOT NULL THEN
    claims := NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB;
    IF (SELECT auth.uid()) IS NOT NULL OR COALESCE(claims ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM platform.organizations o WHERE o.id = p_organization_id FOR UPDATE;
    SELECT i.membership_id, i.system_role = 'admin' INTO actor_membership, actor_admin
    FROM platform_private.staff_membership_identity(p_organization_id, p_service_actor) i;
    IF actor_membership IS NULL OR actor_admin IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT actor_membership, TRUE;
    RETURN;
  END IF;
  BEGIN
    SELECT o.actor_membership_id INTO actor_membership
    FROM platform_private.require_organization_operator(p_organization_id, 'catalog.import.manage') o;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'catalog_geography_forbidden' USING ERRCODE = '42501';
  END;
  SELECT i.system_role = 'admin' INTO actor_admin
  FROM platform_private.staff_membership_identity(p_organization_id, actor_membership) i;
  IF actor_membership IS NULL OR (p_require_admin AND actor_admin IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'catalog_admin_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor_membership, COALESCE(actor_admin, FALSE);
END
$$;

-- Повтор запроса: та же квитанция; тот же request_id с другим входом,
-- другой операцией или другим актором: 23505. NULL: запрос новый.
CREATE FUNCTION platform_private.catalog_geo_replay(p_organization_id UUID, p_request_id UUID,
  p_actor UUID, p_operation TEXT, p_input_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r platform_private.catalog_geography_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'catalog_request_id_required' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_bw5_request(p_request_id);
  SELECT * INTO r FROM platform_private.catalog_geography_requests g
  WHERE g.organization_id = p_organization_id AND g.request_id = p_request_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF r.operation <> p_operation OR r.input_hash <> p_input_hash OR r.actor_membership_id <> p_actor THEN
    RAISE EXCEPTION 'catalog_request_reused' USING ERRCODE = '23505';
  END IF;
  RETURN r.receipt;
END
$$;

CREATE FUNCTION platform_private.catalog_geo_record(p_organization_id UUID, p_request_id UUID,
  p_actor UUID, p_operation TEXT, p_input_hash TEXT, p_receipt JSONB)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO platform_private.catalog_geography_requests
    (organization_id, request_id, actor_membership_id, operation, input_hash, receipt)
  VALUES (p_organization_id, p_request_id, p_actor, p_operation, p_input_hash, p_receipt)
  RETURNING receipt
$$;

-- Вуз организации в шести странах (для стоимости и связи с городом).
CREATE FUNCTION platform_private.catalog_geo_institution(p_organization_id UUID, p_institution_id UUID)
RETURNS platform.catalog_institutions
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i platform.catalog_institutions%ROWTYPE;
BEGIN
  SELECT * INTO i FROM platform.catalog_institutions x
  WHERE x.organization_id = p_organization_id AND x.id = p_institution_id
    AND x.country_code = ANY (platform_private.study_country_codes());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN i;
END
$$;

-- Проверенный ввод строки стоимости (одинаково для правки и импорта).
-- Ключи camelCase, как в docs/catalog/geography-costs-contract.md.
CREATE FUNCTION platform_private.catalog_cost_input(p_organization_id UUID, p_institution_id UUID, p_cost JSONB)
RETURNS platform.catalog_costs
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c platform.catalog_costs%ROWTYPE; program JSONB; latest JSONB;
BEGIN
  IF jsonb_typeof(p_cost) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_cost -> 'amountMinMinor') IS DISTINCT FROM 'number'
    OR (p_cost ->> 'amountMinMinor') !~ '^[0-9]{1,16}$'
    OR NOT (p_cost -> 'amountMaxMinor' IS NULL OR p_cost -> 'amountMaxMinor' = 'null'::JSONB
      OR (jsonb_typeof(p_cost -> 'amountMaxMinor') = 'number' AND (p_cost ->> 'amountMaxMinor') ~ '^[0-9]{1,16}$'))
    OR COALESCE(p_cost ->> 'verifiedOn', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN
    RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
  END IF;
  c.organization_id := p_organization_id;
  c.institution_id := p_institution_id;
  c.program_id := p_cost ->> 'programId';
  c.study_level := p_cost ->> 'studyLevel';
  c.teaching_language := p_cost ->> 'teachingLanguage';
  c.cost_kind := p_cost ->> 'costKind';
  c.period := p_cost ->> 'period';
  c.amount_min_minor := (p_cost ->> 'amountMinMinor')::BIGINT;
  c.amount_max_minor := (p_cost ->> 'amountMaxMinor')::BIGINT;
  c.currency := p_cost ->> 'currency';
  c.academic_year := p_cost ->> 'academicYear';
  c.note_ru := p_cost ->> 'noteRu';
  c.note_ky := p_cost ->> 'noteKy';
  c.source_kind := p_cost ->> 'sourceKind';
  c.source_name := p_cost ->> 'sourceName';
  c.source_url := p_cost ->> 'sourceUrl';
  c.verified_on := (p_cost ->> 'verifiedOn')::DATE;
  IF c.cost_kind IS NULL OR c.cost_kind NOT IN ('tuition', 'accommodation', 'application_fee', 'insurance', 'other')
    OR c.period IS NULL OR c.period NOT IN ('year', 'semester', 'month', 'week', 'day', 'once', 'program')
    OR (c.study_level IS NOT NULL AND c.study_level NOT IN ('language', 'foundation', 'diploma', 'bachelor', 'master', 'doctorate'))
    OR (c.program_id IS NOT NULL AND c.program_id !~ '^[a-z0-9][a-z0-9-]{0,63}$')
    OR (c.teaching_language IS NOT NULL AND c.teaching_language !~ '^[a-z]{2}$')
    OR c.amount_min_minor > 1000000000000000
    OR (c.amount_max_minor IS NOT NULL AND (c.amount_max_minor <= c.amount_min_minor OR c.amount_max_minor > 1000000000000000))
    OR COALESCE(c.currency, '') !~ '^[A-Z]{3}$'
    OR (c.academic_year IS NOT NULL AND NOT platform_private.catalog_academic_year_ok(c.academic_year))
    OR (c.note_ru IS NULL) <> (c.note_ky IS NULL)
    OR (c.note_ru IS NOT NULL AND NOT (platform_private.catalog_text_ok(c.note_ru, 300) AND platform_private.catalog_text_ok(c.note_ky, 300)))
    OR c.source_kind IS NULL OR c.source_kind NOT IN ('official', 'agency', 'evo_document')
    OR NOT platform_private.catalog_text_ok(c.source_name, 200)
    OR (c.source_url IS NOT NULL AND NOT platform_private.university_public_url(c.source_url))
    OR (c.source_kind <> 'evo_document' AND c.source_url IS NULL)
    OR c.verified_on < DATE '2000-01-01' OR c.verified_on > current_date
  THEN
    RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
  END IF;
  -- Программа, если названа, есть в последней опубликованной карточке; её
  -- уровень совпадает с названным.
  IF c.program_id IS NOT NULL THEN
    SELECT p.content INTO latest FROM platform_private.university_catalog_publications p
    WHERE p.organization_id = p_organization_id AND p.institution_id = p_institution_id AND p.status = 'published'
    ORDER BY p.version DESC LIMIT 1;
    SELECT x INTO program FROM jsonb_array_elements(latest -> 'programs') x WHERE x ->> 'id' = c.program_id;
    IF program IS NULL OR (c.study_level IS NOT NULL AND c.study_level <> program ->> 'level') THEN
      RAISE EXCEPTION 'catalog_cost_program_unknown' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN c;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
END
$$;

CREATE FUNCTION platform_private.catalog_cost_staff_json(c platform.catalog_costs)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'institutionId', c.institution_id, 'programId', c.program_id, 'studyLevel', c.study_level,
    'teachingLanguage', c.teaching_language, 'costKind', c.cost_kind, 'period', c.period,
    'amountMinMinor', c.amount_min_minor, 'amountMaxMinor', c.amount_max_minor, 'currency', c.currency,
    'exponent', platform_private.catalog_currency_exponent(c.currency),
    'academicYear', c.academic_year, 'noteRu', c.note_ru, 'noteKy', c.note_ky,
    'sourceKind', c.source_kind, 'sourceName', c.source_name, 'sourceUrl', c.source_url, 'verifiedOn', c.verified_on,
    'confirmedAt', c.confirmed_at, 'confirmedOn', c.confirmed_on, 'confirmationReason', c.confirmation_reason,
    'confirmedByName', (SELECT p.display_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = c.organization_id AND m.id = c.confirmed_by_membership_id),
    'status', c.status, 'publishedAt', c.published_at, 'version', c.version, 'importKey', c.import_key,
    'createdAt', c.created_at, 'updatedAt', c.updated_at)
$$;

CREATE FUNCTION platform_private.catalog_city_staff_json(c platform.catalog_cities)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
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
$$;

REVOKE ALL ON FUNCTION
  platform_private.catalog_geo_actor(UUID, BOOLEAN, UUID),
  platform_private.catalog_geo_replay(UUID, UUID, UUID, TEXT, TEXT),
  platform_private.catalog_geo_record(UUID, UUID, UUID, TEXT, TEXT, JSONB),
  platform_private.catalog_geo_institution(UUID, UUID),
  platform_private.catalog_cost_input(UUID, UUID, JSONB),
  platform_private.catalog_cost_staff_json(platform.catalog_costs),
  platform_private.catalog_city_staff_json(platform.catalog_cities)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 6. RPC сотрудника
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_catalog_geography_v1(p_organization_id UUID)
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
  RETURN jsonb_build_object(
    'countries', (SELECT jsonb_agg(jsonb_build_object(
        'code', s.country_code, 'nameRu', s.name_ru, 'nameKy', s.name_ky, 'nameEn', s.name_en,
        'photo', s.photo, 'summaryRu', s.summary_ru, 'summaryKy', s.summary_ky, 'kyReview', s.ky_review)
      ORDER BY s.sort_order) FROM platform.study_countries s),
    'cities', COALESCE((SELECT jsonb_agg(platform_private.catalog_city_staff_json(c)
      ORDER BY s.sort_order, c.name_ru, c.city_key)
      FROM platform.catalog_cities c JOIN platform.study_countries s ON s.country_code = c.country_code
      WHERE c.organization_id = p_organization_id), '[]'::JSONB),
    'institutions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.institution_name, 'country', i.country_code, 'cityLabel', i.city,
        'published', EXISTS (SELECT 1 FROM platform_private.university_catalog_publications p
          WHERE p.organization_id = i.organization_id AND p.institution_id = i.id AND p.status = 'published'),
        'cityKey', l.city_key, 'assignedVia', l.assigned_via, 'assignedAt', l.assigned_at)
      ORDER BY s.sort_order, i.institution_name, i.id)
      FROM platform.catalog_institutions i
      JOIN platform.study_countries s ON s.country_code = i.country_code
      LEFT JOIN platform.catalog_institution_cities l ON l.organization_id = i.organization_id AND l.institution_id = i.id
      WHERE i.organization_id = p_organization_id), '[]'::JSONB),
    'costs', COALESCE((SELECT jsonb_agg(platform_private.catalog_cost_staff_json(c)
      ORDER BY c.institution_id, c.cost_kind, c.created_at, c.id)
      FROM platform.catalog_costs c WHERE c.organization_id = p_organization_id), '[]'::JSONB),
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

-- Город: создать (p_base_version = 0) или изменить (p_base_version = текущая
-- версия). Опубликованная карточка остаётся опубликованной и обязана
-- остаться полной (CHECK catalog_cities_published_complete).
CREATE FUNCTION platform.staff_catalog_city_upsert_v1(p_organization_id UUID, p_city JSONB, p_base_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; existing platform.catalog_cities%ROWTYPE; saved platform.catalog_cities%ROWTYPE;
  keys CONSTANT TEXT[] := ARRAY['key', 'country', 'nameRu', 'nameKy', 'nameEn', 'lat', 'lng', 'photo',
    'summaryRu', 'summaryKy', 'factRu', 'factKy', 'factSourceUrl', 'factVerifiedOn', 'kyReview'];
  v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION; v_verified DATE; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, NULL);
  IF jsonb_typeof(p_city) IS DISTINCT FROM 'object' OR NOT p_city ?& keys OR p_city - keys <> '{}'::JSONB
    OR p_base_version IS NULL OR p_base_version NOT BETWEEN 0 AND 9007199254740989
    OR COALESCE(p_city ->> 'key', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_city ->> 'key') NOT BETWEEN 2 AND 64
    OR NOT COALESCE((p_city ->> 'country') = ANY (platform_private.study_country_codes()), FALSE)
    OR NOT (platform_private.catalog_text_ok(p_city ->> 'nameRu', 100) AND platform_private.catalog_text_ok(p_city ->> 'nameKy', 100)
      AND platform_private.catalog_text_ok(p_city ->> 'nameEn', 100))
    OR NOT ((p_city -> 'lat' = 'null'::JSONB AND p_city -> 'lng' = 'null'::JSONB)
      OR (jsonb_typeof(p_city -> 'lat') = 'number' AND jsonb_typeof(p_city -> 'lng') = 'number'))
    OR NOT (p_city -> 'photo' = 'null'::JSONB OR platform_private.catalog_photo_valid(p_city -> 'photo', 'cities'))
    OR NOT ((p_city -> 'summaryRu' = 'null'::JSONB AND p_city -> 'summaryKy' = 'null'::JSONB)
      OR (platform_private.catalog_text_ok(p_city ->> 'summaryRu', 300) AND platform_private.catalog_text_ok(p_city ->> 'summaryKy', 300)))
    OR NOT ((p_city -> 'factRu' = 'null'::JSONB AND p_city -> 'factKy' = 'null'::JSONB)
      OR (platform_private.catalog_text_ok(p_city ->> 'factRu', 200) AND platform_private.catalog_text_ok(p_city ->> 'factKy', 200)))
    OR NOT (p_city -> 'factSourceUrl' = 'null'::JSONB OR platform_private.university_public_url(p_city ->> 'factSourceUrl'))
    OR NOT (p_city -> 'factVerifiedOn' = 'null'::JSONB OR COALESCE(p_city ->> 'factVerifiedOn', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR COALESCE(p_city ->> 'kyReview', '') NOT IN ('pending', 'done')
  THEN
    RAISE EXCEPTION 'catalog_city_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_lat := (p_city ->> 'lat')::DOUBLE PRECISION;
    v_lng := (p_city ->> 'lng')::DOUBLE PRECISION;
    v_verified := (p_city ->> 'factVerifiedOn')::DATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'catalog_city_invalid' USING ERRCODE = '22023';
  END;
  IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180
    OR v_verified < DATE '2000-01-01' OR v_verified > current_date THEN
    RAISE EXCEPTION 'catalog_city_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('city', p_city, 'base', p_base_version));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'city_upsert', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO existing FROM platform.catalog_cities c
  WHERE c.organization_id = p_organization_id AND c.city_key = p_city ->> 'key' FOR UPDATE;
  IF NOT FOUND THEN
    IF p_base_version <> 0 THEN
      RAISE EXCEPTION 'catalog_city_version_changed' USING ERRCODE = '40001';
    END IF;
    INSERT INTO platform.catalog_cities (organization_id, city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo,
      summary_ru, summary_ky, fact_ru, fact_ky, fact_source_url, fact_verified_on, ky_review, updated_by_membership_id)
    VALUES (p_organization_id, p_city ->> 'key', p_city ->> 'country', p_city ->> 'nameRu', p_city ->> 'nameKy', p_city ->> 'nameEn',
      v_lat, v_lng, NULLIF(p_city -> 'photo', 'null'::JSONB), p_city ->> 'summaryRu', p_city ->> 'summaryKy',
      p_city ->> 'factRu', p_city ->> 'factKy', p_city ->> 'factSourceUrl', v_verified, p_city ->> 'kyReview', actor.membership_id)
    RETURNING * INTO saved;
  ELSE
    IF existing.version <> p_base_version THEN
      RAISE EXCEPTION 'catalog_city_version_changed' USING ERRCODE = '40001';
    END IF;
    IF existing.country_code <> p_city ->> 'country' THEN
      RAISE EXCEPTION 'catalog_city_country_immutable' USING ERRCODE = '22023';
    END IF;
    UPDATE platform.catalog_cities c SET name_ru = p_city ->> 'nameRu', name_ky = p_city ->> 'nameKy', name_en = p_city ->> 'nameEn',
      lat = v_lat, lng = v_lng, photo = NULLIF(p_city -> 'photo', 'null'::JSONB),
      summary_ru = p_city ->> 'summaryRu', summary_ky = p_city ->> 'summaryKy',
      fact_ru = p_city ->> 'factRu', fact_ky = p_city ->> 'factKy', fact_source_url = p_city ->> 'factSourceUrl',
      fact_verified_on = v_verified, ky_review = p_city ->> 'kyReview',
      version = c.version + 1, updated_at = clock_timestamp(), updated_by_membership_id = actor.membership_id
    WHERE c.organization_id = p_organization_id AND c.city_key = existing.city_key
    RETURNING * INTO saved;
  END IF;
  receipt := jsonb_build_object('requestId', p_request_id, 'cityKey', saved.city_key,
    'version', saved.version, 'status', saved.status);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'city_upsert', digest, receipt);
END
$$;

-- Публикация (только полная карточка) или снятие с публикации.
CREATE FUNCTION platform.staff_catalog_city_publish_v1(p_organization_id UUID, p_city_key TEXT, p_published BOOLEAN,
  p_base_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; existing platform.catalog_cities%ROWTYPE; saved platform.catalog_cities%ROWTYPE; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, NULL);
  IF p_city_key IS NULL OR p_published IS NULL OR p_base_version IS NULL THEN
    RAISE EXCEPTION 'catalog_city_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('city', p_city_key, 'published', p_published, 'base', p_base_version));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'city_publish', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO existing FROM platform.catalog_cities c
  WHERE c.organization_id = p_organization_id AND c.city_key = p_city_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog_city_unavailable' USING ERRCODE = '42501';
  END IF;
  IF existing.version <> p_base_version THEN
    RAISE EXCEPTION 'catalog_city_version_changed' USING ERRCODE = '40001';
  END IF;
  IF p_published AND (existing.photo IS NULL OR existing.summary_ru IS NULL OR existing.fact_ru IS NULL
    OR existing.fact_source_url IS NULL OR existing.fact_verified_on IS NULL) THEN
    RAISE EXCEPTION 'catalog_city_incomplete' USING ERRCODE = '22023';
  END IF;
  IF (existing.status = 'published') = p_published THEN
    saved := existing;
  ELSE
    UPDATE platform.catalog_cities c SET status = CASE WHEN p_published THEN 'published' ELSE 'draft' END,
      published_at = CASE WHEN p_published THEN clock_timestamp() END,
      published_via = CASE WHEN p_published THEN 'staff' END,
      reviewed_by_membership_id = CASE WHEN p_published THEN actor.membership_id END,
      version = c.version + 1, updated_at = clock_timestamp(), updated_by_membership_id = actor.membership_id
    WHERE c.organization_id = p_organization_id AND c.city_key = p_city_key
    RETURNING * INTO saved;
  END IF;
  receipt := jsonb_build_object('requestId', p_request_id, 'cityKey', saved.city_key,
    'version', saved.version, 'status', saved.status);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'city_publish', digest, receipt);
END
$$;

-- Вуз → город своей страны; p_city_key NULL снимает связь.
CREATE FUNCTION platform.staff_catalog_institution_city_set_v1(p_organization_id UUID, p_institution_id UUID,
  p_city_key TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; institution platform.catalog_institutions%ROWTYPE; city platform.catalog_cities%ROWTYPE; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, NULL);
  IF p_institution_id IS NULL OR (p_city_key IS NOT NULL AND p_city_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'catalog_city_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('institution', p_institution_id, 'city', p_city_key));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'institution_city_set', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  institution := platform_private.catalog_geo_institution(p_organization_id, p_institution_id);
  PERFORM 1 FROM platform.catalog_institution_cities l WHERE l.institution_id = p_institution_id FOR UPDATE;
  IF p_city_key IS NULL THEN
    DELETE FROM platform.catalog_institution_cities l
    WHERE l.organization_id = p_organization_id AND l.institution_id = p_institution_id;
  ELSE
    SELECT * INTO city FROM platform.catalog_cities c WHERE c.organization_id = p_organization_id AND c.city_key = p_city_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog_city_unavailable' USING ERRCODE = '42501';
    END IF;
    IF city.country_code <> institution.country_code THEN
      RAISE EXCEPTION 'catalog_city_country_mismatch' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform.catalog_institution_cities (institution_id, organization_id, city_key, assigned_via, assigned_by_membership_id)
    VALUES (p_institution_id, p_organization_id, p_city_key, 'staff', actor.membership_id)
    ON CONFLICT (institution_id) DO UPDATE SET city_key = EXCLUDED.city_key, assigned_via = 'staff',
      assigned_by_membership_id = EXCLUDED.assigned_by_membership_id, assigned_at = clock_timestamp();
  END IF;
  receipt := jsonb_build_object('requestId', p_request_id, 'institutionId', p_institution_id, 'cityKey', p_city_key);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'institution_city_set', digest, receipt);
END
$$;

-- Строка стоимости: создать (без id, p_base_version = 0) или изменить (id и
-- текущая версия). Любая правка возвращает строку в черновик и снимает
-- подтверждение агентства.
CREATE FUNCTION platform.staff_catalog_cost_upsert_v1(p_organization_id UUID, p_cost JSONB, p_base_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; existing platform.catalog_costs%ROWTYPE; input platform.catalog_costs%ROWTYPE;
  saved platform.catalog_costs%ROWTYPE; v_institution_id UUID; v_cost_id UUID; receipt JSONB;
  keys CONSTANT TEXT[] := ARRAY['id', 'institutionId', 'programId', 'studyLevel', 'teachingLanguage', 'costKind', 'period',
    'amountMinMinor', 'amountMaxMinor', 'currency', 'academicYear', 'noteRu', 'noteKy', 'sourceKind', 'sourceName',
    'sourceUrl', 'verifiedOn'];
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, NULL);
  IF jsonb_typeof(p_cost) IS DISTINCT FROM 'object' OR NOT p_cost ?& keys OR p_cost - keys <> '{}'::JSONB
    OR p_base_version IS NULL OR p_base_version NOT BETWEEN 0 AND 9007199254740989
    OR COALESCE(p_cost ->> 'institutionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT (p_cost -> 'id' = 'null'::JSONB OR COALESCE(p_cost ->> 'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN
    RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
  END IF;
  v_institution_id := (p_cost ->> 'institutionId')::UUID;
  v_cost_id := (p_cost ->> 'id')::UUID;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('cost', p_cost, 'base', p_base_version));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'cost_upsert', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  PERFORM platform_private.catalog_geo_institution(p_organization_id, v_institution_id);
  input := platform_private.catalog_cost_input(p_organization_id, v_institution_id, p_cost);
  IF v_cost_id IS NULL THEN
    IF p_base_version <> 0 THEN
      RAISE EXCEPTION 'catalog_cost_version_changed' USING ERRCODE = '40001';
    END IF;
    input.id := gen_random_uuid();
    input.status := 'draft';
    input.version := 1;
    input.request_id := p_request_id;
    input.created_by_membership_id := actor.membership_id;
    input.updated_by_membership_id := actor.membership_id;
    input.created_at := clock_timestamp();
    input.updated_at := input.created_at;
    INSERT INTO platform.catalog_costs SELECT input.* RETURNING * INTO saved;
  ELSE
    SELECT * INTO existing FROM platform.catalog_costs c
    WHERE c.organization_id = p_organization_id AND c.id = v_cost_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog_cost_unavailable' USING ERRCODE = '42501';
    END IF;
    IF existing.institution_id <> v_institution_id THEN
      RAISE EXCEPTION 'catalog_cost_institution_immutable' USING ERRCODE = '22023';
    END IF;
    IF existing.version <> p_base_version THEN
      RAISE EXCEPTION 'catalog_cost_version_changed' USING ERRCODE = '40001';
    END IF;
    UPDATE platform.catalog_costs c SET program_id = input.program_id, study_level = input.study_level,
      teaching_language = input.teaching_language, cost_kind = input.cost_kind, period = input.period,
      amount_min_minor = input.amount_min_minor, amount_max_minor = input.amount_max_minor, currency = input.currency,
      academic_year = input.academic_year, note_ru = input.note_ru, note_ky = input.note_ky,
      source_kind = input.source_kind, source_name = input.source_name, source_url = input.source_url,
      verified_on = input.verified_on, status = 'draft',
      confirmed_by_membership_id = NULL, confirmed_at = NULL, confirmed_on = NULL, confirmation_reason = NULL,
      version = c.version + 1, updated_by_membership_id = actor.membership_id, updated_at = clock_timestamp()
    WHERE c.organization_id = p_organization_id AND c.id = v_cost_id
    RETURNING * INTO saved;
  END IF;
  receipt := jsonb_build_object('requestId', p_request_id, 'costId', saved.id, 'version', saved.version, 'status', saved.status);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'cost_upsert', digest, receipt);
END
$$;

-- Подтверждение строки агентства: только системный Admin; не публикует.
CREATE FUNCTION platform.staff_catalog_cost_confirm_v1(p_organization_id UUID, p_cost_id UUID, p_base_version BIGINT,
  p_reason TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; existing platform.catalog_costs%ROWTYPE; saved platform.catalog_costs%ROWTYPE; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, TRUE, NULL);
  IF p_cost_id IS NULL OR p_base_version IS NULL OR NOT platform_private.catalog_text_ok(p_reason, 500) THEN
    RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('cost', p_cost_id, 'base', p_base_version, 'reason', p_reason));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'cost_confirm', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO existing FROM platform.catalog_costs c
  WHERE c.organization_id = p_organization_id AND c.id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog_cost_unavailable' USING ERRCODE = '42501';
  END IF;
  IF existing.version <> p_base_version THEN
    RAISE EXCEPTION 'catalog_cost_version_changed' USING ERRCODE = '40001';
  END IF;
  IF existing.source_kind <> 'agency' THEN
    RAISE EXCEPTION 'catalog_cost_not_agency' USING ERRCODE = '22023';
  END IF;
  UPDATE platform.catalog_costs c SET confirmed_by_membership_id = actor.membership_id, confirmed_at = clock_timestamp(),
    confirmed_on = current_date, confirmation_reason = p_reason,
    version = c.version + 1, updated_by_membership_id = actor.membership_id, updated_at = clock_timestamp()
  WHERE c.organization_id = p_organization_id AND c.id = p_cost_id
  RETURNING * INTO saved;
  receipt := jsonb_build_object('requestId', p_request_id, 'costId', saved.id, 'version', saved.version,
    'status', saved.status, 'confirmedOn', saved.confirmed_on);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'cost_confirm', digest, receipt);
END
$$;

-- Статус строки: published, retired или draft. Строка агентства без
-- подтверждения не публикуется (23514, как CHECK таблицы).
CREATE FUNCTION platform.staff_catalog_cost_publish_v1(p_organization_id UUID, p_cost_id UUID, p_status TEXT,
  p_base_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; existing platform.catalog_costs%ROWTYPE; saved platform.catalog_costs%ROWTYPE; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, NULL);
  IF p_cost_id IS NULL OR p_base_version IS NULL OR p_status IS NULL OR p_status NOT IN ('published', 'retired', 'draft') THEN
    RAISE EXCEPTION 'catalog_cost_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('cost', p_cost_id, 'status', p_status, 'base', p_base_version));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'cost_publish', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO existing FROM platform.catalog_costs c
  WHERE c.organization_id = p_organization_id AND c.id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog_cost_unavailable' USING ERRCODE = '42501';
  END IF;
  IF existing.version <> p_base_version THEN
    RAISE EXCEPTION 'catalog_cost_version_changed' USING ERRCODE = '40001';
  END IF;
  IF p_status = 'published' AND existing.source_kind = 'agency' AND existing.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'catalog_cost_agency_unconfirmed' USING ERRCODE = '23514';
  END IF;
  IF existing.status = p_status THEN
    saved := existing;
  ELSE
    UPDATE platform.catalog_costs c SET status = p_status,
      published_at = CASE WHEN p_status = 'published' THEN clock_timestamp() ELSE c.published_at END,
      published_by_membership_id = CASE WHEN p_status = 'published' THEN actor.membership_id ELSE c.published_by_membership_id END,
      version = c.version + 1, updated_by_membership_id = actor.membership_id, updated_at = clock_timestamp()
    WHERE c.organization_id = p_organization_id AND c.id = p_cost_id
    RETURNING * INTO saved;
  END IF;
  receipt := jsonb_build_object('requestId', p_request_id, 'costId', saved.id, 'version', saved.version, 'status', saved.status);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'cost_publish', digest, receipt);
END
$$;

-- Импорт пакетом (до 2000 строк). Вуз по institutionId или по (country,
-- точное institutionName); отсутствующий вуз и уже импортированный importKey
-- попадают в отчёт и не создаются. Неверная строка отклоняет весь пакет
-- (22023). confirmation (подтверждение агентства владельцем) требует
-- системного Admin; publish строки агентства требует confirmation.
CREATE FUNCTION platform.staff_catalog_cost_import_v1(p_organization_id UUID, p_rows JSONB, p_request_id UUID,
  p_actor_membership_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; row_item JSONB; row_position BIGINT; report JSONB := '[]'::JSONB;
  institution platform.catalog_institutions%ROWTYPE; input platform.catalog_costs%ROWTYPE; existing_id UUID;
  confirmation JSONB; v_confirmed_on DATE; v_publish BOOLEAN; v_created INTEGER := 0; skipped_existing INTEGER := 0;
  skipped_missing INTEGER := 0; receipt JSONB; needs_admin BOOLEAN;
  keys CONSTANT TEXT[] := ARRAY['importKey', 'institutionId', 'country', 'institutionName', 'programId', 'studyLevel',
    'teachingLanguage', 'costKind', 'period', 'amountMinMinor', 'amountMaxMinor', 'currency', 'academicYear', 'noteRu',
    'noteKy', 'sourceKind', 'sourceName', 'sourceUrl', 'verifiedOn', 'confirmation', 'publish'];
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'catalog_import_invalid' USING ERRCODE = '22023';
  END IF;
  needs_admin := EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r
    WHERE r -> 'confirmation' IS NOT NULL AND r -> 'confirmation' <> 'null'::JSONB);
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, needs_admin, p_actor_membership_id);
  digest := platform_private.bw5_input_sha256(jsonb_build_object('rows', p_rows));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'cost_import', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  FOR row_item, row_position IN SELECT r, n FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, n) LOOP
    IF jsonb_typeof(row_item) IS DISTINCT FROM 'object' OR NOT row_item ?& ARRAY['importKey', 'costKind'] OR row_item - keys <> '{}'::JSONB
      OR COALESCE(row_item ->> 'importKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$'
      OR NOT (row_item -> 'publish' IS NULL OR jsonb_typeof(row_item -> 'publish') = 'boolean')
      OR NOT ((row_item ? 'institutionId' AND COALESCE(row_item ->> 'institutionId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR (NOT row_item ? 'institutionId' AND COALESCE(row_item ->> 'country', '') ~ '^[A-Z]{2}$'
          AND platform_private.university_text(row_item -> 'institutionName', 300)))
    THEN
      RAISE EXCEPTION 'catalog_import_invalid: row %', row_position USING ERRCODE = '22023';
    END IF;
    IF row_item ? 'institutionId' THEN
      SELECT * INTO institution FROM platform.catalog_institutions i
      WHERE i.organization_id = p_organization_id AND i.id = (row_item ->> 'institutionId')::UUID;
    ELSE
      SELECT * INTO institution FROM platform.catalog_institutions i
      WHERE i.organization_id = p_organization_id AND i.country_code = row_item ->> 'country'
        AND i.institution_name = row_item ->> 'institutionName';
    END IF;
    IF NOT FOUND OR NOT institution.country_code = ANY (platform_private.study_country_codes()) THEN
      skipped_missing := skipped_missing + 1;
      report := report || jsonb_build_array(jsonb_build_object('importKey', row_item ->> 'importKey', 'status', 'institution_missing'));
      CONTINUE;
    END IF;
    SELECT c.id INTO existing_id FROM platform.catalog_costs c
    WHERE c.organization_id = p_organization_id AND c.import_key = row_item ->> 'importKey';
    IF FOUND THEN
      skipped_existing := skipped_existing + 1;
      report := report || jsonb_build_array(jsonb_build_object('importKey', row_item ->> 'importKey', 'status', 'exists', 'costId', existing_id));
      CONTINUE;
    END IF;
    BEGIN
      input := platform_private.catalog_cost_input(p_organization_id, institution.id, row_item);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'catalog_import_invalid: row %', row_position USING ERRCODE = '22023';
    END;
    confirmation := NULLIF(row_item -> 'confirmation', 'null'::JSONB);
    v_publish := COALESCE((row_item ->> 'publish')::BOOLEAN, FALSE);
    v_confirmed_on := NULL;
    IF confirmation IS NOT NULL THEN
      IF jsonb_typeof(confirmation) IS DISTINCT FROM 'object' OR NOT confirmation ?& ARRAY['confirmedOn', 'reason']
        OR confirmation - ARRAY['confirmedOn', 'reason'] <> '{}'::JSONB OR input.source_kind <> 'agency'
        OR NOT platform_private.catalog_text_ok(confirmation ->> 'reason', 500)
        OR COALESCE(confirmation ->> 'confirmedOn', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'catalog_import_invalid: row %', row_position USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_confirmed_on := (confirmation ->> 'confirmedOn')::DATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'catalog_import_invalid: row %', row_position USING ERRCODE = '22023';
      END;
      IF v_confirmed_on < DATE '2026-01-01' OR v_confirmed_on > current_date THEN
        RAISE EXCEPTION 'catalog_import_invalid: row %', row_position USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_publish AND input.source_kind = 'agency' AND confirmation IS NULL THEN
      RAISE EXCEPTION 'catalog_cost_agency_unconfirmed: row %', row_position USING ERRCODE = '23514';
    END IF;
    input.id := gen_random_uuid();
    input.request_id := md5(p_request_id::TEXT || ':' || row_position::TEXT)::UUID;
    input.import_key := row_item ->> 'importKey';
    input.version := 1;
    input.status := CASE WHEN v_publish THEN 'published' ELSE 'draft' END;
    input.published_at := CASE WHEN v_publish THEN clock_timestamp() END;
    input.published_by_membership_id := CASE WHEN v_publish THEN actor.membership_id END;
    input.confirmed_by_membership_id := CASE WHEN confirmation IS NOT NULL THEN actor.membership_id END;
    input.confirmed_at := CASE WHEN confirmation IS NOT NULL THEN clock_timestamp() END;
    input.confirmed_on := v_confirmed_on;
    input.confirmation_reason := confirmation ->> 'reason';
    input.created_by_membership_id := actor.membership_id;
    input.updated_by_membership_id := actor.membership_id;
    input.created_at := clock_timestamp();
    input.updated_at := input.created_at;
    INSERT INTO platform.catalog_costs SELECT input.*;
    v_created := v_created + 1;
    report := report || jsonb_build_array(jsonb_build_object('importKey', input.import_key, 'status', 'created',
      'costId', input.id, 'published', v_publish));
  END LOOP;
  receipt := jsonb_build_object('requestId', p_request_id, 'created', v_created, 'existing', skipped_existing,
    'institutionMissing', skipped_missing, 'rows', report);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'cost_import', digest, receipt);
END
$$;

-- Курс валюты «1 USD = p_units_per_usd <валюта>» на дату; повтор той же
-- даты исправляет курс.
CREATE FUNCTION platform.staff_catalog_fx_rate_set_v1(p_organization_id UUID, p_currency TEXT, p_as_of DATE,
  p_units_per_usd NUMERIC, p_source_name TEXT, p_source_url TEXT, p_request_id UUID, p_actor_membership_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; digest TEXT; replay JSONB; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.catalog_geo_actor(p_organization_id, FALSE, p_actor_membership_id);
  IF COALESCE(p_currency, '') !~ '^[A-Z]{3}$' OR p_currency = 'USD'
    OR p_as_of IS NULL OR p_as_of < DATE '2000-01-01' OR p_as_of > current_date
    OR p_units_per_usd IS NULL OR p_units_per_usd <= 0 OR p_units_per_usd >= 1000000000
    OR NOT platform_private.catalog_text_ok(p_source_name, 200)
    OR (p_source_url IS NOT NULL AND NOT platform_private.university_public_url(p_source_url)) THEN
    RAISE EXCEPTION 'catalog_fx_rate_invalid' USING ERRCODE = '22023';
  END IF;
  digest := platform_private.bw5_input_sha256(jsonb_build_object('currency', p_currency, 'asOf', p_as_of,
    'unitsPerUsd', p_units_per_usd, 'sourceName', p_source_name, 'sourceUrl', p_source_url));
  replay := platform_private.catalog_geo_replay(p_organization_id, p_request_id, actor.membership_id, 'fx_rate_set', digest);
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  INSERT INTO platform.catalog_fx_rates (organization_id, currency, as_of, units_per_usd, source_name, source_url,
    set_by_membership_id, request_id)
  VALUES (p_organization_id, p_currency, p_as_of, p_units_per_usd, p_source_name, p_source_url, actor.membership_id, p_request_id)
  ON CONFLICT (organization_id, currency, as_of) DO UPDATE SET units_per_usd = EXCLUDED.units_per_usd,
    source_name = EXCLUDED.source_name, source_url = EXCLUDED.source_url,
    set_by_membership_id = EXCLUDED.set_by_membership_id, set_at = clock_timestamp(), request_id = EXCLUDED.request_id;
  receipt := jsonb_build_object('requestId', p_request_id, 'currency', p_currency, 'asOf', p_as_of, 'unitsPerUsd', p_units_per_usd);
  RETURN platform_private.catalog_geo_record(p_organization_id, p_request_id, actor.membership_id, 'fx_rate_set', digest, receipt);
END
$$;

REVOKE ALL ON FUNCTION
  platform.student_university_index_v1(TEXT),
  platform.student_university_detail_v1(UUID),
  platform.staff_catalog_geography_v1(UUID),
  platform.staff_catalog_city_upsert_v1(UUID, JSONB, BIGINT, UUID),
  platform.staff_catalog_city_publish_v1(UUID, TEXT, BOOLEAN, BIGINT, UUID),
  platform.staff_catalog_institution_city_set_v1(UUID, UUID, TEXT, UUID),
  platform.staff_catalog_cost_upsert_v1(UUID, JSONB, BIGINT, UUID),
  platform.staff_catalog_cost_confirm_v1(UUID, UUID, BIGINT, TEXT, UUID),
  platform.staff_catalog_cost_publish_v1(UUID, UUID, TEXT, BIGINT, UUID),
  platform.staff_catalog_cost_import_v1(UUID, JSONB, UUID, UUID),
  platform.staff_catalog_fx_rate_set_v1(UUID, TEXT, DATE, NUMERIC, TEXT, TEXT, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.student_university_index_v1(TEXT),
  platform.student_university_detail_v1(UUID),
  platform.staff_catalog_geography_v1(UUID),
  platform.staff_catalog_city_upsert_v1(UUID, JSONB, BIGINT, UUID),
  platform.staff_catalog_city_publish_v1(UUID, TEXT, BOOLEAN, BIGINT, UUID),
  platform.staff_catalog_institution_city_set_v1(UUID, UUID, TEXT, UUID),
  platform.staff_catalog_cost_upsert_v1(UUID, JSONB, BIGINT, UUID),
  platform.staff_catalog_cost_confirm_v1(UUID, UUID, BIGINT, TEXT, UUID),
  platform.staff_catalog_cost_publish_v1(UUID, UUID, TEXT, BIGINT, UUID),
  platform.staff_catalog_cost_import_v1(UUID, JSONB, UUID, UUID),
  platform.staff_catalog_fx_rate_set_v1(UUID, TEXT, DATE, NUMERIC, TEXT, TEXT, UUID, UUID)
TO authenticated;
-- Скрипт импорта координатора: сервисная роль с явным членством Admin.
GRANT EXECUTE ON FUNCTION
  platform.staff_catalog_cost_import_v1(UUID, JSONB, UUID, UUID),
  platform.staff_catalog_fx_rate_set_v1(UUID, TEXT, DATE, NUMERIC, TEXT, TEXT, UUID, UUID)
TO service_role;

COMMENT ON TABLE platform.study_countries IS
  'Карточки шести стран продукта (283): ключ по platform_private.study_country_codes(), названия как src/lib/study-countries.json. Меняются миграцией.';
COMMENT ON TABLE platform.catalog_costs IS
  'Стоимость вузов (283). Строка агентства публикуется только с подтверждением (catalog_costs_agency_published_confirmed). Студенту источник agency без названия и адреса.';
COMMENT ON FUNCTION platform.student_university_index_v1(TEXT) IS
  'Миграция 283: весь опубликованный каталог шести стран одной выдачей (страны, города, краткие карточки вузов); notModified при совпадении версии. Контракт: docs/catalog/geography-costs-contract.md.';
COMMENT ON FUNCTION platform.student_university_detail_v1(UUID) IS
  'Миграция 283: страница вуза одним вызовом (карточка, страна, город, избранное, подготовки, открытая консультация, стоимость с курсами). Контракт: docs/catalog/geography-costs-contract.md.';

-- ---------------------------------------------------------------------------
-- 7. Сид (генерируется, руками не править)
-- ---------------------------------------------------------------------------
-- >>> BEGIN GENERATED GEOGRAPHY SEED (scripts/catalog/generate-geography-seed.mjs)
-- Руками не править: node scripts/catalog/generate-geography-seed.mjs --seed-dir <папка> --write.
-- Входы (sha256): countries.json 45bd4e99ec40850296c3994affb0fb244f1a76f746fda12a1892fcdd3672f8ac,
--   cities.json 1cf50441c74e308ab8eb5255cf556cacd4880bc24bcc9f487c03dc6cd12e094b,
--   institution-cities.json ad0235662ad6b02c43617f8de81cb1d3ba87bece018844735609d9e60d814265,
--   photos-manifest.json 28a6f73d7b0ae1bb32dbebc719001e83aa7e48990c57061baa073aaffeb13d1e.
-- Страны: 6 (с фото 6); города: 61 (опубликовано 61); связи вуз → город: 116.
-- Города создаются для каждой организации, где есть вуз этой страны; вуз связывается по
-- (country_code, точное institution_name), отсутствующий вуз пропускается.
UPDATE platform.study_countries AS s SET photo = v.photo, summary_ru = v.summary_ru, summary_ky = v.summary_ky,
  ky_review = v.ky_review, updated_at = clock_timestamp()
FROM (VALUES
  ('CN', '{"path":"geography/countries/cn-f1bef3115cf5.jpg","width":2000,"height":1125,"author":"Diana","authorUrl":"https://www.pexels.com/@diana-2910042/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/ancient-fortress-on-green-hill-4445241/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Китай, одна из крупнейших стран мира по площади и населению, с древней историей и современными мегаполисами. Иностранные студенты учатся здесь на китайском или английском языке: на языковых курсах, в бакалавриате и магистратуре.', 'Кытай аянты жана калкы боюнча дүйнөдөгү эң ири өлкөлөрдүн бири, байыркы тарыхы жана заманбап мегаполистери бар. Чет элдик студенттер бул жерде кытай же англис тилинде окушат: тил курстарында, бакалавриатта жана магистратурада.', 'pending'),
  ('MY', '{"path":"geography/countries/my-a23e7777b369.jpg","width":2000,"height":1333,"author":"Shakil Ahmed","authorUrl":"https://www.pexels.com/@sahmed007/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/aerial-view-of-langkawi-s-lush-coastline-and-marinas-32399927/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Малайзия, страна в Юго-Восточной Азии на Малайском полуострове и острове Калимантан, с тропическим климатом круглый год. Многие университеты преподают на английском языке, а в стране работают кампусы нескольких зарубежных вузов.', 'Малайзия Түштүк-Чыгыш Азиядагы Малай жарым аралында жана Калимантан аралында жайгашкан өлкө, климаты жыл бою тропикалык. Көп университеттер англис тилинде окутат, ал эми өлкөдө бир нече чет элдик университеттин кампустары иштейт.', 'pending'),
  ('AE', '{"path":"geography/countries/ae-1ca7d146ccef.jpg","width":2000,"height":1333,"author":"Abid Ali","authorUrl":"https://www.pexels.com/@abid-ali-150086727/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/facade-of-a-white-mosque-10590305/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'ОАЭ, федерация семи эмиратов на Аравийском полуострове, с жарким пустынным климатом. Большинство жителей страны иностранцы, а в частных вузах и кампусах зарубежных университетов обучение чаще всего идёт на английском языке.', 'БАЭ Араб жарым аралындагы жети эмираттын федерациясы, климаты ысык жана чөлдүү. Өлкө тургундарынын көпчүлүгү чет элдиктер, ал эми жеке окуу жайларында жана чет элдик университеттердин кампустарында окутуу көбүнчө англис тилинде жүрөт.', 'pending'),
  ('TR', '{"path":"geography/countries/tr-90ada84fc07d.jpg","width":2000,"height":1333,"author":"Алексей Антонов","authorUrl":"https://www.pexels.com/@alexej9071/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/clear-sky-over-rock-formations-12233995/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Турция, страна на стыке Европы и Азии, омывается четырьмя морями. В стране работают государственные и частные университеты, и многие программы для иностранных студентов преподаются на английском языке.', 'Түркия Европа менен Азиянын түйүшүндө жайгашкан, төрт деңиз менен чектешкен өлкө. Өлкөдө мамлекеттик жана жеке университеттер иштейт, чет элдик студенттер үчүн көп программалар англис тилинде окутулат.', 'pending'),
  ('IT', '{"path":"geography/countries/it-edf7c6fe4694.jpg","width":2000,"height":1309,"author":"Otis w","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/village-and-church-in-mountain-valley-ZtAt11BAV6I","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Италия, страна на юге Европы на Апеннинском полуострове, родина одних из старейших университетов мира. Государственные и частные вузы предлагают программы на итальянском и английском языках, многие из них в исторических городах.', 'Италия Европанын түштүгүндөгү Апеннин жарым аралында жайгашкан өлкө, дүйнөдөгү эң байыркы университеттердин айрымдарынын мекени. Мамлекеттик жана жеке окуу жайлары италия жана англис тилдеринде программаларды сунуштайт, алардын көбү тарыхый шаарларда.', 'pending'),
  ('CZ', '{"path":"geography/countries/cz-0142126aeacc.jpg","width":2000,"height":1500,"author":"Ivan Theodoulou","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/aerial-photography-of-city-building-h0YlnYGa3F0","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Чехия, страна в центре Европы с историческими городами. Здесь работает Карлов университет в Праге, основанный в 1348 году и один из старейших университетов мира. В государственных вузах можно учиться на чешском или английском языке.', 'Чехия Европанын борборундагы тарыхый шаарлары бар өлкө. Бул жерде 1348-жылы негизделген, дүйнөдөгү эң байыркы университеттердин бири Прагадагы Карл университети иштейт. Мамлекеттик окуу жайларында чех же англис тилинде окууга болот.', 'pending')
) AS v(country_code, photo, summary_ru, summary_ky, ky_review)
WHERE s.country_code = v.country_code;
INSERT INTO platform.catalog_cities (organization_id, city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo,
  summary_ru, summary_ky, fact_ru, fact_ky, fact_source_url, fact_verified_on, ky_review, status, published_at, published_via)
SELECT o.id, v.city_key, v.country_code, v.name_ru, v.name_ky, v.name_en, v.lat, v.lng, v.photo,
  v.summary_ru, v.summary_ky, v.fact_ru, v.fact_ky, v.fact_source_url, v.fact_verified_on, v.ky_review, v.status,
  CASE WHEN v.status = 'published' THEN clock_timestamp() END, CASE WHEN v.status = 'published' THEN 'migration' END
FROM platform.organizations o
CROSS JOIN (VALUES
  ('hangzhou', 'CN', 'Ханчжоу', 'Ханчжоу', 'Hangzhou', 30.25::DOUBLE PRECISION, 120.1675::DOUBLE PRECISION, '{"path":"geography/cities/cn-hangzhou-185154d72586.jpg","width":2000,"height":1500,"author":"miyou_ 77","authorUrl":"https://www.pexels.com/@miyou_-77-696995602/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/view-of-the-west-lake-and-the-leifeng-pagoda-in-hangzhou-china-20700881/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Ханчжоу, столица провинции Чжэцзян, стоит на берегу озера Сиху. Это один из центров цифровой экономики Китая и крупный университетский город: здесь работают Чжэцзянский университет и ещё несколько вузов.', 'Ханчжоу Чжэцзян провинциясынын борбору, Сиху көлүнүн жээгинде жайгашкан. Бул Кытайдын санариптик экономикасынын борборлорунун бири жана ири университет шаары: бул жерде Чжэцзян университети жана дагы бир нече жогорку окуу жайы иштейт.', 'Культурный ландшафт озера Сиху в Ханчжоу внесён в список Всемирного наследия ЮНЕСКО в 2011 году.', 'Ханчжоудагы Сиху көлүнүн маданий ландшафты 2011-жылы ЮНЕСКОнун Бүткүл дүйнөлүк мурас тизмесине киргизилген.', 'https://whc.unesco.org/en/list/1334', '2026-10-16'::DATE, 'pending', 'published'),
  ('shanghai', 'CN', 'Шанхай', 'Шанхай', 'Shanghai', 31.2325::DOUBLE PRECISION, 121.4692::DOUBLE PRECISION, '{"path":"geography/cities/cn-shanghai-41b1eb070bbd.jpg","width":2000,"height":1483,"author":"JC Terry","authorUrl":"https://www.pexels.com/@jcterry/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/cityscape-of-shanghai-25020077/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Шанхай, один из крупнейших городов Китая, стоит в дельте реки Янцзы. Это международный финансовый и портовый центр, а среди его вузов Фуданьский университет, Шанхайский университет Цзяотун и Университет Тунцзи.', 'Шанхай Кытайдын эң ири шаарларынын бири, Янцзы дарыясынын дельтасында жайгашкан. Бул эл аралык каржы жана порт борбору, ал эми анын окуу жайларынын арасында Фудань университети, Шанхай Цзяотун университети жана Тунцзи университети бар.', 'Шанхайская башня высотой 632 метра самое высокое здание Китая.', 'Бийиктиги 632 метр болгон Шанхай мунарасы Кытайдагы эң бийик имарат.', 'https://en.wikipedia.org/wiki/Shanghai_Tower', '2026-10-16'::DATE, 'pending', 'published'),
  ('beijing', 'CN', 'Пекин', 'Бээжин', 'Beijing', 39.904::DOUBLE PRECISION, 116.4075::DOUBLE PRECISION, '{"path":"geography/cities/cn-beijing-7288cd4b2583.jpg","width":2000,"height":1501,"author":"BI ravencrow","authorUrl":"https://www.pexels.com/@biravencrow/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/traditional-architecture-of-the-forbidden-city-39468928/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Пекин, столица Китая, один из главных научных и образовательных центров страны: здесь работают Университет Цинхуа и Пекинский университет. Лето в городе жаркое и влажное, зима холодная и сухая.', 'Бээжин Кытайдын борбору жана өлкөнүн негизги илим жана билим берүү борборлорунун бири: бул жерде Цинхуа университети жана Бээжин университети иштейт. Шаарда жайы ысык жана нымдуу, кышы суук жана кургак.', 'Пекин первым в мире принял и летние (2008), и зимние (2022) Олимпийские игры.', 'Бээжин жайкы (2008) жана кышкы (2022) Олимпиада оюндарын өткөргөн дүйнөдөгү биринчи шаар.', 'https://en.wikipedia.org/wiki/Beijing', '2026-10-16'::DATE, 'pending', 'published'),
  ('guangzhou', 'CN', 'Гуанчжоу', 'Гуанчжоу', 'Guangzhou', 23.13::DOUBLE PRECISION, 113.26::DOUBLE PRECISION, '{"path":"geography/cities/cn-guangzhou-f1fe361edb26.jpg","width":2000,"height":1125,"author":"jiahua zhou","authorUrl":"https://www.pexels.com/@jiahua-zhou-425001890/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/waterfront-view-of-guangzhou-china-25865508/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Гуанчжоу, столица провинции Гуандун, крупный порт на реке Чжуцзян на юге Китая. Кроме путунхуа здесь широко говорят на кантонском языке, а климат субтропический: тепло и влажно большую часть года.', 'Гуанчжоу Гуандун провинциясынын борбору, Кытайдын түштүгүндөгү Чжуцзян дарыясындагы ири порт. Путунхуадан тышкары бул жерде кантон тилинде көп сүйлөшөт, климаты субтропикалык: жылдын көбүндө жылуу жана нымдуу.', 'Кантонская ярмарка проходит в Гуанчжоу весной и осенью с 1957 года. Её считают старейшей и крупнейшей торговой ярмаркой Китая.', 'Кантон жарманкеси 1957-жылдан бери Гуанчжоуда жазында жана күзүндө өтөт. Аны Кытайдагы эң эски жана эң ири соода жарманкеси деп эсептешет.', 'https://en.wikipedia.org/wiki/Canton_Fair', '2026-10-16'::DATE, 'pending', 'published'),
  ('xian', 'CN', 'Сиань', 'Сиань', 'Xi''an', 34.2611::DOUBLE PRECISION, 108.9422::DOUBLE PRECISION, '{"path":"geography/cities/cn-xian-5b9709fc053d.jpg","width":2000,"height":1500,"author":"Rain Lü","authorUrl":"https://www.pexels.com/@rain-lu-452606747/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/cyclists-on-xian-city-wall-at-sunset-28678711/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Сиань, столица провинции Шэньси, один из древнейших городов Китая и бывшая столица империй Хань и Тан. Отсюда начинался Великий шёлковый путь, а сегодня это крупный университетский центр северо-запада страны.', 'Сиань Шэньси провинциясынын борбору, Кытайдын эң байыркы шаарларынын бири жана Хань менен Тан империяларынын мурдагы борбору. Улуу Жибек жолу ушул жерден башталган, азыр бул өлкөнүн түндүк-батышындагы ири университет борбору.', 'Городская стена Сианя длиной около 13,7 км построена при династии Мин и считается одной из самых хорошо сохранившихся городских стен Китая.', 'Сиандын шаар дубалынын узундугу 13,7 км чамасында, ал Мин династиясынын тушунда курулган жана Кытайдагы эң жакшы сакталган шаар дубалдарынын бири деп эсептелет.', 'https://en.wikipedia.org/wiki/City_Wall_of_Xi%27an', '2026-10-16'::DATE, 'pending', 'published'),
  ('chengdu', 'CN', 'Чэнду', 'Чэнду', 'Chengdu', 30.66::DOUBLE PRECISION, 104.0633::DOUBLE PRECISION, '{"path":"geography/cities/cn-chengdu-32eaf56fb1e9.jpg","width":2000,"height":1125,"author":"Tetovált Kínai","authorUrl":"https://www.pexels.com/@xiavil/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/anshun-bridge-at-dusk-in-chengdu-china-35557996/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Чэнду, столица провинции Сычуань на юго-западе Китая, известен сычуаньской кухней, чайными домами и спокойным ритмом жизни. В городе работает база по разведению гигантских панд.', 'Чэнду Кытайдын түштүк-батышындагы Сычуань провинциясынын борбору, сычуань ашканасы, чай үйлөрү жана шашылбаган жашоо ыргагы менен белгилүү. Шаарда алп пандаларды көбөйтүү базасы иштейт.', 'База по разведению гигантских панд в Чэнду основана в 1987 году; начинали с шести панд, спасённых в дикой природе.', 'Чэндудагы алп пандаларды көбөйтүү базасы 1987-жылы негизделген; иш жапайы жаратылыштан куткарылган алты пандадан башталган.', 'https://en.wikipedia.org/wiki/Chengdu_Research_Base_of_Giant_Panda_Breeding', '2026-10-16'::DATE, 'pending', 'published'),
  ('qingdao', 'CN', 'Циндао', 'Циндао', 'Qingdao', 36.1167::DOUBLE PRECISION, 120.4::DOUBLE PRECISION, '{"path":"geography/cities/cn-qingdao-e5ee88e8bd9f.jpg","width":2000,"height":1333,"author":"zy s","authorUrl":"https://www.pexels.com/@zy-s-1353547308/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/zhanqiao-pier-in-china-26873061/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Циндао, портовый город провинции Шаньдун на побережье Жёлтого моря. В старой части города сохранилась европейская архитектура конца XIX и начала XX века, а среди вузов города Океанологический университет Китая.', 'Циндао Шаньдун провинциясындагы Сары деңиздин жээгиндеги порт шаары. Шаардын эски бөлүгүндө XIX кылымдын аягы жана XX кылымдын башындагы европалык архитектура сакталган, ал эми шаардын окуу жайларынын арасында Кытай океан университети бар.', 'Пирс Чжаньцяо длиной 440 метров построен в 1891 году и стал первым причалом Циндао; восьмиугольный павильон Хуйлань на его конце появился в 1930 году.', 'Узундугу 440 метр болгон Чжаньцяо пирси 1891-жылы курулуп, Циндаонун биринчи причалы болгон; анын учундагы сегиз бурчтуу Хуйлань павильону 1930-жылы курулган.', 'https://en.wikipedia.org/wiki/Zhanqiao_Pier', '2026-10-16'::DATE, 'pending', 'published'),
  ('wuhan', 'CN', 'Ухань', 'Ухань', 'Wuhan', 30.595::DOUBLE PRECISION, 114.2975::DOUBLE PRECISION, '{"path":"geography/cities/cn-wuhan-2d143969829a.jpg","width":2000,"height":1333,"author":"yx b","authorUrl":"https://www.pexels.com/@ppppr/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/the-wuhan-yangtze-river-bridge-in-wuhan-china-12841262/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Ухань, столица провинции Хубэй, стоит при слиянии рек Янцзы и Ханьшуй и служит транспортным узлом центрального Китая. Это один из крупнейших университетских центров страны, здесь работают Уханьский университет и HUST.', 'Ухань Хубэй провинциясынын борбору, Янцзы жана Ханьшуй дарыялары кошулган жерде жайгашкан жана борбордук Кытайдын транспорттук түйүнү. Бул өлкөнүн эң ири университет борборлорунун бири, бул жерде Ухань университети жана HUST иштейт.', 'Мост через Янцзы в Ухане, открытый в 1957 году, называют «Первым мостом через Янцзы»; по верхнему ярусу идёт автодорога, по нижнему железная дорога.', '1957-жылы ачылган Ухандагы Янцзы көпүрөсүн «Янцзыдагы биринчи көпүрө» деп аташат; анын үстүңкү кабаты менен автожол, ылдыйкы кабаты менен темир жол өтөт.', 'https://en.wikipedia.org/wiki/Wuhan_Yangtze_River_Bridge', '2026-10-16'::DATE, 'pending', 'published'),
  ('chongqing', 'CN', 'Чунцин', 'Чунцин', 'Chongqing', 29.55::DOUBLE PRECISION, 106.5069::DOUBLE PRECISION, '{"path":"geography/cities/cn-chongqing-346d94b362b2.jpg","width":2000,"height":1333,"author":"Liuuu _61","authorUrl":"https://www.pexels.com/@liuuu-_61-2383408/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/skyline-of-chongqing-with-yangtze-river-view-38049229/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Чунцин, один из четырёх городов центрального подчинения Китая, расположен на юго-западе страны при слиянии рек Янцзы и Цзялин. Город построен на холмах и известен острой кухней, прежде всего чунцинским хого.', 'Чунцин Кытайдын борбордук баш ийүүдөгү төрт шаарынын бири, өлкөнүн түштүк-батышында Янцзы жана Цзялин дарыялары кошулган жерде жайгашкан. Шаар дөбөлөрдүн үстүнө курулган жана ачуу тамактары, баарынан мурда чунцин хогосу менен белгилүү.', 'Станция монорельса Лицзыба в Чунцине находится на уровне с 6 по 8 этаж 19-этажного жилого дома: поезда проходят прямо через здание.', 'Чунцин монорельсинин Лицзыба бекети 19 кабаттуу турак үйдүн 6-кабатынан 8-кабатына чейинки деңгээлде жайгашкан: поезддер имараттын ичинен өтөт.', 'https://en.wikipedia.org/wiki/Liziba_station', '2026-10-16'::DATE, 'pending', 'published'),
  ('harbin', 'CN', 'Харбин', 'Харбин', 'Harbin', 45.75::DOUBLE PRECISION, 126.6333::DOUBLE PRECISION, '{"path":"geography/cities/cn-harbin-ebe04eacb4ca.jpg","width":2000,"height":1335,"author":"李聪明ing","authorUrl":"https://www.pexels.com/@ing-554398100/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/illuminated-ice-castle-at-night-35352648/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Харбин, столица самой северной провинции Китая Хэйлунцзян, известен очень холодной зимой. Город вырос как железнодорожный узел на рубеже XIX и XX веков, и в нём сохранилась архитектура того времени.', 'Харбин Кытайдын эң түндүктөгү Хэйлунцзян провинциясынын борбору, өтө суук кышы менен белгилүү. Шаар XIX жана XX кылымдардын тогошкон учурунда темир жол түйүнү катары өскөн, анда ошол доордун архитектурасы сакталган.', 'Харбинский фестиваль льда и снега считается крупнейшим в мире; ледяные здания для него строят из блоков льда, которые берут прямо из реки Сунгари.', 'Харбиндин муз жана кар фестивалы дүйнөдөгү эң ири фестиваль деп эсептелет; анын муз имараттары түз эле Сунгари дарыясынан алынган муз блокторунан курулат.', 'https://en.wikipedia.org/wiki/Harbin_International_Ice_and_Snow_Sculpture_Festival', '2026-10-16'::DATE, 'pending', 'published'),
  ('hefei', 'CN', 'Хэфэй', 'Хэфэй', 'Hefei', 31.8639::DOUBLE PRECISION, 117.2808::DOUBLE PRECISION, '{"path":"geography/cities/cn-hefei-1088776b2ee9.jpg","width":2000,"height":1125,"author":"Joanie xie","authorUrl":"https://www.pexels.com/@joanie-xie-1306424600/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/aerial-view-of-hefei-city-skyline-in-daylight-30607308/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Хэфэй, столица провинции Аньхой на востоке Китая, известен как центр науки и технологий. Здесь находятся Китайский научно-технический университет (USTC) и институты Академии наук Китая.', 'Хэфэй Кытайдын чыгышындагы Аньхой провинциясынын борбору, илим жана технология борбору катары белгилүү. Бул жерде Кытай илим жана технология университети (USTC) жана Кытай илимдер академиясынын институттары жайгашкан.', '20 января 2025 года экспериментальный токамак EAST в Хэфэе удерживал плазму 1066 секунд и побил собственный рекорд 2023 года.', '2025-жылдын 20-январында Хэфэйдеги EAST эксперименталдык токамагы плазманы 1066 секунд кармап, 2023-жылдагы өз рекордун жаңырткан.', 'https://en.wikipedia.org/wiki/Experimental_Advanced_Superconducting_Tokamak', '2026-10-16'::DATE, 'pending', 'published'),
  ('nanchang', 'CN', 'Наньчан', 'Наньчан', 'Nanchang', 28.6842::DOUBLE PRECISION, 115.8872::DOUBLE PRECISION, '{"path":"geography/cities/cn-nanchang-334e226ffcfa.jpg","width":2000,"height":1125,"author":"CHINA YU","authorUrl":"https://www.pexels.com/@china-yu-200611083/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/stunning-night-view-of-pavilion-of-prince-teng-36348004/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Наньчан, столица провинции Цзянси, стоит на берегу реки Ганьцзян. Символ города Павильон принца Тэна, одна из «трёх великих башен» юга Китая.', 'Наньчан Цзянси провинциясынын борбору, Ганьцзян дарыясынын жээгинде жайгашкан. Шаардын символу Тэн ханзаадасынын павильону, ал Кытайдын түштүгүндөгү «үч улуу мунаранын» бири.', 'Павильон принца Тэна впервые построили в 653 году; нынешнее здание возвели в 1989 году на прежнем месте.', 'Тэн ханзаадасынын павильону алгач 653-жылы курулган; азыркы имарат 1989-жылы мурдагы жеринде кайра тургузулган.', 'https://en.wikipedia.org/wiki/Pavilion_of_Prince_Teng', '2026-10-16'::DATE, 'pending', 'published'),
  ('nanjing', 'CN', 'Нанкин', 'Нанкин', 'Nanjing', 32.0608::DOUBLE PRECISION, 118.7789::DOUBLE PRECISION, '{"path":"geography/cities/cn-nanjing-3e94aad3670f.jpg","width":2000,"height":1333,"author":"sam Zheng","authorUrl":"https://www.pexels.com/@sam-zheng-2147574978/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/modern-skyline-view-with-traditional-pagoda-31931620/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Нанкин, столица провинции Цзянсу, в прошлом был столицей нескольких китайских государств, в том числе империи Мин. Город сохранил городскую стену эпохи Мин и остаётся крупным университетским центром востока Китая.', 'Нанкин Цзянсу провинциясынын борбору, мурда бир нече кытай мамлекетинин, анын ичинде Мин империясынын борбору болгон. Шаар Мин доорундагы шаар дубалын сактап калган жана чыгыш Кытайдагы ири университет борбору бойдон калууда.', 'Городскую стену Нанкина строили 21 год силами около 200 000 рабочих по замыслу основателя династии Мин.', 'Нанкиндин шаар дубалын Мин династиясынын негиздөөчүсүнүн долбоору боюнча 200 000ге жакын жумушчу 21 жыл курган.', 'https://en.wikipedia.org/wiki/Nanjing_City_Wall', '2026-10-16'::DATE, 'pending', 'published'),
  ('ningbo', 'CN', 'Нинбо', 'Нинбо', 'Ningbo', 29.875::DOUBLE PRECISION, 121.5492::DOUBLE PRECISION, '{"path":"geography/cities/cn-ningbo-548d79919ff8.jpg","width":2000,"height":1333,"author":"Jin Zhang","authorUrl":"https://www.pexels.com/@jin-zhang-2161544741/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/modern-skyline-of-ningbo-at-twilight-37560629/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Нинбо, портовый город провинции Чжэцзян к югу от залива Ханчжоувань. Здесь работает Ноттингемский университет в Нинбо (UNNC) с обучением на английском языке.', 'Нинбо Чжэцзян провинциясындагы Ханчжоувань булуңунун түштүгүндөгү порт шаары. Бул жерде англис тилинде окуткан Ноттингем университетинин Нинбодогу кампусу (UNNC) иштейт.', 'Порт Нинбо-Чжоушань считается самым загруженным портом мира по объёму грузов.', 'Нинбо-Чжоушань порту жүк көлөмү боюнча дүйнөдөгү эң жүктөлгөн порт деп эсептелет.', 'https://en.wikipedia.org/wiki/Port_of_Ningbo-Zhoushan', '2026-10-16'::DATE, 'pending', 'published'),
  ('shenyang', 'CN', 'Шэньян', 'Шэньян', 'Shenyang', 41.8025::DOUBLE PRECISION, 123.4281::DOUBLE PRECISION, '{"path":"geography/cities/cn-shenyang-a42050ce8f3c.jpg","width":2000,"height":1125,"author":"Techyan","authorUrl":"https://commons.wikimedia.org/wiki/User:Techyan","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Mukden_Palace_drone_view_1.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Шэньян, столица провинции Ляонин, один из крупнейших городов северо-востока Китая. В XVII веке здесь была первая столица династии Цин, и в городе сохранился её императорский дворец.', 'Шэньян Ляонин провинциясынын борбору, Кытайдын түндүк-чыгышындагы эң ири шаарлардын бири. XVII кылымда бул жерде Цин династиясынын биринчи борбору болгон, шаарда анын императордук сарайы сакталган.', 'Императорский дворец Цин в Шэньяне насчитывает 114 построек и вместе с Запретным городом в Пекине входит в объект Всемирного наследия ЮНЕСКО.', 'Шэньяндагы Цин императордук сарайы 114 имараттан турат жана Бээжиндеги Тыюу салынган шаар менен бирге ЮНЕСКОнун Бүткүл дүйнөлүк мурас объектисине кирет.', 'https://whc.unesco.org/en/list/439', '2026-10-16'::DATE, 'pending', 'published'),
  ('suzhou', 'CN', 'Сучжоу', 'Сучжоу', 'Suzhou', 31.3::DOUBLE PRECISION, 120.6194::DOUBLE PRECISION, '{"path":"geography/cities/cn-suzhou-87ff2681fb49.jpg","width":2000,"height":1333,"author":"Garrison Gao","authorUrl":"https://www.pexels.com/@garrison-gao-56316964/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/charming-canal-scene-in-suzhou-china-36466099/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Сучжоу, город в провинции Цзянсу недалеко от Шанхая, известен каналами и классическими садами. Здесь работает китайско-британский университет Сиань Цзяотун-Ливерпуль (XJTLU).', 'Сучжоу Шанхайга жакын Цзянсу провинциясындагы шаар, каналдары жана классикалык бактары менен белгилүү. Бул жерде кытай-британ Сиань Цзяотун-Ливерпуль университети (XJTLU) иштейт.', 'Классические сады Сучжоу внесены в список Всемирного наследия ЮНЕСКО в 1997 году, а в 2000 году границы объекта расширили.', 'Сучжоунун классикалык бактары 1997-жылы ЮНЕСКОнун Бүткүл дүйнөлүк мурас тизмесине киргизилген, ал эми 2000-жылы объекттин чеги кеңейтилген.', 'https://whc.unesco.org/en/list/813', '2026-10-16'::DATE, 'pending', 'published'),
  ('xiangyang', 'CN', 'Сянъян', 'Сянъян', 'Xiangyang', 32.0654::DOUBLE PRECISION, 112.1531::DOUBLE PRECISION, '{"path":"geography/cities/cn-xiangyang-09a43f5de719.jpg","width":2000,"height":1500,"author":"Yumeto","authorUrl":"https://commons.wikimedia.org/wiki/User:Yumeto","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:20250525_Linhan_Men.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Сянъян, город на реке Ханьшуй на северо-западе провинции Хубэй с долгой историей. В старой части города сохранилась одна из старейших городских стен Китая, дошедших до наших дней целиком.', 'Сянъян Хубэй провинциясынын түндүк-батышындагы Ханьшуй дарыясынын боюндагы узак тарыхы бар шаар. Шаардын эски бөлүгүндө Кытайдагы бүтүн бойдон сакталган эң байыркы шаар дубалдарынын бири бар.', 'Сянъян вырос из двух старых городов на разных берегах реки Ханьшуй, Сянчэна и Фаньчэна; до 2010 года он назывался Сянфань.', 'Сянъян Ханьшуй дарыясынын эки жээгиндеги эки эски шаардан, Сянчэн жана Фаньчэнден куралган; 2010-жылга чейин ал Сянфань деп аталган.', 'https://en.wikipedia.org/wiki/Xiangyang', '2026-10-16'::DATE, 'pending', 'published'),
  ('yibin', 'CN', 'Ибинь', 'Ибинь', 'Yibin', 28.7596::DOUBLE PRECISION, 104.64::DOUBLE PRECISION, '{"path":"geography/cities/cn-yibin-ab71db5ef539.jpg","width":2000,"height":1506,"author":"RieezH","authorUrl":"https://commons.wikimedia.org/wiki/User:RieezH","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:%E5%90%88%E6%B1%9F%E9%97%A8%E5%B9%BF%E5%9C%BA.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Ибинь, город на юго-востоке провинции Сычуань, стоит при слиянии рек Миньцзян и Цзиньша. Это транспортный узел юга провинции: через город проходят железные дороги и несколько мостов через Янцзы.', 'Ибинь Сычуань провинциясынын түштүк-чыгышындагы шаар, Миньцзян жана Цзиньша дарыялары кошулган жерде жайгашкан. Бул провинциянын түштүгүндөгү транспорттук түйүн: шаар аркылуу темир жолдор жана Янцзы аркылуу бир нече көпүрө өтөт.', 'Выше Ибиня Янцзы называют Цзиньша, а ниже города по-китайски Чанцзян, то есть «Длинная река».', 'Ибинден жогору Янцзыны Цзиньша деп, ал эми шаардан төмөн кытайча Чанцзян, башкача айтканда «Узун дарыя» деп аташат.', 'https://en.wikipedia.org/wiki/Yibin', '2026-10-16'::DATE, 'pending', 'published'),
  ('zhuhai', 'CN', 'Чжухай', 'Чжухай', 'Zhuhai', 22.2742::DOUBLE PRECISION, 113.5719::DOUBLE PRECISION, '{"path":"geography/cities/cn-zhuhai-b32b9709729c.jpg","width":2000,"height":1333,"author":"fei wang","authorUrl":"https://www.pexels.com/@feiwang/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/zhuhai-opera-in-zhuhai-in-china-20599726/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Чжухай, город провинции Гуандун в дельте Жемчужной реки, граничит с Макао и стал одной из первых особых экономических зон Китая. Здесь работают кампусы нескольких вузов, в том числе Пекинского технологического института (BIT).', 'Чжухай Гуандун провинциясындагы Бермет дарыясынын дельтасында жайгашкан, Макао менен чектешкен шаар жана Кытайдын алгачкы атайын экономикалык зоналарынын бири. Бул жерде бир нече окуу жайдын, анын ичинде Бээжин технологиялык институтунун (BIT) кампустары иштейт.', 'Мост Гонконг, Чжухай и Макао длиной 55 км считается самым длинным морским переходом в мире.', 'Узундугу 55 км болгон Гонконг, Чжухай жана Макао көпүрөсү дүйнөдөгү эң узун деңиз аркылуу өтүүчү курулма деп эсептелет.', 'https://en.wikipedia.org/wiki/Hong_Kong%E2%80%93Zhuhai%E2%80%93Macau_Bridge', '2026-10-16'::DATE, 'pending', 'published'),
  ('kuala-lumpur', 'MY', 'Куала-Лумпур', 'Куала-Лумпур', 'Kuala Lumpur', 3.1478::DOUBLE PRECISION, 101.6953::DOUBLE PRECISION, '{"path":"geography/cities/my-kuala-lumpur-c46690f608e6.jpg","width":2000,"height":1331,"author":"Joerg Hartmann","authorUrl":"https://www.pexels.com/@joerg-hartmann-626385254/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/skyscrapers-in-city-in-malaysia-26108669/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Куала-Лумпур, столица и самый населённый город Малайзии, центр агломерации Большой Куала-Лумпур. Это деловой и транспортный узел страны, где работают многие частные и государственные университеты.', 'Куала-Лумпур Малайзиянын борбору жана эң көп калктуу шаары, Чоң Куала-Лумпур агломерациясынын борбору. Бул өлкөнүн ишкердик жана транспорттук түйүнү, бул жерде көп жеке жана мамлекеттик университеттер иштейт.', 'Башни-близнецы Петронас высотой 451,9 метра с 1998 по 2004 год были самыми высокими зданиями мира.', 'Бийиктиги 451,9 метр болгон Петронас эгиз мунаралары 1998-жылдан 2004-жылга чейин дүйнөдөгү эң бийик имараттар болгон.', 'https://en.wikipedia.org/wiki/Petronas_Towers', '2026-10-16'::DATE, 'pending', 'published'),
  ('bandar-sunway', 'MY', 'Бандар-Санвей', 'Бандар-Санвей', 'Bandar Sunway', 3.0675::DOUBLE PRECISION, 101.6033::DOUBLE PRECISION, '{"path":"geography/cities/my-bandar-sunway-5bc53f9b4b5b.jpg","width":2000,"height":900,"author":"Azreey","authorUrl":"https://commons.wikimedia.org/wiki/User:Azreey","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Bandar_Sunway_-_South_Quay_Lake.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Бандар-Санвей (Sunway City), городской район в штате Селангор: большая часть относится к Субанг-Джае, северная к Петалинг-Джае. Здесь работают Sunway University и Monash University Malaysia, поэтому район известен как центр высшего образования.', 'Бандар-Санвей (Sunway City) Селангор штатындагы шаардык район: анын көбү Субанг-Жаяга, түндүк бөлүгү Петалинг-Жаяга карайт. Бул жерде Sunway University жана Monash University Malaysia иштейт, ошондуктан район жогорку билим берүү борбору катары белгилүү.', 'С 2000 по 2007 год в Бандар-Санвее работал Sunway Monorail, первый общественный монорельс Малайзии.', '2000-жылдан 2007-жылга чейин Бандар-Санвейде Малайзиядагы биринчи коомдук монорельс Sunway Monorail иштеген.', 'https://en.wikipedia.org/wiki/Sunway_City', '2026-10-16'::DATE, 'pending', 'published'),
  ('cyberjaya', 'MY', 'Сайберджая', 'Сайбержая', 'Cyberjaya', 2.9225::DOUBLE PRECISION, 101.655::DOUBLE PRECISION, '{"path":"geography/cities/my-cyberjaya-13d16489d168.jpg","width":2000,"height":1125,"author":"Nora Khalid","authorUrl":"https://www.pexels.com/@nora-khalid-706233149/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/river-and-park-with-city-buildings-behind-25401816/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Сайберджая, запланированный город с научным парком в округе Сепанг штата Селангор, часть агломерации Большой Куала-Лумпур. Его строили рядом с Путраджаей как центр технологий и цифровой экономики.', 'Сайбержая Селангор штатынын Сепанг районундагы илимий парк негизинде пландалган шаар, Чоң Куала-Лумпур агломерациясынын бөлүгү. Ал Путраджаянын жанында технология жана санариптик экономика борбору катары курулган.', 'Название Cyberjaya составлено из слов cyber и Putrajaya; город официально открыли 17 мая 1997 года.', 'Cyberjaya деген ат cyber жана Putrajaya сөздөрүнөн куралган; шаар 1997-жылдын 17-майында расмий ачылган.', 'https://en.wikipedia.org/wiki/Cyberjaya', '2026-10-16'::DATE, 'pending', 'published'),
  ('johor-bahru', 'MY', 'Джохор-Бару', 'Жохор-Бару', 'Johor Bahru', 1.4556::DOUBLE PRECISION, 103.7611::DOUBLE PRECISION, '{"path":"geography/cities/my-johor-bahru-40dbee49d091.jpg","width":2000,"height":1343,"author":"Alix Lee","authorUrl":"https://www.pexels.com/@alix-lee-43379071/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/skyline-of-johor-bahru-with-waterfront-reflection-32162170/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Джохор-Бару, столица штата Джохор на южной оконечности Малайского полуострова, граничит с Сингапуром. Это один из крупнейших городов Малайзии и важный центр торговли и промышленности.', 'Жохор-Бару Малай жарым аралынын түштүк четиндеги Жохор штатынын борбору, Сингапур менен чектешет. Бул Малайзиядагы эң ири шаарлардын бири жана соода менен өнөр жайдын маанилүү борбору.', 'Дамба длиной 1,056 км через Джохорский пролив соединяет Джохор-Бару с Сингапуром; её открыли в 1924 году.', 'Жохор кысыгы аркылуу өткөн узундугу 1,056 км дамба Жохор-Баруну Сингапур менен байланыштырат; ал 1924-жылы ачылган.', 'https://en.wikipedia.org/wiki/Johor%E2%80%93Singapore_Causeway', '2026-10-16'::DATE, 'pending', 'published'),
  ('nilai', 'MY', 'Нилай', 'Нилай', 'Nilai', 2.8167::DOUBLE PRECISION, 101.8::DOUBLE PRECISION, '{"path":"geography/cities/my-nilai-f267df47e50e.jpg","width":2000,"height":1202,"author":"AyyanD","authorUrl":"https://commons.wikimedia.org/wiki/User:AyyanD","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Clock_tower,_Nilai_Square,_Nilai.jpg","license":"CC BY-SA 3.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0"}'::JSONB, 'Нилай, город в штате Негри-Сембилан на границе с Селангором, часть агломерации Большой Куала-Лумпур. Он находится недалеко от международного аэропорта Куала-Лумпура (KLIA).', 'Нилай Селангор менен чектешкен Негри-Сембилан штатындагы шаар, Чоң Куала-Лумпур агломерациясынын бөлүгү. Ал Куала-Лумпурдун эл аралык аэропортуна (KLIA) жакын жайгашкан.', 'В Нилае работают несколько вузов, в том числе INTI International University и Universiti Sains Islam Malaysia, поэтому здесь учатся студенты со всего мира.', 'Нилайда бир нече окуу жай, анын ичинде INTI International University жана Universiti Sains Islam Malaysia иштейт, ошондуктан бул жерде дүйнөнүн ар кайсы өлкөсүнөн студенттер окушат.', 'https://en.wikipedia.org/wiki/Nilai', '2026-10-16'::DATE, 'pending', 'published'),
  ('petaling-jaya', 'MY', 'Петалинг-Джая', 'Петалинг-Жая', 'Petaling Jaya', 3.1073::DOUBLE PRECISION, 101.6067::DOUBLE PRECISION, '{"path":"geography/cities/my-petaling-jaya-3cad0934daf3.jpg","width":2000,"height":1500,"author":"Deva Darshan","authorUrl":"https://www.pexels.com/@darshan394/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/bird-s-eye-view-of-city-1173771/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Петалинг-Джая, город в штате Селангор в составе агломерации Большой Куала-Лумпур. Его строили как город-спутник столицы, а статус города он получил в 2006 году.', 'Петалинг-Жая Чоң Куала-Лумпур агломерациясынын курамындагы Селангор штатындагы шаар. Ал борбордун шаар-спутниги катары курулган, ал эми шаар статусун 2006-жылы алган.', 'Петалинг-Джаю начали строить в 1952 году: первые 800 домов появились на земле каучуковой плантации Effingham Estate, чтобы разгрузить Куала-Лумпур.', 'Петалинг-Жаянын курулушу 1952-жылы башталган: Куала-Лумпурдун жүгүн азайтуу үчүн Effingham Estate каучук плантациясынын жеринде алгачкы 800 үй курулган.', 'https://en.wikipedia.org/wiki/Petaling_Jaya', '2026-10-16'::DATE, 'pending', 'published'),
  ('sepang', 'MY', 'Сепанг', 'Сепанг', 'Sepang', 2.6917::DOUBLE PRECISION, 101.7514::DOUBLE PRECISION, '{"path":"geography/cities/my-sepang-f40f462c7940.jpg","width":2000,"height":1500,"author":"CK Tan","authorUrl":"https://web.archive.org/web/20161103145524/http://www.panoramio.com/user/6148113?with_photo_id=133617881","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Bird-eye_view_of_KLIA_and_Sepang_F1_Circuit_-_panoramio.jpg","license":"CC BY 3.0","licenseUrl":"https://creativecommons.org/licenses/by/3.0"}'::JSONB, 'Сепанг, город и округ на юге штата Селангор. Здесь находятся международный аэропорт Куала-Лумпура (KLIA) и автодром Sepang International Circuit, а в районе Бандар-Сунсурия работает кампус Xiamen University Malaysia.', 'Сепанг Селангор штатынын түштүгүндөгү шаар жана район. Бул жерде Куала-Лумпурдун эл аралык аэропорту (KLIA) жана Sepang International Circuit автодрому жайгашкан, ал эми Бандар-Сунсурия районунда Xiamen University Malaysia кампусу иштейт.', 'Трасса Sepang International Circuit длиной 5,543 км с 1999 по 2017 год принимала Гран-при Малайзии «Формулы-1».', 'Узундугу 5,543 км болгон Sepang International Circuit трассасында 1999-жылдан 2017-жылга чейин «Формула-1» Малайзия Гран-приси өткөн.', 'https://en.wikipedia.org/wiki/Sepang_International_Circuit', '2026-10-16'::DATE, 'pending', 'published'),
  ('serdang', 'MY', 'Серданг', 'Серданг', 'Serdang', 3.0333::DOUBLE PRECISION, 101.7167::DOUBLE PRECISION, '{"path":"geography/cities/my-serdang-b7b5883499da.jpg","width":2000,"height":1500,"author":"Wee Hong","authorUrl":"https://commons.wikimedia.org/wiki/User:Wee_Hong","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Masjid_UPM.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Серданг, пригород в штате Селангор между Куала-Лумпуром и Путраджаей, часть агломерации Большой Куала-Лумпур; административно относится к Сери-Кембангану. Здесь находится главный кампус Universiti Putra Malaysia (UPM).', 'Серданг Куала-Лумпур менен Путраджаянын ортосундагы Селангор штатындагы шаар четиндеги аймак, Чоң Куала-Лумпур агломерациясынын бөлүгү; административдик жактан Сери-Кембанганга кирет. Бул жерде Universiti Putra Malaysia (UPM) башкы кампусу жайгашкан.', 'Университет UPM начинался 21 мая 1931 года как Школа сельского хозяйства в Серданге на участке в 9 гектаров.', 'UPM университети 1931-жылдын 21-майында Сердангдагы 9 гектар жерде Айыл чарба мектеби катары башталган.', 'https://en.wikipedia.org/wiki/University_of_Putra_Malaysia', '2026-10-16'::DATE, 'pending', 'published'),
  ('shah-alam', 'MY', 'Шах-Алам', 'Шах-Алам', 'Shah Alam', 3.0833::DOUBLE PRECISION, 101.5333::DOUBLE PRECISION, '{"path":"geography/cities/my-shah-alam-a3130eec0344.jpg","width":2000,"height":1278,"author":"Intan Payung","authorUrl":"https://www.pexels.com/@intan-payung-3809692/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/illuminated-mosque-at-night-5649468/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Шах-Алам, столица штата Селангор с 1978 года и первый запланированный город Малайзии после обретения независимости. Здесь работают несколько университетов, в том числе Management and Science University.', 'Шах-Алам 1978-жылдан бери Селангор штатынын борбору жана Малайзия көз карандысыздыкка жеткенден кийин пландалып курулган биринчи шаар. Бул жерде бир нече университет, анын ичинде Management and Science University иштейт.', 'Мечеть Султана Салахуддина Абдул Азиза Шаха, или «Голубая мечеть», крупнейшая мечеть Малайзии; её главная примета большой сине-серебристый купол.', 'Султан Салахуддин Абдул Азиз Шах мечити, же «Көк мечит», Малайзиядагы эң чоң мечит; анын негизги өзгөчөлүгү чоң көк-күмүш түстүү күмбөзү.', 'https://en.wikipedia.org/wiki/Sultan_Salahuddin_Abdul_Aziz_Mosque', '2026-10-16'::DATE, 'pending', 'published'),
  ('subang-jaya', 'MY', 'Субанг-Джая', 'Субанг-Жая', 'Subang Jaya', 3.0644::DOUBLE PRECISION, 101.5936::DOUBLE PRECISION, '{"path":"geography/cities/my-subang-jaya-152703c08160.jpg","width":2000,"height":1297,"author":"Md. Shaifuzzaman Ayon","authorUrl":"https://www.pexels.com/@saifzaman/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/aerial-shot-of-shoes-in-malaysia-4629376/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Субанг-Джая, город в штате Селангор в составе агломерации Большой Куала-Лумпур. Это один из самых населённых городов Малайзии с большими жилыми районами и несколькими частными университетами.', 'Субанг-Жая Чоң Куала-Лумпур агломерациясынын курамындагы Селангор штатындагы шаар. Бул чоң турак жай райондору жана бир нече жеке университети бар Малайзиядагы эң көп калктуу шаарлардын бири.', 'Строительство Субанг-Джаи началось в 1976 году на месте каучуковой плантации Seafield Estate.', 'Субанг-Жаянын курулушу 1976-жылы Seafield Estate каучук плантациясынын ордунда башталган.', 'https://en.wikipedia.org/wiki/Subang_Jaya', '2026-10-16'::DATE, 'pending', 'published'),
  ('dubai', 'AE', 'Дубай', 'Дубай', 'Dubai', 25.2697::DOUBLE PRECISION, 55.3094::DOUBLE PRECISION, '{"path":"geography/cities/ae-dubai-291c279a2408.jpg","width":2000,"height":1334,"author":"Nihongraphy","authorUrl":"https://www.pexels.com/@nihongraphy-22469233/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/dubai-skyline-at-night-13256066/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Дубай, самый населённый город ОАЭ и столица одноимённого эмирата, стоит на морском побережье у бухты Дубай-Крик. Это международный деловой и транспортный центр, где работают кампусы многих зарубежных университетов.', 'Дубай БАЭнин эң көп калктуу шаары жана ушул эле аттагы эмираттын борбору, Дубай-Крик булуңунун жанындагы деңиз жээгинде жайгашкан. Бул эл аралык ишкердик жана транспорттук борбор, бул жерде көп чет элдик университеттердин кампустары иштейт.', 'Бурдж-Халифа в Дубае высотой 828 метров самое высокое здание в мире.', 'Дубайдагы бийиктиги 828 метр болгон Бурж-Халифа дүйнөдөгү эң бийик имарат.', 'https://en.wikipedia.org/wiki/Burj_Khalifa', '2026-10-16'::DATE, 'pending', 'published'),
  ('istanbul', 'TR', 'Стамбул', 'Стамбул', 'Istanbul', 41.01::DOUBLE PRECISION, 28.9603::DOUBLE PRECISION, '{"path":"geography/cities/tr-istanbul-6a171f0b3237.jpg","width":2000,"height":1125,"author":"Talha Güney","authorUrl":"https://www.pexels.com/@tlhaguney/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/illuminated-bridge-in-istambul-16254744/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Стамбул, крупнейший город Турции, её экономический, культурный и исторический центр. Город стоит по обе стороны пролива Босфор между Мраморным и Чёрным морями.', 'Стамбул Түркиянын эң ири шаары, анын экономикалык, маданий жана тарыхый борбору. Шаар Мрамор жана Кара деңиздеринин ортосундагы Босфор кысыгынын эки жээгинде жайгашкан.', 'Стамбул стоит сразу на двух континентах: около двух третей жителей живут в европейской части города, остальные в азиатской.', 'Стамбул эки континентте жайгашкан: тургундардын үчтөн экисине жакыны шаардын Европа бөлүгүндө, калганы Азия бөлүгүндө жашайт.', 'https://en.wikipedia.org/wiki/Istanbul', '2026-10-16'::DATE, 'pending', 'published'),
  ('ankara', 'TR', 'Анкара', 'Анкара', 'Ankara', 39.9358::DOUBLE PRECISION, 32.8387::DOUBLE PRECISION, '{"path":"geography/cities/tr-ankara-b5de7e819ace.jpg","width":2000,"height":1333,"author":"Mehdi","authorUrl":"https://www.pexels.com/@mehdi-337113120/","sourceName":"Pexels","sourceUrl":"https://www.pexels.com/photo/panoramic-view-of-ankara-cityscape-29043804/","license":"Pexels License","licenseUrl":"https://www.pexels.com/license/"}'::JSONB, 'Анкара, столица Турции, стоит в центральной части Анатолии и по населению уступает в стране только Стамбулу. Здесь работают несколько крупных университетов, в том числе Анкарский университет, Билькент и ODTÜ.', 'Анкара Түркиянын борбору, Анатолиянын борбордук бөлүгүндө жайгашкан жана калкы боюнча өлкөдө Стамбулдан гана кийин турат. Бул жерде бир нече ири университет, анын ичинде Анкара университети, Билькент жана ODTÜ иштейт.', 'Ангорская кошка, ангорская коза, дающая мохер, и ангорский кролик названы по старому имени Анкары, Ангора.', 'Ангор мышыгы, мохер берүүчү ангор эчкиси жана ангор коёну Анкаранын эски аты Ангорадан аталган.', 'https://en.wikipedia.org/wiki/Ankara', '2026-10-16'::DATE, 'pending', 'published'),
  ('milan', 'IT', 'Милан', 'Милан', 'Milan', 45.4669::DOUBLE PRECISION, 9.19::DOUBLE PRECISION, '{"path":"geography/cities/it-milan-4595d05c03e7.jpg","width":2000,"height":1498,"author":"Ouael Ben Salah","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/duomo-di-milano-cathedral-in-milan-0xe2FGo7Vc0","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Милан, крупнейший город Ломбардии на севере Италии, один из главных деловых центров страны. Город известен экономикой, модой и дизайном, и здесь работает сразу несколько крупных университетов.', 'Милан Италиянын түндүгүндөгү Ломбардиянын эң ири шаары жана өлкөнүн негизги ишкердик борборлорунун бири. Шаар экономикасы, модасы жана дизайны менен белгилүү, бул жерде бир нече ири университет иштейт.', 'Миланский собор начали строить в 1386 году, а последние работы завершили только в 1965 году: стройка заняла почти шесть веков.', 'Милан соборунун курулушу 1386-жылы башталып, акыркы иштери 1965-жылы гана бүткөн: курулуш дээрлик алты кылымга созулган.', 'https://en.wikipedia.org/wiki/Milan_Cathedral', '2026-10-16'::DATE, 'pending', 'published'),
  ('rome', 'IT', 'Рим', 'Рим', 'Rome', 41.8931::DOUBLE PRECISION, 12.4828::DOUBLE PRECISION, '{"path":"geography/cities/it-rome-6004125c0695.jpg","width":2000,"height":1449,"author":"Anton Volnuhin","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-large-building-with-a-lot-of-windows-on-top-of-it-jqSfmgvrIZs","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Рим, столица Италии и региона Лацио, по преданию основан в 753 году до н. э. В городе находятся крупнейшие музеи и памятники древности, а среди его университетов Сапиенца и Тор Вергата.', 'Рим Италиянын жана Лацио аймагынын борбору, уламыш боюнча б. з. ч. 753-жылы негизделген. Шаарда ири музейлер жана байыркы эстеликтер бар, ал эми анын университеттеринин арасында Сапиенца жана Тор Вергата бар.', 'Внутри Рима находится Ватикан: это единственный в мире пример страны, расположенной внутри города.', 'Римдин ичинде Ватикан жайгашкан: бул шаардын ичиндеги өлкөнүн дүйнөдөгү жалгыз мисалы.', 'https://en.wikipedia.org/wiki/Rome', '2026-10-16'::DATE, 'pending', 'published'),
  ('turin', 'IT', 'Турин', 'Турин', 'Turin', 45.0792::DOUBLE PRECISION, 7.6761::DOUBLE PRECISION, '{"path":"geography/cities/it-turin-ea9f2cc08bca.jpg","width":2000,"height":1333,"author":"Fabio Fistarol","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/aerial-view-of-city-buildings-during-daytime-VjA_PSSsOHI","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Турин, столица региона Пьемонт на северо-западе Италии, стоит у подножия Альп. С 1861 по 1865 год он был первой столицей объединённой Италии, а сегодня это промышленный и университетский город.', 'Турин Италиянын түндүк-батышындагы Пьемонт аймагынын борбору, Альп тоолорунун этегинде жайгашкан. 1861-жылдан 1865-жылга чейин ал бириккен Италиянын биринчи борбору болгон, азыр бул өнөр жай жана университет шаары.', 'Египетский музей Турина основан в 1824 году и считается старейшим в мире музеем, целиком посвящённым культуре Древнего Египта.', 'Турин Египет музейи 1824-жылы негизделген жана толугу менен Байыркы Египеттин маданиятына арналган дүйнөдөгү эң эски музей деп эсептелет.', 'https://en.wikipedia.org/wiki/Museo_Egizio', '2026-10-16'::DATE, 'pending', 'published'),
  ('bergamo', 'IT', 'Бергамо', 'Бергамо', 'Bergamo', 45.695::DOUBLE PRECISION, 9.67::DOUBLE PRECISION, '{"path":"geography/cities/it-bergamo-a82de162fb0b.jpg","width":2000,"height":1125,"author":"Isaac Maffeis","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-view-of-a-city-from-across-the-river-EY6V1ji2j4c","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Бергамо, город в Ломбардии примерно в 50 км к северо-востоку от Милана, делится на Верхний город (Читта-Альта) и Нижний город. Верхний город окружают венецианские стены XVI века.', 'Бергамо Миландан болжол менен 50 км түндүк-чыгышта жайгашкан Ломбардиядагы шаар, Жогорку шаарга (Читта-Альта) жана Төмөнкү шаарга бөлүнөт. Жогорку шаарды XVI кылымдагы венециялык дубалдар курчап турат.', 'Венецианские стены Бергамо входят в список Всемирного наследия ЮНЕСКО с 2017 года, а в 2023 году Бергамо вместе с Брешией был Столицей культуры Италии.', 'Бергамонун венециялык дубалдары 2017-жылдан бери ЮНЕСКОнун Бүткүл дүйнөлүк мурас тизмесинде, ал эми 2023-жылы Бергамо Брешиа менен бирге Италиянын маданият борбору болгон.', 'https://en.wikipedia.org/wiki/Bergamo', '2026-10-16'::DATE, 'pending', 'published'),
  ('bologna', 'IT', 'Болонья', 'Болонья', 'Bologna', 44.4939::DOUBLE PRECISION, 11.3428::DOUBLE PRECISION, '{"path":"geography/cities/it-bologna-8442e78bc48c.jpg","width":2000,"height":1333,"author":"Petr Slováček","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-view-of-a-city-with-tall-buildings-SXk8BWKvoXE","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Болонья, главный город региона Эмилия-Романья на севере Италии, известна красными черепичными крышами и длинными галереями-портиками. Это один из самых известных университетских городов Европы.', 'Болонья Италиянын түндүгүндөгү Эмилия-Романья аймагынын башкы шаары, кызыл чатырлары жана узун аркалуу галереялары менен белгилүү. Бул Европадагы эң белгилүү университет шаарларынын бири.', 'Болонский университет, где преподавание началось около 1088 года, считается старейшим из непрерывно действующих университетов мира.', 'Болон университетинде окутуу болжол менен 1088-жылы башталган, ал дүйнөдөгү үзгүлтүксүз иштеп келе жаткан эң эски университет деп эсептелет.', 'https://en.wikipedia.org/wiki/University_of_Bologna', '2026-10-16'::DATE, 'pending', 'published'),
  ('brescia', 'IT', 'Брешиа', 'Брешиа', 'Brescia', 45.5389::DOUBLE PRECISION, 10.2203::DOUBLE PRECISION, '{"path":"geography/cities/it-brescia-08301952b524.jpg","width":2000,"height":1333,"author":"Krzysztof","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/grand-white-cathedral-with-a-dome-and-bell-tower-t5RlZyn7B1E","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Брешиа, город в Ломбардии к востоку от Милана, с римскими древностями и площадью Лоджа. В городе работает Университет Брешии.', 'Брешиа Миландын чыгышындагы Ломбардиядагы шаар, рим доорундагы эстеликтери жана Лоджа аянты бар. Шаарда Брешиа университети иштейт.', 'Монастырь Сан-Сальваторе и Санта-Джулия в Брешии с 2011 года входит в список ЮНЕСКО в составе объекта «Лангобарды в Италии».', 'Брешиадагы Сан-Сальваторе жана Санта-Джулия монастыры 2011-жылдан бери «Италиядагы лангобарддар» объектисинин курамында ЮНЕСКОнун тизмесинде.', 'https://en.wikipedia.org/wiki/Brescia', '2026-10-16'::DATE, 'pending', 'published'),
  ('camerino', 'IT', 'Камерино', 'Камерино', 'Camerino', 43.1333::DOUBLE PRECISION, 13.0667::DOUBLE PRECISION, '{"path":"geography/cities/it-camerino-630bb4a5fe93.jpg","width":2000,"height":1000,"author":"Tuvok89","authorUrl":"https://commons.wikimedia.org/wiki/User:Tuvok89","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Camerino.panorama.jpg","license":"Public domain","licenseUrl":"https://commons.wikimedia.org/wiki/File:Camerino.panorama.jpg"}'::JSONB, 'Камерино, небольшой город на холме в регионе Марке, в предгорьях Апеннин. Жизнь города во многом связана с Университетом Камерино.', 'Камерино Марке аймагындагы Апеннин тоолорунун этегиндеги дөбөдө жайгашкан чакан шаар. Шаардын жашоосу көбүнчө Камерино университети менен байланыштуу.', 'Обучение в Камерино ведётся как минимум с XIII века: тогда здесь преподавали гражданское и церковное право, медицину и словесность.', 'Камеринодо окутуу жок дегенде XIII кылымдан бери жүрүп келет: ал кезде бул жерде жарандык жана чиркөө укугу, медицина жана адабият окутулган.', 'https://www.unicam.it/ateneo/storia', '2026-10-16'::DATE, 'pending', 'published'),
  ('cassino', 'IT', 'Кассино', 'Кассино', 'Cassino', 41.4917::DOUBLE PRECISION, 13.8333::DOUBLE PRECISION, '{"path":"geography/cities/it-cassino-d8bf91801f7a.jpg","width":2000,"height":1151,"author":"ThePhotografer","authorUrl":"https://commons.wikimedia.org/wiki/User:ThePhotografer","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Monte_Cassino_Abbey.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Кассино, город в регионе Лацио у подножия горы Монте-Кассино, между Римом и Неаполем. В городе работает Университет Кассино и Южного Лацио.', 'Кассино Лацио аймагындагы Монте-Кассино тоосунун этегиндеги, Рим менен Неаполдун ортосундагы шаар. Шаарда Кассино жана Түштүк Лацио университети иштейт.', 'Около 529 года Бенедикт Нурсийский основал на горе над городом монастырь Монтекассино, первую обитель ордена бенедиктинцев.', 'Болжол менен 529-жылы Нурсиялык Бенедикт шаардын үстүндөгү тоодо Монтекассино монастырын негиздеген, бул бенедиктиндер орденинин биринчи монастыры.', 'https://en.wikipedia.org/wiki/Monte_Cassino', '2026-10-16'::DATE, 'pending', 'published'),
  ('catania', 'IT', 'Катания', 'Катания', 'Catania', 37.5027::DOUBLE PRECISION, 15.0873::DOUBLE PRECISION, '{"path":"geography/cities/it-catania-70c4dee552ba.jpg","width":2000,"height":1333,"author":"Lukas Janßen","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-view-of-a-city-with-a-mountain-in-the-background-SYu314pVpd8","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Катания, один из крупнейших городов Сицилии, стоит на восточном побережье у подножия вулкана Этна. В городе работает Университет Катании.', 'Катания Сицилиянын эң ири шаарларынын бири, чыгыш жээкте Этна вулканынын этегинде жайгашкан. Шаарда Катания университети иштейт.', 'Этна, один из самых активных вулканов мира, с 2013 года входит в список Всемирного наследия ЮНЕСКО.', 'Дүйнөдөгү эң активдүү вулкандардын бири Этна 2013-жылдан бери ЮНЕСКОнун Бүткүл дүйнөлүк мурас тизмесинде.', 'https://en.wikipedia.org/wiki/Mount_Etna', '2026-10-16'::DATE, 'pending', 'published'),
  ('florence', 'IT', 'Флоренция', 'Флоренция', 'Florence', 43.7714::DOUBLE PRECISION, 11.2542::DOUBLE PRECISION, '{"path":"geography/cities/it-florence-6c5cf164b093.jpg","width":2000,"height":1334,"author":"Henrique Ferreira","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/florence-cityscape-with-duomo-cathedral-at-sunrise-zMFxCtkn9vI","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Флоренция, столица Тосканы, считается колыбелью итальянского Возрождения. Исторический центр с собором, галереями и мостом Понте-Веккьо один из самых известных в Европе.', 'Флоренция Тосканынын борбору жана италиялык Кайра жаралуу доорунун бешиги деп эсептелет. Собору, галереялары жана Понте-Веккьо көпүрөсү бар тарыхый борбору Европадагы эң белгилүүлөрдүн бири.', 'Купол собора Санта-Мария-дель-Фьоре, завершённый в 1436 году по проекту Брунеллески, до сих пор самый большой каменный купол из когда-либо построенных.', 'Брунеллескинин долбоору боюнча 1436-жылы бүткөн Санта-Мария-дель-Фьоре соборунун күмбөзү азыркыга чейин курулган эң чоң таш күмбөз бойдон калууда.', 'https://en.wikipedia.org/wiki/Florence_Cathedral', '2026-10-16'::DATE, 'pending', 'published'),
  ('genoa', 'IT', 'Генуя', 'Генуя', 'Genoa', 44.4072::DOUBLE PRECISION, 8.9339::DOUBLE PRECISION, '{"path":"geography/cities/it-genoa-bdd4cac33e3f.jpg","width":2000,"height":1333,"author":"Bart Ros","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/colorful-buildings-line-a-harbor-with-boats-at-dusk-4rrexf-JVWY","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Генуя, столица региона Лигурия, крупный морской порт на севере Италии. Старый город известен узкими улочками и дворцами Палаццо деи Ролли, которые в 2006 году внесены в список ЮНЕСКО.', 'Генуя Лигурия аймагынын борбору, Италиянын түндүгүндөгү ири деңиз порту. Эски шаар тар көчөлөрү жана 2006-жылы ЮНЕСКОнун тизмесине киргизилген Палаццо деи Ролли сарайлары менен белгилүү.', 'Христофор Колумб родился в Генуе около 1451 года.', 'Христофор Колумб Генуяда болжол менен 1451-жылы туулган.', 'https://en.wikipedia.org/wiki/Genoa', '2026-10-16'::DATE, 'pending', 'published'),
  ('macerata', 'IT', 'Мачерата', 'Мачерата', 'Macerata', 43.3003::DOUBLE PRECISION, 13.4533::DOUBLE PRECISION, '{"path":"geography/cities/it-macerata-5f1e8ceba44f.jpg","width":2000,"height":1500,"author":"Viaggiamocela","authorUrl":"https://commons.wikimedia.org/wiki/User:Viaggiamocela","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Macerata_-_Sferisterio_di_Macerata_-_2024-09-17_09-54-11_001.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Мачерата, город на холме в регионе Марке на востоке Италии, с историческим центром в кольце средневековых стен. Университет Мачераты основан в 1290 году и известен гуманитарными и общественными науками.', 'Мачерата Италиянын чыгышындагы Марке аймагындагы дөбөдө жайгашкан шаар, анын тарыхый борборун орто кылымдык дубалдар курчап турат. Мачерата университети 1290-жылы негизделген жана гуманитардык жана коомдук илимдер менен белгилүү.', 'Арену Сферистерио спроектировал в 1823 году архитектор Иренео Алеандри для игры в мяч, а сегодня на ней летом идут оперные спектакли.', 'Сферистерио аренасын 1823-жылы архитектор Иренео Алеандри топ оюну үчүн долбоорлогон, ал эми азыр анда жайында опера коюлат.', 'https://en.wikipedia.org/wiki/Sferisterio', '2026-10-16'::DATE, 'pending', 'published'),
  ('messina', 'IT', 'Мессина', 'Мессина', 'Messina', 38.1936::DOUBLE PRECISION, 15.5542::DOUBLE PRECISION, '{"path":"geography/cities/it-messina-8d58dbe171f8.jpg","width":2000,"height":1498,"author":"Giuseppe Famiani","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/harbor-with-boats-and-a-distant-monument-Ao2fwkqCVcM","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Мессина, крупный порт на северо-востоке Сицилии, стоит на Мессинском проливе, который отделяет остров от материковой Италии. В городе работает Университет Мессины.', 'Мессина Сицилиянын түндүк-чыгышындагы ири порт, аралды Италиянын материгинен бөлүп турган Мессина кысыгында жайгашкан. Шаарда Мессина университети иштейт.', 'На колокольне Мессинского собора установлены астрономические часы, которые считают самыми большими в мире; их заказали страсбургской фирме Ungerer в 1933 году.', 'Мессина соборунун коңгуроо мунарасында дүйнөдөгү эң чоң деп эсептелген астрономиялык саат бар; аны 1933-жылы Страсбургдагы Ungerer фирмасына буйрутма кылышкан.', 'https://en.wikipedia.org/wiki/Messina_Cathedral', '2026-10-16'::DATE, 'pending', 'published'),
  ('naples', 'IT', 'Неаполь', 'Неаполь', 'Naples', 40.8358::DOUBLE PRECISION, 14.2486::DOUBLE PRECISION, '{"path":"geography/cities/it-naples-a55fd8ba1b7e.jpg","width":2000,"height":1333,"author":"Aleksandar Rusev","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/view-of-naples-italy-with-mount-vesuvius-in-the-background--TzHiS_s7XY","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Неаполь, столица региона Кампания на юге Италии, раскинулся на берегу залива с видом на Везувий. Это один из крупнейших городов страны с древним историческим центром и Университетом имени Федерико II.', 'Неаполь Италиянын түштүгүндөгү Кампания аймагынын борбору, Везувийге караган булуңдун жээгинде жайгашкан. Бул өлкөнүн эң ири шаарларынын бири, анын байыркы тарыхый борбору жана Федерико II атындагы университети бар.', 'В 2017 году ЮНЕСКО внесло искусство неаполитанских пиццайоло в список нематериального культурного наследия человечества.', '2017-жылы ЮНЕСКО неаполдук пиццайололордун өнөрүн адамзаттын материалдык эмес маданий мурасынын тизмесине киргизген.', 'https://ich.unesco.org/en/RL/art-of-neapolitan-pizzaiuolo-00722', '2026-10-16'::DATE, 'pending', 'published'),
  ('padua', 'IT', 'Падуя', 'Падуя', 'Padua', 45.4078::DOUBLE PRECISION, 11.8733::DOUBLE PRECISION, '{"path":"geography/cities/it-padua-6907aec54cd7.jpg","width":2000,"height":1333,"author":"Stefano Segato","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/blue-and-brown-concrete-building-FjPCPmSvUU0","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Падуя, университетский город в регионе Венето недалеко от Венеции. Она известна базиликой Святого Антония и старейшим университетским ботаническим садом.', 'Падуя Венециянын жанындагы Венето аймагындагы университет шаары. Ал Ыйык Антоний базиликасы жана эң эски университеттик ботаникалык багы менен белгилүү.', 'Ботанический сад Падуи основан в 1545 году и считается старейшим в мире университетским ботаническим садом, который остался на прежнем месте.', 'Падуянын ботаникалык багы 1545-жылы негизделген жана өз ордунда калган дүйнөдөгү эң эски университеттик ботаникалык бак деп эсептелет.', 'https://en.wikipedia.org/wiki/Orto_botanico_di_Padova', '2026-10-16'::DATE, 'pending', 'published'),
  ('palermo', 'IT', 'Палермо', 'Палермо', 'Palermo', 38.1157::DOUBLE PRECISION, 13.3613::DOUBLE PRECISION, '{"path":"geography/cities/it-palermo-244fb17151aa.jpg","width":2000,"height":1273,"author":"VINCENZO INZONE","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-large-building-with-a-clock-tower-on-top-of-it-6ZY2VD0ygH8","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Палермо, столица Сицилии и крупнейший город острова. Облик города сложился под арабским, византийским и нормандским влиянием, а в городе работает Университет Палермо.', 'Палермо Сицилиянын борбору жана аралдагы эң ири шаар. Шаардын келбети араб, Византия жана норман таасиринде калыптанган, ал эми шаарда Палермо университети иштейт.', 'Арабо-нормандский Палермо, ансамбль дворцов и соборов в смешанном стиле, в 2015 году внесён в список Всемирного наследия ЮНЕСКО.', 'Аралаш стилдеги сарайлар жана соборлор ансамбли болгон араб-норман Палермосу 2015-жылы ЮНЕСКОнун Бүткүл дүйнөлүк мурас тизмесине киргизилген.', 'https://en.wikipedia.org/wiki/Arab-Norman_Palermo_and_the_Cathedral_Churches_of_Cefal%C3%B9_and_Monreale', '2026-10-16'::DATE, 'pending', 'published'),
  ('parma', 'IT', 'Парма', 'Парма', 'Parma', 44.8015::DOUBLE PRECISION, 10.328::DOUBLE PRECISION, '{"path":"geography/cities/it-parma-38d8e3971fb5.jpg","width":2000,"height":1333,"author":"Hardial Aujla","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/yellow-building-with-a-clock-tower-and-a-statue-WMRUihnxOxM","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Парма, город в регионе Эмилия-Романья на севере Италии, родина пармезана (Parmigiano Reggiano) и пармской ветчины. В городе работает один из старейших университетов Италии.', 'Парма Италиянын түндүгүндөгү Эмилия-Романья аймагындагы шаар, пармезан (Parmigiano Reggiano) сырынын жана парма ветчинасынын мекени. Шаарда Италиядагы эң эски университеттердин бири иштейт.', 'С 2015 года Парма входит в сеть креативных городов ЮНЕСКО как город гастрономии.', '2015-жылдан бери Парма ЮНЕСКОнун чыгармачыл шаарлар тармагына гастрономия шаары катары кирет.', 'https://www.unesco.org/en/creative-cities/parma', '2026-10-16'::DATE, 'pending', 'published'),
  ('pavia', 'IT', 'Павия', 'Павия', 'Pavia', 45.1853::DOUBLE PRECISION, 9.155::DOUBLE PRECISION, '{"path":"geography/cities/it-pavia-0f74d980cbe6.jpg","width":2000,"height":1500,"author":"emanuele piantadosi","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/an-aerial-view-of-a-city-with-a-church-tower-W52Ue0xXgsE","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Павия, университетский город в Ломбардии на реке Тичино, примерно в 35 км к югу от Милана. Его узнают по Крытому мосту и куполу собора.', 'Павия Ломбардиядагы Тичино дарыясынын боюндагы, Миландан болжол менен 35 км түштүктө жайгашкан университет шаары. Аны Жабык көпүрөсүнөн жана соборунун күмбөзүнөн таанышат.', 'Алессандро Вольта с 1779 года почти 40 лет руководил кафедрой экспериментальной физики в Павии; в 1799 году он создал вольтов столб, первую электрическую батарею.', 'Алессандро Вольта 1779-жылдан тартып дээрлик 40 жыл Павияда эксперименталдык физика кафедрасын жетектеген; 1799-жылы ал вольта мамычасын, биринчи электр батареясын ойлоп тапкан.', 'https://en.wikipedia.org/wiki/Alessandro_Volta', '2026-10-16'::DATE, 'pending', 'published'),
  ('perugia', 'IT', 'Перуджа', 'Перуджа', 'Perugia', 43.1119::DOUBLE PRECISION, 12.3885::DOUBLE PRECISION, '{"path":"geography/cities/it-perugia-1c38b4ed385d.jpg","width":2000,"height":1333,"author":"Annamaria Kupo","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-view-of-a-town-with-a-clock-tower-trOmO_1Mlt8","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Перуджа, столица региона Умбрия в центре Италии, город на холме с этрусской историей. Здесь работают Университет Перуджи, основанный в 1308 году, и Университет для иностранцев.', 'Перуджа Италиянын борборундагы Умбрия аймагынын борбору, этруск тарыхы бар дөбөдөгү шаар. Бул жерде 1308-жылы негизделген Перуджа университети жана Чет элдиктер үчүн университет иштейт.', 'С 1973 года в Перудже каждое лето проходит джазовый фестиваль Umbria Jazz.', '1973-жылдан бери Перуджада жыл сайын жайында Umbria Jazz джаз фестивалы өтөт.', 'https://en.wikipedia.org/wiki/Perugia', '2026-10-16'::DATE, 'pending', 'published'),
  ('pisa', 'IT', 'Пиза', 'Пиза', 'Pisa', 43.7167::DOUBLE PRECISION, 10.4::DOUBLE PRECISION, '{"path":"geography/cities/it-pisa-180e126fed31.jpg","width":2000,"height":1500,"author":"D Grom","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/the-leaning-tower-of-the-leaning-tower-of-pisa-5tLijx3JgMk","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Пиза, город в Тоскане на реке Арно, известна площадью Чудес с собором, баптистерием и Пизанской башней. В городе работает Университет Пизы.', 'Пиза Тосканадагы Арно дарыясынын боюндагы шаар, собору, баптистерийи жана Пиза мунарасы бар Керемет аянты менен белгилүү. Шаарда Пиза университети иштейт.', 'Пизанскую башню начали строить в 1173 году, и она стала крениться ещё во время стройки из-за мягкого грунта; после укрепления в 2001 году наклон составляет 3,97 градуса.', 'Пиза мунарасынын курулушу 1173-жылы башталган жана жумшак топурактан улам ал курулуп жатканда эле кыйшая баштаган; 2001-жылы бекемдегенден кийин анын кыйшаюусу 3,97 градус.', 'https://en.wikipedia.org/wiki/Leaning_Tower_of_Pisa', '2026-10-16'::DATE, 'pending', 'published'),
  ('rende', 'IT', 'Ренде', 'Ренде', 'Rende', 39.3333::DOUBLE PRECISION, 16.1833::DOUBLE PRECISION, '{"path":"geography/cities/it-rende-1a0d16991819.jpg","width":2000,"height":1500,"author":"Fernando Santopaolo at Italian Wikipedia","authorUrl":"https://en.wikipedia.org/wiki/it:User:Fernando%20Santopaolo","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Arcavacata,_Rende,_paesaggio.jpg","license":"Public domain","licenseUrl":"https://commons.wikimedia.org/wiki/File:Arcavacata,_Rende,_paesaggio.jpg"}'::JSONB, 'Ренде, город в регионе Калабрия рядом с Козенцей. В его районе Аркавакката находится кампус Университета Калабрии.', 'Ренде Калабрия аймагындагы Козенцага жакын шаар. Анын Аркавакката районунда Калабрия университетинин кампусу жайгашкан.', 'Университет Калабрии основан в 1972 году; его кампус в Аркавакката-ди-Ренде занимает около 200 гектаров на холмах.', 'Калабрия университети 1972-жылы негизделген; анын Аркавакката-ди-Рендедеги кампусу дөбөлөрдө болжол менен 200 гектар жерди ээлейт.', 'https://en.wikipedia.org/wiki/University_of_Calabria', '2026-10-16'::DATE, 'pending', 'published'),
  ('siena', 'IT', 'Сиена', 'Сиена', 'Siena', 43.3183::DOUBLE PRECISION, 11.3314::DOUBLE PRECISION, '{"path":"geography/cities/it-siena-bb288f0581b4.jpg","width":2000,"height":1428,"author":"Wolfgang Weiser","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-tall-clock-tower-towering-over-a-city-XpqlTGB4iPc","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Сиена, средневековый город в Тоскане; в его центре лежит площадь Кампо с башней Манджа. В городе работает Университет Сиены.', 'Сиена Тосканадагы орто кылымдык шаар; анын борборунда Манджа мунарасы бар Кампо аянты жайгашкан. Шаарда Сиена университети иштейт.', 'Дважды в год, 2 июля и 16 августа, на площади Кампо проходят скачки Палио: в них участвуют десять из семнадцати городских районов, контрад.', 'Жылына эки жолу, 2-июлда жана 16-августта, Кампо аянтында Палио ат чабышы өтөт: ага шаардын он жети районунун, контрадасынын онусу катышат.', 'https://en.wikipedia.org/wiki/Palio_di_Siena', '2026-10-16'::DATE, 'pending', 'published'),
  ('trento', 'IT', 'Тренто', 'Тренто', 'Trento', 46.0667::DOUBLE PRECISION, 11.1167::DOUBLE PRECISION, '{"path":"geography/cities/it-trento-160ecf297497.jpg","width":2000,"height":1385,"author":"Joshua Kettle","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-fountain-in-front-of-a-building-with-a-clock-tower-in-the-background-7Sh84H2sJhE","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Тренто, город на севере Италии в автономной провинции Трентино, окружён горами. Это небольшой университетский город с историческим центром вокруг площади Дуомо и фонтана Нептуна.', 'Тренто Италиянын түндүгүндөгү Трентино автономиялуу провинциясындагы, тоолор курчаган шаар. Бул Дуомо аянтынын жана Нептун фонтанынын айланасындагы тарыхый борбору бар чакан университет шаары.', 'С 1545 по 1563 год в Тренто проходил Тридентский собор, девятнадцатый вселенский собор католической церкви.', '1545-жылдан 1563-жылга чейин Тренто шаарында католик чиркөөсүнүн он тогузунчу бүткүл дүйнөлүк жыйыны, Тридент жыйыны өткөн.', 'https://en.wikipedia.org/wiki/Council_of_Trent', '2026-10-16'::DATE, 'pending', 'published'),
  ('varese', 'IT', 'Варезе', 'Варезе', 'Varese', 45.8167::DOUBLE PRECISION, 8.8333::DOUBLE PRECISION, '{"path":"geography/cities/it-varese-736d1283b026.jpg","width":2000,"height":1333,"author":"Parsifall","authorUrl":"https://commons.wikimedia.org/wiki/User:Parsifall","sourceName":"Wikimedia Commons","sourceUrl":"https://commons.wikimedia.org/wiki/File:Varese,_Palazzo_Estense_01.jpg","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0"}'::JSONB, 'Варезе, город в Ломбардии недалеко от границы со Швейцарией, у озера Варезе в предгорьях Альп. Университет Инсубрии работает в двух городах, Варезе и Комо.', 'Варезе Швейцария чек арасына жакын, Альп тоолорунун этегиндеги Варезе көлүнүн жанындагы Ломбардиядагы шаар. Инсубрия университети эки шаарда, Варезеде жана Комодо иштейт.', 'Дорогу к святилищу Сакро-Монте-ди-Варезе с 14 часовнями начали строить в 1604 году; с 2003 года она в списке ЮНЕСКО вместе с другими сакри-монти.', '14 часовнясы бар Сакро-Монте-ди-Варезе ыйык жайына баруучу жолдун курулушу 1604-жылы башталган; 2003-жылдан бери ал башка сакри-монтилер менен бирге ЮНЕСКОнун тизмесинде.', 'https://en.wikipedia.org/wiki/Sacro_Monte_di_Varese', '2026-10-16'::DATE, 'pending', 'published'),
  ('venice', 'IT', 'Венеция', 'Венеция', 'Venice', 45.4397::DOUBLE PRECISION, 12.3319::DOUBLE PRECISION, '{"path":"geography/cities/it-venice-5a6883943663.jpg","width":2000,"height":1333,"author":"Wojciech Wyszkowski","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/historic-venetian-buildings-line-the-grand-canal-at-sunset-4vtboz-1hEc","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Венеция, город в регионе Венето на северо-востоке Италии, стоит в лагуне Адриатического моря. Вместо улиц здесь каналы, а среди вузов города Университет Ка'' Фоскари.', 'Венеция Италиянын түндүк-чыгышындагы Венето аймагындагы шаар, Адриатика деңизинин лагунасында жайгашкан. Көчөлөрдүн ордуна бул жерде каналдар бар, ал эми шаардын окуу жайларынын арасында Ка'' Фоскари университети бар.', 'Венеция стоит более чем на сотне небольших островов, которые соединяют более 400 мостов.', 'Венеция жүздөн ашык кичинекей аралда жайгашкан, аларды 400дөн ашык көпүрө байланыштырат.', 'https://en.wikipedia.org/wiki/Venice', '2026-10-16'::DATE, 'pending', 'published'),
  ('verona', 'IT', 'Верона', 'Верона', 'Verona', 45.4386::DOUBLE PRECISION, 10.9928::DOUBLE PRECISION, '{"path":"geography/cities/it-verona-1f55986a8622.jpg","width":2000,"height":1500,"author":"Lens by Benji","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/cityscape-with-river-and-bridge-at-sunset-KTsFgTGqekg","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Верона, город в регионе Венето на реке Адидже, известна римской Ареной и тем, что здесь происходит действие «Ромео и Джульетты». В городе работает Университет Вероны.', 'Верона Венето аймагындагы Адидже дарыясынын боюндагы шаар, рим Аренасы жана «Ромео жана Джульетта» чыгармасынын окуялары ушул жерде өткөнү менен белгилүү. Шаарда Верона университети иштейт.', 'Римская Арена Вероны построена в I веке н. э., а с 1913 года на ней проходит летний оперный фестиваль, крупнейший в мире под открытым небом.', 'Верона Аренасы б. з. I кылымында курулган, ал эми 1913-жылдан бери анда дүйнөдөгү ачык асман алдындагы эң ири жайкы опера фестивалы өтөт.', 'https://en.wikipedia.org/wiki/Verona_Arena', '2026-10-16'::DATE, 'pending', 'published'),
  ('prague', 'CZ', 'Прага', 'Прага', 'Prague', 50.0875::DOUBLE PRECISION, 14.4214::DOUBLE PRECISION, '{"path":"geography/cities/cz-prague-804b7a5e4464.jpg","width":2000,"height":1126,"author":"Joshua Kettle","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-bridge-with-statues-and-buildings-in-the-background-4AL1OnvWAng","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Прага, столица Чехии на реке Влтаве, известна историческим центром, мостами и готическими башнями. Здесь работают Карлов университет, Чешский технический университет и другие вузы.', 'Прага Чехиянын борбору, Влтава дарыясынын боюнда жайгашкан, тарыхый борбору, көпүрөлөрү жана готикалык мунаралары менен белгилүү. Бул жерде Карл университети, Чех техникалык университети жана башка окуу жайлар иштейт.', 'По данным Книги рекордов Гиннесса, Пражский Град крупнейший древний замок в мире: он занимает почти 70 тысяч квадратных метров.', 'Гиннестин рекорддор китебине ылайык, Прага сепили дүйнөдөгү эң чоң байыркы сепил: ал дээрлик 70 миң чарчы метр аянтты ээлейт.', 'https://en.wikipedia.org/wiki/Prague_Castle', '2026-10-16'::DATE, 'pending', 'published'),
  ('brno', 'CZ', 'Брно', 'Брно', 'Brno', 49.1953::DOUBLE PRECISION, 16.6083::DOUBLE PRECISION, '{"path":"geography/cities/cz-brno-55ddc2ec529d.jpg","width":2000,"height":1322,"author":"Leonhard Niederwimmer","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/a-city-with-many-buildings-8ekJQLfNQV8","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Брно, второй по величине город Чехии и центр Южноморавского края. В городе много вузов, среди них Масариков университет и Технический университет в Брно.', 'Брно Чехиядагы көлөмү боюнча экинчи шаар жана Түштүк Моравия аймагынын борбору. Шаарда көп окуу жайлар бар, алардын арасында Масарик университети жана Брно техникалык университети.', 'В 1850-х годах Грегор Мендель ставил опыты с горохом в аббатстве Святого Томаша в Брно, и с них началась генетика.', '1850-жылдары Грегор Мендель Брнодогу Ыйык Томаш аббаттыгында буурчак менен тажрыйбаларды жүргүзгөн жана генетика ушулардан башталган.', 'https://en.wikipedia.org/wiki/Brno', '2026-10-16'::DATE, 'pending', 'published'),
  ('liberec', 'CZ', 'Либерец', 'Либерец', 'Liberec', 50.7667::DOUBLE PRECISION, 15.05::DOUBLE PRECISION, '{"path":"geography/cities/cz-liberec-e41bbdd8c5d6.jpg","width":2000,"height":1333,"author":"Lukáš Vaňátko","authorUrl":null,"sourceName":"Unsplash","sourceUrl":"https://unsplash.com/photos/green-trees-and-mountains-during-sunrise-FRQ7qW7fRb0","license":"Unsplash License","licenseUrl":"https://unsplash.com/license"}'::JSONB, 'Либерец, город на севере Чехии примерно в 80 км к северо-востоку от Праги, у подножия Йизерских гор и горы Ештед. В городе работает Технический университет в Либереце.', 'Либерец Прагадан болжол менен 80 км түндүк-чыгышта, Йизер тоолорунун жана Ештед тоосунун этегинде жайгашкан Чехиянын түндүгүндөгү шаар. Шаарда Либерец техникалык университети иштейт.', 'Телебашня с отелем на вершине Ештеда высотой 94 метра открыта в 1973 году; её архитектор Карел Губачек в 1969 году получил премию Огюста Перре.', 'Ештед чокусундагы бийиктиги 94 метр болгон мейманканалуу телемунара 1973-жылы ачылган; анын архитектору Карел Губачек 1969-жылы Огюст Перре сыйлыгын алган.', 'https://en.wikipedia.org/wiki/Je%C5%A1t%C4%9Bd_Tower', '2026-10-16'::DATE, 'pending', 'published')
) AS v(city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo, summary_ru, summary_ky, fact_ru, fact_ky,
  fact_source_url, fact_verified_on, ky_review, status)
WHERE EXISTS (SELECT 1 FROM platform.catalog_institutions i WHERE i.organization_id = o.id AND i.country_code = v.country_code);
INSERT INTO platform.catalog_institution_cities (institution_id, organization_id, city_key, assigned_via)
SELECT i.id, i.organization_id, v.city_key, 'migration'
FROM (VALUES
  ('CN', 'Beijing Institute of Technology', 'zhuhai'),
  ('CN', 'Beijing Language and Culture University', 'beijing'),
  ('CN', 'Beijing Normal University', 'beijing'),
  ('CN', 'Chang’an University', 'xian'),
  ('CN', 'China Jiliang University', 'hangzhou'),
  ('CN', 'China University of Petroleum (East China)', 'qingdao'),
  ('CN', 'Communication University of Zhejiang', 'hangzhou'),
  ('CN', 'East China Normal University', 'shanghai'),
  ('CN', 'East China University of Science and Technology', 'shanghai'),
  ('CN', 'Fudan University', 'shanghai'),
  ('CN', 'Guangdong University of Foreign Studies', 'guangzhou'),
  ('CN', 'Guangdong University of Technology', 'guangzhou'),
  ('CN', 'Guangzhou Huashang Vocational College', 'guangzhou'),
  ('CN', 'Hangzhou City University', 'hangzhou'),
  ('CN', 'Hangzhou Normal University', 'hangzhou'),
  ('CN', 'Harbin Institute of Technology', 'harbin'),
  ('CN', 'Huazhong University of Science and Technology', 'wuhan'),
  ('CN', 'Hubei University of Arts and Science', 'xiangyang'),
  ('CN', 'Nanchang University', 'nanchang'),
  ('CN', 'Nanjing University', 'nanjing'),
  ('CN', 'Northwestern Polytechnical University', 'xian'),
  ('CN', 'Ocean University of China', 'qingdao'),
  ('CN', 'Peking University', 'beijing'),
  ('CN', 'Shanghai International Studies University', 'shanghai'),
  ('CN', 'Shanghai Jiao Tong University', 'shanghai'),
  ('CN', 'Shanghai Normal University', 'shanghai'),
  ('CN', 'Shanghai University', 'shanghai'),
  ('CN', 'Shenyang Aerospace University', 'shenyang'),
  ('CN', 'South China University of Technology', 'guangzhou'),
  ('CN', 'Southwest University', 'chongqing'),
  ('CN', 'Southwestern University of Finance and Economics', 'chengdu'),
  ('CN', 'Tongji University', 'shanghai'),
  ('CN', 'Tsinghua University', 'beijing'),
  ('CN', 'University of Electronic Science and Technology of China', 'chengdu'),
  ('CN', 'University of Nottingham Ningbo China', 'ningbo'),
  ('CN', 'University of Science and Technology of China', 'hefei'),
  ('CN', 'University of Shanghai for Science and Technology', 'shanghai'),
  ('CN', 'Wuhan University', 'wuhan'),
  ('CN', 'Xidian University', 'xian'),
  ('CN', 'Xi’an International Studies University', 'xian'),
  ('CN', 'Xi’an Jiaotong-Liverpool University', 'suzhou'),
  ('CN', 'Yibin University', 'yibin'),
  ('CN', 'Zhejiang Gongshang University', 'hangzhou'),
  ('CN', 'Zhejiang International Studies University', 'hangzhou'),
  ('CN', 'Zhejiang Sci-Tech University', 'hangzhou'),
  ('CN', 'Zhejiang University', 'hangzhou'),
  ('CN', 'Zhejiang University of Technology', 'hangzhou'),
  ('MY', 'Asia Pacific University of Technology & Innovation', 'kuala-lumpur'),
  ('MY', 'City University Malaysia', 'petaling-jaya'),
  ('MY', 'INTI International University', 'nilai'),
  ('MY', 'Management and Science University', 'shah-alam'),
  ('MY', 'Monash University Malaysia', 'bandar-sunway'),
  ('MY', 'Multimedia University', 'cyberjaya'),
  ('MY', 'Sunway University', 'bandar-sunway'),
  ('MY', 'Taylor’s University', 'subang-jaya'),
  ('MY', 'UCSI University', 'kuala-lumpur'),
  ('MY', 'Universiti Kuala Lumpur', 'kuala-lumpur'),
  ('MY', 'Universiti Putra Malaysia', 'serdang'),
  ('MY', 'Universiti Teknologi Malaysia', 'johor-bahru'),
  ('MY', 'Xiamen University Malaysia', 'sepang'),
  ('AE', 'GBS (Global Banking School) — Dubai Campus', 'dubai'),
  ('TR', 'Ankara University', 'ankara'),
  ('TR', 'Bahçeşehir University', 'istanbul'),
  ('TR', 'Bilkent University', 'ankara'),
  ('TR', 'Boğaziçi University', 'istanbul'),
  ('TR', 'Istanbul University', 'istanbul'),
  ('TR', 'Koç University', 'istanbul'),
  ('TR', 'Middle East Technical University (METU/ODTÜ)', 'ankara'),
  ('TR', 'Sabancı University', 'istanbul'),
  ('TR', 'Yeditepe University', 'istanbul'),
  ('TR', 'İstanbul Aydın University', 'istanbul'),
  ('TR', 'İstanbul Teknik Üniversitesi (İTÜ)', 'istanbul'),
  ('IT', 'Bocconi University', 'milan'),
  ('IT', 'Ca’ Foscari University of Venice', 'venice'),
  ('IT', 'IULM University', 'milan'),
  ('IT', 'Politecnico di Milano', 'milan'),
  ('IT', 'Politecnico di Torino', 'turin'),
  ('IT', 'Sapienza University of Rome', 'rome'),
  ('IT', 'Scuola Politecnica di Design (SPD)', 'milan'),
  ('IT', 'University of Bergamo', 'bergamo'),
  ('IT', 'University of Bologna', 'bologna'),
  ('IT', 'University of Brescia', 'brescia'),
  ('IT', 'University of Calabria', 'rende'),
  ('IT', 'University of Camerino', 'camerino'),
  ('IT', 'University of Cassino and Southern Lazio', 'cassino'),
  ('IT', 'University of Catania', 'catania'),
  ('IT', 'University of Florence', 'florence'),
  ('IT', 'University of Genoa', 'genoa'),
  ('IT', 'University of Insubria', 'varese'),
  ('IT', 'University of Macerata', 'macerata'),
  ('IT', 'University of Messina', 'messina'),
  ('IT', 'University of Milan (Statale)', 'milan'),
  ('IT', 'University of Milan-Bicocca', 'milan'),
  ('IT', 'University of Naples Federico II', 'naples'),
  ('IT', 'University of Padova', 'padua'),
  ('IT', 'University of Palermo', 'palermo'),
  ('IT', 'University of Parma', 'parma'),
  ('IT', 'University of Pavia', 'pavia'),
  ('IT', 'University of Perugia', 'perugia'),
  ('IT', 'University of Pisa', 'pisa'),
  ('IT', 'University of Rome Tor Vergata', 'rome'),
  ('IT', 'University of Siena', 'siena'),
  ('IT', 'University of Trento', 'trento'),
  ('IT', 'University of Turin', 'turin'),
  ('IT', 'University of Verona', 'verona'),
  ('IT', 'Università Cattolica del Sacro Cuore', 'milan'),
  ('CZ', 'Academy of Arts, Architecture and Design in Prague (UMPRUM)', 'prague'),
  ('CZ', 'Brno University of Technology', 'brno'),
  ('CZ', 'Charles University', 'prague'),
  ('CZ', 'Czech Technical University in Prague', 'prague'),
  ('CZ', 'Czech University of Life Sciences Prague', 'prague'),
  ('CZ', 'Masaryk University', 'brno'),
  ('CZ', 'Prague City University — Prague College', 'prague'),
  ('CZ', 'Prague University of Economics and Business (VŠE)', 'prague'),
  ('CZ', 'Technical University of Liberec', 'liberec'),
  ('CZ', 'University of Chemistry and Technology Prague', 'prague')
) AS v(country_code, institution_name, city_key)
JOIN platform.catalog_institutions i ON i.country_code = v.country_code AND i.institution_name = v.institution_name
JOIN platform.catalog_cities c ON c.organization_id = i.organization_id AND c.city_key = v.city_key
  AND c.country_code = v.country_code;
-- <<< END GENERATED GEOGRAPHY SEED

-- ---------------------------------------------------------------------------
-- 8. Проверка: страны, прежние RPC без изменений, права и search_path
-- ---------------------------------------------------------------------------
DO $a283_verify$
DECLARE routine RECORD; drifted TEXT;
BEGIN
  IF (SELECT array_agg(s.country_code ORDER BY s.sort_order) FROM platform.study_countries s)
      IS DISTINCT FROM platform_private.study_country_codes() THEN
    RAISE EXCEPTION 'a283_countries_drift';
  END IF;
  SELECT string_agg(o.signature, ', ') INTO drifted FROM a283_old_rpcs o
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(o.signature)
  WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) <> o.definition_md5 OR p.proacl::TEXT IS DISTINCT FROM o.acl;
  IF drifted IS NOT NULL OR (SELECT count(*) FROM a283_old_rpcs) <> 10 THEN
    RAISE EXCEPTION 'a283_old_rpc_changed: %', drifted;
  END IF;
  FOR routine IN
    SELECT p.oid::REGPROCEDURE AS signature, p.proconfig, p.prosecdef, n.nspname,
      p.proname IN ('staff_catalog_cost_import_v1', 'staff_catalog_fx_rate_set_v1') AS service_allowed,
      p.proname IN ('catalog_text_ok', 'catalog_photo_source_allowed', 'catalog_photo_valid', 'catalog_academic_year_ok',
        'catalog_currency_exponent', 'catalog_usd_approx', 'catalog_content_levels', 'catalog_content_intakes',
        'guard_catalog_city_identity') AS invoker_ok
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND p.proname IN ('student_university_index_v1', 'student_university_detail_v1',
        'staff_catalog_geography_v1', 'staff_catalog_city_upsert_v1', 'staff_catalog_city_publish_v1',
        'staff_catalog_institution_city_set_v1', 'staff_catalog_cost_upsert_v1', 'staff_catalog_cost_confirm_v1',
        'staff_catalog_cost_publish_v1', 'staff_catalog_cost_import_v1', 'staff_catalog_fx_rate_set_v1'))
      OR (n.nspname = 'platform_private' AND p.proname IN ('catalog_text_ok', 'catalog_photo_source_allowed',
        'catalog_photo_valid', 'catalog_academic_year_ok', 'catalog_currency_exponent', 'catalog_usd_approx',
        'guard_catalog_city_identity', 'guard_catalog_institution_city', 'catalog_student_latest',
        'catalog_content_levels', 'catalog_content_intakes', 'catalog_city_student_json', 'catalog_student_index',
        'catalog_student_costs', 'catalog_geo_actor', 'catalog_geo_replay', 'catalog_geo_record',
        'catalog_geo_institution', 'catalog_cost_input', 'catalog_cost_staff_json', 'catalog_city_staff_json'))
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR (NOT routine.prosecdef AND NOT routine.invoker_ok)
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', routine.signature, 'EXECUTE') IS DISTINCT FROM (routine.nspname = 'platform')
      OR has_function_privilege('service_role', routine.signature, 'EXECUTE') IS DISTINCT FROM routine.service_allowed
    THEN
      RAISE EXCEPTION 'a283_posture_drift: %', routine.signature;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
      AND p.proname IN ('catalog_text_ok', 'catalog_photo_source_allowed', 'catalog_photo_valid', 'catalog_academic_year_ok',
        'catalog_currency_exponent', 'catalog_usd_approx', 'guard_catalog_city_identity', 'guard_catalog_institution_city',
        'catalog_student_latest', 'catalog_content_levels', 'catalog_content_intakes', 'catalog_city_student_json',
        'catalog_student_index', 'catalog_student_costs', 'catalog_geo_actor', 'catalog_geo_replay', 'catalog_geo_record',
        'catalog_geo_institution', 'catalog_cost_input', 'catalog_cost_staff_json', 'catalog_city_staff_json')) <> 21
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
      AND p.proname IN ('student_university_index_v1', 'student_university_detail_v1', 'staff_catalog_geography_v1',
        'staff_catalog_city_upsert_v1', 'staff_catalog_city_publish_v1', 'staff_catalog_institution_city_set_v1',
        'staff_catalog_cost_upsert_v1', 'staff_catalog_cost_confirm_v1', 'staff_catalog_cost_publish_v1',
        'staff_catalog_cost_import_v1', 'staff_catalog_fx_rate_set_v1')) <> 11 THEN
    RAISE EXCEPTION 'a283_rpc_count';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_privileges t
    WHERE t.table_schema IN ('platform', 'platform_private')
      AND t.table_name IN ('study_countries', 'catalog_cities', 'catalog_institution_cities', 'catalog_costs',
        'catalog_fx_rates', 'catalog_geography_requests')
      AND t.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin')) THEN
    RAISE EXCEPTION 'a283_table_grant';
  END IF;
END
$a283_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
