-- Website enquiry intake: rename the PL/pgSQL variable normalized_phone to
-- contact_phone in platform.receive_website_lead (body of migration 240).
--
-- Defect (since 170, carried by 231 and 240): the variable normalized_phone
-- has the name of the column platform.clients.normalized_phone. With the
-- default plpgsql.variable_conflict = error the contact lookup
--   ... AND c.normalized_phone=normalized_phone;
-- raises SQLSTATE 42702 «column reference "normalized_phone" is ambiguous» on
-- every valid enquiry, after the receipt check and the rate-limit rows, so the
-- whole call rolls back and the route answers 503. Production, read-only
-- (06.10.2026, aggregates only): platform_private.website_lead_receipts has
-- never held a row, platform.leads has no lead with source_key 'website', the
-- live function body contains that statement and the database log shows the
-- 42702 error on 01.10.2026. No enquiry from the website ever reached the CRM.
--
-- Fix: the body is byte-identical to 240 except the variable's declaration and
-- each of its seven uses; column references (c.normalized_phone) are
-- untouched. CREATE OR REPLACE keeps the identity, owner, SECURITY DEFINER,
-- empty search_path and volatility; the service-only ACL of 231 is
-- re-asserted. The migration refuses to run on any body other than 240's and
-- verifies the result. No data is changed: the lost enquiries cannot be
-- recovered from the database because nothing was stored.

BEGIN;

DO $m262_pre$
DECLARE
  target_oid oid := to_regprocedure(
    'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb)');
BEGIN
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'm262: platform.receive_website_lead (11 arguments) does not exist';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = target_oid)
      <> 'a99e227c0eb7020b2e039eff3bd269d9' THEN
    RAISE EXCEPTION 'm262: platform.receive_website_lead is not the migration 240 definition it was written against';
  END IF;
  -- Remembered for the verification below (transaction-local).
  PERFORM pg_catalog.set_config('evo.m262_attributes',
    (SELECT (pg_catalog.to_jsonb(p) - 'prosrc')::TEXT FROM pg_catalog.pg_proc p WHERE p.oid = target_oid), TRUE);
END
$m262_pre$;

CREATE OR REPLACE FUNCTION platform.receive_website_lead(
  p_organization_id UUID,p_owner_membership_id UUID,p_request_id UUID,
  p_name TEXT,p_phone TEXT,p_age INTEGER,p_city TEXT,p_country TEXT,
  p_consent BOOLEAN,p_ip_hash TEXT,p_university JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt platform_private.website_lead_receipts%ROWTYPE;
  contact_phone TEXT; payload JSONB; resolved_client UUID; resolved_lead UUID;
  matching_clients INTEGER; attempts INTEGER; direction TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'website_intake_forbidden' USING ERRCODE='42501';
  END IF;
  contact_phone:=platform_private.normalize_person_phone(NULLIF(btrim(p_phone),''));
  IF p_request_id IS NULL OR p_request_id='00000000-0000-0000-0000-000000000000'::UUID
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 300 OR p_name ~ '[[:cntrl:]]'
    OR contact_phone IS NULL OR contact_phone !~ '^\+?[0-9]{7,15}$'
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
  payload:=jsonb_build_object('name',btrim(p_name),'phone',contact_phone,'age',p_age,
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
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:'||p_organization_id::TEXT||':'||contact_phone,0));
  SELECT count(*),min(c.id::TEXT)::UUID INTO matching_clients,resolved_client FROM platform.clients c
    WHERE c.organization_id=p_organization_id AND c.lifecycle_state='active' AND c.normalized_phone=contact_phone;
  IF matching_clients>1 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF resolved_client IS NOT NULL THEN
    SELECT l.id INTO resolved_lead FROM platform.leads l WHERE l.organization_id=p_organization_id
      AND l.client_id=resolved_client AND l.lifecycle_state='open'
      ORDER BY l.updated_at DESC,l.id LIMIT 1 FOR UPDATE;
  ELSE
    resolved_client:=platform_private.create_or_link_client(p_organization_id,btrim(p_name),NULL,contact_phone,
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

REVOKE ALL ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB) TO service_role;

-- The same function (oid, identity, owner, definer, search_path, volatility,
-- ACL and every other catalog attribute), the renamed variable, and no
-- ambiguous column comparison left.
DO $m262_verify$
DECLARE
  target_oid oid := to_regprocedure(
    'platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb)');
  routine RECORD;
BEGIN
  SELECT p.prosrc, p.prosecdef, p.proconfig, p.proacl, p.provolatile,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      (pg_catalog.to_jsonb(p) - 'prosrc') AS attributes
    INTO routine FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF NOT FOUND
    OR routine.identity_arguments IS DISTINCT FROM
      'p_organization_id uuid, p_owner_membership_id uuid, p_request_id uuid, p_name text, p_phone text, '
      || 'p_age integer, p_city text, p_country text, p_consent boolean, p_ip_hash text, p_university jsonb'
    OR routine.owner IS DISTINCT FROM 'postgres'
    OR NOT routine.prosecdef
    OR routine.provolatile IS DISTINCT FROM 'v'
    OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR routine.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
    OR has_function_privilege('anon', target_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', target_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', target_oid, 'EXECUTE')
    OR routine.attributes IS DISTINCT FROM current_setting('evo.m262_attributes')::JSONB
  THEN
    RAISE EXCEPTION 'm262: platform.receive_website_lead lost its identity, definer, search_path or service-only ACL';
  END IF;
  IF strpos(routine.prosrc, 'contact_phone') = 0
    OR strpos(routine.prosrc, 'c.normalized_phone=normalized_phone') <> 0
    OR (length(routine.prosrc) - length(replace(routine.prosrc, 'normalized_phone', ''))) / length('normalized_phone') <> 1
    OR (length(routine.prosrc) - length(replace(routine.prosrc, 'contact_phone', ''))) / length('contact_phone') <> 8
    OR pg_catalog.md5(routine.prosrc) <> '7dc77f2607cc62b1f644572481d850e6'
  THEN
    RAISE EXCEPTION 'm262: platform.receive_website_lead body is not 240''s with the variable renamed';
  END IF;
END
$m262_verify$;

NOTIFY pgrst,'reload schema';
COMMIT;
