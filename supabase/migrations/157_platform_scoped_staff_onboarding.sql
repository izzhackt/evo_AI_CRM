-- S2: extend the existing 139 Auth send ledger, not a second invitation system.
-- Auth dispatch remains a server-side external effect. A claimed request never
-- becomes dispatchable again; neither an Auth timestamp nor completion proves
-- inbox delivery or first login.
-- https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
-- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
BEGIN;

-- Preserve the existing service-only, one-shot first-organization bootstrap.
-- Its real Auth identity, locks, published Admin bundle, scope, audit and replay
-- stay unchanged; only this INSERT establishes the new protected Admin flag.
-- No caller-supplied flag, general promotion path or Auth fixture is added.
DO $staff_first_admin_bootstrap$
DECLARE body TEXT; anchor TEXT;
BEGIN
 body:=pg_get_functiondef('platform.bootstrap_organization_admin(text,uuid,text,text,uuid)'::regprocedure);
 anchor:=$old$  INSERT INTO platform.organization_memberships (
    organization_id,
    profile_id,
    status,
    "current_role",
    current_bundle_id
  )
  VALUES (
    organization_id,
    profile_id,
    'active',
    'admin',
    bundle_id
  )
  RETURNING id INTO membership_id;$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'staff_first_admin_bootstrap_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$  INSERT INTO platform.organization_memberships (
    organization_id,
    profile_id,
    status,
    "current_role",
    current_bundle_id,
    is_system_admin
  )
  VALUES (
    organization_id,
    profile_id,
    'active',
    'admin',
    bundle_id,
    TRUE
  )
  RETURNING id INTO membership_id;$new$);
 EXECUTE body;
END $staff_first_admin_bootstrap$;

ALTER TABLE platform_private.staff_auth_requests
 ALTER COLUMN requested_role DROP NOT NULL,
 ADD COLUMN request_payload JSONB,
 ADD COLUMN prepared_assignments JSONB NOT NULL DEFAULT '[]'::JSONB,
 ADD COLUMN preparation_version BIGINT NOT NULL DEFAULT 0 CHECK(preparation_version BETWEEN 0 AND 9007199254740991),
 ADD COLUMN preparation_reason TEXT,
 ADD COLUMN no_access BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN expected_access_version BIGINT,
 ADD COLUMN conflict_code TEXT,
 ADD CONSTRAINT staff_auth_prepared_array CHECK(jsonb_typeof(prepared_assignments)='array'),
 ADD CONSTRAINT staff_auth_no_access_empty CHECK(NOT no_access OR jsonb_array_length(prepared_assignments)=0),
 ADD CONSTRAINT staff_auth_expected_access_version CHECK(expected_access_version IS NULL OR expected_access_version BETWEEN 1 AND 9007199254740991);

