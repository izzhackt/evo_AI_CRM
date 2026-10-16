-- 285 «Подготовка к CSCA: движок» (S5.1 ядро). Контракт: план
-- docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md §9.3 и детальный дизайн модуля
-- (DESIGN.md §7.2-§7.4); запись docs/PLAN_CHANGES.md «2026-10-16 · Подготовка
-- к CSCA, S5.1 ядро: движок и математика, часть 1 (миграции 285, 286, запись
-- до кода)». Описание для отрисовщиков: docs/portal/csca-contract.md.
--
-- Движок обучения 198 расширяется, а не дублируется:
--  a) трек модуля: learning_modules.track ('english' по умолчанию, ADD COLUMN
--     с константой не переписывает строки и не будит триггеры
--     неизменяемости); learning_modules_v1 отдаёт только 'english', так что
--     старые сборки iPhone и веб «Английский» CSCA не видят;
--  b) контент выпуска CSCA (всё привязано к строке модуля = выпуску):
--     learning_topics, learning_figures (SVG по профилю, палитра из шести
--     цветов), learning_items (банк заданий: 4 варианта, один верный, разбор
--     каждого варианта RU и KY, provenance = 'evo_authored'),
--     learning_test_forms (диагностика и пробный тест), плюс календарь
--     сессий csca_exam_sessions; всё неизменяемо, правка = новый выпуск;
--  c) уроки CSCA: типизированные блоки теории (idea, formula, figure, table,
--     example, pitfalls, tip, terms, interactive) и упражнение типа item,
--     ссылающееся на задание того же выпуска; запись урока остаётся в RPC
--     198 (start/save/complete_learning_lesson_v1);
--  d) тест на время: старт, срок и автозавершение считает сервер; ответы
--     можно менять до срока (+15 с на сеть), разбор и ключи открываются
--     только после завершения; у пробного теста нет досрочного завершения;
--  e) повторение с интервалами (ящики 1-4: 1, 3, 7, 14 дней по датам
--     Бишкека), журнал ответов (только добавление), прогресс;
--  f) «Сообщить об ошибке»: читает только Admin, без автора;
--  g) выбранная учеником целевая сессия.
--
-- Тела функций 198 и 280 меняются только заменой проверенных фрагментов
-- (шаблон 281/282): каждый фрагмент обязан встретиться ровно ожидаемое число
-- раз, иначе миграция падает. Формы ответов v1 не меняются.
--
-- ПРИВАТНОСТЬ (как 198): ноль табличных грантов, только RPC; попытки,
-- ответы, прогресс и повторение видит только сам ученик; сотрудники, чужой
-- ученик и anon получают 42501; в audit_events ничего не пишется. Новые
-- таблицы состояния входят в удаление аккаунта (280).
BEGIN;

DO $a285_anchors$
BEGIN
  IF to_regclass('platform_private.learning_modules') IS NULL
    OR to_regclass('platform.learning_lesson_attempts') IS NULL
    OR to_regprocedure('platform.learning_modules_v1()') IS NULL
    OR to_regprocedure('platform_private.validate_learning_module()') IS NULL
    OR to_regprocedure('platform_private.validate_learning_lesson()') IS NULL
    OR to_regprocedure('platform_private.validate_learning_exercise()') IS NULL
    OR to_regprocedure('platform_private.learning_exercise_public(platform_private.learning_exercises)') IS NULL
    OR to_regprocedure('platform_private.learning_exercise_explain(platform_private.learning_exercises)') IS NULL
    OR to_regprocedure('platform_private.grade_learning_answer(platform_private.learning_exercises,jsonb)') IS NULL
    OR to_regprocedure('platform_private.write_learning_lesson(text,uuid,uuid,bigint,uuid,jsonb,uuid)') IS NULL
    OR to_regprocedure('platform_private.require_learning_actor_read()') IS NULL
    OR to_regprocedure('platform_private.require_domain_actor(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_closure(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_counts(jsonb)') IS NULL
    OR to_regprocedure('platform_private.account_erasure_bypass()') IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'platform_private.learning_modules'::REGCLASS AND attname = 'track' AND NOT attisdropped)
    OR to_regclass('platform_private.learning_items') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a285_csca_learning_anchor_drift';
  END IF;
END
$a285_anchors$;

CREATE FUNCTION pg_temp.a285_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a285_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) Трек модуля и тип упражнения item.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.learning_modules
  ADD COLUMN track TEXT NOT NULL DEFAULT 'english'
    CONSTRAINT learning_modules_track_check
    CHECK (track IN ('english', 'csca-math', 'csca-physics', 'csca-chemistry'));
CREATE INDEX learning_modules_track_idx
  ON platform_private.learning_modules(track, module_key, published_at DESC, id DESC);

ALTER TABLE platform_private.learning_exercises
  DROP CONSTRAINT learning_exercises_exercise_type_check,
  ADD CONSTRAINT learning_exercises_exercise_type_check
    CHECK (exercise_type IN ('choice', 'matching', 'short_answer', 'reading', 'item'));

-- ---------------------------------------------------------------------------
-- b) Контент выпуска CSCA. Строка модуля = выпуск; всё ниже ссылается на неё.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.learning_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES platform_private.learning_modules(id) ON DELETE RESTRICT,
  topic_key TEXT NOT NULL CHECK (topic_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  order_index INTEGER NOT NULL CHECK (order_index BETWEEN 1 AND 200),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (module_id, topic_key),
  UNIQUE (module_id, order_index)
);

CREATE TABLE platform_private.learning_figures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES platform_private.learning_modules(id) ON DELETE RESTRICT,
  figure_key TEXT NOT NULL CHECK (figure_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  svg TEXT NOT NULL,
  view_box TEXT NOT NULL,
  alt_ru TEXT NOT NULL,
  alt_ky TEXT NOT NULL,
  alt_en TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (module_id, figure_key)
);

CREATE TABLE platform_private.learning_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES platform_private.learning_modules(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (item_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  topic_key TEXT NOT NULL,
  syllabus_point TEXT NOT NULL CHECK (syllabus_point ~ '^[1-9]\.[1-9][0-9]?$'),
  difficulty SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  pool TEXT NOT NULL CHECK (pool IN ('lesson', 'practice', 'diagnostic', 'mock')),
  provenance TEXT NOT NULL CHECK (provenance = 'evo_authored'),
  body JSONB NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  UNIQUE (module_id, item_key),
  FOREIGN KEY (module_id, topic_key)
    REFERENCES platform_private.learning_topics(module_id, topic_key) ON DELETE RESTRICT
);
CREATE INDEX learning_items_key_idx ON platform_private.learning_items(item_key);

CREATE TABLE platform_private.learning_test_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES platform_private.learning_modules(id) ON DELETE RESTRICT,
  form_key TEXT NOT NULL CHECK (form_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  kind TEXT NOT NULL CHECK (kind IN ('diagnostic', 'mock')),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 60 AND 7200),
  allow_early_finish BOOLEAN NOT NULL,
  item_keys JSONB NOT NULL CHECK (jsonb_typeof(item_keys) = 'array'),
  UNIQUE (module_id, form_key),
  -- Пробный тест как настоящий экзамен: досрочного завершения нет.
  CHECK (kind <> 'mock' OR NOT allow_early_finish)
);

-- Календарь официальных сессий CSCA (факты csca.cn с датой проверки).
-- Неизменяемо: исправление = новая строка того же session_key, читается
-- последняя по published_at.
CREATE TABLE platform_private.csca_exam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT NOT NULL CHECK (session_key ~ '^[0-9]{4}-[0-9]{2}$'),
  exam_from DATE NOT NULL,
  exam_to DATE NOT NULL,
  registration_opens_at TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  source_url TEXT NOT NULL CHECK (source_url ~ '^https://csca\.cn(/[A-Za-z0-9/._-]*)?$'),
  verified_on DATE NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (exam_from <= exam_to AND exam_to - exam_from <= 3),
  CHECK ((registration_opens_at IS NULL) = (registration_closes_at IS NULL)),
  CHECK (registration_opens_at IS NULL OR (registration_opens_at < registration_closes_at
    AND registration_closes_at < exam_from::TIMESTAMPTZ + INTERVAL '1 day')),
  UNIQUE (session_key, published_at)
);

-- ---------------------------------------------------------------------------
-- c) Состояние ученика. Ключи заданий и тем стабильны между выпусками, поэтому
-- журнал, повторение и прогресс ссылаются на ключи, а не на строки выпуска.
-- ---------------------------------------------------------------------------
CREATE TABLE platform.learning_test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  form_id UUID NOT NULL REFERENCES platform_private.learning_test_forms(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  started_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(answers) = 'object'),
  flags JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(flags) = 'array'),
  item_seconds JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(item_seconds) = 'object'),
  completion TEXT CHECK (completion IN ('submitted', 'timeout')),
  result_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, student_membership_id, id),
  CHECK (deadline_at > started_at),
  CHECK ((status = 'draft' AND completed_at IS NULL AND result_snapshot IS NULL AND completion IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND completion IS NOT NULL
      AND result_snapshot IS NOT NULL AND jsonb_typeof(result_snapshot) = 'object'))
);
CREATE UNIQUE INDEX learning_test_one_draft_idx
  ON platform.learning_test_attempts(organization_id, student_membership_id, form_id)
  WHERE status = 'draft';
CREATE INDEX learning_test_attempt_owner_idx
  ON platform.learning_test_attempts(organization_id, student_membership_id, status, completed_at DESC, id DESC);
CREATE INDEX learning_test_attempt_form_idx ON platform.learning_test_attempts(form_id);

CREATE TABLE platform_private.learning_test_requests (
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('start', 'save', 'complete')),
  input_hash TEXT NOT NULL,
  attempt_id UUID NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (student_membership_id, request_id),
  FOREIGN KEY (organization_id, student_membership_id, attempt_id)
    REFERENCES platform.learning_test_attempts(organization_id, student_membership_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX learning_test_request_attempt_idx
  ON platform_private.learning_test_requests(organization_id, student_membership_id, attempt_id);

CREATE TABLE platform.learning_item_reviews (
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('csca-math', 'csca-physics', 'csca-chemistry')),
  item_key TEXT NOT NULL CHECK (item_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  box SMALLINT NOT NULL CHECK (box BETWEEN 1 AND 4),
  due_on DATE NOT NULL,
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, student_membership_id, track, item_key),
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_item_reviews_due_idx
  ON platform.learning_item_reviews(organization_id, student_membership_id, track, due_on)
  WHERE retired_at IS NULL;

CREATE TABLE platform_private.learning_review_requests (
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  track TEXT NOT NULL,
  item_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (student_membership_id, request_id),
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_review_requests_owner_idx
  ON platform_private.learning_review_requests(organization_id, student_membership_id);

CREATE TABLE platform.learning_item_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('csca-math', 'csca-physics', 'csca-chemistry')),
  item_key TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('lesson', 'practice', 'diagnostic', 'mock', 'review')),
  correct BOOLEAN NOT NULL,
  seconds INTEGER CHECK (seconds BETWEEN 0 AND 3600),
  ref_id UUID NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_item_events_topic_idx
  ON platform.learning_item_events(organization_id, student_membership_id, track, topic_key, answered_at DESC, id DESC);

