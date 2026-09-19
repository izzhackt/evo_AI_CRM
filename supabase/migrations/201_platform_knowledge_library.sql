-- 201_platform_knowledge_library; KB release coordinated by Astra.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('platform-knowledge-library','platform-knowledge-library',FALSE,8388608,ARRAY['application/octet-stream']);
-- Even a broader existing object policy cannot expose this private library.
CREATE POLICY knowledge_library_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id<>'platform-knowledge-library') WITH CHECK(bucket_id<>'platform-knowledge-library');

CREATE TABLE platform_private.kb_blobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  area TEXT NOT NULL CHECK (area IN ('internal','clients','raw','secrets')),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0 AND byte_size <= 1099511627776),
  part_size INTEGER NOT NULL DEFAULT 8388608 CHECK (part_size=8388608),
  owner_membership_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading','ready')),
  verified_at TIMESTAMPTZ,
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','opaque')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,area,sha256,byte_size),
  UNIQUE (organization_id,area,id)
);
CREATE TABLE platform_private.kb_blob_parts (
  blob_id UUID NOT NULL REFERENCES platform_private.kb_blobs(id),
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blob_id,part_index)
);
CREATE TABLE platform_private.kb_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  area TEXT NOT NULL CHECK (area IN ('internal','clients','raw','secrets')),
  parent_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('folder','page','file','secret')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240 AND title !~ '[\x00-\x1F\x7F]'),
  body TEXT NOT NULL DEFAULT '' CHECK (octet_length(body) <= 2097152),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  client_case_id UUID REFERENCES platform.student_cases(id),
  blob_id UUID,
  source_blob_id UUID,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream' CHECK (length(mime_type) <= 160),
  source JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(source)='object' AND octet_length(source::text)<=65536),
  source_key TEXT CHECK (length(source_key)<=160),
  review_question TEXT NOT NULL DEFAULT '' CHECK (length(review_question)<=4000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  archived_at TIMESTAMPTZ,
  archive_batch UUID,
  deleted_at TIMESTAMPTZ,
  delete_batch UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  UNIQUE (organization_id,area,id),
  UNIQUE (organization_id,source_key),
  FOREIGN KEY (organization_id,area,parent_id) REFERENCES platform_private.kb_nodes(organization_id,area,id),
  FOREIGN KEY (organization_id,area,blob_id) REFERENCES platform_private.kb_blobs(organization_id,area,id),
  FOREIGN KEY (organization_id,area,source_blob_id) REFERENCES platform_private.kb_blobs(organization_id,area,id),
  CHECK (kind='page' OR body=''),
  CHECK ((area='secrets' AND kind IN ('folder','file','secret')) OR (area<>'secrets' AND kind<>'secret')),
  CHECK (kind<>'folder' OR (blob_id IS NULL AND source_blob_id IS NULL)),
  CHECK (area='clients' OR client_case_id IS NULL)
);
CREATE INDEX kb_nodes_browse ON platform_private.kb_nodes(organization_id,area,parent_id,title,id);
CREATE INDEX kb_nodes_source ON platform_private.kb_nodes(organization_id,source_key) WHERE source_key IS NOT NULL;
CREATE INDEX kb_nodes_search ON platform_private.kb_nodes USING gin(to_tsvector('simple',title || ' ' || description || ' ' || body)) WHERE area<>'secrets';
CREATE TABLE platform_private.kb_versions (
  node_id UUID NOT NULL REFERENCES platform_private.kb_nodes(id),
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_membership_id UUID NOT NULL,
  PRIMARY KEY(node_id,version)
);
CREATE TABLE platform_private.kb_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,request_id)
);
ALTER TABLE platform_private.kb_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_blob_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.kb_nodes,platform_private.kb_versions,platform_private.kb_requests,
  platform_private.kb_blobs,platform_private.kb_blob_parts FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.kb_require_admin(p_organization_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() x
    WHERE x.organization_id=p_organization_id AND x.platform_role='admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_forbidden' USING ERRCODE='42501'; END IF;
  RETURN a.membership_id;
END;
$$;
REVOKE ALL ON FUNCTION platform_private.kb_require_admin(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.kb_save_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO platform_private.kb_versions(node_id,version,snapshot,actor_membership_id)
    VALUES(NEW.id,NEW.version,to_jsonb(NEW),NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION platform_private.kb_save_version() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER kb_node_version AFTER INSERT OR UPDATE ON platform_private.kb_nodes
  FOR EACH ROW EXECUTE FUNCTION platform_private.kb_save_version();

CREATE FUNCTION platform.kb_query_v1(p_organization_id UUID,p_query JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE n platform_private.kb_nodes; b platform_private.kb_blobs;
  result JSONB; lim INTEGER:=100; mode TEXT:=coalesce(p_query->>'mode','list');
BEGIN
  PERFORM platform_private.kb_require_admin(p_organization_id);
  IF jsonb_typeof(p_query)<>'object' THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
  lim:=least(200,greatest(1,coalesce((p_query->>'limit')::INTEGER,100)));
  IF mode='item' OR mode='history' THEN
    SELECT * INTO n FROM platform_private.kb_nodes WHERE organization_id=p_organization_id AND id=(p_query->>'id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
    IF mode='item' THEN RETURN to_jsonb(n); END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.version DESC),'[]') INTO result FROM (
      SELECT version,created_at,actor_membership_id,snapshot FROM platform_private.kb_versions
      WHERE node_id=n.id AND version<coalesce((p_query->>'beforeVersion')::INTEGER,2147483647)
      ORDER BY version DESC LIMIT lim+1
    ) v;
    RETURN jsonb_build_object('items',result,'hasMore',jsonb_array_length(result)>lim);
  ELSIF mode='blob' THEN
    SELECT * INTO b FROM platform_private.kb_blobs WHERE organization_id=p_organization_id AND id=(p_query->>'id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.part_index),'[]') INTO result
      FROM platform_private.kb_blob_parts x WHERE x.blob_id=b.id;
    RETURN to_jsonb(b)||jsonb_build_object('parts',result);
  ELSIF mode='sources' THEN
    IF jsonb_typeof(p_query->'keys') IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->'keys')>200 THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
    RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',k.id,'sourceKey',k.source_key,'area',k.area,
      'sha256',k.source->>'sha256','byteSize',k.source->'byteSize','blobId',coalesce(k.source_blob_id,k.blob_id),
      'blobReady',source_blob.state='ready','version',k.version,'archived',k.archived_at IS NOT NULL,'trashed',k.deleted_at IS NOT NULL)),'[]')
      FROM platform_private.kb_nodes k LEFT JOIN platform_private.kb_blobs source_blob ON source_blob.id=coalesce(k.source_blob_id,k.blob_id) AND source_blob.organization_id=k.organization_id
      WHERE k.organization_id=p_organization_id AND k.source_key IN (SELECT jsonb_array_elements_text(p_query->'keys')));
  ELSIF mode='source' THEN
    SELECT * INTO n FROM platform_private.kb_nodes WHERE organization_id=p_organization_id AND source_key=p_query->>'key';
    RETURN CASE WHEN FOUND THEN to_jsonb(n) ELSE 'null'::JSONB END;
  ELSIF mode NOT IN ('list','search','folders','trash','review','archive','inbox') THEN
    RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t)-'body'-'source' ORDER BY t.title,t.id),'[]') INTO result FROM (
    SELECT k.* FROM platform_private.kb_nodes k
    WHERE k.organization_id=p_organization_id
      AND (nullif(p_query->>'area','') IS NULL OR k.area=p_query->>'area')
      AND (CASE WHEN mode='trash' THEN k.deleted_at IS NOT NULL ELSE k.deleted_at IS NULL END)
      AND (mode IN ('trash','archive') OR k.archived_at IS NULL)
      AND (mode<>'archive' OR k.archived_at IS NOT NULL)
      AND (mode<>'folders' OR k.kind='folder')
      AND (mode<>'review' OR k.review_question<>'')
      AND (mode<>'inbox' OR (k.parent_id IS NULL AND k.kind<>'folder') OR k.source->>'classification' IN ('unapproved_candidate','unmatched_client_material'))
      AND (nullif(p_query->>'scopeParentId','') IS NULL OR k.id IN (
        WITH RECURSIVE inside AS (SELECT id FROM platform_private.kb_nodes WHERE id=(p_query->>'scopeParentId')::UUID AND organization_id=p_organization_id
          UNION ALL SELECT child.id FROM platform_private.kb_nodes child JOIN inside parent ON child.parent_id=parent.id) SELECT id FROM inside))
      AND (mode<>'list' OR k.parent_id IS NOT DISTINCT FROM nullif(p_query->>'parentId','')::UUID)
      AND (nullif(p_query->>'caseId','') IS NULL OR k.client_case_id=(p_query->>'caseId')::UUID)
      AND (mode<>'search' OR (k.area<>'secrets' AND (k.title ILIKE '%'||(p_query->>'search')||'%'
        OR k.description ILIKE '%'||(p_query->>'search')||'%'
        OR (k.kind='page' AND k.body ILIKE '%'||(p_query->>'search')||'%'))))
      AND (nullif(p_query->>'afterTitle','') IS NULL OR (k.title,k.id)>(p_query->>'afterTitle',(p_query->>'afterId')::UUID))
    ORDER BY k.title,k.id LIMIT lim+1
  ) t;
  RETURN jsonb_build_object('items',result,'hasMore',jsonb_array_length(result)>lim);
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_query_v1(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_query_v1(UUID,JSONB) TO authenticated;

CREATE FUNCTION platform.kb_command_v1(p_organization_id UUID,p_request_id UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; fingerprint TEXT; prior platform_private.kb_requests; n platform_private.kb_nodes;
  parent platform_private.kb_nodes; b platform_private.kb_blobs; old_snapshot JSONB;
  result JSONB; op TEXT:=p_command->>'op'; area_value TEXT:=p_command->>'area';
  parent_value UUID:=nullif(p_command->>'parentId','')::UUID;
BEGIN
  actor:=platform_private.kb_require_admin(p_organization_id);
  IF p_request_id IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::TEXT)>2500000 THEN
    RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
  END IF;
  -- One short organization lock protects concurrent topology changes and exact retries.
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:'||p_organization_id::TEXT,0));
  fingerprint:=md5(p_command::TEXT);
  SELECT * INTO prior FROM platform_private.kb_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id<>actor OR prior.fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'knowledge_request_conflict' USING ERRCODE='PT409';
    END IF;
    RETURN prior.receipt;
  END IF;
  IF op='reserve_blob' THEN
    INSERT INTO platform_private.kb_blobs(organization_id,area,sha256,byte_size,owner_membership_id)
      VALUES(p_organization_id,area_value,p_command->>'sha256',(p_command->>'byteSize')::BIGINT,actor)
      ON CONFLICT(organization_id,area,sha256,byte_size) DO NOTHING;
    SELECT * INTO b FROM platform_private.kb_blobs WHERE organization_id=p_organization_id AND area=area_value
      AND sha256=p_command->>'sha256' AND byte_size=(p_command->>'byteSize')::BIGINT;
    result:=to_jsonb(b);
  ELSE
    IF op='create' THEN
      IF nullif(p_command->>'sourceKey','') IS NOT NULL THEN
        SELECT * INTO n FROM platform_private.kb_nodes WHERE organization_id=p_organization_id AND source_key=p_command->>'sourceKey';
        IF FOUND THEN
          -- An import retry never overwrites any page or metadata edited in CRM.
          result:=to_jsonb(n);
        END IF;
      END IF;
      IF result IS NULL THEN
        n.id:=coalesce(nullif(p_command->>'id','')::UUID,gen_random_uuid());
        n.organization_id:=p_organization_id; n.area:=area_value; n.parent_id:=parent_value;
        n.kind:=p_command->>'kind'; n.title:=btrim(p_command->>'title');
        n.body:=coalesce(p_command->>'body',''); n.description:=coalesce(p_command->>'description','');
        n.client_case_id:=nullif(p_command->>'caseId','')::UUID;
        n.blob_id:=nullif(p_command->>'blobId','')::UUID; n.source_blob_id:=nullif(p_command->>'sourceBlobId','')::UUID;
        n.mime_type:=coalesce(p_command->>'mimeType','application/octet-stream');
        n.source:=coalesce(p_command->'source','{}'); n.source_key:=nullif(p_command->>'sourceKey','');
        n.review_question:=coalesce(p_command->>'reviewQuestion',''); n.version:=1;
        n.created_at:=now(); n.updated_at:=now(); n.updated_by:=actor;
        IF coalesce((p_command->>'archived')::BOOLEAN,FALSE) THEN n.archived_at:=now(); n.archive_batch:=p_request_id; END IF;
      END IF;
    ELSE
      SELECT * INTO n FROM platform_private.kb_nodes WHERE organization_id=p_organization_id AND id=(p_command->>'id')::UUID FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
      IF n.version IS DISTINCT FROM (p_command->>'expectedVersion')::INTEGER THEN
        RAISE EXCEPTION 'knowledge_version_conflict' USING ERRCODE='PT409';
      END IF;
      IF n.kind='secret' AND op IN ('edit','restore_version') THEN RAISE EXCEPTION 'knowledge_encrypted_operation_required' USING ERRCODE='42501'; END IF;
      IF op='edit' THEN
        IF n.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'knowledge_in_trash' USING ERRCODE='PT409'; END IF;
        n.title:=coalesce(nullif(btrim(p_command->>'title'),''),n.title);
        n.body:=coalesce(p_command->>'body',n.body);
        n.description:=coalesce(p_command->>'description',n.description);
        n.review_question:=coalesce(p_command->>'reviewQuestion',n.review_question);
      ELSIF op='move' THEN
        n.parent_id:=parent_value;
      ELSIF op='assign_case' THEN
        IF n.area<>'clients' OR n.client_case_id IS NOT NULL OR n.deleted_at IS NOT NULL
          OR n.archived_at IS NOT NULL OR parent_value IS NULL OR NOT coalesce((p_command->>'confirmed')::BOOLEAN,FALSE) THEN
          RAISE EXCEPTION 'knowledge_case_boundary' USING ERRCODE='22023';
        END IF;
        n.parent_id:=parent_value; n.client_case_id:=nullif(p_command->>'caseId','')::UUID;
        IF n.client_case_id IS NULL THEN RAISE EXCEPTION 'knowledge_case_boundary' USING ERRCODE='22023'; END IF;
      ELSIF op='restore_version' THEN
        IF n.kind<>'page' OR n.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
        SELECT v.snapshot INTO old_snapshot FROM platform_private.kb_versions v WHERE v.node_id=n.id AND v.version=(p_command->>'restoreVersion')::INTEGER;
        IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
        n.body:=old_snapshot->>'body'; n.title:=old_snapshot->>'title';
      ELSIF op NOT IN ('trash','restore','archive','unarchive') THEN
        RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023';
      END IF;
      n.version:=n.version+1; n.updated_at:=now(); n.updated_by:=actor;
    END IF;
    IF result IS NULL THEN
      IF op='create' AND n.kind='secret' THEN RAISE EXCEPTION 'knowledge_encrypted_operation_required' USING ERRCODE='42501'; END IF;
      IF n.parent_id IS NOT NULL THEN
        SELECT * INTO parent FROM platform_private.kb_nodes WHERE id=n.parent_id AND organization_id=p_organization_id AND area=n.area;
        IF NOT FOUND OR parent.kind<>'folder' OR parent.deleted_at IS NOT NULL OR (parent.archived_at IS NOT NULL AND op IN ('create','move','assign_case','unarchive')) THEN
          RAISE EXCEPTION 'knowledge_parent_invalid' USING ERRCODE='22023';
        END IF;
        IF EXISTS(WITH RECURSIVE ancestors AS (
          SELECT id,parent_id FROM platform_private.kb_nodes WHERE id=n.parent_id
          UNION ALL SELECT k.id,k.parent_id FROM platform_private.kb_nodes k JOIN ancestors a ON k.id=a.parent_id
        ) SELECT 1 FROM ancestors WHERE id=n.id) THEN
          RAISE EXCEPTION 'knowledge_folder_cycle' USING ERRCODE='22023';
        END IF;
        IF parent.client_case_id IS DISTINCT FROM n.client_case_id THEN
          RAISE EXCEPTION 'knowledge_case_boundary' USING ERRCODE='22023';
        END IF;
      END IF;
      IF n.client_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.student_cases c WHERE c.id=n.client_case_id AND c.organization_id=p_organization_id) THEN
        RAISE EXCEPTION 'knowledge_case_boundary' USING ERRCODE='42501';
      END IF;
      IF n.kind='file' AND n.blob_id IS NULL THEN RAISE EXCEPTION 'knowledge_blob_required' USING ERRCODE='22023'; END IF;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY[n.blob_id,n.source_blob_id]) x(id) WHERE id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM platform_private.kb_blobs blob_row WHERE blob_row.id=x.id AND blob_row.organization_id=p_organization_id AND blob_row.area=n.area AND blob_row.state='ready')) THEN
        RAISE EXCEPTION 'knowledge_blob_not_ready' USING ERRCODE='PT409';
      END IF;
      IF op IN ('trash','archive') THEN
        -- A batch records exactly which descendants this action affected.
        WITH RECURSIVE descendants AS (
          SELECT id FROM platform_private.kb_nodes WHERE id=n.id
          UNION ALL SELECT k.id FROM platform_private.kb_nodes k JOIN descendants d ON k.parent_id=d.id
        ) UPDATE platform_private.kb_nodes k SET
          deleted_at=CASE WHEN op='trash' THEN now() ELSE k.deleted_at END,
          delete_batch=CASE WHEN op='trash' THEN p_request_id ELSE k.delete_batch END,
          archived_at=CASE WHEN op='archive' THEN now() ELSE k.archived_at END,
          archive_batch=CASE WHEN op='archive' THEN p_request_id ELSE k.archive_batch END,
          version=k.version+1,updated_at=now(),updated_by=actor
          WHERE k.id IN (SELECT id FROM descendants) AND k.deleted_at IS NULL AND (op='trash' OR k.archived_at IS NULL);
      ELSIF op IN ('restore','unarchive') THEN
        WITH RECURSIVE descendants AS (SELECT id FROM platform_private.kb_nodes WHERE id=n.id
          UNION ALL SELECT child.id FROM platform_private.kb_nodes child JOIN descendants d ON child.parent_id=d.id)
        UPDATE platform_private.kb_nodes k SET
          deleted_at=CASE WHEN op='restore' THEN NULL ELSE k.deleted_at END,
          delete_batch=CASE WHEN op='restore' THEN NULL ELSE k.delete_batch END,
          archived_at=CASE WHEN op='unarchive' THEN NULL ELSE k.archived_at END,
          archive_batch=CASE WHEN op='unarchive' THEN NULL ELSE k.archive_batch END,
          version=k.version+1,updated_at=now(),updated_by=actor
          WHERE k.organization_id=p_organization_id AND k.id IN (SELECT id FROM descendants) AND
            ((op='restore' AND k.delete_batch=n.delete_batch) OR (op='unarchive' AND k.archive_batch=n.archive_batch));
      ELSIF op='assign_case' THEN
        IF EXISTS(WITH RECURSIVE descendants AS (SELECT id,client_case_id FROM platform_private.kb_nodes WHERE id=n.id
          UNION ALL SELECT child.id,child.client_case_id FROM platform_private.kb_nodes child JOIN descendants d ON child.parent_id=d.id)
          SELECT 1 FROM descendants WHERE client_case_id IS NOT NULL) THEN
          RAISE EXCEPTION 'knowledge_case_boundary' USING ERRCODE='22023';
        END IF;
        WITH RECURSIVE descendants AS (SELECT id FROM platform_private.kb_nodes WHERE id=n.id
          UNION ALL SELECT child.id FROM platform_private.kb_nodes child JOIN descendants d ON child.parent_id=d.id)
        UPDATE platform_private.kb_nodes k SET client_case_id=n.client_case_id,
          parent_id=CASE WHEN k.id=n.id THEN n.parent_id ELSE k.parent_id END,
          version=k.version+1,updated_at=now(),updated_by=actor
          WHERE k.id IN (SELECT id FROM descendants);
      ELSIF op='create' THEN
        INSERT INTO platform_private.kb_nodes SELECT n.*;
      ELSE
        UPDATE platform_private.kb_nodes SET title=n.title,body=n.body,description=n.description,
          review_question=n.review_question,parent_id=n.parent_id,version=n.version,updated_at=n.updated_at,updated_by=n.updated_by
          WHERE id=n.id;
      END IF;
      SELECT to_jsonb(k) INTO result FROM platform_private.kb_nodes k WHERE id=n.id;
    END IF;
  END IF;
  INSERT INTO platform_private.kb_requests VALUES(p_organization_id,p_request_id,actor,fingerprint,result,now());
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_command_v1(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_command_v1(UUID,UUID,JSONB) TO authenticated;

-- Private storage writes are accepted only through the application service after user Admin gate.
-- The server re-reads stored bytes. This service-only function never grants a caller a signed URL.
CREATE FUNCTION platform.kb_storage_verified_v1(p_organization_id UUID,p_blob_id UUID,p_part_index INTEGER,
  p_sha256 TEXT,p_byte_size BIGINT,p_complete BOOLEAN DEFAULT FALSE,p_scan_status TEXT DEFAULT 'pending')
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b platform_private.kb_blobs; previous platform_private.kb_blob_parts; expected_size BIGINT;
BEGIN
  SELECT * INTO b FROM platform_private.kb_blobs WHERE id=p_blob_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
  IF p_complete THEN
    IF p_sha256<>b.sha256 OR p_byte_size<>b.byte_size OR
      (SELECT coalesce(sum(byte_size),0) FROM platform_private.kb_blob_parts WHERE blob_id=b.id)<>b.byte_size OR
      (SELECT count(*) FROM platform_private.kb_blob_parts WHERE blob_id=b.id)<>ceil(b.byte_size::NUMERIC/b.part_size) THEN
      RAISE EXCEPTION 'knowledge_integrity_failed' USING ERRCODE='22023';
    END IF;
    IF p_scan_status NOT IN ('clean','opaque') THEN RAISE EXCEPTION 'knowledge_scan_required' USING ERRCODE='22023'; END IF;
    UPDATE platform_private.kb_blobs SET state='ready',verified_at=now(),scan_status=p_scan_status WHERE id=b.id RETURNING * INTO b;
  ELSE
    IF p_part_index IS NULL OR p_part_index<0 OR p_part_index>=ceil(b.byte_size::NUMERIC/b.part_size) THEN
      RAISE EXCEPTION 'knowledge_part_invalid' USING ERRCODE='22023';
    END IF;
    expected_size:=least(b.part_size,b.byte_size-p_part_index::BIGINT*b.part_size);
    IF p_byte_size<>expected_size THEN RAISE EXCEPTION 'knowledge_part_invalid' USING ERRCODE='22023'; END IF;
    SELECT * INTO previous FROM platform_private.kb_blob_parts WHERE blob_id=b.id AND part_index=p_part_index;
    IF FOUND THEN
      IF previous.sha256<>p_sha256 OR previous.byte_size<>p_byte_size THEN
        RAISE EXCEPTION 'knowledge_part_conflict' USING ERRCODE='PT409';
      END IF;
    ELSE
      IF b.state='ready' THEN RAISE EXCEPTION 'knowledge_blob_immutable' USING ERRCODE='PT409'; END IF;
      INSERT INTO platform_private.kb_blob_parts(blob_id,part_index,byte_size,sha256) VALUES(b.id,p_part_index,p_byte_size,p_sha256);
    END IF;
  END IF;
  RETURN to_jsonb(b);
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_storage_verified_v1(UUID,UUID,INTEGER,TEXT,BIGINT,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_storage_verified_v1(UUID,UUID,INTEGER,TEXT,BIGINT,BOOLEAN,TEXT) TO service_role;
COMMIT;