-- The original caller/recipient/request are immutable. Repreparation changes
-- only the separately versioned approval, with its own audit command receipt.
CREATE FUNCTION platform_private.staff_auth_request_protect()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Staff Auth request history is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(OLD)-ARRAY['prepared_assignments','preparation_version','preparation_reason','no_access',
   'conflict_code','target_membership_id','auth_user_id','status','provider_observed_at','rejection_code',
   'rejection_http_status','rejected_at','completed_at'])
 IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['prepared_assignments','preparation_version','preparation_reason','no_access',
   'conflict_code','target_membership_id','auth_user_id','status','provider_observed_at','rejection_code',
   'rejection_http_status','rejected_at','completed_at'])
 OR (OLD.target_membership_id IS NOT NULL AND OLD.target_membership_id IS DISTINCT FROM NEW.target_membership_id)
 OR (OLD.auth_user_id IS NOT NULL AND OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id)
 OR (OLD.status IN ('completed','rejected') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN
  RAISE EXCEPTION 'Staff Auth request identity is immutable' USING ERRCODE='55000';
 END IF;
 IF ROW(OLD.prepared_assignments,OLD.preparation_version,OLD.preparation_reason,OLD.no_access)
 IS DISTINCT FROM ROW(NEW.prepared_assignments,NEW.preparation_version,NEW.preparation_reason,NEW.no_access)
 AND (OLD.operation<>'invite' OR OLD.status NOT IN ('dispatching','reconciliation_required')
  OR NEW.preparation_version<>OLD.preparation_version+1) THEN
  RAISE EXCEPTION 'Staff Auth approval requires a new preparation version' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_auth_request_protect BEFORE UPDATE OR DELETE ON platform_private.staff_auth_requests
 FOR EACH ROW EXECUTE FUNCTION platform_private.staff_auth_request_protect();
CREATE TRIGGER staff_auth_request_no_truncate BEFORE TRUNCATE ON platform_private.staff_auth_requests
 FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Reuse 155's role/scope validation. Bundle identity and permission keys are
-- captured for human confirmation; the immutable bundle remains authoritative.
CREATE FUNCTION platform_private.staff_auth_prepare_assignments(
 p_organization_id UUID,p_assignments JSONB,p_no_access BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE entry JSONB; normalized JSONB:='[]'::JSONB; scope JSONB; permission_keys JSONB;
 r platform.staff_role_definitions%ROWTYPE; bundle_version BIGINT; role_version BIGINT;
BEGIN
 IF p_no_access IS NULL OR p_assignments IS NULL OR jsonb_typeof(p_assignments)<>'array'
 OR jsonb_array_length(p_assignments)>100
 OR (p_no_access AND jsonb_array_length(p_assignments)<>0)
 OR (NOT p_no_access AND jsonb_array_length(p_assignments)=0) THEN
  RAISE EXCEPTION 'staff_workspace_explicit_access_required' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT(entry ?& ARRAY['roleId','roleVersion','scope'])
  OR (SELECT count(*) FROM jsonb_object_keys(entry))<>3
  OR jsonb_typeof(entry->'roleId')<>'string'
  OR (entry->>'roleId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(entry->'roleVersion')<>'number'
  OR (entry->>'roleVersion')!~'^[1-9][0-9]{0,15}$' THEN
   RAISE EXCEPTION 'staff_workspace_invalid_assignments' USING ERRCODE='22023'; END IF;
  role_version:=(entry->>'roleVersion')::BIGINT;
  SELECT * INTO r FROM platform.staff_role_definitions
   WHERE organization_id=p_organization_id AND id=(entry->>'roleId')::UUID AND status='active';
  IF NOT FOUND OR role_version>9007199254740991 OR r.version<>role_version OR r.current_bundle_id IS NULL THEN
   RAISE EXCEPTION 'staff_workspace_role_version_conflict' USING ERRCODE='40001'; END IF;
  scope:=platform_private.staff_validate_role_scope(p_organization_id,r.id,entry->'scope');
  SELECT b.version INTO bundle_version FROM platform.role_bundle_versions b
   WHERE b.id=r.current_bundle_id AND b.status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_workspace_role_version_conflict' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(jsonb_agg(bp.permission_key ORDER BY bp.permission_key),'[]'::JSONB)
   INTO permission_keys FROM platform.role_bundle_permissions bp WHERE bp.bundle_id=r.current_bundle_id;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('roleId',r.id,'roleVersion',r.version,
   'bundleId',r.current_bundle_id,'bundleVersion',bundle_version,'label',r.label,
   'permissionKeys',permission_keys,'scope',scope));
 END LOOP;
 IF jsonb_array_length(normalized)<>(SELECT count(DISTINCT jsonb_build_array(e->'roleId',e->'scope'))
  FROM jsonb_array_elements(normalized) e) THEN
  RAISE EXCEPTION 'staff_workspace_duplicate_assignment' USING ERRCODE='22023'; END IF;
 IF NOT p_no_access AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) e
  WHERE jsonb_array_length(e->'permissionKeys')>0) THEN
  RAISE EXCEPTION 'staff_workspace_explicit_access_required' USING ERRCODE='22023'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(e ORDER BY e->>'roleId',(e->'scope')::TEXT)
  FROM jsonb_array_elements(normalized) e),'[]'::JSONB);
END $$;

-- A changed role, department or deleted record needs fresh human approval.
-- Catch only the shared validator's expected scope-validation failure; SQL or
-- infrastructure errors propagate and cannot become a completed invitation.
CREATE FUNCTION platform_private.staff_auth_preparation_conflict(p_organization_id UUID,p_prepared JSONB,p_no_access BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE entry JSONB;
BEGIN
 IF p_no_access THEN
  IF p_prepared='[]'::JSONB THEN RETURN NULL; END IF;
  RETURN 'prepared_access_invalid';
 END IF;
 IF p_prepared IS NULL OR jsonb_typeof(p_prepared)<>'array' OR jsonb_array_length(p_prepared)=0 THEN
  RETURN 'prepared_access_invalid'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_prepared) LOOP
  IF NOT EXISTS(SELECT 1 FROM platform.staff_role_definitions r
   JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id AND b.status='published'
   WHERE r.organization_id=p_organization_id AND r.id=(entry->>'roleId')::UUID AND r.status='active'
   AND r.version=(entry->>'roleVersion')::BIGINT AND b.id=(entry->>'bundleId')::UUID
   AND b.version=(entry->>'bundleVersion')::BIGINT) THEN RETURN 'role_version_changed'; END IF;
  BEGIN
   PERFORM platform_private.staff_validate_role_scope(p_organization_id,(entry->>'roleId')::UUID,entry->'scope');
  EXCEPTION WHEN invalid_parameter_value THEN RETURN 'scope_changed';
  END;
 END LOOP;
 RETURN NULL;
