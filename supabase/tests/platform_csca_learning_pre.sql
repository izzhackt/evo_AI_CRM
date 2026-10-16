\set ON_ERROR_STOP on

-- Snapshot BEFORE migration 285 («Подготовка к CSCA: движок»). Run only by
-- scripts/test-csca-learning-postgres.sh on its own disposable database, right
-- before 285 is applied. It COMMITS a small synthetic fixture (one
-- organization, one Student, a synthetic English module with two lessons,
-- one completed attempt with a wrong answer and one draft) and the exact
-- outputs of the released v1 learning RPCs for that Student into
-- csca_proof.v1_snapshot. platform_csca_learning.sql later calls the same
-- RPCs after 285 and 286 and requires byte-identical JSON: the English course
-- and learning_modules_v1 do not change for old iPhone builds.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE SCHEMA csca_proof;
CREATE TABLE csca_proof.v1_snapshot (name TEXT PRIMARY KEY, payload JSONB NOT NULL);

CREATE FUNCTION pg_temp.p285s_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p285s_id(INTEGER) TO authenticated;

INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p285s_id(1), 'Migration 285 snapshot organization');
-- The organization keeps an active organization-scoped Admin (deferred
-- platform invariant checked at COMMIT); the Student is the snapshot actor.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p285s_id(100), 'p285-snapshot-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p285s_id(101), 'p285-snapshot-student@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p285s_id(200), pg_temp.p285s_id(100), 'P285 Snapshot Admin', 'active', 1),
  (pg_temp.p285s_id(201), pg_temp.p285s_id(101), 'P285 Snapshot Student', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p285s_id(300 + actor.n), pg_temp.p285s_id(1), pg_temp.p285s_id(200 + actor.n), 'active',
  actor.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = actor.role::platform.business_role
     AND status = 'published' ORDER BY version DESC LIMIT 1),
  actor.role = 'admin'
FROM (VALUES (0, 'admin'), (1, 'student')) AS actor(n, role);
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p285s_id(11), pg_temp.p285s_id(1), 'organization', pg_temp.p285s_id(1), 1);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p285s_id(1), pg_temp.p285s_id(300 + n), pg_temp.p285s_id(11), 1, 1, TRUE, 'system',
  'P285 snapshot organization scope', pg_temp.p285s_id(600 + n)
FROM generate_series(0, 1) AS n;

-- Synthetic English module (the 198 shape) next to the real en-m1-start.
INSERT INTO platform_private.learning_modules (id, module_key, version, metadata, published_at)
VALUES (pg_temp.p285s_id(801), 'p285-english', 'snapshot', jsonb_build_object(
  'title_ru', 'P285 Английский', 'title_ky', 'P285 Англис тили',
  'level_note_ru', 'Синтетический уровень', 'level_note_ky', 'Синтетикалык деңгээл'),
  '1900-01-01'::TIMESTAMPTZ);
INSERT INTO platform_private.learning_lessons (id, module_id, lesson_key, order_index, metadata, theory)
SELECT pg_temp.p285s_id(810 + n), pg_temp.p285s_id(801), 'p285-lesson-' || n, n,
  jsonb_build_object('title_ru', 'Урок ' || n, 'title_ky', 'Сабак ' || n, 'goal_ru', 'Цель', 'goal_ky', 'Максат'),
  jsonb_build_array(jsonb_build_object('text_ru', 'Теория', 'text_ky', 'Теория KY',
    'examples', jsonb_build_array(jsonb_build_object('en', 'Hello', 'ru', 'Привет', 'ky', 'Салам'))))
