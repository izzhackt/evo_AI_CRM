-- D4: immutable session-prepared Student Profile artifacts. Storage API creates
-- bytes/buckets; this migration never writes storage.buckets or storage.objects.
-- Service RPCs read metadata only. Frozen values have no service-role reader.
-- https://supabase.com/docs/guides/storage/security/access-control
BEGIN;

CREATE TABLE platform_private.document_export_input_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frozen_profile JSONB NOT NULL CHECK (jsonb_typeof(frozen_profile) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE platform_private.document_export_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id UUID NOT NULL UNIQUE REFERENCES platform_private.document_export_input_snapshots(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  profile_revision BIGINT NOT NULL CHECK (profile_revision BETWEEN 1 AND 9007199254740991),
  source_versions JSONB NOT NULL CHECK (jsonb_typeof(source_versions) = 'array'),
  field_reviews_sha256 TEXT NOT NULL CHECK (field_reviews_sha256 ~ '^[a-f0-9]{64}$'),
  workspace_revision TEXT NOT NULL CHECK (workspace_revision ~ '^[a-f0-9]{64}$'),
  input_snapshot_sha256 TEXT NOT NULL CHECK (input_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  request_id UUID NOT NULL UNIQUE,
  request_sha256 TEXT NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  kind TEXT NOT NULL DEFAULT 'student_profile' CHECK (kind = 'student_profile'),
  mode TEXT NOT NULL CHECK (mode IN ('draft','final')),
  template_sha256 TEXT NOT NULL DEFAULT '2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0'
    CHECK (template_sha256 = '2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0'),
  renderer_version TEXT NOT NULL DEFAULT 'evo-student-profile-docx-v1' CHECK (renderer_version = 'evo-student-profile-docx-v1'),
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    CHECK (mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','stored_unverified','ready','unknown','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  begun_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  claim_token UUID UNIQUE,
  bucket_id TEXT NOT NULL DEFAULT 'platform-document-exports' CHECK (bucket_id = 'platform-document-exports'),
  object_name TEXT,
  output_sha256 TEXT CHECK (output_sha256 ~ '^[a-f0-9]{64}$'),
  output_bytes INTEGER CHECK (output_bytes BETWEEN 1 AND 5242880),
  sealed_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  receipt_id UUID UNIQUE,
  failure_code TEXT CHECK (failure_code IN ('profile_not_ready','source_changed','access_changed','source_unavailable',
    'template_unavailable','integrity_failed','export_failed','storage_unavailable')),
  completion_input_sha256 TEXT CHECK (completion_input_sha256 ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id,student_case_id,student_profile_id)
    REFERENCES platform.student_profiles(organization_id,student_case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (bucket_id,object_name),
  CHECK ((begun_at IS NULL AND lease_expires_at IS NULL AND claim_token IS NULL)
    OR (begun_at IS NOT NULL AND lease_expires_at > begun_at AND claim_token IS NOT NULL)),
  CHECK ((sealed_at IS NULL AND object_name IS NULL AND output_sha256 IS NULL AND output_bytes IS NULL)
    OR (sealed_at IS NOT NULL AND begun_at IS NOT NULL AND output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
      AND object_name = organization_id::TEXT || '/' || student_case_id::TEXT || '/' || id::TEXT || '.docx')),
  CHECK ((state = 'ready' AND ready_at IS NOT NULL AND receipt_id IS NOT NULL AND sealed_at IS NOT NULL AND failure_code IS NULL)
    OR (state <> 'ready' AND ready_at IS NULL AND receipt_id IS NULL)),
  CHECK ((state IN ('failed','unknown')) = (failure_code IS NOT NULL))
);
CREATE INDEX document_export_artifacts_case_idx ON platform_private.document_export_artifacts(organization_id,student_case_id,created_at DESC,id);
CREATE INDEX document_export_artifacts_profile_idx ON platform_private.document_export_artifacts(student_profile_id);
CREATE INDEX document_export_artifacts_actor_profile_idx ON platform_private.document_export_artifacts(actor_profile_id);
CREATE INDEX document_export_artifacts_actor_membership_idx ON platform_private.document_export_artifacts(organization_id,actor_membership_id);

CREATE TABLE platform_private.document_export_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES platform_private.document_export_artifacts(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL UNIQUE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('prepared','begun','sealed','ready','failed','unknown','reconciled')),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  outcome JSONB NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX document_export_events_artifact_idx ON platform_private.document_export_events(artifact_id,created_at);

CREATE TABLE platform_private.document_export_download_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES platform_private.document_export_artifacts(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() + INTERVAL '2 minutes',
  consumed_at TIMESTAMPTZ,
  completion_sha256 TEXT CHECK (completion_sha256 ~ '^[a-f0-9]{64}$'),
  completion JSONB,
  FOREIGN KEY (organization_id,actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '2 minutes'),
  CHECK ((completion_sha256 IS NULL) = (completion IS NULL))
);
CREATE INDEX document_export_download_artifact_idx ON platform_private.document_export_download_grants(artifact_id);
CREATE INDEX document_export_download_actor_idx ON platform_private.document_export_download_grants(organization_id,actor_membership_id);
CREATE INDEX document_export_download_profile_idx ON platform_private.document_export_download_grants(actor_profile_id);

ALTER TABLE platform_private.document_export_input_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_export_download_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.document_export_input_snapshots,platform_private.document_export_artifacts,
  platform_private.document_export_events,platform_private.document_export_download_grants
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.document_export_immutable_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'document_export_history_immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER document_export_snapshot_immutable BEFORE UPDATE OR DELETE ON platform_private.document_export_input_snapshots
  FOR EACH ROW EXECUTE FUNCTION platform_private.document_export_immutable_history();
CREATE TRIGGER document_export_events_immutable BEFORE UPDATE OR DELETE ON platform_private.document_export_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.document_export_immutable_history();
CREATE FUNCTION platform_private.preserve_document_export_artifact()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mutable TEXT[] := ARRAY['state','begun_at','lease_expires_at','claim_token','object_name','output_sha256',
  'output_bytes','sealed_at','ready_at','receipt_id','failure_code','completion_input_sha256'];
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document_export_history_immutable' USING ERRCODE='55000'; END IF;
  IF OLD.state IN ('ready','failed') OR (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable)
    OR (OLD.begun_at IS NOT NULL AND ROW(NEW.begun_at,NEW.lease_expires_at,NEW.claim_token)
      IS DISTINCT FROM ROW(OLD.begun_at,OLD.lease_expires_at,OLD.claim_token))
    OR (OLD.sealed_at IS NOT NULL AND ROW(NEW.object_name,NEW.output_sha256,NEW.output_bytes,NEW.sealed_at)
      IS DISTINCT FROM ROW(OLD.object_name,OLD.output_sha256,OLD.output_bytes,OLD.sealed_at)) THEN
    RAISE EXCEPTION 'document_export_history_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_export_artifact_immutable BEFORE UPDATE OR DELETE ON platform_private.document_export_artifacts
  FOR EACH ROW EXECUTE FUNCTION platform_private.preserve_document_export_artifact();

CREATE FUNCTION platform_private.document_export_review_digest(p_profile_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.bw1_input_sha256(COALESCE(jsonb_agg(jsonb_build_object(
    'field_key',f.field_key,'review_state',f.review_state,'profile_revision',f.profile_revision,
    'reviewed_at',f.reviewed_at,'reviewed_by',f.reviewed_by_membership_id,
    'source_version_id',f.source_document_version_id,'source_page',f.source_page,
    'review_ids',(SELECT COALESCE(jsonb_agg(r.id ORDER BY r.profile_revision_after),'[]'::JSONB)
      FROM platform.student_profile_field_reviews r WHERE r.student_profile_id=f.student_profile_id AND r.field_key=f.field_key)
  ) ORDER BY f.field_key),'[]'::JSONB)) FROM platform.student_profile_fields f WHERE f.student_profile_id=p_profile_id
$$;
CREATE FUNCTION platform_private.document_export_workspace_digest(p_profile_id UUID,p_revision BIGINT,p_reviews_hash TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.bw1_input_sha256(jsonb_build_object('kind','student_profile','profile_id',p_profile_id,
    'profile_revision',p_revision,'field_reviews_sha256',p_reviews_hash,
    'template_sha256','2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0',
    'renderer_version','evo-student-profile-docx-v1'))
$$;

-- Metadata-only authorization. A historical ready export does not require the
-- latest profile revision, but always requires current access to every source.
CREATE FUNCTION platform_private.document_export_actor_authorized(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_artifact.organization_id,p_member) i WHERE i.auth_user_id=p_auth)
    AND platform_private.staff_can_access(p_artifact.organization_id,p_member,'profile.read.full','student_case',p_artifact.student_case_id)
    AND platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','student_case',p_artifact.student_case_id)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifact.source_versions) source
      WHERE NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','document',(source->>'id')::UUID))
$$;
CREATE FUNCTION platform_private.document_export_live_failure(
  p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID,p_require_current BOOLEAN
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE source JSONB; version_row RECORD; current_profile RECORD;
BEGIN
  IF NOT platform_private.document_export_actor_authorized(p_artifact,p_auth,p_member) THEN
    RETURN 'access_changed';
  END IF;
  FOR source IN SELECT * FROM jsonb_array_elements(p_artifact.source_versions) LOOP
    IF NOT platform_private.staff_can_access(p_artifact.organization_id,p_member,'document.download','document',(source->>'id')::UUID) THEN
      RETURN 'access_changed';
    END IF;
    SELECT v.id,v.sha256_hex,v.integrity_status,v.malware_status,s.removed_at INTO version_row
    FROM platform.document_versions v JOIN platform.document_slots s ON s.organization_id=v.organization_id AND s.id=v.document_slot_id
    WHERE v.organization_id=p_artifact.organization_id AND v.student_case_id=p_artifact.student_case_id AND v.id=(source->>'id')::UUID
      AND EXISTS (SELECT 1 FROM platform_private.document_upload_finalizations f
        WHERE f.organization_id=v.organization_id AND f.student_case_id=v.student_case_id AND f.document_version_id=v.id);
    IF NOT FOUND OR version_row.sha256_hex IS DISTINCT FROM source->>'sha256'
      OR version_row.integrity_status::TEXT <> 'verified' OR version_row.malware_status::TEXT <> 'clean'
      OR version_row.removed_at IS NOT NULL THEN RETURN 'source_unavailable'; END IF;
  END LOOP;
  IF p_require_current THEN
    SELECT id,revision INTO current_profile FROM platform.student_profiles
      WHERE organization_id=p_artifact.organization_id AND student_case_id=p_artifact.student_case_id AND id=p_artifact.student_profile_id;
    IF NOT FOUND OR current_profile.revision <> p_artifact.profile_revision
      OR platform_private.document_export_review_digest(current_profile.id) <> p_artifact.field_reviews_sha256 THEN RETURN 'source_changed'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION platform_private.document_export_receipt(p_artifact platform_private.document_export_artifacts,p_auth UUID,p_member UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',p_artifact.id,'student_case_id',p_artifact.student_case_id,'student_profile_id',p_artifact.student_profile_id,
    'profile_revision',p_artifact.profile_revision,'workspace_revision',p_artifact.workspace_revision,
    'input_snapshot_sha256',p_artifact.input_snapshot_sha256,'field_reviews_sha256',p_artifact.field_reviews_sha256,
    'kind',p_artifact.kind,'mode',p_artifact.mode,'state',p_artifact.state,'template_sha256',p_artifact.template_sha256,
    'renderer_version',p_artifact.renderer_version,'created_at',p_artifact.created_at,'ready_at',p_artifact.ready_at,
    'output_sha256',p_artifact.output_sha256,'output_bytes',p_artifact.output_bytes,'mime_type',p_artifact.mime_type,
    'receipt_id',p_artifact.receipt_id,'failure_code',p_artifact.failure_code,
    'historical',NOT EXISTS(SELECT 1 FROM platform.student_profiles p WHERE p.id=p_artifact.student_profile_id
      AND p.revision=p_artifact.profile_revision AND platform_private.document_export_review_digest(p.id)=p_artifact.field_reviews_sha256),
    'can_download',p_artifact.state='ready' AND platform_private.document_export_live_failure(p_artifact,p_auth,p_member,FALSE) IS NULL)
$$;
CREATE FUNCTION platform_private.document_export_storage_target(p_artifact platform_private.document_export_artifacts,p_expires_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_artifact.sealed_at IS NULL THEN NULL ELSE jsonb_build_object('bucket_id',p_artifact.bucket_id,
    'object_name',p_artifact.object_name,'mime_type',p_artifact.mime_type,'expires_at',p_expires_at) END
$$;
CREATE FUNCTION platform_private.require_document_export_service()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'document_export_service_required' USING ERRCODE='42501'; END IF;
END $$;

-- Match the ordinary staff command serialization. Never hold these locks over
-- rendering or a Storage request: each command is one short database transaction.
CREATE FUNCTION platform_private.lock_document_export(p_artifact_id UUID,p_extra_member UUID DEFAULT NULL)
RETURNS platform_private.document_export_artifacts LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.organizations WHERE id=a.organization_id FOR UPDATE;
  PERFORM platform_private.lock_bw3_request(a.request_id);
  PERFORM platform_private.staff_lock_memberships(a.organization_id,ARRAY[a.actor_membership_id,p_extra_member]);
  PERFORM 1 FROM platform.student_cases WHERE id=a.student_case_id AND organization_id=a.organization_id FOR UPDATE;
  PERFORM 1 FROM platform.student_profiles WHERE id=a.student_profile_id AND organization_id=a.organization_id FOR UPDATE;
  PERFORM 1 FROM platform.document_slots s WHERE s.organization_id=a.organization_id
    AND s.id IN (SELECT v.document_slot_id FROM platform.document_versions v WHERE v.organization_id=a.organization_id
      AND v.id IN (SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x)) ORDER BY s.id FOR SHARE;
  PERFORM 1 FROM platform.document_versions v WHERE v.organization_id=a.organization_id
    AND v.id IN (SELECT (x->>'id')::UUID FROM jsonb_array_elements(a.source_versions) x) ORDER BY v.id FOR SHARE;
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id FOR UPDATE;
  RETURN a;
END $$;

CREATE FUNCTION platform.staff_document_export_workspace(p_student_case_id UUID)
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
    ORDER BY a.created_at DESC,a.id),'[]'::JSONB) INTO exports
    FROM platform_private.document_export_artifacts a WHERE a.organization_id=org AND a.student_case_id=p_student_case_id;
  RETURN jsonb_build_object('schema_version',1,'student_case_id',p_student_case_id,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'revision',p.revision) END,
    'workspace_revision',CASE WHEN p.id IS NULL THEN NULL ELSE platform_private.document_export_workspace_digest(p.id,p.revision,
      platform_private.document_export_review_digest(p.id)) END,'can_export',p.id IS NOT NULL,'artifacts',exports);
END $$;

CREATE FUNCTION platform.prepare_document_export(p_student_case_id UUID,p_mode TEXT,p_expected_workspace_revision TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; p RECORD; org UUID; frozen JSONB; fields JSONB; prep UUID; digest TEXT; review_hash TEXT; request_hash TEXT;
  a platform_private.document_export_artifacts%ROWTYPE; source_data JSONB; failure TEXT;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  IF p_student_case_id IS NULL OR p_request_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('draft','final')
    OR p_expected_workspace_revision IS NULL OR p_expected_workspace_revision !~ '^[a-f0-9]{64}$' THEN
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
    OR NOT platform_private.staff_can_access_for_actor(org,'document.download','student_case',p_student_case_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  request_hash := platform_private.bw1_input_sha256(jsonb_build_object('case_id',p_student_case_id,'mode',p_mode,
    'workspace_revision',p_expected_workspace_revision,'auth_user_id',actor.auth_user_id,'membership_id',actor.membership_id));
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF a.request_sha256 <> request_hash THEN RAISE EXCEPTION 'document_export_request_conflict' USING ERRCODE='23505'; END IF;
    -- Replays after begin never expose frozen values or authorize another render.
    IF a.begun_at IS NULL AND a.state='pending' THEN
      failure:=platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,TRUE);
      IF failure IS NULL THEN SELECT frozen_profile INTO frozen FROM platform_private.document_export_input_snapshots WHERE id=a.preparation_id; END IF;
    END IF;
    RETURN jsonb_build_object('schema_version',1,'preparation_id',a.preparation_id,
      'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id),'frozen_profile',frozen);
  END IF;
  SELECT id,revision INTO p FROM platform.student_profiles WHERE organization_id=org AND student_case_id=p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_not_ready' USING ERRCODE='55000'; END IF;
  review_hash:=platform_private.document_export_review_digest(p.id);
  digest:=platform_private.document_export_workspace_digest(p.id,p.revision,review_hash);
  IF digest<>p_expected_workspace_revision THEN RAISE EXCEPTION 'document_export_stale_revision' USING ERRCODE='40001'; END IF;
  -- The one values-bearing read remains on the authenticated session path.
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
    FROM platform.document_versions v WHERE v.id IN (SELECT (f->>'source_document_version_id')::UUID FROM jsonb_array_elements(fields) f
      WHERE f->>'source_document_version_id' IS NOT NULL);
  INSERT INTO platform_private.document_export_input_snapshots(frozen_profile) VALUES(frozen) RETURNING id INTO prep;
  INSERT INTO platform_private.document_export_artifacts(preparation_id,organization_id,student_case_id,student_profile_id,
    actor_auth_user_id,actor_profile_id,actor_membership_id,profile_revision,source_versions,field_reviews_sha256,
    workspace_revision,input_snapshot_sha256,request_id,request_sha256,mode)
  VALUES(prep,org,p_student_case_id,p.id,actor.auth_user_id,actor.profile_id,actor.membership_id,p.revision,source_data,
    review_hash,digest,platform_private.bw1_input_sha256(frozen),p_request_id,request_hash,p_mode) RETURNING * INTO a;
  failure:=platform_private.document_export_live_failure(a,actor.auth_user_id,actor.membership_id,TRUE);
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'document_export_source_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.record_document_export_event(a,'prepared',gen_random_uuid(),request_hash,jsonb_build_object('state','pending'));
  RETURN jsonb_build_object('schema_version',1,'preparation_id',prep,
    'artifact',platform_private.document_export_receipt(a,actor.auth_user_id,actor.membership_id),'frozen_profile',frozen);
END $$;

CREATE FUNCTION platform_private.record_document_export_event(p_artifact platform_private.document_export_artifacts,
  p_kind TEXT,p_request_id UUID,p_input_sha256 TEXT,p_outcome JSONB,p_actor_profile UUID DEFAULT NULL,p_actor_auth UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO platform_private.document_export_events(artifact_id,request_id,event_kind,input_sha256,outcome)
    VALUES(p_artifact.id,p_request_id,p_kind,p_input_sha256,p_outcome);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
    resource_type,resource_id,after_state,reason,request_id)
  VALUES(p_artifact.organization_id,'user',COALESCE(p_actor_profile,p_artifact.actor_profile_id),
    'auth:'||COALESCE(p_actor_auth,p_artifact.actor_auth_user_id)::TEXT,'document.export.'||p_kind,
    'student_profile',p_artifact.student_profile_id,
    jsonb_build_object('artifact_id',p_artifact.id,'profile_revision',p_artifact.profile_revision,
      'state',p_artifact.state,'mode',p_artifact.mode,'output_sha256',p_artifact.output_sha256,
      'output_bytes',p_artifact.output_bytes,'failure_code',p_artifact.failure_code),
    'Persistent artifact outcome; not a delivery or university submission receipt',p_request_id);
END $$;

CREATE FUNCTION platform.begin_document_export(p_preparation_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; artifact_id UUID; failure TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  SELECT id INTO artifact_id FROM platform_private.document_export_artifacts WHERE preparation_id=p_preparation_id;
  a:=platform_private.lock_document_export(artifact_id);
  IF p_actor_auth_user_id IS DISTINCT FROM a.actor_auth_user_id OR p_actor_membership_id IS DISTINCT FROM a.actor_membership_id THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF a.begun_at IS NOT NULL OR a.state<>'pending' THEN
    RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),
      'created',FALSE,'claim_token',NULL); END IF;
  failure:=platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,TRUE);
  IF failure IS NOT NULL THEN
    UPDATE platform_private.document_export_artifacts SET state='failed',failure_code=failure WHERE id=a.id RETURNING * INTO a;
    PERFORM platform_private.record_document_export_event(a,'failed',gen_random_uuid(),a.request_sha256,jsonb_build_object('failure_code',failure));
    RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),
      'created',FALSE,'claim_token',NULL);
  END IF;
  UPDATE platform_private.document_export_artifacts SET begun_at=statement_timestamp(),
    lease_expires_at=statement_timestamp()+INTERVAL '10 minutes',claim_token=gen_random_uuid() WHERE id=a.id RETURNING * INTO a;
  PERFORM platform_private.record_document_export_event(a,'begun',gen_random_uuid(),a.request_sha256,jsonb_build_object('state',a.state));
  RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),
    'created',TRUE,'claim_token',a.claim_token);
