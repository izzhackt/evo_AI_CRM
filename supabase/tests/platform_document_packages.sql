\set ON_ERROR_STOP on
-- Isolated rollback-only authority/lifecycle probes. Scanner and Storage rows
-- below are explicit synthetic observations, NOT actual byte/provider proof.
BEGIN;
CREATE FUNCTION pg_temp.pk_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
 SELECT ('64169000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.pk_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Package SQL: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.pk_error(command TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE TEMP TABLE pk_receipts(key TEXT PRIMARY KEY,body JSONB NOT NULL);
CREATE FUNCTION pg_temp.pk_body(p_key TEXT) RETURNS JSONB LANGUAGE SQL STABLE AS $$ SELECT body FROM pg_temp.pk_receipts WHERE key=p_key $$;
CREATE FUNCTION pg_temp.pk_artifact(p_key TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT (pg_temp.pk_body(p_key)->'artifact'->>'id')::UUID $$;
CREATE FUNCTION pg_temp.pk_claim(p_key TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT (pg_temp.pk_body(p_key)->>'claim_token')::UUID $$;
GRANT SELECT,INSERT ON pk_receipts TO authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated,service_role;

INSERT INTO platform.organizations(id,name) VALUES(pg_temp.pk_id(1),'Synthetic package organization');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(pg_temp.pk_id(101),'package-proof@example.invalid','{}');
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
 VALUES(pg_temp.pk_id(201),pg_temp.pk_id(101),'Synthetic package staff','active',1);
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
 SELECT pg_temp.pk_id(301),pg_temp.pk_id(1),pg_temp.pk_id(201),'active','admin',id,TRUE
 FROM platform.role_bundle_versions WHERE role='admin' AND status='published' ORDER BY version DESC LIMIT 1;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.pk_id(401),pg_temp.pk_id(1),'student_case',pg_temp.pk_id(501),1);
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
 target_country,target_degree,program_direction,state,current_scope_id,current_scope_version)
 VALUES(pg_temp.pk_id(501),pg_temp.pk_id(1),pg_temp.pk_id(301),'synthetic:package','Synthetic package student',
 'China','Bachelor','Engineering','pending',pg_temp.pk_id(401),1);
UPDATE platform.record_scopes SET is_active=FALSE WHERE id=pg_temp.pk_id(401);
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.pk_id(402),pg_temp.pk_id(1),'student_case',pg_temp.pk_id(501),2);
UPDATE platform.student_cases SET state='active',current_curator_membership_id=pg_temp.pk_id(301),handoff_at=statement_timestamp(),
 current_scope_id=pg_temp.pk_id(402),current_scope_version=2 WHERE id=pg_temp.pk_id(501);
INSERT INTO platform.university_applications(id,organization_id,student_case_id,institution_name,program_name,status,created_by_membership_id)
 VALUES(pg_temp.pk_id(601),pg_temp.pk_id(1),pg_temp.pk_id(501),'Synthetic University','Engineering','preparation',pg_temp.pk_id(301));
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.pk_id(101),
 'claims',jsonb_build_object('sub',pg_temp.pk_id(101),'role','authenticated')))->'claims')::TEXT AS pk_admin \gset
SET LOCAL request.jwt.claims TO :'pk_admin'; SET LOCAL ROLE authenticated;
INSERT INTO pk_receipts SELECT 'slot',platform.create_custom_document_slot(pg_temp.pk_id(1),pg_temp.pk_id(501),
 'Synthetic original','Isolated SQL evidence',pg_temp.pk_id(701));
RESET ROLE;
INSERT INTO storage.buckets(id,name,public) VALUES('platform-documents','platform-documents',FALSE) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}'; SET LOCAL ROLE service_role;
INSERT INTO pk_receipts SELECT 'upload',platform.reserve_document_upload_after_ingress_scan(pg_temp.pk_id(1),pg_temp.pk_id(101),
 (pg_temp.pk_body('slot')->>'document_slot_id')::UUID,'synthetic-original.pdf','application/pdf',2048,
 repeat('b',64),'clean','ClamAV','1.5.4','27890','clamd-zinstream-v1',statement_timestamp(),pg_temp.pk_id(702));
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata,created_at) SELECT body->>'bucket_id',body->>'object_name',
 jsonb_build_object('size',2048,'mimetype','application/pdf'),statement_timestamp() FROM pk_receipts WHERE key='upload';
SET LOCAL ROLE service_role;
SELECT platform.finalize_document_upload_with_scan(pg_temp.pk_id(1),(pg_temp.pk_body('upload')->>'upload_reservation_id')::UUID,
 'ClamAV','1.5.4','27890','clamd-zinstream-v1',repeat('b',64),statement_timestamp(),pg_temp.pk_id(703));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'pk_admin'; SET LOCAL ROLE authenticated;
