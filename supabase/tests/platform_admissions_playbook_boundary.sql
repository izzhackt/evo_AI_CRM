\set ON_ERROR_STOP on
\if :{?a137_mode}
\else
 \set a137_mode normal
\endif
SELECT :'a137_mode'='worker' AS a137_worker, :'a137_mode'='assert' AS a137_race_assert, :'a137_mode'='setup' AS a137_setup \gset
-- Fictional upstream handoff snapshots only; not Auth invitation or Sales-provider
-- acceptance. Every admissions operation below uses real role/RLS/RPC/triggers.
BEGIN;
CREATE FUNCTION pg_temp.a137_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$ SELECT ('59137000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID $$;
CREATE FUNCTION pg_temp.a137_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A137: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.a137_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.a137_id(INTEGER),pg_temp.a137_assert(BOOLEAN,TEXT),pg_temp.a137_error(TEXT) TO authenticated,anon,service_role;
\if :a137_worker
 SELECT jsonb_build_object('sub',p.auth_user_id,'role','authenticated','platform_role',m."current_role",'platform_access_version',p.access_version,'platform_organization_id',m.organization_id,'platform_membership_id',m.id,'platform_bundle_id',b.id,'platform_bundle_version',b.version)::TEXT AS a137_claims
 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id JOIN platform.role_bundle_versions b ON b.id=m.current_bundle_id WHERE p.id=pg_temp.a137_id(201) \gset
 SET LOCAL request.jwt.claims TO :'a137_claims'; SET LOCAL ROLE authenticated;
 SELECT pg_temp.a137_error(format('SELECT platform.update_case_admissions_facts_v1(%L,1,%L,NULL,%L,%L,CURRENT_DATE,%L)',pg_temp.a137_id(504),jsonb_build_object('serviceScopeEvidence',:'a137_value')::TEXT,'draft','Concurrent next action',pg_temp.a137_id(:a137_request))) AS a137_worker_result;
 SELECT pg_sleep(1);
 COMMIT;
\elif :a137_race_assert
 SELECT pg_temp.a137_assert((SELECT admissions_version=2 AND admissions_facts->>'serviceScopeEvidence' IN ('First writer','Second writer') FROM platform.student_cases WHERE id=pg_temp.a137_id(504)),'only one racing facts revision persists');
 SELECT pg_temp.a137_assert((SELECT count(*)=1 FROM platform_private.admissions_events WHERE request_id IN (pg_temp.a137_id(9801),pg_temp.a137_id(9802))),'one racing receipt only');
 ROLLBACK;
\else
CREATE TEMP TABLE a137_actors(n INTEGER,org UUID,role platform.business_role,claims TEXT);
INSERT INTO a137_actors(n,org,role) SELECT n,pg_temp.a137_id(CASE WHEN n=6 THEN 2 ELSE 1 END),role::platform.business_role
 FROM (VALUES(1,'admin'),(2,'sales'),(3,'curator'),(4,'curator'),(5,'student'),(6,'admin')) t(n,role);
INSERT INTO platform.organizations(id,name) VALUES(pg_temp.a137_id(1),'A137 Fictional A'),(pg_temp.a137_id(2),'A137 Fictional B');
INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT pg_temp.a137_id(100+n),'a137-'||n||'@example.invalid','{}' FROM a137_actors;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) SELECT pg_temp.a137_id(200+n),pg_temp.a137_id(100+n),'A137 Actor '||n,'active',1 FROM a137_actors;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id)
 SELECT pg_temp.a137_id(300+n),org,pg_temp.a137_id(200+n),'active',role,(SELECT id FROM platform.role_bundle_versions WHERE role=a.role AND status='published' ORDER BY version DESC LIMIT 1) FROM a137_actors a;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 VALUES(pg_temp.a137_id(401),pg_temp.a137_id(1),'organization',pg_temp.a137_id(1),1),(pg_temp.a137_id(402),pg_temp.a137_id(2),'organization',pg_temp.a137_id(2),1);
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
 SELECT pg_temp.a137_id(410+n),pg_temp.a137_id(1),'student_case',pg_temp.a137_id(500+n),2 FROM generate_series(1,5) n;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version,is_active)
 SELECT pg_temp.a137_id(420+n),pg_temp.a137_id(1),'student_case',pg_temp.a137_id(500+n),1,FALSE FROM generate_series(1,5) n;
INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,reason,request_id)
 SELECT org,pg_temp.a137_id(300+n),pg_temp.a137_id(CASE WHEN n=6 THEN 402 ELSE 401 END),1,1,TRUE,'system','A137 synthetic organization scope',pg_temp.a137_id(600+n) FROM a137_actors;
INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,reason,request_id)
 SELECT pg_temp.a137_id(1),pg_temp.a137_id(303),pg_temp.a137_id(410+n),2,1,TRUE,'system','A137 current curator scope',pg_temp.a137_id(620+n) FROM generate_series(1,5) n;
