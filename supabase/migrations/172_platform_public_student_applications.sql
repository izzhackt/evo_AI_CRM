-- Public questionnaire -> verified Auth identity -> Admissions decision.
-- No anonymous business writes, synthetic invitation, Sales/payment facts or
-- Student authority before a successful atomic approval.
BEGIN;

CREATE FUNCTION platform_private.student_application_questionnaire_valid(q JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item JSONB; e JSONB; score NUMERIC; maximum NUMERIC; minimum NUMERIC; step NUMERIC;
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object' OR octet_length(q::TEXT)>8192
 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM
 ARRAY['averageGrade','consent','consentVersion','destinationCountries','educationLevel','english','firstName','fundingSource','gradeScale','intakeSeason','intakeYear','lastName','nationality','phone','requestId','schemaVersion','studyFields','studyLevels','tuitionBudget']::TEXT[]
 OR q->'schemaVersion'<>'1'::JSONB OR q->'consent'<>'true'::JSONB OR q->>'consentVersion'<>'2026-09-18'
 OR q->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
 FOREACH e IN ARRAY ARRAY[q->'firstName',q->'lastName'] LOOP
  IF jsonb_typeof(e)<>'string' OR char_length(e#>>'{}') NOT BETWEEN 1 AND 60
   OR e#>>'{}'<>btrim(e#>>'{}') OR e#>>'{}' ~ '[[:cntrl:]]' THEN RETURN FALSE; END IF;
 END LOOP;
 IF jsonb_typeof(q->'phone')<>'string' OR q->>'phone' !~ '^\+?[0-9 ()-]{7,40}$'
 OR q->>'phone'<>btrim(q->>'phone') OR length(regexp_replace(q->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15
 OR q->>'intakeSeason' NOT IN ('spring','summer','autumn','winter','undecided')
 OR jsonb_typeof(q->'intakeYear')<>'number' OR (q->>'intakeYear')::NUMERIC NOT BETWEEN 2026 AND 2036
 OR trunc((q->>'intakeYear')::NUMERIC)<>(q->>'intakeYear')::NUMERIC
 OR q->>'educationLevel' NOT IN ('secondary','high_school','foundation','diploma','bachelor','master','phd')
 OR q->>'gradeScale' NOT IN ('100','5','4','10','20') OR jsonb_typeof(q->'gradeScale')<>'string'
 OR jsonb_typeof(q->'averageGrade')<>'number' OR (q->>'averageGrade')::NUMERIC NOT BETWEEN 0 AND (q->>'gradeScale')::NUMERIC
 OR NOT ((q->>'nationality')=ANY(string_to_array('AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW',' '))) OR jsonb_typeof(q->'nationality')<>'string'
 OR q->>'tuitionBudget' NOT IN ('under_5000','5000_10000','10000_20000','20000_30000','over_30000','undecided')
 OR q->>'fundingSource' NOT IN ('family','savings','scholarship','loan','employer','undecided') THEN RETURN FALSE; END IF;
 FOREACH e IN ARRAY ARRAY[q->'destinationCountries',q->'studyFields',q->'studyLevels'] LOOP
  IF jsonb_typeof(e)<>'array' OR jsonb_array_length(e)<1
   OR jsonb_array_length(e)<>(SELECT count(DISTINCT v) FROM jsonb_array_elements(e) v) THEN RETURN FALSE; END IF;
 END LOOP;
 IF jsonb_array_length(q->'destinationCountries')>15 OR jsonb_array_length(q->'studyFields')>10
 OR jsonb_array_length(q->'studyLevels')>6 THEN RETURN FALSE; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(q->'destinationCountries') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('CN','MY','DE','FR','ES','IT','NL','PL','HU','AT','CZ','GB','CY','TR','AE') THEN RETURN FALSE; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(q->'studyFields') LOOP
  IF jsonb_typeof(item)<>'string' OR char_length(item#>>'{}') NOT BETWEEN 1 AND 100
  OR item#>>'{}'<>btrim(item#>>'{}') OR item#>>'{}' ~ '[[:cntrl:]]' THEN RETURN FALSE; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(q->'studyLevels') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('foundation','bachelor','master','phd','diploma','language') THEN RETURN FALSE; END IF;
 END LOOP;
 e:=q->'english';
 IF jsonb_typeof(e)<>'object' THEN RETURN FALSE; END IF;
 IF e->>'mode'='self' THEN
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(e) key) IS DISTINCT FROM ARRAY['level','mode']::TEXT[]
   OR e->>'level' NOT IN ('beginner','intermediate','advanced','fluent') THEN RETURN FALSE; END IF;
 ELSIF e->>'mode'='exam' THEN
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(e) key) IS DISTINCT FROM ARRAY['exam','mode','score']::TEXT[]
   OR jsonb_typeof(e->'score')<>'number' OR e->>'exam' NOT IN ('ielts','toefl','toefl_120','pte','duolingo') THEN RETURN FALSE; END IF;
  score:=(e->>'score')::NUMERIC;
  minimum:=CASE e->>'exam' WHEN 'toefl' THEN 1 WHEN 'pte' THEN 10 WHEN 'duolingo' THEN 10 ELSE 0 END;
  maximum:=CASE e->>'exam' WHEN 'ielts' THEN 9 WHEN 'toefl' THEN 6 WHEN 'toefl_120' THEN 120 WHEN 'pte' THEN 90 ELSE 160 END;
  step:=CASE e->>'exam' WHEN 'ielts' THEN 0.5 WHEN 'toefl' THEN 0.5 WHEN 'duolingo' THEN 5 ELSE 1 END;
  IF score<minimum OR score>maximum OR mod(score,step)<>0 THEN RETURN FALSE; END IF;
 ELSE RETURN FALSE; END IF;
 -- Reject explicit JSON nulls and numeric/boolean substitutions in string fields.
 IF EXISTS(SELECT 1 FROM jsonb_each(q) x WHERE x.key IN ('requestId','firstName','lastName','phone','intakeSeason','educationLevel','gradeScale','nationality','tuitionBudget','fundingSource','consentVersion') AND jsonb_typeof(x.value)<>'string')
 OR EXISTS(SELECT 1 FROM jsonb_each(e) x WHERE x.key IN ('mode','level','exam') AND jsonb_typeof(x.value)<>'string') THEN RETURN FALSE; END IF;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE TABLE platform_private.student_application_configuration (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 organization_id UUID NOT NULL REFERENCES platform.organizations(id),
 enabled BOOLEAN NOT NULL DEFAULT TRUE
);
-- A standalone clone with no organization, or a multi-tenant installation,
-- fails closed until an operator binds the intended existing organization.
INSERT INTO platform_private.student_application_configuration(singleton,organization_id)
 SELECT TRUE,min(id::TEXT)::UUID FROM platform.organizations WHERE status='active' HAVING count(*)=1;

CREATE TABLE platform_private.student_applications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES platform.organizations(id),
 auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
 normalized_email TEXT NOT NULL UNIQUE CHECK(normalized_email=lower(btrim(normalized_email)) AND length(normalized_email) BETWEEN 3 AND 320),
 questionnaire JSONB NOT NULL CHECK(platform_private.student_application_questionnaire_valid(questionnaire)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 decided_at TIMESTAMPTZ,
 decided_by_membership_id UUID,
 decision_reason TEXT CHECK(decision_reason IS NULL OR (length(btrim(decision_reason)) BETWEEN 1 AND 1000 AND decision_reason !~ '[[:cntrl:]]')),
 admissions_direction TEXT CHECK(admissions_direction IN ('CN','MY','EUROPE','AE','TR')),
 student_case_id UUID UNIQUE,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,decided_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,student_case_id) REFERENCES platform.student_cases(organization_id,id),
 CHECK((status='pending' AND decided_at IS NULL AND decided_by_membership_id IS NULL AND decision_reason IS NULL AND student_case_id IS NULL AND admissions_direction IS NULL)
 OR (status='rejected' AND decided_at IS NOT NULL AND decided_by_membership_id IS NOT NULL AND decision_reason IS NOT NULL AND student_case_id IS NULL AND admissions_direction IS NULL)
 OR (status='approved' AND decided_at IS NOT NULL AND decided_by_membership_id IS NOT NULL AND decision_reason IS NOT NULL AND student_case_id IS NOT NULL AND admissions_direction IS NOT NULL))
);
CREATE INDEX student_applications_queue_idx ON platform_private.student_applications(organization_id,status,submitted_at DESC,id);
CREATE TABLE platform_private.student_application_receipts (
 request_id UUID PRIMARY KEY,
 application_id UUID NOT NULL REFERENCES platform_private.student_applications(id),
 actor_auth_user_id UUID NOT NULL REFERENCES auth.users(id),
 command TEXT NOT NULL CHECK(command IN ('submit','approve','reject')),
 input JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER student_application_receipts_append_only BEFORE UPDATE OR DELETE ON platform_private.student_application_receipts
 FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_application_receipts_no_truncate BEFORE TRUNCATE ON platform_private.student_application_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
ALTER TABLE platform_private.student_application_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_application_configuration FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_application_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_application_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_application_configuration,platform_private.student_applications,platform_private.student_application_receipts
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

ALTER TABLE platform.student_cases
 ADD COLUMN public_application_id UUID UNIQUE,
 ALTER COLUMN responsible_sales_membership_id DROP NOT NULL,
 ADD CONSTRAINT student_cases_public_application_fkey FOREIGN KEY(organization_id,public_application_id)
 REFERENCES platform_private.student_applications(organization_id,id),
 ADD CONSTRAINT student_cases_sales_or_public_application CHECK(responsible_sales_membership_id IS NOT NULL OR public_application_id IS NOT NULL);
CREATE TRIGGER student_cases_public_application_immutable BEFORE UPDATE ON platform.student_cases
 FOR EACH ROW EXECUTE FUNCTION platform_private.protect_domain_identity('public_application_id');
-- A public application has no Sales scope to revoke. Keep the existing audited
-- curator assignment, scope rotation, lifecycle events and access-version bump.
DO $patch$
DECLARE body TEXT; anchor TEXT;
BEGIN
 body:=pg_get_functiondef('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)'::regprocedure);
 anchor:=$old$    PERFORM platform_private.append_scope_event(
      p_organization_id, target_case.responsible_sales_membership_id,
      previous_scope.id, previous_scope.scope_version, FALSE,
      'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
    );$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'student_application_assignment_source_drift'; END IF;
 body:=replace(body,anchor,'    IF target_case.responsible_sales_membership_id IS NOT NULL THEN'||E'\n'||anchor||E'\n    END IF;');
 EXECUTE body;
END $patch$;

-- These are the two live read projections that join the historical Sales
-- owner. RLS/case scopes remain unchanged; ownerless public cases stay visible.
DO $sales_projection$
DECLARE signature TEXT; body TEXT; anchor TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  'private.platform_staff_application_page(integer,timestamp with time zone,uuid,platform.application_status,uuid,uuid)'
 ] LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  FOREACH anchor IN ARRAY ARRAY['JOIN platform.organization_memberships AS sales_membership','JOIN platform.profiles AS sales_profile'] LOOP
   IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>(CASE WHEN signature LIKE 'platform.staff_student_case_page%' THEN 2 ELSE 1 END) OR strpos(body,'LEFT '||anchor)>0 THEN
    RAISE EXCEPTION 'student_application_sales_projection_source_drift'; END IF;
   -- The first case branch is the full-authority view. Keep the separate
   -- historical Sales-summary branch tied to its actual Sales owner.
   body:=overlay(body placing 'LEFT '||anchor from strpos(body,anchor) for length(anchor));
  END LOOP;
  EXECUTE body;
 END LOOP;
END $sales_projection$;

CREATE FUNCTION platform_private.student_application_direction(country TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN country IN ('CN','MY','AE','TR') THEN country
 WHEN country IN ('DE','FR','ES','IT','NL','PL','HU','AT','CZ','GB','CY') THEN 'EUROPE' END
$$;
CREATE FUNCTION platform_private.student_application_json(p_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'status',a.status,'revision',a.revision,'email',a.normalized_email,
 'questionnaire',a.questionnaire,'submitted_at',a.submitted_at,'decided_at',a.decided_at,
 'decision_reason',a.decision_reason,'student_case_id',a.student_case_id,'admissions_direction',a.admissions_direction)
 FROM platform_private.student_applications a WHERE a.id=p_id
$$;
CREATE FUNCTION platform_private.student_application_verified_email()
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE email TEXT;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
 AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()) AND COALESCE(u.is_anonymous,FALSE)=FALSE;
 IF email IS NULL OR length(email) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'student_application_email_unverified' USING ERRCODE='42501'; END IF;
 RETURN email;
END $$;
CREATE FUNCTION platform_private.student_application_can_manage(p_org UUID,p_direction TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.current_actor_authority() a WHERE a.organization_id=p_org AND a.platform_role IS DISTINCT FROM 'student'
 AND platform_private.staff_context_can_access(p_org,a.membership_id,'profile.read.full','student_case',NULL,NULL,NULL,p_direction)
 AND platform_private.staff_context_can_access(p_org,a.membership_id,'profile.manage','student_case',NULL,NULL,NULL,p_direction)
 AND platform_private.staff_context_can_access(p_org,a.membership_id,'case.curator.assign','student_case',NULL,NULL,NULL,p_direction))
$$;
CREATE FUNCTION platform_private.student_application_visible(p_org UUID,q JSONB)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(q->'destinationCountries') c
 WHERE platform_private.student_application_can_manage(p_org,platform_private.student_application_direction(c)))
$$;
CREATE FUNCTION platform_private.student_application_staff_org()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID;
BEGIN
 SELECT a.organization_id INTO org FROM platform.current_actor_authority() a
 WHERE a.platform_role IS DISTINCT FROM 'student' AND EXISTS(SELECT 1 FROM unnest(ARRAY['CN','MY','EUROPE','AE','TR']) d
 WHERE platform_private.student_application_can_manage(a.organization_id,d));
 IF org IS NULL THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 RETURN org;
END $$;

CREATE FUNCTION platform.own_student_application_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE application_id UUID;
BEGIN
 PERFORM platform_private.student_application_verified_email();
 SELECT a.id INTO application_id FROM platform_private.student_applications a WHERE a.auth_user_id=auth.uid();
 RETURN platform_private.student_application_json(application_id);
END $$;

CREATE FUNCTION platform.submit_student_application_v1(p_request_id UUID,p_questionnaire JSONB,p_expected_revision BIGINT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE email TEXT; org UUID; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB;
BEGIN
 email:=platform_private.student_application_verified_email();
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
 OR NOT platform_private.student_application_questionnaire_valid(p_questionnaire)
 OR (p_questionnaire->>'requestId')::UUID<>p_request_id THEN RAISE EXCEPTION 'student_application_invalid' USING ERRCODE='22023'; END IF;
 SELECT c.organization_id INTO org FROM platform_private.student_application_configuration c JOIN platform.organizations o ON o.id=c.organization_id
 WHERE c.singleton AND c.enabled AND o.status='active';
 IF org IS NULL THEN RAISE EXCEPTION 'student_application_unavailable' USING ERRCODE='55000'; END IF;
 payload:=jsonb_build_object('questionnaire',p_questionnaire,'expected_revision',p_expected_revision);
 PERFORM pg_advisory_xact_lock(hashtextextended('student-application-auth:'||auth.uid()::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('student-application-request:'||p_request_id::TEXT,0));
 SELECT * INTO receipt FROM platform_private.student_application_receipts r WHERE r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_auth_user_id<>auth.uid() OR receipt.command<>'submit' OR receipt.input<>payload THEN RAISE EXCEPTION 'student_application_request_conflict' USING ERRCODE='40001'; END IF;
  RETURN platform_private.student_application_json(receipt.application_id);
 END IF;
 SELECT * INTO app FROM platform_private.student_applications a WHERE a.auth_user_id=auth.uid() FOR UPDATE;
 IF app.id IS NOT NULL THEN
  IF app.organization_id<>org OR app.normalized_email<>email OR app.status<>'rejected' OR app.revision<>p_expected_revision THEN
   RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='40001'; END IF;
 ELSE
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='40001'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=auth.uid()) THEN
  RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='40001'; END IF;
 IF app.id IS NULL THEN
  INSERT INTO platform_private.student_applications(organization_id,auth_user_id,normalized_email,questionnaire)
  VALUES(org,auth.uid(),email,p_questionnaire) RETURNING * INTO app;
 ELSE
  UPDATE platform_private.student_applications SET questionnaire=p_questionnaire,status='pending',revision=revision+1,
   submitted_at=statement_timestamp(),decided_at=NULL,decided_by_membership_id=NULL,decision_reason=NULL
  WHERE id=app.id RETURNING * INTO app;
 END IF;
 INSERT INTO platform_private.student_application_receipts(request_id,application_id,actor_auth_user_id,command,input)
 VALUES(p_request_id,app.id,auth.uid(),'submit',payload);
 RETURN platform_private.student_application_json(app.id);
END $$;

CREATE FUNCTION platform.staff_student_application_pending_count_v1()
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID;
BEGIN
 org:=platform_private.student_application_staff_org();
 RETURN (SELECT count(*) FROM platform_private.student_applications a WHERE a.organization_id=org AND a.status='pending'
 AND platform_private.student_application_visible(org,a.questionnaire));
END $$;
CREATE FUNCTION platform.staff_student_applications_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; applications JSONB; curators JSONB;
BEGIN
 org:=platform_private.student_application_staff_org();
 SELECT COALESCE(jsonb_agg(platform_private.student_application_json(a.id) ORDER BY (a.status='pending') DESC,CASE WHEN a.status='pending' THEN a.submitted_at END ASC,a.submitted_at DESC,a.id),'[]'::JSONB)
 INTO applications FROM (SELECT * FROM platform_private.student_applications a WHERE a.organization_id=org
 AND platform_private.student_application_visible(org,a.questionnaire)
 ORDER BY (a.status='pending') DESC,CASE WHEN a.status='pending' THEN a.submitted_at END ASC,a.submitted_at DESC,a.id LIMIT 100) a;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('membership_id',x.membership_id,'display_name',x.display_name,'directions',x.directions) ORDER BY x.display_name,x.membership_id),'[]'::JSONB)
 INTO curators FROM (
 SELECT i.membership_id,i.display_name,array_agg(d ORDER BY d) directions
 FROM platform.organization_memberships m JOIN platform_private.staff_membership_identity(org,m.id) i ON TRUE
 CROSS JOIN unnest(ARRAY['CN','MY','EUROPE','AE','TR']) d
 WHERE m.organization_id=org AND platform_private.student_application_can_manage(org,d)
 AND platform_private.staff_context_can_access(org,m.id,'case.read.full','student_case',NULL,m.id,NULL,d)
 AND platform_private.staff_context_can_access(org,m.id,'task.manage','student_case',NULL,m.id,NULL,d)
 GROUP BY i.membership_id,i.display_name ORDER BY i.display_name,i.membership_id LIMIT 100) x;
 RETURN jsonb_build_object('applications',applications,'curators',curators,'pending_count',platform.staff_student_application_pending_count_v1());
