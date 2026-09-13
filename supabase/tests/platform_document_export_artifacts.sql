\set ON_ERROR_STOP on
-- Rollback-only D4 SQL behavior, using synthetic staff and case records.
-- Hash parameters represent trusted handler observations, NOT proof of actual
-- rendering, Storage, scanner, browser use or receipt of a file by a person.
BEGIN;
CREATE FUNCTION pg_temp.d4_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
 SELECT ('64164000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.d4_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'D4 SQL proof: %',message; END IF; END $$;
CREATE TEMP TABLE d4_receipts(key TEXT PRIMARY KEY,body JSONB NOT NULL);
GRANT SELECT,INSERT ON d4_receipts TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION pg_temp.d4_id(INTEGER),pg_temp.d4_assert(BOOLEAN,TEXT) TO authenticated,service_role;

INSERT INTO platform.organizations(id,name) VALUES(pg_temp.d4_id(1),'D4 synthetic organization');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.d4_id(100+n),'d4-export-'||n||'@example.invalid','{}'::JSONB FROM generate_series(1,3)n;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
 SELECT pg_temp.d4_id(200+n),pg_temp.d4_id(100+n),'D4 synthetic staff '||n,'active',1 FROM generate_series(1,3)n;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
 SELECT pg_temp.d4_id(300+n),pg_temp.d4_id(1),pg_temp.d4_id(200+n),'active','admin',
  (SELECT id FROM platform.role_bundle_versions WHERE role='admin' AND status='published' ORDER BY version DESC LIMIT 1),TRUE FROM generate_series(1,3)n;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.d4_id(401),pg_temp.d4_id(1),'student_case',pg_temp.d4_id(501),1);
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
 target_country,target_degree,program_direction,state,current_scope_id,current_scope_version)
 VALUES(pg_temp.d4_id(501),pg_temp.d4_id(1),pg_temp.d4_id(301),'synthetic:d4-artifacts','D4 synthetic student',
 'China','Bachelor','Engineering','pending',pg_temp.d4_id(401),1);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.d4_id(101),
 'claims',jsonb_build_object('sub',pg_temp.d4_id(101),'role','authenticated')))->'claims')::TEXT AS d4_author \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.d4_id(102),
 'claims',jsonb_build_object('sub',pg_temp.d4_id(102),'role','authenticated')))->'claims')::TEXT AS d4_admin \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.d4_id(103),
 'claims',jsonb_build_object('sub',pg_temp.d4_id(103),'role','authenticated')))->'claims')::TEXT AS d4_downloader \gset
SET LOCAL request.jwt.claims TO :'d4_author';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'missing',platform.staff_document_export_workspace(pg_temp.d4_id(501));
SELECT pg_temp.d4_assert((SELECT body->'profile'='null'::JSONB AND body->>'can_export'='false' AND body->'artifacts'='[]'::JSONB FROM d4_receipts WHERE key='missing'),
 'workspace read does not create profile or artifact');
INSERT INTO d4_receipts SELECT 'profile',platform.start_student_profile(pg_temp.d4_id(1),pg_temp.d4_id(501),0,'Start synthetic D4 profile',pg_temp.d4_id(701));
INSERT INTO d4_receipts SELECT 'confirmed',platform.review_student_profile_field(pg_temp.d4_id(1),pg_temp.d4_id(501),
 'student_first_name','confirm','Confirmed Name',NULL,NULL,NULL,1,'Confirm synthetic name',pg_temp.d4_id(702));
RESET ROLE;
-- A synthetic upstream unreviewed field checks that preparation does not freeze
-- unconfirmed text. This is not a provider/extraction acceptance claim.
INSERT INTO platform.student_profile_fields(organization_id,student_case_id,student_profile_id,field_key,value,review_state,profile_revision)
 SELECT pg_temp.d4_id(1),pg_temp.d4_id(501),id,'student_last_name','Unconfirmed synthetic name','extracted',revision
 FROM platform.student_profiles WHERE organization_id=pg_temp.d4_id(1) AND student_case_id=pg_temp.d4_id(501);
SELECT pg_temp.d4_assert(NOT has_table_privilege('service_role','platform_private.document_export_input_snapshots','SELECT'),
 'service role has no frozen value table grant');
SELECT pg_temp.d4_assert(NOT has_function_privilege('service_role','platform.prepare_document_export(uuid,text,text,uuid)','EXECUTE'),
 'service role cannot prepare/read values via session RPC');
SELECT pg_temp.d4_assert(NOT has_function_privilege('authenticated','platform.complete_document_export(uuid,uuid,text,text,text,integer)','EXECUTE'),
 'staff cannot mark an artifact ready');
SELECT pg_temp.d4_assert(NOT has_table_privilege('authenticated','platform_private.document_export_artifacts','UPDATE'),
 'staff cannot overwrite publication state');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
