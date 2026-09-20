-- CRM-02a: explicit Sales Manager authority; one date/seller source for new sales.
-- No role assignments, imported rows or historical dates/months are rewritten.
BEGIN;

ALTER TABLE platform.staff_role_definitions ADD COLUMN workflow_key TEXT
  CHECK (workflow_key IS NULL OR workflow_key='sales_manager');
CREATE UNIQUE INDEX staff_role_workflow_key_idx
  ON platform.staff_role_definitions(organization_id,workflow_key) WHERE workflow_key IS NOT NULL;
COMMENT ON COLUMN platform.staff_role_definitions.workflow_key IS
  'Stable workflow identity, independent of editable label; not exposed by role editor commands.';

-- Deployment binding verified read-only on 2026-09-20. Empty local/new databases
-- have no implicit manager: provisioning must explicitly bind a reviewed role.
DO $binding$
BEGIN
  IF EXISTS(SELECT 1 FROM platform.organizations WHERE id='2b527337-3dfe-4c00-b9f5-002a2bccfd29') THEN
    UPDATE platform.staff_role_definitions SET workflow_key='sales_manager'
      WHERE organization_id='2b527337-3dfe-4c00-b9f5-002a2bccfd29'
        AND id='46b1b73b-fbf0-4443-b926-9b5c95fea897' AND status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'sales_manager_binding_requires_review'; END IF;
  END IF;
END $binding$;

CREATE FUNCTION platform_private.staff_is_sales_manager(p_organization_id UUID,p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1
    FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
    JOIN platform.staff_role_assignments a ON a.organization_id=i.organization_id AND a.membership_id=i.membership_id
    JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id
    JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
    JOIN platform.role_bundle_permissions bp ON bp.bundle_id=b.id AND bp.permission_key='sales.register.manage'
    WHERE a.revoked_at IS NULL AND r.status='active' AND r.current_bundle_id=a.bundle_id
      AND r.workflow_key='sales_manager')
$$;

CREATE FUNCTION platform.sales_register_write_access(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  RETURN platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id);
END $$;

