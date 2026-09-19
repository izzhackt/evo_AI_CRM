\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 198 (PORT-4a «Движок обучения и
-- профессий»). Runs at the 198 checkpoint against the FULL current schema,
-- exactly like platform_university_favorites.sql at 195. Fixtures are
-- synthetic actors with hook-generated live claims (the p192/p195 convention)
-- plus synthetic learning content inserted directly into platform_private
-- (the p135 convention: the boundary suite proves the RPC surface, not the
-- seed pipeline — migration 199 owns the real content). Every row rolls back.
--
-- Boundary claims proven here:
--   (i)    exact-key content validators reject malformed module/lesson/
--          exercise payloads of all four types and malformed profession
--          cards (22023); published content and receipts are immutable
--          (UPDATE/DELETE -> 55000), completed attempts are frozen;
--   (ii)   a Student starts/saves/completes ONLY their own attempt; save
--          grades server-side and returns the verdict + the answered
--          exercise's разбор immediately; answers are final inside an
--          attempt; the request_id replay returns the original receipt;
--   (iii)  answer keys and unanswered explains never serialize to the
--          client: the safe lesson projection carries no answer_index/
--          accepted/pairs/explain material, a draft resume carries разбор
--          ONLY for answered exercises;
--   (iv)   optimistic revision: a stale expected_revision fails 40001 and
--          a completed attempt takes no further writes;
--   (v)    the mistake bank is computed server-side at completion, the
--          review RPC returns wrong exercises (cap 20, newest first) as
--          safe projections, review_check grades ONLY exercises from the
--          actor's own bank;
--   (vi)   privacy: admin/sales/curator, a same-org peer Student and a
--          foreign-org Student are refused each other's state (42501),
--          anon/service_role/no-session are refused, direct table access
--          is refused, and nothing lands in audit_events;
--   (vii)  the guard is the 148/195/196 catalogue pattern and stays
--          case-INDEPENDENT: Student A works on a pending case, Student B
--          works with NO case at all;
--   (viii) content versioning: a newer module version replaces the map
--          entry while completed attempts keep their original lesson rows.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p198_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19800000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p198_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 198 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p198_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p198_id(INTEGER),
  pg_temp.p198_assert(BOOLEAN, TEXT),
  pg_temp.p198_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P198_LEARNING_ENGINE_SUITE_START' AS p198_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization A with admin/sales/curator staff and TWO students --
-- A owns a portal-activated PENDING case, B owns NO case at all (the guard
-- is the 148 catalogue guard, deliberately case-independent). Organization B
-- owns a third, foreign Student.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES
  (pg_temp.p198_id(1), 'Migration 198 synthetic organization A'),
  (pg_temp.p198_id(2), 'Migration 198 synthetic organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p198_id(101), 'p198-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p198_id(102), 'p198-sales@example.invalid', '{}'::JSONB),
  (pg_temp.p198_id(103), 'p198-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p198_id(104), 'p198-student-pending@example.invalid', '{}'::JSONB),
  (pg_temp.p198_id(105), 'p198-student-caseless@example.invalid', '{}'::JSONB),
  (pg_temp.p198_id(106), 'p198-student-foreign@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p198_id(201), pg_temp.p198_id(101), 'P198 Admin', 'active', 1),
  (pg_temp.p198_id(202), pg_temp.p198_id(102), 'P198 Sales', 'active', 1),
  (pg_temp.p198_id(203), pg_temp.p198_id(103), 'P198 Curator', 'active', 1),
  (pg_temp.p198_id(204), pg_temp.p198_id(104), 'P198 Pending Student', 'active', 1),
  (pg_temp.p198_id(205), pg_temp.p198_id(105), 'P198 Caseless Student', 'active', 1),
  (pg_temp.p198_id(206), pg_temp.p198_id(106), 'P198 Foreign Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
)
SELECT
  pg_temp.p198_id(300 + actor.n),
  pg_temp.p198_id(CASE WHEN actor.n = 6 THEN 2 ELSE 1 END),
  pg_temp.p198_id(200 + actor.n),
  'active', actor.role::platform.business_role,
  (
    SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1
  ),
  actor.role = 'admin'
FROM (VALUES
  (1, 'admin'), (2, 'sales'), (3, 'curator'),
  (4, 'student'), (5, 'student'), (6, 'student')
) AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p198_id(11), pg_temp.p198_id(1), 'organization', pg_temp.p198_id(1), 1),
  (pg_temp.p198_id(12), pg_temp.p198_id(2), 'organization', pg_temp.p198_id(2), 1),
  (pg_temp.p198_id(401), pg_temp.p198_id(1), 'student_case', pg_temp.p198_id(501), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT
  pg_temp.p198_id(CASE WHEN n = 6 THEN 2 ELSE 1 END),
  pg_temp.p198_id(300 + n),
  pg_temp.p198_id(CASE WHEN n = 6 THEN 12 ELSE 11 END),
  1, 1, TRUE, 'system', 'P198 synthetic organization scope', pg_temp.p198_id(600 + n)
FROM generate_series(1, 6) AS n;

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
VALUES
  (pg_temp.p198_id(1), pg_temp.p198_id(304), pg_temp.p198_id(401), 1,
   1, TRUE, 'system', 'P198 pending student case scope', pg_temp.p198_id(611));

-- Student A's portal-activated PENDING case (approved tier): replica-mode
-- snapshot of the shape 180/185 produce, exactly like p195's fixture. The
-- guard under test must NOT depend on this row -- Student B has none.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p198_id(501), pg_temp.p198_id(1), pg_temp.p198_id(304), pg_temp.p198_id(302),
  'synthetic:p198:approved-cabinet', 'P198 Pending Student', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p198_id(401), 1
);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (i) Content validators: exact-key rejection of malformed payloads (22023).
-- ---------------------------------------------------------------------------
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_modules (module_key, version, metadata)
    VALUES ('p198-bad-module', 'test-198', jsonb_build_object(
      'title_ru', 'x', 'title_ky', 'x', 'level_note_ru', 'x', 'level_note_ky', 'x',
      'extra_key', 'smuggled'))
  $sql$) = '22023',
  'module validator must reject an extra metadata key'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_modules (module_key, version, metadata)
    VALUES ('p198-bad-module', 'test-198', jsonb_build_object(
      'title_ru', 'x', 'title_ky', 'x', 'level_note_ru', 'x', 'level_note_ky', ' '))
  $sql$) = '22023',
  'module validator must reject a blank KY field'
);