DO $$BEGIN
 BEGIN PERFORM frozen_profile FROM platform_private.document_export_input_snapshots;
   RAISE EXCEPTION 'unexpected service snapshot read';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claims TO :'d4_author';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'workspace',platform.staff_document_export_workspace(pg_temp.d4_id(501));
INSERT INTO d4_receipts SELECT 'prepare-a',platform.prepare_document_export(pg_temp.d4_id(501),'draft',
 (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='workspace'),pg_temp.d4_id(801));
INSERT INTO d4_receipts SELECT 'prepare-a-repeat',platform.prepare_document_export(pg_temp.d4_id(501),'draft',
 (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='workspace'),pg_temp.d4_id(801));
SELECT pg_temp.d4_assert((SELECT body=(SELECT body FROM d4_receipts WHERE key='prepare-a') FROM d4_receipts WHERE key='prepare-a-repeat'),
 'exact preparation replay has one snapshot and artifact');
SELECT pg_temp.d4_assert((SELECT (SELECT f->>'value' FROM jsonb_array_elements(body->'frozen_profile'->'fields') f WHERE f->>'field_key'='student_first_name')='Confirmed Name'
 AND (SELECT f->'value' FROM jsonb_array_elements(body->'frozen_profile'->'fields') f WHERE f->>'field_key'='student_last_name')='null'::JSONB
 FROM d4_receipts WHERE key='prepare-a'),'only confirmed values freeze');
DO $$BEGIN
 BEGIN PERFORM platform.prepare_document_export(pg_temp.d4_id(501),'final',
   (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='workspace'),pg_temp.d4_id(801));
   RAISE EXCEPTION 'unexpected changed request acceptance';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM platform.prepare_document_export(pg_temp.d4_id(501),'draft',repeat('0',64),pg_temp.d4_id(899));
   RAISE EXCEPTION 'unexpected stale preparation';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'begin-a',platform.begin_document_export((SELECT (body->>'preparation_id')::UUID FROM d4_receipts WHERE key='prepare-a'),pg_temp.d4_id(101),pg_temp.d4_id(301));
INSERT INTO d4_receipts SELECT 'begin-a-repeat',platform.begin_document_export((SELECT (body->>'preparation_id')::UUID FROM d4_receipts WHERE key='prepare-a'),pg_temp.d4_id(101),pg_temp.d4_id(301));
SELECT pg_temp.d4_assert((SELECT body->>'created'='false' AND body->'claim_token'='null'::JSONB FROM d4_receipts WHERE key='begin-a-repeat'),
 'begin replay does not authorize another render');
SELECT pg_temp.d4_assert((SELECT NOT body ? 'frozen_profile' AND position('Confirmed Name' IN body::TEXT)=0 FROM d4_receipts WHERE key='begin-a'),
 'service beginning contains metadata only');
INSERT INTO d4_receipts SELECT 'seal-a',platform.seal_document_export_output((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-a'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-a'),repeat('a',64),128);
INSERT INTO d4_receipts SELECT 'ready-a',platform.complete_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-a'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-a'),'ready',NULL,repeat('a',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'state'='ready' AND body->>'output_sha256'=repeat('a',64) AND body->>'receipt_id' IS NOT NULL FROM d4_receipts WHERE key='ready-a'),
 'sealed matching observation yields ready receipt');
RESET ROLE;
DO $$BEGIN
 BEGIN UPDATE platform_private.document_export_artifacts SET output_bytes=256 WHERE id=(SELECT (body->>'id')::UUID FROM d4_receipts WHERE key='ready-a');
   RAISE EXCEPTION 'unexpected ready mutation'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN UPDATE platform_private.document_export_input_snapshots SET frozen_profile='{}' WHERE id=(SELECT (body->>'preparation_id')::UUID FROM d4_receipts WHERE key='prepare-a');
   RAISE EXCEPTION 'unexpected frozen mutation'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
SET LOCAL request.jwt.claims TO :'d4_author';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'ready-prepare-replay',platform.prepare_document_export(pg_temp.d4_id(501),'draft',
 (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='workspace'),pg_temp.d4_id(801));
SELECT pg_temp.d4_assert((SELECT body->'frozen_profile'='null'::JSONB AND body->'artifact'->>'state'='ready' FROM d4_receipts WHERE key='ready-prepare-replay'),
 'ready replay never reopens frozen render inputs');
-- Prepare remaining independent requests on the same confirmed revision.
INSERT INTO d4_receipts SELECT 'prepare-'||n,platform.prepare_document_export(pg_temp.d4_id(501),'draft',
 (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='workspace'),pg_temp.d4_id(800+n)) FROM generate_series(2,6)n;
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'begin-'||n,platform.begin_document_export((SELECT (body->>'preparation_id')::UUID FROM d4_receipts WHERE key='prepare-'||n),
 pg_temp.d4_id(101),pg_temp.d4_id(301)) FROM generate_series(2,6)n;
