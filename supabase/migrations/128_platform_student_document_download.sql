-- ============================================================
-- 128_platform_student_document_download.sql
--
-- Stage E5: current-version-only Student Portal document grants.
-- The established grant/consume bodies remain the single implementation for
-- audit, expiry, revocation and signing facts. Narrow non-exposed wrappers add
-- Student role and current-slot checks at both transaction boundaries.
-- ============================================================

BEGIN;

-- Every Student HTTP upload attempt consumes a durable admission before the
-- request body or ClamAV is touched. The stable request id binds retries to one
-- actor and slot; each actual retry still receives its own bounded lease and
-- counts toward the rolling limits.
CREATE TABLE platform_private.student_document_scan_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  attempt_no BIGINT NOT NULL CHECK (attempt_no > 0),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  uploader_profile_id UUID NOT NULL,
  uploader_membership_id UUID NOT NULL,
  uploader_auth_user_id UUID NOT NULL,
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  scan_claimed_at TIMESTAMPTZ,
  scan_lease_expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_outcome TEXT CHECK (
    release_outcome IN ('completed', 'rejected', 'failed')
  ),
  CONSTRAINT student_document_scan_admissions_request_attempt_key
    UNIQUE (request_id, attempt_no),
  CONSTRAINT student_document_scan_admissions_slot_fkey
    FOREIGN KEY (organization_id, document_slot_id, student_case_id)
    REFERENCES platform.document_slots(
      organization_id,
      id,
      student_case_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_document_scan_admissions_profile_fkey
    FOREIGN KEY (uploader_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT student_document_scan_admissions_membership_fkey
    FOREIGN KEY (organization_id, uploader_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_document_scan_admissions_lease_check CHECK (
    lease_expires_at > admitted_at
    AND lease_expires_at <= admitted_at + INTERVAL '15 minutes'
  ),
  CONSTRAINT student_document_scan_admissions_scan_lease_check CHECK (
    (scan_claimed_at IS NULL AND scan_lease_expires_at IS NULL)
    OR (
      scan_claimed_at IS NOT NULL
      AND scan_lease_expires_at IS NOT NULL
      AND scan_claimed_at >= admitted_at
      AND scan_lease_expires_at > scan_claimed_at
      AND scan_lease_expires_at <= scan_claimed_at + INTERVAL '15 minutes'
    )
  ),
  CONSTRAINT student_document_scan_admissions_release_check CHECK (
    (released_at IS NULL AND release_outcome IS NULL)
    OR (
      released_at IS NOT NULL
      AND released_at >= admitted_at
      AND release_outcome IS NOT NULL
    )
  )
);

CREATE INDEX student_document_scan_admissions_actor_window_idx
  ON platform_private.student_document_scan_admissions(
    organization_id,
    uploader_auth_user_id,
    admitted_at DESC
  );
CREATE INDEX student_document_scan_admissions_slot_window_idx
  ON platform_private.student_document_scan_admissions(
    organization_id,
    document_slot_id,
    admitted_at DESC
  );
CREATE INDEX student_document_scan_admissions_active_global_idx
  ON platform_private.student_document_scan_admissions(scan_lease_expires_at)
  WHERE released_at IS NULL AND scan_claimed_at IS NOT NULL;
CREATE INDEX student_document_scan_admissions_active_actor_idx
  ON platform_private.student_document_scan_admissions(
    organization_id,
    uploader_auth_user_id,
    scan_lease_expires_at
  )
  WHERE released_at IS NULL AND scan_claimed_at IS NOT NULL;
CREATE INDEX student_document_scan_admissions_active_slot_idx
  ON platform_private.student_document_scan_admissions(
    organization_id,
    document_slot_id,
    scan_lease_expires_at
  )
  WHERE released_at IS NULL AND scan_claimed_at IS NOT NULL;

ALTER TABLE platform_private.student_document_scan_admissions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_document_scan_admissions
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.student_document_scan_admissions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.admit_student_document_upload_scan(
  p_organization_id UUID,
  p_document_slot_id UUID,
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
  case_row platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  prior_admission platform_private.student_document_scan_admissions%ROWTYPE;
  admission_row platform_private.student_document_scan_admissions%ROWTYPE;
  replay_document RECORD;
  checked_at TIMESTAMPTZ := statement_timestamp();
  next_attempt_no BIGINT;
  recent_actor_attempts BIGINT;
  recent_slot_attempts BIGINT;
BEGIN
  IF p_organization_id IS NULL
    OR p_document_slot_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Valid Student scan admission input is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.upload'
  );
  IF actor.actor_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Student document authority is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-request:' || p_request_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-actor:'
      || p_organization_id::TEXT
      || ':'
      || actor.actor_auth_user_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-slot:'
      || p_organization_id::TEXT
      || ':'
      || p_document_slot_id::TEXT,
      0
    )
  );

  SELECT student_case.*
  INTO case_row
  FROM platform.student_cases AS student_case
  JOIN platform.document_slots AS slot
    ON slot.organization_id = student_case.organization_id
    AND slot.student_case_id = student_case.id
  WHERE student_case.organization_id = p_organization_id
    AND slot.id = p_document_slot_id
    AND slot.removed_at IS NULL
    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL
    AND platform_private.membership_has_active_scope(
      p_organization_id,
      actor.actor_membership_id,
      'student_case',
      student_case.id
    )
  FOR UPDATE OF student_case, slot;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = p_document_slot_id
    AND slot.student_case_id = case_row.id
    AND slot.removed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior_admission
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.request_id = p_request_id
  ORDER BY admission.attempt_no DESC
  LIMIT 1;
  IF FOUND AND (
    prior_admission.organization_id IS DISTINCT FROM p_organization_id
    OR prior_admission.student_case_id IS DISTINCT FROM case_row.id
    OR prior_admission.document_slot_id IS DISTINCT FROM p_document_slot_id
    OR prior_admission.uploader_profile_id IS DISTINCT FROM actor.actor_profile_id
    OR prior_admission.uploader_membership_id IS DISTINCT FROM actor.actor_membership_id
    OR prior_admission.uploader_auth_user_id IS DISTINCT FROM actor.actor_auth_user_id
  ) THEN
    RAISE EXCEPTION 'request_id was already used for another scan authority'
      USING ERRCODE = '23505';
  END IF;

  IF FOUND AND prior_admission.release_outcome = 'completed' THEN
    SELECT
      version.id AS document_version_id,
      version.version_no,
      version.original_filename,
      version.declared_mime_type,
      version.byte_size
    INTO replay_document
    FROM platform_private.document_upload_reservations AS reservation
    JOIN platform_private.document_upload_finalizations AS finalization
      ON finalization.organization_id = reservation.organization_id
      AND finalization.upload_reservation_id = reservation.id
      AND finalization.document_version_id = reservation.document_version_id
    JOIN platform.document_versions AS version
      ON version.organization_id = reservation.organization_id
      AND version.id = reservation.document_version_id
      AND version.student_case_id = reservation.student_case_id
      AND version.document_slot_id = reservation.document_slot_id
      AND version.version_no = finalization.published_version_no
    WHERE reservation.request_id = p_request_id
      AND reservation.organization_id = p_organization_id
      AND reservation.student_case_id = case_row.id
      AND reservation.document_slot_id = p_document_slot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Completed Student scan receipt is unavailable'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'admission_id', prior_admission.id,
      'organization_id', prior_admission.organization_id,
      'student_case_id', prior_admission.student_case_id,
      'document_slot_id', prior_admission.document_slot_id,
      'request_id', prior_admission.request_id,
      'attempt_no', prior_admission.attempt_no,
      'admitted_at', prior_admission.admitted_at,
      'lease_expires_at', prior_admission.lease_expires_at,
      'request_retry', TRUE,
      'scan_allowed', FALSE,
      'terminal_replay', TRUE,
      'document_version_id', replay_document.document_version_id,
      'version_no', replay_document.version_no,
      'original_filename', replay_document.original_filename,
      'declared_mime_type', replay_document.declared_mime_type,
      'byte_size', replay_document.byte_size
    );
  END IF;

  IF slot_row.status = 'approved' THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.student_document_scan_admissions AS admission
    WHERE admission.request_id = p_request_id
      AND admission.released_at IS NULL
      AND admission.lease_expires_at > checked_at
  ) THEN
    RAISE EXCEPTION 'Student document scan is already in progress'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*) INTO recent_actor_attempts
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.organization_id = p_organization_id
    AND admission.uploader_auth_user_id = actor.actor_auth_user_id
    AND admission.admitted_at > checked_at - INTERVAL '1 hour';
  SELECT count(*) INTO recent_slot_attempts
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.organization_id = p_organization_id
    AND admission.document_slot_id = p_document_slot_id
    AND admission.admitted_at > checked_at - INTERVAL '1 hour';
  IF recent_actor_attempts >= 60 OR recent_slot_attempts >= 12 THEN
    RAISE EXCEPTION 'Student document scan request limit reached'
      USING ERRCODE = 'PT429';
  END IF;

  SELECT COALESCE(max(admission.attempt_no), 0) + 1
  INTO next_attempt_no
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.request_id = p_request_id;

  INSERT INTO platform_private.student_document_scan_admissions (
    request_id,
    attempt_no,
    organization_id,
    student_case_id,
    document_slot_id,
    uploader_profile_id,
    uploader_membership_id,
    uploader_auth_user_id,
    admitted_at,
    lease_expires_at
  ) VALUES (
    p_request_id,
    next_attempt_no,
    p_organization_id,
    case_row.id,
    p_document_slot_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    checked_at,
    checked_at + INTERVAL '15 minutes'
  )
  RETURNING * INTO admission_row;

  RETURN jsonb_build_object(
    'admission_id', admission_row.id,
    'organization_id', admission_row.organization_id,
    'student_case_id', admission_row.student_case_id,
    'document_slot_id', admission_row.document_slot_id,
    'request_id', admission_row.request_id,
    'attempt_no', admission_row.attempt_no,
    'admitted_at', admission_row.admitted_at,
    'lease_expires_at', admission_row.lease_expires_at,
    'request_retry', admission_row.attempt_no > 1,
    'scan_allowed', TRUE,
    'terminal_replay', FALSE,
    'document_version_id', NULL,
    'version_no', NULL,
    'original_filename', NULL,
    'declared_mime_type', NULL,
    'byte_size', NULL
  );