INSERT INTO platform_private.learning_modules (id, module_key, version, metadata, published_at)
VALUES (pg_temp.p198_id(801), 'p198-module', 'test-198', jsonb_build_object(
  'title_ru', 'P198 Модуль', 'title_ky', 'P198 Модуль KY',
  'level_note_ru', 'Синтетический уровень', 'level_note_ky', 'Синтетикалык деңгээл'),
  '1900-01-01'::TIMESTAMPTZ);

SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_lessons (module_id, lesson_key, order_index, metadata, theory)
    VALUES (pg_temp.p198_id(801), 'p198-bad-lesson', 90,
      jsonb_build_object('title_ru', 'x', 'title_ky', 'x', 'goal_ru', 'x', 'goal_ky', 'x'),
      jsonb_build_array(jsonb_build_object('text_ru', 'x', 'text_ky', 'x',
        'examples', jsonb_build_array(jsonb_build_object('en', 'x', 'ru', 'x')))))
  $sql$) = '22023',
  'lesson validator must reject an example without the KY member'
);

INSERT INTO platform_private.learning_lessons (id, module_id, lesson_key, order_index, metadata, theory)
VALUES
  (pg_temp.p198_id(811), pg_temp.p198_id(801), 'p198-lesson-1', 1,
   jsonb_build_object('title_ru', 'Урок 1', 'title_ky', 'Сабак 1',
     'goal_ru', 'Цель 1', 'goal_ky', 'Максат 1'),
   jsonb_build_array(jsonb_build_object(
     'text_ru', 'Теория', 'text_ky', 'Теория KY',
     'examples', jsonb_build_array(jsonb_build_object('en', 'Hello', 'ru', 'Привет', 'ky', 'Салам'))))),
  (pg_temp.p198_id(812), pg_temp.p198_id(801), 'p198-lesson-2', 2,
   jsonb_build_object('title_ru', 'Урок 2', 'title_ky', 'Сабак 2',
     'goal_ru', 'Цель 2', 'goal_ky', 'Максат 2'),
   jsonb_build_array(jsonb_build_object(
     'text_ru', 'Теория 2', 'text_ky', 'Теория 2 KY',
     'examples', jsonb_build_array(jsonb_build_object('en', 'Bye', 'ru', 'Пока', 'ky', 'Кош')))));

-- Exercise validator rejections, one per type.
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
    VALUES (pg_temp.p198_id(811), 'p198-bad-choice', 91, 'choice', jsonb_build_object(
      'prompt_ru', 'x', 'prompt_ky', 'x', 'answer_index', 0,
      'options', jsonb_build_array(
        jsonb_build_object('id', 'a', 'label', 'A', 'explain_ru', 'x'),
        jsonb_build_object('id', 'b', 'label', 'B', 'explain_ru', 'x', 'explain_ky', 'x'))))
  $sql$) = '22023',
  'choice validator must require explain_ky on EVERY option'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
    VALUES (pg_temp.p198_id(811), 'p198-bad-choice-2', 92, 'choice', jsonb_build_object(
      'prompt_en', 'x', 'prompt_ru', 'x', 'prompt_ky', 'x', 'answer_index', 0,
      'options', jsonb_build_array(
        jsonb_build_object('id', 'a', 'label', 'A', 'explain_ru', 'x', 'explain_ky', 'x'),
        jsonb_build_object('id', 'b', 'label', 'B', 'explain_ru', 'x', 'explain_ky', 'x'))))
  $sql$) = '22023',
  'choice validator must reject mixing prompt_en with the RU/KY pair'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
    VALUES (pg_temp.p198_id(811), 'p198-bad-matching', 93, 'matching', jsonb_build_object(
      'instruction_ru', 'x', 'instruction_ky', 'x', 'explain_ru', 'x', 'explain_ky', 'x',
      'pairs', jsonb_build_array(
        jsonb_build_object('left_en', 'one', 'right_ru', 'дубль', 'right_ky', 'бир'),
        jsonb_build_object('left_en', 'two', 'right_ru', 'дубль', 'right_ky', 'эки'),
        jsonb_build_object('left_en', 'three', 'right_ru', 'три', 'right_ky', 'үч'))))
  $sql$) = '22023',
  'matching validator must reject duplicate right_ru values'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
    VALUES (pg_temp.p198_id(811), 'p198-bad-short', 94, 'short_answer', jsonb_build_object(
      'prompt_ru', 'x', 'prompt_ky', 'x', 'explain_ru', 'x', 'explain_ky', 'x',
      'accepted', jsonb_build_array(' ., ')))
  $sql$) = '22023',
  'short answer validator must reject an accepted form that normalizes to empty'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
    VALUES (pg_temp.p198_id(811), 'p198-bad-reading', 95, 'reading', jsonb_build_object(
      'passage_en', 'Synthetic passage.',
      'questions', jsonb_build_array(jsonb_build_object(
        'id', 'q1', 'prompt_en', 'x',
        'options', jsonb_build_array(
          jsonb_build_object('id', 'a', 'label', 'A', 'explain_ru', 'x', 'explain_ky', 'x'),
          jsonb_build_object('id', 'b', 'label', 'B', 'explain_ru', 'x', 'explain_ky', 'x'))))))
  $sql$) = '22023',
  'reading validator must require answer_index on every question'
);