INSERT INTO d4_receipts SELECT 'seal-'||n,platform.seal_document_export_output((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-'||n),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-'||n),repeat(n::TEXT,64),128) FROM generate_series(2,5)n;
INSERT INTO d4_receipts SELECT 'unknown-2',platform.complete_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-2'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-2'),'unknown','storage_unavailable',NULL,NULL);
INSERT INTO d4_receipts SELECT 'inspect-2',platform.inspect_document_export_reconciliation((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-2'),
 pg_temp.d4_id(102),pg_temp.d4_id(302));
SELECT pg_temp.d4_assert((SELECT body->'storage'->>'object_name'=(SELECT body->'storage'->>'object_name' FROM d4_receipts WHERE key='seal-2')
 AND body->'artifact'->>'output_sha256'=repeat('2',64) AND body->'artifact'->>'can_download'='false' FROM d4_receipts WHERE key='inspect-2'),
 'unknown reconciliation uses the same sealed object, not a replacement');
INSERT INTO d4_receipts SELECT 'reconcile-unknown-2',platform.reconcile_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-2'),
 pg_temp.d4_id(102),pg_temp.d4_id(302),pg_temp.d4_id(901),NULL,NULL,'storage_unavailable');
INSERT INTO d4_receipts SELECT 'reconcile-unknown-replay-2',platform.reconcile_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-2'),
 pg_temp.d4_id(102),pg_temp.d4_id(302),pg_temp.d4_id(901),repeat('2',64),128,NULL);
SELECT pg_temp.d4_assert((SELECT body=(SELECT body FROM d4_receipts WHERE key='reconcile-unknown-2')
 AND body->>'state'='unknown' FROM d4_receipts WHERE key='reconcile-unknown-replay-2'),
 'replayed user command keeps its first outcome even when later Storage observation differs');
INSERT INTO d4_receipts SELECT 'reconciled-2',platform.reconcile_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-2'),
 pg_temp.d4_id(102),pg_temp.d4_id(302),pg_temp.d4_id(905),repeat('2',64),128,NULL);
SELECT pg_temp.d4_assert((SELECT body->>'state'='ready' FROM d4_receipts WHERE key='reconciled-2'),'known exact observation reconciles to ready');
INSERT INTO d4_receipts SELECT 'corrupt-3',platform.complete_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-3'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-3'),'ready',NULL,repeat('f',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='integrity_failed' AND body->>'can_download'='false'
 FROM d4_receipts WHERE key='corrupt-3'),'different readback hash commits failure, preserves expected identity');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'d4_author';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'changed-profile',platform.review_student_profile_field(pg_temp.d4_id(1),pg_temp.d4_id(501),
 'student_first_name','confirm','Changed Name',NULL,NULL,NULL,2,'Ordinary edit while export in flight',pg_temp.d4_id(703));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'stale-4',platform.complete_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-4'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-4'),'ready',NULL,repeat('4',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='source_changed' FROM d4_receipts WHERE key='stale-4'),
 'ordinary profile change persists failure without publishing');
INSERT INTO d4_receipts SELECT 'stale-seal-6',platform.seal_document_export_output((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-6'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-6'),repeat('6',64),128);
SELECT pg_temp.d4_assert((SELECT body->'artifact'->>'state'='failed' AND body->'artifact'->>'failure_code'='source_changed'
 AND body->'storage'='null'::JSONB FROM d4_receipts WHERE key='stale-seal-6'),
 'seal commits stale failure and returns no upload target');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_downloader';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'history',platform.staff_document_export_workspace(pg_temp.d4_id(501));
SELECT pg_temp.d4_assert((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'artifacts') a
 WHERE a->>'id'=(SELECT body->>'id' FROM d4_receipts WHERE key='ready-a') AND a->>'historical'='true' AND a->>'can_download'='true')
 AND position('Confirmed Name' IN body::TEXT)=0 AND position('Changed Name' IN body::TEXT)=0 AND position('object_name' IN body::TEXT)=0
 FROM d4_receipts WHERE key='history'),'history marks stale input but leaks no values or storage keys');
INSERT INTO d4_receipts SELECT 'grant-first',platform.grant_document_export_download((SELECT (body->>'id')::UUID FROM d4_receipts WHERE key='ready-a'),pg_temp.d4_id(902));
INSERT INTO d4_receipts SELECT 'grant-revoke',platform.grant_document_export_download((SELECT (body->>'id')::UUID FROM d4_receipts WHERE key='ready-a'),pg_temp.d4_id(903));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'download-first',platform.consume_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-first'),pg_temp.d4_id(103),pg_temp.d4_id(303));
INSERT INTO d4_receipts SELECT 'download-verified',platform.complete_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-first'),pg_temp.d4_id(103),pg_temp.d4_id(303),repeat('a',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'verified'='true' FROM d4_receipts WHERE key='download-verified'),
 'different authorized employee can verify immutable historical bytes');
