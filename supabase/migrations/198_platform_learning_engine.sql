-- PORT-4a «Движок обучения и профессий» (план
-- docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md §6 «Английский»/«Профессии»,
-- §8.5 «Личные данные», §8.6 «Публикуемый контент»; решения PORT-0 «Состав
-- первого учебного модуля» и «Покрытие профессий»; запись PLAN_CHANGES
-- 2026-09-19 «PORT-4a: движок обучения и профессий (миграция 198)»).
--
-- Референс-архитектура — миграция 135 (student assessments): версионируемый
-- ИММУТАБЕЛЬНЫЙ контент в platform_private, состояние ученика за RPC-only
-- границей с optimistic revision (40001), идемпотентность записи по
-- request_id с receipt. Отличия от 135 зафиксированы в PLAN_CHANGES:
--   - guard — каталожный паттерн 148/195/196 (student + portal.read.self,
--     СОЗНАТЕЛЬНО case-НЕзависимый: обучение — общая approved-возможность);
--   - проверка ответа и разбор выдаются сразу при сохранении ответа
--     (механика урока), но ТОЛЬКО для отвеченного упражнения: ключи ответов
--     и разборы неотвеченных не сериализуются клиенту вовсе;
--   - банк ошибок: id неверно отвеченных упражнений вычисляются сервером в
--     момент ответа и сохраняются в попытке и её result_snapshot;
--   - «урок пройден» = отвечено каждое упражнение; доля верных хранится в
--     result_snapshot, но порогом не является (план §6).
--
-- ПРИВАТНОСТЬ (план §6/§8.5, staff-невидимость обучения — стоячее решение):
-- ноль табличных грантов, только RPC; попытки/ответы/прогресс не попадают в
-- audit_events; admin/sales/curator и чужой студент получают 42501.
BEGIN;

-- ---------------------------------------------------------------------------
-- Контент: модули -> уроки -> упражнения. Версия живёт на модуле
-- (module_key + version); новый выпуск контента = новые строки всех трёх
-- таблиц, старые попытки продолжают ссылаться на свои строки (план §8.6).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.learning_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key TEXT NOT NULL CHECK (module_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  version TEXT NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (module_key, version)
);

CREATE TABLE platform_private.learning_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES platform_private.learning_modules(id) ON DELETE RESTRICT,
  lesson_key TEXT NOT NULL CHECK (lesson_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  order_index INTEGER NOT NULL CHECK (order_index BETWEEN 1 AND 200),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  theory JSONB NOT NULL CHECK (jsonb_typeof(theory) = 'array'),
  UNIQUE (module_id, lesson_key),
  UNIQUE (module_id, order_index)
);
CREATE INDEX learning_lessons_module_idx
  ON platform_private.learning_lessons(module_id, order_index);

CREATE TABLE platform_private.learning_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES platform_private.learning_lessons(id) ON DELETE RESTRICT,
  exercise_key TEXT NOT NULL CHECK (exercise_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  order_index INTEGER NOT NULL CHECK (order_index BETWEEN 1 AND 200),
  exercise_type TEXT NOT NULL
    CHECK (exercise_type IN ('choice', 'matching', 'short_answer', 'reading')),
  body JSONB NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  UNIQUE (lesson_id, exercise_key),
  UNIQUE (lesson_id, order_index)
);
CREATE INDEX learning_exercises_lesson_idx
  ON platform_private.learning_exercises(lesson_id, order_index);

-- Карточки профессий: версионируемый публикуемый контент (план §8.6);
-- body — полный объект карточки в схеме драфта professions-draft.json.
CREATE TABLE platform_private.profession_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_key TEXT NOT NULL CHECK (card_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  version TEXT NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  body JSONB NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (card_key, version)
);

-- ---------------------------------------------------------------------------
-- Состояние ученика: попытки уроков + идемпотентный журнал запросов (135).
-- ---------------------------------------------------------------------------
CREATE TABLE platform.learning_lesson_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES platform_private.learning_lessons(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  answers JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(answers) = 'object'),
  result_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, student_membership_id, id),
  CHECK ((status = 'draft' AND completed_at IS NULL AND result_snapshot IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND result_snapshot IS NOT NULL
      AND jsonb_typeof(result_snapshot) = 'object'))
);
CREATE UNIQUE INDEX learning_one_draft_per_lesson_idx
  ON platform.learning_lesson_attempts(organization_id, student_membership_id, lesson_id)
  WHERE status = 'draft';
CREATE INDEX learning_attempt_owner_history_idx
  ON platform.learning_lesson_attempts(organization_id, student_membership_id, created_at DESC, id DESC);
CREATE INDEX learning_attempt_lesson_idx ON platform.learning_lesson_attempts(lesson_id);