END $$;

-- 154 has no dependent database objects for this obsolete overload. RESTRICT
-- is deliberate: unexpected dependencies stop the migration, never CASCADE.
DROP FUNCTION platform.staff_workspace_claim_auth(UUID,UUID,TEXT,TEXT,TEXT,platform.business_role,UUID);
CREATE FUNCTION platform.staff_workspace_claim_auth(
 p_organization_id UUID,p_request_id UUID,p_operation TEXT,
 p_email TEXT DEFAULT NULL,p_display_name TEXT DEFAULT NULL,p_membership_id UUID DEFAULT NULL,
 p_assignments JSONB DEFAULT NULL,p_no_access BOOLEAN DEFAULT FALSE,p_reason TEXT DEFAULT NULL,
 p_expected_access_version BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; r platform_private.staff_auth_requests%ROWTYPE; payload JSONB; prepared JSONB:='[]'::JSONB;
 v_email TEXT; v_name TEXT; v_auth UUID; v_baseline TIMESTAMPTZ; v_version BIGINT;
BEGIN
 IF p_organization_id IS NULL OR p_request_id IS NULL OR p_operation IS NULL
 OR p_operation NOT IN ('invite','recovery') OR p_no_access IS NULL
 OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'staff_workspace_invalid_input' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id,'membership.provision');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT,139));
 payload:=jsonb_build_object('operation',p_operation,'email',lower(btrim(p_email)),
  'displayName',btrim(p_display_name),'membershipId',p_membership_id,'assignments',p_assignments,
  'noAccess',p_no_access,'reason',btrim(p_reason),'expectedAccessVersion',p_expected_access_version);
 SELECT * INTO r FROM platform_private.staff_auth_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF r.organization_id<>p_organization_id OR r.actor_membership_id<>actor.actor_membership_id
  OR r.request_payload IS NULL OR r.request_payload<>payload THEN
   RAISE EXCEPTION 'staff_workspace_request_conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('id',r.id,'dispatch',FALSE,'status',r.status);
 END IF;
 IF EXISTS(SELECT 1 FROM platform.audit_events WHERE request_id=p_request_id)
 OR EXISTS(SELECT 1 FROM platform_private.staff_role_command_receipts WHERE request_id=p_request_id) THEN
  RAISE EXCEPTION 'staff_workspace_request_conflict' USING ERRCODE='23505'; END IF;
 IF p_operation='invite' THEN
  v_email:=lower(btrim(p_email)); v_name:=btrim(p_display_name);
  IF p_membership_id IS NOT NULL OR p_expected_access_version IS NOT NULL
  OR v_email IS NULL OR length(v_email) NOT BETWEEN 3 AND 320
  OR v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 160 OR v_name~'[[:cntrl:]]' THEN
   RAISE EXCEPTION 'staff_workspace_invalid_invite' USING ERRCODE='22023'; END IF;
  prepared:=platform_private.staff_auth_prepare_assignments(p_organization_id,p_assignments,p_no_access);
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=v_email) THEN
   RAISE EXCEPTION 'staff_workspace_email_exists' USING ERRCODE='23505'; END IF;
 ELSE
  IF p_email IS NOT NULL OR p_display_name IS NOT NULL OR p_assignments IS NOT NULL
  OR p_no_access OR p_membership_id IS NULL OR p_expected_access_version IS NULL THEN
   RAISE EXCEPTION 'staff_workspace_invalid_recovery' USING ERRCODE='22023'; END IF;
  PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_membership_id]);
  SELECT u.email,i.display_name,i.auth_user_id,u.recovery_sent_at,i.access_version
   INTO v_email,v_name,v_auth,v_baseline,v_version
   FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
   JOIN auth.users u ON u.id=i.auth_user_id;
  IF NOT FOUND OR v_version<>p_expected_access_version THEN
   RAISE EXCEPTION 'staff_workspace_version_conflict' USING ERRCODE='40001'; END IF;
  v_email:=lower(btrim(v_email));
  IF v_email IS NULL OR length(v_email) NOT BETWEEN 3 AND 320
  OR v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   RAISE EXCEPTION 'staff_workspace_recovery_target_unavailable' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::TEXT||':'||v_email,139));
 IF EXISTS(SELECT 1 FROM platform_private.staff_auth_requests WHERE organization_id=p_organization_id
  AND normalized_email=v_email AND status IN ('dispatching','reconciliation_required')) THEN
  RAISE EXCEPTION 'staff_workspace_auth_pending' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM platform_private.staff_auth_requests WHERE organization_id=p_organization_id
  AND normalized_email=v_email AND created_at>clock_timestamp()-interval '60 seconds') THEN
  RAISE EXCEPTION 'staff_workspace_auth_cooldown' USING ERRCODE='55000'; END IF;
 INSERT INTO platform_private.staff_auth_requests(id,organization_id,actor_membership_id,operation,normalized_email,
  display_name,requested_role,target_membership_id,auth_user_id,baseline_recovery_sent_at,request_payload,
  prepared_assignments,preparation_version,preparation_reason,no_access,expected_access_version)
 VALUES(p_request_id,p_organization_id,actor.actor_membership_id,p_operation,v_email,v_name,NULL,
  p_membership_id,v_auth,v_baseline,payload,prepared,CASE WHEN p_operation='invite' THEN 1 ELSE 0 END,
  btrim(p_reason),p_no_access,p_expected_access_version);
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
  resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,
  'staff.auth.prepare','staff_auth_request',p_request_id,NULL,
  jsonb_build_object('operation',p_operation,'preparedAssignments',prepared,'noAccess',p_no_access,
   'targetMembershipId',p_membership_id,'expectedAccessVersion',p_expected_access_version),btrim(p_reason),p_request_id);
 RETURN jsonb_build_object('id',p_request_id,'dispatch',TRUE,'email',v_email,'status','dispatching');
