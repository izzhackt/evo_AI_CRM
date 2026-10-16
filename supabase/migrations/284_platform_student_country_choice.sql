-- 284: выбор страны студента для «Пути поступления» на «Главной» (S4, план
-- docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md §8.3; docs/PLAN_CHANGES.md
-- 2026-10-16 «Путь поступления на «Главной» (284)»). План относил выбор к
-- 282, но 282 его не включила; 283 занята университетами (S3), поэтому выбор
-- страны живёт здесь. Контракт для веба и iPhone:
-- docs/portal/country-timeline-contract.md.
--
--  a) platform_private.study_country_from_text(text): код одной из шести
--     стран продукта по коду, английскому, русскому или кыргызскому
--     названию; иначе NULL. target_country дела это свободный текст.
--  b) platform_private.student_country_choices (одна строка на участника) и
--     platform_private.student_country_choice_requests (квитанции по
--     request_id). RLS включена и обязательна, табличных грантов нет.
--  c) platform.student_country_choice_v1(): сохранённый выбор, иначе вывод
--     по умолчанию с источником: страна анкеты, если в ней ровно одна из
--     шести; иначе страна дела (target_country распознаётся как одна из
--     шести); иначе «не выбрано».
--  d) platform.set_student_country_choice_v1(p_country, p_request_id):
--     шесть кодов или UNDECIDED; повтор того же request_id возвращает
--     исходную квитанцию, тот же request_id с другой страной отклоняется.
--  e) Удаление аккаунта (280): обе таблицы входят в «свои» таблицы
--     account_deletion_closure. Иначе сохранённый выбор делал бы простой
--     аккаунт ручным (other_records), а строки оставались бы после удаления.
--
-- Только студент о себе (student + portal.read.self, guard 148/195/196);
-- сотрудник, заявитель без участия и anon получают 42501. Выбор сотрудникам
-- не виден и в audit_events не пишется (данные студента, план §4.2).
-- Подписи существующих RPC не меняются.
BEGIN;