END $$;

CREATE FUNCTION platform.seal_document_export_output(p_artifact_id UUID,p_claim_token UUID,p_output_sha256 TEXT,p_output_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; failure TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_output_sha256 IS NULL OR p_output_sha256 !~ '^[a-f0-9]{64}$' OR p_output_bytes IS NULL OR p_output_bytes NOT BETWEEN 1 AND 5242880 THEN
    RAISE EXCEPTION 'document_export_invalid_output' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
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
    IF a.output_sha256<>p_output_sha256 OR a.output_bytes<>p_output_bytes THEN
      RAISE EXCEPTION 'document_export_output_conflict' USING ERRCODE='23505'; END IF;
  ELSE
    UPDATE platform_private.document_export_artifacts SET output_sha256=p_output_sha256,output_bytes=p_output_bytes,
      object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||'.docx',sealed_at=statement_timestamp()
      WHERE id=a.id RETURNING * INTO a;
    PERFORM platform_private.record_document_export_event(a,'sealed',gen_random_uuid(),
      platform_private.bw1_input_sha256(jsonb_build_object('sha256',p_output_sha256,'bytes',p_output_bytes)),jsonb_build_object('state',a.state));
  END IF;
  RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,a.actor_auth_user_id,a.actor_membership_id),
    'storage',platform_private.document_export_storage_target(a,a.lease_expires_at));
