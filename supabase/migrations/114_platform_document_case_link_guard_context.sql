-- Keep merged migration 113 immutable while narrowing its aggregate version path.
-- This forward migration requires an exact transaction-local context set only
-- by the canonical document-case link command.

CREATE OR REPLACE FUNCTION platform_private.guard_dynamic_document_slot_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  status_transition BOOLEAN;
  metadata_changed BOOLEAN;
  case_link_transition BOOLEAN;
BEGIN
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Removed document slots are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.intent_kind IS DISTINCT FROM OLD.intent_kind THEN
    RAISE EXCEPTION 'Document slot intent is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.version = 9223372036854775807 THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  status_transition := (
    (OLD.status = 'required' AND NEW.status = 'submitted')
    OR (
      OLD.status IN ('submitted', 'correction_required', 'rejected')
      AND NEW.status = 'submitted'
    )
    OR (
      OLD.status = 'submitted'
      AND NEW.status IN ('approved', 'correction_required', 'rejected')
    )
  );

  metadata_changed :=
    NEW.display_label IS DISTINCT FROM OLD.display_label
    OR NEW.group_label IS DISTINCT FROM OLD.group_label
    OR NEW.removed_at IS DISTINCT FROM OLD.removed_at
    OR NEW.removed_by_membership_id IS DISTINCT FROM
      OLD.removed_by_membership_id
    OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason;

  case_link_transition :=
    pg_catalog.current_setting(
      'platform_private.document_slot_case_link_context',
      TRUE
    ) IS NOT DISTINCT FROM
      OLD.organization_id::TEXT || ':' ||
      OLD.student_case_id::TEXT || ':' ||
      OLD.id::TEXT || ':' ||
      OLD.version::TEXT
    AND NEW.version = OLD.version + 1
    AND (
      pg_catalog.to_jsonb(NEW) - ARRAY['version', 'updated_at']::TEXT[]
    ) IS NOT DISTINCT FROM (
      pg_catalog.to_jsonb(OLD) - ARRAY['version', 'updated_at']::TEXT[]
    );

  IF metadata_changed THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
      OR NEW.current_version_no IS DISTINCT FROM OLD.current_version_no
    THEN
      RAISE EXCEPTION 'Document slot metadata transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
  ELSIF case_link_transition THEN
    NULL;
  ELSIF NOT status_transition THEN
    RAISE EXCEPTION 'Document slot transition is not allowed'
      USING ERRCODE = '55000';
  END IF;

  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.guard_dynamic_document_slot_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.set_document_slot_case_link(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
  p_target_kind platform.document_slot_case_link_target_kind,
  p_target_id UUID,
  p_enabled BOOLEAN,
  p_expected_version BIGINT,
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
  slot_row platform.document_slots%ROWTYPE;
  application_row platform.university_applications%ROWTYPE;
  visa_row platform.visa_cases%ROWTYPE;
  existing_link platform.document_slot_case_links%ROWTYPE;
  changed_link platform.document_slot_case_links%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  before_state JSONB;
  action_name TEXT;
  normalized_reason TEXT := NULLIF(pg_catalog.btrim(p_reason), '');
  next_university_application_id UUID;
  next_visa_case_id UUID;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_document_slot_id IS NULL
    OR p_target_kind IS NULL
    OR p_target_id IS NULL
    OR p_enabled IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version <= 0
    OR normalized_reason IS NULL
    OR pg_catalog.char_length(normalized_reason) > 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Document slot case link command is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_kind = 'university_application' THEN
    next_university_application_id := p_target_id;
    next_visa_case_id := NULL;
    action_name := CASE
      WHEN p_enabled THEN 'document.slot.application.link'
      ELSE 'document.slot.application.unlink'
    END;
  ELSIF p_target_kind = 'visa_case' THEN
    next_university_application_id := NULL;
    next_visa_case_id := p_target_id;
    action_name := CASE
      WHEN p_enabled THEN 'document.slot.visa.link'
      ELSE 'document.slot.visa.unlink'
    END;
  ELSE
    RAISE EXCEPTION 'Document slot link target is unsupported'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'document_slot_id', p_document_slot_id,
    'target_kind', p_target_kind,
    'target_id', p_target_id,
    'university_application_id', next_university_application_id,
    'visa_case_id', next_visa_case_id,
    'linked', p_enabled,
    'expected_version', p_expected_version::TEXT,
    'reason', normalized_reason,
    'request_id', p_request_id
  );

  -- Replay precedes all mutable resource checks so a durable retry still
  -- returns its original receipt after the slot is later removed.
  replayed := platform_private.replay_audit(
    p_request_id,
    action_name,
    'document_slot',
    p_document_slot_id,
    normalized_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT slot.* INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND slot.id = p_document_slot_id
    AND slot.removed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document slot is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF slot_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_target_kind = 'university_application' THEN
    SELECT application.* INTO application_row
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
      AND application.id = p_target_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Document slot link target is unavailable'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT visa_case.* INTO visa_row
    FROM platform.visa_cases AS visa_case
    WHERE visa_case.organization_id = p_organization_id
      AND visa_case.student_case_id = p_student_case_id
      AND visa_case.id = p_target_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Document slot link target is unavailable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT link.* INTO existing_link
  FROM platform.document_slot_case_links AS link
  WHERE link.organization_id = p_organization_id
    AND link.student_case_id = p_student_case_id
    AND link.document_slot_id = p_document_slot_id
    AND (
      (
        p_target_kind = 'university_application'
        AND link.university_application_id = p_target_id
      )
      OR (
        p_target_kind = 'visa_case'
        AND link.visa_case_id = p_target_id
      )
    )
  FOR UPDATE;

  IF (p_enabled AND existing_link.id IS NOT NULL)
    OR (NOT p_enabled AND existing_link.id IS NULL)
  THEN
    RAISE EXCEPTION 'Document slot case link command makes no change'
      USING ERRCODE = '22023';
  END IF;

  before_state := replay_shape || jsonb_build_object(
    'linked', existing_link.id IS NOT NULL,
    'document_slot_case_link_id', existing_link.id,
    'version', slot_row.version::TEXT
  );

  IF p_enabled THEN
    INSERT INTO platform.document_slot_case_links (
      organization_id,
      student_case_id,
      document_slot_id,
      target_kind,
      university_application_id,
      visa_case_id,
      created_by_membership_id
    )
    VALUES (
      p_organization_id,
      p_student_case_id,
      p_document_slot_id,
      p_target_kind,
      next_university_application_id,
      next_visa_case_id,
      actor.actor_membership_id
    )
    RETURNING * INTO changed_link;
  ELSE
    DELETE FROM platform.document_slot_case_links AS link
    WHERE link.organization_id = existing_link.organization_id
      AND link.id = existing_link.id
    RETURNING * INTO changed_link;
  END IF;

  PERFORM pg_catalog.set_config(
    'platform_private.document_slot_case_link_context',
    p_organization_id::TEXT || ':' ||
      p_student_case_id::TEXT || ':' ||
      p_document_slot_id::TEXT || ':' ||
      p_expected_version::TEXT,
    TRUE
  );

  UPDATE platform.document_slots AS slot
  SET
    version = slot.version + 1,
    updated_at = statement_timestamp()
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND slot.id = p_document_slot_id
    AND slot.version = p_expected_version
  RETURNING slot.* INTO slot_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  PERFORM pg_catalog.set_config(
    'platform_private.document_slot_case_link_context',
    '',
    TRUE
  );

  result := replay_shape || jsonb_build_object(
    'document_slot_case_link_id', CASE WHEN p_enabled THEN changed_link.id ELSE NULL END,
    'version', slot_row.version::TEXT,
    'changed_at', slot_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    action_name,
    'document_slot',
    p_document_slot_id,
    before_state,
    result,
    normalized_reason,
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.set_document_slot_case_link(
  UUID,
  UUID,
  UUID,
  platform.document_slot_case_link_target_kind,
  UUID,
  BOOLEAN,
  BIGINT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_document_slot_case_link(
  UUID,
  UUID,
  UUID,
  platform.document_slot_case_link_target_kind,
  UUID,
  BOOLEAN,
  BIGINT,
  TEXT,
  UUID
)
  TO authenticated;