CREATE FUNCTION pg_temp.a284_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a284_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) Страна продукта по свободному тексту
-- ---------------------------------------------------------------------------
-- Названия из src/lib/study-countries.json (RU, KY, значение формы сайта),
-- прежние значения анкеты 180 («Czech Republic») и частые написания. Тест
-- tests/portal-country-timeline.test.mjs сверяет список с JSON.
CREATE FUNCTION platform_private.study_country_from_text(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN upper(btrim(p_value)) = ANY (platform_private.study_country_codes()) THEN upper(btrim(p_value))
    ELSE CASE replace(lower(btrim(p_value)), 'ё', 'е')
      WHEN 'china' THEN 'CN' WHEN 'китай' THEN 'CN' WHEN 'кытай' THEN 'CN' WHEN 'кнр' THEN 'CN'
      WHEN 'malaysia' THEN 'MY' WHEN 'малайзия' THEN 'MY'
      WHEN 'united arab emirates' THEN 'AE' WHEN 'uae' THEN 'AE' WHEN 'оаэ' THEN 'AE' WHEN 'баэ' THEN 'AE'
      WHEN 'объединенные арабские эмираты' THEN 'AE' WHEN 'бириккен араб эмираттары' THEN 'AE'
      WHEN 'turkey' THEN 'TR' WHEN 'türkiye' THEN 'TR' WHEN 'turkiye' THEN 'TR' WHEN 'турция' THEN 'TR' WHEN 'түркия' THEN 'TR'
      WHEN 'italy' THEN 'IT' WHEN 'италия' THEN 'IT'
      WHEN 'czechia' THEN 'CZ' WHEN 'czech republic' THEN 'CZ' WHEN 'чехия' THEN 'CZ' WHEN 'чешская республика' THEN 'CZ'
    END
  END
$$;

-- ---------------------------------------------------------------------------
-- b) Выбор и квитанции
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.student_country_choices (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  country TEXT NOT NULL CHECK (country = 'UNDECIDED' OR country = ANY (platform_private.study_country_codes())),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, membership_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

CREATE TABLE platform_private.student_country_choice_requests (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  country TEXT NOT NULL CHECK (country = 'UNDECIDED' OR country = ANY (platform_private.study_country_codes())),
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, membership_id, request_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

ALTER TABLE platform_private.student_country_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_country_choices FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_country_choice_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_country_choice_requests FORCE ROW LEVEL SECURITY;
-- Ноль permissive-политик и ноль табличных грантов: только RPC ниже.
REVOKE ALL ON TABLE platform_private.student_country_choices, platform_private.student_country_choice_requests
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Ответ обеих RPC: {country, source, savedAt}.
--   saved: сохранённый выбор (код или UNDECIDED), savedAt = время сохранения;
--   application: ровно одна из шести стран в анкете этого аккаунта;
--   case: target_country своего дела распознаётся как одна из шести;
--   none: country NULL.
-- Своё дело резолвится как в 196 (portal_activated_at, pending/active/closed,
-- первое по created_at).
CREATE FUNCTION platform_private.student_country_choice_payload(
  p_organization_id UUID, p_membership_id UUID, p_auth_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved platform_private.student_country_choices%ROWTYPE; derived TEXT;
BEGIN
  SELECT * INTO saved FROM platform_private.student_country_choices c
  WHERE c.organization_id = p_organization_id AND c.membership_id = p_membership_id;
  IF FOUND THEN
    RETURN jsonb_build_object('country', saved.country, 'source', 'saved', 'savedAt', saved.updated_at);
  END IF;
  SELECT CASE WHEN count(DISTINCT d.code) = 1 THEN min(d.code) END INTO derived
  FROM platform_private.student_applications a
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE
    WHEN jsonb_typeof(a.questionnaire -> 'destinationCountries') = 'array' THEN a.questionnaire -> 'destinationCountries'
    ELSE '[]'::JSONB END) AS d(code)
  WHERE a.organization_id = p_organization_id AND a.auth_user_id = p_auth_user_id
    AND d.code = ANY (platform_private.study_country_codes());
  IF derived IS NOT NULL THEN
    RETURN jsonb_build_object('country', derived, 'source', 'application', 'savedAt', NULL);
  END IF;
  SELECT platform_private.study_country_from_text(sc.target_country) INTO derived
  FROM platform.student_cases sc
  WHERE sc.organization_id = p_organization_id
    AND sc.student_membership_id = p_membership_id
    AND sc.portal_activated_at IS NOT NULL
    AND sc.state IN ('pending', 'active', 'closed')
  ORDER BY sc.created_at, sc.id LIMIT 1;
  IF derived IS NOT NULL THEN
    RETURN jsonb_build_object('country', derived, 'source', 'case', 'savedAt', NULL);
  END IF;
  RETURN jsonb_build_object('country', NULL, 'source', 'none', 'savedAt', NULL);
END $$;

-- ---------------------------------------------------------------------------
-- c) Чтение
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.student_country_choice_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Country choice unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.student_country_choice_payload(a.organization_id, a.membership_id, a.auth_user_id);
END $$;

-- ---------------------------------------------------------------------------
-- d) Запись
-- ---------------------------------------------------------------------------
-- Порядок: вход (42501), вход заново под живой блокировкой участника (как
-- 198: параллельный отзыв доступа не проскакивает), проверка значения
-- (22023), блокировка выбора участника, квитанция по request_id.
CREATE FUNCTION platform.set_student_country_choice_v1(p_country TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; locked RECORD; previous platform_private.student_country_choice_requests%ROWTYPE; result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Country choice unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO locked FROM platform_private.require_domain_actor(a.organization_id, 'portal.read.self');
  IF locked.actor_role IS DISTINCT FROM 'student' OR locked.actor_membership_id IS DISTINCT FROM a.membership_id THEN
    RAISE EXCEPTION 'Country choice unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_country IS NULL
    OR NOT (p_country = 'UNDECIDED' OR p_country = ANY (platform_private.study_country_codes())) THEN
    RAISE EXCEPTION 'Invalid country choice' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'evo:country-choice:' || a.organization_id::TEXT || ':' || a.membership_id::TEXT, 0));
  SELECT * INTO previous FROM platform_private.student_country_choice_requests r
  WHERE r.organization_id = a.organization_id AND r.membership_id = a.membership_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF previous.country IS DISTINCT FROM p_country THEN
      RAISE EXCEPTION 'Country choice request was already used' USING ERRCODE = '22023';
    END IF;
    RETURN previous.receipt;
  END IF;
  INSERT INTO platform_private.student_country_choices AS c (organization_id, membership_id, country, request_id)
  VALUES (a.organization_id, a.membership_id, p_country, p_request_id)
  ON CONFLICT (organization_id, membership_id) DO UPDATE
    SET country = EXCLUDED.country, request_id = EXCLUDED.request_id, updated_at = clock_timestamp();
  result := platform_private.student_country_choice_payload(a.organization_id, a.membership_id, a.auth_user_id);
  INSERT INTO platform_private.student_country_choice_requests (organization_id, membership_id, request_id, country, receipt)
  VALUES (a.organization_id, a.membership_id, p_request_id, p_country, result);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION
  platform_private.study_country_from_text(TEXT),
  platform_private.student_country_choice_payload(UUID, UUID, UUID),
  platform.student_country_choice_v1(),
  platform.set_student_country_choice_v1(TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_country_choice_v1(), platform.set_student_country_choice_v1(TEXT, UUID)
TO authenticated;

-- ---------------------------------------------------------------------------
-- e) Удаление аккаунта: выбор и квитанции это свои строки аккаунта.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a284_replace('platform_private.account_deletion_closure(uuid,uuid)',
  $old$    'platform.learning_lesson_attempts', 'platform_private.learning_requests',
    'platform.audit_events'];$old$,
  $new$    'platform.learning_lesson_attempts', 'platform_private.learning_requests',
    -- 284: выбор страны студента и его квитанции.
    'platform_private.student_country_choices', 'platform_private.student_country_choice_requests',
    'platform.audit_events'];$new$, 1);