END $$;

CREATE FUNCTION platform.complete_document_export(p_artifact_id UUID,p_claim_token UUID,p_outcome TEXT,p_failure_code TEXT,
  p_observed_sha256 TEXT,p_observed_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; failure TEXT; fingerprint TEXT; outcome TEXT:=p_outcome;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_outcome IS NULL OR p_outcome NOT IN ('ready','failed','unknown')
    OR (p_outcome='ready' AND (p_failure_code IS NOT NULL OR p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$'
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 5242880))
    OR (p_outcome<>'ready' AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL OR p_failure_code IS NULL
      OR p_failure_code NOT IN ('profile_not_ready','source_changed','access_changed','source_unavailable',
        'template_unavailable','integrity_failed','export_failed','storage_unavailable')))
    OR (p_outcome='unknown' AND p_failure_code<>'storage_unavailable') THEN
    RAISE EXCEPTION 'document_export_invalid_completion' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id);
  IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'document_export_claim_invalid' USING ERRCODE='42501'; END IF;
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

CREATE FUNCTION platform.inspect_document_export_reconciliation(p_artifact_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE;
BEGIN
  PERFORM platform_private.require_document_export_service();
  a:=platform_private.lock_document_export(p_artifact_id,p_actor_membership_id);
  IF NOT platform_private.document_export_actor_authorized(a,p_actor_auth_user_id,p_actor_membership_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  IF a.state='pending' AND COALESCE(a.lease_expires_at,a.created_at+INTERVAL '10 minutes')>clock_timestamp() THEN
    RAISE EXCEPTION 'document_export_artifact_pending' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),
    'storage',CASE WHEN a.state IN ('ready','failed')
      OR platform_private.document_export_live_failure(a,a.actor_auth_user_id,a.actor_membership_id,TRUE) IS NOT NULL
      THEN NULL ELSE platform_private.document_export_storage_target(a,statement_timestamp()+INTERVAL '2 minutes') END);
