\set ON_ERROR_STOP on
-- Synthetic SQL authorization fixtures only. Every row is rolled back; no Auth
-- invitation, production publication or provider workflow is claimed here.
BEGIN;
CREATE FUNCTION pg_temp.u148_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$ SELECT ('59948000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID $$;
CREATE FUNCTION pg_temp.u148_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'U148: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.u148_error(statement TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN EXECUTE statement; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.u148_id(INTEGER),pg_temp.u148_assert(BOOLEAN,TEXT),pg_temp.u148_error(TEXT) TO authenticated,anon,service_role;
CREATE TEMP TABLE u148_actors(n INT,org UUID,role platform.business_role,claims TEXT);
-- Earlier stateful suites may leave a deliberately restricted, higher-version
-- Sales bundle. A role title or highest version is not a fixed-role contract.
-- Reproduce that condition here too, so this proof also runs independently.
INSERT INTO platform.role_bundle_versions(id,role,version,status,label)
 SELECT pg_temp.u148_id(999),'sales',COALESCE(max(version),0)+1,'draft','U148 restricted Sales regression'
 FROM platform.role_bundle_versions WHERE role='sales';
INSERT INTO platform.role_bundle_permissions(bundle_id,bundle_role,permission_key)
 VALUES(pg_temp.u148_id(999),'sales','organization.read');
UPDATE platform.role_bundle_versions SET status='published',published_at=clock_timestamp() WHERE id=pg_temp.u148_id(999);
INSERT INTO u148_actors SELECT n,pg_temp.u148_id(CASE WHEN n IN(6,7) THEN 2 ELSE 1 END),role::platform.business_role,NULL FROM (VALUES(1,'admin'),(2,'sales'),(3,'curator'),(4,'student'),(5,'finance'),(6,'admin'),(7,'student'),(8,'sales')) actors(n,role);
INSERT INTO platform.organizations(id,name) VALUES(pg_temp.u148_id(1),'U148 isolated A'),(pg_temp.u148_id(2),'U148 isolated B');
INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT pg_temp.u148_id(100+n),'u148-'||n||'@example.invalid','{}'::JSONB FROM u148_actors;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) SELECT pg_temp.u148_id(200+n),pg_temp.u148_id(100+n),'U148 actor '||n,'active',1 FROM u148_actors;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id)
 SELECT pg_temp.u148_id(300+n),a.org,pg_temp.u148_id(200+n),'active',a.role,
 CASE WHEN n=8 THEN pg_temp.u148_id(999) ELSE
  (SELECT id FROM platform.role_bundle_versions WHERE role=a.role AND status='published' AND version=13
   AND id=CASE a.role
    WHEN 'admin' THEN '00000000-0000-4000-8000-000000001301'::UUID
    WHEN 'sales' THEN '00000000-0000-4000-8000-000000001302'::UUID
    WHEN 'curator' THEN '00000000-0000-4000-8000-000000001303'::UUID
    WHEN 'finance' THEN '00000000-0000-4000-8000-000000001304'::UUID
    WHEN 'student' THEN '00000000-0000-4000-8000-000000001305'::UUID END)
 END FROM u148_actors a;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES(pg_temp.u148_id(401),pg_temp.u148_id(1),'organization',pg_temp.u148_id(1),1),(pg_temp.u148_id(402),pg_temp.u148_id(2),'organization',pg_temp.u148_id(2),1);
INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,reason,request_id)
 SELECT org,pg_temp.u148_id(300+n),pg_temp.u148_id(CASE WHEN org=pg_temp.u148_id(1) THEN 401 ELSE 402 END),1,1,TRUE,'system','U148 synthetic scope',pg_temp.u148_id(600+n) FROM u148_actors;