END $$;

CREATE FUNCTION platform.staff_workspace_prepare_pending_access(
 p_organization_id UUID,p_request_id UUID,p_expected_preparation_version BIGINT,
 p_assignments JSONB,p_no_access BOOLEAN,p_reason TEXT,p_command_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r platform_private.staff_auth_requests%ROWTYPE; command JSONB; result JSONB; prepared JSONB; before_state JSONB;
BEGIN
 IF p_request_id IS NULL OR p_command_request_id IS NULL OR p_request_id=p_command_request_id THEN
  RAISE EXCEPTION 'staff_workspace_invalid_input' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM platform_private.staff_auth_requests WHERE id=p_command_request_id) THEN
  RAISE EXCEPTION 'staff_workspace_request_conflict' USING ERRCODE='23505'; END IF;
 command:=jsonb_build_object('operation','staffAuthPrepare','requestId',p_request_id,
  'expectedPreparationVersion',p_expected_preparation_version,'assignments',p_assignments,
  'noAccess',p_no_access,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_command_request_id,command);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT * INTO r FROM platform_private.staff_auth_requests
  WHERE organization_id=p_organization_id AND id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.operation<>'invite' OR r.status NOT IN ('dispatching','reconciliation_required') THEN
  RAISE EXCEPTION 'staff_workspace_pending_invite_required' USING ERRCODE='22023'; END IF;
 IF p_expected_preparation_version IS NULL OR r.preparation_version<>p_expected_preparation_version
 OR r.preparation_version>=9007199254740991 THEN
  RAISE EXCEPTION 'staff_workspace_preparation_version_conflict' USING ERRCODE='40001'; END IF;
 prepared:=platform_private.staff_auth_prepare_assignments(p_organization_id,p_assignments,p_no_access);
 before_state:=jsonb_build_object('preparationVersion',r.preparation_version,
  'assignments',r.prepared_assignments,'noAccess',r.no_access,'conflictCode',r.conflict_code);
 UPDATE platform_private.staff_auth_requests SET prepared_assignments=prepared,no_access=p_no_access,
  preparation_version=preparation_version+1,preparation_reason=btrim(p_reason),conflict_code=NULL,
  status='reconciliation_required' WHERE id=r.id;
 result:=jsonb_build_object('status','applied','requestId',r.id,'preparationVersion',r.preparation_version+1);
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_command_request_id,command,result,
  'staff.auth.reprepare','staff_auth_request',r.id,before_state);
END $$;

CREATE FUNCTION platform.staff_workspace_auth_preparation(p_organization_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r platform_private.staff_auth_requests%ROWTYPE;
BEGIN
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'membership.read');
 SELECT * INTO r FROM platform_private.staff_auth_requests WHERE organization_id=p_organization_id AND id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_workspace_request_missing' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',r.id,'operation',r.operation,'status',r.status,
  'displayName',r.display_name,'preparationVersion',r.preparation_version,'conflictCode',
  CASE WHEN r.operation='invite' AND r.preparation_version=0 AND r.status IN ('dispatching','reconciliation_required')
   THEN 'legacy_access_review_required' ELSE r.conflict_code END,'noAccess',r.no_access,
  'targetMembershipId',r.target_membership_id,'assignments',r.prepared_assignments);
END $$;