CREATE TABLE platform_private.learning_item_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('csca-math', 'csca-physics', 'csca-chemistry')),
  item_key TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES platform_private.learning_items(id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (student_membership_id, request_id),
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_item_reports_org_idx
  ON platform_private.learning_item_reports(organization_id, track, created_at DESC, id DESC);
CREATE INDEX learning_item_reports_owner_idx
  ON platform_private.learning_item_reports(organization_id, student_membership_id, created_at DESC);

CREATE TABLE platform.learning_track_preferences (
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('csca-math', 'csca-physics', 'csca-chemistry')),
  target_session_key TEXT CHECK (target_session_key ~ '^[0-9]{4}-[0-9]{2}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, student_membership_id, track),
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);

ALTER TABLE platform_private.learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_figures FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_items FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_test_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_test_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.csca_exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.csca_exam_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_test_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_test_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_test_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_item_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_item_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_review_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_item_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_item_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_item_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_track_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_track_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  platform_private.learning_topics,
  platform_private.learning_figures,
  platform_private.learning_items,
  platform_private.learning_test_forms,
  platform_private.csca_exam_sessions,
  platform.learning_test_attempts,
  platform_private.learning_test_requests,
  platform.learning_item_reviews,
  platform_private.learning_review_requests,
  platform.learning_item_events,
  platform_private.learning_item_reports,
  platform.learning_track_preferences
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON SEQUENCE platform.learning_item_events_id_seq
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Мелкие помощники валидаторов.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_csca_track_ok(p_track TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(p_track IN ('csca-math', 'csca-physics', 'csca-chemistry'), FALSE)
$$;

-- CASE держит порядок вычисления: ключи считаются только у объекта, число
-- приводится только после проверки формы.
CREATE FUNCTION platform_private.learning_keys_are(p_value JSONB, p_keys TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN (SELECT count(*) FROM jsonb_object_keys(p_value)) = cardinality(p_keys) AND p_value ?& p_keys
    ELSE FALSE END
$$;

CREATE FUNCTION platform_private.learning_int_ok(p_value JSONB, p_min INTEGER, p_max INTEGER)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' AND (p_value #>> '{}') ~ '^\d{1,6}$'
    THEN (p_value #>> '{}')::INTEGER BETWEEN p_min AND p_max
    ELSE FALSE END
$$;

CREATE FUNCTION platform_private.learning_pair_ok(p_value JSONB, p_prefix TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT platform_private.learning_text_ok(p_value -> (p_prefix || '_ru'))
    AND platform_private.learning_text_ok(p_value -> (p_prefix || '_ky'))
$$;

-- {ru, ky}: пара строк без других ключей.
CREATE FUNCTION platform_private.learning_ru_ky_ok(p_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT platform_private.learning_keys_are(p_value, ARRAY['ru', 'ky'])
    AND platform_private.learning_text_ok(p_value -> 'ru')
    AND platform_private.learning_text_ok(p_value -> 'ky')
$$;

-- Термины: {en, ru, ky} или {en, ru, ky, zh, pinyin}; все строки непустые.
CREATE FUNCTION platform_private.learning_terms_ok(p_terms JSONB, p_min INTEGER, p_max INTEGER)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(p_terms) = 'array'
    AND jsonb_array_length(p_terms) BETWEEN p_min AND p_max
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_terms) term
      WHERE NOT (platform_private.learning_keys_are(term, ARRAY['en', 'ru', 'ky'])
          OR platform_private.learning_keys_are(term, ARRAY['en', 'ru', 'ky', 'zh', 'pinyin']))
        OR EXISTS (SELECT 1 FROM jsonb_each(term) field
          WHERE NOT platform_private.learning_text_ok(field.value))), FALSE)
$$;

CREATE FUNCTION platform_private.learning_module_track(p_module_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT module.track FROM platform_private.learning_modules module WHERE module.id = p_module_id
$$;

CREATE FUNCTION platform_private.learning_lesson_track(p_lesson_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT module.track FROM platform_private.learning_lessons lesson
  JOIN platform_private.learning_modules module ON module.id = lesson.module_id
  WHERE lesson.id = p_lesson_id
$$;

-- Текущие модули трека: последний выпуск каждого module_key.
CREATE FUNCTION platform_private.learning_track_modules(p_track TEXT)
RETURNS SETOF platform_private.learning_modules LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT DISTINCT ON (module.module_key) module.*
  FROM platform_private.learning_modules module
  WHERE module.track = p_track
  ORDER BY module.module_key, module.published_at DESC, module.id DESC
$$;

-- Задание по ключу в треке: самый новый выпуск, где оно есть.
CREATE FUNCTION platform_private.learning_track_item(p_track TEXT, p_item_key TEXT)
RETURNS platform_private.learning_items LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT item.* FROM platform_private.learning_items item
  JOIN platform_private.learning_modules module ON module.id = item.module_id
  WHERE module.track = p_track AND item.item_key = p_item_key
  ORDER BY module.published_at DESC, module.id DESC
  LIMIT 1
$$;

-- «Сегодня» для серии и повторения: по Бишкеку (UTC+6), решение по умолчанию.
CREATE FUNCTION platform_private.learning_local_date(p_at TIMESTAMPTZ)
RETURNS DATE LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT (p_at AT TIME ZONE 'Asia/Bishkek')::DATE
$$;

-- ---------------------------------------------------------------------------
-- Валидаторы контента CSCA (exact-key, 22023 на INSERT).
-- ---------------------------------------------------------------------------
-- Метаданные модуля CSCA: шесть полей DESIGN §7.2 + sections (4 модуля
-- программы и их пункты, своими словами EVO).
CREATE FUNCTION platform_private.learning_csca_module_ok(p_module_key TEXT, p_track TEXT, p_metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE section JSONB; point JSONB; n INTEGER := 0; m INTEGER;
BEGIN
  IF NOT platform_private.learning_csca_track_ok(p_track)
    OR p_module_key IS NULL OR left(p_module_key, length(p_track)) <> p_track
    OR octet_length(p_metadata::TEXT) > 32768
    OR NOT platform_private.learning_keys_are(p_metadata, ARRAY['title_ru', 'title_ky', 'level_note_ru',
      'level_note_ky', 'syllabus_edition', 'syllabus_url', 'sections'])
    OR NOT platform_private.learning_pair_ok(p_metadata, 'title')
    OR NOT platform_private.learning_pair_ok(p_metadata, 'level_note')
    OR jsonb_typeof(p_metadata -> 'syllabus_edition') <> 'string'
    OR (p_metadata ->> 'syllabus_edition') !~ '^[0-9]{4}$'
    OR jsonb_typeof(p_metadata -> 'syllabus_url') <> 'string'
    OR (p_metadata ->> 'syllabus_url') !~ '^https://[a-z0-9.-]+(/[A-Za-z0-9/._-]*)?$'
    OR jsonb_typeof(p_metadata -> 'sections') <> 'array'
    OR jsonb_array_length(p_metadata -> 'sections') NOT BETWEEN 1 AND 8
  THEN
    RETURN FALSE;
  END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(p_metadata -> 'sections') LOOP
    n := n + 1;
    IF NOT platform_private.learning_keys_are(section, ARRAY['section', 'title_ru', 'title_ky', 'title_en',
        'mock_items_estimate', 'points'])
      OR NOT platform_private.learning_int_ok(section -> 'section', n, n)
      OR NOT platform_private.learning_pair_ok(section, 'title')
      OR NOT platform_private.learning_text_ok(section -> 'title_en')
      OR NOT platform_private.learning_int_ok(section -> 'mock_items_estimate', 0, 80)
      OR jsonb_typeof(section -> 'points') <> 'array'
      OR jsonb_array_length(section -> 'points') NOT BETWEEN 1 AND 12
    THEN
      RETURN FALSE;
    END IF;
    m := 0;
    FOR point IN SELECT value FROM jsonb_array_elements(section -> 'points') LOOP
      m := m + 1;
      IF NOT platform_private.learning_keys_are(point, ARRAY['point', 'label_ru', 'label_ky', 'label_en'])
        OR point ->> 'point' IS DISTINCT FROM (n::TEXT || '.' || m::TEXT)
        OR NOT platform_private.learning_pair_ok(point, 'label')
        OR NOT platform_private.learning_text_ok(point -> 'label_en')
      THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END LOOP;
  RETURN TRUE;
END $$;

CREATE FUNCTION platform_private.validate_learning_topic()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  module platform_private.learning_modules%ROWTYPE;
  meta JSONB := NEW.metadata;
  prerequisite TEXT;
BEGIN
  SELECT * INTO module FROM platform_private.learning_modules WHERE id = NEW.module_id;
  IF module.id IS NULL OR NOT platform_private.learning_csca_track_ok(module.track)
    OR NOT platform_private.learning_keys_are(meta, ARRAY['title_ru', 'title_ky', 'title_en', 'section',
      'syllabus_point', 'syllabus_fit', 'mock_items_estimate', 'likely_gap', 'prerequisites', 'lessons_planned'])
    OR NOT platform_private.learning_pair_ok(meta, 'title')
    OR NOT platform_private.learning_text_ok(meta -> 'title_en')
    OR NOT platform_private.learning_int_ok(meta -> 'section', 1, 8)
    OR jsonb_typeof(meta -> 'syllabus_point') <> 'string'
    -- Пункт программы существует в разделе своего модуля.
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(module.metadata -> 'sections') section
      CROSS JOIN LATERAL jsonb_array_elements(section -> 'points') point
      WHERE section ->> 'section' = meta ->> 'section' AND point ->> 'point' = meta ->> 'syllabus_point')
    OR jsonb_typeof(meta -> 'syllabus_fit') <> 'string'
    OR (meta ->> 'syllabus_fit') NOT IN ('explicit', 'implied')
    OR NOT platform_private.learning_int_ok(meta -> 'mock_items_estimate', 0, 48)
    OR jsonb_typeof(meta -> 'likely_gap') <> 'boolean'
    OR NOT platform_private.learning_int_ok(meta -> 'lessons_planned', 0, 12)
    OR jsonb_typeof(meta -> 'prerequisites') <> 'array'
    OR jsonb_array_length(meta -> 'prerequisites') > 6
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(meta -> 'prerequisites'))
      <> jsonb_array_length(meta -> 'prerequisites')
  THEN
    RAISE EXCEPTION 'Invalid learning topic content' USING ERRCODE = '22023';
  END IF;
  -- Предпосылка: уже опубликованная тема того же выпуска с меньшим порядком.
  FOR prerequisite IN SELECT value FROM jsonb_array_elements_text(meta -> 'prerequisites') LOOP
    IF NOT EXISTS (SELECT 1 FROM platform_private.learning_topics topic
      WHERE topic.module_id = NEW.module_id AND topic.topic_key = prerequisite
        AND topic.order_index < NEW.order_index)
    THEN
      RAISE EXCEPTION 'Invalid learning topic prerequisite' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Профиль SVG (DESIGN §7.7): только svg title rect line circle path polygon
-- text tspan, атрибуты геометрии, обводки, заливки и шрифта; без style,
-- script, foreignObject, image, ссылок, сущностей DTD и инструкций; каждый
-- цвет: один из шести цветов палитры (светлая тема), fill/stroke ещё 'none'.
CREATE FUNCTION platform_private.learning_svg_ok(p_svg TEXT, p_view_box TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  palette CONSTANT TEXT[] := ARRAY['#ffffff', '#191714', '#6b6660', '#e4dfd7', '#d70217', '#177245'];
  elements CONSTANT TEXT[] := ARRAY['svg', 'title', 'rect', 'line', 'circle', 'path', 'polygon', 'text', 'tspan'];
  attributes CONSTANT TEXT[] := ARRAY['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'transform', 'fill', 'stroke', 'stroke-width',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
    'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline'];
  attribute_pattern CONSTANT TEXT := '\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"';
  tag RECORD;
  attr RECORD;
  root_view_box TEXT;
  size TEXT[];
BEGIN
  IF p_svg IS NULL OR p_view_box IS NULL OR octet_length(p_svg) > 24576
    OR left(p_svg, 5) <> '<svg ' OR right(rtrim(p_svg, E' \n\t\r'), 6) <> '</svg>'
    OR p_svg ~* '(<!|<\?|script|<style|\sstyle\s*=|foreignobject|<image|href|url\(|javascript:|data:|@import)'
    OR (SELECT count(*) FROM regexp_matches(p_svg, '<svg[\s>]', 'g')) <> 1
    -- Только предопределённые и числовые сущности.
    OR regexp_replace(p_svg, '&(amp|lt|gt|quot|apos|#[0-9]{1,6}|#x[0-9a-fA-F]{1,6});', '', 'g') LIKE '%&%'
  THEN
    RETURN FALSE;
  END IF;
  FOR tag IN SELECT match[1] AS name, match[2] AS attrs
    FROM regexp_matches(p_svg, '<([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>', 'g') AS match
  LOOP
    IF NOT (tag.name = ANY (elements))
      OR regexp_replace(tag.attrs, attribute_pattern, '', 'g') !~ '^\s*/?$'
    THEN
      RETURN FALSE;
    END IF;
    FOR attr IN SELECT a[1] AS name, a[2] AS value FROM regexp_matches(tag.attrs, attribute_pattern, 'g') AS a LOOP
      IF NOT (attr.name = ANY (attributes))
        OR (attr.name IN ('fill', 'stroke') AND NOT (lower(attr.value) = ANY (palette || ARRAY['none'])))
        OR (attr.name = 'xmlns' AND attr.value <> 'http://www.w3.org/2000/svg')
      THEN
        RETURN FALSE;
      END IF;
      IF tag.name = 'svg' AND attr.name = 'viewBox' THEN root_view_box := attr.value; END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM regexp_matches(p_svg, '</([a-zA-Z][a-zA-Z0-9]*)\s*>', 'g') AS match
      WHERE NOT (match[1] = ANY (elements)))
    OR EXISTS (SELECT 1 FROM regexp_matches(p_svg, '(#[0-9a-fA-F]{3,8})', 'g') AS match
      WHERE NOT (lower(match[1]) = ANY (palette)))
    OR root_view_box IS DISTINCT FROM p_view_box
  THEN
    RETURN FALSE;
  END IF;
  size := regexp_match(p_view_box, '^0 0 ([0-9]{3})(\.[0-9]+)? ([0-9]{2,3})(\.[0-9]+)?$');
  RETURN size IS NOT NULL AND size[1]::INTEGER BETWEEN 360 AND 450 AND size[3]::INTEGER BETWEEN 100 AND 600;
END $$;

CREATE FUNCTION platform_private.validate_learning_figure()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT platform_private.learning_csca_track_ok(platform_private.learning_module_track(NEW.module_id))
    OR NOT platform_private.learning_svg_ok(NEW.svg, NEW.view_box)
    OR NEW.sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(NEW.svg, 'UTF8')), 'hex')
    OR NULLIF(btrim(NEW.alt_ru), '') IS NULL OR char_length(NEW.alt_ru) > 1000
    OR NULLIF(btrim(NEW.alt_ky), '') IS NULL OR char_length(NEW.alt_ky) > 1000
    OR NULLIF(btrim(NEW.alt_en), '') IS NULL OR char_length(NEW.alt_en) > 1000
  THEN
    RAISE EXCEPTION 'Invalid learning figure content' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- Задание банка (DESIGN §5): условие EN, ровно 4 варианта a..d, один верный
-- (answer_index), разбор каждого варианта RU и KY, решение RU и KY одинаковой
-- длины, 1..6 терминов, навык, ориентир времени, необязательный рисунок того
-- же выпуска. До 16 КБ.
CREATE FUNCTION platform_private.validate_learning_item()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  body JSONB := NEW.body;
  topic platform_private.learning_topics%ROWTYPE;
  key_count INTEGER := (SELECT count(*) FROM jsonb_object_keys(NEW.body));
BEGIN
  SELECT * INTO topic FROM platform_private.learning_topics t
    WHERE t.module_id = NEW.module_id AND t.topic_key = NEW.topic_key;
  IF topic.id IS NULL
    OR NOT platform_private.learning_csca_track_ok(platform_private.learning_module_track(NEW.module_id))
    OR topic.metadata ->> 'syllabus_point' IS DISTINCT FROM NEW.syllabus_point
    OR octet_length(body::TEXT) > 16384
    OR NOT (body ?& ARRAY['stem_en', 'options', 'answer_index', 'solution_ru', 'solution_ky', 'terms',
      'skill', 'est_seconds'])
    OR key_count NOT IN (8, 9) OR (key_count = 9 AND NOT body ? 'figure_key')
    OR NOT platform_private.learning_text_ok(body -> 'stem_en') OR char_length(body ->> 'stem_en') > 2000
    OR jsonb_typeof(body -> 'options') <> 'array' OR jsonb_array_length(body -> 'options') <> 4
    OR (SELECT string_agg(option ->> 'id', '' ORDER BY ordinality)
      FROM jsonb_array_elements(body -> 'options') WITH ORDINALITY AS options(option, ordinality))
      IS DISTINCT FROM 'abcd'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'options') option
      WHERE NOT platform_private.learning_keys_are(option, ARRAY['id', 'label', 'explain_ru', 'explain_ky'])
        OR NOT platform_private.learning_text_ok(option -> 'label')
        OR NOT platform_private.learning_pair_ok(option, 'explain'))
    OR (SELECT count(DISTINCT option ->> 'label') FROM jsonb_array_elements(body -> 'options') option) <> 4
    OR NOT platform_private.learning_int_ok(body -> 'answer_index', 0, 3)
    OR jsonb_typeof(body -> 'solution_ru') <> 'array' OR jsonb_typeof(body -> 'solution_ky') <> 'array'
    OR jsonb_array_length(body -> 'solution_ru') NOT BETWEEN 1 AND 8
    OR jsonb_array_length(body -> 'solution_ru') <> jsonb_array_length(body -> 'solution_ky')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'solution_ru') step
      WHERE NOT platform_private.learning_text_ok(step))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'solution_ky') step
      WHERE NOT platform_private.learning_text_ok(step))
    OR NOT platform_private.learning_terms_ok(body -> 'terms', 1, 6)
    OR jsonb_typeof(body -> 'skill') <> 'string' OR (body ->> 'skill') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    OR NOT platform_private.learning_int_ok(body -> 'est_seconds', 20, 240)
    OR (body ? 'figure_key' AND (jsonb_typeof(body -> 'figure_key') <> 'string'
      OR NOT EXISTS (SELECT 1 FROM platform_private.learning_figures figure
        WHERE figure.module_id = NEW.module_id AND figure.figure_key = body ->> 'figure_key')))
  THEN
    RAISE EXCEPTION 'Invalid learning item content' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.validate_learning_test_form()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT platform_private.learning_csca_track_ok(platform_private.learning_module_track(NEW.module_id))
    OR NOT platform_private.learning_keys_are(NEW.metadata, ARRAY['title_ru', 'title_ky', 'intro_ru', 'intro_ky'])
    OR NOT platform_private.learning_pair_ok(NEW.metadata, 'title')
    OR NOT platform_private.learning_pair_ok(NEW.metadata, 'intro')
    OR jsonb_array_length(NEW.item_keys) NOT BETWEEN 1 AND 80
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.item_keys) item_key
      WHERE jsonb_typeof(item_key) <> 'string')
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.item_keys))
      <> jsonb_array_length(NEW.item_keys)
    -- Каждое задание: того же выпуска и из пула своего вида формы.
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.item_keys) item_key
      WHERE NOT EXISTS (SELECT 1 FROM platform_private.learning_items item
        WHERE item.module_id = NEW.module_id AND item.item_key = item_key.value AND item.pool = NEW.kind))
  THEN
    RAISE EXCEPTION 'Invalid learning test form content' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- Блок теории урока CSCA (DESIGN §4).
