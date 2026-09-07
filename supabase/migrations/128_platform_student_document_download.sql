-- ============================================================
-- 128_platform_student_document_download.sql
--
-- Stage E5: current-version-only Student Portal document grants.
-- The established grant/consume bodies remain the single implementation for
-- audit, expiry, revocation and signing facts. Narrow non-exposed wrappers add
-- Student role and current-slot checks at both transaction boundaries.
-- ============================================================

BEGIN;

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
