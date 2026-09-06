-- Canonical V3-F university-application country and degree facts.
--
-- The business works with a fixed set of destination countries, but until now
-- only the case knew a free-text target_country/target_degree. Every
-- university application now carries its own nullable destination-country
-- code from the exact six-country product allowlist and a machine degree key.
-- The stored type mirrors
-- student_cases.target_degree (TEXT with a format CHECK, migrations 042/088):
-- the value dictionary lives in the interface wording layer, never as a
-- second schema-level enum.

BEGIN;

ALTER TABLE platform.university_applications
  ADD COLUMN country TEXT
    CHECK (
      country IS NULL
      OR country IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    );
ALTER TABLE platform.university_applications
  ADD COLUMN degree TEXT
    CHECK (
      degree IS NULL
      OR (
        degree = btrim(degree)
        AND degree <> ''
        AND char_length(degree) <= 160
        AND degree !~ '[[:cntrl:]]'
      )
    );

-- Replace the two create signatures and the details command exactly the way
-- migration 112 replaced its predecessors: DROP the superseded signature and
-- CREATE the widened one. The audit actions (application.create and
-- application.details.update) already exist, so the Admin journal allowlist
-- is composed by earlier migrations and stays untouched here.
DROP FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, BIGINT, UUID
);
DROP FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, BIGINT, UUID
);
DROP FUNCTION platform.update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, BIGINT, UUID
);

