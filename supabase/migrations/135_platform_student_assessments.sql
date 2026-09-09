-- P4: Student-owner-private English/ORVIS attempts. No staff/case/audit projection.
-- Reviewed basis: https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://www.postgresql.org/docs/current/explicit-locking.html
BEGIN;

CREATE TABLE platform_private.student_assessment_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key TEXT NOT NULL CHECK (instrument_key IN ('english36', 'orvis92')),
  version TEXT NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  locale TEXT NOT NULL CHECK (locale = 'ru'),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  grading_rules JSONB NOT NULL CHECK (jsonb_typeof(grading_rules) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (instrument_key, version, locale),
  UNIQUE (id, instrument_key)
);

CREATE TABLE platform.student_assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  instrument_key TEXT NOT NULL,
  version_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  answers JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(answers) = 'object'),
  result_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (version_id, instrument_key)
    REFERENCES platform_private.student_assessment_versions(id, instrument_key) ON DELETE RESTRICT,
  UNIQUE (organization_id, student_membership_id, id),
  CHECK ((status = 'draft' AND completed_at IS NULL AND result_snapshot IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND result_snapshot IS NOT NULL
      AND jsonb_typeof(result_snapshot) = 'object'))
);
CREATE UNIQUE INDEX student_assessment_one_draft_idx
  ON platform.student_assessment_attempts(organization_id, student_membership_id, instrument_key)
  WHERE status = 'draft';
CREATE INDEX student_assessment_owner_history_idx
  ON platform.student_assessment_attempts(organization_id, student_membership_id, created_at DESC, id DESC);
CREATE INDEX student_assessment_version_idx ON platform.student_assessment_attempts(version_id);

CREATE TABLE platform_private.student_assessment_requests (
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
    REFERENCES platform.student_assessment_attempts(organization_id, student_membership_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX student_assessment_request_attempt_idx
  ON platform_private.student_assessment_requests(organization_id, student_membership_id, attempt_id);

ALTER TABLE platform_private.student_assessment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_assessment_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_assessment_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_assessment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_assessment_requests FORCE ROW LEVEL SECURITY;
-- Intentionally no permissive policies or table grants: even the owner uses RPCs.
REVOKE ALL ON TABLE platform_private.student_assessment_versions,
  platform.student_assessment_attempts, platform_private.student_assessment_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.validate_student_assessment_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  question JSONB;
  rule JSONB;
  question_id TEXT;
  expected_count INTEGER := CASE NEW.instrument_key WHEN 'english36' THEN 36 ELSE 92 END;
BEGIN
  IF jsonb_array_length(NEW.questions) <> expected_count
    OR (SELECT count(*) FROM jsonb_object_keys(NEW.grading_rules)) <> expected_count
    OR (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(NEW.questions) item) <> expected_count
    OR NULLIF(btrim(NEW.metadata->>'title'), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid assessment content version' USING ERRCODE = '22023';
  END IF;
  FOR question IN SELECT value FROM jsonb_array_elements(NEW.questions) LOOP
    question_id := question->>'id';
    rule := NEW.grading_rules->question_id;
    IF jsonb_typeof(question) <> 'object' OR jsonb_typeof(question->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(question->'prompt') IS DISTINCT FROM 'string' OR question_id IS NULL
      OR question_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
      OR NULLIF(btrim(question->>'prompt'), '') IS NULL
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(question) key
        WHERE key NOT IN ('id', 'prompt', 'options', 'topic', 'passage'))
      OR jsonb_typeof(question->'options') IS DISTINCT FROM 'array'
      OR jsonb_typeof(rule) IS DISTINCT FROM 'object'
    THEN
      RAISE EXCEPTION 'Invalid assessment question' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(question->'options') NOT BETWEEN 2 AND 8
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(question->'options') option
        WHERE jsonb_typeof(option) <> 'object'
          OR jsonb_typeof(option->'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(option->'label') IS DISTINCT FROM 'string'
          OR NULLIF(option->>'id', '') IS NULL OR char_length(option->>'id') > 80
          OR NULLIF(btrim(option->>'label'), '') IS NULL
          OR (SELECT count(*) FROM jsonb_object_keys(option)) <> 2
          OR NOT (option ?& ARRAY['id', 'label']))
      OR (SELECT count(DISTINCT option->>'id') FROM jsonb_array_elements(question->'options') option)
        <> jsonb_array_length(question->'options')
    THEN
      RAISE EXCEPTION 'Invalid assessment options' USING ERRCODE = '22023';
    END IF;
    IF NEW.instrument_key = 'english36' THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question->'options') option
          WHERE option->>'id' = rule->>'correctOptionId' AND option->>'id' <> 'unknown')
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question->'options') option
          WHERE option->>'id' = 'unknown')
        OR NULLIF(btrim(rule->>'explanation'), '') IS NULL
        OR NULLIF(btrim(rule->>'topic'), '') IS NULL
      THEN
        RAISE EXCEPTION 'Invalid English grading rule' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF rule->>'scale' IS NULL OR rule->>'scale' NOT IN
          ('leadership', 'organization', 'altruism', 'creativity', 'analysis', 'production', 'adventure', 'erudition')
        OR (SELECT array_agg(option->>'id' ORDER BY option->>'id')
          FROM jsonb_array_elements(question->'options') option) IS DISTINCT FROM ARRAY['1','2','3','4','5']::TEXT[]
      THEN
        RAISE EXCEPTION 'Invalid ORVIS grading rule' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF NEW.instrument_key = 'orvis92' AND EXISTS (
    SELECT 1 FROM (VALUES ('leadership',12),('organization',13),('altruism',13),('creativity',14),
      ('analysis',10),('production',10),('adventure',10),('erudition',10)) expected(scale, n)
    WHERE (SELECT count(*) FROM jsonb_each(NEW.grading_rules) rule WHERE rule.value->>'scale'=expected.scale) <> expected.n
  ) THEN
    RAISE EXCEPTION 'Invalid ORVIS scale coverage' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.guard_student_assessment_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME <> 'student_assessment_attempts' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Assessment record is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Assessment record is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.student_membership_id IS DISTINCT FROM OLD.student_membership_id
    OR NEW.instrument_key IS DISTINCT FROM OLD.instrument_key
    OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.revision <> OLD.revision + 1
  THEN
    RAISE EXCEPTION 'Assessment identity/version is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER student_assessment_version_validate BEFORE INSERT
  ON platform_private.student_assessment_versions FOR EACH ROW
  EXECUTE FUNCTION platform_private.validate_student_assessment_version();
