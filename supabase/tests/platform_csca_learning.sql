\set ON_ERROR_STOP on

-- Current-boundary acceptance for migrations 285 («Подготовка к CSCA: движок»)
-- and 286 (математика, часть 1). Runs after both, against the full schema.
-- Fixtures are synthetic actors with hook-generated live claims (the p198
-- convention); the CSCA content is the REAL generated content of 286. Time
-- passing is simulated by moving an attempt's start and deadline back in
-- replica mode, as the SQL owner. Every row rolls back.
--
-- Claims proven here:
--   (i)    learning_modules_v1 and the English course are unchanged: when the
--          pre-285 snapshot exists (scripts/test-csca-learning-postgres.sh),
--          the v1 RPCs return byte-identical JSON; always: v1 equals the
--          original 198 query restricted to English and never lists CSCA,
--          and the English write path keeps its exact 198 key sets;
--   (ii)   CSCA content validators reject malformed modules, topics, figures
--          (SVG profile, palette, sha256), items, lessons, exercises, forms
--          and sessions (22023 or CHECK 23514); content is immutable (55000);
--   (iii)  the lesson read projects items without keys or разборы; an item
--          answer through the 198 write path is graded on the server, its
--          receipt replays, it is final, it lands in the answer log and a
--          wrong answer lands in the review bank;
--   (iv)   timed tests: the server sets start and deadline, answers can be
--          changed until deadline + 15 s, a stale revision is 40001, the
--          review (keys and разборы) is hidden until completion, the mock has
--          no early finish, the diagnostic has, completion is idempotent, a
--          late save is refused, an expired draft is finished by the server on
--          the first read (completion = timeout), receipts replay (a save
--          replay with a fresh serverNow), a start on a form whose draft
--          expired returns that finished attempt, «Ошибки» finish expired
--          tests first;
--   (v)    spaced review: due items only, boxes 1..4 with 1/3/7/14 days,
--          retirement after box 4, receipts replay;
--   (vi)   progress, «Сообщить об ошибке» (Admin sees the text, never the
--          author), the target session (an ended session is refused);
--   (vii)  privacy: Admin, Sales, Curator, another Student of the same
--          organization, a Student of another organization, anon and
--          service_role are refused (42501), also with invalid arguments;
--          no table grants; no audit rows;
--   (viii) account deletion (280) erases every new state table of a simple
--          account automatically.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p285_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28500000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p285_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 285 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p285_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE FUNCTION pg_temp.p285_failure(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p285_id(INTEGER),
  pg_temp.p285_assert(BOOLEAN, TEXT),
  pg_temp.p285_error(TEXT),
  pg_temp.p285_failure(TEXT)
  TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.p285_safe_items(p_items JSONB, p_prefix_keys TEXT[]) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE AS $$
  -- Every projected item carries exactly the safe keys (figureKey only when
  -- the item has a figure) and options carry only {id, label}.
  SELECT jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) item
      WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item) key) <> (SELECT array_agg(key ORDER BY key)
          FROM unnest(p_prefix_keys || ARRAY['difficulty', 'estSeconds', 'itemKey', 'options', 'stemEn', 'syllabusPoint',
            'topicKey'] || CASE WHEN item ? 'figureKey' THEN ARRAY['figureKey'] ELSE '{}'::TEXT[] END) key)
        OR jsonb_array_length(item -> 'options') <> 4
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(item -> 'options') option
          WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(option) key) <> ARRAY['id', 'label']))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p285_safe_items(JSONB, TEXT[]) TO authenticated;

-- Owner-only helpers: simulate elapsed time and due dates.
CREATE FUNCTION pg_temp.p285_age_attempt(p_attempt UUID, p_seconds INTEGER) RETURNS VOID
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

CREATE FUNCTION pg_temp.p285_make_due(p_membership UUID, p_item_key TEXT, p_box INTEGER) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE platform.learning_item_reviews
    SET due_on = (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, box = p_box
    WHERE student_membership_id = p_membership AND item_key = p_item_key;
  SET LOCAL session_replication_role = origin;
END
$$;

SELECT 'P285_CSCA_LEARNING_SUITE_START' AS p285_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization A with admin/sales/curator staff and two caseless
-- Students (the guard is the 198 catalogue guard, case-independent);
-- organization B owns a third, foreign Student.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES
  (pg_temp.p285_id(1), 'Migration 285 synthetic organization A'),
  (pg_temp.p285_id(2), 'Migration 285 synthetic organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT pg_temp.p285_id(100 + n), 'p285-actor-' || n || '@example.invalid', '{}'::JSONB
FROM generate_series(1, 6) AS n;

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
SELECT pg_temp.p285_id(200 + n), pg_temp.p285_id(100 + n), 'P285 Actor ' || n, 'active', 1
FROM generate_series(1, 6) AS n;

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p285_id(300 + actor.n), pg_temp.p285_id(CASE WHEN actor.n = 6 THEN 2 ELSE 1 END),
  pg_temp.p285_id(200 + actor.n), 'active', actor.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1),
  actor.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student'), (5, 'student'), (6, 'student'))
  AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p285_id(11), pg_temp.p285_id(1), 'organization', pg_temp.p285_id(1), 1),
  (pg_temp.p285_id(12), pg_temp.p285_id(2), 'organization', pg_temp.p285_id(2), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p285_id(CASE WHEN n = 6 THEN 2 ELSE 1 END), pg_temp.p285_id(300 + n),
  pg_temp.p285_id(CASE WHEN n = 6 THEN 12 ELSE 11 END), 1, 1, TRUE, 'system',
  'P285 synthetic organization scope', pg_temp.p285_id(600 + n)
FROM generate_series(1, 6) AS n;

-- Content handles of 286 (read as the owner; Students cannot read tables).
SELECT
  (SELECT id FROM platform_private.learning_modules WHERE module_key = 'csca-math' AND version = '1.0.0') AS p285_module,
  (SELECT id FROM platform_private.learning_lessons WHERE lesson_key = 'csca-math-m2-exp-log-l1') AS p285_lesson,
  (SELECT id FROM platform_private.learning_lessons WHERE lesson_key = 'csca-math-m2-exp-log-p1') AS p285_practice,
  (SELECT id FROM platform_private.learning_test_forms WHERE form_key = 'csca-math-diagnostic-1') AS p285_diagnostic,
  (SELECT id FROM platform_private.learning_test_forms WHERE form_key = 'csca-math-mock-1') AS p285_mock,
  (SELECT lesson.id FROM platform_private.learning_lessons lesson
    JOIN platform_private.learning_modules module ON module.id = lesson.module_id
    WHERE module.module_key = 'en-m1-start' ORDER BY lesson.order_index LIMIT 1) AS p285_english_lesson,
  (SELECT exercise.id FROM platform_private.learning_exercises exercise
    JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
    JOIN platform_private.learning_modules module ON module.id = lesson.module_id
    WHERE module.module_key = 'en-m1-start' AND exercise.exercise_type = 'choice'
    ORDER BY lesson.order_index, exercise.order_index LIMIT 1) AS p285_english_choice,
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE AS p285_today
\gset

-- Correct options of the items the suite answers, from the real content.
SELECT jsonb_object_agg(item.item_key, item.body -> 'options' -> (item.body ->> 'answer_index')::INTEGER ->> 'id')::TEXT
  AS p285_keys
FROM platform_private.learning_items item WHERE item.module_id = :'p285_module'
\gset

-- Live JWT claims via the CURRENT production hook, never hand-built.
SELECT
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(101),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_admin,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(102),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(102), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_sales,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(103),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(103), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_curator,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(104),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_student_a,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(105),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(105), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_student_b,
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p285_id(106),
    'claims', jsonb_build_object('sub', pg_temp.p285_id(106), 'role', 'authenticated'))) -> 'claims')::TEXT AS p285_student_c
\gset

-- ===========================================================================
-- (i) v1 unchanged.
-- ===========================================================================
SELECT to_regclass('csca_proof.v1_snapshot') IS NOT NULL AS p285_has_snapshot \gset
\if :p285_has_snapshot
SELECT
  (platform_private.custom_access_token_hook(jsonb_build_object('user_id', '28500000-0000-4000-8000-000000000101'::UUID,
    'claims', jsonb_build_object('sub', '28500000-0000-4000-8000-000000000101', 'role', 'authenticated'))) -> 'claims')::TEXT
    AS p285_snapshot_student,
  (SELECT lesson.id FROM platform_private.learning_lessons lesson
    JOIN platform_private.learning_modules module ON module.id = lesson.module_id
    WHERE module.module_key = 'en-m1-start' ORDER BY lesson.order_index LIMIT 1) AS p285_snapshot_real_lesson
