-- 289_platform_telephony_ingest — «Телефония Beeline KG» срез T1b: функции приёма,
-- проекции, ног, окна успокоения, аренды и повторов, сопоставления телефона.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.1 (пункты 6–8), §5.2, §6.1,
-- §6.2, §6.3, §9.1; ADR 0033 (решения 3–5); docs/PLAN_CHANGES.md (запись
-- «Телефония T1b»). Схема — миграция 288 (T1a); здесь только функции и один
-- индекс. Маршрута, env, клиента ВАТС, сверки, интерфейса и задач нет: они идут
-- срезами T2–T12. Слияние ничего не открывает: проекция закрыта флагом
-- telephony_settings.projection_enabled (отсутствие строки = выключено).
--
-- Что делает:
--  * platform.telephony_receive_v1 (только service_role) — приём аутентифицированного
--    запроса ВАТС (event, history, rating) или запись формы для всего остального:
--      - ХРАНИТЬ СНАЧАЛА: доказательство пишется всегда; мягкая проверка
--        (validation_state ok / incomplete с перечнем недостающих имён полей);
--      - идемпотентность: ключ дедупликации SHA-256 от (cmd, type, callid,
--        second_callid, user, status, missedStatus, start, ext, phone); повтор —
--        status 'deduplicated', новых строк нет; повтор того же request_id —
--        'replayed'; сообщения с одним callid и разными user/status/start хранятся все;
--      - белый список 19 документированных полей; токен и ссылка из полей
--        вырезаются (ссылка отдельным параметром, в доказательстве только
--        has_link); значения — строки без управляющих знаков;
--      - замок T1a на fields (SQLSTATE 23514) не превращается в отказ: вместо
--        строки ok/incomplete пишется строка 'rejected' с формой (имена полей и
--        длины, без значений; чужие имена — invalid_name_N), cmd = 'bad_'+cmd,
--        функция отвечает status 'rejected' и НЕ падает (PLAN_CHANGES T1a, п. 19);
--      - внутренний звонок (короткий номер или номер сотрудника): номер в
--        доказательстве пуст (метка internal), ссылка не сохраняется, строки
--        звонка нет, считается только internal_calls_total (при проекции);
--      - ссылка на запись кладётся сразу в строку ноги в той же транзакции, до
--        проекции (§5.2); проекция идёт через точку сохранения: при сбое
--        доказательство и нога со ссылкой остаются, работа уходит в retry_wait;
--      - любой иной сбой приёма наружу — только PT503 с кодом вида
--        telephony_receive_failed:e<sqlstate>_<имя ограничения>, без SQLERRM.
--  * проекция (platform_private.telephony_project_event) — одно сообщение в звонок и
--    ногу: ключ ноги (call, user, leg_started_at) обновляется как переход (нога от
--    события получает время приёма, history уточняет его), событие находит свою
--    ногу (ближайшая нога того же сотрудника, у которой такого события ещё нет),
--    нет дублей при повторе, history после event, порядке «не по порядку»,
--    нескольких ногах группы и переводе; хронология call_events (одна строка на
--    сообщение, уникальный индекс) и пересчёт звонка (telephony_recompute_call) по правилам §6.1:
--      1. ответил сотрудник — нога сотрудника из справочника telephony_extensions
--         с ACCEPTED (только входящий) либо со status success и ненулевой общей
--         длительностью; приветствие, группа, ivr, fax и пустой user — не ответ;
--      2. ответ необратим (уже answered не меняется более поздней ногой);
--      3. прочие итоги по старшинству busy > unavailable > not_found > not_allowed
--         > cancelled > missed; 4. CANCELLED относится к ноге, звонок ended, когда
--         закончили все известные ноги; 6. talk_seconds — только из сверки (сумма
--         по ответившим ногам, если она есть); 7. направление — по первому
--         событию или ноге; 8. TRANSFERRED со second_callid связывает звонки
--         (linked_call_id), telephony_chain_answered — цепочка как один контакт;
--  * сопоставление телефона (platform_private.telephony_match_phone, §6.2): ключи
--    person_phone_match_keys (281) по platform.clients; один клиент — matched,
--    лид — единственный открытый, иначе самый недавно обновлённый открытый;
--    несколько — ambiguous; ни одного — unmatched. Клиентов и лидов функция не
--    создаёт (T9);
--  * очередь: platform.telephony_claim_work_v1 (аренда, число попыток) и
--    platform.telephony_project_work_v1 (проекция, succeeded / retry_wait с
--    отсрочкой 60 с · 2^(попытка−1), не больше часа / dead_lettered после
--    max_attempts; истёкшая аренда забирается заново); закрыты флагом;
--  * окно успокоения: platform.telephony_settle_calls_v1 — звонок считается
--    завершённым для решений (settled_at), когда по нему тихо 90 секунд и итог
--    известен; входящий без финальных сообщений через 90 секунд — missed;
--    исходящий без итога ждёт сверки, а через час тишины уходит с needs_review.
--
-- Записанные здесь уточнения контракта (в PLAN_CHANGES): (а) settled_at ставит
-- только тик и всегда через 90 с тишины (плановая формулировка «все известные ноги
-- закончили» допускала немедленное решение; тишина защищает от событий «не по
-- порядку»); (б) у исходящего ACCEPTED не даёт ответа (неизвестно, чья трубка;
-- ответ — history Success от сотрудника или сверка); (в) needs_review ставит
-- неполное сообщение только по полям, меняющим «кто, что, когда» (callid, type,
-- direction, user, phone, status, start), а не по diversion, duration и wait;
-- (г) при выключенной проекции ссылка на запись не сохраняется (ноги нет) и
-- возвращается сверкой; (д) метка internal в fields — наша, не поле ВАТС;
-- (е) пока справочник telephony_extensions пуст (нет ни одной действующей строки),
-- проекция не идёт: работа ждёт в очереди с кодом etl001 (иначе любой звонок вышел
-- бы missed до первой синхронизации GET /users); (ж) событие неизвестного вида
-- ногу не создаёт (остаётся доказательством); (з) у ноги два источника итога —
-- status из history и состояние CANCELLED, берётся старший (cancelled > missed);
-- (и) заготовка второго звонка при переводе несёт только направление, номер
-- приходит с его собственными сообщениями; (к) ключ дедупликации плана не содержит
-- времени, поэтому второй такой же INCOMING того же сотрудника в том же звонке —
-- повтор (сверка подберёт настоящий второй вызов).
--
-- Замки: SECURITY DEFINER с search_path = ''; публичные функции — в схеме platform
-- с проверкой роли service_role внутри и EXECUTE только у service_role; все
-- platform_private.telephony_* — без грантов клиентским ролям. Таблицы T1a не
-- меняются, добавлен один частичный уникальный индекс хронологии
-- (telephony_call_events_pbx_event_key). Нарушение целостности внутри писателя
-- ловится, наружу и в last_error_code уходит только SQLSTATE и имя ограничения
-- или столбца (PLAN_CHANGES T1a, п. 13); SQLERRM, PG_EXCEPTION_DETAIL и
-- PG_EXCEPTION_CONTEXT не читаются.
--
-- Безопасно для production: новые функции и один индекс на пустой таблице;
-- ни одна существующая таблица, функция, политика или право не меняется; приёма
-- нет (маршрут — срез T3), проекция выключена (строки настроек нет).
BEGIN;

DO $tel289_preconditions$
BEGIN
  IF to_regclass('platform_private.telephony_settings') IS NULL
    OR to_regclass('platform_private.telephony_runtime_state') IS NULL
    OR to_regclass('platform_private.telephony_extensions') IS NULL
    OR to_regclass('platform_private.telephony_pbx_events') IS NULL
    OR to_regclass('platform_private.telephony_event_work') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_call_legs') IS NULL
    OR to_regclass('platform_private.telephony_call_events') IS NULL
    OR to_regprocedure('platform_private.telephony_fields_ok(jsonb)') IS NULL
    OR to_regprocedure('platform_private.person_phone_match_keys(text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regclass('platform.clients') IS NULL
    OR to_regclass('platform.leads') IS NULL THEN
    RAISE EXCEPTION 'telephony_t1b_requires_t1a' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname LIKE 'telephony\_%'
      AND (n.nspname = 'platform'
        OR (n.nspname = 'platform_private' AND p.proname NOT IN ('telephony_cadence_ok',
          'telephony_cadence_step_ok', 'telephony_fields_ok', 'telephony_form_shape_ok',
          'telephony_names_ok', 'telephony_prefixes_ok', 'telephony_working_days_ok')))
  ) THEN
    RAISE EXCEPTION 'telephony_t1b_functions_already_exist' USING ERRCODE = '55000';
  END IF;
