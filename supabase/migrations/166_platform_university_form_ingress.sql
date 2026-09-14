-- D4 trusted private-template ingress. No bucket creation or Storage writes.
-- SQL verifies relational bindings and server observations, not file bytes itself.
-- Lock order follows https://www.postgresql.org/docs/current/explicit-locking.html:
-- organization -> request(s) -> memberships -> catalog -> template -> attempt -> grant.
BEGIN;

CREATE TABLE platform_private.university_template_ingresses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
 organization_id UUID NOT NULL, catalog_institution_id UUID NOT NULL, catalog_source_revision TEXT NOT NULL,
 template_id UUID NOT NULL, template_version_id UUID NOT NULL UNIQUE,
 expected_revision BIGINT NOT NULL CHECK(expected_revision BETWEEN 2 AND 9007199254740990),
 actor_auth_user_id UUID NOT NULL, actor_membership_id UUID NOT NULL, actor_access_version BIGINT NOT NULL,
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), byte_size BIGINT NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
 mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 bucket_id TEXT NOT NULL CHECK(bucket_id='platform-document-templates'), object_name TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','processing','sealed','verified','failed','unknown','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), claim_token UUID UNIQUE, begun_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
 sealed_at TIMESTAMPTZ, scan_proof JSONB, inspector_image_id TEXT, inspector_revision TEXT, runtime_revision TEXT,
 manifest JSONB, manifest_sha256 TEXT, seal_input_sha256 TEXT, completion_input_sha256 TEXT,
 inspection_receipt_id UUID UNIQUE REFERENCES platform_private.university_form_inspection_receipts(id), verified_revision BIGINT,
 failure_code TEXT CHECK(failure_code IN ('source_mismatch','malware_detected','scanner_unavailable','template_not_eligible',
  'template_runtime_unavailable','storage_unavailable','storage_missing','access_changed','source_changed','archived','stale_revision','expired','cancelled','integrity_failed')),
 UNIQUE(organization_id,template_id,id), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,template_id,template_version_id) REFERENCES platform_private.university_form_template_versions(organization_id,template_id,id),
 FOREIGN KEY(organization_id,catalog_institution_id) REFERENCES platform.catalog_institutions(organization_id,id),
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 CHECK((claim_token IS NULL)=(begun_at IS NULL) AND (claim_token IS NULL)=(expires_at IS NULL)),
 CHECK(expires_at IS NULL OR expires_at=begun_at+INTERVAL '120 seconds'),
 CHECK((sealed_at IS NULL)=(scan_proof IS NULL) AND (sealed_at IS NULL)=(manifest IS NULL)
  AND (sealed_at IS NULL)=(inspector_image_id IS NULL) AND (sealed_at IS NULL)=(inspector_revision IS NULL)
  AND (sealed_at IS NULL)=(runtime_revision IS NULL) AND (sealed_at IS NULL)=(manifest_sha256 IS NULL)
  AND (sealed_at IS NULL)=(seal_input_sha256 IS NULL)),
 CHECK(inspector_image_id IS NULL OR inspector_image_id ~ '^sha256:[a-f0-9]{64}$'),
 CHECK(inspector_revision IS NULL OR inspector_revision='evo-university-template-v1'),
 CHECK(runtime_revision IS NULL OR runtime_revision ~ '^[a-f0-9]{40}$'),
 CHECK(manifest IS NULL OR octet_length(manifest::TEXT)<=131072),
 CHECK((state='verified')=(inspection_receipt_id IS NOT NULL) AND (state='verified')=(verified_revision IS NOT NULL)),
 CHECK(state NOT IN ('sealed','unknown','verified') OR sealed_at IS NOT NULL),
 CHECK((state IN ('failed','unknown','cancelled'))=(failure_code IS NOT NULL))
);
CREATE INDEX university_template_ingress_actor_idx ON platform_private.university_template_ingresses(organization_id,actor_membership_id);
CREATE TABLE platform_private.university_template_source_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ingress_id UUID NOT NULL REFERENCES platform_private.university_template_ingresses(id),
 request_id UUID NOT NULL UNIQUE, organization_id UUID NOT NULL,
 actor_auth_user_id UUID NOT NULL, actor_membership_id UUID NOT NULL, actor_access_version BIGINT NOT NULL,
 expected_revision BIGINT NOT NULL CHECK(expected_revision BETWEEN 2 AND 9007199254740991),
 intent TEXT NOT NULL CHECK(intent IN ('read','reconcile')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, completion_input_sha256 TEXT, completion JSONB,
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,ingress_id) REFERENCES platform_private.university_template_ingresses(organization_id,id),
 CHECK(expires_at=created_at+INTERVAL '60 seconds'),
 CHECK((completed_at IS NULL)=(completion IS NULL) AND (completed_at IS NULL)=(completion_input_sha256 IS NULL)),
 CHECK(completed_at IS NULL OR consumed_at IS NOT NULL)
);
CREATE INDEX university_template_source_grants_ingress_idx ON platform_private.university_template_source_grants(ingress_id);
CREATE INDEX university_template_source_grants_actor_idx ON platform_private.university_template_source_grants(organization_id,actor_membership_id);
CREATE TABLE platform_private.university_template_ingress_requests (
 request_id UUID PRIMARY KEY, ingress_id UUID NOT NULL REFERENCES platform_private.university_template_ingresses(id),
 command TEXT NOT NULL CHECK(command IN ('prepare','cancel','read','reconcile')),
 input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'), grant_id UUID REFERENCES platform_private.university_template_source_grants(id),
 reason TEXT NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND btrim(reason)<>'' AND reason !~ '[[:cntrl:]]'),
 outcome JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX university_template_ingress_requests_attempt_idx ON platform_private.university_template_ingress_requests(ingress_id);
CREATE TABLE platform_private.university_template_ingress_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ingress_id UUID NOT NULL REFERENCES platform_private.university_template_ingresses(id),
 event_kind TEXT NOT NULL, actor_auth_user_id UUID NOT NULL, actor_membership_id UUID NOT NULL,
 request_id UUID NOT NULL, outcome JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX university_template_ingress_events_attempt_idx ON platform_private.university_template_ingress_events(ingress_id,created_at);

