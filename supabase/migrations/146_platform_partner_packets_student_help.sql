-- O3: immutable partner packet metadata and case-bound Student help.
-- Files stay in canonical private Storage; preparing is not sending.
-- https://supabase.com/docs/guides/database/functions
BEGIN;
CREATE TABLE platform_private.partner_packets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 student_case_id UUID NOT NULL,application_id UUID NOT NULL,created_by_membership_id UUID NOT NULL,
 request_id UUID NOT NULL UNIQUE,version_ids UUID[] NOT NULL CHECK(cardinality(version_ids) BETWEEN 1 AND 50),
 manifest JSONB NOT NULL CHECK(jsonb_typeof(manifest)='object'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,student_case_id) REFERENCES platform.student_cases(organization_id,id),
 FOREIGN KEY(organization_id,application_id,student_case_id) REFERENCES platform.university_applications(organization_id,id,student_case_id),
 FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE INDEX partner_packets_case_idx ON platform_private.partner_packets(organization_id,student_case_id,created_at DESC,id DESC);
CREATE TABLE platform.case_help_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,student_case_id UUID NOT NULL,
 student_membership_id UUID NOT NULL,subject TEXT NOT NULL CHECK(length(btrim(subject)) BETWEEN 1 AND 160),
 body TEXT NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),answer TEXT CHECK(length(btrim(answer)) BETWEEN 1 AND 4000),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),answered_by_membership_id UUID,answered_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,id,student_case_id),
 FOREIGN KEY(organization_id,student_case_id) REFERENCES platform.student_cases(organization_id,id),
 FOREIGN KEY(organization_id,student_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,answered_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 CHECK((status='open' AND answer IS NULL AND answered_at IS NULL AND answered_by_membership_id IS NULL)
  OR(status='answered' AND answer IS NOT NULL AND answered_at IS NOT NULL AND answered_by_membership_id IS NOT NULL))
);
CREATE INDEX case_help_case_idx ON platform.case_help_requests(organization_id,student_case_id,created_at DESC,id DESC);
CREATE TABLE platform_private.case_help_commands (
 request_id UUID PRIMARY KEY,organization_id UUID NOT NULL,actor_membership_id UUID NOT NULL,
 help_request_id UUID NOT NULL,input JSONB NOT NULL,receipt JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,help_request_id) REFERENCES platform.case_help_requests(organization_id,id),
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE FUNCTION platform_private.guard_o3_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Append-only record' USING ERRCODE='42501'; END $$;
CREATE TRIGGER partner_packets_immutable BEFORE UPDATE OR DELETE ON platform_private.partner_packets FOR EACH ROW EXECUTE FUNCTION platform_private.guard_o3_immutable();
CREATE TRIGGER partner_packets_no_truncate BEFORE TRUNCATE ON platform_private.partner_packets FOR EACH STATEMENT EXECUTE FUNCTION platform_private.guard_o3_immutable();
CREATE TRIGGER case_help_commands_immutable BEFORE UPDATE OR DELETE ON platform_private.case_help_commands FOR EACH ROW EXECUTE FUNCTION platform_private.guard_o3_immutable();
CREATE TRIGGER case_help_commands_no_truncate BEFORE TRUNCATE ON platform_private.case_help_commands FOR EACH STATEMENT EXECUTE FUNCTION platform_private.guard_o3_immutable();
ALTER TABLE platform_private.partner_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.partner_packets FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.case_help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_help_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_help_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_help_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.partner_packets,platform.case_help_requests,platform_private.case_help_commands FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION platform_private.require_case_operations_actor(p_case_id UUID,p_allow_student BOOLEAN DEFAULT FALSE)
RETURNS TABLE(organization_id UUID,membership_id UUID,student_case_id UUID,platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE;
BEGIN
 SELECT * INTO a FROM platform.current_actor_authority();
 IF a.membership_id IS NULL THEN RAISE EXCEPTION 'Case access denied' USING ERRCODE='42501'; END IF;
 IF a.platform_role='student' AND p_allow_student AND private.platform_has_permission(a.organization_id,'portal.read.self') THEN
  IF (SELECT count(*) FROM platform.student_portal_cases())<>1 THEN RAISE EXCEPTION 'Case access denied' USING ERRCODE='42501'; END IF;
  SELECT s.* INTO c FROM platform.student_cases s JOIN platform.student_portal_cases() portal ON portal.case_id=s.id
   WHERE s.organization_id=a.organization_id AND s.student_membership_id=a.membership_id;
  IF NOT FOUND OR (p_case_id IS NOT NULL AND p_case_id<>c.id) THEN RAISE EXCEPTION 'Case access denied' USING ERRCODE='42501'; END IF;
 ELSIF a.platform_role IN ('admin','curator') AND private.platform_has_permission(a.organization_id,'case.read.full') THEN
  SELECT * INTO c FROM platform.student_cases s WHERE s.organization_id=a.organization_id AND s.id=p_case_id;
  IF NOT FOUND OR NOT private.platform_can_read_student_case(a.organization_id,c.id) THEN RAISE EXCEPTION 'Case access denied' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Case access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.organization_id,a.membership_id,c.id,a.platform_role;
END $$;

CREATE FUNCTION platform.partner_packet_workspace_v1(p_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; files JSONB; packets JSONB;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(p_case_id);
 IF NOT private.platform_has_permission(a.organization_id,'document.read.full') THEN RAISE EXCEPTION 'Document access denied' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('slotId',s.id,'versionId',v.id,'name',v.original_filename,
  'sha256',v.sha256_hex,'versionNo',v.version_no::TEXT) ORDER BY s.id),'[]'::JSONB) INTO files
 FROM platform.document_slots s JOIN platform.document_versions v ON v.organization_id=s.organization_id AND v.id=s.current_version_id
 WHERE s.organization_id=a.organization_id AND s.student_case_id=a.student_case_id AND s.removed_at IS NULL
  AND s.status='approved' AND v.integrity_status='verified' AND v.malware_status='clean'
  AND EXISTS(SELECT 1 FROM platform_private.document_storage_bindings b WHERE b.organization_id=a.organization_id AND b.document_version_id=v.id)
  AND (SELECT r.decision FROM platform.document_reviews r WHERE r.organization_id=a.organization_id AND r.document_version_id=v.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)='approved';
 SELECT COALESCE(jsonb_agg(x.manifest ORDER BY x.created_at DESC,x.id DESC),'[]'::JSONB) INTO packets FROM
  (SELECT p.* FROM platform_private.partner_packets p WHERE p.organization_id=a.organization_id AND p.student_case_id=a.student_case_id ORDER BY p.created_at DESC,p.id DESC LIMIT 20) x;
 RETURN jsonb_build_object('files',files,'packets',packets);
