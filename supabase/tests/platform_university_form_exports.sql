\set ON_ERROR_STOP on
-- Rollback-only SQL authority/transition proof. Every identity/value is synthetic.
-- Owner-inserted source receipts and service observations are NOT actual native
-- rendering, ClamAV, Storage, image attestation or delivery to a person.
BEGIN;
CREATE FUNCTION pg_temp.fe_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
 SELECT ('64167000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.fe_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Form export SQL: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.fe_error(command TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE TEMP TABLE fe_receipts(key TEXT PRIMARY KEY,body JSONB NOT NULL);
CREATE FUNCTION pg_temp.fe_body(p_key TEXT) RETURNS JSONB LANGUAGE SQL STABLE AS $$ SELECT body FROM pg_temp.fe_receipts WHERE key=p_key $$;
CREATE FUNCTION pg_temp.fe_artifact(p_key TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT (pg_temp.fe_body(p_key)->'artifact'->>'id')::UUID $$;
CREATE FUNCTION pg_temp.fe_claim(p_key TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT (pg_temp.fe_body(p_key)->>'claim_token')::UUID $$;
CREATE FUNCTION pg_temp.fe_proof(p_pdf BOOLEAN DEFAULT FALSE) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
 SELECT jsonb_build_object('image_id','sha256:'||repeat('1',64),'release_revision',repeat('2',40),
 'font_sha256',CASE WHEN p_pdf THEN 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5' END)
$$;
GRANT SELECT,INSERT ON fe_receipts TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION pg_temp.fe_id(INTEGER),pg_temp.fe_assert(BOOLEAN,TEXT),pg_temp.fe_error(TEXT),
 pg_temp.fe_body(TEXT),pg_temp.fe_artifact(TEXT),pg_temp.fe_claim(TEXT),pg_temp.fe_proof(BOOLEAN) TO authenticated,service_role;

-- Golden produced by the actual computePackageGeneratedInputHash helper, not by
-- PostgreSQL's spaced jsonb::text serializer used for the logical capsule hash.
SELECT pg_temp.fe_assert(platform_private.university_form_export_generated_hash(jsonb_populate_record(
 NULL::platform_private.document_export_artifacts,jsonb_build_object('organization_id',pg_temp.fe_id(1),'student_case_id',pg_temp.fe_id(501),
 'student_profile_id',pg_temp.fe_id(701),'profile_revision',2,'field_reviews_sha256',repeat('a',64),'template_sha256',repeat('b',64),
 'application_id',pg_temp.fe_id(601),'catalog_institution_id',pg_temp.fe_id(702),'template_version_id',pg_temp.fe_id(703),
 'mapping_id',pg_temp.fe_id(901),'mapping_sha256',repeat('c',64),'review_id',pg_temp.fe_id(704))))=
 '35cead709586de4efb4c954d78420cb39ddeff5a48fab971fb8bb489f5a3a35e','SQL/package compact canonical golden parity');

INSERT INTO platform.organizations(id,name) VALUES(pg_temp.fe_id(1),'Synthetic form export organization'),(pg_temp.fe_id(2),'Other synthetic organization');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.fe_id(100+n),'form-export-'||n||'@example.invalid','{}'::JSONB FROM generate_series(1,4)n;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
 SELECT pg_temp.fe_id(200+n),pg_temp.fe_id(100+n),'Synthetic export staff '||n,'active',1 FROM generate_series(1,4)n;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
 SELECT pg_temp.fe_id(300+n),pg_temp.fe_id(CASE WHEN n=4 THEN 2 ELSE 1 END),pg_temp.fe_id(200+n),'active',
 CASE WHEN n=3 THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END,
 (SELECT id FROM platform.role_bundle_versions WHERE role=CASE WHEN n=3 THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END
 AND status='published' ORDER BY version DESC LIMIT 1),n<>3 FROM generate_series(1,4)n;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 SELECT pg_temp.fe_id(400+n),pg_temp.fe_id(1),'student_case',pg_temp.fe_id(500+n),1 FROM generate_series(1,2)n;
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
 target_country,target_degree,program_direction,state,current_scope_id,current_scope_version,current_curator_membership_id,handoff_at)
 SELECT pg_temp.fe_id(500+n),pg_temp.fe_id(1),pg_temp.fe_id(301),'synthetic:form-export-'||n,'Synthetic export student '||n,
 'China','Bachelor','Engineering','pending',pg_temp.fe_id(400+n),1,NULL,NULL FROM generate_series(1,2)n;
UPDATE platform.record_scopes SET is_active=FALSE WHERE id=pg_temp.fe_id(401);
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.fe_id(403),pg_temp.fe_id(1),'student_case',pg_temp.fe_id(501),2);
UPDATE platform.student_cases SET state='active',current_curator_membership_id=pg_temp.fe_id(302),handoff_at=statement_timestamp(),
 current_scope_id=pg_temp.fe_id(403),current_scope_version=2 WHERE id=pg_temp.fe_id(501);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.fe_id(101),'claims',jsonb_build_object('sub',pg_temp.fe_id(101),'role','authenticated')))->'claims')::TEXT AS fe_admin \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.fe_id(102),'claims',jsonb_build_object('sub',pg_temp.fe_id(102),'role','authenticated')))->'claims')::TEXT AS fe_admin2 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.fe_id(104),'claims',jsonb_build_object('sub',pg_temp.fe_id(104),'role','authenticated')))->'claims')::TEXT AS fe_other \gset
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
-- Use existing catalogue review workflow, not a new institution name matcher.
SELECT platform.register_workflow_source(pg_temp.fe_id(1),'src_dddddddddddddddddddddddddddddddd','google_spreadsheet',
 'https://docs.google.com/spreadsheets/d/1FormExportSynthetic000000000000000/edit','export-source-v1','Synthetic source',pg_temp.fe_id(1001))::TEXT AS fe_source \gset
