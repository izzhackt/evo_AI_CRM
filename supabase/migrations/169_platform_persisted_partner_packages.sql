-- One saved-artifact lifecycle, extended with immutable partner ZIP snapshots.
-- Product limit: 50 MiB ZIP, 1–50 entries, no selected-item omission.
-- No bucket/provider writes or legacy-history backfill. Old manifests remain JSON-only.
BEGIN;

ALTER TABLE platform_private.partner_packets
  ADD COLUMN export_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN source_snapshot JSONB CHECK(jsonb_typeof(source_snapshot)='array'),
  ADD COLUMN snapshot_sha256 TEXT CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN workspace_revision TEXT CHECK(workspace_revision ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT partner_packets_version_ids_check,
  ADD CONSTRAINT partner_packet_entry_count CHECK(cardinality(version_ids)+cardinality(export_ids) BETWEEN 1 AND 50),
  ADD CONSTRAINT partner_packet_snapshot_binding CHECK(num_nonnulls(source_snapshot,snapshot_sha256,workspace_revision) IN (0,3)),
  ADD CONSTRAINT partner_packet_export_scope UNIQUE(organization_id,student_case_id,application_id,id);
ALTER TABLE platform_private.document_export_input_snapshots
  ALTER COLUMN frozen_profile DROP NOT NULL,
  ADD COLUMN package_snapshot JSONB CHECK(jsonb_typeof(package_snapshot)='object'),
  ADD CONSTRAINT document_export_snapshot_kind CHECK(
    (frozen_profile IS NOT NULL AND package_snapshot IS NULL)
    OR (frozen_profile IS NULL AND frozen_form IS NULL AND package_snapshot IS NOT NULL));
ALTER TABLE platform_private.document_export_artifacts
  ALTER COLUMN student_profile_id DROP NOT NULL,
  ALTER COLUMN profile_revision DROP NOT NULL,
  ALTER COLUMN field_reviews_sha256 DROP NOT NULL,
  ALTER COLUMN template_sha256 DROP NOT NULL,
  ADD COLUMN package_id UUID,
  ADD COLUMN package_item_count INTEGER CHECK(package_item_count BETWEEN 1 AND 50),
  ADD CONSTRAINT document_export_case_fk FOREIGN KEY(organization_id,student_case_id)
    REFERENCES platform.student_cases(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT document_export_package_fk FOREIGN KEY(organization_id,student_case_id,application_id,package_id)
    REFERENCES platform_private.partner_packets(organization_id,student_case_id,application_id,id) ON DELETE RESTRICT,
  DROP CONSTRAINT document_export_kind_binding_check,
  DROP CONSTRAINT document_export_output_limit_check,
  DROP CONSTRAINT document_export_sealed_object_check;
CREATE INDEX document_export_artifacts_package_idx ON platform_private.document_export_artifacts(package_id);
ALTER TABLE platform_private.document_export_artifacts
  ADD CONSTRAINT document_export_kind_binding_check CHECK(
    (kind IN ('student_profile','university_form') AND package_id IS NULL AND package_item_count IS NULL
      AND num_nonnulls(student_profile_id,profile_revision,field_reviews_sha256,template_sha256)=4 AND (
      (kind='student_profile' AND num_nonnulls(application_id,catalog_institution_id,catalog_source_revision,template_id,
        template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,validation_day,generated_input_sha256,renderer_proof)=0
        AND template_sha256='2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0'
        AND renderer_version='evo-student-profile-docx-v1' AND mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      OR (kind='university_form' AND num_nonnulls(application_id,catalog_institution_id,catalog_source_revision,template_id,
        template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,validation_day,generated_input_sha256)=11
        AND btrim(catalog_source_revision)<>'' AND template_sha256 ~ '^[a-f0-9]{64}$'
        AND ((mime_type='application/pdf' AND renderer_version='evo-university-form-pdf-v1')
          OR (mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND renderer_version='evo-university-form-docx-v1')))))
    OR (kind='package' AND num_nonnulls(package_id,application_id,package_item_count)=3
      AND num_nonnulls(student_profile_id,profile_revision,field_reviews_sha256,template_sha256,catalog_institution_id,
        catalog_source_revision,template_id,template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,
        validation_day,generated_input_sha256,renderer_proof)=0
      AND renderer_version='evo-partner-packet-zip-v1' AND mime_type='application/zip')),
  ADD CONSTRAINT document_export_output_limit_check CHECK(output_bytes BETWEEN 1 AND
    CASE kind WHEN 'student_profile' THEN 5242880 WHEN 'university_form' THEN 20971520 WHEN 'package' THEN 52428800 ELSE 0 END),
  ADD CONSTRAINT document_export_sealed_object_check CHECK(
    (sealed_at IS NULL AND object_name IS NULL AND output_sha256 IS NULL AND output_bytes IS NULL AND renderer_proof IS NULL)
    OR (sealed_at IS NOT NULL AND begun_at IS NOT NULL AND object_name IS NOT NULL AND output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
      AND object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||
        CASE mime_type WHEN 'application/zip' THEN '.zip' WHEN 'application/pdf' THEN '.pdf' ELSE '.docx' END
      AND (kind IN ('student_profile','package') OR platform_private.university_form_renderer_proof_valid(renderer_proof,mime_type))));

-- Keep audited profile/form behavior private and unchanged; the dispatchers add
-- only the new package branch. No extra public RPC or alternate writer.
ALTER FUNCTION platform_private.document_export_actor_authorized(platform_private.document_export_artifacts,UUID,UUID)
  RENAME TO document_export_actor_authorized_before_packages;
CREATE FUNCTION platform_private.document_export_actor_authorized(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE source JSONB; generated platform_private.document_export_artifacts;
BEGIN
  IF p_artifact.kind<>'package' THEN
    RETURN platform_private.document_export_actor_authorized_before_packages(p_artifact,p_auth,p_member); END IF;
  IF NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_artifact.organization_id,p_member) i WHERE i.auth_user_id=p_auth)
    OR NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'case.read.full','student_case',p_artifact.student_case_id)
    OR NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.read.full','student_case',p_artifact.student_case_id)
    OR NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','student_case',p_artifact.student_case_id)
    THEN RETURN FALSE; END IF;
  FOR source IN SELECT * FROM jsonb_array_elements(p_artifact.source_versions) LOOP
    IF NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','document',(source->>'id')::UUID)
      THEN RETURN FALSE; END IF;
  END LOOP;
  FOR generated IN SELECT a.* FROM platform_private.partner_packets p
    JOIN platform_private.document_export_artifacts a ON a.id=ANY(p.export_ids)
    WHERE p.id=p_artifact.package_id AND p.organization_id=p_artifact.organization_id LOOP
    IF generated.organization_id<>p_artifact.organization_id OR generated.student_case_id<>p_artifact.student_case_id
      OR generated.kind NOT IN ('student_profile','university_form')
      OR NOT platform_private.document_export_actor_authorized_before_packages(generated,p_auth,p_member) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

ALTER FUNCTION platform_private.document_export_live_failure(platform_private.document_export_artifacts,UUID,UUID,BOOLEAN)
  RENAME TO document_export_live_failure_before_packages;
CREATE FUNCTION platform_private.document_export_live_failure(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID,p_require_current BOOLEAN
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE packet platform_private.partner_packets; source JSONB; v RECORD; g platform_private.document_export_artifacts; failure TEXT;
BEGIN
  IF p_artifact.kind<>'package' THEN
    RETURN platform_private.document_export_live_failure_before_packages(p_artifact,p_auth,p_member,p_require_current); END IF;
  IF NOT platform_private.document_export_actor_authorized(p_artifact,p_auth,p_member) THEN RETURN 'access_changed'; END IF;
  SELECT * INTO packet FROM platform_private.partner_packets WHERE id=p_artifact.package_id
    AND organization_id=p_artifact.organization_id AND student_case_id=p_artifact.student_case_id AND application_id=p_artifact.application_id;
  IF NOT FOUND OR packet.snapshot_sha256 IS DISTINCT FROM p_artifact.workspace_revision OR packet.source_snapshot IS NULL
    OR jsonb_array_length(packet.source_snapshot)<>p_artifact.package_item_count THEN RETURN 'source_unavailable'; END IF;
  IF packet.snapshot_sha256 IS DISTINCT FROM platform_private.bw1_input_sha256(jsonb_build_object('schema_version',1,'id',packet.id,
    'organization_id',packet.organization_id,'case_id',packet.student_case_id,'application_id',packet.application_id,'sources',packet.source_snapshot))
    OR p_artifact.input_snapshot_sha256 IS DISTINCT FROM platform_private.bw1_input_sha256(jsonb_build_object('packet_sha256',packet.snapshot_sha256,
      'mode',p_artifact.mode,'renderer_version',p_artifact.renderer_version)) THEN RETURN 'source_unavailable'; END IF;
  FOR source IN SELECT * FROM jsonb_array_elements(packet.source_snapshot) LOOP
    IF source->>'kind'='original' THEN
      SELECT d.*,s.removed_at,s.current_version_id,s.status,b.bucket_id,b.object_name,
        (SELECT r.id FROM platform.document_reviews r WHERE r.document_version_id=d.id AND r.organization_id=d.organization_id
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS latest_review INTO v
      FROM platform.document_versions d JOIN platform.document_slots s ON s.organization_id=d.organization_id AND s.id=d.document_slot_id
      JOIN platform_private.document_storage_bindings b ON b.organization_id=d.organization_id AND b.document_version_id=d.id
      WHERE d.id=(source->>'id')::UUID AND d.organization_id=p_artifact.organization_id AND d.student_case_id=p_artifact.student_case_id
        AND EXISTS(SELECT 1 FROM platform_private.document_upload_finalizations f
          WHERE f.organization_id=d.organization_id AND f.student_case_id=d.student_case_id AND f.document_version_id=d.id);
      IF NOT FOUND OR v.integrity_status::TEXT<>'verified' OR v.malware_status::TEXT<>'clean' OR v.removed_at IS NOT NULL
        OR v.sha256_hex IS DISTINCT FROM source->>'sha256' OR v.byte_size IS DISTINCT FROM (source->>'size_bytes')::BIGINT
        OR v.bucket_id IS DISTINCT FROM source->>'bucket_id' OR v.object_name IS DISTINCT FROM source->>'object_name'
        THEN RETURN 'source_unavailable'; END IF;
      IF p_require_current AND (v.current_version_id<>v.id OR v.status::TEXT<>'approved'
        OR v.latest_review IS DISTINCT FROM (source->>'review_id')::UUID) THEN RETURN 'source_changed'; END IF;
    ELSIF source->>'kind'='generated' THEN
      SELECT * INTO g FROM platform_private.document_export_artifacts WHERE id=(source->>'id')::UUID
        AND organization_id=p_artifact.organization_id AND student_case_id=p_artifact.student_case_id;
      IF NOT FOUND OR g.kind NOT IN ('student_profile','university_form') OR g.state<>'ready'
        OR g.output_sha256 IS DISTINCT FROM source->>'sha256' OR g.output_bytes IS DISTINCT FROM (source->>'size_bytes')::INTEGER
        OR g.object_name IS DISTINCT FROM source->>'object_name' OR g.bucket_id IS DISTINCT FROM source->>'bucket_id'
        OR (g.kind='university_form' AND g.application_id IS DISTINCT FROM p_artifact.application_id)
        OR (p_artifact.mode='final' AND g.mode<>'final') THEN RETURN 'source_unavailable'; END IF;
      failure:=platform_private.document_export_live_failure_before_packages(g,p_auth,p_member,p_require_current);
      IF failure IS NOT NULL THEN RETURN failure; END IF;
    ELSE RETURN 'source_unavailable'; END IF;
  END LOOP;
  RETURN NULL;
END $$;

ALTER FUNCTION platform_private.document_export_receipt(platform_private.document_export_artifacts,UUID,UUID)
  RENAME TO document_export_receipt_before_packages;
CREATE FUNCTION platform_private.document_export_receipt(p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.document_export_receipt_before_packages(p_artifact,p_auth,p_member)
    ||CASE WHEN p_artifact.kind='package' THEN jsonb_build_object('package',jsonb_build_object(
      'id',p_artifact.package_id,'application_id',p_artifact.application_id,'item_count',p_artifact.package_item_count)) ELSE '{}'::JSONB END
$$;

ALTER FUNCTION platform_private.lock_document_export(UUID,UUID,UUID) RENAME TO lock_document_export_before_packages;
CREATE FUNCTION platform_private.lock_document_export(p_artifact_id UUID,p_extra_member UUID DEFAULT NULL,p_extra_request UUID DEFAULT NULL)
RETURNS platform_private.document_export_artifacts LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; request_uuid UUID;
BEGIN
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF a.kind<>'package' THEN RETURN platform_private.lock_document_export_before_packages(p_artifact_id,p_extra_member,p_extra_request); END IF;
  PERFORM 1 FROM platform.organizations WHERE id=a.organization_id FOR UPDATE;
  FOR request_uuid IN SELECT DISTINCT x FROM unnest(ARRAY[a.request_id,p_extra_request]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM platform_private.lock_bw3_request(request_uuid); END LOOP;
  PERFORM platform_private.staff_lock_memberships(a.organization_id,ARRAY[a.actor_membership_id,p_extra_member]);
  PERFORM 1 FROM platform.student_cases WHERE id=a.student_case_id AND organization_id=a.organization_id FOR UPDATE;
  PERFORM 1 FROM platform.university_applications WHERE organization_id=a.organization_id AND id=a.application_id FOR SHARE;
  PERFORM 1 FROM platform.student_profiles WHERE organization_id=a.organization_id AND student_case_id=a.student_case_id FOR SHARE;
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=a.organization_id AND s.id IN(
    SELECT v.document_slot_id FROM platform.document_versions v WHERE v.organization_id=a.organization_id
      AND v.id IN(SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x)) ORDER BY s.id FOR SHARE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=a.organization_id
    AND v.id IN(SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x) ORDER BY v.id FOR SHARE;
  PERFORM 1 FROM platform_private.document_export_artifacts g WHERE g.id IN(
    SELECT unnest(p.export_ids) FROM platform_private.partner_packets p WHERE p.id=a.package_id) ORDER BY g.id FOR SHARE;
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id FOR UPDATE;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION platform.staff_document_export_workspace_v2(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base JSONB; actor RECORD; org UUID; exports JSONB;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_student_case_id)
    OR NOT (platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id)
      OR (platform_private.staff_can_access_for_actor(org,'case.read.full','student_case',p_student_case_id)
        AND platform_private.staff_can_access_for_actor(org,'document.read.full','student_case',p_student_case_id))) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id) THEN
    base:=platform.staff_document_export_workspace(p_student_case_id);
  ELSE base:=jsonb_build_object('student_case_id',p_student_case_id,'profile',NULL,'workspace_revision',NULL,'can_export',FALSE); END IF;
  SELECT COALESCE(jsonb_agg(platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id)
    ORDER BY a.created_at DESC,a.id),'[]'::JSONB) INTO exports FROM platform_private.document_export_artifacts a
    WHERE a.organization_id=org AND a.student_case_id=p_student_case_id
      AND platform_private.document_export_actor_authorized(a,actor.auth_user_id,actor.membership_id);
  RETURN base||jsonb_build_object('schema_version',2,'artifacts',exports);
END $$;

-- Private selection metadata, never returned directly to the browser. Every
-- generated artifact is already saved/verified; package-in-package is forbidden.
CREATE FUNCTION platform_private.partner_packet_sources(p_org UUID,p_case UUID,p_auth UUID,p_member UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH originals AS (
    SELECT jsonb_build_object('kind','original','id',v.id,'slot_id',s.id,'filename',v.original_filename,
      'version_no',v.version_no::TEXT,'sha256',v.sha256_hex,'size_bytes',v.byte_size,'mime_type',v.declared_mime_type,
      'bucket_id',b.bucket_id,'object_name',b.object_name,'review_id',r.id) item
    FROM platform.document_slots s JOIN platform.document_versions v ON v.organization_id=s.organization_id AND v.id=s.current_version_id
    JOIN platform_private.document_storage_bindings b ON b.organization_id=v.organization_id AND b.document_version_id=v.id
    JOIN LATERAL(SELECT review.id,review.decision FROM platform.document_reviews review
      WHERE review.document_version_id=v.id AND review.organization_id=v.organization_id ORDER BY review.created_at DESC,review.id DESC LIMIT 1) r ON r.decision='approved'
    WHERE s.organization_id=p_org AND s.student_case_id=p_case AND s.removed_at IS NULL AND s.status='approved'
      AND v.integrity_status='verified' AND v.malware_status='clean'
      AND platform_private.staff_can_access(p_org,p_member,'document.download','document',v.id)
      AND EXISTS(SELECT 1 FROM platform_private.document_upload_finalizations f
        WHERE f.organization_id=v.organization_id AND f.student_case_id=v.student_case_id AND f.document_version_id=v.id)
    ORDER BY v.id LIMIT 1000
  ), generated AS (
    SELECT jsonb_build_object('kind','generated','id',a.id,'export_kind',a.kind,'mode',a.mode,'application_id',a.application_id,
      'created_at',a.created_at,'sha256',a.output_sha256,'size_bytes',a.output_bytes,'mime_type',a.mime_type,
      'bucket_id',a.bucket_id,'object_name',a.object_name) item
    FROM platform_private.document_export_artifacts a WHERE a.organization_id=p_org AND a.student_case_id=p_case
      AND a.kind IN ('student_profile','university_form') AND a.state='ready'
      AND platform_private.document_export_live_failure(a,p_auth,p_member,TRUE) IS NULL
    ORDER BY a.created_at DESC,a.id LIMIT 1000
  ) SELECT COALESCE(jsonb_agg(item ORDER BY item->>'kind',item->>'id'),'[]'::JSONB) FROM (
    SELECT item FROM originals UNION ALL SELECT item FROM generated) entries
$$;
CREATE FUNCTION platform_private.partner_packet_public_files(p_sources JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slotId',s->'slot_id','versionId',s->'id','name',s->'filename',
    'sha256',s->'sha256','versionNo',s->'version_no','sizeBytes',s->'size_bytes','mimeType',s->'mime_type') ORDER BY s->>'id'),'[]'::JSONB)
    FROM jsonb_array_elements(p_sources) s WHERE s->>'kind'='original'
$$;
CREATE FUNCTION platform_private.partner_packet_public_exports(p_sources JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s->'id','kind',s->'export_kind','mode',s->'mode','applicationId',s->'application_id',
    'createdAt',s->'created_at','sha256',s->'sha256','sizeBytes',s->'size_bytes','mimeType',s->'mime_type') ORDER BY s->>'id'),'[]'::JSONB)
    FROM jsonb_array_elements(p_sources) s WHERE s->>'kind'='generated'