CREATE TABLE platform_private.learning_requests (
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
    REFERENCES platform.learning_lesson_attempts(organization_id, student_membership_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX learning_request_attempt_idx
  ON platform_private.learning_requests(organization_id, student_membership_id, attempt_id);

ALTER TABLE platform_private.learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_modules FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_lessons FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.profession_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.profession_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_lesson_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_lesson_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.learning_requests FORCE ROW LEVEL SECURITY;
-- Ноль permissive-политик и ноль табличных грантов: даже владелец ходит
-- только через RPC (паттерн 135).
REVOKE ALL ON TABLE
  platform_private.learning_modules,
  platform_private.learning_lessons,
  platform_private.learning_exercises,
  platform_private.profession_cards,
  platform.learning_lesson_attempts,
  platform_private.learning_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Валидаторы контента: exact-key JSONB по типам упражнений. Битый payload —
-- 22023 на INSERT; UPDATE/DELETE/TRUNCATE контента запрещены триггером ниже.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_text_ok(p_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_value) = 'string' AND NULLIF(btrim(p_value #>> '{}'), '') IS NOT NULL
$$;

-- Формулировка задания: либо только prompt_en (английский — содержание
-- обучения и не переводится), либо пара prompt_ru + prompt_ky (двуязычие
-- обязательно, план §7).
CREATE FUNCTION platform_private.learning_prompt_ok(p_body JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT (platform_private.learning_text_ok(p_body -> 'prompt_en')
      AND NOT p_body ? 'prompt_ru' AND NOT p_body ? 'prompt_ky')
    OR (NOT p_body ? 'prompt_en'
      AND platform_private.learning_text_ok(p_body -> 'prompt_ru')
      AND platform_private.learning_text_ok(p_body -> 'prompt_ky'))
$$;

-- Вариант choice/reading: label (английский) ИЛИ пара label_ru/label_ky;
-- explain_ru/explain_ky обязательны У КАЖДОГО варианта (ядро механики
-- разбора, notes модуля 1).
CREATE FUNCTION platform_private.learning_option_ok(p_option JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_option) = 'object'
    AND (p_option ->> 'id') ~ '^[a-z]$'
    AND platform_private.learning_text_ok(p_option -> 'explain_ru')
    AND platform_private.learning_text_ok(p_option -> 'explain_ky')
    AND ((platform_private.learning_text_ok(p_option -> 'label')
        AND NOT p_option ? 'label_ru' AND NOT p_option ? 'label_ky'
        AND (SELECT count(*) FROM jsonb_object_keys(p_option)) = 4)
      OR (NOT p_option ? 'label'
        AND platform_private.learning_text_ok(p_option -> 'label_ru')
        AND platform_private.learning_text_ok(p_option -> 'label_ky')
        AND (SELECT count(*) FROM jsonb_object_keys(p_option)) = 5))
$$;

CREATE FUNCTION platform_private.learning_options_ok(p_options JSONB, p_answer_index JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_options) = 'array'
    AND jsonb_array_length(p_options) BETWEEN 2 AND 6
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_options) o
      WHERE NOT platform_private.learning_option_ok(o))
    AND (SELECT count(DISTINCT o ->> 'id') FROM jsonb_array_elements(p_options) o)
      = jsonb_array_length(p_options)
    AND jsonb_typeof(p_answer_index) = 'number'
    AND (p_answer_index #>> '{}') ~ '^\d+$'
    AND (p_answer_index #>> '{}')::INTEGER < jsonb_array_length(p_options)
$$;

CREATE FUNCTION platform_private.validate_learning_module()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'level_note_ru', 'level_note_ky'])
    OR EXISTS (SELECT 1 FROM jsonb_each(NEW.metadata) field
      WHERE NOT platform_private.learning_text_ok(field.value))
  THEN
    RAISE EXCEPTION 'Invalid learning module content' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.validate_learning_lesson()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata)) <> 4
    OR NOT (NEW.metadata ?& ARRAY['title_ru', 'title_ky', 'goal_ru', 'goal_ky'])
    OR EXISTS (SELECT 1 FROM jsonb_each(NEW.metadata) field
      WHERE NOT platform_private.learning_text_ok(field.value))
    OR jsonb_array_length(NEW.theory) NOT BETWEEN 1 AND 6
    OR octet_length(NEW.theory::TEXT) > 32768
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.theory) block
      WHERE jsonb_typeof(block) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(block)) <> 3
        OR NOT (block ?& ARRAY['text_ru', 'text_ky', 'examples'])
        OR NOT platform_private.learning_text_ok(block -> 'text_ru')
        OR NOT platform_private.learning_text_ok(block -> 'text_ky')
        OR jsonb_typeof(block -> 'examples') <> 'array'
        OR jsonb_array_length(block -> 'examples') NOT BETWEEN 1 AND 8
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(block -> 'examples') example
          WHERE jsonb_typeof(example) <> 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(example)) <> 3
            OR NOT (example ?& ARRAY['en', 'ru', 'ky'])
            OR EXISTS (SELECT 1 FROM jsonb_each(example) field
              WHERE NOT platform_private.learning_text_ok(field.value))))
  THEN
    RAISE EXCEPTION 'Invalid learning lesson content' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.validate_learning_exercise()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  body JSONB := NEW.body;
  base_keys TEXT[];
  question JSONB;