CREATE FUNCTION platform_private.university_ingress_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'university_ingress_immutable' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='university_template_ingresses' THEN
  IF (to_jsonb(NEW)-ARRAY['state','claim_token','begun_at','expires_at','sealed_at','scan_proof','inspector_image_id','inspector_revision',
   'runtime_revision','manifest','manifest_sha256','seal_input_sha256','completion_input_sha256','inspection_receipt_id','verified_revision','failure_code'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claim_token','begun_at','expires_at','sealed_at','scan_proof','inspector_image_id','inspector_revision',
   'runtime_revision','manifest','manifest_sha256','seal_input_sha256','completion_input_sha256','inspection_receipt_id','verified_revision','failure_code'])
   OR (OLD.claim_token IS NOT NULL AND (NEW.claim_token,NEW.begun_at,NEW.expires_at) IS DISTINCT FROM (OLD.claim_token,OLD.begun_at,OLD.expires_at))
   OR (OLD.sealed_at IS NOT NULL AND (NEW.sealed_at,NEW.scan_proof,NEW.inspector_image_id,NEW.inspector_revision,NEW.runtime_revision,NEW.manifest,NEW.manifest_sha256,NEW.seal_input_sha256)
    IS DISTINCT FROM (OLD.sealed_at,OLD.scan_proof,OLD.inspector_image_id,OLD.inspector_revision,OLD.runtime_revision,OLD.manifest,OLD.manifest_sha256,OLD.seal_input_sha256))
   OR (OLD.completion_input_sha256 IS NOT NULL AND NEW.completion_input_sha256 IS DISTINCT FROM OLD.completion_input_sha256)
   OR OLD.state IN ('verified','failed','cancelled')
   OR NOT (NEW.state=OLD.state OR (OLD.state='prepared' AND NEW.state IN ('processing','failed','cancelled'))
    OR (OLD.state='processing' AND NEW.state IN ('sealed','failed','cancelled'))
    OR (OLD.state IN ('sealed','unknown') AND NEW.state IN ('verified','failed','unknown','cancelled'))) THEN
   RAISE EXCEPTION 'university_ingress_immutable' USING ERRCODE='55000'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['consumed_at','completed_at','completion_input_sha256','completion'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['consumed_at','completed_at','completion_input_sha256','completion'])
   OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
   OR OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_immutable' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER university_ingress_guard BEFORE UPDATE OR DELETE ON platform_private.university_template_ingresses
 FOR EACH ROW EXECUTE FUNCTION platform_private.university_ingress_guard();
CREATE TRIGGER university_source_grant_guard BEFORE UPDATE OR DELETE ON platform_private.university_template_source_grants
 FOR EACH ROW EXECUTE FUNCTION platform_private.university_ingress_guard();
DO $$DECLARE n TEXT; BEGIN
 FOREACH n IN ARRAY ARRAY['university_template_ingresses','university_template_source_grants','university_template_ingress_requests','university_template_ingress_events'] LOOP
  EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON platform_private.%I FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',n);
  IF n IN ('university_template_ingress_requests','university_template_ingress_events') THEN
   EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON platform_private.%I FOR EACH ROW EXECUTE FUNCTION platform_private.university_form_immutable()',n);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION platform_private.university_ingress_require_service()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
 RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF; END $$;
CREATE FUNCTION platform_private.university_ingress_actor_valid(p_org UUID,p_auth UUID,p_member UUID,p_access BIGINT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_org,p_member) i
  WHERE i.auth_user_id=p_auth AND i.access_version=p_access)
 AND platform_private.staff_can_access(p_org,p_member,'catalog.import.manage','organization',p_org)
$$;
CREATE FUNCTION platform_private.university_ingress_lock_template(p_template UUID,p_requests UUID[],p_members UUID[])
RETURNS platform_private.university_form_templates LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t platform_private.university_form_templates; request UUID;
BEGIN
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=p_template;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM platform.organizations WHERE id=t.organization_id FOR UPDATE;
 FOR request IN SELECT DISTINCT x FROM unnest(p_requests) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM platform_private.lock_bw3_request(request);
 END LOOP;
 PERFORM platform_private.staff_lock_memberships(t.organization_id,p_members);
 PERFORM 1 FROM platform.catalog_institutions WHERE organization_id=t.organization_id AND id=t.catalog_institution_id FOR SHARE;
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=p_template FOR UPDATE;
 RETURN t;
END $$;
CREATE FUNCTION platform_private.university_ingress_lock(p_id UUID,p_request UUID DEFAULT NULL,p_member UUID DEFAULT NULL)
RETURNS platform_private.university_template_ingresses LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses;
BEGIN
 SELECT * INTO a FROM platform_private.university_template_ingresses WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.university_ingress_lock_template(a.template_id,ARRAY[a.request_id,p_request],ARRAY[a.actor_membership_id,p_member]);
 SELECT * INTO a FROM platform_private.university_template_ingresses WHERE id=p_id FOR UPDATE;
 RETURN a;
