-- D4 registry only. No bytes/bucket/inspection writer or rendering is installed.
-- Runtime roles cannot manufacture the trusted template inspection receipt.
BEGIN;

CREATE TABLE platform_private.university_form_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
 catalog_institution_id UUID NOT NULL,
 catalog_source_revision TEXT NOT NULL,
 title TEXT NOT NULL CHECK (btrim(title)<>'' AND char_length(title)<=200 AND title !~ '[[:cntrl:]]'),
 revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
 created_by_membership_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 archived_at TIMESTAMPTZ,
 published_mapping_id UUID,
 published_review_id UUID,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,catalog_institution_id) REFERENCES platform.catalog_institutions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 CHECK ((published_mapping_id IS NULL)=(published_review_id IS NULL)),
 CHECK (archived_at IS NULL OR published_mapping_id IS NULL)
);
CREATE INDEX university_form_templates_catalog_idx ON platform_private.university_form_templates(organization_id,catalog_institution_id,id);
CREATE INDEX university_form_templates_author_idx ON platform_private.university_form_templates(organization_id,created_by_membership_id);

CREATE TABLE platform_private.university_form_template_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, template_id UUID NOT NULL,
 version_number INTEGER NOT NULL CHECK(version_number>0),
 created_revision BIGINT NOT NULL CHECK(created_revision BETWEEN 2 AND 9007199254740991),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
 mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 source_reference TEXT NOT NULL CHECK(btrim(source_reference)<>'' AND char_length(source_reference)<=500 AND source_reference !~ '[[:cntrl:]]'),
 source_date DATE NOT NULL CHECK(source_date BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'),
 bucket_id TEXT NOT NULL DEFAULT 'platform-document-templates' CHECK(bucket_id='platform-document-templates'),
 object_name TEXT NOT NULL UNIQUE,
 created_by_membership_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,template_id,id), UNIQUE(template_id,version_number), UNIQUE(template_id,created_revision),
 FOREIGN KEY(organization_id,template_id) REFERENCES platform_private.university_form_templates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 CHECK(object_name=organization_id::TEXT||'/'||template_id::TEXT||'/'||id::TEXT||CASE WHEN mime_type='application/pdf' THEN '.pdf' ELSE '.docx' END)
);
CREATE INDEX university_form_versions_author_idx ON platform_private.university_form_template_versions(organization_id,created_by_membership_id);

CREATE TABLE platform_private.university_form_inspection_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, template_id UUID NOT NULL,
 template_version_id UUID NOT NULL UNIQUE,
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_byte_size INTEGER NOT NULL CHECK(source_byte_size BETWEEN 1 AND 20971520),
 source_mime_type TEXT NOT NULL CHECK(source_mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 source_object_name TEXT NOT NULL,
 scan_signature_revision TEXT NOT NULL CHECK(scan_signature_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 inspector_revision TEXT NOT NULL CHECK(inspector_revision='evo-university-template-v1'),
 inspector_image_sha256 TEXT NOT NULL CHECK(inspector_image_sha256 ~ '^sha256:[a-f0-9]{64}$'),
 manifest_sha256 TEXT NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 manifest JSONB NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::TEXT)<=1048576),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(organization_id,template_id,template_version_id)
  REFERENCES platform_private.university_form_template_versions(organization_id,template_id,id) ON DELETE RESTRICT
);

