\set ON_ERROR_STOP on

-- Acceptance for the CSCA math part 2 content migration (release 1.1.0 of
-- the module csca-math). Runs after the migration, on the database where
-- platform_csca_math_part2_pre.sql committed a Student with progress on release
-- 1.0.0. The engine (285) is NOT changed by part 2: this suite shows that the
-- existing validators and RPCs take the larger release as it is. Every row
-- the suite writes rolls back.
--
-- Claims proven here:
--   (i)    1.1.0 is the current release of csca-math and 1.0.0 stays beside it;
--          counts: 28 topics, 55 figures, 228 items, 56 lessons (28 lessons and
--          28 practice sets), 156 exercises, 2 forms; pools 93/63/24/48;
--   (ii)   everything of 1.0.0 is carried unchanged: items, figures, lessons
--          with their theory, exercises in order, topics, module metadata;
--   (iii)  every item is used exactly once; the mock has 48 items at 75 s
--          each, no early finish, modules 7/19/14/8, difficulty 14/24/10;
--          the diagnostic has 24 items, two per syllabus point, early finish;
--   (iv)   published rows of 1.1.0 are immutable;
--   (v)    progress goes by key: a lesson, the answer log and the review bank
--          of 1.0.0 count in 1.1.0; new forms show no stale result; the old
--          diagnostic attempt stays readable with its review;
--   (vi)   a Student runs a new lesson, its practice, the 24 item diagnostic
--          and the 48 item mock through the unchanged RPCs (server deadline,
--          no key or разбор before completion, early finish refused for the
--          mock, completion by timeout, review of 48 items);
--   (vii)  privacy: Sales and Curator are refused (42501), no table grants,
--          learning_modules_v1 never lists CSCA.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.c2_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('c5ca0002-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.c2_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CSCA math part 2 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.c2_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE FUNCTION pg_temp.c2_failure(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.c2_id(INTEGER),
  pg_temp.c2_assert(BOOLEAN, TEXT),
  pg_temp.c2_error(TEXT),
  pg_temp.c2_failure(TEXT)
  TO authenticated, anon, service_role;

-- Owner-only: simulate elapsed time on an attempt (as the 285 suite does).
CREATE FUNCTION pg_temp.c2_age_attempt(p_attempt UUID, p_seconds INTEGER) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE platform.learning_test_attempts
    SET started_at = started_at - make_interval(secs => p_seconds),
      deadline_at = deadline_at - make_interval(secs => p_seconds),
      created_at = created_at - make_interval(secs => p_seconds)
    WHERE id = p_attempt;
  SET LOCAL session_replication_role = origin;
END
$$;

SELECT 'CSCA_MATH_PART2_SUITE_START' AS c2_suite_marker;

-- Handles, read as the owner (Students cannot read tables).
SELECT
  (SELECT id FROM platform_private.learning_modules WHERE module_key = 'csca-math' AND version = '1.0.0') AS c2_v1,
  (SELECT id FROM platform_private.learning_modules WHERE module_key = 'csca-math' AND version = '1.1.0') AS c2_v2
\gset
SELECT
  (SELECT id FROM platform_private.learning_lessons WHERE module_id = :'c2_v2' AND lesson_key = 'csca-math-m1-sets-l1') AS c2_sets_lesson,
  (SELECT id FROM platform_private.learning_lessons WHERE module_id = :'c2_v2' AND lesson_key = 'csca-math-m1-sets-p1') AS c2_sets_practice,
  (SELECT jsonb_array_length(theory) FROM platform_private.learning_lessons
    WHERE module_id = :'c2_v2' AND lesson_key = 'csca-math-m1-sets-l1') AS c2_sets_theory_length,
  (SELECT id FROM platform_private.learning_test_forms WHERE module_id = :'c2_v2' AND form_key = 'csca-math-diagnostic-2') AS c2_diagnostic,
  (SELECT id FROM platform_private.learning_test_forms WHERE module_id = :'c2_v2' AND form_key = 'csca-math-mock-2') AS c2_mock,
  (SELECT id FROM platform.learning_test_attempts WHERE student_membership_id = pg_temp.c2_id(304) AND status = 'completed') AS c2_old_attempt,
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS c2_today
\gset

-- Correct options of release 1.1.0 and ready answer sets: all right; the
-- diagnostic with its last item wrong.
SELECT jsonb_object_agg(item.item_key, item.body -> 'options' -> (item.body ->> 'answer_index')::INTEGER ->> 'id')::TEXT
  AS c2_keys
FROM platform_private.learning_items item WHERE item.module_id = :'c2_v2'
\gset
SELECT (SELECT jsonb_object_agg(key.value,
    CASE WHEN key.ordinality = jsonb_array_length(form.item_keys)
      THEN CASE WHEN :'c2_keys'::JSONB ->> key.value = 'a' THEN 'b' ELSE 'a' END
      ELSE :'c2_keys'::JSONB ->> key.value END)
  FROM jsonb_array_elements_text(form.item_keys) WITH ORDINALITY AS key(value, ordinality))::TEXT AS c2_diagnostic_answers
FROM platform_private.learning_test_forms form WHERE form.id = :'c2_diagnostic'
\gset
SELECT (SELECT jsonb_object_agg(key.value, :'c2_keys'::JSONB ->> key.value)
  FROM jsonb_array_elements_text(form.item_keys) AS key(value))::TEXT AS c2_mock_answers
FROM platform_private.learning_test_forms form WHERE form.id = :'c2_mock'
\gset

-- Live JWT claims via the CURRENT production hook.
SELECT
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.c2_id(102),
    'claims', jsonb_build_object('sub', pg_temp.c2_id(102), 'role', 'authenticated'))) -> 'claims')::TEXT AS c2_sales,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.c2_id(103),
    'claims', jsonb_build_object('sub', pg_temp.c2_id(103), 'role', 'authenticated'))) -> 'claims')::TEXT AS c2_curator,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.c2_id(104),
    'claims', jsonb_build_object('sub', pg_temp.c2_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS c2_student
\gset

-- ===========================================================================
-- (i) The release.
-- ===========================================================================
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_modules WHERE module_key = 'csca-math') = 2
    AND (SELECT array_agg(version ORDER BY version) FROM platform_private.learning_modules
      WHERE module_key = 'csca-math') = ARRAY['1.0.0', '1.1.0']
    AND (SELECT count(*) FROM platform_private.learning_track_modules('csca-math')) = 1
    AND (SELECT id FROM platform_private.learning_track_modules('csca-math')) = :'c2_v2'
    AND (SELECT count(*) FROM platform_private.learning_track_modules('english')) >= 1,
  '1.1.0 is the current release of csca-math, 1.0.0 stays, the English course is untouched');
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_topics WHERE module_id = :'c2_v2') = 28
    AND (SELECT count(*) FROM platform_private.learning_figures WHERE module_id = :'c2_v2') = 55
    AND (SELECT count(*) FROM platform_private.learning_items WHERE module_id = :'c2_v2') = 228
    AND (SELECT count(*) FROM platform_private.learning_lessons WHERE module_id = :'c2_v2') = 56
    AND (SELECT count(*) FROM platform_private.learning_exercises exercise
      JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
      WHERE lesson.module_id = :'c2_v2') = 156
    AND (SELECT count(*) FROM platform_private.learning_test_forms WHERE module_id = :'c2_v2') = 2
    AND (SELECT jsonb_object_agg(pool, n) FROM (SELECT pool, count(*) AS n FROM platform_private.learning_items
      WHERE module_id = :'c2_v2' GROUP BY pool) pools) = '{"lesson": 93, "practice": 63, "diagnostic": 24, "mock": 48}'::JSONB,
  'release 1.1.0 holds 28 topics, 55 figures, 228 items (93/63/24/48), 56 lessons, 156 exercises and 2 forms');