END $$;
CREATE FUNCTION platform_private.university_ingress_live_failure(a platform_private.university_template_ingresses,p_revision BIGINT,p_original_actor BOOLEAN DEFAULT TRUE)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t platform_private.university_form_templates;
BEGIN
 IF p_original_actor AND NOT platform_private.university_ingress_actor_valid(a.organization_id,a.actor_auth_user_id,a.actor_membership_id,a.actor_access_version) THEN RETURN 'access_changed'; END IF;
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=a.template_id AND organization_id=a.organization_id;
 IF NOT FOUND THEN RETURN 'source_changed'; END IF;
 IF t.archived_at IS NOT NULL THEN RETURN 'archived'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.catalog_institutions c WHERE c.id=a.catalog_institution_id AND c.organization_id=a.organization_id
  AND c.source_revision=a.catalog_source_revision AND t.catalog_source_revision=c.source_revision) THEN RETURN 'source_changed'; END IF;
 IF t.revision IS DISTINCT FROM p_revision THEN RETURN 'stale_revision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform_private.university_form_template_versions v WHERE v.id=a.template_version_id AND v.template_id=a.template_id
  AND v.organization_id=a.organization_id AND v.sha256=a.sha256 AND v.byte_size=a.byte_size AND v.mime_type=a.mime_type
  AND v.bucket_id=a.bucket_id AND v.object_name=a.object_name) THEN RETURN 'source_changed'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION platform_private.university_ingress_receipt(a platform_private.university_template_ingresses,p_replayed BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('schema_version',1,'ingress_id',a.id,'template_id',a.template_id,'template_version_id',a.template_version_id,
  'request_id',a.request_id,'revision',COALESCE(a.verified_revision,a.expected_revision),'state',a.state,'sha256',a.sha256,'byte_size',a.byte_size,
  'inspection_receipt_id',a.inspection_receipt_id,'failure_code',a.failure_code,'replayed',p_replayed,
  'can_reconcile',a.sealed_at IS NOT NULL AND (a.state='unknown' OR (a.state='sealed' AND a.expires_at<=clock_timestamp()))
   AND platform_private.university_ingress_live_failure(a,a.expected_revision) IS NULL,
  'can_cancel',a.state IN ('prepared','processing','sealed','unknown') AND platform_private.university_ingress_live_failure(a,a.expected_revision,FALSE) IS NULL)
$$;
CREATE FUNCTION platform_private.university_ingress_source(a platform_private.university_template_ingresses,p_revision BIGINT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('organization_id',a.organization_id,'catalog_institution_id',a.catalog_institution_id,
  'catalog_source_revision',a.catalog_source_revision,'template_id',a.template_id,'template_version_id',a.template_version_id,
  'expected_revision',p_revision,'sha256',a.sha256,'byte_size',a.byte_size,'mime_type',a.mime_type,'bucket_id',a.bucket_id,'object_name',a.object_name)
$$;
CREATE FUNCTION platform_private.university_ingress_event(a platform_private.university_template_ingresses,p_kind TEXT,p_request UUID,
 p_actor_auth UUID DEFAULT NULL,p_actor_member UUID DEFAULT NULL)
RETURNS VOID LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO platform_private.university_template_ingress_events(ingress_id,event_kind,actor_auth_user_id,actor_membership_id,request_id,outcome)
 VALUES(a.id,p_kind,COALESCE(p_actor_auth,a.actor_auth_user_id),COALESCE(p_actor_member,a.actor_membership_id),p_request,
  platform_private.university_ingress_receipt(a))
$$;
CREATE FUNCTION platform_private.university_ingress_fail(a platform_private.university_template_ingresses,p_failure TEXT,p_unknown BOOLEAN DEFAULT FALSE)
RETURNS platform_private.university_template_ingresses LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF a.state NOT IN ('verified','failed','cancelled') THEN
  UPDATE platform_private.university_template_ingresses SET state=CASE WHEN p_unknown AND sealed_at IS NOT NULL THEN 'unknown' ELSE 'failed' END,
   failure_code=p_failure WHERE id=a.id RETURNING * INTO a;
  PERFORM platform_private.university_ingress_event(a,a.state,gen_random_uuid());
 END IF;
 RETURN a;
END $$;

CREATE FUNCTION platform.prepare_university_template_ingress(p_template_id UUID,p_template_version_id UUID,p_expected_revision BIGINT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t platform_private.university_form_templates; v platform_private.university_form_template_versions;
 a platform_private.university_template_ingresses; actor RECORD; r platform_private.university_template_ingress_requests; fingerprint TEXT; failure TEXT;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_template_version_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 2 AND 9007199254740990 THEN
  RAISE EXCEPTION 'university_ingress_invalid_request' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=p_template_id;
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=t.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 t:=platform_private.university_ingress_lock_template(p_template_id,ARRAY[p_request_id],ARRAY[actor.membership_id]);
 PERFORM platform_private.require_organization_operator(t.organization_id,'catalog.import.manage');
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=t.organization_id;
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('command','prepare','template',p_template_id,'version',p_template_version_id,
  'expected',p_expected_revision,'auth',actor.auth_user_id,'member',actor.membership_id));
 SELECT * INTO r FROM platform_private.university_template_ingress_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF r.input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO a FROM platform_private.university_template_ingresses WHERE id=r.ingress_id FOR UPDATE;
  failure:=platform_private.university_ingress_live_failure(a,COALESCE(a.verified_revision,a.expected_revision));
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a,TRUE));
 END IF;
 IF EXISTS(SELECT 1 FROM platform_private.university_form_command_receipts WHERE request_id=p_request_id)
  OR EXISTS(SELECT 1 FROM platform_private.university_template_ingresses WHERE template_version_id=p_template_version_id) THEN
  RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
 SELECT * INTO v FROM platform_private.university_form_template_versions WHERE id=p_template_version_id AND template_id=t.id AND organization_id=t.organization_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM platform_private.university_form_inspection_receipts WHERE template_version_id=v.id) THEN
  RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO platform_private.university_template_ingresses(request_id,organization_id,catalog_institution_id,catalog_source_revision,template_id,template_version_id,
  expected_revision,actor_auth_user_id,actor_membership_id,actor_access_version,sha256,byte_size,mime_type,bucket_id,object_name)
 VALUES(p_request_id,t.organization_id,t.catalog_institution_id,t.catalog_source_revision,t.id,v.id,p_expected_revision,actor.auth_user_id,actor.membership_id,
  (SELECT i.access_version FROM platform_private.staff_membership_identity(t.organization_id,actor.membership_id)i),v.sha256,v.byte_size,v.mime_type,v.bucket_id,v.object_name) RETURNING * INTO a;
 failure:=platform_private.university_ingress_live_failure(a,p_expected_revision);
 IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
 INSERT INTO platform_private.university_template_ingress_requests(request_id,ingress_id,command,input_sha256,reason,outcome)
 VALUES(p_request_id,a.id,'prepare',fingerprint,'Upload private university template',platform_private.university_ingress_receipt(a));
 PERFORM platform_private.university_ingress_event(a,'prepared',p_request_id);
 RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a));
END $$;

CREATE FUNCTION platform.begin_university_template_ingress(p_ingress_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; failure TEXT; started TIMESTAMPTZ;
BEGIN
 PERFORM platform_private.university_ingress_require_service(); a:=platform_private.university_ingress_lock(p_ingress_id);
 IF p_actor_auth_user_id IS DISTINCT FROM a.actor_auth_user_id OR p_actor_membership_id IS DISTINCT FROM a.actor_membership_id THEN
  RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 failure:=platform_private.university_ingress_live_failure(a,COALESCE(a.verified_revision,a.expected_revision));
 IF failure IS NOT NULL THEN
  IF a.state IN ('verified','failed','cancelled') THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
  a:=platform_private.university_ingress_fail(a,failure);
 ELSIF a.state='prepared' THEN
  started:=clock_timestamp();
  UPDATE platform_private.university_template_ingresses SET state='processing',claim_token=gen_random_uuid(),begun_at=started,
   expires_at=started+INTERVAL '120 seconds' WHERE id=a.id RETURNING * INTO a;
  -- clock_timestamp is sampled once for an exact, non-extendable lease.
  PERFORM platform_private.university_ingress_event(a,'processing',gen_random_uuid());
  RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a),'claim_token',a.claim_token,
   'source',platform_private.university_ingress_source(a,a.expected_revision),'expires_at',a.expires_at);
 ELSIF a.state IN ('processing','sealed') AND a.expires_at<=clock_timestamp() THEN
  a:=platform_private.university_ingress_fail(a,'expired',a.sealed_at IS NOT NULL);
 END IF;
 RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a,TRUE),'claim_token',NULL,'source',NULL,'expires_at',NULL);