INSERT INTO d4_receipts SELECT 'download-before-revoke',platform.consume_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-revoke'),pg_temp.d4_id(103),pg_temp.d4_id(303));
RESET ROLE;

SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'revoke-author',platform.staff_system_admin_command(pg_temp.d4_id(1),pg_temp.d4_id(301),1,FALSE,
 'Ordinary synthetic role revocation during generation',pg_temp.d4_id(704));
INSERT INTO d4_receipts SELECT 'revoke-downloader',platform.staff_system_admin_command(pg_temp.d4_id(1),pg_temp.d4_id(303),1,FALSE,
 'Ordinary synthetic role revocation during download',pg_temp.d4_id(705));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'revoked-5',platform.complete_document_export((SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='begin-5'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='begin-5'),'ready',NULL,repeat('5',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='access_changed' FROM d4_receipts WHERE key='revoked-5'),
 'revocation wins even when stored hash matches');
INSERT INTO d4_receipts SELECT 'download-denied',platform.complete_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-revoke'),pg_temp.d4_id(103),pg_temp.d4_id(303),repeat('a',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'verified'='false' AND body->>'failure_code'='access_changed' FROM d4_receipts WHERE key='download-denied'),
 'download rechecks current employee after readback');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'grant-after-author-revoke',platform.grant_document_export_download((SELECT (body->>'id')::UUID FROM d4_receipts WHERE key='ready-a'),pg_temp.d4_id(904));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'download-after-author-revoke',platform.consume_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-after-author-revoke'),pg_temp.d4_id(102),pg_temp.d4_id(302));
INSERT INTO d4_receipts SELECT 'verified-after-author-revoke',platform.complete_document_export_download((SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='grant-after-author-revoke'),pg_temp.d4_id(102),pg_temp.d4_id(302),repeat('a',64),128);
SELECT pg_temp.d4_assert((SELECT body->>'verified'='true' FROM d4_receipts WHERE key='verified-after-author-revoke'),
 'author revocation does not block another currently authorized employee from historical ready exports');
RESET ROLE;
SELECT pg_temp.d4_assert((SELECT count(*)=6 FROM platform_private.document_export_artifacts WHERE organization_id=pg_temp.d4_id(1)),
 'downloads and replays never create additional artifacts');
SELECT pg_temp.d4_assert((SELECT count(*)=4 FROM platform_private.document_export_artifacts WHERE organization_id=pg_temp.d4_id(1) AND state='failed'),
 'corrupt, stale, revoked and stale-seal operations have durable terminal failures');
SELECT pg_temp.d4_assert((SELECT count(*)=0 FROM platform_private.student_profile_export_attempts WHERE organization_id=pg_temp.d4_id(1)),
 'persistent export uses no legacy generation producer');

-- Source-backed/scoped continuation. Only the synthetic case's initial active
-- state is fixture setup. Roles, assignments, source finalization and field
-- confirmation use their installed commands, without permission replacements.
CREATE FUNCTION pg_temp.d4_error(command TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.d4_error(TEXT) TO authenticated,service_role;
UPDATE platform.record_scopes SET is_active=FALSE WHERE id=pg_temp.d4_id(401);
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.d4_id(402),pg_temp.d4_id(1),'student_case',pg_temp.d4_id(501),2),
 (pg_temp.d4_id(403),pg_temp.d4_id(1),'student_case',pg_temp.d4_id(502),1);
UPDATE platform.student_cases SET state='active',current_curator_membership_id=pg_temp.d4_id(302),
 handoff_at=statement_timestamp(),current_scope_id=pg_temp.d4_id(402),current_scope_version=2
 WHERE id=pg_temp.d4_id(501);
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
 target_country,target_degree,program_direction,state,current_scope_id,current_scope_version)
 VALUES(pg_temp.d4_id(502),pg_temp.d4_id(1),pg_temp.d4_id(302),'synthetic:d4-other-case','D4 other synthetic student',
 'China','Bachelor','Engineering','pending',pg_temp.d4_id(403),1);
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'scope-role',platform.staff_role_command(pg_temp.d4_id(1),pg_temp.d4_id(601),0,'create',
 '{"label":"D4 case export reader","description":"Synthetic single-case reader","permissionKeys":["profile.read.full","document.download"]}',
 'Create synthetic scoped export role',pg_temp.d4_id(1001));
INSERT INTO d4_receipts SELECT 'scope-publish',platform.staff_role_publish(pg_temp.d4_id(1),pg_temp.d4_id(601),1,
 platform.staff_role_impact(pg_temp.d4_id(1),pg_temp.d4_id(601),1)->>'impactFingerprint','Publish synthetic scoped role',pg_temp.d4_id(1002));