CREATE TRIGGER student_assessment_versions_immutable BEFORE UPDATE OR DELETE
  ON platform_private.student_assessment_versions FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();
CREATE TRIGGER student_assessment_versions_no_truncate BEFORE TRUNCATE
  ON platform_private.student_assessment_versions FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();
CREATE TRIGGER student_assessment_attempts_guard BEFORE UPDATE OR DELETE
  ON platform.student_assessment_attempts FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();
CREATE TRIGGER student_assessment_attempts_no_truncate BEFORE TRUNCATE
  ON platform.student_assessment_attempts FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();
CREATE TRIGGER student_assessment_requests_immutable BEFORE UPDATE OR DELETE
  ON platform_private.student_assessment_requests FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();
CREATE TRIGGER student_assessment_requests_no_truncate BEFORE TRUNCATE
  ON platform_private.student_assessment_requests FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.guard_student_assessment_immutable();

CREATE FUNCTION platform_private.require_student_assessment_actor_read()
RETURNS TABLE (organization_id UUID, membership_id UUID, profile_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() authority
    WHERE authority.platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(actor.organization_id, 'portal.read.self')
    OR (SELECT count(*) FROM platform.student_portal_cases()) <> 1
  THEN
    RAISE EXCEPTION 'Assessment is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.organization_id, actor.membership_id, actor.profile_id;
END $$;

-- Exact public content projection; hidden keys cannot cross via extra question fields.
CREATE FUNCTION platform_private.student_assessment_public_questions(p_questions JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', question->>'id', 'prompt', question->>'prompt',
    'topic', question->>'topic', 'passage', question->>'passage',
    'options', (SELECT jsonb_agg(jsonb_build_object('id', option->>'id', 'label', option->>'label') ORDER BY ordinal)
      FROM jsonb_array_elements(question->'options') WITH ORDINALITY AS options(option, ordinal))
  )) ORDER BY ordinal), '[]'::JSONB)
  FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS questions(question, ordinal)
$$;

CREATE FUNCTION platform_private.student_assessment_attempt_payload(p_attempt platform.student_assessment_attempts)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'attemptId', p_attempt.id, 'instrumentKey', p_attempt.instrument_key,
    'versionId', version.id, 'version', version.version, 'locale', version.locale,
    'status', p_attempt.status, 'revision', p_attempt.revision,
    'metadata', version.metadata,
    'questions', platform_private.student_assessment_public_questions(version.questions),
    'answers', p_attempt.answers, 'result', p_attempt.result_snapshot,
    'createdAt', p_attempt.created_at, 'updatedAt', p_attempt.updated_at, 'completedAt', p_attempt.completed_at
  ) FROM platform_private.student_assessment_versions version WHERE version.id = p_attempt.version_id