END $$;

CREATE FUNCTION platform.cancel_university_template_ingress(p_template_id UUID,p_template_version_id UUID,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; actor RECORD; r platform_private.university_template_ingress_requests;
 fingerprint TEXT; failure TEXT; result JSONB;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 2 AND 9007199254740990
  OR p_reason IS NULL OR btrim(p_reason)='' OR char_length(p_reason)>500 OR p_reason ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'university_ingress_invalid_request' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM platform_private.university_template_ingresses WHERE template_id=p_template_id AND template_version_id=p_template_version_id;
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=a.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 a:=platform_private.university_ingress_lock(a.id,p_request_id,actor.membership_id);
 PERFORM platform_private.require_organization_operator(a.organization_id,'catalog.import.manage');
 failure:=platform_private.university_ingress_live_failure(a,p_expected_revision,FALSE);
 IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('command','cancel','template',p_template_id,'version',p_template_version_id,
  'expected',p_expected_revision,'reason',p_reason,'auth',actor.auth_user_id,'member',actor.membership_id));
 SELECT * INTO r FROM platform_private.university_template_ingress_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF r.input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  RETURN r.outcome||jsonb_build_object('replayed',TRUE);
 END IF;
 IF EXISTS(SELECT 1 FROM platform_private.university_form_command_receipts WHERE request_id=p_request_id) THEN
  RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
 IF a.state NOT IN ('prepared','processing','sealed','unknown') THEN RAISE EXCEPTION 'university_ingress_not_active' USING ERRCODE='55000'; END IF;
 UPDATE platform_private.university_template_ingresses SET state='cancelled',failure_code='cancelled' WHERE id=a.id RETURNING * INTO a;
 result:=platform_private.university_ingress_receipt(a);
 INSERT INTO platform_private.university_template_ingress_requests(request_id,ingress_id,command,input_sha256,reason,outcome)
 VALUES(p_request_id,a.id,'cancel',fingerprint,p_reason,result);
 PERFORM platform_private.university_ingress_event(a,'cancelled',p_request_id,actor.auth_user_id,actor.membership_id);
 RETURN result;
END $$;

CREATE FUNCTION platform.prepare_university_template_source_access(p_template_id UUID,p_template_version_id UUID,p_expected_revision BIGINT,p_intent TEXT,p_request_id UUID,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; g platform_private.university_template_source_grants;
 actor RECORD; r platform_private.university_template_ingress_requests; failure TEXT; fingerprint TEXT; started TIMESTAMPTZ;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 2 AND 9007199254740991 OR p_intent IS NULL OR p_intent NOT IN ('read','reconcile')
  OR p_reason IS NULL OR btrim(p_reason)='' OR char_length(p_reason)>500 OR p_reason ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'university_ingress_invalid_request' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM platform_private.university_template_ingresses WHERE template_id=p_template_id AND template_version_id=p_template_version_id;
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=a.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 a:=platform_private.university_ingress_lock(a.id,p_request_id,actor.membership_id);
 PERFORM platform_private.require_organization_operator(a.organization_id,'catalog.import.manage');
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('command',p_intent,'template',p_template_id,'version',p_template_version_id,
  'expected',p_expected_revision,'reason',p_reason,'auth',actor.auth_user_id,'member',actor.membership_id));
 SELECT * INTO r FROM platform_private.university_template_ingress_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF r.input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO g FROM platform_private.university_template_source_grants WHERE id=r.grant_id FOR UPDATE;
  failure:=platform_private.university_ingress_live_failure(a,CASE WHEN g.intent='reconcile' AND g.completed_at IS NOT NULL
   AND g.completion->>'permitted'='true' AND a.state='verified' THEN a.verified_revision ELSE p_expected_revision END,p_intent='reconcile');
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
  IF NOT platform_private.university_ingress_actor_valid(a.organization_id,g.actor_auth_user_id,g.actor_membership_id,g.actor_access_version)
   OR (g.expires_at<=clock_timestamp() AND NOT (g.intent='reconcile' AND g.completed_at IS NOT NULL AND g.completion->>'permitted'='true')) THEN
   RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('grant_id',g.id);
 END IF;
 failure:=platform_private.university_ingress_live_failure(a,p_expected_revision,p_intent='reconcile');
 IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM platform_private.university_form_command_receipts WHERE request_id=p_request_id) THEN
  RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
 IF (p_intent='read' AND a.state<>'verified') OR (p_intent='reconcile' AND
  (p_expected_revision<>a.expected_revision OR a.sealed_at IS NULL OR NOT (a.state='unknown' OR (a.state='sealed' AND a.expires_at<=clock_timestamp())))) THEN
  RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
 started:=clock_timestamp();
 INSERT INTO platform_private.university_template_source_grants(ingress_id,request_id,organization_id,actor_auth_user_id,actor_membership_id,actor_access_version,
  expected_revision,intent,created_at,expires_at)
 VALUES(a.id,p_request_id,a.organization_id,actor.auth_user_id,actor.membership_id,
  (SELECT i.access_version FROM platform_private.staff_membership_identity(a.organization_id,actor.membership_id)i),
  p_expected_revision,p_intent,started,started+INTERVAL '60 seconds') RETURNING * INTO g;
 INSERT INTO platform_private.university_template_ingress_requests(request_id,ingress_id,command,input_sha256,grant_id,reason,outcome)
 VALUES(p_request_id,a.id,p_intent,fingerprint,g.id,p_reason,jsonb_build_object('grant_id',g.id));
 PERFORM platform_private.university_ingress_event(a,p_intent||'_grant',p_request_id,actor.auth_user_id,actor.membership_id);
 RETURN jsonb_build_object('grant_id',g.id);
END $$;

