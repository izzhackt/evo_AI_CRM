\set ON_ERROR_STOP on
-- Actual PostgreSQL/authenticated RPC behavior with synthetic rows. Owner-only
-- inserted receipt metadata is NOT actual upload, ClamAV or native inspection.
BEGIN;
CREATE FUNCTION pg_temp.uf_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
 SELECT ('65165000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.uf_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Registry SQL: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.uf_error(command TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE TEMP TABLE uf_receipts(key TEXT PRIMARY KEY,body JSONB NOT NULL);
-- The expected hashes are also pinned in Node tests via the existing resolver.
SELECT pg_temp.uf_assert(encode(sha256(convert_to(platform_private.university_form_mapping_content(pg_temp.uf_id(701),pg_temp.uf_id(601),repeat('a',64),
 '[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false}]',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),'UTF8')),'hex')='e7cb953650c43e8bcf49b645221cff71d670f935c52f17ed62eb9c76e62dd618','SQL matches existing DOCX mapping canonical hash');
SELECT pg_temp.uf_assert(encode(sha256(convert_to(platform_private.university_form_mapping_content(pg_temp.uf_id(701),pg_temp.uf_id(601),repeat('a',64),
 '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1.0,"x":0.001,"y":23.125,"width":50.000,"height":12.0,"characterCount":10}}]',
 'application/pdf'),'UTF8')),'hex')='7fbafa6e9f82ac87f19f5054e9be0d6c2e0eb63283ba8781295f4327b6700a8b','SQL normalizes decimals to existing PDF hash');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform_private.university_form_mapping_content(%L,%L,%L,%L,%L)',
 pg_temp.uf_id(701),pg_temp.uf_id(601),repeat('a',64),m,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))='22023','invalid mapping rejected')
 FROM (VALUES
 ('[]'),
 ('[{"slotId":"p-1","sourceKey":"guessed_value","required":true,"format":"text","manual":false}]'),
 ('[{"slotId":"p-1","sourceKey":null,"required":true,"format":"text","manual":false}]'),
 ('[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"DD","manual":false}]'),
 ('[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"text","manual":true}]'),
 ('[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"value":"forbidden"}]'))bad(m);
SELECT pg_temp.uf_assert(NOT platform_private.university_form_manifest_valid(m::JSONB,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),'malformed proof manifest fails closed')
 FROM (VALUES
 ('{"format":"docx","slots":[{"id":"p-1"}],"pageSizes":[]}'),
 ('{"format":"docx","slots":[{"id":"p-1","editable":true},{"id":"p-1","editable":true}],"pageSizes":[]}'),
 ('{"format":"docx","slots":[{"id":"p-1","editable":null}],"pageSizes":[]}'),
 ('{"format":"docx","slots":[],"pageSizes":[{"width":600,"height":800}]}'),
 ('{"format":"pdf","slots":[],"pageSizes":[]}'),
 ('{"format":"docx","slots":[],"pageSizes":[],"privateText":"not allowed"}'))bad(m);
GRANT SELECT,INSERT ON uf_receipts TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION pg_temp.uf_id(INTEGER),pg_temp.uf_assert(BOOLEAN,TEXT),pg_temp.uf_error(TEXT) TO authenticated,service_role;
INSERT INTO platform.organizations(id,name) VALUES(pg_temp.uf_id(1),'Synthetic form organization'),(pg_temp.uf_id(2),'Other synthetic organization');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.uf_id(100+n),'form-registry-'||n||'@example.invalid','{}'::JSONB FROM generate_series(1,4)n;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
 SELECT pg_temp.uf_id(200+n),pg_temp.uf_id(100+n),'Synthetic form staff '||n,'active',1 FROM generate_series(1,4)n;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
 SELECT pg_temp.uf_id(300+n),pg_temp.uf_id(CASE WHEN n=4 THEN 2 ELSE 1 END),pg_temp.uf_id(200+n),'active',
  CASE WHEN n IN (2,3) THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END,
  (SELECT id FROM platform.role_bundle_versions WHERE role=CASE WHEN n IN (2,3) THEN 'sales'::platform.business_role ELSE 'admin'::platform.business_role END
   AND status='published' ORDER BY version DESC LIMIT 1),n IN (1,4) FROM generate_series(1,4)n;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.uf_id(101),'claims',jsonb_build_object('sub',pg_temp.uf_id(101),'role','authenticated')))->'claims')::TEXT AS uf_admin \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.uf_id(103),'claims',jsonb_build_object('sub',pg_temp.uf_id(103),'role','authenticated')))->'claims')::TEXT AS uf_denied \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.uf_id(104),'claims',jsonb_build_object('sub',pg_temp.uf_id(104),'role','authenticated')))->'claims')::TEXT AS uf_other \gset