CREATE FUNCTION platform_private.learning_csca_cell_ok(p_cell JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT (platform_private.learning_keys_are(p_cell, ARRAY['tex'])
      AND platform_private.learning_text_ok(p_cell -> 'tex'))
    OR platform_private.learning_ru_ky_ok(p_cell)
$$;

CREATE FUNCTION platform_private.learning_csca_block_ok(p_module_id UUID, p_block JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE kind TEXT := CASE WHEN jsonb_typeof(p_block) = 'object' THEN p_block ->> 'kind' END;
BEGIN
  IF kind IS NULL OR jsonb_typeof(p_block -> 'kind') <> 'string' THEN
    RETURN FALSE;
  END IF;
  IF kind = 'idea' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'ru', 'ky'])
      AND platform_private.learning_text_ok(p_block -> 'ru') AND platform_private.learning_text_ok(p_block -> 'ky');
  ELSIF kind = 'formula' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'tex', 'note_ru', 'note_ky'])
      AND jsonb_typeof(p_block -> 'tex') = 'array' AND jsonb_array_length(p_block -> 'tex') BETWEEN 1 AND 6
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_block -> 'tex') tex
        WHERE NOT platform_private.learning_text_ok(tex))
      AND platform_private.learning_pair_ok(p_block, 'note');
  ELSIF kind = 'figure' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'figure_key', 'caption_ru', 'caption_ky'])
      AND platform_private.learning_pair_ok(p_block, 'caption')
      AND EXISTS (SELECT 1 FROM platform_private.learning_figures figure
        WHERE figure.module_id = p_module_id AND figure.figure_key = p_block ->> 'figure_key');
  ELSIF kind = 'table' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'caption_ru', 'caption_ky', 'header', 'rows'])
      AND platform_private.learning_pair_ok(p_block, 'caption')
      AND jsonb_typeof(p_block -> 'header') = 'array' AND jsonb_array_length(p_block -> 'header') BETWEEN 2 AND 6
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_block -> 'header') cell
        WHERE NOT platform_private.learning_csca_cell_ok(cell))
      AND jsonb_typeof(p_block -> 'rows') = 'array' AND jsonb_array_length(p_block -> 'rows') BETWEEN 1 AND 20
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_block -> 'rows') table_row
        WHERE jsonb_typeof(table_row) <> 'array'
          OR jsonb_array_length(table_row) <> jsonb_array_length(p_block -> 'header')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(table_row) cell
            WHERE NOT platform_private.learning_csca_cell_ok(cell)));
  ELSIF kind = 'example' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'title_ru', 'title_ky', 'stem_en', 'steps',
        'answer_ru', 'answer_ky'])
      AND platform_private.learning_pair_ok(p_block, 'title')
      AND platform_private.learning_text_ok(p_block -> 'stem_en')
      AND platform_private.learning_pair_ok(p_block, 'answer')
      AND jsonb_typeof(p_block -> 'steps') = 'array' AND jsonb_array_length(p_block -> 'steps') BETWEEN 1 AND 8
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_block -> 'steps') step
        WHERE NOT platform_private.learning_ru_ky_ok(step));
  ELSIF kind = 'pitfalls' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'items'])
      AND jsonb_typeof(p_block -> 'items') = 'array' AND jsonb_array_length(p_block -> 'items') BETWEEN 1 AND 6
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_block -> 'items') item
        WHERE NOT platform_private.learning_ru_ky_ok(item));
  ELSIF kind = 'tip' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'tip', 'ru', 'ky'])
      AND p_block ->> 'tip' = 'no_calculator'
      AND platform_private.learning_text_ok(p_block -> 'ru') AND platform_private.learning_text_ok(p_block -> 'ky');
  ELSIF kind = 'terms' THEN
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'terms'])
      AND platform_private.learning_terms_ok(p_block -> 'terms', 1, 24);
  ELSIF kind = 'interactive' THEN
    -- Виджет из закрытого реестра; рисунок того же выпуска: статичная
    -- замена для отрисовщика, который виджета не знает.
    RETURN platform_private.learning_keys_are(p_block, ARRAY['kind', 'widget', 'params', 'figure_key',
        'caption_ru', 'caption_ky'])
      AND p_block ->> 'widget' IN ('number-line', 'graph-transform', 'unit-circle', 'secant-tangent',
        'conic-sections', 'vectors', 'complex-plane', 'normal-distribution')
      AND jsonb_typeof(p_block -> 'params') = 'object' AND octet_length((p_block -> 'params')::TEXT) <= 2048
      AND platform_private.learning_pair_ok(p_block, 'caption')
      AND EXISTS (SELECT 1 FROM platform_private.learning_figures figure
        WHERE figure.module_id = p_module_id AND figure.figure_key = p_block ->> 'figure_key');
  END IF;
  RETURN FALSE;
END $$;

-- Урок CSCA: метаданные DESIGN §7.2 D, теория из типизированных блоков
-- (1..24 у урока, 0..24 у практики), до 64 КБ.
CREATE FUNCTION platform_private.learning_csca_lesson_ok(p_module_id UUID, p_metadata JSONB, p_theory JSONB)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    platform_private.learning_csca_track_ok(platform_private.learning_module_track(p_module_id))
    AND platform_private.learning_keys_are(p_metadata, ARRAY['title_ru', 'title_ky', 'title_en', 'goal_ru',
      'goal_ky', 'topic_key', 'kind', 'est_minutes', 'syllabus_point'])
    AND platform_private.learning_pair_ok(p_metadata, 'title')
    AND platform_private.learning_text_ok(p_metadata -> 'title_en')
    AND platform_private.learning_pair_ok(p_metadata, 'goal')
    AND p_metadata ->> 'kind' IN ('lesson', 'practice')
    AND platform_private.learning_int_ok(p_metadata -> 'est_minutes', 1, 60)
    AND EXISTS (SELECT 1 FROM platform_private.learning_topics topic
      WHERE topic.module_id = p_module_id AND topic.topic_key = p_metadata ->> 'topic_key'
        AND topic.metadata ->> 'syllabus_point' = p_metadata ->> 'syllabus_point')
    AND jsonb_typeof(p_theory) = 'array'
    AND jsonb_array_length(p_theory) BETWEEN CASE WHEN p_metadata ->> 'kind' = 'lesson' THEN 1 ELSE 0 END AND 24
    AND octet_length(p_theory::TEXT) <= 65536
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_theory) block
      WHERE NOT platform_private.learning_csca_block_ok(p_module_id, block)), FALSE)
$$;

-- Упражнение item: тело ровно {"item_key"}, ключ упражнения = ключ задания,
-- задание того же выпуска и из пула вида урока (lesson -> lesson,
-- practice -> practice).
CREATE FUNCTION platform_private.learning_exercise_item_ok(p_lesson_id UUID, p_exercise_key TEXT, p_body JSONB)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT COALESCE(platform_private.learning_keys_are(p_body, ARRAY['item_key'])
    AND jsonb_typeof(p_body -> 'item_key') = 'string'
    AND p_body ->> 'item_key' = p_exercise_key
    AND EXISTS (SELECT 1 FROM platform_private.learning_lessons lesson
      JOIN platform_private.learning_items item ON item.module_id = lesson.module_id
      WHERE lesson.id = p_lesson_id AND item.item_key = p_body ->> 'item_key'
        AND item.pool = lesson.metadata ->> 'kind'), FALSE)
$$;

CREATE FUNCTION platform_private.validate_csca_exam_session()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.session_key <> to_char(NEW.exam_from, 'YYYY-MM') THEN
    RAISE EXCEPTION 'Invalid CSCA exam session' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 198: валидаторы модуля, урока и упражнения узнают трек (замена фрагментов;
-- ветки 'english' остаются байт в байт прежними).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a285_replace('platform_private.validate_learning_module()',
$old$BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'level_note_ru', 'level_note_ky'])$old$,
$new$BEGIN
  -- 285: модуль CSCA несёт план программы, у него свой валидатор.
  IF NEW.track <> 'english' THEN
    IF NOT platform_private.learning_csca_module_ok(NEW.module_key, NEW.track, NEW.metadata) THEN
      RAISE EXCEPTION 'Invalid learning module content' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'level_note_ru', 'level_note_ky'])$new$, 1);

SELECT pg_temp.a285_replace('platform_private.validate_learning_lesson()',
$old$BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'goal_ru', 'goal_ky'])$old$,
$new$BEGIN
  -- 285: урок CSCA состоит из типизированных блоков, у него свой валидатор.
  IF platform_private.learning_module_track(NEW.module_id) IS DISTINCT FROM 'english' THEN
    IF NOT platform_private.learning_csca_lesson_ok(NEW.module_id, NEW.metadata, NEW.theory) THEN
      RAISE EXCEPTION 'Invalid learning lesson content' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'goal_ru', 'goal_ky'])$new$, 1);

SELECT pg_temp.a285_replace('platform_private.validate_learning_exercise()',
$old$    WHEN 'short_answer' THEN ARRAY['accepted', 'explain_ru', 'explain_ky']
$old$,
$new$    WHEN 'item' THEN ARRAY['item_key']
    WHEN 'short_answer' THEN ARRAY['accepted', 'explain_ru', 'explain_ky']
$new$, 1);

SELECT pg_temp.a285_replace('platform_private.validate_learning_exercise()',
$old$  IF NEW.exercise_type = 'choice' THEN
    IF NOT platform_private.learning_prompt_ok(body)$old$,
$new$  -- 285: в уроках CSCA только упражнения item, а item: только в уроках CSCA.
  IF (NEW.exercise_type = 'item')
    IS DISTINCT FROM (platform_private.learning_lesson_track(NEW.lesson_id) <> 'english')
  THEN
    RAISE EXCEPTION 'Invalid learning exercise track' USING ERRCODE = '22023';
  END IF;
  IF NEW.exercise_type = 'choice' THEN
    IF NOT platform_private.learning_prompt_ok(body)$new$, 1);

SELECT pg_temp.a285_replace('platform_private.validate_learning_exercise()',
$old$  ELSIF NEW.exercise_type = 'short_answer' THEN
    IF NOT platform_private.learning_prompt_ok(body)$old$,
$new$  ELSIF NEW.exercise_type = 'item' THEN
    IF body ? 'source_lesson' OR body ? 'prompt_en' OR body ? 'prompt_ru' OR body ? 'prompt_ky'
      OR NOT platform_private.learning_exercise_item_ok(NEW.lesson_id, NEW.exercise_key, body)
    THEN
      RAISE EXCEPTION 'Invalid item exercise' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.exercise_type = 'short_answer' THEN
    IF NOT platform_private.learning_prompt_ok(body)$new$, 1);

-- ---------------------------------------------------------------------------
-- Неизменяемость нового контента и границы состояния ученика. Удаление строки
-- состояния допускается только внутри транзакции удаления аккаунта (280).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.guard_csca_learning()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- 280: account erasure bypass (one transaction, row DELETE only).
  IF TG_LEVEL = 'ROW' AND TG_OP = 'DELETE'
    AND NULLIF(pg_catalog.current_setting('platform.account_erasure_request_id', TRUE), '') IS NOT NULL THEN
    IF platform_private.account_erasure_bypass() THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP <> 'UPDATE' OR TG_LEVEL <> 'ROW'
    OR TG_TABLE_NAME NOT IN ('learning_test_attempts', 'learning_item_reviews', 'learning_track_preferences')
  THEN
    RAISE EXCEPTION 'Learning record is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'learning_test_attempts' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'Learning record is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.student_membership_id IS DISTINCT FROM OLD.student_membership_id
      OR NEW.form_id IS DISTINCT FROM OLD.form_id
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.revision <> OLD.revision + 1
    THEN
      RAISE EXCEPTION 'Learning attempt identity is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'learning_item_reviews' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.student_membership_id IS DISTINCT FROM OLD.student_membership_id
      OR NEW.track IS DISTINCT FROM OLD.track OR NEW.item_key IS DISTINCT FROM OLD.item_key
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Learning review identity is immutable' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.student_membership_id IS DISTINCT FROM OLD.student_membership_id
      OR NEW.track IS DISTINCT FROM OLD.track
    THEN
      RAISE EXCEPTION 'Learning preference identity is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER learning_topic_validate BEFORE INSERT ON platform_private.learning_topics
  FOR EACH ROW EXECUTE FUNCTION platform_private.validate_learning_topic();
CREATE TRIGGER learning_figure_validate BEFORE INSERT ON platform_private.learning_figures
  FOR EACH ROW EXECUTE FUNCTION platform_private.validate_learning_figure();
CREATE TRIGGER learning_item_validate BEFORE INSERT ON platform_private.learning_items
  FOR EACH ROW EXECUTE FUNCTION platform_private.validate_learning_item();
CREATE TRIGGER learning_test_form_validate BEFORE INSERT ON platform_private.learning_test_forms
  FOR EACH ROW EXECUTE FUNCTION platform_private.validate_learning_test_form();
CREATE TRIGGER csca_exam_session_validate BEFORE INSERT ON platform_private.csca_exam_sessions
  FOR EACH ROW EXECUTE FUNCTION platform_private.validate_csca_exam_session();

DO $a285_guards$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'platform_private.learning_topics', 'platform_private.learning_figures',
    'platform_private.learning_items', 'platform_private.learning_test_forms',
    'platform_private.csca_exam_sessions', 'platform.learning_test_attempts',
    'platform_private.learning_test_requests', 'platform.learning_item_reviews',
    'platform_private.learning_review_requests', 'platform.learning_item_events',
    'platform_private.learning_item_reports', 'platform.learning_track_preferences'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %s FOR EACH ROW '
      'EXECUTE FUNCTION platform_private.guard_csca_learning()',
      split_part(target, '.', 2) || '_guard', target);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
      'EXECUTE FUNCTION platform_private.guard_csca_learning()',
      split_part(target, '.', 2) || '_no_truncate', target);
  END LOOP;