$$;

CREATE FUNCTION platform_private.validate_student_assessment_answers(
  p_questions JSONB, p_answers JSONB, p_complete BOOLEAN
) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' OR octet_length(p_answers::TEXT) > 32768 THEN
    RAISE EXCEPTION 'Invalid assessment answers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_answers) answer
    WHERE jsonb_typeof(answer.value) <> 'string' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_questions) question,
        jsonb_array_elements(question->'options') option
      WHERE question->>'id' = answer.key AND option->>'id' = answer.value #>> '{}'
    )) OR (p_complete AND (SELECT count(*) FROM jsonb_object_keys(p_answers)) <> jsonb_array_length(p_questions))
  THEN
    RAISE EXCEPTION 'Invalid or incomplete assessment answers' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE FUNCTION platform_private.grade_student_assessment(
  p_version platform_private.student_assessment_versions, p_answers JSONB, p_completed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE result JSONB; feedback JSONB; topics JSONB; scales JSONB; top_scales JSONB; correct_count INTEGER;
BEGIN
  PERFORM platform_private.validate_student_assessment_answers(p_version.questions, p_answers, TRUE);
  result := jsonb_build_object('instrumentKey', p_version.instrument_key, 'version', p_version.version,
    'metadata', p_version.metadata, 'answeredCount', jsonb_array_length(p_version.questions),
    'questionCount', jsonb_array_length(p_version.questions), 'completedAt', p_completed_at);
  IF p_version.instrument_key = 'english36' THEN
    SELECT count(*) FILTER (WHERE p_answers->>rule.key = rule.value->>'correctOptionId'),
      jsonb_agg(jsonb_build_object('questionId', question->>'id',
        'selectedOptionId', p_answers->>(question->>'id'), 'correctOptionId', rule.value->>'correctOptionId',
        'correct', p_answers->>rule.key = rule.value->>'correctOptionId',
        'explanation', rule.value->>'explanation', 'topic', rule.value->>'topic') ORDER BY ordinal)
    INTO correct_count, feedback
    FROM jsonb_array_elements(p_version.questions) WITH ORDINALITY AS questions(question, ordinal)
    JOIN jsonb_each(p_version.grading_rules) rule ON rule.key = question->>'id';
    SELECT jsonb_agg(jsonb_build_object('topic', topic, 'correctCount', correct, 'totalCount', total) ORDER BY topic)
    INTO topics FROM (SELECT rule.value->>'topic' topic,
      count(*) FILTER (WHERE p_answers->>rule.key = rule.value->>'correctOptionId') correct, count(*) total
      FROM jsonb_each(p_version.grading_rules) rule GROUP BY rule.value->>'topic') grouped;
    RETURN result || jsonb_build_object('english', jsonb_build_object('correctCount', correct_count,
      'totalCount', 36, 'band', CASE WHEN correct_count <= 17 THEN 'basic' WHEN correct_count <= 27 THEN 'developing' ELSE 'strong' END,
      'topics', topics, 'feedback', feedback));
  END IF;
  WITH grouped AS (
    SELECT rule.value->>'scale' scale, sum((p_answers->>rule.key)::INTEGER) raw_sum, count(*) item_count
    FROM jsonb_each(p_version.grading_rules) rule GROUP BY rule.value->>'scale'
  ) SELECT jsonb_agg(jsonb_build_object('scale', scale, 'rawSum', raw_sum,
    'itemCount', item_count, 'mean', round(raw_sum::NUMERIC/item_count, 4)) ORDER BY scale),
    (SELECT jsonb_agg(scale ORDER BY scale) FROM grouped top_group
      WHERE NOT EXISTS (SELECT 1 FROM grouped higher
        WHERE higher.raw_sum * top_group.item_count > top_group.raw_sum * higher.item_count))
    INTO scales, top_scales FROM grouped;
  RETURN result || jsonb_build_object('orvis', jsonb_build_object('scales', scales, 'topScales', top_scales));
END $$;

CREATE FUNCTION platform.student_assessments_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; instruments JSONB; attempts JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_student_assessment_actor_read();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('instrumentKey', version.instrument_key,
    'versionId', version.id, 'version', version.version, 'locale', version.locale,
    'metadata', version.metadata, 'questionCount', jsonb_array_length(version.questions),
    'draftAttemptId', (SELECT attempt.id FROM platform.student_assessment_attempts attempt
      WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
        AND attempt.instrument_key = version.instrument_key AND attempt.status = 'draft'),
    'latestCompletedAttemptId', (SELECT attempt.id FROM platform.student_assessment_attempts attempt
      WHERE attempt.organization_id = actor.organization_id AND attempt.student_membership_id = actor.membership_id
        AND attempt.instrument_key = version.instrument_key AND attempt.status = 'completed'
      ORDER BY attempt.completed_at DESC, attempt.id DESC LIMIT 1)
  ) ORDER BY version.instrument_key), '[]'::JSONB) INTO instruments
  FROM (SELECT DISTINCT ON (instrument_key) * FROM platform_private.student_assessment_versions
    ORDER BY instrument_key, published_at DESC, id DESC) version;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('attemptId', attempt.id, 'instrumentKey', attempt.instrument_key,
    'version', version.version, 'status', attempt.status, 'revision', attempt.revision,
    'answeredCount', (SELECT count(*) FROM jsonb_object_keys(attempt.answers)),
    'questionCount', jsonb_array_length(version.questions), 'createdAt', attempt.created_at,
    'updatedAt', attempt.updated_at, 'completedAt', attempt.completed_at
  ) ORDER BY attempt.created_at DESC, attempt.id DESC), '[]'::JSONB) INTO attempts
  FROM (SELECT * FROM platform.student_assessment_attempts
    WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
    ORDER BY created_at DESC, id DESC LIMIT 30) attempt
  JOIN platform_private.student_assessment_versions version ON version.id = attempt.version_id;
  RETURN jsonb_build_object('instruments', instruments, 'attempts', attempts);
