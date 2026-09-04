-- V3-D canonical optimistic-concurrency boundary for mutable Admissions rows.

ALTER TABLE platform.case_tasks ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE platform.case_tasks
  ADD CONSTRAINT case_tasks_version_positive CHECK (version > 0);
ALTER TABLE platform.university_applications
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE platform.university_applications
  ADD CONSTRAINT university_applications_version_positive CHECK (version > 0);
ALTER TABLE platform.visa_cases ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE platform.visa_cases
  ADD CONSTRAINT visa_cases_version_positive CHECK (version > 0);
ALTER TABLE platform.stop_factors ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE platform.stop_factors
  ADD CONSTRAINT stop_factors_version_positive CHECK (version > 0);

-- Replace the superseded command signatures instead of hiding them behind
-- compatibility wrappers. The functions below are the only active write path.
DROP FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT, UUID
);
DROP FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT, UUID
);
DROP FUNCTION platform.change_university_application(
  UUID, UUID, platform.application_status, TEXT, TEXT, UUID
);
DROP FUNCTION platform.create_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, UUID
);
DROP FUNCTION platform.change_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, UUID
);
DROP FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority,
  TIMESTAMPTZ, platform.case_task_status, BOOLEAN, UUID
);
DROP FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID,
  platform.case_task_priority, TIMESTAMPTZ, BOOLEAN, UUID
);
DROP FUNCTION platform.resolve_case_stop_factor(
  UUID, UUID, UUID, platform.stop_factor_resolution_kind,
  UUID, TEXT, TEXT, UUID
);
DROP FUNCTION platform.assert_case_finance_stop_factor(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID
);
DROP FUNCTION platform.resolve_stop_factor(
  UUID, UUID, platform.stop_factor_resolution_kind, UUID, TEXT, TEXT, UUID
);
DROP FUNCTION platform.create_stop_factor(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID
);