\gset
CREATE TEMP TABLE p285_v1_after (name TEXT PRIMARY KEY, payload JSONB NOT NULL);
GRANT ALL ON p285_v1_after TO authenticated;
SET request.jwt.claims TO :'p285_snapshot_student';
SET ROLE authenticated;
INSERT INTO p285_v1_after VALUES
  ('learning_modules_v1', platform.learning_modules_v1()),
  ('learning_lesson_v1:completed', platform.learning_lesson_v1('28500000-0000-4000-8000-000000000811')),
  ('learning_lesson_v1:draft', platform.learning_lesson_v1('28500000-0000-4000-8000-000000000812')),
  ('learning_lesson_v1:en-m1-start', platform.learning_lesson_v1(:'p285_snapshot_real_lesson')),
  ('learning_review_v1', platform.learning_review_v1('28500000-0000-4000-8000-000000000801')),
  ('learning_review_check_v1', platform.learning_review_check_v1('28500000-0000-4000-8000-000000000821',
    '{"selected":"a"}'));
RESET ROLE;
SELECT pg_temp.p285_assert(
  (SELECT count(*) FROM csca_proof.v1_snapshot before
    JOIN p285_v1_after after ON after.name = before.name AND after.payload = before.payload) = 6,
  'v1 learning RPCs must return byte-identical JSON before and after 285/286: '
    || COALESCE((SELECT string_agg(before.name, ', ') FROM csca_proof.v1_snapshot before
      JOIN p285_v1_after after ON after.name = before.name WHERE after.payload <> before.payload), '')
);
SELECT 'P285_V1_SNAPSHOT_MATCHED' AS p285_suite_marker;
\endif

SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.learning_modules_v1()::TEXT AS p285_v1_map \gset
RESET ROLE;
-- v1 equals the original 198 query restricted to English, for the same actor.
SELECT jsonb_build_object('modules', COALESCE(jsonb_agg(jsonb_build_object(
    'moduleId', module.id, 'moduleKey', module.module_key, 'version', module.version,
    'metadata', module.metadata,
    'lessonsTotal', (SELECT count(*) FROM platform_private.learning_lessons lesson WHERE lesson.module_id = module.id),
    'lessonsCompleted', 0,
    'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'lessonId', lesson.id, 'lessonKey', lesson.lesson_key, 'orderIndex', lesson.order_index,
        'metadata', lesson.metadata,
        'exercisesTotal', (SELECT count(*) FROM platform_private.learning_exercises exercise
          WHERE exercise.lesson_id = lesson.id),
        'completed', FALSE, 'draftAttemptId', NULL, 'lastResult', NULL) ORDER BY lesson.order_index)
      FROM platform_private.learning_lessons lesson WHERE lesson.module_id = module.id), '[]'::JSONB))
    ORDER BY module.module_key), '[]'::JSONB))::TEXT AS p285_v1_expected
FROM (SELECT DISTINCT ON (module_key) * FROM platform_private.learning_modules
  WHERE track = 'english' ORDER BY module_key, published_at DESC, id DESC) module
\gset
SELECT pg_temp.p285_assert(:'p285_v1_map'::JSONB = :'p285_v1_expected'::JSONB,
  'learning_modules_v1 must equal the original 198 projection of the English modules');
SELECT pg_temp.p285_assert(
  :'p285_v1_map'::TEXT NOT LIKE '%csca%'
    AND (SELECT count(*) FROM platform_private.learning_modules WHERE track = 'csca-math') = 1
    AND (SELECT count(*) FROM platform_private.learning_modules WHERE track = 'english') >= 1,
  'learning_modules_v1 must not list the CSCA module that 286 published');
SELECT pg_temp.p285_assert(
  (SELECT bool_and(track = 'english') FROM platform_private.learning_modules WHERE module_key LIKE 'en-%'),
  'existing English modules keep the default track');

-- English write path keeps its exact 198 key sets.
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.start_learning_lesson_v1(:'p285_english_lesson', pg_temp.p285_id(901))::TEXT AS p285_en_start \gset
SELECT platform.save_learning_answer_v1((:'p285_en_start'::JSONB ->> 'attemptId')::UUID, 1, :'p285_english_choice',
  '{"selected":"a"}', pg_temp.p285_id(902))::TEXT AS p285_en_save \gset
SELECT platform.learning_lesson_v1(:'p285_english_lesson')::TEXT AS p285_en_lesson \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_en_start'::JSONB) key)
    = ARRAY['answeredCount', 'answers', 'attemptId', 'completedAt', 'createdAt', 'exercisesTotal', 'lessonId',
      'result', 'revision', 'status', 'updatedAt']
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_en_save'::JSONB) key)
    = ARRAY['answeredCount', 'attemptId', 'correct', 'exerciseId', 'exercisesTotal', 'explain', 'revision', 'verdict']
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_en_lesson'::JSONB) key)
    = ARRAY['draft', 'latestCompleted', 'lesson', 'module']
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_en_lesson'::JSONB -> 'module') key)
    = ARRAY['metadata', 'moduleId', 'moduleKey', 'version'],
  'English v1 start/save/lesson keep the 198 key sets (no track field leaks into v1)');
SELECT pg_temp.p285_assert(
  NOT EXISTS (SELECT 1 FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)),
  'an English answer writes nothing to the CSCA answer log');

-- ===========================================================================
-- (ii) Content validators and immutability.
-- ===========================================================================
SELECT pg_temp.p285_assert(pg_temp.p285_error($sql$
  INSERT INTO platform_private.learning_modules (module_key, version, track, metadata)
  VALUES ('csca-math', 'p285-bad', 'csca-math', jsonb_build_object('title_ru', 'x', 'title_ky', 'x',
    'level_note_ru', 'x', 'level_note_ky', 'x'))
$sql$) = '22023', 'a CSCA module without the syllabus outline must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error($sql$
  INSERT INTO platform_private.learning_modules (module_key, version, track, metadata)
  VALUES ('csca-math', 'p285-bad', 'csca-history', '{}'::JSONB)
$sql$) = '22023', 'an unknown track must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_topics (module_id, topic_key, order_index, metadata)
  SELECT %L, 'p285-topic', 199, metadata || '{"section": 9}'::JSONB FROM platform_private.learning_topics
  WHERE topic_key = 'm1-sets'
$sql$, :'p285_module')) = '22023', 'a topic outside the syllabus outline must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_topics (module_id, topic_key, order_index, metadata)
  SELECT %L, 'p285-topic', 199, metadata || '{"prerequisites": ["p285-missing"]}'::JSONB
  FROM platform_private.learning_topics WHERE topic_key = 'm1-sets'
$sql$, :'p285_module')) = '22023', 'a topic prerequisite must be an earlier topic');

-- Figures: the SVG profile, the palette and the content hash.
CREATE FUNCTION pg_temp.p285_figure_error(p_module UUID, p_svg TEXT, p_hash TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform_private.learning_figures (module_id, figure_key, svg, view_box, alt_ru, alt_ky, alt_en, sha256)
  VALUES (p_module, 'p285-figure', p_svg, '0 0 400 300', 'alt', 'alt', 'alt',
    COALESCE(p_hash, encode(sha256(convert_to(p_svg, 'UTF8')), 'hex')));
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#ffffff"/></svg>')
  = 'ok', 'a profile-conforming figure must be accepted');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><script>alert(1)</script></svg>') = '22023',
  'a figure with a script must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="4" height="3" fill="#00ff00"/></svg>')
  = '22023', 'a colour outside the six-colour palette must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="4" height="3" onload="x()"/></svg>')
  = '22023', 'an event-handler attribute must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><image width="4" height="3"/></svg>')
  = '22023', 'an image element must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="4" height="3" style="fill:red"/></svg>')
  = '22023', 'a style attribute must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_figure_error(:'p285_module',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="4" height="3"/></svg>', repeat('0', 64))
  = '22023', 'a figure whose sha256 does not match must be rejected');

-- Items: exactly 4 options a..d, a known topic, a valid figure, provenance.
CREATE FUNCTION pg_temp.p285_item_error(p_module UUID, p_patch JSONB, p_pool TEXT DEFAULT 'practice',
  p_provenance TEXT DEFAULT 'evo_authored') RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform_private.learning_items (module_id, item_key, topic_key, syllabus_point, difficulty, pool,
    provenance, body)
  SELECT p_module, 'csca-math-p285-' || substr(md5(p_patch::TEXT || p_pool || p_provenance), 1, 8), topic_key,
    syllabus_point, difficulty, p_pool, p_provenance, body || p_patch
  FROM platform_private.learning_items WHERE item_key = 'csca-math-exp-log-001' AND module_id = p_module;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{}'::JSONB) = 'ok',
  'a well-formed item must be accepted');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module',
  jsonb_build_object('options', (SELECT (body -> 'options') - 3 FROM platform_private.learning_items
    WHERE item_key = 'csca-math-exp-log-001'))) = '22023', 'an item with 3 options must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{"answer_index": 4}'::JSONB) = '22023',
  'an answer index outside 0..3 must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module',
  jsonb_build_object('options', (SELECT jsonb_set(body -> 'options', '{0,explain_ky}', '" "')
    FROM platform_private.learning_items WHERE item_key = 'csca-math-exp-log-001'))) = '22023',
  'an option without a KY разбор must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{"figure_key": "p285-missing"}'::JSONB) = '22023',
  'an item referencing a missing figure must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{"solution_ky": []}'::JSONB) = '22023',
  'RU and KY solutions must have the same number of steps');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{}'::JSONB, 'practice', 'csc_official') = '23514',
  'only evo_authored items are allowed');
