\set ON_ERROR_STOP on
-- Disposable empty database only. Real PostgreSQL/session RPCs, synthetic
-- scan/storage/provider facts. This is not Auth/browser/bytes/provider proof.
BEGIN;
CREATE FUNCTION pg_temp.d3_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'D3 queue proof: %', message; END IF; END $$;
CREATE TEMP TABLE d3_fixture AS SELECT gen_random_uuid() AS auth_id, gen_random_uuid() AS case_id,
  gen_random_uuid() AS scope_id, gen_random_uuid() AS slot_id, gen_random_uuid() AS request_id,
  NULL::JSONB AS bootstrap, NULL::JSONB AS upload, NULL::JSONB AS claims;
CREATE TEMP TABLE d3_receipts(key TEXT PRIMARY KEY, body JSONB);
GRANT SELECT,UPDATE ON d3_fixture TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON d3_receipts TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION pg_temp.d3_assert(BOOLEAN,TEXT) TO authenticated,service_role;
SELECT pg_temp.d3_assert(NOT EXISTS (SELECT 1 FROM platform.organizations), 'empty isolated database');
INSERT INTO auth.users(id,email,raw_user_meta_data)
  SELECT auth_id,'d3-queue-synthetic@example.invalid','{}'::JSONB FROM d3_fixture;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
UPDATE d3_fixture SET bootstrap=platform.bootstrap_organization_admin(
  'D3 Synthetic Organization',auth_id,'D3 Synthetic Admin','Isolated queue proof',gen_random_uuid());
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT m.is_system_admin FROM platform.organization_memberships m
  JOIN d3_fixture f ON m.id=(f.bootstrap->>'membership_id')::UUID), 'canonical System Admin bootstrap');
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
  SELECT scope_id,(bootstrap->>'organization_id')::UUID,'student_case',case_id,1 FROM d3_fixture;
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
  target_country,target_degree,program_direction,state,current_scope_id,current_scope_version)
  SELECT case_id,(bootstrap->>'organization_id')::UUID,(bootstrap->>'membership_id')::UUID,
    'synthetic:d3-queue','D3 Fictional Student','China','Bachelor','Engineering','pending',scope_id,1 FROM d3_fixture;
INSERT INTO platform.document_slots(id,organization_id,student_case_id,requirement_id,intent_kind,
  display_label,group_label,created_by_membership_id)
  SELECT slot_id,(bootstrap->>'organization_id')::UUID,case_id,NULL,'custom',
    'Synthetic document','Synthetic documents',(bootstrap->>'membership_id')::UUID FROM d3_fixture;
UPDATE d3_fixture SET claims=platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id',auth_id,'claims',jsonb_build_object('sub',auth_id,'role','authenticated')))->'claims';
SELECT claims::TEXT AS staff_claims FROM d3_fixture \gset
SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'profile',platform.start_student_profile(
  (bootstrap->>'organization_id')::UUID,case_id,0,'Synthetic partial profile',gen_random_uuid()) FROM d3_fixture;
RESET ROLE;

-- Existing ingress/finalize RPCs establish exact source and scan provenance.
-- No scanner is called and no customer bytes are stored by this SQL proof.
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
UPDATE d3_fixture SET upload=platform.reserve_document_upload_after_ingress_scan(
  (bootstrap->>'organization_id')::UUID,auth_id,slot_id,'synthetic.pdf','application/pdf',128,repeat('a',64),
  'clean','ClamAV','1.5.3','27889','clamd-zinstream-v1',statement_timestamp(),gen_random_uuid());
RESET ROLE;
INSERT INTO storage.buckets(id,name,public) VALUES('platform-documents','platform-documents',FALSE);
INSERT INTO storage.objects(bucket_id,name,metadata,created_at)
  SELECT upload->>'bucket_id',upload->>'object_name','{"size":128,"mimetype":"application/pdf"}',
    statement_timestamp() FROM d3_fixture;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'finalized',platform.finalize_document_upload_with_scan(
  (bootstrap->>'organization_id')::UUID,(upload->>'upload_reservation_id')::UUID,
  'ClamAV','1.5.3','27889','clamd-zinstream-v1',repeat('a',64),statement_timestamp(),gen_random_uuid()) FROM d3_fixture;