$$;
CREATE FUNCTION platform_private.partner_packet_public(p platform_private.partner_packets)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.manifest||jsonb_build_object('revision',p.snapshot_sha256,
    'generatedExports',COALESCE(p.manifest->'generatedExports','[]'::JSONB),
    'files',CASE WHEN p.source_snapshot IS NOT NULL THEN p.manifest->'files' ELSE
      (SELECT COALESCE(jsonb_agg(f||jsonb_build_object('sizeBytes',v.byte_size,'mimeType',v.declared_mime_type) ORDER BY f->>'versionId'),'[]'::JSONB)
       FROM jsonb_array_elements(p.manifest->'files') f JOIN platform.document_versions v
         ON v.id=(f->>'versionId')::UUID AND v.organization_id=p.organization_id AND v.student_case_id=p.student_case_id) END)
$$;
CREATE FUNCTION platform.partner_packet_workspace_v2(p_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; org UUID; sources JSONB; packets JSONB;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'staff_session_required' USING ERRCODE='42501'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_case_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'case.read.full','student_case',p_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.read.full','student_case',p_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_case_id) THEN
    RAISE EXCEPTION 'packet_unavailable' USING ERRCODE='42501'; END IF;
  sources:=platform_private.partner_packet_sources(org,p_case_id,actor.auth_user_id,actor.membership_id);
  SELECT COALESCE(jsonb_agg(platform_private.partner_packet_public(p) ORDER BY p.created_at DESC,p.id),'[]'::JSONB) INTO packets
    FROM (SELECT * FROM platform_private.partner_packets WHERE organization_id=org AND student_case_id=p_case_id
      ORDER BY created_at DESC,id LIMIT 20) p;
  RETURN jsonb_build_object('files',platform_private.partner_packet_public_files(sources),
    'generatedExports',platform_private.partner_packet_public_exports(sources),'packets',packets,
    'workspaceRevision',platform_private.bw1_input_sha256(sources),'maxArchiveBytes',52428800);
END $$;

CREATE FUNCTION platform.prepare_partner_packet_v2(p_case_id UUID,p_application_id UUID,p_version_ids UUID[],p_request_id UUID,
  p_export_ids UUID[],p_expected_revision TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; org UUID; app platform.university_applications; packet platform_private.partner_packets;
  ids UUID[]; exports UUID[]; sources JSONB; selected JSONB; author_name TEXT;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'staff_session_required' USING ERRCODE='42501'; END IF;
  IF p_case_id IS NULL OR p_application_id IS NULL OR p_request_id IS NULL OR p_version_ids IS NULL OR p_export_ids IS NULL
    OR cardinality(p_version_ids)+cardinality(p_export_ids) NOT BETWEEN 1 AND 50
    OR array_position(p_version_ids,NULL) IS NOT NULL OR array_position(p_export_ids,NULL) IS NOT NULL
    OR p_expected_revision IS NULL OR p_expected_revision !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_packet_input' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}'::UUID[]) INTO ids FROM unnest(p_version_ids) x;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}'::UUID[]) INTO exports FROM unnest(p_export_ids) x;
  IF cardinality(ids)<>cardinality(p_version_ids) OR cardinality(exports)<>cardinality(p_export_ids) THEN
    RAISE EXCEPTION 'duplicate_packet_input' USING ERRCODE='22023'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'packet_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=org FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(p_request_id);
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'packet_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.staff_lock_memberships(org,ARRAY[actor.membership_id]);
  PERFORM 1 FROM platform.student_cases WHERE organization_id=org AND id=p_case_id AND state='active' FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'case.read.full','student_case',p_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'application.manage','student_case',p_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.read.full','student_case',p_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_case_id) THEN
    RAISE EXCEPTION 'packet_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO packet FROM platform_private.partner_packets WHERE request_id=p_request_id;
  IF FOUND THEN
    IF packet.organization_id<>org OR packet.student_case_id<>p_case_id OR packet.application_id<>p_application_id
      OR packet.created_by_membership_id<>actor.membership_id OR packet.version_ids<>ids OR packet.export_ids<>exports
      OR packet.workspace_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
    RETURN platform_private.partner_packet_public(packet);
  END IF;
  SELECT * INTO app FROM platform.university_applications WHERE organization_id=org AND student_case_id=p_case_id AND id=p_application_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'packet_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_case_id FOR SHARE;
  PERFORM 1 FROM platform.document_slots WHERE organization_id=org AND student_case_id=p_case_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM platform.document_versions WHERE organization_id=org AND student_case_id=p_case_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM platform_private.document_export_artifacts WHERE organization_id=org AND id=ANY(exports) ORDER BY id FOR SHARE;
  sources:=platform_private.partner_packet_sources(org,p_case_id,actor.auth_user_id,actor.membership_id);
  IF platform_private.bw1_input_sha256(sources)<>p_expected_revision THEN RAISE EXCEPTION 'packet_changed' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'kind',s->>'id'),'[]'::JSONB) INTO selected FROM jsonb_array_elements(sources) s
    WHERE (s->>'kind'='original' AND (s->>'id')::UUID=ANY(ids))
      OR (s->>'kind'='generated' AND (s->>'id')::UUID=ANY(exports) AND (s->>'application_id' IS NULL OR (s->>'application_id')::UUID=p_application_id));
  IF jsonb_array_length(selected)<>cardinality(ids)+cardinality(exports) THEN RAISE EXCEPTION 'packet_source_unavailable' USING ERRCODE='55000'; END IF;
  IF (SELECT sum((s->>'size_bytes')::BIGINT) FROM jsonb_array_elements(selected) s)>=52428800 THEN
    RAISE EXCEPTION 'package_too_large' USING ERRCODE='55000'; END IF;
  packet.id:=gen_random_uuid(); packet.organization_id:=org; packet.student_case_id:=p_case_id; packet.application_id:=p_application_id;
  packet.created_by_membership_id:=actor.membership_id; packet.request_id:=p_request_id; packet.version_ids:=ids; packet.export_ids:=exports;
  packet.created_at:=statement_timestamp(); packet.source_snapshot:=selected; packet.workspace_revision:=p_expected_revision;
  packet.snapshot_sha256:=platform_private.bw1_input_sha256(jsonb_build_object('schema_version',1,'id',packet.id,
    'organization_id',org,'case_id',p_case_id,'application_id',p_application_id,'sources',selected));
  SELECT display_name INTO author_name FROM platform.profiles WHERE id=actor.profile_id;
  packet.manifest:=jsonb_build_object('id',packet.id,'caseId',p_case_id,'applicationId',p_application_id,
    'applicationName',app.institution_name||' · '||app.program_name,'createdBy',author_name,'createdAt',packet.created_at,
    'requestId',p_request_id,'files',platform_private.partner_packet_public_files(selected),
    'generatedExports',platform_private.partner_packet_public_exports(selected));
  INSERT INTO platform_private.partner_packets SELECT (packet).*;
  RETURN platform_private.partner_packet_public(packet);