END $$;
CREATE FUNCTION platform.staff_student_application_for_case_v1(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE app_id UUID; org UUID;
BEGIN
 SELECT c.organization_id,c.public_application_id INTO org,app_id FROM platform.student_cases c WHERE c.id=p_student_case_id;
 IF org IS NULL OR NOT platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id) THEN
  RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 RETURN platform_private.student_application_json(app_id);
END $$;

CREATE FUNCTION platform.decide_student_application_v1(p_application_id UUID,p_expected_revision BIGINT,p_decision TEXT,
 p_admissions_direction TEXT,p_curator_membership_id UUID,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; actor RECORD; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB; member JSONB;
 new_case UUID:=gen_random_uuid(); scope_id UUID:=gen_random_uuid(); profile_id UUID; member_id UUID;
 new_profile UUID; child_membership UUID; child_org_scope UUID; child_curator UUID;
 q JSONB; email TEXT; case_country TEXT; field RECORD; education_label TEXT; budget_label TEXT; language_label TEXT;
BEGIN
 org:=platform_private.student_application_staff_org();
 IF p_application_id IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
 OR p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 OR p_reason ~ '[[:cntrl:]]'
 OR (p_decision='approve' AND (p_admissions_direction IS NULL OR p_admissions_direction NOT IN ('CN','MY','EUROPE','AE','TR') OR p_curator_membership_id IS NULL))
 OR (p_decision='reject' AND (p_admissions_direction IS NOT NULL OR p_curator_membership_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'student_application_invalid' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('application_id',p_application_id,'expected_revision',p_expected_revision,'direction',p_admissions_direction,'curator',p_curator_membership_id,'reason',btrim(p_reason));
 -- Same top-level case-assignment lock and organization/member order as E1.
 PERFORM platform_private.lock_student_case_note_assignment_domain(org);
 PERFORM pg_advisory_xact_lock(hashtextextended('student-application-request:'||p_request_id::TEXT,0));
 PERFORM 1 FROM platform.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id=org AND a.platform_role IS DISTINCT FROM 'student';
 IF NOT FOUND THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.staff_lock_memberships(org,array_remove(ARRAY[actor.membership_id,p_curator_membership_id],NULL::UUID));
 SELECT * INTO app FROM platform_private.student_applications a WHERE a.organization_id=org AND a.id=p_application_id FOR UPDATE;
 IF app.id IS NULL OR NOT platform_private.student_application_visible(org,app.questionnaire) THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 IF p_decision='approve' AND (NOT platform_private.student_application_can_manage(org,p_admissions_direction)
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(app.questionnaire->'destinationCountries') c WHERE platform_private.student_application_direction(c)=p_admissions_direction)) THEN
  RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM platform_private.student_application_receipts r WHERE r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_auth_user_id<>auth.uid() OR receipt.application_id<>app.id OR receipt.command<>p_decision OR receipt.input<>payload THEN
   RAISE EXCEPTION 'student_application_request_conflict' USING ERRCODE='40001'; END IF;
  RETURN platform_private.student_application_json(app.id);
 END IF;
 IF app.status<>'pending' OR app.revision<>p_expected_revision THEN RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='40001'; END IF;
 IF p_decision='reject' THEN
  UPDATE platform_private.student_applications SET status='rejected',revision=revision+1,decided_at=statement_timestamp(),
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason) WHERE id=app.id;
 ELSE
  SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=app.auth_user_id AND u.email_confirmed_at IS NOT NULL
   AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()) AND COALESCE(u.is_anonymous,FALSE)=FALSE FOR UPDATE;
  IF email IS DISTINCT FROM app.normalized_email THEN RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=app.auth_user_id) THEN
   RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='40001'; END IF;
  q:=app.questionnaire;
  education_label:=CASE q->>'educationLevel' WHEN 'secondary' THEN 'Учится в школе' WHEN 'high_school' THEN 'Окончил(а) школу'
   WHEN 'foundation' THEN 'Подготовительная программа' WHEN 'diploma' THEN 'Колледж / диплом' WHEN 'bachelor' THEN 'Бакалавриат' WHEN 'master' THEN 'Магистратура' WHEN 'phd' THEN 'Докторантура' END;
  budget_label:=CASE q->>'tuitionBudget' WHEN 'under_5000' THEN 'До 5 000 USD в год' WHEN '5000_10000' THEN '5 000–10 000 USD в год'
   WHEN '10000_20000' THEN '10 000–20 000 USD в год' WHEN '20000_30000' THEN '20 000–30 000 USD в год'
   WHEN 'over_30000' THEN 'Более 30 000 USD в год' WHEN 'undecided' THEN 'Бюджет пока не определён' END;
  language_label:='Указано студентом: '||CASE WHEN q->'english'->>'mode'='self' THEN
   CASE q->'english'->>'level' WHEN 'beginner' THEN 'начальный английский' WHEN 'intermediate' THEN 'средний английский' WHEN 'advanced' THEN 'продвинутый английский' WHEN 'fluent' THEN 'свободное владение английским' END
   ELSE CASE q->'english'->>'exam' WHEN 'ielts' THEN 'IELTS' WHEN 'toefl' THEN 'TOEFL iBT (шкала 1–6)' WHEN 'toefl_120' THEN 'TOEFL iBT (шкала 0–120)' WHEN 'pte' THEN 'PTE Academic' WHEN 'duolingo' THEN 'Duolingo English Test' END||' '||(q->'english'->>'score') END;
  child_membership:=platform_private.student_portal_child_request_id(p_request_id,'public_student_membership');
  child_org_scope:=platform_private.student_portal_child_request_id(p_request_id,'public_student_org_scope');
  child_curator:=platform_private.student_portal_child_request_id(p_request_id,'public_student_curator');
  member:=platform_private.provision_member_authorized_e1(org,app.auth_user_id,(q->>'firstName')||' '||(q->>'lastName'),
   'student','Approved public Student application',child_membership,actor.profile_id,actor.auth_user_id);
  profile_id:=(member->>'profile_id')::UUID; member_id:=(member->>'membership_id')::UUID;
  PERFORM platform_private.assign_organization_scope_authorized_e1(org,member_id,'Approved public Student application',child_org_scope,actor.profile_id,actor.auth_user_id);
  INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES(scope_id,org,'student_case',new_case,1);
  SELECT CASE WHEN count(*)=1 THEN min(CASE c WHEN 'CN' THEN 'China' WHEN 'MY' THEN 'Malaysia' WHEN 'AE' THEN 'United Arab Emirates' WHEN 'TR' THEN 'Turkey'
   WHEN 'DE' THEN 'Germany' WHEN 'FR' THEN 'France' WHEN 'ES' THEN 'Spain' WHEN 'IT' THEN 'Italy' WHEN 'NL' THEN 'Netherlands'
   WHEN 'PL' THEN 'Poland' WHEN 'HU' THEN 'Hungary' WHEN 'AT' THEN 'Austria' WHEN 'CZ' THEN 'Czech Republic' WHEN 'GB' THEN 'United Kingdom' WHEN 'CY' THEN 'Cyprus' END) ELSE NULL END
  INTO case_country FROM jsonb_array_elements_text(q->'destinationCountries') c WHERE platform_private.student_application_direction(c)=p_admissions_direction;
  INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,source_key,
   student_display_name,target_country,target_degree,intake,operational_stage,current_scope_id,current_scope_version,public_application_id,admissions_direction)
  VALUES(new_case,org,member_id,NULL,'public_student_application:'||app.id::TEXT,(q->>'firstName')||' '||(q->>'lastName'),
   case_country,CASE WHEN jsonb_array_length(q->'studyLevels')=1 THEN CASE q->'studyLevels'->>0
   WHEN 'foundation' THEN 'Подготовительная программа' WHEN 'bachelor' THEN 'Бакалавриат' WHEN 'master' THEN 'Магистратура'
   WHEN 'phd' THEN 'Докторантура' WHEN 'diploma' THEN 'Колледж / диплом' WHEN 'language' THEN 'Языковая программа' END ELSE NULL END,
   CASE q->>'intakeSeason' WHEN 'spring' THEN 'Весна' WHEN 'summer' THEN 'Лето' WHEN 'autumn' THEN 'Осень' WHEN 'winter' THEN 'Зима' ELSE 'Сезон не определён' END||' '||(q->>'intakeYear'),
   'intake_review',scope_id,1,app.id,p_admissions_direction);
  -- Exact existing resource now exists; recheck selected curator under live scopes.
  IF NOT platform_private.staff_can_receive_assignment(org,p_curator_membership_id,'case.read.full','student_case',new_case)
   OR NOT platform_private.staff_can_receive_assignment(org,p_curator_membership_id,'task.manage','student_case',new_case) THEN
   RAISE EXCEPTION 'student_application_curator_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.assign_student_case_curator_authorized_e1(org,new_case,p_curator_membership_id,'Approved public Student application',
   child_curator,actor.profile_id,actor.membership_id,actor.auth_user_id);
  INSERT INTO platform.student_profiles(organization_id,student_case_id,revision,preferred_display_name,legal_display_name,
   citizenship_country,current_education_summary,academic_summary,language_summary,budget_band,decision_participant_labels,
   consent_status,consent_evidence_ref,created_by_membership_id,updated_by_membership_id)
  VALUES(org,new_case,1,(q->>'firstName')||' '||(q->>'lastName'),NULL,q->>'nationality',education_label,
   (q->>'averageGrade')||' / '||(q->>'gradeScale'),
   language_label,budget_label,ARRAY[]::TEXT[],'granted','student_application:'||app.id::TEXT||':consent:2026-09-18',actor.membership_id,actor.membership_id)
  RETURNING id INTO new_profile;
  FOR field IN SELECT * FROM (VALUES
   ('student_first_name',q->>'firstName'),('student_last_name',q->>'lastName'),('mobile_phone',q->>'phone'),('student_email',CASE WHEN length(email)<=120 THEN email ELSE NULL END),
   ('nationality',NULL::TEXT),('current_study_status',education_label),('budget_per_year',budget_label)
  ) AS fields(key,value) WHERE key='nationality' OR value IS NOT NULL LOOP
   INSERT INTO platform.student_profile_fields(organization_id,student_case_id,student_profile_id,field_key,value,review_state,profile_revision)
   VALUES(org,new_case,new_profile,field.key,field.value,'needs_review',1);
  END LOOP;
  PERFORM platform_private.bump_access_version(profile_id);
  UPDATE platform_private.student_applications SET status='approved',revision=revision+1,decided_at=statement_timestamp(),
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason),admissions_direction=p_admissions_direction,student_case_id=new_case WHERE id=app.id;
 END IF;
 INSERT INTO platform_private.student_application_receipts(request_id,application_id,actor_auth_user_id,command,input)
 VALUES(p_request_id,app.id,auth.uid(),p_decision,payload);
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(org,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'student.application.'||p_decision,'student_application',app.id,
 jsonb_build_object('status','pending','revision',app.revision),jsonb_build_object('status',CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
 'revision',app.revision+1,'student_case_id',CASE WHEN p_decision='approve' THEN new_case ELSE NULL END),btrim(p_reason),p_request_id);
 RETURN platform_private.student_application_json(app.id);