CREATE FUNCTION platform.consume_university_template_source_access(p_grant_id UUID,p_actor_auth_user_id UUID,p_actor_membership_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; g platform_private.university_template_source_grants;
BEGIN
 PERFORM platform_private.university_ingress_require_service();
 SELECT * INTO g FROM platform_private.university_template_source_grants WHERE id=p_grant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
 a:=platform_private.university_ingress_lock(g.ingress_id,g.request_id,g.actor_membership_id);
 SELECT * INTO g FROM platform_private.university_template_source_grants WHERE id=p_grant_id FOR UPDATE;
 IF g.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR g.actor_membership_id IS DISTINCT FROM p_actor_membership_id
  OR g.consumed_at IS NOT NULL OR g.expires_at<=clock_timestamp()
  OR NOT platform_private.university_ingress_actor_valid(a.organization_id,g.actor_auth_user_id,g.actor_membership_id,g.actor_access_version)
  OR platform_private.university_ingress_live_failure(a,g.expected_revision,g.intent='reconcile') IS NOT NULL
  OR (g.intent='read' AND a.state<>'verified') OR (g.intent='reconcile' AND (a.sealed_at IS NULL
   OR NOT (a.state='unknown' OR (a.state='sealed' AND a.expires_at<=clock_timestamp())))) THEN
  RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
 UPDATE platform_private.university_template_source_grants SET consumed_at=clock_timestamp() WHERE id=g.id RETURNING * INTO g;
 PERFORM platform_private.university_ingress_event(a,g.intent||'_consumed',g.request_id,g.actor_auth_user_id,g.actor_membership_id);
 RETURN jsonb_build_object('grant_id',g.id,'receipt',platform_private.university_ingress_receipt(a),
  'source',platform_private.university_ingress_source(a,g.expected_revision),'expires_at',g.expires_at);
END $$;

CREATE FUNCTION platform.complete_university_template_source_access(p_grant_id UUID,p_observed_sha256 TEXT,p_observed_bytes BIGINT,p_observed_mime_type TEXT,p_storage_missing BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; g platform_private.university_template_source_grants;
 failure TEXT; fingerprint TEXT; result JSONB; permitted BOOLEAN:=FALSE;
BEGIN
 PERFORM platform_private.university_ingress_require_service();
 IF p_storage_missing IS NULL OR (p_storage_missing AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL OR p_observed_mime_type IS NOT NULL))
  OR (NOT p_storage_missing AND (p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$' OR p_observed_bytes IS NULL
   OR p_observed_bytes NOT BETWEEN 1 AND 20971520 OR p_observed_mime_type IS NULL)) THEN
  RAISE EXCEPTION 'university_ingress_invalid_request' USING ERRCODE='22023'; END IF;
 SELECT * INTO g FROM platform_private.university_template_source_grants WHERE id=p_grant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
 a:=platform_private.university_ingress_lock(g.ingress_id,g.request_id,g.actor_membership_id);
 SELECT * INTO g FROM platform_private.university_template_source_grants WHERE id=p_grant_id FOR UPDATE;
 IF g.consumed_at IS NULL THEN RAISE EXCEPTION 'university_ingress_grant_unavailable' USING ERRCODE='42501'; END IF;
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('sha256',p_observed_sha256,'bytes',p_observed_bytes,'mime',p_observed_mime_type,'missing',p_storage_missing));
 failure:=platform_private.university_ingress_live_failure(a,
  CASE WHEN g.intent='reconcile' AND g.completed_at IS NOT NULL AND a.state='verified' THEN a.verified_revision ELSE g.expected_revision END,g.intent='reconcile');
 IF NOT platform_private.university_ingress_actor_valid(a.organization_id,g.actor_auth_user_id,g.actor_membership_id,g.actor_access_version) THEN failure:='access_changed';
 ELSIF g.expires_at<=clock_timestamp() THEN failure:='expired'; END IF;
 IF g.completed_at IS NOT NULL THEN
  IF g.completion_input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
  -- Replaying completion never hands out another byte permission. It can report
  -- a completed reconciliation, but only under current actor/source checks.
  RETURN jsonb_build_object('permitted',FALSE,'receipt',platform_private.university_ingress_receipt(a,TRUE));
 END IF;
 IF failure IS NULL THEN
  IF a.state='cancelled' OR (g.intent='read' AND a.state<>'verified') OR (g.intent='reconcile' AND (a.sealed_at IS NULL
   OR NOT (a.state='unknown' OR (a.state='sealed' AND a.expires_at<=clock_timestamp())))) THEN failure:='source_changed';
  ELSIF p_storage_missing THEN failure:='storage_missing';
  ELSIF p_observed_sha256 IS DISTINCT FROM a.sha256 OR p_observed_bytes IS DISTINCT FROM a.byte_size OR p_observed_mime_type IS DISTINCT FROM a.mime_type
   OR NOT platform_private.university_ingress_storage_matches(a) THEN failure:='integrity_failed';
  END IF;
 END IF;
 IF g.intent='reconcile' AND a.state IN ('sealed','unknown') THEN
  IF failure IS NULL THEN a:=platform_private.university_ingress_verify(a);
  ELSE a:=platform_private.university_ingress_fail(a,failure); END IF;
 END IF;
 permitted:=failure IS NULL;
 result:=jsonb_build_object('permitted',permitted,'receipt',platform_private.university_ingress_receipt(a));
 UPDATE platform_private.university_template_source_grants SET completed_at=clock_timestamp(),completion_input_sha256=fingerprint,completion=result WHERE id=g.id;
 PERFORM platform_private.university_ingress_event(a,g.intent||CASE WHEN permitted THEN '_verified' ELSE '_denied' END,g.request_id,g.actor_auth_user_id,g.actor_membership_id);
 RETURN result;
END $$;

CREATE FUNCTION platform.staff_university_form_manager_templates(p_catalog_institution_id UUID,p_after_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; items JSONB; next_id UUID;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 SELECT organization_id INTO org FROM platform.catalog_institutions WHERE id=p_catalog_institution_id;
 IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'catalog.import.manage','organization',org) THEN
  RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'revision',x.revision,'archived',x.archived_at IS NOT NULL,
  'catalog_source_revision',x.catalog_source_revision,'source_current',x.archived_at IS NULL AND EXISTS(SELECT 1 FROM platform.catalog_institutions c
   WHERE c.id=x.catalog_institution_id AND c.organization_id=org AND c.source_revision=x.catalog_source_revision),
  'latest_version',(SELECT jsonb_build_object('id',v.id,'number',v.version_number,'revision',v.created_revision,'sha256',v.sha256,
   'byte_size',v.byte_size,'mime_type',v.mime_type,'created_at',v.created_at,'inspection',CASE WHEN platform_private.university_form_inspection_matches(v) THEN 'verified' ELSE 'pending' END)
   FROM platform_private.university_form_template_versions v WHERE v.template_id=x.id ORDER BY v.created_revision DESC LIMIT 1),
  'publication',platform_private.university_form_current_publication(x)) ORDER BY x.id),'[]'::JSONB),
  CASE WHEN count(*)=20 THEN (array_agg(x.id ORDER BY x.id DESC))[1] END INTO items,next_id
 FROM (SELECT t.* FROM platform_private.university_form_templates t WHERE t.organization_id=org AND t.catalog_institution_id=p_catalog_institution_id
  AND (p_after_id IS NULL OR t.id>p_after_id) ORDER BY t.id LIMIT 20)x;
 RETURN jsonb_build_object('schema_version',1,'catalog_institution_id',p_catalog_institution_id,'items',items,'next_after_id',next_id);
