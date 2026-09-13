\set ON_ERROR_STOP on
-- Synthetic PostgreSQL constraints/authentication proof ONLY. Owner-created
-- ClamAV/native observations and storage.objects metadata are not actual bytes,
-- scanning, native isolation, Storage service or production acceptance.
BEGIN;
CREATE FUNCTION pg_temp.ui_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
 SELECT ('65166000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.ui_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Ingress SQL: %',message; END IF; END $$;
CREATE TEMP TABLE ui_context(key TEXT PRIMARY KEY,value JSONB NOT NULL);
CREATE FUNCTION pg_temp.ui_rpc(p_role TEXT,p_claims JSONB,p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE previous_role TEXT:=current_setting('role'); previous_claims TEXT:=current_setting('request.jwt.claims',TRUE); result JSONB;
BEGIN
 PERFORM set_config('request.jwt.claims',p_claims::TEXT,TRUE);
 PERFORM set_config('role',p_role,TRUE);
 EXECUTE p_sql INTO result;
 PERFORM set_config('role',previous_role,TRUE);
 PERFORM set_config('request.jwt.claims',COALESCE(previous_claims,''),TRUE);
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.ui_staff(p_sql TEXT,p_actor INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_rpc('authenticated',(SELECT value FROM ui_context WHERE key='actor'||p_actor),p_sql)
$$;
CREATE FUNCTION pg_temp.ui_service(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_rpc('service_role','{"role":"service_role"}',p_sql)
$$;
CREATE FUNCTION pg_temp.ui_error(p_sql TEXT,p_actor INTEGER DEFAULT 1) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
 IF p_actor=0 THEN PERFORM pg_temp.ui_service(p_sql);
 ELSIF p_actor=-1 THEN PERFORM pg_temp.ui_rpc('anon','{"role":"anon"}',p_sql);
 ELSE PERFORM pg_temp.ui_staff(p_sql,p_actor); END IF;
 RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.ui_owner_error(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
INSERT INTO platform.organizations(id,name) VALUES(pg_temp.ui_id(1),'Synthetic ingress organization'),(pg_temp.ui_id(2),'Other synthetic ingress organization');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.ui_id(100+n),'template-ingress-'||n||'@example.invalid','{}'::JSONB FROM generate_series(1,4)n;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
 SELECT pg_temp.ui_id(200+n),pg_temp.ui_id(100+n),'Synthetic template staff '||n,'active',1 FROM generate_series(1,4)n;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
 SELECT pg_temp.ui_id(300+n),pg_temp.ui_id(CASE WHEN n=4 THEN 2 ELSE 1 END),pg_temp.ui_id(200+n),'active',
  CASE WHEN n=3 THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END,
  (SELECT id FROM platform.role_bundle_versions WHERE role=CASE WHEN n=3 THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END
   AND status='published' ORDER BY version DESC LIMIT 1),n<>3 FROM generate_series(1,4)n;
INSERT INTO ui_context SELECT 'actor'||n,platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.ui_id(100+n),
 'claims',jsonb_build_object('sub',pg_temp.ui_id(100+n),'role','authenticated')))->'claims' FROM generate_series(1,4)n;
-- Real existing source/catalog command surface, isolated synthetic identities.
DO $$DECLARE source UUID; batch UUID; BEGIN
 source:=(pg_temp.ui_staff(format('SELECT to_jsonb(platform.register_workflow_source(%L,%L,%L,%L,%L,%L,%L))',pg_temp.ui_id(1),
  'src_ffffffffffffffffffffffffffffffff','google_spreadsheet','https://docs.google.com/spreadsheets/d/1IngressSynthetic000000000/edit',
  'ingress-source-v1','Synthetic source',pg_temp.ui_id(700)))#>>'{}')::UUID;
 PERFORM pg_temp.ui_staff(format('SELECT to_jsonb(platform.review_workflow_source(%L,%L,%L,%L,%L))',pg_temp.ui_id(1),source,'reviewed','Synthetic review',pg_temp.ui_id(701)));
 batch:=(pg_temp.ui_staff(format('SELECT platform.create_catalog_import_batch(%L,%L,%L,%L,%L)',pg_temp.ui_id(1),source,'university','Synthetic batch',pg_temp.ui_id(702)))->>'catalog_import_batch_id')::UUID;
 PERFORM pg_temp.ui_staff(format('SELECT to_jsonb(platform.stage_catalog_import_candidate(%L,%L,%L,%L,%L,%L,%L,%L))',pg_temp.ui_id(1),batch,
  'rec_ffffffffffffffffffffffffffffffff','Synthetic Ingress University','MY','Synthetic city','Synthetic candidate',pg_temp.ui_id(703)));
 PERFORM pg_temp.ui_staff(format('SELECT to_jsonb(platform.validate_catalog_import_batch(%L,%L,%L,%L))',pg_temp.ui_id(1),batch,'Synthetic validation',pg_temp.ui_id(704)));
 PERFORM pg_temp.ui_staff(format('SELECT to_jsonb(platform.review_catalog_import_batch(%L,%L,%L,%L,%L))',pg_temp.ui_id(1),batch,'approve','Synthetic approval',pg_temp.ui_id(705)));
 INSERT INTO ui_context SELECT 'catalog',to_jsonb(id) FROM platform.catalog_institutions WHERE organization_id=pg_temp.ui_id(1);
END $$;
-- This is local metadata setup, never a managed bucket apply.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('platform-document-templates','platform-document-templates',FALSE,20971520,ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

CREATE FUNCTION pg_temp.ui_prepare(n INTEGER,p_mime TEXT DEFAULT 'application/pdf') RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE template UUID:=pg_temp.ui_id(10000+n); version UUID; result JSONB;
BEGIN
 PERFORM pg_temp.ui_staff(format('SELECT platform.create_university_form_template(%L,%L,%L,%L,0,%L,%L)',pg_temp.ui_id(1),template,
  (SELECT value#>>'{}' FROM ui_context WHERE key='catalog'),'Synthetic template '||n,'Create synthetic',pg_temp.ui_id(20000+n)));
 version:=(pg_temp.ui_staff(format('SELECT platform.reserve_university_form_version(%L,%L,%L,128,%L,%L,%L,1,%L,%L)',pg_temp.ui_id(1),template,
  repeat('a',64),p_mime,'Synthetic public blank','2026-09-14','Reserve synthetic',pg_temp.ui_id(30000+n)))->>'target_id')::UUID;
 result:=pg_temp.ui_staff(format('SELECT platform.prepare_university_template_ingress(%L,%L,2,%L)',template,version,pg_temp.ui_id(40000+n)));
 RETURN result->'receipt';
END $$;
CREATE FUNCTION pg_temp.ui_begin(a UUID) RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_service(format('SELECT platform.begin_university_template_ingress(%L,%L,%L)',a,pg_temp.ui_id(101),pg_temp.ui_id(301)))
$$;
CREATE FUNCTION pg_temp.ui_proof() RETURNS JSONB LANGUAGE SQL AS $$
 SELECT jsonb_build_object('engine','ClamAV','engineVersion','1.4.3','signatureVersion','synthetic-123','protocol','clamd-zinstream-v1',
  'scannedAt',clock_timestamp(),'sha256Hex',repeat('a',64))
$$;
CREATE FUNCTION pg_temp.ui_seal(a UUID,claim UUID,p_manifest JSONB DEFAULT '{"format":"pdf","slots":[],"pageSizes":[{"width":600,"height":800}]}') RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_service(format('SELECT platform.seal_university_template_ingress(%L,%L,%L,%L,%L,%L,%L)',a,claim,pg_temp.ui_proof(),
  'sha256:'||repeat('b',64),'evo-university-template-v1',repeat('c',40),p_manifest))
$$;
CREATE FUNCTION pg_temp.ui_object(a UUID) RETURNS VOID LANGUAGE SQL AS $$
 INSERT INTO storage.objects(bucket_id,name,metadata) SELECT bucket_id,object_name,jsonb_build_object('size',byte_size,'mimetype',mime_type)
 FROM platform_private.university_template_ingresses WHERE id=a
$$;
CREATE FUNCTION pg_temp.ui_complete(a UUID,claim UUID,p_hash TEXT DEFAULT repeat('a',64),p_bytes BIGINT DEFAULT 128,p_mime TEXT DEFAULT 'application/pdf') RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_service(format('SELECT platform.complete_university_template_ingress(%L,%L,%L,NULL,%L,%L,%L)',a,claim,'verified',p_hash,p_bytes,p_mime))
$$;
CREATE FUNCTION pg_temp.ui_grant(a JSONB,n INTEGER,p_intent TEXT DEFAULT 'read',p_revision BIGINT DEFAULT 3,p_actor INTEGER DEFAULT 1) RETURNS UUID LANGUAGE SQL AS $$
 SELECT (pg_temp.ui_staff(format('SELECT platform.prepare_university_template_source_access(%L,%L,%L,%L,%L,%L)',a->>'template_id',a->>'template_version_id',
  p_revision,p_intent,pg_temp.ui_id(n),'Synthetic source access'),p_actor)->>'grant_id')::UUID
$$;
CREATE FUNCTION pg_temp.ui_consume(g UUID,p_actor INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_service(format('SELECT platform.consume_university_template_source_access(%L,%L,%L)',g,pg_temp.ui_id(100+p_actor),pg_temp.ui_id(300+p_actor)))
$$;
CREATE FUNCTION pg_temp.ui_read_complete(g UUID,p_missing BOOLEAN DEFAULT FALSE) RETURNS JSONB LANGUAGE SQL AS $$
 SELECT pg_temp.ui_service(format('SELECT platform.complete_university_template_source_access(%L,%L,%L,%L,%L)',g,
  CASE WHEN NOT p_missing THEN repeat('a',64) END,CASE WHEN NOT p_missing THEN 128 END,CASE WHEN NOT p_missing THEN 'application/pdf' END,p_missing))
$$;

DO $$DECLARE role_name TEXT; table_name TEXT; signature TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
  FOREACH table_name IN ARRAY ARRAY['university_template_ingresses','university_template_source_grants','university_template_ingress_requests','university_template_ingress_events','university_form_inspection_receipts'] LOOP
   PERFORM pg_temp.ui_assert(NOT has_table_privilege(role_name,'platform_private.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),role_name||' cannot access '||table_name);
  END LOOP;
 END LOOP;
 FOR signature IN SELECT p.oid::REGPROCEDURE::TEXT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='platform_private' AND p.proname LIKE 'university_ingress_%' LOOP
  PERFORM pg_temp.ui_assert(NOT has_function_privilege('authenticated',signature,'EXECUTE') AND NOT has_function_privilege('service_role',signature,'EXECUTE'),
   'private helper is inaccessible '||signature);
 END LOOP;
END $$;

DO $$DECLARE a JSONB; b JSONB; result JSONB; attempt UUID; claim UUID; grant_id UUID; proof JSONB; n INTEGER; item TEXT; t UUID; version UUID; mapping JSONB;
BEGIN
 a:=pg_temp.ui_prepare(1); attempt:=(a->>'ingress_id')::UUID; t:=(a->>'template_id')::UUID; version:=(a->>'template_version_id')::UUID;
 PERFORM pg_temp.ui_assert(platform_private.university_form_exact_keys(a,ARRAY['schema_version','ingress_id','template_id','template_version_id','request_id','revision','state',
  'sha256','byte_size','inspection_receipt_id','failure_code','replayed','can_reconcile','can_cancel']),'receipt exact public keys');
 PERFORM pg_temp.ui_assert(a->>'state'='prepared' AND a->'inspection_receipt_id'='null'::JSONB,'prepare is not verified');
 result:=pg_temp.ui_staff(format('SELECT platform.prepare_university_template_ingress(%L,%L,2,%L)',t,version,pg_temp.ui_id(40001)));
 PERFORM pg_temp.ui_assert(result->'receipt'->>'replayed'='true','prepare exact replay');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_ingress(%L,%L,3,%L)',t,version,pg_temp.ui_id(40001)))='23505','changed replay conflicts');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_ingress(%L,%L,2,%L)',t,version,pg_temp.ui_id(49999)))='23505','one attempt per version');
 FOREACH n IN ARRAY ARRAY[-1,0,3,4] LOOP
  PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_ingress(%L,%L,2,%L)',t,version,pg_temp.ui_id(49000+n)),n)='42501','prepare authorization boundary');
 END LOOP;
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.begin_university_template_ingress(%L,%L,%L)',attempt,pg_temp.ui_id(101),pg_temp.ui_id(301)))='42501','browser cannot begin');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.begin_university_template_ingress(%L,%L,%L)',attempt,pg_temp.ui_id(102),pg_temp.ui_id(302)),0)='42501','service cannot substitute actor');
 b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
 PERFORM pg_temp.ui_assert(b->'receipt'->>'state'='processing' AND claim IS NOT NULL,'first begin has claim');
 PERFORM pg_temp.ui_assert(platform_private.university_form_exact_keys(b->'source',ARRAY['organization_id','catalog_institution_id','catalog_source_revision','template_id',
  'template_version_id','expected_revision','sha256','byte_size','mime_type','bucket_id','object_name']),'internal source exact keys');
 result:=pg_temp.ui_begin(attempt);
 PERFORM pg_temp.ui_assert(result->'claim_token'='null'::JSONB AND result->'source'='null'::JSONB,'duplicate begin cannot reacquire bytes');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.seal_university_template_ingress(%L,%L,%L,%L,%L,%L,%L)',attempt,pg_temp.ui_id(999),pg_temp.ui_proof(),
  'sha256:'||repeat('b',64),'evo-university-template-v1',repeat('c',40),'{"format":"pdf","slots":[],"pageSizes":[{"width":600,"height":800}]}'),0)='42501','wrong claim fails');
 FOR n IN 1..5 LOOP
  proof:=pg_temp.ui_proof();
  proof:=CASE n WHEN 1 THEN proof||'{"sha256Hex":"wrong"}' WHEN 2 THEN proof||'{"engine":"browser"}'
   WHEN 3 THEN proof||'{"extra":true}' WHEN 4 THEN proof||'{"scannedAt":"1900-01-01T00:00:00Z"}' ELSE proof||'{"signatureVersion":null}' END;
  PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.seal_university_template_ingress(%L,%L,%L,%L,%L,%L,%L)',attempt,claim,proof,
   'sha256:'||repeat('b',64),'evo-university-template-v1',repeat('c',40),'{"format":"pdf","slots":[],"pageSizes":[{"width":600,"height":800}]}'),0)='22023','invalid scan evidence rejected');
 END LOOP;
 result:=pg_temp.ui_seal(attempt,claim);
 PERFORM pg_temp.ui_assert(result->'receipt'->>'state'='sealed' AND NOT EXISTS(SELECT 1 FROM platform_private.university_form_inspection_receipts WHERE template_version_id=version),
  'seal alone creates no inspection receipt');
 PERFORM pg_temp.ui_object(attempt);
 result:=pg_temp.ui_complete(attempt,claim);
 PERFORM pg_temp.ui_assert(result->>'state'='verified' AND result->>'revision'='3' AND result->>'inspection_receipt_id' IS NOT NULL,'exact observation and metadata finalize once');
 PERFORM pg_temp.ui_assert(pg_temp.ui_complete(attempt,claim)->>'replayed'='true','exact completion replay');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.complete_university_template_ingress(%L,%L,%L,NULL,%L,127,%L)',attempt,claim,'verified',repeat('a',64),'application/pdf'),0)='23505','completion changed input conflicts');
 PERFORM pg_temp.ui_assert(pg_temp.ui_owner_error(format('UPDATE platform_private.university_form_inspection_receipts SET source_sha256=%L WHERE template_version_id=%L',repeat('d',64),version))='55000','165 receipt immutable even to owner');
 PERFORM pg_temp.ui_assert(pg_temp.ui_owner_error(format('UPDATE platform_private.university_template_ingresses SET object_name=%L WHERE id=%L','changed',attempt))='55000','source binding immutable');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_source_access(%L,%L,3,%L,%L,%L)',t,version,'read',pg_temp.ui_id(60000),'Synthetic read'),3)='42501','manager-only source grant');
 grant_id:=pg_temp.ui_grant(a,60001); result:=pg_temp.ui_consume(grant_id);
 PERFORM pg_temp.ui_assert(result->'source'->>'expected_revision'='3','read grant binds current revision');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.consume_university_template_source_access(%L,%L,%L)',grant_id,pg_temp.ui_id(101),pg_temp.ui_id(301)),0)='42501','grant consumes once');
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='true','exact read permitted');
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='false','completion replay cannot release bytes twice');
 -- Legitimate subsequent mapping increments revision; fresh source reads still work.
 mapping:='[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":1,"y":1,"width":30,"height":12}}]';
 PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,3,%L,%L)',pg_temp.ui_id(1),t,pg_temp.ui_id(61001),version,repeat('a',64),mapping,'Synthetic mapping',pg_temp.ui_id(62001)));
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_ingress(%L,%L,2,%L)',t,version,pg_temp.ui_id(40001)))='55000','old ingress replay fenced after mapping');
 grant_id:=pg_temp.ui_grant(a,60002,'read',4); PERFORM pg_temp.ui_consume(grant_id);
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='true','fresh read after mapping permitted');
 -- Manager2 retains access to verified source after original uploader revocation.
 grant_id:=pg_temp.ui_grant(a,60003,'read',4,2); PERFORM pg_temp.ui_consume(grant_id,2);
 UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.ui_id(201);
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='true','new manager uses own grant, immutable proof survives uploader change');
 grant_id:=pg_temp.ui_grant(a,60004,'read',4,2); PERFORM pg_temp.ui_consume(grant_id,2);
 UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.ui_id(202);
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='false','grant actor revoke-restore fence');
 -- A grant cannot survive a later template revision.
 grant_id:=pg_temp.ui_grant(a,60005,'read',4); PERFORM pg_temp.ui_consume(grant_id);
 PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,4,%L,%L)',pg_temp.ui_id(1),t,pg_temp.ui_id(61002),version,repeat('a',64),mapping,'Another mapping',pg_temp.ui_id(62002)));
 PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(grant_id)->>'permitted'='false','read completion rechecks template revision');
 INSERT INTO ui_context VALUES('verified',a);