END
$a285_guards$;

-- ---------------------------------------------------------------------------
-- Проекция, разбор и проверка задания. Ключ (answer_index) и разборы в
-- проекцию не входят.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_item_public(p_item platform_private.learning_items)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'itemKey', p_item.item_key,
    'topicKey', p_item.topic_key,
    'syllabusPoint', p_item.syllabus_point,
    'difficulty', p_item.difficulty,
    'estSeconds', p_item.body -> 'est_seconds',
    'figureKey', p_item.body -> 'figure_key',
    'stemEn', p_item.body -> 'stem_en',
    'options', (SELECT jsonb_agg(jsonb_build_object('id', option ->> 'id', 'label', option -> 'label')
        ORDER BY ordinality)
      FROM jsonb_array_elements(p_item.body -> 'options') WITH ORDINALITY AS options(option, ordinality))))
$$;

CREATE FUNCTION platform_private.learning_item_explain(p_item platform_private.learning_items)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'correctOptionId', p_item.body -> 'options' -> (p_item.body ->> 'answer_index')::INTEGER ->> 'id',
    'options', (SELECT jsonb_agg(jsonb_build_object('id', option ->> 'id',
        'explainRu', option -> 'explain_ru', 'explainKy', option -> 'explain_ky') ORDER BY ordinality)
      FROM jsonb_array_elements(p_item.body -> 'options') WITH ORDINALITY AS options(option, ordinality)),
    'solutionRu', p_item.body -> 'solution_ru',
    'solutionKy', p_item.body -> 'solution_ky',
    'terms', p_item.body -> 'terms')
$$;

CREATE FUNCTION platform_private.learning_item_correct_option(p_item platform_private.learning_items)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT p_item.body -> 'options' -> (p_item.body ->> 'answer_index')::INTEGER ->> 'id'
$$;

-- Ответ ровно {"selected": "<id варианта>"}; иначе 22023.
CREATE FUNCTION platform_private.learning_item_grade(p_item platform_private.learning_items, p_answer JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE is_correct BOOLEAN;
BEGIN
  IF p_item.id IS NULL THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_answer IS NULL OR NOT platform_private.learning_keys_are(p_answer, ARRAY['selected'])
    OR jsonb_typeof(p_answer -> 'selected') <> 'string'
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_item.body -> 'options') option
      WHERE option ->> 'id' = p_answer ->> 'selected')
  THEN
    RAISE EXCEPTION 'Invalid item answer' USING ERRCODE = '22023';
  END IF;
  is_correct := platform_private.learning_item_correct_option(p_item) = p_answer ->> 'selected';
  RETURN jsonb_build_object('correct', is_correct, 'verdict', jsonb_build_object('correct', is_correct));
END $$;

CREATE FUNCTION platform_private.learning_item_for_exercise(p_exercise platform_private.learning_exercises)
RETURNS platform_private.learning_items LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT item.* FROM platform_private.learning_lessons lesson
  JOIN platform_private.learning_items item
    ON item.module_id = lesson.module_id AND item.item_key = p_exercise.body ->> 'item_key'
  WHERE lesson.id = p_exercise.lesson_id
$$;

-- Словарь рисунков {key: {svg, viewBox, altRu, altKy, altEn, sha256}}.
CREATE FUNCTION platform_private.learning_figures_payload(p_module_id UUID, p_keys TEXT[])
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(figure.figure_key, jsonb_build_object(
      'svg', figure.svg, 'viewBox', figure.view_box,
      'altRu', figure.alt_ru, 'altKy', figure.alt_ky, 'altEn', figure.alt_en,
      'sha256', figure.sha256) ORDER BY figure.figure_key), '{}'::JSONB)
  FROM platform_private.learning_figures figure
  WHERE figure.module_id = p_module_id AND figure.figure_key = ANY (COALESCE(p_keys, '{}'::TEXT[]))
$$;

-- 198: проекция, разбор и проверка упражнения получают явную ветку item
-- (иначе item молча ушёл бы в ветку reading).
SELECT pg_temp.a285_replace('platform_private.learning_exercise_public(platform_private.learning_exercises)',
$old$    WHEN 'short_answer' THEN '{}'::JSONB
$old$,
$new$    WHEN 'item' THEN platform_private.learning_item_public(platform_private.learning_item_for_exercise(p_exercise))
    WHEN 'short_answer' THEN '{}'::JSONB
$new$, 1);

SELECT pg_temp.a285_replace('platform_private.learning_exercise_explain(platform_private.learning_exercises)',
$old$    WHEN 'short_answer' THEN jsonb_build_object(
      'answer', p_exercise.body -> 'accepted' -> 0,$old$,
$new$    WHEN 'item' THEN platform_private.learning_item_explain(platform_private.learning_item_for_exercise(p_exercise))
    WHEN 'short_answer' THEN jsonb_build_object(
      'answer', p_exercise.body -> 'accepted' -> 0,$new$, 1);

SELECT pg_temp.a285_replace('platform_private.grade_learning_answer(platform_private.learning_exercises,jsonb)',
$old$  ELSIF p_exercise.exercise_type = 'short_answer' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1$old$,
$new$  ELSIF p_exercise.exercise_type = 'item' THEN
    RETURN platform_private.learning_item_grade(
      platform_private.learning_item_for_exercise(p_exercise), p_answer);
  ELSIF p_exercise.exercise_type = 'short_answer' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1$new$, 1);
-- Проверка item читает банк заданий: функция больше не IMMUTABLE.
ALTER FUNCTION platform_private.grade_learning_answer(platform_private.learning_exercises, JSONB) STABLE;

-- ---------------------------------------------------------------------------
-- Журнал ответов и ящик повторения.
-- ---------------------------------------------------------------------------
-- Интервал ящика: 1 -> 1 день, 2 -> 3, 3 -> 7, 4 -> 14.
CREATE FUNCTION platform_private.learning_review_interval(p_box INTEGER)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT (ARRAY[1, 3, 7, 14])[p_box]
$$;

-- Неверный ответ: задание в ящик 1 на завтра (по Бишкеку); выбывшее
-- возвращается в банк.
CREATE FUNCTION platform_private.learning_review_mark_wrong(
  p_organization_id UUID, p_membership_id UUID, p_track TEXT, p_item_key TEXT
) RETURNS VOID LANGUAGE SQL VOLATILE SET search_path = '' AS $$
  INSERT INTO platform.learning_item_reviews AS review (organization_id, student_membership_id, track, item_key,
    box, due_on, lapses)
  VALUES (p_organization_id, p_membership_id, p_track, p_item_key, 1,
    platform_private.learning_local_date(clock_timestamp()) + 1, 0)
  ON CONFLICT (organization_id, student_membership_id, track, item_key) DO UPDATE
    SET box = 1, due_on = EXCLUDED.due_on, lapses = review.lapses + 1, retired_at = NULL,
      updated_at = clock_timestamp()
$$;

CREATE FUNCTION platform_private.learning_log_item_answer(
  p_organization_id UUID, p_membership_id UUID, p_track TEXT, p_item platform_private.learning_items,
  p_source TEXT, p_correct BOOLEAN, p_seconds INTEGER, p_ref_id UUID
) RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
BEGIN
  INSERT INTO platform.learning_item_events (organization_id, student_membership_id, track, item_key, topic_key,
    source, correct, seconds, ref_id)
  VALUES (p_organization_id, p_membership_id, p_track, p_item.item_key, p_item.topic_key,
    p_source, p_correct, p_seconds, p_ref_id);
  IF NOT p_correct AND p_source <> 'review' THEN
    PERFORM platform_private.learning_review_mark_wrong(p_organization_id, p_membership_id, p_track, p_item.item_key);
  END IF;
END $$;

-- Ответ на упражнение item в уроке или практике (вызывается из записи 198).
CREATE FUNCTION platform_private.learning_record_lesson_item_answer(
  p_organization_id UUID, p_membership_id UUID, p_exercise platform_private.learning_exercises,
  p_correct BOOLEAN, p_attempt_id UUID
) RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE lesson platform_private.learning_lessons%ROWTYPE; item platform_private.learning_items%ROWTYPE;
BEGIN
  SELECT * INTO lesson FROM platform_private.learning_lessons WHERE id = p_exercise.lesson_id;
  item := platform_private.learning_item_for_exercise(p_exercise);
  PERFORM platform_private.learning_log_item_answer(p_organization_id, p_membership_id,
    platform_private.learning_module_track(lesson.module_id), item,
    lesson.metadata ->> 'kind', p_correct, NULL, p_attempt_id);
END $$;

SELECT pg_temp.a285_replace('platform_private.write_learning_lesson(text,uuid,uuid,bigint,uuid,jsonb,uuid)',
$old$      grade := platform_private.grade_learning_answer(exercise, p_answer);
      UPDATE platform.learning_lesson_attempts
$old$,
$new$      grade := platform_private.grade_learning_answer(exercise, p_answer);
      -- 285: ответ на задание CSCA идёт в журнал ответов и в банк повторения.
      IF exercise.exercise_type = 'item' THEN
        PERFORM platform_private.learning_record_lesson_item_answer(actor.organization_id,
          actor.membership_id, exercise, (grade ->> 'correct')::BOOLEAN, attempt.id);
      END IF;
      UPDATE platform.learning_lesson_attempts
$new$, 1);

-- 198: карта модулей v1: только английский (старые сборки iPhone и веб
-- «Английский» не должны увидеть модуль CSCA).
SELECT pg_temp.a285_replace('platform.learning_modules_v1()',
$old$  FROM (SELECT DISTINCT ON (module_key) * FROM platform_private.learning_modules
    ORDER BY module_key, published_at DESC, id DESC) module;$old$,
$new$  FROM (SELECT DISTINCT ON (module_key) * FROM platform_private.learning_modules
    WHERE track = 'english'
    ORDER BY module_key, published_at DESC, id DESC) module;$new$, 1);

-- ---------------------------------------------------------------------------
-- Ученик: чтение и запись. Запись берёт живую авторитетную блокировку, как
-- 198 (сериализует записи с отзывом доступа).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.require_learning_actor_write()
RETURNS TABLE (organization_id UUID, membership_id UUID, profile_id UUID)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; locked_actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT * INTO locked_actor FROM platform_private.require_domain_actor(actor.organization_id, 'portal.read.self');
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF locked_actor.actor_role <> 'student' OR locked_actor.actor_membership_id <> actor.membership_id THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.organization_id, actor.membership_id, actor.profile_id;
END $$;

CREATE FUNCTION platform_private.require_csca_track(p_track TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF NOT platform_private.learning_csca_track_ok(p_track) THEN
    RAISE EXCEPTION 'Invalid learning track' USING ERRCODE = '22023';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Тест на время.
-- ---------------------------------------------------------------------------
-- Запас на сеть после срока: сохранение принимается до deadline_at + 15 с;
-- черновик старше этого срока сервер завершает сам при первом чтении.
CREATE FUNCTION platform_private.learning_test_grace()
RETURNS INTERVAL LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT INTERVAL '15 seconds'
$$;

-- Оценка попытки: доля верных всего, по темам и разделам программы, темп
-- (секунды присылает клиент, это подсказка, в оценку не входят).
CREATE FUNCTION platform_private.learning_test_result(
  p_attempt platform.learning_test_attempts, p_completion TEXT, p_completed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  WITH form AS (
    SELECT * FROM platform_private.learning_test_forms WHERE id = p_attempt.form_id
  ), graded AS (
    SELECT keys.value AS item_key, keys.ordinality, item.topic_key,
      (topic.metadata ->> 'section')::INTEGER AS section,
      p_attempt.answers ->> keys.value AS selected,
      COALESCE(p_attempt.answers ->> keys.value = platform_private.learning_item_correct_option(item), FALSE)
        AS is_correct,
      CASE WHEN jsonb_typeof(p_attempt.item_seconds -> keys.value) = 'number'
        THEN least(greatest((p_attempt.item_seconds ->> keys.value)::NUMERIC, 0), 3600)::INTEGER END AS seconds
    FROM form
    CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) WITH ORDINALITY AS keys(value, ordinality)
    JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = keys.value
    JOIN platform_private.learning_topics topic
      ON topic.module_id = form.module_id AND topic.topic_key = item.topic_key
  ), totals AS (
    SELECT count(*)::INTEGER AS total, count(selected)::INTEGER AS answered,
      count(*) FILTER (WHERE is_correct)::INTEGER AS correct,
      count(seconds) FILTER (WHERE selected IS NOT NULL)::INTEGER AS timed,
      round(avg(seconds) FILTER (WHERE selected IS NOT NULL)) AS avg_seconds
    FROM graded
  )
  SELECT jsonb_build_object(
    'itemsTotal', totals.total,
    'answeredCount', totals.answered,
    'correctCount', totals.correct,
    'unansweredCount', totals.total - totals.answered,
    'correctShare', CASE WHEN totals.total = 0 THEN 0 ELSE round(totals.correct::NUMERIC / totals.total, 4) END,
    'byTopic', (SELECT COALESCE(jsonb_agg(jsonb_build_object('topicKey', grouped.topic_key,
        'total', grouped.total, 'answered', grouped.answered, 'correct', grouped.correct)
        ORDER BY grouped.first_ordinality), '[]'::JSONB)
      FROM (SELECT topic_key, count(*) AS total, count(selected) AS answered,
          count(*) FILTER (WHERE is_correct) AS correct, min(ordinality) AS first_ordinality
        FROM graded GROUP BY topic_key) grouped),
    'bySection', (SELECT COALESCE(jsonb_agg(jsonb_build_object('section', grouped.section,
        'total', grouped.total, 'answered', grouped.answered, 'correct', grouped.correct)
        ORDER BY grouped.section), '[]'::JSONB)
      FROM (SELECT section, count(*) AS total, count(selected) AS answered,
          count(*) FILTER (WHERE is_correct) AS correct
        FROM graded GROUP BY section) grouped),
    'pace', jsonb_build_object('answeredWithTime', totals.timed, 'avgSeconds', totals.avg_seconds,
      'budgetSeconds', 75),
    'perItem', (SELECT COALESCE(jsonb_object_agg(item_key,
        jsonb_build_object('selected', selected, 'correct', is_correct)), '{}'::JSONB) FROM graded),
    'wrongItemKeys', (SELECT COALESCE(jsonb_agg(item_key ORDER BY ordinality)
        FILTER (WHERE selected IS NOT NULL AND NOT is_correct), '[]'::JSONB) FROM graded),
    'unansweredItemKeys', (SELECT COALESCE(jsonb_agg(item_key ORDER BY ordinality)
        FILTER (WHERE selected IS NULL), '[]'::JSONB) FROM graded),
    'completion', p_completion,
    'completedAt', p_completed_at)
  FROM totals
$$;

-- Завершение попытки: оценка, журнал ответов (только отвеченные задания),
-- неверные: в банк повторения.
CREATE FUNCTION platform_private.learning_test_finalize(p_attempt platform.learning_test_attempts, p_completion TEXT)
RETURNS platform.learning_test_attempts LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  form platform_private.learning_test_forms%ROWTYPE;
  track TEXT;
  completed_time TIMESTAMPTZ := clock_timestamp();
  result JSONB;
  attempt platform.learning_test_attempts%ROWTYPE;
  item RECORD;
BEGIN
  SELECT * INTO form FROM platform_private.learning_test_forms WHERE id = p_attempt.form_id;
  track := platform_private.learning_module_track(form.module_id);
  result := platform_private.learning_test_result(p_attempt, p_completion, completed_time);
  UPDATE platform.learning_test_attempts
    SET status = 'completed', completion = p_completion, result_snapshot = result,
      completed_at = completed_time, updated_at = completed_time, revision = revision + 1
    WHERE id = p_attempt.id
    RETURNING * INTO attempt;
  FOR item IN
    SELECT bank AS item_row, (result -> 'perItem' -> keys.value ->> 'correct')::BOOLEAN AS is_correct,
      CASE WHEN jsonb_typeof(p_attempt.item_seconds -> keys.value) = 'number'
        THEN least(greatest((p_attempt.item_seconds ->> keys.value)::NUMERIC, 0), 3600)::INTEGER END AS seconds
    FROM jsonb_array_elements_text(form.item_keys) WITH ORDINALITY AS keys(value, ordinality)
    JOIN platform_private.learning_items bank ON bank.module_id = form.module_id AND bank.item_key = keys.value
    WHERE p_attempt.answers ? keys.value
    ORDER BY keys.ordinality
  LOOP
    PERFORM platform_private.learning_log_item_answer(attempt.organization_id, attempt.student_membership_id,
      track, item.item_row, form.kind, item.is_correct, item.seconds, attempt.id);
  END LOOP;
  RETURN attempt;
END $$;

-- Просроченные черновики ученика (старше срока + 15 с) завершаются сервером.
CREATE FUNCTION platform_private.learning_tests_finalize_expired(p_organization_id UUID, p_membership_id UUID)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE attempt platform.learning_test_attempts%ROWTYPE; finalized INTEGER := 0;
BEGIN
  FOR attempt IN SELECT * FROM platform.learning_test_attempts
    WHERE organization_id = p_organization_id AND student_membership_id = p_membership_id
      AND status = 'draft' AND clock_timestamp() > deadline_at + platform_private.learning_test_grace()
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    PERFORM platform_private.learning_test_finalize(attempt, 'timeout');
    finalized := finalized + 1;
  END LOOP;
  RETURN finalized;
END $$;

-- Чтение с автозавершением: блокировка автора берётся, только если есть что
-- завершать (обычное чтение остаётся дешёвым).
CREATE FUNCTION platform_private.learning_tests_settle(p_organization_id UUID, p_membership_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM platform.learning_test_attempts
    WHERE organization_id = p_organization_id AND student_membership_id = p_membership_id
      AND status = 'draft' AND clock_timestamp() > deadline_at + platform_private.learning_test_grace())
  THEN
    SELECT * INTO actor FROM platform_private.require_learning_actor_write();
    IF actor.organization_id <> p_organization_id OR actor.membership_id <> p_membership_id THEN
      RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM platform_private.learning_tests_finalize_expired(p_organization_id, p_membership_id);
  END IF;
END $$;

-- Полный ответ о попытке. До завершения: задания без ключей и разборов.
-- После: итог и разбор каждого задания.
CREATE FUNCTION platform_private.learning_test_payload(p_attempt platform.learning_test_attempts)
RETURNS JSONB LANGUAGE SQL VOLATILE SET search_path = '' AS $$
  WITH form AS (
    SELECT * FROM platform_private.learning_test_forms WHERE id = p_attempt.form_id
  ), items AS (
    SELECT item AS item_row, item.item_key, item.body, keys.ordinality
    FROM form
    CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) WITH ORDINALITY AS keys(value, ordinality)
    JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = keys.value
  )
  SELECT jsonb_build_object(
    'attemptId', p_attempt.id,
    'formId', form.id,
    'formKey', form.form_key,
    'kind', form.kind,
    'track', platform_private.learning_module_track(form.module_id),
    'metadata', form.metadata,
    'durationSeconds', form.duration_seconds,
    'allowEarlyFinish', form.allow_early_finish,
    'graceSeconds', 15,
    'status', p_attempt.status,
    'revision', p_attempt.revision,
    'startedAt', p_attempt.started_at,
    'deadlineAt', p_attempt.deadline_at,
    'serverNow', clock_timestamp(),
    'itemsTotal', jsonb_array_length(form.item_keys),
    'answeredCount', (SELECT count(*) FROM jsonb_object_keys(p_attempt.answers)),
    'answers', p_attempt.answers,
    'flags', p_attempt.flags,
    'itemSeconds', p_attempt.item_seconds,
    'items', (SELECT COALESCE(jsonb_agg(platform_private.learning_item_public(items.item_row)
        ORDER BY items.ordinality), '[]'::JSONB) FROM items),
    'figures', platform_private.learning_figures_payload(form.module_id,
      ARRAY(SELECT items.body ->> 'figure_key' FROM items WHERE items.body ? 'figure_key')),
    'completion', p_attempt.completion,
    'completedAt', p_attempt.completed_at,
    'result', p_attempt.result_snapshot,
    'review', CASE WHEN p_attempt.status = 'completed' THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'itemKey', items.item_key,
          'selected', p_attempt.answers -> items.item_key,
          'correct', COALESCE(p_attempt.answers ->> items.item_key
            = platform_private.learning_item_correct_option(items.item_row), FALSE),
          'seconds', p_attempt.item_seconds -> items.item_key,
          'flagged', p_attempt.flags ? items.item_key,
          'explain', platform_private.learning_item_explain(items.item_row))
        ORDER BY items.ordinality), '[]'::JSONB) FROM items) END)
  FROM form