-- Both creation entries use this same canonical snapshot under their lead lock.
-- The recorder is intentionally absent from seller selection.
CREATE FUNCTION platform_private.sales_register_new_snapshot(p_organization_id UUID,p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE conditions platform_private.lead_sale_conditions%ROWTYPE; owner_id UUID;
  seller TEXT; applicant TEXT; phone TEXT; month_value DATE; normalized JSONB;
BEGIN
  SELECT l.current_owner_membership_id,c.display_name,
    CASE WHEN length(c.phone)<=100 THEN c.phone ELSE c.normalized_phone END,p.display_name
    INTO owner_id,applicant,phone,seller
    FROM platform.leads l JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    JOIN platform.organization_memberships m ON m.organization_id=l.organization_id AND m.id=l.current_owner_membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    WHERE l.organization_id=p_organization_id AND l.id=p_lead_id;
  IF NOT FOUND OR owner_id IS NULL OR NOT platform_private.staff_can_access(p_organization_id,owner_id,
    'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'sales_register_invalid_owner' USING ERRCODE='22023'; END IF;
  SELECT * INTO conditions FROM platform_private.lead_sale_conditions c
    WHERE c.organization_id=p_organization_id AND c.lead_id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR conditions.fields->>'service_cost_minor' IS NULL OR nullif(conditions.fields->>'signing_date','') IS NULL THEN
    RAISE EXCEPTION 'sale_conditions_missing' USING ERRCODE='22023'; END IF;
  month_value:=date_trunc('month',(conditions.fields->>'signing_date')::DATE)::DATE;
  normalized:=platform_private.sales_register_fields(jsonb_build_object(
    'report_month',month_value,'signing_date',conditions.fields->>'signing_date',
    'applicant_name',left(btrim(applicant),300),'phone',phone,
    'manager_label',left(btrim(regexp_replace(coalesce(seller,''),'[[:cntrl:]]',' ','g')),300),
    'program',conditions.fields->>'service_label','notes',conditions.fields->>'payment_note',
    'service_cost_raw',conditions.fields->>'service_cost_raw','service_cost_minor',conditions.fields->>'service_cost_minor',
    'service_cost_currency',conditions.fields->>'service_cost_currency','paid_raw',conditions.fields->>'paid_raw',
    'paid_minor',conditions.fields->>'paid_minor','paid_currency',conditions.fields->>'paid_currency'));
  RETURN jsonb_build_object('owner_membership_id',owner_id,'report_month',month_value,'fields',normalized);
END $$;

CREATE OR REPLACE FUNCTION platform.create_sales_report_handoff(p_organization_id uuid, p_request_id uuid, p_lead_id uuid, p_curator_membership_id uuid, p_report_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor RECORD; snapshot JSONB; fingerprint TEXT;
  prior platform_private.sales_report_handoff_requests%ROWTYPE; owner_id UUID; client_id_value UUID;
  selected_gate_version BIGINT; sale platform_private.sales_register%ROWTYPE; receipt JSONB; case_id UUID;
  report_month_value DATE; normalized JSONB;
  pending_case platform.student_cases%ROWTYPE; command_reason TEXT:='Sale saved from the report'; source_snapshot JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id)
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'sales.register.manage')
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'lead.sales.workflow.manage') THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_curator_membership_id IS NULL
    OR (p_report_month IS NOT NULL AND (extract(day FROM p_report_month)<>1
      OR p_report_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01')) THEN
    RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
  -- The legacy month argument only identifies the original request; it never selects a new sale's month.
  -- Serialize first by request, then by canonical lead. The report trigger owns
  -- the report lock; never acquire it before the lead lock (opposite handoff path).
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-report-request:'||p_organization_id::TEXT||':'||p_request_id::TEXT,0));
  fingerprint:=md5(jsonb_build_object('lead',p_lead_id,'curator',p_curator_membership_id,'report_month',p_report_month)::TEXT);
  SELECT * INTO prior FROM platform_private.sales_report_handoff_requests r
    WHERE r.organization_id=p_organization_id AND r.request_id=p_request_id;
  IF FOUND THEN
    -- Preserve retries of pre-208 receipts, including omitted legacy month.
    IF NOT (prior.receipt ? 'report_month') THEN
      fingerprint:=md5(jsonb_build_object('lead',p_lead_id,'curator',p_curator_membership_id,
        'report_month',coalesce(p_report_month,date_trunc('month',prior.created_at AT TIME ZONE 'Asia/Bishkek')::DATE))::TEXT);
    END IF;
    IF prior.actor_membership_id<>actor.membership_id OR prior.fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
    IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'sales.register.manage','sales_register',
      (prior.receipt->>'record_id')::UUID) THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
    RETURN prior.receipt || jsonb_build_object('report_month',
      (SELECT r.report_month FROM platform_private.sales_register r
        WHERE r.organization_id=p_organization_id AND r.id=(prior.receipt->>'record_id')::UUID));
  END IF;
  IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::TEXT||':u6:'||p_lead_id::TEXT,0));
  SELECT l.current_owner_membership_id,l.client_id INTO owner_id,client_id_value
    FROM platform.leads l JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    WHERE l.organization_id=p_organization_id AND l.id=p_lead_id AND l.lifecycle_state='open' AND c.lifecycle_state='active'
    FOR UPDATE OF l,c;
  IF NOT FOUND OR owner_id IS NULL THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.lead_id=p_lead_id)
    OR EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs h WHERE h.organization_id=p_organization_id AND h.lead_id=p_lead_id) THEN
    RAISE EXCEPTION 'sales_register_already_transferred' USING ERRCODE='PT409'; END IF;
  snapshot:=platform_private.sales_register_new_snapshot(p_organization_id,p_lead_id);
  report_month_value:=(snapshot->>'report_month')::DATE;
  owner_id:=(snapshot->>'owner_membership_id')::UUID;
  normalized:=snapshot->'fields';
  -- One person, one card (S1 flag): a lead may already own a pending,
  -- portal-activated, curator-less case opened by cabinet approval. Activate
  -- THAT case instead of colliding with student_cases_one_open_case_per_
  -- canonical_lead_idx (088) by inserting a second one for the same lead.
  SELECT * INTO pending_case FROM platform.student_cases sc
    WHERE sc.organization_id=p_organization_id AND sc.canonical_lead_id=p_lead_id AND sc.state='pending' FOR UPDATE;
  IF FOUND THEN
    -- The cabinet case snapshotted responsible_sales at approval time; the
    -- lead may have been reassigned since. Per-case sales scoping (155:
    -- case.read.summary / document.read.sales / finance.read.summary /
    -- communication.read.summary) keys off responsible_sales_membership_id,
    -- so sync it to the CURRENT lead owner credited with the sale
    -- — the same invariant handoff_lead_to_admissions enforces by rejection
    -- (088 'admissions_handoff_existing_case_conflict'), resolved here by
    -- update because the sale itself names the authoritative owner.
    IF pending_case.responsible_sales_membership_id IS DISTINCT FROM owner_id THEN
      UPDATE platform.student_cases sc SET responsible_sales_membership_id=owner_id
        WHERE sc.organization_id=p_organization_id AND sc.id=pending_case.id;
      INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
        VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'case.sales.owner.sync','student_case',pending_case.id,
          jsonb_build_object('responsible_sales_membership_id',pending_case.responsible_sales_membership_id),
          jsonb_build_object('responsible_sales_membership_id',owner_id),
          'Sales owner synced to the lead''s current owner at sale recording',
          public.uuid_generate_v5(p_request_id,'sales-report:owner-sync'));
    END IF;
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id,pending_case.id,p_curator_membership_id,
      command_reason,public.uuid_generate_v5(p_request_id,'sales-report:assign'),actor.profile_id,actor.membership_id,actor.auth_user_id);
    case_id:=pending_case.id;
    -- No platform.sales_admissions_handoffs row exists for this branch (that
    -- table is the OTHER path's evidence), so its AFTER INSERT trigger never
    -- fires here: insert the already fully-populated pipeline row directly.
    source_snapshot:=jsonb_build_object('activation','pending_case','student_case_id',case_id);
    INSERT INTO platform_private.sales_register(organization_id,report_month,owner_membership_id,source_kind,lead_id,client_id,fields,source_snapshot)
      VALUES(p_organization_id,report_month_value,owner_id,'pipeline',p_lead_id,client_id_value,normalized,source_snapshot)
      RETURNING * INTO sale;
  ELSE
    SELECT g.gate_version INTO selected_gate_version FROM platform.lead_admissions_gates g
      WHERE g.organization_id=p_organization_id AND g.lead_id=p_lead_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_gate_missing' USING ERRCODE='22023'; END IF;
    PERFORM platform_private.handoff_lead_to_admissions(p_lead_id,selected_gate_version,p_curator_membership_id,'sales_report',
      command_reason,public.uuid_generate_v5(p_request_id,'sales-report:handoff'));
    SELECT h.student_case_id INTO STRICT case_id FROM platform.sales_admissions_handoffs h
      WHERE h.organization_id=p_organization_id AND h.lead_id=p_lead_id;
    -- The canonical handoff trigger already inserted exactly one pipeline row.
    UPDATE platform_private.sales_register r SET report_month=report_month_value,owner_membership_id=owner_id,
      fields=normalized,updated_at=now() WHERE r.organization_id=p_organization_id AND r.lead_id=p_lead_id RETURNING r.* INTO STRICT sale;
  END IF;
  receipt:=jsonb_build_object('organization_id',p_organization_id,'operation','create','record_id',sale.id,
    'version',sale.version::TEXT,'request_id',p_request_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id,'report_month',sale.report_month);
  INSERT INTO platform_private.sales_report_handoff_requests(organization_id,request_id,actor_membership_id,fingerprint,receipt)
    VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.create','sales_register',sale.id,
      jsonb_build_object('version',sale.version::TEXT,'lead_id',p_lead_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id),
      'Report sale with immediate Admissions assignment',p_request_id);
  RETURN receipt;