SELECT pg_temp.p285_assert(pg_temp.p285_item_error(:'p285_module', '{"smuggled": 1}'::JSONB) = '22023',
  'an item with an unknown key must be rejected');

-- Lessons and exercises: typed blocks, item exercises only in CSCA lessons.
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_lessons (module_id, lesson_key, order_index, metadata, theory)
  SELECT %L, 'p285-bad-lesson', 199, metadata, theory || '[{"kind": "video", "url": "https://example.invalid"}]'::JSONB
  FROM platform_private.learning_lessons WHERE lesson_key = 'csca-math-m2-exp-log-l1'
$sql$, :'p285_module')) = '22023', 'an unknown theory block kind must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_lessons (module_id, lesson_key, order_index, metadata, theory)
  SELECT %L, 'p285-bad-lesson', 199, metadata, '[]'::JSONB
  FROM platform_private.learning_lessons WHERE lesson_key = 'csca-math-m2-exp-log-l1'
$sql$, :'p285_module')) = '22023', 'a lesson (not a practice) needs at least one block');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
  VALUES (%L, 'csca-math-exp-log-001', 99, 'item', '{"item_key": "csca-math-exp-log-001"}')
$sql$, :'p285_english_lesson')) = '22023', 'an item exercise must not enter an English lesson');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
  SELECT %L, 'p285-choice', 99, 'choice', body FROM platform_private.learning_exercises
  WHERE exercise_type = 'choice' LIMIT 1
$sql$, :'p285_lesson')) = '22023', 'a choice exercise must not enter a CSCA lesson');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
  VALUES (%L, 'csca-math-exp-log-004', 99, 'item', '{"item_key": "csca-math-exp-log-004"}')
$sql$, :'p285_lesson')) = '22023', 'a practice-pool item must not enter a lesson check');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_exercises (lesson_id, exercise_key, order_index, exercise_type, body)
  VALUES (%L, 'csca-math-exp-log-007', 99, 'item', '{"item_key": "csca-math-exp-log-007"}')
$sql$, :'p285_practice')) = '22023', 'a diagnostic item must not enter a practice set');

-- Forms: the mock has no early finish; items of the form's own pool.
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_test_forms (module_id, form_key, kind, metadata, duration_seconds,
    allow_early_finish, item_keys)
  SELECT %L, 'p285-mock', 'mock', metadata, 450, TRUE, item_keys FROM platform_private.learning_test_forms
  WHERE form_key = 'csca-math-mock-1'
$sql$, :'p285_module')) = '23514', 'a mock form with an early finish must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format($sql$
  INSERT INTO platform_private.learning_test_forms (module_id, form_key, kind, metadata, duration_seconds,
    allow_early_finish, item_keys)
  SELECT %L, 'p285-mock', 'mock', metadata, 450, FALSE, '["csca-math-exp-log-001"]'::JSONB
  FROM platform_private.learning_test_forms WHERE form_key = 'csca-math-mock-1'
$sql$, :'p285_module')) = '22023', 'a mock form with a lesson-pool item must be rejected');
SELECT pg_temp.p285_assert(pg_temp.p285_error($sql$
  INSERT INTO platform_private.csca_exam_sessions (session_key, exam_from, exam_to, source_url, verified_on)
  VALUES ('2027-02', '2027-03-13', '2027-03-14', 'https://csca.cn', '2026-10-16')
$sql$) = '22023', 'a session key must name the exam month');
SELECT pg_temp.p285_assert(pg_temp.p285_error($sql$
  INSERT INTO platform_private.csca_exam_sessions (session_key, exam_from, exam_to, source_url, verified_on)
  VALUES ('2027-03', '2027-03-13', '2027-03-14', 'https://example.invalid', '2026-10-16')
$sql$) = '23514', 'a session source must be csca.cn');

SELECT pg_temp.p285_assert(pg_temp.p285_error('UPDATE platform_private.learning_items SET pool = pool') = '55000',
  'published items are immutable');
SELECT pg_temp.p285_assert(pg_temp.p285_error('DELETE FROM platform_private.learning_figures') = '55000',
  'published figures are immutable');
SELECT pg_temp.p285_assert(pg_temp.p285_error('UPDATE platform_private.csca_exam_sessions SET verified_on = verified_on')
  = '55000', 'published exam sessions are immutable');
SELECT pg_temp.p285_assert(pg_temp.p285_error('TRUNCATE platform_private.learning_test_forms CASCADE') = '55000',
  'published forms must not be truncated');
SELECT pg_temp.p285_assert(pg_temp.p285_error('UPDATE platform_private.learning_modules SET track = track') = '55000',
  'published modules stay immutable after the track column');

-- ===========================================================================
-- (iii) Home, lesson read, item answers through the 198 write path.
-- ===========================================================================
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT pg_temp.p285_assert(pg_temp.p285_error('SELECT platform.learning_track_home_v1(''english'')') = '22023'
  AND pg_temp.p285_error('SELECT platform.learning_track_home_v1(''csca-history'')') = '22023',
  'the CSCA home accepts only CSCA tracks');
SELECT platform.learning_track_home_v1('csca-math')::TEXT AS p285_home \gset
SELECT pg_temp.p285_assert(
  jsonb_array_length(:'p285_home'::JSONB -> 'modules') = 1
    AND jsonb_array_length(:'p285_home'::JSONB -> 'topics') = 28
    AND jsonb_array_length(:'p285_home'::JSONB -> 'lessons') = 6
    AND jsonb_array_length(:'p285_home'::JSONB -> 'tests') = 2
    AND (SELECT bool_and(topic ->> 'state' = 'not_started') FROM jsonb_array_elements(:'p285_home'::JSONB -> 'topics') topic)
    AND :'p285_home'::JSONB #>> '{nextStep,kind}' = 'test'
    AND :'p285_home'::JSONB #>> '{nextStep,formId}' = :'p285_diagnostic'
    AND :'p285_home'::JSONB #>> '{review,dueCount}' = '0'
    AND :'p285_home'::JSONB -> 'targetSessionKey' = 'null'::JSONB
    AND :'p285_home'::JSONB #>> '{tests,0,kind}' = 'diagnostic'
    AND :'p285_home'::JSONB #>> '{tests,1,allowEarlyFinish}' = 'false',
  'a new Student sees the outline, 28 topics not started, 6 lessons, 2 tests and the diagnostic as next step');
SELECT pg_temp.p285_assert(
  jsonb_array_length(:'p285_home'::JSONB -> 'sessions')
    = (SELECT count(*) FROM (VALUES ('2026-11-15'::DATE), ('2026-12-20'), ('2027-01-24'), ('2027-03-14'),
      ('2027-04-25'), ('2027-06-27')) AS session(exam_to) WHERE session.exam_to >= :'p285_today'::DATE),
  'the calendar lists the published sessions that have not ended (Bishkek date)');