END $$;

-- Outcome matrix: exact bytes and independent Storage metadata must both match.
DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; result JSONB; n INTEGER; BEGIN
 FOR n IN 2..7 LOOP
  a:=pg_temp.ui_prepare(n); attempt:=(a->>'ingress_id')::UUID; b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
  PERFORM pg_temp.ui_seal(attempt,claim);
  IF n<>7 THEN PERFORM pg_temp.ui_object(attempt); END IF;
  IF n=5 THEN UPDATE storage.objects SET metadata=metadata||'{"size":127}' WHERE name=(SELECT object_name FROM platform_private.university_template_ingresses WHERE id=attempt); END IF;
  IF n=6 THEN UPDATE storage.objects SET metadata=metadata||'{"mimetype":"text/plain"}' WHERE name=(SELECT object_name FROM platform_private.university_template_ingresses WHERE id=attempt); END IF;
  result:=pg_temp.ui_complete(attempt,claim,CASE WHEN n=2 THEN repeat('d',64) ELSE repeat('a',64) END,CASE WHEN n=3 THEN 127 ELSE 128 END,CASE WHEN n=4 THEN 'text/plain' ELSE 'application/pdf' END);
  PERFORM pg_temp.ui_assert(result->>'state'='failed' AND result->>'failure_code'='integrity_failed','hash/size/MIME/Storage mismatch fails');
  PERFORM pg_temp.ui_assert(NOT EXISTS(SELECT 1 FROM platform_private.university_form_inspection_receipts WHERE template_version_id=(a->>'template_version_id')::UUID),'no receipt after mismatch');
 END LOOP;
