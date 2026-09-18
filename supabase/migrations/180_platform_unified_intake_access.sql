-- Unified-workflow pivot, slice S1 «Заявки и доступ».
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md (§1-§4, §13) + docs/PLAN_CHANGES.md
-- «unified workflow: план-контракт реализации» (2026-09-18).
--
-- Supersedes 177's approve-into-Admissions-case flow. «Кабинет до продажи» is
-- now stored as the SAME canonical chain client -> lead -> student_cases that
-- Website/WhatsApp already use: approving a platform анкета creates/links the
-- canonical lead (never a curator, direction or active case) and opens a
-- state='pending' cabinet with portal_activated_at set. The only curator
-- handoff trigger remains the Sales report (S2, a later slice). Historical
-- approved rows (with admissions_direction/curator already set by the old
-- flow) stay valid under every relaxed constraint below.
--
-- Sections:
--  a) student_applications: add canonical_lead_id; relax the approved-shape
--     CHECK so approval only requires student_case_id (direction stays legal
--     but optional, both for historical and new rows).
--  b) student_application_configuration: add intake_owner_membership_id, the
--     Sales membership that owns leads created straight from the public
--     questionnaire (NULL = no owner yet; approval will create the lead then).
--  c) submit_student_application_v1: unchanged questionnaire/upsert contract,
--     PT409 conflict codes preserved; now also links the canonical
--     client/lead when the configuration has an owner, storing
--     canonical_lead_id on the application row.
--  d) decide_student_application_v1: drops direction/curator entirely.
--     Reject is unchanged. Approve provisions the Student membership exactly
--     as before, ensures the canonical lead exists (creating it with the
--     approving actor's own Sales membership as owner only when the actor is
--     Sales and the submit-time link is absent), and opens a pending,
--     curator-less, portal-activated case linked to that lead.
--  e) student_cases_intake_origin_check: the public-application branch now
--     allows canonical_lead_id/responsible_sales_membership_id to be set
--     (both the historical NULL shape and the new linked shape stay legal).
--  f) student_cases_state_shape_check: the pending branch no longer forbids
--     portal_activated_at (a pending cabinet may now be portal-activated).
--     Portal authority + read models are extended to serve 'pending' cases;
--     see the function list at the bottom of this file.
--  g) staff_student_application_for_lead_v1: a small new staff read used by
--     the lead-card «Доступ к платформе» block (mirrors
--     staff_student_application_for_case_v1's shape/gating, keyed by lead).
--
-- Portal-predicate functions EXTENDED to accept state='pending' (see the
-- bottom DO block for exact current-body anchors and verification):
--   private.platform_can_read_student_portal_case  (core case-read gate;
--     platform.student_portal_cases(), student_portal_documents(),
--     student_portal_notifications_v1/v2() and
--     mark_own_student_portal_notification_read_v2() all delegate to it and
--     needed no separate change)
--   platform.student_portal_overview_v2()            (own inline predicate)
--   platform_private.live_student_portal_recipient    (overdue-notification
--     recipient resolution)
--   private.platform_can_upload_reserved_document
--   platform.admit_student_document_upload_scan
--   private.grant_student_portal_document_download
--   private.grant_document_download_pre_e5             (Student branch only;
--     Admin/Curator branches untouched)
--   private.consume_document_download_grant_pre_e5      (Student branch only)
--   platform.reserve_document_upload_after_ingress_scan (Student branch only)
--   platform.preflight_document_upload                  (Student branch only)
--   platform_private.require_document_storage_actor     (Student branch only)
--   platform_private.require_current_upload_reservation  (Student-owner
--     branch only)
--
-- Deliberately LEFT active/closed-only (documented, not touched):
--   platform.student_portal_applications_v2/visa_cases_v2/*_timeline_v1 and
--     platform.student_portal_finance_v2 — the «Заявки и виза»/Money tabs are
--     being retired (plan §13/S5) and a pending cabinet has no applications,
--     visas or payments yet regardless (no sale exists before approval per
--     plan §6/§10), so these stay correctly empty either way.
--   platform.student_portal_messages() — not reachable from any connected
--     portal route today (no /portal/messages page in
--     STUDENT_PORTAL_PAGE_ALLOWLIST); left untouched, fail-closed bias.
--   private.platform_can_read_student_case, platform.staff_document_queue,
--     staff_student_case_document_workspace, staff_case_access_snapshot,
--     staff_company_file_workspace, private.platform_can_read_document_full/
--     finance_full/communication_full, private.platform_can_access_bw6_case,
--     platform.staff_case_task_target — staff-only readers, no Student branch.
--   platform_private.require_notification_actor — gates staff notification
--     *creation* (admin/sales/curator), not the Student read path.
--   private.message_media_attachment_actor_is_current — Inbox/team-chat media,
--     not the Student portal.
--
-- Style: SECURITY DEFINER, SET search_path='', REVOKE/GRANT pairs, replay via
-- the existing request-id receipt table, and the PT409 conflict codes
-- (Supabase custom-error-code retry guidance, see 178) exactly as 177/178.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) student_applications: canonical_lead_id + relaxed approved-decision shape
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.student_applications
  ADD COLUMN canonical_lead_id UUID,
  ADD CONSTRAINT student_applications_canonical_lead_fkey
    FOREIGN KEY(organization_id,canonical_lead_id)
    REFERENCES platform.leads(organization_id,id);
CREATE INDEX student_applications_canonical_lead_idx
  ON platform_private.student_applications(organization_id,canonical_lead_id)
  WHERE canonical_lead_id IS NOT NULL;

-- The original approved-shape CHECK was declared inline (no CONSTRAINT name),
-- so PostgreSQL auto-named it. Find it by its known definition text rather
-- than guessing the generated name.
DO $student_applications_decision_shape$
DECLARE old_name TEXT;
BEGIN
  SELECT con.conname INTO old_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid=con.conrelid
  JOIN pg_namespace ns ON ns.oid=rel.relnamespace
  WHERE ns.nspname='platform_private' AND rel.relname='student_applications' AND con.contype='c'
    AND pg_get_constraintdef(con.oid) LIKE '%student_case_id IS NOT NULL AND admissions_direction IS NOT NULL))%';
  IF old_name IS NULL THEN RAISE EXCEPTION 'student_application_decision_shape_check_not_found'; END IF;
  EXECUTE format('ALTER TABLE platform_private.student_applications DROP CONSTRAINT %I',old_name);
END
$student_applications_decision_shape$;
ALTER TABLE platform_private.student_applications
  ADD CONSTRAINT student_applications_decision_shape_check CHECK(
   (status='pending' AND decided_at IS NULL AND decided_by_membership_id IS NULL AND decision_reason IS NULL AND student_case_id IS NULL AND admissions_direction IS NULL)
   OR (status='rejected' AND decided_at IS NOT NULL AND decided_by_membership_id IS NOT NULL AND decision_reason IS NOT NULL AND student_case_id IS NULL AND admissions_direction IS NULL)
   OR (status='approved' AND decided_at IS NOT NULL AND decided_by_membership_id IS NOT NULL AND decision_reason IS NOT NULL AND student_case_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- b) student_application_configuration: intake_owner_membership_id
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.student_application_configuration
  ADD COLUMN intake_owner_membership_id UUID,
  ADD CONSTRAINT student_application_configuration_owner_fkey
    FOREIGN KEY(organization_id,intake_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id,id);
-- Left NULL by default: an unset owner means "approval will create the lead
-- instead" (submit_student_application_v1 skips lead creation below), not a
-- placeholder fact. No existing operational process sets this column yet.

-- ---------------------------------------------------------------------------
-- c) submit_student_application_v1: unchanged validation/upsert + lead link
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.submit_student_application_v1(p_request_id UUID,p_questionnaire JSONB,p_expected_revision BIGINT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE email TEXT; org UUID; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB;
 owner_membership_id UUID; linked_client_id UUID; linked_lead_id UUID;
BEGIN
 email:=platform_private.student_application_account_email();
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
  IF receipt.actor_auth_user_id<>auth.uid() OR receipt.command<>'submit' OR receipt.input<>payload THEN RAISE EXCEPTION 'student_application_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN platform_private.student_application_json(receipt.application_id);
 END IF;
 SELECT * INTO app FROM platform_private.student_applications a WHERE a.auth_user_id=auth.uid() FOR UPDATE;
 IF app.id IS NOT NULL THEN
  IF app.organization_id<>org OR app.normalized_email<>email OR app.status<>'rejected' OR app.revision<>p_expected_revision THEN
   RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='PT409'; END IF;
 ELSE
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='PT409'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=auth.uid()) THEN
  RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;
 IF app.id IS NULL THEN
  INSERT INTO platform_private.student_applications(organization_id,auth_user_id,normalized_email,questionnaire)
  VALUES(org,auth.uid(),email,p_questionnaire) RETURNING * INTO app;
 ELSE
  UPDATE platform_private.student_applications SET questionnaire=p_questionnaire,status='pending',revision=revision+1,
   submitted_at=statement_timestamp(),decided_at=NULL,decided_by_membership_id=NULL,decision_reason=NULL
  WHERE id=app.id RETURNING * INTO app;
 END IF;
 -- One person, one card: when the intake owner is configured, link (or
 -- create) the SAME canonical client/lead Website/WhatsApp already use, so a
 -- platform applicant is never a second, independent lead. A NULL owner means
 -- approval will create the lead instead (decide_student_application_v1).
 IF app.canonical_lead_id IS NULL THEN
  SELECT c.intake_owner_membership_id INTO owner_membership_id
  FROM platform_private.student_application_configuration c WHERE c.singleton;
  IF owner_membership_id IS NOT NULL THEN
   linked_client_id:=platform_private.create_or_link_client(org,(p_questionnaire->>'firstName')||' '||(p_questionnaire->>'lastName'),
    email,p_questionnaire->>'phone','evo_platform','client',app.id::TEXT,'platform_application_submitted',statement_timestamp(),NULL,NULL);
   linked_lead_id:=platform_private.create_or_link_lead(org,linked_client_id,owner_membership_id,'new','platform_application',
    'evo_platform','lead',app.id::TEXT,'platform_application_submitted',statement_timestamp(),NULL,NULL);
   UPDATE platform_private.student_applications SET canonical_lead_id=linked_lead_id WHERE id=app.id RETURNING * INTO app;
  END IF;
 END IF;
 INSERT INTO platform_private.student_application_receipts(request_id,application_id,actor_auth_user_id,command,input)
 VALUES(p_request_id,app.id,auth.uid(),'submit',payload);
 RETURN platform_private.student_application_json(app.id);
END $$;

-- ---------------------------------------------------------------------------
-- d) decide_student_application_v1: access-only decision, no direction/curator
-- ---------------------------------------------------------------------------
DROP FUNCTION platform.decide_student_application_v1(UUID,BIGINT,TEXT,TEXT,UUID,TEXT,UUID);

CREATE FUNCTION platform.decide_student_application_v1(p_application_id UUID,p_expected_revision BIGINT,p_decision TEXT,
 p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; actor RECORD; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB; member JSONB;
 new_case UUID:=gen_random_uuid(); scope_id UUID:=gen_random_uuid(); profile_id UUID; member_id UUID;
 new_profile UUID; child_membership UUID; child_org_scope UUID; field RECORD;
 education_label TEXT; budget_label TEXT; language_label TEXT; target_degree_label TEXT; intake_label TEXT;
 q JSONB; email TEXT; lead_id UUID; owner_membership_id UUID;
BEGIN
 org:=platform_private.student_application_staff_org();
 IF p_application_id IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
 OR p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 OR p_reason ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'student_application_invalid' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('application_id',p_application_id,'expected_revision',p_expected_revision,'reason',btrim(p_reason));
 -- Same top-level case-assignment lock and organization/member order as E1.
 PERFORM platform_private.lock_student_case_note_assignment_domain(org);
 PERFORM pg_advisory_xact_lock(hashtextextended('student-application-request:'||p_request_id::TEXT,0));
 PERFORM 1 FROM platform.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id=org AND a.platform_role IS DISTINCT FROM 'student';
 IF NOT FOUND THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.staff_lock_memberships(org,ARRAY[actor.membership_id]);
 SELECT * INTO app FROM platform_private.student_applications a WHERE a.organization_id=org AND a.id=p_application_id FOR UPDATE;
 IF app.id IS NULL OR NOT platform_private.student_application_visible(org,app.questionnaire) THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM platform_private.student_application_receipts r WHERE r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_auth_user_id<>auth.uid() OR receipt.application_id<>app.id OR receipt.command<>p_decision OR receipt.input<>payload THEN
   RAISE EXCEPTION 'student_application_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN platform_private.student_application_json(app.id);
 END IF;
 IF app.status<>'pending' OR app.revision<>p_expected_revision THEN RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='PT409'; END IF;
 IF p_decision='reject' THEN
  -- Rejecting a public application never touches a linked lead: the contact,
  -- source and history stay exactly as they are (plan §4).
  UPDATE platform_private.student_applications SET status='rejected',revision=revision+1,decided_at=statement_timestamp(),
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason) WHERE id=app.id;
 ELSE
  SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=app.auth_user_id AND u.email_confirmed_at IS NOT NULL
   AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()) AND COALESCE(u.is_anonymous,FALSE)=FALSE FOR UPDATE;
  IF email IS DISTINCT FROM app.normalized_email THEN RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=app.auth_user_id) THEN
   RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;
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
  member:=platform_private.provision_member_authorized_e1(org,app.auth_user_id,(q->>'firstName')||' '||(q->>'lastName'),
   'student','Approved public Student application',child_membership,actor.profile_id,actor.auth_user_id);
  profile_id:=(member->>'profile_id')::UUID; member_id:=(member->>'membership_id')::UUID;
  PERFORM platform_private.assign_organization_scope_authorized_e1(org,member_id,'Approved public Student application',child_org_scope,actor.profile_id,actor.auth_user_id);
  INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES(scope_id,org,'student_case',new_case,1);
  -- Ensure the SAME canonical lead the submit step may already have linked.
  -- Approval never creates a second lead: if submit-time linking was skipped
  -- (no configured owner), create it now with the approving actor's own Sales
  -- membership as owner only when the actor actually is Sales; otherwise the
  -- lead is created ownerless (still legal; Sales can claim it from Заявки).
  lead_id:=app.canonical_lead_id;
  IF lead_id IS NULL THEN
   DECLARE linked_client_id UUID;
   BEGIN
    linked_client_id:=platform_private.create_or_link_client(org,(q->>'firstName')||' '||(q->>'lastName'),email,q->>'phone',
     'evo_platform','client',app.id::TEXT,'platform_application_approved',statement_timestamp(),NULL,NULL);
    owner_membership_id:=CASE WHEN actor.platform_role='sales' THEN actor.membership_id ELSE NULL END;
    lead_id:=platform_private.create_or_link_lead(org,linked_client_id,owner_membership_id,'new','platform_application',
     'evo_platform','lead',app.id::TEXT,'platform_application_approved',statement_timestamp(),NULL,NULL);
   END;
   UPDATE platform_private.student_applications SET canonical_lead_id=lead_id WHERE id=app.id;
  END IF;
  SELECT l.current_owner_membership_id INTO owner_membership_id FROM platform.leads l WHERE l.organization_id=org AND l.id=lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
  target_degree_label:=CASE WHEN jsonb_array_length(q->'studyLevels')=1 THEN CASE q->'studyLevels'->>0
   WHEN 'foundation' THEN 'Подготовительная программа' WHEN 'bachelor' THEN 'Бакалавриат' WHEN 'master' THEN 'Магистратура'
   WHEN 'phd' THEN 'Докторантура' WHEN 'diploma' THEN 'Колледж / диплом' WHEN 'language' THEN 'Языковая программа' END ELSE NULL END;
  intake_label:=CASE q->>'intakeSeason' WHEN 'spring' THEN 'Весна' WHEN 'summer' THEN 'Лето' WHEN 'autumn' THEN 'Осень' WHEN 'winter' THEN 'Зима' ELSE 'Сезон не определён' END||' '||(q->>'intakeYear');
  -- No direction is chosen here (plan §4/§8): «Вузы и программы» stay a
  -- later, manual Admissions step. target_country stays NULL; target_degree
  -- is real data from the questionnaire's study level and needs no direction.
  INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,source_key,
   student_display_name,target_country,target_degree,intake,operational_stage,state,portal_activated_at,
   current_scope_id,current_scope_version,public_application_id,canonical_lead_id)
  VALUES(new_case,org,member_id,owner_membership_id,'public_student_application:'||app.id::TEXT,(q->>'firstName')||' '||(q->>'lastName'),
   NULL,target_degree_label,intake_label,'intake_review','pending',statement_timestamp(),
   scope_id,1,app.id,lead_id);
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
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason),student_case_id=new_case,admissions_direction=NULL WHERE id=app.id;
 END IF;
 INSERT INTO platform_private.student_application_receipts(request_id,application_id,actor_auth_user_id,command,input)
 VALUES(p_request_id,app.id,auth.uid(),p_decision,payload);
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(org,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'student.application.'||p_decision,'student_application',app.id,
 jsonb_build_object('status','pending','revision',app.revision),jsonb_build_object('status',CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
 'revision',app.revision+1,'student_case_id',CASE WHEN p_decision='approve' THEN new_case ELSE NULL END),btrim(p_reason),p_request_id);
 RETURN platform_private.student_application_json(app.id);
END $$;

-- student_application_json: expose canonical_lead_id (the client decoder's
-- exact-key check is updated in the same slice, src/lib/v3/student-application-source.ts).
CREATE OR REPLACE FUNCTION platform_private.student_application_json(p_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'status',a.status,'revision',a.revision,'email',a.normalized_email,
 'questionnaire',a.questionnaire,'submitted_at',a.submitted_at,'decided_at',a.decided_at,
 'decision_reason',a.decision_reason,'student_case_id',a.student_case_id,'admissions_direction',a.admissions_direction,
 'canonical_lead_id',a.canonical_lead_id)
 FROM platform_private.student_applications a WHERE a.id=p_id
$$;

-- New small staff read for the lead-card «Доступ к платформе» block: mirrors
-- staff_student_application_for_case_v1's shape/gating but is keyed by the
-- canonical lead (an application may be linked to a lead well before any
-- case/approval exists). Uses the same lead-read authority as the rest of
-- the lead card (private.platform_can_read_canonical_lead).
CREATE FUNCTION platform.staff_student_application_for_lead_v1(p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID; app_id UUID;
BEGIN
 SELECT l.organization_id INTO org FROM platform.leads l WHERE l.id=p_lead_id;
 IF org IS NULL OR NOT EXISTS(SELECT 1 FROM platform.current_actor_authority() a WHERE a.organization_id=org)
  OR NOT private.platform_can_read_canonical_lead(org,p_lead_id) THEN
  RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 SELECT a.id INTO app_id FROM platform_private.student_applications a
  WHERE a.organization_id=org AND a.canonical_lead_id=p_lead_id
  ORDER BY a.submitted_at DESC,a.id DESC LIMIT 1;
 RETURN platform_private.student_application_json(app_id);
END $$;

REVOKE ALL ON FUNCTION platform.submit_student_application_v1(UUID,JSONB,BIGINT),
 platform.decide_student_application_v1(UUID,BIGINT,TEXT,TEXT,UUID),
 platform.staff_student_application_for_lead_v1(UUID),
 platform_private.student_application_json(UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.submit_student_application_v1(UUID,JSONB,BIGINT),
 platform.decide_student_application_v1(UUID,BIGINT,TEXT,TEXT,UUID),
 platform.staff_student_application_for_lead_v1(UUID)
 TO authenticated;

-- ---------------------------------------------------------------------------
-- e) student_cases: relax the intake-origin and state-shape CHECKs
-- ---------------------------------------------------------------------------
-- The public-application branch used to REQUIRE canonical_lead_id IS NULL.
-- Both shapes are now legal: a historical row created before this slice (no
-- lead), and a new row created by this slice (lead always set). The final
-- clause dropped below also let responsible_sales_membership_id stay NULL;
-- that remains true (the first disjunct only fires when it IS set).
ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_intake_origin_check,
  ADD CONSTRAINT student_cases_intake_origin_check CHECK(
   responsible_sales_membership_id IS NOT NULL
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('docs-intake:'||id::TEXT)
    AND canonical_client_id IS NOT NULL AND canonical_lead_id IS NULL
   )
   OR (
    public_application_id IS NOT NULL
    AND source_key IS NOT DISTINCT FROM ('public_student_application:'||public_application_id::TEXT)
    AND student_membership_id IS NOT NULL
   )
  );

-- A «кабинет до продажи» pending case may now carry a live portal activation.
-- portal_activated_at stays governed by student_cases_portal_membership_shape_check
-- (088: requires student_membership_id when set, unconditionally on state) —
-- a pending public-application case always has student_membership_id set, so
-- that guard still holds. Only the pending branch's own NULL requirement for
-- portal_activated_at is dropped here; curator/handoff stay forbidden while
-- pending (only a Sales report handoff, S2, may set them).
ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_state_shape_check,
  ADD CONSTRAINT student_cases_state_shape_check CHECK (
    (
      state = 'pending'
      AND current_curator_membership_id IS NULL
      AND handoff_at IS NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'active'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'closed'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND closed_at IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- f) Portal authority + read models: accept a portal-activated 'pending' case
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.evo_u8_portal_pending_replace(p_signature TEXT, p_before TEXT, p_after TEXT, p_expected INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO body;
  occurrences := (length(body) - length(replace(body, p_before, ''))) / length(p_before);
  IF occurrences <> p_expected THEN
    RAISE EXCEPTION 'evo_u8_portal_pending_anchor_mismatch: % (% instead of %)', p_signature, occurrences, p_expected;
  END IF;
  EXECUTE replace(body, p_before, p_after);
END
$$;

-- Core case-read gate. student_portal_cases(), student_portal_documents(),
-- student_portal_notifications_v1/v2() and
-- mark_own_student_portal_notification_read_v2() all delegate to this and
-- need no separate change.
SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.platform_can_read_student_portal_case(uuid,uuid)',
  $$      AND membership."current_role" = 'student'
      AND student_case.state IN ('active', 'closed')
      AND student_case.portal_activated_at IS NOT NULL$$,
  $$      AND membership."current_role" = 'student'
      AND student_case.state IN ('pending', 'active', 'closed')
      AND student_case.portal_activated_at IS NOT NULL$$);

-- Overview (own inline predicate in addition to the core gate above).
SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform.student_portal_overview_v2()',
  $$  WHERE student_case.state IN ('active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$  WHERE student_case.state IN ('pending', 'active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL$$);

-- Overdue-notification recipient resolution (cron-driven notification
-- creation; harmless no-op today since a pending case has no deadlines yet,
-- included for completeness per the notifications family).
SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform_private.live_student_portal_recipient(uuid,uuid)',
  $$    AND student_case.state IN ('active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$    AND student_case.state IN ('pending', 'active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL$$);

-- Upload/download chain (Student branch only; Admin/Curator branches, which
-- a pending case cannot satisfy anyway, are untouched).
SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.platform_can_upload_reserved_document(text,text)',
  $$        OR (
          membership."current_role" = 'student'
          AND student_case.state IN ('active', 'closed')
          AND student_case.student_membership_id = membership.id
          AND student_case.portal_activated_at IS NOT NULL$$,
  $$        OR (
          membership."current_role" = 'student'
          AND student_case.state IN ('pending', 'active', 'closed')
          AND student_case.student_membership_id = membership.id
          AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform.admit_student_document_upload_scan(uuid,uuid,uuid)',
  $$    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$    AND student_case.state IN ('pending', 'active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.grant_student_portal_document_download(uuid,uuid,uuid)',
  $$    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$    AND student_case.state IN ('pending', 'active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$);

-- Two occurrences (preliminary check + post-lock recheck); each is patched
-- individually by its own local table alias.
SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);
SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
  $$    OR (
      actor.actor_role IS NOT DISTINCT FROM 'student'
      AND case_row.state IN ('active', 'closed')
      AND case_row.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND case_row.portal_activated_at IS NOT NULL$$,
  $$    OR (
      actor.actor_role IS NOT DISTINCT FROM 'student'
      AND case_row.state IN ('pending', 'active', 'closed')
      AND case_row.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND case_row.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'private.consume_document_download_grant_pre_e5(uuid,uuid)',
  $$      OR (membership."current_role" = 'student'
        AND download_grant.grantee_role = 'student'
        AND student_case.state IN ('active', 'closed') AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (membership."current_role" = 'student'
        AND download_grant.grantee_role = 'student'
        AND student_case.state IN ('pending', 'active', 'closed') AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform_private.require_document_storage_actor(uuid,uuid,text)',
  $$    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('active','closed')
      AND c.student_membership_id=a.actor_membership_id AND c.portal_activated_at IS NOT NULL$$,
  $$    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('pending','active','closed')
      AND c.student_membership_id=a.actor_membership_id AND c.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_u8_portal_pending_replace(
  'platform_private.require_current_upload_reservation(uuid,uuid,text)',
  $$      AND c.student_membership_id = m.id AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL$$,
  $$      AND c.student_membership_id = m.id AND c.state IN ('pending', 'active', 'closed') AND c.portal_activated_at IS NOT NULL$$);

NOTIFY pgrst,'reload schema';
COMMIT;