CREATE TABLE platform_private.university_form_mapping_versions (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, template_id UUID NOT NULL, template_version_id UUID NOT NULL,
 template_sha256 TEXT NOT NULL CHECK(template_sha256 ~ '^[a-f0-9]{64}$'),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mappings JSONB NOT NULL CHECK(jsonb_typeof(mappings)='array' AND jsonb_array_length(mappings) BETWEEN 1 AND 3000 AND octet_length(mappings::TEXT)<=1048576),
 created_revision BIGINT NOT NULL CHECK(created_revision BETWEEN 2 AND 9007199254740991),
 created_by_membership_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,template_id,id), UNIQUE(template_id,created_revision),
 FOREIGN KEY(organization_id,template_id,template_version_id)
  REFERENCES platform_private.university_form_template_versions(organization_id,template_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX university_form_mappings_version_idx ON platform_private.university_form_mapping_versions(template_version_id,created_revision DESC);
CREATE INDEX university_form_mappings_author_idx ON platform_private.university_form_mapping_versions(organization_id,created_by_membership_id);

CREATE TABLE platform_private.university_form_mapping_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, template_id UUID NOT NULL, mapping_id UUID NOT NULL,
 mapping_sha256 TEXT NOT NULL CHECK(mapping_sha256 ~ '^[a-f0-9]{64}$'),
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
 reviewer_membership_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(btrim(reason)<>'' AND char_length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
 created_revision BIGINT NOT NULL CHECK(created_revision BETWEEN 2 AND 9007199254740991),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,template_id,mapping_id,id), UNIQUE(template_id,created_revision),
 FOREIGN KEY(organization_id,template_id,mapping_id) REFERENCES platform_private.university_form_mapping_versions(organization_id,template_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reviewer_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX university_form_reviews_mapping_idx ON platform_private.university_form_mapping_reviews(mapping_id,created_revision DESC);
CREATE INDEX university_form_reviews_actor_idx ON platform_private.university_form_mapping_reviews(organization_id,reviewer_membership_id);
ALTER TABLE platform_private.university_form_templates ADD CONSTRAINT university_form_published_tuple_fk
 FOREIGN KEY(organization_id,id,published_mapping_id,published_review_id)
 REFERENCES platform_private.university_form_mapping_reviews(organization_id,template_id,mapping_id,id) ON DELETE RESTRICT;

CREATE TABLE platform_private.university_form_command_receipts (
 request_id UUID PRIMARY KEY, organization_id UUID NOT NULL, template_id UUID NOT NULL,
 actor_membership_id UUID NOT NULL, actor_auth_user_id UUID NOT NULL,
 command TEXT NOT NULL CHECK(command IN ('create','reserve_version','save_mapping','review_mapping','publish','archive')),
 input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 outcome JSONB NOT NULL CHECK(jsonb_typeof(outcome)='object'),
 reason TEXT NOT NULL CHECK(btrim(reason)<>'' AND char_length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(organization_id,template_id) REFERENCES platform_private.university_form_templates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX university_form_receipts_template_idx ON platform_private.university_form_command_receipts(organization_id,template_id,created_at);
CREATE INDEX university_form_receipts_actor_idx ON platform_private.university_form_command_receipts(organization_id,actor_membership_id);

CREATE FUNCTION platform_private.university_form_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'university_form_immutable' USING ERRCODE='55000'; END $$;
CREATE FUNCTION platform_private.university_form_template_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.catalog_institution_id IS DISTINCT FROM OLD.catalog_institution_id OR NEW.catalog_source_revision IS DISTINCT FROM OLD.catalog_source_revision
 OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR OLD.archived_at IS NOT NULL OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'university_form_immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER university_form_template_update BEFORE UPDATE OR DELETE ON platform_private.university_form_templates
 FOR EACH ROW EXECUTE FUNCTION platform_private.university_form_template_update_guard();
DO $$DECLARE name TEXT; BEGIN
 FOREACH name IN ARRAY ARRAY['university_form_templates','university_form_template_versions','university_form_inspection_receipts',
 'university_form_mapping_versions','university_form_mapping_reviews','university_form_command_receipts'] LOOP
  EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON platform_private.%I FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',name);
  IF name<>'university_form_templates' THEN
   EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON platform_private.%I FOR EACH ROW EXECUTE FUNCTION platform_private.university_form_immutable()',name);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION platform_private.university_form_exact_keys(p_value JSONB,p_keys TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_typeof(p_value)='object' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_value) k)
  =(SELECT array_agg(k ORDER BY k) FROM unnest(p_keys) k)
$$;
CREATE FUNCTION platform_private.university_form_number(p_value JSONB,p_min NUMERIC,p_max NUMERIC)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n NUMERIC; s TEXT;
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value)<>'number' THEN RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
 n:=(p_value#>>'{}')::NUMERIC;
 IF n<p_min OR n>p_max OR n<>round(n,3) THEN RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
 s:=n::TEXT; IF position('.' IN s)>0 THEN s:=rtrim(rtrim(s,'0'),'.'); END IF;
 RETURN s;
END $$;

-- Same canonical JSON as computeUniversityFormMappingHash: exact property order,
-- lexicographically sorted slots and finite bounded decimal geometry.
CREATE FUNCTION platform_private.university_form_mapping_content(p_id UUID,p_version UUID,p_hash TEXT,p_mappings JSONB,p_mime TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item JSONB; pos JSONB; s TEXT; parts TEXT[]:=ARRAY[]::TEXT[]; slots TEXT[]:=ARRAY[]::TEXT[];
 source TEXT; slot TEXT; fmt TEXT; pdf BOOLEAN:=p_mime='application/pdf'; page TEXT; count_text TEXT;
BEGIN
 IF p_id IS NULL OR p_version IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
 OR p_mime NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 OR p_mappings IS NULL OR jsonb_typeof(p_mappings)<>'array' OR octet_length(p_mappings::TEXT)>1048576
 OR jsonb_array_length(p_mappings) NOT BETWEEN 1 AND (CASE WHEN pdf THEN 500 ELSE 3000 END) THEN
  RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT v FROM jsonb_array_elements(p_mappings) v ORDER BY v->>'slotId' COLLATE "C" LOOP
  IF NOT COALESCE(platform_private.university_form_exact_keys(item,
   CASE WHEN pdf THEN ARRAY['slotId','sourceKey','required','format','manual','position'] ELSE ARRAY['slotId','sourceKey','required','format','manual'] END),FALSE)
   OR jsonb_typeof(item->'slotId')<>'string' OR jsonb_typeof(item->'format')<>'string'
   OR jsonb_typeof(item->'required')<>'boolean' OR jsonb_typeof(item->'manual')<>'boolean'
   OR jsonb_typeof(item->'sourceKey') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
  source:=item->>'sourceKey'; slot:=item->>'slotId'; fmt:=item->>'format';
  IF slot !~ (CASE WHEN pdf THEN '^pdf-[1-9][0-9]{0,3}$' ELSE '^p-[1-9][0-9]{0,3}$' END) OR slot=ANY(slots)
   OR fmt NOT IN ('text','DD.MM.YYYY','DD/MM/YYYY','YYYY-MM-DD','DD','MM','YYYY')
   OR ((item->>'manual')::BOOLEAN AND (source IS NOT NULL OR fmt<>'text'))
   OR (NOT (item->>'manual')::BOOLEAN AND (source IS NULL OR NOT (platform_private.student_profile_field_is_known(source)
     OR source IN ('full_name','surname_first_name','father_full_name','mother_full_name'))))
   OR (fmt<>'text' AND source NOT IN ('date_of_birth','passport_expiry_date','desired_start_date')) THEN
   RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
  slots:=array_append(slots,slot);
  s:='{"slotId":'||to_json(slot)::TEXT||',"sourceKey":'||COALESCE(to_json(source)::TEXT,'null')
   ||',"required":'||(item->>'required')||',"format":'||to_json(fmt)::TEXT||',"manual":'||(item->>'manual');
  IF pdf THEN
   pos:=item->'position';
   IF NOT COALESCE(platform_private.university_form_exact_keys(pos,CASE WHEN pos ? 'characterCount'
    THEN ARRAY['page','x','y','width','height','characterCount'] ELSE ARRAY['page','x','y','width','height'] END),FALSE) THEN
    RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
   page:=platform_private.university_form_number(pos->'page',1,100);
   IF page::NUMERIC<>trunc(page::NUMERIC) THEN RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
   s:=s||',"position":{"page":'||page||',"x":'||platform_private.university_form_number(pos->'x',0,3000)
    ||',"y":'||platform_private.university_form_number(pos->'y',0,3000)
    ||',"width":'||platform_private.university_form_number(pos->'width',12,3000)
    ||',"height":'||platform_private.university_form_number(pos->'height',12,3000);
   IF pos ? 'characterCount' THEN
    count_text:=platform_private.university_form_number(pos->'characterCount',1,120);
    IF count_text::NUMERIC<>trunc(count_text::NUMERIC) OR (pos->>'width')::NUMERIC/count_text::NUMERIC<5 THEN
     RAISE EXCEPTION 'university_form_invalid_mapping' USING ERRCODE='22023'; END IF;
    s:=s||',"characterCount":'||count_text;
   END IF;
   s:=s||'}';
  END IF;
  parts:=array_append(parts,s||'}');
 END LOOP;
 RETURN '{"versionId":'||to_json(p_id::TEXT)::TEXT||',"templateVersionId":'||to_json(p_version::TEXT)::TEXT
  ||',"templateSha256":'||to_json(p_hash)::TEXT||',"mappings":['||array_to_string(parts,',')||']}';
END $$;

CREATE FUNCTION platform_private.university_form_manifest_valid(p_manifest JSONB,p_mime TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE slot JSONB; page JSONB; ids TEXT[]:=ARRAY[]::TEXT[]; pdf BOOLEAN:=p_mime='application/pdf';
BEGIN
 IF NOT COALESCE(platform_private.university_form_exact_keys(p_manifest,ARRAY['format','slots','pageSizes']),FALSE)
  OR p_manifest->>'format' IS DISTINCT FROM (CASE WHEN pdf THEN 'pdf' ELSE 'docx' END)
  OR jsonb_typeof(p_manifest->'slots') IS DISTINCT FROM 'array' OR jsonb_typeof(p_manifest->'pageSizes') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
 IF jsonb_array_length(p_manifest->'slots')>3000 OR jsonb_array_length(p_manifest->'pageSizes')>100
  OR (pdf AND jsonb_array_length(p_manifest->'pageSizes')=0) OR (NOT pdf AND p_manifest->'pageSizes'<>'[]'::JSONB) THEN RETURN FALSE; END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(p_manifest->'slots') LOOP
  IF NOT COALESCE(platform_private.university_form_exact_keys(slot,ARRAY['id','editable']),FALSE)
   OR jsonb_typeof(slot->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(slot->'editable') IS DISTINCT FROM 'boolean'
   OR slot->>'id' !~ (CASE WHEN pdf THEN '^pdf-[1-9][0-9]{0,3}$' ELSE '^p-[1-9][0-9]{0,3}$' END)
   OR slot->>'id'=ANY(ids) THEN RETURN FALSE; END IF;
  ids:=array_append(ids,slot->>'id');
 END LOOP;
 FOR page IN SELECT value FROM jsonb_array_elements(p_manifest->'pageSizes') LOOP
  IF NOT COALESCE(platform_private.university_form_exact_keys(page,ARRAY['width','height']),FALSE)
   OR jsonb_typeof(page->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(page->'height') IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  IF (page->>'width')::NUMERIC NOT BETWEEN 72 AND 3000 OR (page->>'height')::NUMERIC NOT BETWEEN 72 AND 3000 THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;
CREATE FUNCTION platform_private.university_form_inspection_matches(p_version platform_private.university_form_template_versions)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.university_form_inspection_receipts r
 WHERE r.organization_id=p_version.organization_id AND r.template_id=p_version.template_id AND r.template_version_id=p_version.id
 AND r.source_sha256=p_version.sha256 AND r.source_byte_size=p_version.byte_size AND r.source_mime_type=p_version.mime_type
 AND r.source_object_name=p_version.object_name AND r.manifest_sha256=platform_private.bw1_input_sha256(r.manifest)
 AND platform_private.university_form_manifest_valid(r.manifest,p_version.mime_type))
$$;
CREATE FUNCTION platform_private.university_form_mapping_inspected(p_mapping platform_private.university_form_mapping_versions)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v platform_private.university_form_template_versions; manifest JSONB; m JSONB; slot JSONB; pos JSONB; page JSONB;
BEGIN
 SELECT * INTO v FROM platform_private.university_form_template_versions WHERE id=p_mapping.template_version_id;
 IF NOT FOUND OR v.sha256<>p_mapping.template_sha256 OR NOT platform_private.university_form_inspection_matches(v) THEN RETURN FALSE; END IF;
 SELECT r.manifest INTO manifest FROM platform_private.university_form_inspection_receipts r WHERE r.template_version_id=v.id;
 FOR m IN SELECT value FROM jsonb_array_elements(p_mapping.mappings) LOOP
  SELECT value INTO slot FROM jsonb_array_elements(manifest->'slots') WHERE value->>'id'=m->>'slotId';
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(manifest->'slots') WHERE value->>'id'=m->>'slotId')<>1
   OR jsonb_typeof(slot->'editable') IS DISTINCT FROM 'boolean' OR (NOT (slot->>'editable')::BOOLEAN AND NOT (m->>'manual')::BOOLEAN) THEN RETURN FALSE; END IF;
  IF v.mime_type='application/pdf' THEN
   pos:=m->'position'; page:=manifest->'pageSizes'->((pos->>'page')::INTEGER-1);
   IF page IS NULL OR jsonb_typeof(page->'width')<>'number' OR jsonb_typeof(page->'height')<>'number'
    OR (page->>'width')::NUMERIC NOT BETWEEN 72 AND 3000 OR (page->>'height')::NUMERIC NOT BETWEEN 72 AND 3000
    OR (pos->>'x')::NUMERIC+(pos->>'width')::NUMERIC>(page->>'width')::NUMERIC
    OR (pos->>'y')::NUMERIC+(pos->>'height')::NUMERIC>(page->>'height')::NUMERIC THEN RETURN FALSE; END IF;
  END IF;
 END LOOP;
 IF v.mime_type='application/pdf' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_mapping.mappings) a
 CROSS JOIN jsonb_array_elements(p_mapping.mappings) b WHERE a->>'slotId'<b->>'slotId'
 AND a->'position'->>'page'=b->'position'->>'page'
 AND (a->'position'->>'x')::NUMERIC<(b->'position'->>'x')::NUMERIC+(b->'position'->>'width')::NUMERIC
 AND (b->'position'->>'x')::NUMERIC<(a->'position'->>'x')::NUMERIC+(a->'position'->>'width')::NUMERIC
 AND (a->'position'->>'y')::NUMERIC<(b->'position'->>'y')::NUMERIC+(b->'position'->>'height')::NUMERIC
 AND (b->'position'->>'y')::NUMERIC<(a->'position'->>'y')::NUMERIC+(a->'position'->>'height')::NUMERIC) THEN RETURN FALSE; END IF;
 RETURN TRUE;
END $$;

CREATE FUNCTION platform_private.university_form_command(p_organization_id UUID,p_template_id UUID,p_action TEXT,
 p_payload JSONB,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; t platform_private.university_form_templates; v platform_private.university_form_template_versions;
 m platform_private.university_form_mapping_versions; r platform_private.university_form_mapping_reviews;
 receipt platform_private.university_form_command_receipts; catalog platform.catalog_institutions;
 target_id UUID; result JSONB; fingerprint TEXT; content TEXT; next_revision BIGINT;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 IF p_organization_id IS NULL OR p_request_id IS NULL OR p_template_id IS NULL OR p_expected_revision IS NULL
 OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990 OR p_reason IS NULL OR btrim(p_reason)='' OR char_length(p_reason)>500 OR p_reason ~ '[[:cntrl:]]'
 OR p_action IS NULL OR p_action NOT IN ('create','reserve_version','save_mapping','review_mapping','publish','archive')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::TEXT)>1050000 THEN
  RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 PERFORM platform_private.lock_bw3_request(p_request_id);
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[actor.membership_id]);
 PERFORM platform_private.require_organization_operator(p_organization_id,'catalog.import.manage');
 fingerprint:=platform_private.bw1_input_sha256(jsonb_build_object('org',p_organization_id,'template',p_template_id,
 'action',p_action,'payload',p_payload,'expected',p_expected_revision,'reason',p_reason,'actor',actor.auth_user_id,'membership',actor.membership_id));
 SELECT * INTO receipt FROM platform_private.university_form_command_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.input_sha256<>fingerprint THEN RAISE EXCEPTION 'university_form_request_conflict' USING ERRCODE='23505'; END IF;
  RETURN receipt.outcome||jsonb_build_object('replayed',TRUE);
 END IF;
 IF p_action='create' THEN
  IF NOT COALESCE(platform_private.university_form_exact_keys(p_payload,ARRAY['catalogInstitutionId','title']),FALSE)
   OR jsonb_typeof(p_payload->'title')<>'string' OR btrim(p_payload->>'title')='' OR char_length(p_payload->>'title')>200
   OR p_payload->>'title' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
  SELECT * INTO catalog FROM platform.catalog_institutions WHERE organization_id=p_organization_id AND id=(p_payload->>'catalogInstitutionId')::UUID FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'university_form_stale_revision' USING ERRCODE='40001'; END IF;
  INSERT INTO platform_private.university_form_templates(id,organization_id,catalog_institution_id,catalog_source_revision,title,revision,created_by_membership_id)
  VALUES(p_template_id,p_organization_id,catalog.id,catalog.source_revision,p_payload->>'title',1,actor.membership_id) RETURNING * INTO t;
  next_revision:=1; target_id:=t.id;
 ELSE
  SELECT * INTO t FROM platform_private.university_form_templates WHERE organization_id=p_organization_id AND id=p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO catalog FROM platform.catalog_institutions WHERE organization_id=p_organization_id AND id=t.catalog_institution_id FOR SHARE;
  IF NOT FOUND OR catalog.source_revision<>t.catalog_source_revision THEN RAISE EXCEPTION 'university_form_source_changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO t FROM platform_private.university_form_templates WHERE organization_id=p_organization_id AND id=p_template_id FOR UPDATE;
  IF t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'university_form_archived' USING ERRCODE='55000'; END IF;
  IF t.revision<>p_expected_revision THEN RAISE EXCEPTION 'university_form_stale_revision' USING ERRCODE='40001'; END IF;
  next_revision:=t.revision+1;
  IF p_action='reserve_version' THEN
   IF NOT COALESCE(platform_private.university_form_exact_keys(p_payload,ARRAY['sha256','byteSize','mimeType','sourceReference','sourceDate']),FALSE)
    OR jsonb_typeof(p_payload->'sha256')<>'string' OR p_payload->>'sha256' !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_payload->'byteSize')<>'number' OR (p_payload->>'byteSize')::NUMERIC NOT BETWEEN 1 AND 20971520
    OR (p_payload->>'byteSize')::NUMERIC<>trunc((p_payload->>'byteSize')::NUMERIC)
    OR jsonb_typeof(p_payload->'mimeType')<>'string' OR p_payload->>'mimeType' NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR jsonb_typeof(p_payload->'sourceReference')<>'string' OR btrim(p_payload->>'sourceReference')='' OR char_length(p_payload->>'sourceReference')>500
    OR p_payload->>'sourceReference' ~ '[[:cntrl:]]' OR jsonb_typeof(p_payload->'sourceDate')<>'string'
    OR p_payload->>'sourceDate' !~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
     RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
   target_id:=gen_random_uuid();
   INSERT INTO platform_private.university_form_template_versions(id,organization_id,template_id,version_number,created_revision,sha256,byte_size,mime_type,source_reference,source_date,object_name,created_by_membership_id)
   VALUES(target_id,p_organization_id,t.id,(SELECT COALESCE(max(version_number),0)+1 FROM platform_private.university_form_template_versions WHERE template_id=t.id),next_revision,
    p_payload->>'sha256',(p_payload->>'byteSize')::INTEGER,p_payload->>'mimeType',p_payload->>'sourceReference',(p_payload->>'sourceDate')::DATE,
    p_organization_id::TEXT||'/'||t.id::TEXT||'/'||target_id::TEXT||CASE WHEN p_payload->>'mimeType'='application/pdf' THEN '.pdf' ELSE '.docx' END,actor.membership_id);
  ELSIF p_action='save_mapping' THEN
   IF NOT COALESCE(platform_private.university_form_exact_keys(p_payload,ARRAY['mappingId','templateVersionId','templateSha256','mappings']),FALSE) THEN
    RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
   SELECT * INTO v FROM platform_private.university_form_template_versions WHERE organization_id=p_organization_id AND template_id=t.id AND id=(p_payload->>'templateVersionId')::UUID;
   IF NOT FOUND OR v.sha256 IS DISTINCT FROM p_payload->>'templateSha256' THEN RAISE EXCEPTION 'university_form_source_changed' USING ERRCODE='55000'; END IF;
   target_id:=(p_payload->>'mappingId')::UUID;
   content:=platform_private.university_form_mapping_content(target_id,v.id,v.sha256,p_payload->'mappings',v.mime_type);
   INSERT INTO platform_private.university_form_mapping_versions(id,organization_id,template_id,template_version_id,template_sha256,sha256,mappings,created_revision,created_by_membership_id)
   VALUES(target_id,p_organization_id,t.id,v.id,v.sha256,encode(sha256(convert_to(content,'UTF8')),'hex'),content::JSONB->'mappings',next_revision,actor.membership_id);
  ELSIF p_action IN ('review_mapping','publish') THEN
   IF NOT COALESCE(platform_private.university_form_exact_keys(p_payload,CASE WHEN p_action='review_mapping'
    THEN ARRAY['mappingId','mappingSha256','decision'] ELSE ARRAY['mappingId','mappingSha256','reviewId'] END),FALSE) THEN
    RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
   SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE organization_id=p_organization_id AND template_id=t.id AND id=(p_payload->>'mappingId')::UUID;
   IF NOT FOUND OR m.sha256 IS DISTINCT FROM p_payload->>'mappingSha256' THEN RAISE EXCEPTION 'university_form_source_changed' USING ERRCODE='55000'; END IF;
   IF p_action='review_mapping' THEN
    IF p_payload->>'decision' IS NULL OR p_payload->>'decision' NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
    IF p_payload->>'decision'='approved' AND NOT platform_private.university_form_mapping_inspected(m) THEN RAISE EXCEPTION 'university_form_not_inspected' USING ERRCODE='55000'; END IF;
    INSERT INTO platform_private.university_form_mapping_reviews AS review_row(organization_id,template_id,mapping_id,mapping_sha256,decision,reviewer_membership_id,reason,created_revision)
     VALUES(p_organization_id,t.id,m.id,m.sha256,p_payload->>'decision',actor.membership_id,p_reason,next_revision) RETURNING review_row.id INTO target_id;
    IF t.published_mapping_id=m.id THEN t.published_mapping_id:=NULL; t.published_review_id:=NULL; END IF;
   ELSE
    SELECT * INTO r FROM platform_private.university_form_mapping_reviews WHERE mapping_id=m.id ORDER BY created_revision DESC LIMIT 1;
    IF NOT FOUND OR r.id IS DISTINCT FROM (p_payload->>'reviewId')::UUID OR r.decision<>'approved' OR r.mapping_sha256<>m.sha256
     OR NOT platform_private.university_form_mapping_inspected(m) THEN RAISE EXCEPTION 'university_form_not_ready' USING ERRCODE='55000'; END IF;
    t.published_mapping_id:=m.id; t.published_review_id:=r.id; target_id:=m.id;
   END IF;
  ELSIF p_action='archive' THEN
   IF p_payload<>'{}'::JSONB THEN RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
   t.archived_at:=statement_timestamp(); t.published_mapping_id:=NULL; t.published_review_id:=NULL; target_id:=t.id;
  END IF;
  UPDATE platform_private.university_form_templates SET revision=next_revision,archived_at=t.archived_at,
   published_mapping_id=t.published_mapping_id,published_review_id=t.published_review_id WHERE id=t.id;
 END IF;
 result:=jsonb_build_object('schema_version',1,'template_id',t.id,'target_id',target_id,'revision',next_revision,'outcome',p_action,'replayed',FALSE);
 INSERT INTO platform_private.university_form_command_receipts(request_id,organization_id,template_id,actor_membership_id,actor_auth_user_id,command,input_sha256,outcome,reason)
 VALUES(p_request_id,p_organization_id,t.id,actor.membership_id,actor.auth_user_id,p_action,fingerprint,result,p_reason);
 RETURN result;
END $$;

CREATE FUNCTION platform.create_university_form_template(p_organization_id UUID,p_template_id UUID,p_catalog_institution_id UUID,p_title TEXT,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'create',jsonb_build_object('catalogInstitutionId',p_catalog_institution_id,'title',p_title),p_expected_revision,p_reason,p_request_id)
$$;
CREATE FUNCTION platform.reserve_university_form_version(p_organization_id UUID,p_template_id UUID,p_sha256 TEXT,p_byte_size INTEGER,p_mime_type TEXT,p_source_reference TEXT,p_source_date DATE,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'reserve_version',jsonb_build_object('sha256',p_sha256,'byteSize',p_byte_size,'mimeType',p_mime_type,'sourceReference',p_source_reference,'sourceDate',p_source_date),p_expected_revision,p_reason,p_request_id)
$$;
CREATE FUNCTION platform.save_university_form_mapping(p_organization_id UUID,p_template_id UUID,p_mapping_id UUID,p_template_version_id UUID,p_template_sha256 TEXT,p_mappings JSONB,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'save_mapping',jsonb_build_object('mappingId',p_mapping_id,'templateVersionId',p_template_version_id,'templateSha256',p_template_sha256,'mappings',p_mappings),p_expected_revision,p_reason,p_request_id)
$$;
CREATE FUNCTION platform.review_university_form_mapping(p_organization_id UUID,p_template_id UUID,p_mapping_id UUID,p_mapping_sha256 TEXT,p_decision TEXT,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'review_mapping',jsonb_build_object('mappingId',p_mapping_id,'mappingSha256',p_mapping_sha256,'decision',p_decision),p_expected_revision,p_reason,p_request_id)
$$;
CREATE FUNCTION platform.publish_university_form_template(p_organization_id UUID,p_template_id UUID,p_mapping_id UUID,p_mapping_sha256 TEXT,p_review_id UUID,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'publish',jsonb_build_object('mappingId',p_mapping_id,'mappingSha256',p_mapping_sha256,'reviewId',p_review_id),p_expected_revision,p_reason,p_request_id)
$$;
CREATE FUNCTION platform.archive_university_form_template(p_organization_id UUID,p_template_id UUID,p_expected_revision BIGINT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.university_form_command(p_organization_id,p_template_id,'archive','{}'::JSONB,p_expected_revision,p_reason,p_request_id)
$$;

CREATE FUNCTION platform_private.university_form_current_publication(p_template platform_private.university_form_templates)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m platform_private.university_form_mapping_versions; r platform_private.university_form_mapping_reviews;
BEGIN
 IF p_template.archived_at IS NOT NULL OR p_template.published_mapping_id IS NULL OR NOT EXISTS(SELECT 1 FROM platform.catalog_institutions
 WHERE id=p_template.catalog_institution_id AND organization_id=p_template.organization_id AND source_revision=p_template.catalog_source_revision) THEN RETURN NULL; END IF;
 SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE id=p_template.published_mapping_id;
 SELECT * INTO r FROM platform_private.university_form_mapping_reviews WHERE mapping_id=m.id ORDER BY created_revision DESC LIMIT 1;
 IF r.id IS DISTINCT FROM p_template.published_review_id OR r.decision<>'approved' OR NOT platform_private.university_form_mapping_inspected(m) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('template_version_id',m.template_version_id,'template_sha256',m.template_sha256,
  'mapping_id',m.id,'mapping_sha256',m.sha256,'review_id',r.id,'reviewer_membership_id',r.reviewer_membership_id,'reviewed_at',r.created_at);
END $$;
CREATE FUNCTION platform.staff_university_form_workspace(p_template_id UUID,p_version_id UUID DEFAULT NULL,
 p_before_version BIGINT DEFAULT NULL,p_before_mapping BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t platform_private.university_form_templates; v platform_private.university_form_template_versions;
 publication JSONB; manage BOOLEAN; versions JSONB; mappings JSONB; selected JSONB; next_version BIGINT; next_mapping BIGINT;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 IF p_template_id IS NULL OR p_before_version NOT BETWEEN 1 AND 9007199254740991 OR p_before_mapping NOT BETWEEN 1 AND 9007199254740991 THEN
  RAISE EXCEPTION 'university_form_invalid_request' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM platform_private.university_form_templates WHERE id=p_template_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 manage:=platform_private.staff_can_access_for_actor(t.organization_id,'catalog.import.manage','organization',t.organization_id);
 IF NOT manage AND NOT platform_private.staff_can_access_for_actor(t.organization_id,'catalog.read','organization',t.organization_id) THEN
  RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 publication:=platform_private.university_form_current_publication(t);
 IF NOT manage AND (publication IS NULL OR (p_version_id IS NOT NULL AND p_version_id IS DISTINCT FROM (publication->>'template_version_id')::UUID)
  OR p_before_version IS NOT NULL OR p_before_mapping IS NOT NULL) THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM platform_private.university_form_template_versions WHERE template_id=t.id
  AND id=COALESCE(p_version_id,CASE WHEN NOT manage THEN (publication->>'template_version_id')::UUID ELSE NULL END)
  LIMIT 1;
 IF v.id IS NULL AND p_version_id IS NOT NULL THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 IF v.id IS NULL AND manage THEN SELECT * INTO v FROM platform_private.university_form_template_versions WHERE template_id=t.id ORDER BY created_revision DESC LIMIT 1; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'number',x.version_number,'revision',x.created_revision,'sha256',x.sha256,
  'byte_size',x.byte_size,'mime_type',x.mime_type,'created_at',x.created_at,'inspection',CASE WHEN platform_private.university_form_inspection_matches(x) THEN 'verified' ELSE 'pending' END) ORDER BY x.created_revision DESC),'[]'::JSONB),
  CASE WHEN count(*)=20 THEN min(x.created_revision) ELSE NULL END INTO versions,next_version
 FROM (SELECT * FROM platform_private.university_form_template_versions WHERE template_id=t.id AND (manage OR id=v.id)
  AND (p_before_version IS NULL OR created_revision<p_before_version) ORDER BY created_revision DESC LIMIT 20)x;
 IF v.id IS NOT NULL THEN
  selected:=jsonb_build_object('id',v.id,'number',v.version_number,'revision',v.created_revision,'sha256',v.sha256,'byte_size',v.byte_size,
   'mime_type',v.mime_type,'created_at',v.created_at,'inspection',CASE WHEN platform_private.university_form_inspection_matches(v) THEN 'verified' ELSE 'pending' END);
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'template_version_id',x.template_version_id,'template_sha256',x.template_sha256,
  'sha256',x.sha256,'revision',x.created_revision,'mappings',x.mappings,'created_at',x.created_at,'review',
  (SELECT jsonb_build_object('id',r.id,'decision',r.decision,'reviewer_membership_id',r.reviewer_membership_id,'reviewed_at',r.created_at,'revision',r.created_revision)
   FROM platform_private.university_form_mapping_reviews r WHERE r.mapping_id=x.id ORDER BY r.created_revision DESC LIMIT 1)) ORDER BY x.created_revision DESC),'[]'::JSONB),
  CASE WHEN count(*)=20 THEN min(x.created_revision) ELSE NULL END INTO mappings,next_mapping
 FROM (SELECT * FROM platform_private.university_form_mapping_versions WHERE template_id=t.id AND template_version_id=v.id
  AND (manage OR id=t.published_mapping_id) AND (p_before_mapping IS NULL OR created_revision<p_before_mapping) ORDER BY created_revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('schema_version',1,'template',jsonb_build_object('id',t.id,'organization_id',t.organization_id,
  'catalog_institution_id',t.catalog_institution_id,'catalog_source_revision',t.catalog_source_revision,'title',t.title,'revision',t.revision,'archived',t.archived_at IS NOT NULL),
  'can_manage',manage AND t.archived_at IS NULL,'publication',publication,'selected_version',selected,'versions',versions,'mappings',mappings,
  'next_version_before',next_version,'next_mapping_before',next_mapping);
END $$;
CREATE FUNCTION platform.staff_published_university_forms(p_catalog_institution_id UUID,p_after_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; items JSONB; next_id UUID;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 SELECT organization_id INTO org FROM platform.catalog_institutions WHERE id=p_catalog_institution_id;
 IF NOT FOUND OR NOT platform_private.staff_can_access_for_actor(org,'catalog.read','organization',org) THEN
  RAISE EXCEPTION 'university_form_forbidden' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'revision',x.revision,'publication',x.publication) ORDER BY x.id),'[]'::JSONB),
  CASE WHEN count(*)=20 THEN (array_agg(x.id ORDER BY x.id DESC))[1] ELSE NULL END INTO items,next_id
 FROM (SELECT t.id,t.title,t.revision,platform_private.university_form_current_publication(t) publication
 FROM platform_private.university_form_templates t WHERE t.organization_id=org AND t.catalog_institution_id=p_catalog_institution_id
 AND (p_after_id IS NULL OR t.id>p_after_id) AND platform_private.university_form_current_publication(t) IS NOT NULL ORDER BY t.id LIMIT 20)x;
 RETURN jsonb_build_object('schema_version',1,'catalog_institution_id',p_catalog_institution_id,'items',items,'next_after_id',next_id);
END $$;

DO $$DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::REGPROCEDURE signature,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='platform_private' AND p.proname LIKE 'university_form_%') OR (n.nspname='platform' AND p.proname IN (
 'create_university_form_template','reserve_university_form_version','save_university_form_mapping','review_university_form_mapping',
 'publish_university_form_template','archive_university_form_template','staff_university_form_workspace','staff_published_university_forms')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',f.signature);
  IF f.nspname='platform' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;
COMMENT ON TABLE platform_private.university_form_inspection_receipts IS
 'No runtime writer in165. The later real ClamAV + hard-isolated D4 template ingress must install its reviewed trusted writer; D3 source inspection is not eligible.';
COMMENT ON TABLE platform_private.university_form_template_versions IS
 'Declared immutable source metadata only. Reservation is not upload, scan, inspection, renderer or publication proof.';
COMMIT;