END $$;

CREATE FUNCTION platform.prepare_document_package_export(p_student_case_id UUID,p_packet_id UUID,p_mode TEXT,
  p_expected_workspace_revision TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; actor RECORD; packet platform_private.partner_packets; a platform_private.document_export_artifacts;
  request_hash TEXT; failure TEXT; source_data JSONB;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'staff_session_required' USING ERRCODE='42501'; END IF;
  IF p_student_case_id IS NULL OR p_packet_id IS NULL OR p_request_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('draft','final')
    OR p_expected_workspace_revision IS NULL OR p_expected_workspace_revision !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'document_export_invalid_request' USING ERRCODE='22023'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=org FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(p_request_id);
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.staff_lock_memberships(org,ARRAY[actor.membership_id]);
  PERFORM 1 FROM platform.student_cases WHERE organization_id=org AND id=p_student_case_id FOR UPDATE;
  IF NOT platform_private.staff_can_access_for_actor(org,'application.manage','student_case',p_student_case_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  request_hash:=platform_private.bw1_input_sha256(jsonb_build_object('kind','package','organization_id',org,'student_case_id',p_student_case_id,
    'packet_id',p_packet_id,'actor',actor.membership_id,'mode',p_mode,'expected_workspace_revision',p_expected_workspace_revision));
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF a.request_sha256<>request_hash OR a.actor_auth_user_id<>actor.auth_user_id OR a.actor_membership_id<>actor.membership_id
      THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
    IF NOT platform_private.document_export_actor_authorized(a,actor.auth_user_id,actor.membership_id) THEN
      RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('schema_version',1,'preparation_id',a.preparation_id,
      'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id));
  END IF;
  SELECT * INTO packet FROM platform_private.partner_packets WHERE id=p_packet_id AND organization_id=org AND student_case_id=p_student_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF packet.source_snapshot IS NULL THEN RAISE EXCEPTION 'packet_requires_preparation' USING ERRCODE='55000'; END IF;
  IF packet.snapshot_sha256<>p_expected_workspace_revision THEN RAISE EXCEPTION 'packet_changed' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM platform.university_applications WHERE organization_id=org AND id=packet.application_id FOR SHARE;
  PERFORM 1 FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_student_case_id FOR SHARE;
  PERFORM 1 FROM platform.document_slots WHERE organization_id=org AND student_case_id=p_student_case_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM platform.document_versions WHERE organization_id=org AND student_case_id=p_student_case_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM platform_private.document_export_artifacts WHERE organization_id=org AND id=ANY(packet.export_ids) ORDER BY id FOR SHARE;
  SELECT COALESCE(jsonb_agg(DISTINCT source),'[]'::JSONB) INTO source_data FROM (
    SELECT jsonb_build_object('id',s->'id','sha256',s->'sha256') source FROM jsonb_array_elements(packet.source_snapshot) s WHERE s->>'kind'='original'
    UNION ALL SELECT s FROM platform_private.document_export_artifacts g CROSS JOIN LATERAL jsonb_array_elements(g.source_versions) s
      WHERE g.id=ANY(packet.export_ids) AND g.organization_id=org AND g.student_case_id=p_student_case_id) sources;
  a.id:=gen_random_uuid(); a.preparation_id:=gen_random_uuid(); a.organization_id:=org; a.student_case_id:=p_student_case_id;
  a.actor_auth_user_id:=actor.auth_user_id; a.actor_profile_id:=actor.profile_id; a.actor_membership_id:=actor.membership_id;
  a.kind:='package'; a.mode:=p_mode; a.package_id:=packet.id; a.package_item_count:=jsonb_array_length(packet.source_snapshot);
  a.application_id:=packet.application_id; a.source_versions:=source_data; a.workspace_revision:=packet.snapshot_sha256;
  a.input_snapshot_sha256:=platform_private.bw1_input_sha256(jsonb_build_object('packet_sha256',packet.snapshot_sha256,
    'mode',p_mode,'renderer_version','evo-partner-packet-zip-v1'));
  a.request_id:=p_request_id; a.request_sha256:=request_hash; a.renderer_version:='evo-partner-packet-zip-v1'; a.mime_type:='application/zip';
  failure:=platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,TRUE);
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'packet_not_ready' USING ERRCODE='55000'; END IF;
  INSERT INTO platform_private.document_export_input_snapshots(id,package_snapshot) VALUES(a.preparation_id,
    jsonb_build_object('packet_id',packet.id,'snapshot_sha256',packet.snapshot_sha256,'sources',packet.source_snapshot));
  INSERT INTO platform_private.document_export_artifacts(id,preparation_id,organization_id,student_case_id,student_profile_id,
    actor_auth_user_id,actor_profile_id,actor_membership_id,profile_revision,source_versions,field_reviews_sha256,workspace_revision,
    input_snapshot_sha256,request_id,request_sha256,kind,mode,template_sha256,renderer_version,mime_type,application_id,package_id,package_item_count)
  VALUES(a.id,a.preparation_id,org,p_student_case_id,NULL,actor.auth_user_id,actor.profile_id,actor.membership_id,NULL,source_data,NULL,
    a.workspace_revision,a.input_snapshot_sha256,p_request_id,request_hash,'package',p_mode,NULL,a.renderer_version,a.mime_type,
    a.application_id,a.package_id,a.package_item_count) RETURNING * INTO a;
  PERFORM platform_private.record_document_export_event(a,'prepared',gen_random_uuid(),request_hash,jsonb_build_object('state','pending'));
  RETURN jsonb_build_object('schema_version',1,'preparation_id',a.preparation_id,
    'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id));
END $$;

-- Metadata-only, exact claimed artifact. No profile values, arbitrary paths or
-- unbound service-role reads; fresh scope/safety checks precede every byte read.
CREATE FUNCTION platform.read_document_package_export_sources(p_artifact_id UUID,p_claim_token UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; sources JSONB;
BEGIN
  PERFORM platform_private.require_document_export_service();
  a:=platform_private.lock_document_export(p_artifact_id,p_actor_membership_id);
  IF a.kind<>'package' OR a.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR a.actor_membership_id IS DISTINCT FROM p_actor_membership_id OR a.claim_token IS DISTINCT FROM p_claim_token
    OR a.begun_at IS NULL OR a.state<>'pending' OR a.lease_expires_at<=statement_timestamp()
    OR platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,TRUE) IS NOT NULL THEN
    RAISE EXCEPTION 'package_source_unavailable' USING ERRCODE='42501'; END IF;
  SELECT package_snapshot->'sources' INTO sources FROM platform_private.document_export_input_snapshots WHERE id=a.preparation_id;
  RETURN jsonb_build_object('artifact_id',a.id,'packet_id',a.package_id,'workspace_revision',a.workspace_revision,
    'expires_at',a.lease_expires_at,'sources',sources);
END $$;

CREATE OR REPLACE FUNCTION platform_private.record_document_export_event(p_artifact platform_private.document_export_artifacts,
  p_kind TEXT,p_request_id UUID,p_input_sha256 TEXT,p_outcome JSONB,p_actor_profile UUID DEFAULT NULL,p_actor_auth UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO platform_private.document_export_events(artifact_id,request_id,event_kind,input_sha256,outcome)
    VALUES(p_artifact.id,p_request_id,p_kind,p_input_sha256,p_outcome);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
    resource_type,resource_id,after_state,reason,request_id)
  VALUES(p_artifact.organization_id,'user',COALESCE(p_actor_profile,p_artifact.actor_profile_id),
    'auth:'||COALESCE(p_actor_auth,p_artifact.actor_auth_user_id)::TEXT,'document.export.'||p_kind,
    CASE WHEN p_artifact.kind='student_profile' THEN 'student_profile' ELSE 'document_export' END,
    CASE WHEN p_artifact.kind='student_profile' THEN p_artifact.student_profile_id ELSE p_artifact.id END,
    jsonb_build_object('artifact_id',p_artifact.id,'profile_revision',p_artifact.profile_revision,
      'state',p_artifact.state,'mode',p_artifact.mode,'output_sha256',p_artifact.output_sha256,
      'output_bytes',p_artifact.output_bytes,'failure_code',p_artifact.failure_code)
      ||CASE WHEN p_artifact.kind<>'student_profile' THEN jsonb_build_object('application_id',p_artifact.application_id) ELSE '{}'::JSONB END
      ||CASE WHEN p_artifact.kind='package' THEN jsonb_build_object('package_id',p_artifact.package_id) ELSE '{}'::JSONB END,
    'Persistent artifact outcome; not a delivery or university submission receipt',p_request_id);
END $$;

CREATE OR REPLACE FUNCTION platform.seal_document_export_output(p_artifact_id UUID,p_claim_token UUID,p_output_sha256 TEXT,p_output_bytes INTEGER,
  p_renderer_proof JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; failure TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_output_sha256 IS NULL OR p_output_sha256 !~ '^[a-f0-9]{64}$' OR p_output_bytes IS NULL OR p_output_bytes NOT BETWEEN 1 AND 52428800 THEN
    RAISE EXCEPTION 'document_export_invalid_output' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
  IF a.kind NOT IN ('student_profile','university_form','package')
    OR p_output_bytes>(CASE a.kind WHEN 'student_profile' THEN 5242880 WHEN 'university_form' THEN 20971520 WHEN 'package' THEN 52428800 ELSE 0 END)
    OR (a.kind IN ('student_profile','package') AND p_renderer_proof IS NOT NULL)
    OR (a.kind='university_form' AND NOT platform_private.university_form_renderer_proof_valid(p_renderer_proof,a.mime_type)) THEN
    RAISE EXCEPTION 'document_export_invalid_output' USING ERRCODE='22023'; END IF;
  IF a.state='failed' THEN
    RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id),'storage',NULL);
  END IF;
  IF a.state<>'pending' THEN RAISE EXCEPTION 'document_export_not_pending' USING ERRCODE='55000'; END IF;
  failure:=platform_private.document_export_live_failure(a,a.actor_auth_user_id,a.actor_membership_id,TRUE);
  IF failure IS NULL AND a.lease_expires_at<=clock_timestamp() THEN failure:='export_failed'; END IF;
  IF failure IS NOT NULL THEN
    UPDATE platform_private.document_export_artifacts SET state='failed',failure_code=failure WHERE id=a.id RETURNING * INTO a;
    PERFORM platform_private.record_document_export_event(a,'failed',gen_random_uuid(),
      platform_private.bw1_input_sha256(jsonb_build_object('phase','seal','failure',failure)),jsonb_build_object('state',a.state));
    RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id),'storage',NULL);
  END IF;
  IF a.sealed_at IS NOT NULL THEN
    IF a.output_sha256<>p_output_sha256 OR a.output_bytes<>p_output_bytes OR a.renderer_proof IS DISTINCT FROM p_renderer_proof THEN
      RAISE EXCEPTION 'document_export_output_conflict' USING ERRCODE='23505'; END IF;
  ELSE
    UPDATE platform_private.document_export_artifacts SET output_sha256=p_output_sha256,output_bytes=p_output_bytes,renderer_proof=p_renderer_proof,
      object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||CASE mime_type WHEN 'application/pdf' THEN '.pdf' WHEN 'application/zip' THEN '.zip' ELSE '.docx' END,
      sealed_at=statement_timestamp() WHERE id=a.id RETURNING * INTO a;
    PERFORM platform_private.record_document_export_event(a,'sealed',gen_random_uuid(),
      platform_private.bw1_input_sha256(jsonb_build_object('sha256',p_output_sha256,'bytes',p_output_bytes)
        ||CASE WHEN a.kind='university_form' THEN jsonb_build_object('renderer_proof',p_renderer_proof) ELSE '{}'::JSONB END),
      jsonb_build_object('state',a.state));
  END IF;
  RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id),
    'storage',platform_private.document_export_storage_target(a,a.lease_expires_at));