SELECT pg_temp.c2_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.learning_topics topic WHERE topic.module_id = :'c2_v2'
    AND ((SELECT count(*) FROM platform_private.learning_lessons lesson WHERE lesson.module_id = :'c2_v2'
        AND lesson.metadata ->> 'topic_key' = topic.topic_key AND lesson.metadata ->> 'kind' = 'lesson') <> 1
      OR (SELECT count(*) FROM platform_private.learning_lessons lesson WHERE lesson.module_id = :'c2_v2'
        AND lesson.metadata ->> 'topic_key' = topic.topic_key AND lesson.metadata ->> 'kind' = 'practice') <> 1)),
  'every one of the 28 topics has exactly one lesson and one practice set');
SELECT pg_temp.c2_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.learning_items item
    WHERE item.module_id = :'c2_v2'
      AND (SELECT count(*) FROM platform_private.learning_exercises exercise
          JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
          WHERE lesson.module_id = :'c2_v2' AND exercise.exercise_key = item.item_key)
        + (SELECT count(*) FROM platform_private.learning_test_forms form
          WHERE form.module_id = :'c2_v2' AND form.item_keys ? item.item_key) <> 1),
  'every item is used exactly once: one lesson check, one practice set or one form');

-- ===========================================================================
-- (ii) Everything of 1.0.0 is carried unchanged.
-- ===========================================================================
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_items old WHERE old.module_id = :'c2_v1') = 30
    AND (SELECT count(*) FROM platform_private.learning_items old
      JOIN platform_private.learning_items now ON now.module_id = :'c2_v2' AND now.item_key = old.item_key
      WHERE old.module_id = :'c2_v1' AND now.body = old.body AND now.topic_key = old.topic_key
        AND now.syllabus_point = old.syllabus_point AND now.difficulty = old.difficulty AND now.pool = old.pool
        AND now.provenance = old.provenance) = 30,
  'the 30 items of 1.0.0 are carried with identical body, topic, point, difficulty and pool');
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_figures old WHERE old.module_id = :'c2_v1') = 9
    AND (SELECT count(*) FROM platform_private.learning_figures old
      JOIN platform_private.learning_figures now ON now.module_id = :'c2_v2' AND now.figure_key = old.figure_key
      WHERE old.module_id = :'c2_v1' AND now.svg = old.svg AND now.sha256 = old.sha256 AND now.view_box = old.view_box
        AND now.alt_ru = old.alt_ru AND now.alt_ky = old.alt_ky AND now.alt_en = old.alt_en) = 9,
  'the 9 figures of 1.0.0 are carried byte for byte');
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_lessons old WHERE old.module_id = :'c2_v1') = 6
    AND (SELECT count(*) FROM platform_private.learning_lessons old
      JOIN platform_private.learning_lessons now ON now.module_id = :'c2_v2' AND now.lesson_key = old.lesson_key
      WHERE old.module_id = :'c2_v1' AND now.metadata = old.metadata AND now.theory = old.theory) = 6
    AND (SELECT count(*) FROM platform_private.learning_exercises old
      JOIN platform_private.learning_lessons old_lesson ON old_lesson.id = old.lesson_id AND old_lesson.module_id = :'c2_v1'
      JOIN platform_private.learning_lessons now_lesson ON now_lesson.module_id = :'c2_v2'
        AND now_lesson.lesson_key = old_lesson.lesson_key
      JOIN platform_private.learning_exercises now ON now.lesson_id = now_lesson.id AND now.exercise_key = old.exercise_key
      WHERE now.order_index = old.order_index AND now.body = old.body AND now.exercise_type = old.exercise_type) = 21,
  'the 6 lessons (3 lessons and 3 practice sets) and their 21 exercises are carried with theory and order');
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform_private.learning_topics old
    JOIN platform_private.learning_topics now ON now.module_id = :'c2_v2' AND now.topic_key = old.topic_key
    WHERE old.module_id = :'c2_v1' AND now.order_index = old.order_index
      AND now.metadata - 'prerequisites' = old.metadata - 'prerequisites') = 28
    AND (SELECT module.metadata FROM platform_private.learning_modules module WHERE module.id = :'c2_v2')
      = (SELECT module.metadata FROM platform_private.learning_modules module WHERE module.id = :'c2_v1'),
  'the 28 topics keep key, order and metadata (prerequisites may grow); the module metadata is identical');
