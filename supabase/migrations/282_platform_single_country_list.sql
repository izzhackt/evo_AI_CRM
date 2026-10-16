-- 282: один список стран для всего продукта (решение владельца 16.10.2026,
-- docs/PLAN_CHANGES.md «Один список стран для всего продукта (282)»).
--
-- Страны продукта: CN, MY, AE, TR, IT, CZ в этом порядке. Источник для веба,
-- CRM и iPhone: src/lib/study-countries.json; здесь его коды и значения формы
-- сайта, тест platform_single_country_list.sql сверяет их с файлом.
--
--  a) platform_private.study_country_codes(): коды стран продукта.
--  b) Каталог студента (веб и iPhone читают одни RPC): student_university_catalog,
--     student_university_catalog_by_ids_v1, student_university_favorites_v1,
--     set_university_favorite_v1 (только добавление в избранное),
--     student_recent_universities_v1 и create_portal_consultation_request_v1
--     (новая заявка на консультацию по вузу) видят только вузы этих стран.
--     platform_private.university_catalog_page получает необязательный список
--     стран; staff_university_catalog его не передаёт и видит весь каталог.
--     Новая student_hidden_university_favorites_v1 отдаёт число избранных
--     вузов вне списка (строка «Больше нет в каталоге: N», план §6.3).
--  c) Анкета: CHECK student_applications (student_application_questionnaire_valid)
--     РАСШИРЯЕТСЯ: прежние 15 кодов остаются валидными, добавлен «undecided»
--     («Пока не решил»), только один. submit_student_application_v1 не
--     меняется и принимает всё, что принимает CHECK: прежние коды шлют старые
--     сборки iPhone, открытая до выката вкладка и сохранённый черновик
--     (план §4.1, §6.4, приёмка §6.6 п. 2). Список из шести навязывает
--     интерфейс (веб, iPhone 1.1), а не отказ старым клиентам.
--  d) Приём заявок сайта (receive_website_lead): список стран разделён на
--     текущие значения формы (website_enquiry_country_values) и прежние
--     (website_enquiry_legacy_country_values). Принимаются оба набора, как и
--     до 282, направление лида то же. Приёмник сознательно не сужается
--     (план §6.4): кэшированная старая страница или откат сайта не должны
--     терять заявку.
--
-- Тела функций меняются заменой проверенных фрагментов (шаблон 281): каждый
-- фрагмент обязан встретиться ровно столько раз, сколько ожидается, иначе
-- миграция падает. CREATE OR REPLACE сохраняет владельца и права; новой
-- сигнатуре university_catalog_page права выставляются заново. Подготовка по
-- программе (214), заявки в вуз (118/190) уже на шести странах и не меняются.
BEGIN;

CREATE FUNCTION pg_temp.a282_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a282_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) Страны продукта и значения формы сайта
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.study_country_codes()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY['CN', 'MY', 'AE', 'TR', 'IT', 'CZ']::TEXT[]
$$;

-- Что шлёт форма сайта с новым списком: шесть стран и «Undecided».
CREATE FUNCTION platform_private.website_enquiry_country_values()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY['China', 'Malaysia', 'United Arab Emirates', 'Turkey', 'Italy', 'Czechia', 'Undecided']::TEXT[]
$$;

-- Прежние значения формы сайта (240), которых нет в списке продукта. Приёмник
-- продолжает их принимать (план §6.4): старая страница не теряет заявку.
CREATE FUNCTION platform_private.website_enquiry_legacy_country_values()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY['Europe', 'Germany', 'United Kingdom', 'Netherlands', 'France', 'Poland', 'Austria', 'Cyprus']::TEXT[]
$$;

REVOKE ALL ON FUNCTION
  platform_private.study_country_codes(),
  platform_private.website_enquiry_country_values(),
  platform_private.website_enquiry_legacy_country_values()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- b) Каталог студента