SELECT platform.review_workflow_source(pg_temp.fe_id(1),:'fe_source','reviewed','Synthetic source review',pg_temp.fe_id(1002));
INSERT INTO fe_receipts SELECT 'batch',platform.create_catalog_import_batch(pg_temp.fe_id(1),:'fe_source','university','Synthetic export catalogue',pg_temp.fe_id(1003));
SELECT (body->>'catalog_import_batch_id')::UUID AS fe_batch FROM fe_receipts WHERE key='batch' \gset
SELECT platform.stage_catalog_import_candidate(pg_temp.fe_id(1),:'fe_batch','rec_dddddddddddddddddddddddddddddddd',
 'Synthetic Export University','MY','Synthetic city','Synthetic candidate',pg_temp.fe_id(1004));
SELECT platform.validate_catalog_import_batch(pg_temp.fe_id(1),:'fe_batch','Synthetic validation',pg_temp.fe_id(1005));
SELECT platform.review_catalog_import_batch(pg_temp.fe_id(1),:'fe_batch','approve','Synthetic approval',pg_temp.fe_id(1006));
RESET ROLE;
SELECT id AS fe_catalog FROM platform.catalog_institutions WHERE organization_id=pg_temp.fe_id(1) \gset
INSERT INTO fe_receipts VALUES('catalog',jsonb_build_object('id',:'fe_catalog'));
-- Synthetic canonical application rows: creation UI is not under this SQL test.
INSERT INTO platform.university_applications(id,organization_id,student_case_id,catalog_institution_id,institution_name,program_name,status,created_by_membership_id)
 SELECT pg_temp.fe_id(600+n),pg_temp.fe_id(1),pg_temp.fe_id(500+n),:'fe_catalog','Synthetic Export University','Engineering','preparation',pg_temp.fe_id(301)
 FROM generate_series(1,2)n;
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'template-'||n,platform.create_university_form_template(pg_temp.fe_id(1),pg_temp.fe_id(800+n),:'fe_catalog',
 'Synthetic blank '||n,0,'Create template',pg_temp.fe_id(1100+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'version-'||n,platform.reserve_university_form_version(pg_temp.fe_id(1),pg_temp.fe_id(800+n),repeat(CASE n WHEN 1 THEN 'a' ELSE 'b' END,64),128,
 CASE n WHEN 1 THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ELSE 'application/pdf' END,
 'Synthetic public blank','2026-09-14',1,'Reserve source metadata',pg_temp.fe_id(1110+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'mapping-'||n,platform.save_university_form_mapping(pg_temp.fe_id(1),pg_temp.fe_id(800+n),pg_temp.fe_id(900+n),
 (pg_temp.fe_body('version-'||n)->>'target_id')::UUID,repeat(CASE n WHEN 1 THEN 'a' ELSE 'b' END,64),
 CASE n WHEN 1 THEN '[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false}]'::JSONB
 ELSE '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":10,"y":20,"width":160,"height":24}}]'::JSONB END,
 2,'Save exact mapping',pg_temp.fe_id(1120+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'unpublished',platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901));
SELECT pg_temp.fe_assert(pg_temp.fe_body('unpublished')->>'unavailable_reason'='mapping_not_current'
 AND pg_temp.fe_body('unpublished')->'selection'='null'::JSONB,'unpublished selection unavailable without fabricated authority');
RESET ROLE;
-- PostgreSQL owner ONLY installs synthetic minimal inspected-source receipts.
INSERT INTO platform_private.university_form_inspection_receipts(organization_id,template_id,template_version_id,source_sha256,source_byte_size,
 source_mime_type,source_object_name,scan_signature_revision,inspector_revision,inspector_image_sha256,manifest_sha256,manifest)
 SELECT v.organization_id,v.template_id,v.id,v.sha256,v.byte_size,v.mime_type,v.object_name,'synthetic-clamav-1','evo-university-template-v1','sha256:'||repeat('1',64),
 platform_private.bw1_input_sha256(manifest),manifest FROM platform_private.university_form_template_versions v
 CROSS JOIN LATERAL (SELECT CASE v.mime_type WHEN 'application/pdf' THEN '{"format":"pdf","slots":[],"pageSizes":[{"width":612,"height":792}]}'::JSONB
 ELSE '{"format":"docx","slots":[{"id":"p-1","editable":true}],"pageSizes":[]}'::JSONB END manifest) f WHERE v.organization_id=pg_temp.fe_id(1);
INSERT INTO fe_receipts SELECT 'mapping-hash-'||n,to_jsonb(m.sha256) FROM generate_series(1,2)n
 JOIN platform_private.university_form_mapping_versions m ON m.id=pg_temp.fe_id(900+n);
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'review-'||n,platform.review_university_form_mapping(pg_temp.fe_id(1),pg_temp.fe_id(800+n),pg_temp.fe_id(900+n),
 pg_temp.fe_body('mapping-hash-'||n)#>>'{}','approved',3,'Review synthetic source mapping',pg_temp.fe_id(1130+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'publish-'||n,platform.publish_university_form_template(pg_temp.fe_id(1),pg_temp.fe_id(800+n),pg_temp.fe_id(900+n),
 pg_temp.fe_body('mapping-hash-'||n)#>>'{}',(pg_temp.fe_body('review-'||n)->>'target_id')::UUID,4,'Publish exact reviewed tuple',pg_temp.fe_id(1140+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'missing-profile',platform.staff_university_form_export_workspace(pg_temp.fe_id(502),pg_temp.fe_id(602),pg_temp.fe_id(901));
SELECT pg_temp.fe_assert(pg_temp.fe_body('missing-profile')->>'unavailable_reason'='profile_missing'
 AND pg_temp.fe_body('missing-profile')->'selection'<>'null'::JSONB AND pg_temp.fe_body('missing-profile')->'workspace_revision'='null'::JSONB,'missing profile read creates nothing');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.staff_university_form_export_workspace(%L,%L,%L)',
 pg_temp.fe_id(501),pg_temp.fe_id(602),pg_temp.fe_id(901)))='42501','foreign case application denied');
INSERT INTO fe_receipts SELECT 'profile',platform.start_student_profile(pg_temp.fe_id(1),pg_temp.fe_id(501),0,'Start synthetic profile',pg_temp.fe_id(1150));
SELECT platform.review_student_profile_field(pg_temp.fe_id(1),pg_temp.fe_id(501),'student_first_name','confirm','Confirmed synthetic name',NULL,NULL,NULL,1,'Confirm synthetic field',pg_temp.fe_id(1151));
RESET ROLE;
INSERT INTO platform.student_profile_fields(organization_id,student_case_id,student_profile_id,field_key,value,review_state,profile_revision)
 SELECT pg_temp.fe_id(1),pg_temp.fe_id(501),id,'student_last_name','UNCONFIRMED_FIXTURE_VALUE','extracted',revision FROM platform.student_profiles WHERE student_case_id=pg_temp.fe_id(501);
SELECT pg_temp.fe_assert(NOT EXISTS(SELECT 1 FROM platform.student_profiles WHERE student_case_id=pg_temp.fe_id(502)),'read-only missing-profile workspace does not initialize');
-- Public/session/service separation includes effective PUBLIC grants.
SELECT pg_temp.fe_assert(NOT has_function_privilege(r,s,'EXECUTE'),'forbidden session RPC role '||r||' '||s)
 FROM (VALUES('anon'),('service_role'),('supabase_auth_admin')) roles(r) CROSS JOIN (VALUES
 ('platform.staff_university_form_export_workspace(uuid,uuid,uuid)'),('platform.prepare_university_form_export(uuid,uuid,uuid,text,text,uuid)'),
 ('platform.staff_document_export_workspace_v2(uuid)')) signatures(s);
SELECT pg_temp.fe_assert(NOT has_table_privilege(r,'platform_private.document_export_input_snapshots','SELECT')
 AND NOT has_table_privilege(r,'platform_private.document_export_artifacts','UPDATE'),'private snapshot/receipt grants remain closed '||r)
 FROM (VALUES('anon'),('authenticated'),('service_role'),('supabase_auth_admin')) roles(r);
SELECT pg_temp.fe_assert(to_regprocedure('platform.seal_document_export_output(uuid,uuid,text,integer)') IS NULL
 AND (SELECT pronargdefaults=1 FROM pg_proc WHERE oid='platform.seal_document_export_output(uuid,uuid,text,integer,jsonb)'::REGPROCEDURE),
 'single defaulted seal signature preserves old four-argument call without ambiguous overload');
SET LOCAL request.jwt.claims TO :'fe_other';
SET LOCAL ROLE authenticated;
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.staff_university_form_export_workspace(%L,%L,%L)',pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901)))='42501','other organization denied');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'workspace-'||n,platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(900+n)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'profile-workspace',platform.staff_document_export_workspace(pg_temp.fe_id(501));
INSERT INTO fe_receipts SELECT 'profile-prepare',platform.prepare_document_export(pg_temp.fe_id(501),'draft',pg_temp.fe_body('profile-workspace')->>'workspace_revision',pg_temp.fe_id(1200));
INSERT INTO fe_receipts SELECT 'prepare-'||n,platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),
 'draft',pg_temp.fe_body('workspace-1')->>'workspace_revision',pg_temp.fe_id(1200+n)) FROM generate_series(1,12)n;