SELECT platform.learning_lesson_v2(:'p285_lesson')::TEXT AS p285_lesson_payload \gset
SELECT pg_temp.p285_assert(
  :'p285_lesson_payload'::JSONB #>> '{module,track}' = 'csca-math'
    AND :'p285_lesson_payload'::JSONB #>> '{topic,topicKey}' = 'm2-exp-log'
    AND jsonb_array_length(:'p285_lesson_payload'::JSONB #> '{lesson,theory}') = 11
    AND jsonb_array_length(:'p285_lesson_payload'::JSONB #> '{lesson,exercises}') = 4
    AND :'p285_lesson_payload'::JSONB #>> '{lesson,exercises,0,type}' = 'item'
    AND :'p285_lesson_payload'::JSONB #>> '{lesson,exercises,0,itemKey}' = 'csca-math-exp-log-001'
    AND jsonb_array_length(:'p285_lesson_payload'::JSONB #> '{lesson,exercises,0,options}') = 4
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_lesson_payload'::JSONB -> 'figures') key)
      = ARRAY['exp-base', 'exp-log-mirror']
    AND :'p285_lesson_payload'::JSONB #>> '{figures,exp-base,svg}' LIKE '<svg %',
  'the lesson read carries typed blocks, 4 item exercises and only its own figures');
SELECT pg_temp.p285_assert(
  (:'p285_lesson_payload'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%answer_index%'
    AND (:'p285_lesson_payload'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%Верно:%'
    AND (:'p285_lesson_payload'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%correctOptionId%'
    AND (:'p285_lesson_payload'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%solution%'
    AND (:'p285_lesson_payload'::JSONB -> 'lesson' -> 'exercises')::TEXT NOT LIKE '%explain%',
  'the item projection carries no key, no разбор and no solution before an answer');
SELECT pg_temp.p285_assert(
  pg_temp.p285_safe_items(:'p285_lesson_payload'::JSONB #> '{lesson,exercises}',
    ARRAY['exerciseId', 'exerciseKey', 'orderIndex', 'type']),
  'lesson item exercises carry exactly the safe projection keys');

SELECT
  (SELECT jsonb_agg(exercise ->> 'exerciseId' ORDER BY (exercise ->> 'orderIndex')::INTEGER)
    FROM jsonb_array_elements(:'p285_lesson_payload'::JSONB #> '{lesson,exercises}') exercise)::TEXT AS p285_exercises
\gset
SELECT platform.start_learning_lesson_v1(:'p285_lesson', pg_temp.p285_id(911)) ->> 'attemptId' AS p285_attempt \gset
-- csca-math-exp-log-001: correct is b; answer a (wrong).
SELECT platform.save_learning_answer_v1(:'p285_attempt', 1, (:'p285_exercises'::JSONB ->> 0)::UUID,
  '{"selected":"a"}', pg_temp.p285_id(912))::TEXT AS p285_item_save \gset
SELECT pg_temp.p285_assert(
  :'p285_item_save'::JSONB ->> 'correct' = 'false'
    AND :'p285_item_save'::JSONB #>> '{explain,correctOptionId}' = (:'p285_keys'::JSONB ->> 'csca-math-exp-log-001')
    AND jsonb_array_length(:'p285_item_save'::JSONB #> '{explain,options}') = 4
    AND jsonb_array_length(:'p285_item_save'::JSONB #> '{explain,solutionRu}') >= 1
    AND jsonb_array_length(:'p285_item_save'::JSONB #> '{explain,solutionKy}')
      = jsonb_array_length(:'p285_item_save'::JSONB #> '{explain,solutionRu}'),
  'an item answer is graded on the server and returns the full разбор of the answered item only');
SELECT pg_temp.p285_assert(
  platform.save_learning_answer_v1(:'p285_attempt', 1, (:'p285_exercises'::JSONB ->> 0)::UUID,
    '{"selected":"a"}', pg_temp.p285_id(912))::TEXT = :'p285_item_save',
  'the item answer receipt replays');
SELECT pg_temp.p285_assert(
  pg_temp.p285_error(format('SELECT platform.save_learning_answer_v1(%L, 2, %L, ''{"selected":"b"}'', %L)',
    :'p285_attempt', :'p285_exercises'::JSONB ->> 0, pg_temp.p285_id(913))) = '22023'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_answer_v1(%L, 2, %L, ''{"selected":"e"}'', %L)',
    :'p285_attempt', :'p285_exercises'::JSONB ->> 1, pg_temp.p285_id(914))) = '22023'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_answer_v1(%L, 2, %L, ''{"text":"b"}'', %L)',
    :'p285_attempt', :'p285_exercises'::JSONB ->> 1, pg_temp.p285_id(915))) = '22023',
  'an answered item is final; an unknown option or a foreign answer shape is 22023');
SELECT platform.save_learning_answer_v1(:'p285_attempt', 2, (:'p285_exercises'::JSONB ->> 1)::UUID,
  jsonb_build_object('selected', :'p285_keys'::JSONB ->> 'csca-math-exp-log-002'), pg_temp.p285_id(916)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'p285_attempt', 3, (:'p285_exercises'::JSONB ->> 2)::UUID,
  jsonb_build_object('selected', :'p285_keys'::JSONB ->> 'csca-math-exp-log-003'), pg_temp.p285_id(917)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'p285_attempt', 4, (:'p285_exercises'::JSONB ->> 3)::UUID,
  jsonb_build_object('selected', :'p285_keys'::JSONB ->> 'csca-math-exp-log-005'), pg_temp.p285_id(918)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_lesson_v1(:'p285_attempt', 5, pg_temp.p285_id(919)) ->> 'status' AS p285_lesson_status \gset
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_lesson_status' = 'completed', 'the CSCA lesson completes through the 198 RPC');
SELECT pg_temp.p285_assert(
  (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)
    AND source = 'lesson') = 4
  AND (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)
    AND source = 'lesson' AND NOT correct AND item_key = 'csca-math-exp-log-001') = 1
  AND (SELECT box = 1 AND due_on = :'p285_today'::DATE + 1 AND lapses = 0 FROM platform.learning_item_reviews
    WHERE student_membership_id = pg_temp.p285_id(304) AND item_key = 'csca-math-exp-log-001')
  AND (SELECT count(*) FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.p285_id(304)) = 1,
  'lesson answers enter the answer log once each; the wrong one enters the review bank, box 1, due tomorrow');

SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.learning_track_home_v1('csca-math')::TEXT AS p285_home \gset
SELECT pg_temp.p285_assert(
  (SELECT topic ->> 'state' FROM jsonb_array_elements(:'p285_home'::JSONB -> 'topics') topic
    WHERE topic ->> 'topicKey' = 'm2-exp-log') = 'shaky'
  AND (SELECT (lesson ->> 'completed')::BOOLEAN FROM jsonb_array_elements(:'p285_home'::JSONB -> 'lessons') lesson
    WHERE lesson ->> 'lessonKey' = 'csca-math-m2-exp-log-l1')
  AND :'p285_home'::JSONB #>> '{review,activeCount}' = '1'
  AND :'p285_home'::JSONB #>> '{review,dueCount}' = '0'
  AND :'p285_home'::JSONB #>> '{review,nextDueOn}' = (:'p285_today'::DATE + 1)::TEXT,
  '3 of 4 correct makes the topic «Шатко»; the lesson is completed; one item is due tomorrow');

-- ===========================================================================
-- (iv) Timed tests.
-- ===========================================================================
SELECT platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(921))::TEXT AS p285_diag \gset
SELECT pg_temp.p285_assert(
  :'p285_diag'::JSONB ->> 'status' = 'draft'
    AND :'p285_diag'::JSONB ->> 'revision' = '1'
    AND :'p285_diag'::JSONB ->> 'itemsTotal' = '3'
    AND jsonb_array_length(:'p285_diag'::JSONB -> 'items') = 3
    AND (:'p285_diag'::JSONB ->> 'deadlineAt')::TIMESTAMPTZ - (:'p285_diag'::JSONB ->> 'startedAt')::TIMESTAMPTZ
      = INTERVAL '240 seconds'
    AND :'p285_diag'::JSONB ->> 'graceSeconds' = '15'
    AND :'p285_diag'::JSONB ? 'serverNow'
    AND :'p285_diag'::JSONB -> 'review' = 'null'::JSONB
    AND :'p285_diag'::JSONB -> 'result' = 'null'::JSONB
    AND :'p285_diag'::TEXT NOT LIKE '%Верно:%' AND :'p285_diag'::TEXT NOT LIKE '%correctOptionId%'
    AND :'p285_diag'::TEXT NOT LIKE '%answer_index%' AND :'p285_diag'::TEXT NOT LIKE '%solution%',
  'starting a test sets the server deadline and serves the items without keys or разборы');
SELECT pg_temp.p285_assert(pg_temp.p285_safe_items(:'p285_diag'::JSONB -> 'items', '{}'::TEXT[]),
  'test items carry exactly the safe projection keys');
SELECT :'p285_diag'::JSONB ->> 'attemptId' AS p285_diag_attempt \gset
SELECT pg_temp.p285_assert(
  platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(921)) ->> 'attemptId' = :'p285_diag_attempt'
    AND platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(922)) ->> 'attemptId' = :'p285_diag_attempt'
    AND platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(922)) ->> 'startedAt'
      = :'p285_diag'::JSONB ->> 'startedAt',
  'a start replay and a second start resume the same draft with the same server start');
SELECT pg_temp.p285_assert(pg_temp.p285_error(format(
  'SELECT platform.start_learning_test_v1(%L, %L)', :'p285_mock', pg_temp.p285_id(921))) = '22023',
  'a request id cannot be reused for another form');
SELECT pg_temp.p285_assert(
  platform.learning_test_attempt_v1(:'p285_diag_attempt') -> 'review' = 'null'::JSONB,
  'the attempt read hides the review until completion');

SELECT platform.save_learning_test_v1(:'p285_diag_attempt', 1,
  jsonb_build_object('csca-math-exp-log-007', 'a', 'csca-math-derivative-007',
    :'p285_keys'::JSONB ->> 'csca-math-derivative-007'),
  '["csca-math-line-circle-007"]', '{"csca-math-exp-log-007": 40, "csca-math-derivative-007": 70}',
  pg_temp.p285_id(923))::TEXT AS p285_diag_save \gset
SELECT pg_temp.p285_assert(
  :'p285_diag_save'::JSONB ->> 'revision' = '2' AND :'p285_diag_save'::JSONB ->> 'answeredCount' = '2'
    AND :'p285_diag_save'::TEXT NOT LIKE '%correct%',
  'a save replaces the draft state and reveals nothing about correctness');
SELECT pg_sleep(0.01);
SELECT platform.save_learning_test_v1(:'p285_diag_attempt', 1,
  jsonb_build_object('csca-math-exp-log-007', 'a', 'csca-math-derivative-007',
    :'p285_keys'::JSONB ->> 'csca-math-derivative-007'),
  '["csca-math-line-circle-007"]', '{"csca-math-exp-log-007": 40, "csca-math-derivative-007": 70}',
  pg_temp.p285_id(923))::TEXT AS p285_diag_save_replay \gset
SELECT pg_temp.p285_assert(
  (:'p285_diag_save_replay'::JSONB - 'serverNow') = (:'p285_diag_save'::JSONB - 'serverNow')
    AND (:'p285_diag_save_replay'::JSONB ->> 'serverNow')::TIMESTAMPTZ
      > (:'p285_diag_save'::JSONB ->> 'serverNow')::TIMESTAMPTZ
    AND (:'p285_diag_save_replay'::JSONB ->> 'serverNow')::TIMESTAMPTZ >= clock_timestamp() - INTERVAL '5 seconds',
  'the save receipt replays with a fresh serverNow, so a replay never winds a client clock back');
SELECT pg_temp.p285_assert(
  pg_temp.p285_error(format('SELECT platform.save_learning_test_v1(%L, 1, ''{}'', ''[]'', ''{}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(924))) = '40001'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_test_v1(%L, 2, ''{"csca-math-exp-log-007": "z"}'', ''[]'', ''{}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(925))) = '22023'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_test_v1(%L, 2, ''{"csca-math-exp-log-001": "a"}'', ''[]'', ''{}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(926))) = '22023'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_test_v1(%L, 2, ''{}'', ''["x", "x"]'', ''{}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(927))) = '22023'
  AND pg_temp.p285_error(format('SELECT platform.save_learning_test_v1(%L, 2, ''{}'', ''[]'', ''{"csca-math-exp-log-007": 4000}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(928))) = '22023',
  'a stale revision is 40001; an unknown option, a foreign item, a repeated flag or 4000 s are 22023');
-- The diagnostic may finish early.
SELECT platform.complete_learning_test_v1(:'p285_diag_attempt', 2, pg_temp.p285_id(929))::TEXT AS p285_diag_done \gset
SELECT pg_temp.p285_assert(
  :'p285_diag_done'::JSONB ->> 'status' = 'completed'
    AND :'p285_diag_done'::JSONB ->> 'completion' = 'submitted'
    AND :'p285_diag_done'::JSONB #>> '{result,itemsTotal}' = '3'
    AND :'p285_diag_done'::JSONB #>> '{result,answeredCount}' = '2'
    AND :'p285_diag_done'::JSONB #>> '{result,correctCount}'
      = (CASE WHEN :'p285_keys'::JSONB ->> 'csca-math-exp-log-007' = 'a' THEN 2 ELSE 1 END)::TEXT
    AND :'p285_diag_done'::JSONB #>> '{result,unansweredItemKeys,0}' = 'csca-math-line-circle-007'
    AND :'p285_diag_done'::JSONB #>> '{result,pace,budgetSeconds}' = '75'
    AND :'p285_diag_done'::JSONB #>> '{result,pace,answeredWithTime}' = '2'
    AND jsonb_array_length(:'p285_diag_done'::JSONB -> 'review') = 3
    AND :'p285_diag_done'::JSONB #>> '{review,0,explain,correctOptionId}'
      = :'p285_keys'::JSONB ->> 'csca-math-exp-log-007'
    AND :'p285_diag_done'::JSONB #>> '{review,2,flagged}' = 'true',
  'completing the diagnostic early grades on the server and opens the review of every item');
SELECT pg_temp.p285_assert(
  platform.complete_learning_test_v1(:'p285_diag_attempt', 2, pg_temp.p285_id(929)) #>> '{result,completedAt}'
      = :'p285_diag_done'::JSONB #>> '{result,completedAt}'
    AND platform.complete_learning_test_v1(:'p285_diag_attempt', 99, pg_temp.p285_id(930)) #>> '{result,completedAt}'
      = :'p285_diag_done'::JSONB #>> '{result,completedAt}',
  'completion is idempotent: a replay and a new request return the same result');
SELECT pg_temp.p285_assert(
  pg_temp.p285_failure(format('SELECT platform.save_learning_test_v1(%L, 3, ''{}'', ''[]'', ''{}'', %L)',
    :'p285_diag_attempt', pg_temp.p285_id(931))) = '22023:learning_test_completed',
  'a completed test takes no further saves');

-- The mock: no early finish.
SELECT platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(941)) ->> 'attemptId' AS p285_mock_attempt \gset
SELECT pg_temp.p285_assert(
  pg_temp.p285_failure(format('SELECT platform.complete_learning_test_v1(%L, 1, %L)',
    :'p285_mock_attempt', pg_temp.p285_id(942))) = '22023:learning_test_early_finish_forbidden',
  'the mock test cannot be finished before the deadline');
SELECT platform.save_learning_test_v1(:'p285_mock_attempt', 1,
  jsonb_build_object('csca-math-exp-log-006', :'p285_keys'::JSONB ->> 'csca-math-exp-log-006',
    'csca-math-derivative-005', CASE WHEN :'p285_keys'::JSONB ->> 'csca-math-derivative-005' = 'a' THEN 'b' ELSE 'a' END),
  '[]', '{"csca-math-exp-log-006": 60, "csca-math-derivative-005": 90}', pg_temp.p285_id(943)) ->> 'revision'
  AS p285_mock_revision \gset
RESET ROLE;
-- 450 s test; move it 470 s into the past: deadline + 15 s has passed.
SELECT pg_temp.p285_age_attempt(:'p285_mock_attempt', 470);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT pg_temp.p285_assert(
  pg_temp.p285_failure(format('SELECT platform.save_learning_test_v1(%L, %s, ''{}'', ''[]'', ''{}'', %L)',
    :'p285_mock_attempt', :'p285_mock_revision', pg_temp.p285_id(944))) = '22023:learning_test_deadline_passed',
  'a save after deadline + 15 s is refused');
SELECT platform.learning_test_attempt_v1(:'p285_mock_attempt')::TEXT AS p285_mock_read \gset
SELECT pg_temp.p285_assert(
  :'p285_mock_read'::JSONB ->> 'status' = 'completed'
    AND :'p285_mock_read'::JSONB ->> 'completion' = 'timeout'
    AND :'p285_mock_read'::JSONB #>> '{result,answeredCount}' = '2'
    AND :'p285_mock_read'::JSONB #>> '{result,correctCount}' = '1'
    AND :'p285_mock_read'::JSONB #>> '{result,itemsTotal}' = '6'
    AND jsonb_array_length(:'p285_mock_read'::JSONB -> 'review') = 6,
  'the first read after the deadline finishes the expired draft on the server (completion = timeout)');
SELECT pg_temp.p285_assert(
  platform.learning_test_attempt_v1(:'p285_mock_attempt') #>> '{result,completedAt}'
    = :'p285_mock_read'::JSONB #>> '{result,completedAt}',
  'automatic completion is idempotent');

-- A second mock: the deadline passed 5 s ago (inside the 15 s grace): the
-- late save is accepted and completion is a timeout, not an early finish.
SELECT platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(951)) ->> 'attemptId' AS p285_mock2 \gset
SELECT pg_temp.p285_assert(:'p285_mock2' <> :'p285_mock_attempt', 'a new mock attempt starts after the first finished');
RESET ROLE;
SELECT pg_temp.p285_age_attempt(:'p285_mock2', 455);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.save_learning_test_v1(:'p285_mock2', 1, '{"csca-math-line-circle-009": "a"}', '[]', '{}',
  pg_temp.p285_id(952)) ->> 'revision' AS p285_mock2_revision \gset
SELECT platform.complete_learning_test_v1(:'p285_mock2', 2, pg_temp.p285_id(953))::TEXT AS p285_mock2_done \gset
SELECT pg_temp.p285_assert(
  :'p285_mock2_revision' = '2'
    AND :'p285_mock2_done'::JSONB ->> 'completion' = 'timeout'
    AND :'p285_mock2_done'::JSONB #>> '{result,answeredCount}' = '1',
  'inside the grace window a save lands and completion records a timeout');
SELECT platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(932)) ->> 'attemptId' AS p285_diag2 \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)
    AND source = 'mock') = 3
  AND (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)
    AND source = 'diagnostic') = 2
  AND (SELECT seconds FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)
    AND item_key = 'csca-math-exp-log-006') = 60
  AND EXISTS (SELECT 1 FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.p285_id(304)
    AND item_key = 'csca-math-derivative-005' AND box = 1),
  'test completion logs answered items only (with the client time hint) and sends wrong ones to review');
