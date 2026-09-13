-- D3 durable queue. No provider dispatcher, credentials or confirmed-value writer.
-- Contract: docs/design/v3/evo-docs-recognition-contract.md.
BEGIN;

INSERT INTO platform.permission_definitions (
  permission_key, description, staff_label, staff_group,
  staff_resource_kinds, staff_scope_kinds, staff_sensitive, staff_system_only
) VALUES ('document.extract', 'Explicit extraction from an authorized case document',
  'Извлечь поля из документа', 'Документы', ARRAY['student_case'],
  ARRAY['own','department','direction','record','organization'], FALSE, FALSE);

-- Flat ASCII metadata only, matching JSON.stringify of sorted primitive keys.
-- Do not replace this with jsonb::text: its whitespace changes the v1 hash.
CREATE FUNCTION platform_private.document_recognition_canonical(p_value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_each(p_value) pair
      WHERE jsonb_typeof(pair.value) NOT IN ('string','number','boolean','null')) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  RETURN '{' || COALESCE((SELECT string_agg(to_jsonb(key)::TEXT || ':' || value::TEXT, ',' ORDER BY key COLLATE "C")
    FROM jsonb_each(p_value)), '') || '}';
END $$;

CREATE FUNCTION platform_private.document_recognition_sha(p_value JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(platform_private.document_recognition_canonical(p_value), 'UTF8')), 'hex')
$$;

CREATE FUNCTION platform_private.document_recognition_config_valid(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item TEXT; amount NUMERIC;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_value)) <> 13
    OR NOT p_value ?& ARRAY['enabled','projectId','model','configVersion','pricingPolicyVersion',
      'paidProjectId','paidEligibilityReference','perJobBudgetMicros','dailyOrgBudgetMicros',
      'inputTokenCeiling','outputTokenCeiling','inputMicrosPerMillionTokens','outputMicrosPerMillionTokens']
    OR p_value->'enabled' IS DISTINCT FROM 'true'::JSONB
    OR p_value->>'paidProjectId' IS DISTINCT FROM p_value->>'projectId' THEN RETURN FALSE; END IF;
  FOREACH item IN ARRAY ARRAY['projectId','configVersion','pricingPolicyVersion','paidProjectId','paidEligibilityReference'] LOOP
    IF jsonb_typeof(p_value->item) <> 'string' OR (p_value->>item) !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' THEN RETURN FALSE; END IF;
  END LOOP;
  IF jsonb_typeof(p_value->'model') <> 'string' OR p_value->>'model' !~ '^gemini-[a-z0-9][a-z0-9.-]{0,100}$'
    OR p_value->>'model' ~ '(^|-)latest(-|$)' THEN RETURN FALSE; END IF;
  FOREACH item IN ARRAY ARRAY['perJobBudgetMicros','dailyOrgBudgetMicros','inputTokenCeiling','outputTokenCeiling',
    'inputMicrosPerMillionTokens','outputMicrosPerMillionTokens'] LOOP
    IF jsonb_typeof(p_value->item) <> 'number' OR (p_value->>item) !~ '^[0-9]+$' THEN RETURN FALSE; END IF;
    amount := (p_value->>item)::NUMERIC;
    IF amount NOT BETWEEN 1 AND 9007199254740991 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN (p_value->>'outputTokenCeiling')::NUMERIC <= 6000
    AND (p_value->>'dailyOrgBudgetMicros')::NUMERIC >= (p_value->>'perJobBudgetMicros')::NUMERIC
    AND ceil(((p_value->>'inputTokenCeiling')::NUMERIC * (p_value->>'inputMicrosPerMillionTokens')::NUMERIC
      + (p_value->>'outputTokenCeiling')::NUMERIC * (p_value->>'outputMicrosPerMillionTokens')::NUMERIC) / 1000000)
      <= (p_value->>'perJobBudgetMicros')::NUMERIC;
END $$;