SELECT pg_temp.c2_assert(
  (SELECT array_agg(form_key ORDER BY form_key) FROM platform_private.learning_test_forms WHERE module_id = :'c2_v1')
    = ARRAY['csca-math-diagnostic-1', 'csca-math-mock-1']
    AND (SELECT array_agg(form_key ORDER BY form_key) FROM platform_private.learning_test_forms WHERE module_id = :'c2_v2')
      = ARRAY['csca-math-diagnostic-2', 'csca-math-mock-2']
    AND NOT EXISTS (SELECT 1 FROM platform_private.learning_test_forms old
      JOIN platform_private.learning_test_forms now ON now.module_id = :'c2_v2' AND now.kind = old.kind
      WHERE old.module_id = :'c2_v1' AND NOT (now.item_keys @> old.item_keys)),
  'the pilot forms keep their release; the full forms have new keys and reuse every pilot item');

-- ===========================================================================
-- (iii) The forms.
-- ===========================================================================
SELECT pg_temp.c2_assert(
  (SELECT jsonb_array_length(item_keys) = 48 AND duration_seconds = 3600 AND NOT allow_early_finish AND kind = 'mock'
    FROM platform_private.learning_test_forms WHERE id = :'c2_mock')
    AND (SELECT jsonb_object_agg(section, n) FROM (
      SELECT topic.metadata ->> 'section' AS section, count(*) AS n
      FROM platform_private.learning_test_forms form
      CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) AS key(value)
      JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = key.value
      JOIN platform_private.learning_topics topic ON topic.module_id = form.module_id AND topic.topic_key = item.topic_key
      WHERE form.id = :'c2_mock' GROUP BY 1) sections) = '{"1": 7, "2": 19, "3": 14, "4": 8}'::JSONB
    AND (SELECT jsonb_object_agg(difficulty, n) FROM (
      SELECT item.difficulty, count(*) AS n
      FROM platform_private.learning_test_forms form
      CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) AS key(value)
      JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = key.value
      WHERE form.id = :'c2_mock' GROUP BY 1) levels) = '{"1": 14, "2": 24, "3": 10}'::JSONB
    AND NOT EXISTS (SELECT 1 FROM platform_private.learning_test_forms form
      CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) AS key(value)
      JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = key.value
      WHERE form.id = :'c2_mock' AND item.pool <> 'mock'),
  'the mock has 48 mock-pool items, 3600 s, no early finish, modules 7/19/14/8 and difficulty 14/24/10');