-- ---------------------------------------------------------------------------
-- Необязательный список стран у общего помощника страницы (148, 151): NULL
-- означает весь каталог (сотрудники), иначе только эти страны (студент).
DO $a282_catalog_page$
DECLARE
  definition TEXT;
  old_header CONSTANT TEXT := $old$p_institution_id uuid, p_offset integer)
 RETURNS jsonb$old$;
  new_header CONSTANT TEXT := $new$p_institution_id uuid, p_offset integer, p_countries text[] DEFAULT NULL::text[])
 RETURNS jsonb$new$;
  old_filter CONSTANT TEXT := $old$  AND (p_country IS NULL OR content->>'country'=p_country)$old$;
  new_filter CONSTANT TEXT := $new$  AND (p_country IS NULL OR content->>'country'=p_country)
  AND (p_countries IS NULL OR content->>'country'=ANY(p_countries))$new$;
BEGIN
  definition := pg_get_functiondef('platform_private.university_catalog_page(uuid,text,text,text,uuid,integer)'::regprocedure);
  IF (length(definition) - length(replace(definition, old_header, ''))) / length(old_header) <> 1
    OR (length(definition) - length(replace(definition, old_filter, ''))) / length(old_filter) <> 1 THEN
    RAISE EXCEPTION 'a282_replace_drift: platform_private.university_catalog_page';
  END IF;
  -- Другая сигнатура: CREATE OR REPLACE создаёт новую функцию, прежнюю убираем.
  EXECUTE replace(replace(definition, old_header, new_header), old_filter, new_filter);
  DROP FUNCTION platform_private.university_catalog_page(UUID, TEXT, TEXT, TEXT, UUID, INTEGER);
END
$a282_catalog_page$;
REVOKE ALL ON FUNCTION platform_private.university_catalog_page(UUID, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT[])
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

SELECT pg_temp.a282_replace('platform.student_university_catalog(text,text,text,uuid,integer)',
  $old$ RETURN platform_private.university_catalog_page(a.organization_id,p_query,p_country,p_level,p_institution_id,p_offset);$old$,
  $new$ -- 282: только страны продукта.
 RETURN platform_private.university_catalog_page(a.organization_id,p_query,p_country,p_level,p_institution_id,p_offset,platform_private.study_country_codes());$new$, 1);

-- Вуз другой страны неотличим от неопубликованного: отказ всего вызова, как
-- для любого недоступного id (195). Список избранного таких id не отдаёт.
SELECT pg_temp.a282_replace('platform.student_university_catalog_by_ids_v1(uuid[])',
  $old$      WHERE i.organization_id = a.organization_id AND i.id = requested.id
        AND EXISTS ($old$,
  $new$      WHERE i.organization_id = a.organization_id AND i.id = requested.id
        AND i.country_code = ANY (platform_private.study_country_codes())
        AND EXISTS ($new$, 1);

SELECT pg_temp.a282_replace('platform.student_university_favorites_v1()',
  $old$    FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
  ), '[]'::JSONB);$old$,
  $new$    FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
      -- 282: избранные вузы стран вне списка продукта не показываются.
      AND EXISTS (SELECT 1 FROM platform.catalog_institutions i
        WHERE i.organization_id = f.organization_id AND i.id = f.institution_id
          AND i.country_code = ANY (platform_private.study_country_codes()))
  ), '[]'::JSONB);$new$, 1);

