-- 275_platform_ai_agent_autosend_schema — «ИИ-агент» P4: ночной автоответчик,
-- таблицы и чистые помощники. Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md
-- §5.2–5.4, §11 (правила 1–13 и таблица «Где проверяется»), §15 P4, §18
-- Q5–Q9, Q11; ADR 0031; docs/PLAN_CHANGES.md (07.10, P4).
--
-- Что делает:
--  * platform_private.ai_autosend_settings — одна строка на организацию:
--    выключен (enabled = false), «Проверка без отправки» (shadow_mode = true),
--    до трёх чатов живого теста, недельное расписание (0–2 окна в день,
--    from >= to — через полночь, окно принадлежит дню начала; по умолчанию
--    ежедневно 20:00–09:00), до 50 интервалов дат «включён весь день» /
--    «выключен» (≤ 31 дня), рабочие дни (пн–пт), часовой пояс Asia/Bishkek
--    (CHECK), задержка 30 ≤ min ≤ max ≤ 90 с, лимиты не выше 4 в чате за час,
--    8 в чате за ночь, 30 на номер за час, финальные фразы {ru,ky,en} ×
--    {tomorrow, day} с подтверждением (RU подтверждена словами владельца,
--    KY/EN — нет; day держит ровно один {day}; без цифр и ссылок),
--    строка-раскрытие (§18 Q11; включена, не подтверждена), ответственный,
--    пауза, счётчики ошибок, версия;
--  * platform_private.ai_autosend_log — журнал решений: одно решение на
--    сообщение клиента (UNIQUE (org, client_message_id), правило 8), интервал,
--    статус, режим, вид, причина (и код агента, почему сказана финальная
--    фраза), язык, текст ≤ 1000 и его SHA-256 (CHECK),
--    предложенные ⊇ процитированные фрагменты, квалификация, день звонка,
--    время отправки, ссылки на авторизацию и работу, аренда;
--  * ai_autosend_exclusions (чат выключен сотрудником; ночное состояние не
--    хранится — выводится из журнала), ai_autosend_summaries (утренняя
--    сводка: счётчики, причины, день звонка, задача, квалификация — без
--    текста клиента), ai_autosend_call_tasks (задача «Позвонить клиенту» —
--    один раз на чат и сводку);
--  * помощники без грантов: ai_autosend_settings_row, валидаторы настроек,
--    ai_autosend_window (окно по Бишкеку ±14 дней: недельные окна и дни «вкл»
--    минус дни «выкл», склейка «островами»; остров длиннее суток режется в
--    каждые 12:00 по Бишкеку, поэтому начало интервала не зависит от «сейчас»),
--    ai_autosend_final_phrase, ai_autosend_language_confirmed,
--    ai_autosend_patterns (единый источник стоп-слов и ссылок, его же получает
--    агент), ai_autosend_fold / _fold_variants (NFKC, точки-двойники,
--    невидимые символы, слова из смеси латиницы и кириллицы),
--    ai_autosend_text_reason, ai_autosend_digits, ai_autosend_number_tokens,
--    ai_autosend_numbers_ok, ai_autosend_qualification_ok,
--    ai_autosend_reason_ru, ai_autosend_shadow_nights (ночи проверки: разные
--    ночи по Бишкеку среди сводок последних 30 дней хотя бы с одним ответом
--    shadow), ai_autosend_mode
--    (live / live_test — только после трёх ночей проверки / shadow).
--
-- Безопасно для production: только новые таблицы и функции; автоответчик
-- выключен. Внешние ключи на communication_conversations и
-- communication_messages до конца транзакции миграции держат на них SHARE ROW
-- EXCLUSIVE (проверка мгновенная — таблицы новые и пустые), как 274.
-- Повторный запуск в той же точке цепочки ничего не меняет.
BEGIN;

DO $ai275_preconditions$
BEGIN
  IF to_regclass('platform_private.ai_client_memory') IS NULL
    OR to_regprocedure('platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_p4_requires_274' USING ERRCODE = '55000';
  END IF;
END
$ai275_preconditions$;

-- ---------------------------------------------------------------------------
-- Валидаторы настроек (IMMUTABLE; используются в CHECK).
-- ---------------------------------------------------------------------------

-- Недельное расписание: ровно ключи mon..sun, у каждого 0–2 окна
-- {"from":"HH:MM","to":"HH:MM"}.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_schedule_ok(p_schedule JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_schedule IS NOT NULL AND jsonb_typeof(p_schedule) = 'object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_schedule) k)
      = ARRAY['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed']
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_schedule) d
      WHERE jsonb_typeof(d.value) <> 'array' OR jsonb_array_length(d.value) > 2
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.value) s
          WHERE jsonb_typeof(s) <> 'object'
            OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM ARRAY['from', 'to']
            OR jsonb_typeof(s -> 'from') <> 'string' OR jsonb_typeof(s -> 'to') <> 'string'
            OR (s ->> 'from') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            OR (s ->> 'to') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
$$;

-- Дата YYYY-MM-DD (настоящая дата) или NULL.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_date(p_text TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN make_date(substr(p_text, 1, 4)::INTEGER, substr(p_text, 6, 2)::INTEGER, substr(p_text, 9, 2)::INTEGER);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

-- Интервалы дат: до 50 {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","mode":"on|off"},
-- from ≤ to, не длиннее 31 дня.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_overrides_ok(p_overrides JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) = 'array' AND jsonb_array_length(p_overrides) <= 50
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_overrides) o
      WHERE jsonb_typeof(o) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(o) k) IS DISTINCT FROM ARRAY['from', 'mode', 'to']
        OR jsonb_typeof(o -> 'mode') <> 'string' OR (o ->> 'mode') NOT IN ('on', 'off')
        OR jsonb_typeof(o -> 'from') <> 'string' OR jsonb_typeof(o -> 'to') <> 'string'
        OR platform_private.ai_autosend_date(o ->> 'from') IS NULL
        OR platform_private.ai_autosend_date(o ->> 'to') IS NULL
        OR platform_private.ai_autosend_date(o ->> 'to') < platform_private.ai_autosend_date(o ->> 'from')
        OR platform_private.ai_autosend_date(o ->> 'to') - platform_private.ai_autosend_date(o ->> 'from') > 30)
