-- B3g: immutable program compositions and an explicit EVO package decision.
-- Contract: docs/platform/b3g-program-package-contract.md and b3g-package-wire-v1.md.
-- Individual228 commands, canonical bytes, legacy current/status and ZIP169 remain unchanged.
BEGIN;

CREATE TABLE platform_private.application_package_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL, student_case_id UUID NOT NULL, application_id UUID NOT NULL,
  requirements_revision_id UUID NOT NULL, package_version BIGINT NOT NULL CHECK(package_version>0),
  previous_package_id UUID, composition_sha256 TEXT NOT NULL CHECK(composition_sha256 ~ '^[0-9a-f]{64}$'),
  composition JSONB NOT NULL CHECK(jsonb_typeof(composition)='array' AND jsonb_array_length(composition) BETWEEN 1 AND 100),
  program_snapshot JSONB NOT NULL, submitted_by_membership_id UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(), intent JSONB NOT NULL, receipt JSONB NOT NULL,
  UNIQUE(organization_id,id,student_case_id,application_id), UNIQUE(organization_id,application_id,package_version),
  FOREIGN KEY(application_id) REFERENCES platform_private.catalog_preparation_bindings(application_id),
  FOREIGN KEY(organization_id,requirements_revision_id,student_case_id,application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,previous_package_id,student_case_id,application_id)
    REFERENCES platform_private.application_package_submissions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,submitted_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE TABLE platform_private.application_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL, application_id UUID NOT NULL, package_id UUID NOT NULL,
  requirements_revision_id UUID NOT NULL, requirement_item_id UUID NOT NULL REFERENCES platform_private.application_requirement_items(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 100), document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL, submission_id UUID NOT NULL, selection JSONB NOT NULL,
  definition JSONB NOT NULL, material_snapshot JSONB,
  UNIQUE(package_id,position), UNIQUE(package_id,requirement_item_id), UNIQUE(package_id,document_slot_id),
  FOREIGN KEY(organization_id,package_id,student_case_id,application_id)
    REFERENCES platform_private.application_package_submissions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,requirements_revision_id,student_case_id,application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,submission_id,student_case_id,application_id)
    REFERENCES platform_private.application_document_submissions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,document_version_id,student_case_id,document_slot_id)
    REFERENCES platform.document_versions(organization_id,id,student_case_id,document_slot_id)
);
CREATE TABLE platform_private.application_package_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL, student_case_id UUID NOT NULL, application_id UUID NOT NULL, package_id UUID NOT NULL,
  previous_review_id UUID REFERENCES platform_private.application_package_reviews(id),
  reviewer_membership_id UUID NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','correction_required')),
  reason TEXT, affected_item_ids JSONB NOT NULL CHECK(jsonb_typeof(affected_item_ids)='array' AND jsonb_array_length(affected_item_ids)<=100),
  document_reviews JSONB NOT NULL CHECK(jsonb_typeof(document_reviews)='array' AND jsonb_array_length(document_reviews) BETWEEN 1 AND 100),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(), intent JSONB NOT NULL, receipt JSONB NOT NULL,
  CHECK((decision='approved' AND reason IS NULL AND affected_item_ids='[]'::JSONB)
    OR (decision='correction_required' AND reason IS NOT NULL AND length(platform_private.requirements_editor_trim(reason))>0 AND length(reason)<=5000)),
  FOREIGN KEY(organization_id,package_id,student_case_id,application_id)
    REFERENCES platform_private.application_package_submissions(organization_id,id,student_case_id,application_id),
  FOREIGN KEY(organization_id,reviewer_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE INDEX application_package_case_history_idx ON platform_private.application_package_submissions(organization_id,student_case_id,submitted_at DESC,id DESC);
CREATE INDEX application_package_review_history_idx ON platform_private.application_package_reviews(package_id,reviewed_at DESC,id DESC);
CREATE INDEX application_package_item_submission_idx ON platform_private.application_package_items(submission_id);

DO $ddl$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['application_package_submissions','application_package_items','application_package_reviews'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('REVOKE ALL ON platform_private.%I FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',n);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON platform_private.%I FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation()',n||'_immutable',n);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON platform_private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change()',n||'_no_truncate',n);
  END LOOP;
END $ddl$;

CREATE FUNCTION platform_private.application_package_actor(p_case UUID,p_application UUID,p_permission TEXT)
RETURNS TABLE(organization_id UUID,profile_id UUID,membership_id UUID,auth_user_id UUID,platform_role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform_private.application_document_actor(p_case,p_permission);
  IF NOT EXISTS(SELECT 1 FROM platform_private.catalog_preparation_bindings b
    WHERE b.organization_id=a.organization_id AND b.student_case_id=p_case AND b.application_id=p_application)
  THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.organization_id,a.profile_id,a.membership_id,a.auth_user_id,a.platform_role;
EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501';
END $$;

CREATE FUNCTION platform_private.application_package_selection_valid(p_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.requirements_editor_uuid(p_value->'documentVersionId') AND (
    (p_value->>'kind'='existing_version' AND platform_private.requirements_editor_keys(p_value,ARRAY['kind','documentVersionId'])) OR
    (p_value->>'kind'='program_upload' AND platform_private.requirements_editor_keys(p_value,ARRAY['kind','documentVersionId','uploadContextId'])
      AND platform_private.requirements_editor_uuid(p_value->'uploadContextId')))
$$;
CREATE FUNCTION platform_private.application_package_selections_valid(p_value JSONB,p_empty BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE x JSONB; ids UUID[]:=ARRAY[]::UUID[]; id UUID;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR jsonb_array_length(p_value)>100
    OR (NOT p_empty AND jsonb_array_length(p_value)=0) THEN RETURN FALSE; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF NOT platform_private.requirements_editor_keys(x,ARRAY['requirementItemId','selection','expectedPreviousSubmissionId'])
      OR NOT platform_private.requirements_editor_uuid(x->'requirementItemId')
      OR platform_private.application_package_selection_valid(x->'selection') IS DISTINCT FROM TRUE
      OR (x->'expectedPreviousSubmissionId'<>'null'::JSONB AND NOT platform_private.requirements_editor_uuid(x->'expectedPreviousSubmissionId'))
    THEN RETURN FALSE; END IF;
    id:=(x->>'requirementItemId')::UUID;
    IF id=ANY(ids) THEN RETURN FALSE; END IF; ids:=array_append(ids,id);
  END LOOP;
  RETURN TRUE;
END $$;
CREATE FUNCTION platform_private.application_package_intent(p_operation TEXT,p_intent JSONB)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE x JSONB; seen UUID[]:=ARRAY[]::UUID[]; id UUID;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('submit','review') OR p_intent IS NULL OR octet_length(p_intent::TEXT)>1048576
    OR NOT platform_private.requirements_editor_uuid(p_intent->'studentCaseId')
    OR NOT platform_private.requirements_editor_uuid(p_intent->'applicationId')
    OR NOT platform_private.requirements_editor_uuid(p_intent->'requestId')
  THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  IF p_operation='submit' THEN
    IF NOT platform_private.requirements_editor_keys(p_intent,ARRAY['studentCaseId','applicationId','requirementsRevisionId','expectedPreviousPackageId','items','requestId'])
      OR NOT platform_private.requirements_editor_uuid(p_intent->'requirementsRevisionId')
      OR (p_intent->'expectedPreviousPackageId'<>'null'::JSONB AND NOT platform_private.requirements_editor_uuid(p_intent->'expectedPreviousPackageId'))
      OR NOT platform_private.application_package_selections_valid(p_intent->'items',FALSE)
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    RETURN;
  END IF;
  IF NOT platform_private.requirements_editor_keys(p_intent,ARRAY['studentCaseId','applicationId','packageId','expectedPreviousReviewId','decision','reason','affectedItemIds','documentReviews','reuseApprovals','requestId'])
    OR NOT platform_private.requirements_editor_uuid(p_intent->'packageId')
    OR (p_intent->'expectedPreviousReviewId'<>'null'::JSONB AND NOT platform_private.requirements_editor_uuid(p_intent->'expectedPreviousReviewId'))
    OR p_intent->>'decision' IS NULL OR p_intent->>'decision' NOT IN ('approved','correction_required')
    OR jsonb_typeof(p_intent->'affectedItemIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_intent->'documentReviews') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_intent->'reuseApprovals') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_intent->'affectedItemIds')>100 OR jsonb_array_length(p_intent->'documentReviews') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(p_intent->'reuseApprovals')>100
    OR (p_intent->>'decision'='approved' AND (p_intent->'reason'<>'null'::JSONB OR p_intent->'affectedItemIds'<>'[]'::JSONB))
    OR (p_intent->>'decision'='correction_required' AND (NOT platform_private.requirements_editor_text(p_intent->'reason',5000)
      OR p_intent->'reuseApprovals'<>'[]'::JSONB))
  THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_intent->'affectedItemIds') LOOP
    IF NOT platform_private.requirements_editor_uuid(x) THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    id:=(x #>> '{}')::UUID; IF id=ANY(seen) THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF; seen:=array_append(seen,id);
  END LOOP;
  seen:=ARRAY[]::UUID[];
  FOR x IN SELECT value FROM jsonb_array_elements(p_intent->'documentReviews') LOOP
    IF NOT platform_private.requirements_editor_keys(x,ARRAY['requirementItemId','submissionId','expectedReviewId'])
      OR NOT platform_private.requirements_editor_uuid(x->'requirementItemId') OR NOT platform_private.requirements_editor_uuid(x->'submissionId')
      OR (x->'expectedReviewId'<>'null'::JSONB AND NOT platform_private.requirements_editor_uuid(x->'expectedReviewId'))
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    id:=(x->>'requirementItemId')::UUID; IF id=ANY(seen) THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF; seen:=array_append(seen,id);
  END LOOP;
  seen:=ARRAY[]::UUID[];
  FOR x IN SELECT value FROM jsonb_array_elements(p_intent->'reuseApprovals') LOOP
    IF NOT platform_private.requirements_editor_keys(x,ARRAY['requirementItemId','submissionId','expectedReviewId','sourceSubmissionId','sourceReviewId'])
      OR NOT platform_private.requirements_editor_uuid(x->'sourceSubmissionId') OR NOT platform_private.requirements_editor_uuid(x->'sourceReviewId')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_intent->'documentReviews') e(value) WHERE e.value=x-ARRAY['sourceSubmissionId','sourceReviewId'])
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    id:=(x->>'requirementItemId')::UUID; IF id=ANY(seen) THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF; seen:=array_append(seen,id);
  END LOOP;
END $$;

CREATE FUNCTION platform_private.application_package_program(p_org UUID,p_application UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('institutionId',b.institution_id,'publicationId',b.publication_id,'programId',b.program_id,'intakeId',b.intake_id,
    'universityTitle',p.content->>'name','programTitle',program.value->>'title','intakeLabel',intake.value->>'label')
  FROM platform_private.catalog_preparation_bindings b
  JOIN platform_private.university_catalog_publications p ON p.organization_id=b.organization_id AND p.id=b.publication_id
  CROSS JOIN LATERAL jsonb_array_elements(p.content->'programs') program(value)
  CROSS JOIN LATERAL jsonb_array_elements(program.value->'intakes') intake(value)
  WHERE b.organization_id=p_org AND b.application_id=p_application AND program.value->>'id'=b.program_id AND intake.value->>'id'=b.intake_id::TEXT
$$;
CREATE FUNCTION platform_private.application_package_document_review(p_review UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('reviewId',id,'decision',decision,'reason',reason,'reviewedAt',reviewed_at)
  FROM platform_private.application_document_submission_reviews WHERE id=p_review
$$;
CREATE FUNCTION platform_private.application_package_review_summary(p_review UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('packageReviewId',r.id,'packageId',r.package_id,'decision',r.decision,'reason',r.reason,
    'affectedItemIds',r.affected_item_ids,'documentReviews',r.document_reviews,'reviewedAt',r.reviewed_at)
  FROM platform_private.application_package_reviews r WHERE r.id=p_review
$$;
CREATE FUNCTION platform_private.application_package_summary(p_package UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('packageId',p.id,'requirementsRevisionId',p.requirements_revision_id,'requirementsRevisionVersion',r.revision_version::TEXT,
    'origin',r.origin,'configurationState',r.configuration_state,'packageVersion',p.package_version::TEXT,'previousPackageId',p.previous_package_id,
    'compositionSha256',p.composition_sha256,'submittedAt',p.submitted_at,'itemCount',jsonb_array_length(p.composition),
    'isCurrentRequirements',p.requirements_revision_id=(SELECT id FROM platform_private.application_requirement_revisions WHERE organization_id=p.organization_id AND application_id=p.application_id ORDER BY revision_version DESC LIMIT 1),
    'latestReview',(SELECT platform_private.application_package_review_summary(id) FROM platform_private.application_package_reviews WHERE package_id=p.id ORDER BY reviewed_at DESC,id DESC LIMIT 1))
  FROM platform_private.application_package_submissions p JOIN platform_private.application_requirement_revisions r ON r.id=p.requirements_revision_id WHERE p.id=p_package
$$;
CREATE FUNCTION platform_private.application_package_replay(p_request UUID,p_org UUID,p_action TEXT,p_application UUID,p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE event platform.audit_events%ROWTYPE;
BEGIN
  SELECT * INTO event FROM platform.audit_events WHERE request_id=p_request;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF event.organization_id IS DISTINCT FROM p_org OR event.action IS DISTINCT FROM p_action OR event.resource_id IS DISTINCT FROM p_application
    OR event.after_state->'intent' IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'application_package_intent_conflict' USING ERRCODE='PT409'; END IF;
  RETURN event.after_state->'receipt';
END $$;

-- All parent and predetermined child requests precede every organization/row
-- lock. Child calls reacquire only these held locks; no dynamically found child.
CREATE FUNCTION platform_private.application_package_prelock(p_operation TEXT,p_intent JSONB)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE id UUID; requests UUID[]; p_request UUID:=(p_intent->>'requestId')::UUID;
BEGIN
  requests:=ARRAY[p_request];
  IF p_operation='submit' THEN
    SELECT requests||COALESCE(array_agg(public.uuid_generate_v5(p_request,'application-package:submit:'||(value->>'requirementItemId'))),ARRAY[]::UUID[]) INTO requests FROM jsonb_array_elements(p_intent->'items');
  ELSE
    SELECT requests||COALESCE(array_agg(public.uuid_generate_v5(p_request,'application-package:review:'||(value->>'requirementItemId'))),ARRAY[]::UUID[]) INTO requests FROM jsonb_array_elements(p_intent->'reuseApprovals');
  END IF;
  FOR id IN SELECT DISTINCT x FROM unnest(requests) x ORDER BY x LOOP PERFORM platform_private.lock_p2h_request(id); END LOOP;
END $$;

CREATE FUNCTION platform_private.application_package_cursor(p_cursor JSONB,p_limit INTEGER)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_cursor IS NOT NULL AND (
    NOT platform_private.requirements_editor_keys(p_cursor,ARRAY['createdAt','id']) OR NOT platform_private.requirements_editor_uuid(p_cursor->'id')
    OR jsonb_typeof(p_cursor->'createdAt') IS DISTINCT FROM 'string'))
  THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  IF p_cursor IS NOT NULL THEN PERFORM (p_cursor->>'createdAt')::TIMESTAMPTZ; END IF;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023';
END $$;

CREATE FUNCTION platform.application_package_readiness_v1(p_student_case_id UUID,p_application_id UUID,p_selections JSONB DEFAULT '[]')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; docs JSONB; requirements JSONB; revision UUID; latest UUID; x JSONB; i platform_private.application_requirement_items%ROWTYPE;
  reasons TEXT[]:=ARRAY[]::TEXT[]; item_reasons TEXT[]; missing UUID[]:=ARRAY[]::UUID[]; result JSONB:='[]';
  file JSONB; version_id UUID; submission UUID; previous UUID; may_submit BOOLEAN:=FALSE; material_ok BOOLEAN;
BEGIN
  IF NOT platform_private.application_package_selections_valid(p_selections,TRUE) THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM platform_private.application_package_actor(p_student_case_id,p_application_id,'document.read.full');
  docs:=platform_private.application_documents_view(p_student_case_id,p_application_id,a.platform_role='student');
  requirements:=docs->'requirements'; revision:=(requirements->>'revisionId')::UUID;
  BEGIN PERFORM 1 FROM platform_private.application_package_actor(p_student_case_id,p_application_id,'document.upload'); may_submit:=TRUE;
  EXCEPTION WHEN insufficient_privilege THEN may_submit:=FALSE; END;
  SELECT id INTO latest FROM platform_private.application_package_submissions WHERE organization_id=a.organization_id AND application_id=p_application_id ORDER BY package_version DESC LIMIT 1;
  IF revision IS NULL THEN reasons:=array_append(reasons,'requirements_unavailable'); END IF;
  IF jsonb_array_length(p_selections)=0 THEN reasons:=array_append(reasons,'empty_composition'); END IF;
  -- A broken excluded optional does not gate readiness. A revision's generic
  -- needs_configuration flag is therefore deliberately not a submission gate.
  FOR i IN SELECT * FROM platform_private.application_requirement_items WHERE revision_id=revision AND required ORDER BY position LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_selections) s WHERE s->>'requirementItemId'=i.id::TEXT) THEN missing:=array_append(missing,i.id); END IF;
    BEGIN PERFORM platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,i.id,TRUE);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN IF NOT 'material_unavailable'=ANY(reasons) THEN reasons:=array_append(reasons,'material_unavailable'); END IF; END;
  END LOOP;
  IF cardinality(missing)>0 THEN reasons:=array_append(reasons,'missing_required'); END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    SELECT * INTO i FROM platform_private.application_requirement_items WHERE id=(x->>'requirementItemId')::UUID
      AND organization_id=a.organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
    IF i.revision_id IS DISTINCT FROM revision THEN RAISE EXCEPTION 'application_package_stale_requirements' USING ERRCODE='PT409'; END IF;
    item_reasons:=ARRAY[]::TEXT[]; file:=NULL; submission:=NULL; material_ok:=TRUE;
    BEGIN PERFORM platform_private.application_document_item(a.organization_id,p_student_case_id,p_application_id,i.id,TRUE);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN item_reasons:=array_append(item_reasons,'material_unavailable'); material_ok:=FALSE; END;
    IF material_ok THEN
      version_id:=platform_private.application_document_selection(a.organization_id,p_student_case_id,p_application_id,i.id,x->'selection',TRUE);
      file:=platform_private.application_document_file(a.organization_id,version_id);
      IF file->>'technicalAvailability'<>'available' THEN item_reasons:=array_append(item_reasons,'file_unavailable'); END IF;
      SELECT id INTO submission FROM platform_private.application_document_submissions WHERE organization_id=a.organization_id
        AND application_id=p_application_id AND requirements_revision_id=revision AND requirement_item_id=i.id AND document_version_id=version_id;
      SELECT id INTO previous FROM platform_private.application_document_submissions WHERE requirement_item_id=i.id ORDER BY submitted_at DESC,id DESC LIMIT 1;
      IF submission IS NULL AND previous IS DISTINCT FROM (x->>'expectedPreviousSubmissionId')::UUID THEN item_reasons:=array_append(item_reasons,'previous_submission_changed'); END IF;
    END IF;
    result:=result||jsonb_build_array(x||jsonb_build_object('file',file,'submissionId',submission,'reasons',to_jsonb(item_reasons)));
    IF 'material_unavailable'=ANY(item_reasons) AND NOT 'material_unavailable'=ANY(reasons) THEN reasons:=array_append(reasons,'material_unavailable'); END IF;
    IF 'file_unavailable'=ANY(item_reasons) AND NOT 'file_unavailable'=ANY(reasons) THEN reasons:=array_append(reasons,'file_unavailable'); END IF;
    IF 'previous_submission_changed'=ANY(item_reasons) AND NOT 'previous_submission_changed'=ANY(reasons) THEN reasons:=array_append(reasons,'previous_submission_changed'); END IF;
  END LOOP;
  RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,
    'requirements',requirements,'documentItems',docs->'items','latestPackage',platform_private.application_package_summary(latest),
    'selections',result,'missingRequiredItemIds',to_jsonb(missing),'reasons',to_jsonb(reasons),'canSubmit',may_submit AND cardinality(reasons)=0);
END $$;

CREATE FUNCTION platform.application_package_detail_v1(p_student_case_id UUID,p_application_id UUID,p_package_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; p platform_private.application_package_submissions%ROWTYPE; i platform_private.application_package_items%ROWTYPE;
  summary JSONB; submission JSONB; evidence JSONB; items JSONB:='[]'; warnings JSONB:='[]';
BEGIN
  SELECT * INTO a FROM platform_private.application_package_actor(p_student_case_id,p_application_id,'document.read.full');
  SELECT * INTO p FROM platform_private.application_package_submissions WHERE id=p_package_id AND organization_id=a.organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  summary:=platform_private.application_package_summary(p.id);
  FOR i IN SELECT * FROM platform_private.application_package_items WHERE package_id=p.id ORDER BY position LOOP
    submission:=platform_private.application_document_submission_summary(i.submission_id);
    items:=items||jsonb_build_array(jsonb_build_object('packageItemId',i.id,'requirementItemId',i.requirement_item_id,
      'definition',i.definition,'materialSnapshot',i.material_snapshot,'selection',i.selection,'submission',submission));
    SELECT value INTO evidence FROM jsonb_array_elements(summary->'latestReview'->'documentReviews') WHERE value->>'requirementItemId'=i.requirement_item_id::TEXT;
    IF evidence IS NOT NULL AND evidence->'review' IS DISTINCT FROM submission->'review' THEN
      warnings:=warnings||jsonb_build_array(jsonb_build_object('requirementItemId',i.requirement_item_id,'submissionId',i.submission_id,'reason','review_changed','currentReview',submission->'review'));
    END IF;
    IF submission->'file'->>'technicalAvailability'<>'available' THEN
      warnings:=warnings||jsonb_build_array(jsonb_build_object('requirementItemId',i.requirement_item_id,'submissionId',i.submission_id,'reason','file_unavailable','currentReview',submission->'review'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,
    'package',summary,'program',p.program_snapshot,'items',items,'currentWarnings',warnings);
END $$;

CREATE FUNCTION platform.application_package_history_v1(p_student_case_id UUID,p_application_id UUID,p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; x RECORD; result JSONB:='[]'; cursor JSONB; n INTEGER:=0;
BEGIN
  SELECT * INTO a FROM platform_private.application_package_actor(p_student_case_id,p_application_id,'document.read.full');
  PERFORM platform_private.application_package_cursor(p_cursor,p_limit);
  FOR x IN SELECT * FROM platform_private.application_package_submissions WHERE organization_id=a.organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id
    AND (p_cursor IS NULL OR (submitted_at,id)<((p_cursor->>'createdAt')::TIMESTAMPTZ,(p_cursor->>'id')::UUID)) ORDER BY submitted_at DESC,id DESC LIMIT p_limit+1 LOOP
    n:=n+1; IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'packages',result,'nextCursor',cursor); END IF;
    result:=result||jsonb_build_array(platform_private.application_package_summary(x.id)); cursor:=jsonb_build_object('createdAt',x.submitted_at,'id',x.id);
  END LOOP;
  RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'packages',result,'nextCursor',NULL);
END $$;
CREATE FUNCTION platform.application_package_review_history_v1(p_student_case_id UUID,p_application_id UUID,p_package_id UUID,p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; x RECORD; result JSONB:='[]'; cursor JSONB; n INTEGER:=0;
BEGIN
  SELECT * INTO a FROM platform_private.application_package_actor(p_student_case_id,p_application_id,'document.read.full');
  PERFORM platform_private.application_package_cursor(p_cursor,p_limit);
  IF NOT EXISTS(SELECT 1 FROM platform_private.application_package_submissions WHERE id=p_package_id AND organization_id=a.organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id)
  THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  FOR x IN SELECT * FROM platform_private.application_package_reviews WHERE package_id=p_package_id
    AND (p_cursor IS NULL OR (reviewed_at,id)<((p_cursor->>'createdAt')::TIMESTAMPTZ,(p_cursor->>'id')::UUID)) ORDER BY reviewed_at DESC,id DESC LIMIT p_limit+1 LOOP
    n:=n+1; IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'packageId',p_package_id,'reviews',result,'nextCursor',cursor); END IF;
    result:=result||jsonb_build_array(platform_private.application_package_review_summary(x.id)); cursor:=jsonb_build_object('createdAt',x.reviewed_at,'id',x.id);
  END LOOP;
  RETURN jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,'packageId',p_package_id,'reviews',result,'nextCursor',NULL);
END $$;
CREATE FUNCTION platform.application_package_queue_v1(p_cursor JSONB DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; x RECORD; result JSONB:='[]'; cursor JSONB; n INTEGER:=0;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role='student' OR NOT private.platform_has_permission(a.organization_id,'document.read.full') THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.application_package_cursor(p_cursor,p_limit);
  FOR x IN SELECT p.*,c.student_display_name FROM platform_private.application_package_submissions p
    JOIN platform.student_cases c ON c.organization_id=p.organization_id AND c.id=p.student_case_id
    WHERE p.organization_id=a.organization_id AND platform_private.staff_can_access_for_actor(a.organization_id,'document.read.full','student_case',p.student_case_id)
      AND NOT EXISTS(SELECT 1 FROM platform_private.application_package_reviews r WHERE r.package_id=p.id)
      AND (p_cursor IS NULL OR (p.submitted_at,p.id)<((p_cursor->>'createdAt')::TIMESTAMPTZ,(p_cursor->>'id')::UUID))
    ORDER BY p.submitted_at DESC,p.id DESC LIMIT p_limit+1 LOOP
    n:=n+1; IF n>p_limit THEN RETURN jsonb_build_object('protocolVersion',1,'items',result,'nextCursor',cursor); END IF;
    result:=result||jsonb_build_array(jsonb_build_object('studentCaseId',x.student_case_id,'applicationId',x.application_id,
      'studentDisplayName',x.student_display_name,'program',x.program_snapshot,'package',platform_private.application_package_summary(x.id)));
    cursor:=jsonb_build_object('createdAt',x.submitted_at,'id',x.id);
  END LOOP;
  RETURN jsonb_build_object('protocolVersion',1,'items',result,'nextCursor',NULL);
END $$;

CREATE FUNCTION platform.application_package_submit_v1(p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; request UUID; case_id UUID; application UUID; revision UUID; latest platform_private.application_package_submissions%ROWTYPE;
  x JSONB; i platform_private.application_requirement_items%ROWTYPE; proof JSONB; intent JSONB; receipt JSONB;
  composition JSONB:='[]'; pending_items JSONB:='[]'; receipt_items JSONB:='[]'; child JSONB; sha TEXT; new_id UUID:=gen_random_uuid();
  new_item UUID; next_version BIGINT; at TIMESTAMPTZ:=statement_timestamp(); position INTEGER:=0;
BEGIN
  PERFORM platform_private.application_package_intent('submit',p_intent);
  request:=(p_intent->>'requestId')::UUID; case_id:=(p_intent->>'studentCaseId')::UUID; application:=(p_intent->>'applicationId')::UUID;
  PERFORM platform_private.application_package_prelock('submit',p_intent);
  PERFORM platform_private.application_document_lock(case_id,application,NULL,request,'document.upload');
  SELECT * INTO a FROM platform_private.application_package_actor(case_id,application,'document.upload');
  intent:=p_intent||jsonb_build_object('actorMembershipId',a.membership_id);
  receipt:=platform_private.application_package_replay(request,a.organization_id,'application.package.submit',application,intent);
  IF receipt IS NOT NULL THEN RETURN receipt; END IF;
  SELECT r.id INTO revision FROM platform_private.application_requirement_revisions r WHERE r.organization_id=a.organization_id AND r.application_id=application ORDER BY r.revision_version DESC LIMIT 1;
  IF revision IS DISTINCT FROM (p_intent->>'requirementsRevisionId')::UUID THEN RAISE EXCEPTION 'application_package_stale_requirements' USING ERRCODE='PT409'; END IF;
  -- Prelock all current definition slots, selected canonical versions and all
  -- selected-item submissions before the first228 child command. Excluded
  -- optional slots are serialized here but are not a readiness prerequisite.
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=a.organization_id AND s.student_case_id=case_id
    AND s.id IN(SELECT document_slot_id FROM platform_private.application_requirement_items WHERE revision_id=revision) ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=a.organization_id AND v.student_case_id=case_id
    AND v.id IN(SELECT (value->'selection'->>'documentVersionId')::UUID FROM jsonb_array_elements(p_intent->'items')) ORDER BY v.id FOR UPDATE;
  PERFORM 1 FROM platform_private.application_document_submissions s WHERE s.organization_id=a.organization_id AND s.application_id=application
    AND s.requirement_item_id IN(SELECT (value->>'requirementItemId')::UUID FROM jsonb_array_elements(p_intent->'items')) ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM platform_private.application_package_actor(case_id,application,'document.upload');
  proof:=platform.application_package_readiness_v1(case_id,application,p_intent->'items');
  IF proof->'reasons' ? 'previous_submission_changed' THEN RAISE EXCEPTION 'application_package_previous_submission_changed' USING ERRCODE='PT409'; END IF;
  IF (proof->>'canSubmit')::BOOLEAN IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'application_package_not_ready' USING ERRCODE='PT409'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_intent->'items') LOOP
    SELECT * INTO STRICT i FROM platform_private.application_requirement_items WHERE id=(x->>'requirementItemId')::UUID;
    composition:=composition||jsonb_build_array(jsonb_build_object('requirementItemId',i.id,'documentSlotId',i.document_slot_id,'documentVersionId',x->'selection'->'documentVersionId'));
  END LOOP;
  sha:=platform_private.bw1_input_sha256(jsonb_build_object('requirementsRevisionId',revision,'items',composition));
  SELECT * INTO latest FROM platform_private.application_package_submissions WHERE organization_id=a.organization_id AND application_id=application ORDER BY package_version DESC LIMIT 1;
  IF latest.id IS NOT NULL AND latest.requirements_revision_id=revision AND latest.composition_sha256=sha AND latest.composition=composition THEN
    receipt:=latest.receipt||jsonb_build_object('requestId',request,'reused',TRUE);
    -- New request, identical composition: immutable alias audit; future exact
    -- replay can prove this intent without inventing a second package row.
    PERFORM platform_private.application_document_audit(request,a.organization_id,a.profile_id,'application.package.submit',application,intent,receipt);
    RETURN receipt;
  END IF;
  IF latest.id IS DISTINCT FROM (p_intent->>'expectedPreviousPackageId')::UUID THEN RAISE EXCEPTION 'application_package_previous_package_changed' USING ERRCODE='PT409'; END IF;
  next_version:=COALESCE(latest.package_version,0)+1;
  at:=GREATEST(clock_timestamp(),COALESCE(latest.submitted_at+'1 microsecond'::INTERVAL,clock_timestamp()));
  FOR x IN SELECT value FROM jsonb_array_elements(p_intent->'items') LOOP
    SELECT * INTO STRICT i FROM platform_private.application_requirement_items WHERE id=(x->>'requirementItemId')::UUID;
    child:=platform.submit_application_document_v1(case_id,application,revision,i.id,x->'selection',(x->>'expectedPreviousSubmissionId')::UUID,
      public.uuid_generate_v5(request,'application-package:submit:'||i.id::TEXT));
    new_item:=gen_random_uuid(); position:=position+1;
    receipt_items:=receipt_items||jsonb_build_array(jsonb_build_object('packageItemId',new_item,'requirementItemId',i.id,'documentSlotId',i.document_slot_id,'documentVersionId',child->'documentVersionId','submissionId',child->'submissionId'));
    pending_items:=pending_items||jsonb_build_array(jsonb_build_object('id',new_item,'item',i.id,'slot',i.document_slot_id,'version',child->'documentVersionId',
      'submission',child->'submissionId','selection',x->'selection','position',position,'definition',platform_private.requirements_editor_definition(i),'materialSnapshot',i.material_snapshot));
  END LOOP;
  receipt:=jsonb_build_object('protocolVersion',1,'requestId',request,'studentCaseId',case_id,'applicationId',application,'packageId',new_id,
    'requirementsRevisionId',revision,'packageVersion',next_version::TEXT,'compositionSha256',sha,'submittedAt',at,'reused',FALSE,'items',receipt_items);
  INSERT INTO platform_private.application_package_submissions(id,request_id,organization_id,student_case_id,application_id,requirements_revision_id,
    package_version,previous_package_id,composition_sha256,composition,program_snapshot,submitted_by_membership_id,submitted_at,intent,receipt)
  VALUES(new_id,request,a.organization_id,case_id,application,revision,next_version,latest.id,sha,composition,
    platform_private.application_package_program(a.organization_id,application),a.membership_id,at,intent,receipt);
  FOR x IN SELECT value FROM jsonb_array_elements(pending_items) LOOP
    INSERT INTO platform_private.application_package_items(id,organization_id,student_case_id,application_id,package_id,requirements_revision_id,
      requirement_item_id,position,document_slot_id,document_version_id,submission_id,selection,definition,material_snapshot)
    VALUES((x->>'id')::UUID,a.organization_id,case_id,application,new_id,revision,(x->>'item')::UUID,(x->>'position')::INTEGER,
      (x->>'slot')::UUID,(x->>'version')::UUID,(x->>'submission')::UUID,x->'selection',x->'definition',NULLIF(x->'materialSnapshot','null'::JSONB));
  END LOOP;
  PERFORM platform_private.application_document_audit(request,a.organization_id,a.profile_id,'application.package.submit',application,intent,receipt);
  RETURN receipt;
END $$;

-- Prove EVERY predecessor edge, including material metadata;228's ancestry
-- alone deliberately is not proof that an older review remains applicable.
CREATE FUNCTION platform_private.application_package_reuse_proof(p_current UUID,p_source UUID,p_source_review UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_submission platform_private.application_document_submissions%ROWTYPE;
  source_submission platform_private.application_document_submissions%ROWTYPE;
  item platform_private.application_requirement_items%ROWTYPE; previous platform_private.application_requirement_items%ROWTYPE;
  revision platform_private.application_requirement_revisions%ROWTYPE; previous_revision platform_private.application_requirement_revisions%ROWTYPE;
  source_review platform_private.application_document_submission_reviews%ROWTYPE; current_review platform_private.application_document_submission_reviews%ROWTYPE;
  current_material JSONB; previous_material JSONB;
BEGIN
  SELECT * INTO current_submission FROM platform_private.application_document_submissions WHERE id=p_current;
  SELECT * INTO source_submission FROM platform_private.application_document_submissions WHERE id=p_source;
  IF current_submission.id IS NULL OR source_submission.id IS NULL OR current_submission.id=source_submission.id
    OR (current_submission.organization_id,current_submission.student_case_id,current_submission.application_id,current_submission.document_slot_id,current_submission.document_version_id)
       IS DISTINCT FROM (source_submission.organization_id,source_submission.student_case_id,source_submission.application_id,source_submission.document_slot_id,source_submission.document_version_id)
  THEN RETURN FALSE; END IF;
  SELECT * INTO source_review FROM platform_private.application_document_submission_reviews WHERE submission_id=p_source ORDER BY reviewed_at DESC,id DESC LIMIT 1;
  SELECT * INTO current_review FROM platform_private.application_document_submission_reviews WHERE submission_id=p_current ORDER BY reviewed_at DESC,id DESC LIMIT 1;
  IF source_review.id IS DISTINCT FROM p_source_review OR source_review.decision IS DISTINCT FROM 'approved'
    OR (current_review.id IS NOT NULL AND current_review.decision<>'approved') THEN RETURN FALSE; END IF;
  SELECT * INTO item FROM platform_private.application_requirement_items WHERE id=current_submission.requirement_item_id;
  LOOP
    IF item.id=source_submission.requirement_item_id THEN RETURN TRUE; END IF;
    SELECT * INTO revision FROM platform_private.application_requirement_revisions WHERE id=item.revision_id;
    IF item.predecessor_item_id IS NULL OR revision.previous_revision_id IS NULL THEN RETURN FALSE; END IF;
    SELECT * INTO previous FROM platform_private.application_requirement_items WHERE id=item.predecessor_item_id
      AND organization_id=item.organization_id AND student_case_id=item.student_case_id AND application_id=item.application_id;
    IF NOT FOUND OR platform_private.requirements_editor_definition(item) IS DISTINCT FROM platform_private.requirements_editor_definition(previous) THEN RETURN FALSE; END IF;
    SELECT * INTO previous_revision FROM platform_private.application_requirement_revisions WHERE id=previous.revision_id;
    IF previous_revision.id IS DISTINCT FROM revision.previous_revision_id OR previous_revision.revision_version>=revision.revision_version THEN RETURN FALSE; END IF;
    current_material:=COALESCE(item.material_snapshot,jsonb_build_object('intentKind','custom','requirementId',NULL,'rawLabel',item.label,'rawGroupLabel',item.group_label,
      'label',item.label,'groupLabel',item.group_label,'sourceRequirementKey',NULL,'sourceChecklistVersion',NULL,'sourceInstructions',NULL));
    previous_material:=COALESCE(previous.material_snapshot,jsonb_build_object('intentKind','custom','requirementId',NULL,'rawLabel',previous.label,'rawGroupLabel',previous.group_label,
      'label',previous.label,'groupLabel',previous.group_label,'sourceRequirementKey',NULL,'sourceChecklistVersion',NULL,'sourceInstructions',NULL));
    IF current_material IS DISTINCT FROM previous_material THEN RETURN FALSE; END IF;
    item:=previous;
  END LOOP;
END $$;

CREATE FUNCTION platform.application_package_review_v1(p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; request UUID; case_id UUID; application UUID; target_package UUID; intent JSONB; receipt JSONB;
  p platform_private.application_package_submissions%ROWTYPE; item platform_private.application_package_items%ROWTYPE;
  requirement platform_private.application_requirement_items%ROWTYPE; slot platform.document_slots%ROWTYPE;
  latest UUID; current_review platform_private.application_document_submission_reviews%ROWTYPE; expected JSONB; reuse JSONB;
  evidence JSONB:='[]'; child JSONB; review_id UUID:=gen_random_uuid(); at TIMESTAMPTZ:=statement_timestamp(); item_index INTEGER:=0;
  decision TEXT; review_summary JSONB; source_ids UUID[]:=ARRAY[]::UUID[];
BEGIN
  PERFORM platform_private.application_package_intent('review',p_intent);
  request:=(p_intent->>'requestId')::UUID; case_id:=(p_intent->>'studentCaseId')::UUID; application:=(p_intent->>'applicationId')::UUID;
  target_package:=(p_intent->>'packageId')::UUID; decision:=p_intent->>'decision';
  PERFORM platform_private.application_package_prelock('review',p_intent);
  PERFORM platform_private.application_document_lock(case_id,application,NULL,request,'document.review');
  SELECT * INTO a FROM platform_private.application_package_actor(case_id,application,'document.review');
  intent:=p_intent||jsonb_build_object('actorMembershipId',a.membership_id);
  receipt:=platform_private.application_package_replay(request,a.organization_id,'application.package.review',application,intent);
  IF receipt IS NOT NULL THEN RETURN receipt; END IF;
  SELECT * INTO p FROM platform_private.application_package_submissions WHERE id=target_package AND organization_id=a.organization_id AND student_case_id=case_id AND application_id=application;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(array_agg((value->>'sourceSubmissionId')::UUID),ARRAY[]::UUID[]) INTO source_ids FROM jsonb_array_elements(p_intent->'reuseApprovals');
  -- Only same-case/application source candidates are locked. Full correlation
  -- and lineage are proven below before any review write.
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=a.organization_id AND s.student_case_id=case_id
    AND (s.id IN(SELECT document_slot_id FROM platform_private.application_package_items WHERE package_id=p.id)
      OR s.id IN(SELECT document_slot_id FROM platform_private.application_document_submissions WHERE id=ANY(source_ids) AND organization_id=a.organization_id AND application_id=application)) ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=a.organization_id AND v.student_case_id=case_id
    AND (v.id IN(SELECT document_version_id FROM platform_private.application_package_items WHERE package_id=p.id)
      OR v.id IN(SELECT document_version_id FROM platform_private.application_document_submissions WHERE id=ANY(source_ids) AND organization_id=a.organization_id AND application_id=application)) ORDER BY v.id FOR UPDATE;
  PERFORM 1 FROM platform_private.application_document_submissions s WHERE s.organization_id=a.organization_id AND s.application_id=application
    AND (s.id IN(SELECT submission_id FROM platform_private.application_package_items WHERE package_id=p.id) OR s.id=ANY(source_ids)) ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM platform_private.application_package_actor(case_id,application,'document.review');
  SELECT id INTO latest FROM platform_private.application_package_reviews WHERE package_id=p.id ORDER BY reviewed_at DESC,id DESC LIMIT 1;
  IF latest IS DISTINCT FROM (p_intent->>'expectedPreviousReviewId')::UUID THEN RAISE EXCEPTION 'application_package_previous_review_changed' USING ERRCODE='PT409'; END IF;
  IF jsonb_array_length(p_intent->'documentReviews')<>jsonb_array_length(p.composition)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_intent->'affectedItemIds') x WHERE NOT EXISTS(SELECT 1 FROM platform_private.application_package_items WHERE package_id=p.id AND requirement_item_id=x::UUID))
  THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  -- Validate the complete expected vector and every reuse proof BEFORE child
  -- writes. Locks prevent a later concurrent negative review passing unnoticed.
  FOR item IN SELECT * FROM platform_private.application_package_items WHERE package_id=p.id ORDER BY position LOOP
    expected:=p_intent->'documentReviews'->item_index; item_index:=item_index+1;
    IF expected->>'requirementItemId' IS DISTINCT FROM item.requirement_item_id::TEXT OR expected->>'submissionId' IS DISTINCT FROM item.submission_id::TEXT
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    SELECT * INTO current_review FROM platform_private.application_document_submission_reviews WHERE submission_id=item.submission_id ORDER BY reviewed_at DESC,id DESC LIMIT 1;
    IF current_review.id IS DISTINCT FROM (expected->>'expectedReviewId')::UUID THEN RAISE EXCEPTION 'application_package_document_review_changed' USING ERRCODE='PT409'; END IF;
    SELECT value INTO reuse FROM jsonb_array_elements(p_intent->'reuseApprovals') WHERE value->>'requirementItemId'=item.requirement_item_id::TEXT;
    IF reuse IS NOT NULL AND NOT platform_private.application_package_reuse_proof(item.submission_id,(reuse->>'sourceSubmissionId')::UUID,(reuse->>'sourceReviewId')::UUID)
    THEN RAISE EXCEPTION 'application_package_reuse_unavailable' USING ERRCODE='PT409'; END IF;
    IF decision='approved' THEN
      SELECT * INTO STRICT requirement FROM platform_private.application_requirement_items WHERE id=item.requirement_item_id;
      SELECT * INTO slot FROM platform.document_slots WHERE id=item.document_slot_id AND organization_id=a.organization_id AND student_case_id=case_id;
      IF slot.id IS NULL OR slot.removed_at IS NOT NULL OR NOT platform_private.requirements_editor_item_matches(slot,requirement)
        OR NOT EXISTS(SELECT 1 FROM platform.document_slot_case_links WHERE organization_id=a.organization_id AND student_case_id=case_id AND document_slot_id=item.document_slot_id AND university_application_id=application)
        OR platform_private.application_document_file(a.organization_id,item.document_version_id)->>'technicalAvailability'<>'available'
        OR (current_review.decision IS DISTINCT FROM 'approved' AND reuse IS NULL)
      THEN RAISE EXCEPTION 'application_package_review_not_ready' USING ERRCODE='PT409'; END IF;
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM platform_private.application_package_items WHERE package_id=p.id ORDER BY position LOOP
    SELECT * INTO current_review FROM platform_private.application_document_submission_reviews WHERE submission_id=item.submission_id ORDER BY reviewed_at DESC,id DESC LIMIT 1;
    SELECT value INTO reuse FROM jsonb_array_elements(p_intent->'reuseApprovals') WHERE value->>'requirementItemId'=item.requirement_item_id::TEXT;
    IF reuse IS NOT NULL AND current_review.id IS NULL THEN
      child:=platform.review_application_document_submission_v1(item.submission_id,NULL,'approved',NULL,
        public.uuid_generate_v5(request,'application-package:review:'||item.requirement_item_id::TEXT));
      SELECT * INTO STRICT current_review FROM platform_private.application_document_submission_reviews WHERE id=(child->>'reviewId')::UUID;
    END IF;
    evidence:=evidence||jsonb_build_array(jsonb_build_object('requirementItemId',item.requirement_item_id,'submissionId',item.submission_id,
      'review',platform_private.application_package_document_review(current_review.id),
      'reusedFromSubmissionId',reuse->'sourceSubmissionId','reusedFromReview',platform_private.application_package_document_review((reuse->>'sourceReviewId')::UUID)));
  END LOOP;
  SELECT GREATEST(clock_timestamp(),COALESCE(MAX(reviewed_at)+'1 microsecond'::INTERVAL,clock_timestamp())) INTO at FROM platform_private.application_package_reviews WHERE package_id=p.id;
  review_summary:=jsonb_build_object('packageReviewId',review_id,'packageId',p.id,'decision',decision,'reason',p_intent->'reason',
    'affectedItemIds',p_intent->'affectedItemIds','documentReviews',evidence,'reviewedAt',at);
  receipt:=jsonb_build_object('protocolVersion',1,'requestId',request,'studentCaseId',case_id,'applicationId',application,'packageId',p.id,'packageReview',review_summary);
  INSERT INTO platform_private.application_package_reviews(id,request_id,organization_id,student_case_id,application_id,package_id,previous_review_id,
    reviewer_membership_id,decision,reason,affected_item_ids,document_reviews,reviewed_at,intent,receipt)
  VALUES(review_id,request,a.organization_id,case_id,application,p.id,latest,a.membership_id,decision,p_intent->>'reason',p_intent->'affectedItemIds',evidence,at,intent,receipt);
  PERFORM platform_private.application_document_audit(request,a.organization_id,a.profile_id,'application.package.review',application,intent,receipt);
  RETURN receipt;
END $$;

CREATE FUNCTION platform.application_package_recover_v1(p_operation TEXT,p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; receipt JSONB; request UUID; case_id UUID; application UUID; intent JSONB; permission TEXT;
BEGIN
  PERFORM platform_private.application_package_intent(p_operation,p_intent);
  request:=(p_intent->>'requestId')::UUID; case_id:=(p_intent->>'studentCaseId')::UUID; application:=(p_intent->>'applicationId')::UUID;
  permission:=CASE WHEN p_operation='submit' THEN 'document.upload' ELSE 'document.review' END;
  -- Never re-execute a command here. Exact absence is observed only after the
  -- parent request and ordinary writer authority locks; stale revision is irrelevant.
  PERFORM platform_private.application_document_lock(case_id,application,NULL,request,permission);
  SELECT * INTO a FROM platform_private.application_package_actor(case_id,application,permission);
  intent:=p_intent||jsonb_build_object('actorMembershipId',a.membership_id);
  receipt:=platform_private.application_package_replay(request,a.organization_id,'application.package.'||p_operation,application,intent);
  RETURN jsonb_build_object('protocolVersion',1,'operation',p_operation,'requestId',request,'studentCaseId',case_id,'applicationId',application,'status',CASE WHEN receipt IS NULL THEN 'not_written' ELSE 'committed' END,'receipt',receipt);
END $$;

-- Private INSERT guards correlate immutable snapshots with their canonical
-- identities. No caller can manufacture evidence by mixing same-tenant rows.
CREATE FUNCTION platform_private.application_package_insert_guard()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE p platform_private.application_package_submissions%ROWTYPE; i platform_private.application_requirement_items%ROWTYPE;
  s platform_private.application_document_submissions%ROWTYPE; r platform_private.application_document_submission_reviews%ROWTYPE;
  x JSONB; n INTEGER; expected JSONB;
BEGIN
  IF TG_TABLE_NAME='application_package_submissions' THEN
    IF NEW.program_snapshot IS DISTINCT FROM platform_private.application_package_program(NEW.organization_id,NEW.application_id)
      OR NEW.composition_sha256 IS DISTINCT FROM platform_private.bw1_input_sha256(jsonb_build_object('requirementsRevisionId',NEW.requirements_revision_id,'items',NEW.composition))
      OR NEW.receipt->>'packageId' IS DISTINCT FROM NEW.id::TEXT
      OR NEW.receipt->>'requestId' IS DISTINCT FROM NEW.request_id::TEXT
      OR NEW.intent->>'actorMembershipId' IS DISTINCT FROM NEW.submitted_by_membership_id::TEXT
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    IF NEW.previous_package_id IS NULL THEN
      IF NEW.package_version<>1 THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    ELSE
      SELECT * INTO STRICT p FROM platform_private.application_package_submissions WHERE id=NEW.previous_package_id;
      IF (p.organization_id,p.student_case_id,p.application_id,p.package_version+1) IS DISTINCT FROM (NEW.organization_id,NEW.student_case_id,NEW.application_id,NEW.package_version)
      THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='application_package_items' THEN
    SELECT * INTO STRICT p FROM platform_private.application_package_submissions WHERE id=NEW.package_id;
    SELECT * INTO STRICT i FROM platform_private.application_requirement_items WHERE id=NEW.requirement_item_id;
    SELECT * INTO STRICT s FROM platform_private.application_document_submissions WHERE id=NEW.submission_id;
    IF (NEW.organization_id,NEW.student_case_id,NEW.application_id,NEW.requirements_revision_id) IS DISTINCT FROM (p.organization_id,p.student_case_id,p.application_id,p.requirements_revision_id)
      OR (i.organization_id,i.student_case_id,i.application_id,i.revision_id,i.document_slot_id) IS DISTINCT FROM (NEW.organization_id,NEW.student_case_id,NEW.application_id,NEW.requirements_revision_id,NEW.document_slot_id)
      OR (s.organization_id,s.student_case_id,s.application_id,s.requirements_revision_id,s.requirement_item_id,s.document_slot_id,s.document_version_id)
        IS DISTINCT FROM (NEW.organization_id,NEW.student_case_id,NEW.application_id,NEW.requirements_revision_id,NEW.requirement_item_id,NEW.document_slot_id,NEW.document_version_id)
      OR NEW.definition IS DISTINCT FROM platform_private.requirements_editor_definition(i) OR NEW.material_snapshot IS DISTINCT FROM i.material_snapshot
      OR NEW.selection IS DISTINCT FROM p.intent->'items'->(NEW.position-1)->'selection'
      OR p.composition->(NEW.position-1) IS DISTINCT FROM jsonb_build_object('requirementItemId',i.id,'documentSlotId',i.document_slot_id,'documentVersionId',NEW.document_version_id)
      OR p.receipt->'items'->(NEW.position-1) IS DISTINCT FROM jsonb_build_object('packageItemId',NEW.id,'requirementItemId',i.id,'documentSlotId',i.document_slot_id,'documentVersionId',NEW.document_version_id,'submissionId',s.id)
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
  ELSE
    SELECT * INTO STRICT p FROM platform_private.application_package_submissions WHERE id=NEW.package_id;
    IF (NEW.organization_id,NEW.student_case_id,NEW.application_id) IS DISTINCT FROM (p.organization_id,p.student_case_id,p.application_id)
      OR NEW.intent->>'actorMembershipId' IS DISTINCT FROM NEW.reviewer_membership_id::TEXT
      OR jsonb_array_length(NEW.document_reviews)<>jsonb_array_length(p.composition)
      OR (NEW.previous_review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_private.application_package_reviews WHERE id=NEW.previous_review_id AND package_id=p.id))
    THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
    n:=0;
    FOR x IN SELECT value FROM jsonb_array_elements(NEW.document_reviews) LOOP
      SELECT * INTO STRICT s FROM platform_private.application_document_submissions WHERE id=(x->>'submissionId')::UUID;
      IF NOT EXISTS(SELECT 1 FROM platform_private.application_package_items WHERE package_id=p.id AND position=n+1 AND requirement_item_id=(x->>'requirementItemId')::UUID AND submission_id=s.id)
        OR x->'review' IS DISTINCT FROM COALESCE(platform_private.application_package_document_review((x->'review'->>'reviewId')::UUID),'null'::JSONB)
      THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
      IF x->'review'<>'null'::JSONB AND NOT EXISTS(SELECT 1 FROM platform_private.application_document_submission_reviews WHERE id=(x->'review'->>'reviewId')::UUID AND submission_id=s.id)
      THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
      IF NEW.decision='approved' AND x->'review'->>'decision' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'application_package_review_not_ready' USING ERRCODE='PT409'; END IF;
      IF x->'reusedFromSubmissionId'<>'null'::JSONB THEN
        SELECT * INTO r FROM platform_private.application_document_submission_reviews WHERE id=(x->'reusedFromReview'->>'reviewId')::UUID AND submission_id=(x->>'reusedFromSubmissionId')::UUID;
        IF r.id IS NULL OR x->'reusedFromReview' IS DISTINCT FROM platform_private.application_package_document_review(r.id)
        THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
      ELSIF x->'reusedFromReview'<>'null'::JSONB THEN RAISE EXCEPTION 'application_package_invalid_intent' USING ERRCODE='22023'; END IF;
      n:=n+1;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER application_package_submission_insert BEFORE INSERT ON platform_private.application_package_submissions FOR EACH ROW EXECUTE FUNCTION platform_private.application_package_insert_guard();
CREATE TRIGGER application_package_item_insert BEFORE INSERT ON platform_private.application_package_items FOR EACH ROW EXECUTE FUNCTION platform_private.application_package_insert_guard();
CREATE TRIGGER application_package_review_insert BEFORE INSERT ON platform_private.application_package_reviews FOR EACH ROW EXECUTE FUNCTION platform_private.application_package_insert_guard();

CREATE FUNCTION platform_private.publish_application_package_review_notification()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE p platform_private.application_package_submissions%ROWTYPE; recipient UUID; n UUID;
BEGIN
  SELECT * INTO STRICT p FROM platform_private.application_package_submissions WHERE id=NEW.package_id AND organization_id=NEW.organization_id;
  SELECT student_membership_id INTO recipient FROM platform.student_cases WHERE organization_id=p.organization_id AND id=p.student_case_id;
  IF recipient IS NULL THEN RETURN NEW; END IF;
  INSERT INTO platform.notifications(organization_id,student_case_id,recipient_membership_id,category,title,body,dedupe_key,created_by_membership_id,created_at,updated_at)
  VALUES(p.organization_id,p.student_case_id,recipient,'application.package.review',p.program_snapshot->>'programTitle',
    CASE NEW.decision WHEN 'approved' THEN 'Комплект документов проверен EVO.' ELSE NEW.reason END,
    'application_package_review:'||NEW.id::TEXT,NEW.reviewer_membership_id,NEW.reviewed_at,NEW.reviewed_at) RETURNING id INTO n;
  INSERT INTO platform.notification_events(organization_id,notification_id,student_case_id,recipient_membership_id,event_type,actor_membership_id,reason,request_id)
  VALUES(p.organization_id,n,p.student_case_id,recipient,'created',NEW.reviewer_membership_id,'EVO reviewed the exact program package',NEW.request_id);
  RETURN NEW;
END $$;
CREATE TRIGGER application_package_review_notification AFTER INSERT ON platform_private.application_package_reviews FOR EACH ROW EXECUTE FUNCTION platform_private.publish_application_package_review_notification();
CREATE FUNCTION platform_private.own_application_package_notifications()
RETURNS TABLE(notification_id UUID,review_id UUID,package_id UUID,student_case_id UUID,category TEXT,event_code TEXT,subject_label TEXT,detail TEXT,due_at TIMESTAMPTZ,created_at TIMESTAMPTZ,read_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT n.id,r.id,p.id,p.student_case_id,n.category,'application_package_review'::TEXT,p.program_snapshot->>'programTitle',r.reason,NULL::TIMESTAMPTZ,n.created_at,n.read_at
  FROM platform.current_actor_authority() a
  JOIN platform.notifications n ON n.organization_id=a.organization_id AND n.recipient_membership_id=a.membership_id
  JOIN platform.notification_events e ON e.organization_id=n.organization_id AND e.notification_id=n.id AND e.student_case_id=n.student_case_id AND e.recipient_membership_id=n.recipient_membership_id AND e.event_type='created'
  JOIN platform_private.application_package_reviews r ON r.organization_id=n.organization_id AND r.student_case_id=n.student_case_id AND r.request_id=e.request_id AND r.reviewer_membership_id=n.created_by_membership_id AND r.reviewer_membership_id=e.actor_membership_id
  JOIN platform_private.application_package_submissions p ON p.id=r.package_id AND p.organization_id=r.organization_id AND p.student_case_id=r.student_case_id AND p.application_id=r.application_id
  JOIN platform.student_cases c ON c.organization_id=p.organization_id AND c.id=p.student_case_id AND c.student_membership_id=a.membership_id
  WHERE a.platform_role='student' AND n.category='application.package.review' AND n.dedupe_key='application_package_review:'||r.id::TEXT
    AND private.platform_has_permission(a.organization_id,'notification.read.self') AND private.platform_can_read_student_portal_case(a.organization_id,c.id)
$$;
CREATE FUNCTION platform.application_package_notification_v1(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; case_id UUID; application UUID;
BEGIN
  SELECT p.student_case_id,p.application_id,jsonb_build_object('protocolVersion',1,'notificationId',n.notification_id,'studentCaseId',p.student_case_id,
    'applicationId',p.application_id,'packageId',p.id,'packageReviewId',r.id,'review',platform_private.application_package_review_summary(r.id))
  INTO case_id,application,result FROM platform_private.own_application_package_notifications() n
    JOIN platform_private.application_package_reviews r ON r.id=n.review_id JOIN platform_private.application_package_submissions p ON p.id=r.package_id WHERE n.notification_id=p_notification_id;
  IF result IS NULL THEN RAISE EXCEPTION 'application_packages_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform_private.application_package_actor(case_id,application,'document.read.full');
  RETURN result;
END $$;

-- Amend only the two existing153 notification projections. Fail closed on
-- drift; preserve their existing branch order, output columns and replay paths.
CREATE FUNCTION pg_temp.b3g_replace(p_text TEXT,p_old TEXT,p_new TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF (length(p_text)-length(replace(p_text,p_old,'')))/length(p_old)<>1 THEN RAISE EXCEPTION 'B3g notification source drift'; END IF;
  RETURN replace(p_text,p_old,p_new);
END $$;
DO $notifications$ DECLARE signature TEXT; definition TEXT; body TEXT; original TEXT; BEGIN
  signature:='platform.student_portal_notifications_v2()';
  SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,original FROM pg_proc WHERE oid=signature::REGPROCEDURE;
  body:=pg_temp.b3g_replace(original,$old$    FROM platform_private.own_application_document_notifications() n$old$,$new$    FROM platform_private.own_application_document_notifications() n
    UNION ALL
    SELECT n.notification_id,n.category,n.event_code,n.subject_label,n.detail,n.due_at,n.created_at,n.read_at
    FROM platform_private.own_application_package_notifications() n$new$);
  EXECUTE pg_temp.b3g_replace(definition,original,body);
  signature:='platform.mark_own_student_portal_notification_read_v2(uuid,uuid)';
  SELECT pg_get_functiondef(oid),prosrc INTO STRICT definition,original FROM pg_proc WHERE oid=signature::REGPROCEDURE;
  body:=pg_temp.b3g_replace(original,$old$      OR EXISTS (
        SELECT 1 FROM platform_private.own_application_document_notifications() program
        WHERE program.notification_id = notification.id
      )$old$,$new$      OR EXISTS (
        SELECT 1 FROM platform_private.own_application_document_notifications() program
        WHERE program.notification_id = notification.id
      )
      OR EXISTS (
        SELECT 1 FROM platform_private.own_application_package_notifications() package
        WHERE package.notification_id = notification.id
      )$new$);
  EXECUTE pg_temp.b3g_replace(definition,original,body);
END $notifications$;

ALTER FUNCTION platform_private.application_package_actor(UUID,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_actor(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_selection_valid(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_selection_valid(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_selections_valid(JSONB,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_selections_valid(JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_intent(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_intent(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_program(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_program(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_document_review(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_document_review(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_review_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_review_summary(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_summary(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_replay(UUID,UUID,TEXT,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_replay(UUID,UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_prelock(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_prelock(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.application_package_cursor(JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_cursor(JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform.application_package_readiness_v1(UUID,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_readiness_v1(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_readiness_v1(UUID,UUID,JSONB) TO authenticated;

ALTER FUNCTION platform.application_package_detail_v1(UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_detail_v1(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_detail_v1(UUID,UUID,UUID) TO authenticated;

ALTER FUNCTION platform.application_package_history_v1(UUID,UUID,JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_history_v1(UUID,UUID,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_history_v1(UUID,UUID,JSONB,INTEGER) TO authenticated;

ALTER FUNCTION platform.application_package_review_history_v1(UUID,UUID,UUID,JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_review_history_v1(UUID,UUID,UUID,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_review_history_v1(UUID,UUID,UUID,JSONB,INTEGER) TO authenticated;

ALTER FUNCTION platform.application_package_queue_v1(JSONB,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_queue_v1(JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_queue_v1(JSONB,INTEGER) TO authenticated;

ALTER FUNCTION platform.application_package_submit_v1(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_submit_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_submit_v1(JSONB) TO authenticated;

ALTER FUNCTION platform_private.application_package_reuse_proof(UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_reuse_proof(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform.application_package_review_v1(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_review_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_review_v1(JSONB) TO authenticated;

ALTER FUNCTION platform.application_package_recover_v1(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_recover_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_recover_v1(TEXT,JSONB) TO authenticated;

ALTER FUNCTION platform_private.application_package_insert_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.application_package_insert_guard() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.publish_application_package_review_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.publish_application_package_review_notification() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform_private.own_application_package_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.own_application_package_notifications() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER FUNCTION platform.application_package_notification_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.application_package_notification_v1(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.application_package_notification_v1(UUID) TO authenticated;

COMMIT;
