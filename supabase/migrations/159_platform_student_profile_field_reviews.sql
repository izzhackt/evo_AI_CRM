-- D2b: reviewed fields of the existing canonical Student Profile.
-- Contract: docs/design/v3/evo-docs-profile-fields-contract.md.
-- This slice has no provider-ingestion endpoint and no generated-file storage.
BEGIN;

-- Stable template keys/bounds; presentation labels live in the shared TS registry.
CREATE FUNCTION platform_private.student_profile_field_registry()
RETURNS TABLE (field_key TEXT, ordinal INTEGER, max_length INTEGER, canonical_column TEXT)
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM (VALUES
    ('student_first_name', 1, 60, NULL::TEXT),
    ('student_last_name', 2, 60, NULL::TEXT),
    ('date_of_birth', 3, 20, 'date_of_birth'),
    ('nationality', 4, 60, 'citizenship_country'),
    ('passport_number', 5, 30, NULL::TEXT),
    ('passport_expiry_date', 6, 20, NULL::TEXT),
    ('country_of_residence', 7, 60, 'residency_country'),
    ('permanent_address', 8, 180, NULL::TEXT),
    ('mobile_phone', 9, 40, NULL::TEXT),
    ('whatsapp_telegram', 10, 60, NULL::TEXT),
    ('student_email', 11, 120, NULL::TEXT),
    ('chinese_level_hsk', 12, 40, NULL::TEXT),
    ('english_level', 13, 60, NULL::TEXT),
    ('education_1_school_name', 14, 100, NULL::TEXT),
    ('education_1_country_city', 15, 80, NULL::TEXT),
    ('education_1_year_from', 16, 12, NULL::TEXT),
    ('education_1_year_to', 17, 12, NULL::TEXT),
    ('education_1_degree_certificate', 18, 80, NULL::TEXT),
    ('education_2_school_name', 19, 100, NULL::TEXT),
    ('education_2_country_city', 20, 80, NULL::TEXT),
    ('education_2_year_from', 21, 12, NULL::TEXT),
    ('education_2_year_to', 22, 12, NULL::TEXT),
    ('education_2_degree_certificate', 23, 80, NULL::TEXT),
    ('education_3_school_name', 24, 100, NULL::TEXT),
    ('education_3_country_city', 25, 80, NULL::TEXT),
    ('education_3_year_from', 26, 12, NULL::TEXT),
    ('education_3_year_to', 27, 12, NULL::TEXT),
    ('education_3_degree_certificate', 28, 80, NULL::TEXT),
    ('current_study_status', 29, 100, NULL::TEXT),
    ('expected_graduation_year', 30, 12, NULL::TEXT),
    ('extracurricular_achievements', 31, 400, NULL::TEXT),
    ('desired_country_of_study', 32, 60, NULL::TEXT),
    ('desired_university', 33, 120, NULL::TEXT),
    ('field_major', 34, 100, NULL::TEXT),
    ('program_level', 35, 60, NULL::TEXT),
    ('desired_start_date', 36, 30, NULL::TEXT),
    ('budget_per_year', 37, 60, NULL::TEXT),
    ('scholarship_interest', 38, 20, NULL::TEXT),
    ('why_this_field', 39, 500, NULL::TEXT),
    ('father_first_name', 40, 60, NULL::TEXT),
    ('father_last_name', 41, 60, NULL::TEXT),
    ('father_employer', 42, 100, NULL::TEXT),
    ('father_job_title', 43, 80, NULL::TEXT),
    ('father_mobile_phone', 44, 40, NULL::TEXT),
    ('father_work_email', 45, 120, NULL::TEXT),
    ('father_personal_email', 46, 120, NULL::TEXT),
    ('mother_first_name', 47, 60, NULL::TEXT),
    ('mother_last_name', 48, 60, NULL::TEXT),
    ('mother_employer', 49, 100, NULL::TEXT),
    ('mother_job_title', 50, 80, NULL::TEXT),
    ('mother_mobile_phone', 51, 40, NULL::TEXT),
    ('mother_work_email', 52, 120, NULL::TEXT),
    ('mother_personal_email', 53, 120, NULL::TEXT),
    ('emergency_contact_name', 54, 100, NULL::TEXT),
    ('emergency_contact_relationship', 55, 60, NULL::TEXT),
    ('emergency_contact_phone_email', 56, 140, NULL::TEXT),
    ('previous_visa_refusals', 57, 20, NULL::TEXT),
    ('visa_refusal_country', 58, 60, NULL::TEXT),
    ('chronic_conditions_allergies', 59, 20, NULL::TEXT),
    ('conditions_details', 60, 240, NULL::TEXT),
    ('lead_source', 61, 120, NULL::TEXT)
  ) AS fields(field_key, ordinal, max_length, canonical_column)
