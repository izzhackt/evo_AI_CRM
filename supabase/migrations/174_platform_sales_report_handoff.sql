-- New sales are one canonical, assigned Admissions handoff. Historical report
-- updates/imports remain reporting-only. Amounts never confirm payment evidence.
BEGIN;

ALTER TABLE platform.sales_admissions_handoffs
  DROP CONSTRAINT sales_admissions_handoffs_handoff_mode_check,
  ADD CONSTRAINT sales_admissions_handoffs_handoff_mode_check
    CHECK (handoff_mode IN ('normal','exceptional_override','sales_report'));
ALTER TABLE platform_private.sales_admissions_handoff_receipts
  DROP CONSTRAINT sales_admissions_handoff_receipts_handoff_mode_check,
  ADD CONSTRAINT sales_admissions_handoff_receipts_handoff_mode_check
    CHECK (handoff_mode IN ('normal','exceptional_override','sales_report'));

-- Keep the canonical assignment/lifecycle/tasks implementation and its current
-- scoped authorization. Only the atomic report command may use the new mode.
DO $migration$
DECLARE definition TEXT;
BEGIN
  definition := pg_get_functiondef('platform.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)'::regprocedure);
  IF position('OR normalized_mode NOT IN (''normal'', ''exceptional_override'')' IN definition)=0
    OR position('OR lead_record.stage_key <> ''qualified''' IN definition)=0
    OR position('  PERFORM platform_private.assert_lead_admissions_handoff_gate(' IN definition)=0 THEN
    RAISE EXCEPTION 'sales_report_handoff_definition_changed';
  END IF;
  definition := replace(definition,'FUNCTION platform.handoff_lead_to_admissions(',
    'FUNCTION platform_private.handoff_lead_to_admissions(');
  definition := replace(definition,'OR normalized_mode NOT IN (''normal'', ''exceptional_override'')',
    'OR normalized_mode NOT IN (''normal'', ''exceptional_override'', ''sales_report'')');
  definition := replace(definition,'OR lead_record.stage_key <> ''qualified''',
    'OR (normalized_mode <> ''sales_report'' AND lead_record.stage_key <> ''qualified'')');
  definition := replace(definition,$old$  PERFORM platform_private.assert_lead_admissions_handoff_gate(
    actor.organization_id,
    p_lead_id,
    normalized_mode
  );$old$,$new$  IF normalized_mode <> 'sales_report' THEN
    PERFORM platform_private.assert_lead_admissions_handoff_gate(actor.organization_id,p_lead_id,normalized_mode);
  END IF;$new$);
  IF position('IF normalized_mode <> ''sales_report'' THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'sales_report_handoff_gate_definition_changed';
  END IF;
  EXECUTE definition;
END
$migration$;
REVOKE ALL ON FUNCTION platform_private.handoff_lead_to_admissions(UUID,BIGINT,UUID,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.handoff_lead_to_admissions(
  p_lead_id UUID,p_expected_gate_version BIGINT,p_admissions_owner_membership_id UUID,
  p_handoff_mode TEXT,p_reason TEXT,p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_handoff_mode IS NULL OR lower(btrim(p_handoff_mode)) NOT IN ('normal','exceptional_override') THEN
    RAISE EXCEPTION 'admissions_handoff_invalid_mode' USING ERRCODE='22023';
  END IF;
  RETURN platform_private.handoff_lead_to_admissions(p_lead_id,p_expected_gate_version,
    p_admissions_owner_membership_id,p_handoff_mode,p_reason,p_request_id);
END $$;

CREATE TABLE platform_private.sales_report_handoff_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL, actor_membership_id UUID NOT NULL,
  fingerprint TEXT NOT NULL, receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(organization_id,request_id),
  FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
ALTER TABLE platform_private.sales_report_handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_report_handoff_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.sales_report_handoff_requests FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER sales_report_handoff_requests_append_only BEFORE UPDATE OR DELETE
  ON platform_private.sales_report_handoff_requests FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE FUNCTION platform.sales_register_intake_options(p_organization_id UUID,p_query TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; curators JSONB; leads JSONB; query TEXT:=btrim(coalesce(p_query,''));
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'sales.register.manage')
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'lead.sales.workflow.manage') THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF length(query)>200 OR query ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'sales_register_invalid_query' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',p.display_name) ORDER BY p.display_name,m.id),'[]') INTO curators
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
    WHERE m.organization_id=p_organization_id AND m.status='active' AND p.status='active'
      AND platform_private.staff_context_can_access(p_organization_id,m.id,'case.read.full','student_case',NULL,m.id,NULL,NULL)
      AND platform_private.staff_context_can_access(p_organization_id,m.id,'task.manage','student_case',NULL,m.id,NULL,NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'label',l.display_name,'phone',coalesce(l.phone,''),
    'owner_id',l.current_owner_membership_id) ORDER BY l.display_name,l.id),'[]') INTO leads FROM (
    SELECT lead.id,left(c.display_name,300) AS display_name,
      CASE WHEN length(c.phone)<=100 THEN c.phone ELSE c.normalized_phone END AS phone,lead.current_owner_membership_id
      FROM platform.leads lead JOIN platform.clients c ON c.organization_id=lead.organization_id AND c.id=lead.client_id
      WHERE lead.organization_id=p_organization_id AND lead.lifecycle_state='open' AND c.lifecycle_state='active'
        AND lead.current_owner_membership_id IS NOT NULL
        AND length(query)>=2 AND (position(lower(query) IN lower(c.display_name))>0 OR position(query IN coalesce(c.phone,''))>0)
        AND platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',lead.id)
        AND NOT EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.lead_id=lead.id)
      ORDER BY c.display_name,lead.id LIMIT 30
  ) l;
  RETURN jsonb_build_object('organization_id',p_organization_id,'curators',curators,'leads',leads);