CREATE OR REPLACE FUNCTION platform.staff_workspace_reconcile_auth(p_organization_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; r platform_private.staff_auth_requests%ROWTYPE; u RECORD; conflict TEXT;
 v_profile_id UUID; v_membership_id UUID; v_access_version BIGINT; assignments JSONB; audit_id UUID;
BEGIN
 IF p_organization_id IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'staff_workspace_invalid_input' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id,'membership.provision');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT,139));
 SELECT * INTO r FROM platform_private.staff_auth_requests
  WHERE id=p_request_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_workspace_request_missing' USING ERRCODE='22023'; END IF;
 IF r.status IN ('completed','rejected') THEN
  RETURN jsonb_build_object('status',r.status,'operation',r.operation,'rejection_code',r.rejection_code);
 END IF;
 IF r.operation='invite' THEN
  IF r.preparation_version=0 THEN conflict:='legacy_access_review_required';
  ELSE conflict:=platform_private.staff_auth_preparation_conflict(r.organization_id,r.prepared_assignments,r.no_access); END IF;
  IF conflict IS NOT NULL THEN
   UPDATE platform_private.staff_auth_requests SET status='reconciliation_required',conflict_code=conflict WHERE id=r.id;
   RETURN jsonb_build_object('status','reconciliation_required','operation',r.operation,'conflict_code',conflict);
  END IF;
  SELECT id,invited_at INTO u FROM auth.users WHERE lower(email)=r.normalized_email
   AND invited_at>=r.created_at AND raw_user_meta_data->>'evo_staff_invitation_request_id'=r.id::TEXT FOR SHARE;
  IF FOUND THEN
   -- Never adopt an existing profile, Student, or unrelated business identity.
   IF EXISTS(SELECT 1 FROM platform.profiles p WHERE p.auth_user_id=u.id) THEN
    UPDATE platform_private.staff_auth_requests SET status='reconciliation_required',
     provider_observed_at=u.invited_at,conflict_code='identity_already_linked' WHERE id=r.id;
    RETURN jsonb_build_object('status','reconciliation_required','operation','invite','conflict_code','identity_already_linked');
   END IF;
   INSERT INTO platform.profiles(auth_user_id,display_name) VALUES(u.id,r.display_name) RETURNING id INTO v_profile_id;
   INSERT INTO platform.organization_memberships(organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
    VALUES(r.organization_id,v_profile_id,'active',NULL,NULL,FALSE) RETURNING id INTO v_membership_id;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('roleId',e->'roleId','scope',e->'scope')),'[]'::JSONB)
    INTO assignments FROM jsonb_array_elements(r.prepared_assignments) e;
   PERFORM platform_private.staff_replace_assignments(r.organization_id,v_membership_id,assignments);
   IF NOT r.no_access AND NOT EXISTS(SELECT 1 FROM platform.staff_role_assignments a
    JOIN platform.role_bundle_permissions bp ON bp.bundle_id=a.bundle_id
    WHERE a.organization_id=r.organization_id AND a.membership_id=v_membership_id AND a.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'staff_workspace_prepared_access_missing' USING ERRCODE='55000'; END IF;
   PERFORM platform_private.staff_bump_memberships(r.organization_id,ARRAY[v_membership_id]);
   SELECT access_version INTO v_access_version FROM platform.profiles WHERE id=v_profile_id;
   audit_id:=md5(r.id::TEXT||':staff-onboarding-completed')::UUID;
   INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
    resource_type,resource_id,before_state,after_state,reason,request_id)
   VALUES(r.organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,
    'membership.provision','organization_membership',v_membership_id,NULL,
    jsonb_build_object('organization_id',r.organization_id,'profile_id',v_profile_id,'membership_id',v_membership_id,
     'systemRole','staff','access_version',v_access_version,'invitationRequestId',r.id,
     'preparationVersion',r.preparation_version,'assignments',r.prepared_assignments,'noAccess',r.no_access),
    r.preparation_reason,audit_id);
   UPDATE platform_private.staff_auth_requests SET status='completed',auth_user_id=u.id,
    target_membership_id=v_membership_id,provider_observed_at=u.invited_at,completed_at=clock_timestamp(),conflict_code=NULL WHERE id=r.id;
   RETURN jsonb_build_object('status','completed','operation','invite');
  END IF;
 ELSE
  -- Rights may legitimately change after dispatch; recovery never restores old
  -- rights. Recheck the same currently active non-Student identity instead.
  IF NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(r.organization_id,r.target_membership_id) i
   JOIN auth.users au ON au.id=i.auth_user_id WHERE i.auth_user_id=r.auth_user_id AND lower(au.email)=r.normalized_email) THEN
   UPDATE platform_private.staff_auth_requests SET status='reconciliation_required',conflict_code='recovery_target_unavailable' WHERE id=r.id;
   RETURN jsonb_build_object('status','reconciliation_required','operation','recovery','conflict_code','recovery_target_unavailable');
  END IF;
  SELECT recovery_sent_at INTO u FROM auth.users WHERE id=r.auth_user_id AND lower(email)=r.normalized_email
   AND recovery_sent_at>=r.created_at AND recovery_sent_at>COALESCE(r.baseline_recovery_sent_at,'-infinity'::TIMESTAMPTZ);
  IF FOUND THEN
   INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
    resource_type,resource_id,before_state,after_state,reason,request_id)
   VALUES(r.organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,
    'staff.auth.recovery.observed','staff_auth_request',r.id,NULL,
    jsonb_build_object('operation','recovery','targetMembershipId',r.target_membership_id,
     'providerObservedAt',u.recovery_sent_at),COALESCE(r.preparation_reason,'Staff recovery Auth evidence observed'),
    md5(r.id::TEXT||':staff-recovery-observed')::UUID);
   UPDATE platform_private.staff_auth_requests SET status='completed',provider_observed_at=u.recovery_sent_at,
    completed_at=clock_timestamp(),conflict_code=NULL WHERE id=r.id;
   RETURN jsonb_build_object('status','completed','operation','recovery');
  END IF;
 END IF;
 UPDATE platform_private.staff_auth_requests SET status='reconciliation_required',conflict_code=NULL WHERE id=r.id;
 RETURN jsonb_build_object('status','reconciliation_required','operation',r.operation);
