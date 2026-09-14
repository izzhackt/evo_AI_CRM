-- D4 saved forms extend164's one immutable artifact lifecycle. No Storage writes,
-- native execution or frozen-value service-role reader is installed here.
-- Contract: docs/design/v3/evo-docs-university-packages-contract.md
BEGIN;

ALTER TABLE platform_private.document_export_input_snapshots
  ADD COLUMN frozen_form JSONB CHECK (frozen_form IS NULL OR jsonb_typeof(frozen_form)='object');
ALTER TABLE platform_private.document_export_artifacts
  ADD COLUMN application_id UUID,
  ADD COLUMN catalog_institution_id UUID,
  ADD COLUMN catalog_source_revision TEXT,
  ADD COLUMN template_id UUID,
  ADD COLUMN template_version_id UUID,
  ADD COLUMN inspection_receipt_id UUID,
  ADD COLUMN mapping_id UUID,
  ADD COLUMN mapping_sha256 TEXT CHECK(mapping_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN review_id UUID,
  ADD COLUMN validation_day DATE,
  ADD COLUMN generated_input_sha256 TEXT CHECK(generated_input_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN renderer_proof JSONB;

-- Composite targets bind one application/catalog and one exact version/mapping/
-- inspection tuple, not merely a collection of independently existing UUIDs.
ALTER TABLE platform.university_applications ADD CONSTRAINT university_applications_export_scope_key
  UNIQUE(organization_id,student_case_id,catalog_institution_id,id);
ALTER TABLE platform_private.university_form_templates ADD CONSTRAINT university_form_template_export_scope_key
  UNIQUE(organization_id,catalog_institution_id,id);
ALTER TABLE platform_private.university_form_mapping_versions ADD CONSTRAINT university_form_mapping_export_scope_key
  UNIQUE(organization_id,template_id,template_version_id,id);
ALTER TABLE platform_private.university_form_inspection_receipts ADD CONSTRAINT university_form_inspection_export_scope_key
  UNIQUE(organization_id,template_id,template_version_id,id);
ALTER TABLE platform_private.document_export_artifacts
  ADD CONSTRAINT document_export_form_application_fk FOREIGN KEY(organization_id,student_case_id,catalog_institution_id,application_id)
    REFERENCES platform.university_applications(organization_id,student_case_id,catalog_institution_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT document_export_form_template_fk FOREIGN KEY(organization_id,catalog_institution_id,template_id)
    REFERENCES platform_private.university_form_templates(organization_id,catalog_institution_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT document_export_form_mapping_fk FOREIGN KEY(organization_id,template_id,template_version_id,mapping_id)
    REFERENCES platform_private.university_form_mapping_versions(organization_id,template_id,template_version_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT document_export_form_review_fk FOREIGN KEY(organization_id,template_id,mapping_id,review_id)
    REFERENCES platform_private.university_form_mapping_reviews(organization_id,template_id,mapping_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT document_export_form_inspection_fk FOREIGN KEY(organization_id,template_id,template_version_id,inspection_receipt_id)
    REFERENCES platform_private.university_form_inspection_receipts(organization_id,template_id,template_version_id,id) ON DELETE RESTRICT;

ALTER TABLE platform_private.document_export_artifacts
  DROP CONSTRAINT document_export_artifacts_kind_check,
  DROP CONSTRAINT document_export_artifacts_template_sha256_check,
  DROP CONSTRAINT document_export_artifacts_renderer_version_check,
  DROP CONSTRAINT document_export_artifacts_mime_type_check,
  DROP CONSTRAINT document_export_artifacts_output_bytes_check,
  DROP CONSTRAINT document_export_artifacts_failure_code_check;
--164's unnamed sealed-object CHECK is identified by its sole object_name column
-- reference. Require exactly one; never drop unrelated constraints by a pattern.
DO $$DECLARE target TEXT; count_found INTEGER;
BEGIN
  SELECT count(*),min(c.conname) INTO count_found,target FROM pg_constraint c
  WHERE c.conrelid='platform_private.document_export_artifacts'::REGCLASS AND c.contype='c'
    AND (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='object_name')=ANY(c.conkey);
  IF count_found<>1 THEN RAISE EXCEPTION 'document_export_seal_constraint_mismatch'; END IF;
  EXECUTE format('ALTER TABLE platform_private.document_export_artifacts DROP CONSTRAINT %I',target);
END $$;

CREATE FUNCTION platform_private.university_form_renderer_proof_valid(p_proof JSONB,p_mime TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT COALESCE(platform_private.university_form_exact_keys(p_proof,ARRAY['image_id','release_revision','font_sha256'])
    AND jsonb_typeof(p_proof->'image_id')='string' AND p_proof->>'image_id' ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof(p_proof->'release_revision')='string' AND p_proof->>'release_revision' ~ '^[a-f0-9]{40}$'
    AND CASE p_mime WHEN 'application/pdf' THEN p_proof->>'font_sha256'='b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'
      WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN p_proof->'font_sha256'='null'::JSONB ELSE FALSE END,FALSE)
$$;
ALTER TABLE platform_private.document_export_artifacts
  ADD CONSTRAINT document_export_kind_binding_check CHECK(
    (kind='student_profile' AND num_nonnulls(application_id,catalog_institution_id,catalog_source_revision,template_id,
      template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,validation_day,generated_input_sha256,renderer_proof)=0
      AND template_sha256='2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0'
      AND renderer_version='evo-student-profile-docx-v1'
      AND mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR (kind='university_form' AND num_nonnulls(application_id,catalog_institution_id,catalog_source_revision,template_id,
      template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,validation_day,generated_input_sha256)=11
      AND btrim(catalog_source_revision)<>'' AND template_sha256 ~ '^[a-f0-9]{64}$'
      AND ((mime_type='application/pdf' AND renderer_version='evo-university-form-pdf-v1')
        OR (mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND renderer_version='evo-university-form-docx-v1')))),
  ADD CONSTRAINT document_export_output_limit_check CHECK(output_bytes BETWEEN 1 AND CASE WHEN kind='student_profile' THEN 5242880 ELSE 20971520 END),
  ADD CONSTRAINT document_export_failure_kind_check CHECK(failure_code IN ('profile_not_ready','source_changed','access_changed','source_unavailable',
    'template_unavailable','integrity_failed','export_failed','storage_unavailable') OR (kind='university_form' AND failure_code='form_not_ready')),
  ADD CONSTRAINT document_export_sealed_object_check CHECK(
    (sealed_at IS NULL AND object_name IS NULL AND output_sha256 IS NULL AND output_bytes IS NULL AND renderer_proof IS NULL)
    OR (sealed_at IS NOT NULL AND begun_at IS NOT NULL AND object_name IS NOT NULL AND output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
      AND object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||CASE WHEN mime_type='application/pdf' THEN '.pdf' ELSE '.docx' END
      AND (kind='student_profile' OR platform_private.university_form_renderer_proof_valid(renderer_proof,mime_type))));

CREATE OR REPLACE FUNCTION platform_private.preserve_document_export_artifact()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mutable TEXT[]:=ARRAY['state','begun_at','lease_expires_at','claim_token','object_name','output_sha256',
  'output_bytes','sealed_at','ready_at','receipt_id','failure_code','completion_input_sha256','renderer_proof'];
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document_export_history_immutable' USING ERRCODE='55000'; END IF;
  IF OLD.state IN ('ready','failed') OR (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable)
    OR (OLD.begun_at IS NOT NULL AND ROW(NEW.begun_at,NEW.lease_expires_at,NEW.claim_token)
      IS DISTINCT FROM ROW(OLD.begun_at,OLD.lease_expires_at,OLD.claim_token))
    OR (OLD.sealed_at IS NOT NULL AND ROW(NEW.object_name,NEW.output_sha256,NEW.output_bytes,NEW.sealed_at,NEW.renderer_proof)
      IS DISTINCT FROM ROW(OLD.object_name,OLD.output_sha256,OLD.output_bytes,OLD.sealed_at,OLD.renderer_proof)) THEN
    RAISE EXCEPTION 'document_export_history_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION platform_private.university_form_export_binding(p_artifact platform_private.document_export_artifacts)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('application_id',p_artifact.application_id,'catalog_institution_id',p_artifact.catalog_institution_id,
    'catalog_source_revision',p_artifact.catalog_source_revision,'template_id',p_artifact.template_id,'template_version_id',p_artifact.template_version_id,
    'inspection_receipt_id',p_artifact.inspection_receipt_id,'mapping_id',p_artifact.mapping_id,'mapping_sha256',p_artifact.mapping_sha256,
    'review_id',p_artifact.review_id,'validation_day',p_artifact.validation_day)
$$;

-- Metadata only; caller must authorize/lock before using it. Minimal receipt166
-- manifests contain no rich DOCX text/context/kind. The child reinspects bytes.
CREATE FUNCTION platform_private.university_form_export_metadata(p_case UUID,p_application UUID,p_mapping UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE app platform.university_applications; t platform_private.university_form_templates;
  m platform_private.university_form_mapping_versions; v platform_private.university_form_template_versions;
  r platform_private.university_form_mapping_reviews; i platform_private.university_form_inspection_receipts;
  publication JSONB;
BEGIN
  SELECT * INTO app FROM platform.university_applications WHERE id=p_application AND student_case_id=p_case;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE id=p_mapping AND organization_id=app.organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO t FROM platform_private.university_form_templates WHERE id=m.template_id
    AND organization_id=app.organization_id AND catalog_institution_id=app.catalog_institution_id;
  IF NOT FOUND OR t.published_mapping_id IS DISTINCT FROM m.id THEN RETURN NULL; END IF;
  publication:=platform_private.university_form_current_publication(t);
  IF publication IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM platform_private.university_form_template_versions WHERE id=m.template_version_id;
  SELECT * INTO r FROM platform_private.university_form_mapping_reviews WHERE id=t.published_review_id;
  SELECT * INTO i FROM platform_private.university_form_inspection_receipts WHERE template_version_id=v.id;
  IF i.id IS NULL OR NOT platform_private.university_form_manifest_valid(i.manifest,v.mime_type) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('schema_version',1,'kind','university_form','organization_id',app.organization_id,'student_case_id',p_case,
    'form',jsonb_build_object('application_id',app.id,'catalog_institution_id',app.catalog_institution_id,'catalog_source_revision',t.catalog_source_revision,
      'template_id',t.id,'template_version_id',v.id,'inspection_receipt_id',i.id,'mapping_id',m.id,'mapping_sha256',m.sha256,
      'review_id',r.id,'validation_day',(statement_timestamp() AT TIME ZONE 'UTC')::DATE),
    'template',jsonb_build_object('versionId',v.id,'sha256',v.sha256,'manifest',i.manifest),
    'mapping',jsonb_build_object('versionId',m.id,'templateVersionId',v.id,'templateSha256',v.sha256,'mappings',m.mappings,'sha256',m.sha256),
    'review',jsonb_build_object('versionId',r.id,'templateVersionId',v.id,'templateSha256',v.sha256,'mappingVersionId',m.id,'mappingSha256',m.sha256,'state','approved'),
    'source_byte_size',v.byte_size,'source_mime_type',v.mime_type,'manifest_sha256',i.manifest_sha256,
    'renderer_version',CASE WHEN v.mime_type='application/pdf' THEN 'evo-university-form-pdf-v1' ELSE 'evo-university-form-docx-v1' END,
    'font_sha256',CASE WHEN v.mime_type='application/pdf' THEN 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5' END);
END $$;

CREATE FUNCTION platform_private.university_form_export_workspace_digest(p_metadata JSONB,p_profile UUID,p_revision BIGINT,p_reviews TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT platform_private.bw1_input_sha256(jsonb_build_object('schema_version',1,'kind','university_form',
    'organization_id',p_metadata->'organization_id','student_case_id',p_metadata->'student_case_id','form',p_metadata->'form',
    'profile_id',p_profile,'profile_revision',p_revision,'field_reviews_sha256',p_reviews,
    'template_sha256',p_metadata->'template'->'sha256','manifest_sha256',p_metadata->'manifest_sha256',
    'renderer_version',p_metadata->'renderer_version','font_sha256',p_metadata->'font_sha256'))
$$;

-- This projection is sorted-key COMPACT JSON, the existing package hash domain.
-- Its values are only canonical UUIDs, lowercase hashes, a literal and BIGINT;
-- do not substitute bw1(jsonb::text), which contains inter-property whitespace.
CREATE FUNCTION platform_private.university_form_export_generated_hash(p_artifact platform_private.document_export_artifacts)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT encode(sha256(convert_to('{'||string_agg(to_json(key)::TEXT||':'||value::TEXT,',' ORDER BY key COLLATE "C")||'}','UTF8')),'hex')
  FROM jsonb_each(jsonb_build_object('kind','university_form','organizationId',p_artifact.organization_id,'studentCaseId',p_artifact.student_case_id,
    'profileId',p_artifact.student_profile_id,'profileRevision',p_artifact.profile_revision,'fieldReviewsSha256',p_artifact.field_reviews_sha256,
    'templateSha256',p_artifact.template_sha256,'applicationId',p_artifact.application_id,'catalogInstitutionId',p_artifact.catalog_institution_id,
    'templateVersionId',p_artifact.template_version_id,'mappingVersionId',p_artifact.mapping_id,'mappingSha256',p_artifact.mapping_sha256,
    'mappingReviewVersionId',p_artifact.review_id))
$$;

CREATE OR REPLACE FUNCTION platform_private.document_export_actor_authorized(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_artifact.organization_id,p_member) i WHERE i.auth_user_id=p_auth)
    AND platform_private.staff_can_access(p_artifact.organization_id,p_member,'profile.read.full','student_case',p_artifact.student_case_id)
    AND platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','student_case',p_artifact.student_case_id)
    AND (p_artifact.kind='student_profile' OR platform_private.staff_can_access(p_artifact.organization_id,p_member,'catalog.read','organization',p_artifact.organization_id))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifact.source_versions) source
      WHERE NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','document',(source->>'id')::UUID))
$$;

CREATE OR REPLACE FUNCTION platform_private.document_export_live_failure(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID,p_require_current BOOLEAN
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE source JSONB; version_row RECORD; current_profile RECORD; metadata JSONB;
BEGIN
  IF NOT platform_private.document_export_actor_authorized(p_artifact,p_auth,p_member) THEN RETURN 'access_changed'; END IF;
  FOR source IN SELECT * FROM jsonb_array_elements(p_artifact.source_versions) LOOP
    SELECT v.id,v.sha256_hex,v.integrity_status,v.malware_status,s.removed_at INTO version_row
    FROM platform.document_versions v JOIN platform.document_slots s ON s.organization_id=v.organization_id AND s.id=v.document_slot_id
    WHERE v.organization_id=p_artifact.organization_id AND v.student_case_id=p_artifact.student_case_id AND v.id=(source->>'id')::UUID
      AND EXISTS(SELECT 1 FROM platform_private.document_upload_finalizations f
        WHERE f.organization_id=v.organization_id AND f.student_case_id=v.student_case_id AND f.document_version_id=v.id);
    IF NOT FOUND OR version_row.sha256_hex IS DISTINCT FROM source->>'sha256'
      OR version_row.integrity_status::TEXT<>'verified' OR version_row.malware_status::TEXT<>'clean'
      OR version_row.removed_at IS NOT NULL THEN RETURN 'source_unavailable'; END IF;
  END LOOP;
  IF p_artifact.kind='university_form' AND NOT EXISTS(
    SELECT 1 FROM platform_private.university_form_template_versions v
    JOIN platform_private.university_form_inspection_receipts i ON i.template_version_id=v.id
    WHERE v.organization_id=p_artifact.organization_id AND v.template_id=p_artifact.template_id AND v.id=p_artifact.template_version_id
      AND v.sha256=p_artifact.template_sha256 AND v.mime_type=p_artifact.mime_type AND i.id=p_artifact.inspection_receipt_id
      AND platform_private.university_form_inspection_matches(v)) THEN RETURN 'source_unavailable'; END IF;
  IF p_require_current THEN
    SELECT id,revision INTO current_profile FROM platform.student_profiles
      WHERE organization_id=p_artifact.organization_id AND student_case_id=p_artifact.student_case_id AND id=p_artifact.student_profile_id;
    IF NOT FOUND OR current_profile.revision<>p_artifact.profile_revision
      OR platform_private.document_export_review_digest(current_profile.id)<>p_artifact.field_reviews_sha256 THEN RETURN 'source_changed'; END IF;
    IF p_artifact.kind='university_form' THEN
      metadata:=platform_private.university_form_export_metadata(p_artifact.student_case_id,p_artifact.application_id,p_artifact.mapping_id);
      IF metadata IS NULL OR platform_private.university_form_export_workspace_digest(metadata,current_profile.id,
        current_profile.revision,p_artifact.field_reviews_sha256) IS DISTINCT FROM p_artifact.workspace_revision THEN RETURN 'source_changed'; END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION platform_private.document_export_receipt(p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',p_artifact.id,'student_case_id',p_artifact.student_case_id,'student_profile_id',p_artifact.student_profile_id,
    'profile_revision',p_artifact.profile_revision,'workspace_revision',p_artifact.workspace_revision,
    'input_snapshot_sha256',p_artifact.input_snapshot_sha256,'field_reviews_sha256',p_artifact.field_reviews_sha256,
    'kind',p_artifact.kind,'mode',p_artifact.mode,'state',p_artifact.state,'template_sha256',p_artifact.template_sha256,
    'renderer_version',p_artifact.renderer_version,'created_at',p_artifact.created_at,'ready_at',p_artifact.ready_at,
    'output_sha256',p_artifact.output_sha256,'output_bytes',p_artifact.output_bytes,'mime_type',p_artifact.mime_type,
    'receipt_id',p_artifact.receipt_id,'failure_code',p_artifact.failure_code,
    'historical',CASE WHEN p_artifact.kind='student_profile' THEN NOT EXISTS(SELECT 1 FROM platform.student_profiles p
      WHERE p.id=p_artifact.student_profile_id AND p.revision=p_artifact.profile_revision
        AND platform_private.document_export_review_digest(p.id)=p_artifact.field_reviews_sha256)
      ELSE platform_private.document_export_live_failure(p_artifact,p_auth,p_member,TRUE) IS NOT NULL END,
    'can_download',p_artifact.state='ready' AND platform_private.document_export_live_failure(p_artifact,p_auth,p_member,FALSE) IS NULL)
    || CASE WHEN p_artifact.kind='university_form' THEN jsonb_build_object('form',platform_private.university_form_export_binding(p_artifact),
      'generated_input_sha256',p_artifact.generated_input_sha256,'renderer_proof',p_artifact.renderer_proof) ELSE '{}'::JSONB END
$$;

-- Private signature gains an optional command request, so every request advisory
-- lock is acquired in order before member/case/resource/row locks. Public args stay164.
DROP FUNCTION platform_private.lock_document_export(UUID,UUID);
CREATE FUNCTION platform_private.lock_document_export(p_artifact_id UUID,p_extra_member UUID DEFAULT NULL,p_extra_request UUID DEFAULT NULL)
RETURNS platform_private.document_export_artifacts LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; request_uuid UUID;
BEGIN
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=a.organization_id FOR UPDATE;
  FOR request_uuid IN SELECT DISTINCT x FROM unnest(ARRAY[a.request_id,p_extra_request]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM platform_private.lock_bw3_request(request_uuid);
  END LOOP;
  PERFORM platform_private.staff_lock_memberships(a.organization_id,ARRAY[a.actor_membership_id,p_extra_member]);
  PERFORM 1 FROM platform.student_cases WHERE id=a.student_case_id AND organization_id=a.organization_id FOR UPDATE;
  PERFORM 1 FROM platform.student_profiles WHERE id=a.student_profile_id AND organization_id=a.organization_id FOR UPDATE;
  IF a.kind='university_form' THEN
    PERFORM 1 FROM platform.university_applications WHERE organization_id=a.organization_id AND id=a.application_id FOR UPDATE;
    PERFORM 1 FROM platform.catalog_institutions WHERE organization_id=a.organization_id AND id=a.catalog_institution_id FOR SHARE;
    PERFORM 1 FROM platform_private.university_form_templates WHERE organization_id=a.organization_id AND id=a.template_id FOR UPDATE;
    PERFORM 1 FROM platform_private.university_form_template_versions WHERE id=a.template_version_id FOR SHARE;
    PERFORM 1 FROM platform_private.university_form_mapping_versions WHERE id=a.mapping_id FOR SHARE;
    PERFORM 1 FROM platform_private.university_form_mapping_reviews WHERE id=a.review_id FOR SHARE;
    PERFORM 1 FROM platform_private.university_form_inspection_receipts WHERE id=a.inspection_receipt_id FOR SHARE;
  END IF;
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=a.organization_id
    AND s.id IN(SELECT v.document_slot_id FROM platform.document_versions v WHERE v.organization_id=a.organization_id
      AND v.id IN(SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x)) ORDER BY s.id FOR SHARE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=a.organization_id
    AND v.id IN(SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x) ORDER BY v.id FOR SHARE;
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id FOR UPDATE;
  RETURN a;
END $$;

-- A migration precedes app replacement and survives app rollback: retain the
-- exact v1 shape and exclude form rows even after the new app has created them.
CREATE OR REPLACE FUNCTION platform.staff_document_export_workspace(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; p RECORD; org UUID; exports JSONB;
BEGIN
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_student_case_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT id,revision INTO p FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_student_case_id;
  SELECT COALESCE(jsonb_agg(platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id)
    ORDER BY a.created_at DESC,a.id),'[]'::JSONB) INTO exports FROM platform_private.document_export_artifacts a
    WHERE a.organization_id=org AND a.student_case_id=p_student_case_id AND a.kind='student_profile';
  RETURN jsonb_build_object('schema_version',1,'student_case_id',p_student_case_id,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'revision',p.revision) END,
    'workspace_revision',CASE WHEN p.id IS NULL THEN NULL ELSE platform_private.document_export_workspace_digest(p.id,p.revision,
      platform_private.document_export_review_digest(p.id)) END,'can_export',p.id IS NOT NULL,'artifacts',exports);
END $$;

CREATE FUNCTION platform.staff_document_export_workspace_v2(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base JSONB; actor RECORD; org UUID; exports JSONB;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  base:=platform.staff_document_export_workspace(p_student_case_id);
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  SELECT COALESCE(jsonb_agg(platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id)
    ORDER BY a.created_at DESC,a.id),'[]'::JSONB) INTO exports FROM platform_private.document_export_artifacts a
    WHERE a.organization_id=org AND a.student_case_id=p_student_case_id
      AND (a.kind='student_profile' OR platform_private.document_export_actor_authorized(a,actor.auth_user_id,actor.membership_id));
  RETURN base||jsonb_build_object('schema_version',2,'artifacts',exports);
END $$;

CREATE FUNCTION platform.staff_university_form_export_workspace(p_student_case_id UUID,p_application_id UUID,p_mapping_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; actor RECORD; p RECORD; catalog UUID; metadata JSONB;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  IF p_student_case_id IS NULL OR p_application_id IS NULL OR p_mapping_id IS NULL THEN
    RAISE EXCEPTION 'document_export_invalid_request' USING ERRCODE='22023'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_student_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'catalog.read','organization',org) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT app.catalog_institution_id INTO catalog FROM platform.university_applications app
    JOIN platform_private.university_form_templates t ON t.organization_id=app.organization_id AND t.catalog_institution_id=app.catalog_institution_id
    JOIN platform_private.university_form_mapping_versions m ON m.organization_id=t.organization_id AND m.template_id=t.id
    WHERE app.organization_id=org AND app.student_case_id=p_student_case_id AND app.id=p_application_id AND m.id=p_mapping_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT id,revision INTO p FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_student_case_id;
  IF p.id IS NOT NULL AND EXISTS(SELECT 1 FROM platform.student_profile_fields f WHERE f.student_profile_id=p.id
    AND f.review_state::TEXT='confirmed' AND f.source_document_version_id IS NOT NULL
    AND NOT platform_private.staff_can_access_for_actor(org,'document.download','document',f.source_document_version_id)) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  metadata:=platform_private.university_form_export_metadata(p_student_case_id,p_application_id,p_mapping_id);
  RETURN jsonb_build_object('schema_version',1,'student_case_id',p_student_case_id,'application_id',p_application_id,'catalog_institution_id',catalog,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'revision',p.revision) END,
    'selection',metadata->'form','workspace_revision',CASE WHEN metadata IS NULL OR p.id IS NULL THEN NULL
      ELSE platform_private.university_form_export_workspace_digest(metadata,p.id,p.revision,platform_private.document_export_review_digest(p.id)) END,
    'can_export',metadata IS NOT NULL AND p.id IS NOT NULL,
    'unavailable_reason',CASE WHEN metadata IS NULL THEN 'mapping_not_current' WHEN p.id IS NULL THEN 'profile_missing' END);
END $$;

CREATE FUNCTION platform.prepare_university_form_export(p_student_case_id UUID,p_application_id UUID,p_mapping_id UUID,
  p_mode TEXT,p_expected_workspace_revision TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; actor RECORD; p RECORD; app platform.university_applications;
  t platform_private.university_form_templates; m platform_private.university_form_mapping_versions;
  a platform_private.document_export_artifacts; request_hash TEXT; metadata JSONB; frozen JSONB; fields JSONB;
  source_data JSONB; failure TEXT; capsule JSONB; digest TEXT;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  IF p_student_case_id IS NULL OR p_application_id IS NULL OR p_mapping_id IS NULL OR p_request_id IS NULL
    OR p_mode IS NULL OR p_mode NOT IN ('draft','final') OR p_expected_workspace_revision IS NULL
    OR p_expected_workspace_revision !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'document_export_invalid_request' USING ERRCODE='22023'; END IF;
  SELECT organization_id INTO org FROM platform.student_cases WHERE id=p_student_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=org FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(p_request_id);
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.staff_lock_memberships(org,ARRAY[actor.membership_id]);
  PERFORM 1 FROM platform.student_cases WHERE id=p_student_case_id AND organization_id=org FOR UPDATE;
  IF NOT platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_student_case_id)
    OR NOT platform_private.staff_can_access_for_actor(org,'catalog.read','organization',org) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  request_hash:=platform_private.bw1_input_sha256(jsonb_build_object('kind','university_form','organization_id',org,
    'student_case_id',p_student_case_id,'application_id',p_application_id,'mapping_id',p_mapping_id,'mode',p_mode,
    'workspace_revision',p_expected_workspace_revision,'auth_user_id',actor.auth_user_id,'membership_id',actor.membership_id));
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF a.kind<>'university_form' OR a.request_sha256<>request_hash THEN
      RAISE EXCEPTION 'document_export_request_conflict' USING ERRCODE='23505'; END IF;
    a:=platform_private.lock_document_export(a.id,actor.membership_id);
    IF NOT platform_private.document_export_actor_authorized(a,actor.auth_user_id,actor.membership_id) THEN
      RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
    IF a.begun_at IS NULL AND a.state='pending'
      AND platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,TRUE) IS NULL THEN
      SELECT frozen_form||jsonb_build_object('mode',a.mode,'frozen_profile',frozen_profile) INTO capsule
        FROM platform_private.document_export_input_snapshots WHERE id=a.preparation_id;
    END IF;
    RETURN jsonb_build_object('schema_version',1,'preparation_id',a.preparation_id,
      'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id),'frozen_form',capsule);
  END IF;
  SELECT id,revision INTO p FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_student_case_id FOR UPDATE;
  SELECT * INTO app FROM platform.university_applications WHERE organization_id=org AND student_case_id=p_student_case_id AND id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE organization_id=org AND id=p_mapping_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM platform_private.university_form_templates WHERE organization_id=org AND id=m.template_id
    AND catalog_institution_id=app.catalog_institution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.catalog_institutions WHERE organization_id=org AND id=t.catalog_institution_id FOR SHARE;
  PERFORM 1 FROM platform_private.university_form_templates WHERE id=t.id FOR UPDATE;
  PERFORM 1 FROM platform_private.university_form_template_versions WHERE id=m.template_version_id FOR SHARE;
  PERFORM 1 FROM platform_private.university_form_mapping_versions WHERE id=m.id FOR SHARE;
  PERFORM 1 FROM platform_private.university_form_mapping_reviews WHERE id=t.published_review_id FOR SHARE;
  PERFORM 1 FROM platform_private.university_form_inspection_receipts WHERE template_version_id=m.template_version_id FOR SHARE;
  metadata:=platform_private.university_form_export_metadata(p_student_case_id,p_application_id,p_mapping_id);
  IF metadata IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'document_export_not_ready' USING ERRCODE='55000'; END IF;
  a.field_reviews_sha256:=platform_private.document_export_review_digest(p.id);
  digest:=platform_private.university_form_export_workspace_digest(metadata,p.id,p.revision,a.field_reviews_sha256);
  IF digest<>p_expected_workspace_revision THEN RAISE EXCEPTION 'document_export_stale_revision' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=org AND s.id IN(
    SELECT v.document_slot_id FROM platform.document_versions v WHERE v.organization_id=org AND v.id IN(
      SELECT f.source_document_version_id FROM platform.student_profile_fields f WHERE f.student_profile_id=p.id
        AND f.review_state::TEXT='confirmed' AND f.source_document_version_id IS NOT NULL)) ORDER BY s.id FOR SHARE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=org AND v.id IN(
    SELECT f.source_document_version_id FROM platform.student_profile_fields f WHERE f.student_profile_id=p.id
      AND f.review_state::TEXT='confirmed' AND f.source_document_version_id IS NOT NULL) ORDER BY v.id FOR SHARE;
  -- The only values-bearing read remains on this authenticated session path.
  frozen:=platform.staff_student_profile_fields(p_student_case_id);
  SELECT jsonb_agg(jsonb_build_object('field_key',f->>'field_key',
    'value',CASE WHEN f->>'review_state'='confirmed' THEN f->'value' ELSE 'null'::JSONB END,
    'review_state',f->>'review_state','reviewed_at',f->'reviewed_at',
    'source_document_version_id',CASE WHEN f->>'review_state'='confirmed' THEN f->'source_document_version_id' ELSE 'null'::JSONB END,
    'source_page',CASE WHEN f->>'review_state'='confirmed' THEN f->'source_page' ELSE 'null'::JSONB END,'proposals','[]'::JSONB) ORDER BY ordinal)
    INTO fields FROM jsonb_array_elements(frozen->'fields') WITH ORDINALITY AS f(f,ordinal);
  frozen:=jsonb_build_object('student_case_id',p_student_case_id,'profile',jsonb_build_object('id',p.id,'revision',p.revision),
    'can_initialize',FALSE,'can_review',FALSE,'can_export',TRUE,'fields',fields);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'sha256',v.sha256_hex) ORDER BY v.id),'[]'::JSONB) INTO source_data
    FROM platform.document_versions v WHERE v.id IN(SELECT (f->>'source_document_version_id')::UUID FROM jsonb_array_elements(fields) f
      WHERE f->>'source_document_version_id' IS NOT NULL);
  capsule:=metadata||jsonb_build_object('mode',p_mode,'frozen_profile',frozen);
  a.id:=gen_random_uuid(); a.preparation_id:=gen_random_uuid(); a.organization_id:=org; a.student_case_id:=p_student_case_id;
  a.student_profile_id:=p.id; a.profile_revision:=p.revision; a.source_versions:=source_data;
  a.actor_auth_user_id:=actor.auth_user_id; a.actor_profile_id:=actor.profile_id; a.actor_membership_id:=actor.membership_id;
  a.workspace_revision:=digest; a.input_snapshot_sha256:=platform_private.bw1_input_sha256(capsule);
  a.request_id:=p_request_id; a.request_sha256:=request_hash; a.kind:='university_form'; a.mode:=p_mode;
  a.template_sha256:=metadata->'template'->>'sha256'; a.renderer_version:=metadata->>'renderer_version'; a.mime_type:=metadata->>'source_mime_type';
  a.application_id:=p_application_id; a.catalog_institution_id:=app.catalog_institution_id; a.catalog_source_revision:=metadata->'form'->>'catalog_source_revision';
  a.template_id:=t.id; a.template_version_id:=m.template_version_id; a.inspection_receipt_id:=(metadata->'form'->>'inspection_receipt_id')::UUID;
  a.mapping_id:=m.id; a.mapping_sha256:=m.sha256; a.review_id:=(metadata->'form'->>'review_id')::UUID;
  a.validation_day:=(metadata->'form'->>'validation_day')::DATE;
  a.generated_input_sha256:=platform_private.university_form_export_generated_hash(a);
  failure:=platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,TRUE);
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'document_export_source_unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO platform_private.document_export_input_snapshots(id,frozen_profile,frozen_form) VALUES(a.preparation_id,frozen,metadata);
  INSERT INTO platform_private.document_export_artifacts(id,preparation_id,organization_id,student_case_id,student_profile_id,
    actor_auth_user_id,actor_profile_id,actor_membership_id,profile_revision,source_versions,field_reviews_sha256,workspace_revision,
    input_snapshot_sha256,request_id,request_sha256,kind,mode,template_sha256,renderer_version,mime_type,application_id,catalog_institution_id,
    catalog_source_revision,template_id,template_version_id,inspection_receipt_id,mapping_id,mapping_sha256,review_id,validation_day,generated_input_sha256)
  VALUES(a.id,a.preparation_id,a.organization_id,a.student_case_id,a.student_profile_id,a.actor_auth_user_id,a.actor_profile_id,a.actor_membership_id,
    a.profile_revision,a.source_versions,a.field_reviews_sha256,a.workspace_revision,a.input_snapshot_sha256,a.request_id,a.request_sha256,a.kind,a.mode,
    a.template_sha256,a.renderer_version,a.mime_type,a.application_id,a.catalog_institution_id,a.catalog_source_revision,a.template_id,a.template_version_id,
    a.inspection_receipt_id,a.mapping_id,a.mapping_sha256,a.review_id,a.validation_day,a.generated_input_sha256) RETURNING * INTO a;
  PERFORM platform_private.record_document_export_event(a,'prepared',gen_random_uuid(),request_hash,jsonb_build_object('state','pending'));
  RETURN jsonb_build_object('schema_version',1,'preparation_id',a.preparation_id,
    'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id),'frozen_form',capsule);
END $$;

CREATE OR REPLACE FUNCTION platform.begin_document_export(p_preparation_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; artifact_id UUID; failure TEXT; result JSONB; source JSONB;
BEGIN
  PERFORM platform_private.require_document_export_service();
  SELECT id INTO artifact_id FROM platform_private.document_export_artifacts WHERE preparation_id=p_preparation_id;
  a:=platform_private.lock_document_export(artifact_id);
  IF p_actor_auth_user_id IS DISTINCT FROM a.actor_auth_user_id OR p_actor_membership_id IS DISTINCT FROM a.actor_membership_id THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF a.begun_at IS NOT NULL OR a.state<>'pending' THEN
    result:=jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),'created',FALSE,'claim_token',NULL);
  ELSE
    failure:=platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,TRUE);
    IF failure IS NOT NULL THEN
      UPDATE platform_private.document_export_artifacts SET state='failed',failure_code=failure WHERE id=a.id RETURNING * INTO a;
      PERFORM platform_private.record_document_export_event(a,'failed',gen_random_uuid(),a.request_sha256,jsonb_build_object('failure_code',failure));
      result:=jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),'created',FALSE,'claim_token',NULL);
    ELSE
      UPDATE platform_private.document_export_artifacts SET begun_at=statement_timestamp(),
        lease_expires_at=statement_timestamp()+INTERVAL '10 minutes',claim_token=gen_random_uuid() WHERE id=a.id RETURNING * INTO a;
      PERFORM platform_private.record_document_export_event(a,'begun',gen_random_uuid(),a.request_sha256,jsonb_build_object('state',a.state));
      result:=jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),'created',TRUE,'claim_token',a.claim_token);
      IF a.kind='university_form' THEN
        SELECT jsonb_build_object('bucket_id',v.bucket_id,'object_name',v.object_name,'mime_type',v.mime_type,'sha256',v.sha256,
          'byte_size',v.byte_size,'inspection_receipt_id',i.id,'manifest_sha256',i.manifest_sha256,'expires_at',a.lease_expires_at) INTO source
        FROM platform_private.university_form_template_versions v JOIN platform_private.university_form_inspection_receipts i ON i.template_version_id=v.id
        WHERE v.id=a.template_version_id AND i.id=a.inspection_receipt_id;
      END IF;
    END IF;
  END IF;
  RETURN result||CASE WHEN a.kind='university_form' THEN jsonb_build_object('template_source',source) ELSE '{}'::JSONB END;
