-- ============================================================
-- 113_platform_document_case_links.sql
--
-- V3-F connects one canonical case document slot to the university
-- application or visa case that needs it. The document slot and document
-- version remain the only file authority; this table only records case-local
-- relevance links.
-- ============================================================

BEGIN;

CREATE TYPE platform.document_slot_case_link_target_kind AS ENUM (
  'university_application',
  'visa_case'
);

CREATE TABLE platform.document_slot_case_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  target_kind platform.document_slot_case_link_target_kind NOT NULL,
  university_application_id UUID,
  visa_case_id UUID,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_slot_case_links_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_slot_case_links_target_shape_check CHECK (
    (
      target_kind = 'university_application'
      AND university_application_id IS NOT NULL
      AND visa_case_id IS NULL
    )
    OR (
      target_kind = 'visa_case'
      AND university_application_id IS NULL
      AND visa_case_id IS NOT NULL
    )
  ),
  CONSTRAINT document_slot_case_links_document_slot_fkey
    FOREIGN KEY (organization_id, document_slot_id, student_case_id)
    REFERENCES platform.document_slots(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slot_case_links_university_application_fkey
    FOREIGN KEY (organization_id, university_application_id, student_case_id)
    REFERENCES platform.university_applications(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slot_case_links_visa_case_fkey
    FOREIGN KEY (organization_id, visa_case_id, student_case_id)
    REFERENCES platform.visa_cases(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slot_case_links_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX document_slot_case_links_application_key
  ON platform.document_slot_case_links (
    organization_id,
    student_case_id,
    document_slot_id,
    university_application_id
  )
  WHERE university_application_id IS NOT NULL;

CREATE UNIQUE INDEX document_slot_case_links_visa_case_key
  ON platform.document_slot_case_links (
    organization_id,
    student_case_id,
    document_slot_id,
    visa_case_id
  )
  WHERE visa_case_id IS NOT NULL;

CREATE INDEX document_slot_case_links_slot_idx
  ON platform.document_slot_case_links (
    organization_id,
    student_case_id,
    document_slot_id,
    target_kind
  );

CREATE INDEX document_slot_case_links_application_idx
  ON platform.document_slot_case_links (
    organization_id,
    student_case_id,
    university_application_id
  )
  WHERE university_application_id IS NOT NULL;

CREATE INDEX document_slot_case_links_visa_case_idx
  ON platform.document_slot_case_links (
    organization_id,
    student_case_id,
    visa_case_id
  )
  WHERE visa_case_id IS NOT NULL;

CREATE INDEX document_slot_case_links_created_by_idx
  ON platform.document_slot_case_links (
    organization_id,
    created_by_membership_id
  );

ALTER TABLE platform.document_slot_case_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_slot_case_links FORCE ROW LEVEL SECURITY;

CREATE POLICY document_slot_case_links_full_read
  ON platform.document_slot_case_links
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(organization_id, student_case_id))
  );

REVOKE ALL PRIVILEGES ON TYPE
  platform.document_slot_case_link_target_kind
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON TYPE platform.document_slot_case_link_target_kind
  TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE platform.document_slot_case_links
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE platform.document_slot_case_links
  TO authenticated;

COMMENT ON TYPE platform.document_slot_case_link_target_kind IS
  'Document-slot target kind for case-local application or visa relevance links.';
COMMENT ON TABLE platform.document_slot_case_links IS
  'Case-local links from canonical document slots to the application or visa case that needs the same file evidence.';

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_v3f_document_links;

CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY(
    SELECT DISTINCT action
    FROM unnest(
      platform_private.p7a_safe_audit_actions_pre_v3f_document_links()
      || ARRAY[
        'document.slot.application.link',
        'document.slot.application.unlink',
        'document.slot.visa.link',
        'document.slot.visa.unlink'
      ]::TEXT[]
    ) AS action
    ORDER BY action
  )
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions_pre_v3f_document_links()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Migration 108 admits only document status, metadata and removal changes.
-- A case-link is part of the slot aggregate, so its canonical command must be
-- able to advance the same optimistic version without changing slot data.
-- The exact row comparison keeps every other unsupported transition closed;
-- authenticated roles still have no direct UPDATE privilege on this table.
CREATE OR REPLACE FUNCTION platform_private.guard_dynamic_document_slot_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  status_transition BOOLEAN;
  metadata_changed BOOLEAN;
  aggregate_version_only BOOLEAN;
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

  aggregate_version_only :=
    NEW.version = OLD.version + 1
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
  ELSIF NOT status_transition AND NOT aggregate_version_only THEN
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

CREATE FUNCTION platform.set_document_slot_case_link(
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
  removed_slots_payload JSONB;
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

  SELECT
    COALESCE(
      jsonb_agg(
        slot_row.payload
        ORDER BY slot_row.sort_deadline NULLS LAST,
          slot_row.sort_label,
          slot_row.document_slot_id
      ) FILTER (WHERE slot_row.removed_at IS NULL),
      '[]'::JSONB
    ),
    COALESCE(
      jsonb_agg(
        slot_row.payload || jsonb_build_object(
          'removed_at', slot_row.removed_at,
          'removed_by_membership_id', slot_row.removed_by_membership_id,
          'removal_reason', slot_row.removal_reason
        )
        ORDER BY slot_row.removed_at DESC, slot_row.document_slot_id
      ) FILTER (WHERE slot_row.removed_at IS NOT NULL),
      '[]'::JSONB
    )
  INTO slots_payload, removed_slots_payload
  FROM (
    SELECT
      slot.id AS document_slot_id,
      slot.deadline AS sort_deadline,
      lower(COALESCE(slot.display_label, requirement.label)) AS sort_label,
      slot.removed_at,
      slot.removed_by_membership_id,
      slot.removal_reason,
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
        'case_links', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'document_slot_case_link_id', link.id,
                'target_kind', link.target_kind,
                'university_application_id', link.university_application_id,
                'visa_case_id', link.visa_case_id,
                'created_by_membership_id', link.created_by_membership_id,
                'created_at', link.created_at
              )
              ORDER BY link.target_kind, link.created_at, link.id
            ),
            '[]'::JSONB
          )
          FROM platform.document_slot_case_links AS link
          WHERE link.organization_id = slot.organization_id
            AND link.student_case_id = slot.student_case_id
            AND link.document_slot_id = slot.id
        ),
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
  ) AS slot_row;

  RETURN jsonb_build_object(
    'organization_id', target_case.organization_id,
    'student_case_id', target_case.id,
    'case_state', target_case.state,
    'slots', slots_payload,
    'removed_slots', removed_slots_payload
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_document_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_document_workspace(UUID)
  TO authenticated;

COMMIT;