END $$;

-- Keep the directory command's signature, but remove fixed-role edits and its
-- versionless alternate entry point. 155 guards the last live system Admin.
CREATE OR REPLACE FUNCTION platform.staff_workspace_change_member(
 p_organization_id UUID,p_membership_id UUID,p_expected_version BIGINT,
 p_operation TEXT,p_value TEXT,p_reason TEXT,p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; target RECORD; command JSONB; result JSONB; before_state JSONB;
BEGIN
 IF p_operation IS DISTINCT FROM 'status' OR p_value IS NULL OR p_value NOT IN ('active','suspended') THEN
  RAISE EXCEPTION 'staff_workspace_invalid_change' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM platform_private.staff_auth_requests WHERE id=p_request_id) THEN
  RAISE EXCEPTION 'staff_workspace_request_conflict' USING ERRCODE='23505'; END IF;
 command:=jsonb_build_object('operation','staffStatus','membershipId',p_membership_id,
  'expectedVersion',p_expected_version,'status',p_value,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_request_id,command);
 IF result IS NOT NULL THEN RETURN result||jsonb_build_object('status',p_value); END IF;
 SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id,'membership.status.change');
 PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_membership_id]);
 SELECT m.profile_id,m.status,m."current_role",m.current_bundle_id,p.access_version INTO target
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
  WHERE m.organization_id=p_organization_id AND m.id=p_membership_id AND m."current_role" IS DISTINCT FROM 'student';
 IF NOT FOUND OR p_expected_version IS NULL OR target.access_version<>p_expected_version
 OR target.access_version>=9007199254740991 THEN
  RAISE EXCEPTION 'staff_workspace_version_conflict' USING ERRCODE='40001'; END IF;
 IF actor.actor_membership_id=p_membership_id AND p_value<>'active' THEN
  RAISE EXCEPTION 'staff_workspace_self_deactivation_forbidden' USING ERRCODE='42501'; END IF;
 IF target.status::TEXT=p_value THEN RAISE EXCEPTION 'staff_workspace_status_unchanged' USING ERRCODE='22023'; END IF;
 before_state:=jsonb_build_object('status',target.status,'access_version',target.access_version);
 UPDATE platform.organization_memberships SET status=p_value::platform.membership_status
  WHERE organization_id=p_organization_id AND id=p_membership_id;
 PERFORM platform_private.staff_bump_memberships(p_organization_id,ARRAY[p_membership_id]);
 result:=jsonb_build_object('organization_id',p_organization_id,'membership_id',p_membership_id,'profile_id',target.profile_id,
  'role',target."current_role",'bundle_id',target.current_bundle_id,'status',p_value,'access_version',target.access_version+1);
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_request_id,command,result,
  'membership.status.change','organization_membership',p_membership_id,before_state);
END $$;

-- Keep the established Admin-only directory DTO and personal-grant ledger.
-- Coarse role is historical display metadata; custom staff have no fake role.
CREATE OR REPLACE FUNCTION platform.staff_directory(p_organization_id UUID)
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,display_name TEXT,
 platform_role platform.business_role,membership_status platform.membership_status,access_version BIGINT,
 contract_confirmation_granted BOOLEAN,first_payment_confirmation_granted BOOLEAN,admissions_gate_override_granted BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'membership.read');
 RETURN QUERY SELECT p.auth_user_id,p.id,m.id,p.display_name,
  CASE WHEN m.is_system_admin THEN 'admin'::platform.business_role
   WHEN m."current_role"='admin' THEN NULL::platform.business_role ELSE m."current_role" END,
  m.status,p.access_version,
  platform_private.latest_membership_permission_grant(m.organization_id,m.id,'contract.evidence.confirm'),
  platform_private.latest_membership_permission_grant(m.organization_id,m.id,'finance.first.payment.confirm'),
  platform_private.latest_membership_permission_grant(m.organization_id,m.id,'admissions.handoff.gate.override')
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND m."current_role" IS DISTINCT FROM 'student'
 ORDER BY lower(p.display_name),m.id;