END $$;

DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; g UUID; result JSONB; n INTEGER; BEGIN
 FOR n IN 10..14 LOOP
  a:=pg_temp.ui_prepare(n); attempt:=(a->>'ingress_id')::UUID; b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
  PERFORM pg_temp.ui_seal(attempt,claim);
  IF n<>12 THEN PERFORM pg_temp.ui_object(attempt); END IF;
  result:=pg_temp.ui_service(format('SELECT platform.complete_university_template_ingress(%L,%L,%L,%L,NULL,NULL,NULL)',attempt,claim,'unknown','storage_unavailable'));
  PERFORM pg_temp.ui_assert(result->>'state'='unknown' AND result->>'can_reconcile'='true','ambiguous write remains unknown');
  IF n=10 THEN
   result:=pg_temp.ui_staff(format('SELECT platform.cancel_university_template_ingress(%L,%L,2,%L,%L)',a->>'template_id',a->>'template_version_id','Cancel synthetic',pg_temp.ui_id(65010)));
   PERFORM pg_temp.ui_assert(result->>'state'='cancelled','persistent cancellation fence');
   PERFORM pg_temp.ui_assert(pg_temp.ui_staff(format('SELECT platform.cancel_university_template_ingress(%L,%L,2,%L,%L)',a->>'template_id',a->>'template_version_id','Cancel synthetic',pg_temp.ui_id(65010)))->>'replayed'='true','cancel replay');
   PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_source_access(%L,%L,2,%L,%L,%L)',a->>'template_id',a->>'template_version_id','reconcile',pg_temp.ui_id(66010),'Reconcile cancelled'))='42501','cancelled cannot reconcile');
  ELSE
   g:=pg_temp.ui_grant(a,66000+n,'reconcile',2); PERFORM pg_temp.ui_consume(g);
   IF n=13 THEN UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.ui_id(201); END IF;
   IF n=14 THEN
    PERFORM pg_temp.ui_staff(format('SELECT platform.archive_university_form_template(%L,%L,2,%L,%L)',pg_temp.ui_id(1),a->>'template_id','Archive during I/O',pg_temp.ui_id(67014)));
   END IF;
   result:=pg_temp.ui_read_complete(g,n=12);
   PERFORM pg_temp.ui_assert(result->>'permitted'=CASE WHEN n=11 THEN 'true' ELSE 'false' END,'reconciliation verifies exact source or denies');
   PERFORM pg_temp.ui_assert(result->'receipt'->>'state'=CASE WHEN n=11 THEN 'verified' ELSE 'failed' END,'reconciliation terminal state');
   IF n=11 THEN
    PERFORM pg_temp.ui_assert(pg_temp.ui_grant(a,66011,'reconcile',2)=g,'successful reconcile replays same consumed grant at its own verified revision');
    PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_source_access(%L,%L,3,%L,%L,%L)',a->>'template_id',a->>'template_version_id',
     'reconcile',pg_temp.ui_id(66011),'Synthetic source access'))='23505','changed reconcile request conflicts');
    PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,3,%L,%L)',pg_temp.ui_id(1),a->>'template_id',pg_temp.ui_id(76111),a->>'template_version_id',repeat('a',64),
     '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":0,"y":0,"width":30,"height":12}}]',
     'Mutation after reconciliation',pg_temp.ui_id(77111)));
    PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.prepare_university_template_source_access(%L,%L,2,%L,%L,%L)',a->>'template_id',a->>'template_version_id',
     'reconcile',pg_temp.ui_id(66011),'Synthetic source access'))='55000','later mutation fences successful reconcile replay');
   END IF;
   IF n=12 THEN PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='storage_missing','missing Storage explicit failure'); END IF;
   IF n=13 THEN PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='access_changed','original actor access-version fence'); END IF;
   IF n=14 THEN PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='archived','archive fence'); END IF;
  END IF;
 END LOOP;