$$;

-- ---------------------------------------------------------------------------
-- Текст (правила 5, 7, 13): единый источник шаблонов и нормализация.
-- ---------------------------------------------------------------------------

-- Единый источник стоп-слов (правило 7), ссылок и длины (правило 13) и
-- пометок [n]. Основы ищутся с начала слова без учёта регистра; ссылка — где
-- угодно. Его же получает агент (autosend_context_v1) — во фрагментах,
-- совместимых с Python `re` (граница слова — `(?<![\w])`, флаг IGNORECASE).
-- Ссылка — любой «метка.домен» (домен из 2+ латинских букв или
-- кириллический домен из списка; пробел перед точкой допускается), а также
-- http(s), www, wa.me и t.me с пробелами.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_patterns()
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('version', 3,
    'stems', jsonb_build_array(
      -- Обещания.
      'гарант', 'обеща', 'скидк', 'акци', 'бесплатн', 'промокод', 'возврат',
      -- Оплата, деньги, способы оплаты. «плач» — формы глагола «платить»
      -- («оплачивается», «доплачу», «уплачено»); «плачет» тоже стоп — это
      -- лишь финальная фраза вместо ответа, отправки он не открывает.
      'оплат', 'предоплат', '(за|до|вы|у|пере|по)?плат(?!форм)', '(не|пред)?оплач', '(за|до|вы|у|пере|рас)?плач',
      'рассрочк', 'квитанц', 'взнос', 'аванс', 'залог', 'реквизит', 'сч[её]т',
      'карт(а|у|ой|е|ы|очк)', 'перевод', 'переведите', 'перев[её]д', 'перевест', 'перечисл(?!енн)', 'деньг', 'денеж',
      'наличн', 'касс(а|у|е|ы|ир|ов)', 'kaspi', 'mbank', 'элсом', 'elsom', 'элкарт', 'elcart', 'master\s*card',
      'мастер\s*кард', 'visa\s*/\s*master', 'qiwi', 'megapay', 'мегапэй', 'o!\s*dengi', 'odengi', 'юмани', 'yoomoney',
      'unistream', 'юнистрим', 'western\s*union', 'золот(ая|ой|ую)\s+корон',
      -- Кыргызский.
      'кепилд', 'арзандат', 'акысыз', 'төлө', 'акча', 'накталай',
      -- Английский.
      'guarantee', 'discount', 'free', 'refund', 'pay', '(pre|re)pay', '(pre|un|re)?paid', 'instal{1,2}ment',
      'invoice', 'card', 'transfer', 'iban', 'cash', 'deposit', 'money', 'fees?(?![a-z])'),
    'links', jsonb_build_array('https?:/', 'www\.', 'wa\s*\.?\s*me\s*/', 't\s*\.\s*me\s*/',
      '[0-9a-zа-яёәөүңһ][0-9a-zа-яёәөүңһ-]*\s?\.(?:[a-z]{2,24}(?![0-9a-z])|(?:рф|рус|бел|укр|қаз|срб|мкд|мон|орг|ком|сайт|онлайн|дети|москва)(?![а-яё]))'),
    'marker', '\[[0-9]{1,3}\]',
    'maxLength', 1000)
$$;