RESET ROLE;
INSERT INTO d4_receipts SELECT 'scope-bindings',jsonb_build_array(jsonb_build_object('roleId',r.id,'roleVersion',r.version,
 'bundleId',r.current_bundle_id,'bundleVersion',b.version)) FROM platform.staff_role_definitions r
 JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id WHERE r.id=pg_temp.d4_id(601);
INSERT INTO d4_receipts VALUES('scope-assignment',jsonb_build_array(jsonb_build_object('roleId',pg_temp.d4_id(601),
 'scope',jsonb_build_object('kind','record','key',pg_temp.d4_id(501),'resourceKind','student_case'))));
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'scope-assigned',platform.staff_role_assignments_save(pg_temp.d4_id(1),pg_temp.d4_id(303),2,
 (SELECT body FROM d4_receipts WHERE key='scope-assignment'),(SELECT body FROM d4_receipts WHERE key='scope-bindings'),
 'Limit synthetic employee to one case',pg_temp.d4_id(1003));
INSERT INTO d4_receipts SELECT 'source-slot',platform.create_custom_document_slot(pg_temp.d4_id(1),pg_temp.d4_id(501),
 'Synthetic source PDF','D4 source evidence',pg_temp.d4_id(1004));
RESET ROLE;
SELECT pg_temp.d4_assert((SELECT NOT is_system_admin FROM platform.organization_memberships WHERE id=pg_temp.d4_id(303)),
 'source-backed reader is not a System Admin');
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.d4_id(103),
 'claims',jsonb_build_object('sub',pg_temp.d4_id(103),'role','authenticated')))->'claims')::TEXT AS d4_scoped \gset

-- Same metadata-only source setup as the installed private-storage SQL fixtures.
-- There are NO physical files, real scans or Storage API observations here.
INSERT INTO storage.buckets(id,name,public) VALUES('platform-documents','platform-documents',FALSE) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-upload-1',platform.reserve_document_upload_after_ingress_scan(pg_temp.d4_id(1),pg_temp.d4_id(102),
 (SELECT (body->>'document_slot_id')::UUID FROM d4_receipts WHERE key='source-slot'),'synthetic-source.pdf','application/pdf',2048,
 repeat('b',64),'clean','ClamAV','1.5.4','27890','clamd-zinstream-v1',statement_timestamp(),pg_temp.d4_id(1005));
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata,created_at) SELECT body->>'bucket_id',body->>'object_name',
 jsonb_build_object('size',2048,'mimetype','application/pdf'),statement_timestamp() FROM d4_receipts WHERE key='source-upload-1';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-finalized-1',platform.finalize_document_upload_with_scan(pg_temp.d4_id(1),
 (SELECT (body->>'upload_reservation_id')::UUID FROM d4_receipts WHERE key='source-upload-1'),
 'ClamAV','1.5.4','27890','clamd-zinstream-v1',repeat('b',64),statement_timestamp(),pg_temp.d4_id(1006));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'source-confirmed',platform.review_student_profile_field(pg_temp.d4_id(1),pg_temp.d4_id(501),
 'student_first_name','confirm','Source Confirmed Name',NULL,
 (SELECT (body->>'document_version_id')::UUID FROM d4_receipts WHERE key='source-upload-1'),1,3,
 'Confirm synthetic source version one',pg_temp.d4_id(1007));
RESET ROLE;
-- A newer upload must not invalidate a healthy, retained confirmed source v1.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-upload-2',platform.reserve_document_upload_after_ingress_scan(pg_temp.d4_id(1),pg_temp.d4_id(102),
 (SELECT (body->>'document_slot_id')::UUID FROM d4_receipts WHERE key='source-slot'),'synthetic-source-new.pdf','application/pdf',2048,
 repeat('c',64),'clean','ClamAV','1.5.4','27890','clamd-zinstream-v1',statement_timestamp(),pg_temp.d4_id(1008));
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata,created_at) SELECT body->>'bucket_id',body->>'object_name',
 jsonb_build_object('size',2048,'mimetype','application/pdf'),statement_timestamp() FROM d4_receipts WHERE key='source-upload-2';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-finalized-2',platform.finalize_document_upload_with_scan(pg_temp.d4_id(1),
 (SELECT (body->>'upload_reservation_id')::UUID FROM d4_receipts WHERE key='source-upload-2'),
 'ClamAV','1.5.4','27890','clamd-zinstream-v1',repeat('c',64),statement_timestamp(),pg_temp.d4_id(1009));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_scoped';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'source-workspace',platform.staff_document_export_workspace(pg_temp.d4_id(501));
SELECT pg_temp.d4_assert(pg_temp.d4_error(format('SELECT platform.staff_document_export_workspace(%L::uuid)',pg_temp.d4_id(502)))='42501',
 'record-scoped reader cannot inspect another case');