END $$;

-- Owner-only clock/race setup is explicit; no wall-clock or provider claim.
DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; g UUID; result JSONB; n INTEGER; BEGIN
 FOR n IN 20..22 LOOP
  a:=pg_temp.ui_prepare(n); attempt:=(a->>'ingress_id')::UUID; b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
  IF n<>20 THEN PERFORM pg_temp.ui_seal(attempt,claim); END IF;
  ALTER TABLE platform_private.university_template_ingresses DISABLE TRIGGER university_ingress_guard;
  UPDATE platform_private.university_template_ingresses x SET begun_at=begun_at-INTERVAL '3 minutes',expires_at=expires_at-INTERVAL '3 minutes' WHERE x.id=attempt;
  ALTER TABLE platform_private.university_template_ingresses ENABLE TRIGGER university_ingress_guard;
  result:=pg_temp.ui_begin(attempt);
  PERFORM pg_temp.ui_assert(result->'claim_token'='null'::JSONB AND result->'receipt'->>'state'=CASE WHEN n=20 THEN 'failed' ELSE 'unknown' END,'expired worker cannot reacquire claim');
  IF n=21 THEN
   PERFORM pg_temp.ui_object(attempt); g:=pg_temp.ui_grant(a,68021,'reconcile',2); PERFORM pg_temp.ui_consume(g);
   PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(g)->'receipt'->>'state'='verified','expired sealed attempt explicitly reconciles');
  ELSIF n=22 THEN
   g:=pg_temp.ui_grant(a,68022,'reconcile',2); PERFORM pg_temp.ui_consume(g);
   ALTER TABLE platform_private.university_template_source_grants DISABLE TRIGGER university_source_grant_guard;
   UPDATE platform_private.university_template_source_grants SET created_at=created_at-INTERVAL '2 minutes',expires_at=expires_at-INTERVAL '2 minutes' WHERE id=g;
   ALTER TABLE platform_private.university_template_source_grants ENABLE TRIGGER university_source_grant_guard;
   PERFORM pg_temp.ui_assert(pg_temp.ui_read_complete(g)->>'permitted'='false','expired source grant never releases bytes');
  END IF;
 END LOOP;
