-- Extend public website enquiry countries; document-preparation country policy is unchanged.
-- CREATE OR REPLACE preserves the existing function identity, owner and service-only ACL.
BEGIN;

CREATE OR REPLACE FUNCTION platform.receive_website_lead(
  p_organization_id UUID,p_owner_membership_id UUID,p_request_id UUID,
  p_name TEXT,p_phone TEXT,p_age INTEGER,p_city TEXT,p_country TEXT,
  p_consent BOOLEAN,p_ip_hash TEXT,p_university JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt platform_private.website_lead_receipts%ROWTYPE;
  normalized_phone TEXT; payload JSONB; resolved_client UUID; resolved_lead UUID;
  matching_clients INTEGER; attempts INTEGER; direction TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'website_intake_forbidden' USING ERRCODE='42501';
  END IF;
  normalized_phone:=platform_private.normalize_person_phone(NULLIF(btrim(p_phone),''));
  IF p_request_id IS NULL OR p_request_id='00000000-0000-0000-0000-000000000000'::UUID
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 300 OR p_name ~ '[[:cntrl:]]'
    OR normalized_phone IS NULL OR normalized_phone !~ '^\+?[0-9]{7,15}$'
    OR (p_age IS NOT NULL AND p_age NOT BETWEEN 10 AND 100)
    OR (p_city IS NOT NULL AND (length(btrim(p_city)) NOT BETWEEN 1 AND 150 OR p_city ~ '[[:cntrl:]]'))
    OR p_country IS NULL OR p_country NOT IN ('China','Malaysia','Europe','Germany','United Kingdom',
      'Italy','Netherlands','France','Poland','Czechia','Austria','Cyprus',
      'United Arab Emirates','Turkey','Undecided')
    OR p_consent IS DISTINCT FROM TRUE OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023'; END IF;
  IF p_university IS NOT NULL THEN
    IF jsonb_typeof(p_university) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023';
    END IF;
    IF NOT (p_university ?& ARRAY['slug','name'])
      OR p_university - ARRAY['slug','name'] <> '{}'::JSONB
      OR jsonb_typeof(p_university->'slug') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_university->'name') IS DISTINCT FROM 'string'
      OR length(p_university->>'slug') NOT BETWEEN 1 AND 120
      OR (p_university->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      OR length(p_university->>'name') NOT BETWEEN 1 AND 300
      OR length(btrim(p_university->>'name'))=0
      OR (p_university->>'name') ~ '[[:cntrl:]]'
    THEN RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023'; END IF;
    p_university:=jsonb_build_object('slug',p_university->>'slug','name',btrim(p_university->>'name'));
  END IF;
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id AND o.status='active' FOR KEY SHARE;
  IF NOT FOUND OR p_owner_membership_id IS NULL
    OR NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,'lead.read','lead',NULL)
    OR NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,'lead.sales.workflow.manage','lead',NULL)
  THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  payload:=jsonb_build_object('name',btrim(p_name),'phone',normalized_phone,'age',p_age,
    'city',NULLIF(btrim(p_city),''),'country',btrim(p_country),'consent',TRUE);
  -- Preserve the exact legacy payload for retries from already-open older forms.
  -- A supplied university participates in request-id conflict detection.
  IF p_university IS NOT NULL THEN payload:=payload||jsonb_build_object('university',p_university); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('website-request:'||p_request_id::TEXT,0));
  SELECT * INTO receipt FROM platform_private.website_lead_receipts r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF receipt.organization_id<>p_organization_id OR receipt.payload<>payload THEN
      RETURN jsonb_build_object('status','request_conflict');
    END IF;
    RETURN jsonb_build_object('status','accepted','request_id',p_request_id);
  END IF;
  -- Durable global cap bounds the number of IP buckets an attacker can create.
  INSERT INTO platform_private.website_intake_limits AS limits VALUES(p_organization_id,'organization',statement_timestamp(),1)
    ON CONFLICT(organization_id,bucket) DO UPDATE SET
      attempts=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '1 hour' THEN 1 ELSE limits.attempts+1 END,
      window_start=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '1 hour' THEN statement_timestamp() ELSE limits.window_start END
    RETURNING limits.attempts INTO attempts;
  IF attempts>100 THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
  DELETE FROM platform_private.website_intake_limits WHERE organization_id=p_organization_id
    AND bucket<>'organization' AND window_start<statement_timestamp()-INTERVAL '1 day';
  INSERT INTO platform_private.website_intake_limits AS limits VALUES(p_organization_id,p_ip_hash,statement_timestamp(),1)
    ON CONFLICT(organization_id,bucket) DO UPDATE SET
      attempts=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '10 minutes' THEN 1 ELSE limits.attempts+1 END,
      window_start=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '10 minutes' THEN statement_timestamp() ELSE limits.window_start END
    RETURNING limits.attempts INTO attempts;
  IF attempts>5 THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
  -- Shares the manual-intake contact lock, preventing competing client creation.
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:'||p_organization_id::TEXT||':'||normalized_phone,0));
  SELECT count(*),min(c.id::TEXT)::UUID INTO matching_clients,resolved_client FROM platform.clients c
    WHERE c.organization_id=p_organization_id AND c.lifecycle_state='active' AND c.normalized_phone=normalized_phone;
  IF matching_clients>1 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF resolved_client IS NOT NULL THEN
    SELECT l.id INTO resolved_lead FROM platform.leads l WHERE l.organization_id=p_organization_id
      AND l.client_id=resolved_client AND l.lifecycle_state='open'
      ORDER BY l.updated_at DESC,l.id LIMIT 1 FOR UPDATE;
  ELSE
    resolved_client:=platform_private.create_or_link_client(p_organization_id,btrim(p_name),NULL,normalized_phone,
      'evo_website','client',p_request_id::TEXT,'website_submitted',statement_timestamp(),NULL,NULL);
  END IF;
  IF resolved_lead IS NULL THEN
    resolved_lead:=platform_private.create_or_link_lead(p_organization_id,resolved_client,p_owner_membership_id,
      'new','website','evo_website','lead',p_request_id::TEXT,'website_submitted',statement_timestamp(),NULL,NULL);
    direction:=CASE lower(btrim(p_country)) WHEN 'china' THEN 'CN' WHEN 'malaysia' THEN 'MY' WHEN 'europe' THEN 'EU'
      WHEN 'turkey' THEN 'TR' WHEN 'turkiye' THEN 'TR' WHEN 'united arab emirates' THEN 'AE'
      WHEN 'uae' THEN 'AE' WHEN 'germany' THEN 'EU' WHEN 'italy' THEN 'EU'
      WHEN 'netherlands' THEN 'EU' WHEN 'france' THEN 'EU' WHEN 'poland' THEN 'EU'
      WHEN 'united kingdom' THEN 'EU' WHEN 'czechia' THEN 'EU'
      WHEN 'austria' THEN 'EU' WHEN 'cyprus' THEN 'EU' WHEN 'undecided' THEN NULL ELSE NULL END;
    UPDATE platform.leads SET interest_direction=direction WHERE id=resolved_lead AND organization_id=p_organization_id;
  END IF;
  INSERT INTO platform_private.website_lead_receipts(request_id,organization_id,lead_id,payload)
    VALUES(p_request_id,p_organization_id,resolved_lead,payload);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'service','evo-website','lead.website.receive','lead',resolved_lead,
      jsonb_build_object('source_key','website','request_id',p_request_id),'Website inquiry received with consent',p_request_id);
  RETURN jsonb_build_object('status','accepted','request_id',p_request_id);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