SET LOCAL request.jwt.claims TO :'uf_admin';
SET LOCAL ROLE authenticated;
-- Real existing catalogue review commands, not a new name-based catalogue.
SELECT platform.register_workflow_source(pg_temp.uf_id(1),'src_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','google_spreadsheet',
 'https://docs.google.com/spreadsheets/d/1TemplateRegistrySynthetic000000000/edit','registry-source-v1','Synthetic source',pg_temp.uf_id(700))::TEXT AS uf_source \gset
SELECT platform.review_workflow_source(pg_temp.uf_id(1),:'uf_source','reviewed','Synthetic source review',pg_temp.uf_id(701));
INSERT INTO uf_receipts SELECT 'batch',platform.create_catalog_import_batch(pg_temp.uf_id(1),:'uf_source','university','Synthetic catalogue',pg_temp.uf_id(702));
SELECT (body->>'catalog_import_batch_id')::UUID AS uf_batch FROM uf_receipts WHERE key='batch' \gset
SELECT platform.stage_catalog_import_candidate(pg_temp.uf_id(1),:'uf_batch','rec_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
 'Synthetic Form University','MY','Synthetic city','Synthetic candidate',pg_temp.uf_id(703));
SELECT platform.validate_catalog_import_batch(pg_temp.uf_id(1),:'uf_batch','Synthetic validation',pg_temp.uf_id(704));
SELECT platform.review_catalog_import_batch(pg_temp.uf_id(1),:'uf_batch','approve','Synthetic approval',pg_temp.uf_id(705));
RESET ROLE;
SELECT id AS uf_catalog FROM platform.catalog_institutions WHERE organization_id=pg_temp.uf_id(1) \gset
INSERT INTO uf_receipts VALUES('catalog',jsonb_build_object('id',:'uf_catalog'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.uf_assert(platform.staff_published_university_forms(:'uf_catalog')->'items'='[]'::JSONB,'empty read stays empty');
INSERT INTO uf_receipts SELECT 'create',platform.create_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(501),:'uf_catalog','Synthetic application',0,'Create template',pg_temp.uf_id(710));
INSERT INTO uf_receipts SELECT 'replay',platform.create_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(501),:'uf_catalog','Synthetic application',0,'Create template',pg_temp.uf_id(710));
SELECT pg_temp.uf_assert((SELECT body->>'replayed'='true' AND body-'replayed'=(SELECT body-'replayed' FROM uf_receipts WHERE key='create') FROM uf_receipts WHERE key='replay'),'exact replay retains receipt');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.create_university_form_template(%L,%L,%L,%L,0,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(501),:'uf_catalog','Changed title','Create template',pg_temp.uf_id(710)))='23505','changed replay conflicts');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.archive_university_form_template(%L,%L,0,%L,%L)',pg_temp.uf_id(1),pg_temp.uf_id(501),'Stale',pg_temp.uf_id(711)))='40001','stale revision denied');
INSERT INTO uf_receipts SELECT 'version',platform.reserve_university_form_version(pg_temp.uf_id(1),pg_temp.uf_id(501),repeat('a',64),128,
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Synthetic public blank','2026-09-14',1,'Reserve only',pg_temp.uf_id(712));
SELECT (body->>'target_id')::UUID AS uf_version FROM uf_receipts WHERE key='version' \gset
INSERT INTO uf_receipts SELECT 'draft-workspace',platform.staff_university_form_workspace(pg_temp.uf_id(501));
SELECT pg_temp.uf_assert((SELECT body->'selected_version'->>'inspection'='pending' AND body->'publication'='null'::JSONB FROM uf_receipts WHERE key='draft-workspace'),'declared hash is not inspection or publication');
INSERT INTO uf_receipts SELECT 'mapping',platform.save_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_version',repeat('a',64),
 '[{"slotId":"p-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false}]',2,'Draft exact mapping',pg_temp.uf_id(713));