INSERT INTO fe_receipts SELECT 'prepare-pdf',platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902),
 'final',pg_temp.fe_body('workspace-2')->>'workspace_revision',pg_temp.fe_id(1213));
INSERT INTO fe_receipts SELECT 'prepare-replay',platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),
 'draft',pg_temp.fe_body('workspace-1')->>'workspace_revision',pg_temp.fe_id(1201));
SELECT pg_temp.fe_assert(pg_temp.fe_body('prepare-1')=pg_temp.fe_body('prepare-replay'),'pre-begin replay returns identical frozen capsule');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.prepare_university_form_export(%L,%L,%L,%L,%L,%L)',pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),
 'final',pg_temp.fe_body('workspace-1')->>'workspace_revision',pg_temp.fe_id(1201)))='23505','changed request payload conflicts');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.prepare_university_form_export(%L,%L,%L,%L,%L,%L)',pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),
 'draft',repeat('0',64),pg_temp.fe_id(1220)))='40001','stale workspace rejected before artifact creation');
SELECT pg_temp.fe_assert(pg_temp.fe_body('prepare-1')->'frozen_form'->'template'->'manifest'='{"format":"docx","slots":[{"id":"p-1","editable":true}],"pageSizes":[]}'::JSONB
 AND position('UNCONFIRMED_FIXTURE_VALUE' IN pg_temp.fe_body('prepare-1')::TEXT)=0
 AND jsonb_array_length(pg_temp.fe_body('prepare-1')->'frozen_form'->'frozen_profile'->'fields')=61,'minimal DOCX manifest and confirmed-only 61-field profile');
