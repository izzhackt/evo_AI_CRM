-- D2a: start the existing canonical profile without inventing applicant facts.
-- The applied country checklist governs completeness, not whether a profile can
-- exist. Preserve S2 paired permission/resource authority and Student ownership.
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/explicit-locking.html
BEGIN;

-- PostgreSQL CHECK constraints still reject invalid non-null values. Only the
-- absence of these nine facts becomes valid; identity, consent and bounds stay.
ALTER TABLE platform.student_profiles
  ALTER COLUMN preferred_display_name DROP NOT NULL,
  ALTER COLUMN communication_language DROP NOT NULL,
  ALTER COLUMN citizenship_country DROP NOT NULL,
  ALTER COLUMN residency_country DROP NOT NULL,
  ALTER COLUMN current_education_summary DROP NOT NULL,
  ALTER COLUMN academic_summary DROP NOT NULL,
  ALTER COLUMN language_summary DROP NOT NULL,
  ALTER COLUMN budget_band DROP NOT NULL,
  ALTER COLUMN next_step DROP NOT NULL;

CREATE FUNCTION platform.start_student_profile(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_expected_profile_revision BIGINT,
  p_reason TEXT,
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
  profile_id UUID;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_expected_profile_revision IS NULL
    OR p_expected_profile_revision < 0
  THEN
    RAISE EXCEPTION 'A student case and expected profile revision are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'profile.manage'
  );
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'expected_profile_revision', p_expected_profile_revision
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'student.profile.start', 'student_profile',
    normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  -- The same request -> case ordering as upsert serializes both commands.
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'profile.manage'
  );

  IF p_expected_profile_revision <> 0 OR EXISTS (
    SELECT 1 FROM platform.student_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.student_case_id = p_student_case_id
  ) THEN
    RAISE EXCEPTION 'Student Profile revision conflict'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO platform.student_profiles (
    organization_id, student_case_id, revision,
    preferred_display_name, legal_display_name, communication_language,
    date_of_birth, citizenship_country, residency_country,
    current_education_summary, academic_summary, language_summary,
    budget_band, decision_participant_labels, consent_status,
    consent_evidence_ref, next_step,
    created_by_membership_id, updated_by_membership_id
  ) VALUES (
    p_organization_id, p_student_case_id, 1,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, ARRAY[]::TEXT[], 'not_recorded', NULL, NULL,
    actor.actor_membership_id, actor.actor_membership_id
  ) RETURNING id INTO profile_id;

  result := jsonb_build_object(
    'id', profile_id,
    'student_profile_id', profile_id,
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'revision', 1,
    'applied_country_requirement_version_id',
      target_case.applied_country_requirement_version_id,
    'updated_field_names', ARRAY[]::TEXT[],
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.start', 'student_profile', profile_id,
    NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

-- Preserve the complete existing upsert, including payload validation, consent,
-- legal-name requirement, locking, authorization and audit. Change only the DOB
-- condition: required -> present, rather than required <-> present. Fail clearly
-- if the preceding definition differs instead of silently editing another rule.
DO $migration$
DECLARE
  definition TEXT;
  old_condition TEXT := $condition$    OR ('date_of_birth' = ANY(target_version.required_profile_fields))
      IS DISTINCT FROM (p_date_of_birth IS NOT NULL)$condition$;
  new_condition TEXT := $condition$    OR (
      'date_of_birth' = ANY(target_version.required_profile_fields)
      AND p_date_of_birth IS NULL
    )$condition$;
BEGIN
  SELECT pg_get_functiondef(
    'platform.upsert_student_profile(uuid,uuid,bigint,text,text,date,text,text,text,text,text,text,text,text[],platform.student_profile_consent_status,text,text,text,uuid)'::regprocedure
  ) INTO definition;
  IF (length(definition) - length(replace(definition, old_condition, '')))
    <> length(old_condition)
  THEN
    RAISE EXCEPTION 'Unexpected Student Profile upsert date-of-birth condition';
  END IF;
  EXECUTE replace(definition, old_condition, new_condition);
END
$migration$;

CREATE OR REPLACE FUNCTION platform.staff_student_profile_snapshot(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  student_profile_id UUID,
  student_display_name TEXT,
  profile_revision BIGINT,
  preferred_display_name TEXT,
  legal_display_name TEXT,
  communication_language TEXT,
  date_of_birth DATE,
  citizenship_country TEXT,
  residency_country TEXT,
  current_education_summary TEXT,
  academic_summary TEXT,
  language_summary TEXT,
  budget_band TEXT,
  decision_participant_labels TEXT[],
  consent_status platform.student_profile_consent_status,
  consent_evidence_ref TEXT,
  profile_next_step TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  case_state platform.student_case_state,
  case_next_action TEXT,
  portal_activated_at TIMESTAMPTZ,
  applied_country_requirement_version_id UUID,
  checklist_version BIGINT,
  required_profile_fields platform.student_profile_field[]
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    profile.id,
    student_case.student_display_name,
    profile.revision,
    profile.preferred_display_name,
    profile.legal_display_name,
    profile.communication_language,
    profile.date_of_birth,
    profile.citizenship_country,
    profile.residency_country,
    profile.current_education_summary,
    profile.academic_summary,
    profile.language_summary,
    profile.budget_band,
    profile.decision_participant_labels,
    profile.consent_status,
    profile.consent_evidence_ref,
    profile.next_step,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.next_action,
    student_case.portal_activated_at,
    student_case.applied_country_requirement_version_id,
    requirement_version.version,
    COALESCE(requirement_version.required_profile_fields,
      ARRAY[]::platform.student_profile_field[])
  FROM platform.student_cases AS student_case
  JOIN platform.student_profiles AS profile
    ON profile.organization_id = student_case.organization_id
    AND profile.student_case_id = student_case.id
  LEFT JOIN platform.country_requirement_versions AS requirement_version
    ON requirement_version.organization_id = student_case.organization_id
    AND requirement_version.id =
      student_case.applied_country_requirement_version_id
  WHERE student_case.id = p_student_case_id
    AND (
      student_case.applied_country_requirement_version_id IS NULL
      OR requirement_version.status IN ('approved', 'retired')
    )
    AND platform_private.staff_can_access_for_actor(student_case.organization_id,
      'profile.read.full', 'student_case', student_case.id)
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_profile()
RETURNS TABLE (
  case_id UUID,
  student_profile_id UUID,
  student_display_name TEXT,
  profile_revision BIGINT,
  preferred_display_name TEXT,
  legal_display_name TEXT,
  communication_language TEXT,
  date_of_birth DATE,
  citizenship_country TEXT,
  residency_country TEXT,
  current_education_summary TEXT,
  academic_summary TEXT,
  language_summary TEXT,
  budget_band TEXT,
  decision_participant_labels TEXT[],
  consent_status platform.student_profile_consent_status,
  consent_evidence_ref TEXT,
  profile_next_step TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  case_state platform.student_case_state,
  case_next_action TEXT,
  portal_activated_at TIMESTAMPTZ,
  applied_country_requirement_version_id UUID,
  checklist_version BIGINT,
  required_profile_fields platform.student_profile_field[]
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH eligible_cases AS MATERIALIZED (
    SELECT candidate.id
    FROM platform.student_cases AS candidate
    JOIN platform.student_profiles AS candidate_profile
      ON candidate_profile.organization_id = candidate.organization_id
      AND candidate_profile.student_case_id = candidate.id
    LEFT JOIN platform.country_requirement_versions AS candidate_version
      ON candidate_version.organization_id = candidate.organization_id
      AND candidate_version.id =
        candidate.applied_country_requirement_version_id
    WHERE (
        candidate.applied_country_requirement_version_id IS NULL
        OR candidate_version.status IN ('approved', 'retired')
      )
      AND private.platform_has_permission(
        candidate.organization_id,
        'profile.read.self'
      )
      AND private.platform_can_read_student_portal_case(
        candidate.organization_id,
        candidate.id
      )
  )
  SELECT
    student_case.id,
    profile.id,
    student_case.student_display_name,
    profile.revision,
    profile.preferred_display_name,
    profile.legal_display_name,
    profile.communication_language,
    profile.date_of_birth,
    profile.citizenship_country,
    profile.residency_country,
    profile.current_education_summary,
    profile.academic_summary,
    profile.language_summary,
    profile.budget_band,
    profile.decision_participant_labels,
    profile.consent_status,
    profile.consent_evidence_ref,
    profile.next_step,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.next_action,
    student_case.portal_activated_at,
    student_case.applied_country_requirement_version_id,
    requirement_version.version,
    COALESCE(requirement_version.required_profile_fields,
      ARRAY[]::platform.student_profile_field[])
  FROM platform.student_cases AS student_case
  JOIN platform.student_profiles AS profile
    ON profile.organization_id = student_case.organization_id
    AND profile.student_case_id = student_case.id
  LEFT JOIN platform.country_requirement_versions AS requirement_version
    ON requirement_version.organization_id = student_case.organization_id
    AND requirement_version.id =
      student_case.applied_country_requirement_version_id
  WHERE student_case.id IN (SELECT eligible_case.id FROM eligible_cases AS eligible_case)
    AND (SELECT count(*) FROM eligible_cases) = 1
$$;

REVOKE ALL ON FUNCTION platform.start_student_profile(UUID, UUID, BIGINT, TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.start_student_profile(UUID, UUID, BIGINT, TEXT, UUID)
TO authenticated;

COMMENT ON TABLE platform.student_profiles IS
  'One revisioned canonical profile per case. Unknown facts are NULL; explicit staff commands create or edit it. The applied country requirement defines completeness, not profile existence.';
COMMENT ON FUNCTION platform.start_student_profile(UUID, UUID, BIGINT, TEXT, UUID) IS
  'Explicit scoped profile.manage command: absence at expected revision zero becomes an honest empty profile at revision one; audited and request-idempotent.';
COMMENT ON COLUMN platform.student_profiles.date_of_birth IS
  'Optional applicant fact unless the applied country requirement requires it; the complete upsert rejects future dates and dates before 1900.';

COMMIT;