END $$;

-- These columns describe the historical authorizer bundle only. A protected
-- system Admin has no required legacy bundle. Do not modify old receipt values
-- or any Student-side identity/bundle/receipt constraint.
ALTER TABLE platform_private.student_portal_provisioning_receipts
 ALTER COLUMN authorizing_bundle_id DROP NOT NULL,
 ALTER COLUMN authorizing_bundle_version DROP NOT NULL,
 ADD CONSTRAINT student_portal_authorizer_bundle_pair CHECK(
  (authorizing_bundle_id IS NULL)=(authorizing_bundle_version IS NULL));

CREATE OR REPLACE FUNCTION platform_private.assert_student_portal_receipt_admin_e1(p_receipt_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
BEGIN
 SELECT * INTO receipt FROM platform_private.student_portal_provisioning_receipts candidate WHERE candidate.id=p_receipt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(receipt.organization_id,receipt.authorizing_membership_id) identity
  WHERE identity.system_role='admin' AND identity.auth_user_id=receipt.authorizing_auth_user_id
  AND identity.profile_id=receipt.authorizing_profile_id AND identity.access_version=receipt.authorizing_access_version)
 OR EXISTS(SELECT 1 FROM unnest(receipt.required_permission_keys) required(permission_key)
  WHERE NOT platform_private.staff_has_permission(receipt.organization_id,receipt.authorizing_membership_id,required.permission_key)) THEN
  RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE='42501'; END IF;
END $$;

-- Narrow forward replacements retain 126/149 business and Student proof logic.
-- Exact anchors fail on source drift instead of rewriting a changed function.
DO $staff_portal_admin_receipts$
DECLARE body TEXT; anchor TEXT;
BEGIN
 body:=pg_get_functiondef('platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::regprocedure);
 anchor:=$old$  SELECT profile.access_version, membership.current_bundle_id, bundle.version
  INTO actor_access_version, actor_bundle_id, actor_bundle_version
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.profile_id = profile.id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE profile.id = actor.actor_profile_id
    AND profile.auth_user_id = actor.actor_auth_user_id
    AND profile.status = 'active'
    AND membership.organization_id = p_organization_id
    AND membership.id = actor.actor_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'admin'
    AND bundle.status = 'published'
  FOR UPDATE OF profile, membership, bundle;$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'staff_portal_prepare_admin_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(p_organization_id,
    array_remove(ARRAY[actor.actor_membership_id,p_legacy_curator_membership_id]::UUID[],NULL::UUID));
  SELECT identity.access_version,NULL::UUID,NULL::BIGINT
  INTO actor_access_version,actor_bundle_id,actor_bundle_version
  FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) identity
  WHERE identity.system_role='admin' AND identity.profile_id=actor.actor_profile_id
    AND identity.auth_user_id=actor.actor_auth_user_id;$new$);
 anchor:=$old$    PERFORM 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_legacy_curator_membership_id
      AND membership.status = 'active'
      AND platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, 'curator')
      AND profile.status = 'active'
      AND bundle.status = 'published'
    FOR UPDATE OF membership, profile, bundle;$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'staff_portal_prepare_curator_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$    -- The requested curator's profile/member rows are already locked above.
    -- Responsibility is live staff identity plus capacity for this exact case,
    -- not a fixed role label or a legacy membership bundle.
    PERFORM 1
    FROM platform_private.staff_membership_identity(
      p_organization_id,p_legacy_curator_membership_id) identity
    WHERE platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'case.read.full','student_case',p_student_case_id)
      AND platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'task.manage','student_case',p_student_case_id);$new$);
 EXECUTE body;

 body:=pg_get_functiondef('platform.finalize_student_portal_authority(uuid,bigint,bigint)'::regprocedure);
 anchor:=$old$  -- Participant locks begin only after the complete advisory tree.
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'staff_portal_finalize_admin_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$  -- Canonical advisory locks precede the shared organization/profile/member
  -- row order. Subsequent E1 participant locks reacquire already-held rows.
  PERFORM 1 FROM platform.organizations WHERE id=receipt_hint.organization_id FOR UPDATE;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  PERFORM profile.id FROM platform.profiles profile
  WHERE profile.id=ANY(array_remove(ARRAY[receipt.authorizing_profile_id,receipt.student_profile_id]::UUID[],NULL::UUID))
    OR EXISTS(SELECT 1 FROM platform.organization_memberships membership
      WHERE membership.organization_id=receipt.organization_id AND membership.profile_id=profile.id
        AND membership.id=ANY(array_remove(ARRAY[receipt.authorizing_membership_id,
          receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID)))
  ORDER BY profile.id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(receipt.organization_id,array_remove(
    ARRAY[receipt.authorizing_membership_id,receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID));$new$);
 anchor:=$old$        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile ON profile.id = membership.profile_id
        JOIN platform.role_bundle_versions AS bundle
          ON bundle.id = membership.current_bundle_id
          AND bundle.role = membership."current_role"
        WHERE membership.organization_id = receipt.organization_id
          AND membership.id = receipt.legacy_curator_membership_id
          AND membership.status = 'active'
          AND platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, 'curator')
          AND profile.status = 'active'
          AND bundle.status = 'published'$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'staff_portal_finalize_curator_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$        FROM platform_private.staff_membership_identity(
          receipt.organization_id,receipt.legacy_curator_membership_id) identity
        WHERE platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'case.read.full','student_case',receipt.student_case_id)
          AND platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'task.manage','student_case',receipt.student_case_id)$new$);
 EXECUTE body;