SELECT pg_temp.fe_assert(pg_temp.fe_body('prepare-pdf')->'frozen_form'->'template'->'manifest'->'slots'='[]'::JSONB
 AND pg_temp.fe_body('prepare-pdf')->'frozen_form'->'mapping'->'mappings'->0->>'slotId'='pdf-1','PDF regions belong to approved mapping, not invented inspector slots');
INSERT INTO fe_receipts SELECT 'history-v1',platform.staff_document_export_workspace(pg_temp.fe_id(501));
INSERT INTO fe_receipts SELECT 'history-v2',platform.staff_document_export_workspace_v2(pg_temp.fe_id(501));
SELECT pg_temp.fe_assert(pg_temp.fe_body('history-v1')->>'schema_version'='1' AND jsonb_array_length(pg_temp.fe_body('history-v1')->'artifacts')=1
 AND NOT (pg_temp.fe_body('history-v1')->'artifacts'->0 ? 'form'),'legacy v1 profile-only history unchanged');
SELECT pg_temp.fe_assert(pg_temp.fe_body('history-v2')->>'schema_version'='2' AND jsonb_array_length(pg_temp.fe_body('history-v2')->'artifacts')=14,'explicit v2 union history contains both kinds');
RESET ROLE;
SELECT pg_temp.fe_assert(input_snapshot_sha256=platform_private.bw1_input_sha256(pg_temp.fe_body('prepare-1')->'frozen_form')
 AND generated_input_sha256=platform_private.university_form_export_generated_hash(a) AND generated_input_sha256<>input_snapshot_sha256,
 'logical input and package-generated digests bind distinct exact domains') FROM platform_private.document_export_artifacts a WHERE id=pg_temp.fe_artifact('prepare-1');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('UPDATE platform_private.document_export_artifacts SET mapping_id=%L WHERE id=%L',pg_temp.fe_id(902),pg_temp.fe_artifact('prepare-1')))='55000','binding immutable before rendering');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('UPDATE platform_private.document_export_input_snapshots SET frozen_form=%L WHERE id=%L','{}',
 pg_temp.fe_body('prepare-1')->>'preparation_id'))='55000','minimal capsule immutable');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'begin-'||n,platform.begin_document_export((pg_temp.fe_body('prepare-'||n)->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301)) FROM generate_series(1,12)n;
INSERT INTO fe_receipts SELECT 'begin-pdf',platform.begin_document_export((pg_temp.fe_body('prepare-pdf')->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301));
INSERT INTO fe_receipts SELECT 'profile-begin',platform.begin_document_export((pg_temp.fe_body('profile-prepare')->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301));
INSERT INTO fe_receipts SELECT 'begin-replay',platform.begin_document_export((pg_temp.fe_body('prepare-1')->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301));
SELECT pg_temp.fe_assert(pg_temp.fe_body('begin-replay')->>'created'='false' AND pg_temp.fe_body('begin-replay')->'template_source'='null'::JSONB
 AND pg_temp.fe_body('begin-1')->'template_source'->>'bucket_id'='platform-document-templates'
 AND position('Confirmed synthetic name' IN pg_temp.fe_body('begin-1')::TEXT)=0,'one claim only, service source target has no field values');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,128,%L::jsonb)',pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),repeat('c',64),proof))='22023',
 'invalid renderer proof cannot seal') FROM (VALUES(NULL::JSONB),('{}'::JSONB),(pg_temp.fe_proof()-'image_id'),
 (pg_temp.fe_proof()||jsonb_build_object('image_id',repeat('1',64))),
 (pg_temp.fe_proof()||jsonb_build_object('release_revision',repeat('2',64))),
 (pg_temp.fe_proof()||jsonb_build_object('extra','forbidden')),(pg_temp.fe_proof(TRUE))) invalid(proof);
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,20971521,%L::jsonb)',pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),repeat('c',64),pg_temp.fe_proof()))='22023','form output above 20 MiB denied');
INSERT INTO fe_receipts SELECT 'seal-1',platform.seal_document_export_output(pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),repeat('c',64),20971520,pg_temp.fe_proof());
INSERT INTO fe_receipts SELECT 'seal-1-replay',platform.seal_document_export_output(pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),repeat('c',64),20971520,pg_temp.fe_proof());
SELECT pg_temp.fe_assert(pg_temp.fe_body('seal-1')=pg_temp.fe_body('seal-1-replay'),'exact seal replay preserves output identity');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,20971520,%L::jsonb)',pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),repeat('c',64),
 pg_temp.fe_proof()||jsonb_build_object('image_id','sha256:'||repeat('3',64))))='23505','changed image proof cannot replace sealed proof');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,128,%L::jsonb)',pg_temp.fe_artifact('begin-pdf'),pg_temp.fe_claim('begin-pdf'),repeat('d',64),pg_temp.fe_proof()))='22023','PDF missing exact fixed font denied');