-- Valid content: lesson 1 carries one exercise of EVERY type. Private
-- markers p198-private-* prove non-serialization below.
INSERT INTO platform_private.learning_exercises (id, lesson_id, exercise_key, order_index, exercise_type, body)
VALUES
  (pg_temp.p198_id(821), pg_temp.p198_id(811), 'p198-l1-e1', 1, 'choice', jsonb_build_object(
    'prompt_ru', 'Выберите верное.', 'prompt_ky', 'Туурасын тандаңыз.',
    'answer_index', 1,
    'options', jsonb_build_array(
      jsonb_build_object('id', 'a', 'label', 'Alpha',
        'explain_ru', 'p198-private-choice-explain-a', 'explain_ky', 'p198-private-choice-explain-a-ky'),
      jsonb_build_object('id', 'b', 'label', 'Bravo',
        'explain_ru', 'p198-private-choice-explain-b', 'explain_ky', 'p198-private-choice-explain-b-ky'),
      jsonb_build_object('id', 'c', 'label', 'Charlie',
        'explain_ru', 'p198-private-choice-explain-c', 'explain_ky', 'p198-private-choice-explain-c-ky'),
      jsonb_build_object('id', 'd', 'label', 'Delta',
        'explain_ru', 'p198-private-choice-explain-d', 'explain_ky', 'p198-private-choice-explain-d-ky')))),
  (pg_temp.p198_id(822), pg_temp.p198_id(811), 'p198-l1-e2', 2, 'matching', jsonb_build_object(
    'instruction_ru', 'Соедините.', 'instruction_ky', 'Дал келтириңиз.',
    'explain_ru', 'p198-private-matching-explain', 'explain_ky', 'p198-private-matching-explain-ky',
    'pairs', jsonb_build_array(
      jsonb_build_object('left_en', 'one', 'right_ru', 'один', 'right_ky', 'бир'),
      jsonb_build_object('left_en', 'two', 'right_ru', 'два', 'right_ky', 'эки'),
      jsonb_build_object('left_en', 'three', 'right_ru', 'три', 'right_ky', 'үч')))),
  (pg_temp.p198_id(823), pg_temp.p198_id(811), 'p198-l1-e3', 3, 'short_answer', jsonb_build_object(
    'prompt_ru', 'Напишите по-английски: «Я Айдана».',
    'prompt_ky', 'Англисче жазыңыз: «Мен Айданамын».',
    'accepted', jsonb_build_array('I''m Aidana', 'I am Aidana'),
    'explain_ru', 'p198-private-short-explain', 'explain_ky', 'p198-private-short-explain-ky')),
  (pg_temp.p198_id(824), pg_temp.p198_id(811), 'p198-l1-e4', 4, 'reading', jsonb_build_object(
    'passage_en', 'Aidana is from Naryn. She is sixteen.',
    'questions', jsonb_build_array(
      jsonb_build_object('id', 'q1', 'prompt_en', 'Where is Aidana from?', 'answer_index', 0,
        'options', jsonb_build_array(
          jsonb_build_object('id', 'a', 'label', 'Naryn',
            'explain_ru', 'p198-private-reading-explain-q1a', 'explain_ky', 'p198-private-reading-explain-q1a-ky'),
          jsonb_build_object('id', 'b', 'label', 'Osh',
            'explain_ru', 'p198-private-reading-explain-q1b', 'explain_ky', 'p198-private-reading-explain-q1b-ky'))),
      jsonb_build_object('id', 'q2', 'prompt_en', 'How old is she?', 'answer_index', 1,
        'options', jsonb_build_array(
          jsonb_build_object('id', 'a', 'label', 'fifteen',
            'explain_ru', 'p198-private-reading-explain-q2a', 'explain_ky', 'p198-private-reading-explain-q2a-ky'),
          jsonb_build_object('id', 'b', 'label', 'sixteen',
            'explain_ru', 'p198-private-reading-explain-q2b', 'explain_ky', 'p198-private-reading-explain-q2b-ky')))))),
  (pg_temp.p198_id(825), pg_temp.p198_id(812), 'p198-l2-e1', 1, 'choice', jsonb_build_object(
    'prompt_en', 'Ten plus three is ___.',
    'answer_index', 0,
    'options', jsonb_build_array(
      jsonb_build_object('id', 'a', 'label', 'thirteen',
        'explain_ru', 'p198-private-l2-explain-a', 'explain_ky', 'p198-private-l2-explain-a-ky'),
      jsonb_build_object('id', 'b', 'label', 'thirty',
        'explain_ru', 'p198-private-l2-explain-b', 'explain_ky', 'p198-private-l2-explain-b-ky'))));