END $$;

-- Forward PDF rules: actual inspector slots=[]; rectangles/manual flags are human-defined.
DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; mapping JSONB; m platform_private.university_form_mapping_versions; n INTEGER; BEGIN
 PERFORM pg_temp.ui_assert(platform_private.university_form_manifest_valid('{"format":"pdf","slots":[],"pageSizes":[{"width":600,"height":800}]}','application/pdf'),'real passive PDF manifest');
 PERFORM pg_temp.ui_assert(NOT platform_private.university_form_manifest_valid('{"format":"pdf","slots":[{"id":"pdf-1","editable":true}],"pageSizes":[{"width":600,"height":800}]}','application/pdf'),'no fabricated PDF slots');
 a:=pg_temp.ui_prepare(30); attempt:=(a->>'ingress_id')::UUID; b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
 PERFORM pg_temp.ui_seal(attempt,claim); PERFORM pg_temp.ui_object(attempt); PERFORM pg_temp.ui_complete(attempt,claim);
 FOR n IN 1..4 LOOP
  mapping:=jsonb_build_array(jsonb_build_object('slotId','pdf-1','sourceKey',CASE WHEN n=4 THEN NULL ELSE 'student_first_name' END,
   'required',TRUE,'format','text','manual',n=4,'position',jsonb_build_object('page',CASE WHEN n=2 THEN 2 ELSE 1 END,'x',CASE WHEN n=1 THEN 590 ELSE 1 END,'y',1,'width',30,'height',12)));
  IF n=3 THEN mapping:=mapping||jsonb_build_array((mapping->0)||'{"slotId":"pdf-2"}'); END IF;
  PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,%L,%L,%L)',pg_temp.ui_id(1),a->>'template_id',pg_temp.ui_id(70000+n),a->>'template_version_id',
   repeat('a',64),mapping,2+n,'Synthetic PDF mapping',pg_temp.ui_id(71000+n)));
  SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE id=pg_temp.ui_id(70000+n);
  PERFORM pg_temp.ui_assert(platform_private.university_form_mapping_inspected(m)=(n=4),'PDF outside page/absent page/overlap fail; human manual succeeds');
 END LOOP;
 a:=pg_temp.ui_prepare(31,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); attempt:=(a->>'ingress_id')::UUID;
 b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
 PERFORM pg_temp.ui_seal(attempt,claim,'{"format":"docx","slots":[{"id":"p-1","editable":true},{"id":"p-2","editable":false}],"pageSizes":[]}');
 PERFORM pg_temp.ui_object(attempt); PERFORM pg_temp.ui_complete(attempt,claim,repeat('a',64),128,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 FOR n IN 1..3 LOOP
  mapping:=jsonb_build_array(jsonb_build_object('slotId',CASE WHEN n=1 THEN 'p-99' ELSE 'p-2' END,'sourceKey',CASE WHEN n=3 THEN NULL ELSE 'student_first_name' END,
   'required',TRUE,'format','text','manual',n=3));
  PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,%L,%L,%L)',pg_temp.ui_id(1),a->>'template_id',pg_temp.ui_id(72000+n),a->>'template_version_id',
   repeat('a',64),mapping,2+n,'Synthetic DOCX mapping',pg_temp.ui_id(73000+n)));
  SELECT * INTO m FROM platform_private.university_form_mapping_versions WHERE id=pg_temp.ui_id(72000+n);
  PERFORM pg_temp.ui_assert(platform_private.university_form_mapping_inspected(m)=(n=3),'DOCX actual slots and manual-only flag preserved');
 END LOOP;