INSERT INTO fe_receipts SELECT 'seal-pdf',platform.seal_document_export_output(pg_temp.fe_artifact('begin-pdf'),pg_temp.fe_claim('begin-pdf'),repeat('d',64),20971520,pg_temp.fe_proof(TRUE));
SELECT pg_temp.fe_assert(pg_temp.fe_body('seal-pdf')->'storage'->>'object_name' LIKE '%.pdf'
 AND pg_temp.fe_body('seal-pdf')->'artifact'->>'receipt_id' IS NULL,'PDF sealed target has matching extension and no ready receipt yet');
INSERT INTO fe_receipts SELECT 'ready-1',platform.complete_document_export(pg_temp.fe_artifact('begin-1'),pg_temp.fe_claim('begin-1'),'ready',NULL,repeat('c',64),20971520);
INSERT INTO fe_receipts SELECT 'ready-pdf',platform.complete_document_export(pg_temp.fe_artifact('begin-pdf'),pg_temp.fe_claim('begin-pdf'),'ready',NULL,repeat('d',64),20971520);
SELECT pg_temp.fe_assert(pg_temp.fe_body(k)->>'state'='ready' AND pg_temp.fe_body(k)->>'receipt_id' IS NOT NULL
 AND pg_temp.fe_body(k)->'renderer_proof'->>'image_id'='sha256:'||repeat('1',64),'matching observed output creates immutable ready receipt '||k) FROM (VALUES('ready-1'),('ready-pdf'))keys(k);
INSERT INTO fe_receipts SELECT 'seal-'||n,platform.seal_document_export_output(pg_temp.fe_artifact('begin-'||n),pg_temp.fe_claim('begin-'||n),repeat('e',64),128,pg_temp.fe_proof()) FROM generate_series(2,6)n;
INSERT INTO fe_receipts SELECT 'unknown-2',platform.complete_document_export(pg_temp.fe_artifact('begin-2'),pg_temp.fe_claim('begin-2'),'unknown','storage_unavailable',NULL,NULL);
INSERT INTO fe_receipts SELECT 'inspect-2',platform.inspect_document_export_reconciliation(pg_temp.fe_artifact('begin-2'),pg_temp.fe_id(102),pg_temp.fe_id(302));
SELECT pg_temp.fe_assert(pg_temp.fe_body('inspect-2')->'storage'->>'object_name'=pg_temp.fe_body('seal-2')->'storage'->>'object_name','unknown recovery targets identical create-only key');
INSERT INTO fe_receipts SELECT 'reconcile-unknown',platform.reconcile_document_export(pg_temp.fe_artifact('begin-2'),pg_temp.fe_id(102),pg_temp.fe_id(302),pg_temp.fe_id(1301),NULL,NULL,'storage_unavailable');
INSERT INTO fe_receipts SELECT 'reconcile-replay',platform.reconcile_document_export(pg_temp.fe_artifact('begin-2'),pg_temp.fe_id(102),pg_temp.fe_id(302),pg_temp.fe_id(1301),repeat('e',64),128,NULL);
SELECT pg_temp.fe_assert(pg_temp.fe_body('reconcile-unknown')=pg_temp.fe_body('reconcile-replay') AND pg_temp.fe_body('reconcile-replay')->>'state'='unknown','same request keeps original unknown outcome');
INSERT INTO fe_receipts SELECT 'reconciled-2',platform.reconcile_document_export(pg_temp.fe_artifact('begin-2'),pg_temp.fe_id(102),pg_temp.fe_id(302),pg_temp.fe_id(1302),repeat('e',64),128,NULL);
INSERT INTO fe_receipts SELECT 'corrupt-3',platform.complete_document_export(pg_temp.fe_artifact('begin-3'),pg_temp.fe_claim('begin-3'),'ready',NULL,repeat('f',64),128);
SELECT pg_temp.fe_assert(pg_temp.fe_body('reconciled-2')->>'state'='ready' AND pg_temp.fe_body('corrupt-3')->>'failure_code'='integrity_failed','exact readback reconciles, different bytes never ready');
INSERT INTO fe_receipts SELECT 'not-ready-7',platform.complete_document_export(pg_temp.fe_artifact('begin-7'),pg_temp.fe_claim('begin-7'),'failed','form_not_ready',NULL,NULL);
SELECT pg_temp.fe_assert(pg_temp.fe_body('not-ready-7')->>'failure_code'='form_not_ready','real renderer not-ready failure can be reported without a seal');
RESET ROLE;
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('UPDATE platform_private.document_export_artifacts SET renderer_proof=%L WHERE id=%L',pg_temp.fe_proof(TRUE),pg_temp.fe_artifact('begin-1')))='55000','ready proof immutable');
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'after-begin-replay',platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),'draft',pg_temp.fe_body('workspace-1')->>'workspace_revision',pg_temp.fe_id(1201));
SELECT pg_temp.fe_assert(pg_temp.fe_body('after-begin-replay')->'frozen_form'='null'::JSONB,'replay after begin never reopens frozen values');
INSERT INTO fe_receipts SELECT 'unrelated-draft',platform.reserve_university_form_version(pg_temp.fe_id(1),pg_temp.fe_id(801),repeat('a',64),128,
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Another synthetic blank','2026-09-14',5,'Unpublished draft',pg_temp.fe_id(1310));
SELECT pg_temp.fe_assert(platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901))->>'workspace_revision'=pg_temp.fe_body('workspace-1')->>'workspace_revision','unrelated draft does not invalidate published tuple');
SELECT platform.review_student_profile_field(pg_temp.fe_id(1),pg_temp.fe_id(501),'student_first_name','confirm','Changed synthetic name',NULL,NULL,NULL,2,'Edit while rendering',pg_temp.fe_id(1311));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'stale-complete',platform.complete_document_export(pg_temp.fe_artifact('begin-4'),pg_temp.fe_claim('begin-4'),'ready',NULL,repeat('e',64),128);
INSERT INTO fe_receipts SELECT 'stale-seal',platform.seal_document_export_output(pg_temp.fe_artifact('begin-8'),pg_temp.fe_claim('begin-8'),repeat('e',64),128,pg_temp.fe_proof());
SELECT pg_temp.fe_assert(pg_temp.fe_body('stale-complete')->>'failure_code'='source_changed'
 AND pg_temp.fe_body('stale-seal')->'artifact'->>'failure_code'='source_changed' AND pg_temp.fe_body('stale-seal')->'storage'='null'::JSONB,'live profile change fences completion and sealing');
