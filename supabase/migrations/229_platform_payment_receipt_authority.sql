-- ROOT229: exact staff receipt targets; no direct table grants or monetary writes.
BEGIN;
CREATE FUNCTION platform_private.receipt_staff_can_write(p_org UUID,p_member UUID,p_case UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_org,p_member))
 AND EXISTS(SELECT 1 FROM platform.student_cases c WHERE c.organization_id=p_org AND c.id=p_case
 AND (platform_private.staff_can_access(p_org,p_member,'finance.read.full','organization',p_org)
   OR (platform_private.staff_can_access(p_org,p_member,'case.read.full','student_case',p_case)
     AND platform_private.staff_has_permission(p_org,p_member,'finance.read.summary'))
   OR (c.state='pending' AND c.responsible_sales_membership_id=p_member))
 AND (platform_private.staff_can_access(p_org,p_member,'case.update.append','student_case',p_case)
   OR (c.state='pending' AND c.responsible_sales_membership_id=p_member)))
$$;
REVOKE ALL ON FUNCTION platform_private.receipt_staff_can_write(UUID,UUID,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform.staff_payment_receipt_upload_target_v1(p_payment_event_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; event_row platform.payment_events%ROWTYPE; agreement JSONB;
BEGIN
 SELECT a.* INTO actor FROM platform.current_actor_authority() a
 JOIN platform_private.staff_membership_identity(a.organization_id,a.membership_id) i ON TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO event_row FROM platform.payment_events e
 WHERE e.organization_id=actor.organization_id AND e.id=p_payment_event_id AND e.event_type='payment';
 IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501'; END IF;
 agreement:=platform.staff_case_agreement_v1(event_row.student_case_id);
 IF (agreement->>'can_write')::BOOLEAN IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('organization_id',actor.organization_id,'student_case_id',event_row.student_case_id,'payment_event_id',event_row.id);
END $$;
CREATE FUNCTION platform.staff_payment_receipt_download_target_v1(p_student_case_id UUID,p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; file_row platform.payment_receipt_files%ROWTYPE; agreement JSONB;
BEGIN
 SELECT a.* INTO actor FROM platform.current_actor_authority() a
 JOIN platform_private.staff_membership_identity(a.organization_id,a.membership_id) i ON TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501'; END IF;
 agreement:=platform.staff_case_agreement_v1(p_student_case_id);
 SELECT f.* INTO file_row FROM platform.payment_receipt_files f
 JOIN platform.payment_events e ON e.organization_id=f.organization_id AND e.id=f.payment_event_id
 AND e.student_case_id=f.student_case_id AND e.event_type='payment'
 WHERE f.organization_id=actor.organization_id AND f.student_case_id=p_student_case_id AND f.id=p_file_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('organization_id',actor.organization_id,'student_case_id',p_student_case_id,
 'payment_receipt_file_id',file_row.id,'storage_object_name',file_row.storage_object_name);
END $$;
REVOKE ALL ON FUNCTION platform.staff_payment_receipt_upload_target_v1(UUID),
 platform.staff_payment_receipt_download_target_v1(UUID,UUID) FROM PUBLIC,anon,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_payment_receipt_upload_target_v1(UUID),
 platform.staff_payment_receipt_download_target_v1(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION platform.record_payment_receipt_file_metadata(
  p_organization_id UUID,
  p_payment_event_id UUID,
  p_uploaded_by_membership_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_storage_object_name TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_row platform.payment_events%ROWTYPE;
  uploader RECORD;
  replayed JSONB;
  created_file_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Payment receipt file uploaded';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  -- Same organization -> identity ordering as scoped-role mutations in155.
  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_uploaded_by_membership_id]);
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_request_id IS NULL
    OR p_declared_mime_type IS NULL
    OR p_sha256_hex IS NULL
    OR p_payment_event_id IS NULL
    OR p_uploaded_by_membership_id IS NULL
    OR p_original_filename IS NULL
    OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN
      ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL
    OR btrim(p_storage_object_name) = ''
  THEN
    RAISE EXCEPTION
      'Complete receipt file metadata is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO event_row FROM platform.payment_events AS payment_event
  WHERE payment_event.organization_id = p_organization_id
    AND payment_event.id = p_payment_event_id
    AND payment_event.event_type = 'payment';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment event is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO uploader
  FROM platform_private.staff_membership_identity(
    p_organization_id, p_uploaded_by_membership_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Uploader membership is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM platform.student_cases
    WHERE organization_id=p_organization_id AND id=event_row.student_case_id FOR UPDATE;
  IF NOT platform_private.receipt_staff_can_write(p_organization_id,p_uploaded_by_membership_id,event_row.student_case_id) THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE='42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'case.payment_receipt.upload', 'payment_receipt_file', NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'payment_event_id', p_payment_event_id,
      'original_filename', btrim(p_original_filename),
      'sha256_hex', lower(btrim(p_sha256_hex))
    )
  );
  IF replayed IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM platform.payment_receipt_files f
      WHERE f.id=(replayed->>'payment_receipt_file_id')::UUID
        AND f.organization_id=p_organization_id AND f.student_case_id=event_row.student_case_id
        AND f.payment_event_id=p_payment_event_id
        AND f.uploaded_by_membership_id=p_uploaded_by_membership_id
        AND f.original_filename=btrim(p_original_filename)
        AND f.declared_mime_type=lower(btrim(p_declared_mime_type))
        AND f.byte_size=p_byte_size AND f.sha256_hex=lower(btrim(p_sha256_hex))
        AND f.storage_object_name=btrim(p_storage_object_name)) THEN
      RAISE EXCEPTION 'Receipt request conflict' USING ERRCODE='40001';
    END IF;
    RETURN replayed;
  END IF;

  -- Additive only — a second/third receipt for the SAME payment_event_id
  -- never touches payment_obligations.total_paid_minor (only
  -- record_case_payment_v1's own INSERT into payment_events does that), so
  -- an extra evidence file can never double-count the money.
  INSERT INTO platform.payment_receipt_files (
    id, organization_id, student_case_id, payment_obligation_id,
    payment_event_id, original_filename, declared_mime_type, byte_size,
    sha256_hex, storage_object_name, uploaded_by_membership_id
  ) VALUES (
    created_file_id, p_organization_id, event_row.student_case_id,
    event_row.payment_obligation_id, p_payment_event_id,
    btrim(p_original_filename), lower(btrim(p_declared_mime_type)),
    p_byte_size, lower(btrim(p_sha256_hex)), btrim(p_storage_object_name),
    p_uploaded_by_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'payment_event_id', p_payment_event_id,
    'payment_receipt_file_id', created_file_id,
    'original_filename', btrim(p_original_filename),
    'sha256_hex', lower(btrim(p_sha256_hex))
  );

  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'system', 'service_role:document_ingest',
    'case.payment_receipt.upload', 'payment_receipt_file', created_file_id,
    NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

-- CREATE OR REPLACE retains189 service-only ACL; reaffirm explicitly.
REVOKE ALL ON FUNCTION platform.record_payment_receipt_file_metadata(UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_payment_receipt_file_metadata(UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,UUID) TO service_role;
COMMIT;