RESET ROLE;
INSERT INTO platform_private.document_recognition_configs(organization_id,config,registry_version,prompt_policy_version,enabled)
  SELECT (bootstrap->>'organization_id')::UUID,
    '{"enabled":true,"projectId":"synthetic-project","model":"gemini-3.1-flash","configVersion":"synthetic-v1",
      "pricingPolicyVersion":"synthetic-price-v1","paidProjectId":"synthetic-project","paidEligibilityReference":"synthetic-no-billing-proof",
      "perJobBudgetMicros":10000,"dailyOrgBudgetMicros":100000,"inputTokenCeiling":10000,"outputTokenCeiling":6000,
      "inputMicrosPerMillionTokens":100000,"outputMicrosPerMillionTokens":200000}',
    'evo-profile-61-v1','synthetic-prompt-v1',TRUE FROM d3_fixture;

SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'enqueued',platform.enqueue_document_recognition(
  (bootstrap->>'organization_id')::UUID,case_id,(upload->>'document_version_id')::UUID,1,request_id,NULL) FROM d3_fixture;
INSERT INTO d3_receipts SELECT 'replayed',platform.enqueue_document_recognition(
  (bootstrap->>'organization_id')::UUID,case_id,(upload->>'document_version_id')::UUID,1,request_id,NULL) FROM d3_fixture;
SELECT pg_temp.d3_assert((SELECT body->>'replayed'='true' AND body->>'job_id'=
  (SELECT body->>'job_id' FROM d3_receipts WHERE key='enqueued') FROM d3_receipts WHERE key='replayed'), 'enqueue replay retains job');
INSERT INTO d3_receipts SELECT 'read',platform.staff_document_recognition_job(case_id,
  (SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='enqueued')) FROM d3_fixture;
SELECT pg_temp.d3_assert((SELECT body->>'state'='queued' AND body->>'cleanup_state'='not_uploaded'
  AND body->>'proposal_count'='0' FROM d3_receipts WHERE key='read'), 'safe staff read');
-- A normal human edit does not change the original request identity on replay.
INSERT INTO d3_receipts SELECT 'human-empty',platform.review_student_profile_field(
  (bootstrap->>'organization_id')::UUID,case_id,'english_level','clear',NULL,NULL,NULL,NULL,1,
  'Synthetic confirmed empty optional field',gen_random_uuid()) FROM d3_fixture;
RESET ROLE;
UPDATE platform_private.document_recognition_configs SET enabled=FALSE;
SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'replay-after-edit',platform.enqueue_document_recognition(
  (bootstrap->>'organization_id')::UUID,case_id,(upload->>'document_version_id')::UUID,1,request_id,NULL) FROM d3_fixture;
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT count(*)=1 AND min(reserved_cost_micros)=2200
  FROM platform_private.document_recognition_jobs), 'one immutable request and one monetary reservation');
SELECT pg_temp.d3_assert((SELECT body->>'replayed'='true' FROM d3_receipts WHERE key='replay-after-edit'),
  'replay uses original revision/config after human edit and config disable');
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'claim',platform.claim_document_recognition('synthetic-worker-one');
INSERT INTO d3_receipts SELECT 'renew',platform.renew_document_recognition_lease(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='claim';
RESET ROLE;
-- Controlled clock fixture: an expired pre-dispatch lease is recoverable.
UPDATE platform_private.document_recognition_attempts SET lease_until=statement_timestamp()-INTERVAL '1 second';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'recovered',platform.claim_document_recognition('synthetic-worker-two');
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT body->>'attempt_id'=(SELECT body->>'attempt_id' FROM d3_receipts WHERE key='claim')
  AND body->>'claim_token'<>(SELECT body->>'claim_token' FROM d3_receipts WHERE key='claim')
  FROM d3_receipts WHERE key='recovered'), 'recovery keeps attempt and rotates fence');