SELECT platform.staff_university_form_workspace(pg_temp.uf_id(501))->'mappings'->0->>'sha256' AS uf_mapping_hash \gset
INSERT INTO uf_receipts VALUES('mapping-hash',to_jsonb(:'uf_mapping_hash'::TEXT));
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.review_university_form_mapping(%L,%L,%L,%L,%L,3,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash','approved','No proof yet',pg_temp.uf_id(714)))='55000','approval denies missing inspection');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.publish_university_form_template(%L,%L,%L,%L,%L,3,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash',pg_temp.uf_id(999),'No review',pg_temp.uf_id(715)))='55000','publication denies missing review');
RESET ROLE;
SELECT pg_temp.uf_assert(NOT has_table_privilege(role_name,table_name,'INSERT') AND NOT has_table_privilege(role_name,table_name,'UPDATE') AND NOT has_table_privilege(role_name,table_name,'SELECT'),
 'runtime roles cannot write/read private registry: '||role_name||'/'||table_name)
 FROM (VALUES('anon'),('authenticated'),('service_role'),('supabase_auth_admin'))r(role_name)
 CROSS JOIN (VALUES('platform_private.university_form_templates'),('platform_private.university_form_template_versions'),
 ('platform_private.university_form_mapping_versions'),('platform_private.university_form_mapping_reviews'),
 ('platform_private.university_form_inspection_receipts'),('platform_private.university_form_command_receipts'))t(table_name);
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('UPDATE platform_private.university_form_template_versions SET sha256=%L WHERE id=%L',repeat('b',64),:'uf_version'))='55000','source metadata immutable');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('UPDATE platform_private.university_form_mapping_versions SET mappings=%L WHERE id=%L','[]',pg_temp.uf_id(601)))='55000','mapping immutable');
-- Domain fixture ONLY. No runtime role or installed RPC can insert this proof.
INSERT INTO platform_private.university_form_inspection_receipts(organization_id,template_id,template_version_id,source_sha256,source_byte_size,
 source_mime_type,source_object_name,scan_signature_revision,inspector_revision,inspector_image_sha256,manifest_sha256,manifest)
 SELECT v.organization_id,v.template_id,v.id,v.sha256,v.byte_size,v.mime_type,v.object_name,'synthetic-clamav-1','evo-university-template-v1','sha256:'||repeat('1',64),
 platform_private.bw1_input_sha256(manifest),manifest FROM platform_private.university_form_template_versions v
 CROSS JOIN (SELECT '{"format":"docx","slots":[{"id":"p-1","editable":true}],"pageSizes":[]}'::JSONB manifest)f WHERE v.id=:'uf_version';
SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'review',platform.review_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash','approved',3,'Synthetic manifest reviewed',pg_temp.uf_id(716));
SELECT (body->>'target_id')::UUID AS uf_review FROM uf_receipts WHERE key='review' \gset
INSERT INTO uf_receipts SELECT 'publish',platform.publish_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash',:'uf_review',4,'Publish synthetic registry tuple',pg_temp.uf_id(717));
SELECT pg_temp.uf_assert(jsonb_array_length(platform.staff_published_university_forms(:'uf_catalog')->'items')=1,'exact reviewed tuple published');
INSERT INTO uf_receipts SELECT 'version-two',platform.reserve_university_form_version(pg_temp.uf_id(1),pg_temp.uf_id(501),repeat('a',64),128,
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Same bytes new version','2026-09-14',5,'Reserve another version',pg_temp.uf_id(718));
SELECT pg_temp.uf_assert(platform.staff_university_form_workspace(pg_temp.uf_id(501))->'publication'->>'template_version_id'=:'uf_version'
 AND platform.staff_university_form_workspace(pg_temp.uf_id(501))->'selected_version'->>'inspection'='pending','same hash new version does not inherit proof or overwrite publication');
SELECT pg_temp.uf_assert(platform.staff_university_form_workspace(pg_temp.uf_id(501),:'uf_version')->'selected_version'->>'id'=:'uf_version','exact historical source readable');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_other'; SET LOCAL ROLE authenticated;
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.staff_university_form_workspace(%L)',pg_temp.uf_id(501)))='42501','cross-tenant Admin read denied');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.create_university_form_template(%L,%L,%L,%L,0,%L,%L)',
 pg_temp.uf_id(2),pg_temp.uf_id(502),:'uf_catalog','Wrong tenant','Wrong catalog',pg_temp.uf_id(719)))='42501','catalog composite tenant denied');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_denied'; SET LOCAL ROLE authenticated;
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.staff_university_form_workspace(%L)',pg_temp.uf_id(501)))='42501','ungranted Sales cannot inspect drafts');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_admin'; SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'role',platform.staff_role_command(pg_temp.uf_id(1),pg_temp.uf_id(801),0,'create',
 '{"label":"Synthetic form manager","description":"Registry proof","permissionKeys":["catalog.read","catalog.import.manage"]}','Create role',pg_temp.uf_id(720));
