\set ON_ERROR_STOP on

-- Fixture BEFORE the CSCA math part 2 content migration (release 1.1.0). Run
-- only by scripts/test-csca-learning-postgres.sh on its own disposable
-- database, after the whole chain except part 2 and after
-- platform_csca_learning.sql, right before part 2 is applied. It COMMITS one
-- organization with an Admin, a Sales, a Curator and a Student, and the
-- Student's progress on release 1.0.0 made through the real RPCs: the
-- completed lesson csca-math-m2-exp-log-l1 (one wrong answer, so one item in
-- the review bank) and the completed pilot diagnostic csca-math-diagnostic-1.
-- platform_csca_math_part2.sql then proves that release 1.1.0 keeps that
-- progress (it goes by key), shows the new forms and runs them end to end.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.c2_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('c5ca0002-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.c2_id(INTEGER) TO authenticated;

INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.c2_id(1), 'CSCA math part 2 fixture organization');

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT pg_temp.c2_id(100 + n), 'csca-part2-actor-' || n || '@example.invalid', '{}'::JSONB
FROM generate_series(1, 4) AS n;

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
SELECT pg_temp.c2_id(200 + n), pg_temp.c2_id(100 + n), 'CSCA part 2 actor ' || n, 'active', 1
FROM generate_series(1, 4) AS n;

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.c2_id(300 + actor.n), pg_temp.c2_id(1), pg_temp.c2_id(200 + actor.n), 'active',
  actor.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1),
  actor.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student')) AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.c2_id(11), pg_temp.c2_id(1), 'organization', pg_temp.c2_id(1), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.c2_id(1), pg_temp.c2_id(300 + n), pg_temp.c2_id(11), 1, 1, TRUE, 'system',
  'CSCA part 2 fixture organization scope', pg_temp.c2_id(600 + n)
FROM generate_series(1, 4) AS n;

-- Handles of release 1.0.0 (the only csca-math release at this moment).
SELECT
  (SELECT id FROM platform_private.learning_lessons WHERE lesson_key = 'csca-math-m2-exp-log-l1') AS c2_lesson,
  (SELECT id FROM platform_private.learning_test_forms WHERE form_key = 'csca-math-diagnostic-1') AS c2_diagnostic1
\gset
SELECT jsonb_object_agg(item.item_key, item.body -> 'options' -> (item.body ->> 'answer_index')::INTEGER ->> 'id')::TEXT
  AS c2_keys
FROM platform_private.learning_items item
JOIN platform_private.learning_modules module ON module.id = item.module_id
WHERE module.module_key = 'csca-math' AND module.version = '1.0.0'
\gset

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.c2_id(104),
  'claims', jsonb_build_object('sub', pg_temp.c2_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS c2_student
\gset

SET request.jwt.claims TO :'c2_student';
SET ROLE authenticated;
-- The pilot lesson of exp-log: 4 checks, the first one answered wrong.
SELECT platform.learning_lesson_v2(:'c2_lesson')::TEXT AS c2_payload \gset
SELECT (SELECT jsonb_agg(exercise ->> 'exerciseId' ORDER BY (exercise ->> 'orderIndex')::INTEGER)
  FROM jsonb_array_elements(:'c2_payload'::JSONB #> '{lesson,exercises}') exercise)::TEXT AS c2_exercises \gset
SELECT platform.start_learning_lesson_v1(:'c2_lesson', pg_temp.c2_id(901)) ->> 'attemptId' AS c2_attempt \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 1, (:'c2_exercises'::JSONB ->> 0)::UUID,
  jsonb_build_object('selected', CASE WHEN :'c2_keys'::JSONB ->> 'csca-math-exp-log-001' = 'a' THEN 'b' ELSE 'a' END),
  pg_temp.c2_id(902)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 2, (:'c2_exercises'::JSONB ->> 1)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-exp-log-002'), pg_temp.c2_id(903)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 3, (:'c2_exercises'::JSONB ->> 2)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-exp-log-003'), pg_temp.c2_id(904)) IS NOT NULL AS ok \gset
SELECT platform.save_learning_answer_v1(:'c2_attempt', 4, (:'c2_exercises'::JSONB ->> 3)::UUID,
  jsonb_build_object('selected', :'c2_keys'::JSONB ->> 'csca-math-exp-log-005'), pg_temp.c2_id(905)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_lesson_v1(:'c2_attempt', 5, pg_temp.c2_id(906)) ->> 'status' AS c2_lesson_status \gset

-- The pilot diagnostic of release 1.0.0: one wrong and one right answer, one item flagged.
SELECT platform.start_learning_test_v1(:'c2_diagnostic1', pg_temp.c2_id(911)) ->> 'attemptId' AS c2_diag_attempt \gset
SELECT platform.save_learning_test_v1(:'c2_diag_attempt', 1,
  jsonb_build_object('csca-math-exp-log-007',
    CASE WHEN :'c2_keys'::JSONB ->> 'csca-math-exp-log-007' = 'a' THEN 'b' ELSE 'a' END,
    'csca-math-derivative-007', :'c2_keys'::JSONB ->> 'csca-math-derivative-007'),
  '["csca-math-line-circle-007"]', '{"csca-math-exp-log-007": 40, "csca-math-derivative-007": 70}',
  pg_temp.c2_id(912)) IS NOT NULL AS ok \gset
SELECT platform.complete_learning_test_v1(:'c2_diag_attempt', 2, pg_temp.c2_id(913)) ->> 'status' AS c2_diag_status \gset
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM platform_private.learning_modules WHERE module_key = 'csca-math') <> 1
    OR (SELECT count(*) FROM platform.learning_lesson_attempts WHERE student_membership_id = pg_temp.c2_id(304)
      AND status = 'completed') <> 1
    OR (SELECT count(*) FROM platform.learning_test_attempts WHERE student_membership_id = pg_temp.c2_id(304)
      AND status = 'completed') <> 1
    OR (SELECT count(*) FROM platform.learning_item_reviews WHERE student_membership_id = pg_temp.c2_id(304)) <> 2
    OR (SELECT count(*) FROM platform.learning_item_events WHERE student_membership_id = pg_temp.c2_id(304)) <> 6
  THEN
    RAISE EXCEPTION 'CSCA math part 2 fixture is incomplete';
  END IF;
END $$;

SELECT 'CSCA_MATH_PART2_FIXTURE_RECORDED' AS c2_fixture_marker;
COMMIT;