SELECT pg_temp.p285_assert(
  pg_temp.p285_error(format('UPDATE platform.learning_test_attempts SET revision = revision + 1 WHERE id = %L',
    :'p285_diag_attempt')) = '55000'
  AND pg_temp.p285_error(format('UPDATE platform.learning_test_attempts SET deadline_at = deadline_at + INTERVAL ''1 hour'',
    revision = revision + 1 WHERE id = %L', :'p285_diag2')) = '55000'
  AND pg_temp.p285_error(format('UPDATE platform.learning_test_attempts SET revision = revision + 2 WHERE id = %L',
    :'p285_diag2')) = '55000'
  AND pg_temp.p285_error('DELETE FROM platform.learning_item_events') = '55000'
  AND pg_temp.p285_error('DELETE FROM platform_private.learning_test_requests') = '55000',
  'completed attempts, the deadline of a draft, the answer log and receipts are immutable even for the SQL owner');

-- «Продолжить тест» after the deadline: a start on a form whose draft expired
-- (and is finished by that very call) returns the finished attempt with its
-- result and review, never a fresh attempt; the next start opens a new one.
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(954)) ->> 'attemptId' AS p285_mock3 \gset
SELECT platform.save_learning_test_v1(:'p285_mock3', 1,
  jsonb_build_object('csca-math-line-circle-006', :'p285_keys'::JSONB ->> 'csca-math-line-circle-006'),
  '[]', '{}', pg_temp.p285_id(955)) IS NOT NULL AS ok \gset
RESET ROLE;
SELECT pg_temp.p285_age_attempt(:'p285_mock3', 470);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(956))::TEXT AS p285_mock3_resume \gset
SELECT pg_temp.p285_assert(
  :'p285_mock3' NOT IN (:'p285_mock2', :'p285_mock_attempt')
    AND :'p285_mock3_resume'::JSONB ->> 'attemptId' = :'p285_mock3'
    AND :'p285_mock3_resume'::JSONB ->> 'status' = 'completed'
    AND :'p285_mock3_resume'::JSONB ->> 'completion' = 'timeout'
    AND :'p285_mock3_resume'::JSONB #>> '{result,answeredCount}' = '1'
    AND :'p285_mock3_resume'::JSONB #>> '{result,correctCount}' = '1'
    AND jsonb_array_length(:'p285_mock3_resume'::JSONB -> 'review') = 6
    AND platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(956)) ->> 'attemptId' = :'p285_mock3',
  'a start on a form whose draft expired returns that finished attempt with its review, also on replay');