INSERT INTO uf_receipts SELECT 'role-publish',platform.staff_role_publish(pg_temp.uf_id(1),pg_temp.uf_id(801),1,
 platform.staff_role_impact(pg_temp.uf_id(1),pg_temp.uf_id(801),1)->>'impactFingerprint','Publish role',pg_temp.uf_id(721));
SELECT platform.staff_role_command(pg_temp.uf_id(1),pg_temp.uf_id(802),0,'create',
 '{"label":"Synthetic published form reader","description":"Registry reader proof","permissionKeys":["catalog.read"]}','Reader role',pg_temp.uf_id(728));
SELECT platform.staff_role_publish(pg_temp.uf_id(1),pg_temp.uf_id(802),1,
 platform.staff_role_impact(pg_temp.uf_id(1),pg_temp.uf_id(802),1)->>'impactFingerprint','Publish reader role',pg_temp.uf_id(729));
RESET ROLE;
INSERT INTO uf_receipts SELECT 'bindings',jsonb_build_array(jsonb_build_object('roleId',r.id,'roleVersion',r.version,'bundleId',r.current_bundle_id,'bundleVersion',b.version))
 FROM platform.staff_role_definitions r JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id WHERE r.id=pg_temp.uf_id(801);
INSERT INTO uf_receipts VALUES('assignment',jsonb_build_array(jsonb_build_object('roleId',pg_temp.uf_id(801),'scope',jsonb_build_object('kind','organization','key',pg_temp.uf_id(1),'resourceKind',NULL))));
INSERT INTO uf_receipts SELECT 'reader-bindings',jsonb_build_array(jsonb_build_object('roleId',r.id,'roleVersion',r.version,'bundleId',r.current_bundle_id,'bundleVersion',b.version))
 FROM platform.staff_role_definitions r JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id WHERE r.id=pg_temp.uf_id(802);
SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'assign',platform.staff_role_assignments_save(pg_temp.uf_id(1),pg_temp.uf_id(302),1,
 (SELECT body FROM uf_receipts WHERE key='assignment'),(SELECT body FROM uf_receipts WHERE key='bindings'),'Assign actual scoped role',pg_temp.uf_id(722));