END $$;

CREATE FUNCTION platform.student_assessment_attempt_v1(p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; attempt platform.student_assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.require_student_assessment_actor_read();
  SELECT * INTO attempt FROM platform.student_assessment_attempts
    WHERE id = p_attempt_id AND organization_id = actor.organization_id AND student_membership_id = actor.membership_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment is unavailable' USING ERRCODE = '42501'; END IF;
  RETURN platform_private.student_assessment_attempt_payload(attempt);
END $$;

CREATE FUNCTION platform_private.write_student_assessment(
  p_operation TEXT, p_instrument_key TEXT, p_attempt_id UUID,
  p_expected_revision BIGINT, p_answers JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; locked_actor RECORD;
  attempt platform.student_assessment_attempts%ROWTYPE;
  version platform_private.student_assessment_versions%ROWTYPE;
  previous_request platform_private.student_assessment_requests%ROWTYPE;
  input_hash TEXT; response JSONB; completed_time TIMESTAMPTZ;
BEGIN
  IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('start','save','complete')
    OR (p_operation = 'start' AND (p_instrument_key IS NULL OR p_instrument_key NOT IN ('english36','orvis92')))
    OR (p_operation <> 'start' AND (p_attempt_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1))
  THEN RAISE EXCEPTION 'Invalid assessment request' USING ERRCODE = '22023'; END IF;
  -- Bound untrusted JSON before taking the shared authority locks or hashing it.
  IF p_operation <> 'start' AND (p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object'
    OR octet_length(p_answers::TEXT) > 32768) THEN
    RAISE EXCEPTION 'Invalid assessment answers' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_student_assessment_actor_read();
  -- Existing live authority lock serializes start/save/complete and concurrent revocation.
  SELECT * INTO locked_actor FROM platform_private.require_domain_actor(actor.organization_id, 'portal.read.self');
  SELECT * INTO actor FROM platform_private.require_student_assessment_actor_read();
  IF locked_actor.actor_role <> 'student' OR locked_actor.actor_membership_id <> actor.membership_id THEN
    RAISE EXCEPTION 'Assessment is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'student-assessment:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  input_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object('operation', p_operation,
    'instrumentKey', p_instrument_key, 'attemptId', p_attempt_id, 'expectedRevision', p_expected_revision,
    'answers', p_answers)::TEXT, 'UTF8')), 'hex');
  SELECT * INTO previous_request FROM platform_private.student_assessment_requests
    WHERE student_membership_id = actor.membership_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous_request.organization_id <> actor.organization_id OR previous_request.operation <> p_operation
      OR previous_request.input_hash <> input_hash THEN
      RAISE EXCEPTION 'Assessment request was already used' USING ERRCODE = '22023';
    END IF;
    SELECT content.* INTO STRICT version FROM platform_private.student_assessment_versions content
      JOIN platform.student_assessment_attempts existing ON existing.version_id = content.id
      WHERE existing.id = previous_request.attempt_id AND existing.organization_id = actor.organization_id
        AND existing.student_membership_id = actor.membership_id;
    RETURN previous_request.receipt || jsonb_build_object('metadata', version.metadata,
      'questions', platform_private.student_assessment_public_questions(version.questions));
  END IF;
  IF p_operation = 'start' THEN
    SELECT * INTO attempt FROM platform.student_assessment_attempts
      WHERE organization_id = actor.organization_id AND student_membership_id = actor.membership_id
        AND instrument_key = p_instrument_key AND status = 'draft' FOR UPDATE;
    IF NOT FOUND THEN
      SELECT * INTO version FROM platform_private.student_assessment_versions
        WHERE instrument_key = p_instrument_key ORDER BY published_at DESC, id DESC LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Assessment is unavailable' USING ERRCODE = '42501'; END IF;
      INSERT INTO platform.student_assessment_attempts(organization_id, student_membership_id, instrument_key, version_id)
        VALUES (actor.organization_id, actor.membership_id, p_instrument_key, version.id) RETURNING * INTO attempt;
    END IF;
  ELSE
    SELECT * INTO attempt FROM platform.student_assessment_attempts
      WHERE id = p_attempt_id AND organization_id = actor.organization_id AND student_membership_id = actor.membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assessment is unavailable' USING ERRCODE = '42501'; END IF;
    IF attempt.status <> 'draft' OR attempt.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Assessment attempt changed' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO STRICT version FROM platform_private.student_assessment_versions WHERE id = attempt.version_id;
    PERFORM platform_private.validate_student_assessment_answers(version.questions, p_answers, p_operation = 'complete');
    completed_time := CASE WHEN p_operation = 'complete' THEN clock_timestamp() ELSE NULL END;
    UPDATE platform.student_assessment_attempts SET answers = p_answers, revision = revision + 1,
      status = CASE WHEN p_operation = 'complete' THEN 'completed' ELSE 'draft' END,
      updated_at = clock_timestamp(), completed_at = completed_time,
      result_snapshot = CASE WHEN p_operation = 'complete'
        THEN platform_private.grade_student_assessment(version, p_answers, completed_time) ELSE NULL END
      WHERE id = attempt.id RETURNING * INTO attempt;
  END IF;
  response := platform_private.student_assessment_attempt_payload(attempt);
  INSERT INTO platform_private.student_assessment_requests(organization_id, student_membership_id, request_id,
    operation, input_hash, attempt_id, receipt)
    VALUES (actor.organization_id, actor.membership_id, p_request_id, p_operation, input_hash, attempt.id,
      response - 'questions' - 'metadata');
  RETURN response;