SELECT platform.review_document_version(pg_temp.pk_id(1),(pg_temp.pk_body('upload')->>'document_version_id')::UUID,
 'approved','Approve isolated source',pg_temp.pk_id(704));
INSERT INTO pk_receipts SELECT 'workspace',platform.partner_packet_workspace_v2(pg_temp.pk_id(501));
SELECT pg_temp.pk_assert(jsonb_array_length(pg_temp.pk_body('workspace')->'files')=1,'one real canonical approved SQL version');
INSERT INTO pk_receipts SELECT 'packet',platform.prepare_partner_packet_v2(pg_temp.pk_id(501),pg_temp.pk_id(601),
 ARRAY[(pg_temp.pk_body('upload')->>'document_version_id')::UUID],pg_temp.pk_id(705),'{}',pg_temp.pk_body('workspace')->>'workspaceRevision');
INSERT INTO pk_receipts SELECT 'packet-repeat',platform.prepare_partner_packet_v2(pg_temp.pk_id(501),pg_temp.pk_id(601),
 ARRAY[(pg_temp.pk_body('upload')->>'document_version_id')::UUID],pg_temp.pk_id(705),'{}',pg_temp.pk_body('workspace')->>'workspaceRevision');
SELECT pg_temp.pk_assert(pg_temp.pk_body('packet')=pg_temp.pk_body('packet-repeat'),'packet exact replay');
SELECT pg_temp.pk_assert(pg_temp.pk_error(format('SELECT platform.prepare_partner_packet_v2(%L,%L,ARRAY[%L::uuid],%L,%L::uuid[],%L)',
 pg_temp.pk_id(501),pg_temp.pk_id(601),pg_temp.pk_id(999),pg_temp.pk_id(706),'{}',pg_temp.pk_body('workspace')->>'workspaceRevision'))='55000',
 'one unavailable selected item fails entire preparation');
INSERT INTO pk_receipts SELECT 'prepared',platform.prepare_document_package_export(pg_temp.pk_id(501),(pg_temp.pk_body('packet')->>'id')::UUID,
 'final',pg_temp.pk_body('packet')->>'revision',pg_temp.pk_id(707));
RESET ROLE;
SELECT pg_temp.pk_assert(NOT EXISTS(SELECT 1 FROM platform.student_profiles WHERE student_case_id=pg_temp.pk_id(501)),
 'original-only package never invents a Student Profile');
SELECT pg_temp.pk_assert((SELECT student_profile_id IS NULL AND profile_revision IS NULL AND template_sha256 IS NULL AND field_reviews_sha256 IS NULL
 FROM platform_private.document_export_artifacts WHERE id=pg_temp.pk_artifact('prepared')),'package has explicit null profile fields');
SELECT pg_temp.pk_assert(NOT has_function_privilege('service_role','platform.prepare_document_package_export(uuid,uuid,text,text,uuid)','EXECUTE'),
 'service cannot prepare session snapshots');
SELECT pg_temp.pk_assert(NOT has_function_privilege('authenticated','platform.read_document_package_export_sources(uuid,uuid,uuid,uuid)','EXECUTE'),
 'browser cannot read private source locations');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}'; SET LOCAL ROLE service_role;
INSERT INTO pk_receipts SELECT 'begun',platform.begin_document_export((pg_temp.pk_body('prepared')->>'preparation_id')::UUID,pg_temp.pk_id(101),pg_temp.pk_id(301));
INSERT INTO pk_receipts SELECT 'sources',platform.read_document_package_export_sources(pg_temp.pk_artifact('begun'),pg_temp.pk_claim('begun'),pg_temp.pk_id(101),pg_temp.pk_id(301));
SELECT pg_temp.pk_assert(jsonb_array_length(pg_temp.pk_body('sources')->'sources')=1,'exact claim gets one captured source');
SELECT pg_temp.pk_assert(pg_temp.pk_error(format('SELECT platform.seal_document_export_output(%L,%L,%L,52428801,NULL)',
 pg_temp.pk_artifact('begun'),pg_temp.pk_claim('begun'),repeat('a',64)))='22023','50MiB+1 rejected');
INSERT INTO pk_receipts SELECT 'sealed',platform.seal_document_export_output(pg_temp.pk_artifact('begun'),pg_temp.pk_claim('begun'),repeat('a',64),52428800,NULL);
SELECT pg_temp.pk_assert(pg_temp.pk_body('sealed')->'storage'->>'object_name' LIKE '%.zip','shared exact immutable ZIP key');
INSERT INTO pk_receipts SELECT 'ready',platform.complete_document_export(pg_temp.pk_artifact('begun'),pg_temp.pk_claim('begun'),'ready',NULL,repeat('a',64),52428800);
SELECT pg_temp.pk_assert(pg_temp.pk_body('ready')->>'state'='ready' AND pg_temp.pk_body('ready')->>'historical'='false'
 AND pg_temp.pk_body('ready')->>'can_download'='true','original-only package ready/current/downloadable');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'pk_admin'; SET LOCAL ROLE authenticated;