-- Profession cards: validator rejections + two valid cards.
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.profession_cards (card_key, version, body)
    VALUES ('p198-bad-card', 'test-198', jsonb_build_object(
      'id', 'p198-bad-card', 'title_ru', 'x', 'title_ky', 'x',
      'orvis_scales', jsonb_build_array('bravery'),
      'day_in_work_ru', 'x', 'day_in_work_ky', 'x',
      'environment_ru', 'x', 'environment_ky', 'x',
      'skills_ru', jsonb_build_array('x'), 'skills_ky', jsonb_build_array('x'),
      'interesting_ru', jsonb_build_array('x'), 'interesting_ky', jsonb_build_array('x'),
      'hard_ru', jsonb_build_array('x'), 'hard_ky', jsonb_build_array('x'),
      'trial_task_ru', 'x', 'trial_task_ky', 'x',
      'study_directions_ru', jsonb_build_array('x'), 'study_directions_ky', jsonb_build_array('x'),
      'linked_program_refs', jsonb_build_array(jsonb_build_object(
        'institution_photo_key', 'k', 'program_hint', 'p')),
      'sources', jsonb_build_array('https://example.invalid/p198')))
  $sql$) = '22023',
  'profession card validator must reject an unknown ORVIS scale id'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error($sql$
    INSERT INTO platform_private.profession_cards (card_key, version, body)
    VALUES ('p198-bad-card-2', 'test-198', jsonb_build_object(
      'id', 'p198-bad-card-2', 'title_ru', 'x', 'title_ky', 'x',
      'orvis_scales', jsonb_build_array('analysis'),
      'day_in_work_ru', 'x', 'day_in_work_ky', 'x',
      'environment_ru', 'x', 'environment_ky', 'x',
      'skills_ru', jsonb_build_array('x', 'y'), 'skills_ky', jsonb_build_array('x'),
      'interesting_ru', jsonb_build_array('x'), 'interesting_ky', jsonb_build_array('x'),
      'hard_ru', jsonb_build_array('x'), 'hard_ky', jsonb_build_array('x'),
      'trial_task_ru', 'x', 'trial_task_ky', 'x',
      'study_directions_ru', jsonb_build_array('x'), 'study_directions_ky', jsonb_build_array('x'),
      'linked_program_refs', jsonb_build_array(jsonb_build_object(
        'institution_photo_key', 'k', 'program_hint', 'p')),
      'sources', jsonb_build_array('https://example.invalid/p198')))
  $sql$) = '22023',
  'profession card validator must reject RU/KY lists of different lengths'
);

INSERT INTO platform_private.profession_cards (id, card_key, version, body, published_at)
SELECT pg_temp.p198_id(830 + n), card_key, 'test-198', jsonb_build_object(
  'id', card_key, 'title_ru', title_ru, 'title_ky', title_ru || ' KY',
  'orvis_scales', scales,
  'day_in_work_ru', 'День из жизни.', 'day_in_work_ky', 'Жумуш күнү.',
  'environment_ru', 'Среда.', 'environment_ky', 'Чөйрө.',
  'skills_ru', jsonb_build_array('Навык'), 'skills_ky', jsonb_build_array('Көндүм'),
  'interesting_ru', jsonb_build_array('Интересно'), 'interesting_ky', jsonb_build_array('Кызык'),
  'hard_ru', jsonb_build_array('Сложно'), 'hard_ky', jsonb_build_array('Кыйын'),
  'trial_task_ru', 'Пробное задание.', 'trial_task_ky', 'Сынак тапшырма.',
  'study_directions_ru', jsonb_build_array('Направление'),
  'study_directions_ky', jsonb_build_array('Багыт'),
  'linked_program_refs', jsonb_build_array(jsonb_build_object(
    'institution_photo_key', 'p198-university', 'program_hint', 'P198 Program')),
  'sources', jsonb_build_array('https://example.invalid/p198/' || card_key)),
  '1900-01-01'::TIMESTAMPTZ
FROM (VALUES
  (1, 'p198-card-analyst', 'Аналитик', jsonb_build_array('analysis', 'organization')),
  (2, 'p198-card-guide', 'Гид', jsonb_build_array('adventure'))
) AS card(n, card_key, title_ru, scales);

-- (i) Immutability of published content.
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('UPDATE platform_private.learning_modules SET metadata = metadata') = '55000',
  'published module content must be immutable'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('UPDATE platform_private.learning_exercises SET body = body') = '55000',
  'published exercise content must be immutable'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('DELETE FROM platform_private.profession_cards') = '55000',
  'published profession cards must be immutable'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('TRUNCATE platform_private.learning_lessons CASCADE') = '55000',
  'published lesson content must not be truncated'
);