END $$;

CREATE FUNCTION platform.reconcile_document_export(p_artifact_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID,
  p_request_id UUID,p_observed_sha256 TEXT,p_observed_bytes INTEGER,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; event platform_private.document_export_events%ROWTYPE;
  caller RECORD; fingerprint TEXT; failure TEXT; result JSONB; state_value TEXT;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF p_request_id IS NULL OR (p_failure_code IS NOT NULL AND p_failure_code NOT IN ('source_unavailable','storage_unavailable','integrity_failed'))
    OR (p_failure_code IS NULL AND (p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$'
      OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 5242880))
    OR (p_failure_code IS NOT NULL AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL)) THEN
    RAISE EXCEPTION 'document_export_invalid_reconciliation' USING ERRCODE='22023'; END IF;
  a:=platform_private.lock_document_export(p_artifact_id,p_actor_membership_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  SELECT * INTO caller FROM platform_private.staff_membership_identity(a.organization_id,p_actor_membership_id) i WHERE i.auth_user_id=p_actor_auth_user_id;
  IF NOT FOUND OR NOT platform_private.document_export_actor_authorized(a,p_actor_auth_user_id,p_actor_membership_id) THEN
    RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  -- The replay key describes the employee's command, not a later observation.
  -- A lost response followed by a changed Storage read still returns the first
  -- committed command outcome. A new explicit check uses a new request ID.
  fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('artifact_id',a.id,'auth_user_id',p_actor_auth_user_id,
    'membership_id',p_actor_membership_id));
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
    ELSIF a.sealed_at IS NULL OR a.output_sha256 IS DISTINCT FROM p_observed_sha256 OR a.output_bytes IS DISTINCT FROM p_observed_bytes THEN
      failure:='integrity_failed'; END IF;
  END IF;
  state_value:=CASE WHEN failure IS NULL THEN 'ready' WHEN failure='storage_unavailable' THEN 'unknown' ELSE 'failed' END;
  UPDATE platform_private.document_export_artifacts SET state=state_value,failure_code=failure,
    ready_at=CASE WHEN state_value='ready' THEN statement_timestamp() END,
    receipt_id=CASE WHEN state_value='ready' THEN gen_random_uuid() END WHERE id=a.id RETURNING * INTO a;
  result:=platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id);
  PERFORM platform_private.record_document_export_event(a,'reconciled',p_request_id,fingerprint,result,caller.profile_id,p_actor_auth_user_id);
  RETURN result;