$$;

-- Проверка состояния черновика против формы: ответы {itemKey: id варианта},
-- флажки [itemKey], секунды {itemKey: 0..3600}.
CREATE FUNCTION platform_private.learning_test_state_ok(
  p_form platform_private.learning_test_forms, p_answers JSONB, p_flags JSONB, p_item_seconds JSONB
) RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    jsonb_typeof(p_answers) = 'object' AND jsonb_typeof(p_flags) = 'array'
    AND jsonb_typeof(p_item_seconds) = 'object'
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_answers) answer
      WHERE jsonb_typeof(answer.value) <> 'string'
        OR NOT EXISTS (SELECT 1 FROM platform_private.learning_items item
          CROSS JOIN LATERAL jsonb_array_elements(item.body -> 'options') option
          WHERE item.module_id = p_form.module_id AND item.item_key = answer.key
            AND p_form.item_keys ? answer.key AND option ->> 'id' = answer.value #>> '{}'))
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_flags) flag
      WHERE jsonb_typeof(flag) <> 'string' OR NOT p_form.item_keys ? (flag #>> '{}'))
    AND (SELECT count(DISTINCT flag) FROM jsonb_array_elements_text(p_flags) flag) = jsonb_array_length(p_flags)
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_item_seconds) entry
      WHERE NOT p_form.item_keys ? entry.key OR NOT platform_private.learning_int_ok(entry.value, 0, 3600)), FALSE)
$$;

-- Запись теста: start/save/complete с квитанциями по request_id (как 198).
-- start и complete возвращают свежий ответ (serverNow меняется), квитанция
-- хранит только id попытки; save возвращает сохранённую квитанцию.
CREATE FUNCTION platform_private.write_learning_test(
  p_operation TEXT, p_form_id UUID, p_attempt_id UUID, p_expected_revision BIGINT,
  p_answers JSONB, p_flags JSONB, p_item_seconds JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  attempt platform.learning_test_attempts%ROWTYPE;
  form platform_private.learning_test_forms%ROWTYPE;
  previous_request platform_private.learning_test_requests%ROWTYPE;
  response JSONB; receipt JSONB; input_hash TEXT; now_time TIMESTAMPTZ;
BEGIN
  IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('start', 'save', 'complete')
    OR (p_operation = 'start' AND p_form_id IS NULL)
    OR (p_operation <> 'start' AND (p_attempt_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1))
  THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  IF p_operation = 'save' AND (p_answers IS NULL OR p_flags IS NULL OR p_item_seconds IS NULL
    OR jsonb_typeof(p_answers) <> 'object' OR jsonb_typeof(p_flags) <> 'array'
    OR jsonb_typeof(p_item_seconds) <> 'object'
    OR octet_length(p_answers::TEXT) + octet_length(p_flags::TEXT) + octet_length(p_item_seconds::TEXT) > 32768)
  THEN
    RAISE EXCEPTION 'Invalid learning test state' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_learning_actor_write();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'learning-test:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  input_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation', p_operation, 'formId', p_form_id, 'attemptId', p_attempt_id,
    'expectedRevision', p_expected_revision, 'answers', p_answers, 'flags', p_flags,
    'itemSeconds', p_item_seconds)::TEXT, 'UTF8')), 'hex');
  SELECT * INTO previous_request FROM platform_private.learning_test_requests
    WHERE student_membership_id = actor.membership_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous_request.organization_id <> actor.organization_id
      OR previous_request.operation <> p_operation
      OR previous_request.input_hash <> input_hash THEN
      RAISE EXCEPTION 'Learning request was already used' USING ERRCODE = '22023';
    END IF;
    IF p_operation = 'save' THEN
      RETURN previous_request.receipt;
    END IF;
    PERFORM platform_private.learning_tests_finalize_expired(actor.organization_id, actor.membership_id);
    SELECT * INTO attempt FROM platform.learning_test_attempts WHERE id = previous_request.attempt_id;
    RETURN platform_private.learning_test_payload(attempt);
  END IF;

  IF p_operation = 'start' THEN
    SELECT * INTO form FROM platform_private.learning_test_forms WHERE id = p_form_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'learning-test-form:' || actor.membership_id::TEXT || ':' || form.id::TEXT, 0));
    PERFORM platform_private.learning_tests_finalize_expired(actor.organization_id, actor.membership_id);
    SELECT * INTO attempt FROM platform.learning_test_attempts
      WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
        AND form_id = form.id AND status = 'draft'
      FOR UPDATE;
    IF NOT FOUND THEN
      now_time := clock_timestamp();
      INSERT INTO platform.learning_test_attempts (organization_id, student_membership_id, form_id,
        started_at, deadline_at, created_at, updated_at)
      VALUES (actor.organization_id, actor.membership_id, form.id, now_time,
        now_time + make_interval(secs => form.duration_seconds), now_time, now_time)
      RETURNING * INTO attempt;
    END IF;
    receipt := jsonb_build_object('attemptId', attempt.id);
    response := platform_private.learning_test_payload(attempt);
  ELSE
    SELECT * INTO attempt FROM platform.learning_test_attempts
      WHERE id = p_attempt_id AND organization_id = actor.organization_id
        AND student_membership_id = actor.membership_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO form FROM platform_private.learning_test_forms WHERE id = attempt.form_id;
    now_time := clock_timestamp();
    IF p_operation = 'save' THEN
      IF attempt.status = 'completed' THEN
        RAISE EXCEPTION 'learning_test_completed' USING ERRCODE = '22023';
      END IF;
      IF now_time > attempt.deadline_at + platform_private.learning_test_grace() THEN
        RAISE EXCEPTION 'learning_test_deadline_passed' USING ERRCODE = '22023';
      END IF;
      IF attempt.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'Learning attempt changed' USING ERRCODE = '40001';
      END IF;
      IF NOT platform_private.learning_test_state_ok(form, p_answers, p_flags, p_item_seconds) THEN
        RAISE EXCEPTION 'Invalid learning test state' USING ERRCODE = '22023';
      END IF;
      UPDATE platform.learning_test_attempts
        SET answers = p_answers, flags = p_flags, item_seconds = p_item_seconds,
          revision = revision + 1, updated_at = now_time
        WHERE id = attempt.id
        RETURNING * INTO attempt;
      response := jsonb_build_object(
        'attemptId', attempt.id, 'status', attempt.status, 'revision', attempt.revision,
        'answeredCount', (SELECT count(*) FROM jsonb_object_keys(attempt.answers)),
        'savedAt', attempt.updated_at, 'deadlineAt', attempt.deadline_at, 'serverNow', now_time);
      receipt := response;
    ELSE
      IF attempt.status = 'draft' THEN
        IF now_time < attempt.deadline_at AND NOT form.allow_early_finish THEN
          RAISE EXCEPTION 'learning_test_early_finish_forbidden' USING ERRCODE = '22023';
        END IF;
        IF now_time <= attempt.deadline_at + platform_private.learning_test_grace()
          AND attempt.revision <> p_expected_revision THEN
          RAISE EXCEPTION 'Learning attempt changed' USING ERRCODE = '40001';
        END IF;
        attempt := platform_private.learning_test_finalize(attempt,
          CASE WHEN now_time >= attempt.deadline_at THEN 'timeout' ELSE 'submitted' END);
      END IF;
      receipt := jsonb_build_object('attemptId', attempt.id);
      response := platform_private.learning_test_payload(attempt);
    END IF;
  END IF;
  INSERT INTO platform_private.learning_test_requests (organization_id, student_membership_id, request_id,
    operation, input_hash, attempt_id, receipt)
  VALUES (actor.organization_id, actor.membership_id, p_request_id, p_operation, input_hash, attempt.id, receipt);
  RETURN response;
END $$;