-- The correct matching answer, computed from the SAME served-order expression
-- the projection uses: matches[left i] = served position of stored right i.
SELECT (
  SELECT jsonb_agg(array_position(served.arr, idx) - 1 ORDER BY idx)::TEXT
  FROM (SELECT platform_private.learning_matching_order(
    pg_temp.p198_id(822),
    (SELECT body -> 'pairs' FROM platform_private.learning_exercises
     WHERE id = pg_temp.p198_id(822))) AS arr) served,
    generate_series(0, 2) AS idx
) AS p198_matching_correct
\gset

-- Live JWT claims via the CURRENT production hook -- never hand-built.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_sales_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_curator_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_student_a_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_student_b_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p198_id(106),
  'claims', jsonb_build_object('sub', pg_temp.p198_id(106), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p198_student_c_claims
\gset

-- ===========================================================================
-- (ii)+(iii)+(vii) Student A (pending case, approved tier): map, safe
-- projection, start/resume, per-exercise grading with instant разбор.
-- ===========================================================================
SET request.jwt.claims TO :'p198_student_a_claims';
SET ROLE authenticated;

SELECT platform.learning_modules_v1()::TEXT AS p198_map \gset
SELECT pg_temp.p198_assert(
  jsonb_array_length(:'p198_map'::JSONB -> 'modules') = 1
    AND :'p198_map'::JSONB #>> '{modules,0,lessonsTotal}' = '2'
    AND :'p198_map'::JSONB #>> '{modules,0,lessonsCompleted}' = '0'
    AND :'p198_map'::JSONB #>> '{modules,0,lessons,0,completed}' = 'false',
  'module map must show two lessons and zero own progress'
);

SELECT platform.learning_lesson_v1(pg_temp.p198_id(811))::TEXT AS p198_lesson \gset
SELECT pg_temp.p198_assert(
  jsonb_array_length(:'p198_lesson'::JSONB #> '{lesson,exercises}') = 4
    AND :'p198_lesson'::JSONB -> 'draft' = 'null'::JSONB
    AND :'p198_lesson'::JSONB -> 'latestCompleted' = 'null'::JSONB,
  'lesson projection must list four exercises and no attempts yet'
);
-- Answer keys and explains never serialize into the safe projection.
SELECT pg_temp.p198_assert(
  :'p198_lesson'::TEXT NOT LIKE '%p198-private-%'
    AND :'p198_lesson'::TEXT NOT LIKE '%answer_index%'
    AND :'p198_lesson'::TEXT NOT LIKE '%accepted%'
    AND :'p198_lesson'::TEXT NOT LIKE '%correctOptionId%'
    AND (:'p198_lesson'::JSONB #> '{lesson,exercises,1}') ? 'lefts'
    AND (:'p198_lesson'::JSONB #> '{lesson,exercises,1}') ? 'rights'
    AND NOT (:'p198_lesson'::JSONB #> '{lesson,exercises,1}') ? 'pairs',
  'safe projection must carry no answer keys, no explains and no stored pairs'
);

SELECT platform.start_learning_lesson_v1(pg_temp.p198_id(811), pg_temp.p198_id(901))
  ->> 'attemptId' AS p198_attempt \gset
SELECT pg_temp.p198_assert(
  platform.start_learning_lesson_v1(pg_temp.p198_id(811), pg_temp.p198_id(901))
    ->> 'attemptId' = :'p198_attempt',
  'start replay must return the original receipt'
);
SELECT pg_temp.p198_assert(
  platform.start_learning_lesson_v1(pg_temp.p198_id(811), pg_temp.p198_id(902))
    ->> 'attemptId' = :'p198_attempt',
  'a second start must resume the existing draft'
);

-- Choice: wrong option -> instant verdict + разбор of THE ANSWERED exercise.
SELECT platform.save_learning_answer_v1(:'p198_attempt', 1, pg_temp.p198_id(821),
  '{"selected":"a"}', pg_temp.p198_id(903))::TEXT AS p198_save_choice \gset
SELECT pg_temp.p198_assert(
  :'p198_save_choice'::JSONB ->> 'correct' = 'false'
    AND :'p198_save_choice'::JSONB ->> 'revision' = '2'
    AND :'p198_save_choice'::JSONB #>> '{explain,correctOptionId}' = 'b'
    AND :'p198_save_choice'::TEXT LIKE '%p198-private-choice-explain-a%'
    AND :'p198_save_choice'::TEXT LIKE '%p198-private-choice-explain-b-ky%',
  'choice save must grade server-side and return the full разбор immediately'
);
SELECT pg_temp.p198_assert(
  platform.save_learning_answer_v1(:'p198_attempt', 1, pg_temp.p198_id(821),
    '{"selected":"a"}', pg_temp.p198_id(903))::TEXT = :'p198_save_choice',
  'save replay must return the original receipt'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 1, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(822), '{"matches":[0,1,2]}', pg_temp.p198_id(904)
  )) = '40001',
  'a stale expected revision must fail 40001'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 2, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(821), '{"selected":"b"}', pg_temp.p198_id(905)
  )) = '22023',
  'an answered exercise must not accept a second answer'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 2, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(822), '{"matches":[0,0,1]}', pg_temp.p198_id(906)
  )) = '22023',
  'a non-permutation matching answer must be rejected'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 2, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(824), '{"selected":{"q1":"a"}}', pg_temp.p198_id(907)
  )) = '22023',
  'a reading answer must cover every question'
);