END $$;

CREATE FUNCTION platform.prepare_partner_packet_v1(p_case_id UUID,p_application_id UUID,p_version_ids UUID[],p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE; app platform.university_applications%ROWTYPE;
 prior platform_private.partner_packets%ROWTYPE; ids UUID[]; entries JSONB; packet_id UUID:=gen_random_uuid();
 created TIMESTAMPTZ:=clock_timestamp(); manifest JSONB; author_name TEXT;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(p_case_id);
 IF NOT private.platform_has_permission(a.organization_id,'document.read.full') THEN RAISE EXCEPTION 'Document access denied' USING ERRCODE='42501'; END IF;
 PERFORM platform_private.require_case_operator(a.organization_id,a.student_case_id,'application.manage');
 IF p_request_id IS NULL OR p_application_id IS NULL OR p_version_ids IS NULL OR cardinality(p_version_ids) NOT BETWEEN 1 AND 50
  OR array_position(p_version_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid packet input' USING ERRCODE='22023'; END IF;
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM unnest(p_version_ids) value;
 IF cardinality(ids)<>cardinality(p_version_ids) THEN RAISE EXCEPTION 'Duplicate packet version' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('partner-packet:'||p_request_id::TEXT,0));
 SELECT * INTO prior FROM platform_private.partner_packets p WHERE p.request_id=p_request_id;
 IF FOUND THEN
  IF prior.organization_id<>a.organization_id OR prior.created_by_membership_id<>a.membership_id OR prior.student_case_id<>a.student_case_id OR prior.application_id IS DISTINCT FROM p_application_id OR prior.version_ids<>ids THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.manifest;
 END IF;
 SELECT * INTO c FROM platform.student_cases s WHERE s.organization_id=a.organization_id AND s.id=a.student_case_id FOR UPDATE;
 IF c.state<>'active' THEN RAISE EXCEPTION 'Active case required' USING ERRCODE='42501'; END IF;
 SELECT * INTO app FROM platform.university_applications x WHERE x.organization_id=a.organization_id AND x.student_case_id=c.id AND x.id=p_application_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable' USING ERRCODE='42501'; END IF;
 PERFORM s.id FROM platform.document_slots s WHERE s.organization_id=a.organization_id AND s.student_case_id=c.id AND s.current_version_id=ANY(ids) ORDER BY s.id FOR UPDATE;
 PERFORM v.id FROM platform.document_versions v WHERE v.organization_id=a.organization_id AND v.student_case_id=c.id AND v.id=ANY(ids) ORDER BY v.id FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('slotId',s.id,'versionId',v.id,'name',v.original_filename,'sha256',v.sha256_hex,'versionNo',v.version_no::TEXT) ORDER BY s.id) INTO entries
 FROM platform.document_slots s JOIN platform.document_versions v ON v.organization_id=s.organization_id AND v.id=s.current_version_id
 WHERE s.organization_id=a.organization_id AND s.student_case_id=c.id AND v.id=ANY(ids)
  AND s.removed_at IS NULL AND s.status='approved' AND v.integrity_status='verified' AND v.malware_status='clean'
  AND EXISTS(SELECT 1 FROM platform_private.document_storage_bindings b WHERE b.organization_id=a.organization_id AND b.document_version_id=v.id)
  AND (SELECT r.decision FROM platform.document_reviews r WHERE r.organization_id=a.organization_id AND r.document_version_id=v.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)='approved';
 IF COALESCE(jsonb_array_length(entries),0)<>cardinality(ids) THEN RAISE EXCEPTION 'Only current approved clean versions may be selected' USING ERRCODE='22023'; END IF;
 SELECT p.display_name INTO author_name FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id WHERE m.id=a.membership_id;
 manifest:=jsonb_build_object('id',packet_id,'caseId',c.id,'applicationId',app.id,'applicationName',app.institution_name||' · '||app.program_name,
  'createdBy',author_name,'createdAt',created,'requestId',p_request_id,'files',entries);
 INSERT INTO platform_private.partner_packets(id,organization_id,student_case_id,application_id,created_by_membership_id,request_id,version_ids,manifest,created_at)
 VALUES(packet_id,a.organization_id,c.id,app.id,a.membership_id,p_request_id,ids,manifest,created);
 RETURN manifest;