$$;

CREATE FUNCTION platform_private.student_profile_field_is_known(p_field_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_field_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_private.student_profile_field_registry() AS field
    WHERE field.field_key = p_field_key
  )
$$;

-- Canonical countries retain their existing 120-character domain. The lower
-- 60-character template limit is an explicit export issue, never truncation.
CREATE FUNCTION platform_private.normalize_student_profile_field_value(
  p_field_key TEXT, p_value TEXT
)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  definition RECORD;
  result TEXT;
  parts TEXT[];
  normalized_date DATE;
  digits TEXT;
  maximum INTEGER;
BEGIN
  SELECT * INTO definition FROM platform_private.student_profile_field_registry() AS field
    WHERE field.field_key = p_field_key;
  IF NOT FOUND OR p_value IS NULL OR char_length(p_value) > 4096 THEN
    RAISE EXCEPTION 'A bounded profile field value is required' USING ERRCODE = '22023';
  END IF;
  result := btrim(regexp_replace(
    regexp_replace(normalize(p_value, NFKC), '[[:cntrl:]]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'
  ));
  IF result = '' THEN
    RAISE EXCEPTION 'A nonempty profile field value is required' USING ERRCODE = '22023';
  END IF;
  IF p_field_key IN ('date_of_birth', 'passport_expiry_date', 'desired_start_date') THEN
    parts := regexp_match(result, '^([0-9]{4})[-/. ]([0-9]{1,2})[-/. ]([0-9]{1,2})$');
    IF parts IS NULL THEN
      parts := regexp_match(result, '^([0-9]{1,2})[-/. ]([0-9]{1,2})[-/. ]([0-9]{4})$');
      IF parts IS NOT NULL THEN parts := ARRAY[parts[3], parts[2], parts[1]]; END IF;
    END IF;
    IF parts IS NULL OR parts[1]::INTEGER NOT BETWEEN 1900 AND 2200 THEN
      RAISE EXCEPTION 'Profile field date is invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      normalized_date := make_date(parts[1]::INTEGER, parts[2]::INTEGER, parts[3]::INTEGER);
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RAISE EXCEPTION 'Profile field date is invalid' USING ERRCODE = '22023';
    END;
    IF p_field_key = 'date_of_birth' AND normalized_date > current_date THEN
      RAISE EXCEPTION 'Profile field date is invalid' USING ERRCODE = '22023';
    END IF;
    result := to_char(normalized_date, 'YYYY-MM-DD');
  ELSIF p_field_key IN (
    'student_email', 'father_work_email', 'father_personal_email',
    'mother_work_email', 'mother_personal_email'
  ) THEN
    result := lower(result);
    IF result !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Profile field email is invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF p_field_key IN ('mobile_phone', 'father_mobile_phone', 'mother_mobile_phone') THEN
    digits := regexp_replace(result, '[^0-9]', '', 'g');
    IF result !~ '^\+?[0-9 ().-]+$' OR char_length(digits) NOT BETWEEN 7 AND 15 THEN
      RAISE EXCEPTION 'Profile field phone is invalid' USING ERRCODE = '22023';
    END IF;
    result := CASE WHEN left(result, 1) = '+' THEN '+' ELSE '' END || digits;
  ELSIF p_field_key IN ('scholarship_interest', 'previous_visa_refusals', 'chronic_conditions_allergies') THEN
    result := CASE
      WHEN lower(result) IN ('yes', 'y', 'да', 'oui', 'true') THEN 'Yes'
      WHEN lower(result) IN ('no', 'n', 'нет', 'non', 'false') THEN 'No'
      ELSE NULL END;
    IF result IS NULL THEN
      RAISE EXCEPTION 'Profile field requires Yes or No' USING ERRCODE = '22023';
    END IF;
  END IF;
  maximum := CASE WHEN definition.canonical_column IN ('citizenship_country', 'residency_country')
    THEN 120 ELSE definition.max_length END;
  IF char_length(result) > maximum THEN
    RAISE EXCEPTION 'Profile field value exceeds its bound' USING ERRCODE = '22023';
  END IF;
  RETURN result;
END
$$;

ALTER TABLE platform.student_profiles
  ADD CONSTRAINT student_profiles_case_identity_key UNIQUE (organization_id, student_case_id, id);

CREATE TABLE platform.student_profile_fields (
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  field_key TEXT NOT NULL CHECK (platform_private.student_profile_field_is_known(field_key)),
  -- Only the 58 extension fields own a current value in this table.
  value TEXT CHECK (value IS NULL OR (
    char_length(value) BETWEEN 1 AND 500 AND value = btrim(value) AND value !~ '[[:cntrl:]]'
  )),
  review_state TEXT NOT NULL CHECK (review_state IN ('extracted', 'needs_review', 'conflict', 'confirmed')),
  profile_revision BIGINT NOT NULL CHECK (profile_revision BETWEEN 1 AND 9007199254740991),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_membership_id UUID,
  source_document_version_id UUID,
  source_document_slot_id UUID,
  source_page INTEGER CHECK (source_page BETWEEN 1 AND 10000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, student_profile_id, field_key),
  CONSTRAINT student_profile_fields_canonical_value_check CHECK (
    field_key NOT IN ('date_of_birth', 'nationality', 'country_of_residence') OR value IS NULL
  ),
  CONSTRAINT student_profile_fields_review_shape_check CHECK (
    (reviewed_at IS NULL) = (reviewed_by_membership_id IS NULL)
    AND (review_state <> 'confirmed' OR reviewed_at IS NOT NULL)
  ),
  CONSTRAINT student_profile_fields_source_shape_check CHECK (
    (source_document_version_id IS NULL) = (source_document_slot_id IS NULL)
    AND (source_page IS NULL OR source_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (organization_id, student_case_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, student_case_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_document_version_id, student_case_id, source_document_slot_id)
    REFERENCES platform.document_versions(organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT
);

-- Immutable evidence, not a second current value. D3 will provide actual job
-- provenance and an authorized ingestion path; D2 grants no proposal writer.
CREATE TABLE platform.student_profile_field_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  field_key TEXT NOT NULL CHECK (platform_private.student_profile_field_is_known(field_key)),
  value TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 4096 AND btrim(value) <> ''),
  source_document_version_id UUID,
  source_document_slot_id UUID,
  source_page INTEGER CHECK (source_page BETWEEN 1 AND 10000),
  source_snippet TEXT CHECK (source_snippet IS NULL OR char_length(source_snippet) BETWEEN 1 AND 2000),
  confidence NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profile_field_proposals_identity_key
    UNIQUE (organization_id, student_profile_id, field_key, id),
  CONSTRAINT student_profile_field_proposals_source_shape_check CHECK (
    (source_document_version_id IS NULL) = (source_document_slot_id IS NULL)
    AND (source_page IS NULL OR source_document_version_id IS NOT NULL)
    AND (source_snippet IS NULL OR source_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (organization_id, student_case_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, student_case_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_document_version_id, student_case_id, source_document_slot_id)
    REFERENCES platform.document_versions(organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT
);

CREATE TABLE platform.student_profile_field_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  field_key TEXT NOT NULL CHECK (platform_private.student_profile_field_is_known(field_key)),
  decision TEXT NOT NULL CHECK (decision IN ('confirm', 'clear', 'reject_proposal')),
  previous_value TEXT CHECK (previous_value IS NULL OR char_length(previous_value) BETWEEN 1 AND 4096),
  -- This is an immutable historical decision, including historical mapped values.
  value TEXT CHECK (value IS NULL OR char_length(value) BETWEEN 1 AND 4096),
  proposal_id UUID,
  source_document_version_id UUID,
  source_document_slot_id UUID,
  source_page INTEGER CHECK (source_page BETWEEN 1 AND 10000),
  profile_revision_before BIGINT NOT NULL CHECK (profile_revision_before BETWEEN 1 AND 9007199254740990),
  profile_revision_after BIGINT NOT NULL,
  reviewed_by_membership_id UUID NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  request_id UUID NOT NULL UNIQUE,
  CHECK (profile_revision_after = profile_revision_before + 1),
  CONSTRAINT student_profile_field_reviews_decision_shape_check CHECK (
    (decision <> 'confirm' OR value IS NOT NULL)
    AND (decision <> 'clear' OR (value IS NULL AND proposal_id IS NULL AND source_document_version_id IS NULL))
    AND (decision <> 'reject_proposal' OR proposal_id IS NOT NULL)
  ),
  CONSTRAINT student_profile_field_reviews_source_shape_check CHECK (
    (source_document_version_id IS NULL) = (source_document_slot_id IS NULL)
    AND (source_page IS NULL OR source_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (organization_id, student_case_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, student_case_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, student_profile_id, field_key, proposal_id)
    REFERENCES platform.student_profile_field_proposals(organization_id, student_profile_id, field_key, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_document_version_id, student_case_id, source_document_slot_id)
    REFERENCES platform.document_versions(organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT
);

CREATE INDEX student_profile_field_proposals_case_idx
  ON platform.student_profile_field_proposals(organization_id, student_case_id, field_key, created_at, id);
CREATE INDEX student_profile_field_reviews_proposal_idx
  ON platform.student_profile_field_reviews(organization_id, student_profile_id, proposal_id, profile_revision_after);

ALTER TABLE platform.student_profile_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_fields FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.student_profile_fields,
  platform.student_profile_field_proposals, platform.student_profile_field_reviews
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.preserve_student_profile_field_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Profile field proposals and reviews are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER student_profile_field_proposals_immutable
  BEFORE UPDATE OR DELETE ON platform.student_profile_field_proposals
  FOR EACH ROW EXECUTE FUNCTION platform_private.preserve_student_profile_field_history();
CREATE TRIGGER student_profile_field_reviews_immutable
  BEFORE UPDATE OR DELETE ON platform.student_profile_field_reviews
  FOR EACH ROW EXECUTE FUNCTION platform_private.preserve_student_profile_field_history();

-- The existing profile writer owns the revision/audit. Invalidation is metadata
-- maintenance, not another human decision or another revision. A mapped review
-- updates the canonical column first, then restores its own confirmed metadata.
CREATE FUNCTION platform_private.invalidate_changed_profile_field_reviews()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed RECORD;
BEGIN
  FOR changed IN
    SELECT * FROM (VALUES
      ('date_of_birth', to_char(OLD.date_of_birth, 'YYYY-MM-DD'), to_char(NEW.date_of_birth, 'YYYY-MM-DD')),
      ('nationality', OLD.citizenship_country, NEW.citizenship_country),
      ('country_of_residence', OLD.residency_country, NEW.residency_country)
    ) AS changes(field_key, before_value, after_value)
    WHERE changes.before_value IS DISTINCT FROM changes.after_value
  LOOP
    UPDATE platform.student_profile_fields AS field
    SET review_state = CASE WHEN field.review_state = 'conflict' THEN 'conflict' ELSE 'needs_review' END,
      reviewed_at = NULL, reviewed_by_membership_id = NULL,
      source_document_version_id = NULL, source_document_slot_id = NULL, source_page = NULL,
      profile_revision = NEW.revision, updated_at = NEW.updated_at
    WHERE field.organization_id = NEW.organization_id
      AND field.student_profile_id = NEW.id AND field.field_key = changed.field_key;
  END LOOP;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_profile_fields_canonical_invalidation
  AFTER UPDATE OF date_of_birth, citizenship_country, residency_country ON platform.student_profiles
  FOR EACH ROW EXECUTE FUNCTION platform_private.invalidate_changed_profile_field_reviews();

CREATE FUNCTION platform.staff_student_profile_fields(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
  target_profile platform.student_profiles%ROWTYPE;
  may_manage BOOLEAN;
  result_fields JSONB;
BEGIN
  SELECT * INTO target_case FROM platform.student_cases AS student_case
    WHERE student_case.id = p_student_case_id;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(
    target_case.organization_id, 'profile.read.full', 'student_case', target_case.id
  ) THEN
    RAISE EXCEPTION 'Student profile fields are unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_profile FROM platform.student_profiles AS profile
    WHERE profile.organization_id = target_case.organization_id AND profile.student_case_id = target_case.id;
  may_manage := platform_private.staff_can_access_for_actor(
    target_case.organization_id, 'profile.manage', 'student_case', target_case.id
  );
  SELECT jsonb_agg(jsonb_build_object(
    'field_key', definition.field_key,
    'value', CASE definition.canonical_column
      WHEN 'date_of_birth' THEN to_char(target_profile.date_of_birth, 'YYYY-MM-DD')
      WHEN 'citizenship_country' THEN target_profile.citizenship_country
      WHEN 'residency_country' THEN target_profile.residency_country
      ELSE current_field.value END,
    'review_state', COALESCE(current_field.review_state, 'needs_review'),
    'reviewed_at', current_field.reviewed_at,
    'source_document_version_id', current_field.source_document_version_id,
    'source_page', current_field.source_page,
    'proposals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', proposal.id, 'value', proposal.value,
        'source_document_version_id', proposal.source_document_version_id,
        'source_page', proposal.source_page, 'source_snippet', proposal.source_snippet,
        'confidence', proposal.confidence, 'created_at', proposal.created_at,
        'status', COALESCE((
          SELECT CASE review.decision WHEN 'confirm' THEN 'accepted' ELSE 'rejected' END
          FROM platform.student_profile_field_reviews AS review
          WHERE review.organization_id = proposal.organization_id
            AND review.student_profile_id = proposal.student_profile_id AND review.proposal_id = proposal.id
          ORDER BY review.profile_revision_after DESC LIMIT 1
        ), 'pending')
      ) ORDER BY proposal.created_at, proposal.id)
      FROM platform.student_profile_field_proposals AS proposal
      WHERE proposal.organization_id = target_case.organization_id
        AND proposal.student_profile_id = target_profile.id AND proposal.field_key = definition.field_key
    ), '[]'::JSONB)
  ) ORDER BY definition.ordinal) INTO result_fields
  FROM platform_private.student_profile_field_registry() AS definition
  LEFT JOIN platform.student_profile_fields AS current_field
    ON current_field.organization_id = target_case.organization_id
    AND current_field.student_profile_id = target_profile.id AND current_field.field_key = definition.field_key;
  RETURN jsonb_build_object(
    'student_case_id', target_case.id,
    'profile', CASE WHEN target_profile.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', target_profile.id, 'revision', target_profile.revision) END,
    'can_initialize', may_manage AND target_profile.id IS NULL,
    'can_review', may_manage AND target_profile.id IS NOT NULL,
    'can_export', target_profile.id IS NOT NULL AND platform_private.staff_can_access_for_actor(
      target_case.organization_id, 'document.download', 'student_case', target_case.id
    ),
    'fields', result_fields
  );
END
$$;

CREATE FUNCTION platform.review_student_profile_field(
  p_organization_id UUID, p_student_case_id UUID, p_field_key TEXT,
  p_decision TEXT, p_value TEXT, p_proposal_id UUID,
  p_source_version_id UUID, p_source_page INTEGER,
  p_expected_revision BIGINT, p_reason TEXT, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  target_profile platform.student_profiles%ROWTYPE;
  target_proposal platform.student_profile_field_proposals%ROWTYPE;
  target_source platform.document_versions%ROWTYPE;
  normalized_reason TEXT;
  submitted_value TEXT;
  reviewed_value TEXT;
  previous_value TEXT;
  source_version UUID;
  source_slot UUID;
  source_page INTEGER;
  next_revision BIGINT;
  changed_at TIMESTAMPTZ;
  review_id UUID := gen_random_uuid();
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR NOT platform_private.student_profile_field_is_known(p_field_key)
    OR p_decision IS NULL OR p_decision NOT IN ('confirm', 'clear', 'reject_proposal')
    OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740990
    OR (p_source_page IS NOT NULL AND (p_source_version_id IS NULL OR p_source_page NOT BETWEEN 1 AND 10000))
    OR (p_proposal_id IS NOT NULL AND (p_source_version_id IS NOT NULL OR p_source_page IS NOT NULL))
    OR (p_decision = 'confirm' AND p_value IS NULL AND p_proposal_id IS NULL)
    OR (p_decision = 'clear' AND (p_value IS NOT NULL OR p_proposal_id IS NOT NULL OR p_source_version_id IS NOT NULL OR p_source_page IS NOT NULL))
    OR (p_decision = 'reject_proposal' AND (p_proposal_id IS NULL OR p_value IS NOT NULL OR p_source_version_id IS NOT NULL OR p_source_page IS NOT NULL))
  THEN
    RAISE EXCEPTION 'A bounded profile field review command is required' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NOT NULL THEN
    submitted_value := platform_private.normalize_student_profile_field_value(p_field_key, p_value);
  END IF;
  SELECT * INTO actor FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'profile.manage'
  );
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id, 'student_case_id', p_student_case_id,
    'actor_membership_id', actor.actor_membership_id, 'field_key', p_field_key,
    'decision', p_decision, 'value', submitted_value, 'proposal_id', p_proposal_id,
    'source_version_id', p_source_version_id, 'source_page', p_source_page,
    'expected_revision', p_expected_revision
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'student.profile.field.review', 'student_profile', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  -- Match the request -> case -> profile lock order of the full profile writer.
  SELECT * INTO target_case FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'profile.manage'
  );
  SELECT * INTO target_profile FROM platform.student_profiles AS profile
    WHERE profile.organization_id = p_organization_id AND profile.student_case_id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR target_profile.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Student Profile revision conflict' USING ERRCODE = '40001';
  END IF;
  previous_value := CASE p_field_key
    WHEN 'date_of_birth' THEN to_char(target_profile.date_of_birth, 'YYYY-MM-DD')
    WHEN 'nationality' THEN target_profile.citizenship_country
    WHEN 'country_of_residence' THEN target_profile.residency_country
    ELSE (SELECT field.value FROM platform.student_profile_fields AS field
      WHERE field.organization_id = p_organization_id AND field.student_profile_id = target_profile.id
        AND field.field_key = p_field_key) END;
  reviewed_value := submitted_value;
  source_version := p_source_version_id;
  source_page := p_source_page;

  IF p_proposal_id IS NOT NULL THEN
    SELECT * INTO target_proposal FROM platform.student_profile_field_proposals AS proposal
    WHERE proposal.id = p_proposal_id AND proposal.organization_id = p_organization_id
      AND proposal.student_case_id = p_student_case_id AND proposal.student_profile_id = target_profile.id
      AND proposal.field_key = p_field_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile field proposal is unavailable' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM platform.student_profile_field_reviews AS review
      WHERE review.organization_id = p_organization_id AND review.student_profile_id = target_profile.id
        AND review.proposal_id = p_proposal_id) THEN
      RAISE EXCEPTION 'Profile field proposal was already reviewed' USING ERRCODE = '40001';
    END IF;
    source_version := target_proposal.source_document_version_id;
    source_slot := target_proposal.source_document_slot_id;
    source_page := target_proposal.source_page;
    IF p_decision = 'confirm' THEN
      reviewed_value := platform_private.normalize_student_profile_field_value(p_field_key, target_proposal.value);
      IF submitted_value IS NOT NULL AND submitted_value IS DISTINCT FROM reviewed_value THEN
        RAISE EXCEPTION 'Profile field proposal does not match the confirmed value' USING ERRCODE = '22023';
      END IF;
    ELSE
      reviewed_value := previous_value;
    END IF;
  END IF;

  -- A source annotation is one exact finalized, clean version of this same case.
  -- Historical versions remain legitimate evidence; no original bytes are read.
  IF source_version IS NOT NULL AND p_decision = 'confirm' THEN
    SELECT * INTO target_source FROM platform.document_versions AS version
    WHERE version.organization_id = p_organization_id AND version.student_case_id = p_student_case_id
      AND version.id = source_version AND version.integrity_status = 'verified' AND version.malware_status = 'clean'
      AND EXISTS (SELECT 1 FROM platform_private.document_upload_finalizations AS finalization
        WHERE finalization.organization_id = version.organization_id
          AND finalization.student_case_id = version.student_case_id AND finalization.document_version_id = version.id)
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile field source document is unavailable' USING ERRCODE = 'P0001';
    END IF;
    IF target_source.declared_mime_type IN ('image/jpeg', 'image/png') AND source_page IS NOT NULL AND source_page <> 1 THEN
      RAISE EXCEPTION 'Image profile field source page must be one' USING ERRCODE = '22023';
    END IF;
    source_slot := target_source.document_slot_id;
  END IF;

  next_revision := target_profile.revision + 1;
  changed_at := GREATEST(statement_timestamp(), target_profile.updated_at + INTERVAL '1 microsecond');
  -- Exactly one aggregate revision. The invalidation trigger performs no profile
  -- update/history insert and cannot create a second revision or review event.
  UPDATE platform.student_profiles AS profile SET
    date_of_birth = CASE WHEN p_field_key = 'date_of_birth' AND p_decision <> 'reject_proposal'
      THEN reviewed_value::DATE ELSE profile.date_of_birth END,
    citizenship_country = CASE WHEN p_field_key = 'nationality' AND p_decision <> 'reject_proposal'
      THEN reviewed_value ELSE profile.citizenship_country END,
    residency_country = CASE WHEN p_field_key = 'country_of_residence' AND p_decision <> 'reject_proposal'
      THEN reviewed_value ELSE profile.residency_country END,
    revision = next_revision, updated_by_membership_id = actor.actor_membership_id, updated_at = changed_at
  WHERE profile.organization_id = p_organization_id AND profile.id = target_profile.id;

  INSERT INTO platform.student_profile_field_reviews (
    id, organization_id, student_case_id, student_profile_id, field_key, decision,
    previous_value, value, proposal_id, source_document_version_id, source_document_slot_id, source_page,
    profile_revision_before, profile_revision_after, reviewed_by_membership_id, reviewed_at, request_id
  ) VALUES (
    review_id, p_organization_id, p_student_case_id, target_profile.id, p_field_key, p_decision,
    previous_value, reviewed_value, p_proposal_id, source_version, source_slot, source_page,
    target_profile.revision, next_revision, actor.actor_membership_id, changed_at, p_request_id
  );
  IF p_decision <> 'reject_proposal' THEN
    INSERT INTO platform.student_profile_fields (
      organization_id, student_case_id, student_profile_id, field_key, value, review_state,
      profile_revision, reviewed_at, reviewed_by_membership_id,
      source_document_version_id, source_document_slot_id, source_page, updated_at
    ) VALUES (
      p_organization_id, p_student_case_id, target_profile.id, p_field_key,
      CASE WHEN p_field_key IN ('date_of_birth', 'nationality', 'country_of_residence') THEN NULL ELSE reviewed_value END,
      'confirmed', next_revision, changed_at, actor.actor_membership_id,
      source_version, source_slot, source_page, changed_at
    ) ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET
      value = EXCLUDED.value, review_state = EXCLUDED.review_state,
      profile_revision = EXCLUDED.profile_revision, reviewed_at = EXCLUDED.reviewed_at,
      reviewed_by_membership_id = EXCLUDED.reviewed_by_membership_id,
      source_document_version_id = EXCLUDED.source_document_version_id,
      source_document_slot_id = EXCLUDED.source_document_slot_id, source_page = EXCLUDED.source_page,
      updated_at = EXCLUDED.updated_at;
  END IF;
  result := jsonb_build_object(
    'organization_id', p_organization_id, 'student_case_id', p_student_case_id,
    'student_profile_id', target_profile.id, 'profile_revision', next_revision,
    'field_key', p_field_key, 'decision', p_decision, 'review_id', review_id,
    'request_id', p_request_id, 'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id, 'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.field.review', 'student_profile', target_profile.id,
    jsonb_build_object('student_profile_id', target_profile.id, 'profile_revision', target_profile.revision),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.student_profile_field_registry(),
  platform_private.student_profile_field_is_known(TEXT),
  platform_private.normalize_student_profile_field_value(TEXT, TEXT),
  platform_private.preserve_student_profile_field_history(),
  platform_private.invalidate_changed_profile_field_reviews(),
  platform.staff_student_profile_fields(UUID),
  platform.review_student_profile_field(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, INTEGER, BIGINT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_profile_fields(UUID),
  platform.review_student_profile_field(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, INTEGER, BIGINT, TEXT, UUID)
  TO authenticated;

COMMENT ON TABLE platform.student_profile_fields IS
  'D2 current review metadata and 58 canonical extension values. The three mapped values remain in student_profiles.';
COMMENT ON TABLE platform.student_profile_field_proposals IS
  'Immutable candidate evidence. No D2 product/provider ingestion path or automatic canonical acceptance is granted.';
COMMENT ON TABLE platform.student_profile_field_reviews IS
  'Immutable human field decisions; historical values are evidence, not a second current profile authority.';
COMMIT;