-- Matching: the correct served-order answer grades true.
SELECT platform.save_learning_answer_v1(:'p198_attempt', 2, pg_temp.p198_id(822),
  jsonb_build_object('matches', :'p198_matching_correct'::JSONB),
  pg_temp.p198_id(908))::TEXT AS p198_save_matching \gset
SELECT pg_temp.p198_assert(
  :'p198_save_matching'::JSONB ->> 'correct' = 'true'
    AND :'p198_save_matching'::JSONB #>> '{verdict,correctCount}' = '3'
    AND :'p198_save_matching'::TEXT LIKE '%p198-private-matching-explain%',
  'matching save must map served positions back to the stored pairing'
);

-- Short answer: normalization (case, spaces, trailing punctuation, apostrophe).
SELECT platform.save_learning_answer_v1(:'p198_attempt', 3, pg_temp.p198_id(823),
  jsonb_build_object('text', '  i’m   AIDANA., '), pg_temp.p198_id(909))::TEXT AS p198_save_short \gset
SELECT pg_temp.p198_assert(
  :'p198_save_short'::JSONB ->> 'correct' = 'true'
    AND :'p198_save_short'::JSONB #>> '{explain,answer}' = 'I''m Aidana',
  'short answer normalization must accept case/space/punctuation/apostrophe variants'
);

-- Draft resume: разбор present ONLY for the three answered exercises; the
-- unanswered reading keeps its keys and explains private.
SELECT platform.learning_lesson_v1(pg_temp.p198_id(811))::TEXT AS p198_resume \gset
SELECT pg_temp.p198_assert(
  (SELECT count(*) FROM jsonb_object_keys(:'p198_resume'::JSONB #> '{draft,answers}')) = 3
    AND :'p198_resume'::JSONB #>> '{draft,answeredCount}' = '3'
    AND :'p198_resume'::TEXT LIKE '%p198-private-choice-explain-a%'
    AND :'p198_resume'::TEXT NOT LIKE '%p198-private-reading-explain%'
    AND :'p198_resume'::TEXT NOT LIKE '%answer_index%',
  'draft resume must carry разбор only for answered exercises'
);

-- Completion requires every exercise answered; the share is stored, not gated.
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.complete_learning_lesson_v1(%L, 4, %L)',
    :'p198_attempt', pg_temp.p198_id(910)
  )) = '22023',
  'completion must require every exercise answered'
);
SELECT platform.save_learning_answer_v1(:'p198_attempt', 4, pg_temp.p198_id(824),
  '{"selected":{"q1":"a","q2":"a"}}', pg_temp.p198_id(911))::TEXT AS p198_save_reading \gset
SELECT pg_temp.p198_assert(
  :'p198_save_reading'::JSONB ->> 'correct' = 'false'
    AND :'p198_save_reading'::JSONB #>> '{verdict,perQuestion,q1}' = 'true'
    AND :'p198_save_reading'::JSONB #>> '{verdict,perQuestion,q2}' = 'false',
  'reading verdict must carry per-question detail'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.complete_learning_lesson_v1(%L, 4, %L)',
    :'p198_attempt', pg_temp.p198_id(912)
  )) = '40001',
  'completion with a stale revision must fail 40001'
);
SELECT platform.complete_learning_lesson_v1(:'p198_attempt', 5, pg_temp.p198_id(913))::TEXT
  AS p198_completed \gset
SELECT pg_temp.p198_assert(
  :'p198_completed'::JSONB ->> 'status' = 'completed'
    AND :'p198_completed'::JSONB #>> '{result,exercisesTotal}' = '4'
    AND :'p198_completed'::JSONB #>> '{result,correctCount}' = '2'
    AND (:'p198_completed'::JSONB #>> '{result,correctShare}')::NUMERIC = 0.5
    AND :'p198_completed'::JSONB #> '{result,wrongExerciseIds}'
      = jsonb_build_array(pg_temp.p198_id(821)::TEXT, pg_temp.p198_id(824)::TEXT),
  'completion must store the share and the server-computed mistake bank'
);
SELECT pg_temp.p198_assert(
  platform.complete_learning_lesson_v1(:'p198_attempt', 5, pg_temp.p198_id(913))::TEXT
    = :'p198_completed',
  'completion replay must return the original receipt'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 6, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(821), '{"selected":"b"}', pg_temp.p198_id(914)
  )) = '40001',
  'a completed attempt must take no further writes'
);

-- Progress and retake.
SELECT platform.learning_modules_v1()::TEXT AS p198_map_after \gset
SELECT pg_temp.p198_assert(
  :'p198_map_after'::JSONB #>> '{modules,0,lessonsCompleted}' = '1'
    AND :'p198_map_after'::JSONB #>> '{modules,0,lessons,0,completed}' = 'true'
    AND :'p198_map_after'::JSONB #>> '{modules,0,lessons,0,lastResult,correctCount}' = '2',
  'module map must reflect own completion'
);
SELECT platform.start_learning_lesson_v1(pg_temp.p198_id(811), pg_temp.p198_id(915))
  ->> 'attemptId' AS p198_retake \gset