SELECT platform.staff_role_assignments_save(pg_temp.uf_id(1),pg_temp.uf_id(303),1,
 jsonb_build_array(jsonb_build_object('roleId',pg_temp.uf_id(802),'scope',jsonb_build_object('kind','organization','key',pg_temp.uf_id(1),'resourceKind',NULL))),
 (SELECT body FROM uf_receipts WHERE key='reader-bindings'),'Assign catalog reader',pg_temp.uf_id(731));
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.uf_id(103),'claims',jsonb_build_object('sub',pg_temp.uf_id(103),'role','authenticated')))->'claims')::TEXT AS uf_reader \gset
SET LOCAL request.jwt.claims TO :'uf_reader'; SET LOCAL ROLE authenticated;
SELECT pg_temp.uf_assert(jsonb_array_length(platform.staff_published_university_forms(:'uf_catalog')->'items')=1
 AND platform.staff_university_form_workspace(pg_temp.uf_id(501))->>'can_manage'='false'
 AND jsonb_array_length(platform.staff_university_form_workspace(pg_temp.uf_id(501))->'versions')=1,
 'catalog reader selects only the exact published version, no drafts');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.staff_university_form_workspace(%L,%L)',pg_temp.uf_id(501),
 (SELECT body->>'target_id' FROM uf_receipts WHERE key='version-two')))='42501','catalog reader cannot request uninspected draft version');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.archive_university_form_template(%L,%L,6,%L,%L)',pg_temp.uf_id(1),pg_temp.uf_id(501),'Reader cannot mutate',pg_temp.uf_id(732)))='42501','catalog read grants no management');
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.uf_id(102),'claims',jsonb_build_object('sub',pg_temp.uf_id(102),'role','authenticated')))->'claims')::TEXT AS uf_manager \gset
SET LOCAL request.jwt.claims TO :'uf_manager'; SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'manager-read',platform.staff_university_form_workspace(pg_temp.uf_id(501));
SELECT pg_temp.uf_assert((SELECT body->>'can_manage'='true' FROM uf_receipts WHERE key='manager-read'),'custom role works without Admin label');
INSERT INTO uf_receipts SELECT 'manager-reject',platform.review_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash','rejected',6,'Withdraw synthetic mapping approval',pg_temp.uf_id(723));
SELECT pg_temp.uf_assert(platform.staff_published_university_forms(:'uf_catalog')->'items'='[]'::JSONB,'reject immediately removes published selection');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.publish_university_form_template(%L,%L,%L,%L,%L,7,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash',:'uf_review','Stale approval',pg_temp.uf_id(724)))='55000','old approved review cannot bypass rejection');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_admin'; SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'revoke',platform.staff_role_assignments_save(pg_temp.uf_id(1),pg_temp.uf_id(302),2,'[]','[]','Revoke scoped manager',pg_temp.uf_id(725));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_manager'; SET LOCAL ROLE authenticated;
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.review_university_form_mapping(%L,%L,%L,%L,%L,6,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(501),pg_temp.uf_id(601),:'uf_mapping_hash','rejected','Withdraw synthetic mapping approval',pg_temp.uf_id(723)))='42501','revoked old session cannot replay');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'uf_admin'; SET LOCAL ROLE authenticated;
INSERT INTO uf_receipts SELECT 'archive',platform.archive_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(501),7,'Archive without deletion',pg_temp.uf_id(726));
SELECT pg_temp.uf_assert(platform.staff_university_form_workspace(pg_temp.uf_id(501))->'template'->>'archived'='true','archive retains readable history');
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.archive_university_form_template(%L,%L,8,%L,%L)',pg_temp.uf_id(1),pg_temp.uf_id(501),'Already archived',pg_temp.uf_id(727)))='55000','archive cannot be edited');
RESET ROLE;
SELECT pg_temp.uf_assert((SELECT count(*)=2 FROM platform_private.university_form_template_versions WHERE template_id=pg_temp.uf_id(501))
 AND (SELECT count(*)=2 FROM platform_private.university_form_mapping_reviews WHERE template_id=pg_temp.uf_id(501)),'archive/rejection preserve immutable history');
SET LOCAL request.jwt.claims TO :'uf_admin'; SET LOCAL ROLE authenticated;
SELECT platform.create_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(505),:'uf_catalog','Pagination source',0,'Create pagination fixture',pg_temp.uf_id(730));
DO $$BEGIN
 FOR n IN 1..22 LOOP
  PERFORM platform.reserve_university_form_version(pg_temp.uf_id(1),pg_temp.uf_id(505),repeat('c',64),128,'application/pdf',
   'Synthetic uninspected version','2026-09-14',n,'Exercise real keyset history',pg_temp.uf_id(740+n));
 END LOOP;
END $$;
SELECT pg_temp.uf_assert(jsonb_array_length(platform.staff_university_form_workspace(pg_temp.uf_id(505))->'versions')=20
 AND (platform.staff_university_form_workspace(pg_temp.uf_id(505))->>'next_version_before')::BIGINT=4,
 'workspace keyset page retains most recent20 source versions');
SELECT pg_temp.uf_assert(jsonb_array_length(platform.staff_university_form_workspace(pg_temp.uf_id(505),NULL,4)->'versions')=2
 AND platform.staff_university_form_workspace(pg_temp.uf_id(505),NULL,4)->'next_version_before'='null'::JSONB,
 'older source versions remain available on next page');
SELECT platform.create_university_form_template(pg_temp.uf_id(1),pg_temp.uf_id(506),:'uf_catalog','PDF source',0,'Create PDF fixture',pg_temp.uf_id(770));
INSERT INTO uf_receipts SELECT 'pdf-version',platform.reserve_university_form_version(pg_temp.uf_id(1),pg_temp.uf_id(506),repeat('d',64),256,
 'application/pdf','Synthetic passive PDF','2026-09-14',1,'Reserve PDF only',pg_temp.uf_id(771));