SET LOCAL session_replication_role=replica;
INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,current_curator_membership_id,source_key,student_display_name,target_country,target_degree,operational_stage,state,handoff_at,current_scope_id,current_scope_version)
 SELECT pg_temp.a137_id(500+n),pg_temp.a137_id(1),pg_temp.a137_id(302),pg_temp.a137_id(303),'synthetic:a137:'||n,'A137 Student '||n,CASE WHEN n=2 THEN 'Malaysia' ELSE 'China' END,'Bachelor','contract_confirmed','active',clock_timestamp(),pg_temp.a137_id(410+n),2 FROM generate_series(1,5) n;
INSERT INTO platform.student_case_assignment_events(id,organization_id,student_case_id,event_type,new_curator_membership_id,previous_scope_id,previous_scope_version,new_scope_id,new_scope_version,actor_membership_id,reason,request_id)
 SELECT pg_temp.a137_id(700+n),pg_temp.a137_id(1),pg_temp.a137_id(500+n),'assigned',pg_temp.a137_id(303),pg_temp.a137_id(420+n),1,pg_temp.a137_id(410+n),2,pg_temp.a137_id(301),'Synthetic upstream assignment',pg_temp.a137_id(710+n) FROM generate_series(1,5) n;
INSERT INTO platform.sales_admissions_handoffs(id,organization_id,lead_id,client_id,student_case_id,source_key,handoff_mode,reason,actor_membership_id,actor_profile_id,admissions_owner_membership_id,gate_version,gate_state,workflow_version,sales_context,client_context,provenance,conversation_links)
 SELECT pg_temp.a137_id(800+n),pg_temp.a137_id(1),pg_temp.a137_id(850+n),pg_temp.a137_id(860+n),pg_temp.a137_id(500+n),'canonical-lead:'||pg_temp.a137_id(850+n),'normal','Synthetic accepted Sales context',pg_temp.a137_id(302),pg_temp.a137_id(202),pg_temp.a137_id(303),1,'satisfied',1,'{}','{}','[]','[]' FROM generate_series(1,5) n;
INSERT INTO platform.student_case_handoff_acknowledgements(organization_id,student_case_id,handoff_id,assignment_event_id,curator_membership_id,revision,decision,request_id)
 SELECT pg_temp.a137_id(1),pg_temp.a137_id(500+n),pg_temp.a137_id(800+n),pg_temp.a137_id(700+n),pg_temp.a137_id(303),1,'accepted',pg_temp.a137_id(870+n) FROM generate_series(1,3) n;
INSERT INTO platform.university_applications(id,organization_id,student_case_id,institution_name,program_name,status,latest_evidence_reference,created_by_membership_id,is_primary)
 VALUES(pg_temp.a137_id(975),pg_temp.a137_id(1),pg_temp.a137_id(505),'Historical synthetic university','Historical programme','offer','Historical offer reference',pg_temp.a137_id(301),TRUE),
 (pg_temp.a137_id(976),pg_temp.a137_id(1),pg_temp.a137_id(505),'Alternative synthetic university','Alternative programme','preparation',NULL,pg_temp.a137_id(301),FALSE);
INSERT INTO platform.document_slots(id,organization_id,student_case_id,intent_kind,display_label,group_label,status,created_by_membership_id,removed_at,removed_by_membership_id,removal_reason)
 VALUES(pg_temp.a137_id(970),pg_temp.a137_id(1),pg_temp.a137_id(505),'custom','Active fictional document','Application','required',pg_temp.a137_id(301),NULL,NULL,NULL),
 (pg_temp.a137_id(971),pg_temp.a137_id(1),pg_temp.a137_id(505),'custom','Removed fictional document','Application','required',pg_temp.a137_id(301),clock_timestamp(),pg_temp.a137_id(301),'Fictional removal');
INSERT INTO platform.document_slot_case_links(organization_id,student_case_id,document_slot_id,target_kind,university_application_id,created_by_membership_id)
 SELECT pg_temp.a137_id(1),pg_temp.a137_id(505),pg_temp.a137_id(n),'university_application',pg_temp.a137_id(975),pg_temp.a137_id(301) FROM generate_series(970,971) n;
SET LOCAL session_replication_role=origin;
UPDATE a137_actors a SET claims=jsonb_build_object('sub',p.auth_user_id,'role','authenticated','platform_role',a.role,'platform_access_version',p.access_version,'platform_organization_id',m.organization_id,'platform_membership_id',m.id,'platform_bundle_id',b.id,'platform_bundle_version',b.version)::TEXT
 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id JOIN platform.role_bundle_versions b ON b.id=m.current_bundle_id WHERE p.id=pg_temp.a137_id(200+a.n);