CREATE TABLE platform_private.document_recognition_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  config JSONB NOT NULL CHECK (platform_private.document_recognition_config_valid(config)),
  registry_version TEXT NOT NULL CHECK (registry_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  prompt_policy_version TEXT NOT NULL CHECK (prompt_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX document_recognition_config_version
  ON platform_private.document_recognition_configs(organization_id, (config->>'configVersion'));
CREATE UNIQUE INDEX document_recognition_one_enabled_config
  ON platform_private.document_recognition_configs(organization_id) WHERE enabled;

CREATE FUNCTION platform_private.document_recognition_config_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) - 'enabled' IS DISTINCT FROM to_jsonb(OLD) - 'enabled' THEN
    RAISE EXCEPTION 'Recognition configuration history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_recognition_config_history BEFORE UPDATE OR DELETE
  ON platform_private.document_recognition_configs FOR EACH ROW
  EXECUTE FUNCTION platform_private.document_recognition_config_immutable();

CREATE TABLE platform_private.document_recognition_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  source_document_slot_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes BIGINT NOT NULL CHECK (source_bytes BETWEEN 1 AND 26214400),
  source_mime TEXT NOT NULL CHECK (source_mime IN ('application/pdf','image/jpeg','image/png')),
  source_pages INTEGER CHECK (source_pages BETWEEN 1 AND CASE WHEN source_mime = 'application/pdf' THEN 20 ELSE 1 END),
  actor_auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  retry_of_job_id UUID,
  expected_profile_revision BIGINT NOT NULL CHECK (expected_profile_revision BETWEEN 1 AND 9007199254740991),
  config_id UUID NOT NULL,
  config_snapshot JSONB NOT NULL CHECK (platform_private.document_recognition_config_valid(config_snapshot)),
  request_identity JSONB NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  equivalence_key TEXT NOT NULL CHECK (equivalence_key ~ '^[0-9a-f]{64}$'),
  processing_fingerprint TEXT CHECK (processing_fingerprint ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','preflight','uploading','file_processing','generating',
    'result_saved','review_ready','failed','upload_unknown','generation_unknown','publication_blocked','cancelled')),
  cleanup_state TEXT NOT NULL DEFAULT 'not_uploaded' CHECK (cleanup_state IN ('not_uploaded','pending','deleting','confirmed_absent','unknown')),
  proposal_count INTEGER NOT NULL DEFAULT 0 CHECK (proposal_count BETWEEN 0 AND 61),
  failure_code TEXT CHECK (failure_code IN ('document_not_eligible','profile_not_started','provider_not_configured','budget_exhausted',
    'access_revoked','source_changed','source_unavailable','provider_rejected','provider_unavailable','invalid_result',
    'upload_unknown','generation_unknown','publication_blocked','cancelled')),
  reserved_cost_micros BIGINT NOT NULL CHECK (reserved_cost_micros BETWEEN 1 AND 9007199254740991),
  reservation_day DATE NOT NULL,
  reservation_released_at TIMESTAMPTZ,
  upload_started_at TIMESTAMPTZ,
  generate_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, id), UNIQUE (organization_id, request_id),
  CHECK ((source_pages IS NULL) = (processing_fingerprint IS NULL)),
  CHECK (upload_started_at IS NULL OR processing_fingerprint IS NOT NULL),
  CHECK (generate_started_at IS NULL OR upload_started_at IS NOT NULL),
  CHECK (reservation_released_at IS NULL OR (upload_started_at IS NULL AND generate_started_at IS NULL)),
  FOREIGN KEY (organization_id, student_case_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, student_case_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_version_id, student_case_id, source_document_slot_id)
    REFERENCES platform.document_versions(organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, config_id)
    REFERENCES platform_private.document_recognition_configs(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, retry_of_job_id)
    REFERENCES platform_private.document_recognition_jobs(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX document_recognition_equivalent_active
  ON platform_private.document_recognition_jobs(organization_id, equivalence_key)
  WHERE state IN ('queued','preflight','uploading','file_processing','generating','result_saved','upload_unknown');
CREATE INDEX document_recognition_queued ON platform_private.document_recognition_jobs(created_at, id)
  WHERE state IN ('queued','preflight','uploading','upload_unknown','file_processing','generating','result_saved');
CREATE INDEX document_recognition_active_project ON platform_private.document_recognition_jobs((config_snapshot->>'projectId'),organization_id,id)
  WHERE state IN ('preflight','uploading','upload_unknown','file_processing','generating','result_saved');
CREATE INDEX document_recognition_daily_reservations
  ON platform_private.document_recognition_jobs(organization_id, reservation_day) WHERE reservation_released_at IS NULL;

CREATE TABLE platform_private.document_recognition_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  job_id UUID NOT NULL UNIQUE,
  ordinal INTEGER NOT NULL DEFAULT 1 CHECK (ordinal = 1),
  worker_id TEXT NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  claim_token UUID NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('preflight','source_sealed','upload_intent','upload_unknown','file_processing',
    'token_counted','generation_intent','result_saved','review_ready','generation_unknown','publication_blocked','cancelled','failed')),
  token_count_receipt JSONB,
  result JSONB,
  result_sha256 TEXT CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  response_id TEXT CHECK (response_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  model_version TEXT CHECK (model_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  usage JSONB,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, job_id) REFERENCES platform_private.document_recognition_jobs(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE platform_private.document_recognition_provider_files (
  attempt_id UUID PRIMARY KEY REFERENCES platform_private.document_recognition_attempts(id) ON DELETE RESTRICT,
  resource_name TEXT NOT NULL UNIQUE CHECK (resource_name ~ '^files/evo-[0-9a-f]{32}$'),
  project_id TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes BIGINT NOT NULL CHECK (expected_bytes BETWEEN 1 AND 26214400),
  expected_mime TEXT NOT NULL CHECK (expected_mime IN ('application/pdf','image/jpeg','image/png')),
  observed_state TEXT CHECK (observed_state IN ('ACTIVE','PROCESSING','FAILED')),
  observed_owned_at TIMESTAMPTZ,
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count BETWEEN 0 AND 5),
  cleanup_worker_id TEXT,
  cleanup_token UUID,
  cleanup_lease_until TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts BETWEEN 0 AND 5),
  cleanup_next_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  delete_started_at TIMESTAMPTZ,
  delete_acknowledged_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  confirmed_absent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (resource_name = 'files/evo-' || replace(attempt_id::TEXT,'-','')),
  CHECK (confirmed_absent_at IS NULL OR observed_owned_at IS NOT NULL)
);
CREATE TABLE platform_private.document_recognition_proposal_links (
  attempt_id UUID NOT NULL REFERENCES platform_private.document_recognition_attempts(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 61),
  proposal_id UUID NOT NULL UNIQUE REFERENCES platform.student_profile_field_proposals(id) ON DELETE RESTRICT,
  PRIMARY KEY(attempt_id,ordinal)
);
CREATE INDEX document_recognition_cleanup_due ON platform_private.document_recognition_provider_files(cleanup_next_at,attempt_id)
  WHERE cleanup_attempts<5 AND confirmed_absent_at IS NULL;

