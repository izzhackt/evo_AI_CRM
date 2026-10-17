-- 303: телефоны, остаточные случаи сопоставления после 281 (issue #1198,
-- docs/PLAN_CHANGES.md «2026-10-17 · Телефоны: остаточные случаи сопоставления
-- после 281 (#1198, миграция 296, запись до кода)»). Запись писалась под номером 296;
-- итоговый номер 303 присвоен при сведении 18.10 по свежему origin/main (последняя
-- миграция 301, 302 занята аудитом направления) и сверяется ещё раз перед слиянием.
--
-- Forward-only, на живых определениях 001–302. Обе заменяемые функции закреплены
-- md5 их текущего тела (шаблон 253/256/281): расхождение останавливает миграцию.
-- Подписи, владельцы, права и search_path не меняются (CREATE OR REPLACE и
-- замена фрагментов через pg_get_functiondef их сохраняют); новых клиентских
-- функций нет.
--
--  a) platform_private.person_phone_match_keys (281): номер другой страны без
--     «+» читается как E.164 для сравнения. 281 читал так номер, который
--     принимает admissions_direct_phone, 9 цифр (Кыргызстан) и 9960…; номер вида
--     «7 701 …» оставался одним ключом. Прямой путь хранит «+7 701 …» и ищет
--     «+N», «N», «00N», поэтому прямой порядок находил продажи и сайт, а
--     обратный нет: ручной лид «7 701 …» после дела давал второго клиента с
--     открытым лидом, сайт создавал нового клиента. Добавлен последний случай:
--     10–15 цифр, первая не 0, читаются как «+» и эти цифры. Ключи такого номера
--     теперь «+N», «N», «00N», как у прямого пути, и замки продаж, сайта и
--     прямого пути пересекаются по тем же значениям. Ничего не угадывается:
--     страна не подбирается, национальный префикс не отрезается («8 701 …»
--     Казахстана и России, «0532 …» Турции, а также 7–8 цифр по-прежнему не
--     находятся ни в одном порядке: это сказано в runbook). Правила
--     Кыргызстана стоят раньше и не меняются. Номер как хранился, так и
--     хранится: правка влияет только на сравнение и порядок замков. Телефония
--     (289) вызывает функцию с номерами в E.164 с «+», для них ключи прежние.
--  b) platform.receive_website_lead (263, 281, 282): заявка человека, у которого
--     есть дело прямого добавления («Добавить студента») или импорта в работе,
--     присоединяется к лиду этого дела и нового лида продаж не открывает. До
--     этого сайт открывал у такого клиента лид website/open (лид дела уже
--     converted), а handoff_lead_to_admissions ищет дело по canonical_lead_id и
--     source_key лида, не по клиенту, и ветка pending_case в
--     create_sales_report_handoff (208/215) тоже: передача такого лида создала
--     бы тому же клиенту второе дело (уникальный индекс 088 один на лид).
--     Выбрано узкое решение у источника, а не правка передачи (шесть версий,
--     ворота договора, замки), не лид «с пометкой» (метка не мешает передаче) и
--     не лид сразу converted (ложная конверсия в воронке продаж). Присоединение
--     идёт тем же путём, что повтор на открытый лид (240): квитанция
--     website_lead_receipts на лид дела, касание источника с is_repeat (на канал
--     не влияет), строка журнала lead.website.receive (в after_state
--     student_case_id, причина названа), в «Маркетинге» заявка повторная. Новый
--     клиент и лид не создаются, interest_direction лида дела не трогается.
--     Открытый лид по-прежнему главнее; закрытое дело ничего не меняет (человек
--     мог прийти за новой услугой: лид открывается как раньше); дело, пришедшее
--     через продажи, не затронуто (у него есть владелец продаж и лид с
--     историей). Куратору сигнал не уходит: для сотрудников нет канала
--     уведомлений, а заметка от чужого имени недопустима; заявка видна в
--     журнале, квитанциях и счёте повторных заявок «Маркетинга».
--
-- Телефон родителя в сопоставлении «тот же человек» не участвует (решение
-- координатора 17.10.2026, у братьев и сестёр общий номер родителя): здесь
-- ничего не меняется, решение записано в runbook и PLAN_CHANGES.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: заменяемые тела ровно те, что собрали 281 и 282.
-- ---------------------------------------------------------------------------
DO $a303_anchor$
BEGIN
  -- Тело 281, без изменений до этой миграции.
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform_private.person_phone_match_keys(text)'::regprocedure)
    IS DISTINCT FROM '4155ff91fac1be0e11843425a0ef3d66' THEN
    RAISE EXCEPTION 'a303_anchor_drift: platform_private.person_phone_match_keys is not the 281 definition';
  END IF;
  -- Тело 263 с заменами 281 (замки и поиск по написаниям) и 282 (список
  -- стран); значение посчитано по тексту миграций, метод сверен с якорем 281
  -- для тела 263 (2902c9fa…).
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure)
    IS DISTINCT FROM '5ff3e987f45f568b4129af6b1fa7b242' THEN
    RAISE EXCEPTION 'a303_anchor_drift: platform.receive_website_lead is not the 263 body with the 281 and 282 replacements';
  END IF;
END
$a303_anchor$;