BEGIN
  IF octet_length(body::TEXT) > 32768
    OR (body ? 'source_lesson' AND (jsonb_typeof(body -> 'source_lesson') <> 'number'
      OR (body ->> 'source_lesson') !~ '^\d{1,2}$' OR (body ->> 'source_lesson')::INTEGER < 1))
  THEN
    RAISE EXCEPTION 'Invalid learning exercise content' USING ERRCODE = '22023';
  END IF;
  -- exact-key: допустимый набор ключей типа + необязательный source_lesson +
  -- одна из двух форм формулировки.
  base_keys := CASE NEW.exercise_type
    WHEN 'choice' THEN ARRAY['options', 'answer_index']
    WHEN 'matching' THEN ARRAY['instruction_ru', 'instruction_ky', 'pairs', 'explain_ru', 'explain_ky']
    WHEN 'short_answer' THEN ARRAY['accepted', 'explain_ru', 'explain_ky']
    ELSE ARRAY['passage_en', 'questions']
  END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(body) key
    WHERE key <> ALL (base_keys || ARRAY['source_lesson', 'prompt_en', 'prompt_ru', 'prompt_ky']))
    OR NOT (body ?& base_keys)
  THEN
    RAISE EXCEPTION 'Invalid learning exercise keys' USING ERRCODE = '22023';
  END IF;
  IF NEW.exercise_type = 'choice' THEN
    IF NOT platform_private.learning_prompt_ok(body)
      OR NOT platform_private.learning_options_ok(body -> 'options', body -> 'answer_index')
    THEN
      RAISE EXCEPTION 'Invalid choice exercise' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.exercise_type = 'matching' THEN
    IF body ? 'prompt_en' OR body ? 'prompt_ru' OR body ? 'prompt_ky'
      OR NOT platform_private.learning_text_ok(body -> 'instruction_ru')
      OR NOT platform_private.learning_text_ok(body -> 'instruction_ky')
      OR NOT platform_private.learning_text_ok(body -> 'explain_ru')
      OR NOT platform_private.learning_text_ok(body -> 'explain_ky')
      OR jsonb_typeof(body -> 'pairs') <> 'array'
      OR jsonb_array_length(body -> 'pairs') NOT BETWEEN 3 AND 8
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'pairs') pair
        WHERE jsonb_typeof(pair) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(pair)) <> 3
          OR NOT (pair ?& ARRAY['left_en', 'right_ru', 'right_ky'])
          OR EXISTS (SELECT 1 FROM jsonb_each(pair) field
            WHERE NOT platform_private.learning_text_ok(field.value)))
      -- Различимость обеих колонок: иначе сопоставление неоднозначно.
      OR (SELECT count(DISTINCT pair ->> 'left_en') FROM jsonb_array_elements(body -> 'pairs') pair)
        <> jsonb_array_length(body -> 'pairs')
      OR (SELECT count(DISTINCT pair ->> 'right_ru') FROM jsonb_array_elements(body -> 'pairs') pair)
        <> jsonb_array_length(body -> 'pairs')
    THEN
      RAISE EXCEPTION 'Invalid matching exercise' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.exercise_type = 'short_answer' THEN
    IF NOT platform_private.learning_prompt_ok(body)
      OR NOT platform_private.learning_text_ok(body -> 'explain_ru')
      OR NOT platform_private.learning_text_ok(body -> 'explain_ky')
      OR jsonb_typeof(body -> 'accepted') <> 'array'
      OR jsonb_array_length(body -> 'accepted') NOT BETWEEN 1 AND 12
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'accepted') accepted
        WHERE NOT platform_private.learning_text_ok(accepted)
          OR NULLIF(platform_private.normalize_learning_short_answer(accepted #>> '{}'), '') IS NULL)
    THEN
      RAISE EXCEPTION 'Invalid short answer exercise' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF body ? 'prompt_en' OR body ? 'prompt_ru' OR body ? 'prompt_ky'
      OR NOT platform_private.learning_text_ok(body -> 'passage_en')
      OR jsonb_typeof(body -> 'questions') <> 'array'
      OR jsonb_array_length(body -> 'questions') NOT BETWEEN 1 AND 5
      OR (SELECT count(DISTINCT reading_question ->> 'id')
        FROM jsonb_array_elements(body -> 'questions') reading_question)
        <> jsonb_array_length(body -> 'questions')
    THEN
      RAISE EXCEPTION 'Invalid reading exercise' USING ERRCODE = '22023';
    END IF;
    FOR question IN SELECT value FROM jsonb_array_elements(body -> 'questions') LOOP
      IF (SELECT count(*) FROM jsonb_object_keys(question)) <> 4
        OR NOT (question ?& ARRAY['id', 'prompt_en', 'options', 'answer_index'])
        OR (question ->> 'id') !~ '^[a-z0-9][a-z0-9_-]{0,99}$'
        OR NOT platform_private.learning_text_ok(question -> 'prompt_en')
        OR NOT platform_private.learning_options_ok(question -> 'options', question -> 'answer_index')
      THEN
        RAISE EXCEPTION 'Invalid reading question' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.validate_profession_card()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  body JSONB := NEW.body;
  pair TEXT;
BEGIN
  IF octet_length(body::TEXT) > 65536
    OR (SELECT count(*) FROM jsonb_object_keys(body)) <> 20
    OR NOT (body ?& ARRAY['id', 'title_ru', 'title_ky', 'orvis_scales',
      'day_in_work_ru', 'day_in_work_ky', 'environment_ru', 'environment_ky',
      'skills_ru', 'skills_ky', 'interesting_ru', 'interesting_ky',
      'hard_ru', 'hard_ky', 'trial_task_ru', 'trial_task_ky',
      'study_directions_ru', 'study_directions_ky', 'linked_program_refs', 'sources'])
    OR body ->> 'id' IS DISTINCT FROM NEW.card_key
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['title_ru', 'title_ky', 'day_in_work_ru',
      'day_in_work_ky', 'environment_ru', 'environment_ky', 'trial_task_ru', 'trial_task_ky']) field
      WHERE NOT platform_private.learning_text_ok(body -> field))
  THEN
    RAISE EXCEPTION 'Invalid profession card content' USING ERRCODE = '22023';
  END IF;
  -- Шкалы ORVIS: 1..3, только 8 известных id, без повторов (первая — основная).
  IF jsonb_typeof(body -> 'orvis_scales') <> 'array'
    OR jsonb_array_length(body -> 'orvis_scales') NOT BETWEEN 1 AND 3
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(body -> 'orvis_scales') scale
      WHERE scale NOT IN ('leadership', 'organization', 'altruism', 'creativity',
        'analysis', 'production', 'adventure', 'erudition'))
    OR (SELECT count(DISTINCT scale) FROM jsonb_array_elements_text(body -> 'orvis_scales') scale)
      <> jsonb_array_length(body -> 'orvis_scales')
  THEN
    RAISE EXCEPTION 'Invalid profession card scales' USING ERRCODE = '22023';
  END IF;
  -- Парные RU/KY-списки одинаковой длины, непустые строки (KY — не сокращение RU).
  FOREACH pair IN ARRAY ARRAY['skills', 'interesting', 'hard', 'study_directions'] LOOP
    IF jsonb_typeof(body -> (pair || '_ru')) <> 'array'
      OR jsonb_typeof(body -> (pair || '_ky')) <> 'array'
      OR jsonb_array_length(body -> (pair || '_ru')) NOT BETWEEN 1 AND 12
      OR jsonb_array_length(body -> (pair || '_ru'))
        <> jsonb_array_length(body -> (pair || '_ky'))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> (pair || '_ru')) item
        WHERE NOT platform_private.learning_text_ok(item))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> (pair || '_ky')) item
        WHERE NOT platform_private.learning_text_ok(item))
    THEN
      RAISE EXCEPTION 'Invalid profession card lists' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(body -> 'linked_program_refs') <> 'array'
    OR jsonb_array_length(body -> 'linked_program_refs') NOT BETWEEN 1 AND 8
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'linked_program_refs') ref
      WHERE jsonb_typeof(ref) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(ref)) <> 2
        OR NOT (ref ?& ARRAY['institution_photo_key', 'program_hint'])
        OR NOT platform_private.learning_text_ok(ref -> 'institution_photo_key')
        OR NOT platform_private.learning_text_ok(ref -> 'program_hint'))
    OR jsonb_typeof(body -> 'sources') <> 'array'
    OR jsonb_array_length(body -> 'sources') NOT BETWEEN 1 AND 4
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(body -> 'sources') source
      WHERE source !~ '^https://')
  THEN
    RAISE EXCEPTION 'Invalid profession card references' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- Иммутабельность (паттерн 135): контент/receipt'ы не меняются вовсе;