CREATE FUNCTION platform.start_learning_test_v1(p_form_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_test('start', p_form_id, NULL, NULL, NULL, NULL, NULL, p_request_id)
$$;
CREATE FUNCTION platform.save_learning_test_v1(
  p_attempt_id UUID, p_expected_revision BIGINT, p_answers JSONB, p_flags JSONB, p_item_seconds JSONB,
  p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_test('save', NULL, p_attempt_id, p_expected_revision,
    p_answers, p_flags, p_item_seconds, p_request_id)
$$;
CREATE FUNCTION platform.complete_learning_test_v1(p_attempt_id UUID, p_expected_revision BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_test('complete', NULL, p_attempt_id, p_expected_revision,
    NULL, NULL, NULL, p_request_id)
$$;

CREATE FUNCTION platform.learning_test_attempt_v1(p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; attempt platform.learning_test_attempts%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.learning_test_attempts
    WHERE id = p_attempt_id AND organization_id = actor.organization_id
      AND student_membership_id = actor.membership_id)
  THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.learning_tests_settle(actor.organization_id, actor.membership_id);
  SELECT * INTO attempt FROM platform.learning_test_attempts WHERE id = p_attempt_id;
  RETURN platform_private.learning_test_payload(attempt);
END $$;

-- ---------------------------------------------------------------------------
-- Состояние тем (DESIGN §8.3): окно: последние 6 проверенных ответов по теме
-- из всех источников.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_topic_states(p_organization_id UUID, p_membership_id UUID, p_track TEXT)
RETURNS TABLE (module_id UUID, topic_key TEXT, order_index INTEGER, metadata JSONB, state TEXT,
  window_answers INTEGER, window_correct INTEGER, answers_total INTEGER, correct_total INTEGER,
  lesson_completed BOOLEAN, has_lessons BOOLEAN)
LANGUAGE SQL STABLE SET search_path = '' AS $$
  WITH modules AS (
    SELECT * FROM platform_private.learning_track_modules(p_track)
  ), ranked AS (
    SELECT event.topic_key, event.correct,
      row_number() OVER (PARTITION BY event.topic_key ORDER BY event.answered_at DESC, event.id DESC) AS rn
    FROM platform.learning_item_events event
    WHERE event.organization_id = p_organization_id AND event.student_membership_id = p_membership_id
      AND event.track = p_track
  ), window_stats AS (
    SELECT ranked.topic_key,
      count(*) FILTER (WHERE rn <= 6)::INTEGER AS n,
      count(*) FILTER (WHERE rn <= 6 AND correct)::INTEGER AS c,
      count(*)::INTEGER AS total,
      count(*) FILTER (WHERE correct)::INTEGER AS total_correct
    FROM ranked GROUP BY ranked.topic_key
  ), lesson_activity AS (
    SELECT lesson.metadata ->> 'topic_key' AS topic_key,
      bool_or(attempt.status = 'completed' AND lesson.metadata ->> 'kind' = 'lesson') AS completed
    FROM platform.learning_lesson_attempts attempt
    JOIN platform_private.learning_lessons lesson ON lesson.id = attempt.lesson_id
    JOIN platform_private.learning_modules module ON module.id = lesson.module_id AND module.track = p_track
    WHERE attempt.organization_id = p_organization_id AND attempt.student_membership_id = p_membership_id
    GROUP BY lesson.metadata ->> 'topic_key'
  )
  SELECT topic.module_id, topic.topic_key, topic.order_index, topic.metadata,
    CASE
      WHEN COALESCE(stats.n, 0) = 0 AND activity.topic_key IS NULL THEN 'not_started'
      WHEN COALESCE(stats.n, 0) < 3 THEN 'few_data'
      WHEN stats.c * 2 < stats.n THEN 'gap'
      WHEN stats.c * 5 < stats.n * 4 THEN 'shaky'
      ELSE 'confident'
    END,
    COALESCE(stats.n, 0), COALESCE(stats.c, 0), COALESCE(stats.total, 0), COALESCE(stats.total_correct, 0),
    COALESCE(activity.completed, FALSE),
    EXISTS (SELECT 1 FROM platform_private.learning_lessons lesson
      WHERE lesson.module_id = topic.module_id AND lesson.metadata ->> 'topic_key' = topic.topic_key)
  FROM platform_private.learning_topics topic
  JOIN modules ON modules.id = topic.module_id
  LEFT JOIN window_stats stats ON stats.topic_key = topic.topic_key
  LEFT JOIN lesson_activity activity ON activity.topic_key = topic.topic_key
$$;

-- ---------------------------------------------------------------------------
-- Чтение v2: модули трека, главная трека, урок.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.learning_modules_v2(p_track TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; modules JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF p_track IS NULL OR p_track NOT IN ('english', 'csca-math', 'csca-physics', 'csca-chemistry') THEN
    RAISE EXCEPTION 'Invalid learning track' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'moduleId', module.id, 'moduleKey', module.module_key, 'version', module.version,
    'track', module.track, 'metadata', module.metadata,
    'lessonsTotal', (SELECT count(*) FROM platform_private.learning_lessons lesson
      WHERE lesson.module_id = module.id),
    'lessonsCompleted', (SELECT count(*) FROM platform_private.learning_lessons lesson
      WHERE lesson.module_id = module.id AND EXISTS (
        SELECT 1 FROM platform.learning_lesson_attempts attempt
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id
          AND attempt.lesson_id = lesson.id AND attempt.status = 'completed')),
    'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'lessonId', lesson.id, 'lessonKey', lesson.lesson_key,
        'orderIndex', lesson.order_index, 'metadata', lesson.metadata,
        'exercisesTotal', (SELECT count(*) FROM platform_private.learning_exercises exercise
          WHERE exercise.lesson_id = lesson.id),
        'completed', EXISTS (SELECT 1 FROM platform.learning_lesson_attempts attempt
          WHERE attempt.organization_id = actor.organization_id
            AND attempt.student_membership_id = actor.membership_id
            AND attempt.lesson_id = lesson.id AND attempt.status = 'completed'),
        'draftAttemptId', (SELECT attempt.id FROM platform.learning_lesson_attempts attempt
          WHERE attempt.organization_id = actor.organization_id
            AND attempt.student_membership_id = actor.membership_id
            AND attempt.lesson_id = lesson.id AND attempt.status = 'draft'),
        'lastResult', (SELECT attempt.result_snapshot
          FROM platform.learning_lesson_attempts attempt
          WHERE attempt.organization_id = actor.organization_id
            AND attempt.student_membership_id = actor.membership_id
            AND attempt.lesson_id = lesson.id AND attempt.status = 'completed'
          ORDER BY attempt.completed_at DESC, attempt.id DESC LIMIT 1)
      ) ORDER BY lesson.order_index)
      FROM platform_private.learning_lessons lesson
      WHERE lesson.module_id = module.id), '[]'::JSONB)
  ) ORDER BY module.module_key), '[]'::JSONB) INTO modules
  FROM platform_private.learning_track_modules(p_track) module;
  RETURN jsonb_build_object('track', p_track, 'modules', modules);
END $$;

CREATE FUNCTION platform.learning_lesson_v2(p_lesson_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lesson platform_private.learning_lessons%ROWTYPE;
  module platform_private.learning_modules%ROWTYPE;
  topic platform_private.learning_topics%ROWTYPE;
  draft platform.learning_lesson_attempts%ROWTYPE;
  latest platform.learning_lesson_attempts%ROWTYPE;
  figure_keys TEXT[];
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT * INTO lesson FROM platform_private.learning_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO module FROM platform_private.learning_modules WHERE id = lesson.module_id;
  SELECT * INTO topic FROM platform_private.learning_topics
    WHERE module_id = module.id AND topic_key = lesson.metadata ->> 'topic_key';
  SELECT * INTO draft FROM platform.learning_lesson_attempts
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
      AND lesson_id = lesson.id AND status = 'draft';
  SELECT * INTO latest FROM platform.learning_lesson_attempts
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
      AND lesson_id = lesson.id AND status = 'completed'
    ORDER BY completed_at DESC, id DESC LIMIT 1;
  IF module.track <> 'english' THEN
    figure_keys := ARRAY(
      SELECT block ->> 'figure_key' FROM jsonb_array_elements(lesson.theory) block
      WHERE block ->> 'kind' IN ('figure', 'interactive')
      UNION
      SELECT item.body ->> 'figure_key' FROM platform_private.learning_exercises exercise
      JOIN platform_private.learning_items item
        ON item.module_id = module.id AND item.item_key = exercise.body ->> 'item_key'
      WHERE exercise.lesson_id = lesson.id AND exercise.exercise_type = 'item' AND item.body ? 'figure_key');
  END IF;
  RETURN jsonb_build_object(
    'module', jsonb_build_object('moduleId', module.id, 'moduleKey', module.module_key,
      'version', module.version, 'track', module.track, 'metadata', module.metadata),
    'topic', CASE WHEN topic.id IS NULL THEN NULL ELSE jsonb_build_object(
      'topicKey', topic.topic_key, 'orderIndex', topic.order_index, 'metadata', topic.metadata) END,
    'lesson', jsonb_build_object('lessonId', lesson.id, 'lessonKey', lesson.lesson_key,
      'orderIndex', lesson.order_index, 'metadata', lesson.metadata, 'theory', lesson.theory,
      'exercises', COALESCE((SELECT jsonb_agg(platform_private.learning_exercise_public(exercise.*)
          ORDER BY exercise.order_index)
        FROM platform_private.learning_exercises exercise
        WHERE exercise.lesson_id = lesson.id), '[]'::JSONB)),
    'figures', platform_private.learning_figures_payload(module.id, figure_keys),
    'draft', CASE WHEN draft.id IS NULL THEN NULL
      ELSE platform_private.learning_attempt_payload(draft) END,
    'latestCompleted', CASE WHEN latest.id IS NULL THEN NULL
      ELSE platform_private.learning_attempt_payload(latest) END
  );
END $$;

-- Главная трека: одним вызовом модули, темы с состоянием, уроки, формы
-- тестов с черновиком и последним итогом, повторение, календарь, целевая
-- сессия и «следующий шаг» (DESIGN §2).
CREATE FUNCTION platform.learning_track_home_v1(p_track TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  today DATE;
  states JSONB; modules JSONB; topics JSONB; lessons JSONB; tests JSONB; review JSONB; sessions JSONB;
  target TEXT; next_step JSONB; diagnostic RECORD; chosen RECORD; lesson_pick RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  PERFORM platform_private.require_csca_track(p_track);
  PERFORM platform_private.learning_tests_settle(actor.organization_id, actor.membership_id);
  today := platform_private.learning_local_date(clock_timestamp());

  SELECT COALESCE(jsonb_agg(to_jsonb(topic_state) ORDER BY topic_state.order_index), '[]'::JSONB) INTO states
    FROM platform_private.learning_topic_states(actor.organization_id, actor.membership_id, p_track) topic_state;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('moduleId', module.id, 'moduleKey', module.module_key,
      'version', module.version, 'metadata', module.metadata) ORDER BY module.module_key), '[]'::JSONB)
    INTO modules FROM platform_private.learning_track_modules(p_track) module;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('moduleId', state.module_id, 'topicKey', state.topic_key,
      'orderIndex', state.order_index, 'metadata', state.metadata, 'state', state.state,
      'windowAnswers', state.window_answers, 'windowCorrect', state.window_correct,
      'lessonCompleted', state.lesson_completed, 'hasLessons', state.has_lessons)
      ORDER BY state.order_index), '[]'::JSONB)
    INTO topics FROM jsonb_to_recordset(states) AS state(module_id UUID, topic_key TEXT, order_index INTEGER,
      metadata JSONB, state TEXT, window_answers INTEGER, window_correct INTEGER, lesson_completed BOOLEAN,
      has_lessons BOOLEAN);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'moduleId', lesson.module_id, 'lessonId', lesson.id, 'lessonKey', lesson.lesson_key,
      'orderIndex', lesson.order_index, 'metadata', lesson.metadata,
      'exercisesTotal', (SELECT count(*) FROM platform_private.learning_exercises exercise
        WHERE exercise.lesson_id = lesson.id),
      -- Пройденность по ключу урока: новый выпуск контента её не обнуляет.
      'completed', EXISTS (SELECT 1 FROM platform.learning_lesson_attempts attempt
        JOIN platform_private.learning_lessons done ON done.id = attempt.lesson_id
        JOIN platform_private.learning_modules done_module ON done_module.id = done.module_id
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id AND attempt.status = 'completed'
          AND done.lesson_key = lesson.lesson_key AND done_module.track = p_track),
      'draftAttemptId', (SELECT attempt.id FROM platform.learning_lesson_attempts attempt
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id
          AND attempt.lesson_id = lesson.id AND attempt.status = 'draft'),
      'lastResult', (SELECT attempt.result_snapshot FROM platform.learning_lesson_attempts attempt
        JOIN platform_private.learning_lessons done ON done.id = attempt.lesson_id
        JOIN platform_private.learning_modules done_module ON done_module.id = done.module_id
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id AND attempt.status = 'completed'
          AND done.lesson_key = lesson.lesson_key AND done_module.track = p_track
        ORDER BY attempt.completed_at DESC, attempt.id DESC LIMIT 1))
      ORDER BY lesson.order_index), '[]'::JSONB)
    INTO lessons
    FROM platform_private.learning_lessons lesson
    JOIN platform_private.learning_track_modules(p_track) module ON module.id = lesson.module_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'moduleId', form.module_id, 'formId', form.id, 'formKey', form.form_key, 'kind', form.kind,
      'metadata', form.metadata, 'durationSeconds', form.duration_seconds,
      'allowEarlyFinish', form.allow_early_finish, 'itemsTotal', jsonb_array_length(form.item_keys),
      'draft', (SELECT jsonb_build_object('attemptId', attempt.id, 'revision', attempt.revision,
          'startedAt', attempt.started_at, 'deadlineAt', attempt.deadline_at,
          'answeredCount', (SELECT count(*) FROM jsonb_object_keys(attempt.answers)))
        FROM platform.learning_test_attempts attempt
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id
          AND attempt.form_id = form.id AND attempt.status = 'draft'),
      'lastResult', (SELECT jsonb_build_object('attemptId', attempt.id, 'completedAt', attempt.completed_at,
          'completion', attempt.completion,
          'itemsTotal', attempt.result_snapshot -> 'itemsTotal',
          'answeredCount', attempt.result_snapshot -> 'answeredCount',
          'correctCount', attempt.result_snapshot -> 'correctCount',
          'correctShare', attempt.result_snapshot -> 'correctShare')
        FROM platform.learning_test_attempts attempt
        JOIN platform_private.learning_test_forms done ON done.id = attempt.form_id
        JOIN platform_private.learning_modules done_module ON done_module.id = done.module_id
        WHERE attempt.organization_id = actor.organization_id
          AND attempt.student_membership_id = actor.membership_id AND attempt.status = 'completed'
          AND done.form_key = form.form_key AND done_module.track = p_track
        ORDER BY attempt.completed_at DESC, attempt.id DESC LIMIT 1))
      ORDER BY CASE form.kind WHEN 'diagnostic' THEN 0 ELSE 1 END, form.form_key), '[]'::JSONB)
    INTO tests
    FROM platform_private.learning_test_forms form
    JOIN platform_private.learning_track_modules(p_track) module ON module.id = form.module_id;

  SELECT jsonb_build_object(
      'dueCount', count(*) FILTER (WHERE review.due_on <= today),
      'activeCount', count(*),
      'nextDueOn', min(review.due_on) FILTER (WHERE review.due_on > today))
    INTO review
    FROM platform.learning_item_reviews review
    WHERE review.organization_id = actor.organization_id AND review.student_membership_id = actor.membership_id
      AND review.track = p_track AND review.retired_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('sessionKey', session.session_key,
      'examFrom', session.exam_from, 'examTo', session.exam_to,
      'registrationOpensAt', session.registration_opens_at,
      'registrationClosesAt', session.registration_closes_at,
      'sourceUrl', session.source_url, 'verifiedOn', session.verified_on) ORDER BY session.exam_from), '[]'::JSONB)
    INTO sessions
    FROM (SELECT DISTINCT ON (session_key) * FROM platform_private.csca_exam_sessions
      ORDER BY session_key, published_at DESC, id DESC) session
    WHERE session.exam_to >= today;

  SELECT preference.target_session_key INTO target FROM platform.learning_track_preferences preference
    WHERE preference.organization_id = actor.organization_id
      AND preference.student_membership_id = actor.membership_id AND preference.track = p_track;

  -- Следующий шаг (детерминированно): 1) диагностика, пока её не прошли;
  -- 2) тема «Пробел», «Мало данных» или «Не начато» с уроками и пройденными
  -- предпосылками, с наибольшим весом в пробном, при равенстве меньший
  -- порядок; 3) первая тема «Шатко»; 4) повторение, если есть задания на
  -- сегодня.
  SELECT form.id, form.form_key INTO diagnostic
    FROM platform_private.learning_test_forms form
    JOIN platform_private.learning_track_modules(p_track) module ON module.id = form.module_id
    WHERE form.kind = 'diagnostic'
    ORDER BY form.form_key LIMIT 1;
  IF diagnostic.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.learning_test_attempts attempt
    JOIN platform_private.learning_test_forms done ON done.id = attempt.form_id
    JOIN platform_private.learning_modules done_module ON done_module.id = done.module_id
    WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
      AND attempt.status = 'completed' AND done.kind = 'diagnostic' AND done_module.track = p_track)
  THEN
    next_step := jsonb_build_object('kind', 'test', 'formId', diagnostic.id, 'formKey', diagnostic.form_key);
  ELSE
    SELECT state.* INTO chosen FROM jsonb_to_recordset(states) AS state(module_id UUID, topic_key TEXT,
        order_index INTEGER, metadata JSONB, state TEXT, lesson_completed BOOLEAN, has_lessons BOOLEAN)
      WHERE state.has_lessons AND state.state IN ('gap', 'few_data', 'not_started')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(state.metadata -> 'prerequisites') prerequisite
          JOIN jsonb_to_recordset(states) AS required(topic_key TEXT, state TEXT, lesson_completed BOOLEAN,
            has_lessons BOOLEAN) ON required.topic_key = prerequisite.value
          WHERE required.has_lessons AND NOT required.lesson_completed
            AND required.state NOT IN ('shaky', 'confident'))
      ORDER BY (state.metadata ->> 'mock_items_estimate')::INTEGER DESC, state.order_index
      LIMIT 1;
    IF chosen.topic_key IS NULL THEN
      SELECT state.* INTO chosen FROM jsonb_to_recordset(states) AS state(module_id UUID, topic_key TEXT,
          order_index INTEGER, metadata JSONB, state TEXT, lesson_completed BOOLEAN, has_lessons BOOLEAN)
        WHERE state.has_lessons AND state.state = 'shaky'
        ORDER BY state.order_index LIMIT 1;
    END IF;
    IF chosen.topic_key IS NOT NULL THEN
      -- Первый непройденный урок темы, затем непройденная практика, затем
      -- практика (или урок) заново.
      SELECT lesson.id, lesson.lesson_key, lesson.metadata ->> 'kind' AS lesson_kind INTO lesson_pick
        FROM platform_private.learning_lessons lesson
        WHERE lesson.module_id = chosen.module_id AND lesson.metadata ->> 'topic_key' = chosen.topic_key
        ORDER BY EXISTS (SELECT 1 FROM platform.learning_lesson_attempts attempt
            JOIN platform_private.learning_lessons done ON done.id = attempt.lesson_id
            WHERE attempt.organization_id = actor.organization_id
              AND attempt.student_membership_id = actor.membership_id AND attempt.status = 'completed'
              AND done.lesson_key = lesson.lesson_key),
          CASE WHEN EXISTS (SELECT 1 FROM platform.learning_lesson_attempts attempt
              JOIN platform_private.learning_lessons done ON done.id = attempt.lesson_id
              WHERE attempt.organization_id = actor.organization_id
                AND attempt.student_membership_id = actor.membership_id AND attempt.status = 'completed'
                AND done.lesson_key = lesson.lesson_key)
            THEN CASE lesson.metadata ->> 'kind' WHEN 'practice' THEN 0 ELSE 1 END
            ELSE CASE lesson.metadata ->> 'kind' WHEN 'lesson' THEN 0 ELSE 1 END END,
          lesson.order_index
        LIMIT 1;
      next_step := jsonb_build_object('kind', 'lesson', 'lessonId', lesson_pick.id,
        'lessonKey', lesson_pick.lesson_key, 'lessonKind', lesson_pick.lesson_kind,
        'topicKey', chosen.topic_key, 'topicState', chosen.state);
    ELSIF (review ->> 'dueCount')::INTEGER > 0 THEN
      next_step := jsonb_build_object('kind', 'review');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'track', p_track,
    'serverNow', clock_timestamp(),
    'today', today,
    'modules', modules,
    'topics', topics,
    'lessons', lessons,
    'tests', tests,
    'review', review,
    'sessions', sessions,
    'targetSessionKey', target,
    'nextStep', next_step);