-- Замена проверяемого фрагмента внутри тела (шаблон 173/244/281/282).
CREATE FUNCTION pg_temp.a303_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a303_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) Номер другой страны без «+»: те же ключи, что у прямого пути
-- ---------------------------------------------------------------------------
-- Тело 281 целиком, плюс один последний случай в CASE. Тот же список
-- параметров, язык, IMMUTABLE и search_path = '': владелец и права (закрыты для
-- всех клиентских ролей в 281) остаются.
CREATE OR REPLACE FUNCTION platform_private.person_phone_match_keys(p_value TEXT)
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  WITH typed AS (SELECT platform_private.normalize_person_phone(NULLIF(btrim(p_value), '')) AS n),
  parsed AS (SELECT t.n, COALESCE(platform_private.admissions_direct_phone(t.n),
      CASE WHEN t.n ~ '^[0-9]{9}$' THEN '+996' || t.n
        WHEN t.n ~ '^9960[0-9]{9}$' THEN '+996' || substr(t.n, 5)
        WHEN t.n ~ '^[1-9][0-9]{9,14}$' THEN '+' || t.n END) AS canonical
    FROM typed t)
  SELECT CASE WHEN r.n IS NULL OR r.n IN ('', '+') THEN ARRAY[]::TEXT[]
    ELSE ARRAY(SELECT DISTINCT k FROM unnest(ARRAY[r.n] || platform_private.admissions_direct_phone_keys(r.canonical)) k
      ORDER BY k) END
  FROM parsed r
$$;

COMMENT ON FUNCTION platform_private.person_phone_match_keys(TEXT) IS
  'Migration 281 + 303: every spelling under which another intake may have stored the number as typed; since 303 also a number of another country typed without «+» (10-15 digits) reads as «+» and those digits. Compare only; nothing is guessed.';

-- ---------------------------------------------------------------------------
-- b) Заявка с сайта после прямого дела: присоединение вместо нового лида
-- ---------------------------------------------------------------------------
SELECT pg_temp.a303_replace(
  'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)',
  $old$ touch JSONB; joined BOOLEAN:=FALSE;$old$,
  $new$ touch JSONB; joined BOOLEAN:=FALSE; direct_case UUID;$new$, 1);

SELECT pg_temp.a303_replace(
  'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)',
  $old$  joined:=resolved_lead IS NOT NULL;$old$,
  $new$  -- 303: no open lead, but the client has a direct-admissions case (the add-a-student button or the
  -- import) in work: already an admissions student. The submission joins the lead of that case instead
  -- of opening a sales lead, which a handoff would turn into a second case (handoff_lead_to_admissions
  -- finds a case by the lead, not by the client). An open lead found above still wins; a closed case
  -- and cases that came through sales change nothing.
  IF resolved_lead IS NULL THEN
    SELECT sc.canonical_lead_id,sc.id INTO resolved_lead,direct_case FROM platform.student_cases sc
      WHERE sc.organization_id=p_organization_id
        AND (sc.canonical_client_id=resolved_client OR sc.canonical_lead_id IN (
          SELECT l.id FROM platform.leads l WHERE l.organization_id=p_organization_id AND l.client_id=resolved_client))
        AND sc.state IN ('pending','active') AND sc.canonical_lead_id IS NOT NULL
        AND sc.source_key LIKE 'admissions-direct:%'
      ORDER BY sc.created_at DESC,sc.id LIMIT 1;
  END IF;
  joined:=resolved_lead IS NOT NULL;$new$, 1);

SELECT pg_temp.a303_replace(
  'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)',
  $old$jsonb_build_object('source_key','website','request_id',p_request_id),'Website inquiry received with consent',p_request_id);$old$,
  $new$CASE WHEN direct_case IS NULL THEN jsonb_build_object('source_key','website','request_id',p_request_id)
        ELSE jsonb_build_object('source_key','website','request_id',p_request_id,'student_case_id',direct_case) END,
      CASE WHEN direct_case IS NULL THEN 'Website inquiry received with consent'
        ELSE 'Website inquiry received with consent; the person has a direct-admissions case in work, no sales lead opened' END,
      p_request_id);$new$, 1);

COMMENT ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB,JSONB) IS
  '240 + необязательные метки p_attribution (263): метки очищаются в SQL, пишутся отдельным касанием website_form и не входят в payload квитанции; повтор по requestId касания не добавляет. 281: клиент ищется по всем написаниям номера. 296: у человека с делом прямого добавления или импорта в работе заявка присоединяется к лиду дела (касание is_repeat), нового лида продаж не открывает.';

-- ---------------------------------------------------------------------------
-- Проверка: новые тела на месте, подписи и права прежние.
-- ---------------------------------------------------------------------------
DO $a303_verify$
BEGIN
  IF (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = 'platform_private.person_phone_match_keys(text)'::regprocedure) NOT LIKE '%''^[1-9][0-9]{9,14}$'' THEN ''+'' || t.n END%'
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
        AND p.proname = 'person_phone_match_keys') <> 1
    OR COALESCE((SELECT NOT (p.provolatile = 'i' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
        FROM pg_catalog.pg_proc p WHERE p.oid = 'platform_private.person_phone_match_keys(text)'::regprocedure), TRUE)
    OR has_function_privilege('anon', 'platform_private.person_phone_match_keys(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.person_phone_match_keys(text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.person_phone_match_keys(text)', 'EXECUTE')
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname = 'receive_website_lead') <> 1
    OR COALESCE((SELECT NOT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 'v'
          AND p.prosrc LIKE '%direct_case UUID%' AND p.prosrc LIKE '%admissions-direct:%'
          AND p.prosrc LIKE '%''student_case_id'',direct_case%'
          AND p.prosrc LIKE '%person_phone_match_keys(contact_phone)%')
        FROM pg_catalog.pg_proc p
        WHERE p.oid = 'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure), TRUE)
    OR NOT has_function_privilege('service_role',
        'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated',
        'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon',
        'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a303_verify_failed';
  END IF;
END
$a303_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