END $$;

DROP FUNCTION platform.seal_document_export_output(UUID,UUID,TEXT,INTEGER);
CREATE FUNCTION platform.seal_document_export_output(p_artifact_id UUID,p_claim_token UUID,p_output_sha256 TEXT,p_output_bytes INTEGER,
  p_renderer_proof JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; failure TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_output_sha256 IS NULL OR p_output_sha256 !~ '^[a-f0-9]{64}$' OR p_output_bytes IS NULL OR p_output_bytes NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'document_export_invalid_output' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
  IF (a.kind='student_profile' AND (p_output_bytes>5242880 OR p_renderer_proof IS NOT NULL))
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
      object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||CASE WHEN mime_type='application/pdf' THEN '.pdf' ELSE '.docx' END,
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
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 20971520))
    OR (p_outcome<>'ready' AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL OR p_failure_code IS NULL
      OR p_failure_code NOT IN ('profile_not_ready','source_changed','access_changed','source_unavailable',
        'template_unavailable','integrity_failed','export_failed','storage_unavailable','form_not_ready')))
    OR (p_outcome='unknown' AND p_failure_code<>'storage_unavailable') THEN
    RAISE EXCEPTION 'document_export_invalid_completion' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
  IF a.kind='student_profile' AND (p_observed_bytes>5242880 OR p_failure_code='form_not_ready') THEN
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
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 20971520))
    OR (p_failure_code IS NOT NULL AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL)) THEN
    RAISE EXCEPTION 'document_export_invalid_reconciliation' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id,p_actor_membership_id,p_request_id);
  IF a.kind='student_profile' AND p_observed_bytes>5242880 THEN
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