RESET ROLE;

-- The v1 renderer contract is unchanged even on the shared five-argument seal.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,5242881)',pg_temp.fe_artifact('profile-begin'),pg_temp.fe_claim('profile-begin'),repeat('c',64)))='22023','profile cap stays 5 MiB');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,128,%L::jsonb)',pg_temp.fe_artifact('profile-begin'),pg_temp.fe_claim('profile-begin'),repeat('c',64),pg_temp.fe_proof()))='22023','profile cannot gain a form renderer proof');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
-- Actual S2 role publication and assignment: export does not require management.
SELECT platform.staff_role_command(pg_temp.fe_id(1),pg_temp.fe_id(1501),0,'create',
 '{"label":"Synthetic saved form exporter","description":"No catalogue management","permissionKeys":["profile.read.full","document.download","catalog.read"]}',
 'Create ordinary exporter',pg_temp.fe_id(1502));
SELECT platform.staff_role_publish(pg_temp.fe_id(1),pg_temp.fe_id(1501),1,
 platform.staff_role_impact(pg_temp.fe_id(1),pg_temp.fe_id(1501),1)->>'impactFingerprint','Publish exporter',pg_temp.fe_id(1503));
RESET ROLE;
INSERT INTO fe_receipts SELECT 'role-bindings',jsonb_build_array(jsonb_build_object('roleId',r.id,'roleVersion',r.version,'bundleId',r.current_bundle_id,'bundleVersion',b.version))
 FROM platform.staff_role_definitions r JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id WHERE r.id=pg_temp.fe_id(1501);
SET LOCAL ROLE authenticated;
SELECT platform.staff_role_assignments_save(pg_temp.fe_id(1),pg_temp.fe_id(303),1,
 jsonb_build_array(jsonb_build_object('roleId',pg_temp.fe_id(1501),'scope',jsonb_build_object('kind','organization','key',pg_temp.fe_id(1),'resourceKind',NULL))),
 pg_temp.fe_body('role-bindings'),'Assign ordinary exporter',pg_temp.fe_id(1504));
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.fe_id(103),'claims',jsonb_build_object('sub',pg_temp.fe_id(103),'role','authenticated')))->'claims')::TEXT AS fe_exporter \gset
SELECT pg_temp.fe_assert(NOT is_system_admin AND NOT platform_private.staff_can_access(organization_id,id,'catalog.import.manage','organization',organization_id),
 'ordinary exporter has no management authority') FROM platform.organization_memberships WHERE id=pg_temp.fe_id(303);
SET LOCAL request.jwt.claims TO :'fe_exporter';
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'ordinary-workspace',platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902));
INSERT INTO fe_receipts SELECT 'ordinary-prepare',platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902),
 'draft',pg_temp.fe_body('ordinary-workspace')->>'workspace_revision',pg_temp.fe_id(1510));
INSERT INTO fe_receipts SELECT 'historical-grant',platform.grant_document_export_download((pg_temp.fe_body('ready-1')->>'id')::UUID,pg_temp.fe_id(1511));
INSERT INTO fe_receipts SELECT 'revoked-grant',platform.grant_document_export_download((pg_temp.fe_body('ready-pdf')->>'id')::UUID,pg_temp.fe_id(1512));
INSERT INTO fe_receipts SELECT 'historical-workspace',platform.staff_document_export_workspace_v2(pg_temp.fe_id(501));
SELECT pg_temp.fe_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.fe_body('historical-workspace')->'artifacts') a
 WHERE a->>'id'=pg_temp.fe_body('ready-1')->>'id' AND a->>'historical'='true' AND a->>'can_download'='true'),'ready history survives profile change under current ordinary actor');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'ordinary-begin',platform.begin_document_export((pg_temp.fe_body('ordinary-prepare')->>'preparation_id')::UUID,pg_temp.fe_id(103),pg_temp.fe_id(303));