END $$;

CREATE FUNCTION platform.case_help_workspace_v1(p_case_id UUID DEFAULT NULL,p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; items JSONB;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(p_case_id,TRUE);
 IF (p_before_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'Invalid help cursor' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC,x.id DESC),'[]'::JSONB) INTO items FROM (
  SELECT h.id,h.created_at,jsonb_build_object('id',h.id,'subject',h.subject,'body',h.body,'answer',h.answer,'status',h.status,
   'version',h.version::TEXT,'createdAt',h.created_at,'answeredAt',h.answered_at) item
  FROM platform.case_help_requests h WHERE h.organization_id=a.organization_id AND h.student_case_id=a.student_case_id
   AND (a.platform_role<>'student' OR h.student_membership_id=a.membership_id)
   AND (p_before_at IS NULL OR (h.created_at,h.id)<(p_before_at,p_before_id)) ORDER BY h.created_at DESC,h.id DESC LIMIT 51
 ) x;
 RETURN jsonb_build_object('caseId',a.student_case_id,'items',items);
END $$;

ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_kind_check;
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_check;
ALTER TABLE platform.staff_notifications ADD COLUMN student_case_id UUID,
 ADD COLUMN help_request_id UUID,
 ADD CONSTRAINT staff_notifications_case_help_fkey FOREIGN KEY(organization_id,help_request_id,student_case_id) REFERENCES platform.case_help_requests(organization_id,id,student_case_id),
 ADD CONSTRAINT staff_notifications_kind_check CHECK(kind IN ('task_assigned','task_updated','chat_mention','case_help')),
 ADD CONSTRAINT staff_notifications_check CHECK(
  (kind='case_help' AND help_request_id IS NOT NULL AND student_case_id IS NOT NULL AND message_id IS NULL AND staff_task_id IS NULL)
  OR(kind='chat_mention' AND message_id IS NOT NULL AND staff_task_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL)
  OR(kind IN ('task_assigned','task_updated') AND staff_task_id IS NOT NULL AND message_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL));