SELECT platform.start_learning_test_v1(:'p285_mock', pg_temp.p285_id(957)) ->> 'attemptId' AS p285_mock4 \gset
SELECT pg_temp.p285_assert(
  :'p285_mock4' NOT IN (:'p285_mock3', :'p285_mock2', :'p285_mock_attempt')
    AND platform.learning_test_attempt_v1(:'p285_mock4') ->> 'status' = 'draft',
  'after the finished attempt was shown, the next start opens a new attempt');

-- «Ошибки» finish an abandoned test first: its wrong answer is in the bank
-- in the very same read (contract §7.5).
SELECT platform.save_learning_test_v1(:'p285_mock4', 1,
  jsonb_build_object('csca-math-exp-log-006',
    CASE WHEN :'p285_keys'::JSONB ->> 'csca-math-exp-log-006' = 'a' THEN 'b' ELSE 'a' END),
  '[]', '{}', pg_temp.p285_id(958)) IS NOT NULL AS ok \gset
SELECT platform.learning_review_v2('csca-math') ->> 'activeCount' AS p285_active_before \gset
RESET ROLE;
SELECT pg_temp.p285_age_attempt(:'p285_mock4', 470);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.learning_review_v2('csca-math') ->> 'activeCount' AS p285_active_after \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  (SELECT status = 'completed' AND completion = 'timeout' FROM platform.learning_test_attempts WHERE id = :'p285_mock4')
    AND :'p285_active_after'::INTEGER = :'p285_active_before'::INTEGER + 1,
  'the review read finishes an expired draft first, so its wrong answer reaches «Ошибки» at once');

-- ===========================================================================
-- (v) Spaced review.
-- ===========================================================================
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT pg_temp.p285_assert(
  jsonb_array_length(platform.learning_review_v2('csca-math') -> 'items') = 0
    AND (platform.learning_review_v2('csca-math') ->> 'activeCount')::INTEGER >= 2,
  'nothing is due on the day of the mistake');
SELECT pg_temp.p285_assert(
  pg_temp.p285_failure(format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-exp-log-001'', ''{"selected":"a"}'', %L)',
    pg_temp.p285_id(961))) = '22023:learning_review_not_due',
  'an item that is not due cannot be reviewed');
RESET ROLE;
SELECT pg_temp.p285_make_due(pg_temp.p285_id(304), 'csca-math-exp-log-001', 1);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.learning_review_v2('csca-math')::TEXT AS p285_review \gset
SELECT pg_temp.p285_assert(
  jsonb_array_length(:'p285_review'::JSONB -> 'items') = 1
    AND :'p285_review'::JSONB #>> '{items,0,itemKey}' = 'csca-math-exp-log-001'
    AND :'p285_review'::JSONB #>> '{items,0,item,stemEn}' IS NOT NULL
    AND (:'p285_review'::JSONB -> 'items')::TEXT NOT LIKE '%Верно:%'
    AND (:'p285_review'::JSONB -> 'items')::TEXT NOT LIKE '%correctOptionId%',
  'a due item is served as a safe projection');
SELECT pg_temp.p285_assert(
  pg_temp.p285_safe_items((SELECT jsonb_agg(entry -> 'item') FROM jsonb_array_elements(:'p285_review'::JSONB -> 'items') entry),
    '{}'::TEXT[])
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_review'::JSONB #> '{items,0}') key)
    = ARRAY['box', 'dueOn', 'item', 'itemKey', 'lapses'],
  'review items carry exactly the safe projection keys');
SELECT platform.record_learning_review_v1('csca-math', 'csca-math-exp-log-001', '{"selected":"a"}',
  pg_temp.p285_id(962))::TEXT AS p285_review_wrong \gset
SELECT pg_temp.p285_assert(
  :'p285_review_wrong'::JSONB ->> 'correct' = 'false' AND :'p285_review_wrong'::JSONB ->> 'box' = '1'
    AND :'p285_review_wrong'::JSONB ->> 'dueOn' = (:'p285_today'::DATE + 1)::TEXT
    AND :'p285_review_wrong'::JSONB ->> 'lapses' = '1'
    AND :'p285_review_wrong'::JSONB #>> '{explain,correctOptionId}' = :'p285_keys'::JSONB ->> 'csca-math-exp-log-001'
    AND platform.record_learning_review_v1('csca-math', 'csca-math-exp-log-001', '{"selected":"a"}',
      pg_temp.p285_id(962))::TEXT = :'p285_review_wrong',
  'a wrong review answer returns to box 1 for tomorrow; the receipt replays');
RESET ROLE;
SELECT pg_temp.p285_make_due(pg_temp.p285_id(304), 'csca-math-exp-log-001', 1);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.record_learning_review_v1('csca-math', 'csca-math-exp-log-001',
  jsonb_build_object('selected', :'p285_keys'::JSONB ->> 'csca-math-exp-log-001'), pg_temp.p285_id(963))::TEXT
  AS p285_review_right \gset
SELECT pg_temp.p285_assert(
  :'p285_review_right'::JSONB ->> 'correct' = 'true' AND :'p285_review_right'::JSONB ->> 'box' = '2'
    AND :'p285_review_right'::JSONB ->> 'dueOn' = (:'p285_today'::DATE + 3)::TEXT,
  'a right answer in box 1 moves the item to box 2 in 3 days');
RESET ROLE;
SELECT pg_temp.p285_make_due(pg_temp.p285_id(304), 'csca-math-exp-log-001', 4);
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT platform.record_learning_review_v1('csca-math', 'csca-math-exp-log-001',
  jsonb_build_object('selected', :'p285_keys'::JSONB ->> 'csca-math-exp-log-001'), pg_temp.p285_id(964))::TEXT
  AS p285_review_retired \gset
SELECT pg_temp.p285_assert(
  :'p285_review_retired'::JSONB ->> 'retired' = 'true'
    AND pg_temp.p285_error(format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-exp-log-001'', ''{"selected":"a"}'', %L)',
      pg_temp.p285_id(965))) = '42501'
    AND pg_temp.p285_error(format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-exp-log-009'', ''{"selected":"a"}'', %L)',
      pg_temp.p285_id(966))) = '42501',
  'a right answer in box 4 retires the item; items outside the own bank are 42501');