-- Добавить в избранное можно только вуз страны продукта; убрать можно любой
-- опубликованный, как прежде. Счётчик считает то же, что отдаёт список.
SELECT pg_temp.a282_replace('platform.set_university_favorite_v1(uuid,boolean)',
  $old$    WHERE i.organization_id = a.organization_id AND i.id = p_institution_id
      AND EXISTS ($old$,
  $new$    WHERE i.organization_id = a.organization_id AND i.id = p_institution_id
      AND (NOT p_favored OR i.country_code = ANY (platform_private.study_country_codes()))
      AND EXISTS ($new$, 1);
SELECT pg_temp.a282_replace('platform.set_university_favorite_v1(uuid,boolean)',
  $old$  SELECT count(*) INTO total FROM platform_private.university_favorites f
  WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id;$old$,
  $new$  SELECT count(*) INTO total FROM platform_private.university_favorites f
  WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
    AND EXISTS (SELECT 1 FROM platform.catalog_institutions i
      WHERE i.organization_id = f.organization_id AND i.id = f.institution_id
        AND i.country_code = ANY (platform_private.study_country_codes()));$new$, 1);

SELECT pg_temp.a282_replace('platform.student_recent_universities_v1()',
  $old$    SELECT * FROM latest
    WHERE first_published_at >= statement_timestamp() - interval '30 days'$old$,
  $new$    SELECT * FROM latest
    WHERE content->>'country' = ANY (platform_private.study_country_codes())
      AND first_published_at >= statement_timestamp() - interval '30 days'$new$, 1);

-- Новая заявка на консультацию по вузу (197): вуз другой страны неотличим от
-- неопубликованного, как в by_ids. Заявка без вуза и прежние заявки не
-- меняются.
SELECT pg_temp.a282_replace('platform.create_portal_consultation_request_v1(uuid,uuid,text)',
  $old$    WHERE i.organization_id = a.organization_id AND i.id = p_institution_id
      AND EXISTS ($old$,
  $new$    WHERE i.organization_id = a.organization_id AND i.id = p_institution_id
      -- 282: только вуз страны продукта.
      AND i.country_code = ANY (platform_private.study_country_codes())
      AND EXISTS ($new$, 1);

-- Число избранных вузов, которых студент больше не видит (страна вне списка):
-- «Больше нет в каталоге: N» в «Избранном» (план §6.3). Только свои записи
-- актора, тот же вход, что у student_university_favorites_v1 (195); сами
-- вузы не называются.
CREATE FUNCTION platform.student_hidden_university_favorites_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Favourites unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('hiddenCount', (
    SELECT count(*) FROM platform_private.university_favorites f
    JOIN platform.catalog_institutions i ON i.organization_id = f.organization_id AND i.id = f.institution_id
    WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
      AND NOT (i.country_code = ANY (platform_private.study_country_codes()))));
END $$;
REVOKE ALL ON FUNCTION platform.student_hidden_university_favorites_v1()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_hidden_university_favorites_v1() TO authenticated;
COMMENT ON FUNCTION platform.student_hidden_university_favorites_v1() IS
  'Число своих избранных вузов вне списка стран продукта (282): строка «Больше нет в каталоге: N».';

-- ---------------------------------------------------------------------------
-- c) Анкета
-- ---------------------------------------------------------------------------
SELECT pg_temp.a282_replace('platform_private.student_application_questionnaire_valid(jsonb)',
  $old$  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('CN','MY','DE','FR','ES','IT','NL','PL','HU','AT','CZ','GB','CY','TR','AE') THEN RETURN FALSE; END IF;$old$,
  $new$  -- 282: прежние 15 кодов остаются валидными (старые клиенты, сохранённые анкеты); «undecided» только один.
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('CN','MY','DE','FR','ES','IT','NL','PL','HU','AT','CZ','GB','CY','TR','AE','undecided')
  OR (item#>>'{}'='undecided' AND jsonb_array_length(q->'destinationCountries')<>1) THEN RETURN FALSE; END IF;$new$, 1);

-- ---------------------------------------------------------------------------
-- d) Приём заявок сайта
-- ---------------------------------------------------------------------------
SELECT pg_temp.a282_replace('platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)',
  $old$    OR p_country IS NULL OR p_country NOT IN ('China','Malaysia','Europe','Germany','United Kingdom',
      'Italy','Netherlands','France','Poland','Czechia','Austria','Cyprus',
      'United Arab Emirates','Turkey','Undecided')$old$,
  $new$    -- 282: текущие значения формы и прежние; приёмник не сужается (план §6.4).
    OR p_country IS NULL OR NOT (p_country=ANY(platform_private.website_enquiry_country_values())
      OR p_country=ANY(platform_private.website_enquiry_legacy_country_values()))$new$, 1);

-- ---------------------------------------------------------------------------
-- Проверка: новые тела на месте, submit_student_application_v1 не тронута,
-- одна сигнатура у каждой функции, права и search_path прежние.
-- ---------------------------------------------------------------------------
DO $a282_verify$
DECLARE routine RECORD;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'platform_private'::REGNAMESPACE
      AND proname = 'university_catalog_page') <> 1
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])'::regprocedure)
      NOT LIKE '%content->>''country''=ANY(p_countries)%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.student_university_catalog(text,text,text,uuid,integer)'::regprocedure)
      NOT LIKE '%p_offset,platform_private.study_country_codes())%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_university_catalog(uuid,text,text,text,uuid,integer)'::regprocedure)
      LIKE '%study_country_codes%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.student_university_catalog_by_ids_v1(uuid[])'::regprocedure)
      NOT LIKE '%study_country_codes%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.student_university_favorites_v1()'::regprocedure)
      NOT LIKE '%study_country_codes%'
    OR (SELECT (length(prosrc) - length(replace(prosrc, 'study_country_codes', ''))) / length('study_country_codes')
      FROM pg_catalog.pg_proc WHERE oid = 'platform.set_university_favorite_v1(uuid,boolean)'::regprocedure) <> 2
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.student_recent_universities_v1()'::regprocedure)
      NOT LIKE '%study_country_codes%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.student_application_questionnaire_valid(jsonb)'::regprocedure)
      NOT LIKE '%''AE'',''undecided'')%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.submit_student_application_v1(uuid,jsonb,bigint)'::regprocedure)
      LIKE '%study_country_codes%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.create_portal_consultation_request_v1(uuid,uuid,text)'::regprocedure)
      NOT LIKE '%study_country_codes%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure)
      NOT LIKE '%website_enquiry_legacy_country_values()%'
    OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'platform'::REGNAMESPACE
      AND proname IN ('student_university_catalog', 'student_university_catalog_by_ids_v1', 'student_university_favorites_v1',
        'set_university_favorite_v1', 'student_recent_universities_v1', 'submit_student_application_v1', 'receive_website_lead',
        'create_portal_consultation_request_v1', 'student_hidden_university_favorites_v1')) <> 9
  THEN
    RAISE EXCEPTION 'a282_replace_not_applied';
  END IF;
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.proconfig,
      p.oid::REGPROCEDURE::TEXT LIKE 'platform_private.%' AS private_helper,
      p.oid::REGPROCEDURE::TEXT LIKE 'platform.receive_website_lead%' AS service_only
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'platform_private.study_country_codes()'::regprocedure,
      'platform_private.website_enquiry_country_values()'::regprocedure,
      'platform_private.website_enquiry_legacy_country_values()'::regprocedure,
      'platform_private.university_catalog_page(uuid,text,text,text,uuid,integer,text[])'::regprocedure,
      'platform_private.student_application_questionnaire_valid(jsonb)'::regprocedure,
      'platform.student_university_catalog(text,text,text,uuid,integer)'::regprocedure,
      'platform.student_university_catalog_by_ids_v1(uuid[])'::regprocedure,
      'platform.student_university_favorites_v1()'::regprocedure,
      'platform.set_university_favorite_v1(uuid,boolean)'::regprocedure,
      'platform.student_recent_universities_v1()'::regprocedure,
      'platform.create_portal_consultation_request_v1(uuid,uuid,text)'::regprocedure,
      'platform.student_hidden_university_favorites_v1()'::regprocedure,
      'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', routine.signature, 'EXECUTE')
        IS DISTINCT FROM (NOT routine.private_helper AND NOT routine.service_only)
      OR has_function_privilege('service_role', routine.signature, 'EXECUTE') IS DISTINCT FROM routine.service_only
    THEN
      RAISE EXCEPTION 'a282_posture_drift: %', routine.signature;
    END IF;
  END LOOP;
END
$a282_verify$;

COMMENT ON FUNCTION platform_private.study_country_codes() IS
  'Страны продукта (282, решение владельца 16.10.2026) в порядке продукта; тот же список, что src/lib/study-countries.json.';
COMMENT ON FUNCTION platform_private.website_enquiry_legacy_country_values() IS
  'Прежние значения формы сайта (240) вне списка продукта. Приёмник продолжает их принимать (план §6.4).';

NOTIFY pgrst, 'reload schema';
COMMIT;