END $$;

-- Live permission/revision/cancellation checks between distinct RPC transactions.
DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; result JSONB; n INTEGER; old_source TEXT; BEGIN
 FOR n IN 40..44 LOOP
  a:=pg_temp.ui_prepare(n); attempt:=(a->>'ingress_id')::UUID;
  IF n=40 THEN
   UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.ui_id(201);
   result:=pg_temp.ui_begin(attempt);
   PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='access_changed' AND result->'claim_token'='null'::JSONB,'live actor change before begin denies claim');
  ELSE
   b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
   IF n=41 THEN
    PERFORM pg_temp.ui_staff(format('SELECT platform.save_university_form_mapping(%L,%L,%L,%L,%L,%L,2,%L,%L)',pg_temp.ui_id(1),a->>'template_id',pg_temp.ui_id(74041),a->>'template_version_id',repeat('a',64),
     '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":0,"y":0,"width":30,"height":12}}]',
     'Race revision',pg_temp.ui_id(75041)));
    result:=pg_temp.ui_seal(attempt,claim);
    PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='stale_revision' AND result->'source'='null'::JSONB,'template mutation fences seal');
   ELSIF n=42 THEN
    PERFORM pg_temp.ui_staff(format('SELECT platform.cancel_university_template_ingress(%L,%L,2,%L,%L)',a->>'template_id',a->>'template_version_id','Cancel during inspection',pg_temp.ui_id(75042)));
    result:=pg_temp.ui_seal(attempt,claim);
    PERFORM pg_temp.ui_assert(result->'receipt'->>'state'='cancelled' AND result->'source'='null'::JSONB,'cancel prevents late seal');
    PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.complete_university_template_ingress(%L,%L,%L,NULL,%L,128,%L)',attempt,claim,'verified',repeat('a',64),'application/pdf'),0)='55000','cancel prevents late completion');
   ELSIF n=43 THEN
    -- Catalog/batch/candidate provenance is itself immutable and FK-bound. Leave
    -- those constraints intact. Owner-only setup makes the cached template
    -- provenance stale, exercising the same live catalog/source comparison.
    -- The exact user guard and original value are restored immediately.
    SELECT catalog_source_revision INTO old_source FROM platform_private.university_form_templates WHERE id=(a->>'template_id')::UUID;
    ALTER TABLE platform_private.university_form_templates DISABLE TRIGGER university_form_template_update;
    UPDATE platform_private.university_form_templates SET catalog_source_revision='synthetic-other-revision' WHERE id=(a->>'template_id')::UUID;
    result:=pg_temp.ui_seal(attempt,claim);
    UPDATE platform_private.university_form_templates SET catalog_source_revision=old_source WHERE id=(a->>'template_id')::UUID;
    ALTER TABLE platform_private.university_form_templates ENABLE TRIGGER university_form_template_update;
    PERFORM pg_temp.ui_assert(result->'receipt'->>'failure_code'='source_changed' AND result->'source'='null'::JSONB,'stale catalog provenance fences seal');
   ELSE
    PERFORM pg_temp.ui_seal(attempt,claim); PERFORM pg_temp.ui_object(attempt);
    PERFORM pg_temp.ui_staff(format('SELECT platform.archive_university_form_template(%L,%L,2,%L,%L)',pg_temp.ui_id(1),a->>'template_id','Archive before completion',pg_temp.ui_id(75044)));
    result:=pg_temp.ui_complete(attempt,claim);
    PERFORM pg_temp.ui_assert(result->>'state'='failed' AND result->>'failure_code'='archived','archive fences verified completion');
   END IF;
  END IF;
 END LOOP;
 FOR n IN -1..1 LOOP
  PERFORM pg_temp.ui_assert(pg_temp.ui_error('INSERT INTO platform_private.university_form_inspection_receipts DEFAULT VALUES RETURNING ''{}''::JSONB',n)='42501','runtime cannot directly insert trusted receipt');
  PERFORM pg_temp.ui_assert(pg_temp.ui_error('INSERT INTO platform_private.university_template_ingresses DEFAULT VALUES RETURNING ''{}''::JSONB',n)='42501','runtime cannot directly insert attempt');
 END LOOP;
 PERFORM pg_temp.ui_assert(pg_temp.ui_staff('SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id=''platform-document-templates''')='0'::JSONB,'browser has no direct private template Storage read');