END $$;
CREATE FUNCTION platform.staff_university_template_inspection(p_template_id UUID,p_template_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t platform_private.university_form_templates; v platform_private.university_form_template_versions;
 a platform_private.university_template_ingresses; r platform_private.university_form_inspection_receipts; verified BOOLEAN;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=p_template_id;
 IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(t.organization_id,'catalog.import.manage','organization',t.organization_id) THEN
  RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM platform_private.university_form_template_versions WHERE id=p_template_version_id AND template_id=t.id AND organization_id=t.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM platform_private.university_template_ingresses WHERE template_version_id=v.id;
 SELECT * INTO r FROM platform_private.university_form_inspection_receipts WHERE template_version_id=v.id;
 verified:=platform_private.university_form_inspection_matches(v);
 RETURN jsonb_build_object('schema_version',1,'template_id',t.id,'template_version_id',v.id,'template_sha256',v.sha256,'mime_type',v.mime_type,
  'template_revision',t.revision,'source_current',t.archived_at IS NULL AND EXISTS(SELECT 1 FROM platform.catalog_institutions c
   WHERE c.id=t.catalog_institution_id AND c.organization_id=t.organization_id AND c.source_revision=t.catalog_source_revision),
  'inspection',CASE WHEN verified THEN 'verified' ELSE 'pending' END,'manifest',CASE WHEN verified THEN r.manifest END,
  'receipt_id',CASE WHEN verified THEN r.id END,'inspected_at',CASE WHEN verified THEN r.created_at END,
  'ingress',CASE WHEN a.id IS NOT NULL THEN platform_private.university_ingress_receipt(a) END);
END $$;

-- Passive PDF inspection proves page geometry, not human-defined editable areas.
CREATE OR REPLACE FUNCTION platform_private.university_form_manifest_valid(p_manifest JSONB,p_mime TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE slot JSONB; page JSONB; slot_number INTEGER:=0; pdf BOOLEAN:=p_mime='application/pdf';
BEGIN
 IF p_mime IS NULL OR p_mime NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  OR NOT COALESCE(platform_private.university_form_exact_keys(p_manifest,ARRAY['format','slots','pageSizes']),FALSE)
  OR p_manifest->>'format' IS DISTINCT FROM (CASE WHEN pdf THEN 'pdf' ELSE 'docx' END)
  OR jsonb_typeof(p_manifest->'slots') IS DISTINCT FROM 'array' OR jsonb_typeof(p_manifest->'pageSizes') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
 IF jsonb_array_length(p_manifest->'slots')>3000 OR jsonb_array_length(p_manifest->'pageSizes')>100
  OR (pdf AND (p_manifest->'slots'<>'[]'::JSONB OR jsonb_array_length(p_manifest->'pageSizes')=0))
  OR (NOT pdf AND (p_manifest->'pageSizes'<>'[]'::JSONB OR jsonb_array_length(p_manifest->'slots')=0)) THEN RETURN FALSE; END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(p_manifest->'slots') WITH ORDINALITY ORDER BY ordinality LOOP
  slot_number:=slot_number+1;
  IF NOT COALESCE(platform_private.university_form_exact_keys(slot,ARRAY['id','editable']),FALSE)
   OR jsonb_typeof(slot->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(slot->'editable') IS DISTINCT FROM 'boolean'
   OR slot->>'id' IS DISTINCT FROM 'p-'||slot_number::TEXT THEN RETURN FALSE; END IF;
 END LOOP;
 FOR page IN SELECT value FROM jsonb_array_elements(p_manifest->'pageSizes') LOOP
  IF NOT COALESCE(platform_private.university_form_exact_keys(page,ARRAY['width','height']),FALSE)
   OR jsonb_typeof(page->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(page->'height') IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  IF (page->>'width')::NUMERIC NOT BETWEEN 72 AND 3000 OR (page->>'height')::NUMERIC NOT BETWEEN 72 AND 3000 THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;
CREATE OR REPLACE FUNCTION platform_private.university_form_mapping_inspected(p_mapping platform_private.university_form_mapping_versions)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v platform_private.university_form_template_versions; manifest JSONB; m JSONB; slot JSONB; pos JSONB; page JSONB;
BEGIN
 SELECT * INTO v FROM platform_private.university_form_template_versions WHERE id=p_mapping.template_version_id;
 IF NOT FOUND OR v.sha256<>p_mapping.template_sha256 OR NOT platform_private.university_form_inspection_matches(v) THEN RETURN FALSE; END IF;
 -- Also defend against malformed owner-supplied fixture rows; normal writes use165.
 BEGIN PERFORM platform_private.university_form_mapping_content(p_mapping.id,v.id,v.sha256,p_mapping.mappings,v.mime_type);
 EXCEPTION WHEN SQLSTATE '22023' THEN RETURN FALSE; END;
 SELECT r.manifest INTO manifest FROM platform_private.university_form_inspection_receipts r WHERE r.template_version_id=v.id;
 FOR m IN SELECT value FROM jsonb_array_elements(p_mapping.mappings) LOOP
  IF v.mime_type='application/pdf' THEN
   pos:=m->'position'; page:=manifest->'pageSizes'->((pos->>'page')::INTEGER-1);
   IF page IS NULL OR (pos->>'x')::NUMERIC+(pos->>'width')::NUMERIC>(page->>'width')::NUMERIC
    OR (pos->>'y')::NUMERIC+(pos->>'height')::NUMERIC>(page->>'height')::NUMERIC THEN RETURN FALSE; END IF;
  ELSE
   SELECT value INTO slot FROM jsonb_array_elements(manifest->'slots') WHERE value->>'id'=m->>'slotId';
   IF NOT FOUND OR (NOT (slot->>'editable')::BOOLEAN AND NOT (m->>'manual')::BOOLEAN) THEN RETURN FALSE; END IF;
  END IF;
 END LOOP;
 IF v.mime_type='application/pdf' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_mapping.mappings) a
 CROSS JOIN jsonb_array_elements(p_mapping.mappings) b WHERE a->>'slotId'<b->>'slotId'
 AND (a->'position'->>'page')::NUMERIC=(b->'position'->>'page')::NUMERIC
 AND (a->'position'->>'x')::NUMERIC<(b->'position'->>'x')::NUMERIC+(b->'position'->>'width')::NUMERIC
 AND (b->'position'->>'x')::NUMERIC<(a->'position'->>'x')::NUMERIC+(a->'position'->>'width')::NUMERIC
 AND (a->'position'->>'y')::NUMERIC<(b->'position'->>'y')::NUMERIC+(b->'position'->>'height')::NUMERIC
 AND (b->'position'->>'y')::NUMERIC<(a->'position'->>'y')::NUMERIC+(a->'position'->>'height')::NUMERIC) THEN RETURN FALSE; END IF;
 RETURN TRUE;
END $$;

CREATE FUNCTION platform.seal_university_template_ingress(p_ingress_id UUID,p_claim_token UUID,p_scan_proof JSONB,p_inspector_image_id TEXT,
 p_inspector_revision TEXT,p_runtime_revision TEXT,p_manifest JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; failure TEXT; scanned TIMESTAMPTZ; fingerprint TEXT;
BEGIN
 PERFORM platform_private.university_ingress_require_service(); a:=platform_private.university_ingress_lock(p_ingress_id);
 IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'university_ingress_claim_invalid' USING ERRCODE='42501'; END IF;
 failure:=platform_private.university_ingress_live_failure(a,COALESCE(a.verified_revision,a.expected_revision));
 IF failure IS NOT NULL THEN a:=platform_private.university_ingress_fail(a,failure);
 ELSIF a.state IN ('processing','sealed') AND a.expires_at<=clock_timestamp() THEN a:=platform_private.university_ingress_fail(a,'expired',a.sealed_at IS NOT NULL);
 END IF;
 IF a.state NOT IN ('processing','sealed') THEN RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a),'source',NULL); END IF;
 IF octet_length(p_scan_proof::TEXT)>2048 OR NOT COALESCE(platform_private.university_form_exact_keys(p_scan_proof,ARRAY['engine','engineVersion','signatureVersion','protocol','scannedAt','sha256Hex']),FALSE)
  OR p_scan_proof->>'engine' IS DISTINCT FROM 'ClamAV' OR p_scan_proof->>'protocol' IS DISTINCT FROM 'clamd-zinstream-v1'
  OR jsonb_typeof(p_scan_proof->'engineVersion') IS DISTINCT FROM 'string' OR p_scan_proof->>'engineVersion' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  OR jsonb_typeof(p_scan_proof->'signatureVersion') IS DISTINCT FROM 'string' OR p_scan_proof->>'signatureVersion' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  OR p_scan_proof->>'sha256Hex' IS DISTINCT FROM a.sha256 OR jsonb_typeof(p_scan_proof->'scannedAt') IS DISTINCT FROM 'string'
  OR char_length(p_scan_proof->>'scannedAt')>40
  OR p_inspector_image_id IS NULL OR p_inspector_image_id !~ '^sha256:[a-f0-9]{64}$'
  OR p_inspector_revision IS DISTINCT FROM 'evo-university-template-v1' OR p_runtime_revision IS NULL OR p_runtime_revision !~ '^[a-f0-9]{40}$'
  OR p_manifest IS NULL OR octet_length(p_manifest::TEXT)>131072 OR NOT platform_private.university_form_manifest_valid(p_manifest,a.mime_type) THEN
  RAISE EXCEPTION 'university_ingress_invalid_proof' USING ERRCODE='22023'; END IF;
 BEGIN scanned:=(p_scan_proof->>'scannedAt')::TIMESTAMPTZ;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'university_ingress_invalid_proof' USING ERRCODE='22023'; END;
 IF NOT isfinite(scanned) OR scanned<a.begun_at-INTERVAL '5 seconds' OR scanned<clock_timestamp()-INTERVAL '120 seconds'
  OR scanned>clock_timestamp()+INTERVAL '5 seconds' THEN RAISE EXCEPTION 'university_ingress_invalid_proof' USING ERRCODE='22023'; END IF;
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('scan',p_scan_proof,'image',p_inspector_image_id,'policy',p_inspector_revision,'runtime',p_runtime_revision,'manifest',p_manifest));
 IF a.sealed_at IS NOT NULL THEN
  IF a.seal_input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a,TRUE),'source',NULL);
 END IF;
 UPDATE platform_private.university_template_ingresses SET state='sealed',sealed_at=clock_timestamp(),scan_proof=p_scan_proof,
  inspector_image_id=p_inspector_image_id,inspector_revision=p_inspector_revision,runtime_revision=p_runtime_revision,
  manifest=p_manifest,manifest_sha256=platform_private.bw1_input_sha256(p_manifest),seal_input_sha256=fingerprint WHERE id=a.id RETURNING * INTO a;
 PERFORM platform_private.university_ingress_event(a,'sealed',gen_random_uuid());
 RETURN jsonb_build_object('receipt',platform_private.university_ingress_receipt(a),'source',platform_private.university_ingress_source(a,a.expected_revision));