END $$;

-- ---------------------------------------------------------------------------
-- Повторение с интервалами.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.learning_review_v2(p_track TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; today DATE; items JSONB; figures JSONB; counts RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  PERFORM platform_private.require_csca_track(p_track);
  today := platform_private.learning_local_date(clock_timestamp());
  WITH due AS (
    SELECT review.*, platform_private.learning_track_item(p_track, review.item_key) AS item
    FROM platform.learning_item_reviews review
    WHERE review.organization_id = actor.organization_id AND review.student_membership_id = actor.membership_id
      AND review.track = p_track AND review.retired_at IS NULL AND review.due_on <= today
    ORDER BY review.due_on, review.box, review.updated_at, review.item_key
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('itemKey', due.item_key, 'box', due.box, 'dueOn', due.due_on,
        'lapses', due.lapses, 'item', platform_private.learning_item_public(due.item))
        ORDER BY due.due_on, due.box, due.updated_at, due.item_key) FILTER (WHERE (due.item).id IS NOT NULL),
      '[]'::JSONB),
    COALESCE(jsonb_object_agg(figure.figure_key, jsonb_build_object('svg', figure.svg, 'viewBox', figure.view_box,
        'altRu', figure.alt_ru, 'altKy', figure.alt_ky, 'altEn', figure.alt_en, 'sha256', figure.sha256))
        FILTER (WHERE figure.id IS NOT NULL), '{}'::JSONB)
    INTO items, figures
    FROM due
    LEFT JOIN platform_private.learning_figures figure
      ON figure.module_id = (due.item).module_id AND figure.figure_key = (due.item).body ->> 'figure_key';
  SELECT count(*) FILTER (WHERE review.due_on <= today) AS due_count, count(*) AS active_count,
      min(review.due_on) FILTER (WHERE review.due_on > today) AS next_due_on
    INTO counts
    FROM platform.learning_item_reviews review
    WHERE review.organization_id = actor.organization_id AND review.student_membership_id = actor.membership_id
      AND review.track = p_track AND review.retired_at IS NULL;
  RETURN jsonb_build_object('track', p_track, 'today', today, 'items', items, 'figures', figures,
    'dueCount', counts.due_count, 'activeCount', counts.active_count, 'nextDueOn', counts.next_due_on);
END $$;

-- Ответ в повторении: только задание своего банка со сроком сегодня или
-- раньше. Верно: ящик +1 (1, 3, 7, 14 дней), в ящике 4 задание выбывает.
-- Неверно: ящик 1 на завтра. Квитанции по request_id.
CREATE FUNCTION platform.record_learning_review_v1(p_track TEXT, p_item_key TEXT, p_answer JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  review platform.learning_item_reviews%ROWTYPE;
  item platform_private.learning_items%ROWTYPE;
  previous_request platform_private.learning_review_requests%ROWTYPE;
  grade JSONB; response JSONB; input_hash TEXT; today DATE; is_correct BOOLEAN; retired BOOLEAN := FALSE;
BEGIN
  PERFORM platform_private.require_csca_track(p_track);
  IF p_request_id IS NULL OR p_item_key IS NULL OR p_answer IS NULL OR jsonb_typeof(p_answer) <> 'object'
    OR octet_length(p_answer::TEXT) > 1024
  THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_learning_actor_write();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'learning-review:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  input_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'track', p_track, 'itemKey', p_item_key, 'answer', p_answer)::TEXT, 'UTF8')), 'hex');
  SELECT * INTO previous_request FROM platform_private.learning_review_requests
    WHERE student_membership_id = actor.membership_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous_request.organization_id <> actor.organization_id OR previous_request.input_hash <> input_hash THEN
      RAISE EXCEPTION 'Learning request was already used' USING ERRCODE = '22023';
    END IF;
    RETURN previous_request.receipt;
  END IF;
  SELECT * INTO review FROM platform.learning_item_reviews
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
      AND track = p_track AND item_key = p_item_key AND retired_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  today := platform_private.learning_local_date(clock_timestamp());
  IF review.due_on > today THEN
    RAISE EXCEPTION 'learning_review_not_due' USING ERRCODE = '22023';
  END IF;
  item := platform_private.learning_track_item(p_track, p_item_key);
  grade := platform_private.learning_item_grade(item, p_answer);
  is_correct := (grade ->> 'correct')::BOOLEAN;
  IF is_correct AND review.box = 4 THEN
    retired := TRUE;
    UPDATE platform.learning_item_reviews SET retired_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE organization_id = review.organization_id AND student_membership_id = review.student_membership_id
        AND track = review.track AND item_key = review.item_key
      RETURNING * INTO review;
  ELSIF is_correct THEN
    UPDATE platform.learning_item_reviews
      SET box = review.box + 1, due_on = today + platform_private.learning_review_interval(review.box + 1),
        updated_at = clock_timestamp()
      WHERE organization_id = review.organization_id AND student_membership_id = review.student_membership_id
        AND track = review.track AND item_key = review.item_key
      RETURNING * INTO review;
  ELSE
    UPDATE platform.learning_item_reviews
      SET box = 1, due_on = today + 1, lapses = review.lapses + 1, updated_at = clock_timestamp()
      WHERE organization_id = review.organization_id AND student_membership_id = review.student_membership_id
        AND track = review.track AND item_key = review.item_key
      RETURNING * INTO review;
  END IF;
  PERFORM platform_private.learning_log_item_answer(actor.organization_id, actor.membership_id, p_track, item,
    'review', is_correct, NULL, p_request_id);
  response := jsonb_build_object(
    'itemKey', p_item_key, 'correct', is_correct, 'verdict', grade -> 'verdict',
    'explain', platform_private.learning_item_explain(item),
    'box', review.box, 'dueOn', CASE WHEN retired THEN NULL ELSE review.due_on END, 'retired', retired,
    'lapses', review.lapses);
  INSERT INTO platform_private.learning_review_requests (organization_id, student_membership_id, request_id,
    track, item_key, input_hash, receipt)
  VALUES (actor.organization_id, actor.membership_id, p_request_id, p_track, p_item_key, input_hash, response);
  RETURN response;
END $$;

-- ---------------------------------------------------------------------------
-- Прогресс: покрытие программы, состояние тем, история тестов, темп против
-- 75 с, серия дней по Бишкеку, повторение.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.learning_track_progress_v1(p_track TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; today DATE; topics JSONB; coverage JSONB; tests JSONB; pace JSONB; streak JSONB; review JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  PERFORM platform_private.require_csca_track(p_track);
  PERFORM platform_private.learning_tests_settle(actor.organization_id, actor.membership_id);
  today := platform_private.learning_local_date(clock_timestamp());

  SELECT COALESCE(jsonb_agg(jsonb_build_object('topicKey', state.topic_key, 'orderIndex', state.order_index,
        'section', (state.metadata ->> 'section')::INTEGER, 'state', state.state,
        'windowAnswers', state.window_answers, 'windowCorrect', state.window_correct,
        'answersTotal', state.answers_total, 'correctTotal', state.correct_total,
        'lessonCompleted', state.lesson_completed) ORDER BY state.order_index), '[]'::JSONB),
      jsonb_build_object('topicsTotal', count(*), 'topicsWithCompletedLesson', count(*) FILTER (WHERE state.lesson_completed))
    INTO topics, coverage
    FROM platform_private.learning_topic_states(actor.organization_id, actor.membership_id, p_track) state;

  SELECT COALESCE(jsonb_agg(history.entry ORDER BY history.completed_at DESC, history.id DESC), '[]'::JSONB)
    INTO tests
    FROM (SELECT attempt.completed_at, attempt.id, jsonb_build_object('attemptId', attempt.id, 'formKey', form.form_key, 'kind', form.kind,
        'completion', attempt.completion, 'completedAt', attempt.completed_at,
        'itemsTotal', attempt.result_snapshot -> 'itemsTotal',
        'answeredCount', attempt.result_snapshot -> 'answeredCount',
        'correctCount', attempt.result_snapshot -> 'correctCount',
        'correctShare', attempt.result_snapshot -> 'correctShare',
        'avgSeconds', attempt.result_snapshot -> 'pace' -> 'avgSeconds') AS entry
      FROM platform.learning_test_attempts attempt
      JOIN platform_private.learning_test_forms form ON form.id = attempt.form_id
      JOIN platform_private.learning_modules module ON module.id = form.module_id AND module.track = p_track
      WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
        AND attempt.status = 'completed'
      ORDER BY attempt.completed_at DESC, attempt.id DESC
      LIMIT 20) history;

  SELECT jsonb_build_object('answeredWithTime', count(event.seconds),
      'avgSeconds', round(avg(event.seconds)), 'budgetSeconds', 75)
    INTO pace
    FROM platform.learning_item_events event
    WHERE event.organization_id = actor.organization_id AND event.student_membership_id = actor.membership_id
      AND event.track = p_track AND event.seconds IS NOT NULL;

  WITH days AS (
    SELECT platform_private.learning_local_date(attempt.completed_at) AS day
    FROM platform.learning_lesson_attempts attempt
    JOIN platform_private.learning_lessons lesson ON lesson.id = attempt.lesson_id
    JOIN platform_private.learning_modules module ON module.id = lesson.module_id AND module.track = p_track
    WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
      AND attempt.status = 'completed'
    UNION
    SELECT platform_private.learning_local_date(attempt.completed_at)
    FROM platform.learning_test_attempts attempt
    JOIN platform_private.learning_test_forms form ON form.id = attempt.form_id
    JOIN platform_private.learning_modules module ON module.id = form.module_id AND module.track = p_track
    WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
      AND attempt.status = 'completed'
    UNION
    SELECT platform_private.learning_local_date(event.answered_at)
    FROM platform.learning_item_events event
    WHERE event.organization_id = actor.organization_id AND event.student_membership_id = actor.membership_id
      AND event.track = p_track AND event.source = 'review'
  ), runs AS (
    SELECT day, day - (row_number() OVER (ORDER BY day))::INTEGER AS run_key FROM days
  ), grouped AS (
    SELECT run_key, count(*)::INTEGER AS length, max(day) AS last_day FROM runs GROUP BY run_key
  )
  SELECT jsonb_build_object(
      'current', COALESCE((SELECT length FROM grouped WHERE last_day >= today - 1 ORDER BY last_day DESC LIMIT 1), 0),
      'best', COALESCE((SELECT max(length) FROM grouped), 0),
      'lastActiveOn', (SELECT max(last_day) FROM grouped),
      'timeZone', 'Asia/Bishkek')
    INTO streak;

  SELECT jsonb_build_object('dueCount', count(*) FILTER (WHERE review.retired_at IS NULL AND review.due_on <= today),
      'activeCount', count(*) FILTER (WHERE review.retired_at IS NULL),
      'retiredCount', count(*) FILTER (WHERE review.retired_at IS NOT NULL))
    INTO review
    FROM platform.learning_item_reviews review
    WHERE review.organization_id = actor.organization_id AND review.student_membership_id = actor.membership_id
      AND review.track = p_track;

  RETURN jsonb_build_object('track', p_track, 'today', today, 'coverage', coverage, 'topics', topics,
    'tests', tests, 'pace', pace, 'streak', streak, 'review', review);
END $$;

-- ---------------------------------------------------------------------------
-- «Сообщить об ошибке» и целевая сессия.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.report_learning_item_v1(p_track TEXT, p_item_key TEXT, p_message TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; item platform_private.learning_items%ROWTYPE;
  previous platform_private.learning_item_reports%ROWTYPE; report platform_private.learning_item_reports%ROWTYPE;
  message TEXT := btrim(COALESCE(p_message, ''));
BEGIN
  PERFORM platform_private.require_csca_track(p_track);
  IF p_request_id IS NULL OR p_item_key IS NULL OR char_length(message) NOT BETWEEN 1 AND 500
    OR message ~ '[\x01-\x09\x0b-\x1f\x7f]'
  THEN
    RAISE EXCEPTION 'Invalid learning report' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_learning_actor_write();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'learning-report:' || actor.membership_id::TEXT, 0));
  SELECT * INTO previous FROM platform_private.learning_item_reports
    WHERE student_membership_id = actor.membership_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous.organization_id <> actor.organization_id OR previous.track <> p_track
      OR previous.item_key <> p_item_key OR previous.message <> message THEN
      RAISE EXCEPTION 'Learning request was already used' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('reportId', previous.id, 'itemKey', previous.item_key,
      'createdAt', previous.created_at);
  END IF;
  item := platform_private.learning_track_item(p_track, p_item_key);
  IF item.id IS NULL THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM platform_private.learning_item_reports r
      WHERE r.organization_id = actor.organization_id AND r.student_membership_id = actor.membership_id
        AND r.created_at > clock_timestamp() - INTERVAL '1 day') >= 20 THEN
    RAISE EXCEPTION 'learning_report_limit' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform_private.learning_item_reports (organization_id, student_membership_id, request_id, track,
    item_key, item_id, message)
  VALUES (actor.organization_id, actor.membership_id, p_request_id, p_track, p_item_key, item.id, message)
  RETURNING * INTO report;
  RETURN jsonb_build_object('reportId', report.id, 'itemKey', report.item_key, 'createdAt', report.created_at);