SELECT pg_temp.p198_assert(
  :'p198_retake' <> :'p198_attempt',
  'a retake must open a new attempt'
);

-- ===========================================================================
-- (v) Review: own mistake bank, safe projections, bank-guarded re-check.
-- ===========================================================================
SELECT platform.learning_review_v1(pg_temp.p198_id(801))::TEXT AS p198_review \gset
SELECT pg_temp.p198_assert(
  jsonb_array_length(:'p198_review'::JSONB -> 'items') = 2
    AND :'p198_review'::JSONB #>> '{items,0,exerciseId}' = pg_temp.p198_id(821)::TEXT
    AND :'p198_review'::JSONB #>> '{items,1,exerciseId}' = pg_temp.p198_id(824)::TEXT
    AND :'p198_review'::TEXT NOT LIKE '%p198-private-%'
    AND :'p198_review'::TEXT NOT LIKE '%answer_index%',
  'review must list wrong exercises as safe projections'
);
SELECT platform.learning_review_check_v1(pg_temp.p198_id(821), '{"selected":"b"}')::TEXT
  AS p198_review_check \gset
SELECT pg_temp.p198_assert(
  :'p198_review_check'::JSONB ->> 'correct' = 'true'
    AND :'p198_review_check'::TEXT LIKE '%p198-private-choice-explain-b%',
  'review check must grade and reveal the разбор of a bank exercise'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.learning_review_check_v1(%L, %L)',
    pg_temp.p198_id(822), '{"matches":[0,1,2]}'
  )) = '42501',
  'review check must refuse an exercise outside the own mistake bank'
);

-- Professions: list + full card.
SELECT platform.profession_cards_v1()::TEXT AS p198_cards \gset
SELECT pg_temp.p198_assert(
  jsonb_array_length(:'p198_cards'::JSONB -> 'cards') = 2
    AND :'p198_cards'::JSONB #>> '{cards,0,cardKey}' = 'p198-card-analyst',
  'profession list must return the published cards'
);
SELECT pg_temp.p198_assert(
  (SELECT count(*) FROM jsonb_object_keys(
    platform.profession_card_v1(pg_temp.p198_id(831)) -> 'body')) = 20,
  'profession card must return the full validated body'
);

-- Direct table access stays closed even for the owner student.
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT * FROM platform.learning_lesson_attempts') = '42501',
  'direct attempt table access must be denied'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT * FROM platform_private.learning_exercises') = '42501',
  'direct content table access must be denied'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT * FROM platform_private.learning_requests') = '42501',
  'direct receipt table access must be denied'
);

RESET ROLE;

-- ===========================================================================
-- (vi) Same-org peer Student B (caseless) and foreign-org Student C.
-- ===========================================================================
SET request.jwt.claims TO :'p198_student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  (platform.learning_modules_v1() #>> '{modules,0,lessonsCompleted}') = '0'
    AND (platform.learning_modules_v1() #> '{modules,0,lessons,0,draftAttemptId}') = 'null'::JSONB,
  'peer student must see zero foreign progress (and the caseless guard must pass)'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.save_learning_answer_v1(%L, 6, %L, %L, %L)',
    :'p198_attempt', pg_temp.p198_id(821), '{"selected":"b"}', pg_temp.p198_id(921)
  )) = '42501',
  'peer student must be refused a foreign attempt'
);
SELECT pg_temp.p198_assert(
  jsonb_array_length(platform.learning_review_v1(pg_temp.p198_id(801)) -> 'items') = 0,
  'peer student review bank must be empty'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.learning_review_check_v1(%L, %L)',
    pg_temp.p198_id(821), '{"selected":"b"}'
  )) = '42501',
  'peer student must be refused a foreign mistake-bank exercise'
);
RESET ROLE;

SET request.jwt.claims TO :'p198_student_c_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'SELECT platform.complete_learning_lesson_v1(%L, 6, %L)',
    :'p198_attempt', pg_temp.p198_id(922)
  )) = '42501',
  'foreign-org student must be refused a foreign attempt'
);
SELECT pg_temp.p198_assert(
  (platform.learning_modules_v1() #>> '{modules,0,lessonsCompleted}') = '0',
  'foreign-org student must see zero foreign progress'
);
RESET ROLE;

-- ===========================================================================
-- (vi) Staff, anon, service_role and no-session denials.
-- ===========================================================================
SET request.jwt.claims TO :'p198_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501'
    AND pg_temp.p198_error('SELECT platform.profession_cards_v1()') = '42501'
    AND pg_temp.p198_error(format('SELECT platform.learning_lesson_v1(%L)', pg_temp.p198_id(811))) = '42501'
    AND pg_temp.p198_error(format(
      'SELECT platform.save_learning_answer_v1(%L, 6, %L, %L, %L)',
      :'p198_attempt', pg_temp.p198_id(821), '{"selected":"b"}', pg_temp.p198_id(923))) = '42501',
  'admin must be refused every learning RPC'
);
RESET ROLE;
SET request.jwt.claims TO :'p198_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501'
    AND pg_temp.p198_error(format('SELECT platform.learning_review_v1(%L)', pg_temp.p198_id(801))) = '42501',
  'sales must be refused every learning RPC'
);
RESET ROLE;
SET request.jwt.claims TO :'p198_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501'
    AND pg_temp.p198_error(format('SELECT platform.profession_card_v1(%L)', pg_temp.p198_id(831))) = '42501',
  'curator must be refused every learning RPC'
);
RESET ROLE;

