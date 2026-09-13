BEGIN;

-- D2 records a server generation attempt, not a stored artifact or delivery.
-- Elevated RPCs repeat the existing S2 identity/scope checks. They never read
-- profile field values: those remain on the authenticated user snapshot path.
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/getting-started/api-keys
CREATE TABLE platform_private.student_profile_export_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES platform.organization_memberships(id) ON DELETE RESTRICT,
  profile_revision BIGINT NOT NULL CHECK (profile_revision BETWEEN 1 AND 9007199254740991),
  mode TEXT NOT NULL CHECK (mode IN ('draft', 'final')),
  template_sha256 TEXT NOT NULL CHECK (template_sha256 ~ '^[0-9a-f]{64}$'),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  completion_request_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'failed')),
  output_sha256 TEXT CHECK (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_bytes INTEGER CHECK (output_bytes BETWEEN 1 AND 5242880),
  failure_code TEXT CHECK (failure_code IN (
    'profile_not_ready', 'profile_changed', 'access_changed',
    'template_unavailable', 'render_failed', 'export_unavailable'
  )),
  completion_input_sha256 TEXT CHECK (completion_input_sha256 ~ '^[0-9a-f]{64}$'),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, student_case_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, student_case_id, id) ON DELETE RESTRICT,
  CHECK (request_id <> completion_request_id),
  CHECK (
    (status = 'pending' AND output_sha256 IS NULL AND output_bytes IS NULL
      AND failure_code IS NULL AND completed_at IS NULL AND completion_input_sha256 IS NULL)
    OR (status = 'generated' AND output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
      AND failure_code IS NULL AND completed_at IS NOT NULL AND completion_input_sha256 IS NOT NULL)
    OR (status = 'failed' AND output_sha256 IS NULL AND output_bytes IS NULL
      AND failure_code IS NOT NULL AND completed_at IS NOT NULL AND completion_input_sha256 IS NOT NULL)
  )
);
CREATE INDEX student_profile_export_attempts_case_idx
  ON platform_private.student_profile_export_attempts(organization_id, student_case_id, attempted_at DESC);
CREATE INDEX student_profile_export_attempts_profile_idx
  ON platform_private.student_profile_export_attempts(student_profile_id);
CREATE INDEX student_profile_export_attempts_actor_profile_idx
  ON platform_private.student_profile_export_attempts(actor_profile_id);
CREATE INDEX student_profile_export_attempts_actor_membership_idx
  ON platform_private.student_profile_export_attempts(actor_membership_id);
ALTER TABLE platform_private.student_profile_export_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.student_profile_export_attempts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.preserve_student_profile_export_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Student profile export history is immutable' USING ERRCODE = '22023';
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('generated', 'failed')
    OR (to_jsonb(NEW) - ARRAY['status', 'output_sha256', 'output_bytes', 'failure_code',
      'completed_at', 'completion_input_sha256']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['status', 'output_sha256', 'output_bytes', 'failure_code',
      'completed_at', 'completion_input_sha256']) THEN
    RAISE EXCEPTION 'Student profile export history is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER preserve_student_profile_export_attempt
  BEFORE UPDATE OR DELETE ON platform_private.student_profile_export_attempts
  FOR EACH ROW EXECUTE FUNCTION platform_private.preserve_student_profile_export_attempt();

CREATE FUNCTION platform_private.student_profile_export_receipt(
  p_attempt platform_private.student_profile_export_attempts, p_created BOOLEAN
) RETURNS JSONB LANGUAGE SQL STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'attempt_id', p_attempt.id, 'organization_id', p_attempt.organization_id,
    'student_case_id', p_attempt.student_case_id, 'student_profile_id', p_attempt.student_profile_id,
    'profile_revision', p_attempt.profile_revision, 'mode', p_attempt.mode,
    'template_sha256', p_attempt.template_sha256, 'status', p_attempt.status,
    'created', p_created, 'failure_code', p_attempt.failure_code
  )
$$;