END $function$;


-- The older handoff path also produces a sale; it cannot bypass the same rules.
CREATE OR REPLACE FUNCTION platform_private.register_completed_sales_handoff(p_handoff_id UUID) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE handoff platform.sales_admissions_handoffs%ROWTYPE; actor RECORD;
  snapshot JSONB; sale_id UUID; audit_request UUID;
BEGIN
  SELECT * INTO handoff FROM platform.sales_admissions_handoffs WHERE id=p_handoff_id AND handoff_state='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_handoff_missing' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||handoff.organization_id::TEXT,0));
  IF EXISTS(SELECT 1 FROM platform_private.sales_register r
    WHERE r.organization_id=handoff.organization_id AND r.lead_id=handoff.lead_id) THEN RETURN; END IF;
  SELECT * INTO actor FROM platform_private.sales_register_actor(handoff.organization_id);
  IF NOT platform_private.staff_is_sales_manager(handoff.organization_id,actor.membership_id)
    OR NOT platform_private.staff_can_access(handoff.organization_id,actor.membership_id,
      'lead.sales.workflow.manage','lead',handoff.lead_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  snapshot:=platform_private.sales_register_new_snapshot(handoff.organization_id,handoff.lead_id);
  INSERT INTO platform_private.sales_register(organization_id,report_month,owner_membership_id,source_kind,lead_id,client_id,fields,source_snapshot)
    VALUES(handoff.organization_id,(snapshot->>'report_month')::DATE,(snapshot->>'owner_membership_id')::UUID,
      'pipeline',handoff.lead_id,handoff.client_id,snapshot->'fields',
      (snapshot->'fields')||jsonb_build_object('handoff_id',handoff.id,'handed_off_at',handoff.handed_off_at,
        'original_owner_membership_id',snapshot->>'owner_membership_id')) RETURNING id INTO sale_id;
  audit_request:=public.uuid_generate_v5(handoff.id,'sales-register:pipeline');
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(handoff.organization_id,'user',handoff.actor_profile_id,'handoff:'||handoff.id::TEXT,'sales.register.pipeline','sales_register',sale_id,
      jsonb_build_object('version','1','lead_id',handoff.lead_id,'handoff_id',handoff.id),'Canonical completed handoff',audit_request);
END $$;

-- Preserve historical edit validation, reasons, revisions and request history.
DO $guard$
DECLARE definition TEXT; needle TEXT:=' SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);';
BEGIN
  definition:=pg_get_functiondef('private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure);
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 THEN
    RAISE EXCEPTION 'sales_register_manage_definition_changed'; END IF;
  EXECUTE replace(definition,needle,needle||E'\n IF NOT platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id) THEN\n   RAISE EXCEPTION ''sales_register_forbidden'' USING ERRCODE=''42501''; END IF;');
END $guard$;

REVOKE ALL ON FUNCTION platform_private.staff_is_sales_manager(UUID,UUID),
  platform_private.sales_register_new_snapshot(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.sales_register_write_access(UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sales_register_write_access(UUID) TO authenticated;
-- OR REPLACE above preserves the established creation/edit/trigger ACLs.
NOTIFY pgrst, 'reload schema';
COMMIT;