INSERT INTO d4_receipts SELECT 'source-prepare-'||n,platform.prepare_document_export(pg_temp.d4_id(501),'draft',
 (SELECT body->>'workspace_revision' FROM d4_receipts WHERE key='source-workspace'),pg_temp.d4_id(1100+n)) FROM generate_series(10,17)n;
SELECT pg_temp.d4_assert((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'frozen_profile'->'fields') f
 WHERE f->>'field_key'='student_first_name' AND f->>'value'='Source Confirmed Name' AND f->>'source_page'='1'
 AND f->>'source_document_version_id'=(SELECT body->>'document_version_id' FROM d4_receipts WHERE key='source-upload-1'))
 FROM d4_receipts WHERE key='source-prepare-10'),'scoped session freezes confirmed value with retained source v1');
RESET ROLE;
SELECT pg_temp.d4_assert((SELECT source_versions=jsonb_build_array(jsonb_build_object('id',
 (SELECT body->>'document_version_id' FROM d4_receipts WHERE key='source-upload-1'),'sha256',repeat('b',64)))
 FROM platform_private.document_export_artifacts WHERE request_id=pg_temp.d4_id(1110)),
 'immutable export stores a nonempty exact source-version/hash dependency');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-begin-'||n,platform.begin_document_export(
 (SELECT (body->>'preparation_id')::UUID FROM d4_receipts WHERE key='source-prepare-'||n),pg_temp.d4_id(103),pg_temp.d4_id(303)) FROM generate_series(10,14)n;
INSERT INTO d4_receipts SELECT 'source-seal-'||n,platform.seal_document_export_output(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-'||n),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-'||n),repeat('d',64),256) FROM generate_series(10,14)n;
INSERT INTO d4_receipts SELECT 'source-ready',platform.complete_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-10'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-10'),'ready',NULL,repeat('d',64),256);
SELECT pg_temp.d4_assert((SELECT body->>'state'='ready' AND body->>'can_download'='true' FROM d4_receipts WHERE key='source-ready'),
 'scoped employee publishes source-backed output after source slot advances to v2');
SELECT pg_temp.d4_assert(pg_temp.d4_error(format('SELECT platform.inspect_document_export_reconciliation(%L::uuid,%L::uuid,%L::uuid)',
 (SELECT body->'artifact'->>'id' FROM d4_receipts WHERE key='source-begin-14'),pg_temp.d4_id(103),pg_temp.d4_id(303)))='55000',
 'unexpired pending lease forbids racing reconciliation');
INSERT INTO d4_receipts SELECT 'source-unknown-14',platform.complete_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-14'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-14'),'unknown','storage_unavailable',NULL,NULL);
RESET ROLE;

-- Time fixtures initialize first claim metadata before begin (no immutable
-- claim is rewritten), preserving checks/triggers. This avoids a ten-minute
-- sleep; subsequent expiry decisions execute the real service RPCs/database clock.
UPDATE platform_private.document_export_artifacts SET begun_at=clock_timestamp()-INTERVAL '11 minutes',
 lease_expires_at=clock_timestamp()-INTERVAL '1 minute',claim_token=gen_random_uuid()
 WHERE request_id=pg_temp.d4_id(1115);
UPDATE platform_private.document_export_artifacts SET begun_at=clock_timestamp()-INTERVAL '11 minutes',
 lease_expires_at=clock_timestamp()-INTERVAL '1 minute',claim_token=gen_random_uuid(),sealed_at=clock_timestamp()-INTERVAL '2 minutes',
 object_name=organization_id::TEXT||'/'||student_case_id::TEXT||'/'||id::TEXT||'.docx',output_sha256=repeat('e',64),output_bytes=256
 WHERE request_id IN (pg_temp.d4_id(1116),pg_temp.d4_id(1117));
INSERT INTO d4_receipts SELECT 'expired-claim-'||request_id::TEXT,jsonb_build_object('id',id,'claim',claim_token)
 FROM platform_private.document_export_artifacts WHERE request_id IN (pg_temp.d4_id(1115),pg_temp.d4_id(1116),pg_temp.d4_id(1117));
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'expired-seal',platform.seal_document_export_output((body->>'id')::UUID,(body->>'claim')::UUID,repeat('e',64),256)
 FROM d4_receipts WHERE key='expired-claim-'||pg_temp.d4_id(1115)::TEXT;
SELECT pg_temp.d4_assert((SELECT body->'artifact'->>'failure_code'='export_failed' AND body->'storage'='null'::JSONB FROM d4_receipts WHERE key='expired-seal'),
 'expired generation lease durably fails before issuing upload target');
INSERT INTO d4_receipts SELECT 'expired-complete',platform.complete_document_export((body->>'id')::UUID,(body->>'claim')::UUID,'ready',NULL,repeat('e',64),256)
 FROM d4_receipts WHERE key='expired-claim-'||pg_temp.d4_id(1116)::TEXT;
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='export_failed' FROM d4_receipts WHERE key='expired-complete'),
 'expired generation lease cannot complete even with matching byte observations');