CREATE FUNCTION platform.create_case_help_request_v1(p_subject TEXT,p_body TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; h platform.case_help_requests%ROWTYPE; prior platform_private.case_help_commands%ROWTYPE;
 input JSONB; receipt JSONB;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(NULL,TRUE);
 IF a.platform_role<>'student' THEN RAISE EXCEPTION 'Student required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_subject IS NULL OR p_body IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 160 OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Invalid help request' USING ERRCODE='22023'; END IF;
 input:=jsonb_build_object('operation','create','caseId',a.student_case_id,'subject',btrim(p_subject),'body',btrim(p_body));
 PERFORM pg_advisory_xact_lock(hashtextextended('case-help:'||p_request_id::TEXT,0));
 SELECT * INTO prior FROM platform_private.case_help_commands x WHERE x.request_id=p_request_id;
 IF FOUND THEN
  IF prior.organization_id<>a.organization_id OR prior.actor_membership_id<>a.membership_id OR prior.input<>input THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.receipt;
 END IF;
 INSERT INTO platform.case_help_requests(organization_id,student_case_id,student_membership_id,subject,body)
 VALUES(a.organization_id,a.student_case_id,a.membership_id,btrim(p_subject),btrim(p_body)) RETURNING * INTO h;
 receipt:=jsonb_build_object('id',h.id,'caseId',h.student_case_id,'version',h.version::TEXT,'requestId',p_request_id);
 INSERT INTO platform_private.case_help_commands VALUES(p_request_id,a.organization_id,a.membership_id,h.id,input,receipt,clock_timestamp());
 INSERT INTO platform.staff_notifications(organization_id,recipient_membership_id,event_key,kind,student_case_id,help_request_id)
 SELECT a.organization_id,m.id,'case-help:'||h.id::TEXT,'case_help',h.student_case_id,h.id
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id AND p.status='active'
 JOIN platform.student_cases c ON c.organization_id=m.organization_id AND c.id=a.student_case_id
 WHERE m.organization_id=a.organization_id AND m.status='active' AND(m.current_role='admin' OR(m.current_role='curator' AND m.id=c.current_curator_membership_id));
 RETURN receipt;
END $$;

CREATE FUNCTION platform.answer_case_help_request_v1(p_case_id UUID,p_help_id UUID,p_answer TEXT,p_expected_version BIGINT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; h platform.case_help_requests%ROWTYPE; prior platform_private.case_help_commands%ROWTYPE; input JSONB; receipt JSONB;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(p_case_id);
 PERFORM platform_private.require_case_operator(a.organization_id,a.student_case_id,'case.update.append');
 IF p_request_id IS NULL OR p_help_id IS NULL OR p_answer IS NULL OR length(btrim(p_answer)) NOT BETWEEN 1 AND 4000 OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'Invalid help answer' USING ERRCODE='22023'; END IF;
 input:=jsonb_build_object('operation','answer','caseId',a.student_case_id,'id',p_help_id,'answer',btrim(p_answer),'version',p_expected_version::TEXT);
 PERFORM pg_advisory_xact_lock(hashtextextended('case-help:'||p_request_id::TEXT,0));
 SELECT * INTO prior FROM platform_private.case_help_commands x WHERE x.request_id=p_request_id;
 IF FOUND THEN
  IF prior.organization_id<>a.organization_id OR prior.actor_membership_id<>a.membership_id OR prior.input<>input THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.receipt;
 END IF;
 SELECT * INTO h FROM platform.case_help_requests x WHERE x.organization_id=a.organization_id AND x.student_case_id=a.student_case_id AND x.id=p_help_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Help request unavailable' USING ERRCODE='42501'; END IF;
 IF h.version<>p_expected_version THEN RAISE EXCEPTION 'stale' USING ERRCODE='40001'; END IF;
 UPDATE platform.case_help_requests SET answer=btrim(p_answer),status='answered',version=version+1,
  answered_by_membership_id=a.membership_id,answered_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
 receipt:=jsonb_build_object('id',h.id,'caseId',h.student_case_id,'version',h.version::TEXT,'requestId',p_request_id);
 INSERT INTO platform_private.case_help_commands VALUES(p_request_id,a.organization_id,a.membership_id,h.id,input,receipt,clock_timestamp());
 RETURN receipt;
END $$;

CREATE OR REPLACE FUNCTION platform_private.staff_notification_visible(n platform.staff_notifications)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.current_actor_authority() a WHERE a.organization_id=n.organization_id AND a.membership_id=n.recipient_membership_id
 AND a.platform_role IN ('admin','sales','curator') AND (
  (n.staff_task_id IS NOT NULL AND EXISTS(SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id=n.organization_id AND t.id=n.staff_task_id AND(a.platform_role='admin' OR a.membership_id IN(t.creator_membership_id,t.assignee_membership_id))))
  OR(n.message_id IS NOT NULL AND EXISTS(SELECT 1 FROM platform.team_chat_messages m WHERE m.organization_id=n.organization_id AND m.id=n.message_id AND m.deleted_at IS NULL AND a.membership_id=ANY(m.mentioned_membership_ids) AND platform_private.team_chat_can_access(n.organization_id,m.channel_key)))
  OR(n.kind='case_help' AND a.platform_role IN ('admin','curator') AND private.platform_can_read_student_case(n.organization_id,n.student_case_id))
 ))
$$;
CREATE OR REPLACE FUNCTION platform.staff_notifications_page(p_organization_id UUID,p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; items JSONB; unread_count BIGINT;
BEGIN
 SELECT * INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales','curator');
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE='42501'; END IF;
 IF(p_before_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'staff_notifications_cursor_invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO unread_count FROM platform.staff_notifications n WHERE n.organization_id=p_organization_id AND n.recipient_membership_id=actor.membership_id AND n.read_at IS NULL AND platform_private.staff_notification_visible(n);
 SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::JSONB) INTO items FROM (
  SELECT n.created_at,n.id,jsonb_build_object('id',n.id,'kind',n.kind,'created_at',n.created_at,'read_at',n.read_at,'staff_task_id',n.staff_task_id,
   'message_id',n.message_id,'channel_key',m.channel_key,'parent_message_id',m.parent_message_id,'student_case_id',n.student_case_id,'help_request_id',n.help_request_id) item
  FROM platform.staff_notifications n LEFT JOIN platform.team_chat_messages m ON m.id=n.message_id
  WHERE n.organization_id=p_organization_id AND n.recipient_membership_id=actor.membership_id AND platform_private.staff_notification_visible(n)
   AND(p_before_at IS NULL OR(n.created_at,n.id)<(p_before_at,p_before_id)) ORDER BY n.created_at DESC,n.id DESC LIMIT 51
 )q;
 RETURN jsonb_build_object('items',items,'unread_count',unread_count::TEXT);
END $$;

DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE(n.nspname='platform' AND p.proname IN ('partner_packet_workspace_v1','prepare_partner_packet_v1','case_help_workspace_v1','create_case_help_request_v1','answer_case_help_request_v1'))
  OR(n.nspname='platform_private' AND p.proname IN ('guard_o3_immutable','require_case_operations_actor'))
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF split_part(f.signature::TEXT,'.',1)='platform' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