END $$;

REVOKE ALL ON FUNCTION platform_private.student_application_questionnaire_valid(JSONB),platform_private.student_application_direction(TEXT),
 platform_private.student_application_json(UUID),platform_private.student_application_verified_email(),platform_private.student_application_can_manage(UUID,TEXT),
 platform_private.student_application_visible(UUID,JSONB),platform_private.student_application_staff_org()
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.own_student_application_v1(),platform.submit_student_application_v1(UUID,JSONB,BIGINT),
 platform.staff_student_application_pending_count_v1(),platform.staff_student_applications_v1(),platform.staff_student_application_for_case_v1(UUID),
 platform.decide_student_application_v1(UUID,BIGINT,TEXT,TEXT,UUID,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.own_student_application_v1(),platform.submit_student_application_v1(UUID,JSONB,BIGINT),
 platform.staff_student_application_pending_count_v1(),platform.staff_student_applications_v1(),platform.staff_student_application_for_case_v1(UUID),
 platform.decide_student_application_v1(UUID,BIGINT,TEXT,TEXT,UUID,TEXT,UUID) TO authenticated;
COMMENT ON TABLE platform_private.student_applications IS 'Canonical self-reported public Student application. Verified Auth owns submission; Admissions approval alone grants existing portal authority. Questionnaire remains source evidence, not staff-confirmed profile facts.';
COMMIT;