CREATE OR REPLACE FUNCTION platform.grant_document_export_download(p_artifact_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; actor RECORD; g platform_private.document_export_download_grants;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=a.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(a.id,actor.membership_id,p_request_id);
  IF a.state<>'ready' OR platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,FALSE) IS NOT NULL THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF g.artifact_id<>a.id OR g.actor_auth_user_id<>actor.auth_user_id OR g.actor_membership_id<>actor.membership_id THEN
      RAISE EXCEPTION 'document_export_request_conflict' USING ERRCODE='23505'; END IF;
  ELSE
    INSERT INTO platform_private.document_export_download_grants(artifact_id,request_id,organization_id,actor_auth_user_id,actor_membership_id,actor_profile_id)
      VALUES(a.id,p_request_id,a.organization_id,actor.auth_user_id,actor.membership_id,actor.profile_id) RETURNING * INTO g;
  END IF;
  RETURN jsonb_build_object('grant_id',g.id,'artifact_id',g.artifact_id,'expires_at',g.expires_at,'consumed',g.consumed_at IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION platform.complete_document_export_download(p_grant_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID,
  p_observed_sha256 TEXT,p_observed_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts; g platform_private.document_export_download_grants;
  failure TEXT; fingerprint TEXT; result JSONB;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF (p_observed_sha256 IS NULL)<>(p_observed_bytes IS NULL)
    OR (p_observed_sha256 IS NOT NULL AND (p_observed_sha256 !~ '^[a-f0-9]{64}$' OR p_observed_bytes NOT BETWEEN 1 AND 20971520)) THEN
    RAISE EXCEPTION 'document_export_invalid_download_outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(g.artifact_id,p_actor_membership_id);
  IF a.kind='student_profile' AND p_observed_bytes>5242880 THEN
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
    CASE WHEN a.kind='university_form' THEN 'document_export' ELSE 'student_profile' END,
    CASE WHEN a.kind='university_form' THEN a.id ELSE a.student_profile_id END,
    result||CASE WHEN a.kind='university_form' THEN jsonb_build_object('application_id',a.application_id) ELSE '{}'::JSONB END,
    'Storage readback and live access verified; not confirmation of delivery',g.request_id);
  RETURN result;
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
    CASE WHEN p_artifact.kind='university_form' THEN 'document_export' ELSE 'student_profile' END,
    CASE WHEN p_artifact.kind='university_form' THEN p_artifact.id ELSE p_artifact.student_profile_id END,
    jsonb_build_object('artifact_id',p_artifact.id,'profile_revision',p_artifact.profile_revision,
      'state',p_artifact.state,'mode',p_artifact.mode,'output_sha256',p_artifact.output_sha256,
      'output_bytes',p_artifact.output_bytes,'failure_code',p_artifact.failure_code)
      ||CASE WHEN p_artifact.kind='university_form' THEN jsonb_build_object('application_id',p_artifact.application_id) ELSE '{}'::JSONB END,
    'Persistent artifact outcome; not a delivery or university submission receipt',p_request_id);