END $$;

-- Только Admin (шаблон 265): задание и текст, без автора.
CREATE FUNCTION platform.staff_learning_item_reports_v1(p_track TEXT, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; reports JSONB;
BEGIN
  SELECT a.organization_id, a.membership_id INTO actor FROM platform.current_actor_authority() a
    WHERE a.platform_role = 'admin'::platform.business_role AND a.membership_id IS NOT NULL
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning reports are unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.require_csca_track(p_track);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('reportId', report.id, 'track', report.track,
      'itemKey', report.item_key, 'topicKey', item.topic_key, 'moduleVersion', module.version,
      'stemEn', item.body -> 'stem_en', 'message', report.message, 'createdAt', report.created_at)
      ORDER BY report.created_at DESC, report.id DESC), '[]'::JSONB) INTO reports
    FROM (SELECT * FROM platform_private.learning_item_reports r
      WHERE r.organization_id = actor.organization_id AND r.track = p_track
      ORDER BY r.created_at DESC, r.id DESC LIMIT p_limit) report
    JOIN platform_private.learning_items item ON item.id = report.item_id
    JOIN platform_private.learning_modules module ON module.id = item.module_id;
  RETURN jsonb_build_object('track', p_track, 'reports', reports);
END $$;

CREATE FUNCTION platform.set_learning_target_session_v1(p_track TEXT, p_session_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; saved platform.learning_track_preferences%ROWTYPE;
BEGIN
  PERFORM platform_private.require_csca_track(p_track);
  IF p_session_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform_private.csca_exam_sessions session
    WHERE session.session_key = p_session_key)
  THEN
    RAISE EXCEPTION 'Invalid learning session' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_learning_actor_write();
  INSERT INTO platform.learning_track_preferences AS preference (organization_id, student_membership_id, track,
    target_session_key)
  VALUES (actor.organization_id, actor.membership_id, p_track, p_session_key)
  ON CONFLICT (organization_id, student_membership_id, track) DO UPDATE
    SET target_session_key = EXCLUDED.target_session_key, updated_at = clock_timestamp()
  RETURNING * INTO saved;
  RETURN jsonb_build_object('track', saved.track, 'targetSessionKey', saved.target_session_key,
    'updatedAt', saved.updated_at);
END $$;

-- ---------------------------------------------------------------------------
-- Удаление аккаунта (280): новые таблицы состояния: «свои» таблицы аккаунта
-- (простой аккаунт удаляется автоматически, как раньше) и счётчик «tests».
-- ---------------------------------------------------------------------------
-- The anchor is the 198 line alone, so the insert composes with other
-- additions to the list (284 appends the country choice tables after it).
SELECT pg_temp.a285_replace('platform_private.account_deletion_closure(uuid,uuid)',
$old$    'platform.learning_lesson_attempts', 'platform_private.learning_requests',
$old$,
$new$    'platform.learning_lesson_attempts', 'platform_private.learning_requests',
    -- 285: состояние подготовки к CSCA.
    'platform.learning_test_attempts', 'platform_private.learning_test_requests',
    'platform.learning_item_reviews', 'platform_private.learning_review_requests',
    'platform.learning_item_events', 'platform_private.learning_item_reports',
    'platform.learning_track_preferences',
$new$, 1);

SELECT pg_temp.a285_replace('platform_private.account_deletion_counts(jsonb)',
$old$          'platform.learning_lesson_attempts', 'platform_private.learning_requests') THEN 'tests'$old$,
$new$          'platform.learning_lesson_attempts', 'platform_private.learning_requests',
          'platform.learning_test_attempts', 'platform_private.learning_test_requests',
          'platform.learning_item_reviews', 'platform_private.learning_review_requests',
          'platform.learning_item_events', 'platform_private.learning_item_reports',
          'platform.learning_track_preferences') THEN 'tests'$new$, 1);

-- ---------------------------------------------------------------------------
-- Гранты: приватные помощники закрыты ото всех; RPC: только authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.learning_csca_track_ok(TEXT),
  platform_private.learning_keys_are(JSONB, TEXT[]),
  platform_private.learning_int_ok(JSONB, INTEGER, INTEGER),
  platform_private.learning_pair_ok(JSONB, TEXT),
  platform_private.learning_ru_ky_ok(JSONB),
  platform_private.learning_terms_ok(JSONB, INTEGER, INTEGER),
  platform_private.learning_module_track(UUID),
  platform_private.learning_lesson_track(UUID),
  platform_private.learning_track_modules(TEXT),
  platform_private.learning_track_item(TEXT, TEXT),
  platform_private.learning_local_date(TIMESTAMPTZ),
  platform_private.learning_csca_module_ok(TEXT, TEXT, JSONB),
  platform_private.validate_learning_topic(),
  platform_private.learning_svg_ok(TEXT, TEXT),
  platform_private.validate_learning_figure(),
  platform_private.validate_learning_item(),
  platform_private.validate_learning_test_form(),
  platform_private.learning_csca_cell_ok(JSONB),
  platform_private.learning_csca_block_ok(UUID, JSONB),
  platform_private.learning_csca_lesson_ok(UUID, JSONB, JSONB),
  platform_private.learning_exercise_item_ok(UUID, TEXT, JSONB),
  platform_private.validate_csca_exam_session(),
  platform_private.guard_csca_learning(),
  platform_private.learning_item_public(platform_private.learning_items),
  platform_private.learning_item_explain(platform_private.learning_items),
  platform_private.learning_item_correct_option(platform_private.learning_items),
  platform_private.learning_item_grade(platform_private.learning_items, JSONB),
  platform_private.learning_item_for_exercise(platform_private.learning_exercises),
  platform_private.learning_figures_payload(UUID, TEXT[]),
  platform_private.learning_review_interval(INTEGER),
  platform_private.learning_review_mark_wrong(UUID, UUID, TEXT, TEXT),
  platform_private.learning_log_item_answer(UUID, UUID, TEXT, platform_private.learning_items, TEXT, BOOLEAN, INTEGER, UUID),
  platform_private.learning_record_lesson_item_answer(UUID, UUID, platform_private.learning_exercises, BOOLEAN, UUID),
  platform_private.require_learning_actor_write(),
  platform_private.require_csca_track(TEXT),
  platform_private.learning_test_grace(),
  platform_private.learning_test_result(platform.learning_test_attempts, TEXT, TIMESTAMPTZ),
  platform_private.learning_test_finalize(platform.learning_test_attempts, TEXT),
  platform_private.learning_tests_finalize_expired(UUID, UUID),
  platform_private.learning_tests_settle(UUID, UUID),
  platform_private.learning_test_payload(platform.learning_test_attempts),
  platform_private.learning_test_state_ok(platform_private.learning_test_forms, JSONB, JSONB, JSONB),
  platform_private.write_learning_test(TEXT, UUID, UUID, BIGINT, JSONB, JSONB, JSONB, UUID),
  platform_private.learning_topic_states(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform.learning_modules_v2(TEXT),
  platform.learning_lesson_v2(UUID),
  platform.learning_track_home_v1(TEXT),
  platform.start_learning_test_v1(UUID, UUID),
  platform.save_learning_test_v1(UUID, BIGINT, JSONB, JSONB, JSONB, UUID),
  platform.complete_learning_test_v1(UUID, BIGINT, UUID),
  platform.learning_test_attempt_v1(UUID),
  platform.learning_review_v2(TEXT),
  platform.record_learning_review_v1(TEXT, TEXT, JSONB, UUID),
  platform.learning_track_progress_v1(TEXT),
  platform.report_learning_item_v1(TEXT, TEXT, TEXT, UUID),
  platform.staff_learning_item_reports_v1(TEXT, INTEGER),
  platform.set_learning_target_session_v1(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.learning_modules_v2(TEXT),
  platform.learning_lesson_v2(UUID),
  platform.learning_track_home_v1(TEXT),
  platform.start_learning_test_v1(UUID, UUID),
  platform.save_learning_test_v1(UUID, BIGINT, JSONB, JSONB, JSONB, UUID),
  platform.complete_learning_test_v1(UUID, BIGINT, UUID),
  platform.learning_test_attempt_v1(UUID),
  platform.learning_review_v2(TEXT),
  platform.record_learning_review_v1(TEXT, TEXT, JSONB, UUID),
  platform.learning_track_progress_v1(TEXT),
  platform.report_learning_item_v1(TEXT, TEXT, TEXT, UUID),
  platform.staff_learning_item_reports_v1(TEXT, INTEGER),
  platform.set_learning_target_session_v1(TEXT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Проверка применения: фрагменты на месте, прежние функции сохранили
-- definer, search_path и гранты.
-- ---------------------------------------------------------------------------
DO $a285_applied$
DECLARE routine REGPROCEDURE;
BEGIN
  IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.learning_modules_v1()'::REGPROCEDURE)
      NOT LIKE '%WHERE track = ''english''%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc
      WHERE oid = 'platform_private.write_learning_lesson(text,uuid,uuid,bigint,uuid,jsonb,uuid)'::REGPROCEDURE)
      NOT LIKE '%learning_record_lesson_item_answer%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc
      WHERE oid = 'platform_private.learning_exercise_public(platform_private.learning_exercises)'::REGPROCEDURE)
      NOT LIKE '%learning_item_public%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc
      WHERE oid = 'platform_private.learning_exercise_explain(platform_private.learning_exercises)'::REGPROCEDURE)
      NOT LIKE '%learning_item_explain%'
    OR (SELECT provolatile FROM pg_catalog.pg_proc
      WHERE oid = 'platform_private.grade_learning_answer(platform_private.learning_exercises,jsonb)'::REGPROCEDURE) <> 's'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.validate_learning_exercise()'::REGPROCEDURE)
      NOT LIKE '%learning_exercise_item_ok%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.validate_learning_lesson()'::REGPROCEDURE)
      NOT LIKE '%learning_csca_lesson_ok%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.validate_learning_module()'::REGPROCEDURE)
      NOT LIKE '%learning_csca_module_ok%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.account_deletion_closure(uuid,uuid)'::REGPROCEDURE)
      NOT LIKE '%platform.learning_track_preferences%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.account_deletion_counts(jsonb)'::REGPROCEDURE)
      NOT LIKE '%platform.learning_item_events%'
  THEN
    RAISE EXCEPTION 'a285_replace_not_applied';
  END IF;
  FOREACH routine IN ARRAY ARRAY[
    'platform.learning_modules_v1()'::REGPROCEDURE,
    'platform.learning_modules_v2(text)'::REGPROCEDURE,
    'platform.learning_lesson_v2(uuid)'::REGPROCEDURE,
    'platform.learning_track_home_v1(text)'::REGPROCEDURE,
    'platform.start_learning_test_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.save_learning_test_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid)'::REGPROCEDURE,
    'platform.complete_learning_test_v1(uuid,bigint,uuid)'::REGPROCEDURE,
    'platform.learning_test_attempt_v1(uuid)'::REGPROCEDURE,
    'platform.learning_review_v2(text)'::REGPROCEDURE,
    'platform.record_learning_review_v1(text,text,jsonb,uuid)'::REGPROCEDURE,
    'platform.learning_track_progress_v1(text)'::REGPROCEDURE,
    'platform.report_learning_item_v1(text,text,text,uuid)'::REGPROCEDURE,
    'platform.staff_learning_item_reports_v1(text,integer)'::REGPROCEDURE,
    'platform.set_learning_target_session_v1(text,text)'::REGPROCEDURE,
    'platform_private.write_learning_lesson(text,uuid,uuid,bigint,uuid,jsonb,uuid)'::REGPROCEDURE
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = routine)
      OR has_function_privilege('anon', routine, 'EXECUTE')
      OR has_function_privilege('service_role', routine, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a285_routine_hygiene: %', routine;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'platform_private.write_learning_lesson(text,uuid,uuid,bigint,uuid,jsonb,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.learning_modules_v1()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a285_grant_drift';
  END IF;
END
$a285_applied$;

NOTIFY pgrst, 'reload schema';
COMMIT;
