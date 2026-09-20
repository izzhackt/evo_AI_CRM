-- B3a: optional stable intake IDs and honestly reviewed ID-only revisions.
-- No publication/content backfill, registry, identity seed or permission change.
BEGIN;

-- Preserve the current photo/level/date/URL validation, including 150 and 151.
DO $migration$
DECLARE
 definition TEXT;
 old_fragment TEXT;
 new_fragment TEXT;
BEGIN
 SELECT pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure) INTO definition;
 old_fragment := $old$ids TEXT[] := '{}'::TEXT[];$old$;
 new_fragment := $new$ids TEXT[] := '{}'::TEXT[]; intake_ids TEXT[] := '{}'::TEXT[];$new$;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 1 THEN
  RAISE EXCEPTION 'University validator declaration changed; review migration 211';
 END IF;
 definition := replace(definition,old_fragment,new_fragment);
 old_fragment := $old$OR intake - ARRAY['label','startDate','startMonth','applicationDeadline','deadlineTime','timezone','status','note','sourceUrl','verifiedOn']$old$;
 new_fragment := $new$OR intake - ARRAY['id','label','startDate','startMonth','applicationDeadline','deadlineTime','timezone','status','note','sourceUrl','verifiedOn']$new$;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 1 THEN
  RAISE EXCEPTION 'University intake keys changed; review migration 211';
 END IF;
 definition := replace(definition,old_fragment,new_fragment);
 old_fragment := $old$FOR intake IN SELECT * FROM jsonb_array_elements(program->'intakes') LOOP$old$;
 new_fragment := $new$FOR intake IN SELECT * FROM jsonb_array_elements(program->'intakes') LOOP
   IF intake ? 'id' THEN
    IF jsonb_typeof(intake->'id') IS DISTINCT FROM 'string'
     OR length(intake->>'id') <> 36
     OR (intake->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR intake->>'id' = ANY(intake_ids) THEN RETURN FALSE; END IF;
    intake_ids := array_append(intake_ids,intake->>'id');
   END IF;$new$;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 1 THEN
  RAISE EXCEPTION 'University intake loop changed; review migration 211';
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

ALTER TABLE platform_private.university_catalog_publications
 ADD COLUMN review_kind TEXT NOT NULL DEFAULT 'content'
  CHECK (review_kind IN ('content','intake_ids')),
 ADD COLUMN identity_base_publication_id UUID
  REFERENCES platform_private.university_catalog_publications(id),
 ADD COLUMN identity_base_content_hash TEXT,
 ADD CONSTRAINT university_publication_identity_proof_check CHECK (
  (review_kind='content' AND identity_base_publication_id IS NULL AND identity_base_content_hash IS NULL)
  OR (review_kind='intake_ids' AND institution_id IS NOT NULL AND base_version > 0
   AND identity_base_publication_id IS NOT NULL AND identity_base_content_hash IS NOT NULL
   AND identity_base_content_hash ~ '^[0-9a-f]{64}$')
 );
-- The existing to_jsonb(NEW)/to_jsonb(OLD) append-only guard already makes
-- all three new fields immutable, including on the draft -> reviewed transition.

CREATE FUNCTION platform_private.university_intake_ids_only(p_base JSONB,p_candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
 normalized JSONB := p_candidate;
 program_index INT;
 intake_index INT;
 base_program JSONB;
 base_intake JSONB;
 candidate_intake JSONB;
 added_count INT := 0;
BEGIN
 IF jsonb_typeof(p_base->'programs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_candidate->'programs') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_base->'programs') <> jsonb_array_length(p_candidate->'programs') THEN RETURN FALSE; END IF;
 FOR program_index IN 0..jsonb_array_length(p_base->'programs')-1 LOOP
  base_program := p_base->'programs'->program_index;
  IF jsonb_typeof(base_program->'intakes') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_candidate->'programs'->program_index->'intakes') IS DISTINCT FROM 'array'
   OR jsonb_array_length(base_program->'intakes') <> jsonb_array_length(p_candidate->'programs'->program_index->'intakes') THEN RETURN FALSE; END IF;
  FOR intake_index IN 0..jsonb_array_length(base_program->'intakes')-1 LOOP
   base_intake := base_program->'intakes'->intake_index;
   candidate_intake := p_candidate->'programs'->program_index->'intakes'->intake_index;
   -- Positions are used only to prove exact array equality, never to infer an ID.
   -- Existing IDs are not stripped, so replacing/removing one fails equality.
   IF NOT (base_intake ? 'id') AND candidate_intake ? 'id' THEN
    normalized := normalized #- ARRAY['programs',program_index::TEXT,'intakes',intake_index::TEXT,'id'];
    added_count := added_count+1;
   END IF;
  END LOOP;
 END LOOP;
 RETURN added_count > 0 AND normalized IS NOT DISTINCT FROM p_base;
END $$;

CREATE FUNCTION platform_private.lock_university_intake_identities(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 -- A fresh READ COMMITTED statement snapshot after waiting must see the other
 -- writer's publication. A repeatable snapshot plus advisory lock is insufficient.
 -- https://www.postgresql.org/docs/current/transaction-iso.html
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
  RAISE EXCEPTION 'Catalogue publication requires read committed isolation' USING ERRCODE='25001';
 END IF;
 -- Both commands use request -> tenant identity -> institution -> draft/source.
 -- This serializes cross-institution checks, not just edits to one university.
 -- https://www.postgresql.org/docs/current/explicit-locking.html
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:university-intake-identity:'||p_organization_id::TEXT,0));
END $$;

CREATE FUNCTION platform_private.assert_university_intake_identities(p_organization_id UUID,p_institution_id UUID,p_content JSONB)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE total_count INT; identified_count INT;
BEGIN
 SELECT count(*),count(*) FILTER (WHERE intake.value ? 'id') INTO total_count,identified_count
 FROM jsonb_array_elements(p_content->'programs') program(value)
 CROSS JOIN LATERAL jsonb_array_elements(program.value->'intakes') intake(value);
 IF identified_count > 0 AND identified_count <> total_count THEN
  RAISE EXCEPTION 'Every intake in an identified revision requires an ID' USING ERRCODE='22023';
 END IF;
 -- Legacy writers may remain legacy only before this institution has ever had
 -- identified intakes. Deleting all intakes cannot reopen the ID-less writer path.
 IF total_count > 0 AND identified_count=0 AND EXISTS (
  SELECT 1 FROM platform_private.university_catalog_publications publication
  CROSS JOIN LATERAL jsonb_array_elements(publication.content->'programs') program(value)
  CROSS JOIN LATERAL jsonb_array_elements(program.value->'intakes') intake(value)
  WHERE publication.organization_id=p_organization_id AND publication.institution_id=p_institution_id
   AND publication.status='published' AND intake.value ? 'id'
 ) THEN
  RAISE EXCEPTION 'An identified institution cannot publish intakes without IDs' USING ERRCODE='22023';
 END IF;
 IF EXISTS (
  WITH candidate AS (
   SELECT program.value->>'id' AS program_id,intake.value->>'id' AS intake_id
   FROM jsonb_array_elements(p_content->'programs') program(value)
   CROSS JOIN LATERAL jsonb_array_elements(program.value->'intakes') intake(value)
   WHERE intake.value ? 'id'
  )
  SELECT 1 FROM platform_private.university_catalog_publications publication
  CROSS JOIN LATERAL jsonb_array_elements(publication.content->'programs') program(value)
  CROSS JOIN LATERAL jsonb_array_elements(program.value->'intakes') intake(value)
  JOIN candidate ON candidate.intake_id=intake.value->>'id'
  WHERE publication.organization_id=p_organization_id AND publication.status='published'
   AND (publication.institution_id IS DISTINCT FROM p_institution_id
    OR program.value->>'id' IS DISTINCT FROM candidate.program_id)
 ) THEN
  RAISE EXCEPTION 'An intake ID belongs to a different institution or program' USING ERRCODE='22023';
 END IF;
END $$;

CREATE FUNCTION platform_private.stage_university_catalog_publication(
 p_organization_id UUID,p_institution_id UUID,p_base_version BIGINT,p_content JSONB,p_reason TEXT,p_request_id UUID,p_review_kind TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a RECORD; old_request RECORD; digest TEXT; source_id UUID; draft_id UUID := gen_random_uuid();
 receipt JSONB; existing RECORD; current_version BIGINT;
 base_publication platform_private.university_catalog_publications%ROWTYPE;
 base_id UUID; base_hash TEXT;
BEGIN
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 IF p_review_kind IS NULL OR p_review_kind NOT IN ('content','intake_ids')
  OR p_request_id IS NULL OR p_base_version IS NULL OR p_base_version NOT BETWEEN 0 AND 9007199254740990
  OR NOT COALESCE(platform_private.valid_university_content(p_content),FALSE) THEN
  RAISE EXCEPTION 'Invalid reviewed catalogue content' USING ERRCODE='22023';
 END IF;
 IF p_review_kind='intake_ids' AND (p_institution_id IS NULL OR p_base_version=0) THEN
  RAISE EXCEPTION 'An existing published base is required for intake IDs' USING ERRCODE='22023';
 END IF;
 p_reason := platform_private.validate_bw5_reason(p_reason);
 -- Preserve pre-211 normal hashes and receipt replay byte-for-byte.
 IF p_review_kind='content' THEN
  digest := platform_private.bw5_input_sha256(jsonb_build_object('institution',p_institution_id,'base',p_base_version,'content',p_content,'reason',p_reason));
 ELSE
  digest := platform_private.bw5_input_sha256(jsonb_build_object('institution',p_institution_id,'base',p_base_version,'content',p_content,'reason',p_reason,'reviewKind','intake_ids'));
 END IF;
 PERFORM platform_private.lock_bw5_request(p_request_id);
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO old_request FROM platform_private.university_catalog_requests WHERE organization_id=p_organization_id AND actor_membership_id=a.actor_membership_id AND request_id=p_request_id;
 IF FOUND THEN IF old_request.operation <> 'stage' OR old_request.input_hash <> digest THEN RAISE EXCEPTION 'Request reused with different content' USING ERRCODE='23505'; END IF; RETURN old_request.receipt; END IF;
 PERFORM platform_private.lock_university_intake_identities(p_organization_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:university:'||p_organization_id::TEXT||':'||platform_private.normalize_catalog_institution_name(p_content->>'name')||':'||(p_content->>'country'),0));
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO existing FROM platform.catalog_institutions i WHERE i.organization_id=p_organization_id AND i.institution_kind='university'
 AND platform_private.normalize_catalog_institution_name(i.institution_name)=platform_private.normalize_catalog_institution_name(p_content->>'name') AND i.country_code=p_content->>'country';
 IF p_institution_id IS NOT NULL AND (existing.id IS DISTINCT FROM p_institution_id) THEN RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE='42501'; END IF;
 IF existing.id IS NOT NULL AND (existing.institution_name IS DISTINCT FROM p_content->>'name' OR existing.city IS DISTINCT FROM p_content->>'city') THEN RAISE EXCEPTION 'Approved institution identity is immutable' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(max(version),0) INTO current_version FROM platform_private.university_catalog_publications WHERE organization_id=p_organization_id AND institution_id=existing.id AND status='published';
 IF current_version <> p_base_version THEN RAISE EXCEPTION 'Published version changed' USING ERRCODE='40001'; END IF;
 PERFORM platform_private.assert_university_intake_identities(p_organization_id,existing.id,p_content);
 IF p_review_kind='intake_ids' THEN
  SELECT * INTO base_publication FROM platform_private.university_catalog_publications
   WHERE organization_id=p_organization_id AND institution_id=existing.id AND version=p_base_version AND status='published';
  IF NOT FOUND OR NOT platform_private.university_intake_ids_only(base_publication.content,p_content) THEN
   RAISE EXCEPTION 'Technical publication may only add missing intake IDs' USING ERRCODE='22023';
  END IF;
  -- Reuse reviewed provenance; do not manufacture a fresh official-source review.
  PERFORM 1 FROM platform.source_registry WHERE organization_id=p_organization_id AND id=base_publication.source_registry_id AND review_status='reviewed' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The published source is no longer reviewed' USING ERRCODE='40001'; END IF;
  source_id := base_publication.source_registry_id;
  base_id := base_publication.id;
  base_hash := platform_private.bw5_input_sha256(base_publication.content);
 ELSE
  source_id := platform.register_workflow_source(p_organization_id,'src_'||replace(draft_id::TEXT,'-',''),'official_website'::platform.workflow_source_kind,p_content->>'sourceUrl',digest,p_reason,gen_random_uuid());
 END IF;
 INSERT INTO platform_private.university_catalog_publications(id,organization_id,institution_id,base_version,content,source_registry_id,reason,created_by_membership_id,review_kind,identity_base_publication_id,identity_base_content_hash)
 VALUES(draft_id,p_organization_id,existing.id,p_base_version,p_content,source_id,p_reason,a.actor_membership_id,p_review_kind,base_id,base_hash);
 receipt := jsonb_build_object('requestId',p_request_id,'draftId',draft_id,'institutionId',existing.id,'status','saved');
 INSERT INTO platform_private.university_catalog_requests VALUES(p_organization_id,a.actor_membership_id,p_request_id,'stage',digest,receipt);
 RETURN receipt;
END $$;

CREATE OR REPLACE FUNCTION platform.stage_university_catalog_publication(p_organization_id UUID,p_institution_id UUID,p_base_version BIGINT,p_content JSONB,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 RETURN platform_private.stage_university_catalog_publication(p_organization_id,p_institution_id,p_base_version,p_content,p_reason,p_request_id,'content');
END $$;

CREATE FUNCTION platform.stage_university_intake_identity_publication(p_organization_id UUID,p_institution_id UUID,p_base_version BIGINT,p_content JSONB,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 RETURN platform_private.stage_university_catalog_publication(p_organization_id,p_institution_id,p_base_version,p_content,p_reason,p_request_id,'intake_ids');
END $$;

CREATE OR REPLACE FUNCTION platform.review_university_catalog_publication(p_organization_id UUID,p_draft_id UUID,p_decision TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; d platform_private.university_catalog_publications%ROWTYPE; old_request RECORD; digest TEXT; receipt JSONB;
 existing RECORD; current_version BIGINT; batch JSONB; batch_id UUID; published_institution_id UUID;
 base_publication platform_private.university_catalog_publications%ROWTYPE;
BEGIN
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 IF p_request_id IS NULL OR p_draft_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('publish','reject') THEN RAISE EXCEPTION 'Invalid publication decision' USING ERRCODE='22023'; END IF;
 digest := platform_private.bw5_input_sha256(jsonb_build_object('draftId',p_draft_id,'decision',p_decision));
 PERFORM platform_private.lock_bw5_request(p_request_id);
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO old_request FROM platform_private.university_catalog_requests WHERE organization_id=p_organization_id AND actor_membership_id=a.actor_membership_id AND request_id=p_request_id;
 IF FOUND THEN IF old_request.operation <> p_decision OR old_request.input_hash <> digest THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF; RETURN old_request.receipt; END IF;
 SELECT * INTO d FROM platform_private.university_catalog_publications WHERE id=p_draft_id AND organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.lock_university_intake_identities(p_organization_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:university:'||p_organization_id::TEXT||':'||platform_private.normalize_catalog_institution_name(d.content->>'name')||':'||(d.content->>'country'),0));
 SELECT * INTO d FROM platform_private.university_catalog_publications WHERE id=p_draft_id AND organization_id=p_organization_id FOR UPDATE;
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 IF d.status <> 'draft' THEN RAISE EXCEPTION 'Draft already reviewed' USING ERRCODE='40001'; END IF;
 IF p_decision='publish' THEN
  SELECT * INTO existing FROM platform.catalog_institutions i WHERE i.organization_id=p_organization_id AND i.institution_kind='university'
  AND platform_private.normalize_catalog_institution_name(i.institution_name)=platform_private.normalize_catalog_institution_name(d.content->>'name') AND i.country_code=d.content->>'country';
  SELECT COALESCE(max(p.version),0) INTO current_version FROM platform_private.university_catalog_publications p WHERE p.organization_id=p_organization_id AND p.institution_id=existing.id AND p.status='published';
  IF current_version <> d.base_version OR (d.institution_id IS NOT NULL AND d.institution_id IS DISTINCT FROM existing.id) THEN RAISE EXCEPTION 'Published version changed' USING ERRCODE='40001'; END IF;
  IF existing.id IS NOT NULL AND (existing.institution_name IS DISTINCT FROM d.content->>'name' OR existing.city IS DISTINCT FROM d.content->>'city') THEN RAISE EXCEPTION 'Approved identity changed' USING ERRCODE='40001'; END IF;
  IF NOT COALESCE(platform_private.valid_university_content(d.content),FALSE) THEN RAISE EXCEPTION 'Invalid reviewed catalogue content' USING ERRCODE='22023'; END IF;
  PERFORM platform_private.assert_university_intake_identities(p_organization_id,existing.id,d.content);
  IF d.review_kind='intake_ids' THEN
   SELECT * INTO base_publication FROM platform_private.university_catalog_publications
    WHERE id=d.identity_base_publication_id AND organization_id=p_organization_id AND institution_id=existing.id AND version=d.base_version AND status='published';
   IF NOT FOUND OR platform_private.bw5_input_sha256(base_publication.content) IS DISTINCT FROM d.identity_base_content_hash
    OR base_publication.source_registry_id IS DISTINCT FROM d.source_registry_id
    OR NOT platform_private.university_intake_ids_only(base_publication.content,d.content) THEN
    RAISE EXCEPTION 'Technical publication no longer matches its exact base' USING ERRCODE='40001';
   END IF;
   PERFORM 1 FROM platform.source_registry WHERE organization_id=p_organization_id AND id=d.source_registry_id AND review_status='reviewed' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'The published source is no longer reviewed' USING ERRCODE='40001'; END IF;
  ELSE
   PERFORM platform.review_workflow_source(p_organization_id,d.source_registry_id,'reviewed',d.reason,gen_random_uuid());
  END IF;
  published_institution_id := existing.id;
  IF published_institution_id IS NULL THEN
   batch := platform.create_catalog_import_batch(p_organization_id,d.source_registry_id,'university',d.reason,gen_random_uuid());
   batch_id := (batch->>'catalog_import_batch_id')::UUID;
   PERFORM platform.stage_catalog_import_candidate(p_organization_id,batch_id,'rec_'||replace(d.id::TEXT,'-',''),d.content->>'name',d.content->>'country',d.content->>'city',d.reason,gen_random_uuid());
   PERFORM platform.validate_catalog_import_batch(p_organization_id,batch_id,d.reason,gen_random_uuid());
   PERFORM platform.review_catalog_import_batch(p_organization_id,batch_id,'approve',d.reason,gen_random_uuid());
   SELECT i.id INTO STRICT published_institution_id FROM platform.catalog_institutions i WHERE i.organization_id=p_organization_id AND i.import_batch_id=batch_id;
  END IF;
  UPDATE platform_private.university_catalog_publications SET status='published',version=d.base_version+1,institution_id=published_institution_id,
   reviewed_by_membership_id=a.actor_membership_id,reviewed_at=clock_timestamp() WHERE id=d.id;
 ELSE
  -- A technical rejection must not reject the original published source.
  IF d.review_kind='content' THEN
   PERFORM platform.review_workflow_source(p_organization_id,d.source_registry_id,'rejected',d.reason,gen_random_uuid());
  END IF;
  UPDATE platform_private.university_catalog_publications SET status='rejected',reviewed_by_membership_id=a.actor_membership_id,reviewed_at=clock_timestamp() WHERE id=d.id;
  published_institution_id := d.institution_id;
 END IF;
 receipt := jsonb_build_object('requestId',p_request_id,'draftId',d.id,'institutionId',published_institution_id,'status',CASE p_decision WHEN 'publish' THEN 'published' ELSE 'rejected' END);
 INSERT INTO platform_private.university_catalog_requests VALUES(p_organization_id,a.actor_membership_id,p_request_id,p_decision,digest,receipt);
 RETURN receipt;
END $$;

-- Retain the exact legacy DTO while older clients remain deployed. In particular,
-- never offer an ID-only draft under their official-source review checkbox.
CREATE OR REPLACE FUNCTION platform.admin_university_catalog_drafts(p_organization_id UUID,p_draft_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE result JSONB; BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage',TRUE) a WHERE a.actor_organization_id=p_organization_id) THEN RAISE EXCEPTION 'Drafts unavailable' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'institutionId',institution_id,'baseVersion',base_version,'createdAt',created_at,'content',content,'reason',reason,'status','draft') ORDER BY created_at DESC,id),'[]'::JSONB) INTO result
 FROM (SELECT * FROM platform_private.university_catalog_publications WHERE organization_id=p_organization_id AND status='draft' AND review_kind='content' AND (p_draft_id IS NULL OR id=p_draft_id) ORDER BY created_at DESC,id LIMIT 50) drafts;
 RETURN result;
END $$;

CREATE FUNCTION platform.admin_university_catalog_drafts_with_review_kind(p_organization_id UUID,p_draft_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE result JSONB; BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage',TRUE) a WHERE a.actor_organization_id=p_organization_id) THEN RAISE EXCEPTION 'Drafts unavailable' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'institutionId',institution_id,'baseVersion',base_version,'createdAt',created_at,'content',content,'reason',reason,'status','draft','reviewKind',review_kind) ORDER BY created_at DESC,id),'[]'::JSONB) INTO result
 FROM (SELECT * FROM platform_private.university_catalog_publications WHERE organization_id=p_organization_id AND status='draft' AND (p_draft_id IS NULL OR id=p_draft_id) ORDER BY created_at DESC,id LIMIT 50) drafts;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION
 platform_private.university_intake_ids_only(JSONB,JSONB),
 platform_private.lock_university_intake_identities(UUID),
 platform_private.assert_university_intake_identities(UUID,UUID,JSONB),
 platform_private.stage_university_catalog_publication(UUID,UUID,BIGINT,JSONB,TEXT,UUID,TEXT),
 platform.stage_university_intake_identity_publication(UUID,UUID,BIGINT,JSONB,TEXT,UUID),
 platform.admin_university_catalog_drafts_with_review_kind(UUID,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
 platform.stage_university_intake_identity_publication(UUID,UUID,BIGINT,JSONB,TEXT,UUID),
 platform.admin_university_catalog_drafts_with_review_kind(UUID,UUID)
 TO authenticated;
-- CREATE OR REPLACE retains ACLs on the existing public commands and validator.
NOTIFY pgrst, 'reload schema';
COMMIT;