END $$;

CREATE FUNCTION platform.grant_document_export_download(p_artifact_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; actor RECORD; g platform_private.document_export_download_grants%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'document_export_staff_session_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM platform_private.document_export_artifacts WHERE id=p_artifact_id;
  SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=a.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(a.id,actor.membership_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
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

CREATE FUNCTION platform.consume_document_export_download(p_grant_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; g platform_private.document_export_download_grants%ROWTYPE;
BEGIN
  PERFORM platform_private.require_document_export_service();
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(g.artifact_id,p_actor_membership_id);
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id FOR UPDATE;
  IF g.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR g.actor_membership_id IS DISTINCT FROM p_actor_membership_id
    OR g.consumed_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR a.state<>'ready'
    OR platform_private.document_export_live_failure(a,p_actor_auth_user_id,p_actor_membership_id,FALSE) IS NOT NULL THEN
    RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  UPDATE platform_private.document_export_download_grants SET consumed_at=statement_timestamp() WHERE id=g.id RETURNING * INTO g;
  RETURN jsonb_build_object('grant_id',g.id,'artifact',platform_private.document_export_receipt(a,p_actor_auth_user_id,p_actor_membership_id),
    'storage',platform_private.document_export_storage_target(a,g.expires_at));
END $$;

CREATE FUNCTION platform.complete_document_export_download(p_grant_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID,
  p_observed_sha256 TEXT,p_observed_bytes INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.document_export_artifacts%ROWTYPE; g platform_private.document_export_download_grants%ROWTYPE;
  failure TEXT; fingerprint TEXT; result JSONB;
BEGIN
  PERFORM platform_private.require_document_export_service();
  IF (p_observed_sha256 IS NULL) <> (p_observed_bytes IS NULL)
    OR (p_observed_sha256 IS NOT NULL AND (p_observed_sha256 !~ '^[a-f0-9]{64}$' OR p_observed_bytes NOT BETWEEN 1 AND 5242880)) THEN
    RAISE EXCEPTION 'document_export_invalid_download_outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO g FROM platform_private.document_export_download_grants WHERE id=p_grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_export_grant_unavailable' USING ERRCODE='42501'; END IF;
  a:=platform_private.lock_document_export(g.artifact_id,p_actor_membership_id);
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
    'student_profile',a.student_profile_id,result,'Storage readback and live access verified; not confirmation of delivery',g.request_id);
  RETURN result;
END $$;

-- Default function privileges are never a grant to private data. Enumerate this
-- migration's functions; no unrelated historical API or role bundle is changed.
REVOKE ALL ON FUNCTION
  platform_private.document_export_immutable_history(),platform_private.preserve_document_export_artifact(),
  platform_private.document_export_review_digest(UUID),platform_private.document_export_workspace_digest(UUID,BIGINT,TEXT),
  platform_private.document_export_actor_authorized(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.document_export_live_failure(platform_private.document_export_artifacts,UUID,UUID,BOOLEAN),
  platform_private.document_export_receipt(platform_private.document_export_artifacts,UUID,UUID),
  platform_private.document_export_storage_target(platform_private.document_export_artifacts,TIMESTAMPTZ),
  platform_private.require_document_export_service(),platform_private.lock_document_export(UUID,UUID),
  platform_private.record_document_export_event(platform_private.document_export_artifacts,TEXT,UUID,TEXT,JSONB,UUID,UUID),
  platform.staff_document_export_workspace(UUID),platform.prepare_document_export(UUID,TEXT,TEXT,UUID),
  platform.begin_document_export(UUID,UUID,UUID),platform.seal_document_export_output(UUID,UUID,TEXT,INTEGER),
  platform.complete_document_export(UUID,UUID,TEXT,TEXT,TEXT,INTEGER),
  platform.inspect_document_export_reconciliation(UUID,UUID,UUID),platform.reconcile_document_export(UUID,UUID,UUID,UUID,TEXT,INTEGER,TEXT),
  platform.grant_document_export_download(UUID,UUID),platform.consume_document_export_download(UUID,UUID,UUID),
  platform.complete_document_export_download(UUID,UUID,UUID,TEXT,INTEGER)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_document_export_workspace(UUID),platform.prepare_document_export(UUID,TEXT,TEXT,UUID),
  platform.grant_document_export_download(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.begin_document_export(UUID,UUID,UUID),platform.seal_document_export_output(UUID,UUID,TEXT,INTEGER),
  platform.complete_document_export(UUID,UUID,TEXT,TEXT,TEXT,INTEGER),platform.inspect_document_export_reconciliation(UUID,UUID,UUID),
  platform.reconcile_document_export(UUID,UUID,UUID,UUID,TEXT,INTEGER,TEXT),platform.consume_document_export_download(UUID,UUID,UUID),
  platform.complete_document_export_download(UUID,UUID,UUID,TEXT,INTEGER) TO service_role;

COMMENT ON TABLE platform_private.document_export_input_snapshots IS 'Immutable confirmed values prepared and returned only under the staff Auth session. No service-role value reader.';
COMMENT ON TABLE platform_private.document_export_artifacts IS 'Versioned stored results; ready requires trusted byte readback plus live authority. Legacy161 generated attempts are not artifacts.';
-- The persistent producer's real Auth/DB/Storage/browser replacement is proved.
-- Retire the transient producer with the HTTP/UI cutover, preserving migration161,
-- its function definitions and immutable legacy attempt/audit history.
REVOKE EXECUTE ON FUNCTION
  platform.begin_student_profile_export(UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,UUID),
  platform.complete_student_profile_export(UUID,TEXT,TEXT,INTEGER,TEXT)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
COMMIT;
