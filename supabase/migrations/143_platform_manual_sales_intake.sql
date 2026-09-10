-- O1: staff intake is canonical Sales, not a report row or provider identity.
ALTER TABLE platform.leads ADD COLUMN interest_direction TEXT
  CHECK (interest_direction IN ('CN','MY','EU','AE','TR'));
GRANT SELECT (interest_direction) ON platform.leads TO authenticated;

CREATE TABLE platform_private.manual_lead_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  actor_membership_id UUID NOT NULL REFERENCES platform.organization_memberships(id),
  payload JSONB NOT NULL,
  lead_id UUID NOT NULL REFERENCES platform.leads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE platform_private.manual_lead_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.manual_lead_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.manual_lead_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER manual_lead_receipts_append_only BEFORE UPDATE OR DELETE ON platform_private.manual_lead_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER manual_lead_receipts_no_truncate BEFORE TRUNCATE ON platform_private.manual_lead_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE FUNCTION platform.create_manual_sales_lead(
  p_organization_id UUID, p_request_id UUID, p_display_name TEXT,
  p_phone TEXT, p_email TEXT, p_source_key TEXT, p_owner_membership_id UUID,
  p_interest_direction TEXT DEFAULT NULL, p_next_action TEXT DEFAULT NULL,
  p_next_action_due_date DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; receipt platform_private.manual_lead_receipts%ROWTYPE;
  payload JSONB; client_id UUID; lead_id UUID; existing_lead UUID;
  contact_phone TEXT; contact_email TEXT; lock_key TEXT;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales')
      AND private.platform_has_permission(a.organization_id,'lead.sales.workflow.manage');
  IF NOT FOUND THEN RAISE EXCEPTION 'manual_lead_forbidden' USING ERRCODE='42501'; END IF;
  contact_phone:=platform_private.normalize_person_phone(NULLIF(btrim(p_phone),''));
  contact_email:=platform_private.normalize_person_email(NULLIF(btrim(p_email),''));
  IF p_request_id IS NULL OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 300
    OR p_display_name ~ '[[:cntrl:]]' OR (contact_phone IS NULL AND contact_email IS NULL)
    OR (NULLIF(btrim(p_phone),'') IS NOT NULL AND (contact_phone IS NULL OR contact_phone !~ '^\+?[0-9]{7,15}$'))
    OR (NULLIF(btrim(p_email),'') IS NOT NULL AND (contact_email IS NULL OR contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(contact_email)>320))
    OR p_source_key IS NULL OR p_source_key NOT IN ('office','phone_call','referral','website','other')
    OR (p_interest_direction IS NOT NULL AND p_interest_direction NOT IN ('CN','MY','EU','AE','TR'))
    OR (NULLIF(btrim(p_next_action),'') IS NULL) <> (p_next_action_due_date IS NULL)
    OR length(coalesce(p_next_action,''))>500
    OR (p_next_action_due_date IS NOT NULL AND p_next_action_due_date NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31')
  THEN RAISE EXCEPTION 'manual_lead_invalid' USING ERRCODE='22023'; END IF;
  IF p_owner_membership_id IS NULL OR NOT platform_private.is_eligible_sales_owner(p_organization_id,p_owner_membership_id)
    OR (actor.platform_role='sales' AND p_owner_membership_id<>actor.membership_id)
  THEN RAISE EXCEPTION 'manual_lead_forbidden' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('name',btrim(p_display_name),'phone',contact_phone,'email',contact_email,'source',p_source_key,
    'owner',p_owner_membership_id,'direction',p_interest_direction,'next_action',NULLIF(btrim(p_next_action),''),'due',p_next_action_due_date);
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-request:'||p_request_id::TEXT,0));
  SELECT * INTO receipt FROM platform_private.manual_lead_receipts r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF receipt.organization_id<>p_organization_id OR receipt.actor_membership_id<>actor.membership_id OR receipt.payload<>payload
      THEN RAISE EXCEPTION 'manual_lead_request_conflict' USING ERRCODE='22023'; END IF;
    IF NOT private.platform_can_read_canonical_lead(p_organization_id,receipt.lead_id)
      THEN RAISE EXCEPTION 'manual_lead_forbidden' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('status','saved','lead_id',receipt.lead_id,'request_id',p_request_id);
  END IF;
  -- Sorted contact locks serialize manual intake without auto-merging people.
  FOR lock_key IN SELECT value FROM unnest(ARRAY[contact_phone,contact_email]) value WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:'||p_organization_id::TEXT||':'||lock_key,0));
  END LOOP;
  IF EXISTS(SELECT 1 FROM platform.clients c WHERE c.organization_id=p_organization_id AND c.lifecycle_state='active'
    AND ((contact_phone IS NOT NULL AND c.normalized_phone=contact_phone) OR (contact_email IS NOT NULL AND c.normalized_email=contact_email))) THEN
    SELECT l.id INTO existing_lead FROM platform.leads l JOIN platform.clients c ON c.id=l.client_id AND c.organization_id=l.organization_id
      WHERE l.organization_id=p_organization_id AND c.lifecycle_state='active'
        AND ((contact_phone IS NOT NULL AND c.normalized_phone=contact_phone) OR (contact_email IS NOT NULL AND c.normalized_email=contact_email))
        AND private.platform_can_read_canonical_lead(p_organization_id,l.id)
      ORDER BY l.updated_at DESC,l.id LIMIT 1;
    RETURN jsonb_build_object('status','duplicate','lead_id',existing_lead,'request_id',p_request_id);
  END IF;
  client_id:=platform_private.create_or_link_client(p_organization_id,btrim(p_display_name),contact_email,contact_phone,
    'evo_manual','client',p_request_id::TEXT,'staff_recorded',statement_timestamp(),NULL,NULL);
  lead_id:=platform_private.create_or_link_lead(p_organization_id,client_id,p_owner_membership_id,'new',p_source_key,
    'evo_manual','lead',p_request_id::TEXT,'staff_recorded',statement_timestamp(),NULL,NULL);
  UPDATE platform.leads l SET interest_direction=p_interest_direction,
    next_action_text=NULLIF(btrim(p_next_action),''),next_action_due_date=p_next_action_due_date
    WHERE l.id=lead_id AND l.organization_id=p_organization_id;
  INSERT INTO platform_private.manual_lead_receipts VALUES(p_request_id,p_organization_id,actor.membership_id,payload,lead_id,statement_timestamp());
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'lead.manual.create','lead',lead_id,
      jsonb_build_object('lead_id',lead_id,'client_id',client_id,'source_key',p_source_key,'interest_direction',p_interest_direction),
      'Staff-recorded intake',p_request_id);
  RETURN jsonb_build_object('status','saved','lead_id',lead_id,'request_id',p_request_id);
END $$;
REVOKE ALL ON FUNCTION platform.create_manual_sales_lead(UUID,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.create_manual_sales_lead(UUID,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,DATE) TO authenticated;