END $$;

DO $$DECLARE listing JSONB; page2 JSONB; inspection JSONB; a JSONB; BEGIN
 listing:=pg_temp.ui_staff(format('SELECT platform.staff_university_form_manager_templates(%L)',(SELECT value#>>'{}' FROM ui_context WHERE key='catalog')));
 PERFORM pg_temp.ui_assert(jsonb_array_length(listing->'items')=20 AND listing->>'next_after_id' IS NOT NULL,'manager list has20-item keyset page');
 page2:=pg_temp.ui_staff(format('SELECT platform.staff_university_form_manager_templates(%L,%L)',(SELECT value#>>'{}' FROM ui_context WHERE key='catalog'),listing->>'next_after_id'));
 PERFORM pg_temp.ui_assert(jsonb_array_length(page2->'items')=2 AND page2->'next_after_id'='null'::JSONB,'manager list includes remaining unpublished and archived');
 a:=(SELECT value FROM ui_context WHERE key='verified');
 inspection:=pg_temp.ui_staff(format('SELECT platform.staff_university_template_inspection(%L,%L)',a->>'template_id',a->>'template_version_id'));
 PERFORM pg_temp.ui_assert(inspection->>'inspection'='verified' AND NOT (inspection ?| ARRAY['object_name','bucket_id','scan_proof','inspector_image_id','runtime_revision']),
  'safe inspection DTO excludes private source/proof');
 PERFORM pg_temp.ui_assert(pg_temp.ui_error(format('SELECT platform.staff_university_template_inspection(%L,%L)',a->>'template_id',a->>'template_version_id'),3)='42501','inspection manager only');
 PERFORM pg_temp.ui_assert(pg_temp.ui_owner_error('UPDATE platform_private.university_template_ingress_events SET event_kind=''changed''')='55000','outcome events immutable');
END $$;
-- Reviewed native DOCX output and the public DTO require ordered nonempty p-1…p-N.
-- Invalid seals must roll back without sealing the claim or creating a receipt.
DO $$DECLARE a JSONB; b JSONB; attempt UUID; claim UUID; manifest JSONB; rejected BOOLEAN; before_count BIGINT; result JSONB;
BEGIN
 a:=pg_temp.ui_prepare(91,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 attempt:=(a->>'ingress_id')::UUID; b:=pg_temp.ui_begin(attempt); claim:=(b->>'claim_token')::UUID;
 SELECT count(*) INTO before_count FROM platform_private.university_form_inspection_receipts;
 FOR manifest IN SELECT value FROM jsonb_array_elements('[
  {"format":"docx","slots":[],"pageSizes":[]},
  {"format":"docx","slots":[{"id":"p-1","editable":true},{"id":"p-3","editable":false}],"pageSizes":[]},
  {"format":"docx","slots":[{"id":"p-2","editable":true},{"id":"p-1","editable":false}],"pageSizes":[]},
  {"format":"docx","slots":[{"id":"p-9999","editable":true}],"pageSizes":[]}
 ]'::JSONB) LOOP
  rejected:=FALSE;
  BEGIN PERFORM pg_temp.ui_seal(attempt,claim,manifest);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=TRUE; END;
  PERFORM pg_temp.ui_assert(rejected,'empty/gap/reordered/out-of-range DOCX manifest rejected');
  PERFORM pg_temp.ui_assert((SELECT state='processing' AND sealed_at IS NULL FROM platform_private.university_template_ingresses WHERE id=attempt),'invalid DOCX leaves claim unsealed');
  PERFORM pg_temp.ui_assert((SELECT count(*)=before_count FROM platform_private.university_form_inspection_receipts),'invalid DOCX creates no immutable receipt');
 END LOOP;
 PERFORM pg_temp.ui_seal(attempt,claim,'{"format":"docx","slots":[{"id":"p-1","editable":true},{"id":"p-2","editable":false}],"pageSizes":[]}');
 PERFORM pg_temp.ui_object(attempt);
 result:=pg_temp.ui_complete(attempt,claim,repeat('a',64),128,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 PERFORM pg_temp.ui_assert(result->>'state'='verified','exact ordered DOCX manifest remains valid');
 PERFORM pg_temp.ui_assert((SELECT count(*)=before_count+1 FROM platform_private.university_form_inspection_receipts),'valid DOCX creates exactly one immutable receipt');
END $$;
ROLLBACK;
\echo UNIVERSITY_TEMPLATE_INGRESS_SQL_SYNTHETIC_CONSTRAINTS_ONLY