INSERT INTO d3_receipts SELECT 'fingerprint',to_jsonb(platform_private.document_recognition_sha(request_identity ||
  jsonb_build_object('fingerprint_version','evo-document-recognition-request-v1','source_pages',2)))
  FROM platform_private.document_recognition_jobs;
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'sealed',platform.seal_document_recognition_preflight(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,repeat('a',64),128,'application/pdf',2,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='fingerprint')) FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'seal-replayed',platform.seal_document_recognition_preflight(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,repeat('a',64),128,'application/pdf',2,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='fingerprint')) FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body=(SELECT body FROM d3_receipts WHERE key='sealed')
  FROM d3_receipts WHERE key='seal-replayed'), 'sealed source replay is identical');
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT count(*)=1 FROM platform_private.document_recognition_attempts), 'one attempt after recovery');
SELECT pg_temp.d3_assert((SELECT count(*)=1 AND min(revision)=2 FROM platform.student_profiles), 'queue does not edit human profile');
SELECT pg_temp.d3_assert(NOT EXISTS (SELECT 1 FROM platform.student_profile_field_proposals), 'preflight creates no proposals');
SELECT pg_temp.d3_assert(NOT has_function_privilege('authenticated','platform.claim_document_recognition(text)','EXECUTE'),
  'catalog confirms service-only claim');

-- Synthetic provider observations below exercise durable SQL transitions only.
-- No upload, countTokens, generation, deletion or real billing occurs here.
INSERT INTO d3_receipts SELECT 'fields-before-publish',jsonb_agg(to_jsonb(f) ORDER BY field_key)
  FROM platform.student_profile_fields f;
INSERT INTO d3_receipts SELECT 'reviews-before-publish',jsonb_agg(to_jsonb(r) ORDER BY id)
  FROM platform.student_profile_field_reviews r;
INSERT INTO d3_receipts SELECT 'audit-count-before-publish',to_jsonb(count(*)) FROM platform.audit_events;
-- Controlled UTC rollover fixture: yesterday's queued reservation must be
-- checked against today's budget before its first external side effect.
UPDATE platform_private.document_recognition_jobs SET reservation_day=(statement_timestamp() AT TIME ZONE 'UTC')::DATE-1;
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'upload-intent',platform.begin_document_recognition_upload(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'upload-intent-replay',platform.begin_document_recognition_upload(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body->'dispatch'='true'::JSONB FROM d3_receipts WHERE key='upload-intent')
  AND (SELECT body->'dispatch'='false'::JSONB AND body->>'resource_name'=
    (SELECT body->>'resource_name' FROM d3_receipts WHERE key='upload-intent')
    FROM d3_receipts WHERE key='upload-intent-replay'), 'one upload intent with replay dispatch false');
INSERT INTO d3_receipts SELECT 'file-active',platform.observe_document_recognition_file(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,jsonb_build_object(
    'outcome','present','resource_name',(SELECT body->>'resource_name' FROM d3_receipts WHERE key='upload-intent'),
    'state','ACTIVE','sha256',repeat('a',64),'bytes',128,'mime_type','application/pdf'))
  FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body->>'state'='file_processing' FROM d3_receipts WHERE key='file-active'),
  'exact synthetic ACTIVE observation advances the owned file');
RESET ROLE;

SELECT pg_temp.d3_assert((SELECT reservation_day=(statement_timestamp() AT TIME ZONE 'UTC')::DATE
  AND reserved_cost_micros=2200 FROM platform_private.document_recognition_jobs), 'upload moves the same reservation into current UTC day');
-- A processing file can also span midnight before the sole paid generation.
UPDATE platform_private.document_recognition_jobs SET reservation_day=(statement_timestamp() AT TIME ZONE 'UTC')::DATE-1;

-- Hash a complete synthetic wire body, not only its document contents. This
-- minimal fixture schema is not the production prompt/schema or transport proof.
INSERT INTO d3_receipts SELECT 'synthetic-wire-body',jsonb_build_object(
  'store',FALSE,
  'systemInstruction',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object('text','Synthetic SQL workflow fixture only'))),
  'contents',jsonb_build_array(jsonb_build_object('role','user','parts',jsonb_build_array(
    jsonb_build_object('fileData',jsonb_build_object('mimeType','application/pdf',
      'fileUri','https://generativelanguage.googleapis.com/v1beta/' || (body->>'resource_name'))),
    jsonb_build_object('text','Return synthetic candidate proposals for human review')))),
  'generationConfig',jsonb_build_object('maxOutputTokens',6000,'responseFormat',jsonb_build_object(
    'text',jsonb_build_object('mimeType','APPLICATION_JSON','schema',jsonb_build_object('type','object')))))
  FROM d3_receipts WHERE key='upload-intent';