SELECT pg_temp.c2_assert(
  (SELECT jsonb_array_length(item_keys) = 24 AND duration_seconds = 1800 AND allow_early_finish AND kind = 'diagnostic'
    FROM platform_private.learning_test_forms WHERE id = :'c2_diagnostic')
    AND (SELECT count(*) = 12 AND bool_and(n = 2) FROM (
      SELECT item.syllabus_point, count(*) AS n
      FROM platform_private.learning_test_forms form
      CROSS JOIN LATERAL jsonb_array_elements_text(form.item_keys) AS key(value)
      JOIN platform_private.learning_items item ON item.module_id = form.module_id AND item.item_key = key.value
      WHERE form.id = :'c2_diagnostic' AND item.pool = 'diagnostic' GROUP BY 1) points),
  'the diagnostic has 24 diagnostic-pool items, 1800 s, early finish and two items on each of the 12 points');

-- ===========================================================================
-- (iv) Immutability of the new release.
-- ===========================================================================
SELECT pg_temp.c2_assert(
  pg_temp.c2_error('UPDATE platform_private.learning_items SET pool = pool WHERE module_id = ''' || :'c2_v2' || '''') = '55000'
    AND pg_temp.c2_error('DELETE FROM platform_private.learning_test_forms WHERE module_id = ''' || :'c2_v2' || '''') = '55000'
    AND pg_temp.c2_error('UPDATE platform_private.learning_lessons SET theory = theory WHERE module_id = ''' || :'c2_v2' || '''') = '55000'
    AND pg_temp.c2_error('DELETE FROM platform_private.learning_figures WHERE module_id = ''' || :'c2_v2' || '''') = '55000',
  'published items, lessons, figures and forms of 1.1.0 are immutable even for the SQL owner');

-- ===========================================================================
-- (v) Progress goes by key.
-- ===========================================================================
SET request.jwt.claims TO :'c2_student';
SET ROLE authenticated;
SELECT platform.learning_track_home_v1('csca-math')::TEXT AS c2_home \gset
SELECT pg_temp.c2_assert(
  jsonb_array_length(:'c2_home'::JSONB -> 'modules') = 1
    AND :'c2_home'::JSONB #>> '{modules,0,version}' = '1.1.0'
    AND jsonb_array_length(:'c2_home'::JSONB -> 'topics') = 28
    AND (SELECT bool_and((topic ->> 'hasLessons')::BOOLEAN) FROM jsonb_array_elements(:'c2_home'::JSONB -> 'topics') topic)
    AND jsonb_array_length(:'c2_home'::JSONB -> 'lessons') = 56
    AND jsonb_array_length(:'c2_home'::JSONB -> 'tests') = 2
    AND (SELECT array_agg(test ->> 'formKey' ORDER BY test ->> 'formKey') FROM jsonb_array_elements(:'c2_home'::JSONB -> 'tests') test)
      = ARRAY['csca-math-diagnostic-2', 'csca-math-mock-2'],
  'the home lists release 1.1.0: 28 topics all with lessons, 56 lessons, the two full forms');
SELECT pg_temp.c2_assert(
  :'c2_home'::JSONB #>> '{tests,0,kind}' = 'diagnostic' AND :'c2_home'::JSONB #>> '{tests,0,itemsTotal}' = '24'
    AND :'c2_home'::JSONB #>> '{tests,0,durationSeconds}' = '1800' AND :'c2_home'::JSONB #>> '{tests,0,allowEarlyFinish}' = 'true'
    AND :'c2_home'::JSONB #>> '{tests,1,kind}' = 'mock' AND :'c2_home'::JSONB #>> '{tests,1,itemsTotal}' = '48'
    AND :'c2_home'::JSONB #>> '{tests,1,durationSeconds}' = '3600' AND :'c2_home'::JSONB #>> '{tests,1,allowEarlyFinish}' = 'false'
    AND :'c2_home'::JSONB #> '{tests,0,lastResult}' = 'null'::JSONB AND :'c2_home'::JSONB #> '{tests,1,lastResult}' = 'null'::JSONB,
  'the new forms show their size and time, and no stale result of the pilot form');
SELECT pg_temp.c2_assert(
  (SELECT (lesson ->> 'completed')::BOOLEAN FROM jsonb_array_elements(:'c2_home'::JSONB -> 'lessons') lesson
    WHERE lesson ->> 'lessonKey' = 'csca-math-m2-exp-log-l1')
    AND NOT (SELECT (lesson ->> 'completed')::BOOLEAN FROM jsonb_array_elements(:'c2_home'::JSONB -> 'lessons') lesson
      WHERE lesson ->> 'lessonKey' = 'csca-math-m2-exp-log-p1')
    AND (SELECT topic ->> 'state' FROM jsonb_array_elements(:'c2_home'::JSONB -> 'topics') topic
      WHERE topic ->> 'topicKey' = 'm2-exp-log') = 'shaky'
    AND (:'c2_home'::JSONB #>> '{review,activeCount}')::INTEGER = 2
    AND :'c2_home'::JSONB #>> '{nextStep,kind}' = 'lesson',
  'the lesson of 1.0.0 stays completed, its topic keeps its state, the review bank carries over, and a student who did the pilot diagnostic is sent to a lesson');
SELECT platform.learning_test_attempt_v1(:'c2_old_attempt')::TEXT AS c2_old_read \gset
SELECT pg_temp.c2_assert(
  :'c2_old_read'::JSONB ->> 'status' = 'completed'
    AND :'c2_old_read'::JSONB #>> '{result,itemsTotal}' = '3'
    AND jsonb_array_length(:'c2_old_read'::JSONB -> 'review') = 3,
  'the completed attempt of the pilot diagnostic stays readable with its review');
SELECT platform.learning_modules_v1()::TEXT AS c2_v1_modules \gset
SELECT pg_temp.c2_assert(:'c2_v1_modules' NOT LIKE '%csca%',
  'the released v1 module list never shows CSCA');

-- ===========================================================================
-- (vi) A new lesson, its practice, the diagnostic and the mock.
-- ===========================================================================
SELECT platform.learning_lesson_v2(:'c2_sets_lesson')::TEXT AS c2_lesson \gset
SELECT pg_temp.c2_assert(
  :'c2_lesson'::JSONB #>> '{module,version}' = '1.1.0'
    AND :'c2_lesson'::JSONB #>> '{topic,topicKey}' = 'm1-sets'
    AND jsonb_array_length(:'c2_lesson'::JSONB #> '{lesson,theory}') = :c2_sets_theory_length
    AND jsonb_array_length(:'c2_lesson'::JSONB #> '{lesson,exercises}') = 3
    AND :'c2_lesson'::JSONB #> '{figures}' ? 'sets-operations'
    AND (:'c2_lesson'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%answer_index%'
    AND (:'c2_lesson'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%Верно:%'
    AND (:'c2_lesson'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%solution%',
  'a lesson of part 2 is read with its typed blocks, its figure and 3 checks, without keys');
SELECT (SELECT jsonb_agg(exercise ->> 'exerciseId' ORDER BY (exercise ->> 'orderIndex')::INTEGER)
  FROM jsonb_array_elements(:'c2_lesson'::JSONB #> '{lesson,exercises}') exercise)::TEXT AS c2_exercises \gset
SELECT platform.start_learning_lesson_v1(:'c2_sets_lesson', pg_temp.c2_id(921)) ->> 'attemptId' AS c2_attempt \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 1, (:'c2_exercises'::JSONB ->> 0)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-sets-001'), pg_temp.c2_id(922)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 2, (:'c2_exercises'::JSONB ->> 1)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-sets-002'), pg_temp.c2_id(923)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 3, (:'c2_exercises'::JSONB ->> 2)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-sets-003'), pg_temp.c2_id(924)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_lesson_v1(:'c2_attempt', 4, pg_temp.c2_id(925)) ->> 'status' AS c2_lesson_status \gset
SELECT pg_temp.c2_assert(:'c2_lesson_status' = 'completed', 'the new lesson completes through the 198 RPC');

SELECT platform.learning_lesson_v2(:'c2_sets_practice')::TEXT AS c2_practice \gset
SELECT pg_temp.c2_assert(
  :'c2_practice'::JSONB #>> '{lesson,metadata,kind}' = 'practice'
    AND jsonb_array_length(:'c2_practice'::JSONB #> '{lesson,theory}') = 0
    AND jsonb_array_length(:'c2_practice'::JSONB #> '{lesson,exercises}') = 2,
  'the practice set of the new topic has no theory and its 2 practice items');

-- The diagnostic: 24 items, a 30 minute server deadline, finished early.
SELECT platform.start_learning_test_v1(:'c2_diagnostic', pg_temp.c2_id(931))::TEXT AS c2_diag \gset
SELECT pg_temp.c2_assert(
  :'c2_diag'::JSONB ->> 'status' = 'draft'
    AND :'c2_diag'::JSONB ->> 'itemsTotal' = '24'
    AND jsonb_array_length(:'c2_diag'::JSONB -> 'items') = 24
    AND (:'c2_diag'::JSONB ->> 'deadlineAt')::TIMESTAMPTZ - (:'c2_diag'::JSONB ->> 'startedAt')::TIMESTAMPTZ
      = INTERVAL '1800 seconds'
    AND :'c2_diag'::JSONB -> 'review' = 'null'::JSONB
    AND :'c2_diag'::TEXT NOT LIKE '%Верно:%' AND :'c2_diag'::TEXT NOT LIKE '%correctOptionId%'
    AND :'c2_diag'::TEXT NOT LIKE '%answer_index%' AND :'c2_diag'::TEXT NOT LIKE '%solution%',
  'the diagnostic starts with 24 items and a server deadline 30 minutes ahead, no key and no разбор');
SELECT :'c2_diag'::JSONB ->> 'attemptId' AS c2_diag_attempt \gset
SELECT platform.save_learning_test_v1(:'c2_diag_attempt', 1, :'c2_diagnostic_answers'::JSONB, '[]', '{}',
  pg_temp.c2_id(932)) ->> 'revision' AS c2_diag_revision \gset
SELECT platform.complete_learning_test_v1(:'c2_diag_attempt', :c2_diag_revision, pg_temp.c2_id(933))::TEXT AS c2_diag_done \gset
SELECT pg_temp.c2_assert(
  :'c2_diag_done'::JSONB ->> 'status' = 'completed'
    AND :'c2_diag_done'::JSONB ->> 'completion' = 'submitted'
    AND :'c2_diag_done'::JSONB #>> '{result,itemsTotal}' = '24'
    AND :'c2_diag_done'::JSONB #>> '{result,answeredCount}' = '24'
    AND :'c2_diag_done'::JSONB #>> '{result,correctCount}' = '23'
    AND jsonb_array_length(:'c2_diag_done'::JSONB -> 'review') = 24,
  'the diagnostic finishes early, is graded on the server (23 of 24) and opens the review of 24 items');

-- The mock: 48 items, an hour, no early finish.
SELECT platform.start_learning_test_v1(:'c2_mock', pg_temp.c2_id(941))::TEXT AS c2_mock_start \gset
SELECT pg_temp.c2_assert(
  :'c2_mock_start'::JSONB ->> 'itemsTotal' = '48'
    AND jsonb_array_length(:'c2_mock_start'::JSONB -> 'items') = 48
    AND (:'c2_mock_start'::JSONB ->> 'deadlineAt')::TIMESTAMPTZ - (:'c2_mock_start'::JSONB ->> 'startedAt')::TIMESTAMPTZ
      = INTERVAL '3600 seconds'
    AND :'c2_mock_start'::TEXT NOT LIKE '%Верно:%' AND :'c2_mock_start'::TEXT NOT LIKE '%correctOptionId%'
    AND :'c2_mock_start'::TEXT NOT LIKE '%answer_index%' AND :'c2_mock_start'::TEXT NOT LIKE '%solution%',
  'the mock starts with 48 items and a server deadline one hour ahead, no key and no разбор');
SELECT :'c2_mock_start'::JSONB ->> 'attemptId' AS c2_mock_attempt \gset
SELECT pg_temp.c2_assert(
  pg_temp.c2_failure(format('SELECT platform.complete_learning_test_v1(%L, 1, %L)',
    :'c2_mock_attempt', pg_temp.c2_id(942))) = '22023:learning_test_early_finish_forbidden',
  'the 48 item mock cannot be finished before the deadline');
SELECT platform.save_learning_test_v1(:'c2_mock_attempt', 1, :'c2_mock_answers'::JSONB, '[]', '{}',
  pg_temp.c2_id(943)) ->> 'answeredCount' AS c2_mock_answered \gset
SELECT pg_temp.c2_assert(:'c2_mock_answered' = '48', 'a save takes all 48 answers at once');
RESET ROLE;
SELECT pg_temp.c2_age_attempt(:'c2_mock_attempt', 3620);
SET request.jwt.claims TO :'c2_student';
SET ROLE authenticated;
SELECT platform.learning_test_attempt_v1(:'c2_mock_attempt')::TEXT AS c2_mock_read \gset
SELECT pg_temp.c2_assert(
  :'c2_mock_read'::JSONB ->> 'status' = 'completed'
    AND :'c2_mock_read'::JSONB ->> 'completion' = 'timeout'
    AND :'c2_mock_read'::JSONB #>> '{result,itemsTotal}' = '48'
    AND :'c2_mock_read'::JSONB #>> '{result,answeredCount}' = '48'
    AND :'c2_mock_read'::JSONB #>> '{result,correctCount}' = '48'
    AND jsonb_array_length(:'c2_mock_read'::JSONB -> 'review') = 48,
  'after the hour the server finishes the mock (completion = timeout): 48 of 48 graded, review of 48 items');
RESET ROLE;
SELECT pg_temp.c2_assert(
  (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.c2_id(304) AND source = 'mock') = 48
    AND (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.c2_id(304) AND source = 'diagnostic') = 26
    AND (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.c2_id(304) AND source = 'lesson') = 7
    AND (SELECT count(*) FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.c2_id(304)
      AND retired_at IS NULL) = 3,
  'the answer log holds 48 mock, 24 + 2 diagnostic and 4 + 3 lesson answers (old and new), and the review bank 3 wrong items');

-- ===========================================================================
-- (vii) Privacy.
-- ===========================================================================
SELECT pg_temp.c2_assert(
  NOT has_table_privilege('authenticated', 'platform_private.learning_items', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'platform_private.learning_lessons', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'platform_private.learning_test_forms', 'SELECT')
    AND NOT has_table_privilege('anon', 'platform_private.learning_items', 'SELECT'),
  'the content tables have no grants: answer keys stay behind the RPC surface');
SET request.jwt.claims TO :'c2_sales';
SET ROLE authenticated;
SELECT pg_temp.c2_assert(
  pg_temp.c2_error('SELECT platform.learning_track_home_v1(''csca-math'')') = '42501',
  'Sales is refused the CSCA home');
RESET ROLE;
SET request.jwt.claims TO :'c2_curator';
SET ROLE authenticated;
SELECT pg_temp.c2_assert(
  pg_temp.c2_error('SELECT platform.learning_track_home_v1(''csca-math'')') = '42501'
    AND pg_temp.c2_error(format('SELECT platform.start_learning_test_v1(%L, %L)', :'c2_mock', pg_temp.c2_id(951))) = '42501',
  'Curator is refused the CSCA home and cannot start a test');
RESET ROLE;

SELECT 'CSCA_MATH_PART2_SUITE_PASSED' AS c2_suite_marker;
ROLLBACK;
