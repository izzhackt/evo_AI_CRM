\set ON_ERROR_STOP on
-- Real PostgreSQL boundary proof; synthetic actors, not an Auth invitation proof.
-- Normal mode rolls back. setup/worker/assert modes belong only to the disposable
-- authorization harness database and leave their exact fixtures until its removal.
\if :{?p135_mode}
\else
  \set p135_mode normal
\endif
\if :{?p135_operation}
\else
  \set p135_operation save
\endif
\if :{?p135_expected_revision}
\else
  \set p135_expected_revision 1
\endif
SELECT :'p135_mode' = 'worker' AS p135_worker,
       :'p135_mode' = 'assert' AS p135_concurrency_assert,
       :'p135_mode' = 'assert_complete' AS p135_concurrency_complete_assert,
       :'p135_mode' = 'setup' AS p135_setup \gset
BEGIN;
CREATE FUNCTION pg_temp.p135_id(p_n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59935000-0000-4000-8000-' || lpad(p_n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p135_assert(p_ok BOOLEAN, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P135: %', p_message; END IF; END $$;
CREATE FUNCTION pg_temp.p135_error(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.p135_id(INTEGER), pg_temp.p135_assert(BOOLEAN,TEXT), pg_temp.p135_error(TEXT)
  TO authenticated, anon, service_role;

\if :p135_worker
  SELECT jsonb_build_object('sub', profile.auth_user_id, 'role', 'authenticated', 'platform_role','student',
    'platform_access_version', profile.access_version, 'platform_organization_id', membership.organization_id,
    'platform_membership_id',membership.id,'platform_bundle_id',bundle.id,'platform_bundle_version',bundle.version)::TEXT AS p135_claims
    FROM platform.profiles profile JOIN platform.organization_memberships membership ON membership.profile_id=profile.id
    JOIN platform.role_bundle_versions bundle ON bundle.id=membership.current_bundle_id
    WHERE profile.id=pg_temp.p135_id(204) \gset
  SELECT id AS p135_attempt FROM platform.student_assessment_attempts
    WHERE student_membership_id=pg_temp.p135_id(304) AND instrument_key='english36' \gset
  SET LOCAL request.jwt.claims TO :'p135_claims';
  SET LOCAL ROLE authenticated;
  SELECT CASE WHEN :'p135_operation'='complete' THEN
    (SELECT jsonb_object_agg('q'||n,'a') FROM generate_series(1,36) n)
    ELSE jsonb_build_object('q1', :'p135_answer') END::TEXT AS p135_worker_answers \gset
  SELECT pg_temp.p135_error(format('SELECT platform.%I(%L,%s,%L,%L)',
    CASE WHEN :'p135_operation'='complete' THEN 'complete_student_assessment_v1' ELSE 'save_student_assessment_answers_v1' END,
    :'p135_attempt', :p135_expected_revision, :'p135_worker_answers', pg_temp.p135_id(:p135_request)::TEXT)) AS p135_worker_result;
  -- Keep the winning write transaction open while its peer reaches the locks.
  SELECT pg_sleep(1);
  COMMIT;
\elif :p135_concurrency_assert
  SELECT pg_temp.p135_assert((SELECT count(*)=1 AND min(revision)=2
    FROM platform.student_assessment_attempts WHERE student_membership_id=pg_temp.p135_id(304) AND status='draft'),
    'concurrent saves must produce exactly one revision');
  SELECT pg_temp.p135_assert((SELECT count(*)=1 FROM platform_private.student_assessment_requests
    WHERE request_id IN (pg_temp.p135_id(991),pg_temp.p135_id(992))), 'only one competing save persisted');
  SELECT pg_temp.p135_assert((SELECT answers IN ('{"q1":"a"}'::JSONB,'{"q1":"b"}'::JSONB)
    FROM platform.student_assessment_attempts WHERE student_membership_id=pg_temp.p135_id(304) AND status='draft'),
    'winner payload is intact');
  ROLLBACK;
\elif :p135_concurrency_complete_assert
  SELECT pg_temp.p135_assert((SELECT count(*)=1 AND min(revision)=3
    FROM platform.student_assessment_attempts WHERE student_membership_id=pg_temp.p135_id(304)),
    'save/complete race must produce exactly one further revision');
  SELECT pg_temp.p135_assert((SELECT count(*)=1 FROM platform_private.student_assessment_requests
    WHERE request_id IN (pg_temp.p135_id(993),pg_temp.p135_id(994))), 'only one save/complete request persisted');
  SELECT pg_temp.p135_assert((SELECT (status='completed' AND result_snapshot#>>'{english,correctCount}'='36')
    OR (status='draft' AND answers='{"q1":"b"}'::JSONB AND result_snapshot IS NULL)
    FROM platform.student_assessment_attempts WHERE student_membership_id=pg_temp.p135_id(304)),
    'save/complete race cannot produce a partial or stale result');
  ROLLBACK;
\else
  CREATE TEMP TABLE p135_actors (n INTEGER, org UUID, role platform.business_role, claims TEXT);
  INSERT INTO p135_actors(n,org,role) SELECT n, pg_temp.p135_id(CASE WHEN n IN(6,7,8,9) THEN 2 ELSE 1 END), role::platform.business_role
    FROM (VALUES(1,'admin'),(2,'sales'),(3,'curator'),(4,'student'),(5,'student'),
      (6,'student'),(7,'sales'),(8,'curator'),(9,'admin')) actor(n,role);
  INSERT INTO platform.organizations(id,name) VALUES(pg_temp.p135_id(1),'P135 isolated A'),(pg_temp.p135_id(2),'P135 isolated B');
  INSERT INTO auth.users(id,email,raw_user_meta_data)
    SELECT pg_temp.p135_id(100+n), 'p135-'||n||'@example.invalid','{}'::JSONB FROM p135_actors;
  INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
    SELECT pg_temp.p135_id(200+n),pg_temp.p135_id(100+n),'P135 actor '||n,'active',1 FROM p135_actors;
  INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id)
    SELECT pg_temp.p135_id(300+n),actor.org,pg_temp.p135_id(200+n),'active',actor.role,
      (SELECT id FROM platform.role_bundle_versions WHERE role=actor.role AND status='published' ORDER BY version DESC LIMIT 1)
    FROM p135_actors actor;
  INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
    VALUES(pg_temp.p135_id(401),pg_temp.p135_id(1),'organization',pg_temp.p135_id(1),1),
      (pg_temp.p135_id(402),pg_temp.p135_id(2),'organization',pg_temp.p135_id(2),1);
  INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
    SELECT pg_temp.p135_id(400+n),org,'student_case',pg_temp.p135_id(500+n),1 FROM p135_actors WHERE role='student';
  INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,
    assignment_version,granted,actor_kind,reason,request_id)
    SELECT org,pg_temp.p135_id(300+n),pg_temp.p135_id(CASE WHEN org=pg_temp.p135_id(1) THEN 401 ELSE 402 END),
      1,1,TRUE,'system','P135 synthetic organization scope',pg_temp.p135_id(600+n) FROM p135_actors;
  INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,
    assignment_version,granted,actor_kind,reason,request_id)
    SELECT org,pg_temp.p135_id(300+n),pg_temp.p135_id(400+n),1,1,TRUE,'system','P135 synthetic case scope',pg_temp.p135_id(700+n)
    FROM p135_actors WHERE role='student';
  -- Seed upstream activated snapshots only. Every assessment operation below
  -- uses normal triggers/privileges; this does not claim runtime provisioning.
  SET LOCAL session_replication_role=replica;
  INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,
    current_curator_membership_id,source_key,contract_confirmation_ref,contract_confirmed_at,student_display_name,
    target_country,target_degree,program_direction,intake,route_approval_status,operational_stage,state,
    handoff_at,portal_activated_at,current_scope_id,current_scope_version)
    SELECT pg_temp.p135_id(500+n),org,pg_temp.p135_id(300+n),
      pg_temp.p135_id(CASE WHEN n=6 THEN 307 ELSE 302 END),pg_temp.p135_id(CASE WHEN n=6 THEN 308 ELSE 303 END),
      'synthetic:p135:'||n,'synthetic:p135:contract:'||n,clock_timestamp(),'P135 Student '||n,
      'China','Bachelor','Engineering','2027','approved','documents','active',clock_timestamp(),clock_timestamp(),pg_temp.p135_id(400+n),1
    FROM p135_actors WHERE role='student';
  SET LOCAL session_replication_role=origin;
  UPDATE p135_actors actor SET claims=jsonb_build_object('sub',profile.auth_user_id,'role','authenticated',
    'platform_role',actor.role,'platform_access_version',profile.access_version,
    'platform_organization_id',membership.organization_id,'platform_membership_id',membership.id,
    'platform_bundle_id',bundle.id,'platform_bundle_version',bundle.version)::TEXT
    FROM platform.profiles profile JOIN platform.organization_memberships membership ON membership.profile_id=profile.id
    JOIN platform.role_bundle_versions bundle ON bundle.id=membership.current_bundle_id
    WHERE profile.id=pg_temp.p135_id(200+actor.n);
  GRANT SELECT ON p135_actors TO authenticated;

  INSERT INTO platform_private.student_assessment_versions(id,instrument_key,version,locale,metadata,questions,grading_rules,published_at)
  SELECT pg_temp.p135_id(801),'english36','test-135','ru','{"title":"Synthetic English","interpretationVersion":"test-1"}',
    jsonb_agg(jsonb_build_object('id','q'||n,'prompt','Synthetic question '||n,
      'topic', CASE WHEN n<=12 THEN 'grammar' WHEN n<=24 THEN 'vocabulary' ELSE 'reading' END,
      'options',jsonb_build_array(jsonb_build_object('id','a','label','A'),jsonb_build_object('id','b','label','B'),
        jsonb_build_object('id','unknown','label','Unknown'))) ORDER BY n),
    jsonb_object_agg('q'||n,jsonb_build_object('correctOptionId','a','explanation','private-answer-explanation',
      'topic', CASE WHEN n<=12 THEN 'grammar' WHEN n<=24 THEN 'vocabulary' ELSE 'reading' END)), '1900-01-01'::TIMESTAMPTZ
  FROM generate_series(1,36) n;
  INSERT INTO platform_private.student_assessment_versions(id,instrument_key,version,locale,metadata,questions,grading_rules,published_at)
  SELECT pg_temp.p135_id(802),'orvis92','test-135','ru','{"title":"Synthetic ORVIS","translationVersion":"test-1"}',
    jsonb_agg(jsonb_build_object('id',n::TEXT,'prompt','Synthetic interest '||n,
      'options',(SELECT jsonb_agg(jsonb_build_object('id',option::TEXT,'label',option::TEXT) ORDER BY option) FROM generate_series(1,5) option)) ORDER BY n),
    jsonb_object_agg(n::TEXT,jsonb_build_object('scale',CASE WHEN n<=12 THEN 'leadership' WHEN n<=25 THEN 'organization'
      WHEN n<=38 THEN 'altruism' WHEN n<=52 THEN 'creativity' WHEN n<=62 THEN 'analysis' WHEN n<=72 THEN 'production'
      WHEN n<=82 THEN 'adventure' ELSE 'erudition' END)), '1900-01-01'::TIMESTAMPTZ
  FROM generate_series(1,92) n;
  SELECT claims AS p135_claims FROM p135_actors WHERE n=4 \gset
  SET LOCAL request.jwt.claims TO :'p135_claims';
  SET LOCAL ROLE authenticated;
  SELECT platform.start_student_assessment_v1('english36',pg_temp.p135_id(901))->>'attemptId' AS p135_attempt \gset
  \if :p135_setup
    COMMIT;
  \else
    SELECT pg_temp.p135_assert(jsonb_array_length(platform.student_assessments_v1()->'instruments')=2,'catalog includes both instruments');
    SELECT pg_temp.p135_assert(platform.student_assessment_attempt_v1(:'p135_attempt')::TEXT NOT LIKE '%correctOptionId%'
      AND platform.student_assessment_attempt_v1(:'p135_attempt')::TEXT NOT LIKE '%private-answer-explanation%', 'draft key must stay private');
    SELECT pg_temp.p135_assert(platform.start_student_assessment_v1('english36',pg_temp.p135_id(901))->>'attemptId'=:'p135_attempt','start replay');
    SELECT pg_temp.p135_assert(platform.start_student_assessment_v1('english36',pg_temp.p135_id(902))->>'attemptId'=:'p135_attempt','new start resumes existing draft');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.start_student_assessment_v1(%L,%L)','orvis92',pg_temp.p135_id(901)))='22023','request identity cannot be reused');
    SELECT pg_temp.p135_assert(platform.save_student_assessment_answers_v1(:'p135_attempt',1,'{"q1":"a"}',pg_temp.p135_id(903))->>'revision'='2','save increments revision');
    SELECT pg_temp.p135_assert(platform.save_student_assessment_answers_v1(:'p135_attempt',1,'{"q1":"a"}',pg_temp.p135_id(903))->>'revision'='2','save replay returns original receipt');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,1,%L,%L)',:'p135_attempt','{"q1":"b"}',pg_temp.p135_id(904)))='40001','stale write does not clobber');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,2,%L,%L)',:'p135_attempt','{"q1":1}',pg_temp.p135_id(905)))='22023','numeric answer rejected');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,2,%L,%L)',:'p135_attempt','{"unknown-key":"a"}',pg_temp.p135_id(906)))='22023','unknown question rejected');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,2,%L,%L)',:'p135_attempt','{"q1":"invalid-option"}',pg_temp.p135_id(906)))='22023','unknown option rejected');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.complete_student_assessment_v1(%L,2,%L,%L)',:'p135_attempt','{"q1":"a"}',pg_temp.p135_id(907)))='22023','incomplete completion rejected');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT * FROM platform.student_assessment_attempts')='42501','direct owner table access denied');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT * FROM platform_private.student_assessment_versions')='42501','direct key access denied');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT platform_private.require_student_assessment_actor_read()')='42501','private helper denied');
    SELECT jsonb_object_agg('q'||n,CASE WHEN n=36 THEN 'unknown' ELSE 'a' END)::TEXT AS p135_answers FROM generate_series(1,36) n \gset
    SELECT platform.complete_student_assessment_v1(:'p135_attempt',2,:'p135_answers',pg_temp.p135_id(908))::TEXT AS p135_completed \gset
    SELECT pg_temp.p135_assert(:'p135_completed'::JSONB#>>'{result,english,correctCount}'='35','unknown is answered but wrong');
    SELECT pg_temp.p135_assert(:'p135_completed'::JSONB#>>'{result,english,band}'='strong','descriptive band');
    SELECT pg_temp.p135_assert(jsonb_array_length(:'p135_completed'::JSONB#>'{result,english,feedback}')=36,'completed feedback available');
    SELECT pg_temp.p135_assert(platform.complete_student_assessment_v1(:'p135_attempt',2,:'p135_answers',pg_temp.p135_id(908))=:'p135_completed'::JSONB,'completion exact replay');
    SELECT pg_temp.p135_assert(platform.student_assessment_attempt_v1(:'p135_attempt')=:'p135_completed'::JSONB,'reload frozen result');
    SELECT pg_temp.p135_assert(platform.save_student_assessment_answers_v1(:'p135_attempt',1,'{"q1":"a"}',pg_temp.p135_id(903))->>'revision'='2'
      AND platform.save_student_assessment_answers_v1(:'p135_attempt',1,'{"q1":"a"}',pg_temp.p135_id(903))->'answers'='{"q1":"a"}'::JSONB,
      'old save replay preserves original snapshot after a newer completion');
    SELECT pg_temp.p135_assert(platform.student_assessment_attempt_v1(:'p135_attempt')=:'p135_completed'::JSONB,'old replay does not roll back current state');
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,3,%L,%L)',:'p135_attempt','{}',pg_temp.p135_id(909)))='40001','completed is not editable');
    SELECT platform.start_student_assessment_v1('english36',pg_temp.p135_id(910))->>'attemptId' AS p135_retry \gset
    SELECT pg_temp.p135_assert(:'p135_retry'<>:'p135_attempt','retake creates another attempt');
    SELECT platform.start_student_assessment_v1('orvis92',pg_temp.p135_id(911))->>'attemptId' AS p135_orvis \gset
    SELECT jsonb_object_agg(n::TEXT,'3')::TEXT AS p135_orvis_answers FROM generate_series(1,92) n \gset
    SELECT platform.complete_student_assessment_v1(:'p135_orvis',1,:'p135_orvis_answers',pg_temp.p135_id(912))::TEXT AS p135_orvis_result \gset
    SELECT pg_temp.p135_assert(jsonb_array_length(:'p135_orvis_result'::JSONB#>'{result,orvis,topScales}')=8,'all tied scales preserved');
    SELECT pg_temp.p135_assert((SELECT bool_and((value->>'mean')::NUMERIC=3 AND (value->>'rawSum')::INTEGER=(value->>'itemCount')::INTEGER*3)
      FROM jsonb_array_elements(:'p135_orvis_result'::JSONB#>'{result,orvis,scales}')),'ORVIS counts and means');
    RESET ROLE;
    DO $$ DECLARE correct INTEGER; answers JSONB; grade JSONB; content platform_private.student_assessment_versions%ROWTYPE;
    BEGIN
      SELECT * INTO content FROM platform_private.student_assessment_versions WHERE id=pg_temp.p135_id(801);
      FOREACH correct IN ARRAY ARRAY[0,17,18,27,28,36] LOOP
        SELECT jsonb_object_agg('q'||n,CASE WHEN n<=correct THEN 'a' ELSE 'unknown' END) INTO answers FROM generate_series(1,36) n;
        grade:=platform_private.grade_student_assessment(content,answers,clock_timestamp());
        PERFORM pg_temp.p135_assert((grade#>>'{english,correctCount}')::INTEGER=correct,'boundary score');
        PERFORM pg_temp.p135_assert(grade#>>'{english,band}'=CASE WHEN correct<=17 THEN 'basic' WHEN correct<=27 THEN 'developing' ELSE 'strong' END,'boundary band');
      END LOOP;
    END $$;

    -- Other Student, another organization, Admin and Curator are all denied.
    DO $$ DECLARE actor RECORD; target UUID; BEGIN
      SELECT id INTO target FROM platform.student_assessment_attempts WHERE student_membership_id=pg_temp.p135_id(304) AND status='completed' AND instrument_key='english36';
      FOR actor IN SELECT * FROM p135_actors WHERE n IN(1,3,5,6) LOOP
        PERFORM set_config('request.jwt.claims',actor.claims,TRUE);
        SET LOCAL ROLE authenticated;
        PERFORM pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.student_assessment_attempt_v1(%L)',target))='42501','foreign/staff read denied');
        PERFORM pg_temp.p135_assert(pg_temp.p135_error(format('SELECT platform.save_student_assessment_answers_v1(%L,3,%L,%L)',target,'{}',pg_temp.p135_id(920+actor.n)))='42501','foreign/staff write denied');
        IF actor.role <> 'student' THEN
          PERFORM pg_temp.p135_assert(pg_temp.p135_error('SELECT platform.student_assessments_v1()')='42501','staff catalog denied');
        ELSE
          PERFORM pg_temp.p135_assert(platform.student_assessments_v1()->'attempts'='[]'::JSONB,'foreign student catalog has no attempts');
        END IF;
        RESET ROLE;
      END LOOP;
    END $$;
    SET LOCAL request.jwt.claims TO '{}';
    SET LOCAL ROLE authenticated;
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT platform.student_assessments_v1()')='42501','no session denied');
    RESET ROLE;
    SET LOCAL ROLE anon;
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT platform.student_assessments_v1()')='42501','anon denied');
    RESET ROLE;
    SET LOCAL ROLE service_role;
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT platform.student_assessments_v1()')='42501','service role RPC denied');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT * FROM platform.student_assessment_attempts')='42501','service role table denied despite BYPASSRLS');
    RESET ROLE;
    -- Catalog grants, forced RLS, immutable table guards; no audit leak.
    DO $$ DECLARE routine OID; role_name TEXT; BEGIN
      FOREACH routine IN ARRAY ARRAY['platform.student_assessments_v1()'::regprocedure,
        'platform.student_assessment_attempt_v1(uuid)'::regprocedure,'platform.start_student_assessment_v1(text,uuid)'::regprocedure,
        'platform.save_student_assessment_answers_v1(uuid,bigint,jsonb,uuid)'::regprocedure,
        'platform.complete_student_assessment_v1(uuid,bigint,jsonb,uuid)'::regprocedure] LOOP
        PERFORM pg_temp.p135_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=routine),'definer has pinned search_path');
        FOREACH role_name IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
          PERFORM pg_temp.p135_assert(NOT has_function_privilege(role_name,routine,'EXECUTE'),'restricted grants');
        END LOOP;
      END LOOP;
      PERFORM pg_temp.p135_assert((SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
        WHERE oid IN ('platform.student_assessment_attempts'::regclass,'platform_private.student_assessment_versions'::regclass,
          'platform_private.student_assessment_requests'::regclass)),'forced RLS');
    END $$;
    SELECT pg_temp.p135_assert(pg_temp.p135_error(format('UPDATE platform.student_assessment_attempts SET revision=revision+1 WHERE id=%L',:'p135_attempt'))='55000','completed trigger immutable even for SQL owner');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('UPDATE platform_private.student_assessment_versions SET metadata=metadata')='55000','published content immutable');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('DELETE FROM platform_private.student_assessment_requests')='55000','receipts immutable');
    SELECT pg_temp.p135_assert(pg_temp.p135_error('TRUNCATE platform.student_assessment_attempts CASCADE')='55000','truncate denied');
    SELECT pg_temp.p135_assert(NOT EXISTS(SELECT 1 FROM platform.audit_events WHERE request_id IN
      (SELECT request_id FROM platform_private.student_assessment_requests)),'private answers/results never enter staff audit');
    -- New version does not rebind an existing draft or recompute completed results.
    INSERT INTO platform_private.student_assessment_versions(instrument_key,version,locale,metadata,questions,grading_rules,published_at)
      SELECT instrument_key,'test-135-new',locale,metadata||'{"title":"New version"}',questions,grading_rules,'1901-01-01'::TIMESTAMPTZ
      FROM platform_private.student_assessment_versions WHERE id=pg_temp.p135_id(801);
    SET LOCAL request.jwt.claims TO :'p135_claims';
    SET LOCAL ROLE authenticated;
    SELECT pg_temp.p135_assert(platform.student_assessment_attempt_v1(:'p135_attempt')=:'p135_completed'::JSONB,'old completion remains on content version');
    SELECT pg_temp.p135_assert(platform.start_student_assessment_v1('english36',pg_temp.p135_id(940))->>'version'='test-135','existing draft retains version');
    RESET ROLE;
    -- Revocation closes the RPC even with a formerly valid JWT.
    UPDATE platform.profiles SET access_version=access_version+1 WHERE id=pg_temp.p135_id(204);
    SET LOCAL ROLE authenticated;
    SELECT pg_temp.p135_assert(pg_temp.p135_error('SELECT platform.student_assessments_v1()')='42501','stale access-version denied');
    RESET ROLE;
    ROLLBACK;
  \endif
\endif
