-- Close the review/finalization deadlock observed by the real local P2H
-- concurrency gate. This is a forward-only replacement: migration 046 remains
-- immutable, while finalization now matches the authenticated review lock
-- order before it writes the organization-bound audit event.

CREATE OR REPLACE FUNCTION platform.finalize_document_upload(
  p_organization_id UUID,
  p_upload_reservation_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_finalization
    platform_private.document_upload_finalizations%ROWTYPE;
  reservation platform_private.document_upload_reservations%ROWTYPE;
  binding platform_private.document_storage_bindings%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  object_row RECORD;
  finalization_id UUID := gen_random_uuid();
  finalization_audit_event_id UUID := gen_random_uuid();
  finalized_at TIMESTAMPTZ := statement_timestamp();
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Trusted backend published an exact object-backed document upload';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'service_role is required to finalize a document upload'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_upload_reservation_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'organization, upload reservation and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2h_request(p_request_id);

  -- Authenticated review acquires organization authorization before the
  -- mutable case, slot and version rows. Take the audit foreign key's
  -- compatible key-share lock first so it cannot invert that order under
  -- contention while unrelated service finalizations may still run together.
  PERFORM 1
  FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Read the immutable reservation identity, then acquire mutable domain locks
  -- in the shared organization -> case -> slot -> version order. The
  -- reservation itself is locked only after those mutable rows.
  SELECT *
  INTO reservation
  FROM platform_private.document_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = reservation.organization_id
    AND student_case.id = reservation.student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = reservation.organization_id
    AND slot.id = reservation.document_slot_id
    AND slot.student_case_id = reservation.student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document slot cannot publish this reserved version'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = reservation.organization_id
    AND version.id = reservation.document_version_id
    AND version.student_case_id = reservation.student_case_id
    AND version.document_slot_id = reservation.document_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Pending document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO STRICT reservation
  FROM platform_private.document_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id
  FOR UPDATE;

  -- Recheck the immutable receipt only after acquiring the shared domain lock
  -- order. Two request IDs racing on one reservation now deterministically
  -- produce one receipt and one conflict; exact replay returns that receipt.
  SELECT *
  INTO existing_finalization
  FROM platform_private.document_upload_finalizations AS finalization
  WHERE finalization.request_id = p_request_id
    OR finalization.upload_reservation_id = p_upload_reservation_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_finalization.request_id IS DISTINCT FROM p_request_id
      OR existing_finalization.organization_id IS DISTINCT FROM
        p_organization_id
      OR existing_finalization.upload_reservation_id IS DISTINCT FROM
        p_upload_reservation_id
    THEN
      RAISE EXCEPTION
        'request_id or upload reservation was already finalized differently'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'organization_id', existing_finalization.organization_id,
      'student_case_id', existing_finalization.student_case_id,
      'document_slot_id', existing_finalization.document_slot_id,
      'document_version_id', existing_finalization.document_version_id,
      'upload_reservation_id',
        existing_finalization.upload_reservation_id,
      'bucket_id', existing_finalization.bucket_id,
      'object_name', existing_finalization.object_name,
      'object_created_at', existing_finalization.object_created_at,
      'finalized_at', existing_finalization.finalized_at,
      'published_slot_status', 'submitted',
      'published_version_no',
        existing_finalization.published_version_no,
      'document_slot_published', TRUE
    );
  END IF;

  SELECT *
  INTO STRICT binding
  FROM platform_private.document_storage_bindings AS candidate
  WHERE candidate.organization_id = reservation.organization_id
    AND candidate.upload_reservation_id = reservation.id
    AND candidate.document_version_id = reservation.document_version_id
    AND candidate.bucket_id = reservation.bucket_id
    AND candidate.object_name = reservation.object_name;

  IF slot_row.status = 'approved'
    OR (
      slot_row.current_version_no IS NOT NULL
      AND slot_row.current_version_no >= version_row.version_no
    )
  THEN
    RAISE EXCEPTION
      'Document slot cannot publish this reserved version'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    object.id,
    object.created_at
  INTO object_row
  FROM storage.objects AS object
  WHERE object.bucket_id = binding.bucket_id
    AND object.name = binding.object_name
  FOR SHARE;

  IF NOT FOUND
    OR object_row.created_at IS NULL
    OR object_row.created_at < reservation.created_at
    OR object_row.created_at > reservation.expires_at
  THEN
    RAISE EXCEPTION
      'Exact document object was not uploaded inside the reservation window'
      USING ERRCODE = '42501';
  END IF;

  UPDATE platform.document_slots AS slot
  SET
    status = 'submitted',
    current_version_id = version_row.id,
    current_version_no = version_row.version_no
  WHERE slot.organization_id = reservation.organization_id
    AND slot.id = reservation.document_slot_id;

  result := jsonb_build_object(
    'organization_id', reservation.organization_id,
    'student_case_id', reservation.student_case_id,
    'document_slot_id', reservation.document_slot_id,
    'document_version_id', reservation.document_version_id,
    'upload_reservation_id', reservation.id,
    'bucket_id', reservation.bucket_id,
    'object_name', reservation.object_name,
    'object_created_at', object_row.created_at,
    'finalized_at', finalized_at,
    'published_slot_status', 'submitted',
    'published_version_no', version_row.version_no,
    'document_slot_published', TRUE
  );

  INSERT INTO platform.audit_events (
    id,
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
    finalization_audit_event_id,
    reservation.organization_id,
    'service',
    NULL,
    'service:platform-document-upload-finalization',
    'document.upload.finalize',
    'document_version',
    reservation.document_version_id,
    jsonb_build_object(
      'slot_status', slot_row.status,
      'current_version_id', slot_row.current_version_id,
      'current_version_no', slot_row.current_version_no
    ),
    result,
    fixed_reason,
    p_request_id
  );

  INSERT INTO platform_private.document_upload_finalizations (
    id,
    request_id,
    organization_id,
    upload_reservation_id,
    student_case_id,
    document_version_id,
    document_slot_id,
    finalization_audit_event_id,
    bucket_id,
    object_name,
    published_version_no,
    object_created_at,
    finalized_at
  )
  VALUES (
    finalization_id,
    p_request_id,
    reservation.organization_id,
    reservation.id,
    reservation.student_case_id,
    reservation.document_version_id,
    reservation.document_slot_id,
    finalization_audit_event_id,
    reservation.bucket_id,
    reservation.object_name,
    version_row.version_no,
    object_row.created_at,
    finalized_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.finalize_document_upload(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.finalize_document_upload(UUID, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION platform.finalize_document_upload(UUID, UUID, UUID) IS
  'Trusted backend finalization for one exact reserved private Storage object. Locks organization, case, slot and version in the shared deterministic order before writing one immutable receipt and audit event.';