-- попытка меняется только в draft-состоянии с revision+1 и неизменной
-- идентичностью.
CREATE FUNCTION platform_private.guard_learning_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME <> 'learning_lesson_attempts' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Learning record is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Learning record is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.student_membership_id IS DISTINCT FROM OLD.student_membership_id
    OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.revision <> OLD.revision + 1
  THEN
    RAISE EXCEPTION 'Learning attempt identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER learning_module_validate BEFORE INSERT
  ON platform_private.learning_modules FOR EACH ROW
  EXECUTE FUNCTION platform_private.validate_learning_module();
CREATE TRIGGER learning_lesson_validate BEFORE INSERT
  ON platform_private.learning_lessons FOR EACH ROW
  EXECUTE FUNCTION platform_private.validate_learning_lesson();
CREATE TRIGGER learning_exercise_validate BEFORE INSERT
  ON platform_private.learning_exercises FOR EACH ROW
  EXECUTE FUNCTION platform_private.validate_learning_exercise();
CREATE TRIGGER profession_card_validate BEFORE INSERT
  ON platform_private.profession_cards FOR EACH ROW
  EXECUTE FUNCTION platform_private.validate_profession_card();

CREATE TRIGGER learning_modules_immutable BEFORE UPDATE OR DELETE
  ON platform_private.learning_modules FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_modules_no_truncate BEFORE TRUNCATE
  ON platform_private.learning_modules FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_lessons_immutable BEFORE UPDATE OR DELETE
  ON platform_private.learning_lessons FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_lessons_no_truncate BEFORE TRUNCATE
  ON platform_private.learning_lessons FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_exercises_immutable BEFORE UPDATE OR DELETE
  ON platform_private.learning_exercises FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_exercises_no_truncate BEFORE TRUNCATE
  ON platform_private.learning_exercises FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER profession_cards_immutable BEFORE UPDATE OR DELETE
  ON platform_private.profession_cards FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER profession_cards_no_truncate BEFORE TRUNCATE
  ON platform_private.profession_cards FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_attempts_guard BEFORE UPDATE OR DELETE
  ON platform.learning_lesson_attempts FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_attempts_no_truncate BEFORE TRUNCATE
  ON platform.learning_lesson_attempts FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_requests_immutable BEFORE UPDATE OR DELETE
  ON platform_private.learning_requests FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_learning_immutable();
CREATE TRIGGER learning_requests_no_truncate BEFORE TRUNCATE
  ON platform_private.learning_requests FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_learning_immutable();