INSERT INTO d4_receipts SELECT 'expired-inspect',platform.inspect_document_export_reconciliation((body->>'id')::UUID,pg_temp.d4_id(103),pg_temp.d4_id(303))
 FROM d4_receipts WHERE key='expired-claim-'||pg_temp.d4_id(1117)::TEXT;
SELECT pg_temp.d4_assert((SELECT body->'storage'->>'object_name' IS NOT NULL FROM d4_receipts WHERE key='expired-inspect'),
 'expired sealed pending attempt exposes only its known reconciliation target');
INSERT INTO d4_receipts SELECT 'expired-reconciled',platform.reconcile_document_export((body->>'id')::UUID,
 pg_temp.d4_id(103),pg_temp.d4_id(303),pg_temp.d4_id(1200),repeat('e',64),256,NULL)
 FROM d4_receipts WHERE key='expired-claim-'||pg_temp.d4_id(1117)::TEXT;
SELECT pg_temp.d4_assert((SELECT body->>'state'='ready' FROM d4_receipts WHERE key='expired-reconciled'),
 'explicit reconcile recovers expired sealed pending identity without regenerating');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'d4_scoped';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'source-grant-'||n,platform.grant_document_export_download(
 (SELECT (body->>'id')::UUID FROM d4_receipts WHERE key='source-ready'),pg_temp.d4_id(1210+n)) FROM generate_series(1,4)n;
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-consumed-'||n,platform.consume_document_export_download(
 (SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='source-grant-'||n),pg_temp.d4_id(103),pg_temp.d4_id(303)) FROM generate_series(2,4)n;
INSERT INTO d4_receipts SELECT 'source-verified-download',platform.complete_document_export_download(
 (SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='source-grant-4'),pg_temp.d4_id(103),pg_temp.d4_id(303),repeat('d',64),256);
SELECT pg_temp.d4_assert((SELECT body->>'verified'='true' FROM d4_receipts WHERE key='source-verified-download'),
 'current scoped employee verifies source-backed bytes with retained healthy source v1');
RESET ROLE;
-- Backdate bounded grant fixtures only; never replace the clock or grant ACLs.
UPDATE platform_private.document_export_download_grants SET created_at=clock_timestamp()-INTERVAL '3 minutes',expires_at=clock_timestamp()-INTERVAL '1 minute'
 WHERE request_id IN (pg_temp.d4_id(1211),pg_temp.d4_id(1212));
SET LOCAL ROLE service_role;
SELECT pg_temp.d4_assert(pg_temp.d4_error(format('SELECT platform.consume_document_export_download(%L::uuid,%L::uuid,%L::uuid)',
 (SELECT body->>'grant_id' FROM d4_receipts WHERE key='source-grant-1'),pg_temp.d4_id(103),pg_temp.d4_id(303)))='42501',
 'expired unconsumed grant is denied');
INSERT INTO d4_receipts SELECT 'source-expired-download',platform.complete_document_export_download(
 (SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='source-grant-2'),pg_temp.d4_id(103),pg_temp.d4_id(303),repeat('d',64),256);
SELECT pg_temp.d4_assert((SELECT body->>'verified'='false' AND body->>'failure_code'='access_changed' FROM d4_receipts WHERE key='source-expired-download'),
 'grant expiring during readback commits failed verification');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'scope-revoked',platform.staff_role_assignments_save(pg_temp.d4_id(1),pg_temp.d4_id(303),3,'[]','[]',
 'Revoke synthetic case scope during generation and download',pg_temp.d4_id(1220));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-revoked-completion',platform.complete_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-11'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-11'),'ready',NULL,repeat('d',64),256);
INSERT INTO d4_receipts SELECT 'source-revoked-download',platform.complete_document_export_download(
 (SELECT (body->>'grant_id')::UUID FROM d4_receipts WHERE key='source-grant-3'),pg_temp.d4_id(103),pg_temp.d4_id(303),repeat('d',64),256);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='access_changed' FROM d4_receipts WHERE key='source-revoked-completion')
 AND (SELECT body->>'verified'='false' AND body->>'failure_code'='access_changed' FROM d4_receipts WHERE key='source-revoked-download'),
 'live S2 record-scope revocation blocks generation and download after byte observations');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'scope-restored',platform.staff_role_assignments_save(pg_temp.d4_id(1),pg_temp.d4_id(303),4,
 (SELECT body FROM d4_receipts WHERE key='scope-assignment'),(SELECT body FROM d4_receipts WHERE key='scope-bindings'),
 'Restore synthetic case scope for independent source tests',pg_temp.d4_id(1221));
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id',pg_temp.d4_id(103),
 'claims',jsonb_build_object('sub',pg_temp.d4_id(103),'role','authenticated')))->'claims')::TEXT AS d4_scoped_current \gset