-- ===========================================================================
-- (vi) Progress, error reports, target session.
-- ===========================================================================
SELECT platform.learning_track_progress_v1('csca-math')::TEXT AS p285_progress \gset
SELECT pg_temp.p285_assert(
  :'p285_progress'::JSONB #>> '{coverage,topicsTotal}' = '28'
    AND :'p285_progress'::JSONB #>> '{coverage,topicsWithCompletedLesson}' = '1'
    AND jsonb_array_length(:'p285_progress'::JSONB -> 'tests') = 5
    AND :'p285_progress'::JSONB #>> '{streak,current}' = '1'
    AND :'p285_progress'::JSONB #>> '{streak,timeZone}' = 'Asia/Bishkek'
    AND :'p285_progress'::JSONB #>> '{pace,budgetSeconds}' = '75'
    AND (:'p285_progress'::JSONB #>> '{pace,answeredWithTime}')::INTEGER = 4
    AND :'p285_progress'::JSONB #>> '{review,retiredCount}' = '1',
  'progress counts coverage, test history, the Bishkek streak, pace and the review bank');

SELECT platform.report_learning_item_v1('csca-math', 'csca-math-exp-log-006', 'Кажется, на рисунке не видна асимптота.',
  pg_temp.p285_id(971))::TEXT AS p285_report \gset
SELECT pg_temp.p285_assert(
  :'p285_report'::JSONB ->> 'itemKey' = 'csca-math-exp-log-006'
    AND platform.report_learning_item_v1('csca-math', 'csca-math-exp-log-006', 'Кажется, на рисунке не видна асимптота.',
      pg_temp.p285_id(971))::TEXT = :'p285_report'
    AND pg_temp.p285_error(format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-exp-log-006'', ''Другой текст'', %L)',
      pg_temp.p285_id(971))) = '22023'
    AND pg_temp.p285_error(format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-exp-log-006'', ''  '', %L)',
      pg_temp.p285_id(972))) = '22023'
    AND pg_temp.p285_error(format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-exp-log-006'', %L, %L)',
      repeat('x', 501), pg_temp.p285_id(973))) = '22023'
    AND pg_temp.p285_error(format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-p285-none'', ''x'', %L)',
      pg_temp.p285_id(974))) = '42501',
  'a report is idempotent by request id; blank, 501-character and unknown-item reports are refused');

SELECT pg_temp.p285_assert(
  platform.set_learning_target_session_v1('csca-math', '2026-12') ->> 'targetSessionKey' = '2026-12'
    AND platform.learning_track_home_v1('csca-math') ->> 'targetSessionKey' = '2026-12'
    AND pg_temp.p285_error('SELECT platform.set_learning_target_session_v1(''csca-math'', ''2030-01'')') = '22023'
    AND platform.set_learning_target_session_v1('csca-math', NULL) -> 'targetSessionKey' = 'null'::JSONB,
  'the target session is stored per Student and track; unknown sessions are refused');
RESET ROLE;
-- A session that has already ended (by the Bishkek date) is neither listed on
-- the home nor accepted as the target.
INSERT INTO platform_private.csca_exam_sessions (session_key, exam_from, exam_to, source_url, verified_on)
VALUES ('2026-06', '2026-06-13', '2026-06-14', 'https://csca.cn/about/examintro', '2026-10-16');
SET request.jwt.claims TO :'p285_student_a';
SET ROLE authenticated;
SELECT pg_temp.p285_assert(
  pg_temp.p285_failure('SELECT platform.set_learning_target_session_v1(''csca-math'', ''2026-06'')')
      = '22023:Invalid learning session'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(platform.learning_track_home_v1('csca-math') -> 'sessions') session
      WHERE session ->> 'sessionKey' = '2026-06')
    AND platform.set_learning_target_session_v1('csca-math', '2027-01') ->> 'targetSessionKey' = '2027-01'
    AND platform.set_learning_target_session_v1('csca-math', NULL) -> 'targetSessionKey' = 'null'::JSONB,
  'a session that has ended is refused as the target, a coming one is accepted');
RESET ROLE;

SET request.jwt.claims TO :'p285_admin';
SET ROLE authenticated;
SELECT platform.staff_learning_item_reports_v1('csca-math')::TEXT AS p285_admin_reports \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  jsonb_array_length(:'p285_admin_reports'::JSONB -> 'reports') = 1
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'p285_admin_reports'::JSONB #> '{reports,0}') key)
      = ARRAY['createdAt', 'itemKey', 'message', 'moduleVersion', 'reportId', 'stemEn', 'topicKey', 'track']
    AND :'p285_admin_reports'::TEXT NOT LIKE '%' || pg_temp.p285_id(304)::TEXT || '%'
    AND :'p285_admin_reports'::TEXT NOT LIKE '%' || pg_temp.p285_id(204)::TEXT || '%'
    AND :'p285_admin_reports'::TEXT NOT LIKE '%' || pg_temp.p285_id(104)::TEXT || '%',
  'the Admin reads the item and the text of a report, never its author');

-- ===========================================================================
-- (vii) Privacy matrix.
-- ===========================================================================
CREATE TEMP TABLE p285_calls (sql TEXT NOT NULL);
GRANT SELECT ON p285_calls TO authenticated, anon, service_role;
INSERT INTO p285_calls (sql) VALUES
  ('SELECT platform.learning_track_home_v1(''csca-math'')'),
  ('SELECT platform.learning_modules_v2(''csca-math'')'),
  (format('SELECT platform.learning_lesson_v2(%L)', :'p285_lesson')),
  (format('SELECT platform.start_learning_test_v1(%L, %L)', :'p285_diagnostic', pg_temp.p285_id(981))),
  (format('SELECT platform.learning_test_attempt_v1(%L)', :'p285_diag_attempt')),
  (format('SELECT platform.save_learning_test_v1(%L, 1, ''{}'', ''[]'', ''{}'', %L)', :'p285_mock2', pg_temp.p285_id(982))),
  (format('SELECT platform.complete_learning_test_v1(%L, 1, %L)', :'p285_mock2', pg_temp.p285_id(983))),
  ('SELECT platform.learning_review_v2(''csca-math'')'),
  (format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-derivative-005'', ''{"selected":"a"}'', %L)',
    pg_temp.p285_id(984))),
  ('SELECT platform.learning_track_progress_v1(''csca-math'')'),
  (format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-exp-log-001'', ''x'', %L)', pg_temp.p285_id(985))),
  ('SELECT platform.set_learning_target_session_v1(''csca-math'', ''2026-12'')'),
  -- Invalid arguments still answer 42501 to everyone who is not the Student.
  ('SELECT platform.learning_track_home_v1(''nope'')'),
  ('SELECT platform.learning_modules_v2(''nope'')'),
  ('SELECT platform.learning_review_v2(''nope'')'),
  ('SELECT platform.learning_track_progress_v1(''nope'')'),
  (format('SELECT platform.record_learning_review_v1(''nope'', ''csca-math-derivative-005'', ''{"selected":"a"}'', %L)',
    pg_temp.p285_id(991))),
  (format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-derivative-005'', ''[]'', %L)',
    pg_temp.p285_id(992))),
  (format('SELECT platform.report_learning_item_v1(''nope'', ''csca-math-exp-log-001'', ''x'', %L)', pg_temp.p285_id(993))),
  (format('SELECT platform.report_learning_item_v1(''csca-math'', ''csca-math-exp-log-001'', ''  '', %L)', pg_temp.p285_id(994))),
  ('SELECT platform.set_learning_target_session_v1(''nope'', ''2026-12'')'),
  ('SELECT platform.set_learning_target_session_v1(''csca-math'', ''2030-01'')');

CREATE TEMP TABLE p285_peer_calls (sql TEXT NOT NULL);
GRANT SELECT ON p285_peer_calls TO authenticated;
INSERT INTO p285_peer_calls (sql) VALUES
  (format('SELECT platform.learning_test_attempt_v1(%L)', :'p285_diag_attempt')),
  (format('SELECT platform.save_learning_test_v1(%L, 1, ''{}'', ''[]'', ''{}'', %L)', :'p285_mock2', pg_temp.p285_id(986))),
  (format('SELECT platform.complete_learning_test_v1(%L, 1, %L)', :'p285_mock2', pg_temp.p285_id(987))),
  (format('SELECT platform.save_learning_test_v1(%L, 1, ''{}'', ''[]'', ''{}'', %L)', :'p285_diag_attempt', pg_temp.p285_id(988))),
  (format('SELECT platform.record_learning_review_v1(''csca-math'', ''csca-math-derivative-005'', ''{"selected":"a"}'', %L)',
    pg_temp.p285_id(989))),
  (format('SELECT platform.save_learning_answer_v1(%L, 5, %L, ''{"selected":"a"}'', %L)',
    :'p285_attempt', :'p285_exercises'::JSONB ->> 0, pg_temp.p285_id(990)));

CREATE FUNCTION pg_temp.p285_refusals(p_table TEXT, p_expected TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE call RECORD; outcome TEXT; failures TEXT := '';
BEGIN
  FOR call IN EXECUTE format('SELECT sql FROM %s', p_table) LOOP
    outcome := pg_temp.p285_error(call.sql);
    IF outcome <> p_expected THEN failures := failures || outcome || ' for ' || call.sql || '; '; END IF;
  END LOOP;
  RETURN failures;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.p285_refusals(TEXT, TEXT) TO authenticated, anon, service_role;

SET request.jwt.claims TO :'p285_admin';
SET ROLE authenticated;
SELECT pg_temp.p285_refusals('pg_temp.p285_calls', '42501') AS p285_failures \gset
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'the Admin must be refused Student learning data: ' || :'p285_failures');
SET request.jwt.claims TO :'p285_sales';
SET ROLE authenticated;
SELECT pg_temp.p285_refusals('pg_temp.p285_calls', '42501') AS p285_failures \gset
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'Sales must be refused: ' || :'p285_failures');
SET request.jwt.claims TO :'p285_curator';
SET ROLE authenticated;
SELECT pg_temp.p285_refusals('pg_temp.p285_calls', '42501') AS p285_failures \gset
SELECT pg_temp.p285_assert(pg_temp.p285_error('SELECT platform.staff_learning_item_reports_v1(''csca-math'')') = '42501',
  'a Curator must not read error reports');
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'a Curator must be refused: ' || :'p285_failures');
SET ROLE anon;
SELECT pg_temp.p285_refusals('pg_temp.p285_calls', '42501') AS p285_failures \gset
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'anon must be refused: ' || :'p285_failures');
SET ROLE service_role;
SELECT pg_temp.p285_refusals('pg_temp.p285_calls', '42501') AS p285_failures \gset
SELECT pg_temp.p285_assert(pg_temp.p285_error('SELECT * FROM platform.learning_test_attempts') = '42501'
  AND pg_temp.p285_error('SELECT * FROM platform_private.learning_items') = '42501',
  'service_role must be refused the tables');
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'service_role must be refused: ' || :'p285_failures');