INSERT INTO d3_receipts SELECT 'count-receipt',jsonb_build_object('model',config_snapshot->>'model',
  'request_sha256',encode(sha256(convert_to('models/' || (config_snapshot->>'model') || E'\n' ||
    (SELECT body::TEXT FROM d3_receipts WHERE key='synthetic-wire-body'),'UTF8')),'hex'),
  'config_sha256',platform_private.document_recognition_sha(config_snapshot),'input_tokens',128)
  FROM platform_private.document_recognition_jobs WHERE id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='enqueued');
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'count-saved',platform.record_document_recognition_token_count(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='count-receipt')) FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'count-replayed',platform.record_document_recognition_token_count(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='count-receipt')) FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body->'token_count_receipt'=(SELECT body FROM d3_receipts WHERE key='count-receipt')
  FROM d3_receipts WHERE key='count-replayed'), 'exact full-request count receipt survives replay');
INSERT INTO d3_receipts SELECT 'generation-intent',platform.begin_document_recognition_generation(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='count-receipt')) FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'generation-intent-replay',platform.begin_document_recognition_generation(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='count-receipt')) FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body='{"dispatch":true}'::JSONB FROM d3_receipts WHERE key='generation-intent')
  AND (SELECT body='{"dispatch":false}'::JSONB FROM d3_receipts WHERE key='generation-intent-replay'),
  'generation dispatch is allowed once only');
RESET ROLE;
-- Literal normalized result text preserves candidate order and both conflicting
SELECT pg_temp.d3_assert((SELECT reservation_day=(statement_timestamp() AT TIME ZONE 'UTC')::DATE
  AND reserved_cost_micros=2200 FROM platform_private.document_recognition_jobs), 'generation rechecks current UTC day without a second reservation');
-- Literal normalized result text preserves candidate order and both conflicting
-- english_level proposals. Its hash is over these exact UTF-8 bytes.
INSERT INTO d3_receipts VALUES('result-text',to_jsonb(
  '{"candidates":[{"key":"student_first_name","value":"Synthetic Applicant","source_page":1,"source_snippet":"Synthetic name line","confidence":0.9},{"key":"english_level","value":"B1","source_page":1,"source_snippet":"Synthetic English statement","confidence":0.8},{"key":"english_level","value":"B2","source_page":2,"source_snippet":"Conflicting synthetic English statement","confidence":0.7}],"warnings":[]}'::TEXT));