FROM generate_series(1, 2) AS n;
INSERT INTO platform_private.learning_exercises (id, lesson_id, exercise_key, order_index, exercise_type, body)
SELECT pg_temp.p285s_id(820 + n), pg_temp.p285s_id(810 + CASE WHEN n <= 2 THEN 1 ELSE 2 END),
  'p285-choice-' || n, CASE WHEN n IN (1, 3) THEN 1 ELSE 2 END, 'choice',
  jsonb_build_object('prompt_en', 'Pick the greeting ' || n,
    'options', jsonb_build_array(
      jsonb_build_object('id', 'a', 'label', 'Hello', 'explain_ru', 'Верно: приветствие.', 'explain_ky', 'Туура: саламдашуу.'),
      jsonb_build_object('id', 'b', 'label', 'Table', 'explain_ru', 'Неверно: это стол.', 'explain_ky', 'Туура эмес: бул стол.')),
    'answer_index', 0)
FROM generate_series(1, 4) AS n;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p285s_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p285s_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p285s_claims
\gset

SELECT lesson.id AS p285s_real_lesson_id FROM platform_private.learning_lessons lesson
  JOIN platform_private.learning_modules module ON module.id = lesson.module_id
  WHERE module.module_key = 'en-m1-start' ORDER BY lesson.order_index LIMIT 1 \gset

SET request.jwt.claims TO :'p285s_claims';
SET ROLE authenticated;
SELECT platform.start_learning_lesson_v1(pg_temp.p285s_id(811), pg_temp.p285s_id(901)) ->> 'attemptId'
  AS p285s_attempt \gset
SELECT platform.save_learning_answer_v1(:'p285s_attempt', 1, pg_temp.p285s_id(821), '{"selected":"b"}',
  pg_temp.p285s_id(902)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'p285s_attempt', 2, pg_temp.p285s_id(822), '{"selected":"a"}',
  pg_temp.p285s_id(903)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_lesson_v1(:'p285s_attempt', 3, pg_temp.p285s_id(904)) IS NOT NULL AS ok \gset
SELECT platform.start_learning_lesson_v1(pg_temp.p285s_id(812), pg_temp.p285s_id(905)) ->> 'attemptId'
  AS p285s_draft \gset
SELECT platform.save_learning_answer_v1(:'p285s_draft', 1, pg_temp.p285s_id(823), '{"selected":"a"}',
  pg_temp.p285s_id(906)) IS NOT NULL AS ok \gset

SELECT platform.learning_modules_v1()::TEXT AS p285s_modules \gset
SELECT platform.learning_lesson_v1(pg_temp.p285s_id(811))::TEXT AS p285s_lesson_1 \gset
SELECT platform.learning_lesson_v1(pg_temp.p285s_id(812))::TEXT AS p285s_lesson_2 \gset
SELECT platform.learning_lesson_v1(:'p285s_real_lesson_id')::TEXT AS p285s_real_lesson \gset
SELECT platform.learning_review_v1(pg_temp.p285s_id(801))::TEXT AS p285s_review \gset
SELECT platform.learning_review_check_v1(pg_temp.p285s_id(821), '{"selected":"a"}')::TEXT AS p285s_review_check \gset
RESET ROLE;

INSERT INTO csca_proof.v1_snapshot (name, payload) VALUES
  ('learning_modules_v1', :'p285s_modules'::JSONB),
  ('learning_lesson_v1:completed', :'p285s_lesson_1'::JSONB),
  ('learning_lesson_v1:draft', :'p285s_lesson_2'::JSONB),
  ('learning_lesson_v1:en-m1-start', :'p285s_real_lesson'::JSONB),
  ('learning_review_v1', :'p285s_review'::JSONB),
  ('learning_review_check_v1', :'p285s_review_check'::JSONB);

DO $$
BEGIN
  IF (SELECT count(*) FROM csca_proof.v1_snapshot) <> 6
    OR (SELECT jsonb_array_length(payload -> 'modules') FROM csca_proof.v1_snapshot WHERE name = 'learning_modules_v1') <> 2
    OR (SELECT jsonb_array_length(payload -> 'items') FROM csca_proof.v1_snapshot WHERE name = 'learning_review_v1') <> 1
  THEN
    RAISE EXCEPTION 'Migration 285 snapshot is incomplete';
  END IF;
END $$;

SELECT 'P285_V1_SNAPSHOT_RECORDED' AS p285_snapshot_marker;
COMMIT;
