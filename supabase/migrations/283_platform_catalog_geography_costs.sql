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
-- файла; автор, источник и лицензия обязательны.
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
    AND jsonb_typeof(p_photo -> 'license') = 'string' AND platform_private.catalog_text_ok(p_photo ->> 'license', 120)
    AND (p_photo -> 'licenseUrl' = 'null'::JSONB OR platform_private.university_public_url(p_photo ->> 'licenseUrl'))
    AND lower(p_photo::TEXT) !~ 'eduprchina';
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END
$$;

-- Учебный год вида 2026/27.
CREATE FUNCTION platform_private.catalog_academic_year_ok(p_value TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT p_value IS NOT NULL AND p_value ~ '^20[0-9]{2}/[0-9]{2}$'
    AND right(p_value, 2)::INTEGER = (left(p_value, 4)::INTEGER + 1) % 100
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
  academic_year TEXT NOT NULL CHECK (platform_private.catalog_academic_year_ok(academic_year)),
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
    OR NOT platform_private.catalog_academic_year_ok(c.academic_year)
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
-- Входы (sha256): countries.json нет, cities.json нет,
--   institution-cities.json нет.
-- Страны: 0 (с фото 0); города: 0 (опубликовано 0); связи вуз → город: 0.
-- Города создаются для каждой организации, где есть вуз этой страны; вуз связывается по
-- (country_code, точное institution_name), отсутствующий вуз пропускается.
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
