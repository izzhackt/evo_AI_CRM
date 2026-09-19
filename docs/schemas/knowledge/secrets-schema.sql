-- Draft: sealed records contain complete SOPS ciphertext, never plaintext fields.
BEGIN;
CREATE TABLE platform_private.kb_sealed_values (
 node_id UUID NOT NULL REFERENCES platform_private.kb_nodes(id),
 version INTEGER NOT NULL,
 ciphertext TEXT NOT NULL CHECK(octet_length(ciphertext) BETWEEN 1 AND 1048576),
 PRIMARY KEY(node_id,version)
);
CREATE TABLE platform_private.kb_sealed_receipts (
 organization_id UUID NOT NULL,
 request_id UUID NOT NULL,
 actor_membership_id UUID NOT NULL,
 fingerprint TEXT NOT NULL,
 node_id UUID NOT NULL,
 node_version INTEGER NOT NULL,
 PRIMARY KEY(organization_id,request_id)
);
ALTER TABLE platform_private.kb_sealed_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.kb_sealed_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.kb_sealed_values,platform_private.kb_sealed_receipts FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TABLE platform_private.kb_secret_access_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,node_id UUID NOT NULL,
 actor_membership_id UUID NOT NULL,action TEXT NOT NULL CHECK(action IN ('read_metadata','reveal','save')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform_private.kb_secret_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.kb_secret_access_events FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform.kb_sealed_v1(p_organization_id UUID,p_actor UUID,p_mode TEXT,p_data JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE n platform_private.kb_nodes; prior platform_private.kb_sealed_receipts; result TEXT;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_actor) i WHERE i.system_role='admin') THEN
   RAISE EXCEPTION 'knowledge_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_mode IN ('metadata','reveal') THEN
   SELECT * INTO n FROM platform_private.kb_nodes WHERE organization_id=p_organization_id AND id=(p_data->>'id')::UUID AND kind='secret';
   IF NOT FOUND OR n.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
   SELECT ciphertext INTO result FROM platform_private.kb_sealed_values WHERE node_id=n.id AND version=n.version;
   -- Metadata-only node versions (rename/move/archive) share the last sealed revision.
   IF NOT FOUND THEN SELECT ciphertext INTO result FROM platform_private.kb_sealed_values WHERE node_id=n.id AND version<=n.version ORDER BY version DESC LIMIT 1; END IF;
   IF result IS NULL THEN RAISE EXCEPTION 'knowledge_integrity_failed' USING ERRCODE='PT409'; END IF;
   INSERT INTO platform_private.kb_secret_access_events(organization_id,node_id,actor_membership_id,action)
     VALUES(p_organization_id,n.id,p_actor,CASE WHEN p_mode='reveal' THEN 'reveal' ELSE 'read_metadata' END);
   RETURN jsonb_build_object('item',to_jsonb(n),'ciphertext',result);
 END IF;
 IF p_mode NOT IN ('save','receipt') OR coalesce(p_data->>'fingerprint','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:'||p_organization_id::TEXT,0));
 SELECT * INTO prior FROM platform_private.kb_sealed_receipts WHERE organization_id=p_organization_id AND request_id=(p_data->>'requestId')::UUID;
 IF FOUND THEN
   IF prior.actor_membership_id<>p_actor OR prior.fingerprint<>p_data->>'fingerprint' THEN RAISE EXCEPTION 'knowledge_request_conflict' USING ERRCODE='PT409'; END IF;
   SELECT snapshot INTO result FROM platform_private.kb_versions WHERE node_id=prior.node_id AND version=prior.node_version;
   RETURN result::JSONB;
 END IF;
 IF p_mode='receipt' THEN RETURN 'null'::JSONB; END IF;
 SELECT * INTO n FROM platform_private.kb_nodes WHERE id=(p_data->>'id')::UUID AND organization_id=p_organization_id FOR UPDATE;
 IF FOUND THEN
   IF n.kind<>'secret' OR n.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'knowledge_invalid' USING ERRCODE='22023'; END IF;
   IF n.version IS DISTINCT FROM (p_data->>'expectedVersion')::INTEGER THEN RAISE EXCEPTION 'knowledge_version_conflict' USING ERRCODE='PT409'; END IF;
   UPDATE platform_private.kb_nodes SET title=p_data->>'title',version=version+1,updated_at=now(),updated_by=p_actor WHERE id=n.id RETURNING * INTO n;
 ELSE
   IF coalesce((p_data->>'expectedVersion')::INTEGER,0)<>0 THEN RAISE EXCEPTION 'knowledge_not_found' USING ERRCODE='P0002'; END IF;
   IF nullif(p_data->>'parentId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_private.kb_nodes WHERE id=(p_data->>'parentId')::UUID
     AND organization_id=p_organization_id AND area='secrets' AND kind='folder' AND deleted_at IS NULL AND archived_at IS NULL) THEN
     RAISE EXCEPTION 'knowledge_parent_invalid' USING ERRCODE='22023';
   END IF;
   INSERT INTO platform_private.kb_nodes(id,organization_id,area,kind,title,parent_id,updated_by)
     VALUES((p_data->>'id')::UUID,p_organization_id,'secrets','secret',p_data->>'title',nullif(p_data->>'parentId','')::UUID,p_actor) RETURNING * INTO n;
 END IF;
 INSERT INTO platform_private.kb_sealed_values(node_id,version,ciphertext) VALUES(n.id,n.version,p_data->>'ciphertext');
 INSERT INTO platform_private.kb_sealed_receipts VALUES(p_organization_id,(p_data->>'requestId')::UUID,p_actor,p_data->>'fingerprint',n.id,n.version);
 INSERT INTO platform_private.kb_secret_access_events(organization_id,node_id,actor_membership_id,action) VALUES(p_organization_id,n.id,p_actor,'save');
 RETURN to_jsonb(n);
END;
$$;
REVOKE ALL ON FUNCTION platform.kb_sealed_v1(UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.kb_sealed_v1(UUID,UUID,TEXT,JSONB) TO service_role;
COMMIT;