END $$;

REVOKE ALL ON FUNCTION
  platform_private.university_form_renderer_proof_valid(JSONB,TEXT),
  platform_private.university_form_export_binding(platform_private.document_export_artifacts),
  platform_private.university_form_export_metadata(UUID,UUID,UUID),
  platform_private.university_form_export_workspace_digest(JSONB,UUID,BIGINT,TEXT),
  platform_private.university_form_export_generated_hash(platform_private.document_export_artifacts),
  platform_private.preserve_document_export_artifact(),
  platform_private.document_export_actor_authorized(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.document_export_live_failure(platform_private.document_export_artifacts,UUID,UUID,BOOLEAN),
  platform_private.document_export_receipt(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.lock_document_export(UUID,UUID,UUID),
  platform_private.record_document_export_event(platform_private.document_export_artifacts,TEXT,UUID,TEXT,JSONB,UUID,UUID),
  platform.staff_document_export_workspace(UUID),platform.staff_document_export_workspace_v2(UUID),
  platform.staff_university_form_export_workspace(UUID,UUID,UUID),platform.prepare_university_form_export(UUID,UUID,UUID,TEXT,TEXT,UUID),
  platform.begin_document_export(UUID,UUID,UUID),platform.seal_document_export_output(UUID,UUID,TEXT,INTEGER,JSONB),
  platform.complete_document_export(UUID,UUID,TEXT,TEXT,TEXT,INTEGER),
  platform.reconcile_document_export(UUID,UUID,UUID,UUID,TEXT,INTEGER,TEXT),platform.grant_document_export_download(UUID,UUID),
  platform.complete_document_export_download(UUID,UUID,UUID,TEXT,INTEGER)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_document_export_workspace(UUID),platform.staff_document_export_workspace_v2(UUID),
  platform.staff_university_form_export_workspace(UUID,UUID,UUID),platform.prepare_university_form_export(UUID,UUID,UUID,TEXT,TEXT,UUID),
  platform.grant_document_export_download(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.begin_document_export(UUID,UUID,UUID),platform.seal_document_export_output(UUID,UUID,TEXT,INTEGER,JSONB),
  platform.complete_document_export(UUID,UUID,TEXT,TEXT,TEXT,INTEGER),platform.reconcile_document_export(UUID,UUID,UUID,UUID,TEXT,INTEGER,TEXT),
  platform.complete_document_export_download(UUID,UUID,UUID,TEXT,INTEGER) TO service_role;

COMMENT ON COLUMN platform_private.document_export_input_snapshots.frozen_form IS
  'Immutable minimal166 template/mapping/review metadata. Compose with session-only frozen_profile and artifact.mode; no rich DOCX text.';
COMMENT ON COLUMN platform_private.document_export_artifacts.renderer_proof IS
  'NULL until trusted seal; exact Docker engine-native image ID, release revision and PDF embedded font hash. Not template inspection receipt or config digest.';
COMMENT ON COLUMN platform_private.document_export_artifacts.generated_input_sha256 IS
  'Form-only compact canonical package projection hash; distinct from input_snapshot_sha256 PostgreSQL JSONB text hashing.';
NOTIFY pgrst,'reload schema';
COMMIT;