SET request.jwt.claims TO '{}';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501',
  'a session without claims must be refused'
);
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501',
  'anon must be refused'
);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501',
  'service_role must be refused the RPC'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT * FROM platform.learning_lesson_attempts') = '42501',
  'service_role must be refused the table despite BYPASSRLS-free grants'
);
RESET ROLE;

-- ===========================================================================
-- Catalog hygiene: definer/search_path pins, restricted grants, forced RLS,
-- and no audit projection of private learning state.
-- ===========================================================================
DO $$
DECLARE routine OID; role_name TEXT;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'platform.learning_modules_v1()'::regprocedure,
    'platform.learning_lesson_v1(uuid)'::regprocedure,
    'platform.start_learning_lesson_v1(uuid,uuid)'::regprocedure,
    'platform.save_learning_answer_v1(uuid,bigint,uuid,jsonb,uuid)'::regprocedure,
    'platform.complete_learning_lesson_v1(uuid,bigint,uuid)'::regprocedure,
    'platform.learning_review_v1(uuid)'::regprocedure,
    'platform.learning_review_check_v1(uuid,jsonb)'::regprocedure,
    'platform.profession_cards_v1()'::regprocedure,
    'platform.profession_card_v1(uuid)'::regprocedure
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
      FROM pg_proc WHERE oid = routine) THEN
      RAISE EXCEPTION 'Migration 198 assertion failed: definer/search_path pin on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'Migration 198 assertion failed: % must not execute %', role_name, routine;
      END IF;
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.p198_assert(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN (
      'platform_private.learning_modules'::regclass,
      'platform_private.learning_lessons'::regclass,
      'platform_private.learning_exercises'::regclass,
      'platform_private.profession_cards'::regclass,
      'platform.learning_lesson_attempts'::regclass,
      'platform_private.learning_requests'::regclass)),
  'all six learning tables must keep forced RLS'
);
SELECT pg_temp.p198_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id IN
    (SELECT request_id FROM platform_private.learning_requests)),
  'private learning writes must never enter staff audit'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error(format(
    'UPDATE platform.learning_lesson_attempts SET revision = revision + 1 WHERE id = %L',
    :'p198_attempt')) = '55000',
  'a completed attempt must be immutable even for the SQL owner'
);
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('DELETE FROM platform_private.learning_requests') = '55000',
  'receipts must be immutable'
);

-- ===========================================================================
-- (viii) Content versioning: a newer module version replaces the map entry;
-- completed attempts keep their original lesson rows.
-- ===========================================================================
INSERT INTO platform_private.learning_modules (id, module_key, version, metadata, published_at)
VALUES (pg_temp.p198_id(802), 'p198-module', 'test-198-v2', jsonb_build_object(
  'title_ru', 'P198 Модуль v2', 'title_ky', 'P198 Модуль v2 KY',
  'level_note_ru', 'Вторая версия', 'level_note_ky', 'Экинчи версия'),
  '1901-01-01'::TIMESTAMPTZ);
INSERT INTO platform_private.learning_lessons (id, module_id, lesson_key, order_index, metadata, theory)
VALUES (pg_temp.p198_id(813), pg_temp.p198_id(802), 'p198-lesson-1', 1,
  jsonb_build_object('title_ru', 'Урок 1 v2', 'title_ky', 'Сабак 1 v2',
    'goal_ru', 'Цель', 'goal_ky', 'Максат'),
  jsonb_build_array(jsonb_build_object(
    'text_ru', 'Теория v2', 'text_ky', 'Теория v2 KY',
    'examples', jsonb_build_array(jsonb_build_object('en', 'Hi', 'ru', 'Привет', 'ky', 'Салам')))));

SET request.jwt.claims TO :'p198_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  (platform.learning_modules_v1() #>> '{modules,0,version}') = 'test-198-v2'
    AND (platform.learning_modules_v1() #>> '{modules,0,lessonsCompleted}') = '0',
  'the map must serve the newest module version with its own progress'
);
SELECT pg_temp.p198_assert(
  (platform.learning_lesson_v1(pg_temp.p198_id(811)) #>> '{latestCompleted,status}') = 'completed',
  'a completed attempt must stay readable on its original lesson row'
);
RESET ROLE;

-- Revocation closes the RPC even with a formerly valid JWT.
UPDATE platform.profiles SET access_version = access_version + 1
  WHERE id = pg_temp.p198_id(204);
SET ROLE authenticated;
SELECT pg_temp.p198_assert(
  pg_temp.p198_error('SELECT platform.learning_modules_v1()') = '42501',
  'a stale access version must be refused'
);
RESET ROLE;

SELECT 'P198_LEARNING_ENGINE_SUITE_PASSED' AS p198_suite_marker;
ROLLBACK;