-- Another Student of the same organization and a Student of another
-- organization: own (empty) state, never Student A's.
SET request.jwt.claims TO :'p285_student_b';
SET ROLE authenticated;
SELECT pg_temp.p285_refusals('pg_temp.p285_peer_calls', '42501') AS p285_failures \gset
SELECT platform.learning_track_home_v1('csca-math')::TEXT AS p285_home_b \gset
SELECT pg_temp.p285_assert(
  :'p285_home_b'::JSONB #>> '{review,activeCount}' = '0'
    AND (SELECT bool_and(test -> 'draft' = 'null'::JSONB AND test -> 'lastResult' = 'null'::JSONB)
      FROM jsonb_array_elements(:'p285_home_b'::JSONB -> 'tests') test)
    AND (SELECT bool_and(topic ->> 'state' = 'not_started') FROM jsonb_array_elements(:'p285_home_b'::JSONB -> 'topics') topic)
    AND jsonb_array_length(platform.learning_track_progress_v1('csca-math') -> 'tests') = 0,
  'a caseless peer Student works with an own, empty state');
SELECT pg_temp.p285_assert(pg_temp.p285_error('SELECT * FROM platform.learning_item_events') = '42501'
  AND pg_temp.p285_error('SELECT * FROM platform.learning_item_reviews') = '42501'
  AND pg_temp.p285_error('SELECT * FROM platform_private.learning_item_reports') = '42501'
  AND pg_temp.p285_error('SELECT * FROM platform_private.learning_figures') = '42501'
  AND pg_temp.p285_error('INSERT INTO platform.learning_track_preferences (organization_id, student_membership_id, track) VALUES (gen_random_uuid(), gen_random_uuid(), ''csca-math'')') = '42501',
  'direct table access is refused to a Student');
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'a peer Student must be refused Student A''s state: ' || :'p285_failures');
SET request.jwt.claims TO :'p285_student_c';
SET ROLE authenticated;
SELECT pg_temp.p285_refusals('pg_temp.p285_peer_calls', '42501') AS p285_failures \gset
RESET ROLE;
SELECT pg_temp.p285_assert(:'p285_failures' = '', 'a foreign Student must be refused Student A''s state: ' || :'p285_failures');

-- Revocation closes the RPC even with a formerly valid JWT.
UPDATE platform.profiles SET access_version = access_version + 1 WHERE id = pg_temp.p285_id(206);
SET request.jwt.claims TO :'p285_student_c';
SET ROLE authenticated;
SELECT pg_temp.p285_assert(pg_temp.p285_error('SELECT platform.learning_track_home_v1(''csca-math'')') = '42501',
  'a stale access version must be refused');
RESET ROLE;

SELECT pg_temp.p285_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id IN (
      SELECT request_id FROM platform_private.learning_test_requests
      UNION SELECT request_id FROM platform_private.learning_review_requests
      UNION SELECT request_id FROM platform_private.learning_item_reports))
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE resource_id IN (
      SELECT id FROM platform.learning_test_attempts)),
  'private learning writes never enter the staff audit journal');
SELECT pg_temp.p285_assert(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN (
    'platform_private.learning_topics'::regclass, 'platform_private.learning_figures'::regclass,
    'platform_private.learning_items'::regclass, 'platform_private.learning_test_forms'::regclass,
    'platform_private.csca_exam_sessions'::regclass, 'platform.learning_test_attempts'::regclass,
    'platform_private.learning_test_requests'::regclass, 'platform.learning_item_reviews'::regclass,
    'platform_private.learning_review_requests'::regclass, 'platform.learning_item_events'::regclass,
    'platform_private.learning_item_reports'::regclass, 'platform.learning_track_preferences'::regclass))
  AND NOT EXISTS (SELECT 1
    FROM unnest(ARRAY['platform_private.learning_topics', 'platform_private.learning_figures',
      'platform_private.learning_items', 'platform_private.learning_test_forms', 'platform_private.csca_exam_sessions',
      'platform.learning_test_attempts', 'platform_private.learning_test_requests', 'platform.learning_item_reviews',
      'platform_private.learning_review_requests', 'platform.learning_item_events',
      'platform_private.learning_item_reports', 'platform.learning_track_preferences']) AS target(name)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS client(role)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege(name)
    WHERE has_table_privilege(client.role, target.name, privilege.name)),
  'all twelve new tables keep forced RLS and zero client grants');

-- ===========================================================================
-- (viii) Account deletion (280) erases the new state of a simple account.
-- Student B: caseless, with CSCA activity in every new table.
-- ===========================================================================
SET request.jwt.claims TO :'p285_student_b';
SET ROLE authenticated;
SELECT platform.start_learning_test_v1(:'p285_diagnostic', pg_temp.p285_id(1001)) ->> 'attemptId' AS p285_b_attempt \gset
SELECT platform.save_learning_test_v1(:'p285_b_attempt', 1,
  jsonb_build_object('csca-math-exp-log-007', CASE WHEN :'p285_keys'::JSONB ->> 'csca-math-exp-log-007' = 'a' THEN 'b' ELSE 'a' END),
  '[]', '{"csca-math-exp-log-007": 30}', pg_temp.p285_id(1002)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_test_v1(:'p285_b_attempt', 2, pg_temp.p285_id(1003)) IS NOT NULL AS ok \gset
SELECT platform.set_learning_target_session_v1('csca-math', '2027-01') IS NOT NULL AS ok \gset
SELECT platform.report_learning_item_v1('csca-math', 'csca-math-exp-log-007', 'Проверьте вариант b.',
  pg_temp.p285_id(1004)) IS NOT NULL AS ok \gset
RESET ROLE;
SELECT pg_temp.p285_make_due(pg_temp.p285_id(305), 'csca-math-exp-log-007', 1);
SET request.jwt.claims TO :'p285_student_b';
SET ROLE authenticated;
SELECT platform.record_learning_review_v1('csca-math', 'csca-math-exp-log-007', '{"selected":"a"}',
  pg_temp.p285_id(1005)) IS NOT NULL AS ok \gset
SELECT platform.request_account_deletion_v2(pg_temp.p285_id(1006)) IS NOT NULL AS ok \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  (SELECT count(*) FROM platform.learning_test_attempts WHERE student_membership_id = pg_temp.p285_id(305)) = 1
    AND (SELECT count(*) FROM platform_private.learning_test_requests WHERE student_membership_id = pg_temp.p285_id(305)) = 3
    AND (SELECT count(*) FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.p285_id(305)) = 1
    AND (SELECT count(*) FROM platform_private.learning_review_requests WHERE student_membership_id = pg_temp.p285_id(305)) = 1
    AND (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(305)) = 2
    AND (SELECT count(*) FROM platform_private.learning_item_reports WHERE student_membership_id = pg_temp.p285_id(305)) = 1
    AND (SELECT count(*) FROM platform.learning_track_preferences WHERE student_membership_id = pg_temp.p285_id(305)) = 1
    AND jsonb_array_length(platform_private.account_deletion_check(pg_temp.p285_id(1), pg_temp.p285_id(105)) -> 'reasons') = 0,
  'Student B has rows in every new state table and is still a simple account');
SELECT id AS p285_b_deletion FROM platform_private.account_deletion_requests
  WHERE subject_auth_user_id = pg_temp.p285_id(105) \gset
SET request.jwt.claims TO :'p285_admin';
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p285_b_deletion') ->> 'status' AS p285_b_deletion_status \gset
RESET ROLE;
SELECT pg_temp.p285_assert(
  :'p285_b_deletion_status' = 'processing'
    AND NOT EXISTS (SELECT 1 FROM platform.learning_test_attempts WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform_private.learning_test_requests WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform_private.learning_review_requests WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform_private.learning_item_reports WHERE student_membership_id = pg_temp.p285_id(305))
    AND NOT EXISTS (SELECT 1 FROM platform.learning_track_preferences WHERE student_membership_id = pg_temp.p285_id(305))
    AND EXISTS (SELECT 1 FROM platform.learning_item_events WHERE student_membership_id = pg_temp.p285_id(304)),
  'automatic deletion of a simple account erases its CSCA state and nobody else''s');

SELECT 'P285_CSCA_LEARNING_SUITE_PASSED' AS p285_suite_marker;
ROLLBACK;