END $$;

CREATE FUNCTION platform_private.university_ingress_storage_matches(a platform_private.university_template_ingresses)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name
  AND jsonb_typeof(o.metadata->'size')='number' AND (o.metadata->>'size')::NUMERIC=a.byte_size
  AND o.metadata->>'mimetype'=a.mime_type)
$$;
CREATE FUNCTION platform_private.university_ingress_verify(a platform_private.university_template_ingresses)
RETURNS platform_private.university_template_ingresses LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt UUID;
BEGIN
 -- Caller holds every authority/source lock and has checked actual readback.
 IF a.sealed_at IS NULL OR a.manifest_sha256 IS DISTINCT FROM platform_private.bw1_input_sha256(a.manifest)
  OR NOT platform_private.university_form_manifest_valid(a.manifest,a.mime_type) THEN
  RAISE EXCEPTION 'university_ingress_invalid_proof' USING ERRCODE='22023'; END IF;
 INSERT INTO platform_private.university_form_inspection_receipts(organization_id,template_id,template_version_id,source_sha256,source_byte_size,
  source_mime_type,source_object_name,scan_signature_revision,inspector_revision,inspector_image_sha256,manifest_sha256,manifest)
 VALUES(a.organization_id,a.template_id,a.template_version_id,a.sha256,a.byte_size,a.mime_type,a.object_name,a.scan_proof->>'signatureVersion',
  a.inspector_revision,a.inspector_image_id,a.manifest_sha256,a.manifest) RETURNING id INTO receipt;
 UPDATE platform_private.university_form_templates SET revision=revision+1 WHERE id=a.template_id AND revision=a.expected_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_ingress_stale_revision' USING ERRCODE='40001'; END IF;
 UPDATE platform_private.university_template_ingresses SET state='verified',failure_code=NULL,inspection_receipt_id=receipt,
  verified_revision=expected_revision+1 WHERE id=a.id RETURNING * INTO a;
 PERFORM platform_private.university_ingress_event(a,'verified',gen_random_uuid());
 RETURN a;