CREATE FUNCTION platform.begin_student_profile_export(
  p_organization_id UUID, p_student_case_id UUID,
  p_actor_auth_user_id UUID, p_actor_membership_id UUID,
  p_expected_profile_revision BIGINT, p_mode TEXT,
  p_template_sha256 TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_profile RECORD;
  attempt platform_private.student_profile_export_attempts%ROWTYPE;
  input_hash TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server generation authority is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_actor_auth_user_id IS NULL
    OR p_actor_membership_id IS NULL OR p_request_id IS NULL
    OR p_expected_profile_revision IS NULL OR p_expected_profile_revision NOT BETWEEN 1 AND 9007199254740991
    OR p_mode IS NULL OR p_mode NOT IN ('draft', 'final')
    OR p_template_sha256 IS NULL OR p_template_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A bounded export command is required' USING ERRCODE = '22023';
  END IF;
  -- Match staff command ordering before request, membership or profile locks.
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(p_request_id);
  PERFORM platform_private.staff_lock_memberships(p_organization_id, ARRAY[p_actor_membership_id]);
  SELECT identity.auth_user_id, identity.profile_id INTO actor
  FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id) identity
  WHERE identity.auth_user_id = p_actor_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student profile export is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, p_actor_membership_id,
      'profile.read.full', 'student_case', p_student_case_id)
    OR NOT platform_private.staff_can_access(p_organization_id, p_actor_membership_id,
      'document.download', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Student profile export is unavailable' USING ERRCODE = '42501';
  END IF;
  input_hash := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id, 'student_case_id', p_student_case_id,
    'actor_auth_user_id', p_actor_auth_user_id, 'actor_membership_id', p_actor_membership_id,
    'expected_profile_revision', p_expected_profile_revision, 'mode', p_mode,
    'template_sha256', p_template_sha256
  ));
  SELECT * INTO attempt FROM platform_private.student_profile_export_attempts
    WHERE request_id = p_request_id FOR UPDATE;
  IF FOUND THEN
    IF attempt.input_sha256 <> input_hash THEN
      RAISE EXCEPTION 'Export request conflict' USING ERRCODE = '23505';
    END IF;
    -- Replay precedes revision checking: it never regenerates from newer values.
    RETURN platform_private.student_profile_export_receipt(attempt, FALSE);
  END IF;
  SELECT profile.id, profile.revision INTO target_profile FROM platform.student_profiles AS profile
    WHERE profile.organization_id = p_organization_id AND profile.student_case_id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR target_profile.revision <> p_expected_profile_revision THEN
    RAISE EXCEPTION 'Student profile revision conflict' USING ERRCODE = '40001';
  END IF;
  INSERT INTO platform_private.student_profile_export_attempts (
    organization_id, student_case_id, student_profile_id, actor_auth_user_id, actor_profile_id,
    actor_membership_id, profile_revision, mode, template_sha256, request_id, input_sha256
  ) VALUES (
    p_organization_id, p_student_case_id, target_profile.id, p_actor_auth_user_id, actor.profile_id,
    p_actor_membership_id, p_expected_profile_revision, p_mode, p_template_sha256, p_request_id, input_hash
  ) RETURNING * INTO attempt;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    attempt.organization_id, 'user', attempt.actor_profile_id, 'auth:' || attempt.actor_auth_user_id::TEXT,
    'student.profile.export.attempted', 'student_profile', attempt.student_profile_id,
    jsonb_build_object('attempt_id', attempt.id, 'profile_revision', attempt.profile_revision,
      'mode', attempt.mode, 'template_sha256', attempt.template_sha256, 'status', 'pending'),
    'Explicit server Student Profile export attempt', attempt.request_id
  );
  RETURN platform_private.student_profile_export_receipt(attempt, TRUE);
END
$$;