INSERT INTO pk_receipts SELECT 'history',platform.staff_document_export_workspace_v2(pg_temp.pk_id(501));
SELECT pg_temp.pk_assert(pg_temp.pk_body('history')->'profile'='null'::JSONB AND pg_temp.pk_body('history')->>'can_export'='false'
 AND jsonb_array_length(pg_temp.pk_body('history')->'artifacts')=1,'shared history supports no-profile ZIP');
INSERT INTO pk_receipts SELECT 'grant',platform.grant_document_export_download(pg_temp.pk_artifact('begun'),pg_temp.pk_id(708));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}'; SET LOCAL ROLE service_role;
SELECT platform.consume_document_export_download((pg_temp.pk_body('grant')->>'grant_id')::UUID,pg_temp.pk_id(101),pg_temp.pk_id(301));
INSERT INTO pk_receipts SELECT 'download',platform.complete_document_export_download((pg_temp.pk_body('grant')->>'grant_id')::UUID,
 pg_temp.pk_id(101),pg_temp.pk_id(301),repeat('a',64),52428800);
SELECT pg_temp.pk_assert(pg_temp.pk_body('download')->>'verified'='true','50MiB download lifecycle works');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'pk_admin'; SET LOCAL ROLE authenticated;
INSERT INTO pk_receipts SELECT 'prepared-recovery',platform.prepare_document_package_export(pg_temp.pk_id(501),(pg_temp.pk_body('packet')->>'id')::UUID,
 'final',pg_temp.pk_body('packet')->>'revision',pg_temp.pk_id(710));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}'; SET LOCAL ROLE service_role;
INSERT INTO pk_receipts SELECT 'begun-recovery',platform.begin_document_export((pg_temp.pk_body('prepared-recovery')->>'preparation_id')::UUID,
 pg_temp.pk_id(101),pg_temp.pk_id(301));
SELECT platform.seal_document_export_output(pg_temp.pk_artifact('begun-recovery'),pg_temp.pk_claim('begun-recovery'),repeat('c',64),52428800,NULL);
INSERT INTO pk_receipts SELECT 'unknown',platform.complete_document_export(pg_temp.pk_artifact('begun-recovery'),pg_temp.pk_claim('begun-recovery'),
 'unknown','storage_unavailable',NULL,NULL);
SELECT pg_temp.pk_assert(pg_temp.pk_body('unknown')->>'state'='unknown','uncertain upload remains unconfirmed');
SELECT platform.inspect_document_export_reconciliation(pg_temp.pk_artifact('begun-recovery'),pg_temp.pk_id(101),pg_temp.pk_id(301));
SELECT pg_temp.pk_assert(pg_temp.pk_error(format('SELECT platform.reconcile_document_export(%L,%L,%L,%L,%L,52428801,NULL)',
 pg_temp.pk_artifact('begun-recovery'),pg_temp.pk_id(101),pg_temp.pk_id(301),pg_temp.pk_id(711),repeat('c',64)))='22023',
 'reconciliation does not lift50MiB cap');
INSERT INTO pk_receipts SELECT 'reconciled',platform.reconcile_document_export(pg_temp.pk_artifact('begun-recovery'),
 pg_temp.pk_id(101),pg_temp.pk_id(301),pg_temp.pk_id(712),repeat('c',64),52428800,NULL);
INSERT INTO pk_receipts SELECT 'reconciled-repeat',platform.reconcile_document_export(pg_temp.pk_artifact('begun-recovery'),
 pg_temp.pk_id(101),pg_temp.pk_id(301),pg_temp.pk_id(712),repeat('c',64),52428800,NULL);
SELECT pg_temp.pk_assert(pg_temp.pk_body('reconciled')->>'state'='ready' AND pg_temp.pk_body('reconciled')=pg_temp.pk_body('reconciled-repeat'),
 '50MiB unknown→reconcile→ready replay retains exact saved identity');
RESET ROLE;
UPDATE platform.document_versions SET malware_status='infected' WHERE id=(pg_temp.pk_body('upload')->>'document_version_id')::UUID;
SET LOCAL request.jwt.claims TO :'pk_admin'; SET LOCAL ROLE authenticated;
SELECT pg_temp.pk_assert(pg_temp.pk_error(format('SELECT platform.grant_document_export_download(%L,%L)',
 pg_temp.pk_artifact('begun'),pg_temp.pk_id(709)))='42501','ready archive cannot bypass current malware safety');
RESET ROLE;
ROLLBACK;
\echo DOCUMENT_PACKAGE_SQL_BEHAVIOR_VERIFIED