UPDATE u148_actors actor SET claims=jsonb_build_object('sub',profile.auth_user_id,'role','authenticated','platform_role',actor.role,'platform_access_version',profile.access_version,'platform_organization_id',membership.organization_id,'platform_membership_id',membership.id,'platform_bundle_id',bundle.id,'platform_bundle_version',bundle.version)::TEXT
 FROM platform.profiles profile JOIN platform.organization_memberships membership ON membership.profile_id=profile.id JOIN platform.role_bundle_versions bundle ON bundle.id=membership.current_bundle_id WHERE profile.id=pg_temp.u148_id(200+actor.n);
GRANT SELECT ON u148_actors TO authenticated;
CREATE TEMP TABLE u148_content(value JSONB);
INSERT INTO u148_content VALUES ('{"name":"Synthetic University 148","country":"CN","city":null,"overview":"Synthetic public overview","websiteUrl":"https://university.edu","sourceUrl":"https://university.edu/admissions","verifiedOn":"2026-09-10","notes":"Unknown deadline remains unknown","photoKey":null,"programs":[{"id":"cs","title":"Synthetic computer science","level":"bachelor","duration":null,"language":null,"summary":"Synthetic public program","sourceUrl":"https://university.edu/programs/cs","intakes":[{"label":"Next intake","startDate":null,"startMonth":null,"applicationDeadline":null,"deadlineTime":null,"timezone":null,"status":"unknown","note":"Not confirmed","sourceUrl":"https://university.edu/admissions","verifiedOn":"2026-09-10"}]}]}'::JSONB);
GRANT SELECT ON u148_content TO authenticated;
SELECT pg_temp.u148_assert(platform_private.valid_university_content(value),'valid source DTO accepted') FROM u148_content;
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content(NULL),'SQL null fails closed');
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content('null'),'JSON null fails closed');
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content(value||'{"internalNotes":"private"}'),'extra root field rejected') FROM u148_content;
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content(jsonb_set(value,'{programs,0,id}','1')),'numeric program id rejected') FROM u148_content;
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content(jsonb_set(value,'{programs,0,intakes,0,applicationDeadline}','"2026-02-30"')),'invalid calendar rejected') FROM u148_content;
SELECT pg_temp.u148_assert(NOT platform_private.valid_university_content(jsonb_set(value,'{programs,0,intakes,0,deadlineTime}','"17:00"')),'time without date and timezone rejected') FROM u148_content;
SELECT pg_temp.u148_assert(NOT platform_private.university_public_url(url),'unsafe source rejected') FROM unnest(ARRAY['http://university.edu','https://user:secret@university.edu','https://127.0.0.1','https://university.local','https://university.edu?token=secret','https://university.edu?%74oken=secret','https://university.edu#fragment','https://university.edu:8080'])url;
SELECT pg_temp.u148_assert(platform_private.university_public_url('https://another-real-university.ac.uk/program?id=abc'),'manual official source not confined to initial five universities');
SELECT claims AS u148_claims FROM u148_actors WHERE n=1 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT platform.stage_university_catalog_publication(pg_temp.u148_id(1),NULL,0,value,'Synthetic source review',pg_temp.u148_id(801))::TEXT AS u148_stage FROM u148_content \gset
SELECT pg_temp.u148_assert((platform.stage_university_catalog_publication(pg_temp.u148_id(1),NULL,0,value,'Synthetic source review',pg_temp.u148_id(801)))=:'u148_stage'::JSONB,'exact staging replay stable') FROM u148_content;
SELECT (:'u148_stage'::JSONB->>'draftId') AS u148_draft \gset
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1))->'items')='[]','draft is not published');
SELECT pg_temp.u148_assert(jsonb_array_length(platform.admin_university_catalog_drafts(pg_temp.u148_id(1)))=1,'Admin sees pending draft');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.stage_university_catalog_publication(%L,NULL,0,%L,%L,%L)',pg_temp.u148_id(1),jsonb_set(value,'{overview}','"Different"'),'Synthetic source review',pg_temp.u148_id(801)))='23505','changed staging replay denied') FROM u148_content;
SELECT platform.review_university_catalog_publication(pg_temp.u148_id(1),:'u148_draft','publish',pg_temp.u148_id(802))::TEXT AS u148_review \gset
SELECT (:'u148_review'::JSONB->>'institutionId') AS u148_institution \gset
SELECT pg_temp.u148_assert(platform.review_university_catalog_publication(pg_temp.u148_id(1),:'u148_draft','publish',pg_temp.u148_id(802))=:'u148_review'::JSONB,'exact publish replay stable');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1))#>>'{items,0,version}')='1','published revision visible');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.review_university_catalog_publication(%L,%L,''reject'',%L)',pg_temp.u148_id(1),:'u148_draft',pg_temp.u148_id(802)))='23505','conflicting decision replay denied');
RESET ROLE;
SELECT pg_temp.u148_assert((SELECT count(*)=1 FROM platform.catalog_institutions WHERE organization_id=pg_temp.u148_id(1)),'canonical BW5 institution created exactly once');
SELECT pg_temp.u148_assert((SELECT s.review_status='reviewed' AND b.status='approved' FROM platform.catalog_institutions i JOIN platform.source_registry s ON s.id=i.source_registry_id JOIN platform.catalog_import_batches b ON b.id=i.import_batch_id WHERE i.id=:'u148_institution'),'normal source review and approved import provenance retained');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('UPDATE platform_private.university_catalog_publications SET content=content||''{"internal":"changed"}'' WHERE id=%L',:'u148_draft'))='55000','published history immutable');
SET LOCAL ROLE authenticated;
SELECT platform.stage_university_catalog_publication(pg_temp.u148_id(1),:'u148_institution',1,jsonb_set(value,'{overview}','"Revision two"'),'Synthetic update',pg_temp.u148_id(803))::TEXT AS u148_stage2 FROM u148_content \gset
SELECT platform.stage_university_catalog_publication(pg_temp.u148_id(1),:'u148_institution',1,jsonb_set(value,'{overview}','"Competing revision"'),'Synthetic competing update',pg_temp.u148_id(804))::TEXT AS u148_stage3 FROM u148_content \gset
SELECT platform.review_university_catalog_publication(pg_temp.u148_id(1),(:'u148_stage2'::JSONB->>'draftId')::UUID,'publish',pg_temp.u148_id(805));
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.review_university_catalog_publication(%L,%L,''publish'',%L)',pg_temp.u148_id(1),(:'u148_stage3'::JSONB->>'draftId'),pg_temp.u148_id(806)))='40001','competing draft cannot overwrite newer revision');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1))#>>'{items,0,content,overview}')='Revision two','latest exact content visible');
SELECT pg_temp.u148_assert(platform.stage_university_catalog_publication(pg_temp.u148_id(1),NULL,0,value,'Synthetic source review',pg_temp.u148_id(801))=:'u148_stage'::JSONB,'historical receipt never silently becomes newer version') FROM u148_content;
SELECT platform.review_university_catalog_publication(pg_temp.u148_id(1),(:'u148_stage3'::JSONB->>'draftId')::UUID,'reject',pg_temp.u148_id(807));
SELECT pg_temp.u148_assert(platform.admin_university_catalog_drafts(pg_temp.u148_id(1))='[]','rejected draft leaves published card unchanged');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),NULL,'MY')->'items')='[]','country filter excludes unrelated result');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),'does not match')->'items')='[]','search applies in server');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),NULL,NULL,'master')->'items')='[]','level applies in server');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),NULL,NULL,NULL,NULL,1)->'items')='[]','page offset applies');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.staff_university_catalog(%L)',pg_temp.u148_id(2)))='42501','cross organization staff denied');
SELECT pg_temp.u148_assert(pg_temp.u148_error('SELECT platform.student_university_catalog()')='42501','Admin cannot call Student read projection');
SELECT pg_temp.u148_assert(pg_temp.u148_error('SELECT * FROM platform_private.university_catalog_publications')='42501','direct private table denied');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=4 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert((platform.student_university_catalog()#>>'{items,0,content,overview}')='Revision two','Student sees only latest published content without case requirement');
SELECT pg_temp.u148_assert(NOT (platform.student_university_catalog()#>'{items,0}') ?| ARRAY['source_registry_id','created_by_membership_id','reason','actorId','organizationId'],'Student has no workflow or staff metadata');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.admin_university_catalog_drafts(%L)',pg_temp.u148_id(1)))='42501','Student cannot see drafts');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.review_university_catalog_publication(%L,%L,''publish'',%L)',pg_temp.u148_id(1),:'u148_draft',pg_temp.u148_id(810)))='42501','Student cannot approve');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=7 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert((platform.student_university_catalog()->'items')='[]','other organization Student cannot see published content');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=2 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert(jsonb_array_length(platform.staff_university_catalog(pg_temp.u148_id(1))->'items')=1,'Sales can read approved catalogue');
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.admin_university_catalog_drafts(%L)',pg_temp.u148_id(1)))='42501','Sales cannot see private drafts');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=8 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.staff_university_catalog(%L)',pg_temp.u148_id(1)))='42501','higher-version restricted Sales bundle remains denied');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=3 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert(jsonb_array_length(platform.staff_university_catalog(pg_temp.u148_id(1))->'items')=1,'Curator can read approved catalogue');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=5 \gset
SET LOCAL request.jwt.claims TO :'u148_claims'; SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.staff_university_catalog(%L)',pg_temp.u148_id(1)))='42501','Finance does not gain catalogue permission');
RESET ROLE;
SELECT claims AS u148_claims FROM u148_actors WHERE n=1 \gset
SET LOCAL request.jwt.claims TO :'u148_claims';
SET LOCAL ROLE authenticated;
DO $$ DECLARE n INT; content JSONB; receipt JSONB; BEGIN
 FOR n IN 1..31 LOOP
  SELECT value INTO content FROM u148_content;
  content := jsonb_set(content,'{name}',to_jsonb(CASE WHEN n=31 THEN 'ZZZ final matching university' ELSE 'AAA catalogue university '||lpad(n::TEXT,2,'0') END));
  IF n=31 THEN content := jsonb_set(jsonb_set(content,'{country}','"MY"'),'{programs,0,level}','"master"'); END IF;
  receipt := platform.stage_university_catalog_publication(pg_temp.u148_id(1),NULL,0,content,'Synthetic pagination source',gen_random_uuid());
  PERFORM platform.review_university_catalog_publication(pg_temp.u148_id(1),(receipt->>'draftId')::UUID,'publish',gen_random_uuid());
 END LOOP;
END $$;
SELECT pg_temp.u148_assert(jsonb_array_length(platform.staff_university_catalog(pg_temp.u148_id(1))->'items')=30 AND (platform.staff_university_catalog(pg_temp.u148_id(1))->>'nextOffset')='30','bounded page reports next offset');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),NULL,'MY')#>>'{items,0,content,name}')='ZZZ final matching university','country filtering happens before page limit');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),NULL,NULL,'master')#>>'{items,0,content,name}')='ZZZ final matching university','level filtering happens before page limit');
SELECT pg_temp.u148_assert((platform.staff_university_catalog(pg_temp.u148_id(1),'ZZZ')#>>'{items,0,content,name}')='ZZZ final matching university','search filtering happens before page limit');
RESET ROLE;
UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.u148_id(201);
SET LOCAL ROLE authenticated;
SELECT pg_temp.u148_assert(pg_temp.u148_error(format('SELECT platform.review_university_catalog_publication(%L,%L,''publish'',%L)',pg_temp.u148_id(1),:'u148_draft',pg_temp.u148_id(802)))='42501','revoked Admin cannot replay old successful receipt');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.u148_assert(pg_temp.u148_error('SELECT platform.student_university_catalog()')='42501','anon denied');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.u148_assert(pg_temp.u148_error('SELECT platform.student_university_catalog()')='42501','service role cannot impersonate Student');
RESET ROLE;
ROLLBACK;
\echo U148_UNIVERSITY_CATALOGUE_BOUNDARY_PASS