INSERT INTO d3_receipts SELECT 'result-hash',to_jsonb(encode(sha256(convert_to(body #>> '{}','UTF8')),'hex'))
  FROM d3_receipts WHERE key='result-text';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'result-saved',platform.record_document_recognition_result(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='result-text'),(SELECT body #>> '{}' FROM d3_receipts WHERE key='result-hash'),
  'synthetic-response-1','synthetic-model-version-1','{"inputTokens":128,"outputTokens":64,"totalTokens":192}'::JSONB)
  FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'result-replayed',platform.record_document_recognition_result(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='result-text'),(SELECT body #>> '{}' FROM d3_receipts WHERE key='result-hash'),
  'synthetic-response-1','synthetic-model-version-1','{"inputTokens":128,"outputTokens":64,"totalTokens":192}'::JSONB)
  FROM d3_receipts WHERE key='recovered';
SELECT pg_temp.d3_assert((SELECT body->>'state'='result_saved' AND body->'replayed'='true'::JSONB
  FROM d3_receipts WHERE key='result-replayed'), 'saved result replay does not generate again');
INSERT INTO d3_receipts SELECT 'published',platform.publish_document_recognition_proposals(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='recovered';
INSERT INTO d3_receipts SELECT 'publish-replayed',platform.publish_document_recognition_proposals(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='recovered';
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT body->>'state'='review_ready' AND body->'replayed'='false'::JSONB
  FROM d3_receipts WHERE key='published') AND (SELECT body->>'state'='review_ready' AND body->'replayed'='true'::JSONB
  FROM d3_receipts WHERE key='publish-replayed'), 'publication and local replay reach review-ready');
SELECT pg_temp.d3_assert((SELECT count(*)=1 AND min(revision)=3 FROM platform.student_profiles), 'publication increments one aggregate revision once');
SELECT pg_temp.d3_assert((SELECT jsonb_agg(to_jsonb(f) ORDER BY field_key) FROM platform.student_profile_fields f)
  =(SELECT body FROM d3_receipts WHERE key='fields-before-publish'), 'all current profile fields remain unchanged');
SELECT pg_temp.d3_assert((SELECT value IS NULL AND review_state='confirmed' AND profile_revision=2
  FROM platform.student_profile_fields WHERE field_key='english_level'), 'human-confirmed empty stays empty and confirmed');
SELECT pg_temp.d3_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM platform.student_profile_field_reviews r)
  =(SELECT body FROM d3_receipts WHERE key='reviews-before-publish'), 'human review history remains byte-equivalent JSON');
SELECT pg_temp.d3_assert((SELECT count(*)=3 FROM platform.student_profile_field_proposals)
  AND (SELECT count(*)=3 FROM platform_private.document_recognition_proposal_links), 'three candidates retain three proposal links');
SELECT pg_temp.d3_assert((SELECT jsonb_agg(jsonb_build_object('key',p.field_key,'value',p.value,
  'source_page',p.source_page,'source_snippet',p.source_snippet,'confidence',p.confidence) ORDER BY l.ordinal)
  FROM platform_private.document_recognition_proposal_links l JOIN platform.student_profile_field_proposals p ON p.id=l.proposal_id)
  =((SELECT body #>> '{}' FROM d3_receipts WHERE key='result-text')::JSONB->'candidates'),
  'proposal values, provenance and conflicting candidate order are preserved');
SELECT pg_temp.d3_assert((SELECT bool_and(p.organization_id=(f.bootstrap->>'organization_id')::UUID
  AND p.student_case_id=f.case_id AND p.student_profile_id=j.student_profile_id
  AND p.source_document_version_id=(f.upload->>'document_version_id')::UUID AND p.source_document_slot_id=f.slot_id
  AND p.created_by_membership_id=(f.bootstrap->>'membership_id')::UUID AND l.attempt_id=a.id)
  FROM platform.student_profile_field_proposals p JOIN platform_private.document_recognition_proposal_links l ON l.proposal_id=p.id
  JOIN platform_private.document_recognition_attempts a ON a.id=l.attempt_id
  JOIN platform_private.document_recognition_jobs j ON j.id=a.job_id CROSS JOIN d3_fixture f), 'exact job/case/profile/source/actor links survive publication');
SELECT pg_temp.d3_assert((SELECT count(*) FROM platform.audit_events)=
  (SELECT (body #>> '{}')::BIGINT+1 FROM d3_receipts WHERE key='audit-count-before-publish')
  AND (SELECT count(*)=1 FROM platform.audit_events WHERE action='student.profile.recognition.publish'), 'publication writes one audit even after replay');
SELECT pg_temp.d3_assert((SELECT before_state->>'profile_revision'='2' AND after_state->>'profile_revision'='3'
  AND after_state->>'proposal_count'='3' AND request_id=(SELECT request_id FROM d3_fixture)
  FROM platform.audit_events WHERE action='student.profile.recognition.publish'), 'publication audit records revision/count, not extracted values');
SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'read-published',platform.staff_document_recognition_job(case_id,
  (SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='enqueued')) FROM d3_fixture;
SELECT pg_temp.d3_assert((SELECT body->>'state'='review_ready' AND body->>'proposal_count'='3'
  AND body->>'cleanup_state'='pending' FROM d3_receipts WHERE key='read-published'), 'staff sees proposals with cleanup still pending');
RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'cleanup-claim',platform.claim_document_recognition_cleanup('synthetic-cleanup-one');
INSERT INTO d3_receipts SELECT 'cleanup-present',platform.record_document_recognition_cleanup(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,jsonb_build_object('outcome','present',
    'resource_name',body->>'resource_name','state','ACTIVE','sha256',repeat('a',64),'bytes',128,'mime_type','application/pdf'))
  FROM d3_receipts WHERE key='cleanup-claim';
INSERT INTO d3_receipts SELECT 'delete-intent',platform.begin_document_recognition_delete(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,body->>'resource_name') FROM d3_receipts WHERE key='cleanup-claim';
INSERT INTO d3_receipts SELECT 'delete-intent-replay',platform.begin_document_recognition_delete(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,body->>'resource_name') FROM d3_receipts WHERE key='cleanup-claim';
SELECT pg_temp.d3_assert((SELECT body='{"dispatch":true}'::JSONB FROM d3_receipts WHERE key='delete-intent')
  AND (SELECT body='{"dispatch":false}'::JSONB FROM d3_receipts WHERE key='delete-intent-replay'), 'one fenced delete intent');
INSERT INTO d3_receipts SELECT 'delete-ack',platform.record_document_recognition_cleanup(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,jsonb_build_object('outcome','delete_acknowledged',
    'resource_name',body->>'resource_name','state',NULL,'sha256',NULL,'bytes',NULL,'mime_type',NULL))
  FROM d3_receipts WHERE key='cleanup-claim';
SELECT pg_temp.d3_assert((SELECT body='{"cleanup_state":"pending"}'::JSONB FROM d3_receipts WHERE key='delete-ack'),
  'delete acknowledgement alone does not confirm absence');
INSERT INTO d3_receipts SELECT 'cleanup-absent',platform.record_document_recognition_cleanup(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,jsonb_build_object('outcome','not_found',
    'resource_name',body->>'resource_name','state',NULL,'sha256',NULL,'bytes',NULL,'mime_type',NULL))
  FROM d3_receipts WHERE key='cleanup-claim';
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT body='{"cleanup_state":"confirmed_absent"}'::JSONB FROM d3_receipts WHERE key='cleanup-absent')
  AND (SELECT observed_owned_at IS NOT NULL AND delete_started_at IS NOT NULL AND delete_acknowledged_at IS NOT NULL
    AND confirmed_absent_at IS NOT NULL FROM platform_private.document_recognition_provider_files), 'observed owned file deletion has separate confirmed absence');
SELECT pg_temp.d3_assert((SELECT state='review_ready' AND proposal_count=3 AND cleanup_state='confirmed_absent'
  AND reservation_released_at IS NULL FROM platform_private.document_recognition_jobs), 'cleanup does not erase proposals or label dispatched work free');

-- A second explicitly requested job loses its upload response. Bounded 404s do
-- not prove absence; this ordinary uncertainty path uses the same owned name.
UPDATE platform_private.document_recognition_configs SET enabled=TRUE;
SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'unknown-upload-job',platform.enqueue_document_recognition(
  (bootstrap->>'organization_id')::UUID,case_id,(upload->>'document_version_id')::UUID,3,gen_random_uuid(),NULL) FROM d3_fixture;
RESET ROLE;
INSERT INTO d3_receipts SELECT 'unknown-upload-fingerprint',to_jsonb(platform_private.document_recognition_sha(request_identity ||
  jsonb_build_object('fingerprint_version','evo-document-recognition-request-v1','source_pages',2)))
  FROM platform_private.document_recognition_jobs WHERE id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-upload-job');
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'unknown-upload-claim',platform.claim_document_recognition('synthetic-upload-unknown');
INSERT INTO d3_receipts SELECT 'unknown-upload-seal',platform.seal_document_recognition_preflight(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,repeat('a',64),128,'application/pdf',2,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='unknown-upload-fingerprint')) FROM d3_receipts WHERE key='unknown-upload-claim';
INSERT INTO d3_receipts SELECT 'unknown-upload-intent',platform.begin_document_recognition_upload(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='unknown-upload-claim';
DO $$ DECLARE claim JSONB; file_name TEXT; observation JSONB; n INTEGER;
BEGIN
  SELECT body INTO claim FROM d3_receipts WHERE key='unknown-upload-claim';
  SELECT body->>'resource_name' INTO file_name FROM d3_receipts WHERE key='unknown-upload-intent';
  FOR n IN 1..5 LOOP
    observation:=platform.observe_document_recognition_file((claim->>'attempt_id')::UUID,(claim->>'claim_token')::UUID,
      jsonb_build_object('outcome','not_found','resource_name',file_name,'state',NULL,'sha256',NULL,'bytes',NULL,'mime_type',NULL));
    PERFORM pg_temp.d3_assert(observation->>'state'=CASE WHEN n<5 THEN 'upload_unknown' ELSE 'failed' END,
      'bounded unknown upload observations never authorize generation');
  END LOOP;
END $$;
INSERT INTO d3_receipts SELECT 'unknown-cleanup-claim',platform.claim_document_recognition_cleanup('synthetic-unknown-cleanup');
INSERT INTO d3_receipts SELECT 'unknown-cleanup-404',platform.record_document_recognition_cleanup(
  (body->>'attempt_id')::UUID,(body->>'cleanup_token')::UUID,jsonb_build_object('outcome','not_found',
    'resource_name',body->>'resource_name','state',NULL,'sha256',NULL,'bytes',NULL,'mime_type',NULL))
  FROM d3_receipts WHERE key='unknown-cleanup-claim';
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT body->>'cleanup_state'='pending' FROM d3_receipts WHERE key='unknown-cleanup-404')
  AND (SELECT f.observed_owned_at IS NULL AND f.confirmed_absent_at IS NULL AND f.delete_started_at IS NULL
    AND j.generate_started_at IS NULL AND j.reservation_released_at IS NULL
    FROM platform_private.document_recognition_provider_files f JOIN platform_private.document_recognition_attempts a ON a.id=f.attempt_id
    JOIN platform_private.document_recognition_jobs j ON j.id=a.job_id
    WHERE j.id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-upload-job')),
  'unknown upload plus cleanup 404 remains unresolved and retains reservation');

-- A fresh explicit retry can process the same source. A later expired generation
-- lease records an unknown outcome, never a second automatic generation attempt.
SET LOCAL request.jwt.claims TO :'staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d3_receipts SELECT 'unknown-generation-job',platform.enqueue_document_recognition(
  (bootstrap->>'organization_id')::UUID,case_id,(upload->>'document_version_id')::UUID,3,gen_random_uuid(),
  (SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-upload-job')) FROM d3_fixture;
RESET ROLE;
INSERT INTO d3_receipts SELECT 'unknown-generation-fingerprint',to_jsonb(platform_private.document_recognition_sha(request_identity ||
  jsonb_build_object('fingerprint_version','evo-document-recognition-request-v1','source_pages',2)))
  FROM platform_private.document_recognition_jobs WHERE id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-generation-job');
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'unknown-generation-claim',platform.claim_document_recognition('synthetic-generation-unknown');
INSERT INTO d3_receipts SELECT 'unknown-generation-seal',platform.seal_document_recognition_preflight(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,repeat('a',64),128,'application/pdf',2,
  (SELECT body #>> '{}' FROM d3_receipts WHERE key='unknown-generation-fingerprint')) FROM d3_receipts WHERE key='unknown-generation-claim';
INSERT INTO d3_receipts SELECT 'unknown-generation-upload',platform.begin_document_recognition_upload(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID) FROM d3_receipts WHERE key='unknown-generation-claim';
INSERT INTO d3_receipts SELECT 'unknown-generation-active',platform.observe_document_recognition_file(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,jsonb_build_object('outcome','present',
    'resource_name',(SELECT body->>'resource_name' FROM d3_receipts WHERE key='unknown-generation-upload'),
    'state','ACTIVE','sha256',repeat('a',64),'bytes',128,'mime_type','application/pdf'))
  FROM d3_receipts WHERE key='unknown-generation-claim';
RESET ROLE;
INSERT INTO d3_receipts SELECT 'unknown-generation-wire-body',jsonb_set(body,'{contents,0,parts,0,fileData,fileUri}',
  to_jsonb('https://generativelanguage.googleapis.com/v1beta/' ||
    (SELECT body->>'resource_name' FROM d3_receipts WHERE key='unknown-generation-upload')))
  FROM d3_receipts WHERE key='synthetic-wire-body';
INSERT INTO d3_receipts SELECT 'unknown-generation-count-receipt',jsonb_build_object('model',config_snapshot->>'model',
  'request_sha256',encode(sha256(convert_to('models/' || (config_snapshot->>'model') || E'\n' ||
    (SELECT body::TEXT FROM d3_receipts WHERE key='unknown-generation-wire-body'),'UTF8')),'hex'),
  'config_sha256',platform_private.document_recognition_sha(config_snapshot),'input_tokens',128)
  FROM platform_private.document_recognition_jobs WHERE id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-generation-job');
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'unknown-generation-count',platform.record_document_recognition_token_count(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='unknown-generation-count-receipt')) FROM d3_receipts WHERE key='unknown-generation-claim';
INSERT INTO d3_receipts SELECT 'unknown-generation-intent',platform.begin_document_recognition_generation(
  (body->>'attempt_id')::UUID,(body->>'claim_token')::UUID,
  (SELECT body FROM d3_receipts WHERE key='unknown-generation-count-receipt')) FROM d3_receipts WHERE key='unknown-generation-claim';
RESET ROLE;
-- Controlled clock fixture only, matching the preflight recovery check above.
UPDATE platform_private.document_recognition_attempts SET lease_until=statement_timestamp()-INTERVAL '1 second'
  WHERE job_id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-generation-job');
SET LOCAL ROLE service_role;
INSERT INTO d3_receipts SELECT 'after-generation-expiry',platform.claim_document_recognition('synthetic-recovery-after-generation');
INSERT INTO d3_receipts SELECT 'after-generation-expiry-again',platform.claim_document_recognition('synthetic-recovery-after-generation');
RESET ROLE;
SELECT pg_temp.d3_assert((SELECT body IS NULL FROM d3_receipts WHERE key='after-generation-expiry')
  AND (SELECT body IS NULL FROM d3_receipts WHERE key='after-generation-expiry-again'), 'expired generation never returns a new dispatch claim');
SELECT pg_temp.d3_assert((SELECT j.state='generation_unknown' AND j.failure_code='generation_unknown'
  AND j.generate_started_at IS NOT NULL AND j.reservation_released_at IS NULL AND a.stage='generation_unknown'
  AND a.id=(SELECT (body->>'attempt_id')::UUID FROM d3_receipts WHERE key='unknown-generation-claim') AND a.ordinal=1
  FROM platform_private.document_recognition_jobs j JOIN platform_private.document_recognition_attempts a ON a.job_id=j.id
  WHERE j.id=(SELECT (body->>'job_id')::UUID FROM d3_receipts WHERE key='unknown-generation-job')), 'unknown generation retains original attempt and paid reservation');
SELECT pg_temp.d3_assert((SELECT count(*)=3 FROM platform_private.document_recognition_attempts)
  AND (SELECT count(*)=3 FROM platform.student_profile_field_proposals)
  AND (SELECT count(*)=1 AND min(revision)=3 FROM platform.student_profiles)
  AND (SELECT count(*)=1 FROM platform.audit_events WHERE action='student.profile.recognition.publish'),
  'uncertain provider outcomes create no extra attempt, proposals, review or publication revision');
-- Exact existing FINGERPRINT vector from tests/document-recognition.test.mjs;
-- only the canonical function's fixed fingerprint_version envelope is added.
SELECT pg_temp.d3_assert(platform_private.document_recognition_sha('{
  "fingerprint_version":"evo-document-recognition-request-v1",
  "organization_id":"10000000-0000-4000-8000-000000000001",
  "student_case_id":"10000000-0000-4000-8000-000000000001",
  "student_profile_id":"10000000-0000-4000-8000-000000000001",
  "source_document_slot_id":"10000000-0000-4000-8000-000000000001",
  "source_version_id":"10000000-0000-4000-8000-000000000001",
  "source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "source_bytes":1000,"source_mime":"application/pdf","source_pages":3,
  "actor_auth_user_id":"10000000-0000-4000-8000-000000000001",
  "actor_membership_id":"10000000-0000-4000-8000-000000000001",
  "purpose":"student_profile","extraction_mode":"student_profile_fields",
  "registry_version":"profile-61-v1","schema_version":1,
  "prompt_policy_version":"extract-v1","config_version":"synthetic-v1",
  "provider_project_id":"synthetic-project","model":"gemini-3.7-flash",
  "expected_profile_revision":1,"retry_of_job_id":null
}'::JSONB)='a4d3c643ef7e3349cdc9d662517cb30ead6d56f5fa3ab3ae59644412b493552b',
  'SQL canonical fingerprint matches unchanged JS v1 golden vector');
ROLLBACK;
\echo DOCUMENT_RECOGNITION_QUEUE_POSITIVE_VERIFIED