END $$;

CREATE FUNCTION platform.start_student_assessment_v1(p_instrument_key TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_student_assessment('start', p_instrument_key, NULL, NULL, NULL, p_request_id)
$$;
CREATE FUNCTION platform.save_student_assessment_answers_v1(
  p_attempt_id UUID, p_expected_revision BIGINT, p_answers JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_student_assessment('save', NULL, p_attempt_id, p_expected_revision, p_answers, p_request_id)
$$;
CREATE FUNCTION platform.complete_student_assessment_v1(
  p_attempt_id UUID, p_expected_revision BIGINT, p_answers JSONB, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.write_student_assessment('complete', NULL, p_attempt_id, p_expected_revision, p_answers, p_request_id)
$$;

REVOKE ALL ON FUNCTION platform_private.validate_student_assessment_version(),
  platform_private.guard_student_assessment_immutable(),
  platform_private.require_student_assessment_actor_read(),
  platform_private.student_assessment_public_questions(JSONB),
  platform_private.student_assessment_attempt_payload(platform.student_assessment_attempts),
  platform_private.validate_student_assessment_answers(JSONB, JSONB, BOOLEAN),
  platform_private.grade_student_assessment(platform_private.student_assessment_versions, JSONB, TIMESTAMPTZ),
  platform_private.write_student_assessment(TEXT, TEXT, UUID, BIGINT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_assessments_v1(), platform.student_assessment_attempt_v1(UUID),
  platform.start_student_assessment_v1(TEXT, UUID),
  platform.save_student_assessment_answers_v1(UUID, BIGINT, JSONB, UUID),
  platform.complete_student_assessment_v1(UUID, BIGINT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_assessments_v1(), platform.student_assessment_attempt_v1(UUID),
  platform.start_student_assessment_v1(TEXT, UUID),
  platform.save_student_assessment_answers_v1(UUID, BIGINT, JSONB, UUID),
  platform.complete_student_assessment_v1(UUID, BIGINT, JSONB, UUID) TO authenticated;

COMMIT;
