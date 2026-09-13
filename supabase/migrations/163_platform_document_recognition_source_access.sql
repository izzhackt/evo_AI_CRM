-- D3 exact private source access and bounded current-session job history.
-- No provider worker, configuration enablement or direct table grants.
BEGIN;

ALTER TABLE platform_private.document_recognition_attempts ADD COLUMN source_preflight_policy_version TEXT
  CHECK(source_preflight_policy_version='document-source-v1');

CREATE FUNCTION platform.grant_document_recognition_source(p_attempt_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE;
  binding platform_private.document_storage_bindings%ROWTYPE;
  access_row platform.document_access_events%ROWTYPE;
  actor_profile UUID; expires TIMESTAMPTZ;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state<>'preflight' OR job.upload_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,
    job.actor_auth_user_id,job.actor_membership_id);
  PERFORM platform_private.document_recognition_require_source(job);
  SELECT * INTO STRICT binding FROM platform_private.document_storage_bindings
    WHERE organization_id=job.organization_id AND student_case_id=job.student_case_id
      AND document_slot_id=job.source_document_slot_id AND document_version_id=job.source_version_id;
  SELECT profile_id INTO STRICT actor_profile FROM platform.organization_memberships
    WHERE organization_id=job.organization_id AND id=job.actor_membership_id;
  -- The attempt UUID identifies this single exact-source grant, never a client
  -- path or a bulk read. A replay rechecks authority and renews no worker lease.
  INSERT INTO platform.document_access_events(organization_id,student_case_id,document_slot_id,document_version_id,
    actor_kind,actor_profile_id,actor_membership_id,access_purpose,contract_reference,request_id)
    VALUES(job.organization_id,job.student_case_id,job.source_document_slot_id,job.source_version_id,
      'user',actor_profile,job.actor_membership_id,'document_recognition','d3-source-v1',p_attempt_id)
    ON CONFLICT(request_id) DO NOTHING;
  SELECT * INTO STRICT access_row FROM platform.document_access_events WHERE request_id=p_attempt_id;
  IF access_row.organization_id<>job.organization_id OR access_row.student_case_id<>job.student_case_id
    OR access_row.document_slot_id<>job.source_document_slot_id OR access_row.document_version_id<>job.source_version_id
    OR access_row.actor_kind<>'user' OR access_row.actor_profile_id IS DISTINCT FROM actor_profile
    OR access_row.actor_membership_id IS DISTINCT FROM job.actor_membership_id
    OR access_row.access_purpose<>'document_recognition' OR access_row.contract_reference<>'d3-source-v1' THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  SELECT LEAST(lease_until,statement_timestamp()+INTERVAL '15 seconds') INTO STRICT expires
    FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  RETURN jsonb_build_object('attempt_id',p_attempt_id,'job_id',job.id,'organization_id',job.organization_id,
    'student_case_id',job.student_case_id,'document_slot_id',job.source_document_slot_id,
    'source_version_id',job.source_version_id,'source_sha256',job.source_sha256,'source_bytes',job.source_bytes,
    'source_mime',job.source_mime,'bucket_id',binding.bucket_id,'object_name',binding.object_name,
    'access_event_id',access_row.id,'granted_at',statement_timestamp(),'expires_at',expires);
END $$;

CREATE INDEX document_recognition_source_history
  ON platform_private.document_recognition_jobs(organization_id,student_case_id,source_version_id,created_at DESC,id DESC);

