-- ============================================================
-- 108_platform_dynamic_document_checklists.sql
--
-- V3-F extends the canonical document requirement/slot authority with
-- case-local labels, groups and custom checklist items. Requirements remain
-- the shared baseline; custom intent lives only on a case-bound slot.
-- Removal is soft so immutable versions and private Storage evidence remain.
-- ============================================================

BEGIN;

CREATE TYPE platform.document_slot_intent_kind AS ENUM (
  'baseline',
  'custom'
);

ALTER TABLE platform.document_requirements
  ADD COLUMN group_label TEXT NOT NULL
    DEFAULT 'Обязательные документы',
  ADD CONSTRAINT document_requirements_group_label_check CHECK (
    char_length(btrim(group_label)) BETWEEN 1 AND 200
    AND group_label !~ '[[:cntrl:]]'
  );

ALTER TABLE platform.document_slots
  ALTER COLUMN requirement_id DROP NOT NULL,
  ADD COLUMN intent_kind platform.document_slot_intent_kind
    NOT NULL DEFAULT 'baseline',
  ADD COLUMN display_label TEXT,
  ADD COLUMN group_label TEXT,
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN removed_at TIMESTAMPTZ,
  ADD COLUMN removed_by_membership_id UUID,
  ADD COLUMN removal_reason TEXT,
  ADD CONSTRAINT document_slots_intent_shape_check CHECK (
    (
      intent_kind = 'baseline'
      AND requirement_id IS NOT NULL
    )
    OR (
      intent_kind = 'custom'
      AND requirement_id IS NULL
      AND display_label IS NOT NULL
      AND group_label IS NOT NULL
    )
  ),
  ADD CONSTRAINT document_slots_display_label_check CHECK (
    display_label IS NULL
    OR (
      char_length(btrim(display_label)) BETWEEN 1 AND 500
      AND display_label !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT document_slots_group_label_check CHECK (
    group_label IS NULL
    OR (
      char_length(btrim(group_label)) BETWEEN 1 AND 200
      AND group_label !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT document_slots_version_check CHECK (version > 0),
  ADD CONSTRAINT document_slots_removal_shape_check CHECK (
    (
      removed_at IS NULL
      AND removed_by_membership_id IS NULL
      AND removal_reason IS NULL
    )
    OR (
      removed_at IS NOT NULL
      AND removed_by_membership_id IS NOT NULL
      AND removal_reason IS NOT NULL
      AND char_length(btrim(removal_reason)) BETWEEN 1 AND 1000
      AND removal_reason !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT document_slots_removed_by_fkey
    FOREIGN KEY (organization_id, removed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT;

CREATE INDEX document_slots_active_case_group_idx
  ON platform.document_slots (
    organization_id,
    student_case_id,
    group_label,
    updated_at DESC,
    id
  )
  WHERE removed_at IS NULL;

CREATE INDEX document_slots_removed_by_idx
  ON platform.document_slots (
    organization_id,
    removed_by_membership_id
  )
  WHERE removed_by_membership_id IS NOT NULL;

-- Keep the Admin audit journal allowlist synchronized with the new canonical
-- commands. Migration 092 is the current predecessor and already composes all
-- earlier safe actions through its private pre-U10 helper.
CREATE OR REPLACE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_u10()
      || ARRAY[
        'pilot.cohort.configured',
        'pilot.cohort.member.automatic',
        'pilot.cohort.member.included',
        'pilot.cohort.member.excluded',
        'document.slot.custom.create',
        'document.slot.metadata.change',
        'document.slot.remove'
      ]::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The original P2E slot guard accepted only upload/review status transitions.
-- Keep that contract and add metadata/removal transitions with one monotonic
-- aggregate version. Once removed, a slot and its pointer are frozen.
CREATE OR REPLACE FUNCTION platform_private.guard_dynamic_document_slot_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  status_transition BOOLEAN;
  metadata_changed BOOLEAN;
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

  IF metadata_changed THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
      OR NEW.current_version_no IS DISTINCT FROM OLD.current_version_no
    THEN
      RAISE EXCEPTION 'Document slot metadata transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
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

DROP TRIGGER document_slots_transition_guard
  ON platform.document_slots;
CREATE TRIGGER document_slots_transition_guard
  BEFORE UPDATE ON platform.document_slots
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_dynamic_document_slot_transition();

-- Every metadata creation path ultimately inserts a canonical version. This
-- guard therefore blocks both the service metadata command and a browser
-- reservation from opening a new upload after soft removal.
CREATE OR REPLACE FUNCTION platform_private.guard_active_document_slot_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.document_slots AS slot
    WHERE slot.organization_id = NEW.organization_id
      AND slot.id = NEW.document_slot_id
      AND slot.student_case_id = NEW.student_case_id
      AND slot.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Document slot is unavailable for a new version'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_active_document_slot_version()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER document_versions_require_active_slot
  BEFORE INSERT ON platform.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_active_document_slot_version();

-- Revoke an already-issued but not-yet-consumed browser reservation as soon
-- as its slot is removed. Existing Storage objects and download evidence are
-- deliberately unaffected.
CREATE OR REPLACE FUNCTION private.platform_can_upload_reserved_document(
  p_bucket_id TEXT,
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.document_upload_reservations AS reservation
    JOIN platform_private.document_storage_bindings AS binding
      ON binding.organization_id = reservation.organization_id
      AND binding.upload_reservation_id = reservation.id
      AND binding.document_version_id = reservation.document_version_id
      AND binding.bucket_id = reservation.bucket_id
      AND binding.object_name = reservation.object_name
    JOIN platform.document_versions AS version
      ON version.organization_id = reservation.organization_id
      AND version.id = reservation.document_version_id
      AND version.student_case_id = reservation.student_case_id
      AND version.document_slot_id = reservation.document_slot_id
    JOIN platform.document_slots AS slot
      ON slot.organization_id = reservation.organization_id
      AND slot.id = reservation.document_slot_id
      AND slot.student_case_id = reservation.student_case_id
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = reservation.organization_id
      AND student_case.id = reservation.student_case_id
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = reservation.organization_id
      AND membership.id = reservation.uploader_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = reservation.uploader_profile_id
      AND profile.id = membership.profile_id
    WHERE reservation.bucket_id = p_bucket_id
      AND reservation.object_name = p_object_name
      AND reservation.expires_at > statement_timestamp()
      AND reservation.uploader_auth_user_id = (SELECT auth.uid())
      AND profile.auth_user_id = reservation.uploader_auth_user_id
      AND slot.removed_at IS NULL
      AND version.integrity_status = 'pending'
      AND version.malware_status = 'pending'
      AND private.platform_has_permission(
        reservation.organization_id,
        'document.upload'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'organization',
            reservation.organization_id
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'student_case',
            reservation.student_case_id
          )
        )
        OR (
          membership."current_role" = 'student'
          AND student_case.state IN ('active', 'closed')
          AND student_case.student_membership_id = membership.id
          AND student_case.portal_activated_at IS NOT NULL
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'student_case',
            reservation.student_case_id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION
  private.platform_can_upload_reserved_document(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_can_upload_reserved_document(TEXT, TEXT)
  TO authenticated;

CREATE FUNCTION platform.create_custom_document_slot(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_label TEXT,
  p_group_label TEXT,
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
  replayed JSONB;
  replay_shape JSONB;
  created_slot_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Custom case document slot created';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_label IS NULL
    OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 500
    OR p_label ~ '[[:cntrl:]]'
    OR p_group_label IS NULL
    OR char_length(btrim(p_group_label)) NOT BETWEEN 1 AND 200
    OR p_group_label ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Document slot label and group are required'
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
    'document_requirement_id', NULL,
    'requirement_label', btrim(p_label),
    'group_label', btrim(p_group_label),
    'intent_kind', 'custom',
    'slot_status', 'required',
    'version', '1',
    'request_id', p_request_id
  );

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.custom.create',
    'document_slot',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.custom.create',
    'document_slot',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.document_slots (
    id,
    organization_id,
    student_case_id,
    requirement_id,
    intent_kind,
    display_label,
    group_label,
    status,
    version,
    created_by_membership_id
  )
  VALUES (
    created_slot_id,
    p_organization_id,
    p_student_case_id,
    NULL,
    'custom',
    btrim(p_label),
    btrim(p_group_label),
    'required',
    1,
    actor.actor_membership_id
  );

  result := replay_shape || jsonb_build_object(
    'document_slot_id', created_slot_id
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
    'document.slot.custom.create',
    'document_slot',
    created_slot_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.change_document_slot_metadata(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
  p_label TEXT,
  p_group_label TEXT,
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
  requirement_row platform.document_requirements%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_display_label TEXT;
  next_group_label TEXT;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Case document slot metadata changed';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_document_slot_id IS NULL
    OR p_student_case_id IS NULL
    OR p_label IS NULL
    OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 500
    OR p_label ~ '[[:cntrl:]]'
    OR p_group_label IS NULL
    OR char_length(btrim(p_group_label)) NOT BETWEEN 1 AND 200
    OR p_group_label ~ '[[:cntrl:]]'
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Document slot metadata and reason are required'
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
    'requirement_label', btrim(p_label),
    'group_label', btrim(p_group_label),
    'expected_version', p_expected_version::TEXT,
    'request_id', p_request_id
  );

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.metadata.change',
    'document_slot',
    p_document_slot_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
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

  IF slot_row.requirement_id IS NOT NULL THEN
    SELECT requirement.* INTO requirement_row
    FROM platform.document_requirements AS requirement
    WHERE requirement.organization_id = p_organization_id
      AND requirement.id = slot_row.requirement_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Document slot is unavailable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.metadata.change',
    'document_slot',
    p_document_slot_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF slot_row.version <> p_expected_version
    OR slot_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF slot_row.intent_kind = 'baseline' THEN
    next_display_label := CASE
      WHEN btrim(p_label) = requirement_row.label THEN NULL
      ELSE btrim(p_label)
    END;
    next_group_label := CASE
      WHEN btrim(p_group_label) = requirement_row.group_label THEN NULL
      ELSE btrim(p_group_label)
    END;
  ELSE
    next_display_label := btrim(p_label);
    next_group_label := btrim(p_group_label);
  END IF;

  IF COALESCE(slot_row.display_label, requirement_row.label)
      = btrim(p_label)
    AND COALESCE(slot_row.group_label, requirement_row.group_label)
      = btrim(p_group_label)
  THEN
    RAISE EXCEPTION 'Document slot metadata must change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.document_slots AS slot
  SET
    display_label = next_display_label,
    group_label = next_group_label
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND slot.id = p_document_slot_id
  RETURNING slot.version, slot.updated_at
  INTO next_version, changed_at;

  result := replay_shape || jsonb_build_object(
    'document_requirement_id', slot_row.requirement_id,
    'intent_kind', slot_row.intent_kind,
    'slot_status', slot_row.status,
    'version', next_version::TEXT,
    'changed_at', changed_at
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
    'document.slot.metadata.change',
    'document_slot',
    p_document_slot_id,
    jsonb_build_object(
      'requirement_label',
        COALESCE(slot_row.display_label, requirement_row.label),
      'group_label',
        COALESCE(slot_row.group_label, requirement_row.group_label),
      'intent_kind', slot_row.intent_kind,
      'slot_status', slot_row.status,
      'version', slot_row.version::TEXT
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.remove_document_slot(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
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
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  removed_at_value TIMESTAMPTZ := statement_timestamp();
  fixed_reason CONSTANT TEXT := 'Case document slot removed';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_document_slot_id IS NULL
    OR p_student_case_id IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Document slot and removal reason are required'
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
    'expected_version', p_expected_version::TEXT,
    'removal_reason', btrim(p_reason),
    'request_id', p_request_id
  );

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.remove',
    'document_slot',
    p_document_slot_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
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

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.remove',
    'document_slot',
    p_document_slot_id,
    btrim(p_reason),
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF slot_row.version <> p_expected_version
    OR slot_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform.document_slots AS slot
  SET
    removed_at = removed_at_value,
    removed_by_membership_id = actor.actor_membership_id,
    removal_reason = btrim(p_reason)
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND slot.id = p_document_slot_id
  RETURNING slot.version
  INTO next_version;

  result := replay_shape || jsonb_build_object(
    'intent_kind', slot_row.intent_kind,
    'version', next_version::TEXT,
    'removed_at', removed_at_value
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
    'document.slot.remove',
    'document_slot',
    p_document_slot_id,
    jsonb_build_object(
      'intent_kind', slot_row.intent_kind,
      'slot_status', slot_row.status,
      'version', slot_row.version::TEXT,
      'removed_at', slot_row.removed_at
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

-- Queue row shape remains byte-for-byte compatible; only the resolved label
-- and active-only membership change.
CREATE OR REPLACE FUNCTION platform.staff_document_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  document_slot_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  document_requirement_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  current_version_id UUID,
  current_version_no TEXT,
  current_original_filename TEXT,
  current_declared_mime_type TEXT,
  current_byte_size TEXT,
  current_sha256_hex TEXT,
  current_integrity_status platform.document_integrity_status,
  current_malware_status platform.document_malware_status,
  current_review_decision platform.document_review_decision,
  current_review_reason TEXT,
  current_version_finalized_at TIMESTAMPTZ,
  download_ready BOOLEAN,
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
    RAISE EXCEPTION 'Document queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('document.read.full');

  RETURN QUERY
  SELECT
    slot.updated_at,
    slot.organization_id,
    slot.id,
    slot.student_case_id,
    student_case.student_display_name,
    student_case.state,
    requirement.id,
    requirement.requirement_key,
    COALESCE(slot.display_label, requirement.label),
    slot.status,
    slot.deadline,
    slot.next_action,
    current_version.id,
    current_version.version_no::TEXT,
    current_version.original_filename,
    current_version.declared_mime_type,
    current_version.byte_size::TEXT,
    current_version.sha256_hex,
    current_version.integrity_status,
    current_version.malware_status,
    latest_review.decision,
    latest_review.reason,
    finalization.finalized_at,
    (
      finalization.id IS NOT NULL
      AND current_version.integrity_status = 'verified'
      AND current_version.malware_status = 'clean'
    ),
    slot.created_at,
    slot.updated_at
  FROM platform.document_slots AS slot
  LEFT JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = slot.organization_id
    AND student_case.id = slot.student_case_id
  LEFT JOIN platform.document_versions AS current_version
    ON current_version.organization_id = slot.organization_id
    AND current_version.id = slot.current_version_id
    AND current_version.student_case_id = slot.student_case_id
    AND current_version.document_slot_id = slot.id
  LEFT JOIN platform_private.document_upload_finalizations AS finalization
    ON finalization.organization_id = current_version.organization_id
    AND finalization.document_version_id = current_version.id
  LEFT JOIN LATERAL (
    SELECT
      review.decision,
      review.reason
    FROM platform.document_reviews AS review
    WHERE review.organization_id = current_version.organization_id
      AND review.document_version_id = current_version.id
    ORDER BY review.created_at DESC, review.id DESC
    LIMIT 1
  ) AS latest_review ON TRUE
  WHERE slot.organization_id = actor.organization_id
    AND slot.removed_at IS NULL
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY slot.updated_at DESC, slot.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_document_workspace(
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
  target_case platform.student_cases%ROWTYPE;
  slots_payload JSONB;
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_case_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('document.read.full');

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case documents are unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      slot_row.payload
      ORDER BY slot_row.sort_deadline NULLS LAST,
        slot_row.sort_label,
        slot_row.document_slot_id
    ),
    '[]'::JSONB
  )
  INTO slots_payload
  FROM (
    SELECT
      slot.id AS document_slot_id,
      slot.deadline AS sort_deadline,
      lower(COALESCE(slot.display_label, requirement.label)) AS sort_label,
      jsonb_build_object(
        'document_slot_id', slot.id,
        'document_requirement_id', requirement.id,
        'requirement_key', requirement.requirement_key,
        'requirement_label',
          COALESCE(slot.display_label, requirement.label),
        'group_label', COALESCE(slot.group_label, requirement.group_label),
        'intent_kind', slot.intent_kind,
        'slot_version', slot.version::TEXT,
        'instructions', requirement.instructions,
        'checklist_version', requirement.checklist_version::TEXT,
        'slot_status', slot.status,
        'deadline', slot.deadline,
        'next_action', slot.next_action,
        'current_version_id', slot.current_version_id,
        'current_version_no', slot.current_version_no::TEXT,
        'created_at', slot.created_at,
        'updated_at', slot.updated_at,
        'versions', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'document_version_id', version.id,
                'version_no', version.version_no::TEXT,
                'original_filename', version.original_filename,
                'declared_mime_type', version.declared_mime_type,
                'byte_size', version.byte_size::TEXT,
                'sha256_hex', version.sha256_hex,
                'integrity_status', version.integrity_status,
                'malware_status', version.malware_status,
                'validation_updated_at', version.validation_updated_at,
                'submitted_by_membership_id',
                  version.submitted_by_membership_id,
                'submitted_by_display_name', submitter_profile.display_name,
                'storage_finalized', finalization.id IS NOT NULL,
                'finalized_at', finalization.finalized_at,
                'download_ready', (
                  finalization.id IS NOT NULL
                  AND version.integrity_status = 'verified'
                  AND version.malware_status = 'clean'
                ),
                'is_current', slot.current_version_id = version.id,
                'latest_review', CASE
                  WHEN latest_review.review_id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'decision', latest_review.decision,
                    'reason', latest_review.reason,
                    'reviewer_membership_id',
                      latest_review.reviewer_membership_id,
                    'reviewer_display_name',
                      latest_review.reviewer_display_name,
                    'reviewed_at', latest_review.reviewed_at
                  )
                END,
                'created_at', version.created_at,
                'updated_at', version.updated_at
              )
              ORDER BY version.version_no DESC, version.id
            ),
            '[]'::JSONB
          )
          FROM platform.document_versions AS version
          JOIN platform.organization_memberships AS submitter_membership
            ON submitter_membership.organization_id = version.organization_id
            AND submitter_membership.id = version.submitted_by_membership_id
          JOIN platform.profiles AS submitter_profile
            ON submitter_profile.id = submitter_membership.profile_id
          LEFT JOIN platform_private.document_upload_finalizations AS finalization
            ON finalization.organization_id = version.organization_id
            AND finalization.document_version_id = version.id
          LEFT JOIN LATERAL (
            SELECT
              review.id AS review_id,
              review.decision,
              review.reason,
              review.reviewer_membership_id,
              reviewer_profile.display_name AS reviewer_display_name,
              review.created_at AS reviewed_at
            FROM platform.document_reviews AS review
            JOIN platform.organization_memberships AS reviewer_membership
              ON reviewer_membership.organization_id = review.organization_id
              AND reviewer_membership.id = review.reviewer_membership_id
            JOIN platform.profiles AS reviewer_profile
              ON reviewer_profile.id = reviewer_membership.profile_id
            WHERE review.organization_id = version.organization_id
              AND review.document_version_id = version.id
            ORDER BY review.created_at DESC, review.id DESC
            LIMIT 1
          ) AS latest_review ON TRUE
          WHERE version.organization_id = slot.organization_id
            AND version.student_case_id = slot.student_case_id
            AND version.document_slot_id = slot.id
        )
      ) AS payload
    FROM platform.document_slots AS slot
    LEFT JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = slot.organization_id
      AND requirement.id = slot.requirement_id
    WHERE slot.organization_id = target_case.organization_id
      AND slot.student_case_id = target_case.id
      AND slot.removed_at IS NULL
  ) AS slot_row;

  RETURN jsonb_build_object(
    'organization_id', target_case.organization_id,
    'student_case_id', target_case.id,
    'case_state', target_case.state,
    'slots', slots_payload
  );
END
$$;

REVOKE ALL ON FUNCTION platform.create_custom_document_slot(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_custom_document_slot(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID
)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.change_document_slot_metadata(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_document_slot_metadata(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.remove_document_slot(
  UUID,
  UUID,
  UUID,
  BIGINT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.remove_document_slot(
  UUID,
  UUID,
  UUID,
  BIGINT,
  TEXT,
  UUID
)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_document_queue(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_document_queue(INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.staff_student_case_document_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.staff_student_case_document_workspace(UUID)
  TO authenticated;

COMMIT;
