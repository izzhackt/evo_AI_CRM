-- B3f: contextual saved drafts and explicit single-document submissions.
-- Contract: docs/platform/b3f-program-document-submission-contract.md.
-- Canonical Storage/versions/scans remain shared; legacy current/review is never
-- a program submission. No backfill, Storage write or business initialization.
BEGIN;

CREATE TABLE platform_private.application_document_upload_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL, student_case_id UUID NOT NULL, application_id UUID NOT NULL,
  requirements_revision_id UUID NOT NULL, requirement_item_id UUID NOT NULL
    REFERENCES platform_private.application_requirement_items(id), document_slot_id UUID NOT NULL,
  uploader_profile_id UUID NOT NULL REFERENCES platform.profiles(id), uploader_membership_id UUID NOT NULL,
  uploader_auth_user_id UUID NOT NULL, intent JSONB NOT NULL, intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[0-9a-f]{64}$'),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(organization_id,id,student_case_id,document_slot_id),
  FOREIGN KEY(organization_id,requirements_revision_id,student_case_id,application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,document_slot_id,student_case_id) REFERENCES platform.document_slots(organization_id,id,student_case_id),
  FOREIGN KEY(organization_id,uploader_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
ALTER TABLE platform_private.document_upload_reservations ADD COLUMN application_upload_context_id UUID;
ALTER TABLE platform_private.document_upload_reservations ADD CONSTRAINT document_upload_reservations_application_context_fkey
  FOREIGN KEY(organization_id,application_upload_context_id,student_case_id,document_slot_id)
  REFERENCES platform_private.application_document_upload_contexts(organization_id,id,student_case_id,document_slot_id);
CREATE UNIQUE INDEX document_upload_reservations_application_context_key
  ON platform_private.document_upload_reservations(application_upload_context_id) WHERE application_upload_context_id IS NOT NULL;

CREATE TABLE platform_private.application_document_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,student_case_id UUID NOT NULL,application_id UUID NOT NULL,
  requirements_revision_id UUID NOT NULL,requirement_item_id UUID NOT NULL REFERENCES platform_private.application_requirement_items(id),
  document_slot_id UUID NOT NULL,document_version_id UUID NOT NULL, upload_context_id UUID REFERENCES platform_private.application_document_upload_contexts(id),
  submitted_by_membership_id UUID NOT NULL, submitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  intent JSONB NOT NULL,receipt JSONB NOT NULL,
  UNIQUE(organization_id,application_id,requirements_revision_id,requirement_item_id,document_version_id),
  UNIQUE(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,requirements_revision_id,student_case_id,application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,document_version_id,student_case_id,document_slot_id)
    REFERENCES platform.document_versions(organization_id,id,student_case_id,document_slot_id),
  FOREIGN KEY(organization_id,submitted_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE TABLE platform_private.application_document_submission_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,student_case_id UUID NOT NULL,application_id UUID NOT NULL,submission_id UUID NOT NULL,
  reviewer_membership_id UUID NOT NULL,decision platform.document_review_decision NOT NULL,reason TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),intent JSONB NOT NULL,receipt JSONB NOT NULL,
  CHECK((decision='approved' AND reason IS NULL) OR
    (decision IN ('correction_required','rejected') AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 2000)),
  FOREIGN KEY(organization_id,submission_id,student_case_id,application_id)
    REFERENCES platform_private.application_document_submissions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,reviewer_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE TABLE platform_private.application_document_download_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_id UUID NOT NULL UNIQUE,
  download_grant_id UUID NOT NULL UNIQUE REFERENCES platform_private.document_download_grants(id),
  organization_id UUID NOT NULL,student_case_id UUID NOT NULL,application_id UUID NOT NULL,
  requirements_revision_id UUID NOT NULL,requirement_item_id UUID NOT NULL REFERENCES platform_private.application_requirement_items(id),
  document_slot_id UUID NOT NULL,document_version_id UUID NOT NULL,
  upload_context_id UUID REFERENCES platform_private.application_document_upload_contexts(id),
  submission_id UUID REFERENCES platform_private.application_document_submissions(id),
  actor_auth_user_id UUID NOT NULL,intent JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY(organization_id,requirements_revision_id,student_case_id,application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,document_version_id,student_case_id,document_slot_id)
    REFERENCES platform.document_versions(organization_id,id,student_case_id,document_slot_id)
);
CREATE INDEX application_document_upload_item_idx ON platform_private.application_document_upload_contexts(organization_id,application_id,requirement_item_id,admitted_at DESC,id DESC);
CREATE INDEX application_document_submission_item_idx ON platform_private.application_document_submissions(organization_id,application_id,requirement_item_id,submitted_at DESC,id DESC);
CREATE INDEX application_document_review_submission_idx ON platform_private.application_document_submission_reviews(submission_id,reviewed_at DESC,id DESC);

DO $ddl$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['application_document_upload_contexts','application_document_submissions','application_document_submission_reviews','application_document_download_contexts'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('REVOKE ALL ON platform_private.%I FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',n);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON platform_private.%I FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation()',n||'_immutable',n);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON platform_private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change()',n||'_no_truncate',n);
  END LOOP;
END $ddl$;