CREATE FUNCTION platform.staff_document_recognition_jobs(p_student_case_id UUID,p_source_version_id UUID,p_cursor TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; permission TEXT; row RECORD; jobs JSONB:='[]'::JSONB;
  before_time TIMESTAMPTZ; before_id UUID; seen INTEGER:=0; next_cursor TEXT; last_cursor TEXT;
BEGIN
  IF p_student_case_id IS NULL OR (p_cursor IS NOT NULL AND
    p_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF p_cursor IS NOT NULL THEN
    BEGIN
      before_time:=split_part(p_cursor,'|',1)::TIMESTAMPTZ;
      before_id:=split_part(p_cursor,'|',2)::UUID;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';
    END;
  END IF;
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='42501'; END IF;
  FOREACH permission IN ARRAY ARRAY['case.read.full','profile.read.full','document.read.full'] LOOP
    IF NOT platform_private.staff_can_access(actor.organization_id,actor.membership_id,permission,'student_case',p_student_case_id) THEN
      RAISE EXCEPTION 'unavailable' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM platform.student_cases WHERE organization_id=actor.organization_id AND id=p_student_case_id)
    OR (p_source_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.document_versions WHERE organization_id=actor.organization_id
    AND student_case_id=p_student_case_id AND id=p_source_version_id)) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE='42501'; END IF;
  FOR row IN SELECT j.* FROM platform_private.document_recognition_jobs j
    WHERE organization_id=actor.organization_id AND student_case_id=p_student_case_id
      AND (p_source_version_id IS NULL OR source_version_id=p_source_version_id)
      AND (p_cursor IS NULL OR (created_at,id)<(before_time,before_id))
    ORDER BY created_at DESC,id DESC LIMIT 11 LOOP
    seen:=seen+1;
    IF seen>10 THEN next_cursor:=last_cursor; EXIT; END IF;
    jobs:=jobs||jsonb_build_array(jsonb_build_object('job_id',row.id,'source_version_id',row.source_version_id,'state',row.state,
      'cleanup_state',row.cleanup_state,'proposal_count',row.proposal_count,'failure_code',row.failure_code,'updated_at',row.updated_at));
    last_cursor:=to_char(row.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||row.id::TEXT;
  END LOOP;
  RETURN jsonb_build_object('jobs',jobs,'next_cursor',next_cursor);
END $$;

REVOKE ALL ON FUNCTION platform.grant_document_recognition_source(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.grant_document_recognition_source(UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION platform.staff_document_recognition_jobs(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.staff_document_recognition_jobs(UUID,UUID,TEXT) TO authenticated;
-- Forward replacements preserve existing guards and intent/recovery semantics.
CREATE OR REPLACE FUNCTION platform_private.document_recognition_claim_receipt(
  p_job platform_private.document_recognition_jobs, p_attempt platform_private.document_recognition_attempts
) RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('job_id',p_job.id,'attempt_id',p_attempt.id,'organization_id',p_job.organization_id,
    'claim_token',p_attempt.claim_token,'lease_until',p_attempt.lease_until,'stage',p_attempt.stage,
    'request_identity',p_job.request_identity,'request_fingerprint',p_job.request_fingerprint,
    'config',p_job.config_snapshot,'reserved_cost_micros',p_job.reserved_cost_micros,
    'source_pages',p_job.source_pages,'processing_fingerprint',p_job.processing_fingerprint,
    'state',p_job.state,'resource_name',(SELECT resource_name FROM platform_private.document_recognition_provider_files
      WHERE attempt_id=p_attempt.id),'token_count_receipt',p_attempt.token_count_receipt,
    'source_preflight_policy_version',p_attempt.source_preflight_policy_version,
    'provider_file_state',(SELECT observed_state FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt.id),
    'provider_observation_count',COALESCE((SELECT observation_count FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt.id),0))
$$;

DROP FUNCTION platform.seal_document_recognition_preflight(UUID,UUID,TEXT,BIGINT,TEXT,INTEGER,TEXT);

CREATE FUNCTION platform.seal_document_recognition_preflight(
  p_attempt_id UUID,p_claim_token UUID,p_source_sha256 TEXT,p_source_bytes BIGINT,p_source_mime TEXT,
  p_source_pages INTEGER,p_processing_fingerprint TEXT,p_preflight_policy_version TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
  source RECORD; fingerprint TEXT;
BEGIN
  job := platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state <> 'preflight' OR job.upload_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,
    job.actor_auth_user_id,job.actor_membership_id);
  SELECT * INTO source FROM platform_private.document_recognition_source(job.organization_id,job.student_case_id,job.source_version_id);
  IF NOT FOUND OR source.sha256 IS DISTINCT FROM job.source_sha256 OR source.bytes IS DISTINCT FROM job.source_bytes
    OR source.mime IS DISTINCT FROM job.source_mime THEN RAISE EXCEPTION 'source_changed' USING ERRCODE = '40001'; END IF;
  IF p_preflight_policy_version IS DISTINCT FROM 'document-source-v1' THEN
    RAISE EXCEPTION 'document_not_eligible' USING ERRCODE='22023'; END IF;
  IF p_source_sha256 IS DISTINCT FROM job.source_sha256 OR p_source_bytes IS DISTINCT FROM job.source_bytes
    OR p_source_mime IS DISTINCT FROM job.source_mime OR p_source_pages IS NULL
    OR p_source_pages NOT BETWEEN 1 AND (CASE WHEN job.source_mime='application/pdf' THEN 20 ELSE 1 END) THEN
    RAISE EXCEPTION 'document_not_eligible' USING ERRCODE = '22023';
  END IF;
  fingerprint := platform_private.document_recognition_sha(job.request_identity || jsonb_build_object(
    'fingerprint_version','evo-document-recognition-request-v1','source_pages',p_source_pages));
  IF p_processing_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505'; END IF;
  IF job.processing_fingerprint IS NOT NULL AND job.processing_fingerprint <> fingerprint THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
  END IF;
  IF job.processing_fingerprint IS NULL THEN
    UPDATE platform_private.document_recognition_jobs SET source_pages=p_source_pages,processing_fingerprint=fingerprint,
      updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
    UPDATE platform_private.document_recognition_attempts SET stage='source_sealed',updated_at=statement_timestamp()
      WHERE id=p_attempt_id;
  END IF;
  UPDATE platform_private.document_recognition_attempts SET source_preflight_policy_version=p_preflight_policy_version
    WHERE id=p_attempt_id AND source_preflight_policy_version IS NULL;
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF attempt.source_preflight_policy_version IS DISTINCT FROM p_preflight_policy_version THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  RETURN platform_private.document_recognition_claim_receipt(job,attempt);
END $$;

CREATE OR REPLACE FUNCTION platform.begin_document_recognition_upload(p_attempt_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; file_name TEXT;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,job.actor_auth_user_id,job.actor_membership_id);
  PERFORM platform_private.document_recognition_require_source(job);
  IF NOT EXISTS(SELECT 1 FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id
    AND source_preflight_policy_version='document-source-v1') THEN
    RAISE EXCEPTION 'document_not_eligible' USING ERRCODE='22023'; END IF;
  file_name:='files/evo-' || replace(p_attempt_id::TEXT,'-','');
  IF job.upload_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('dispatch',FALSE,'resource_name',file_name); END IF;
  IF job.state<>'preflight' OR job.processing_fingerprint IS NULL THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM platform_private.document_recognition_check_budget(job);
  INSERT INTO platform_private.document_recognition_provider_files(attempt_id,resource_name,project_id,expected_sha256,expected_bytes,expected_mime)
    VALUES(p_attempt_id,file_name,job.config_snapshot->>'projectId',job.source_sha256,job.source_bytes,job.source_mime);
  UPDATE platform_private.document_recognition_jobs SET state='uploading',upload_started_at=statement_timestamp(),
    cleanup_state='pending',updated_at=statement_timestamp() WHERE id=job.id;
  UPDATE platform_private.document_recognition_attempts SET stage='upload_intent',updated_at=statement_timestamp() WHERE id=p_attempt_id;
  RETURN jsonb_build_object('dispatch',TRUE,'resource_name',file_name);
END $$;

CREATE OR REPLACE FUNCTION platform.begin_document_recognition_generation(p_attempt_id UUID,p_claim_token UUID,p_receipt JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,job.actor_auth_user_id,job.actor_membership_id);
  PERFORM platform_private.document_recognition_require_source(job);
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF attempt.source_preflight_policy_version IS DISTINCT FROM 'document-source-v1' THEN
    RAISE EXCEPTION 'document_not_eligible' USING ERRCODE='22023'; END IF;
  IF p_receipt IS NULL OR attempt.token_count_receipt IS NULL OR p_receipt IS DISTINCT FROM attempt.token_count_receipt THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  IF job.generate_started_at IS NOT NULL THEN RETURN jsonb_build_object('dispatch',FALSE); END IF;
  IF job.state<>'file_processing' OR attempt.stage<>'token_counted' OR NOT EXISTS (
    SELECT 1 FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt_id AND observed_state='ACTIVE') THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM platform_private.document_recognition_check_budget(job);
  UPDATE platform_private.document_recognition_jobs SET state='generating',generate_started_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=job.id;
  UPDATE platform_private.document_recognition_attempts SET stage='generation_intent',updated_at=statement_timestamp() WHERE id=p_attempt_id;
  RETURN jsonb_build_object('dispatch',TRUE);
END $$;

CREATE OR REPLACE FUNCTION platform.finish_document_recognition(p_attempt_id UUID,p_claim_token UUID,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF p_failure_code IS NULL OR p_failure_code NOT IN ('document_not_eligible','provider_not_configured','access_revoked','source_changed','source_unavailable','provider_rejected',
    'provider_unavailable','invalid_result','upload_unknown','generation_unknown','budget_exhausted','cancelled') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF (p_failure_code='generation_unknown' AND job.generate_started_at IS NULL)
    OR (p_failure_code='upload_unknown' AND job.upload_started_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF job.state IN ('review_ready','result_saved','publication_blocked') THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  IF job.state IN ('failed','cancelled','generation_unknown') THEN RETURN platform_private.document_recognition_receipt(job,TRUE); END IF;
  IF job.generate_started_at IS NOT NULL AND p_failure_code NOT IN ('provider_rejected','invalid_result','generation_unknown') THEN
    p_failure_code:='generation_unknown'; END IF;
  UPDATE platform_private.document_recognition_jobs SET
    state=CASE WHEN p_failure_code='generation_unknown' THEN 'generation_unknown' WHEN p_failure_code='cancelled' THEN 'cancelled'
      WHEN p_failure_code='upload_unknown' THEN 'upload_unknown' ELSE 'failed' END,
    failure_code=p_failure_code,reservation_released_at=CASE WHEN upload_started_at IS NULL THEN statement_timestamp() END,
    updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
  UPDATE platform_private.document_recognition_attempts SET stage=job.state,lease_until=statement_timestamp(),updated_at=statement_timestamp()
    WHERE id=p_attempt_id;
  RETURN platform_private.document_recognition_receipt(job,FALSE);
END $$;

CREATE OR REPLACE FUNCTION platform.claim_document_recognition_cleanup(p_worker_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate RECORD; job platform_private.document_recognition_jobs%ROWTYPE;
  file_row platform_private.document_recognition_provider_files%ROWTYPE;
BEGIN
  PERFORM platform_private.document_recognition_require_service();
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  FOR candidate IN SELECT j.id,j.organization_id,f.attempt_id FROM platform_private.document_recognition_provider_files f
    JOIN platform_private.document_recognition_attempts a ON a.id=f.attempt_id
    JOIN platform_private.document_recognition_jobs j ON j.id=a.job_id
    WHERE j.state IN ('review_ready','failed','generation_unknown','publication_blocked','cancelled')
      AND j.cleanup_state IN ('pending','deleting','unknown') AND f.cleanup_attempts<5
      AND f.cleanup_next_at<=statement_timestamp() AND (f.cleanup_lease_until IS NULL OR f.cleanup_lease_until<=statement_timestamp())
    ORDER BY f.cleanup_next_at,f.attempt_id LIMIT 16 LOOP
    PERFORM 1 FROM platform.organizations WHERE id=candidate.organization_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO job FROM platform_private.document_recognition_jobs WHERE id=candidate.id FOR UPDATE;
    PERFORM 1 FROM platform_private.document_recognition_attempts WHERE id=candidate.attempt_id FOR UPDATE;
    SELECT * INTO file_row FROM platform_private.document_recognition_provider_files WHERE attempt_id=candidate.attempt_id FOR UPDATE;
    IF job.cleanup_state='confirmed_absent' OR file_row.cleanup_attempts>=5 OR file_row.cleanup_next_at>statement_timestamp()
      OR file_row.cleanup_lease_until>statement_timestamp() THEN CONTINUE; END IF;
    UPDATE platform_private.document_recognition_provider_files SET cleanup_worker_id=p_worker_id,cleanup_token=gen_random_uuid(),
      cleanup_lease_until=statement_timestamp()+INTERVAL '90 seconds',cleanup_attempts=cleanup_attempts+1,
      delete_started_at=NULL,delete_acknowledged_at=NULL WHERE attempt_id=file_row.attempt_id RETURNING * INTO file_row;
    UPDATE platform_private.document_recognition_jobs SET cleanup_state='pending',updated_at=statement_timestamp() WHERE id=job.id;
    RETURN jsonb_build_object('attempt_id',file_row.attempt_id,'cleanup_token',file_row.cleanup_token,'resource_name',file_row.resource_name,
      'project_id',file_row.project_id,'config',job.config_snapshot,'sha256',file_row.expected_sha256,
      'bytes',file_row.expected_bytes,'mime_type',file_row.expected_mime,'lease_until',file_row.cleanup_lease_until,'source_pages',job.source_pages);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION platform.seal_document_recognition_preflight(UUID,UUID,TEXT,BIGINT,TEXT,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.seal_document_recognition_preflight(UUID,UUID,TEXT,BIGINT,TEXT,INTEGER,TEXT,TEXT) TO service_role;
COMMIT;