END
$$;

CREATE FUNCTION private.claim_student_document_upload_scan(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admission_row platform_private.student_document_scan_admissions%ROWTYPE;
  checked_at TIMESTAMPTZ := statement_timestamp();
  active_actor_scans BIGINT;
  active_slot_scans BIGINT;
  active_global_scans BIGINT;
  claim_replay BOOLEAN := FALSE;
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_auth_user_id IS NULL
    OR p_admission_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Valid Student scan claim input is required'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT * INTO admission_row
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.id = p_admission_id;
  IF NOT FOUND
    OR admission_row.organization_id IS DISTINCT FROM p_organization_id
    OR admission_row.uploader_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR admission_row.request_id IS DISTINCT FROM p_request_id
    OR admission_row.released_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Student scan admission is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('evo:e5:student-scan-global', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-actor:'
      || admission_row.organization_id::TEXT
      || ':'
      || admission_row.uploader_auth_user_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-slot:'
      || admission_row.organization_id::TEXT
      || ':'
      || admission_row.document_slot_id::TEXT,
      0
    )
  );

  SELECT * INTO admission_row
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.id = p_admission_id
  FOR UPDATE;
  IF NOT FOUND
    OR admission_row.organization_id IS DISTINCT FROM p_organization_id
    OR admission_row.uploader_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR admission_row.request_id IS DISTINCT FROM p_request_id
    OR admission_row.released_at IS NOT NULL
    OR admission_row.lease_expires_at <= checked_at
  THEN
    RAISE EXCEPTION 'Student scan admission has expired'
      USING ERRCODE = 'PT409';
  END IF;

  IF admission_row.scan_claimed_at IS NOT NULL THEN
    IF admission_row.scan_lease_expires_at <= checked_at THEN
      RAISE EXCEPTION 'Student scan claim has expired'
        USING ERRCODE = 'PT409';
    END IF;
    claim_replay := TRUE;
  ELSE
    SELECT count(*) INTO active_global_scans
    FROM platform_private.student_document_scan_admissions AS admission
    WHERE admission.scan_claimed_at IS NOT NULL
      AND admission.released_at IS NULL
      AND admission.scan_lease_expires_at > checked_at;
    SELECT count(*) INTO active_actor_scans
    FROM platform_private.student_document_scan_admissions AS admission
    WHERE admission.organization_id = admission_row.organization_id
      AND admission.uploader_auth_user_id = admission_row.uploader_auth_user_id
      AND admission.scan_claimed_at IS NOT NULL
      AND admission.released_at IS NULL
      AND admission.scan_lease_expires_at > checked_at;
    SELECT count(*) INTO active_slot_scans
    FROM platform_private.student_document_scan_admissions AS admission
    WHERE admission.organization_id = admission_row.organization_id
      AND admission.document_slot_id = admission_row.document_slot_id
      AND admission.scan_claimed_at IS NOT NULL
      AND admission.released_at IS NULL
      AND admission.scan_lease_expires_at > checked_at;
    IF active_global_scans >= 4
      OR active_actor_scans >= 2
      OR active_slot_scans >= 1
    THEN
      RAISE EXCEPTION 'Student document scan capacity is unavailable'
        USING ERRCODE = 'PT409';
    END IF;

    UPDATE platform_private.student_document_scan_admissions AS admission
    SET
      scan_claimed_at = checked_at,
      scan_lease_expires_at = checked_at + INTERVAL '15 minutes'
    WHERE admission.id = p_admission_id
    RETURNING * INTO admission_row;
  END IF;

  RETURN jsonb_build_object(
    'admission_id', admission_row.id,
    'organization_id', admission_row.organization_id,
    'request_id', admission_row.request_id,
    'scan_claimed_at', admission_row.scan_claimed_at,
    'claim_checked_at', checked_at,
    'scan_lease_expires_at', admission_row.scan_lease_expires_at,
    'scan_claim_replay', claim_replay,
    'scan_allowed', TRUE
  );