END $$;
CREATE FUNCTION platform.complete_university_template_ingress(p_ingress_id UUID,p_claim_token UUID,p_outcome TEXT,p_failure_code TEXT,
 p_observed_sha256 TEXT,p_observed_bytes BIGINT,p_observed_mime_type TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a platform_private.university_template_ingresses; failure TEXT; fingerprint TEXT;
BEGIN
 PERFORM platform_private.university_ingress_require_service();
 IF p_outcome IS NULL OR p_outcome NOT IN ('verified','failed','unknown')
  OR (p_outcome='verified' AND (p_failure_code IS NOT NULL OR p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[a-f0-9]{64}$'
   OR p_observed_bytes IS NULL OR p_observed_bytes NOT BETWEEN 1 AND 20971520 OR p_observed_mime_type IS NULL))
  OR (p_outcome<>'verified' AND (p_observed_sha256 IS NOT NULL OR p_observed_bytes IS NOT NULL OR p_observed_mime_type IS NOT NULL
   OR p_failure_code IS NULL OR p_failure_code NOT IN ('source_mismatch','malware_detected','scanner_unavailable','template_not_eligible',
    'template_runtime_unavailable','storage_unavailable','storage_missing','access_changed','source_changed','archived','stale_revision','expired','cancelled','integrity_failed')))
  OR (p_outcome='unknown' AND p_failure_code NOT IN ('storage_unavailable','expired')) THEN RAISE EXCEPTION 'university_ingress_invalid_request' USING ERRCODE='22023'; END IF;
 a:=platform_private.university_ingress_lock(p_ingress_id);
 IF p_claim_token IS NULL OR a.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'university_ingress_claim_invalid' USING ERRCODE='42501'; END IF;
 failure:=platform_private.university_ingress_live_failure(a,COALESCE(a.verified_revision,a.expected_revision));
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('outcome',p_outcome,'failure',p_failure_code,'sha256',p_observed_sha256,'bytes',p_observed_bytes,'mime',p_observed_mime_type));
 IF a.completion_input_sha256 IS NOT NULL THEN
  IF a.completion_input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_ingress_request_conflict' USING ERRCODE='23505'; END IF;
  IF failure IS NOT NULL THEN RAISE EXCEPTION 'university_ingress_%',failure USING ERRCODE='55000'; END IF;
  RETURN platform_private.university_ingress_receipt(a,TRUE);
 END IF;
 IF a.state IN ('verified','failed','cancelled','unknown') THEN RAISE EXCEPTION 'university_ingress_not_active' USING ERRCODE='55000'; END IF;
 IF failure IS NOT NULL THEN a:=platform_private.university_ingress_fail(a,failure);
 ELSIF a.expires_at<=clock_timestamp() THEN a:=platform_private.university_ingress_fail(a,'expired',a.sealed_at IS NOT NULL);
 ELSE
  UPDATE platform_private.university_template_ingresses SET completion_input_sha256=fingerprint WHERE id=a.id RETURNING * INTO a;
  IF p_outcome='verified' THEN
   IF a.state<>'sealed' OR p_observed_sha256 IS DISTINCT FROM a.sha256 OR p_observed_bytes IS DISTINCT FROM a.byte_size
    OR p_observed_mime_type IS DISTINCT FROM a.mime_type OR NOT platform_private.university_ingress_storage_matches(a) THEN
    a:=platform_private.university_ingress_fail(a,'integrity_failed');
   ELSE a:=platform_private.university_ingress_verify(a); END IF;
  ELSE
   IF p_outcome='unknown' AND a.sealed_at IS NULL THEN RAISE EXCEPTION 'university_ingress_not_sealed' USING ERRCODE='55000'; END IF;
   a:=platform_private.university_ingress_fail(a,p_failure_code,p_outcome='unknown');
  END IF;
 END IF;
 RETURN platform_private.university_ingress_receipt(a);
END $$;

-- Enumerated scoped RPC grants; private helpers and raw proof tables stay closed.
DO $$DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::REGPROCEDURE signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='platform_private' AND (p.proname LIKE 'university_ingress_%'
  OR p.proname IN ('university_form_manifest_valid','university_form_mapping_inspected')))
 OR (n.nspname='platform' AND p.proname IN ('prepare_university_template_ingress','begin_university_template_ingress',
  'seal_university_template_ingress','complete_university_template_ingress','cancel_university_template_ingress',
  'prepare_university_template_source_access','consume_university_template_source_access','complete_university_template_source_access',
  'staff_university_form_manager_templates','staff_university_template_inspection')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',f.signature);
  IF f.nspname='platform' THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f.signature,CASE WHEN f.proname IN ('begin_university_template_ingress',
    'seal_university_template_ingress','complete_university_template_ingress','consume_university_template_source_access',
    'complete_university_template_source_access') THEN 'service_role' ELSE 'authenticated' END);
  END IF;
 END LOOP;
END $$;
COMMENT ON TABLE platform_private.university_form_inspection_receipts IS
 'Immutable source inspection proof.166 inserts only after a sealed server ClamAV/native proof, exact observed private readback, Storage metadata and fresh actor/source fencing. SQL does not scan bytes.';
COMMENT ON COLUMN platform_private.university_form_inspection_receipts.inspector_image_sha256 IS
 'Verified Docker engine-native image ID from the release-controller sealed runtime environment; not OCI imageConfigDigest or caller-supplied identity.';
COMMIT;