INSERT INTO fe_receipts SELECT 'historical-consume',platform.consume_document_export_download((pg_temp.fe_body('historical-grant')->>'grant_id')::UUID,pg_temp.fe_id(103),pg_temp.fe_id(303));
INSERT INTO fe_receipts SELECT 'historical-download',platform.complete_document_export_download((pg_temp.fe_body('historical-grant')->>'grant_id')::UUID,pg_temp.fe_id(103),pg_temp.fe_id(303),repeat('c',64),20971520);
INSERT INTO fe_receipts SELECT 'before-revoke',platform.consume_document_export_download((pg_temp.fe_body('revoked-grant')->>'grant_id')::UUID,pg_temp.fe_id(103),pg_temp.fe_id(303));
SELECT pg_temp.fe_assert(pg_temp.fe_body('historical-download')->>'verified'='true','historical form accepts exact observed full 20 MiB output');
RESET ROLE;
-- Evaluate actual currentness helper against a yesterday-bound metadata tuple.
-- No clock override or persisted forged receipt: this is a pure SQL boundary test.
SELECT pg_temp.fe_assert(platform_private.document_export_live_failure(jsonb_populate_record(a,jsonb_build_object('validation_day',a.validation_day-1,
 'workspace_revision',platform_private.university_form_export_workspace_digest(
 jsonb_set(pg_temp.fe_body('ordinary-prepare')->'frozen_form','{form,validation_day}',to_jsonb(a.validation_day-1)),
 a.student_profile_id,a.profile_revision,a.field_reviews_sha256))),pg_temp.fe_id(103),pg_temp.fe_id(303),TRUE)='source_changed',
 'UTC validation day belongs to live workspace digest') FROM platform_private.document_export_artifacts a WHERE id=pg_temp.fe_artifact('ordinary-prepare');
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_role_assignments_save(pg_temp.fe_id(1),pg_temp.fe_id(303),2,'[]','[]','Revoke ordinary exporter during render and download',pg_temp.fe_id(1520));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'ordinary-revoked',platform.seal_document_export_output(pg_temp.fe_artifact('ordinary-begin'),pg_temp.fe_claim('ordinary-begin'),repeat('f',64),128,pg_temp.fe_proof(TRUE));
INSERT INTO fe_receipts SELECT 'download-revoked',platform.complete_document_export_download((pg_temp.fe_body('revoked-grant')->>'grant_id')::UUID,pg_temp.fe_id(103),pg_temp.fe_id(303),repeat('d',64),20971520);
SELECT pg_temp.fe_assert(pg_temp.fe_body('ordinary-revoked')->'artifact'->>'failure_code'='access_changed'
 AND pg_temp.fe_body('ordinary-revoked')->'storage'='null'::JSONB AND pg_temp.fe_body('download-revoked')->>'verified'='false'
 AND pg_temp.fe_body('download-revoked')->>'failure_code'='access_changed','service identity does not replace revoked live exporter/downloader');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_exporter';
SET LOCAL ROLE authenticated;
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.staff_university_form_export_workspace(%L,%L,%L)',pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902)))='42501','stale staff JWT cannot restore revoked authority');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'archive-workspace',platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901));
INSERT INTO fe_receipts SELECT 'archive-prepare',platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901),
 'draft',pg_temp.fe_body('archive-workspace')->>'workspace_revision',pg_temp.fe_id(1530));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'archive-begin',platform.begin_document_export((pg_temp.fe_body('archive-prepare')->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
SELECT platform.archive_university_form_template(pg_temp.fe_id(1),pg_temp.fe_id(801),6,'Archive published source while render in flight',pg_temp.fe_id(1531));
SELECT pg_temp.fe_assert(platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(901))->>'unavailable_reason'='mapping_not_current','archived template unavailable for new form');
INSERT INTO fe_receipts SELECT 'archived-ready-grant',platform.grant_document_export_download((pg_temp.fe_body('ready-1')->>'id')::UUID,pg_temp.fe_id(1532));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'archive-denied',platform.seal_document_export_output(pg_temp.fe_artifact('archive-begin'),pg_temp.fe_claim('archive-begin'),repeat('f',64),128,pg_temp.fe_proof());
SELECT pg_temp.fe_assert(pg_temp.fe_body('archive-denied')->'artifact'->>'failure_code'='source_changed','archival fences pending render but preserves ready historical download');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
INSERT INTO fe_receipts SELECT 'source-slot',platform.create_custom_document_slot(pg_temp.fe_id(1),pg_temp.fe_id(501),'Synthetic PDF evidence','SQL source authority',pg_temp.fe_id(1601));
RESET ROLE;
-- Real installed upload/finalization RPCs, but synthetic scanner and storage
-- catalogue observations only. No source file or external Storage service exists.
INSERT INTO storage.buckets(id,name,public) VALUES('platform-documents','platform-documents',FALSE) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'source-upload',platform.reserve_document_upload_after_ingress_scan(pg_temp.fe_id(1),pg_temp.fe_id(101),
 (pg_temp.fe_body('source-slot')->>'document_slot_id')::UUID,'synthetic-source.pdf','application/pdf',2048,repeat('f',64),'clean',
 'ClamAV','1.5.4','27890','clamd-zinstream-v1',statement_timestamp(),pg_temp.fe_id(1602));
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata,created_at) SELECT body->>'bucket_id',body->>'object_name',jsonb_build_object('size',2048,'mimetype','application/pdf'),statement_timestamp()
 FROM fe_receipts WHERE key='source-upload';