SELECT (body->>'target_id')::UUID AS uf_pdf_version FROM uf_receipts WHERE key='pdf-version' \gset
SELECT platform.save_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(901),:'uf_pdf_version',repeat('d',64),
 '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":10,"y":10,"width":200,"height":20}}]',
 2,'Valid PDF mapping',pg_temp.uf_id(772));
SELECT platform.save_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(902),:'uf_pdf_version',repeat('d',64),
 '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":10,"y":10,"width":200,"height":20}},
 {"slotId":"pdf-2","sourceKey":"student_last_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":20,"y":10,"width":200,"height":20}}]',
 3,'Overlapping PDF draft',pg_temp.uf_id(773));
SELECT platform.save_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(903),:'uf_pdf_version',repeat('d',64),
 '[{"slotId":"pdf-1","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":550,"y":10,"width":200,"height":20}}]',
 4,'Outside-page PDF draft',pg_temp.uf_id(774));
SELECT platform.save_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(904),:'uf_pdf_version',repeat('d',64),
 '[{"slotId":"pdf-3","sourceKey":"student_first_name","required":true,"format":"text","manual":false,"position":{"page":1,"x":10,"y":50,"width":200,"height":20}}]',
 5,'Manual source slot cannot be filled',pg_temp.uf_id(775));
RESET ROLE;
INSERT INTO platform_private.university_form_inspection_receipts(organization_id,template_id,template_version_id,source_sha256,source_byte_size,
 source_mime_type,source_object_name,scan_signature_revision,inspector_revision,inspector_image_sha256,manifest_sha256,manifest)
 SELECT v.organization_id,v.template_id,v.id,v.sha256,v.byte_size,v.mime_type,v.object_name,'synthetic-clamav-1','evo-university-template-v1','sha256:'||repeat('2',64),
 platform_private.bw1_input_sha256(manifest),manifest FROM platform_private.university_form_template_versions v
 CROSS JOIN (SELECT '{"format":"pdf","slots":[{"id":"pdf-1","editable":true},{"id":"pdf-2","editable":true},{"id":"pdf-3","editable":false}],"pageSizes":[{"width":600,"height":800}]}'::JSONB manifest)f WHERE v.id=:'uf_pdf_version';
SELECT pg_temp.uf_assert(platform_private.university_form_mapping_inspected(m)=(m.id=pg_temp.uf_id(901)),
 'PDF source geometry/manual guards on mapping '||m.id::TEXT) FROM platform_private.university_form_mapping_versions m WHERE m.template_id=pg_temp.uf_id(506);
INSERT INTO uf_receipts SELECT 'pdf-mapping-hashes',jsonb_object_agg(id::TEXT,sha256) FROM platform_private.university_form_mapping_versions WHERE template_id=pg_temp.uf_id(506);
SET LOCAL ROLE authenticated;
SELECT platform.review_university_form_mapping(pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(901),
 (SELECT body->>pg_temp.uf_id(901)::TEXT FROM uf_receipts WHERE key='pdf-mapping-hashes'),'approved',6,'Approve exact valid synthetic geometry',pg_temp.uf_id(776));
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.review_university_form_mapping(%L,%L,%L,%L,%L,7,%L,%L)',
 pg_temp.uf_id(1),pg_temp.uf_id(506),pg_temp.uf_id(n),(SELECT body->>pg_temp.uf_id(n)::TEXT FROM uf_receipts WHERE key='pdf-mapping-hashes'),
 'approved','Deny bad geometry',pg_temp.uf_id(800+n)))='55000','cannot approve overlapping/outside/manual source mapping') FROM generate_series(902,904)n;
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}'; SET LOCAL ROLE service_role;
SELECT pg_temp.uf_assert(pg_temp.uf_error(format('SELECT platform.staff_university_form_workspace(%L)',pg_temp.uf_id(501)))='42501','service cannot impersonate workspace');
RESET ROLE;
SELECT 'UNIVERSITY_FORM_REGISTRY_SYNTHETIC_COMMANDS_PASS' AS proof;
ROLLBACK;