-- Inject only scanner-health metadata, not a real malware scan. The export
-- authority must use the referenced v1 health, not the healthy current v2.
UPDATE platform.document_versions SET malware_status='infected' WHERE id=(SELECT (body->>'document_version_id')::UUID FROM d4_receipts WHERE key='source-upload-1');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-malware-completion',platform.complete_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-12'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-12'),'ready',NULL,repeat('d',64),256);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='source_unavailable' FROM d4_receipts WHERE key='source-malware-completion'),
 'unhealthy referenced source durably blocks completion despite healthy newer source version');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_scoped_current';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'source-malware-history',platform.staff_document_export_workspace(pg_temp.d4_id(501));
SELECT pg_temp.d4_assert((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'artifacts') a
 WHERE a->>'id'=(SELECT body->>'id' FROM d4_receipts WHERE key='source-ready') AND a->>'state'='ready' AND a->>'can_download'='false')
 FROM d4_receipts WHERE key='source-malware-history'),'ready history stays immutable but download denies current unhealthy source');
SELECT pg_temp.d4_assert(pg_temp.d4_error(format('SELECT platform.grant_document_export_download(%L::uuid,%L::uuid)',
 (SELECT body->>'id' FROM d4_receipts WHERE key='source-ready'),pg_temp.d4_id(1230)))='42501','unhealthy source cannot receive download grant');
RESET ROLE;
UPDATE platform.document_versions SET malware_status='clean' WHERE id=(SELECT (body->>'document_version_id')::UUID FROM d4_receipts WHERE key='source-upload-1');
SET LOCAL request.jwt.claims TO :'d4_admin';
SET LOCAL ROLE authenticated;
INSERT INTO d4_receipts SELECT 'source-removed',platform.remove_document_slot(pg_temp.d4_id(1),pg_temp.d4_id(501),
 (SELECT (body->>'document_slot_id')::UUID FROM d4_receipts WHERE key='source-slot'),
 (SELECT version FROM platform.document_slots WHERE id=(SELECT (body->>'document_slot_id')::UUID FROM d4_receipts WHERE key='source-slot')),
 'Remove synthetic source after preparation',pg_temp.d4_id(1231));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d4_receipts SELECT 'source-removed-completion',platform.complete_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-13'),
 (SELECT (body->>'claim_token')::UUID FROM d4_receipts WHERE key='source-begin-13'),'ready',NULL,repeat('d',64),256);
INSERT INTO d4_receipts SELECT 'source-removed-inspect',platform.inspect_document_export_reconciliation(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-14'),pg_temp.d4_id(103),pg_temp.d4_id(303));
INSERT INTO d4_receipts SELECT 'source-removed-reconcile',platform.reconcile_document_export(
 (SELECT (body->'artifact'->>'id')::UUID FROM d4_receipts WHERE key='source-begin-14'),pg_temp.d4_id(103),pg_temp.d4_id(303),
 pg_temp.d4_id(1232),repeat('d',64),256,NULL);
SELECT pg_temp.d4_assert((SELECT body->>'state'='failed' AND body->>'failure_code'='source_unavailable' FROM d4_receipts WHERE key='source-removed-completion')
 AND (SELECT body->'storage'='null'::JSONB FROM d4_receipts WHERE key='source-removed-inspect')
 AND (SELECT body->>'state'='failed' AND body->>'failure_code'='source_unavailable' FROM d4_receipts WHERE key='source-removed-reconcile'),
 'removed source commits terminal completion/reconcile failure and inspection offers no Storage target');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'d4_scoped_current';
SET LOCAL ROLE authenticated;
SELECT pg_temp.d4_assert(pg_temp.d4_error(format('SELECT platform.grant_document_export_download(%L::uuid,%L::uuid)',
 (SELECT body->>'id' FROM d4_receipts WHERE key='source-ready'),pg_temp.d4_id(1233)))='42501','removed source cannot receive download grant');
RESET ROLE;
SELECT pg_temp.d4_assert((SELECT state='ready' AND output_sha256=repeat('d',64) AND receipt_id=(SELECT (body->>'receipt_id')::UUID FROM d4_receipts WHERE key='source-ready')
 FROM platform_private.document_export_artifacts WHERE request_id=pg_temp.d4_id(1110)),
 'source health and removal never rewrite an immutable ready receipt');
SELECT pg_temp.d4_assert((SELECT count(*)=14 FROM platform_private.document_export_artifacts WHERE organization_id=pg_temp.d4_id(1)),
 'all source checks, lease/grant failures and downloads retain one artifact per preparation');
ROLLBACK;
\echo DOCUMENT_EXPORT_ARTIFACT_SQL_BEHAVIOR_VERIFIED