SET LOCAL ROLE service_role;
SELECT platform.finalize_document_upload_with_scan(pg_temp.fe_id(1),(pg_temp.fe_body('source-upload')->>'upload_reservation_id')::UUID,
 'ClamAV','1.5.4','27890','clamd-zinstream-v1',repeat('f',64),statement_timestamp(),pg_temp.fe_id(1603));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
SELECT platform.review_student_profile_field(pg_temp.fe_id(1),pg_temp.fe_id(501),'student_first_name','confirm','Source-confirmed synthetic name',NULL,
 (pg_temp.fe_body('source-upload')->>'document_version_id')::UUID,1,3,'Confirm from synthetic source version',pg_temp.fe_id(1604));
INSERT INTO fe_receipts SELECT 'source-workspace',platform.staff_university_form_export_workspace(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902));
INSERT INTO fe_receipts SELECT 'source-prepare-'||n,platform.prepare_university_form_export(pg_temp.fe_id(501),pg_temp.fe_id(601),pg_temp.fe_id(902),
 'draft',pg_temp.fe_body('source-workspace')->>'workspace_revision',pg_temp.fe_id(1610+n)) FROM generate_series(1,2)n;
RESET ROLE;
SELECT pg_temp.fe_assert(source_versions=jsonb_build_array(jsonb_build_object('id',(pg_temp.fe_body('source-upload')->>'document_version_id')::UUID,'sha256',repeat('f',64))),
 'frozen form carries exact confirmed source version identity') FROM platform_private.document_export_artifacts WHERE id=pg_temp.fe_artifact('source-prepare-1');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'source-begin-'||n,platform.begin_document_export((pg_temp.fe_body('source-prepare-'||n)->>'preparation_id')::UUID,pg_temp.fe_id(101),pg_temp.fe_id(301)) FROM generate_series(1,2)n;
INSERT INTO fe_receipts SELECT 'source-seal',platform.seal_document_export_output(pg_temp.fe_artifact('source-begin-1'),pg_temp.fe_claim('source-begin-1'),repeat('d',64),128,pg_temp.fe_proof(TRUE));
INSERT INTO fe_receipts SELECT 'source-ready',platform.complete_document_export(pg_temp.fe_artifact('source-begin-1'),pg_temp.fe_claim('source-begin-1'),'ready',NULL,repeat('d',64),128);
SELECT pg_temp.fe_assert(pg_temp.fe_body('source-ready')->>'state'='ready','healthy confirmed source permits saved form');
RESET ROLE;
UPDATE platform.document_versions SET malware_status='infected' WHERE id=(pg_temp.fe_body('source-upload')->>'document_version_id')::UUID;
SET LOCAL ROLE service_role;
INSERT INTO fe_receipts SELECT 'source-denied',platform.seal_document_export_output(pg_temp.fe_artifact('source-begin-2'),pg_temp.fe_claim('source-begin-2'),repeat('d',64),128,pg_temp.fe_proof(TRUE));
SELECT pg_temp.fe_assert(pg_temp.fe_body('source-denied')->'artifact'->>'failure_code'='source_unavailable'
 AND pg_temp.fe_body('source-denied')->'storage'='null'::JSONB,'unsafe exact field source prevents form seal');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'fe_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.fe_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(platform.staff_document_export_workspace_v2(pg_temp.fe_id(501))->'artifacts') a
 WHERE a->>'id'=pg_temp.fe_body('source-ready')->>'id' AND a->>'state'='ready' AND a->>'can_download'='false'),
 'immutable ready form remains visible but unhealthy field source denies download');
SELECT pg_temp.fe_assert(pg_temp.fe_error(format('SELECT platform.grant_document_export_download(%L,%L)',pg_temp.fe_body('source-ready')->>'id',pg_temp.fe_id(1620)))='42501','no grant after field source becomes unsafe');
RESET ROLE;
SELECT pg_temp.fe_assert(NOT EXISTS(SELECT 1 FROM platform.audit_events WHERE organization_id=pg_temp.fe_id(1) AND
 (position('Confirmed synthetic name' IN COALESCE(after_state,'{}')::TEXT)>0 OR position('UNCONFIRMED_FIXTURE_VALUE' IN COALESCE(after_state,'{}')::TEXT)>0)
 AND action LIKE 'document.export.%'),'artifact audit contains no frozen applicant values');
SELECT pg_temp.fe_assert(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 WHERE p.oid IN ('platform.staff_university_form_export_workspace(uuid,uuid,uuid)'::REGPROCEDURE,
 'platform.prepare_university_form_export(uuid,uuid,uuid,text,text,uuid)'::REGPROCEDURE,'platform.staff_document_export_workspace_v2(uuid)'::REGPROCEDURE,
 'platform.seal_document_export_output(uuid,uuid,text,integer,jsonb)'::REGPROCEDURE) AND acl.grantee=0 AND acl.privilege_type='EXECUTE'),'PUBLIC has no new session/service execution grant');
ROLLBACK;
\echo UNIVERSITY_FORM_EXPORT_SQL_BEHAVIOR_VERIFIED