CREATE FUNCTION platform_private.document_recognition_source(p_organization_id UUID, p_student_case_id UUID, p_version_id UUID)
RETURNS TABLE(slot_id UUID, sha256 TEXT, bytes BIGINT, mime TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT version.document_slot_id, version.sha256_hex, version.byte_size, version.declared_mime_type
  FROM platform.document_versions version
  JOIN platform.document_slots slot ON slot.organization_id = version.organization_id
    AND slot.student_case_id = version.student_case_id AND slot.id = version.document_slot_id
  JOIN platform_private.document_storage_bindings binding ON binding.organization_id = version.organization_id
    AND binding.student_case_id = version.student_case_id AND binding.document_slot_id = version.document_slot_id
    AND binding.document_version_id = version.id
  WHERE version.organization_id = p_organization_id AND version.student_case_id = p_student_case_id
    AND version.id = p_version_id AND slot.removed_at IS NULL
    AND version.integrity_status = 'verified' AND version.malware_status = 'clean'
    AND version.declared_mime_type IN ('application/pdf','image/jpeg','image/png')
    AND version.byte_size BETWEEN 1 AND 26214400
    AND platform_private.student_document_has_scan_proof(p_organization_id, version.id)
$$;

CREATE FUNCTION platform_private.document_recognition_require_service()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
  END IF;
END $$;

-- Caller holds the organization lock; same profile/membership order as S2.
CREATE FUNCTION platform_private.document_recognition_require_actor(
  p_org UUID, p_case UUID, p_auth_user UUID, p_membership UUID
) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE permission TEXT;
BEGIN
  PERFORM platform_private.staff_lock_memberships(p_org, ARRAY[p_membership]);
  IF NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_org, p_membership) identity
    WHERE identity.auth_user_id = p_auth_user) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM platform.student_cases WHERE organization_id = p_org AND id = p_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501'; END IF;
  FOREACH permission IN ARRAY ARRAY['case.read.full','profile.read.full','profile.manage','document.read.full','document.download','document.extract'] LOOP
    IF NOT platform_private.staff_can_access(p_org, p_membership, permission, 'student_case', p_case) THEN
      RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION platform_private.document_recognition_receipt(p_job platform_private.document_recognition_jobs, p_replayed BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('job_id', p_job.id, 'state', p_job.state, 'replayed', p_replayed)
$$;

CREATE FUNCTION platform.enqueue_document_recognition(
  p_organization_id UUID, p_student_case_id UUID, p_source_version_id UUID,
  p_expected_profile_revision BIGINT, p_request_id UUID, p_retry_of_job_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; profile RECORD; source RECORD;
  config_row platform_private.document_recognition_configs%ROWTYPE;
  job platform_private.document_recognition_jobs%ROWTYPE;
  identity_json JSONB; reservation BIGINT; already_reserved NUMERIC; equivalent TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_source_version_id IS NULL OR p_request_id IS NULL
    OR p_expected_profile_revision IS NULL OR p_expected_profile_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR UPDATE;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO job FROM platform_private.document_recognition_jobs
    WHERE organization_id = p_organization_id AND request_id = p_request_id FOR UPDATE;
  PERFORM platform_private.document_recognition_require_actor(p_organization_id, p_student_case_id, actor.auth_user_id, actor.membership_id);
  IF job.id IS NOT NULL THEN
    IF job.student_case_id <> p_student_case_id OR job.source_version_id <> p_source_version_id
      OR job.expected_profile_revision <> p_expected_profile_revision
      OR job.retry_of_job_id IS DISTINCT FROM p_retry_of_job_id
      OR job.actor_auth_user_id <> actor.auth_user_id OR job.actor_membership_id <> actor.membership_id THEN
      RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN platform_private.document_recognition_receipt(job, TRUE);
  END IF;
  SELECT id, revision INTO profile FROM platform.student_profiles
    WHERE organization_id = p_organization_id AND student_case_id = p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_started' USING ERRCODE = '22023'; END IF;
  IF profile.revision <> p_expected_profile_revision THEN RAISE EXCEPTION 'profile_changed' USING ERRCODE = '40001'; END IF;
  SELECT * INTO source FROM platform_private.document_recognition_source(p_organization_id, p_student_case_id, p_source_version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_eligible' USING ERRCODE = '22023'; END IF;
  SELECT * INTO config_row FROM platform_private.document_recognition_configs
    WHERE organization_id = p_organization_id AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_configured' USING ERRCODE = '55000'; END IF;
  IF p_retry_of_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform_private.document_recognition_jobs prior WHERE prior.organization_id = p_organization_id
      AND prior.id = p_retry_of_job_id AND prior.student_case_id = p_student_case_id
      AND prior.source_version_id = p_source_version_id AND prior.state IN ('failed','generation_unknown','cancelled','publication_blocked')
  ) THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505'; END IF;
  identity_json := jsonb_build_object(
    'organization_id', p_organization_id, 'student_case_id', p_student_case_id, 'student_profile_id', profile.id,
    'source_document_slot_id', source.slot_id, 'source_version_id', p_source_version_id,
    'source_sha256', source.sha256, 'source_bytes', source.bytes, 'source_mime', source.mime,
    'actor_auth_user_id', actor.auth_user_id, 'actor_membership_id', actor.membership_id,
    'purpose', 'student_profile', 'extraction_mode', 'student_profile_fields',
    'registry_version', config_row.registry_version, 'schema_version', 1,
    'prompt_policy_version', config_row.prompt_policy_version, 'config_version', config_row.config->>'configVersion',
    'provider_project_id', config_row.config->>'projectId', 'model', config_row.config->>'model',
    'expected_profile_revision', p_expected_profile_revision, 'retry_of_job_id', p_retry_of_job_id
  );
  equivalent := platform_private.document_recognition_sha(jsonb_build_object(
    'organization_id', p_organization_id, 'student_case_id', p_student_case_id, 'source_version_id', p_source_version_id,
    'source_sha256', source.sha256, 'config_sha256', platform_private.document_recognition_sha(config_row.config),
    'registry_version', config_row.registry_version, 'prompt_policy_version', config_row.prompt_policy_version));
  IF p_retry_of_job_id IS NULL AND EXISTS (
    SELECT 1 FROM platform_private.document_recognition_jobs prior WHERE prior.organization_id=p_organization_id
      AND prior.equivalence_key=equivalent AND prior.state='generation_unknown'
  ) THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM platform_private.document_recognition_jobs
    WHERE organization_id = p_organization_id AND equivalence_key = equivalent
      AND state IN ('queued','preflight','uploading','file_processing','generating','result_saved','upload_unknown')) THEN
    RAISE EXCEPTION 'equivalent_job_active' USING ERRCODE = '23505';
  END IF;
  reservation := ceil(((config_row.config->>'inputTokenCeiling')::NUMERIC * (config_row.config->>'inputMicrosPerMillionTokens')::NUMERIC
    + (config_row.config->>'outputTokenCeiling')::NUMERIC * (config_row.config->>'outputMicrosPerMillionTokens')::NUMERIC) / 1000000)::BIGINT;
  SELECT COALESCE(sum(reserved_cost_micros), 0) INTO already_reserved FROM platform_private.document_recognition_jobs
    WHERE organization_id = p_organization_id AND reservation_day = (statement_timestamp() AT TIME ZONE 'UTC')::DATE
      AND reservation_released_at IS NULL;
  IF already_reserved + reservation > (config_row.config->>'dailyOrgBudgetMicros')::NUMERIC THEN
    RAISE EXCEPTION 'budget_exhausted' USING ERRCODE = '54000';
  END IF;
  INSERT INTO platform_private.document_recognition_jobs(
    organization_id, student_case_id, student_profile_id, source_document_slot_id, source_version_id,
    source_sha256, source_bytes, source_mime, actor_auth_user_id, actor_membership_id,
    request_id, retry_of_job_id, expected_profile_revision, config_id, config_snapshot, request_identity,
    request_fingerprint, equivalence_key, reserved_cost_micros, reservation_day
  ) VALUES (p_organization_id, p_student_case_id, profile.id, source.slot_id, p_source_version_id,
    source.sha256, source.bytes, source.mime, actor.auth_user_id, actor.membership_id,
    p_request_id, p_retry_of_job_id, p_expected_profile_revision, config_row.id, config_row.config, identity_json,
    platform_private.document_recognition_sha(identity_json || jsonb_build_object(
      'fingerprint_version','evo-document-recognition-enqueue-v1','config_sha256',platform_private.document_recognition_sha(config_row.config))),
    equivalent, reservation, (statement_timestamp() AT TIME ZONE 'UTC')::DATE) RETURNING * INTO job;
  RETURN platform_private.document_recognition_receipt(job, FALSE);
END $$;

CREATE FUNCTION platform.staff_document_recognition_job(p_student_case_id UUID, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; job platform_private.document_recognition_jobs%ROWTYPE; permission TEXT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501'; END IF;
  FOREACH permission IN ARRAY ARRAY['case.read.full','profile.read.full','document.read.full'] LOOP
    IF NOT platform_private.staff_can_access(actor.organization_id, actor.membership_id, permission, 'student_case', p_student_case_id) THEN
      RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  SELECT * INTO job FROM platform_private.document_recognition_jobs
    WHERE organization_id = actor.organization_id AND student_case_id = p_student_case_id AND id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('job_id',job.id,'source_version_id',job.source_version_id,'state',job.state,
    'cleanup_state',job.cleanup_state,'proposal_count',job.proposal_count,'failure_code',job.failure_code,'updated_at',job.updated_at);
END $$;

CREATE FUNCTION platform_private.document_recognition_claim_receipt(
  p_job platform_private.document_recognition_jobs, p_attempt platform_private.document_recognition_attempts
) RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('job_id',p_job.id,'attempt_id',p_attempt.id,'organization_id',p_job.organization_id,
    'claim_token',p_attempt.claim_token,'lease_until',p_attempt.lease_until,'stage',p_attempt.stage,
    'request_identity',p_job.request_identity,'request_fingerprint',p_job.request_fingerprint,
    'config',p_job.config_snapshot,'reserved_cost_micros',p_job.reserved_cost_micros,
    'source_pages',p_job.source_pages,'processing_fingerprint',p_job.processing_fingerprint,
    'state',p_job.state,'resource_name',(SELECT resource_name FROM platform_private.document_recognition_provider_files
      WHERE attempt_id=p_attempt.id),'token_count_receipt',p_attempt.token_count_receipt)
$$;

CREATE FUNCTION platform.claim_document_recognition(p_worker_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate RECORD; job platform_private.document_recognition_jobs%ROWTYPE;
  attempt platform_private.document_recognition_attempts%ROWTYPE; active_count INTEGER;
BEGIN
  PERFORM platform_private.document_recognition_require_service();
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  FOR candidate IN SELECT j.id,j.organization_id FROM platform_private.document_recognition_jobs j
    LEFT JOIN platform_private.document_recognition_attempts a ON a.job_id = j.id
    WHERE j.state IN ('queued','preflight','uploading','upload_unknown','file_processing','generating','result_saved')
      AND (a.id IS NULL OR a.lease_until <= statement_timestamp())
    ORDER BY j.created_at,j.id LIMIT 16 LOOP
    PERFORM 1 FROM platform.organizations WHERE id = candidate.organization_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO job FROM platform_private.document_recognition_jobs WHERE id = candidate.id FOR UPDATE;
    IF job.state NOT IN ('queued','preflight','uploading','upload_unknown','file_processing','generating','result_saved') THEN CONTINUE; END IF;
    SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE job_id = job.id FOR UPDATE;
    IF FOUND AND attempt.lease_until > statement_timestamp() THEN CONTINUE; END IF;
    IF job.state = 'generating' THEN
      -- A lost generation result has no safe paid replay. Reconciliation only
      -- records unknown and hands the owned file to the separate cleanup queue.
      UPDATE platform_private.document_recognition_jobs SET state='generation_unknown',failure_code='generation_unknown',
        updated_at=statement_timestamp() WHERE id=job.id;
      UPDATE platform_private.document_recognition_attempts SET stage='generation_unknown',updated_at=statement_timestamp()
        WHERE id=attempt.id;
      CONTINUE;
    END IF;
    IF job.state = 'uploading' THEN
      UPDATE platform_private.document_recognition_jobs SET state='upload_unknown',failure_code='upload_unknown',
        updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
      UPDATE platform_private.document_recognition_attempts SET stage='upload_unknown',updated_at=statement_timestamp()
        WHERE id=attempt.id RETURNING * INTO attempt;
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('evo-document-recognition-project:' || (job.config_snapshot->>'projectId'), 0)) THEN
      CONTINUE;
    END IF;
    SELECT count(*) INTO active_count FROM platform_private.document_recognition_attempts active
      JOIN platform_private.document_recognition_jobs active_job ON active_job.id = active.job_id
      WHERE active_job.organization_id = job.organization_id AND active_job.state IN
        ('preflight','uploading','upload_unknown','file_processing','generating','result_saved')
        AND active.lease_until > statement_timestamp();
    IF active_count >= 1 THEN CONTINUE; END IF;
    SELECT count(*) INTO active_count FROM platform_private.document_recognition_attempts active
      JOIN platform_private.document_recognition_jobs active_job ON active_job.id = active.job_id
      WHERE active_job.config_snapshot->>'projectId' = job.config_snapshot->>'projectId' AND active_job.state IN
        ('preflight','uploading','upload_unknown','file_processing','generating','result_saved')
        AND active.lease_until > statement_timestamp();
    IF active_count >= 2 THEN CONTINUE; END IF;
    BEGIN
      PERFORM platform_private.document_recognition_require_actor(job.organization_id, job.student_case_id,
        job.actor_auth_user_id, job.actor_membership_id);
    EXCEPTION WHEN insufficient_privilege THEN
      UPDATE platform_private.document_recognition_jobs SET
        state=CASE WHEN job.state='result_saved' THEN 'publication_blocked' ELSE 'failed' END,failure_code='access_revoked',
        reservation_released_at=CASE WHEN upload_started_at IS NULL THEN statement_timestamp() END,
        updated_at=statement_timestamp() WHERE id=job.id;
      IF attempt.id IS NOT NULL THEN UPDATE platform_private.document_recognition_attempts SET stage='failed',
        lease_until=statement_timestamp(),updated_at=statement_timestamp() WHERE id=attempt.id; END IF;
      CONTINUE;
    END;
    IF attempt.id IS NULL THEN
      INSERT INTO platform_private.document_recognition_attempts(organization_id,job_id,worker_id,claim_token,lease_until,stage)
        VALUES(job.organization_id,job.id,p_worker_id,gen_random_uuid(),statement_timestamp()+INTERVAL '90 seconds','preflight')
        RETURNING * INTO attempt;
    ELSE
      -- New fence permits safe GET/result publication, never redispatch of an
      -- existing upload/generation intent. Those commands return dispatch:false.
      UPDATE platform_private.document_recognition_attempts SET worker_id=p_worker_id,claim_token=gen_random_uuid(),
        lease_until=statement_timestamp()+INTERVAL '90 seconds',updated_at=statement_timestamp()
        WHERE id=attempt.id RETURNING * INTO attempt;
    END IF;
    UPDATE platform_private.document_recognition_jobs SET state=CASE WHEN state='queued' THEN 'preflight' ELSE state END,
      updated_at=statement_timestamp()
      WHERE id=job.id RETURNING * INTO job;
    RETURN platform_private.document_recognition_claim_receipt(job,attempt);
  END LOOP;
  RETURN NULL;
END $$;

-- Fixed lock path for every claimed transition: organization → job → attempt.
CREATE FUNCTION platform_private.document_recognition_lock_claim(p_attempt_id UUID,p_claim_token UUID)
RETURNS platform_private.document_recognition_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE hint RECORD; job platform_private.document_recognition_jobs%ROWTYPE;
  attempt platform_private.document_recognition_attempts%ROWTYPE;
BEGIN
  PERFORM platform_private.document_recognition_require_service();
  SELECT organization_id,job_id INTO hint FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE = '40001'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=hint.organization_id FOR UPDATE;
  SELECT * INTO job FROM platform_private.document_recognition_jobs WHERE id=hint.job_id FOR UPDATE;
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF p_claim_token IS NULL OR attempt.claim_token <> p_claim_token OR attempt.lease_until <= statement_timestamp() THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE = '40001';
  END IF;
  RETURN job;
END $$;

CREATE FUNCTION platform.renew_document_recognition_lease(p_attempt_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
BEGIN
  job := platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state NOT IN ('preflight','uploading','upload_unknown','file_processing','generating','result_saved') THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,
    job.actor_auth_user_id,job.actor_membership_id);
  UPDATE platform_private.document_recognition_attempts SET lease_until=statement_timestamp()+INTERVAL '90 seconds',
    updated_at=statement_timestamp() WHERE id=p_attempt_id RETURNING * INTO attempt;
  RETURN platform_private.document_recognition_claim_receipt(job,attempt);
END $$;

CREATE FUNCTION platform.seal_document_recognition_preflight(
  p_attempt_id UUID,p_claim_token UUID,p_source_sha256 TEXT,p_source_bytes BIGINT,p_source_mime TEXT,
  p_source_pages INTEGER,p_processing_fingerprint TEXT
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
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  RETURN platform_private.document_recognition_claim_receipt(job,attempt);
END $$;

CREATE FUNCTION platform.finish_document_recognition_preflight(p_attempt_id UUID,p_claim_token UUID,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE;
BEGIN
  job := platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state <> 'preflight' OR job.upload_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  IF p_failure_code IS NULL OR p_failure_code NOT IN ('document_not_eligible','source_changed','source_unavailable',
    'access_revoked','provider_not_configured','cancelled') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023'; END IF;
  -- Recording a pre-dispatch failure must remain possible after access revocation.
  -- A reservation is releasable only here, before any provider upload/generation.
  UPDATE platform_private.document_recognition_jobs SET state=CASE WHEN p_failure_code='cancelled' THEN 'cancelled' ELSE 'failed' END,
    failure_code=p_failure_code,reservation_released_at=statement_timestamp(),updated_at=statement_timestamp()
    WHERE id=job.id RETURNING * INTO job;
  UPDATE platform_private.document_recognition_attempts SET stage=job.state,lease_until=statement_timestamp(),updated_at=statement_timestamp()
    WHERE id=p_attempt_id;
  RETURN platform_private.document_recognition_receipt(job,FALSE);
END $$;

CREATE FUNCTION platform_private.document_recognition_require_source(p_job platform_private.document_recognition_jobs)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_source(p_job.organization_id,p_job.student_case_id,p_job.source_version_id) s
    WHERE s.slot_id=p_job.source_document_slot_id AND s.sha256=p_job.source_sha256
      AND s.bytes=p_job.source_bytes AND s.mime=p_job.source_mime) THEN
    RAISE EXCEPTION 'source_changed' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION platform_private.document_recognition_check_budget(p_job platform_private.document_recognition_jobs)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE today DATE:=(statement_timestamp() AT TIME ZONE 'UTC')::DATE; reserved NUMERIC;
BEGIN
  IF p_job.reservation_released_at IS NOT NULL THEN RAISE EXCEPTION 'budget_exhausted' USING ERRCODE='54000'; END IF;
  IF p_job.reservation_day=today THEN RETURN; END IF;
  SELECT COALESCE(sum(reserved_cost_micros),0) INTO reserved FROM platform_private.document_recognition_jobs
    WHERE organization_id=p_job.organization_id AND reservation_day=today AND reservation_released_at IS NULL AND id<>p_job.id;
  IF reserved+p_job.reserved_cost_micros>(p_job.config_snapshot->>'dailyOrgBudgetMicros')::NUMERIC THEN
    RAISE EXCEPTION 'budget_exhausted' USING ERRCODE='54000'; END IF;
  UPDATE platform_private.document_recognition_jobs SET reservation_day=today WHERE id=p_job.id;
END $$;

CREATE FUNCTION platform.begin_document_recognition_upload(p_attempt_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; file_name TEXT;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,job.actor_auth_user_id,job.actor_membership_id);
  PERFORM platform_private.document_recognition_require_source(job);
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

CREATE FUNCTION platform.observe_document_recognition_file(p_attempt_id UUID,p_claim_token UUID,p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; file_row platform_private.document_recognition_provider_files%ROWTYPE;
  attempt platform_private.document_recognition_attempts%ROWTYPE; observation_state TEXT;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state NOT IN ('uploading','upload_unknown','file_processing') OR job.generate_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO STRICT file_row FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt_id FOR UPDATE;
  IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_observation))<>6
    OR NOT p_observation ?& ARRAY['outcome','resource_name','state','sha256','bytes','mime_type']
    OR p_observation->>'resource_name' IS DISTINCT FROM file_row.resource_name
    OR p_observation->>'outcome' IS NULL OR p_observation->>'outcome' NOT IN ('present','not_found','unknown')
    OR file_row.observation_count>=5 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF p_observation->>'outcome'='present' THEN
    observation_state:=p_observation->>'state';
    IF observation_state IS NULL OR observation_state NOT IN ('ACTIVE','PROCESSING','FAILED')
      OR p_observation->>'sha256' IS DISTINCT FROM file_row.expected_sha256
      OR p_observation->'bytes' IS DISTINCT FROM to_jsonb(file_row.expected_bytes)
      OR p_observation->>'mime_type' IS DISTINCT FROM file_row.expected_mime THEN
      RAISE EXCEPTION 'source_changed' USING ERRCODE='40001'; END IF;
    UPDATE platform_private.document_recognition_provider_files SET observed_state=observation_state,
      observed_owned_at=COALESCE(observed_owned_at,statement_timestamp()),observation_count=observation_count+1,checked_at=statement_timestamp()
      WHERE attempt_id=p_attempt_id;
    UPDATE platform_private.document_recognition_jobs SET
      state=CASE WHEN observation_state='FAILED' OR (observation_state='PROCESSING' AND file_row.observation_count=4) THEN 'failed' ELSE 'file_processing' END,
      failure_code=CASE WHEN observation_state='FAILED' THEN 'provider_rejected'
        WHEN observation_state='PROCESSING' AND file_row.observation_count=4 THEN 'provider_unavailable' END,
      updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
  ELSE
    IF p_observation->'state'<>'null'::JSONB OR p_observation->'sha256'<>'null'::JSONB
      OR p_observation->'bytes'<>'null'::JSONB OR p_observation->'mime_type'<>'null'::JSONB THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
    UPDATE platform_private.document_recognition_provider_files SET observation_count=observation_count+1,checked_at=statement_timestamp()
      WHERE attempt_id=p_attempt_id;
    UPDATE platform_private.document_recognition_jobs SET state=CASE WHEN file_row.observation_count=4 THEN 'failed' ELSE 'upload_unknown' END,
      failure_code='upload_unknown',updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
  END IF;
  UPDATE platform_private.document_recognition_attempts SET stage=job.state,updated_at=statement_timestamp()
    WHERE id=p_attempt_id RETURNING * INTO attempt;
  RETURN platform_private.document_recognition_claim_receipt(job,attempt);
END $$;

CREATE FUNCTION platform.record_document_recognition_token_count(p_attempt_id UUID,p_claim_token UUID,p_receipt JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF job.state<>'file_processing' OR job.generate_started_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt_id AND observed_state='ACTIVE') THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>4
    OR NOT p_receipt ?& ARRAY['model','request_sha256','config_sha256','input_tokens']
    OR p_receipt->>'model' IS DISTINCT FROM job.config_snapshot->>'model'
    OR p_receipt->>'config_sha256' IS DISTINCT FROM platform_private.document_recognition_sha(job.config_snapshot)
    OR jsonb_typeof(p_receipt->'request_sha256')<>'string' OR p_receipt->>'request_sha256' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_receipt->'input_tokens')<>'number' OR p_receipt->>'input_tokens' !~ '^[0-9]+$'
    OR (p_receipt->>'input_tokens')::NUMERIC NOT BETWEEN 1 AND (job.config_snapshot->>'inputTokenCeiling')::NUMERIC THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF attempt.token_count_receipt IS NOT NULL AND attempt.token_count_receipt IS DISTINCT FROM p_receipt THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  UPDATE platform_private.document_recognition_attempts SET token_count_receipt=p_receipt,stage='token_counted',updated_at=statement_timestamp()
    WHERE id=p_attempt_id RETURNING * INTO attempt;
  RETURN platform_private.document_recognition_claim_receipt(job,attempt);
END $$;

CREATE FUNCTION platform.begin_document_recognition_generation(p_attempt_id UUID,p_claim_token UUID,p_receipt JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,job.actor_auth_user_id,job.actor_membership_id);
  PERFORM platform_private.document_recognition_require_source(job);
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
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

CREATE FUNCTION platform_private.document_recognition_result_valid(p_result JSONB,p_pages INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate JSONB; warning JSONB; limit_length INTEGER;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>2
    OR NOT p_result ?& ARRAY['candidates','warnings'] OR jsonb_typeof(p_result->'candidates')<>'array'
    OR jsonb_typeof(p_result->'warnings')<>'array' OR jsonb_array_length(p_result->'candidates')>61
    OR jsonb_array_length(p_result->'warnings')>16 OR p_pages IS NULL THEN RETURN FALSE; END IF;
  -- Keep conflicting candidates in source order; the immutable ordinal link
  -- distinguishes proposals without selecting/deduplicating a human decision.
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_result->'candidates') LOOP
    IF jsonb_typeof(candidate)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(candidate))<>5
      OR NOT candidate ?& ARRAY['key','value','source_page','source_snippet','confidence'] THEN RETURN FALSE; END IF;
    SELECT max_length INTO limit_length FROM platform_private.student_profile_field_registry() WHERE field_key=candidate->>'key';
    IF NOT FOUND OR jsonb_typeof(candidate->'value')<>'string'
      OR char_length(candidate->>'value') NOT BETWEEN 1 AND limit_length OR btrim(candidate->>'value')='' THEN RETURN FALSE; END IF;
    IF candidate->'source_page'<>'null'::JSONB AND (jsonb_typeof(candidate->'source_page')<>'number'
      OR candidate->>'source_page' !~ '^[0-9]+$' OR (candidate->>'source_page')::NUMERIC NOT BETWEEN 1 AND p_pages) THEN RETURN FALSE; END IF;
    IF candidate->'source_snippet'<>'null'::JSONB AND (jsonb_typeof(candidate->'source_snippet')<>'string'
      OR char_length(candidate->>'source_snippet') NOT BETWEEN 1 AND 240 OR btrim(candidate->>'source_snippet')='') THEN RETURN FALSE; END IF;
    IF candidate->'confidence'<>'null'::JSONB AND (jsonb_typeof(candidate->'confidence')<>'number'
      OR (candidate->>'confidence')::NUMERIC NOT BETWEEN 0 AND 1) THEN RETURN FALSE; END IF;
  END LOOP;
  FOR warning IN SELECT value FROM jsonb_array_elements(p_result->'warnings') LOOP
    IF jsonb_typeof(warning)<>'string' OR char_length(warning #>> '{}') NOT BETWEEN 1 AND 240
      OR btrim(warning #>> '{}')='' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

CREATE FUNCTION platform.record_document_recognition_result(p_attempt_id UUID,p_claim_token UUID,p_result_text TEXT,
  p_result_sha256 TEXT,p_response_id TEXT,p_model_version TEXT,p_usage JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
  parsed JSONB; token_key TEXT;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF p_result_text IS NULL OR octet_length(p_result_text)>262144 OR p_result_sha256 IS DISTINCT FROM
    encode(sha256(convert_to(p_result_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'invalid_result' USING ERRCODE='22023'; END IF;
  parsed:=p_result_text::JSONB;
  IF NOT platform_private.document_recognition_result_valid(parsed,job.source_pages)
    OR p_response_id IS NULL OR p_response_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR p_model_version IS NULL OR p_model_version !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR p_usage IS NULL OR jsonb_typeof(p_usage)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_usage))<>3
    OR NOT p_usage ?& ARRAY['inputTokens','outputTokens','totalTokens'] THEN RAISE EXCEPTION 'invalid_result' USING ERRCODE='22023'; END IF;
  FOREACH token_key IN ARRAY ARRAY['inputTokens','outputTokens','totalTokens'] LOOP
    IF jsonb_typeof(p_usage->token_key)<>'number' OR p_usage->>token_key !~ '^[0-9]+$'
      OR (p_usage->>token_key)::NUMERIC NOT BETWEEN 0 AND 9007199254740991 THEN
      RAISE EXCEPTION 'invalid_result' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF attempt.result_sha256 IS NOT NULL THEN
    IF attempt.result_sha256 IS DISTINCT FROM p_result_sha256 OR attempt.response_id IS DISTINCT FROM p_response_id
      OR attempt.model_version IS DISTINCT FROM p_model_version OR attempt.usage IS DISTINCT FROM p_usage THEN
      RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
    RETURN platform_private.document_recognition_receipt(job,TRUE);
  END IF;
  IF job.state<>'generating' OR job.generate_started_at IS NULL THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  -- Save paid outcome even after actor revocation; publishing still rechecks
  -- current actor+case. No extracted values enter an audit event.
  UPDATE platform_private.document_recognition_attempts SET result=parsed,result_sha256=p_result_sha256,response_id=p_response_id,
    model_version=p_model_version,usage=p_usage,stage='result_saved',updated_at=statement_timestamp() WHERE id=p_attempt_id;
  UPDATE platform_private.document_recognition_jobs SET state='result_saved',updated_at=statement_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN platform_private.document_recognition_receipt(job,FALSE);
END $$;

CREATE FUNCTION platform.publish_document_recognition_proposals(p_attempt_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE; attempt platform_private.document_recognition_attempts%ROWTYPE;
  profile platform.student_profiles%ROWTYPE; candidate RECORD; proposal_id UUID; actor_profile UUID; changed_at TIMESTAMPTZ;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  SELECT * INTO attempt FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF job.state='review_ready' AND attempt.published_at IS NOT NULL THEN RETURN platform_private.document_recognition_receipt(job,TRUE); END IF;
  IF job.state<>'result_saved' OR attempt.result IS NULL THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  BEGIN
    PERFORM platform_private.document_recognition_require_actor(job.organization_id,job.student_case_id,job.actor_auth_user_id,job.actor_membership_id);
    PERFORM platform_private.document_recognition_require_source(job);
  EXCEPTION WHEN insufficient_privilege OR serialization_failure THEN
    UPDATE platform_private.document_recognition_jobs SET state='publication_blocked',failure_code='publication_blocked',updated_at=statement_timestamp()
      WHERE id=job.id RETURNING * INTO job;
    UPDATE platform_private.document_recognition_attempts SET stage='publication_blocked',updated_at=statement_timestamp() WHERE id=p_attempt_id;
    RETURN platform_private.document_recognition_receipt(job,FALSE);
  END;
  SELECT * INTO STRICT profile FROM platform.student_profiles WHERE organization_id=job.organization_id
    AND student_case_id=job.student_case_id AND id=job.student_profile_id FOR UPDATE;
  SELECT profile_id INTO STRICT actor_profile FROM platform_private.staff_membership_identity(job.organization_id,job.actor_membership_id);
  changed_at:=GREATEST(statement_timestamp(),profile.updated_at+INTERVAL '1 microsecond');
  FOR candidate IN SELECT value,ordinality FROM jsonb_array_elements(attempt.result->'candidates') WITH ORDINALITY LOOP
    INSERT INTO platform.student_profile_field_proposals(organization_id,student_case_id,student_profile_id,field_key,value,
      source_document_version_id,source_document_slot_id,source_page,source_snippet,confidence,created_by_membership_id,created_at)
      VALUES(job.organization_id,job.student_case_id,job.student_profile_id,candidate.value->>'key',candidate.value->>'value',
        job.source_version_id,job.source_document_slot_id,(candidate.value->>'source_page')::INTEGER,
        candidate.value->>'source_snippet',(candidate.value->>'confidence')::NUMERIC,job.actor_membership_id,changed_at)
      RETURNING id INTO proposal_id;
    INSERT INTO platform_private.document_recognition_proposal_links(attempt_id,ordinal,proposal_id)
      VALUES(p_attempt_id,candidate.ordinality,proposal_id);
  END LOOP;
  -- A single aggregate revision invalidates old UI snapshots. Confirmed fields
  -- and human review history remain exactly as they were before publication.
  UPDATE platform.student_profiles SET revision=revision+1,updated_at=changed_at,updated_by_membership_id=job.actor_membership_id
    WHERE id=profile.id AND organization_id=job.organization_id;
  UPDATE platform_private.document_recognition_jobs SET state='review_ready',proposal_count=jsonb_array_length(attempt.result->'candidates'),
    failure_code=NULL,updated_at=changed_at WHERE id=job.id RETURNING * INTO job;
  UPDATE platform_private.document_recognition_attempts SET stage='review_ready',published_at=changed_at,updated_at=changed_at WHERE id=p_attempt_id;
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,
    before_state,after_state,reason,request_id) VALUES(job.organization_id,'user',actor_profile,'auth:' || job.actor_auth_user_id::TEXT,
    'student.profile.recognition.publish','student_profile',profile.id,jsonb_build_object('profile_revision',profile.revision),
    jsonb_build_object('job_id',job.id,'attempt_id',p_attempt_id,'result_sha256',attempt.result_sha256,
      'proposal_count',job.proposal_count,'profile_revision',profile.revision+1),'Document recognition proposals require human review',job.request_id);
  RETURN platform_private.document_recognition_receipt(job,FALSE);
END $$;

CREATE FUNCTION platform.finish_document_recognition(p_attempt_id UUID,p_claim_token UUID,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE job platform_private.document_recognition_jobs%ROWTYPE;
BEGIN
  job:=platform_private.document_recognition_lock_claim(p_attempt_id,p_claim_token);
  IF p_failure_code IS NULL OR p_failure_code NOT IN ('access_revoked','source_changed','source_unavailable','provider_rejected',
    'provider_unavailable','invalid_result','upload_unknown','generation_unknown','cancelled') THEN
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

CREATE FUNCTION platform.claim_document_recognition_cleanup(p_worker_id TEXT)
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
      'bytes',file_row.expected_bytes,'mime_type',file_row.expected_mime,'lease_until',file_row.cleanup_lease_until);
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION platform_private.document_recognition_lock_cleanup(p_attempt_id UUID,p_cleanup_token UUID,p_resource_name TEXT)
RETURNS platform_private.document_recognition_provider_files
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE hint RECORD; file_row platform_private.document_recognition_provider_files%ROWTYPE;
BEGIN
  PERFORM platform_private.document_recognition_require_service();
  SELECT organization_id,job_id INTO hint FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=hint.organization_id FOR UPDATE;
  PERFORM 1 FROM platform_private.document_recognition_jobs WHERE id=hint.job_id FOR UPDATE;
  PERFORM 1 FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id FOR UPDATE;
  SELECT * INTO file_row FROM platform_private.document_recognition_provider_files WHERE attempt_id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR p_cleanup_token IS NULL OR file_row.cleanup_token IS DISTINCT FROM p_cleanup_token
    OR file_row.resource_name IS DISTINCT FROM p_resource_name OR file_row.cleanup_lease_until<=statement_timestamp() THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  RETURN file_row;
END $$;

CREATE FUNCTION platform.begin_document_recognition_delete(p_attempt_id UUID,p_cleanup_token UUID,p_resource_name TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE file_row platform_private.document_recognition_provider_files%ROWTYPE;
BEGIN
  file_row:=platform_private.document_recognition_lock_cleanup(p_attempt_id,p_cleanup_token,p_resource_name);
  IF file_row.confirmed_absent_at IS NOT NULL OR file_row.delete_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('dispatch',FALSE); END IF;
  -- Current cleanup claim must first GET and verify the exact owned metadata.
  -- An early 404 after an unknown upload is not a delete/absence authorization.
  IF file_row.observed_owned_at IS NULL OR file_row.checked_at IS NULL
    OR file_row.checked_at<file_row.cleanup_lease_until-INTERVAL '90 seconds' THEN
    RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
  UPDATE platform_private.document_recognition_provider_files SET delete_started_at=statement_timestamp() WHERE attempt_id=p_attempt_id;
  UPDATE platform_private.document_recognition_jobs SET cleanup_state='deleting',updated_at=statement_timestamp()
    WHERE id=(SELECT job_id FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id);
  RETURN jsonb_build_object('dispatch',TRUE);
END $$;

CREATE FUNCTION platform.record_document_recognition_cleanup(p_attempt_id UUID,p_cleanup_token UUID,p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE file_row platform_private.document_recognition_provider_files%ROWTYPE; outcome TEXT; next_state TEXT;
BEGIN
  IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_observation))<>6
    OR NOT p_observation ?& ARRAY['outcome','resource_name','state','sha256','bytes','mime_type'] THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  file_row:=platform_private.document_recognition_lock_cleanup(p_attempt_id,p_cleanup_token,p_observation->>'resource_name');
  outcome:=p_observation->>'outcome';
  IF outcome IS NULL OR outcome NOT IN ('present','not_found','unknown','delete_acknowledged') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF outcome='present' THEN
    IF p_observation->>'state' IS NULL OR p_observation->>'state' NOT IN ('ACTIVE','PROCESSING','FAILED')
      OR p_observation->>'sha256' IS DISTINCT FROM file_row.expected_sha256
      OR p_observation->'bytes' IS DISTINCT FROM to_jsonb(file_row.expected_bytes)
      OR p_observation->>'mime_type' IS DISTINCT FROM file_row.expected_mime THEN
      RAISE EXCEPTION 'source_changed' USING ERRCODE='40001'; END IF;
    UPDATE platform_private.document_recognition_provider_files SET observed_owned_at=COALESCE(observed_owned_at,statement_timestamp()),
      observed_state=p_observation->>'state',checked_at=statement_timestamp() WHERE attempt_id=p_attempt_id;
    next_state:='pending';
  ELSE
    IF p_observation->'state'<>'null'::JSONB OR p_observation->'sha256'<>'null'::JSONB OR p_observation->'bytes'<>'null'::JSONB
      OR p_observation->'mime_type'<>'null'::JSONB THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
    IF outcome='delete_acknowledged' THEN
      IF file_row.delete_started_at IS NULL THEN RAISE EXCEPTION 'claim_unavailable' USING ERRCODE='40001'; END IF;
      UPDATE platform_private.document_recognition_provider_files SET delete_acknowledged_at=statement_timestamp(),checked_at=statement_timestamp()
        WHERE attempt_id=p_attempt_id;
      next_state:='pending';
    ELSIF outcome='not_found' AND file_row.observed_owned_at IS NOT NULL THEN
      UPDATE platform_private.document_recognition_provider_files SET confirmed_absent_at=statement_timestamp(),checked_at=statement_timestamp(),
        cleanup_lease_until=statement_timestamp() WHERE attempt_id=p_attempt_id;
      next_state:='confirmed_absent';
    ELSE
      -- Unknown upload + 404 is deliberately unresolved. 403/network failures
      -- also remain unknown. Five bounded observations never prove deletion.
      UPDATE platform_private.document_recognition_provider_files SET checked_at=statement_timestamp(),cleanup_lease_until=statement_timestamp(),
        cleanup_next_at=statement_timestamp()+make_interval(secs=>LEAST(300,5*(2^cleanup_attempts)::INTEGER)) WHERE attempt_id=p_attempt_id;
      next_state:=CASE WHEN file_row.cleanup_attempts>=5 THEN 'unknown' ELSE 'pending' END;
    END IF;
  END IF;
  UPDATE platform_private.document_recognition_jobs SET cleanup_state=next_state,updated_at=statement_timestamp()
    WHERE id=(SELECT job_id FROM platform_private.document_recognition_attempts WHERE id=p_attempt_id);
  RETURN jsonb_build_object('cleanup_state',next_state);
END $$;

ALTER TABLE platform_private.document_recognition_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_provider_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_provider_files FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_proposal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_recognition_proposal_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.document_recognition_configs,platform_private.document_recognition_jobs,
  platform_private.document_recognition_attempts,platform_private.document_recognition_provider_files,
  platform_private.document_recognition_proposal_links FROM PUBLIC,anon,authenticated,service_role;

DO $function_acl$
DECLARE function_row RECORD;
BEGIN
  FOR function_row IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='platform_private' AND p.proname LIKE 'document_recognition_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',function_row.signature);
  END LOOP;
END $function_acl$;
DO $service_acl$
DECLARE function_row RECORD;
BEGIN
  FOR function_row IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='platform' AND p.proname IN ('begin_document_recognition_upload','observe_document_recognition_file',
      'record_document_recognition_token_count','begin_document_recognition_generation','record_document_recognition_result',
      'publish_document_recognition_proposals','finish_document_recognition','claim_document_recognition_cleanup',
      'begin_document_recognition_delete','record_document_recognition_cleanup') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',function_row.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',function_row.signature);
  END LOOP;
END $service_acl$;
REVOKE ALL ON FUNCTION platform.enqueue_document_recognition(UUID,UUID,UUID,BIGINT,UUID,UUID),
  platform.staff_document_recognition_job(UUID,UUID),platform.claim_document_recognition(TEXT),
  platform.renew_document_recognition_lease(UUID,UUID),
  platform.seal_document_recognition_preflight(UUID,UUID,TEXT,BIGINT,TEXT,INTEGER,TEXT),
  platform.finish_document_recognition_preflight(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.enqueue_document_recognition(UUID,UUID,UUID,BIGINT,UUID,UUID),
  platform.staff_document_recognition_job(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.claim_document_recognition(TEXT),
  platform.renew_document_recognition_lease(UUID,UUID),
  platform.seal_document_recognition_preflight(UUID,UUID,TEXT,BIGINT,TEXT,INTEGER,TEXT),
  platform.finish_document_recognition_preflight(UUID,UUID,TEXT) TO service_role;

COMMENT ON TABLE platform_private.document_recognition_configs IS
  'No credentials or implicit paid eligibility. No configuration is seeded or enabled by this migration.';
COMMENT ON TABLE platform_private.document_recognition_jobs IS
  'D3 durable intents/results/proposals/cleanup. No provider dispatcher, config seed or confirmed-value writer.';

COMMIT;
