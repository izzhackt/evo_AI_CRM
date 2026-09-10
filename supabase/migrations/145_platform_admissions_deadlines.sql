-- O3: one calendar projection for actual recorded Admissions dates.
-- No inferred visa periods, notification scheduler or duplicate task records.
-- https://supabase.com/docs/guides/database/functions
BEGIN;

CREATE FUNCTION platform_private.admissions_deadline_rows(p_case_id UUID DEFAULT NULL)
RETURNS TABLE(source_key TEXT, application_id UUID, student_case_id UUID,
 student_display_name TEXT, university_name TEXT, program_name TEXT,
 application_status platform.application_status, deadline_kind TEXT, deadline DATE)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH cases AS MATERIALIZED (
  SELECT c.* FROM platform.student_cases c WHERE c.state='active'
   AND (p_case_id IS NULL OR c.id=p_case_id)
 ), applications AS (
  SELECT a.*,c.student_display_name FROM platform.university_applications a
  JOIN cases c ON c.organization_id=a.organization_id AND c.id=a.student_case_id
  WHERE a.status IN ('preparation','ready','submitted','under_review','offer')
 )
 SELECT 'application:'||a.id::TEXT||':'||d.kind,a.id,a.student_case_id,
  a.student_display_name,a.institution_name,a.program_name,a.status,d.kind,d.due_on
 FROM applications a CROSS JOIN LATERAL (VALUES
  ('application',CASE WHEN a.status IN ('preparation','ready') THEN a.university_deadline_on END),
  ('partner_reply',CASE WHEN NOT a.admissions_details ? 'universitySubmittedOn' THEN (a.admissions_details->>'partnerReplyDueOn')::DATE END),
  ('correction',CASE WHEN NOT a.admissions_details ? 'correctionResolvedOn' THEN (a.admissions_details->>'correctionDeadline')::DATE END),
  ('offer',CASE WHEN NOT a.admissions_details ? 'conditionsFulfilledOn' THEN (a.admissions_details->>'offerDeadline')::DATE END)
 ) d(kind,due_on) WHERE d.due_on IS NOT NULL
 UNION ALL
 SELECT 'visa:'||v.id::TEXT||':'||d.kind,v.id,v.student_case_id,c.student_display_name,
  'Документы для поездки','',NULL::platform.application_status,d.kind,d.due_on
 FROM platform.visa_cases v JOIN cases c ON c.organization_id=v.organization_id AND c.id=v.student_case_id
 CROSS JOIN LATERAL (VALUES
  ('passport_expiry',(v.admissions_details->>'passportExpiresOn')::DATE),
  ('visa_expiry',CASE WHEN c.admissions_direction IS DISTINCT FROM 'MY' THEN (v.admissions_details->>'visaExpiresOn')::DATE END),
  ('eval_expiry',CASE WHEN c.admissions_direction='MY' THEN (v.admissions_details->>'eValExpiresOn')::DATE END),
  ('entry_visa_expiry',CASE WHEN c.admissions_direction='MY' AND v.admissions_details->>'entryVisaApplicability'='required' THEN (v.admissions_details->>'entryVisaExpiresOn')::DATE END)
 ) d(kind,due_on) WHERE d.due_on IS NOT NULL
$$;

CREATE FUNCTION platform.admissions_deadline_page_v1(p_limit INTEGER DEFAULT 100,
 p_after_deadline DATE DEFAULT NULL,p_after_source_key TEXT DEFAULT NULL,
 p_due_from DATE DEFAULT NULL,p_due_to DATE DEFAULT NULL)