-- Текст для сравнения: NFKC (полноширинные буквы и точки, лигатуры), без
-- невидимых символов, точки-двойники («。», «·», «[.]», «(dot)», « dot »,
-- « точка ») — точкой, нижний регистр без зависимости от локали базы
-- (кириллица RU/KY переводится явно, латиница — lower()).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_fold(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(regexp_replace(
    translate(lower(translate(normalize(COALESCE(p_text, ''), NFKC),
      'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘӨҮҢҺ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәөүңһ')),
      E'。·∙⋅​‌‍⁠﻿­', '....'),
    '[\[\(\{<]\s*(\.|dot|точка)\s*[\]\)\}>]', '.', 'g'),
    '\s+(dot|точка)\s+', '.', 'g')
$$;

-- Три варианта текста для сравнения: свёрнутый; слова из смеси латиницы и
-- кириллицы — латинские двойники кириллицей («oплатите» → «оплатите»); те
-- же слова — кириллические двойники латиницей («еvо.kg» → «evo.kg»). Слова
-- одного алфавита не меняются (иначе «раунд» стал бы «payнд»).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_fold_variants(p_text TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH a AS (SELECT platform_private.ai_autosend_fold(p_text) AS t),
  w AS (SELECT x.w, x.o, x.w ~ '[a-z]' AND x.w ~ '[а-яёәөүңһ]' AS mixed
    FROM a CROSS JOIN LATERAL regexp_split_to_table(a.t, '\s+') WITH ORDINALITY AS x(w, o))
  SELECT ARRAY[(SELECT a.t FROM a),
    COALESCE((SELECT string_agg(CASE WHEN w.mixed THEN translate(w.w, 'aceopxykmhtb', 'асеорхукмнтв') ELSE w.w END, ' '
      ORDER BY w.o) FROM w), ''),
    COALESCE((SELECT string_agg(CASE WHEN w.mixed THEN translate(w.w, 'асеорхукмнтвіј', 'aceopxykmhtbij') ELSE w.w END, ' '
      ORDER BY w.o) FROM w), '')]
$$;

-- Причина отказа по тексту (правила 7 и 13 и пометки [n]) или NULL. Каждый
-- шаблон проверяется на всех трёх вариантах текста.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_text_reason(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH p AS (SELECT platform_private.ai_autosend_patterns() AS j),
  v AS (SELECT platform_private.ai_autosend_fold_variants(p_text) AS t),
  r AS (SELECT
    (SELECT '(' || string_agg('(?:' || (l #>> '{}') || ')', '|') || ')' FROM p, jsonb_array_elements(p.j -> 'links') l)
      AS links,
    (SELECT '(^|[^0-9a-zа-яёәөүңһ_])(' || string_agg('(?:' || (s #>> '{}') || ')', '|') || ')'
      FROM p, jsonb_array_elements(p.j -> 'stems') s) AS stems)
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN 'empty_text'
    WHEN char_length(p_text) > 1000 THEN 'too_long'
    WHEN EXISTS (SELECT 1 FROM unnest(v.t) x WHERE x ~ r.links) THEN 'link'
    WHEN v.t[1] ~ '\[[0-9]{1,3}\]' THEN 'marker'
    WHEN EXISTS (SELECT 1 FROM unnest(v.t) x WHERE x ~ r.stems) THEN 'stop_word'
  END
  FROM v, r
$$;

-- Цифры любой записи — ASCII: NFKC («１５００» → 1500, «½» → 1⁄2, «²» → 2),
-- затем арабско-индийские, восточно-арабские и деванагари.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_digits(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT translate(normalize(COALESCE(p_text, ''), NFKC),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९', '012345678901234567890123456789')
$$;

-- Числа текста: пробел (обычный, U+00A0, U+202F) перед группой из трёх цифр
-- снимается («1 500» → «1500»), запятая между цифрами становится точкой;
-- токен — цифры с точками между группами; pct — за ним «%». Цифры любой
-- записи сначала приводятся к ASCII.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_number_tokens(p_text TEXT)
RETURNS TABLE (token TEXT, pct BOOLEAN) LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT m[1], m[2] IS NOT NULL
  FROM regexp_matches(regexp_replace(regexp_replace(platform_private.ai_autosend_digits(p_text),
      '([0-9])[   ](?=[0-9]{3}(?![0-9]))', '\1', 'g'),
      '([0-9]),(?=[0-9])', '\1.', 'g'),
    '([0-9]+(?:\.[0-9]+)*)([   ]?%)?', 'g') m
$$;

-- Текст фразы или раскрытия: одна строка, без цифр (любой записи), ссылок,
-- стоп-слов, скобок кроме одного {day} у варианта day.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_phrase_text_ok(p_text TEXT, p_max INTEGER, p_day BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_text IS NOT NULL AND p_text = btrim(p_text) AND char_length(p_text) BETWEEN 1 AND p_max
    AND p_text !~ '[[:cntrl:]]' AND p_text !~ '[0-9]'
    AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_number_tokens(p_text))
    AND platform_private.ai_autosend_text_reason(p_text) IS NULL
    AND p_text !~ '[\[\]<>]'
    AND CASE WHEN p_day
      THEN (char_length(p_text) - char_length(replace(p_text, '{day}', ''))) = 5
        AND replace(p_text, '{day}', '') !~ '[{}]'
      ELSE p_text !~ '[{}]' END
$$;

-- Финальные фразы: {ru,ky,en} × {tomorrow, day}, каждая {text, confirmed}.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_phrases_ok(p_phrases JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_phrases IS NOT NULL AND jsonb_typeof(p_phrases) = 'object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_phrases) k) = ARRAY['en', 'ky', 'ru']
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_phrases) l
      WHERE jsonb_typeof(l.value) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(l.value) k) IS DISTINCT FROM ARRAY['day', 'tomorrow']
        OR EXISTS (SELECT 1 FROM jsonb_each(l.value) v
          WHERE jsonb_typeof(v.value) <> 'object'
            OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v.value) k) IS DISTINCT FROM ARRAY['confirmed', 'text']
            OR jsonb_typeof(v.value -> 'confirmed') <> 'boolean' OR jsonb_typeof(v.value -> 'text') <> 'string'
            OR NOT platform_private.ai_autosend_phrase_text_ok(v.value ->> 'text', 300, v.key = 'day')))
$$;

-- Строка-раскрытие: {ru,ky,en}, каждая {text, confirmed}, ≤ 200, без {day}.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_disclosure_ok(p_disclosure JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_disclosure IS NOT NULL AND jsonb_typeof(p_disclosure) = 'object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_disclosure) k) = ARRAY['en', 'ky', 'ru']
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_disclosure) l
      WHERE jsonb_typeof(l.value) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(l.value) k) IS DISTINCT FROM ARRAY['confirmed', 'text']
        OR jsonb_typeof(l.value -> 'confirmed') <> 'boolean' OR jsonb_typeof(l.value -> 'text') <> 'string'
        OR NOT platform_private.ai_autosend_phrase_text_ok(l.value ->> 'text', 200, FALSE))
$$;

-- Квалификация (§11): только ключи country, level, timing, budget,
-- grade_or_age, city, call_time; строки 1..140 в одну строку без телефонов
-- и e-mail (ai_memory_text_ok, 274). NULL — допустимо.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_qualification_ok(p_qualification JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_qualification IS NULL OR (jsonb_typeof(p_qualification) = 'object'
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_qualification) q
      WHERE q.key NOT IN ('country', 'level', 'timing', 'budget', 'grade_or_age', 'city', 'call_time')
        OR jsonb_typeof(q.value) <> 'string' OR char_length(q.value #>> '{}') NOT BETWEEN 1 AND 140
        OR (q.value #>> '{}') <> btrim(q.value #>> '{}') OR (q.value #>> '{}') ~ '[[:cntrl:]]'
        OR NOT platform_private.ai_memory_text_ok(q.value #>> '{}')))
$$;

-- ---------------------------------------------------------------------------
-- Таблицы.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_private.ai_autosend_settings (
  organization_id UUID PRIMARY KEY REFERENCES platform.organizations(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_mode BOOLEAN NOT NULL DEFAULT TRUE,
  live_test_conversation_ids UUID[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(live_test_conversation_ids) <= 3 AND array_position(live_test_conversation_ids, NULL) IS NULL),
  schedule JSONB NOT NULL DEFAULT '{"mon":[{"from":"20:00","to":"09:00"}],"tue":[{"from":"20:00","to":"09:00"}],"wed":[{"from":"20:00","to":"09:00"}],"thu":[{"from":"20:00","to":"09:00"}],"fri":[{"from":"20:00","to":"09:00"}],"sat":[{"from":"20:00","to":"09:00"}],"sun":[{"from":"20:00","to":"09:00"}]}'::JSONB
    CHECK (platform_private.ai_autosend_schedule_ok(schedule)),
  date_overrides JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (platform_private.ai_autosend_overrides_ok(date_overrides)),
  working_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}'
    CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ '{1,2,3,4,5,6,7}'::SMALLINT[]
      AND array_position(working_days, NULL) IS NULL),
  timezone TEXT NOT NULL DEFAULT 'Asia/Bishkek' CHECK (timezone = 'Asia/Bishkek'),
  delay_min_s INTEGER NOT NULL DEFAULT 30,
  delay_max_s INTEGER NOT NULL DEFAULT 90,
  limit_chat_hour INTEGER NOT NULL DEFAULT 4 CHECK (limit_chat_hour BETWEEN 1 AND 4),
  limit_chat_night INTEGER NOT NULL DEFAULT 8 CHECK (limit_chat_night BETWEEN 1 AND 8),
  limit_number_hour INTEGER NOT NULL DEFAULT 30 CHECK (limit_number_hour BETWEEN 1 AND 30),
  phrases JSONB NOT NULL DEFAULT jsonb_build_object(
    'ru', jsonb_build_object(
      'tomorrow', jsonb_build_object('text', 'Завтра в рабочее время вам позвонит наш руководитель.', 'confirmed', TRUE),
      'day', jsonb_build_object('text', '{day} в рабочее время вам позвонит наш руководитель.', 'confirmed', TRUE)),
    'ky', jsonb_build_object(
      'tomorrow', jsonb_build_object('text', 'Эртең иш убактысында биздин жетекчи сизге чалат.', 'confirmed', FALSE),
      'day', jsonb_build_object('text', '{day} иш убактысында биздин жетекчи сизге чалат.', 'confirmed', FALSE)),
    'en', jsonb_build_object(
      'tomorrow', jsonb_build_object('text', 'Our manager will call you tomorrow during business hours.', 'confirmed', FALSE),
      'day', jsonb_build_object('text', 'Our manager will call you {day} during business hours.', 'confirmed', FALSE)))
    CHECK (platform_private.ai_autosend_phrases_ok(phrases)),
  disclosure_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  disclosure JSONB NOT NULL DEFAULT jsonb_build_object(
    'ru', jsonb_build_object('text', 'Пишет автоматический помощник EVO — менеджеры сейчас не на связи.', 'confirmed', FALSE),
    'ky', jsonb_build_object('text', 'EVO автоматтык жардамчысы жазып жатат — менеджерлер азыр байланышта эмес.', 'confirmed', FALSE),
    'en', jsonb_build_object('text', 'This is the EVO automatic assistant — our managers are offline right now.', 'confirmed', FALSE))
    CHECK (platform_private.ai_autosend_disclosure_ok(disclosure)),
  responsible_membership_id UUID,
  enabled_at TIMESTAMPTZ,
  enabled_by UUID,
  pause_code TEXT CHECK (pause_code IN ('provider_down', 'provider_restricted', 'send_errors', 'gemini_error',
    'gemini_billing', 'server_switch_off', 'manual')),
  pause_by_kind TEXT CHECK (pause_by_kind IN ('system', 'agent', 'service', 'user')),
  paused_at TIMESTAMPTZ,
  paused_by UUID,
  send_error_streak INTEGER NOT NULL DEFAULT 0 CHECK (send_error_streak >= 0),
  gemini_error_streak INTEGER NOT NULL DEFAULT 0 CHECK (gemini_error_streak >= 0),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by UUID,
  CONSTRAINT ai_autosend_settings_delay_check CHECK (30 <= delay_min_s AND delay_min_s <= delay_max_s AND delay_max_s <= 90),
  CONSTRAINT ai_autosend_settings_pause_check CHECK ((pause_code IS NULL) = (pause_by_kind IS NULL)
    AND (pause_code IS NULL) = (paused_at IS NULL) AND (paused_by IS NULL OR pause_by_kind = 'user')),
  CONSTRAINT ai_autosend_settings_enabled_check CHECK (NOT enabled
    OR (responsible_membership_id IS NOT NULL AND enabled_at IS NOT NULL)),
  CONSTRAINT ai_autosend_settings_responsible_fkey FOREIGN KEY (organization_id, responsible_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);
COMMENT ON TABLE platform_private.ai_autosend_settings IS
  'AI agent P4: night autoresponder settings, one row per organization. Ships disabled and in shadow mode; limits can only be lowered (CHECK).';

CREATE TABLE IF NOT EXISTS platform_private.ai_autosend_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  conversation_id UUID NOT NULL,
  client_message_id UUID NOT NULL,
  source_at TIMESTAMPTZ NOT NULL,
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'considering' CHECK (status IN ('considering', 'scheduled', 'authorized', 'sent',
    'failed', 'unknown', 'skipped', 'shadow', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'shadow', 'live_test')),
  kind TEXT CHECK (kind IN ('answer', 'final_phrase')),
  reason_code TEXT CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  reason_ru TEXT CHECK (char_length(reason_ru) BETWEEN 1 AND 200),
  -- Почему агент сказал финальную фразу вместо ответа (код агента, только
  -- у kind = final_phrase); reason_code — причина пропуска или отмены.
  final_reason_code TEXT CHECK (final_reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  language TEXT CHECK (language IN ('ru', 'ky', 'en')),
  body TEXT CHECK (char_length(body) BETWEEN 1 AND 1000),
  text TEXT CHECK (char_length(text) BETWEEN 1 AND 1000 AND text = btrim(text)),
  text_sha256 TEXT,
  offered_chunk_ids BIGINT[] NOT NULL DEFAULT '{}' CHECK (cardinality(offered_chunk_ids) <= 64),
  cited_chunk_ids BIGINT[] NOT NULL DEFAULT '{}' CHECK (cardinality(cited_chunk_ids) <= 16),
  qualification JSONB CHECK (platform_private.ai_autosend_qualification_ok(qualification)),
  call_date DATE,
  send_at TIMESTAMPTZ,
  delay_s INTEGER CHECK (delay_s BETWEEN 30 AND 90),
  model TEXT CHECK (model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'),
  manual_send_authorization_id UUID,
  work_item_id UUID,
  outcome_code TEXT CHECK (outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  lease_owner TEXT CHECK (char_length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  committed_at TIMESTAMPTZ,
  authorized_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_autosend_log_message_key UNIQUE (organization_id, client_message_id),
  CONSTRAINT ai_autosend_log_identity_key UNIQUE (organization_id, id, conversation_id, client_message_id),
  CONSTRAINT ai_autosend_log_message_fkey FOREIGN KEY (organization_id, client_message_id, conversation_id)
    REFERENCES platform.communication_messages(organization_id, id, conversation_id) ON DELETE CASCADE,
  CONSTRAINT ai_autosend_log_interval_check CHECK (interval_end > interval_start),
  CONSTRAINT ai_autosend_log_text_sha_check CHECK ((text IS NULL AND text_sha256 IS NULL)
    OR text_sha256 = encode(sha256(convert_to(text, 'UTF8')), 'hex')),
  CONSTRAINT ai_autosend_log_cited_check CHECK (cited_chunk_ids <@ offered_chunk_ids),
  CONSTRAINT ai_autosend_log_committed_check CHECK (status IN ('considering', 'skipped', 'cancelled')
    OR (kind IS NOT NULL AND language IS NOT NULL AND body IS NOT NULL AND text IS NOT NULL AND send_at IS NOT NULL
      AND delay_s IS NOT NULL AND committed_at IS NOT NULL)),
  CONSTRAINT ai_autosend_log_shadow_check CHECK (status <> 'shadow' OR mode = 'shadow'),
  CONSTRAINT ai_autosend_log_live_check CHECK (status NOT IN ('scheduled', 'authorized', 'sent', 'failed', 'unknown')
    OR mode IN ('live', 'live_test')),
  -- Авторизация есть у authorized/sent/failed/unknown и у cancelled, отменённой
  -- до claim (работа снята с очереди); у остальных — нет.
  CONSTRAINT ai_autosend_log_authorized_check CHECK ((manual_send_authorization_id IS NULL) = (work_item_id IS NULL)
    AND (manual_send_authorization_id IS NULL) = (authorized_at IS NULL)
    AND (status NOT IN ('authorized', 'sent', 'failed', 'unknown') OR manual_send_authorization_id IS NOT NULL)
    AND (manual_send_authorization_id IS NULL OR status IN ('authorized', 'sent', 'failed', 'unknown', 'cancelled'))),
  CONSTRAINT ai_autosend_log_final_phrase_check CHECK ((kind = 'final_phrase') = (call_date IS NOT NULL)),
  CONSTRAINT ai_autosend_log_final_reason_check CHECK (final_reason_code IS NULL OR kind = 'final_phrase'),
  CONSTRAINT ai_autosend_log_skip_reason_check CHECK (status NOT IN ('skipped', 'cancelled')
    OR (reason_code IS NOT NULL AND reason_ru IS NOT NULL)),
  CONSTRAINT ai_autosend_log_lease_check CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ai_autosend_log_conversation_idx
  ON platform_private.ai_autosend_log (organization_id, conversation_id, interval_start, committed_at);
CREATE INDEX IF NOT EXISTS ai_autosend_log_committed_idx
  ON platform_private.ai_autosend_log (organization_id, committed_at) WHERE committed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_autosend_log_page_idx
  ON platform_private.ai_autosend_log (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_autosend_log_interval_idx
  ON platform_private.ai_autosend_log (organization_id, interval_start, interval_end);
CREATE INDEX IF NOT EXISTS ai_autosend_log_scheduled_idx
  ON platform_private.ai_autosend_log (send_at) WHERE status = 'scheduled';
COMMENT ON TABLE platform_private.ai_autosend_log IS
  'AI agent P4: one autoresponder decision per client message (rule 8). The stored text and its SHA-256 are the only text a send may use (rule 9).';

CREATE TABLE IF NOT EXISTS platform_private.ai_autosend_exclusions (
  conversation_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_autosend_exclusions_conversation_fkey FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_private.ai_autosend_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  shadow_night BOOLEAN NOT NULL,
  counts JSONB NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND octet_length(items::TEXT) <= 1048576),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  lease_owner TEXT CHECK (char_length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_autosend_summaries_interval_key UNIQUE (organization_id, interval_start),
  CONSTRAINT ai_autosend_summaries_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT ai_autosend_summaries_interval_check CHECK (interval_end > interval_start),
  CONSTRAINT ai_autosend_summaries_lease_check CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE IF NOT EXISTS platform_private.ai_autosend_call_tasks (
  summary_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  call_date DATE NOT NULL,
  staff_task_id UUID,
  skipped_reason TEXT CHECK (skipped_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (summary_id, conversation_id),
  CONSTRAINT ai_autosend_call_tasks_summary_fkey FOREIGN KEY (organization_id, summary_id)
    REFERENCES platform_private.ai_autosend_summaries(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_autosend_call_tasks_task_fkey FOREIGN KEY (organization_id, staff_task_id)
    REFERENCES platform.staff_tasks(organization_id, id),
  CONSTRAINT ai_autosend_call_tasks_outcome_check CHECK ((staff_task_id IS NULL) <> (skipped_reason IS NULL))
);

DO $ai275_lockdown$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_autosend_settings', 'ai_autosend_log', 'ai_autosend_exclusions',
    'ai_autosend_summaries', 'ai_autosend_call_tasks'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform_private.%I FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'platform_private' AND tablename = t) THEN
      RAISE EXCEPTION 'ai_agent_table_has_policies: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$ai275_lockdown$;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_private.ai_autosend_settings_row(p_organization_id UUID)
RETURNS platform_private.ai_autosend_settings LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_autosend_settings;
BEGIN
  SELECT * INTO v_settings FROM platform_private.ai_autosend_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND THEN
    INSERT INTO platform_private.ai_autosend_settings (organization_id)
    SELECT o.id FROM platform.organizations o WHERE o.id = p_organization_id
    ON CONFLICT (organization_id) DO NOTHING;
    SELECT * INTO v_settings FROM platform_private.ai_autosend_settings s WHERE s.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_settings;
END
$$;

-- «Ночи проверки» (§15 P4): разные ночи по Бишкеку среди сводок интервалов,
-- закончившихся за последние 30 дней, в которых есть хотя бы один ответ
-- shadow (статус shadow) — ночь, где всё пропущено, нечего смотреть, а давняя
-- проверка не разрешает живой режим. Ночь интервала — местная дата его
-- начала, до 05:00 — предыдущая (как якорь финальной фразы): два-три окна в
-- одни сутки (или вечер и ранее утро) — одна ночь, а не несколько.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_shadow_nights(p_organization_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(DISTINCT ((s.interval_start AT TIME ZONE 'Asia/Bishkek') - INTERVAL '5 hours')::DATE)::INTEGER
  FROM platform_private.ai_autosend_summaries s
  WHERE s.organization_id = p_organization_id AND s.interval_end > clock_timestamp() - INTERVAL '30 days'
    AND COALESCE((s.counts ->> 'shadow')::INTEGER, 0) >= 1
$$;

-- Режим решения для чата: live (не shadow), live_test (shadow, чат из списка
-- живого теста и уже есть три ночи проверки — порядок §11: shadow, затем
-- живой тест, затем живой режим) или shadow.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_mode(p_settings platform_private.ai_autosend_settings,
  p_conversation_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT p_settings.shadow_mode THEN 'live'
    WHEN p_conversation_id = ANY (p_settings.live_test_conversation_ids)
      AND platform_private.ai_autosend_shadow_nights(p_settings.organization_id) >= 3 THEN 'live_test'
    ELSE 'shadow' END
$$;

-- Окно автоответчика в момент p_at (§11, «За ночь» — 24-часовые отрезки от
-- intervalStart). Недельные окна (from >= to — через полночь, окно
-- принадлежит дню начала; from = to — сутки) и дни «включён весь день»
-- становятся диапазонами по Бишкеку, дни «выключен» вычитаются, диапазоны
-- склеиваются (multirange) в пределах p_at ± 14 дней. Остров длиннее суток
-- режется в каждые 12:00 по Бишкеку: так у него детерминированные интервалы
-- (не зависят от p_at и обрезки ±14 дней), а сводка и финальная фраза — раз
-- в сутки. Обычные ночные окна (≤ 24 ч) не режутся. {inside, intervalStart,
-- intervalEnd, nextStart}.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_window(p_settings platform_private.ai_autosend_settings,
  p_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH base AS (
    SELECT (p_at AT TIME ZONE 'Asia/Bishkek')::DATE AS d0
  ), days AS (
    SELECT (b.d0 + g)::DATE AS d FROM base b CROSS JOIN generate_series(-15, 15) g
  ), ranges AS (
    SELECT tstzrange((d.d + (s ->> 'from')::TIME) AT TIME ZONE 'Asia/Bishkek',
      ((CASE WHEN (s ->> 'from')::TIME < (s ->> 'to')::TIME THEN d.d ELSE d.d + 1 END) + (s ->> 'to')::TIME)
        AT TIME ZONE 'Asia/Bishkek', '[)') AS r
    FROM days d
    CROSS JOIN LATERAL jsonb_array_elements(p_settings.schedule
      -> (ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow FROM d.d)::INTEGER]) s
    UNION ALL
    SELECT tstzrange(platform_private.ai_autosend_date(o ->> 'from')::TIMESTAMP AT TIME ZONE 'Asia/Bishkek',
      (platform_private.ai_autosend_date(o ->> 'to') + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek', '[)')
    FROM jsonb_array_elements(p_settings.date_overrides) o WHERE o ->> 'mode' = 'on'
  ), offs AS (
    SELECT range_agg(tstzrange(platform_private.ai_autosend_date(o ->> 'from')::TIMESTAMP AT TIME ZONE 'Asia/Bishkek',
      (platform_private.ai_autosend_date(o ->> 'to') + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek', '[)')) AS m
    FROM jsonb_array_elements(p_settings.date_overrides) o WHERE o ->> 'mode' = 'off'
  ), merged AS (
    SELECT (COALESCE((SELECT range_agg(r.r) FROM ranges r), '{}'::TSTZMULTIRANGE)
      - COALESCE((SELECT m FROM offs), '{}'::TSTZMULTIRANGE))
      * tstzmultirange(tstzrange(p_at - INTERVAL '14 days', p_at + INTERVAL '14 days', '[)')) AS m
  ), whole AS (
    SELECT u.i FROM merged CROSS JOIN LATERAL unnest(merged.m) AS u(i)
  ), islands AS (
    SELECT w.i FROM whole w WHERE upper(w.i) - lower(w.i) <= INTERVAL '24 hours'
    UNION ALL
    SELECT w.i * tstzrange((d.d + TIME '12:00') AT TIME ZONE 'Asia/Bishkek',
      (d.d + 1 + TIME '12:00') AT TIME ZONE 'Asia/Bishkek', '[)')
    FROM whole w CROSS JOIN days d
    WHERE upper(w.i) - lower(w.i) > INTERVAL '24 hours'
      AND w.i && tstzrange((d.d + TIME '12:00') AT TIME ZONE 'Asia/Bishkek',
        (d.d + 1 + TIME '12:00') AT TIME ZONE 'Asia/Bishkek', '[)')
  )
  SELECT jsonb_build_object('inside', h.i IS NOT NULL, 'intervalStart', lower(h.i), 'intervalEnd', upper(h.i),
    'nextStart', (SELECT min(lower(x.i)) FROM islands x WHERE lower(x.i) > p_at))
  FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT x.i FROM islands x WHERE x.i @> p_at LIMIT 1) h ON TRUE
$$;

-- Подтверждён ли язык для живого режима: обе финальные фразы и (если
-- раскрытие включено) строка-раскрытие.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_language_confirmed(
  p_settings platform_private.ai_autosend_settings, p_language TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_language IN ('ru', 'ky', 'en')
    AND COALESCE((p_settings.phrases -> p_language -> 'tomorrow' ->> 'confirmed')::BOOLEAN, FALSE)
    AND COALESCE((p_settings.phrases -> p_language -> 'day' ->> 'confirmed')::BOOLEAN, FALSE)
    AND (NOT p_settings.disclosure_enabled
      OR COALESCE((p_settings.disclosure -> p_language ->> 'confirmed')::BOOLEAN, FALSE))
$$;

-- Финальная фраза (§11, §18 Q6). D — первая дата, у которой D 10:00 по
-- Бишкеку позже p_at, день недели D в working_days и D не дата «включён весь
-- день». Якорь — местная дата p_at, до 05:00 — предыдущий день. D = якорь + 1
-- → вариант tomorrow; иначе day, где {day} — «Сегодня» (D = якорь), «В
-- понедельник»…«В воскресенье» (до 6 дней вперёд) или дата («12 октября»).
-- Слова дня KY/EN — черновые (dayWordsReview). NULL — рабочего дня в
-- ближайшие 60 дней нет. {text, variant, callDate, day, confirmed,
-- dayWordsReview}.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_final_phrase(p_settings platform_private.ai_autosend_settings,
  p_language TEXT, p_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_local TIMESTAMP; v_anchor DATE; v_day DATE; v_variant TEXT; v_word TEXT; v_offset INTEGER; v_i INTEGER;
  v_dow INTEGER; v_template TEXT;
BEGIN
  IF p_language IS NULL OR p_language NOT IN ('ru', 'ky', 'en') OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  v_local := p_at AT TIME ZONE 'Asia/Bishkek';
  v_anchor := v_local::DATE - CASE WHEN v_local::TIME < TIME '05:00' THEN 1 ELSE 0 END;
  FOR v_i IN 0..60 LOOP
    v_day := v_local::DATE + v_i;
    IF v_day + TIME '10:00' > v_local
      AND extract(isodow FROM v_day)::SMALLINT = ANY (p_settings.working_days)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_settings.date_overrides) o
        WHERE o ->> 'mode' = 'on' AND v_day BETWEEN platform_private.ai_autosend_date(o ->> 'from')
          AND platform_private.ai_autosend_date(o ->> 'to')) THEN
      EXIT;
    END IF;
    v_day := NULL;
  END LOOP;
  IF v_day IS NULL THEN
    RETURN NULL;
  END IF;
  v_offset := v_day - v_anchor;
  v_dow := extract(isodow FROM v_day)::INTEGER;
  IF v_offset = 1 THEN
    v_variant := 'tomorrow';
  ELSE
    v_variant := 'day';
    v_word := CASE
      WHEN v_offset = 0 THEN CASE p_language WHEN 'ru' THEN 'Сегодня' WHEN 'ky' THEN 'Бүгүн' ELSE 'today' END
      WHEN v_offset <= 6 THEN CASE p_language
        WHEN 'ru' THEN (ARRAY['В понедельник', 'Во вторник', 'В среду', 'В четверг', 'В пятницу', 'В субботу',
          'В воскресенье'])[v_dow]
        WHEN 'ky' THEN (ARRAY['Дүйшөмбү күнү', 'Шейшемби күнү', 'Шаршемби күнү', 'Бейшемби күнү', 'Жума күнү',
          'Ишемби күнү', 'Жекшемби күнү'])[v_dow]
        ELSE (ARRAY['on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday',
          'on Sunday'])[v_dow] END
      ELSE CASE p_language
        WHEN 'ru' THEN extract(day FROM v_day)::INTEGER::TEXT || ' ' || (ARRAY['января', 'февраля', 'марта', 'апреля',
          'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'])[extract(month FROM v_day)::INTEGER]
        WHEN 'ky' THEN extract(day FROM v_day)::INTEGER::TEXT || '-' || (ARRAY['январда', 'февралда', 'мартта',
          'апрелде', 'майда', 'июнда', 'июлда', 'августта', 'сентябрда', 'октябрда', 'ноябрда',
          'декабрда'])[extract(month FROM v_day)::INTEGER]
        ELSE 'on ' || extract(day FROM v_day)::INTEGER::TEXT || ' ' || (ARRAY['January', 'February', 'March', 'April',
          'May', 'June', 'July', 'August', 'September', 'October', 'November',
          'December'])[extract(month FROM v_day)::INTEGER] END
    END;
  END IF;
  v_template := p_settings.phrases -> p_language -> v_variant ->> 'text';
  RETURN jsonb_build_object('text', CASE WHEN v_variant = 'day' THEN replace(v_template, '{day}', v_word) ELSE v_template END,
    'variant', v_variant, 'callDate', v_day, 'day', v_word,
    'confirmed', COALESCE((p_settings.phrases -> p_language -> v_variant ->> 'confirmed')::BOOLEAN, FALSE),
    'dayWordsReview', v_variant = 'day' AND p_language <> 'ru');
END
$$;

-- Правило 5 (БД-часть): каждое число текста — токеном в цитируемых
-- фрагментах; процент — процентом.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_numbers_ok(p_text TEXT, p_chunk_ids BIGINT[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM platform_private.ai_autosend_number_tokens(p_text) t
    WHERE NOT EXISTS (SELECT 1 FROM platform_private.ai_chunks c
      CROSS JOIN LATERAL platform_private.ai_autosend_number_tokens(c.content) ct
      WHERE c.id = ANY (COALESCE(p_chunk_ids, '{}')) AND ct.token = t.token AND (ct.pct OR NOT t.pct)))
$$;

-- Причина по-русски для журнала (правило 12).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_reason_ru(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_code
    WHEN 'disabled' THEN 'Автоответчик выключен'
    WHEN 'no_consent' THEN 'Нет согласия на передачу текстов в Gemini'
    WHEN 'paused' THEN 'Автоответчик на паузе'
    WHEN 'shadow_mode' THEN 'Режим «Проверка без отправки»'
    WHEN 'not_sales' THEN 'Чат не в очереди продаж'
    WHEN 'conversation_closed' THEN 'Чат закрыт'
    WHEN 'not_direct' THEN 'Не личный чат WhatsApp продаж'
    WHEN 'not_inbound' THEN 'Сообщение не от клиента'
    WHEN 'history_message' THEN 'Сообщение из импорта истории'
    WHEN 'not_latest' THEN 'Есть более новое сообщение клиента'
    WHEN 'outside_interval' THEN 'Вне расписания автоответчика'
    WHEN 'too_old' THEN 'Сообщение старше 5 минут'
    WHEN 'excluded' THEN 'Автоответчик выключен в этом чате'
    WHEN 'staff_active' THEN 'Сотрудник отвечал или был активен в чате последние 15 минут'
    WHEN 'media_only' THEN 'В сообщении только медиа'
    WHEN 'handed_off' THEN 'Финальная фраза уже сказана в этом интервале'
    WHEN 'limit_chat_hour' THEN 'Лимит ответов в чате за час'
    WHEN 'limit_chat_night' THEN 'Лимит ответов в чате за ночь'
    WHEN 'limit_number_hour' THEN 'Лимит ответов номера за час'
    WHEN 'source_not_allowed' THEN 'Источник не разрешён для автоответчика'
    WHEN 'citation_not_offered' THEN 'Цитата не из найденных фрагментов'
    WHEN 'open_review' THEN 'В источнике есть непроверенные пункты «Листа сверки»'
    WHEN 'number_unsupported' THEN 'Число не найдено в источнике'
    WHEN 'stop_word' THEN 'Стоп-слово обещаний или оплаты'
    WHEN 'link' THEN 'Ссылка в тексте'
    WHEN 'marker' THEN 'Пометка источника в тексте'
    WHEN 'too_long' THEN 'Текст длиннее 1000 символов'
    WHEN 'empty_text' THEN 'Пустой текст'
    WHEN 'phrase_mismatch' THEN 'Финальная фраза не совпадает с настройками'
    WHEN 'phrase_unconfirmed' THEN 'Фраза или строка-раскрытие на этом языке не подтверждены'
    WHEN 'no_working_day' THEN 'Не найден рабочий день для звонка'
    WHEN 'responsible_unavailable' THEN 'Ответственный сотрудник не может отправлять в этот чат'
    WHEN 'provider_down' THEN 'Сессия WhatsApp не в работе'
    WHEN 'provider_restricted' THEN 'WhatsApp ограничил отправку (463/475)'
    WHEN 'send_errors' THEN 'Три ошибки отправки подряд'
    WHEN 'manual' THEN 'Пауза поставлена сотрудником'
    WHEN 'send_expired' THEN 'Время отправки прошло'
    WHEN 'not_live_test' THEN 'Чат убран из списка живого теста'
    WHEN 'expired' THEN 'Решение не завершено вовремя'
    WHEN 'gemini_error' THEN 'Ошибка Gemini'
    WHEN 'gemini_billing' THEN 'Gemini: оплата или доступ'
    WHEN 'blocked' THEN 'Gemini отклонил запрос'
    WHEN 'budget' THEN 'Исчерпан месячный лимит ИИ'
    WHEN 'server_switch_off' THEN 'Отправка выключена на сервере'
    ELSE 'Пропущено агентом'
  END
$$;

DO $ai275_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'ai\_autosend\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai275_private_acl$;

-- Строка настроек для каждой организации (новые получают её при первом
-- обращении, ai_autosend_settings_row).
INSERT INTO platform_private.ai_autosend_settings (organization_id)
SELECT o.id FROM platform.organizations o
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