CREATE FUNCTION platform.create_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_institution_name TEXT,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  created_application_id UUID := gen_random_uuid();
  normalized_institution_name TEXT := btrim(p_institution_name);
  normalized_program_name TEXT := btrim(p_program_name);
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
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
      'Application fields and required external-status evidence are required'
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

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
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

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, institution_name, program_name,
    status, latest_evidence_reference, created_by_membership_id, version
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    normalized_institution_name, normalized_program_name, p_status,
    normalized_evidence_reference, actor.actor_membership_id, 1
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
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, NULL, result,
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.assert_case_finance_stop_factor(
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_reason TEXT,
  p_blocked_action TEXT,
  p_next_action TEXT,
  p_evidence_ref TEXT,
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
  readable_case platform.student_cases%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  created_stop_factor_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_request_id IS NULL
    OR p_student_case_id IS NULL
    OR p_payment_obligation_id IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_blocked_action IS NULL
    OR char_length(btrim(p_blocked_action)) NOT BETWEEN 1 AND 200
    OR p_blocked_action ~ '[[:cntrl:]]'
    OR p_next_action IS NULL
    OR char_length(btrim(p_next_action)) NOT BETWEEN 1 AND 1000
    OR p_next_action ~ '[[:cntrl:]]'
    OR p_evidence_ref IS NULL
    OR char_length(btrim(p_evidence_ref)) NOT BETWEEN 1 AND 1000
    OR p_evidence_ref ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete finance stop fields and evidence are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT * INTO actor
  FROM platform.current_actor_authority();
  IF NOT FOUND
    OR actor.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'case.read.full'
    )
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'finance.read.summary'
    )
  THEN
    RAISE EXCEPTION 'Finance stop assertion authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT student_case.* INTO readable_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case finance control is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', p_student_case_id,
    'payment_obligation_id', p_payment_obligation_id,
    'reason', btrim(p_reason),
    'blocked_action', btrim(p_blocked_action),
    'next_action', btrim(p_next_action),
    'created_evidence_ref', btrim(p_evidence_ref),
    'status', 'active',
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.create',
    'stop_factor',
    NULL,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND student_case.state = 'active'
    AND student_case.handoff_at IS NOT NULL
    AND student_case.current_curator_membership_id IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
    AND EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS owner_membership
      JOIN platform.profiles AS owner_profile
        ON owner_profile.id = owner_membership.profile_id
      JOIN platform.role_bundle_versions AS owner_bundle
        ON owner_bundle.id = owner_membership.current_bundle_id
        AND owner_bundle.role = owner_membership."current_role"
      WHERE owner_membership.organization_id = student_case.organization_id
        AND owner_membership.id = student_case.current_curator_membership_id
        AND owner_membership.status = 'active'
        AND owner_membership."current_role" = 'curator'
        AND owner_profile.status = 'active'
        AND owner_bundle.status = 'published'
    )
  FOR UPDATE OF student_case;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active handed-off student case is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = target_case.organization_id
    AND obligation.id = p_payment_obligation_id
    AND obligation.student_case_id = target_case.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replay_shape := replay_shape || jsonb_build_object(
    'owner_membership_id', target_case.current_curator_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.create',
    'stop_factor',
    NULL,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.stop_factors (
    id, organization_id, student_case_id, payment_obligation_id, status,
    reason, owner_membership_id, blocked_action, next_action,
    created_evidence_ref, created_by_membership_id, version
  ) VALUES (
    created_stop_factor_id, target_case.organization_id, target_case.id,
    p_payment_obligation_id, 'active', btrim(p_reason),
    target_case.current_curator_membership_id, btrim(p_blocked_action),
    btrim(p_next_action), btrim(p_evidence_ref), actor.membership_id, 1
  );

  INSERT INTO platform.stop_factor_events (
    organization_id, student_case_id, payment_obligation_id, stop_factor_id,
    previous_status, new_status, resolution_kind,
    resolution_payment_event_id, evidence_ref, reason, actor_membership_id,
    request_id
  ) VALUES (
    target_case.organization_id, target_case.id, p_payment_obligation_id,
    created_stop_factor_id, NULL, 'active', NULL, NULL,
    btrim(p_evidence_ref), btrim(p_reason), actor.membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'stop_factor_id', created_stop_factor_id,
    'version', 1::BIGINT::TEXT
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    target_case.organization_id, 'user', actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT, 'finance.stop.create',
    'stop_factor', created_stop_factor_id, NULL, result, btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.resolve_case_stop_factor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_stop_factor_id UUID,
  p_resolution_kind platform.stop_factor_resolution_kind,
  p_payment_event_id UUID,
  p_reason TEXT,
  p_evidence_ref TEXT,
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
  obligation_row platform.payment_obligations%ROWTYPE;
  stop_row platform.stop_factors%ROWTYPE;
  payment_row platform.payment_events%ROWTYPE;
  payment_evidence_ref TEXT;
  replayed JSONB;
  replay_shape JSONB;
  resolved_evidence_ref TEXT;
  resolved_at_value TIMESTAMPTZ;
  next_version BIGINT;
  result JSONB;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_stop_factor_id IS NULL
    OR p_resolution_kind IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR (
      p_resolution_kind = 'payment_event'
      AND (
        p_payment_event_id IS NULL
        OR p_evidence_ref IS NOT NULL
      )
    )
    OR (
      p_resolution_kind = 'admin_override'
      AND (
        p_payment_event_id IS NOT NULL
        OR p_evidence_ref IS NULL
        OR btrim(p_evidence_ref) = ''
        OR char_length(btrim(p_evidence_ref)) > 1000
        OR p_evidence_ref ~ '[[:cntrl:]]'
      )
    )
  THEN
    RAISE EXCEPTION
      'Valid payment-event or Admin-override resolution is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT * INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );
  IF actor.actor_role <> 'admin' THEN
    RAISE EXCEPTION 'Admin finance stop release authority is required'
      USING ERRCODE = '42501';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'stop_factor_id', p_stop_factor_id,
    'student_case_id', p_student_case_id,
    'resolution_kind', p_resolution_kind,
    'payment_event_id', p_payment_event_id,
    'reason', btrim(p_reason),
    'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
    'status', 'resolved',
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.resolve',
    'stop_factor',
    p_stop_factor_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-bound stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO stop_row
  FROM platform.stop_factors AS stop
  WHERE stop.organization_id = p_organization_id
    AND stop.student_case_id = p_student_case_id
    AND stop.id = p_stop_factor_id
  FOR UPDATE;
  IF NOT FOUND OR stop_row.status <> 'active' THEN
    RAISE EXCEPTION 'Active stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO obligation_row
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = stop_row.payment_obligation_id
    AND obligation.student_case_id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );
  IF actor.actor_role <> 'admin' THEN
    RAISE EXCEPTION 'Admin finance stop release authority is required'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.resolve',
    'stop_factor',
    p_stop_factor_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF stop_row.version <> p_expected_version
    OR stop_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_resolution_kind = 'payment_event' THEN
    SELECT * INTO payment_row
    FROM platform.payment_events AS payment
    WHERE payment.organization_id = p_organization_id
      AND payment.id = p_payment_event_id
      AND payment.student_case_id = p_student_case_id
      AND payment.payment_obligation_id = obligation_row.id
      AND payment.event_type = 'payment'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked confirmed payment event is unavailable'
        USING ERRCODE = '22023';
    END IF;

    SELECT evidence.evidence_ref INTO payment_evidence_ref
    FROM platform.payment_evidence AS evidence
    WHERE evidence.organization_id = p_organization_id
      AND evidence.payment_event_id = p_payment_event_id
      AND evidence.student_case_id = p_student_case_id
      AND evidence.payment_obligation_id = obligation_row.id
    ORDER BY evidence.created_at, evidence.id
    LIMIT 1
    FOR UPDATE;
    IF payment_evidence_ref IS NULL THEN
      RAISE EXCEPTION 'Linked payment evidence is unavailable'
        USING ERRCODE = '22023';
    END IF;
    resolved_evidence_ref := payment_evidence_ref;
  ELSE
    resolved_evidence_ref := btrim(p_evidence_ref);
  END IF;

  UPDATE platform.stop_factors AS stop
  SET status = 'resolved',
      resolution_kind = p_resolution_kind,
      resolution_payment_event_id = p_payment_event_id,
      resolution_reason = btrim(p_reason),
      resolution_evidence_ref = CASE
        WHEN p_resolution_kind = 'admin_override'
        THEN resolved_evidence_ref
        ELSE NULL
      END,
      resolved_by_membership_id = actor.actor_membership_id,
      resolved_at = statement_timestamp(),
      version = stop_row.version + 1
  WHERE stop.organization_id = p_organization_id
    AND stop.student_case_id = p_student_case_id
    AND stop.id = p_stop_factor_id
  RETURNING stop.resolved_at, stop.version
  INTO resolved_at_value, next_version;

  INSERT INTO platform.stop_factor_events (
    organization_id, student_case_id, payment_obligation_id, stop_factor_id,
    previous_status, new_status, resolution_kind,
    resolution_payment_event_id, evidence_ref, reason, actor_membership_id,
    request_id
  ) VALUES (
    p_organization_id, p_student_case_id, obligation_row.id, p_stop_factor_id,
    'active', 'resolved', p_resolution_kind, p_payment_event_id,
    resolved_evidence_ref, btrim(p_reason), actor.actor_membership_id,
    p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'payment_obligation_id', obligation_row.id,
    'resolved_at', resolved_at_value,
    'version', next_version::TEXT
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'finance.stop.resolve',
    'stop_factor', p_stop_factor_id,
    jsonb_build_object(
      'status', stop_row.status,
      'resolution_kind', stop_row.resolution_kind,
      'resolved_at', stop_row.resolved_at,
      'version', stop_row.version::TEXT
    ),
    result, btrim(p_reason), p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.create_catalog_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_catalog_institution_id UUID,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  normalized_program_name TEXT := btrim(p_program_name);
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  input_sha256 TEXT;
  replayed JSONB;
  replay_shape JSONB;
  created_application_id UUID := gen_random_uuid();
  result JSONB;
  changed_at TIMESTAMPTZ;
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
      'Catalog application fields and required evidence are invalid'
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
    'note', normalized_note
  ));
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
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

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, catalog_institution_id,
    institution_name, program_name, status, latest_evidence_reference,
    created_by_membership_id, version
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    p_catalog_institution_id, catalog_row.institution_name,
    normalized_program_name, p_status, normalized_evidence_reference,
    actor.actor_membership_id, 1
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
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, NULL, result, fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.change_university_application(
  p_organization_id UUID,
  p_application_id UUID,
  p_new_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  application_row platform.university_applications%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'University application status changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_new_status IS NULL
    OR (
      platform_private.application_status_needs_evidence(p_new_status)
      AND NULLIF(btrim(p_evidence_reference), '') IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Application status and required external-status evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'application.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'university_application_id', p_application_id,
    'status', p_new_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), ''),
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'application.status.change', 'university_application',
    p_application_id, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO application_row
  FROM platform.university_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
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
  replayed := platform_private.replay_audit(
    p_request_id, 'application.status.change', 'university_application',
    p_application_id, fixed_reason, replay_shape
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
  IF application_row.status = p_new_status THEN
    RAISE EXCEPTION 'Application status must change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.university_applications AS application
  SET status = p_new_status,
      latest_evidence_reference = COALESCE(
        NULLIF(btrim(p_evidence_reference), ''),
        application_row.latest_evidence_reference
      ),
      version = application_row.version + 1
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  RETURNING application.version, application.updated_at
  INTO next_version, changed_at;

  INSERT INTO platform.university_application_events (
    organization_id, application_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, p_application_id, application_row.student_case_id,
    application_row.status, p_new_status,
    NULLIF(btrim(p_evidence_reference), ''), NULLIF(btrim(p_note), ''),
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'student_case_id', application_row.student_case_id,
    'version', next_version::TEXT,
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'application.status.change', 'university_application', p_application_id,
    jsonb_build_object(
      'status', application_row.status,
      'evidence_reference', application_row.latest_evidence_reference,
      'version', application_row.version::TEXT
    ),
    result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.create_visa_case(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_status platform.visa_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  created_visa_case_id UUID := gen_random_uuid();
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Visa case created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_status IS NULL
    OR (
      platform_private.visa_status_needs_evidence(p_status)
      AND NULLIF(btrim(p_evidence_reference), '') IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Visa status and required external-decision evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'visa.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'status', p_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), ''),
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'visa.create', 'visa_case', NULL,
    fixed_reason, replay_shape
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

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'visa.manage'
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'visa.create', 'visa_case', NULL,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.visa_cases (
    id, organization_id, student_case_id, status,
    latest_evidence_reference, created_by_membership_id, version
  ) VALUES (
    created_visa_case_id, p_organization_id, p_student_case_id, p_status,
    NULLIF(btrim(p_evidence_reference), ''), actor.actor_membership_id, 1
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.visa_case_events (
    organization_id, visa_case_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_visa_case_id, p_student_case_id, NULL, p_status,
    NULLIF(btrim(p_evidence_reference), ''), NULLIF(btrim(p_note), ''),
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'visa_case_id', created_visa_case_id,
    'version', 1::BIGINT::TEXT
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'visa.create', 'visa_case',
    created_visa_case_id, NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.change_visa_case(
  p_organization_id UUID,
  p_visa_case_id UUID,
  p_new_status platform.visa_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  visa_row platform.visa_cases%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Visa status changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_new_status IS NULL
    OR (
      platform_private.visa_status_needs_evidence(p_new_status)
      AND NULLIF(btrim(p_evidence_reference), '') IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Visa status and required external-decision evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'visa.manage'
  );
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'visa_case_id', p_visa_case_id,
    'status', p_new_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), ''),
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'visa.status.change', 'visa_case', p_visa_case_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO visa_row
  FROM platform.visa_cases AS visa
  WHERE visa.organization_id = p_organization_id
    AND visa.id = p_visa_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visa case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    visa_row.student_case_id,
    'visa.manage'
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'visa.status.change', 'visa_case', p_visa_case_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF visa_row.version <> p_expected_version
    OR visa_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF visa_row.status = p_new_status THEN
    RAISE EXCEPTION 'Visa status must change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.visa_cases AS visa
  SET status = p_new_status,
      latest_evidence_reference = COALESCE(
        NULLIF(btrim(p_evidence_reference), ''),
        visa_row.latest_evidence_reference
      ),
      version = visa_row.version + 1
  WHERE visa.organization_id = p_organization_id
    AND visa.id = p_visa_case_id
  RETURNING visa.version, visa.updated_at
  INTO next_version, changed_at;

  INSERT INTO platform.visa_case_events (
    organization_id, visa_case_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, p_visa_case_id, visa_row.student_case_id,
    visa_row.status, p_new_status, NULLIF(btrim(p_evidence_reference), ''),
    NULLIF(btrim(p_note), ''), actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'student_case_id', visa_row.student_case_id,
    'version', next_version::TEXT
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'visa.status.change',
    'visa_case', p_visa_case_id,
    jsonb_build_object(
      'status', visa_row.status,
      'evidence_reference', visa_row.latest_evidence_reference,
      'version', visa_row.version::TEXT
    ),
    result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.create_case_task(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_task_type TEXT,
  p_title TEXT,
  p_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_status platform.case_task_status,
  p_student_visible BOOLEAN,
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
  assignee RECORD;
  created_case_task_id UUID := gen_random_uuid();
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Student case task created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_task_type IS NULL
    OR btrim(p_task_type) = ''
    OR p_title IS NULL
    OR btrim(p_title) = ''
    OR p_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_status IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task type, title, assignee, priority, status and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'task_type', btrim(p_task_type),
    'title', btrim(p_title),
    'assignee_membership_id', p_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'status', p_status,
    'student_visible', p_student_visible,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'task.create', 'case_task', NULL,
    fixed_reason, replay_shape
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

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );
  SELECT * INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_assignee_membership_id
  );
  IF actor.actor_role <> 'admin'
    AND p_assignee_membership_id <> actor.actor_membership_id
  THEN
    RAISE EXCEPTION 'Non-Admin case owner may assign a task only to self'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'task.create', 'case_task', NULL,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.case_tasks (
    id, organization_id, student_case_id, task_type, title,
    assignee_membership_id, priority, due_at, status, student_visible,
    created_by_membership_id, version
  ) VALUES (
    created_case_task_id, p_organization_id, p_student_case_id, btrim(p_task_type),
    btrim(p_title), p_assignee_membership_id, p_priority, p_due_at, p_status,
    p_student_visible, actor.actor_membership_id, 1
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.case_task_events (
    organization_id, case_task_id, student_case_id, previous_status,
    new_status, previous_assignee_membership_id,
    new_assignee_membership_id, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_case_task_id, p_student_case_id, NULL, p_status,
    NULL, p_assignee_membership_id, actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'case_task_id', created_case_task_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'task.create', 'case_task',
    created_case_task_id, NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.change_case_task(
  p_organization_id UUID,
  p_case_task_id UUID,
  p_new_status platform.case_task_status,
  p_new_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_student_visible BOOLEAN,
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
  task_row platform.case_tasks%ROWTYPE;
  assignee RECORD;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Student case task changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_new_status IS NULL
    OR p_new_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task status, assignee, priority and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'task.manage'
  );
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'case_task_id', p_case_task_id,
    'status', p_new_status,
    'assignee_membership_id', p_new_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'student_visible', p_student_visible,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'task.change', 'case_task', p_case_task_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO task_row
  FROM platform.case_tasks AS task
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case task is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    task_row.student_case_id,
    'task.manage'
  );
  SELECT * INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_new_assignee_membership_id
  );
  IF actor.actor_role <> 'admin'
    AND (
      task_row.assignee_membership_id <> actor.actor_membership_id
      OR p_new_assignee_membership_id <> actor.actor_membership_id
      OR task_row.priority <> p_priority
      OR task_row.due_at IS DISTINCT FROM p_due_at
      OR task_row.student_visible <> p_student_visible
    )
  THEN
    RAISE EXCEPTION
      'A live non-Admin task assignee may change only own task status'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'task.change', 'case_task', p_case_task_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF task_row.version <> p_expected_version
    OR task_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF task_row.status = p_new_status
    AND task_row.assignee_membership_id = p_new_assignee_membership_id
    AND task_row.priority = p_priority
    AND task_row.due_at IS NOT DISTINCT FROM p_due_at
    AND task_row.student_visible = p_student_visible
  THEN
    RAISE EXCEPTION 'Task mutation must change at least one field'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.case_tasks AS task
  SET status = p_new_status,
      assignee_membership_id = p_new_assignee_membership_id,
      priority = p_priority,
      due_at = p_due_at,
      student_visible = p_student_visible,
      version = task_row.version + 1
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id
  RETURNING task.version, task.updated_at INTO next_version, changed_at;

  INSERT INTO platform.case_task_events (
    organization_id, case_task_id, student_case_id, previous_status,
    new_status, previous_assignee_membership_id,
    new_assignee_membership_id, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, p_case_task_id, task_row.student_case_id,
    task_row.status, p_new_status, task_row.assignee_membership_id,
    p_new_assignee_membership_id, actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'student_case_id', task_row.student_case_id,
    'version', next_version::TEXT,
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'task.change', 'case_task',
    p_case_task_id,
    jsonb_build_object(
      'status', task_row.status,
      'assignee_membership_id', task_row.assignee_membership_id,
      'priority', task_row.priority,
      'due_at', task_row.due_at,
      'student_visible', task_row.student_visible,
      'version', task_row.version::TEXT
    ),
    result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_university_application(
  UUID, UUID, TEXT, TEXT, platform.application_status, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_catalog_university_application(
  UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_university_application(
  UUID, UUID, platform.application_status, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_university_application(
  UUID, UUID, platform.application_status, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_visa_case(
  UUID, UUID, platform.visa_status, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, BOOLEAN, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, BOOLEAN, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.assert_case_finance_stop_factor(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assert_case_finance_stop_factor(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.resolve_case_stop_factor(
  UUID, UUID, UUID, platform.stop_factor_resolution_kind, UUID, TEXT, TEXT,
  BIGINT, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.resolve_case_stop_factor(
  UUID, UUID, UUID, platform.stop_factor_resolution_kind, UUID, TEXT, TEXT,
  BIGINT, UUID
) TO authenticated;

-- Every mutable row version crosses PostgREST as decimal text. BIGINT remains
-- the database concurrency type without exposing unsafe JSON numbers.
DROP FUNCTION platform.staff_case_task_queue(INTEGER);
CREATE FUNCTION platform.staff_case_task_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  case_task_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  task_type TEXT,
  title TEXT,
  status platform.case_task_status,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  student_visible BOOLEAN,
  assignee_membership_id UUID,
  assignee_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN
    RAISE EXCEPTION 'Task queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('task.manage');

  RETURN QUERY
  SELECT
    case_task.updated_at,
    case_task.organization_id,
    case_task.id,
    case_task.version::TEXT,
    case_task.student_case_id,
    student_case.student_display_name,
    student_case.state,
    case_task.task_type,
    case_task.title,
    case_task.status,
    case_task.priority,
    case_task.due_at,
    case_task.student_visible,
    case_task.assignee_membership_id,
    assignee_profile.display_name,
    case_task.created_at,
    case_task.updated_at
  FROM platform.case_tasks AS case_task
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = case_task.organization_id
    AND student_case.id = case_task.student_case_id
  JOIN platform.organization_memberships AS assignee_membership
    ON assignee_membership.organization_id = case_task.organization_id
    AND assignee_membership.id = case_task.assignee_membership_id
  JOIN platform.profiles AS assignee_profile
    ON assignee_profile.id = assignee_membership.profile_id
  WHERE case_task.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY case_task.updated_at DESC, case_task.id DESC
  LIMIT p_limit;
END
$$;
REVOKE ALL ON FUNCTION platform.staff_case_task_queue(INTEGER)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_queue(INTEGER)
  TO authenticated;

DROP FUNCTION platform.staff_visa_queue(INTEGER);
CREATE FUNCTION platform.staff_visa_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  visa_case_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  status platform.visa_status,
  latest_evidence_reference TEXT,
  created_by_membership_id UUID,
  created_by_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN
    RAISE EXCEPTION 'Visa queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('visa.manage');

  RETURN QUERY
  SELECT
    visa_case.updated_at,
    visa_case.organization_id,
    visa_case.id,
    visa_case.version::TEXT,
    visa_case.student_case_id,
    student_case.student_display_name,
    student_case.state,
    visa_case.status,
    visa_case.latest_evidence_reference,
    visa_case.created_by_membership_id,
    creator_profile.display_name,
    visa_case.created_at,
    visa_case.updated_at
  FROM platform.visa_cases AS visa_case
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = visa_case.organization_id
    AND student_case.id = visa_case.student_case_id
  JOIN platform.organization_memberships AS creator_membership
    ON creator_membership.organization_id = visa_case.organization_id
    AND creator_membership.id = visa_case.created_by_membership_id
  JOIN platform.profiles AS creator_profile
    ON creator_profile.id = creator_membership.profile_id
  WHERE visa_case.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY visa_case.updated_at DESC, visa_case.id DESC
  LIMIT p_limit;
END
$$;
REVOKE ALL ON FUNCTION platform.staff_visa_queue(INTEGER)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_visa_queue(INTEGER)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform.staff_student_case_task_workspace(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  tasks_payload JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  SELECT COALESCE(
    jsonb_agg(
      task.payload
      ORDER BY task.sort_due_at, task.sort_status,
        task.created_at DESC, task.case_task_id
    ),
    '[]'::JSONB
  )
  INTO tasks_payload
  FROM (
    SELECT
      case_task.id AS case_task_id,
      COALESCE(
        case_task.due_at,
        '9999-12-31 00:00:00+00'::TIMESTAMPTZ
      ) AS sort_due_at,
      CASE WHEN case_task.status IN ('done', 'cancelled') THEN 1 ELSE 0 END
        AS sort_status,
      case_task.created_at,
      jsonb_build_object(
        'case_task_id', case_task.id,
        'version', case_task.version::TEXT,
        'task_type', case_task.task_type,
        'title', case_task.title,
        'status', case_task.status,
        'priority', case_task.priority,
        'due_at', case_task.due_at,
        'student_visible', case_task.student_visible,
        'assignee_membership_id', assignee_membership.id,
        'assignee_display_name', assignee_profile.display_name,
        'creator_membership_id', creator_membership.id,
        'creator_display_name', creator_profile.display_name,
        'created_at', case_task.created_at,
        'updated_at', case_task.updated_at
      ) AS payload
    FROM platform.case_tasks AS case_task
    JOIN platform.organization_memberships AS assignee_membership
      ON assignee_membership.organization_id = case_task.organization_id
      AND assignee_membership.id = case_task.assignee_membership_id
    JOIN platform.profiles AS assignee_profile
      ON assignee_profile.id = assignee_membership.profile_id
    JOIN platform.organization_memberships AS creator_membership
      ON creator_membership.organization_id = case_task.organization_id
      AND creator_membership.id = case_task.created_by_membership_id
    JOIN platform.profiles AS creator_profile
      ON creator_profile.id = creator_membership.profile_id
    WHERE case_task.organization_id = actor.organization_id
      AND case_task.student_case_id = actor.student_case_id
  ) AS task;

  RETURN jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', actor.student_case_id,
    'tasks', tasks_payload,
    'assignees', platform_private.u7_workspace_assignees(actor.organization_id)
  );
END
$$;

DROP FUNCTION platform.staff_case_visa(UUID);
CREATE FUNCTION platform.staff_case_visa(
  p_student_case_id UUID
)
RETURNS TABLE (
  visa_case_id UUID,
  version TEXT,
  case_id UUID,
  visa_status platform.visa_status,
  note TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    visa.id,
    visa.version::TEXT,
    visa.student_case_id,
    visa.status,
    CASE
      WHEN latest_event.note IS NULL THEN NULL
      WHEN char_length(latest_event.note) <= 4000
        AND latest_event.note !~ '[[:cntrl:]]'
      THEN latest_event.note
      ELSE NULL
    END,
    visa.updated_at
  FROM platform.visa_cases AS visa
  LEFT JOIN LATERAL (
    SELECT event.note
    FROM platform.visa_case_events AS event
    WHERE event.organization_id = visa.organization_id
      AND event.visa_case_id = visa.id
      AND event.student_case_id = visa.student_case_id
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1
  ) AS latest_event ON TRUE
  WHERE visa.student_case_id = p_student_case_id
    AND private.platform_can_read_student_case(
      visa.organization_id,
      visa.student_case_id
    )
    AND private.platform_has_permission(
      visa.organization_id,
      'visa.manage'
    )
  ORDER BY visa.updated_at DESC, visa.id
$$;
REVOKE ALL ON FUNCTION platform.staff_case_visa(UUID)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_visa(UUID)
  TO authenticated;

DROP FUNCTION platform.staff_application_snapshot(UUID);
DROP FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
);
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
  FROM platform.staff_application_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_university_application_id
  ) AS page
$$;

REVOKE ALL ON FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_application_snapshot(UUID)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_snapshot(UUID)
  TO authenticated;
CREATE OR REPLACE FUNCTION platform.staff_case_finance_control(
  p_student_case_id UUID,
  p_history_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_organization_id UUID;
  obligations_payload JSONB;
  history_payload JSONB;
BEGIN
  IF p_student_case_id IS NULL
    OR p_history_limit IS NULL
    OR p_history_limit NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION
      'Student case and history limit from 1 to 100 are required'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the case and authority together so a missing case and a case from
  -- another tenant fail through the same non-enumerating boundary.
  SELECT student_case.organization_id
  INTO target_organization_id
  FROM platform.student_cases AS student_case
  WHERE student_case.id = p_student_case_id
    AND (
      private.platform_can_read_finance_full(
        student_case.organization_id
      )
      OR (
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
        AND private.platform_has_permission(
          student_case.organization_id,
          'finance.read.summary'
        )
      )
    )
  LIMIT 1;

  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION
      'Student case finance control is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'payment_obligation_id', obligation.id,
        'label', CASE
          WHEN char_length(obligation.label) <= 500
            AND obligation.label !~ '[[:cntrl:]]'
          THEN obligation.label
          ELSE 'Payment obligation'
        END,
        'category', obligation.category,
        'amount_minor', obligation.amount_minor,
        'currency', obligation.currency,
        'due_at', obligation.due_at,
        'total_paid_minor', obligation.total_paid_minor,
        'total_refunded_minor', obligation.total_refunded_minor,
        'outstanding_minor', obligation.amount_minor - (
          obligation.total_paid_minor - obligation.total_refunded_minor
        ),
        'derived_status', platform_private.derive_obligation_status(
          obligation.amount_minor,
          obligation.total_paid_minor,
          obligation.total_refunded_minor,
          obligation.due_at,
          transaction_timestamp()
        ),
        'overdue', (
          obligation.due_at < transaction_timestamp()
          AND obligation.amount_minor - (
            obligation.total_paid_minor - obligation.total_refunded_minor
          ) > 0
        ),
        'next_action', CASE
          WHEN char_length(obligation.next_action) <= 1000
            AND obligation.next_action !~ '[[:cntrl:]]'
          THEN obligation.next_action
          ELSE 'Contact Finance'
        END,
        'payment_confirmation_count', payment_summary.confirmation_count,
        'last_payment_at', payment_summary.last_payment_at,
        'active_stop_factors', stop_summary.active_stop_factors
      )
      ORDER BY obligation.due_at, obligation.id
    ),
    '[]'::JSONB
  )
  INTO obligations_payload
  FROM platform.payment_obligations AS obligation
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE payment_event.event_type = 'payment'
      )::INTEGER AS confirmation_count,
      max(payment_event.occurred_at) FILTER (
        WHERE payment_event.event_type = 'payment'
      ) AS last_payment_at
    FROM platform.payment_events AS payment_event
    WHERE payment_event.organization_id = obligation.organization_id
      AND payment_event.student_case_id = obligation.student_case_id
      AND payment_event.payment_obligation_id = obligation.id
  ) AS payment_summary ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'stop_factor_id', stop_factor.id,
          'version', stop_factor.version::TEXT,
          'reason', CASE
            WHEN char_length(stop_factor.reason) <= 1000
              AND stop_factor.reason !~ '[[:cntrl:]]'
            THEN stop_factor.reason
            ELSE 'Finance stop factor'
          END,
          'blocked_action', CASE
            WHEN char_length(stop_factor.blocked_action) <= 200
              AND stop_factor.blocked_action !~ '[[:cntrl:]]'
            THEN stop_factor.blocked_action
            ELSE 'downstream_case_progress'
          END,
          'next_action', CASE
            WHEN char_length(stop_factor.next_action) <= 1000
              AND stop_factor.next_action !~ '[[:cntrl:]]'
            THEN stop_factor.next_action
            ELSE 'Contact Finance'
          END,
          'owner_display_name', CASE
            WHEN char_length(owner_profile.display_name) <= 200
              AND owner_profile.display_name !~ '[[:cntrl:]]'
            THEN owner_profile.display_name
            ELSE 'Finance owner'
          END,
          'created_at', stop_factor.created_at
        )
        ORDER BY stop_factor.created_at, stop_factor.id
      ),
      '[]'::JSONB
    ) AS active_stop_factors
    FROM platform.stop_factors AS stop_factor
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = stop_factor.organization_id
      AND owner_membership.id = stop_factor.owner_membership_id
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    WHERE stop_factor.organization_id = obligation.organization_id
      AND stop_factor.student_case_id = obligation.student_case_id
      AND stop_factor.payment_obligation_id = obligation.id
      AND stop_factor.status = 'active'
  ) AS stop_summary ON TRUE
  WHERE obligation.organization_id = target_organization_id
    AND obligation.student_case_id = p_student_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'audit_event_id', finance_event.id,
        'action', finance_event.action,
        'resource_type', finance_event.resource_type,
        'resource_id', finance_event.resource_id,
        'actor_display_name', finance_event.actor_display_name,
        'reason', finance_event.safe_reason,
        'created_at', finance_event.created_at
      )
      ORDER BY finance_event.created_at DESC, finance_event.id DESC
    ),
    '[]'::JSONB
  )
  INTO history_payload
  FROM (
    SELECT
      audit_event.id,
      audit_event.action,
      audit_event.resource_type,
      audit_event.resource_id,
      CASE
        WHEN audit_event.actor_kind = 'user'
          AND char_length(actor_profile.display_name) <= 200
          AND actor_profile.display_name !~ '[[:cntrl:]]'
        THEN actor_profile.display_name
        WHEN audit_event.actor_kind = 'user' THEN 'Staff member'
        ELSE 'System'
      END AS actor_display_name,
      CASE
        WHEN char_length(audit_event.reason) <= 1000
          AND audit_event.reason !~ '[[:cntrl:]]'
        THEN audit_event.reason
        ELSE 'Finance change'
      END AS safe_reason,
      audit_event.created_at
    FROM platform.audit_events AS audit_event
    LEFT JOIN platform.profiles AS actor_profile
      ON actor_profile.id = audit_event.actor_profile_id
    WHERE audit_event.organization_id = target_organization_id
      AND audit_event.action = ANY (
        ARRAY[
          'finance.obligation.create',
          'finance.payment.record',
          'finance.stop.create',
          'finance.stop.resolve'
        ]::TEXT[]
      )
      AND (
        (
          audit_event.resource_type = 'payment_obligation'
          AND EXISTS (
            SELECT 1
            FROM platform.payment_obligations AS obligation
            WHERE obligation.organization_id = target_organization_id
              AND obligation.student_case_id = p_student_case_id
              AND obligation.id = audit_event.resource_id
          )
        )
        OR (
          audit_event.resource_type = 'payment_event'
          AND EXISTS (
            SELECT 1
            FROM platform.payment_events AS payment_event
            WHERE payment_event.organization_id = target_organization_id
              AND payment_event.student_case_id = p_student_case_id
              AND payment_event.id = audit_event.resource_id
          )
        )
        OR (
          audit_event.resource_type = 'stop_factor'
          AND EXISTS (
            SELECT 1
            FROM platform.stop_factors AS stop_factor
            WHERE stop_factor.organization_id = target_organization_id
              AND stop_factor.student_case_id = p_student_case_id
              AND stop_factor.id = audit_event.resource_id
          )
        )
      )
    ORDER BY audit_event.created_at DESC, audit_event.id DESC
    LIMIT p_history_limit
  ) AS finance_event;

  RETURN jsonb_build_object(
    'organization_id', target_organization_id,
    'student_case_id', p_student_case_id,
    'obligations', obligations_payload,
    'history', history_payload
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_finance_control(UUID, INTEGER)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_finance_control(UUID, INTEGER)
  TO authenticated;