-- ---------------------------------------------------------------------------
-- Guard: каталожный паттерн 148/195/196 — student + portal.read.self,
-- СОЗНАТЕЛЬНО без проверки состояния кейса (обучение — approved-возможность,
-- план §4; НЕ case-scoped гейты 192 и НЕ case-зависимый guard 135).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.require_learning_actor_read()
RETURNS TABLE (organization_id UUID, membership_id UUID, profile_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() authority
    WHERE authority.platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(actor.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.organization_id, actor.membership_id, actor.profile_id;
END $$;

-- ---------------------------------------------------------------------------
-- Нормализация короткого ответа (резолюция PLAN_CHANGES PORT-4a):
-- апострофы ’ ‘ ʻ ʼ -> ', trim + схлопывание пробелов, lowercase,
-- отбрасывание финальных точек/запятых.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.normalize_learning_short_answer(p_text TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT btrim(regexp_replace(
    lower(btrim(regexp_replace(
      translate(COALESCE(p_text, ''), U&'\2019\2018\02BB\02BC', repeat('''', 4)),
      '\s+', ' ', 'g'))),
    '[.,]+$', ''))
$$;

-- ---------------------------------------------------------------------------
-- Порядок правой колонки matching: детерминированный хэш ЗНАЧЕНИЯ правой
-- части. Функция значения необратима к исходному порядку пар, поэтому сам
-- порядок выдачи не раскрывает ключ; ответ ссылается на позиции выданного
-- порядка, сервер отображает их обратно этим же выражением.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_matching_order(p_exercise_id UUID, p_pairs JSONB)
RETURNS INTEGER[] LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT array_agg((ordinality - 1)::INTEGER
    ORDER BY md5(p_exercise_id::TEXT || ':' || (pair ->> 'right_ru')))
  FROM jsonb_array_elements(p_pairs) WITH ORDINALITY AS pairs(pair, ordinality)
$$;

-- ---------------------------------------------------------------------------
-- Публичная проекция упражнения: allowlist-сборка (паттерн 135) — ключи
-- ответов (answer_index/accepted/пары как соответствия) и разборы НЕ входят.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_exercise_public(p_exercise platform_private.learning_exercises)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'exerciseId', p_exercise.id,
    'exerciseKey', p_exercise.exercise_key,
    'orderIndex', p_exercise.order_index,
    'type', p_exercise.exercise_type,
    'sourceLesson', p_exercise.body -> 'source_lesson',
    'promptEn', p_exercise.body -> 'prompt_en',
    'promptRu', p_exercise.body -> 'prompt_ru',
    'promptKy', p_exercise.body -> 'prompt_ky'
  ))
  || CASE p_exercise.exercise_type
    WHEN 'choice' THEN jsonb_build_object(
      'options', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', option ->> 'id', 'label', option -> 'label',
          'labelRu', option -> 'label_ru', 'labelKy', option -> 'label_ky')) ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'options')
          WITH ORDINALITY AS options(option, ordinality)))
    WHEN 'matching' THEN jsonb_build_object(
      'instructionRu', p_exercise.body -> 'instruction_ru',
      'instructionKy', p_exercise.body -> 'instruction_ky',
      'lefts', (SELECT jsonb_agg(pair -> 'left_en' ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'pairs')
          WITH ORDINALITY AS pairs(pair, ordinality)),
      'rights', (SELECT jsonb_agg(jsonb_build_object(
          'rightRu', pair -> 'right_ru', 'rightKy', pair -> 'right_ky')
          ORDER BY md5(p_exercise.id::TEXT || ':' || (pair ->> 'right_ru')))
        FROM jsonb_array_elements(p_exercise.body -> 'pairs') AS pairs(pair)))
    WHEN 'short_answer' THEN '{}'::JSONB
    ELSE jsonb_build_object(
      'passageEn', p_exercise.body -> 'passage_en',
      'questions', (SELECT jsonb_agg(jsonb_build_object(
          'id', question ->> 'id', 'promptEn', question -> 'prompt_en',
          'options', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', option ->> 'id', 'label', option -> 'label',
              'labelRu', option -> 'label_ru', 'labelKy', option -> 'label_ky'))
              ORDER BY option_row.ordinality)
            FROM jsonb_array_elements(question -> 'options')
              WITH ORDINALITY AS option_row(option, ordinality))) ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'questions')
          WITH ORDINALITY AS questions(question, ordinality)))
  END
$$;

-- Разбор упражнения: выдаётся ТОЛЬКО после ответа (или в review для
-- упражнений собственного банка ошибок — они уже были отвечены).
CREATE FUNCTION platform_private.learning_exercise_explain(p_exercise platform_private.learning_exercises)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT CASE p_exercise.exercise_type
    WHEN 'choice' THEN jsonb_build_object(
      'correctOptionId',
        p_exercise.body -> 'options' -> (p_exercise.body ->> 'answer_index')::INTEGER ->> 'id',
      'options', (SELECT jsonb_agg(jsonb_build_object(
          'id', option ->> 'id',
          'explainRu', option -> 'explain_ru', 'explainKy', option -> 'explain_ky')
          ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'options')
          WITH ORDINALITY AS options(option, ordinality)))
    WHEN 'matching' THEN jsonb_build_object(
      'pairs', (SELECT jsonb_agg(jsonb_build_object(
          'leftEn', pair -> 'left_en',
          'rightRu', pair -> 'right_ru', 'rightKy', pair -> 'right_ky')
          ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'pairs')
          WITH ORDINALITY AS pairs(pair, ordinality)),
      'explainRu', p_exercise.body -> 'explain_ru',
      'explainKy', p_exercise.body -> 'explain_ky')
    WHEN 'short_answer' THEN jsonb_build_object(
      'answer', p_exercise.body -> 'accepted' -> 0,
      'explainRu', p_exercise.body -> 'explain_ru',
      'explainKy', p_exercise.body -> 'explain_ky')
    ELSE jsonb_build_object(
      'questions', (SELECT jsonb_agg(jsonb_build_object(
          'id', question ->> 'id',
          'correctOptionId',
            question -> 'options' -> (question ->> 'answer_index')::INTEGER ->> 'id',
          'options', (SELECT jsonb_agg(jsonb_build_object(
              'id', option ->> 'id',
              'explainRu', option -> 'explain_ru', 'explainKy', option -> 'explain_ky')
              ORDER BY option_row.ordinality)
            FROM jsonb_array_elements(question -> 'options')
              WITH ORDINALITY AS option_row(option, ordinality))) ORDER BY ordinality)
        FROM jsonb_array_elements(p_exercise.body -> 'questions')
          WITH ORDINALITY AS questions(question, ordinality)))
  END
$$;

-- ---------------------------------------------------------------------------
-- Серверная проверка ответа. Возвращает {correct, verdict}; битая форма — 22023.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.grade_learning_answer(
  p_exercise platform_private.learning_exercises, p_answer JSONB
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  served INTEGER[];
  pair_count INTEGER;
  per_pair JSONB;
  per_question JSONB;
  is_correct BOOLEAN;
BEGIN
  IF p_answer IS NULL OR jsonb_typeof(p_answer) <> 'object'
    OR octet_length(p_answer::TEXT) > 4096 THEN
    RAISE EXCEPTION 'Invalid learning answer' USING ERRCODE = '22023';
  END IF;
  IF p_exercise.exercise_type = 'choice' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1
      OR jsonb_typeof(p_answer -> 'selected') <> 'string'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_exercise.body -> 'options') option
        WHERE option ->> 'id' = p_answer ->> 'selected')
    THEN
      RAISE EXCEPTION 'Invalid choice answer' USING ERRCODE = '22023';
    END IF;
    is_correct := (p_exercise.body -> 'options'
      -> (p_exercise.body ->> 'answer_index')::INTEGER ->> 'id') = (p_answer ->> 'selected');
    RETURN jsonb_build_object('correct', is_correct,
      'verdict', jsonb_build_object('correct', is_correct));
  ELSIF p_exercise.exercise_type = 'matching' THEN
    pair_count := jsonb_array_length(p_exercise.body -> 'pairs');
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1
      OR jsonb_typeof(p_answer -> 'matches') <> 'array'
      OR jsonb_array_length(p_answer -> 'matches') <> pair_count
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answer -> 'matches') m
        WHERE jsonb_typeof(m) <> 'number' OR (m #>> '{}') !~ '^\d+$'
          OR (m #>> '{}')::INTEGER >= pair_count)
      OR (SELECT count(DISTINCT m #>> '{}') FROM jsonb_array_elements(p_answer -> 'matches') m)
        <> pair_count
    THEN
      RAISE EXCEPTION 'Invalid matching answer' USING ERRCODE = '22023';
    END IF;
    served := platform_private.learning_matching_order(p_exercise.id, p_exercise.body -> 'pairs');
    SELECT jsonb_agg(to_jsonb(served[(m #>> '{}')::INTEGER + 1] = ordinality::INTEGER - 1)
        ORDER BY ordinality),
      bool_and(served[(m #>> '{}')::INTEGER + 1] = ordinality::INTEGER - 1)
      INTO per_pair, is_correct
      FROM jsonb_array_elements(p_answer -> 'matches') WITH ORDINALITY AS matches(m, ordinality);
    RETURN jsonb_build_object('correct', is_correct,
      'verdict', jsonb_build_object('correct', is_correct, 'perPair', per_pair,
        'correctCount', (SELECT count(*) FROM jsonb_array_elements(per_pair) v
          WHERE v::TEXT = 'true'),
        'total', pair_count));
  ELSIF p_exercise.exercise_type = 'short_answer' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1
      OR jsonb_typeof(p_answer -> 'text') <> 'string'
      OR char_length(p_answer ->> 'text') > 300
    THEN
      RAISE EXCEPTION 'Invalid short answer' USING ERRCODE = '22023';
    END IF;
    is_correct := EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_exercise.body -> 'accepted') accepted
      WHERE platform_private.normalize_learning_short_answer(accepted)
        = platform_private.normalize_learning_short_answer(p_answer ->> 'text'));
    RETURN jsonb_build_object('correct', is_correct,
      'verdict', jsonb_build_object('correct', is_correct));
  ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1
      OR jsonb_typeof(p_answer -> 'selected') <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(p_answer -> 'selected'))
        <> jsonb_array_length(p_exercise.body -> 'questions')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_exercise.body -> 'questions') question
        WHERE jsonb_typeof(p_answer -> 'selected' -> (question ->> 'id')) IS DISTINCT FROM 'string'
          OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question -> 'options') option
            WHERE option ->> 'id' = p_answer -> 'selected' ->> (question ->> 'id')))
    THEN
      RAISE EXCEPTION 'Invalid reading answer' USING ERRCODE = '22023';
    END IF;
    SELECT jsonb_object_agg(question ->> 'id',
        to_jsonb((question -> 'options' -> (question ->> 'answer_index')::INTEGER ->> 'id')
          = (p_answer -> 'selected' ->> (question ->> 'id')))),
      bool_and((question -> 'options' -> (question ->> 'answer_index')::INTEGER ->> 'id')
          = (p_answer -> 'selected' ->> (question ->> 'id')))
      INTO per_question, is_correct
      FROM jsonb_array_elements(p_exercise.body -> 'questions') question;
    RETURN jsonb_build_object('correct', is_correct,
      'verdict', jsonb_build_object('correct', is_correct, 'perQuestion', per_question));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Payload попытки: ответы обогащаются вердиктом (сохранён при ответе) и
-- разбором из контента — ТОЛЬКО для отвеченных упражнений.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.learning_attempt_payload(p_attempt platform.learning_lesson_attempts)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'attemptId', p_attempt.id,
    'lessonId', p_attempt.lesson_id,
    'status', p_attempt.status,
    'revision', p_attempt.revision,
    'answers', COALESCE((
      SELECT jsonb_object_agg(entry.key,
        entry.value || jsonb_build_object('explain', platform_private.learning_exercise_explain(exercise.*)))
      FROM jsonb_each(p_attempt.answers) entry
      JOIN platform_private.learning_exercises exercise ON exercise.id = entry.key::UUID
    ), '{}'::JSONB),
    'answeredCount', (SELECT count(*) FROM jsonb_object_keys(p_attempt.answers)),
    'exercisesTotal', (SELECT count(*) FROM platform_private.learning_exercises exercise
      WHERE exercise.lesson_id = p_attempt.lesson_id),
    'result', p_attempt.result_snapshot,
    'createdAt', p_attempt.created_at,
    'updatedAt', p_attempt.updated_at,
    'completedAt', p_attempt.completed_at
  )
$$;

-- ---------------------------------------------------------------------------
-- Идемпотентная запись (зеркало write-функции 135): start/save/complete с
-- receipt по request_id; optimistic revision 40001; advisory-lock на
-- (membership, request); повторный запрос возвращает исходный receipt.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.write_learning_lesson(
  p_operation TEXT, p_lesson_id UUID, p_attempt_id UUID,
  p_expected_revision BIGINT, p_exercise_id UUID, p_answer JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; locked_actor RECORD;
  attempt platform.learning_lesson_attempts%ROWTYPE;
  exercise platform_private.learning_exercises%ROWTYPE;
  previous_request platform_private.learning_requests%ROWTYPE;
  grade JSONB; response JSONB; input_hash TEXT;
  exercises_total INTEGER; answered_count INTEGER;
  correct_count INTEGER; wrong_ids JSONB; completed_time TIMESTAMPTZ;
BEGIN
  IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('start', 'save', 'complete')
    OR (p_operation = 'start' AND p_lesson_id IS NULL)
    OR (p_operation <> 'start' AND (p_attempt_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1))
    OR (p_operation = 'save' AND p_exercise_id IS NULL)
  THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  -- Ограничиваем недоверенный JSON до общих блокировок и хеширования (135).
  IF p_operation = 'save' AND (p_answer IS NULL OR jsonb_typeof(p_answer) <> 'object'
    OR octet_length(p_answer::TEXT) > 4096) THEN
    RAISE EXCEPTION 'Invalid learning answer' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  -- Живая авторитетная блокировка сериализует записи и параллельный отзыв (135).
  SELECT * INTO locked_actor FROM platform_private.require_domain_actor(actor.organization_id, 'portal.read.self');
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF locked_actor.actor_role <> 'student' OR locked_actor.actor_membership_id <> actor.membership_id THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'learning:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  input_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation', p_operation, 'lessonId', p_lesson_id, 'attemptId', p_attempt_id,
    'expectedRevision', p_expected_revision, 'exerciseId', p_exercise_id,
    'answer', p_answer)::TEXT, 'UTF8')), 'hex');
  SELECT * INTO previous_request FROM platform_private.learning_requests
    WHERE student_membership_id = actor.membership_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous_request.organization_id <> actor.organization_id
      OR previous_request.operation <> p_operation
      OR previous_request.input_hash <> input_hash THEN
      RAISE EXCEPTION 'Learning request was already used' USING ERRCODE = '22023';
    END IF;
    RETURN previous_request.receipt;
  END IF;
  IF p_operation = 'start' THEN
    SELECT * INTO attempt FROM platform.learning_lesson_attempts
      WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
        AND lesson_id = p_lesson_id AND status = 'draft' FOR UPDATE;
    IF NOT FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM platform_private.learning_lessons WHERE id = p_lesson_id) THEN
        RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
      END IF;
      INSERT INTO platform.learning_lesson_attempts(organization_id, student_membership_id, lesson_id)
        VALUES (actor.organization_id, actor.membership_id, p_lesson_id) RETURNING * INTO attempt;
    END IF;
    response := platform_private.learning_attempt_payload(attempt);
  ELSE
    SELECT * INTO attempt FROM platform.learning_lesson_attempts
      WHERE id = p_attempt_id AND organization_id = actor.organization_id
        AND student_membership_id = actor.membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501'; END IF;
    IF attempt.status <> 'draft' OR attempt.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Learning attempt changed' USING ERRCODE = '40001';
    END IF;
    IF p_operation = 'save' THEN
      SELECT * INTO exercise FROM platform_private.learning_exercises
        WHERE id = p_exercise_id AND lesson_id = attempt.lesson_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid learning exercise reference' USING ERRCODE = '22023';
      END IF;
      -- Ответ внутри попытки финален: механика мгновенного разбора не даёт
      -- «подобрать» верный вариант после просмотра объяснения (PLAN_CHANGES).
      IF attempt.answers ? p_exercise_id::TEXT THEN
        RAISE EXCEPTION 'Learning exercise is already answered' USING ERRCODE = '22023';
      END IF;
      grade := platform_private.grade_learning_answer(exercise, p_answer);
      UPDATE platform.learning_lesson_attempts
        SET answers = answers || jsonb_build_object(p_exercise_id::TEXT, jsonb_build_object(
              'answer', p_answer,
              'correct', grade -> 'correct',
              'verdict', grade -> 'verdict',
              'answeredAt', clock_timestamp())),
          revision = revision + 1, updated_at = clock_timestamp()
        WHERE id = attempt.id RETURNING * INTO attempt;
      SELECT count(*) INTO exercises_total FROM platform_private.learning_exercises e
        WHERE e.lesson_id = attempt.lesson_id;
      response := jsonb_build_object(
        'attemptId', attempt.id, 'revision', attempt.revision,
        'exerciseId', p_exercise_id,
        'correct', grade -> 'correct', 'verdict', grade -> 'verdict',
        'explain', platform_private.learning_exercise_explain(exercise),
        'answeredCount', (SELECT count(*) FROM jsonb_object_keys(attempt.answers)),
        'exercisesTotal', exercises_total);
    ELSE
      SELECT count(*) INTO exercises_total FROM platform_private.learning_exercises e
        WHERE e.lesson_id = attempt.lesson_id;
      SELECT count(*) INTO answered_count FROM jsonb_object_keys(attempt.answers);
      -- «Урок пройден» = отвечено каждое упражнение (PLAN_CHANGES PORT-4a);
      -- доля верных сохраняется в результате, но порогом не является.
      IF answered_count <> exercises_total THEN
        RAISE EXCEPTION 'Learning lesson is not fully answered' USING ERRCODE = '22023';
      END IF;
      SELECT count(*) FILTER (WHERE (entry.value -> 'correct')::TEXT = 'true'),
        COALESCE(jsonb_agg(entry.key ORDER BY answered.order_index)
          FILTER (WHERE (entry.value -> 'correct')::TEXT <> 'true'), '[]'::JSONB)
        INTO correct_count, wrong_ids
        FROM jsonb_each(attempt.answers) entry
        JOIN platform_private.learning_exercises answered ON answered.id = entry.key::UUID;
      completed_time := clock_timestamp();
      UPDATE platform.learning_lesson_attempts
        SET status = 'completed', revision = revision + 1,
          updated_at = completed_time, completed_at = completed_time,
          result_snapshot = jsonb_build_object(
            'exercisesTotal', exercises_total,
            'correctCount', correct_count,
            'correctShare', round(correct_count::NUMERIC / exercises_total, 4),
            'wrongExerciseIds', wrong_ids,
            'completedAt', completed_time)
        WHERE id = attempt.id RETURNING * INTO attempt;
      response := platform_private.learning_attempt_payload(attempt);
    END IF;
  END IF;
  INSERT INTO platform_private.learning_requests(organization_id, student_membership_id,
    request_id, operation, input_hash, attempt_id, receipt)
    VALUES (actor.organization_id, actor.membership_id, p_request_id, p_operation,
      input_hash, attempt.id, response);
  RETURN response;
END $$;

CREATE FUNCTION platform.start_learning_lesson_v1(p_lesson_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_lesson('start', p_lesson_id, NULL, NULL, NULL, NULL, p_request_id)
$$;
CREATE FUNCTION platform.save_learning_answer_v1(
  p_attempt_id UUID, p_expected_revision BIGINT, p_exercise_id UUID, p_answer JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_lesson('save', NULL, p_attempt_id, p_expected_revision, p_exercise_id, p_answer, p_request_id)
$$;
CREATE FUNCTION platform.complete_learning_lesson_v1(
  p_attempt_id UUID, p_expected_revision BIGINT, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_learning_lesson('complete', NULL, p_attempt_id, p_expected_revision, NULL, NULL, p_request_id)
$$;

-- ---------------------------------------------------------------------------
-- Чтение: карта модулей со СВОИМ прогрессом (уроки всего/завершено).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.learning_modules_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; modules JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'moduleId', module.id, 'moduleKey', module.module_key, 'version', module.version,
    'metadata', module.metadata,
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
  ) ORDER BY module.module_key), '[]'::JSONB) INTO STRICT modules
  FROM (SELECT DISTINCT ON (module_key) * FROM platform_private.learning_modules
    ORDER BY module_key, published_at DESC, id DESC) module;
  RETURN jsonb_build_object('modules', modules);
END $$;

-- Урок: безопасная проекция + свой draft + последняя завершённая попытка.
CREATE FUNCTION platform.learning_lesson_v1(p_lesson_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lesson platform_private.learning_lessons%ROWTYPE;
  module platform_private.learning_modules%ROWTYPE;
  draft platform.learning_lesson_attempts%ROWTYPE;
  latest platform.learning_lesson_attempts%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT * INTO lesson FROM platform_private.learning_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO module FROM platform_private.learning_modules WHERE id = lesson.module_id;
  SELECT * INTO draft FROM platform.learning_lesson_attempts
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
      AND lesson_id = lesson.id AND status = 'draft';
  SELECT * INTO latest FROM platform.learning_lesson_attempts
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
      AND lesson_id = lesson.id AND status = 'completed'
    ORDER BY completed_at DESC, id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'module', jsonb_build_object('moduleId', module.id, 'moduleKey', module.module_key,
      'version', module.version, 'metadata', module.metadata),
    'lesson', jsonb_build_object('lessonId', lesson.id, 'lessonKey', lesson.lesson_key,
      'orderIndex', lesson.order_index, 'metadata', lesson.metadata, 'theory', lesson.theory,
      'exercises', COALESCE((SELECT jsonb_agg(platform_private.learning_exercise_public(exercise.*)
          ORDER BY exercise.order_index)
        FROM platform_private.learning_exercises exercise
        WHERE exercise.lesson_id = lesson.id), '[]'::JSONB)),
    'draft', CASE WHEN draft.id IS NULL THEN NULL
      ELSE platform_private.learning_attempt_payload(draft) END,
    'latestCompleted', CASE WHEN latest.id IS NULL THEN NULL
      ELSE platform_private.learning_attempt_payload(latest) END
  );
END $$;

-- ---------------------------------------------------------------------------
-- Банк ошибок: упражнения, отвеченные неверно в завершённых попытках модуля.
-- Cap 20, новые первыми (по завершению попытки, затем по порядку в результате).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.learning_review_v1(p_module_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; items JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF NOT EXISTS (SELECT 1 FROM platform_private.learning_modules WHERE id = p_module_id) THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  WITH wrong AS (
    SELECT DISTINCT ON (wrong_id.value)
      wrong_id.value AS exercise_id,
      attempt.completed_at, attempt.id AS attempt_id, wrong_id.ordinality
    FROM platform.learning_lesson_attempts attempt
    JOIN platform_private.learning_lessons lesson
      ON lesson.id = attempt.lesson_id AND lesson.module_id = p_module_id
    CROSS JOIN LATERAL jsonb_array_elements_text(attempt.result_snapshot -> 'wrongExerciseIds')
      WITH ORDINALITY AS wrong_id(value, ordinality)
    WHERE attempt.organization_id = actor.organization_id
      AND attempt.student_membership_id = actor.membership_id
      AND attempt.status = 'completed'
    ORDER BY wrong_id.value, attempt.completed_at DESC, attempt.id DESC
  ), newest AS (
    SELECT wrong.exercise_id, wrong.completed_at, wrong.attempt_id, wrong.ordinality
    FROM wrong
    ORDER BY wrong.completed_at DESC, wrong.attempt_id DESC, wrong.ordinality
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(
      platform_private.learning_exercise_public(exercise.*)
      || jsonb_build_object('lessonId', lesson.id, 'lessonKey', lesson.lesson_key,
        'lessonOrderIndex', lesson.order_index)
      ORDER BY newest.completed_at DESC, newest.attempt_id DESC, newest.ordinality),
    '[]'::JSONB) INTO items
  FROM newest
  JOIN platform_private.learning_exercises exercise ON exercise.id = newest.exercise_id::UUID
  JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id;
  RETURN jsonb_build_object('items', items);
END $$;

-- Проверка ответа в режиме повторения: только для упражнений СОБСТВЕННОГО
-- банка ошибок (их разборы ученику уже открыты завершённой попыткой —
-- инвариант «разбор только отвеченного» сохраняется). Ничего не пишет.
CREATE FUNCTION platform.learning_review_check_v1(p_exercise_id UUID, p_answer JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; exercise platform_private.learning_exercises%ROWTYPE; grade JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  IF p_exercise_id IS NULL THEN
    RAISE EXCEPTION 'Invalid learning request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.learning_lesson_attempts attempt
    WHERE attempt.organization_id = actor.organization_id
      AND attempt.student_membership_id = actor.membership_id
      AND attempt.status = 'completed'
      AND attempt.result_snapshot -> 'wrongExerciseIds' ? p_exercise_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO exercise FROM platform_private.learning_exercises WHERE id = p_exercise_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning is unavailable' USING ERRCODE = '42501'; END IF;
  grade := platform_private.grade_learning_answer(exercise, p_answer);
  RETURN jsonb_build_object(
    'exerciseId', exercise.id,
    'correct', grade -> 'correct',
    'verdict', grade -> 'verdict',
    'explain', platform_private.learning_exercise_explain(exercise));
END $$;

-- ---------------------------------------------------------------------------
-- Профессии: список (компактно) и карточка (полный body). Контент публикуемый,
-- ключей нет; guard тот же студенческий (раздел портала).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.profession_cards_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; cards JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cardId', card.id, 'cardKey', card.card_key, 'version', card.version,
    'titleRu', card.body -> 'title_ru', 'titleKy', card.body -> 'title_ky',
    'orvisScales', card.body -> 'orvis_scales'
  ) ORDER BY card.body ->> 'title_ru', card.card_key), '[]'::JSONB) INTO cards
  FROM (SELECT DISTINCT ON (card_key) * FROM platform_private.profession_cards
    ORDER BY card_key, published_at DESC, id DESC) card;
  RETURN jsonb_build_object('cards', cards);
END $$;

CREATE FUNCTION platform.profession_card_v1(p_card_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; card platform_private.profession_cards%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT * INTO card FROM platform_private.profession_cards WHERE id = p_card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Professions are unavailable' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('cardId', card.id, 'cardKey', card.card_key,
    'version', card.version, 'publishedAt', card.published_at, 'body', card.body);
END $$;

-- ---------------------------------------------------------------------------
-- Гранты: приватные помощники закрыты ото всех; RPC — только authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.learning_text_ok(JSONB),
  platform_private.learning_prompt_ok(JSONB),
  platform_private.learning_option_ok(JSONB),
  platform_private.learning_options_ok(JSONB, JSONB),
  platform_private.validate_learning_module(),
  platform_private.validate_learning_lesson(),
  platform_private.validate_learning_exercise(),
  platform_private.validate_profession_card(),
  platform_private.guard_learning_immutable(),
  platform_private.require_learning_actor_read(),
  platform_private.normalize_learning_short_answer(TEXT),
  platform_private.learning_matching_order(UUID, JSONB),
  platform_private.learning_exercise_public(platform_private.learning_exercises),
  platform_private.learning_exercise_explain(platform_private.learning_exercises),
  platform_private.grade_learning_answer(platform_private.learning_exercises, JSONB),
  platform_private.learning_attempt_payload(platform.learning_lesson_attempts),
  platform_private.write_learning_lesson(TEXT, UUID, UUID, BIGINT, UUID, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform.learning_modules_v1(),
  platform.learning_lesson_v1(UUID),
  platform.start_learning_lesson_v1(UUID, UUID),
  platform.save_learning_answer_v1(UUID, BIGINT, UUID, JSONB, UUID),
  platform.complete_learning_lesson_v1(UUID, BIGINT, UUID),
  platform.learning_review_v1(UUID),
  platform.learning_review_check_v1(UUID, JSONB),
  platform.profession_cards_v1(),
  platform.profession_card_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.learning_modules_v1(),
  platform.learning_lesson_v1(UUID),
  platform.start_learning_lesson_v1(UUID, UUID),
  platform.save_learning_answer_v1(UUID, BIGINT, UUID, JSONB, UUID),
  platform.complete_learning_lesson_v1(UUID, BIGINT, UUID),
  platform.learning_review_v1(UUID),
  platform.learning_review_check_v1(UUID, JSONB),
  platform.profession_cards_v1(),
  platform.profession_card_v1(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