CREATE FUNCTION platform.complete_student_profile_export(
  p_attempt_id UUID, p_outcome TEXT, p_output_sha256 TEXT,
  p_output_bytes INTEGER, p_failure_code TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  attempt platform_private.student_profile_export_attempts%ROWTYPE;
  target_profile RECORD;
  input_hash TEXT;
  effective_outcome TEXT := p_outcome;
  effective_failure TEXT := p_failure_code;
  live_actor BOOLEAN;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server generation authority is required' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('generated', 'failed')
    OR (p_outcome = 'generated' AND (p_output_sha256 IS NULL OR p_output_sha256 !~ '^[0-9a-f]{64}$'
      OR p_output_bytes IS NULL OR p_output_bytes NOT BETWEEN 1 AND 5242880 OR p_failure_code IS NOT NULL))
    OR (p_outcome = 'failed' AND (p_output_sha256 IS NOT NULL OR p_output_bytes IS NOT NULL
      OR p_failure_code IS NULL OR p_failure_code NOT IN ('profile_not_ready', 'profile_changed',
        'access_changed', 'template_unavailable', 'render_failed', 'export_unavailable'))) THEN
    RAISE EXCEPTION 'A bounded export outcome is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO attempt FROM platform_private.student_profile_export_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student profile export is unavailable' USING ERRCODE = '42501';
  END IF;
  -- The initial read obtains immutable context only; lock organization first.
  -- Do not require active status here: access changes still need a durable outcome.
  PERFORM 1 FROM platform.organizations WHERE id = attempt.organization_id FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(attempt.request_id);
  PERFORM platform_private.staff_lock_memberships(attempt.organization_id, ARRAY[attempt.actor_membership_id]);
  PERFORM 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = attempt.organization_id AND student_case.id = attempt.student_case_id FOR UPDATE;
  SELECT profile.id, profile.revision INTO target_profile FROM platform.student_profiles AS profile
    WHERE profile.organization_id = attempt.organization_id AND profile.id = attempt.student_profile_id
      AND profile.student_case_id = attempt.student_case_id FOR UPDATE;
  SELECT * INTO attempt FROM platform_private.student_profile_export_attempts WHERE id = p_attempt_id FOR UPDATE;
  input_hash := platform_private.bw1_input_sha256(jsonb_build_object(
    'outcome', p_outcome, 'output_sha256', p_output_sha256,
    'output_bytes', p_output_bytes, 'failure_code', p_failure_code
  ));
  IF attempt.status <> 'pending' THEN
    IF attempt.completion_input_sha256 <> input_hash THEN
      RAISE EXCEPTION 'Export completion conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('attempt_id', attempt.id, 'status', attempt.status, 'failure_code', attempt.failure_code);
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(attempt.organization_id, attempt.actor_membership_id) identity
    WHERE identity.auth_user_id = attempt.actor_auth_user_id AND identity.profile_id = attempt.actor_profile_id
  ) INTO live_actor;
  IF p_outcome = 'generated' THEN
    IF NOT live_actor OR NOT platform_private.staff_can_access(attempt.organization_id, attempt.actor_membership_id,
        'profile.read.full', 'student_case', attempt.student_case_id)
      OR NOT platform_private.staff_can_access(attempt.organization_id, attempt.actor_membership_id,
        'document.download', 'student_case', attempt.student_case_id) THEN
      effective_outcome := 'failed'; effective_failure := 'access_changed';
    ELSIF target_profile.id IS NULL OR target_profile.revision <> attempt.profile_revision THEN
      effective_outcome := 'failed'; effective_failure := 'profile_changed';
    END IF;
  END IF;
  UPDATE platform_private.student_profile_export_attempts SET
    status = effective_outcome, failure_code = effective_failure,
    output_sha256 = CASE WHEN effective_outcome = 'generated' THEN p_output_sha256 END,
    output_bytes = CASE WHEN effective_outcome = 'generated' THEN p_output_bytes END,
    completion_input_sha256 = input_hash, completed_at = statement_timestamp()
  WHERE id = attempt.id RETURNING * INTO attempt;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    attempt.organization_id, 'user', attempt.actor_profile_id, 'auth:' || attempt.actor_auth_user_id::TEXT,
    'student.profile.export.' || attempt.status, 'student_profile', attempt.student_profile_id,
    jsonb_build_object('attempt_id', attempt.id, 'profile_revision', attempt.profile_revision,
      'mode', attempt.mode, 'template_sha256', attempt.template_sha256, 'status', attempt.status,
      'output_sha256', attempt.output_sha256, 'output_bytes', attempt.output_bytes, 'failure_code', attempt.failure_code),
    'Server generation outcome only; not confirmation of delivery', attempt.completion_request_id
  );
  -- Returning a failed result commits it. Raising here would erase the audit.
  RETURN jsonb_build_object('attempt_id', attempt.id, 'status', attempt.status, 'failure_code', attempt.failure_code);
END
$$;

REVOKE ALL ON FUNCTION platform_private.preserve_student_profile_export_attempt(),
  platform_private.student_profile_export_receipt(platform_private.student_profile_export_attempts, BOOLEAN),
  platform.begin_student_profile_export(UUID, UUID, UUID, UUID, BIGINT, TEXT, TEXT, UUID),
  platform.complete_student_profile_export(UUID, TEXT, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.begin_student_profile_export(UUID, UUID, UUID, UUID, BIGINT, TEXT, TEXT, UUID),
  platform.complete_student_profile_export(UUID, TEXT, TEXT, INTEGER, TEXT) TO service_role;
COMMENT ON TABLE platform_private.student_profile_export_attempts IS
  'D2 server-only generation audit: no field values, stored DOCX, automatic retries or claims of delivery.';

COMMIT;