END $$;

CREATE OR REPLACE FUNCTION platform.complete_document_export(p_artifact_id UUID,p_claim_token UUID,p_outcome TEXT,p_failure_code TEXT,
  p_observed_sha256 TEXT,p_observed_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; failure TEXT; fingerprint TEXT; outcome TEXT:=p_outcome;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_outcome IS NULL OR p_outcome NOT IN ('ready','failed','unknown')
    OR (p_outcome='ready' AND (p_failure_code IS NOT NULL OR p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$'
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 52428800))
    OR (p_outcome<>'ready' AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL OR p_failure_code IS NULL
      OR p_failure_code NOT IN ('profile_not_ready','source_changed','access_changed','source_unavailable',
        'template_unavailable','integrity_failed','export_failed','storage_unavailable','form_not_ready')))
    OR (p_outcome='unknown' AND p_failure_code<>'storage_unavailable') THEN
    RAISE EXCEPTION 'document_export_invalid_completion' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
  IF a.kind NOT IN ('student_profile','university_form','package')
    OR p_observed_bytes>(CASE a.kind WHEN 'student_profile' THEN 5242880 WHEN 'university_form' THEN 20971520 WHEN 'package' THEN 52428800 ELSE 0 END)
    OR (a.kind='student_profile' AND p_failure_code='form_not_ready') THEN
    RAISE EXCEPTION 'document_export_invalid_completion' USING ERRCODE='22023'; END IF;
  fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('outcome',p_outcome,'failure_code',p_failure_code,
    'sha256',p_observed_sha256,'bytes',p_observed_bytes));
  IF a.completion_input_sha256 IS NOT NULL THEN
    IF a.completion_input_sha256<>fingerprint THEN RAISE EXCEPTION 'document_export_completion_conflict' USING ERRCODE='23505'; END IF;
    RETURN platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id);
  END IF;
  IF a.state NOT IN ('pending','stored_unverified') THEN RAISE EXCEPTION 'document_export_not_pending' USING ERRCODE='55000'; END IF;
  failure:=platform_private.document_export_live_failure(a,a.actor_auth_user_id,a.actor_membership_id,TRUE);
  IF failure IS NOT NULL THEN outcome:='failed';
  ELSIF a.lease_expires_at<=clock_timestamp() THEN outcome:='failed';failure:='export_failed';
  ELSIF p_outcome='ready' AND (a.sealed_at IS NULL OR p_observed_sha256 IS DISTINCT FROM a.output_sha256 OR p_observed_bytes IS DISTINCT FROM a.output_bytes) THEN
    outcome:='failed';failure:='integrity_failed';
  ELSE failure:=p_failure_code; END IF;
  UPDATE platform_private.document_export_artifacts SET state=outcome,failure_code=failure,completion_input_sha256=fingerprint,
    ready_at=CASE WHEN outcome='ready' THEN statement_timestamp() END,
    receipt_id=CASE WHEN outcome='ready' THEN gen_random_uuid() END WHERE id=a.id RETURNING * INTO a;
  PERFORM platform_private.record_document_export_event(a,outcome,gen_random_uuid(),fingerprint,jsonb_build_object('state',a.state));
  RETURN platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id);