CREATE FUNCTION private.platform_create_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_institution_name TEXT,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  previous_primary RECORD;
  created_application_id UUID := gen_random_uuid();
  normalized_institution_name TEXT := btrim(p_institution_name);
  normalized_program_name TEXT := btrim(p_program_name);
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  normalized_country TEXT := NULLIF(btrim(p_country), '');
  normalized_degree TEXT := NULLIF(btrim(p_degree), '');
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  audit_before JSONB;
  changed_at TIMESTAMPTZ;
  demoted_primary_application_id UUID;
  demoted_primary_application_previous_version BIGINT;
  demoted_primary_application_version BIGINT;
  fixed_reason CONSTANT TEXT := 'University application created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR normalized_institution_name IS NULL
    OR normalized_institution_name = ''
    OR char_length(normalized_institution_name) > 300
    OR normalized_institution_name ~ '[[:cntrl:]]'
    OR normalized_program_name IS NULL
    OR normalized_program_name = ''
    OR char_length(normalized_program_name) > 300
    OR normalized_program_name ~ '[[:cntrl:]]'
    OR p_status IS NULL
    OR p_is_primary IS NULL
    OR (
      p_university_deadline_on IS NOT NULL
      AND (
        NOT pg_catalog.isfinite(p_university_deadline_on)
        OR p_university_deadline_on < DATE '0001-01-01'
        OR p_university_deadline_on > DATE '9999-12-31'
      )
    )
    OR (
      normalized_country IS NOT NULL
      AND normalized_country NOT IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    )
    OR (
      normalized_degree IS NOT NULL
      AND (
        char_length(normalized_degree) > 160
        OR normalized_degree ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_evidence_reference IS NOT NULL
      AND (
        char_length(normalized_evidence_reference) > 1000
        OR normalized_evidence_reference ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_note IS NOT NULL
      AND (
        char_length(normalized_note) > 1000
        OR normalized_note ~ '[[:cntrl:]]'
      )
    )
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND normalized_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Application fields, geography, priority, deadline and required evidence are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'institution_name', normalized_institution_name,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree,
    'actor_membership_id', actor.actor_membership_id,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- The case row serializes creates and details updates for one case. Every
  -- application row is then locked in UUID order before a primary switch.
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_primary THEN
    PERFORM application.id
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
    ORDER BY application.id
    FOR UPDATE;
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_is_primary THEN
    SELECT application.id, application.version
    INTO previous_primary
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
      AND application.is_primary
    ORDER BY application.id
    LIMIT 1;

    IF FOUND THEN
      IF previous_primary.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'admissions_version_conflict'
          USING ERRCODE = 'PT409';
      END IF;

      demoted_primary_application_id := previous_primary.id;
      demoted_primary_application_previous_version := previous_primary.version;
      UPDATE platform.university_applications AS application
      SET is_primary = FALSE,
          version = application.version + 1
      WHERE application.organization_id = p_organization_id
        AND application.id = previous_primary.id
      RETURNING application.version
      INTO demoted_primary_application_version;
    END IF;
  END IF;

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, institution_name, program_name,
    status, latest_evidence_reference, created_by_membership_id, version,
    is_primary, university_deadline_on, country, degree
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    normalized_institution_name, normalized_program_name, p_status,
    normalized_evidence_reference, actor.actor_membership_id, 1,
    p_is_primary, p_university_deadline_on, normalized_country,
    normalized_degree
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.university_application_events (
    organization_id, application_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_application_id, p_student_case_id, NULL,
    p_status, normalized_evidence_reference, normalized_note,
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'university_application_id', created_application_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_version::TEXT
  );
  IF demoted_primary_application_id IS NOT NULL THEN
    audit_before := jsonb_build_object(
      'demoted_primary_application_id', demoted_primary_application_id,
      'demoted_primary_application_version',
        demoted_primary_application_previous_version::TEXT,
      'demoted_primary_is_primary', TRUE
    );
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, audit_before, result,
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION private.platform_create_catalog_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_catalog_institution_id UUID,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  catalog_row platform.catalog_institutions%ROWTYPE;
  previous_primary RECORD;
  normalized_program_name TEXT := btrim(p_program_name);
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  normalized_country TEXT := NULLIF(btrim(p_country), '');
  normalized_degree TEXT := NULLIF(btrim(p_degree), '');
  input_sha256 TEXT;
  replayed JSONB;
  replay_shape JSONB;
  created_application_id UUID := gen_random_uuid();
  result JSONB;
  audit_before JSONB;
  changed_at TIMESTAMPTZ;
  demoted_primary_application_id UUID;
  demoted_primary_application_previous_version BIGINT;
  demoted_primary_application_version BIGINT;
  fixed_reason CONSTANT TEXT :=
    'Catalog-backed university application created';
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_catalog_institution_id IS NULL
    OR normalized_program_name IS NULL
    OR normalized_program_name = ''
    OR char_length(normalized_program_name) > 300
    OR normalized_program_name ~ '[[:cntrl:]]'
    OR p_status IS NULL
    OR p_is_primary IS NULL
    OR (
      p_university_deadline_on IS NOT NULL
      AND (
        NOT pg_catalog.isfinite(p_university_deadline_on)
        OR p_university_deadline_on < DATE '0001-01-01'
        OR p_university_deadline_on > DATE '9999-12-31'
      )
    )
    OR (
      normalized_country IS NOT NULL
      AND normalized_country NOT IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    )
    OR (
      normalized_degree IS NOT NULL
      AND (
        char_length(normalized_degree) > 160
        OR normalized_degree ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_evidence_reference IS NOT NULL
      AND (
        char_length(normalized_evidence_reference) > 1000
        OR normalized_evidence_reference ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_note IS NOT NULL
      AND (
        char_length(normalized_note) > 1000
        OR normalized_note ~ '[[:cntrl:]]'
      )
    )
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND normalized_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Catalog application fields, geography, priority, deadline and evidence are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree
  ));
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );

  replayed := platform_private.replay_audit(
    p_request_id, 'application.create', 'university_application',
    NULL, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_primary THEN
    PERFORM application.id
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
    ORDER BY application.id
    FOR UPDATE;
  END IF;

  SELECT * INTO catalog_row
  FROM platform.catalog_institutions AS institution
  WHERE institution.organization_id = p_organization_id
    AND institution.id = p_catalog_institution_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved catalog institution is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'institution_name', catalog_row.institution_name,
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'application.create', 'university_application',
    NULL, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_is_primary THEN
    SELECT application.id, application.version
    INTO previous_primary
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
      AND application.is_primary
    ORDER BY application.id
    LIMIT 1;

    IF FOUND THEN
      IF previous_primary.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'admissions_version_conflict'
          USING ERRCODE = 'PT409';
      END IF;

      demoted_primary_application_id := previous_primary.id;
      demoted_primary_application_previous_version := previous_primary.version;
      UPDATE platform.university_applications AS application
      SET is_primary = FALSE,
          version = application.version + 1
      WHERE application.organization_id = p_organization_id
        AND application.id = previous_primary.id
      RETURNING application.version
      INTO demoted_primary_application_version;
    END IF;
  END IF;

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, catalog_institution_id,
    institution_name, program_name, status, latest_evidence_reference,
    created_by_membership_id, version, is_primary, university_deadline_on,
    country, degree
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    p_catalog_institution_id, catalog_row.institution_name,
    normalized_program_name, p_status, normalized_evidence_reference,
    actor.actor_membership_id, 1, p_is_primary, p_university_deadline_on,
    normalized_country, normalized_degree
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.university_application_events (
    organization_id, application_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_application_id, p_student_case_id, NULL, p_status,
    normalized_evidence_reference, normalized_note,
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'university_application_id', created_application_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_version::TEXT
  );
  IF demoted_primary_application_id IS NOT NULL THEN
    audit_before := jsonb_build_object(
      'demoted_primary_application_id', demoted_primary_application_id,
      'demoted_primary_application_version',
        demoted_primary_application_previous_version::TEXT,
      'demoted_primary_is_primary', TRUE
    );
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, audit_before, result,
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION private.platform_update_university_application_details(
  p_organization_id UUID,
  p_university_application_id UUID,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_actor RECORD;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  application_row platform.university_applications%ROWTYPE;
  previous_primary RECORD;
  target_student_case_id UUID;
  normalized_country TEXT := NULLIF(btrim(p_country), '');
  normalized_degree TEXT := NULLIF(btrim(p_degree), '');
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  audit_before JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  demoted_primary_application_id UUID;
  demoted_primary_application_previous_version BIGINT;
  demoted_primary_application_version BIGINT;
  fixed_reason CONSTANT TEXT := 'University application details updated';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_university_application_id IS NULL
    OR p_is_primary IS NULL
    OR (
      p_university_deadline_on IS NOT NULL
      AND (
        NOT pg_catalog.isfinite(p_university_deadline_on)
        OR p_university_deadline_on < DATE '0001-01-01'
        OR p_university_deadline_on > DATE '9999-12-31'
      )
    )
    OR (
      normalized_country IS NOT NULL
      AND normalized_country NOT IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    )
    OR (
      normalized_degree IS NOT NULL
      AND (
        char_length(normalized_degree) > 160
        OR normalized_degree ~ '[[:cntrl:]]'
      )
    )
  THEN
    RAISE EXCEPTION
      'Application priority, deadline, country and degree are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'application.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'university_application_id', p_university_application_id,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  SELECT application.student_case_id
  INTO target_student_case_id
  FROM platform.university_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_university_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'University application is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Authorize the exact case before taking its serialization lock. Repeat the
  -- check after the lock so a concurrent authority change still fails closed.
  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    target_student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'application.details.update', 'university_application',
    p_university_application_id, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = target_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM application.id
  FROM platform.university_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.student_case_id = target_student_case_id
  ORDER BY application.id
  FOR UPDATE;

  SELECT * INTO application_row
  FROM platform.university_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_university_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'University application is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    application_row.student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'application.details.update', 'university_application',
    p_university_application_id, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF application_row.version <> p_expected_version
    OR application_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF application_row.is_primary IS NOT DISTINCT FROM p_is_primary
    AND application_row.university_deadline_on
      IS NOT DISTINCT FROM p_university_deadline_on
    AND application_row.country IS NOT DISTINCT FROM normalized_country
    AND application_row.degree IS NOT DISTINCT FROM normalized_degree
  THEN
    RAISE EXCEPTION 'Application details must change'
      USING ERRCODE = '22023';
  END IF;

  IF p_is_primary AND NOT application_row.is_primary THEN
    SELECT application.id, application.version
    INTO previous_primary
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = target_student_case_id
      AND application.is_primary
      AND application.id <> p_university_application_id
    ORDER BY application.id
    LIMIT 1;

    IF FOUND THEN
      IF previous_primary.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'admissions_version_conflict'
          USING ERRCODE = 'PT409';
      END IF;

      demoted_primary_application_id := previous_primary.id;
      demoted_primary_application_previous_version := previous_primary.version;
      UPDATE platform.university_applications AS application
      SET is_primary = FALSE,
          version = application.version + 1
      WHERE application.organization_id = p_organization_id
        AND application.id = previous_primary.id
      RETURNING application.version
      INTO demoted_primary_application_version;
    END IF;
  END IF;

  UPDATE platform.university_applications AS application
  SET is_primary = p_is_primary,
      university_deadline_on = p_university_deadline_on,
      country = normalized_country,
      degree = normalized_degree,
      version = application_row.version + 1
  WHERE application.organization_id = p_organization_id
    AND application.id = p_university_application_id
  RETURNING application.version, application.updated_at
  INTO next_version, changed_at;

  audit_before := jsonb_build_object(
    'status', application_row.status,
    'evidence_reference', application_row.latest_evidence_reference,
    'is_primary', application_row.is_primary,
    'university_deadline_on', application_row.university_deadline_on,
    'country', application_row.country,
    'degree', application_row.degree,
    'version', application_row.version::TEXT,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_previous_version::TEXT
  );
  result := replay_shape || jsonb_build_object(
    'student_case_id', application_row.student_case_id,
    'status', application_row.status,
    'evidence_reference', application_row.latest_evidence_reference,
    'version', next_version::TEXT,
    'changed_at', changed_at,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_version::TEXT
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'application.details.update', 'university_application',
    p_university_application_id,
    audit_before, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

-- Keep the Data API surface invoker-only. The privileged implementations live
-- in the non-exposed private schema, re-derive actor/tenant authority inside
-- their bodies and remain unreachable to anon/service roles.
CREATE FUNCTION platform.create_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_institution_name TEXT,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.platform_create_university_application(
    p_organization_id,
    p_student_case_id,
    p_institution_name,
    p_program_name,
    p_status,
    p_evidence_reference,
    p_note,
    p_is_primary,
    p_university_deadline_on,
    p_country,
    p_degree,
    p_expected_version,
    p_request_id
  )
$$;

CREATE FUNCTION platform.create_catalog_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_catalog_institution_id UUID,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.platform_create_catalog_university_application(
    p_organization_id,
    p_student_case_id,
    p_catalog_institution_id,
    p_program_name,
    p_status,
    p_evidence_reference,
    p_note,
    p_is_primary,
    p_university_deadline_on,
    p_country,
    p_degree,
    p_expected_version,
    p_request_id
  )
$$;

CREATE FUNCTION platform.update_university_application_details(
  p_organization_id UUID,
  p_university_application_id UUID,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.platform_update_university_application_details(
    p_organization_id,
    p_university_application_id,
    p_is_primary,
    p_university_deadline_on,
    p_country,
    p_degree,
    p_expected_version,
    p_request_id
  )
$$;

REVOKE ALL ON FUNCTION private.platform_create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.platform_create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT,
  BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.platform_update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

-- Return-shape changes require replacing both staff projection functions.
-- The argument signatures stay exactly as migration 078/112 fixed them.
DROP FUNCTION platform.staff_application_snapshot(UUID);
DROP FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
);

CREATE FUNCTION private.platform_staff_application_page(
  p_limit INTEGER,
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_before_application_id UUID DEFAULT NULL,
  p_status platform.application_status DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL,
  p_application_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF (p_before_updated_at IS NULL) <> (p_before_application_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete application cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT application.*
    FROM platform.current_actor_authority() AS authority
    JOIN platform.university_applications AS application
      ON application.organization_id = authority.organization_id
    WHERE private.platform_can_read_student_case(
      application.organization_id,
      application.student_case_id
    )
      AND (p_status IS NULL OR application.status = p_status)
      AND (
        p_student_case_id IS NULL
        OR application.student_case_id = p_student_case_id
      )
      AND (p_application_id IS NULL OR application.id = p_application_id)
      AND (
        p_before_updated_at IS NULL
        OR (application.updated_at, application.id)
          < (p_before_updated_at, p_before_application_id)
      )
    ORDER BY application.updated_at DESC, application.id DESC
    LIMIT p_limit
  )
  SELECT
    application.organization_id,
    application.id,
    application.version::TEXT,
    application.student_case_id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    application.institution_name,
    application.program_name,
    application.status,
    application.latest_evidence_reference,
    application.is_primary,
    application.university_deadline_on,
    application.country,
    application.degree,
    application.created_at,
    application.updated_at,
    sales_profile.display_name,
    curator_profile.display_name,
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
        AND slot.status <> 'approved'
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    )
  FROM page AS application
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = application.organization_id
    AND student_case.id = application.student_case_id
  JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id = student_case.responsible_sales_membership_id
  JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  LEFT JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id = student_case.current_curator_membership_id
  LEFT JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  ORDER BY application.updated_at DESC, application.id DESC;
END
$$;

CREATE FUNCTION private.platform_staff_application_snapshot(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.platform_staff_application_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_university_application_id
  ) AS page
$$;

CREATE FUNCTION platform.staff_application_page(
  p_limit INTEGER,
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_before_application_id UUID DEFAULT NULL,
  p_status platform.application_status DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL,
  p_application_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.platform_staff_application_page(
    p_limit,
    p_before_updated_at,
    p_before_application_id,
    p_status,
    p_student_case_id,
    p_application_id
  ) AS page
$$;

CREATE FUNCTION platform.staff_application_snapshot(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT snapshot.*
  FROM private.platform_staff_application_snapshot(
    p_university_application_id
  ) AS snapshot
$$;

REVOKE ALL ON FUNCTION private.platform_staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) TO authenticated;
REVOKE ALL ON FUNCTION private.platform_staff_application_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_staff_application_snapshot(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_application_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_snapshot(UUID)
  TO authenticated;

COMMENT ON COLUMN platform.university_applications.country IS
  'Nullable destination country of this exact application; limited to the product allowlist CN, MY, AE, TR, IT and CZ.';
COMMENT ON COLUMN platform.university_applications.degree IS
  'Nullable machine degree key of this exact application, stored as the same free TEXT shape as student_cases.target_degree; no schema-level enum.';
COMMENT ON FUNCTION platform.update_university_application_details(
  UUID, UUID, BOOLEAN, DATE, TEXT, TEXT, BIGINT, UUID
) IS
  'Optimistically updates priority/deadline/country/degree facts, serializes primary switches and never fabricates a status event.';

COMMIT;