GRANT SELECT ON a137_actors TO authenticated;
CREATE TEMP TABLE a137_receipts(key TEXT PRIMARY KEY,body JSONB);
GRANT ALL ON a137_receipts TO authenticated;
SELECT claims AS a137_admin FROM a137_actors WHERE n=1 \gset
SET LOCAL request.jwt.claims TO :'a137_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a137_assert(jsonb_array_length(platform.admissions_playbook_catalog_v1()->'playbooks')>=2,'published CN/MY content seeded');
INSERT INTO a137_receipts SELECT 'cn',platform.configure_case_admissions_v1(pg_temp.a137_id(501),0,'CN',
 (SELECT (v->>'id')::UUID FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') v WHERE v->>'direction'='CN' LIMIT 1),'Позвонить клиенту',CURRENT_DATE,pg_temp.a137_id(901));
SELECT pg_temp.a137_assert((SELECT body->>'version'='1' FROM a137_receipts WHERE key='cn'),'configure revision one');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.configure_case_admissions_v1(%L,0,%L,NULL,%L,CURRENT_DATE,%L)',pg_temp.a137_id(501),'CN','Other',pg_temp.a137_id(902)))='PT409','stale configuration denied');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,1,%L,%L,%L,%L)',pg_temp.a137_id(501),'decisions','active','Skip stages',pg_temp.a137_id(903)))='22023','cannot skip stages');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.change_student_case_state(%L,%L,%L,%L,%L)',pg_temp.a137_id(1),pg_temp.a137_id(501),'closed','Old bypass',pg_temp.a137_id(904)))='PT409','old lifecycle cannot bypass new gates');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.set_student_case_route(%L,%L,%L,%L,NULL,NULL,NULL,NULL,%L,%L,%L,%L,%L)',pg_temp.a137_id(1),pg_temp.a137_id(501),'China','Bachelor','draft','decisions','Old next action','Old route bypass',pg_temp.a137_id(909)))='PT409','old route RPC cannot bypass configured stage and revision');
SELECT platform.transition_case_admissions_v1(pg_temp.a137_id(501),1,'profile_and_route','active','Приём подтверждён',pg_temp.a137_id(905));
SELECT pg_temp.a137_assert((SELECT platform.configure_case_admissions_v1(pg_temp.a137_id(501),0,'CN',
 (SELECT (v->>'id')::UUID FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') v WHERE v->>'direction'='CN' LIMIT 1),'Позвонить клиенту',CURRENT_DATE,pg_temp.a137_id(901))=body FROM a137_receipts WHERE key='cn'),'exact replay returns original receipt after newer write');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_case_admissions_facts_v1(%L,2,%L,NULL,%L,%L,CURRENT_DATE,%L)',pg_temp.a137_id(501),'{"madeUpFact":"yes"}','approved','Next',pg_temp.a137_id(906)))='22023','unknown keys rejected');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_case_admissions_facts_v1(%L,2,%L,NULL,%L,%L,CURRENT_DATE,%L)',pg_temp.a137_id(501),'{"arrivalOn":"2026-02-30"}','approved','Next',pg_temp.a137_id(907)))='22023','invalid dates rejected');

-- Complete each country using existing application/visa status commands plus
-- the new evidence facts. The alternative application remains preparation.
DO $$
DECLARE n INTEGER; cid UUID; app UUID; alternate UUID; visa UUID; revision BIGINT; av BIGINT; vv BIGINT; r JSONB; f JSONB; d JSONB; v JSONB; stage TEXT; direction TEXT;
BEGIN
 FOR n IN 1..2 LOOP
  cid:=pg_temp.a137_id(500+n); direction:=CASE WHEN n=1 THEN 'CN' ELSE 'MY' END;
  IF n=2 THEN
   SELECT (p->>'id')::UUID INTO app FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') p WHERE p->>'direction'=direction LIMIT 1;
   PERFORM platform.configure_case_admissions_v1(cid,0,direction,app,'Приём дела',CURRENT_DATE,gen_random_uuid());
   PERFORM platform.transition_case_admissions_v1(cid,1,'profile_and_route','active','Приём подтверждён',gen_random_uuid());
  END IF;
  r:=platform.create_university_application(pg_temp.a137_id(1),cid,'Synthetic University','Synthetic Programme','preparation',NULL,NULL,FALSE,NULL,direction,'Bachelor',0,gen_random_uuid()); app:=(r->>'university_application_id')::UUID;
  IF app IS NULL THEN RAISE EXCEPTION 'Application create contract returned no ID: %',r; END IF;
  r:=platform.create_university_application(pg_temp.a137_id(1),cid,'Alternative University','Alternative','preparation',NULL,NULL,FALSE,NULL,direction,'Bachelor',0,gen_random_uuid()); alternate:=(r->>'university_application_id')::UUID;
  f:=jsonb_build_object('programme','Engineering','intake','2027','selectionConfirmedOn',CURRENT_DATE,'selectionConfirmedBy','Synthetic client','selectionEvidence','Fictional selection confirmation','housingApplicability','not_required','housingNotRequiredReason','Own accommodation confirmed','plannedArrivalOn',CURRENT_DATE,'receivingContact','Synthetic receiving office','receivingPartyNotifiedOn',CURRENT_DATE,'receivingPartyEvidence','Fictional reception confirmation');
  r:=platform.update_case_admissions_facts_v1(cid,2,f,app,'approved','Согласовать документы',CURRENT_DATE,gen_random_uuid()); revision:=(r->>'version')::BIGINT;
  PERFORM platform.transition_case_admissions_v1(cid,revision,'documents','active','Маршрут согласован',gen_random_uuid()); revision:=revision+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',cid,revision,'applications','active','Missing applicability',gen_random_uuid()))='22023','unknown documents applicability blocks');
  d:=jsonb_build_object('documentsApplicability','not_required','documentsSource','Explicit synthetic institution no-document scope','documentsCheckedOn',CURRENT_DATE,'submissionPartner','Synthetic submission partner','partnerSentOn',CURRENT_DATE,'partnerReceivedOn',CURRENT_DATE,'partnerReceiptEvidence','Fictional partner receipt');
  PERFORM platform.update_application_admissions_details_v1(cid,app,2,d,gen_random_uuid()); av:=3;
  PERFORM platform.transition_case_admissions_v1(cid,revision,'applications','active','Применимость подтверждена',gen_random_uuid()); revision:=revision+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.change_university_application(%L,%L,%L,%L,NULL,%s,%L)',pg_temp.a137_id(1),app,'submitted','Partner receipt',av,gen_random_uuid()))='22023','old submitted command cannot confuse partner receipt with university submission');
  d:=d||jsonb_build_object('universitySubmittedOn',CURRENT_DATE,'universitySubmissionReference','SYN-2026','universitySubmissionEvidence','Fictional actual submission','correctionRequest','Fix spelling');
  PERFORM platform.update_application_admissions_details_v1(cid,app,av,d,gen_random_uuid()); av:=av+1;
  PERFORM platform.change_university_application(pg_temp.a137_id(1),app,'submitted','Fictional actual submission',NULL,av,gen_random_uuid()); av:=av+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',cid,revision,'decisions','active','Open correction',gen_random_uuid()))='22023','unresolved correction blocks');
  d:=d||jsonb_build_object('correctionResolvedOn',CURRENT_DATE,'decisionType','conditional','decisionOn',CURRENT_DATE,'decisionReference','SYN-OFFER','decisionEvidence','Fictional offer','offerConditions','Provide final results','selectedOn',CURRENT_DATE,'selectedBy','Synthetic client','selectionEvidence','Fictional selection');
  PERFORM platform.update_application_admissions_details_v1(cid,app,av,d,gen_random_uuid()); av:=av+1;
  PERFORM platform.change_university_application(pg_temp.a137_id(1),app,'offer','Fictional offer',NULL,av,gen_random_uuid()); av:=av+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_application_admissions_details_v1(%L,%L,%s,%L,%L)',cid,app,av,(d-'universitySubmissionEvidence')::TEXT,gen_random_uuid()))='22023','complete submission evidence cannot be silently removed');
  PERFORM platform.transition_case_admissions_v1(cid,revision,'decisions','active','Решение получено',gen_random_uuid()); revision:=revision+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',cid,revision,'visa_and_predeparture','active','Unfulfilled offer',gen_random_uuid()))='22023','conditional offer does not equal fulfilled conditions');
  d:=d||jsonb_build_object('conditionsFulfilledOn',CURRENT_DATE,'conditionsEvidence','Fictional condition evidence');
  PERFORM platform.update_application_admissions_details_v1(cid,app,av,d,gen_random_uuid());
  PERFORM platform.transition_case_admissions_v1(cid,revision,'visa_and_predeparture','active','Условия выполнены',gen_random_uuid()); revision:=revision+1;
  r:=platform.create_visa_case(pg_temp.a137_id(1),cid,'not_started',NULL,NULL,0,gen_random_uuid()); visa:=(r->>'visa_case_id')::UUID;
  PERFORM pg_temp.a137_assert(visa IS NOT NULL,'existing visa create ID');
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.change_visa_case(%L,%L,%L,%L,NULL,1,%L)',pg_temp.a137_id(1),visa,'approved','A document',gen_random_uuid()))='22023','old visa command needs actual country facts');
  v:=jsonb_build_object('applicability','required','applicabilityReason','Synthetic pre-arrival requirement','applicabilitySource','https://example.invalid/official-test-source','applicabilityCheckedOn',CURRENT_DATE,'passportExpiresOn',CURRENT_DATE+1000);
  IF n=1 THEN
   PERFORM platform.update_visa_admissions_details_v1(cid,visa,1,v,gen_random_uuid());
   PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.change_visa_case(%L,%L,%L,%L,NULL,2,%L)',pg_temp.a137_id(1),visa,'approved','Missing Chinese visa dates',gen_random_uuid()))='22023','CN still needs actual visa issuance and validity');
   v:=v||jsonb_build_object('visaIssuedOn',CURRENT_DATE,'visaExpiresOn',CURRENT_DATE+100);
  END IF;
  PERFORM platform.update_visa_admissions_details_v1(cid,visa,CASE WHEN n=1 THEN 2 ELSE 1 END,v,gen_random_uuid());
  PERFORM platform.change_visa_case(pg_temp.a137_id(1),visa,'approved','Fictional pre-arrival evidence',NULL,CASE WHEN n=1 THEN 3 ELSE 2 END,gen_random_uuid()); vv:=CASE WHEN n=1 THEN 4 ELSE 3 END;
  IF n=2 THEN
   PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',cid,revision,'arrival_and_adaptation','active','MY unknown',gen_random_uuid()))='22023','MY eVAL and entry/MDAC unknown cannot silently pass');
   v:=v||jsonb_build_object('emgsReference','SYN-EMGS','eValStatus','approved','eValReference','SYN-EVAL','eValIssuedOn',CURRENT_DATE,'eValExpiresOn',CURRENT_DATE+90,'eValEvidence','Fictional eVAL','entryVisaApplicability','not_required','entryVisaReason','Explicit synthetic nationality exception','entryVisaSource','https://example.invalid/entry','entryVisaCheckedOn',CURRENT_DATE,'mdacApplicability','required','mdacReason','Synthetic first arrival','mdacSource','https://example.invalid/mdac','mdacCheckedOn',CURRENT_DATE,'mdacSubmittedOn',CURRENT_DATE,'mdacEvidence','Fictional MDAC receipt');
   PERFORM platform.update_visa_admissions_details_v1(cid,visa,vv,v,gen_random_uuid());
  END IF;
  PERFORM platform.transition_case_admissions_v1(cid,revision,'arrival_and_adaptation','active','Въезд и встреча подтверждены',gen_random_uuid()); revision:=revision+1;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',cid,revision,'arrival_and_adaptation','arrived','Tickets only',gen_random_uuid()))='22023','tickets or planned date are not actual arrival');
  f:=f||jsonb_build_object('arrivalOn',CURRENT_DATE,'arrivalConfirmedBy','Synthetic client','arrivalEvidence','Fictional actual arrival','medicalStatus','pending','registrationStatus','pending','studentPassStatus','pending');
  PERFORM platform.update_case_admissions_facts_v1(cid,revision,f,app,'approved','Проверить действия после прибытия',CURRENT_DATE+1,gen_random_uuid()); revision:=revision+1;
  PERFORM platform.transition_case_admissions_v1(cid,revision,'arrival_and_adaptation','arrived','Фактическое прибытие подтверждено',gen_random_uuid());
  r:=platform.staff_case_admissions_workspace_v1(cid);
  PERFORM pg_temp.a137_assert(r#>>'{case,outcome}'='arrived' AND r#>>'{case,state}'='closed','confirmed arrival closes case truthfully');
  IF n=2 THEN PERFORM pg_temp.a137_assert(NOT(r#>'{visa,details}' ?| ARRAY['visaIssuedOn','visaExpiresOn']),'MY journey needs no invented pre-arrival Student Pass or generic visa dates'); END IF;
  PERFORM pg_temp.a137_assert(r#>>'{case,facts,studentPassStatus}'='pending','arrival does not auto-complete Student Pass');
  PERFORM pg_temp.a137_assert((SELECT x->>'status'='preparation' FROM jsonb_array_elements(r->'applications') x WHERE x->>'id'=alternate::TEXT),'alternative remains independent');
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_application_admissions_details_v1(%L,%L,%s,%L,%L)',cid,alternate,1,'{}',gen_random_uuid()))='22023','closed case application facts require reopening');
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_case_admissions_facts_v1(%L,%s,%L,%L,%L,%L,CURRENT_DATE,%L)',cid,(r#>>'{case,version}')::BIGINT,(f||'{"programme":"Silent change"}')::TEXT,app,'approved','Next',gen_random_uuid()))='22023','arrived case cannot silently change selection');
  PERFORM platform.update_case_admissions_facts_v1(cid,(r#>>'{case,version}')::BIGINT,f||jsonb_build_object('medicalStatus','confirmed','medicalOn',CURRENT_DATE,'medicalEvidence','Fictional medical result'),app,'approved','Регистрация после прибытия',CURRENT_DATE+1,gen_random_uuid());
 END LOOP;
END $$;

-- Adopt historical offer state incrementally; canonical primary and document
-- relevance links remain the existing application/document authority.
DO $$ DECLARE r JSONB; d JSONB; BEGIN
 PERFORM platform.configure_case_admissions_v1(pg_temp.a137_id(505),0,'CN',(SELECT (v->>'id')::UUID FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') v WHERE v->>'direction'='CN' LIMIT 1),'Проверить исторические основания',CURRENT_DATE,gen_random_uuid());
 d:='{"submissionPartner":"Historical partner"}';
 PERFORM platform.update_application_admissions_details_v1(pg_temp.a137_id(505),pg_temp.a137_id(975),1,d,gen_random_uuid());
 r:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(505));
 PERFORM pg_temp.a137_assert((SELECT x->>'status'='offer' FROM jsonb_array_elements(r->'applications') x WHERE x->>'id'=pg_temp.a137_id(975)::TEXT),'historical status preserved during partial adoption');
 PERFORM pg_temp.a137_assert((SELECT NOT (x->>'ready')::BOOLEAN FROM jsonb_array_elements(r->'gates') x WHERE x->>'stage'='decisions'),'historical offer alone does not satisfy new decision gate');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_application_admissions_details_v1(%L,%L,2,%L,%L)',pg_temp.a137_id(505),pg_temp.a137_id(975),(d||jsonb_build_object('documentSlotIds',pg_temp.a137_id(971)))::TEXT,gen_random_uuid()))='42501','removed linked document cannot be forged into applicability');
 d:=d||jsonb_build_object('documentsApplicability','required','documentsSource','Fictional primary-app requirement source','documentsCheckedOn',CURRENT_DATE,'documentSlotIds',pg_temp.a137_id(970));
 PERFORM platform.update_application_admissions_details_v1(pg_temp.a137_id(505),pg_temp.a137_id(975),2,d,gen_random_uuid());
 r:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(505));
 PERFORM pg_temp.a137_assert((SELECT NOT (x->>'ready')::BOOLEAN FROM jsonb_array_elements(r->'gates') x WHERE x->>'stage'='documents'),'unapproved applicable document blocks');
 d:=d||jsonb_build_object('documentExceptionSlotIds',pg_temp.a137_id(970),'documentsExceptionReason','Institution explicitly waived this item','documentsExceptionEvidence','Fictional dated waiver');
 PERFORM platform.update_application_admissions_details_v1(pg_temp.a137_id(505),pg_temp.a137_id(975),3,d,gen_random_uuid());
 r:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(505));
 PERFORM pg_temp.a137_assert((SELECT (x->>'ready')::BOOLEAN FROM jsonb_array_elements(r->'gates') x WHERE x->>'stage'='documents'),'explicit scoped document exception accepted');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_application_admissions_details_v1(%L,%L,1,%L,%L)',pg_temp.a137_id(505),pg_temp.a137_id(976),jsonb_build_object('documentSlotIds',pg_temp.a137_id(970))::TEXT,gen_random_uuid()))='42501','document must be linked to exact application, not merely same case');
 PERFORM platform.update_university_application_details(pg_temp.a137_id(1),pg_temp.a137_id(976),TRUE,NULL,'CN','Bachelor',1,gen_random_uuid());
 r:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(505));
 PERFORM pg_temp.a137_assert(r#>>'{case,primaryApplicationId}'=pg_temp.a137_id(976)::TEXT AND (r#>>'{case,version}')::BIGINT>1,'old primary switch uses one authority and invalidates case revision');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_case_admissions_facts_v1(%L,1,%L,%L,%L,%L,CURRENT_DATE,%L)',pg_temp.a137_id(505),'{}',pg_temp.a137_id(975),'draft','Stale primary',gen_random_uuid()))='PT409','stale case cannot overwrite newer primary choice');
END $$;

-- Scope, least privilege, pagination and immutable snapshots.
SELECT platform.configure_case_admissions_v1(pg_temp.a137_id(503),0,'CN',(SELECT (v->>'id')::UUID FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') v WHERE v->>'direction'='CN' LIMIT 1),'Просроченный контакт',CURRENT_DATE-2,pg_temp.a137_id(950));
SELECT pg_temp.a137_assert((SELECT count(*)=1 FROM platform.staff_student_case_page(1,NULL,NULL,NULL,NULL,NULL,'CN',pg_temp.a137_id(303),'overdue') WHERE student_case_id=pg_temp.a137_id(503)),'filters apply before limit');
SELECT platform.transition_case_admissions_v1(pg_temp.a137_id(503),1,'intake','cancelled','Клиент отказался',pg_temp.a137_id(951));
SELECT pg_temp.a137_assert((SELECT s->>'cancelled'='1' AND s->>'arrived'='1' FROM jsonb_array_elements(platform.admissions_direction_summary_v1('CN',NULL,CURRENT_DATE,CURRENT_DATE)->'stock') s),'cancelled and arrived are separate');
SELECT pg_temp.a137_assert((SELECT s->>'count'='1' FROM jsonb_array_elements(platform.admissions_direction_summary_v1('CN',NULL,CURRENT_DATE,CURRENT_DATE)->'periodArrivals') s),'period report counts currently confirmed arrival dates');
SELECT pg_temp.a137_assert(jsonb_array_length(platform.admissions_direction_summary_v1('CN',NULL,CURRENT_DATE-10,CURRENT_DATE-1)->'periodArrivals')=0,'period filter is not current stock');
SELECT pg_temp.a137_assert(pg_temp.a137_error('SELECT * FROM platform_private.admissions_events')='42501','no raw event access');
SELECT pg_temp.a137_assert(pg_temp.a137_error('SELECT * FROM platform_private.admissions_playbook_versions')='42501','no raw playbook access');
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.update_application_admissions_details_v1(%L,%L,1,%L,%L)',pg_temp.a137_id(503),pg_temp.a137_id(9999),'{}',gen_random_uuid()))='42501','resource must match exact case');
-- Real existing Finance commands must stop arrival even if all travel facts exist.
DO $$ DECLARE w JSONB; obligation UUID; BEGIN
 w:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(501));
 PERFORM platform.transition_case_admissions_v1(pg_temp.a137_id(501),(w#>>'{case,version}')::BIGINT,'arrival_and_adaptation','active','Повторная проверка обязательства',pg_temp.a137_id(952));
 obligation:=(platform.create_payment_obligation(pg_temp.a137_id(1),pg_temp.a137_id(501),'Fictional unpaid service','evo_service_fee',1000,'USD',clock_timestamp(),'Проверить оплату','Synthetic Finance gate proof',pg_temp.a137_id(953))->>'payment_obligation_id')::UUID;
 PERFORM platform.assert_case_finance_stop_factor(pg_temp.a137_id(501),obligation,'Fictional unpaid balance','arrival','Проверить оплату','Synthetic obligation reference',0,pg_temp.a137_id(954));
 w:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(501));
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,%s,%L,%L,%L,%L)',pg_temp.a137_id(501),w#>>'{case,version}','arrival_and_adaptation','arrived','All travel facts exist',pg_temp.a137_id(955)))='22023','active Finance stop prevents successful arrival');
 PERFORM pg_temp.a137_assert((SELECT s->>'arrived'='0' FROM jsonb_array_elements(platform.admissions_direction_summary_v1('CN',NULL,CURRENT_DATE,CURRENT_DATE)->'stock') s),'reopened case leaves arrived current stock');
 PERFORM pg_temp.a137_assert(jsonb_array_length(platform.admissions_direction_summary_v1('CN',NULL,CURRENT_DATE,CURRENT_DATE)->'periodArrivals')=0,'reopened cases do not remain in successful arrivals KPI');
END $$;
-- Correcting a confirmed arrival must move the KPI period, not double-count it.
DO $$ DECLARE w JSONB; r JSONB; corrected_date DATE:=CURRENT_DATE-40; BEGIN
 w:=platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(502));
 r:=platform.transition_case_admissions_v1(pg_temp.a137_id(502),(w#>>'{case,version}')::BIGINT,'arrival_and_adaptation','active','Исправляем дату прибытия',pg_temp.a137_id(956));
 PERFORM pg_temp.a137_assert(jsonb_array_length(platform.admissions_direction_summary_v1('MY',NULL,NULL,NULL)->'periodArrivals')=0,'reopened Malaysia result is not success');
 r:=platform.update_case_admissions_facts_v1(pg_temp.a137_id(502),(r->>'version')::BIGINT,(w#>'{case,facts}')||jsonb_build_object('arrivalOn',corrected_date),(w#>>'{case,primaryApplicationId}')::UUID,'approved','Проверить исправленную дату',CURRENT_DATE,pg_temp.a137_id(957));
 r:=platform.transition_case_admissions_v1(pg_temp.a137_id(502),(r->>'version')::BIGINT,'arrival_and_adaptation','arrived','Исправленная дата подтверждена',pg_temp.a137_id(958));
 PERFORM pg_temp.a137_assert(jsonb_array_length(platform.admissions_direction_summary_v1('MY',NULL,CURRENT_DATE,CURRENT_DATE)->'periodArrivals')=0,'date correction removes the superseded arrival month');
 PERFORM pg_temp.a137_assert((SELECT s->>'count'='1' FROM jsonb_array_elements(platform.admissions_direction_summary_v1('MY',NULL,corrected_date,corrected_date)->'periodArrivals') s),'corrected arrival appears exactly once in its effective period');
 PERFORM pg_temp.a137_assert((SELECT s->>'count'='1' FROM jsonb_array_elements(platform.admissions_direction_summary_v1('MY',NULL,NULL,NULL)->'periodArrivals') s),'two arrival confirmations never double-count one case');
 r:=platform.transition_case_admissions_v1(pg_temp.a137_id(502),(r->>'version')::BIGINT,'arrival_and_adaptation','active','Пересмотр итогового результата',pg_temp.a137_id(959));
 PERFORM platform.transition_case_admissions_v1(pg_temp.a137_id(502),(r->>'version')::BIGINT,'arrival_and_adaptation','cancelled','Случай закрыт без подтверждённого успеха',pg_temp.a137_id(961));
 PERFORM pg_temp.a137_assert(jsonb_array_length(platform.admissions_direction_summary_v1('MY',NULL,NULL,NULL)->'periodArrivals')=0,'cancelled case with previous arrival history is not successful arrival');
END $$;
RESET ROLE;
SELECT claims AS a137_curator FROM a137_actors WHERE n=3 \gset
SET LOCAL request.jwt.claims TO :'a137_curator'; SET LOCAL ROLE authenticated;
SELECT pg_temp.a137_assert(platform.staff_case_admissions_workspace_v1(pg_temp.a137_id(501))#>>'{case,direction}'='CN','assigned curator reads current assigned case');
SELECT platform.configure_case_admissions_v1(pg_temp.a137_id(504),0,'CN',(SELECT (v->>'id')::UUID FROM jsonb_array_elements(platform.admissions_playbook_catalog_v1()->'playbooks') v WHERE v->>'direction'='CN' LIMIT 1),'Приём дела',CURRENT_DATE,pg_temp.a137_id(960));
SELECT pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.transition_case_admissions_v1(%L,1,%L,%L,%L,%L)',pg_temp.a137_id(504),'profile_and_route','active','No acknowledgement',gen_random_uuid()))='22023','acknowledgement is required to progress, not to access workspace');
RESET ROLE;
DO $$ DECLARE actor_number INTEGER; claims TEXT; BEGIN
 FOR actor_number IN SELECT a.n FROM a137_actors a WHERE a.n IN (2,4,5,6) LOOP
  SELECT a.claims INTO claims FROM a137_actors a WHERE a.n=actor_number;
  PERFORM set_config('request.jwt.claims',claims,TRUE); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.staff_case_admissions_workspace_v1(%L)',pg_temp.a137_id(501)))='42501','foreign organization/unassigned/Sales/Student denied');
  RESET ROLE;
 END LOOP;
END $$;
-- A receipt is not a capability: even an exact replay rechecks live authority.
UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.a137_id(203);
DO $$ DECLARE old_claims TEXT; published_id UUID; BEGIN
 SELECT claims INTO old_claims FROM a137_actors WHERE n=3;
 SELECT id INTO published_id FROM platform_private.admissions_playbook_versions WHERE direction='CN' ORDER BY published_at DESC LIMIT 1;
 PERFORM set_config('request.jwt.claims',old_claims,TRUE); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.staff_case_admissions_workspace_v1(%L)',pg_temp.a137_id(504)))='42501','stale access-version JWT cannot read assigned case');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error(format('SELECT platform.configure_case_admissions_v1(%L,0,%L,%L,%L,CURRENT_DATE,%L)',pg_temp.a137_id(504),'CN',published_id,'Приём дела',pg_temp.a137_id(960)))='42501','exact replay does not bypass revoked live authority');
 RESET ROLE;
END $$;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{}',TRUE);
SELECT pg_temp.a137_assert(pg_temp.a137_error('SELECT platform.admissions_playbook_catalog_v1()')='42501','sessionless catalog denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.a137_assert(pg_temp.a137_error('SELECT platform.admissions_playbook_catalog_v1()')='42501','service role cannot call staff RPC');
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.a137_assert((SELECT count(*)=2 FROM platform_private.admissions_events WHERE student_case_id=pg_temp.a137_id(502) AND kind='transition' AND outcome='arrived'),'date correction and cancellation preserve both immutable arrival events');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error('UPDATE platform_private.admissions_playbook_versions SET title=title')='55000','published playbooks immutable');
 PERFORM pg_temp.a137_assert(pg_temp.a137_error('DELETE FROM platform_private.admissions_events')='55000','events append-only');
 PERFORM pg_temp.a137_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform_private' AND p.proname LIKE 'admissions_%' AND has_function_privilege('authenticated',p.oid,'EXECUTE')),'private helpers revoked');
 PERFORM pg_temp.a137_assert(NOT EXISTS(SELECT 1 FROM platform.case_tasks WHERE source_key LIKE 'admissions.%' GROUP BY organization_id,student_case_id,source_key HAVING count(*)>1),'no duplicate generated tasks');
END $$;
\if :a137_setup
 COMMIT;
\else
 ROLLBACK;
\endif
\endif