END $staff_portal_admin_receipts$;

-- Student organization-scope provisioning still uses the unchanged E1 helper.
-- Staff login and business grants no longer come from this legacy command.
CREATE OR REPLACE FUNCTION platform.assign_organization_scope(
 p_organization_id UUID,p_membership_id UUID,p_reason TEXT,p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD;
BEGIN
 IF p_organization_id IS NULL OR p_membership_id IS NULL OR p_request_id IS NULL
 OR btrim(COALESCE(p_reason,''))='' THEN
  RAISE EXCEPTION 'organization, membership, reason and request_id are required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'scope.manage');
 PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
 PERFORM platform_private.lock_p2d_request(p_request_id);
 SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id,'scope.manage');
 IF NOT EXISTS(SELECT 1 FROM platform.organization_memberships m WHERE m.organization_id=p_organization_id
  AND m.id=p_membership_id AND m."current_role"='student') THEN
  RAISE EXCEPTION 'staff_legacy_scope_assignment_disabled' USING ERRCODE='22023'; END IF;
 RETURN platform_private.assign_organization_scope_authorized_e1(p_organization_id,p_membership_id,
  p_reason,p_request_id,actor.actor_profile_id,actor.actor_auth_user_id);
END $$;

-- Automation ownership is still protected system Admin authority, never an
-- editable role label. Preserve overdue timing, recipient and worker logic.
DO $staff_portal_automation_admin$
DECLARE body TEXT; anchor TEXT;
BEGIN
 body:=pg_get_functiondef('platform.process_student_portal_overdue_notifications_v1(uuid,text)'::regprocedure);
 anchor:=$old$    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>3 THEN
  RAISE EXCEPTION 'staff_portal_automation_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,'');
 anchor:=$old$      AND owner_bundle.status = 'published'
$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>3 THEN
  RAISE EXCEPTION 'staff_portal_automation_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,'');
 anchor:=$old$owner_membership."current_role" = 'admin'$old$;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>3 THEN
  RAISE EXCEPTION 'staff_portal_automation_source_drift' USING ERRCODE='55000'; END IF;
 body:=replace(body,anchor,$new$EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(
        control.organization_id,control.automation_owner_membership_id) identity
        WHERE identity.system_role='admin')$new$);
 EXECUTE body;
END $staff_portal_automation_admin$;

-- Preserve Student E1 provisioning and its private helpers; remove callable
-- legacy staff creation/status/organization-scope routes from this release.
REVOKE ALL ON FUNCTION platform.provision_pilot_staff_member(UUID,UUID,TEXT,platform.business_role,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.change_pilot_staff_status(UUID,UUID,platform.membership_status,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.change_membership_status(UUID,UUID,platform.membership_status,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.assign_organization_scope(UUID,UUID,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

REVOKE ALL ON FUNCTION platform_private.staff_auth_request_protect() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.staff_auth_prepare_assignments(UUID,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.staff_auth_preparation_conflict(UUID,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_workspace_claim_auth(UUID,UUID,TEXT,TEXT,TEXT,UUID,JSONB,BOOLEAN,TEXT,BIGINT)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_workspace_prepare_pending_access(UUID,UUID,BIGINT,JSONB,BOOLEAN,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_workspace_auth_preparation(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_workspace_reconcile_auth(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_workspace_change_member(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_claim_auth(UUID,UUID,TEXT,TEXT,TEXT,UUID,JSONB,BOOLEAN,TEXT,BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_prepare_pending_access(UUID,UUID,BIGINT,JSONB,BOOLEAN,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_auth_preparation(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_reconcile_auth(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_change_member(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.assign_organization_scope(UUID,UUID,TEXT,UUID) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