END
$tel289_preconditions$;

-- ---------------------------------------------------------------------------
-- Хронология: одно сообщение — не больше одной строки (идемпотентность
-- проекции). Мягкая ссылка pbx_event_id заполнена у каждой webhook-строки.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX telephony_call_events_pbx_event_key
  ON platform_private.telephony_call_events (organization_id, pbx_event_id)
  WHERE pbx_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Малые помощники (без грантов).
-- ---------------------------------------------------------------------------

-- Код ошибки для last_error_code и ответа: «e» + SQLSTATE + имя ограничения (или
-- столбца), по форме ^[a-z][a-z0-9_]{0,63}$. Значений не принимает и не может
-- нести: имя ограничения — часть схемы.
CREATE FUNCTION platform_private.telephony_error_code(p_sqlstate TEXT, p_constraint TEXT, p_column TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(
    'e' || COALESCE(NULLIF(lower(regexp_replace(COALESCE(p_sqlstate, ''), '[^0-9A-Za-z]', '', 'g')), ''), 'unknown')
      || COALESCE('_' || NULLIF(regexp_replace(lower(COALESCE(NULLIF(p_constraint, ''), NULLIF(p_column, ''), '')),
        '[^a-z0-9_]', '_', 'g'), ''), ''),
    64)
$$;

-- Текст ВАТС: без управляющих знаков и пробелов по краям, не длиннее p_max
-- знаков; пустое значение — NULL.
CREATE FUNCTION platform_private.telephony_clean_text(p_value TEXT, p_max INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(btrim(left(btrim(regexp_replace(COALESCE(p_value, ''), '[[:cntrl:]]', '', 'g')), p_max)), '')
$$;

-- Время ВАТС: YYYYmmddTHHMMSSZ (вебхук) или ISO (history/json) в UTC; всё
-- остальное и всё вне 2000–2100 годов — NULL. Не падает никогда.
CREATE FUNCTION platform_private.telephony_parse_ts(p_value TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v TEXT := btrim(p_value); r TIMESTAMPTZ;
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  IF v ~ '^[0-9]{8}T[0-9]{6}Z$' THEN
    r := pg_catalog.make_timestamptz(substr(v, 1, 4)::INTEGER, substr(v, 5, 2)::INTEGER, substr(v, 7, 2)::INTEGER,
      substr(v, 10, 2)::INTEGER, substr(v, 12, 2)::INTEGER, substr(v, 14, 2)::DOUBLE PRECISION, 'UTC');
  ELSIF v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    r := v::TIMESTAMPTZ;
  ELSE
    RETURN NULL;
  END IF;
  IF r < TIMESTAMPTZ '2000-01-01 00:00:00+00' OR r > TIMESTAMPTZ '2100-01-01 00:00:00+00' THEN RETURN NULL; END IF;
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

-- Секунды: неотрицательное число (до шести знаков после точки отбрасываются) не
-- больше 2 147 483 647, иначе NULL. Преобразование только после проверки формы.
CREATE FUNCTION platform_private.telephony_to_int(p_value TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN btrim(p_value) ~ '^[0-9]{1,10}(\.[0-9]{1,6})?$'
      AND floor(btrim(p_value)::NUMERIC) <= 2147483647
    THEN floor(btrim(p_value)::NUMERIC)::INTEGER END
$$;

-- Слово статуса в нижнем регистре ^[a-z][a-z0-9_]{0,31}$ (Success -> success,
-- Not Available -> not_available) или NULL.
CREATE FUNCTION platform_private.telephony_status_word(p_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN w ~ '^[a-z][a-z0-9_]{0,31}$' THEN w END
  FROM (SELECT btrim(regexp_replace(lower(btrim(COALESCE(p_value, ''))), '[^a-z0-9]+', '_', 'g'), '_') AS w) s
$$;

-- Номер ВАТС (цифры без «+») в E.164: через 281 (admissions_direct_phone); номер
-- без «+» и без национального начала читается как международный. Не номер — NULL.
CREATE FUNCTION platform_private.telephony_phone_e164(p_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL
    ELSE COALESCE(platform_private.admissions_direct_phone(p_value),
      CASE WHEN p_value ~ '^[[:space:]]*[0-9][0-9[:space:]().-]*$'
        THEN platform_private.admissions_direct_phone('+' || regexp_replace(p_value, '[^0-9]', '', 'g')) END)
    END
$$;

-- Состояния ноги: ringing < accepted < терминальные missed < cancelled <
-- completed < transferred. Слияние не понижает состояние.
CREATE FUNCTION platform_private.telephony_leg_state_rank(p_state TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_state WHEN 'ringing' THEN 0 WHEN 'accepted' THEN 10 WHEN 'missed' THEN 21
    WHEN 'cancelled' THEN 22 WHEN 'completed' THEN 23 WHEN 'transferred' THEN 24 END
$$;

CREATE FUNCTION platform_private.telephony_leg_state_merge(p_old TEXT, p_new TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_new IS NULL THEN p_old WHEN p_old IS NULL THEN p_new
    WHEN platform_private.telephony_leg_state_rank(p_new) > platform_private.telephony_leg_state_rank(p_old) THEN p_new
    ELSE p_old END
$$;

-- Флаг проекции: отсутствие строки настроек = выключено (PLAN_CHANGES T1a, п. 16).
CREATE FUNCTION platform_private.telephony_projection_enabled(p_org UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT s.projection_enabled FROM platform_private.telephony_settings s
    WHERE s.organization_id = p_org), FALSE)
$$;

-- Пользователь ВАТС по справочнику telephony_extensions (без учёта регистра):
-- канонический логин, сотрудник EVO и признак «сотрудник ВАТС». Сотрудником
-- считается только логин из справочника (§6.1, правило 1); пустое значение, ivr
-- и fax — никогда.
CREATE FUNCTION platform_private.telephony_resolve_user(p_org UUID, p_user TEXT)
RETURNS TABLE (o_pbx_user TEXT, o_membership_id UUID, o_is_employee BOOLEAN)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_user TEXT := COALESCE(platform_private.telephony_clean_text(p_user, 128), '');
  v_login TEXT; v_member UUID; v_found BOOLEAN := FALSE;
BEGIN
  IF v_user <> '' AND lower(v_user) NOT IN ('ivr', 'fax') THEN
    SELECT x.pbx_user, x.membership_id, TRUE INTO v_login, v_member, v_found
    FROM platform_private.telephony_extensions x
    WHERE x.organization_id = p_org AND lower(x.pbx_user) = lower(v_user)
    ORDER BY x.active DESC, x.created_at, x.id LIMIT 1;
  END IF;
  IF COALESCE(v_found, FALSE) THEN
    RETURN QUERY SELECT v_login, v_member, TRUE;
  ELSE
    RETURN QUERY SELECT v_user, NULL::UUID, FALSE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Сопоставление телефона с клиентом и лидом (§6.2). Клиентов и лидов не создаёт.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_match_phone(p_org UUID, p_phone TEXT)
RETURNS TABLE (m_state TEXT, m_client_id UUID, m_lead_id UUID)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_keys TEXT[]; v_count INTEGER; v_client UUID; v_lead UUID;
BEGIN
  v_keys := CASE WHEN p_phone IS NULL THEN ARRAY[]::TEXT[]
    ELSE platform_private.person_phone_match_keys(p_phone) END;
  IF cardinality(v_keys) = 0 THEN
    RETURN QUERY SELECT 'unmatched'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  SELECT count(*), min(c.id::TEXT)::UUID INTO v_count, v_client
  FROM platform.clients c
  WHERE c.organization_id = p_org AND c.lifecycle_state = 'active' AND c.normalized_phone = ANY (v_keys);
  IF v_count = 0 THEN
    RETURN QUERY SELECT 'unmatched'::TEXT, NULL::UUID, NULL::UUID;
  ELSIF v_count > 1 THEN
    RETURN QUERY SELECT 'ambiguous'::TEXT, NULL::UUID, NULL::UUID;
  ELSE
    SELECT l.id INTO v_lead
    FROM platform.leads l
    WHERE l.organization_id = p_org AND l.client_id = v_client AND l.lifecycle_state = 'open'
    ORDER BY l.updated_at DESC, l.id LIMIT 1;
    RETURN QUERY SELECT 'matched'::TEXT, v_client, v_lead;
  END IF;
END
$$;

-- Цепочка связанных звонков с одним клиентским номером — один контакт (§6.1,
-- правило 8): отвечен ли хоть один звонок цепочки. Связь идёт в обе стороны
-- (linked_call_id указывает на переведённый звонок), глубина не больше 10.
CREATE FUNCTION platform_private.telephony_chain_answered(p_org UUID, p_call_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH RECURSIVE first_call AS (
    SELECT x.id, x.client_phone FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_org AND x.id = p_call_id
  ), chain(id, depth) AS (
    SELECT f.id, 0 FROM first_call f
    UNION
    SELECT n.id, ch.depth + 1
    FROM chain ch
    JOIN platform_private.telephony_calls x ON x.organization_id = p_org AND x.id = ch.id
    JOIN platform_private.telephony_calls n ON n.organization_id = p_org
      AND (n.id = x.linked_call_id OR n.linked_call_id = x.id)
    CROSS JOIN first_call f
    WHERE ch.depth < 10 AND n.client_phone IS NOT DISTINCT FROM f.client_phone
  )
  SELECT COALESCE(bool_or(c.outcome = 'answered'), FALSE)
  FROM chain ch
  JOIN platform_private.telephony_calls c ON c.organization_id = p_org AND c.id = ch.id
$$;

-- Форма запроса: имя поля → длина (§5.1, пункт 6). p_is_shape = TRUE: вход уже
-- форма (имя → число); FALSE: вход — поля, длина считается по значению. Чужие
-- имена (ссылка, номер, пробелы) заменяются на invalid_name_N; не больше 64 имён.
CREATE FUNCTION platform_private.telephony_form_shape_of(p_obj JSONB, p_is_shape BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_out JSONB := '{}'::JSONB; v_n INTEGER := 0; v_bad INTEGER := 0; v_name TEXT; v_len INTEGER; r RECORD;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN RETURN v_out; END IF;
  FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_obj) e ORDER BY e.key LOOP
    EXIT WHEN v_n >= 64;
    IF r.k ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN
      v_name := r.k;
    ELSE
      v_bad := v_bad + 1;
      v_name := 'invalid_name_' || v_bad;
    END IF;
    IF p_is_shape AND jsonb_typeof(r.v) = 'number' THEN
      v_len := CASE WHEN (r.v #>> '{}') ~ '^[0-9]{1,18}$' THEN LEAST((r.v #>> '{}')::BIGINT, 99999)::INTEGER ELSE 99999 END;
    ELSIF jsonb_typeof(r.v) = 'string' THEN
      v_len := char_length(r.v #>> '{}');
    ELSE
      v_len := char_length(r.v::TEXT);
    END IF;
    v_out := v_out || jsonb_build_object(v_name, LEAST(v_len, 99999));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_out;
END
$$;

-- Строка 'rejected' (форма без значений). cmd — только безопасная форма и не из
-- списка event/history/rating (замок состояния T1a).
CREATE FUNCTION platform_private.telephony_store_rejected(
  p_org UUID, p_request_id UUID, p_cmd TEXT, p_slot TEXT, p_sha TEXT, p_shape JSONB, p_has_link BOOLEAN
) RETURNS UUID LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO platform_private.telephony_pbx_events (organization_id, request_id, cmd, body_sha256, token_slot,
    validation_state, form_shape, has_link)
  VALUES (p_org, p_request_id, p_cmd, p_sha, p_slot, 'rejected', p_shape, COALESCE(p_has_link, FALSE))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- Нога: найти или создать звонок и ногу сообщения, записать ссылку на запись
-- (единственное место её хранения). Идемпотентна: повтор подбирает ту же ногу.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_place_leg(p_org UUID, p_event_id UUID, p_link TEXT)
RETURNS TABLE (o_call_id UUID, o_leg_id UUID)
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  ev platform_private.telephony_pbx_events%ROWTYPE;
  cl platform_private.telephony_calls%ROWTYPE;
  lg platform_private.telephony_call_legs%ROWTYPE;
  f JSONB;
  v_type TEXT; v_dir TEXT; v_callid TEXT; v_second TEXT; v_review BOOLEAN;
  v_user TEXT; v_member UUID; v_phone TEXT; v_ext TEXT; v_group TEXT;
  v_company TEXT; v_company_name TEXT; v_missed SMALLINT;
  v_start TIMESTAMPTZ; v_total INTEGER; v_wait INTEGER; v_status TEXT;
  v_new_state TEXT; v_link TEXT; v_new_at TIMESTAMPTZ; v_new_src TEXT; v_call_start TIMESTAMPTZ;
  v_leg_end TIMESTAMPTZ; v_keys TEXT[]; v_key TEXT; v_found BOOLEAN;
BEGIN
  SELECT * INTO ev FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_org AND e.id = p_event_id;
  IF NOT FOUND OR ev.cmd NOT IN ('event', 'history') OR ev.fields IS NULL THEN
    RETURN;
  END IF;
  f := ev.fields;
  v_type := upper(COALESCE(ev.event_type, ''));
  v_review := ev.missing_fields && ARRAY['callid', 'type', 'direction', 'user', 'phone', 'status', 'start']::TEXT[];

  -- Идентификатор звонка; без него — временный ключ из хэша (start, phone, user).
  v_callid := ev.pbx_callid;
  IF v_callid IS NULL THEN
    v_callid := 'tmp:' || left(encode(sha256(convert_to(concat_ws(E'\x1f',
      COALESCE(f ->> 'start', to_char(ev.received_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MI')),
      COALESCE(f ->> 'phone', ''), COALESCE(f ->> 'user', '')), 'UTF8')), 'hex'), 32);
    v_review := TRUE;
  END IF;
  v_second := CASE WHEN ev.cmd = 'event' AND v_type = 'TRANSFERRED' AND ev.second_callid IS DISTINCT FROM v_callid
    THEN ev.second_callid END;

  -- Один звонок обрабатывается одним писателем (оба идентификатора перевода — в
  -- одном порядке, чтобы два перевода навстречу не ждали друг друга).
  v_keys := ARRAY(SELECT DISTINCT k FROM unnest(ARRAY[v_callid, v_second]) k WHERE k IS NOT NULL ORDER BY k);
  FOREACH v_key IN ARRAY v_keys LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('evo:telephony:call:' || p_org::TEXT || ':' || v_key, 0));
  END LOOP;

  -- Поля сообщения.
  IF ev.cmd = 'event' THEN
    v_dir := CASE lower(btrim(f ->> 'direction')) WHEN 'in' THEN 'in' WHEN 'out' THEN 'out' END;
    IF v_dir IS NULL THEN
      v_dir := CASE v_type WHEN 'INCOMING' THEN 'in' WHEN 'OUTGOING' THEN 'out' END;
    END IF;
  ELSE
    v_dir := CASE lower(btrim(f ->> 'type')) WHEN 'in' THEN 'in' WHEN 'out' THEN 'out' END;
    IF v_dir IS NULL THEN
      v_dir := CASE lower(btrim(f ->> 'direction')) WHEN 'in' THEN 'in' WHEN 'out' THEN 'out' END;
    END IF;
  END IF;
  SELECT r.o_pbx_user, r.o_membership_id INTO v_user, v_member
  FROM platform_private.telephony_resolve_user(p_org, f ->> 'user') r;
  v_phone := platform_private.telephony_phone_e164(f ->> 'phone');
  v_ext := platform_private.telephony_clean_text(f ->> 'ext', 32);
  v_group := platform_private.telephony_clean_text(f ->> 'groupRealName', 200);
  v_company_name := platform_private.telephony_clean_text(f ->> 'telnum_name', 200);
  v_company := platform_private.telephony_clean_text(f ->> 'diversion', 64);
  IF v_company ~ '^\+?[0-9][0-9 ()-]*$' THEN
    v_company := NULLIF(regexp_replace(v_company, '[^0-9]', '', 'g'), '');
  END IF;
  v_link := CASE WHEN p_link ~ '^https://[^[:space:][:cntrl:]]+$' AND char_length(p_link) <= 1024 THEN p_link END;
  IF ev.cmd = 'history' THEN
    v_start := platform_private.telephony_parse_ts(f ->> 'start');
    v_call_start := v_start;
    v_total := platform_private.telephony_to_int(f ->> 'duration');
    v_wait := platform_private.telephony_to_int(f ->> 'wait');
    v_status := platform_private.telephony_status_word(f ->> 'status');
    v_missed := CASE WHEN btrim(f ->> 'missedStatus') ~ '^[1-4]$' THEN btrim(f ->> 'missedStatus')::SMALLINT END;
    -- history — итог ноги: терминальное состояние; без статуса ответом не считается.
    v_new_state := CASE WHEN v_status = 'success' THEN 'completed' WHEN v_status = 'cancel' THEN 'cancelled'
      ELSE 'missed' END;
    v_leg_end := CASE WHEN v_start IS NOT NULL AND v_total IS NOT NULL
      THEN v_start + pg_catalog.make_interval(secs => v_total) ELSE ev.received_at END;
  ELSE
    v_new_state := CASE v_type WHEN 'INCOMING' THEN 'ringing' WHEN 'OUTGOING' THEN 'ringing' WHEN 'ACCEPTED' THEN 'accepted'
      WHEN 'COMPLETED' THEN 'completed' WHEN 'CANCELLED' THEN 'cancelled' WHEN 'TRANSFERRED' THEN 'transferred' END;
  END IF;

  -- Звонок.
  SELECT * INTO cl FROM platform_private.telephony_calls x
  WHERE x.organization_id = p_org AND x.pbx_callid = v_callid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO platform_private.telephony_calls (organization_id, pbx_callid, direction, started_at, client_phone,
      company_number, company_number_name, pbx_missed_status, created_via, needs_review, last_message_at)
    VALUES (p_org, v_callid, COALESCE(v_dir, 'in'), COALESCE(v_call_start, ev.received_at), v_phone, v_company,
      v_company_name, v_missed, 'webhook', v_review OR v_dir IS NULL, ev.received_at)
    RETURNING * INTO cl;
  ELSE
    UPDATE platform_private.telephony_calls x SET
      started_at = LEAST(x.started_at, COALESCE(v_call_start, x.started_at)),
      -- Направление — по первому событию (правило 7); догадку вместо него
      -- (звонок помечен needs_review) исправляет первое сообщение с направлением.
      direction = CASE WHEN x.needs_review AND v_dir IS NOT NULL THEN v_dir ELSE x.direction END,
      client_phone = COALESCE(x.client_phone, v_phone),
      company_number = COALESCE(x.company_number, v_company),
      company_number_name = COALESCE(x.company_number_name, v_company_name),
      pbx_missed_status = COALESCE(v_missed, x.pbx_missed_status),
      needs_review = x.needs_review OR v_review,
      last_message_at = GREATEST(x.last_message_at, ev.received_at),
      updated_at = clock_timestamp()
    WHERE x.id = cl.id
    RETURNING * INTO cl;
  END IF;

  -- Нога.
  v_found := FALSE;
  IF ev.cmd = 'event' THEN
    -- Ближайшая по времени приёма нога того же сотрудника, у которой события
    -- такого вида ещё нет; иначе новая.
    SELECT * INTO lg FROM platform_private.telephony_call_legs x
    WHERE x.organization_id = p_org AND x.call_id = cl.id AND x.pbx_user = v_user
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_events e
        WHERE e.organization_id = p_org AND e.leg_id = x.id AND e.source = 'webhook' AND e.event_type = lower(v_type))
    ORDER BY abs(extract(epoch FROM (x.leg_started_at - ev.received_at))), x.leg_started_at DESC, x.id
    LIMIT 1 FOR UPDATE;
    v_found := FOUND;
  ELSE
    IF v_start IS NOT NULL THEN
      SELECT * INTO lg FROM platform_private.telephony_call_legs x
      WHERE x.organization_id = p_org AND x.call_id = cl.id AND x.pbx_user = v_user AND x.leg_started_at = v_start
      FOR UPDATE;
      v_found := FOUND;
    END IF;
    IF NOT v_found THEN
      -- Нога от события, которой история ещё не уточнила начало.
      SELECT * INTO lg FROM platform_private.telephony_call_legs x
      WHERE x.organization_id = p_org AND x.call_id = cl.id AND x.pbx_user = v_user AND x.leg_start_source = 'event'
      ORDER BY abs(extract(epoch FROM (x.leg_started_at - COALESCE(v_start, ev.received_at)))), x.id
      LIMIT 1 FOR UPDATE;
      v_found := FOUND;
    END IF;
  END IF;

  IF NOT v_found THEN
    INSERT INTO platform_private.telephony_call_legs (organization_id, call_id, pbx_user, extension, group_name,
      membership_id, state, status, leg_started_at, leg_start_source, accepted_at, ended_at,
      webhook_total_seconds, wait_seconds, recording_link, recording_state)
    VALUES (p_org, cl.id, v_user, v_ext, v_group, v_member, COALESCE(v_new_state, 'ringing'), v_status,
      CASE WHEN ev.cmd = 'history' AND v_start IS NOT NULL THEN v_start ELSE ev.received_at END,
      CASE WHEN ev.cmd = 'history' AND v_start IS NOT NULL THEN 'history' ELSE 'event' END,
      CASE WHEN ev.cmd = 'event' AND v_type = 'ACCEPTED' THEN ev.received_at END,
      CASE WHEN ev.cmd = 'history' AND v_new_state IS NOT NULL THEN v_leg_end
        WHEN ev.cmd = 'event' AND v_type IN ('COMPLETED', 'CANCELLED', 'TRANSFERRED') THEN ev.received_at END,
      v_total, v_wait, v_link, CASE WHEN v_link IS NOT NULL THEN 'available' ELSE 'none' END)
    RETURNING * INTO lg;
  ELSE
    -- Ключ ноги (call, user, leg_started_at) обновляется как переход: ранний
    -- приём события уточняется началом из history; занятое значение не берётся.
    v_new_at := lg.leg_started_at;
    v_new_src := lg.leg_start_source;
    IF ev.cmd = 'history' AND v_start IS NOT NULL AND lg.leg_started_at <> v_start
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_legs y
        WHERE y.organization_id = p_org AND y.call_id = lg.call_id AND y.pbx_user = lg.pbx_user
          AND y.leg_started_at = v_start AND y.id <> lg.id) THEN
      v_new_at := v_start;
      v_new_src := 'history';
    ELSIF ev.cmd = 'history' AND v_start IS NOT NULL AND lg.leg_started_at = v_start THEN
      v_new_src := 'history';
    ELSIF ev.cmd = 'event' AND lg.leg_start_source = 'event' AND ev.received_at < lg.leg_started_at
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_legs y
        WHERE y.organization_id = p_org AND y.call_id = lg.call_id AND y.pbx_user = lg.pbx_user
          AND y.leg_started_at = ev.received_at AND y.id <> lg.id) THEN
      v_new_at := ev.received_at;
    END IF;
    UPDATE platform_private.telephony_call_legs x SET
      leg_started_at = v_new_at,
      leg_start_source = v_new_src,
      extension = COALESCE(x.extension, v_ext),
      group_name = COALESCE(x.group_name, v_group),
      membership_id = COALESCE(v_member, x.membership_id),
      state = platform_private.telephony_leg_state_merge(x.state, v_new_state),
      status = CASE WHEN x.status = 'success' THEN x.status ELSE COALESCE(v_status, x.status) END,
      accepted_at = COALESCE(x.accepted_at, CASE WHEN ev.cmd = 'event' AND v_type = 'ACCEPTED' THEN ev.received_at END),
      ended_at = COALESCE(x.ended_at,
        CASE WHEN ev.cmd = 'history' AND v_new_state IS NOT NULL THEN v_leg_end
          WHEN ev.cmd = 'event' AND v_type IN ('COMPLETED', 'CANCELLED', 'TRANSFERRED') THEN ev.received_at END),
      webhook_total_seconds = COALESCE(v_total, x.webhook_total_seconds),
      wait_seconds = COALESCE(v_wait, x.wait_seconds),
      recording_link = COALESCE(v_link, x.recording_link),
      recording_state = CASE WHEN v_link IS NOT NULL THEN 'available' ELSE x.recording_state END,
      updated_at = clock_timestamp()
    WHERE x.id = lg.id
    RETURNING * INTO lg;
  END IF;

  o_call_id := cl.id;
  o_leg_id := lg.id;
  RETURN NEXT;
END
$$;

-- ---------------------------------------------------------------------------
-- Звонок из его ног (§6.1, правила 1–4, 6): пересчёт с нуля по ногам. Ответ
-- необратим: звонок с итогом answered остаётся answered.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_recompute_call(p_org UUID, p_call_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  cl platform_private.telephony_calls%ROWTYPE;
  v_legs INTEGER; v_terminal BOOLEAN; v_known BOOLEAN;
  v_ans_at TIMESTAMPTZ; v_ans_member UUID; v_ans_wait INTEGER;
  v_best TEXT; v_outcome TEXT; v_state TEXT; v_ended TIMESTAMPTZ; v_answered_at TIMESTAMPTZ;
  v_wait INTEGER; v_total INTEGER; v_talk INTEGER; v_rec TEXT; v_member UUID;
BEGIN
  SELECT * INTO cl FROM platform_private.telephony_calls x
  WHERE x.organization_id = p_org AND x.id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), COALESCE(bool_and(l.state IN ('completed', 'cancelled', 'transferred', 'missed')), FALSE)
  INTO v_legs, v_terminal
  FROM platform_private.telephony_call_legs l WHERE l.organization_id = p_org AND l.call_id = p_call_id;
  -- Звонок без ног (заготовка перевода, строка сверки) пересчёту не подлежит.
  IF v_legs = 0 THEN RETURN; END IF;

  -- Первая нога, на которую ответил сотрудник (правило 1).
  SELECT a.t, a.membership_id, a.wait_seconds INTO v_ans_at, v_ans_member, v_ans_wait
  FROM (
    SELECT l.membership_id, l.wait_seconds, l.id,
      COALESCE(l.accepted_at, l.leg_started_at + pg_catalog.make_interval(secs => COALESCE(l.wait_seconds, 0))) AS t
    FROM platform_private.telephony_call_legs l
    WHERE l.organization_id = p_org AND l.call_id = p_call_id AND l.pbx_user <> ''
      AND EXISTS (SELECT 1 FROM platform_private.telephony_extensions e
        WHERE e.organization_id = p_org AND lower(e.pbx_user) = lower(l.pbx_user))
      AND ((cl.direction = 'in' AND l.accepted_at IS NOT NULL)
        OR (l.status = 'success' AND COALESCE(l.webhook_total_seconds, 0) > 0)
        OR COALESCE(l.talk_seconds, 0) > 0)
  ) a
  ORDER BY a.t, a.id LIMIT 1;
  v_known := FOUND;

  -- Итог без ответа: по старшинству среди закончившихся ног (правило 3). У ноги
  -- два источника: status из history и состояние ноги (CANCELLED); берётся
  -- старший. Неизвестный или пустой status и Success без сотрудника — missed.
  SELECT o.outcome INTO v_best
  FROM (
    SELECT x.outcome
    FROM platform_private.telephony_call_legs l
    CROSS JOIN LATERAL (VALUES
      (CASE l.status WHEN 'busy' THEN 'busy' WHEN 'notavailable' THEN 'unavailable' WHEN 'notfound' THEN 'not_found'
        WHEN 'notallowed' THEN 'not_allowed' WHEN 'cancel' THEN 'cancelled' ELSE 'missed' END),
      (CASE l.state WHEN 'cancelled' THEN 'cancelled' END)) x(outcome)
    WHERE l.organization_id = p_org AND l.call_id = p_call_id
      AND l.state IN ('completed', 'cancelled', 'transferred', 'missed') AND x.outcome IS NOT NULL
  ) o
  ORDER BY CASE o.outcome WHEN 'busy' THEN 1 WHEN 'unavailable' THEN 2 WHEN 'not_found' THEN 3
    WHEN 'not_allowed' THEN 4 WHEN 'cancelled' THEN 5 ELSE 6 END
  LIMIT 1;

  IF v_known OR cl.outcome = 'answered' THEN
    v_outcome := 'answered';
    v_state := CASE WHEN v_terminal THEN 'ended' ELSE 'answered' END;
    v_answered_at := COALESCE(cl.answered_at, v_ans_at, cl.last_message_at);
  ELSIF v_terminal THEN
    v_outcome := COALESCE(v_best, 'missed');
    v_state := 'ended';
  ELSE
    v_outcome := NULL;
    v_state := 'ringing';
  END IF;
  v_ended := CASE WHEN v_state = 'ended' THEN
    COALESCE((SELECT max(l.ended_at) FROM platform_private.telephony_call_legs l
      WHERE l.organization_id = p_org AND l.call_id = p_call_id), cl.last_message_at) END;
  v_member := CASE WHEN v_known THEN v_ans_member ELSE cl.membership_id END;

  SELECT max(l.wait_seconds), max(l.webhook_total_seconds) INTO v_wait, v_total
  FROM platform_private.telephony_call_legs l WHERE l.organization_id = p_org AND l.call_id = p_call_id;
  IF v_known AND v_ans_wait IS NOT NULL THEN v_wait := v_ans_wait; END IF;
  -- talk_seconds приходит только из сверки: сумма по ответившим ногам, если есть.
  SELECT sum(l.talk_seconds)::INTEGER INTO v_talk
  FROM platform_private.telephony_call_legs l
  WHERE l.organization_id = p_org AND l.call_id = p_call_id AND l.talk_seconds IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform_private.telephony_extensions e
      WHERE e.organization_id = p_org AND lower(e.pbx_user) = lower(l.pbx_user));
  SELECT CASE WHEN bool_or(l.recording_state = 'available') THEN 'available'
      WHEN bool_or(l.recording_state = 'unavailable') THEN 'unavailable'
      WHEN bool_or(l.recording_state = 'expired') THEN 'expired' ELSE 'none' END
  INTO v_rec
  FROM platform_private.telephony_call_legs l WHERE l.organization_id = p_org AND l.call_id = p_call_id;

  UPDATE platform_private.telephony_calls x SET
    state = v_state,
    outcome = v_outcome,
    outcome_source = CASE WHEN v_outcome IS NULL THEN NULL ELSE 'webhook' END,
    answered_at = CASE WHEN v_outcome = 'answered' THEN v_answered_at END,
    ended_at = v_ended,
    membership_id = v_member,
    wait_seconds = v_wait,
    webhook_total_seconds = v_total,
    talk_seconds = COALESCE(v_talk, x.talk_seconds),
    recording_state = v_rec,
    updated_at = clock_timestamp()
  WHERE x.id = cl.id;
END
$$;

-- ---------------------------------------------------------------------------
-- Проекция одного сообщения: нога, хронология, перевод, пересчёт, сопоставление.
-- Возвращает projected, internal, already_projected или not_applicable.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_project_event(p_org UUID, p_event_id UUID, p_link TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  ev platform_private.telephony_pbx_events%ROWTYPE;
  cl platform_private.telephony_calls%ROWTYPE;
  lg platform_private.telephony_call_legs%ROWTYPE;
  v_call UUID; v_leg UUID; v_second UUID; v_type TEXT; v_at TIMESTAMPTZ; v_phone TEXT; m RECORD;
BEGIN
  SELECT * INTO ev FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_org AND e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_event_missing' USING ERRCODE = '55000';
  END IF;
  IF ev.cmd NOT IN ('event', 'history') OR ev.fields IS NULL THEN
    RETURN 'not_applicable';
  END IF;
  v_type := upper(COALESCE(ev.event_type, ''));

  -- Внутренний звонок между сотрудниками: строки нет, считается только счётчик
  -- (по открывающему событию).
  IF ev.fields ->> 'internal' = '1' THEN
    IF ev.cmd = 'event' AND v_type IN ('INCOMING', 'OUTGOING') THEN
      INSERT INTO platform_private.telephony_runtime_state (organization_id, internal_calls_total)
      VALUES (p_org, 1)
      ON CONFLICT (organization_id) DO UPDATE
        SET internal_calls_total = platform_private.telephony_runtime_state.internal_calls_total + 1,
            updated_at = clock_timestamp();
    END IF;
    RETURN 'internal';
  END IF;

  IF EXISTS (SELECT 1 FROM platform_private.telephony_call_events c
    WHERE c.organization_id = p_org AND c.pbx_event_id = p_event_id) THEN
    RETURN 'already_projected';
  END IF;
  -- Неизвестный вид события ногу не создаёт: доказательство остаётся для разбора.
  IF ev.cmd = 'event' AND v_type NOT IN ('INCOMING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'OUTGOING', 'TRANSFERRED') THEN
    RETURN 'not_applicable';
  END IF;
  -- Справочник пользователей ВАТС пуст (синхронизация GET /users ещё не шла):
  -- «ответил сотрудник» определить нечем, каждый звонок вышел бы missed. Работа
  -- ждёт в очереди с кодом etl001, пока справочник не заполнен.
  IF NOT EXISTS (SELECT 1 FROM platform_private.telephony_extensions x
    WHERE x.organization_id = p_org AND x.active) THEN
    RAISE EXCEPTION 'telephony_directory_empty' USING ERRCODE = 'TL001';
  END IF;

  SELECT p.o_call_id, p.o_leg_id INTO v_call, v_leg FROM platform_private.telephony_place_leg(p_org, p_event_id, p_link) p;
  IF v_call IS NULL THEN RETURN 'not_applicable'; END IF;
  SELECT * INTO lg FROM platform_private.telephony_call_legs x WHERE x.organization_id = p_org AND x.id = v_leg;
  SELECT * INTO cl FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = v_call;

  -- Хронология: одно сообщение — одна строка.
  v_at := CASE WHEN ev.cmd = 'history'
    THEN COALESCE(platform_private.telephony_parse_ts(ev.fields ->> 'start'), ev.received_at) ELSE ev.received_at END;
  INSERT INTO platform_private.telephony_call_events (organization_id, call_id, leg_id, source, event_type, pbx_user,
    occurred_at, pbx_event_id)
  VALUES (p_org, v_call, v_leg, 'webhook',
    CASE WHEN ev.cmd = 'history' THEN 'history'
      WHEN ev.event_type ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$' THEN lower(ev.event_type) ELSE 'unknown' END,
    lg.pbx_user, v_at, p_event_id);

  -- Перевод: пара звонков связывается (правило 8). Второй звонок, которого ещё
  -- нет, получает заготовку; её заполнят его собственные сообщения.
  IF ev.cmd = 'event' AND v_type = 'TRANSFERRED' AND ev.second_callid IS NOT NULL
    AND ev.second_callid IS DISTINCT FROM cl.pbx_callid THEN
    SELECT x.id INTO v_second FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_org AND x.pbx_callid = ev.second_callid FOR UPDATE;
    IF NOT FOUND THEN
      -- Заготовка несёт только направление (перевод его не меняет); номер и
      -- остальное придут с собственными сообщениями второго звонка.
      INSERT INTO platform_private.telephony_calls (organization_id, pbx_callid, direction, started_at, created_via,
        last_message_at)
      VALUES (p_org, ev.second_callid, cl.direction, ev.received_at, 'webhook', ev.received_at)
      RETURNING id INTO v_second;
    END IF;
    UPDATE platform_private.telephony_calls x SET linked_call_id = v_second, updated_at = clock_timestamp()
    WHERE x.organization_id = p_org AND x.id = v_call AND x.linked_call_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
        WHERE y.organization_id = p_org AND y.id = v_second AND y.linked_call_id = v_call);
  END IF;

  PERFORM platform_private.telephony_recompute_call(p_org, v_call);

  -- Сопоставление: пока звонок не завершён для решений, номер сверяется заново
  -- (клиент мог появиться за время звонка); созданное (T9) и завершённое не трогаем.
  SELECT * INTO cl FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = v_call;
  v_phone := cl.client_phone;
  IF v_phone IS NOT NULL AND cl.match_state <> 'created' AND cl.settled_at IS NULL THEN
    SELECT * INTO m FROM platform_private.telephony_match_phone(p_org, v_phone);
    UPDATE platform_private.telephony_calls x SET match_state = m.m_state, client_id = m.m_client_id,
      lead_id = m.m_lead_id, updated_at = clock_timestamp()
    WHERE x.id = v_call AND (x.match_state, x.client_id, x.lead_id) IS DISTINCT FROM (m.m_state, m.m_client_id, m.m_lead_id);
  END IF;
  RETURN 'projected';
END
$$;

-- ---------------------------------------------------------------------------
-- Приём (публичная функция, только service_role).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_receive_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_cmd TEXT,
  p_token_slot TEXT,
  p_body_sha256 TEXT,
  p_fields JSONB,
  p_recording_link TEXT,
  p_form_shape JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_known CONSTANT TEXT[] := ARRAY['cmd', 'type', 'user', 'phone', 'diversion', 'start', 'duration', 'callid',
    'status', 'ext', 'group', 'groupRealName', 'telnum', 'telnum_name', 'rating', 'wait', 'missedStatus',
    'direction', 'second_callid'];
  v_cmd TEXT; v_cmd_safe TEXT; v_sha TEXT;
  v_fields JSONB := '{}'::JSONB; v_dropped INTEGER := 0; v_txt TEXT; r RECORD;
  v_required TEXT[]; v_missing TEXT[] := ARRAY[]::TEXT[]; v_state TEXT;
  v_callid TEXT; v_second TEXT; v_event_type TEXT; v_phone_raw TEXT; v_digits TEXT; v_internal BOOLEAN := FALSE;
  v_has_link BOOLEAN := p_recording_link IS NOT NULL AND btrim(p_recording_link) <> '';
  v_link TEXT; v_canon TEXT; v_dedup TEXT;
  v_event_id UUID; v_work_id UUID; v_existing RECORD; v_proj BOOLEAN;
  v_projection TEXT := 'queued'; v_work_state TEXT := 'queued';
  v_sqlstate TEXT; v_constraint TEXT; v_column TEXT; v_code TEXT; v_rejected BOOLEAN := FALSE;
  v_shape JSONB; v_now TIMESTAMPTZ;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_cmd IS NULL
    OR p_token_slot IS NULL OR p_token_slot NOT IN ('current', 'next')
    OR p_body_sha256 IS NULL OR lower(btrim(p_body_sha256)) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_sha := lower(btrim(p_body_sha256));

  -- Тот же запрос приёма не пишется второй раз.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtextextended('evo:telephony:request:' || p_organization_id::TEXT || ':' || p_request_id::TEXT, 0));
  SELECT e.id, e.organization_id, e.validation_state INTO v_existing
  FROM platform_private.telephony_pbx_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'telephony_request_id_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('status', 'replayed', 'event_id', v_existing.id,
      'validation_state', v_existing.validation_state);
  END IF;

  BEGIN
    v_cmd := lower(btrim(p_cmd));
    v_cmd_safe := CASE WHEN v_cmd ~ '^[a-z0-9_.:-]{0,32}$' THEN v_cmd ELSE '' END;
    v_proj := platform_private.telephony_projection_enabled(p_organization_id);
    v_now := clock_timestamp();

    -- Не event, history и rating: только форма запроса (имена полей и длины).
    IF v_cmd NOT IN ('event', 'history', 'rating') THEN
      v_shape := CASE WHEN p_form_shape IS NOT NULL AND jsonb_typeof(p_form_shape) = 'object'
        THEN platform_private.telephony_form_shape_of(p_form_shape, TRUE)
        ELSE platform_private.telephony_form_shape_of(p_fields, FALSE) END;
      v_event_id := platform_private.telephony_store_rejected(p_organization_id, p_request_id, v_cmd_safe,
        p_token_slot, v_sha, v_shape, v_has_link);
      INSERT INTO platform_private.telephony_runtime_state (organization_id, last_event_at)
      VALUES (p_organization_id, v_now)
      ON CONFLICT (organization_id) DO UPDATE SET last_event_at = EXCLUDED.last_event_at, updated_at = v_now;
      RETURN jsonb_build_object('status', 'rejected', 'reason', 'unknown_cmd', 'event_id', v_event_id,
        'validation_state', 'rejected');
    END IF;

    -- Белый список документированных полей: значение — строка без управляющих
    -- знаков, пустое значение не хранится. Токен, ссылка и всё чужое отбрасываются.
    IF p_fields IS NOT NULL AND jsonb_typeof(p_fields) = 'object' THEN
      FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_fields) e LOOP
        IF r.k = ANY (v_known) AND jsonb_typeof(r.v) IN ('string', 'number', 'boolean') THEN
          v_txt := left(btrim(regexp_replace(r.v #>> '{}', '[[:cntrl:]]', '', 'g')), 2048);
          IF v_txt <> '' THEN
            v_fields := v_fields || jsonb_build_object(r.k, v_txt);
          END IF;
        ELSE
          v_dropped := v_dropped + 1;
        END IF;
      END LOOP;
    END IF;
    v_fields := v_fields || jsonb_build_object('cmd', v_cmd);

    -- Мягкая проверка: документированные обязательные поля; значение неверной
    -- формы считается недостающим.
    v_required := CASE v_cmd
      WHEN 'event' THEN ARRAY['type', 'callid', 'phone', 'user', 'direction']
      WHEN 'history' THEN ARRAY['type', 'user', 'phone', 'diversion', 'start', 'duration', 'callid', 'status', 'wait']
      ELSE ARRAY['phone', 'callid', 'rating', 'user'] END;
    v_callid := v_fields ->> 'callid';
    IF v_callid IS NOT NULL AND char_length(v_callid) > 200 THEN
      v_callid := NULL;
      v_fields := v_fields - 'callid';
    END IF;
    v_second := v_fields ->> 'second_callid';
    IF v_second IS NOT NULL AND char_length(v_second) > 200 THEN
      v_second := NULL;
      v_fields := v_fields - 'second_callid';
    END IF;
    IF v_cmd = 'event' THEN
      IF v_fields ->> 'type' !~ '^[A-Za-z][A-Za-z0-9_]{0,31}$' THEN v_fields := v_fields - 'type'; END IF;
      IF lower(v_fields ->> 'direction') NOT IN ('in', 'out') THEN v_fields := v_fields - 'direction'; END IF;
    ELSIF v_cmd = 'history' THEN
      IF lower(v_fields ->> 'type') NOT IN ('in', 'out') THEN v_fields := v_fields - 'type'; END IF;
    END IF;
    v_event_type := CASE WHEN v_cmd = 'event' THEN v_fields ->> 'type' END;
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_missing
    FROM unnest(v_required) k WHERE NOT (v_fields ? k);
    v_state := CASE WHEN cardinality(v_missing) > 0 THEN 'incomplete' ELSE 'ok' END;

    -- Ключ дедупликации: SHA-256 канонической строки без токена и ссылки (§5.1).
    v_canon := concat_ws(E'\x1f', 'v1', v_cmd, COALESCE(v_fields ->> 'type', ''), COALESCE(v_callid, ''),
      COALESCE(v_second, ''), COALESCE(v_fields ->> 'user', ''), COALESCE(v_fields ->> 'status', ''),
      COALESCE(v_fields ->> 'missedStatus', ''), COALESCE(v_fields ->> 'start', ''), COALESCE(v_fields ->> 'ext', ''),
      COALESCE(v_fields ->> 'phone', ''));
    v_dedup := encode(sha256(convert_to(v_canon, 'UTF8')), 'hex');
    PERFORM pg_catalog.pg_advisory_xact_lock(
      hashtextextended('evo:telephony:dedup:' || p_organization_id::TEXT || ':' || v_dedup, 0));
    SELECT e.id, e.validation_state INTO v_existing FROM platform_private.telephony_pbx_events e
    WHERE e.organization_id = p_organization_id AND e.dedup_key = v_dedup;
    IF FOUND THEN
      SELECT w.state INTO v_work_state FROM platform_private.telephony_event_work w
      WHERE w.organization_id = p_organization_id AND w.event_id = v_existing.id;
      RETURN jsonb_build_object('status', 'deduplicated', 'event_id', v_existing.id,
        'validation_state', v_existing.validation_state, 'work_state', v_work_state);
    END IF;

    -- Внутренний звонок (короткий номер или номер сотрудника): номер в
    -- доказательстве пуст, ссылка не сохраняется.
    v_phone_raw := v_fields ->> 'phone';
    IF v_cmd IN ('event', 'history') AND v_phone_raw IS NOT NULL THEN
      v_digits := regexp_replace(v_phone_raw, '[^0-9]', '', 'g');
      v_internal := v_phone_raw ~ '^[0-9]{1,6}$'
        OR EXISTS (SELECT 1 FROM platform_private.telephony_extensions x
          WHERE x.organization_id = p_organization_id AND x.extension IS NOT NULL
            AND (x.extension = v_phone_raw OR x.extension = v_digits));
      IF v_internal THEN
        v_fields := (v_fields - 'phone') || jsonb_build_object('internal', '1');
        v_has_link := FALSE;
      END IF;
    END IF;
    v_link := CASE WHEN v_has_link THEN btrim(p_recording_link) END;

    -- Доказательство. Замок T1a на fields (23514) не отказ: пишется строка формы.
    BEGIN
      INSERT INTO platform_private.telephony_pbx_events (organization_id, request_id, cmd, event_type, pbx_callid,
        second_callid, dedup_key, body_sha256, token_slot, validation_state, missing_fields, fields, has_link)
      VALUES (p_organization_id, p_request_id, v_cmd, v_event_type, v_callid, v_second, v_dedup, v_sha,
        p_token_slot, v_state, v_missing, v_fields, v_has_link)
      RETURNING id INTO v_event_id;
    EXCEPTION WHEN SQLSTATE '23514' THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_code := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_rejected := TRUE;
    END;
    IF v_rejected THEN
      v_event_id := platform_private.telephony_store_rejected(p_organization_id, p_request_id, 'bad_' || v_cmd,
        p_token_slot, v_sha, platform_private.telephony_form_shape_of(p_fields, FALSE), p_recording_link IS NOT NULL);
      INSERT INTO platform_private.telephony_runtime_state (organization_id, last_event_at)
      VALUES (p_organization_id, v_now)
      ON CONFLICT (organization_id) DO UPDATE SET last_event_at = EXCLUDED.last_event_at, updated_at = v_now;
      RETURN jsonb_build_object('status', 'rejected', 'reason', 'fields_check', 'reason_code', v_code,
        'event_id', v_event_id, 'validation_state', 'rejected');
    END IF;

    INSERT INTO platform_private.telephony_event_work (organization_id, event_id, has_link)
    VALUES (p_organization_id, v_event_id, v_has_link)
    RETURNING id INTO v_work_id;
    INSERT INTO platform_private.telephony_runtime_state (organization_id, last_event_at)
    VALUES (p_organization_id, v_now)
    ON CONFLICT (organization_id) DO UPDATE SET last_event_at = EXCLUDED.last_event_at, updated_at = v_now;

    -- Проекция: ссылка идёт в ногу до остального; сбой оставляет доказательство и
    -- ногу, работа уходит в повтор.
    IF NOT v_proj THEN
      v_projection := 'disabled';
    ELSE
      BEGIN
        v_projection := platform_private.telephony_project_event(p_organization_id, v_event_id, v_link);
        UPDATE platform_private.telephony_event_work w SET state = 'succeeded', attempt_count = 1,
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE w.id = v_work_id;
        v_work_state := 'succeeded';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
        v_code := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
        v_projection := 'queued';
        v_work_state := 'retry_wait';
      END;
      IF v_work_state = 'retry_wait' THEN
        IF v_link IS NOT NULL THEN
          BEGIN
            PERFORM 1 FROM platform_private.telephony_place_leg(p_organization_id, v_event_id, v_link);
          EXCEPTION WHEN OTHERS THEN
            NULL; -- ссылку вернёт сверка по history/json (поле record)
          END;
        END IF;
        UPDATE platform_private.telephony_event_work w SET state = 'retry_wait', attempt_count = 1,
          next_attempt_at = clock_timestamp() + INTERVAL '60 seconds', last_error_code = v_code,
          updated_at = clock_timestamp()
        WHERE w.id = v_work_id;
      END IF;
    END IF;

    RETURN jsonb_build_object('status', 'stored', 'event_id', v_event_id, 'validation_state', v_state,
      'missing_fields', to_jsonb(v_missing), 'projection', v_projection, 'work_state', v_work_state,
      'dropped_fields', v_dropped);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
    v_code := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
    RAISE EXCEPTION 'telephony_receive_failed:%', v_code USING ERRCODE = 'PT503';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- Очередь: аренда и проекция одного элемента (повтор после сбоя приёма).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_claim_work_v1(
  p_organization_id UUID, p_lease_owner TEXT, p_limit INTEGER DEFAULT 20, p_lease_seconds INTEGER DEFAULT 120
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ; v_items JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_lease_owner IS NULL OR char_length(p_lease_owner) NOT BETWEEN 1 AND 200
    OR p_lease_owner ~ '[[:cntrl:]]' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.telephony_projection_enabled(p_organization_id) THEN
    RETURN jsonb_build_object('status', 'disabled', 'items', '[]'::JSONB);
  END IF;
  v_now := clock_timestamp();
  -- Аренда истекла, а попытки исчерпаны: мёртвое письмо.
  UPDATE platform_private.telephony_event_work w SET state = 'dead_lettered', lease_owner = NULL,
    lease_expires_at = NULL, completed_at = v_now, last_error_code = 'lease_expired', updated_at = v_now
  WHERE w.organization_id = p_organization_id AND w.state = 'leased' AND w.lease_expires_at <= v_now
    AND w.attempt_count >= w.max_attempts;
  WITH due AS (
    SELECT w.id FROM platform_private.telephony_event_work w
    WHERE w.organization_id = p_organization_id AND w.attempt_count < w.max_attempts
      AND ((w.state IN ('queued', 'retry_wait') AND w.next_attempt_at <= v_now)
        OR (w.state = 'leased' AND w.lease_expires_at <= v_now))
    ORDER BY w.next_attempt_at, w.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE platform_private.telephony_event_work w SET state = 'leased', lease_owner = p_lease_owner,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds), attempt_count = w.attempt_count + 1,
      updated_at = v_now
    FROM due WHERE w.id = due.id
    RETURNING w.id, w.attempt_count
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('work_id', c.id, 'attempt', c.attempt_count) ORDER BY c.id), '[]'::JSONB)
  INTO v_items FROM claimed c;
  RETURN jsonb_build_object('status', 'ok', 'items', v_items);
END
$$;

CREATE FUNCTION platform.telephony_project_work_v1(
  p_organization_id UUID, p_work_id UUID, p_lease_owner TEXT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  w platform_private.telephony_event_work%ROWTYPE;
  v_now TIMESTAMPTZ; v_result TEXT;
  v_sqlstate TEXT; v_constraint TEXT; v_column TEXT; v_code TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_work_id IS NULL OR p_lease_owner IS NULL
    OR char_length(p_lease_owner) NOT BETWEEN 1 AND 200 OR p_lease_owner ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.telephony_projection_enabled(p_organization_id) THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;
  SELECT * INTO w FROM platform_private.telephony_event_work x
  WHERE x.organization_id = p_organization_id AND x.id = p_work_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_now := clock_timestamp();
  IF w.state <> 'leased' OR w.lease_owner IS DISTINCT FROM p_lease_owner OR w.lease_expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'lease_lost', 'work_state', w.state);
  END IF;
  BEGIN
    v_result := platform_private.telephony_project_event(p_organization_id, w.event_id, NULL);
    UPDATE platform_private.telephony_event_work x SET state = 'succeeded', lease_owner = NULL,
      lease_expires_at = NULL, completed_at = clock_timestamp(), last_error_code = NULL, updated_at = clock_timestamp()
    WHERE x.id = w.id;
    RETURN jsonb_build_object('status', 'succeeded', 'projection', v_result, 'attempt', w.attempt_count);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
    v_code := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
  END;
  IF w.attempt_count >= w.max_attempts THEN
    UPDATE platform_private.telephony_event_work x SET state = 'dead_lettered', lease_owner = NULL,
      lease_expires_at = NULL, completed_at = clock_timestamp(), last_error_code = v_code, updated_at = clock_timestamp()
    WHERE x.id = w.id;
    RETURN jsonb_build_object('status', 'dead_lettered', 'error_code', v_code, 'attempt', w.attempt_count);
  END IF;
  UPDATE platform_private.telephony_event_work x SET state = 'retry_wait', lease_owner = NULL, lease_expires_at = NULL,
    next_attempt_at = clock_timestamp() + make_interval(secs => LEAST(60 * (1 << LEAST(w.attempt_count - 1, 10)), 3600)),
    last_error_code = v_code, updated_at = clock_timestamp()
  WHERE x.id = w.id;
  RETURN jsonb_build_object('status', 'retry_wait', 'error_code', v_code, 'attempt', w.attempt_count);
END
$$;

-- ---------------------------------------------------------------------------
-- Окно успокоения (§6.1, правило 5): звонок завершён для решений, когда по нему
-- 90 секунд тихо и итог известен. Входящий без финальных сообщений — missed;
-- исходящий без итога ждёт сверки и через час тишины уходит с needs_review.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_settle_calls_v1(p_organization_id UUID, p_limit INTEGER DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ; v_settled INTEGER := 0; v_waiting INTEGER := 0; v_flagged INTEGER := 0; v_failed INTEGER := 0;
  r RECORD; cl platform_private.telephony_calls%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.telephony_projection_enabled(p_organization_id) THEN
    RETURN jsonb_build_object('status', 'disabled', 'settled', 0);
  END IF;
  v_now := clock_timestamp();
  FOR r IN
    SELECT x.id FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_organization_id AND x.settled_at IS NULL
      AND x.last_message_at <= v_now - INTERVAL '90 seconds'
    ORDER BY x.last_message_at, x.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM platform_private.telephony_recompute_call(p_organization_id, r.id);
      SELECT * INTO cl FROM platform_private.telephony_calls x WHERE x.id = r.id;
      -- Входящий без финальных сообщений: открытые ноги закрываются как missed.
      IF cl.outcome IS NULL AND cl.direction = 'in' AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs l
        WHERE l.organization_id = p_organization_id AND l.call_id = r.id) THEN
        UPDATE platform_private.telephony_call_legs l SET state = 'missed',
          ended_at = COALESCE(l.ended_at, cl.last_message_at), updated_at = clock_timestamp()
        WHERE l.organization_id = p_organization_id AND l.call_id = r.id AND l.state IN ('ringing', 'accepted');
        PERFORM platform_private.telephony_recompute_call(p_organization_id, r.id);
        SELECT * INTO cl FROM platform_private.telephony_calls x WHERE x.id = r.id;
      END IF;
      IF cl.outcome IS NOT NULL THEN
        UPDATE platform_private.telephony_calls x SET settled_at = v_now, updated_at = clock_timestamp()
        WHERE x.id = r.id;
        v_settled := v_settled + 1;
      ELSIF cl.last_message_at <= v_now - INTERVAL '60 minutes' THEN
        UPDATE platform_private.telephony_calls x SET settled_at = v_now, needs_review = TRUE,
          updated_at = clock_timestamp()
        WHERE x.id = r.id;
        v_flagged := v_flagged + 1;
      ELSE
        v_waiting := v_waiting + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('status', 'ok', 'settled', v_settled, 'waiting', v_waiting, 'flagged', v_flagged,
    'failed', v_failed);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: частные помощники без грантов; публичные функции — только service_role.
-- ---------------------------------------------------------------------------
DO $tel289_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$tel289_private_acl$;

REVOKE ALL ON FUNCTION
  platform.telephony_receive_v1(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB),
  platform.telephony_claim_work_v1(UUID, TEXT, INTEGER, INTEGER),
  platform.telephony_project_work_v1(UUID, UUID, TEXT),
  platform.telephony_settle_calls_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_receive_v1(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB),
  platform.telephony_claim_work_v1(UUID, TEXT, INTEGER, INTEGER),
  platform.telephony_project_work_v1(UUID, UUID, TEXT),
  platform.telephony_settle_calls_v1(UUID, INTEGER)
  TO service_role;

COMMENT ON FUNCTION platform.telephony_receive_v1(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB) IS
  'Telephony T1b: service-only intake of an authenticated PBX request. Stores evidence first, dedups, falls back to a rejected form row on the fields lock (23514), places the leg with its recording link, then projects through a savepoint.';
COMMENT ON FUNCTION platform.telephony_claim_work_v1(UUID, TEXT, INTEGER, INTEGER) IS
  'Telephony T1b: service-only lease of due projection work (attempt counter, expired leases reclaimed). Closed by projection_enabled.';
COMMENT ON FUNCTION platform.telephony_project_work_v1(UUID, UUID, TEXT) IS
  'Telephony T1b: service-only projection of one leased work item; succeeded, retry_wait with backoff or dead_lettered. Closed by projection_enabled.';
COMMENT ON FUNCTION platform.telephony_settle_calls_v1(UUID, INTEGER) IS
  'Telephony T1b: service-only quiet-window tick (90 s) that sets settled_at once a call outcome is known. Closed by projection_enabled.';

-- Самопроверка: публичные функции — definer, пустой search_path, EXECUTE только у
-- service_role; помощники — без прав клиентских ролей.
DO $tel289_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname LIKE 'telephony\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t1b_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname LIKE 'telephony\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t1b_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel289_verify$;

COMMIT;