END $$;

CREATE OR REPLACE FUNCTION platform.reconcile_document_export(p_artifact_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID,
  p_request_id UUID,p_observed_sha256 TEXT,p_observed_bytes INTEGER,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; event platform_private.document_export_events;
  caller RECORD; fingerprint TEXT; failure TEXT; result JSONB; state_value TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_request_id IS NULL OR (p_failure_code IS NOT NULL AND p_failure_code NOT IN ('source_unavailable','storage_unavailable','integrity_failed'))
    OR (p_failure_code IS NULL AND (p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$'
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 52428800))
    OR (p_failure_code IS NOT NULL AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL)) THEN
    RAISE EXCEPTION 'document_export_invalid_reconciliation' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id,p_actor_membership_id,p_request_id);
  IF a.kind NOT IN ('student_profile','university_form','package')
    OR p_observed_bytes>(CASE a.kind WHEN 'student_profile' THEN 5242880 WHEN 'university_form' THEN 20971520 WHEN 'package' THEN 52428800 ELSE 0 END) THEN
    RAISE EXCEPTION 'document_export_invalid_reconciliation' USING ERRCODE='22023'; END IF;
  SELECT * INTO caller FROM platform_private.staff_membership_identity(a.organization_id,p_actor_membership_id) i WHERE i.auth_user_id=p_actor_auth_user_id;
  IF NOT FOUND OR NOT platform_private.document_export_actor_authorized(a,p_actor_auth_user_id,p_actor_membership_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('artifact_id',a.id,'auth_user_id',p_actor_auth_user_id,'membership_id',p_actor_membership_id));
  SELECT * INTO event FROM platform_private.document_export_events WHERE request_id=p_request_id;
  IF FOUND THEN
    IF event.artifact_id<>a.id OR event.event_kind<>'reconciled' OR event.input_sha256<>fingerprint THEN
      RAISE EXCEPTION 'document_export_request_conflict' USING ERRCODE='23505'; END IF;
    RETURN jsonb_set(event.outcome,'{can_download}',to_jsonb(event.outcome->>'state'='ready'
      AND platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,FALSE) IS NULL));
  END IF;
  IF a.state IN ('ready','failed') THEN
    result:=platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id);
    PERFORM platform_private.record_document_export_event(a,'reconciled',p_request_id,fingerprint,result,caller.profile_id,p_actor_auth_user_id);
    RETURN result;
  END IF;
  IF a.state='pending' AND COALESCE(a.lease_expires_at,a.created_at+INTERVAL '10 minutes')>clock_timestamp() THEN
    RAISE EXCEPTION 'document_export_artifact_pending' USING ERRCODE='55000'; END IF;
  failure:=platform_private.document_export_live_failure(a,a.actor_auth_user_id,a.actor_membership_id,TRUE);
  IF failure IS NULL THEN
    IF p_failure_code='storage_unavailable' THEN failure:='storage_unavailable';
    ELSIF p_failure_code IS NOT NULL THEN failure:=p_failure_code;
    ELSIF a.sealed_at IS NULL OR a.output_sha256 IS DISTINCT FROM p_observed_sha256 OR a.output_bytes IS DISTINCT FROM p_observed_bytes THEN failure:='integrity_failed'; END IF;
  END IF;
  state_value:=CASE WHEN failure IS NULL THEN 'ready' WHEN failure='storage_unavailable' THEN 'unknown' ELSE 'failed' END;
  UPDATE platform_private.document_export_artifacts SET state=state_value,failure_code=failure,
    ready_at=CASE WHEN state_value='ready' THEN statement_timestamp() END,
    receipt_id=CASE WHEN state_value='ready' THEN gen_random_uuid() END WHERE id=a.id RETURNING * INTO a;
  result:=platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id);
  PERFORM platform_private.record_document_export_event(a,'reconciled',p_request_id,fingerprint,result,caller.profile_id,p_actor_auth_user_id);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION platform.complete_document_export_download(p_grant_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID,
  p_observed_sha256 TEXT,p_observed_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; g platform_private.document_export_download_grants;
  failure TEXT; fingerprint TEXT; result JSONB;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF (p_observed_sha256 IS NULL)<>(p_observed_bytes IS NULL)
    OR (p_observed_sha256 IS NOT NULL AND (p_observed_sha256 !~ '^[a-f0-9]{64}$' OR p_observed_bytes NOT BETWEEN 1 AND 52428800)) THEN
    RAISE EXCEPTION 'document_export_invalid_download_outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(g.artifact_id,p_actor_membership_id);
  IF a.kind NOT IN ('student_profile','university_form','package')
    OR p_observed_bytes>(CASE a.kind WHEN 'student_profile' THEN 5242880 WHEN 'university_form' THEN 20971520 WHEN 'package' THEN 52428800 ELSE 0 END) THEN
    RAISE EXCEPTION 'document_export_invalid_download_outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id FOR UPDATE;
  IF g.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR g.actor_membership_id IS DISTINCT FROM p_actor_membership_id OR g.consumed_at IS NULL THEN
    RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('sha256',p_observed_sha256,'bytes',p_observed_bytes));
  failure:=platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,FALSE);
  IF g.completion IS NOT NULL THEN
    IF g.completion_sha256<>fingerprint THEN RAISE EXCEPTION 'document_export_download_conflict' USING ERRCODE='23505'; END IF;
    IF failure IS NOT NULL OR g.expires_at<=clock_timestamp() THEN
      RETURN jsonb_build_object('grant_id',g.id,'artifact_id',a.id,'verified',FALSE,'failure_code',COALESCE(failure,'access_changed')); END IF;
    RETURN g.completion;
  END IF;
  IF failure IS NULL THEN
    IF g.expires_at<=clock_timestamp() THEN failure:='access_changed';
    ELSIF a.state<>'ready' OR p_observed_sha256 IS DISTINCT FROM a.output_sha256 OR p_observed_bytes IS DISTINCT FROM a.output_bytes THEN failure:='integrity_failed'; END IF;
  END IF;
  result:=jsonb_build_object('grant_id',g.id,'artifact_id',a.id,'verified',failure IS NULL,'failure_code',failure);
  UPDATE platform_private.document_export_download_grants SET completion_sha256=fingerprint,completion=result WHERE id=g.id;
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
    resource_type,resource_id,after_state,reason,request_id)
  VALUES(a.organization_id,'user',g.actor_profile_id,'auth:'||g.actor_auth_user_id::TEXT,
    'document.export.download.'||CASE WHEN failure IS NULL THEN 'verified' ELSE 'failed' END,
    CASE WHEN a.kind='student_profile' THEN 'student_profile' ELSE 'document_export' END,
    CASE WHEN a.kind='student_profile' THEN a.student_profile_id ELSE a.id END,
    result||CASE WHEN a.kind='university_form' THEN jsonb_build_object('application_id',a.application_id)
      WHEN a.kind='package' THEN jsonb_build_object('application_id',a.application_id,'package_id',a.package_id) ELSE '{}'::JSONB END,
    'Storage readback and live access verified; not confirmation of delivery',g.request_id);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION
  platform_private.document_export_actor_authorized(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.document_export_live_failure(platform_private.document_export_artifacts,UUID,UUID,BOOLEAN),
  platform_private.document_export_receipt(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.lock_document_export(UUID,UUID,UUID),
  platform_private.partner_packet_sources(UUID,UUID,UUID,UUID),platform_private.partner_packet_public_files(JSONB),
  platform_private.partner_packet_public_exports(JSONB),platform_private.partner_packet_public(platform_private.partner_packets),
  platform.partner_packet_workspace_v2(UUID),platform.prepare_partner_packet_v2(UUID,UUID,UUID[],UUID,UUID[],TEXT),
  platform.prepare_document_package_export(UUID,UUID,TEXT,TEXT,UUID),platform.read_document_package_export_sources(UUID,UUID,UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.partner_packet_workspace_v2(UUID),platform.prepare_partner_packet_v2(UUID,UUID,UUID[],UUID,UUID[],TEXT),
  platform.prepare_document_package_export(UUID,UUID,TEXT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.read_document_package_export_sources(UUID,UUID,UUID,UUID) TO service_role;
COMMENT ON COLUMN platform_private.partner_packets.source_snapshot IS
  'NULL for old JSON-only Platform packets. New exact originals/generated artifacts only; never backfilled from current authority.';
COMMENT ON COLUMN platform_private.document_export_artifacts.package_id IS
  'Persisted50MiB ZIP uses the existing immutable artifact lifecycle. No fake Student Profile or legacy test-history migration.';
NOTIFY pgrst,'reload schema';
COMMIT;