-- ---------------------------------------------------------------------------
-- Проверка: распознавание стран, права, search_path, «свои» таблицы 280.
-- ---------------------------------------------------------------------------
DO $a284_verify$
DECLARE routine RECORD;
BEGIN
  IF platform_private.study_country_from_text('Китай') IS DISTINCT FROM 'CN'
    OR platform_private.study_country_from_text(' ЧЕХИЯ ') IS DISTINCT FROM 'CZ'
    OR platform_private.study_country_from_text('Czech Republic') IS DISTINCT FROM 'CZ'
    OR platform_private.study_country_from_text('Түркия') IS DISTINCT FROM 'TR'
    OR platform_private.study_country_from_text('my') IS DISTINCT FROM 'MY'
    OR platform_private.study_country_from_text('Poland') IS NOT NULL
    OR platform_private.study_country_from_text('UNDECIDED') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a284_country_mapping_broken';
  END IF;
  IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.account_deletion_closure(uuid,uuid)'::regprocedure)
    NOT LIKE '%''platform_private.student_country_choices'', ''platform_private.student_country_choice_requests''%'
  THEN
    RAISE EXCEPTION 'a284_replace_not_applied';
  END IF;
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.proconfig, p.prosecdef,
      p.oid::REGPROCEDURE::TEXT LIKE 'platform.%' AS client_rpc
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'platform_private.study_country_from_text(text)'::regprocedure,
      'platform_private.student_country_choice_payload(uuid,uuid,uuid)'::regprocedure,
      'platform_private.account_deletion_closure(uuid,uuid)'::regprocedure,
      'platform.student_country_choice_v1()'::regprocedure,
      'platform.set_student_country_choice_v1(text,uuid)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR has_function_privilege('service_role', routine.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', routine.signature, 'EXECUTE') IS DISTINCT FROM routine.client_rpc
      OR (routine.client_rpc AND NOT routine.prosecdef)
    THEN
      RAISE EXCEPTION 'a284_posture_drift: %', routine.signature;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'platform_private.student_country_choices', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.student_country_choices', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.student_country_choice_requests', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.student_country_choice_requests', 'SELECT')
  THEN
    RAISE EXCEPTION 'a284_table_grant_drift';
  END IF;
END
$a284_verify$;

COMMENT ON FUNCTION platform_private.study_country_from_text(TEXT) IS
  'Код одной из шести стран продукта (282) по коду или названию (EN, RU, KY); иначе NULL (284).';
COMMENT ON TABLE platform_private.student_country_choices IS
  'Выбор страны студента для «Пути поступления» (284): одна строка на участника, только через RPC, сотрудникам не виден.';
COMMENT ON TABLE platform_private.student_country_choice_requests IS
  'Квитанции set_student_country_choice_v1 по request_id (284).';
COMMENT ON FUNCTION platform.student_country_choice_v1() IS
  'Свой выбор страны (284): {country, source: saved|application|case|none, savedAt}.';
COMMENT ON FUNCTION platform.set_student_country_choice_v1(TEXT, UUID) IS
  'Сохранить свой выбор страны (284): CN, MY, AE, TR, IT, CZ или UNDECIDED; идемпотентно по request_id.';

NOTIFY pgrst, 'reload schema';
COMMIT;