RETURNS TABLE(source_key TEXT,application_id UUID,student_case_id UUID,
 student_display_name TEXT,university_name TEXT,program_name TEXT,
 application_status platform.application_status,deadline_kind TEXT,deadline DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD;
BEGIN
 SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor('application.manage');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
  OR (p_after_deadline IS NULL)<>(p_after_source_key IS NULL)
  OR (p_after_source_key IS NOT NULL AND (length(p_after_source_key)>100 OR p_after_source_key !~ '^(application|visa):[0-9a-f-]{36}:[a-z_]+$'))
  OR NOT COALESCE(isfinite(p_after_deadline),TRUE) OR NOT COALESCE(isfinite(p_due_from),TRUE)
  OR NOT COALESCE(isfinite(p_due_to),TRUE) OR p_due_from>p_due_to
 THEN RAISE EXCEPTION 'Invalid Admissions deadline page' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT d.* FROM platform.student_cases c
 CROSS JOIN LATERAL platform_private.admissions_deadline_rows(c.id) d
 WHERE c.organization_id=actor.organization_id AND c.state='active'
  AND private.platform_can_read_student_case(c.organization_id,c.id)
  AND (p_due_from IS NULL OR d.deadline>=p_due_from)
  AND (p_due_to IS NULL OR d.deadline<=p_due_to)
  AND (p_after_deadline IS NULL OR (d.deadline,d.source_key COLLATE "C")>(p_after_deadline,p_after_source_key COLLATE "C"))
 ORDER BY d.deadline,d.source_key COLLATE "C" LIMIT p_limit;
END $$;

-- Preserve the existing attention semantics while covering every application.
CREATE OR REPLACE FUNCTION platform_private.admissions_attention_flags(p_case_id UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; flags TEXT[]:=ARRAY[]::TEXT[]; ack TEXT;
 today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
BEGIN
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id;
 IF c.state<>'active' THEN RETURN flags; END IF;
 IF c.next_action_due_on<today
  OR EXISTS(SELECT 1 FROM platform_private.admissions_deadline_rows(c.id) d WHERE d.deadline<today)
  OR EXISTS(SELECT 1 FROM platform.case_tasks t WHERE t.organization_id=c.organization_id AND t.student_case_id=c.id AND t.status NOT IN ('done','cancelled') AND (t.due_at<CURRENT_TIMESTAMP OR t.due_on<today))
 THEN flags:=array_append(flags,'overdue'); END IF;
 IF EXISTS(SELECT 1 FROM platform.university_applications a WHERE a.organization_id=c.organization_id AND a.student_case_id=c.id
  AND a.status IN ('preparation','ready','submitted','under_review','offer')
  AND a.admissions_details ? 'partnerSentOn' AND NOT a.admissions_details ? 'universitySubmittedOn')
 THEN flags:=array_append(flags,'awaiting_partner'); END IF;
 IF c.operational_stage='applications' AND EXISTS(SELECT 1 FROM platform.university_applications a WHERE a.student_case_id=c.id AND a.is_primary AND a.admissions_details ? 'universitySubmittedOn' AND a.status IN ('submitted','under_review','offer','enrolled')) THEN flags:=array_append(flags,'submitted'); END IF;
 IF c.operational_stage='decisions' THEN flags:=array_append(flags,'decisions'); END IF;
 IF c.operational_stage='visa_and_predeparture' THEN flags:=array_append(flags,'visas'); END IF;
 IF c.operational_stage='arrival_and_adaptation' THEN flags:=array_append(flags,'arrivals'); END IF;
 SELECT r.decision INTO ack FROM platform.student_case_handoff_acknowledgements r JOIN platform.student_case_assignment_events x ON x.id=r.assignment_event_id
  WHERE r.organization_id=c.organization_id AND r.student_case_id=c.id AND x.new_scope_version=c.current_scope_version AND r.curator_membership_id=c.current_curator_membership_id ORDER BY r.revision DESC LIMIT 1;
 IF ack IS DISTINCT FROM 'accepted' AND EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs WHERE organization_id=c.organization_id AND student_case_id=c.id) THEN flags:=array_append(flags,'awaiting_ack'); END IF;
 RETURN flags;
END $$;
REVOKE ALL ON FUNCTION platform_private.admissions_deadline_rows(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.admissions_deadline_page_v1(INTEGER,DATE,TEXT,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.admissions_deadline_page_v1(INTEGER,DATE,TEXT,DATE,DATE) TO authenticated;
COMMIT;