END
$$;

CREATE FUNCTION platform.claim_student_document_upload_scan(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.claim_student_document_upload_scan(
    p_organization_id,
    p_actor_auth_user_id,
    p_admission_id,
    p_request_id
  )
$$;

CREATE FUNCTION private.complete_student_document_upload_scan_admission(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID,
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admission_row platform_private.student_document_scan_admissions%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_auth_user_id IS NULL
    OR p_admission_id IS NULL
    OR p_request_id IS NULL
    OR p_outcome NOT IN ('completed', 'rejected', 'failed')
  THEN
    RAISE EXCEPTION 'Valid Student scan completion input is required'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:e5:student-scan-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT * INTO admission_row
  FROM platform_private.student_document_scan_admissions AS admission
  WHERE admission.id = p_admission_id
  FOR UPDATE;
  IF NOT FOUND
    OR admission_row.organization_id IS DISTINCT FROM p_organization_id
    OR admission_row.uploader_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR admission_row.request_id IS DISTINCT FROM p_request_id
  THEN
    RAISE EXCEPTION 'Student scan admission is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF admission_row.released_at IS NOT NULL
    AND admission_row.release_outcome IS DISTINCT FROM p_outcome
  THEN
    RAISE EXCEPTION 'Student scan admission outcome conflicts with replay'
      USING ERRCODE = '23505';
  END IF;

  IF admission_row.released_at IS NULL THEN
    UPDATE platform_private.student_document_scan_admissions AS admission
    SET
      released_at = statement_timestamp(),
      release_outcome = p_outcome
    WHERE admission.id = p_admission_id
    RETURNING * INTO admission_row;
  END IF;

  RETURN jsonb_build_object(
    'admission_id', admission_row.id,
    'organization_id', admission_row.organization_id,
    'request_id', admission_row.request_id,
    'released_at', admission_row.released_at,
    'release_outcome', admission_row.release_outcome
  );
END
$$;

CREATE FUNCTION platform.complete_student_document_upload_scan_admission(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID,
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.complete_student_document_upload_scan_admission(
    p_organization_id,
    p_actor_auth_user_id,
    p_admission_id,
    p_request_id,
    p_outcome
  )
$$;

REVOKE ALL ON FUNCTION platform.admit_student_document_upload_scan(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.admit_student_document_upload_scan(
  UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.claim_student_document_upload_scan(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.claim_student_document_upload_scan(
  UUID, UUID, UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.claim_student_document_upload_scan(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.claim_student_document_upload_scan(
  UUID, UUID, UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION private.complete_student_document_upload_scan_admission(
  UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.complete_student_document_upload_scan_admission(
  UUID, UUID, UUID, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION platform.complete_student_document_upload_scan_admission(
  UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.complete_student_document_upload_scan_admission(
  UUID, UUID, UUID, UUID, TEXT
) TO service_role;

COMMENT ON TABLE platform_private.student_document_scan_admissions IS
  'Durable Student upload scan admission lifecycle; every admitted attempt counts and active scan-claim leases bound cross-replica ClamAV work.';
COMMENT ON FUNCTION platform.admit_student_document_upload_scan(
  UUID, UUID, UUID
) IS
  'Student-only own-slot attempt admission before body read; it rate-limits but does not consume scarce ClamAV capacity.';
COMMENT ON FUNCTION platform.claim_student_document_upload_scan(
  UUID, UUID, UUID, UUID
) IS
  'Service-only ClamAV capacity claim after a complete bounded body and immediately before scanning.';
COMMENT ON FUNCTION platform.complete_student_document_upload_scan_admission(
  UUID, UUID, UUID, UUID, TEXT
) IS
  'Service-only idempotent terminal release of one Student scan admission.';

-- Upload reservation creates a higher pending version before the slot's
-- current pointer moves. Bind presentation to the canonical pointer instead of
-- asking the UI to infer currentness from MAX(version_no).
CREATE OR REPLACE FUNCTION platform.student_portal_documents()
RETURNS TABLE (
  case_id UUID,
  document_slot_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  instructions TEXT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  document_version_id UUID,
  version_no BIGINT,
  original_filename TEXT,
  declared_mime_type TEXT,
  byte_size BIGINT,
  submitted_at TIMESTAMPTZ,
  review_decision platform.document_review_decision,
  rework_reason TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    slot.student_case_id,
    slot.id,
    requirement.requirement_key,
    COALESCE(slot.display_label, requirement.label),
    requirement.instructions,
    slot.status,
    slot.deadline,
    slot.next_action,
    version.id,
    version.version_no,
    version.original_filename,
    version.declared_mime_type,
    version.byte_size,
    version.created_at,
    review.decision,
    CASE
      WHEN review.decision IN ('correction_required', 'rejected')
      THEN review.reason
      ELSE NULL
    END,
    review.created_at
  FROM platform.document_slots AS slot
  LEFT JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  LEFT JOIN platform.document_versions AS version
    ON version.organization_id = slot.organization_id
    AND version.document_slot_id = slot.id
    AND version.student_case_id = slot.student_case_id
    AND version.id = slot.current_version_id
    AND version.version_no = slot.current_version_no
  LEFT JOIN LATERAL (
    SELECT
      document_review.decision,
      document_review.reason,
      document_review.created_at
    FROM platform.document_reviews AS document_review
    WHERE document_review.organization_id = slot.organization_id
      AND document_review.document_version_id = version.id
    ORDER BY document_review.created_at DESC, document_review.id DESC
    LIMIT 1
  ) AS review ON TRUE
  WHERE slot.removed_at IS NULL
    AND private.platform_can_read_student_portal_case(
      slot.organization_id,
      slot.student_case_id
    )
    AND private.platform_has_permission(
      slot.organization_id,
      'document.read.self'
    )
  ORDER BY slot.deadline NULLS LAST, slot.id
$$;

COMMENT ON FUNCTION platform.student_portal_documents() IS
  'Student-safe document checklist projection bound only to each slot current version.';

ALTER FUNCTION platform.grant_document_download(UUID, UUID, TEXT, INTEGER, UUID)
  SET SCHEMA private;
ALTER FUNCTION private.grant_document_download(UUID, UUID, TEXT, INTEGER, UUID)
  RENAME TO grant_document_download_pre_e5;

ALTER FUNCTION platform.consume_document_download_grant(UUID, UUID)
  SET SCHEMA private;
ALTER FUNCTION private.consume_document_download_grant(UUID, UUID)
  RENAME TO consume_document_download_grant_pre_e5;

REVOKE ALL ON FUNCTION private.grant_document_download_pre_e5(
  UUID, UUID, TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.consume_document_download_grant_pre_e5(
  UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION private.grant_staff_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_access_purpose TEXT,
  p_expires_in_seconds INTEGER,
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
BEGIN
  PERFORM platform_private.lock_p2h_request(p_request_id);
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.download'
  );
  IF actor.actor_role IS NOT DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Staff document authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.grant_document_download_pre_e5(
    p_organization_id,
    p_document_version_id,
    p_access_purpose,
    p_expires_in_seconds,
    p_request_id
  );
END
$$;

CREATE FUNCTION private.grant_student_portal_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
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
  target_case_id UUID;
  target_slot_id UUID;
BEGIN
  IF p_organization_id IS NULL
    OR p_document_version_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Valid Student document grant input is required'
      USING ERRCODE = '22023';
  END IF;

  -- Preserve the established grant lock order: request -> actor -> case ->
  -- slot -> version. The moved body reacquires its locks reentrantly and repeats
  -- live authority before creating or replaying the grant.
  PERFORM platform_private.lock_p2h_request(p_request_id);
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.download'
  );
  IF actor.actor_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Student document authority is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p2h:download-actor:'
      || p_organization_id::TEXT
      || ':'
      || actor.actor_auth_user_id::TEXT,
      0
    )
  );

  SELECT version.student_case_id
  INTO target_case_id
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = target_case_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL
    AND platform_private.membership_has_active_scope(
      p_organization_id,
      actor.actor_membership_id,
      'student_case',
      student_case.id
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT slot.id
  INTO target_slot_id
  FROM platform.document_slots AS slot
  JOIN platform.document_versions AS version
    ON version.organization_id = slot.organization_id
    AND version.student_case_id = slot.student_case_id
    AND version.document_slot_id = slot.id
    AND version.id = p_document_version_id
  JOIN platform_private.document_upload_finalizations AS finalization
    ON finalization.organization_id = version.organization_id
    AND finalization.document_version_id = version.id
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = target_case_id
    AND slot.current_version_id = version.id
    AND slot.removed_at IS NULL
    AND version.integrity_status = 'verified'
    AND version.malware_status = 'clean'
  FOR UPDATE OF slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current verified clean document is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.grant_document_download_pre_e5(
    p_organization_id,
    p_document_version_id,
    'student_document_download',
    60,
    p_request_id
  );
END
$$;

CREATE FUNCTION private.consume_staff_document_download_grant(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  grant_role platform.business_role;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to consume a document grant'
      USING ERRCODE = '42501';
  END IF;
  IF p_document_download_grant_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'download grant id and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2h_request(p_request_id);
  SELECT candidate.grantee_role
  INTO grant_role
  FROM platform_private.document_download_grants AS candidate
  WHERE candidate.id = p_document_download_grant_id
  FOR UPDATE;

  IF NOT FOUND OR grant_role IS NOT DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Staff document download grant is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.consume_document_download_grant_pre_e5(
    p_document_download_grant_id,
    p_request_id
  );
END
$$;

CREATE FUNCTION private.consume_student_portal_document_download_grant(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  download_grant platform_private.document_download_grants%ROWTYPE;
  target_slot_id UUID;
  result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to consume a Student grant'
      USING ERRCODE = '42501';
  END IF;
  IF p_document_download_grant_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'download grant id and request id are required'
      USING ERRCODE = '22023';
  END IF;

  -- The moved body first repeats grant expiry, one-time use, live actor,
  -- scope, clean-version and object checks. It leaves the version lock held.
  -- Acquire the mutable slot NOWAIT below: this either fences currentness
  -- through commit or fails closed instead of deadlocking with the canonical
  -- case -> slot -> version finalization order. Any failure rolls back the
  -- consumption and audit rows written by the moved body.
  PERFORM platform_private.lock_p2h_request(p_request_id);
  SELECT *
  INTO download_grant
  FROM platform_private.document_download_grants AS candidate
  WHERE candidate.id = p_document_download_grant_id
  FOR UPDATE;

  IF NOT FOUND
    OR download_grant.grantee_role IS DISTINCT FROM 'student'
    OR download_grant.access_purpose IS DISTINCT FROM
      'student_document_download'
  THEN
    RAISE EXCEPTION 'Student document download grant is required'
      USING ERRCODE = '42501';
  END IF;

  -- The canonical body locks and validates the live actor, case and version and
  -- writes the one-time consumption. Any failure below rolls that work back.
  result := private.consume_document_download_grant_pre_e5(
    p_document_download_grant_id,
    p_request_id
  );

  SELECT slot.id
  INTO target_slot_id
  FROM platform.document_slots AS slot
  JOIN platform.document_versions AS version
    ON version.organization_id = slot.organization_id
    AND version.student_case_id = slot.student_case_id
    AND version.document_slot_id = slot.id
    AND version.id = download_grant.document_version_id
  JOIN platform_private.document_upload_finalizations AS finalization
    ON finalization.organization_id = version.organization_id
    AND finalization.document_version_id = version.id
  WHERE slot.organization_id = download_grant.organization_id
    AND slot.id = download_grant.document_slot_id
    AND slot.student_case_id = download_grant.student_case_id
    AND slot.current_version_id = version.id
    AND slot.removed_at IS NULL
    AND version.integrity_status = 'verified'
    AND version.malware_status = 'clean'
  FOR UPDATE OF slot NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current verified clean document is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN result;
END
$$;

CREATE FUNCTION platform.grant_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_access_purpose TEXT,
  p_expires_in_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.grant_staff_document_download(
    p_organization_id,
    p_document_version_id,
    p_access_purpose,
    p_expires_in_seconds,
    p_request_id
  )
$$;

CREATE FUNCTION platform.grant_student_portal_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.grant_student_portal_document_download(
    p_organization_id,
    p_document_version_id,
    p_request_id
  )
$$;

CREATE FUNCTION platform.consume_document_download_grant(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.consume_staff_document_download_grant(
    p_document_download_grant_id,
    p_request_id
  )
$$;

CREATE FUNCTION platform.consume_student_portal_document_download_grant(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.consume_student_portal_document_download_grant(
    p_document_download_grant_id,
    p_request_id
  )
$$;

REVOKE ALL ON FUNCTION private.grant_staff_document_download(
  UUID, UUID, TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.grant_staff_document_download(
  UUID, UUID, TEXT, INTEGER, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.grant_student_portal_document_download(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.grant_student_portal_document_download(
  UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.consume_staff_document_download_grant(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.consume_staff_document_download_grant(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION private.consume_student_portal_document_download_grant(
  UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.consume_student_portal_document_download_grant(
  UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.grant_document_download(
  UUID, UUID, TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_document_download(
  UUID, UUID, TEXT, INTEGER, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.grant_student_portal_document_download(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_student_portal_document_download(
  UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.consume_document_download_grant(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.consume_document_download_grant(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION platform.consume_student_portal_document_download_grant(
  UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.consume_student_portal_document_download_grant(
  UUID, UUID
) TO service_role;

COMMENT ON FUNCTION platform.grant_student_portal_document_download(
  UUID, UUID, UUID
) IS
  'Student-only current finalized clean document grant through a non-exposed authority body.';
COMMENT ON FUNCTION platform.consume_student_portal_document_download_grant(
  UUID, UUID
) IS
  'Service-only one-time Student grant consumption that rechecks the current finalized clean slot version.';

COMMIT;