END $$;

CREATE FUNCTION platform.create_sales_report_handoff(
  p_organization_id UUID,p_request_id UUID,p_fields JSONB,p_reason TEXT,
  p_lead_id UUID,p_curator_membership_id UUID,p_email TEXT DEFAULT NULL,p_interest_direction TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; normalized JSONB; fingerprint TEXT; prior platform_private.sales_report_handoff_requests%ROWTYPE;
  owner_id UUID; selected_lead_id UUID; selected_gate_version BIGINT; intake JSONB; sale platform_private.sales_register%ROWTYPE;
  receipt JSONB; case_id UUID; canonical_name TEXT; command_reason TEXT:=btrim(p_reason);
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'sales.register.manage')
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'lead.sales.workflow.manage') THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_curator_membership_id IS NULL OR command_reason IS NULL
    OR length(command_reason) NOT BETWEEN 1 AND 1000 OR command_reason ~ '[[:cntrl:]]'
    OR (p_interest_direction IS NOT NULL AND p_interest_direction NOT IN ('CN','MY','EU','AE','TR')) THEN
    RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
  normalized:=platform_private.sales_register_fields(p_fields);
  owner_id:=NULLIF(p_fields->>'owner_membership_id','')::UUID;
  IF owner_id IS NULL OR NOT platform_private.staff_can_create_for_owner(p_organization_id,actor.membership_id,
    'sales.register.manage','sales_register',owner_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  fingerprint:=md5(jsonb_build_object('fields',p_fields,'reason',command_reason,'lead',p_lead_id,
    'curator',p_curator_membership_id,'email',p_email,'direction',p_interest_direction)::TEXT);
  -- Serialize first by request, then by canonical lead. The report trigger owns
  -- the report lock; never acquire it before the lead lock (opposite handoff path).
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-report-request:'||p_organization_id::TEXT||':'||p_request_id::TEXT,0));
  SELECT * INTO prior FROM platform_private.sales_report_handoff_requests r
    WHERE r.organization_id=p_organization_id AND r.request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id<>actor.membership_id OR prior.fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
    IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'sales.register.manage','sales_register',
      (prior.receipt->>'record_id')::UUID) THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
    RETURN prior.receipt;
  END IF;
  IF p_lead_id IS NULL THEN
    intake:=platform.create_manual_sales_lead(p_organization_id,public.uuid_generate_v5(p_request_id,'sales-report:intake'),
      p_fields->>'applicant_name',p_fields->>'phone',p_email,'other',owner_id,p_interest_direction,NULL,NULL);
    IF intake->>'status'='duplicate' THEN RAISE EXCEPTION 'sales_register_existing_student' USING ERRCODE='PT409'; END IF;
    selected_lead_id:=(intake->>'lead_id')::UUID;
  ELSE selected_lead_id:=p_lead_id;
  END IF;
  IF selected_lead_id IS NULL OR NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,
    'lead.sales.workflow.manage','lead',selected_lead_id) THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::TEXT||':u6:'||selected_lead_id::TEXT,0));
  SELECT c.display_name INTO canonical_name FROM platform.leads l
    JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    WHERE l.organization_id=p_organization_id AND l.id=selected_lead_id AND l.current_owner_membership_id=owner_id
      AND l.lifecycle_state='open' AND c.lifecycle_state='active' FOR UPDATE OF l,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.lead_id=selected_lead_id)
    OR EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs h WHERE h.organization_id=p_organization_id AND h.lead_id=selected_lead_id) THEN
    RAISE EXCEPTION 'sales_register_already_transferred' USING ERRCODE='PT409'; END IF;
  SELECT g.gate_version INTO selected_gate_version FROM platform.lead_admissions_gates g
    WHERE g.organization_id=p_organization_id AND g.lead_id=selected_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_gate_missing' USING ERRCODE='22023'; END IF;
  PERFORM platform_private.handoff_lead_to_admissions(selected_lead_id,selected_gate_version,p_curator_membership_id,'sales_report',
    command_reason,public.uuid_generate_v5(p_request_id,'sales-report:handoff'));
  SELECT h.student_case_id INTO STRICT case_id FROM platform.sales_admissions_handoffs h
    WHERE h.organization_id=p_organization_id AND h.lead_id=selected_lead_id;
  -- The canonical handoff trigger already inserted exactly one pipeline row.
  UPDATE platform_private.sales_register r SET report_month=(p_fields->>'report_month')::DATE,
    owner_membership_id=owner_id,fields=normalized||jsonb_build_object('applicant_name',left(btrim(canonical_name),300)),updated_at=now()
    WHERE r.organization_id=p_organization_id AND r.lead_id=selected_lead_id RETURNING r.* INTO STRICT sale;
  receipt:=jsonb_build_object('organization_id',p_organization_id,'operation','create','record_id',sale.id,
    'version',sale.version::TEXT,'request_id',p_request_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id);
  INSERT INTO platform_private.sales_report_handoff_requests(organization_id,request_id,actor_membership_id,fingerprint,receipt)
    VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.create','sales_register',sale.id,
      jsonb_build_object('version',sale.version::TEXT,'lead_id',selected_lead_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id),
      'Report sale with immediate Admissions assignment',p_request_id);
  RETURN receipt;
END $$;

-- Retire only the old creation entry; keep historical edits/archive/imports.
DO $migration$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef('private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure);
  IF position(' SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);' IN definition)=0 THEN
    RAISE EXCEPTION 'sales_register_manage_definition_changed'; END IF;
  definition:=replace(definition,' SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);',
    E' IF p_operation=''create'' THEN RAISE EXCEPTION ''sales_register_curator_required'' USING ERRCODE=''22023''; END IF;\n SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);');
  EXECUTE definition;
END
$migration$;
REVOKE ALL ON FUNCTION platform.sales_register_intake_options(UUID,TEXT),
  platform.create_sales_report_handoff(UUID,UUID,JSONB,TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sales_register_intake_options(UUID,TEXT),
  platform.create_sales_report_handoff(UUID,UUID,JSONB,TEXT,UUID,UUID,TEXT,TEXT) TO authenticated;
COMMIT;
