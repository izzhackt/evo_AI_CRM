-- O5: source-reviewed publication revisions attached to canonical BW5 institutions.
-- No institution, membership, approval or production content is seeded here.
BEGIN;
ALTER TYPE platform.workflow_source_kind ADD VALUE IF NOT EXISTS 'official_website';

CREATE FUNCTION platform_private.university_public_url(value TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT value IS NOT NULL AND length(value) <= 1000
 AND value ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?][^[:space:]#\\]*)?$'
 AND value !~ '[[:cntrl:]]' AND lower(value) !~ '\.(localhost|local|internal|test|invalid|example)([/?]|$)'
 AND value !~ '[?&][^=&]*%[^=&]*(=|&|$)'
 AND lower(value) !~ '[?&][^=&]*(token|secret|password|auth|api.?key)[^=&]*(=|&|$)'
$$;
-- Compare the enum as text: the newly added value is not used until after COMMIT.
CREATE OR REPLACE FUNCTION platform_private.is_safe_workflow_source_url(p_source_kind platform.workflow_source_kind,p_source_url TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE p_source_kind::TEXT
 WHEN 'google_document' THEN p_source_url ~ '^https://docs\.google\.com/document/d/[A-Za-z0-9_-]{10,200}(/(edit|view))?$'
 WHEN 'google_spreadsheet' THEN p_source_url ~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{10,200}(/(edit|view))?$'
 WHEN 'google_drive_file' THEN p_source_url ~ '^https://drive\.google\.com/file/d/[A-Za-z0-9_-]{10,200}(/(view|edit))?$'
 WHEN 'notion_database' THEN p_source_url ~ '^https://(www\.)?notion\.so/[A-Fa-f0-9]{32}$'
 WHEN 'repository_contract' THEN p_source_url ~ '^https://github\.com/[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}/commit/[A-Fa-f0-9]{40}$'
 WHEN 'official_website' THEN platform_private.university_public_url(p_source_url)
 ELSE FALSE END
$$;
-- Keep the proven BW5 engine; only add the honest public-source kind to its list.
DO $$ DECLARE body TEXT; signature TEXT; BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'platform.create_catalog_import_batch(uuid,uuid,platform.catalog_institution_kind,text,uuid)',
  'platform.admin_catalog_sources()'
 ] LOOP
  body := pg_get_functiondef(signature::regprocedure);
  IF strpos(body, '''notion_database''') = 0 THEN RAISE EXCEPTION 'BW5 source-kind anchor changed'; END IF;
  body := replace(body, 'source_row.source_kind NOT IN', 'source_row.source_kind::TEXT NOT IN');
  body := replace(body, 'source.source_kind IN', 'source.source_kind::TEXT IN');
  body := replace(body, '''notion_database''', '''notion_database'', ''official_website''');
  EXECUTE body;
 END LOOP;
END $$;

CREATE FUNCTION platform_private.university_text(value JSONB, max_length INT, allow_empty BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT COALESCE(jsonb_typeof(value) = 'string' AND length(value #>> '{}') <= max_length
 AND (allow_empty OR btrim(value #>> '{}') <> '') AND (value #>> '{}') !~ '[[:cntrl:]]',FALSE)
$$;
CREATE FUNCTION platform_private.university_date(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$ BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN FALSE; END IF;
 RETURN make_date(left(value #>> '{}',4)::INT,substring(value #>> '{}' FROM 6 FOR 2)::INT,right(value #>> '{}',2)::INT) IS NOT NULL;
 EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION platform_private.valid_university_content(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE program JSONB; intake JSONB; ids TEXT[] := '{}'::TEXT[]; BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR NOT value ?& ARRAY['name','country','city','overview','websiteUrl','sourceUrl','verifiedOn','notes','photoKey','programs']
 OR value - ARRAY['name','country','city','overview','websiteUrl','sourceUrl','verifiedOn','notes','photoKey','programs'] <> '{}'::JSONB
 OR NOT platform_private.university_text(value->'name',300) OR COALESCE(value->>'country','') !~ '^[A-Z]{2}$'
 OR NOT (value->'city' = 'null'::JSONB OR platform_private.university_text(value->'city',200))
 OR NOT platform_private.university_text(value->'overview',1200)
 OR NOT platform_private.university_public_url(value->>'websiteUrl') OR NOT platform_private.university_public_url(value->>'sourceUrl')
 OR NOT platform_private.university_date(value->'verifiedOn') OR NOT platform_private.university_text(value->'notes',1500,TRUE)
 OR NOT (value->'photoKey' = 'null'::JSONB OR value->>'photoKey' IN ('sunway','mmu','xjtlu','unnc'))
 OR jsonb_typeof(value->'programs') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
 IF jsonb_array_length(value->'programs') NOT BETWEEN 1 AND 30 THEN RETURN FALSE; END IF;
 FOR program IN SELECT * FROM jsonb_array_elements(value->'programs') LOOP
  IF jsonb_typeof(program) IS DISTINCT FROM 'object' OR NOT program ?& ARRAY['id','title','level','duration','language','summary','sourceUrl','intakes']
  OR program - ARRAY['id','title','level','duration','language','summary','sourceUrl','intakes'] <> '{}'::JSONB
  OR NOT platform_private.university_text(program->'id',64) OR COALESCE(program->>'id','') !~ '^[a-z0-9][a-z0-9-]{0,63}$' OR program->>'id' = ANY(ids)
  OR NOT platform_private.university_text(program->'title',300) OR COALESCE(program->>'level','') NOT IN ('foundation','diploma','bachelor','master','doctorate')
  OR NOT (program->'duration' = 'null'::JSONB OR platform_private.university_text(program->'duration',150))
  OR NOT (program->'language' = 'null'::JSONB OR platform_private.university_text(program->'language',100))
  OR NOT platform_private.university_text(program->'summary',1200,TRUE) OR NOT platform_private.university_public_url(program->>'sourceUrl')
  OR jsonb_typeof(program->'intakes') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  ids := array_append(ids,program->>'id');
  IF jsonb_array_length(program->'intakes') > 12 THEN RETURN FALSE; END IF;
  FOR intake IN SELECT * FROM jsonb_array_elements(program->'intakes') LOOP
   IF jsonb_typeof(intake) IS DISTINCT FROM 'object' OR NOT intake ?& ARRAY['label','startDate','startMonth','applicationDeadline','deadlineTime','timezone','status','note','sourceUrl','verifiedOn']
   OR intake - ARRAY['label','startDate','startMonth','applicationDeadline','deadlineTime','timezone','status','note','sourceUrl','verifiedOn'] <> '{}'::JSONB
   OR NOT platform_private.university_text(intake->'label',200)
   OR NOT (intake->'startDate' = 'null'::JSONB OR platform_private.university_date(intake->'startDate'))
   OR NOT (intake->'startMonth' = 'null'::JSONB OR intake->>'startMonth' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
   OR NOT (intake->'applicationDeadline' = 'null'::JSONB OR platform_private.university_date(intake->'applicationDeadline'))
   OR NOT (intake->'deadlineTime' = 'null'::JSONB OR intake->>'deadlineTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
   OR NOT (intake->'timezone' = 'null'::JSONB OR (platform_private.university_text(intake->'timezone',100) AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = intake->>'timezone')))
   OR (intake->>'deadlineTime' IS NOT NULL AND (intake->>'applicationDeadline' IS NULL OR intake->>'timezone' IS NULL))
   OR (intake->>'startDate' IS NOT NULL AND intake->>'startMonth' IS NOT NULL AND left(intake->>'startDate',7) <> intake->>'startMonth')
   OR COALESCE(intake->>'status','') NOT IN ('announced','open','closed','unknown','needs_reconfirmation')
   OR NOT platform_private.university_text(intake->'note',1000,TRUE) OR NOT platform_private.university_public_url(intake->>'sourceUrl')
   OR NOT platform_private.university_date(intake->'verifiedOn') THEN RETURN FALSE; END IF;
  END LOOP;
 END LOOP;
 RETURN TRUE;
 EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE TABLE platform_private.university_catalog_publications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES platform.organizations(id),
 institution_id UUID, base_version BIGINT NOT NULL CHECK(base_version BETWEEN 0 AND 9007199254740990),
 version BIGINT, content JSONB NOT NULL CHECK(platform_private.valid_university_content(content)),
 source_registry_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','rejected')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]'),
 created_by_membership_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 reviewed_by_membership_id UUID, reviewed_at TIMESTAMPTZ,
 FOREIGN KEY(organization_id,institution_id) REFERENCES platform.catalog_institutions(organization_id,id),
 FOREIGN KEY(organization_id,source_registry_id) REFERENCES platform.source_registry(organization_id,id),
 FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,reviewed_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 UNIQUE(organization_id,institution_id,version),
 CHECK ((status='draft' AND version IS NULL AND reviewed_at IS NULL AND reviewed_by_membership_id IS NULL)
 OR (status='published' AND institution_id IS NOT NULL AND version=base_version+1 AND reviewed_at IS NOT NULL AND reviewed_by_membership_id IS NOT NULL)
 OR (status='rejected' AND version IS NULL AND reviewed_at IS NOT NULL AND reviewed_by_membership_id IS NOT NULL))
);
CREATE INDEX university_catalog_publications_read_idx ON platform_private.university_catalog_publications(organization_id,institution_id,version DESC) WHERE status='published';
CREATE INDEX university_catalog_publications_drafts_idx ON platform_private.university_catalog_publications(organization_id,created_at DESC) WHERE status='draft';
CREATE TABLE platform_private.university_catalog_requests (
 organization_id UUID NOT NULL REFERENCES platform.organizations(id), actor_membership_id UUID NOT NULL,
 request_id UUID NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('stage','publish','reject')), input_hash TEXT NOT NULL,
 receipt JSONB NOT NULL, PRIMARY KEY(organization_id,actor_membership_id,request_id),
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
ALTER TABLE platform_private.university_catalog_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.university_catalog_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.university_catalog_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.university_catalog_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.university_catalog_publications,platform_private.university_catalog_requests FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE FUNCTION platform_private.guard_university_publication() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status <> 'draft' OR NEW.status NOT IN ('published','rejected')
 OR (to_jsonb(NEW)-ARRAY['status','institution_id','version','reviewed_at','reviewed_by_membership_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','institution_id','version','reviewed_at','reviewed_by_membership_id'])
 OR (OLD.institution_id IS NOT NULL AND NEW.institution_id IS DISTINCT FROM OLD.institution_id) THEN
 RAISE EXCEPTION 'Publication history is immutable' USING ERRCODE='55000'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER university_publication_immutable BEFORE UPDATE OR DELETE ON platform_private.university_catalog_publications FOR EACH ROW EXECUTE FUNCTION platform_private.guard_university_publication();
CREATE TRIGGER university_requests_immutable BEFORE UPDATE OR DELETE ON platform_private.university_catalog_requests FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE FUNCTION platform.stage_university_catalog_publication(p_organization_id UUID,p_institution_id UUID,p_base_version BIGINT,p_content JSONB,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; old_request RECORD; digest TEXT; source_id UUID; draft_id UUID := gen_random_uuid(); receipt JSONB; existing RECORD; current_version BIGINT; BEGIN
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 IF p_request_id IS NULL OR p_base_version IS NULL OR p_base_version NOT BETWEEN 0 AND 9007199254740990 OR NOT COALESCE(platform_private.valid_university_content(p_content),FALSE) THEN RAISE EXCEPTION 'Invalid reviewed catalogue content' USING ERRCODE='22023'; END IF;
 p_reason := platform_private.validate_bw5_reason(p_reason);
 digest := platform_private.bw5_input_sha256(jsonb_build_object('institution',p_institution_id,'base',p_base_version,'content',p_content,'reason',p_reason));
 PERFORM platform_private.lock_bw5_request(p_request_id);
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO old_request FROM platform_private.university_catalog_requests WHERE organization_id=p_organization_id AND actor_membership_id=a.actor_membership_id AND request_id=p_request_id;
 IF FOUND THEN IF old_request.operation <> 'stage' OR old_request.input_hash <> digest THEN RAISE EXCEPTION 'Request reused with different content' USING ERRCODE='23505'; END IF; RETURN old_request.receipt; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('evo:university:'||p_organization_id::TEXT||':'||platform_private.normalize_catalog_institution_name(p_content->>'name')||':'||(p_content->>'country'),0));
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO existing FROM platform.catalog_institutions i WHERE i.organization_id=p_organization_id AND i.institution_kind='university'
 AND platform_private.normalize_catalog_institution_name(i.institution_name)=platform_private.normalize_catalog_institution_name(p_content->>'name') AND i.country_code=p_content->>'country';
 IF p_institution_id IS NOT NULL AND (existing.id IS DISTINCT FROM p_institution_id) THEN RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE='42501'; END IF;
 IF existing.id IS NOT NULL AND (existing.institution_name IS DISTINCT FROM p_content->>'name' OR existing.city IS DISTINCT FROM p_content->>'city') THEN RAISE EXCEPTION 'Approved institution identity is immutable' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(max(version),0) INTO current_version FROM platform_private.university_catalog_publications WHERE organization_id=p_organization_id AND institution_id=existing.id AND status='published';
 IF current_version <> p_base_version THEN RAISE EXCEPTION 'Published version changed' USING ERRCODE='40001'; END IF;
 source_id := platform.register_workflow_source(p_organization_id,'src_'||replace(draft_id::TEXT,'-',''),'official_website'::platform.workflow_source_kind,p_content->>'sourceUrl',digest,p_reason,gen_random_uuid());
 INSERT INTO platform_private.university_catalog_publications(id,organization_id,institution_id,base_version,content,source_registry_id,reason,created_by_membership_id)
 VALUES(draft_id,p_organization_id,existing.id,p_base_version,p_content,source_id,p_reason,a.actor_membership_id);
 receipt := jsonb_build_object('requestId',p_request_id,'draftId',draft_id,'institutionId',existing.id,'status','saved');
 INSERT INTO platform_private.university_catalog_requests VALUES(p_organization_id,a.actor_membership_id,p_request_id,'stage',digest,receipt);
 RETURN receipt;
END $$;

CREATE FUNCTION platform.review_university_catalog_publication(p_organization_id UUID,p_draft_id UUID,p_decision TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; d platform_private.university_catalog_publications%ROWTYPE; old_request RECORD; digest TEXT; receipt JSONB;
 existing RECORD; current_version BIGINT; batch JSONB; batch_id UUID; published_institution_id UUID; BEGIN
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 IF p_request_id IS NULL OR p_draft_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('publish','reject') THEN RAISE EXCEPTION 'Invalid publication decision' USING ERRCODE='22023'; END IF;
 digest := platform_private.bw5_input_sha256(jsonb_build_object('draftId',p_draft_id,'decision',p_decision));
 PERFORM platform_private.lock_bw5_request(p_request_id);
 SELECT * INTO a FROM platform_private.require_bw5_admin_actor(p_organization_id);
 SELECT * INTO old_request FROM platform_private.university_catalog_requests WHERE organization_id=p_organization_id AND actor_membership_id=a.actor_membership_id AND request_id=p_request_id;
 IF FOUND THEN IF old_request.operation <> p_decision OR old_request.input_hash <> digest THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF; RETURN old_request.receipt; END IF;
 SELECT * INTO d FROM platform_private.university_catalog_publications WHERE id=p_draft_id AND organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
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
  PERFORM platform.review_workflow_source(p_organization_id,d.source_registry_id,'reviewed',d.reason,gen_random_uuid());
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
  PERFORM platform.review_workflow_source(p_organization_id,d.source_registry_id,'rejected',d.reason,gen_random_uuid());
  UPDATE platform_private.university_catalog_publications SET status='rejected',reviewed_by_membership_id=a.actor_membership_id,reviewed_at=clock_timestamp() WHERE id=d.id;
  published_institution_id := d.institution_id;
 END IF;
 receipt := jsonb_build_object('requestId',p_request_id,'draftId',d.id,'institutionId',published_institution_id,'status',CASE p_decision WHEN 'publish' THEN 'published' ELSE 'rejected' END);
 INSERT INTO platform_private.university_catalog_requests VALUES(p_organization_id,a.actor_membership_id,p_request_id,p_decision,digest,receipt);
 RETURN receipt;
END $$;

-- This helper returns only the validated public content and catalogue IDs/versions.
CREATE FUNCTION platform_private.university_catalog_page(p_organization_id UUID,p_query TEXT,p_country TEXT,p_level TEXT,p_institution_id UUID,p_offset INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE result JSONB; BEGIN
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 50000 OR length(COALESCE(p_query,'')) > 100
 OR (p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$') OR (p_level IS NOT NULL AND p_level NOT IN ('foundation','diploma','bachelor','master','doctorate')) THEN RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE='22023'; END IF;
 WITH latest AS (SELECT DISTINCT ON (p.institution_id) p.institution_id,p.version,p.content,p.reviewed_at
  FROM platform_private.university_catalog_publications p JOIN platform.catalog_institutions i ON i.id=p.institution_id AND i.organization_id=p.organization_id
  WHERE p.organization_id=p_organization_id AND p.status='published' ORDER BY p.institution_id,p.version DESC),
 filtered AS (SELECT * FROM latest WHERE (p_institution_id IS NULL OR institution_id=p_institution_id)
  AND (COALESCE(p_query,'')='' OR strpos(lower(content->>'name'),lower(p_query)) > 0)
  AND (p_country IS NULL OR content->>'country'=p_country)
  AND (p_level IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(content->'programs') p WHERE p->>'level'=p_level)) ORDER BY content->>'name',institution_id LIMIT 31 OFFSET p_offset),
 numbered AS (SELECT *,row_number() OVER(ORDER BY content->>'name',institution_id) AS n FROM filtered)
 SELECT jsonb_build_object('items',COALESCE(jsonb_agg(jsonb_build_object('id',institution_id,'version',version,'publishedAt',reviewed_at,'content',content) ORDER BY content->>'name',institution_id) FILTER(WHERE n<=30),'[]'::JSONB),'nextOffset',CASE WHEN count(*)>30 THEN p_offset+30 ELSE NULL END) INTO result FROM numbered;
 RETURN result;
END $$;
CREATE FUNCTION platform.staff_university_catalog(p_organization_id UUID,p_query TEXT DEFAULT NULL,p_country TEXT DEFAULT NULL,p_level TEXT DEFAULT NULL,p_institution_id UUID DEFAULT NULL,p_offset INT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.read') a WHERE a.actor_organization_id=p_organization_id) THEN RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE='42501'; END IF;
 RETURN platform_private.university_catalog_page(p_organization_id,p_query,p_country,p_level,p_institution_id,p_offset);
END $$;
CREATE FUNCTION platform.student_university_catalog(p_query TEXT DEFAULT NULL,p_country TEXT DEFAULT NULL,p_level TEXT DEFAULT NULL,p_institution_id UUID DEFAULT NULL,p_offset INT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE a RECORD; BEGIN
 SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role='student';
 IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id,'portal.read.self') THEN RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE='42501'; END IF;
 RETURN platform_private.university_catalog_page(a.organization_id,p_query,p_country,p_level,p_institution_id,p_offset);
END $$;
CREATE FUNCTION platform.admin_university_catalog_drafts(p_organization_id UUID,p_draft_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE result JSONB; BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_private.current_bw5_actor('catalog.import.manage',TRUE) a WHERE a.actor_organization_id=p_organization_id) THEN RAISE EXCEPTION 'Drafts unavailable' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'institutionId',institution_id,'baseVersion',base_version,'createdAt',created_at,'content',content,'reason',reason,'status','draft') ORDER BY created_at DESC,id),'[]'::JSONB) INTO result
 FROM (SELECT * FROM platform_private.university_catalog_publications WHERE organization_id=p_organization_id AND status='draft' AND (p_draft_id IS NULL OR id=p_draft_id) ORDER BY created_at DESC,id LIMIT 50) drafts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION platform_private.university_public_url(TEXT),platform_private.university_text(JSONB,INT,BOOLEAN),platform_private.university_date(JSONB),platform_private.valid_university_content(JSONB),platform_private.guard_university_publication(),platform_private.university_catalog_page(UUID,TEXT,TEXT,TEXT,UUID,INT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.stage_university_catalog_publication(UUID,UUID,BIGINT,JSONB,TEXT,UUID),platform.review_university_catalog_publication(UUID,UUID,TEXT,UUID),platform.staff_university_catalog(UUID,TEXT,TEXT,TEXT,UUID,INT),platform.student_university_catalog(TEXT,TEXT,TEXT,UUID,INT),platform.admin_university_catalog_drafts(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.stage_university_catalog_publication(UUID,UUID,BIGINT,JSONB,TEXT,UUID),platform.review_university_catalog_publication(UUID,UUID,TEXT,UUID),platform.staff_university_catalog(UUID,TEXT,TEXT,TEXT,UUID,INT),platform.student_university_catalog(TEXT,TEXT,TEXT,UUID,INT),platform.admin_university_catalog_drafts(UUID,UUID) TO authenticated;
COMMIT;