CREATE FUNCTION platform_private.application_document_actor(p_case UUID,p_permission TEXT)
RETURNS TABLE(organization_id UUID,profile_id UUID,membership_id UUID,auth_user_id UUID,platform_role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR p_case IS NULL OR p_permission NOT IN ('document.read.full','document.upload','document.review') THEN
    RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
  IF a.platform_role='student' THEN
    IF p_permission='document.review' THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM platform_private.application_requirements_actor(a.organization_id,p_case,TRUE,FALSE);
    IF p_permission='document.upload' AND NOT private.platform_has_permission(a.organization_id,'document.upload') THEN
      RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
  ELSIF NOT COALESCE(platform_private.staff_can_access_for_actor(a.organization_id,p_permission,'student_case',p_case),FALSE) THEN
    RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.organization_id,a.profile_id,a.membership_id,a.auth_user_id,a.platform_role::TEXT;
END $$;

-- Every ordinary write serializes with the existing organization/case/slot
-- writers; authority is re-resolved after all locks, never from browser fields.
CREATE FUNCTION platform_private.application_document_lock(p_case UUID,p_application UUID,p_slot UUID,p_request UUID,p_permission TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  IF NOT platform_private.requirements_editor_uuid(to_jsonb(p_request)) OR p_application IS NULL THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
  PERFORM platform_private.lock_p2h_request(p_request);
  SELECT * INTO a FROM platform_private.application_document_actor(p_case,p_permission);
  PERFORM 1 FROM platform.organizations WHERE id=a.organization_id FOR UPDATE;
  PERFORM 1 FROM platform.profiles WHERE id=a.profile_id FOR UPDATE;
  PERFORM 1 FROM platform.organization_memberships WHERE organization_id=a.organization_id AND id=a.membership_id FOR UPDATE;
  PERFORM 1 FROM platform.student_cases WHERE organization_id=a.organization_id AND id=p_case FOR UPDATE;
  PERFORM 1 FROM platform.university_applications WHERE organization_id=a.organization_id AND student_case_id=p_case AND id=p_application FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM platform_private.catalog_preparation_bindings WHERE organization_id=a.organization_id AND student_case_id=p_case AND application_id=p_application) THEN
    RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
  IF p_slot IS NOT NULL THEN
    PERFORM 1 FROM platform.document_slots WHERE organization_id=a.organization_id AND student_case_id=p_case AND id=p_slot FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM 1 FROM platform_private.application_document_actor(p_case,p_permission);
END $$;

CREATE FUNCTION platform_private.application_document_item(p_org UUID,p_case UUID,p_application UUID,p_item UUID,p_current BOOLEAN)
RETURNS platform_private.application_requirement_items LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i platform_private.application_requirement_items%ROWTYPE; s platform.document_slots%ROWTYPE; latest UUID;
BEGIN
  SELECT * INTO i FROM platform_private.application_requirement_items WHERE organization_id=p_org AND student_case_id=p_case AND application_id=p_application AND id=p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
  IF p_current THEN
    SELECT id INTO latest FROM platform_private.application_requirement_revisions WHERE organization_id=p_org AND student_case_id=p_case AND application_id=p_application ORDER BY revision_version DESC LIMIT 1;
    IF i.revision_id<>latest THEN RAISE EXCEPTION 'application_document_stale_requirements' USING ERRCODE='PT409'; END IF;
    SELECT * INTO s FROM platform.document_slots WHERE organization_id=p_org AND student_case_id=p_case AND id=i.document_slot_id;
    IF s.id IS NULL OR s.removed_at IS NOT NULL OR NOT platform_private.requirements_editor_item_matches(s,i)
      OR NOT EXISTS(SELECT 1 FROM platform.document_slot_case_links WHERE organization_id=p_org AND document_slot_id=s.id AND university_application_id=p_application) THEN
      RAISE EXCEPTION 'application_document_mapping_changed' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN i;
END $$;

CREATE FUNCTION platform_private.application_document_lineage(p_org UUID,p_case UUID,p_application UUID,p_item UUID)
RETURNS TABLE(item_id UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i platform_private.application_requirement_items%ROWTYPE; r platform_private.application_requirement_revisions%ROWTYPE; previous_version BIGINT;
BEGIN
  i:=platform_private.application_document_item(p_org,p_case,p_application,p_item,FALSE);
  LOOP
    SELECT * INTO STRICT r FROM platform_private.application_requirement_revisions WHERE id=i.revision_id AND organization_id=p_org AND student_case_id=p_case AND application_id=p_application;
    IF previous_version IS NOT NULL AND (r.revision_version>=previous_version OR r.id IS DISTINCT FROM
      (SELECT previous_revision_id FROM platform_private.application_requirement_revisions WHERE organization_id=p_org AND application_id=p_application AND revision_version=previous_version)) THEN
      RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
    item_id:=i.id; RETURN NEXT;
    EXIT WHEN i.predecessor_item_id IS NULL;
    previous_version:=r.revision_version;
    SELECT * INTO i FROM platform_private.application_requirement_items WHERE id=i.predecessor_item_id AND organization_id=p_org AND student_case_id=p_case AND application_id=p_application;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION platform_private.application_document_file(p_org UUID,p_version UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v platform.document_versions%ROWTYPE; f platform_private.document_upload_finalizations%ROWTYPE; reasons TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO v FROM platform.document_versions WHERE organization_id=p_org AND id=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
  SELECT * INTO f FROM platform_private.document_upload_finalizations WHERE organization_id=p_org AND document_version_id=v.id;
  IF f.id IS NULL THEN reasons:=array_append(reasons,'upload_not_finalized'); END IF;
  IF v.integrity_status='pending' THEN reasons:=array_append(reasons,'integrity_pending'); ELSIF v.integrity_status='failed' THEN reasons:=array_append(reasons,'integrity_failed'); END IF;
  IF v.malware_status='pending' THEN reasons:=array_append(reasons,'malware_pending'); ELSIF v.malware_status='infected' THEN reasons:=array_append(reasons,'malware_infected'); ELSIF v.malware_status='error' THEN reasons:=array_append(reasons,'malware_error'); END IF;
  IF f.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage.objects o JOIN platform_private.document_storage_bindings b ON b.bucket_id=o.bucket_id AND b.object_name=o.name WHERE b.organization_id=p_org AND b.document_version_id=v.id AND o.created_at=f.object_created_at) THEN reasons:=array_append(reasons,'storage_object_unavailable'); END IF;
  IF v.integrity_status='verified' AND v.malware_status='clean' AND NOT platform_private.student_document_has_scan_proof(p_org,v.id) THEN reasons:=array_append(reasons,'scan_proof_unavailable'); END IF;
  RETURN jsonb_build_object('documentVersionId',v.id,'versionNo',v.version_no::TEXT,'originalFilename',v.original_filename,'declaredMimeType',v.declared_mime_type,'byteSize',v.byte_size::TEXT,'sha256Hex',v.sha256_hex,'finalizedAt',f.finalized_at,'technicalAvailability',CASE WHEN cardinality(reasons)=0 THEN 'available' ELSE 'unavailable' END,'unavailableReasons',to_jsonb(reasons));
END $$;

CREATE FUNCTION platform_private.application_document_upload_summary(p_context UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('uploadContextId',c.id,'requirementsRevisionId',c.requirements_revision_id,'requirementItemId',c.requirement_item_id,'documentSlotId',c.document_slot_id,'admittedAt',c.admitted_at,'file',platform_private.application_document_file(c.organization_id,r.document_version_id))
 FROM platform_private.application_document_upload_contexts c JOIN platform_private.document_upload_reservations r ON r.application_upload_context_id=c.id
 JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id WHERE c.id=p_context
$$;
CREATE FUNCTION platform_private.application_document_submission_summary(p_submission UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('submissionId',s.id,'requirementsRevisionId',s.requirements_revision_id,'requirementItemId',s.requirement_item_id,'documentSlotId',s.document_slot_id,'submittedAt',s.submitted_at,'file',platform_private.application_document_file(s.organization_id,s.document_version_id),'review',
 (SELECT jsonb_build_object('reviewId',r.id,'decision',r.decision,'reason',r.reason,'reviewedAt',r.reviewed_at) FROM platform_private.application_document_submission_reviews r WHERE r.submission_id=s.id ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1))
 FROM platform_private.application_document_submissions s WHERE s.id=p_submission
$$;
CREATE FUNCTION platform_private.application_document_saved_receipt(p_context UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('protocolVersion',1,'requestId',c.request_id,'uploadContextId',c.id,'studentCaseId',c.student_case_id,'applicationId',c.application_id,'requirementsRevisionId',c.requirements_revision_id,'requirementItemId',c.requirement_item_id,'documentSlotId',c.document_slot_id,'documentVersionId',v.id,'versionNo',v.version_no::TEXT,'file',c.intent->'file','finalizedAt',f.finalized_at,'publishedToLegacySlot',FALSE)
 FROM platform_private.application_document_upload_contexts c JOIN platform_private.document_upload_reservations r ON r.application_upload_context_id=c.id JOIN platform.document_versions v ON v.id=r.document_version_id AND v.organization_id=c.organization_id JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id WHERE c.id=p_context
$$;

-- A candidate has an established same-case origin, not merely a guessed UUID.
CREATE FUNCTION platform_private.application_document_version_origin(p_org UUID,p_case UUID,p_slot UUID,p_version UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.document_versions v JOIN platform_private.document_upload_reservations r ON r.organization_id=v.organization_id AND r.document_version_id=v.id JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id
 WHERE v.organization_id=p_org AND v.student_case_id=p_case AND v.document_slot_id=p_slot AND v.id=p_version AND
 (r.application_upload_context_id IS NULL OR EXISTS(SELECT 1 FROM platform_private.application_document_upload_contexts c WHERE c.id=r.application_upload_context_id AND c.organization_id=p_org AND c.student_case_id=p_case AND c.document_slot_id=p_slot)))
$$;
CREATE FUNCTION platform_private.application_document_selection(p_org UUID,p_case UUID,p_application UUID,p_item UUID,p_selection JSONB,p_current BOOLEAN)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i platform_private.application_requirement_items%ROWTYPE; v UUID; c platform_private.application_document_upload_contexts%ROWTYPE; s platform_private.application_document_submissions%ROWTYPE;
BEGIN
 i:=platform_private.application_document_item(p_org,p_case,p_application,p_item,p_current);
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR NOT platform_private.requirements_editor_uuid(p_selection->'documentVersionId') THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 v:=(p_selection->>'documentVersionId')::UUID;
 IF p_selection->>'kind'='existing_version' AND platform_private.requirements_editor_keys(p_selection,ARRAY['kind','documentVersionId']) THEN
   IF NOT platform_private.application_document_version_origin(p_org,p_case,i.document_slot_id,v) THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 ELSIF p_selection->>'kind'='program_upload' AND platform_private.requirements_editor_keys(p_selection,ARRAY['kind','uploadContextId','documentVersionId']) AND platform_private.requirements_editor_uuid(p_selection->'uploadContextId') THEN
   SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE id=(p_selection->>'uploadContextId')::UUID AND organization_id=p_org AND student_case_id=p_case AND application_id=p_application AND requirement_item_id=p_item AND document_slot_id=i.document_slot_id;
   IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations r JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id WHERE r.application_upload_context_id=c.id AND r.document_version_id=v) THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 ELSIF NOT p_current AND p_selection->>'kind'='submission' AND platform_private.requirements_editor_keys(p_selection,ARRAY['kind','submissionId','documentVersionId']) AND platform_private.requirements_editor_uuid(p_selection->'submissionId') THEN
   SELECT * INTO s FROM platform_private.application_document_submissions WHERE id=(p_selection->>'submissionId')::UUID AND organization_id=p_org AND student_case_id=p_case AND application_id=p_application AND requirement_item_id=p_item AND document_version_id=v;
   IF s.id IS NULL THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 RETURN v;
END $$;

CREATE FUNCTION platform_private.application_document_events(p_org UUID,p_case UUID,p_application UUID,p_item UUID)
RETURNS TABLE(id UUID,created_at TIMESTAMPTZ,event JSONB) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH permitted AS (SELECT i.* FROM platform_private.application_requirement_items i WHERE i.organization_id=p_org AND i.student_case_id=p_case AND i.application_id=p_application AND (p_item IS NULL OR i.id IN (SELECT item_id FROM platform_private.application_document_lineage(p_org,p_case,p_application,p_item))))
 SELECT c.id,f.finalized_at,jsonb_build_object('id',c.id,'kind','upload','createdAt',f.finalized_at,'requirementsRevisionId',i.revision_id,'requirementItemId',i.id,'definition',platform_private.requirements_editor_definition(i),'materialSnapshot',i.material_snapshot,'upload',platform_private.application_document_upload_summary(c.id),'submission',NULL)
 FROM permitted i JOIN platform_private.application_document_upload_contexts c ON c.requirement_item_id=i.id JOIN platform_private.document_upload_reservations r ON r.application_upload_context_id=c.id JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id
 UNION ALL
 SELECT s.id,s.submitted_at,jsonb_build_object('id',s.id,'kind','submission','createdAt',s.submitted_at,'requirementsRevisionId',i.revision_id,'requirementItemId',i.id,'definition',platform_private.requirements_editor_definition(i),'materialSnapshot',i.material_snapshot,'upload',NULL,'submission',platform_private.application_document_submission_summary(s.id))
 FROM permitted i JOIN platform_private.application_document_submissions s ON s.requirement_item_id=i.id
$$;
CREATE FUNCTION platform.application_document_history_v1(p_student_case_id UUID,p_application_id UUID,p_requirement_item_id UUID DEFAULT NULL,p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; row RECORD; result JSONB:='[]'; next_cursor JSONB; n INTEGER:=0; cut TIMESTAMPTZ; cut_id UUID;
BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.read.full');
 IF NOT EXISTS(SELECT 1 FROM platform_private.catalog_preparation_bindings WHERE organization_id=a.organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id) THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_cursor IS NOT NULL AND (NOT platform_private.requirements_editor_keys(p_cursor,ARRAY['createdAt','id']) OR NOT platform_private.requirements_editor_uuid(p_cursor->'id') OR jsonb_typeof(p_cursor->'createdAt') IS DISTINCT FROM 'string')) THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 IF p_cursor IS NOT NULL THEN cut:=(p_cursor->>'createdAt')::TIMESTAMPTZ; cut_id:=(p_cursor->>'id')::UUID; END IF;
 FOR row IN SELECT * FROM platform_private.application_document_events(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id) e WHERE cut IS NULL OR (e.created_at,e.id)<(cut,cut_id) ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit+1 LOOP
   n:=n+1; IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementItemId',p_requirement_item_id,'events',result,'nextCursor',next_cursor); END IF;
   result:=result||jsonb_build_array(row.event); next_cursor:=jsonb_build_object('createdAt',row.created_at,'id',row.id);
 END LOOP;
 RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementItemId',p_requirement_item_id,'events',result,'nextCursor',NULL);
END $$;
CREATE FUNCTION platform.application_document_reusable_versions_v1(p_student_case_id UUID,p_application_id UUID,p_requirement_item_id UUID,p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; i platform_private.application_requirement_items%ROWTYPE; v RECORD; result JSONB:='[]'; next_cursor JSONB; n INTEGER:=0; cut BIGINT; cut_id UUID;
BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.read.full');
 i:=platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id,TRUE);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_cursor IS NOT NULL AND (NOT platform_private.requirements_editor_keys(p_cursor,ARRAY['versionNo','documentVersionId']) OR NOT platform_private.requirements_editor_version(p_cursor->'versionNo') OR NOT platform_private.requirements_editor_uuid(p_cursor->'documentVersionId'))) THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 IF p_cursor IS NOT NULL THEN cut:=(p_cursor->>'versionNo')::BIGINT; cut_id:=(p_cursor->>'documentVersionId')::UUID; END IF;
 FOR v IN SELECT x.id,x.version_no FROM platform.document_versions x WHERE x.organization_id=a.organization_id AND x.student_case_id=p_student_case_id AND x.document_slot_id=i.document_slot_id AND (cut IS NULL OR (x.version_no,x.id)<(cut,cut_id)) AND platform_private.application_document_version_origin(a.organization_id,p_student_case_id,i.document_slot_id,x.id) ORDER BY x.version_no DESC,x.id DESC LIMIT p_limit+1 LOOP
   n:=n+1; IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementItemId',i.id,'versions',result,'nextCursor',next_cursor); END IF;
   result:=result||jsonb_build_array(jsonb_build_object('selection',jsonb_build_object('kind','existing_version','documentVersionId',v.id),'file',platform_private.application_document_file(a.organization_id,v.id)));
   next_cursor:=jsonb_build_object('versionNo',v.version_no::TEXT,'documentVersionId',v.id);
 END LOOP;
 RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementItemId',i.id,'versions',result,'nextCursor',NULL);
END $$;
CREATE FUNCTION platform_private.application_documents_view(p_case UUID,p_application UUID,p_student BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; definition JSONB; i platform_private.application_requirement_items%ROWTYPE; item_json JSONB; items JSONB:='[]'; draft UUID; submission UUID; previous JSONB; reusable JSONB; allowed BOOLEAN; upload_allowed BOOLEAN:=FALSE;
BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_case,'document.read.full');
 IF p_student IS DISTINCT FROM (a.platform_role IS NOT DISTINCT FROM 'student') THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 definition:=platform_private.application_requirements_v2_view(a.organization_id,p_case,p_application,p_student,NULL);
 BEGIN PERFORM 1 FROM platform_private.application_document_actor(p_case,'document.upload'); upload_allowed:=TRUE; EXCEPTION WHEN insufficient_privilege THEN upload_allowed:=FALSE; END;
 FOR item_json IN SELECT value FROM jsonb_array_elements(definition->'items') LOOP
   SELECT * INTO STRICT i FROM platform_private.application_requirement_items WHERE id=(item_json->>'requirementItemId')::UUID AND organization_id=a.organization_id AND student_case_id=p_case AND application_id=p_application;
   allowed:=TRUE; reusable:=jsonb_build_object('versions','[]'::JSONB,'nextCursor',NULL);
   BEGIN
     PERFORM platform_private.application_document_item(a.organization_id,p_case,p_application,i.id,TRUE);
     reusable:=platform.application_document_reusable_versions_v1(p_case,p_application,i.id,NULL,20);
   EXCEPTION WHEN SQLSTATE 'PT409' THEN allowed:=FALSE; END;
   SELECT c.id INTO draft FROM platform_private.application_document_upload_contexts c JOIN platform_private.document_upload_reservations r ON r.application_upload_context_id=c.id JOIN platform_private.document_upload_finalizations f ON f.upload_reservation_id=r.id WHERE c.requirement_item_id=i.id ORDER BY f.finalized_at DESC,c.id DESC LIMIT 1;
   SELECT s.id INTO submission FROM platform_private.application_document_submissions s WHERE s.requirement_item_id=i.id ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1;
   SELECT e.event INTO previous FROM platform_private.application_document_events(a.organization_id,p_case,p_application,i.id) e WHERE e.event->>'requirementItemId'<>i.id::TEXT ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
   items:=items||jsonb_build_array(jsonb_build_object('requirementItemId',i.id,'documentSlotId',i.document_slot_id,'savedDraft',platform_private.application_document_upload_summary(draft),'submission',platform_private.application_document_submission_summary(submission),'previousEvidence',previous,'reusableVersions',reusable->'versions','reusableVersionsNextCursor',reusable->'nextCursor','canUpload',allowed AND upload_allowed,'canSubmit',allowed AND upload_allowed));
 END LOOP;
 RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_case,'applicationId',p_application,'requirements',definition,'items',items);
END $$;
CREATE FUNCTION platform.student_application_documents_v1(p_student_case_id UUID,p_application_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT platform_private.application_documents_view(p_student_case_id,p_application_id,TRUE) $$;
CREATE FUNCTION platform.staff_application_documents_v1(p_student_case_id UUID,p_application_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT platform_private.application_documents_view(p_student_case_id,p_application_id,FALSE) $$;

CREATE FUNCTION platform_private.application_document_audit(p_request UUID,p_org UUID,p_profile UUID,p_action TEXT,p_entity UUID,p_intent JSONB,p_receipt JSONB)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_org,'user',p_profile,'profile:'||p_profile::TEXT,p_action,'university_application',p_entity,NULL,jsonb_build_object('intent',p_intent,'receipt',p_receipt),'Explicit program document action',p_request);
END $$;
CREATE FUNCTION platform_private.application_document_replay(p_request UUID,p_org UUID,p_action TEXT,p_application UUID,p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e platform.audit_events%ROWTYPE;
BEGIN
 SELECT * INTO e FROM platform.audit_events WHERE request_id=p_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF e.organization_id IS DISTINCT FROM p_org OR e.action IS DISTINCT FROM p_action OR e.resource_id IS DISTINCT FROM p_application OR e.after_state->'intent' IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 RETURN e.after_state->'receipt';
END $$;
CREATE FUNCTION platform.submit_application_document_v1(p_student_case_id UUID,p_application_id UUID,p_requirements_revision_id UUID,p_requirement_item_id UUID,p_selection JSONB,p_expected_previous_submission_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;i platform_private.application_requirement_items%ROWTYPE;v UUID;version_no BIGINT;latest UUID;existing platform_private.application_document_submissions%ROWTYPE;intent JSONB;receipt JSONB;new_id UUID:=gen_random_uuid();at TIMESTAMPTZ:=statement_timestamp();origin UUID;
BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.upload');
 i:=platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id,FALSE);
 PERFORM platform_private.application_document_lock(p_student_case_id,p_application_id,i.document_slot_id,p_request_id,'document.upload');
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.upload');
 intent:=jsonb_build_object('operation','application_document_submit_v1','studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementsRevisionId',p_requirements_revision_id,'requirementItemId',p_requirement_item_id,'selection',p_selection,'expectedPreviousSubmissionId',p_expected_previous_submission_id,'actorMembershipId',a.membership_id);
 receipt:=platform_private.application_document_replay(p_request_id,a.organization_id,'application.document.submit',p_application_id,intent);
 IF receipt IS NOT NULL THEN RETURN receipt; END IF;
 i:=platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id,TRUE);
 IF i.revision_id IS DISTINCT FROM p_requirements_revision_id THEN RAISE EXCEPTION 'application_document_stale_requirements' USING ERRCODE='PT409'; END IF;
 v:=platform_private.application_document_selection(a.organization_id,p_student_case_id,p_application_id,i.id,p_selection,TRUE);
 SELECT dv.version_no INTO version_no FROM platform.document_versions dv WHERE dv.organization_id=a.organization_id AND dv.id=v FOR UPDATE;
 IF platform_private.application_document_file(a.organization_id,v)->>'technicalAvailability'<>'available' THEN RAISE EXCEPTION 'application_document_file_unavailable' USING ERRCODE='PT409'; END IF;
 SELECT * INTO existing FROM platform_private.application_document_submissions WHERE organization_id=a.organization_id AND application_id=p_application_id AND requirements_revision_id=i.revision_id AND requirement_item_id=i.id AND document_version_id=v;
 IF existing.id IS NOT NULL THEN
   receipt:=existing.receipt||jsonb_build_object('requestId',p_request_id,'reused',TRUE);
 ELSE
   SELECT s.id INTO latest FROM platform_private.application_document_submissions s WHERE s.requirement_item_id=i.id ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1;
   IF latest IS DISTINCT FROM p_expected_previous_submission_id THEN RAISE EXCEPTION 'application_document_previous_submission_changed' USING ERRCODE='PT409'; END IF;
   IF p_selection->>'kind'='program_upload' THEN origin:=(p_selection->>'uploadContextId')::UUID; END IF;
   receipt:=jsonb_build_object('protocolVersion',1,'requestId',p_request_id,'submissionId',new_id,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementsRevisionId',i.revision_id,'requirementItemId',i.id,'documentSlotId',i.document_slot_id,'documentVersionId',v,'versionNo',version_no::TEXT,'submittedAt',at,'reused',FALSE);
   INSERT INTO platform_private.application_document_submissions(id,request_id,organization_id,student_case_id,application_id,requirements_revision_id,requirement_item_id,document_slot_id,document_version_id,upload_context_id,submitted_by_membership_id,submitted_at,intent,receipt)
   VALUES(new_id,p_request_id,a.organization_id,p_student_case_id,p_application_id,i.revision_id,i.id,i.document_slot_id,v,origin,a.membership_id,at,intent,receipt);
 END IF;
 PERFORM platform_private.application_document_audit(p_request_id,a.organization_id,a.profile_id,'application.document.submit',p_application_id,intent,receipt);
 RETURN receipt;
END $$;
CREATE FUNCTION platform.review_application_document_submission_v1(p_submission_id UUID,p_expected_previous_review_id UUID,p_decision platform.document_review_decision,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s platform_private.application_document_submissions%ROWTYPE;a RECORD;intent JSONB;receipt JSONB;latest UUID;new_id UUID:=gen_random_uuid();at TIMESTAMPTZ:=statement_timestamp();
BEGIN
 SELECT * INTO s FROM platform_private.application_document_submissions WHERE id=p_submission_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.application_document_lock(s.student_case_id,s.application_id,s.document_slot_id,p_request_id,'document.review');
 SELECT * INTO a FROM platform_private.application_document_actor(s.student_case_id,'document.review');
 IF a.organization_id<>s.organization_id THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 intent:=jsonb_build_object('operation','application_document_review_v1','submissionId',p_submission_id,'expectedPreviousReviewId',p_expected_previous_review_id,'decision',p_decision,'reason',p_reason,'actorMembershipId',a.membership_id);
 receipt:=platform_private.application_document_replay(p_request_id,a.organization_id,'application.document.review',s.application_id,intent);
 IF receipt IS NOT NULL THEN RETURN receipt; END IF;
 IF p_decision IS NULL OR (p_decision='approved' AND p_reason IS NOT NULL) OR (p_decision<>'approved' AND (p_reason IS NULL OR length(p_reason)>2000 OR length(platform_private.requirements_editor_trim(p_reason))=0 OR translate(p_reason,E'\t\r\n','') ~ '[[:cntrl:]]' OR translate(p_reason,E'\t\r\n','') ~ U&'[\0001-\001F\007F-\009F]')) THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform.document_versions WHERE organization_id=s.organization_id AND id=s.document_version_id FOR UPDATE;
 PERFORM 1 FROM platform_private.application_document_submissions WHERE id=s.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM platform.document_slots WHERE id=s.document_slot_id AND removed_at IS NOT NULL) OR platform_private.application_document_file(a.organization_id,s.document_version_id)->>'technicalAvailability'<>'available' THEN RAISE EXCEPTION 'application_document_file_unavailable' USING ERRCODE='PT409'; END IF;
 SELECT r.id INTO latest FROM platform_private.application_document_submission_reviews r WHERE r.submission_id=s.id ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_expected_previous_review_id THEN RAISE EXCEPTION 'application_document_previous_review_changed' USING ERRCODE='PT409'; END IF;
 receipt:=jsonb_build_object('protocolVersion',1,'requestId',p_request_id,'reviewId',new_id,'submissionId',s.id,'decision',p_decision,'reason',p_reason,'reviewedAt',at);
 INSERT INTO platform_private.application_document_submission_reviews(id,request_id,organization_id,student_case_id,application_id,submission_id,reviewer_membership_id,decision,reason,reviewed_at,intent,receipt)
 VALUES(new_id,p_request_id,s.organization_id,s.student_case_id,s.application_id,s.id,a.membership_id,p_decision,p_reason,at,intent,receipt);
 PERFORM platform_private.application_document_audit(p_request_id,a.organization_id,a.profile_id,'application.document.review',s.application_id,intent,receipt);
 RETURN receipt;
END $$;

CREATE FUNCTION platform_private.application_document_metadata(p_file JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(platform_private.requirements_editor_keys(p_file,ARRAY['originalFilename','declaredMimeType','byteSize','sha256Hex'])
 AND jsonb_typeof(p_file->'originalFilename')='string' AND length(p_file->>'originalFilename') BETWEEN 1 AND 255
 AND octet_length(p_file->>'originalFilename')<=1024 AND p_file->>'originalFilename'=platform_private.requirements_editor_trim(p_file->>'originalFilename')
 AND p_file->>'originalFilename' !~ '[[:cntrl:]/\\]' AND p_file->>'originalFilename' !~ U&'[\0001-\001F\007F-\009F]' AND jsonb_typeof(p_file->'declaredMimeType')='string'
 AND p_file->>'declaredMimeType' IN ('application/pdf','image/jpeg','image/png')
 AND platform_private.requirements_editor_version(p_file->'byteSize') AND (p_file->>'byteSize')::NUMERIC<=26214400
 AND jsonb_typeof(p_file->'sha256Hex')='string' AND p_file->>'sha256Hex' ~ '^[0-9a-f]{64}$',FALSE)
$$;
CREATE FUNCTION platform_private.application_document_admission_result(p_context UUID,p_admission UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('protocolVersion',1,'contextId',c.id,'requestId',c.request_id,'intentSha256',c.intent_sha256,'studentCaseId',c.student_case_id,'applicationId',c.application_id,'requirementsRevisionId',c.requirements_revision_id,'requirementItemId',c.requirement_item_id,'documentSlotId',c.document_slot_id,'file',c.intent->'file','phase',CASE WHEN platform_private.application_document_saved_receipt(c.id) IS NULL THEN 'body_required' ELSE 'finalized' END,'bodyDeadline',a.lease_expires_at,'scanLease',jsonb_build_object('admissionId',a.id,'scanAllowed',platform_private.application_document_saved_receipt(c.id) IS NULL),'receipt',platform_private.application_document_saved_receipt(c.id))
 FROM platform_private.application_document_upload_contexts c JOIN platform_private.student_document_scan_admissions a ON a.request_id=c.request_id AND a.organization_id=c.organization_id AND a.student_case_id=c.student_case_id AND a.document_slot_id=c.document_slot_id AND a.uploader_auth_user_id=c.uploader_auth_user_id WHERE c.id=p_context AND a.id=p_admission
$$;
CREATE FUNCTION platform.admit_application_document_upload_v1(p_student_case_id UUID,p_application_id UUID,p_requirements_revision_id UUID,p_requirement_item_id UUID,p_document_slot_id UUID,p_upload_metadata JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;i platform_private.application_requirement_items%ROWTYPE;c platform_private.application_document_upload_contexts%ROWTYPE;intent JSONB;lease UUID:=gen_random_uuid();at TIMESTAMPTZ:=statement_timestamp();attempt BIGINT;
BEGIN
 IF p_request_id IS NULL OR NOT platform_private.application_document_metadata(p_upload_metadata) THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.upload');
 -- Effective 128 -> 155 takes the organization/actor rows before scan
 -- advisories. Preserve that order even for distinct requests on one actor.
 PERFORM platform_private.application_document_lock(p_student_case_id,p_application_id,p_document_slot_id,p_request_id,'document.upload');
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-request:'||p_request_id::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-actor:'||a.organization_id::TEXT||':'||a.auth_user_id::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-slot:'||a.organization_id::TEXT||':'||p_document_slot_id::TEXT,0));
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.upload');
 intent:=jsonb_build_object('protocolVersion',1,'operation','application_document_upload_v1','studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementsRevisionId',p_requirements_revision_id,'requirementItemId',p_requirement_item_id,'documentSlotId',p_document_slot_id,'file',p_upload_metadata,'actorMembershipId',a.membership_id,'actorAuthUserId',a.auth_user_id);
 SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE request_id=p_request_id;
 IF FOUND THEN
   IF c.organization_id IS DISTINCT FROM a.organization_id OR c.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM platform_private.document_upload_reservations WHERE request_id=p_request_id) OR EXISTS(SELECT 1 FROM platform_private.student_document_scan_admissions WHERE request_id=p_request_id) OR EXISTS(SELECT 1 FROM platform.audit_events WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
   i:=platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id,TRUE);
   IF i.revision_id IS DISTINCT FROM p_requirements_revision_id OR i.document_slot_id IS DISTINCT FROM p_document_slot_id THEN RAISE EXCEPTION 'application_document_stale_requirements' USING ERRCODE='PT409'; END IF;
   INSERT INTO platform_private.application_document_upload_contexts(request_id,organization_id,student_case_id,application_id,requirements_revision_id,requirement_item_id,document_slot_id,uploader_profile_id,uploader_membership_id,uploader_auth_user_id,intent,intent_sha256)
   VALUES(p_request_id,a.organization_id,p_student_case_id,p_application_id,i.revision_id,i.id,i.document_slot_id,a.profile_id,a.membership_id,a.auth_user_id,intent,platform_private.bw1_input_sha256(intent)) RETURNING * INTO c;
 END IF;
 IF EXISTS(SELECT 1 FROM platform.document_slots WHERE id=c.document_slot_id AND removed_at IS NOT NULL) THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM platform_private.student_document_scan_admissions WHERE organization_id=a.organization_id AND (uploader_auth_user_id=a.auth_user_id OR document_slot_id=p_document_slot_id) AND released_at IS NULL AND lease_expires_at>at) THEN RAISE EXCEPTION 'application_document_upload_busy' USING ERRCODE='PT409'; END IF;
 IF (SELECT count(*) FROM platform_private.student_document_scan_admissions WHERE organization_id=a.organization_id AND uploader_auth_user_id=a.auth_user_id AND admitted_at>at-INTERVAL '1 hour')>=60 OR (SELECT count(*) FROM platform_private.student_document_scan_admissions WHERE organization_id=a.organization_id AND document_slot_id=p_document_slot_id AND admitted_at>at-INTERVAL '1 hour')>=12 THEN RAISE EXCEPTION 'application_document_upload_rate_limit' USING ERRCODE='PT429'; END IF;
 SELECT COALESCE(max(attempt_no),0)+1 INTO attempt FROM platform_private.student_document_scan_admissions WHERE request_id=p_request_id;
 INSERT INTO platform_private.student_document_scan_admissions(id,request_id,attempt_no,organization_id,student_case_id,document_slot_id,uploader_profile_id,uploader_membership_id,uploader_auth_user_id,admitted_at,lease_expires_at)
 VALUES(lease,p_request_id,attempt,a.organization_id,p_student_case_id,p_document_slot_id,a.profile_id,a.membership_id,a.auth_user_id,at,at+INTERVAL '15 minutes');
 RETURN platform_private.application_document_admission_result(c.id,lease);
END $$;
CREATE FUNCTION platform.verify_application_document_upload_body_v1(p_context_id UUID,p_admission_id UUID,p_request_id UUID,p_upload_metadata JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;a RECORD;
BEGIN
 SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE id=p_context_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.application_document_lock(c.student_case_id,c.application_id,c.document_slot_id,p_request_id,'document.upload');
 SELECT * INTO a FROM platform_private.application_document_actor(c.student_case_id,'document.upload');
 IF c.organization_id IS DISTINCT FROM a.organization_id OR c.uploader_auth_user_id IS DISTINCT FROM a.auth_user_id OR c.uploader_membership_id IS DISTINCT FROM a.membership_id OR c.request_id IS DISTINCT FROM p_request_id OR c.intent->'file' IS DISTINCT FROM p_upload_metadata THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM platform_private.student_document_scan_admissions WHERE id=p_admission_id AND request_id=c.request_id AND organization_id=c.organization_id AND uploader_auth_user_id=c.uploader_auth_user_id AND released_at IS NULL AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM platform.document_slots WHERE id=c.document_slot_id AND removed_at IS NOT NULL) THEN RAISE EXCEPTION 'application_document_upload_lease_unavailable' USING ERRCODE='PT409'; END IF;
 RETURN platform_private.application_document_admission_result(c.id,p_admission_id);
END $$;

CREATE FUNCTION platform_private.application_document_service_context(p_org UUID,p_actor UUID,p_context UUID,p_hash TEXT,p_request UUID,p_current BOOLEAN)
RETURNS platform_private.application_document_upload_contexts LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;a RECORD;i platform_private.application_requirement_items%ROWTYPE;s platform.student_cases%ROWTYPE;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.lock_p2h_request(p_request);
 SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE id=p_context AND organization_id=p_org;
 IF c.id IS NULL OR c.uploader_auth_user_id IS DISTINCT FROM p_actor OR c.intent_sha256 IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 SELECT * INTO a FROM platform_private.require_scanned_upload_actor(p_org,p_actor,'document.upload');
 IF a.actor_profile_id IS DISTINCT FROM c.uploader_profile_id OR a.actor_membership_id IS DISTINCT FROM c.uploader_membership_id THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM platform.student_cases WHERE organization_id=p_org AND id=c.student_case_id FOR UPDATE;
 IF NOT COALESCE((platform_private.staff_can_access(p_org,a.actor_membership_id,'document.upload','student_case',c.student_case_id)
   OR (a.actor_role IS NOT DISTINCT FROM 'student' AND s.state IN ('active','closed') AND s.student_membership_id=a.actor_membership_id AND s.portal_activated_at IS NOT NULL AND platform_private.membership_has_active_scope(p_org,a.actor_membership_id,'student_case',s.id))),FALSE) THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM platform.university_applications WHERE organization_id=p_org AND student_case_id=c.student_case_id AND id=c.application_id FOR UPDATE;
 PERFORM 1 FROM platform.document_slots WHERE organization_id=p_org AND student_case_id=c.student_case_id AND id=c.document_slot_id AND removed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 i:=platform_private.application_document_item(p_org,c.student_case_id,c.application_id,c.requirement_item_id,p_current);
 IF i.revision_id<>c.requirements_revision_id OR i.document_slot_id<>c.document_slot_id THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN c;
END $$;

-- Source-checked protocol reuse: inherit the fully migrated 156/192 actor,
-- rate, Storage and scan safeguards. No unchecked string replacement, and no
-- caller-selectable switch in a legacy entrypoint.
CREATE FUNCTION pg_temp.b3f_replace(p_body TEXT,p_old TEXT,p_new TEXT,p_count INTEGER DEFAULT 1)
RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN
 IF p_old='' OR (length(p_body)-length(replace(p_body,p_old,'')))/length(p_old)<>p_count THEN RAISE EXCEPTION 'B3f source contract drift'; END IF;
 RETURN replace(p_body,p_old,p_new);
END $$;
DO $clone$
DECLARE source REGPROCEDURE; body TEXT; args TEXT;
BEGIN
 source:='platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)'::REGPROCEDURE;
 SELECT prosrc,pg_get_function_arguments(oid) INTO body,args FROM pg_proc WHERE oid=source;
 body:=pg_temp.b3f_replace(body,$old$  IF slot_row.status = 'approved' THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE = '42501';
  END IF;$old$,$new$  -- A contextual saved draft cannot replace the legacy current pointer.$new$);
 body:=pg_temp.b3f_replace(body,$old$  INSERT INTO platform_private.document_upload_reservations (
    id, request_id,$old$,$new$  INSERT INTO platform_private.document_upload_reservations (
    application_upload_context_id, id, request_id,$new$);
 body:=pg_temp.b3f_replace(body,$old$    reservation_id, p_request_id, p_organization_id, slot_row.student_case_id,$old$,$new$    p_context_id, reservation_id, p_request_id, p_organization_id, slot_row.student_case_id,$new$);
 IF body ~* 'UPDATE[[:space:]]+platform.document_slots' OR position('application_upload_context_id, id, request_id' IN body)=0 THEN RAISE EXCEPTION 'B3f reserve clone invariant'; END IF;
 EXECUTE format('CREATE FUNCTION platform_private.application_document_reserve_step(%s,p_context_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',args,body);
 source:='platform_private.finalize_document_upload_storage_step(uuid,uuid,uuid)'::REGPROCEDURE;
 SELECT prosrc,pg_get_function_arguments(oid) INTO body,args FROM pg_proc WHERE oid=source;
 body:=pg_temp.b3f_replace(body,$old$  IF slot_row.status = 'approved'
    OR (
      slot_row.current_version_no IS NOT NULL
      AND slot_row.current_version_no >= version_row.version_no
    )
  THEN
    RAISE EXCEPTION
      'Document slot cannot publish this reserved version'
      USING ERRCODE = '42501';
  END IF;$old$,$new$  -- Existing approved/current material remains untouched.$new$);
 body:=pg_temp.b3f_replace(body,$old$  UPDATE platform.document_slots AS slot
  SET
    status = 'submitted',
    current_version_id = version_row.id,
    current_version_no = version_row.version_no
  WHERE slot.organization_id = reservation.organization_id
    AND slot.id = reservation.document_slot_id;$old$,$new$  -- Seal only the canonical reserved object; explicit submit is separate.$new$);
 body:=pg_temp.b3f_replace(body,$old$'published_slot_status', 'submitted'$old$,$new$'published_slot_status', NULL$new$,2);
 body:=pg_temp.b3f_replace(body,$old$'document_slot_published', TRUE$old$,$new$'document_slot_published', FALSE$new$,2);
 body:=pg_temp.b3f_replace(body,$old$Trusted backend published an exact object-backed document upload$old$,$new$Trusted backend saved an exact program document without legacy publication$new$);
 IF body ~* 'UPDATE[[:space:]]+platform.document_slots' OR position($x$'document_slot_published', TRUE$x$ IN body)>0 OR position($x$'published_slot_status', 'submitted'$x$ IN body)>0 THEN RAISE EXCEPTION 'B3f finalize clone invariant'; END IF;
 EXECUTE format('CREATE FUNCTION platform_private.application_document_storage_step(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',args,body);
 source:='private.claim_student_document_upload_scan(uuid,uuid,uuid,uuid)'::REGPROCEDURE;
 SELECT prosrc,pg_get_function_arguments(oid) INTO body,args FROM pg_proc WHERE oid=source;
 IF position('evo:e5:student-scan-global' IN body)=0 OR position('active_global_scans' IN body)=0 THEN RAISE EXCEPTION 'B3f scan capacity contract drift'; END IF;
 EXECUTE format('CREATE FUNCTION platform_private.application_document_claim_step(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',args,body);
 source:='private.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)'::REGPROCEDURE;
 SELECT prosrc,pg_get_function_arguments(oid) INTO body,args FROM pg_proc WHERE oid=source;
 EXECUTE format('CREATE FUNCTION platform_private.application_document_complete_step(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',args,body);
END $clone$;

CREATE FUNCTION platform.claim_application_document_upload_scan_v1(p_organization_id UUID,p_actor_auth_user_id UUID,p_context_id UUID,p_admission_id UUID,p_request_id UUID,p_intent_sha256 TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;result JSONB;
BEGIN
 SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE id=p_context_id AND organization_id=p_organization_id AND uploader_auth_user_id=p_actor_auth_user_id;
 IF c.id IS NULL OR c.request_id IS DISTINCT FROM p_request_id OR c.intent_sha256 IS DISTINCT FROM p_intent_sha256 THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 -- 156's scanned actor locks the organization before the shared scan
 -- advisories, matching effective 128 -> 155 admission. The retained request
 -- lock is acquired first by service_context; authority is checked under rows.
 c:=platform_private.application_document_service_context(p_organization_id,p_actor_auth_user_id,p_context_id,p_intent_sha256,p_request_id,FALSE);
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-request:'||p_request_id::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-global',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-actor:'||p_organization_id::TEXT||':'||p_actor_auth_user_id::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-slot:'||p_organization_id::TEXT||':'||c.document_slot_id::TEXT,0));
 -- Once a canonical reservation exists, retries can finish its original
 -- immutable context after a 226 revision. A context-only admission cannot
 -- allocate a new version against superseded requirements.
 IF NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations r
   WHERE r.organization_id=p_organization_id AND r.application_upload_context_id=c.id AND r.request_id=c.request_id) THEN
   PERFORM platform_private.application_document_item(p_organization_id,c.student_case_id,c.application_id,c.requirement_item_id,TRUE);
 END IF;
 IF c.request_id IS DISTINCT FROM p_request_id OR platform_private.application_document_saved_receipt(c.id) IS NOT NULL THEN RAISE EXCEPTION 'application_document_upload_lease_unavailable' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM platform_private.student_document_scan_admissions WHERE id=p_admission_id AND request_id=c.request_id AND organization_id=c.organization_id AND student_case_id=c.student_case_id AND document_slot_id=c.document_slot_id AND uploader_auth_user_id=c.uploader_auth_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_document_upload_lease_unavailable' USING ERRCODE='PT409'; END IF;
 result:=platform_private.application_document_claim_step(p_organization_id,p_actor_auth_user_id,p_admission_id,p_request_id);
 RETURN result;
END $$;
CREATE FUNCTION platform.complete_application_document_upload_scan_v1(p_organization_id UUID,p_actor_auth_user_id UUID,p_context_id UUID,p_admission_id UUID,p_request_id UUID,p_intent_sha256 TEXT,p_outcome TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;receipt JSONB;
BEGIN
 c:=platform_private.application_document_service_context(p_organization_id,p_actor_auth_user_id,p_context_id,p_intent_sha256,p_request_id,FALSE);
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:e5:student-scan-request:'||p_request_id::TEXT,0));
 IF c.request_id IS DISTINCT FROM p_request_id THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM platform_private.student_document_scan_admissions WHERE id=p_admission_id AND request_id=c.request_id AND organization_id=c.organization_id AND student_case_id=c.student_case_id AND document_slot_id=c.document_slot_id AND uploader_auth_user_id=c.uploader_auth_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_document_upload_lease_unavailable' USING ERRCODE='PT409'; END IF;
 PERFORM platform_private.application_document_complete_step(p_organization_id,p_actor_auth_user_id,p_admission_id,p_request_id,p_outcome);
 receipt:=platform_private.application_document_saved_receipt(c.id);
 RETURN jsonb_build_object('savedReceipt',receipt,'definitiveNotSaved',receipt IS NULL AND NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations WHERE application_upload_context_id=c.id));
END $$;
CREATE FUNCTION platform.reserve_application_document_upload_after_ingress_scan_v1(p_organization_id UUID,p_actor_auth_user_id UUID,p_context_id UUID,p_admission_id UUID,p_intent_sha256 TEXT,p_original_filename TEXT,p_declared_mime_type TEXT,p_byte_size BIGINT,p_sha256_hex TEXT,p_scan_result TEXT,p_scanner_engine TEXT,p_scanner_engine_version TEXT,p_scanner_signature_version TEXT,p_scanner_protocol TEXT,p_scanned_at TIMESTAMPTZ,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;metadata JSONB;result JSONB;
BEGIN
 c:=platform_private.application_document_service_context(p_organization_id,p_actor_auth_user_id,p_context_id,p_intent_sha256,p_request_id,FALSE);
 -- Once a canonical reservation exists, retries can finish its original
 -- immutable context after a 226 revision. A context-only admission cannot
 -- allocate a new version against superseded requirements.
 IF NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations r
   WHERE r.organization_id=p_organization_id AND r.application_upload_context_id=c.id AND r.request_id=c.request_id) THEN
   PERFORM platform_private.application_document_item(p_organization_id,c.student_case_id,c.application_id,c.requirement_item_id,TRUE);
 END IF;
 metadata:=jsonb_build_object('originalFilename',p_original_filename,'declaredMimeType',p_declared_mime_type,'byteSize',p_byte_size::TEXT,'sha256Hex',p_sha256_hex);
 IF c.request_id IS DISTINCT FROM p_request_id OR c.intent->'file' IS DISTINCT FROM metadata OR p_scan_result IS DISTINCT FROM 'clean' THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM platform_private.student_document_scan_admissions WHERE id=p_admission_id AND request_id=c.request_id AND organization_id=c.organization_id AND document_slot_id=c.document_slot_id AND uploader_auth_user_id=c.uploader_auth_user_id AND released_at IS NULL AND lease_expires_at>clock_timestamp() AND scan_claimed_at IS NOT NULL AND scan_lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_document_upload_lease_unavailable' USING ERRCODE='PT409'; END IF;
 PERFORM platform_private.assert_clamd_scan_facts(p_scanner_engine,p_scanner_engine_version,p_scanner_signature_version,p_scanner_protocol,p_sha256_hex,p_scanned_at);
 result:=platform_private.application_document_reserve_step(p_organization_id,p_actor_auth_user_id,c.document_slot_id,p_original_filename,p_declared_mime_type,p_byte_size,p_sha256_hex,p_scan_result,p_scanner_engine,p_scanner_engine_version,p_scanner_signature_version,p_scanner_protocol,p_scanned_at,p_request_id,c.id);
 IF NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations WHERE id=(result->>'upload_reservation_id')::UUID AND application_upload_context_id=c.id) THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN result||jsonb_build_object('document_slot_published',FALSE);
END $$;
CREATE FUNCTION platform.finalize_application_document_upload_with_scan_v1(p_organization_id UUID,p_actor_auth_user_id UUID,p_context_id UUID,p_intent_sha256 TEXT,p_upload_reservation_id UUID,p_scanner_engine TEXT,p_scanner_engine_version TEXT,p_scanner_signature_version TEXT,p_scanner_protocol TEXT,p_scanned_sha256_hex TEXT,p_scanned_at TIMESTAMPTZ,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_upload_contexts%ROWTYPE;r platform_private.document_upload_reservations%ROWTYPE;proof_request UUID;receipt JSONB;
BEGIN
 c:=platform_private.application_document_service_context(p_organization_id,p_actor_auth_user_id,p_context_id,p_intent_sha256,p_request_id,FALSE);
 SELECT * INTO r FROM platform_private.document_upload_reservations WHERE organization_id=p_organization_id AND id=p_upload_reservation_id AND application_upload_context_id=c.id;
 IF r.id IS NULL OR r.sha256_hex IS DISTINCT FROM p_scanned_sha256_hex OR NOT r.ingress_scan_required OR r.ingress_scan_result IS DISTINCT FROM 'clean' THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 -- The original immutable context may finish after a 226 edit, but never move
 -- to its successor. Existing service authority/object checks remain intact.
 PERFORM platform_private.application_document_storage_step(p_organization_id,r.id,p_request_id);
 proof_request:=public.uuid_generate_v5('59922800-0000-4000-8000-000000000228'::UUID,'application-document-scan:'||p_request_id::TEXT);
 PERFORM platform_private.attest_document_validation_step(p_organization_id,r.document_version_id,p_scanner_engine,p_scanner_engine_version,p_scanner_signature_version,p_scanner_protocol,p_scanned_sha256_hex,p_scanned_at,proof_request);
 receipt:=platform_private.application_document_saved_receipt(c.id);
 IF receipt IS NULL THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN receipt;
END $$;

CREATE FUNCTION platform.grant_application_document_download_v1(p_student_case_id UUID,p_application_id UUID,p_requirements_revision_id UUID,p_requirement_item_id UUID,p_document_slot_id UUID,p_selection JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;i platform_private.application_requirement_items%ROWTYPE;v UUID;intent JSONB;old platform_private.application_document_download_contexts%ROWTYPE;result JSONB;upload_id UUID;submission_id UUID;
BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.read.full');
 i:=platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,p_requirement_item_id,FALSE);
 PERFORM platform_private.application_document_lock(p_student_case_id,p_application_id,i.document_slot_id,p_request_id,'document.read.full');
 SELECT * INTO a FROM platform_private.application_document_actor(p_student_case_id,'document.read.full');
 IF i.revision_id IS DISTINCT FROM p_requirements_revision_id OR i.document_slot_id IS DISTINCT FROM p_document_slot_id THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 intent:=jsonb_build_object('studentCaseId',p_student_case_id,'applicationId',p_application_id,'requirementsRevisionId',p_requirements_revision_id,'requirementItemId',p_requirement_item_id,'documentSlotId',p_document_slot_id,'selection',p_selection,'actorAuthUserId',a.auth_user_id);
 SELECT * INTO old FROM platform_private.application_document_download_contexts WHERE request_id=p_request_id;
 IF FOUND AND (old.organization_id IS DISTINCT FROM a.organization_id OR old.intent IS DISTINCT FROM intent) THEN RAISE EXCEPTION 'application_document_intent_conflict' USING ERRCODE='PT409'; END IF;
 v:=platform_private.application_document_selection(a.organization_id,p_student_case_id,p_application_id,i.id,p_selection,FALSE);
 PERFORM 1 FROM platform.document_versions WHERE organization_id=a.organization_id AND id=v FOR UPDATE;
 IF EXISTS(SELECT 1 FROM platform.document_slots WHERE id=i.document_slot_id AND removed_at IS NOT NULL) OR platform_private.application_document_file(a.organization_id,v)->>'technicalAvailability'<>'available' THEN RAISE EXCEPTION 'application_document_file_unavailable' USING ERRCODE='PT409'; END IF;
 result:=private.grant_document_download_pre_e5(a.organization_id,v,'application-document:'||p_application_id::TEXT||':'||i.id::TEXT,60,p_request_id);
 IF old.id IS NULL THEN
   IF p_selection->>'kind'='program_upload' THEN upload_id:=(p_selection->>'uploadContextId')::UUID; END IF;
   IF p_selection->>'kind'='submission' THEN submission_id:=(p_selection->>'submissionId')::UUID; END IF;
   INSERT INTO platform_private.application_document_download_contexts(request_id,download_grant_id,organization_id,student_case_id,application_id,requirements_revision_id,requirement_item_id,document_slot_id,document_version_id,upload_context_id,submission_id,actor_auth_user_id,intent)
   VALUES(p_request_id,(result->>'document_download_grant_id')::UUID,a.organization_id,p_student_case_id,p_application_id,i.revision_id,i.id,i.document_slot_id,v,upload_id,submission_id,a.auth_user_id,intent);
 ELSIF old.download_grant_id IS DISTINCT FROM (result->>'document_download_grant_id')::UUID THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION platform.consume_application_document_download_v1(p_organization_id UUID,p_actor_auth_user_id UUID,p_download_grant_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform_private.application_document_download_contexts%ROWTYPE;g platform_private.document_download_grants%ROWTYPE;result JSONB;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM platform_private.application_document_download_contexts WHERE download_grant_id=p_download_grant_id AND organization_id=p_organization_id AND actor_auth_user_id=p_actor_auth_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.lock_p2h_request(p_request_id);
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 SELECT * INTO g FROM platform_private.document_download_grants WHERE id=p_download_grant_id AND organization_id=p_organization_id AND grantee_auth_user_id=p_actor_auth_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM platform.profiles WHERE id=g.grantee_profile_id FOR UPDATE;
 PERFORM 1 FROM platform.organization_memberships WHERE organization_id=p_organization_id AND id=g.grantee_membership_id FOR UPDATE;
 PERFORM 1 FROM platform.student_cases WHERE organization_id=p_organization_id AND id=c.student_case_id FOR SHARE;
 PERFORM 1 FROM platform.university_applications WHERE organization_id=p_organization_id AND id=c.application_id AND student_case_id=c.student_case_id FOR SHARE;
 PERFORM 1 FROM platform.document_slots WHERE organization_id=p_organization_id AND id=c.document_slot_id AND student_case_id=c.student_case_id AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM platform.document_versions WHERE organization_id=p_organization_id AND id=c.document_version_id FOR SHARE;
 PERFORM platform_private.application_document_selection(p_organization_id,c.student_case_id,c.application_id,c.requirement_item_id,c.intent->'selection',FALSE);
 IF platform_private.application_document_file(p_organization_id,c.document_version_id)->>'technicalAvailability'<>'available' THEN RAISE EXCEPTION 'application_document_file_unavailable' USING ERRCODE='PT409'; END IF;
 SELECT * INTO g FROM platform_private.document_download_grants WHERE id=p_download_grant_id AND organization_id=p_organization_id AND grantee_auth_user_id=p_actor_auth_user_id AND document_version_id=c.document_version_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 -- The preserved pre-E5 consume re-resolves current profile/membership/bundle,
 -- scoped permission, case ownership/access version, object identity and expiry.
 -- It never substitutes the global current pointer for the requested version.
 result:=private.consume_document_download_grant_pre_e5(p_download_grant_id,p_request_id);
 IF result->>'document_version_id' IS DISTINCT FROM c.document_version_id::TEXT THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION platform.staff_application_document_submission_queue_v1(p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;x RECORD;result JSONB:='[]';next_cursor JSONB;n INTEGER:=0;cut TIMESTAMPTZ;cut_id UUID;
BEGIN
 SELECT * INTO a FROM platform.current_actor_authority();
 IF a.membership_id IS NULL OR a.platform_role='student' OR NOT private.platform_has_permission(a.organization_id,'document.read.full') THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_cursor IS NOT NULL AND (NOT platform_private.requirements_editor_keys(p_cursor,ARRAY['createdAt','id']) OR NOT platform_private.requirements_editor_uuid(p_cursor->'id') OR jsonb_typeof(p_cursor->'createdAt') IS DISTINCT FROM 'string')) THEN RAISE EXCEPTION 'application_document_invalid_intent' USING ERRCODE='22023'; END IF;
 IF p_cursor IS NOT NULL THEN cut:=(p_cursor->>'createdAt')::TIMESTAMPTZ;cut_id:=(p_cursor->>'id')::UUID; END IF;
 FOR x IN SELECT s.*,c.student_display_name,i.label,i.deadline,p.content->>'name' AS university_title,program.value->>'title' AS program_title,
   s.requirements_revision_id=(SELECT id FROM platform_private.application_requirement_revisions WHERE organization_id=s.organization_id AND application_id=s.application_id ORDER BY revision_version DESC LIMIT 1) AS is_current
 FROM platform_private.application_document_submissions s JOIN platform.student_cases c ON c.organization_id=s.organization_id AND c.id=s.student_case_id
 JOIN platform_private.application_requirement_items i ON i.id=s.requirement_item_id AND i.organization_id=s.organization_id
 JOIN platform_private.catalog_preparation_bindings b ON b.organization_id=s.organization_id AND b.application_id=s.application_id
 JOIN platform_private.university_catalog_publications p ON p.organization_id=b.organization_id AND p.id=b.publication_id
 CROSS JOIN LATERAL jsonb_array_elements(p.content->'programs') program(value)
 WHERE s.organization_id=a.organization_id AND program.value->>'id'=b.program_id
   AND platform_private.staff_can_access_for_actor(a.organization_id,'document.read.full','student_case',s.student_case_id)
   AND NOT EXISTS(SELECT 1 FROM platform_private.application_document_submission_reviews r WHERE r.submission_id=s.id)
   AND (cut IS NULL OR (s.submitted_at,s.id)<(cut,cut_id)) ORDER BY s.submitted_at DESC,s.id DESC LIMIT p_limit+1 LOOP
   n:=n+1;IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'items',result,'nextCursor',next_cursor); END IF;
   result:=result||jsonb_build_array(jsonb_build_object('studentCaseId',x.student_case_id,'applicationId',x.application_id,'studentDisplayName',x.student_display_name,'universityTitle',x.university_title,'programTitle',x.program_title,'requirementLabel',x.label,'deadline',x.deadline,'isCurrentRequirement',x.is_current,'submission',platform_private.application_document_submission_summary(x.id)));
   next_cursor:=jsonb_build_object('createdAt',x.submitted_at,'id',x.id);
 END LOOP;
 RETURN jsonb_build_object('protocolVersion',1,'items',result,'nextCursor',NULL);
END $$;

CREATE FUNCTION platform_private.application_document_legacy_upload_guard(p_request UUID,p_reservation UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_private.application_document_upload_contexts WHERE request_id=p_request)
 OR EXISTS(SELECT 1 FROM platform_private.document_upload_reservations WHERE id=p_reservation AND application_upload_context_id IS NOT NULL) THEN
   RAISE EXCEPTION 'application_documents_update_required' USING ERRCODE='PT409'; END IF;
END $$;
CREATE FUNCTION platform_private.application_document_legacy_reader_guard(p_case UUID,p_application UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE a RECORD;BEGIN
 SELECT * INTO a FROM platform_private.application_document_actor(p_case,'document.read.full');
 IF EXISTS(SELECT 1 FROM platform_private.application_document_upload_contexts WHERE organization_id=a.organization_id AND student_case_id=p_case AND application_id=p_application)
 OR EXISTS(SELECT 1 FROM platform_private.application_document_submissions WHERE organization_id=a.organization_id AND student_case_id=p_case AND application_id=p_application) THEN RAISE EXCEPTION 'application_documents_update_required' USING ERRCODE='PT409'; END IF;
END $$;
DO $guards$ DECLARE signature TEXT;definition TEXT;body TEXT;guard TEXT;BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'platform.admit_student_document_upload_scan(uuid,uuid,uuid)',
 'platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
 'platform.record_document_version_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)',
 'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
 'platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
 'private.claim_student_document_upload_scan(uuid,uuid,uuid,uuid)',
 'private.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)',
 'platform_private.finalize_document_upload_storage_step(uuid,uuid,uuid)',
 'platform.finalize_document_upload_with_scan(uuid,uuid,text,text,text,text,text,timestamp with time zone,uuid)'
 ] LOOP
   SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
   guard:=CASE WHEN signature LIKE '%finalize%' THEN E'\n  PERFORM platform_private.application_document_legacy_upload_guard(p_request_id,p_upload_reservation_id);' ELSE E'\n  PERFORM platform_private.application_document_legacy_upload_guard(p_request_id,NULL);' END;
   -- Insert at the single top-level BEGIN; nested BEGIN blocks remain untouched.
   IF position(E'\nBEGIN\n' IN body)=0 THEN RAISE EXCEPTION 'B3f legacy entry contract drift: %',signature; END IF;
   body:=overlay(body placing E'\nBEGIN'||guard||E'\n' from position(E'\nBEGIN\n' IN body) for length(E'\nBEGIN\n'));
   EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['platform.student_application_requirements_v1(uuid,uuid)','platform.staff_application_requirements_v1(uuid,uuid)','platform.student_application_requirements_v2(uuid,uuid)','platform.staff_application_requirements_v2(uuid,uuid)'] LOOP
   SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
   body:=pg_temp.b3f_replace(body,E'\nBEGIN\n',E'\nBEGIN\n  PERFORM platform_private.application_document_legacy_reader_guard(p_student_case_id,p_application_id);\n');
   EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
 END LOOP;
 -- Context-bound grants must always use the contextual consume wrapper. The
 -- shared pre-E5 primitive is owner-only and intentionally remains reusable.
 FOREACH signature IN ARRAY ARRAY['private.consume_staff_document_download_grant(uuid,uuid)','private.consume_student_portal_document_download_grant(uuid,uuid)'] LOOP
   SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
   body:=pg_temp.b3f_replace(body,E'\nBEGIN\n',E'\nBEGIN\n  IF EXISTS(SELECT 1 FROM platform_private.application_document_download_contexts WHERE download_grant_id=p_document_download_grant_id) THEN RAISE EXCEPTION ''application_documents_update_required'' USING ERRCODE=''PT409''; END IF;\n');
   EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
 END LOOP;
END $guards$;

ALTER TABLE platform_private.application_document_upload_contexts ADD CONSTRAINT application_document_upload_item_fkey FOREIGN KEY(organization_id,requirement_item_id,student_case_id,application_id) REFERENCES platform_private.application_requirement_items(organization_id,id,student_case_id,application_id);
ALTER TABLE platform_private.application_document_submissions ADD CONSTRAINT application_document_submission_item_fkey FOREIGN KEY(organization_id,requirement_item_id,student_case_id,application_id) REFERENCES platform_private.application_requirement_items(organization_id,id,student_case_id,application_id);
ALTER TABLE platform_private.application_document_download_contexts ADD CONSTRAINT application_document_download_item_fkey FOREIGN KEY(organization_id,requirement_item_id,student_case_id,application_id) REFERENCES platform_private.application_requirement_items(organization_id,id,student_case_id,application_id);
CREATE FUNCTION platform_private.application_document_insert_guard()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i platform_private.application_requirement_items%ROWTYPE;c platform_private.application_document_upload_contexts%ROWTYPE;v platform.document_versions%ROWTYPE;j JSONB:=to_jsonb(NEW);
BEGIN
 IF TG_TABLE_NAME='document_upload_reservations' THEN
   IF TG_OP='UPDATE' THEN
     IF NEW.application_upload_context_id IS DISTINCT FROM OLD.application_upload_context_id THEN RAISE EXCEPTION 'application_document_context_immutable' USING ERRCODE='55000'; END IF;RETURN NEW;
   END IF;
   IF NEW.application_upload_context_id IS NULL THEN
     IF EXISTS(SELECT 1 FROM platform_private.application_document_upload_contexts WHERE request_id=NEW.request_id) THEN RAISE EXCEPTION 'application_documents_update_required' USING ERRCODE='PT409'; END IF;
     RETURN NEW;
   END IF;
   SELECT * INTO c FROM platform_private.application_document_upload_contexts WHERE id=NEW.application_upload_context_id;
   SELECT * INTO v FROM platform.document_versions WHERE id=NEW.document_version_id AND organization_id=NEW.organization_id;
   IF c.id IS NULL OR c.organization_id IS DISTINCT FROM NEW.organization_id OR c.student_case_id IS DISTINCT FROM NEW.student_case_id OR c.document_slot_id IS DISTINCT FROM NEW.document_slot_id OR c.request_id IS DISTINCT FROM NEW.request_id OR c.uploader_profile_id IS DISTINCT FROM NEW.uploader_profile_id OR c.uploader_membership_id IS DISTINCT FROM NEW.uploader_membership_id OR c.uploader_auth_user_id IS DISTINCT FROM NEW.uploader_auth_user_id OR c.intent->'file' IS DISTINCT FROM jsonb_build_object('originalFilename',v.original_filename,'declaredMimeType',NEW.declared_mime_type,'byteSize',NEW.byte_size::TEXT,'sha256Hex',NEW.sha256_hex) THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='application_document_submission_reviews' THEN RETURN NEW; END IF;
 SELECT * INTO i FROM platform_private.application_requirement_items WHERE id=(j->>'requirement_item_id')::UUID;
 IF i.organization_id IS DISTINCT FROM (j->>'organization_id')::UUID OR i.student_case_id IS DISTINCT FROM (j->>'student_case_id')::UUID OR i.application_id IS DISTINCT FROM (j->>'application_id')::UUID OR i.revision_id IS DISTINCT FROM (j->>'requirements_revision_id')::UUID OR i.document_slot_id IS DISTINCT FROM (j->>'document_slot_id')::UUID THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='application_document_upload_contexts' AND (j->>'intent_sha256' IS DISTINCT FROM platform_private.bw1_input_sha256(j->'intent') OR NOT platform_private.application_document_metadata(j->'intent'->'file')) THEN RAISE EXCEPTION 'application_document_invariant_conflict' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_document_upload_insert BEFORE INSERT ON platform_private.application_document_upload_contexts FOR EACH ROW EXECUTE FUNCTION platform_private.application_document_insert_guard();
CREATE TRIGGER application_document_submission_insert BEFORE INSERT ON platform_private.application_document_submissions FOR EACH ROW EXECUTE FUNCTION platform_private.application_document_insert_guard();
CREATE TRIGGER application_document_download_insert BEFORE INSERT ON platform_private.application_document_download_contexts FOR EACH ROW EXECUTE FUNCTION platform_private.application_document_insert_guard();
CREATE TRIGGER document_reservation_application_context_insert BEFORE INSERT ON platform_private.document_upload_reservations FOR EACH ROW EXECUTE FUNCTION platform_private.application_document_insert_guard();
CREATE TRIGGER document_reservation_application_context_immutable BEFORE UPDATE OF application_upload_context_id ON platform_private.document_upload_reservations FOR EACH ROW EXECUTE FUNCTION platform_private.application_document_insert_guard();

-- Reuse 153's current notification feed and acknowledgement. The authentic
-- source is the exact program review/event, never a forged legacy review row.
CREATE FUNCTION platform_private.publish_application_document_review_notification()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s platform_private.application_document_submissions%ROWTYPE;i platform_private.application_requirement_items%ROWTYPE;recipient UUID;n UUID;
BEGIN
 SELECT * INTO STRICT s FROM platform_private.application_document_submissions WHERE id=NEW.submission_id AND organization_id=NEW.organization_id;
 SELECT * INTO STRICT i FROM platform_private.application_requirement_items WHERE id=s.requirement_item_id AND organization_id=s.organization_id;
 SELECT student_membership_id INTO recipient FROM platform.student_cases WHERE organization_id=s.organization_id AND id=s.student_case_id;
 IF recipient IS NULL THEN RETURN NEW; END IF;
 INSERT INTO platform.notifications(organization_id,student_case_id,recipient_membership_id,category,title,body,dedupe_key,created_by_membership_id,created_at,updated_at)
 VALUES(s.organization_id,s.student_case_id,recipient,'application.document.review',i.label,
   CASE NEW.decision WHEN 'approved' THEN 'Документ проверен для выбранной программы.' ELSE NEW.reason END,
   'application_submission_review:'||NEW.id::TEXT,NEW.reviewer_membership_id,NEW.reviewed_at,NEW.reviewed_at) RETURNING id INTO n;
 INSERT INTO platform.notification_events(organization_id,notification_id,student_case_id,recipient_membership_id,event_type,actor_membership_id,reason,request_id)
 VALUES(s.organization_id,n,s.student_case_id,recipient,'created',NEW.reviewer_membership_id,'EVO reviewed the exact program document submission',NEW.request_id);
 RETURN NEW;
END $$;
CREATE TRIGGER application_document_review_notification AFTER INSERT ON platform_private.application_document_submission_reviews FOR EACH ROW EXECUTE FUNCTION platform_private.publish_application_document_review_notification();
CREATE FUNCTION platform_private.own_application_document_notifications()
RETURNS TABLE(notification_id UUID,review_id UUID,submission_id UUID,student_case_id UUID,category TEXT,event_code TEXT,subject_label TEXT,detail TEXT,due_at TIMESTAMPTZ,created_at TIMESTAMPTZ,read_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT n.id,r.id,s.id,s.student_case_id,n.category,'application_document_review'::TEXT,i.label,r.reason,NULL::TIMESTAMPTZ,n.created_at,n.read_at
 FROM platform.current_actor_authority() a JOIN platform.notifications n ON n.organization_id=a.organization_id AND n.recipient_membership_id=a.membership_id
 JOIN platform.notification_events e ON e.organization_id=n.organization_id AND e.notification_id=n.id AND e.student_case_id=n.student_case_id AND e.recipient_membership_id=n.recipient_membership_id AND e.event_type='created'
 JOIN platform_private.application_document_submission_reviews r ON r.organization_id=n.organization_id AND r.student_case_id=n.student_case_id AND r.request_id=e.request_id AND r.reviewer_membership_id=n.created_by_membership_id AND r.reviewer_membership_id=e.actor_membership_id
 JOIN platform_private.application_document_submissions s ON s.id=r.submission_id AND s.organization_id=r.organization_id AND s.student_case_id=r.student_case_id AND s.application_id=r.application_id
 JOIN platform_private.application_requirement_items i ON i.id=s.requirement_item_id AND i.organization_id=s.organization_id
 JOIN platform.student_cases c ON c.organization_id=s.organization_id AND c.id=s.student_case_id AND c.student_membership_id=a.membership_id
 WHERE a.platform_role='student' AND n.category='application.document.review' AND n.dedupe_key='application_submission_review:'||r.id::TEXT
 AND private.platform_has_permission(a.organization_id,'notification.read.self') AND private.platform_can_read_student_portal_case(a.organization_id,c.id)
$$;
CREATE FUNCTION platform.student_application_document_notification_v1(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB;case_id UUID;
BEGIN
 SELECT s.student_case_id,jsonb_build_object('protocolVersion',1,'notificationId',n.notification_id,'reviewId',r.id,'studentCaseId',s.student_case_id,'applicationId',s.application_id,'requirementsRevisionId',s.requirements_revision_id,'requirementItemId',s.requirement_item_id,'documentSlotId',s.document_slot_id,'submission',platform_private.application_document_submission_summary(s.id)||jsonb_build_object('review',jsonb_build_object('reviewId',r.id,'decision',r.decision,'reason',r.reason,'reviewedAt',r.reviewed_at))) INTO case_id,result
 FROM platform_private.own_application_document_notifications() n JOIN platform_private.application_document_submissions s ON s.id=n.submission_id JOIN platform_private.application_document_submission_reviews r ON r.id=n.review_id WHERE n.notification_id=p_notification_id;
 IF result IS NULL THEN RAISE EXCEPTION 'application_documents_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM platform_private.application_document_actor(case_id,'document.read.full');
 RETURN result;
END $$;
DO $notification$ DECLARE signature TEXT;definition TEXT;body TEXT;BEGIN
 signature:='platform.student_portal_notifications_v2()';
 SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
 body:=pg_temp.b3f_replace(body,$old$    FROM platform_private.own_case_help_notifications() n$old$,$new$    FROM platform_private.own_case_help_notifications() n
    UNION ALL
    SELECT n.notification_id,n.category,n.event_code,n.subject_label,n.detail,n.due_at,n.created_at,n.read_at
    FROM platform_private.own_application_document_notifications() n$new$);
 EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
 signature:='platform.mark_own_student_portal_notification_read_v2(uuid,uuid)';
 SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
 body:=pg_temp.b3f_replace(body,$old$      OR EXISTS (
        SELECT 1 FROM platform_private.own_case_help_notifications() help
        WHERE help.notification_id = notification.id
      )$old$,$new$      OR EXISTS (
        SELECT 1 FROM platform_private.own_case_help_notifications() help
        WHERE help.notification_id = notification.id
      )
      OR EXISTS (
        SELECT 1 FROM platform_private.own_application_document_notifications() program
        WHERE program.notification_id = notification.id
      )$new$);
 EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
END $notification$;

-- The service-only metadata path also shares the canonical version sequence.
-- Its existing slot FOR UPDATE, manual publication and receipt remain intact.
DO $allocator$ DECLARE signature TEXT:='platform.record_document_version_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)';definition TEXT;body TEXT;BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,body FROM pg_proc WHERE oid=signature::REGPROCEDURE;
 IF position('FOR UPDATE' IN body)=0 OR position('slot_row' IN body)=0 THEN RAISE EXCEPTION 'B3f metadata allocator lock drift'; END IF;
 body:=pg_temp.b3f_replace(body,$old$  next_version_no := COALESCE(slot_row.current_version_no, 0) + 1;$old$,$new$  SELECT COALESCE(MAX(version.version_no), 0) + 1 INTO next_version_no
  FROM platform.document_versions AS version
  WHERE version.organization_id=p_organization_id AND version.document_slot_id=p_document_slot_id;$new$);
 EXECUTE pg_temp.b3f_replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=signature::REGPROCEDURE),body);
END $allocator$;

-- Explicit ownership/ACL inventory. No client DML or callable private bypass.
ALTER FUNCTION platform_private.application_document_actor(UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_actor(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_lock(UUID,UUID,UUID,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_lock(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_item(UUID,UUID,UUID,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_item(UUID,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_lineage(UUID,UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_lineage(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_file(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_file(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_upload_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_upload_summary(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_submission_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_submission_summary(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_saved_receipt(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_saved_receipt(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_version_origin(UUID,UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_version_origin(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_selection(UUID,UUID,UUID,UUID,JSONB,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_selection(UUID,UUID,UUID,UUID,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_events(UUID,UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_events(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.application_document_history_v1(UUID,UUID,UUID,JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_document_history_v1(UUID,UUID,UUID,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_document_history_v1(UUID,UUID,UUID,JSONB,INTEGER) TO authenticated;
ALTER FUNCTION platform.application_document_reusable_versions_v1(UUID,UUID,UUID,JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_document_reusable_versions_v1(UUID,UUID,UUID,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_document_reusable_versions_v1(UUID,UUID,UUID,JSONB,INTEGER) TO authenticated;
ALTER FUNCTION platform_private.application_documents_view(UUID,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_documents_view(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.student_application_documents_v1(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.student_application_documents_v1(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_application_documents_v1(UUID,UUID) TO authenticated;
ALTER FUNCTION platform.staff_application_documents_v1(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.staff_application_documents_v1(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_documents_v1(UUID,UUID) TO authenticated;
ALTER FUNCTION platform_private.application_document_audit(UUID,UUID,UUID,TEXT,UUID,JSONB,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_audit(UUID,UUID,UUID,TEXT,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_replay(UUID,UUID,TEXT,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_replay(UUID,UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.submit_application_document_v1(UUID,UUID,UUID,UUID,JSONB,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.submit_application_document_v1(UUID,UUID,UUID,UUID,JSONB,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.submit_application_document_v1(UUID,UUID,UUID,UUID,JSONB,UUID,UUID) TO authenticated;
ALTER FUNCTION platform.review_application_document_submission_v1(UUID,UUID,platform.document_review_decision,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.review_application_document_submission_v1(UUID,UUID,platform.document_review_decision,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.review_application_document_submission_v1(UUID,UUID,platform.document_review_decision,TEXT,UUID) TO authenticated;
ALTER FUNCTION platform_private.application_document_metadata(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_metadata(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_admission_result(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_admission_result(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.admit_application_document_upload_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.admit_application_document_upload_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.admit_application_document_upload_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) TO authenticated;
ALTER FUNCTION platform.verify_application_document_upload_body_v1(UUID,UUID,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.verify_application_document_upload_body_v1(UUID,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.verify_application_document_upload_body_v1(UUID,UUID,UUID,JSONB) TO authenticated;
ALTER FUNCTION platform_private.application_document_service_context(UUID,UUID,UUID,TEXT,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_service_context(UUID,UUID,UUID,TEXT,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.claim_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.claim_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.claim_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT) TO service_role;
ALTER FUNCTION platform.complete_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.complete_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.complete_application_document_upload_scan_v1(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT) TO service_role;
ALTER FUNCTION platform.reserve_application_document_upload_after_ingress_scan_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.reserve_application_document_upload_after_ingress_scan_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_application_document_upload_after_ingress_scan_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) TO service_role;
ALTER FUNCTION platform.finalize_application_document_upload_with_scan_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.finalize_application_document_upload_with_scan_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.finalize_application_document_upload_with_scan_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) TO service_role;
ALTER FUNCTION platform.grant_application_document_download_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.grant_application_document_download_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_application_document_download_v1(UUID,UUID,UUID,UUID,UUID,JSONB,UUID) TO authenticated;
ALTER FUNCTION platform.consume_application_document_download_v1(UUID,UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.consume_application_document_download_v1(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.consume_application_document_download_v1(UUID,UUID,UUID,UUID) TO service_role;
ALTER FUNCTION platform.staff_application_document_submission_queue_v1(JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.staff_application_document_submission_queue_v1(JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_document_submission_queue_v1(JSONB,INTEGER) TO authenticated;
ALTER FUNCTION platform_private.application_document_legacy_upload_guard(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_legacy_upload_guard(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_legacy_reader_guard(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_legacy_reader_guard(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_insert_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_insert_guard() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.publish_application_document_review_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.publish_application_document_review_notification() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.own_application_document_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.own_application_document_notifications() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform.student_application_document_notification_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.student_application_document_notification_v1(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_application_document_notification_v1(UUID) TO authenticated;
ALTER FUNCTION platform_private.application_document_reserve_step(UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_reserve_step(UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_storage_step(UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_storage_step(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_claim_step(UUID,UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_claim_step(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
ALTER FUNCTION platform_private.application_document_complete_step(UUID,UUID,UUID,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_document_complete_step(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

NOTIFY pgrst,'reload schema';
COMMIT;
