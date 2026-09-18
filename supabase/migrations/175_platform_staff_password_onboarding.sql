-- Extend 157's authenticated Admin onboarding ledger with manual password
-- creation. Supabase createUser runs server-side and sends no invitation.
-- https://supabase.com/docs/reference/javascript/auth-admin-createuser
-- Existing Admin email changes use updateUserById and retain its Auth UUID:
-- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
BEGIN;

ALTER TABLE platform_private.staff_auth_requests
 DROP CONSTRAINT staff_auth_requests_operation_check,
 ADD CONSTRAINT staff_auth_requests_operation_check CHECK(operation IN ('invite','recovery','password'));

-- Patch the existing authority and receipt path in place. Every replacement is
-- anchored once; unexpected function changes stop this migration atomically.
DO $password_onboarding$
DECLARE body TEXT; anchor TEXT; replacement TEXT; item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('platform.staff_workspace_claim_auth(uuid,uuid,text,text,text,uuid,jsonb,boolean,text,bigint)',
   $a$p_operation NOT IN ('invite','recovery')$a$, $b$p_operation NOT IN ('invite','recovery','password')$b$),
  ('platform.staff_workspace_claim_auth(uuid,uuid,text,text,text,uuid,jsonb,boolean,text,bigint)',
   $a$IF p_operation='invite' THEN$a$, $b$IF p_operation IN ('invite','password') THEN$b$),
  ('platform.staff_workspace_claim_auth(uuid,uuid,text,text,text,uuid,jsonb,boolean,text,bigint)',
   $a$CASE WHEN p_operation='invite' THEN 1 ELSE 0 END$a$, $b$CASE WHEN p_operation IN ('invite','password') THEN 1 ELSE 0 END$b$),
  ('platform_private.staff_auth_request_protect()',
   $a$OLD.operation<>'invite'$a$, $b$OLD.operation NOT IN ('invite','password')$b$),
  ('platform.staff_workspace_prepare_pending_access(uuid,uuid,bigint,jsonb,boolean,text,uuid)',
   $a$r.operation<>'invite'$a$, $b$r.operation NOT IN ('invite','password')$b$),
  ('platform.staff_workspace_record_auth_rejection(uuid,uuid,text,integer)',
   $a$IF r.operation = 'invite' THEN$a$, $b$IF r.operation IN ('invite','password') THEN$b$),
  ('platform.staff_workspace_reconcile_auth(uuid,uuid)',
   $a$IF r.operation='invite' THEN$a$, $b$IF r.operation IN ('invite','password') THEN$b$),
  ('platform.staff_workspace_reconcile_auth(uuid,uuid)',
   $a$SELECT id,invited_at INTO u FROM auth.users WHERE lower(email)=r.normalized_email
   AND invited_at>=r.created_at AND raw_user_meta_data->>'evo_staff_invitation_request_id'=r.id::TEXT FOR SHARE;$a$,
   $b$SELECT id,CASE WHEN r.operation='password' THEN created_at ELSE invited_at END AS invited_at
   INTO u FROM auth.users WHERE lower(email)=r.normalized_email AND (
    (r.operation='invite' AND invited_at>=r.created_at
     AND raw_user_meta_data->>'evo_staff_invitation_request_id'=r.id::TEXT)
    OR (r.operation='password' AND created_at>=r.created_at AND email_confirmed_at IS NOT NULL
     AND COALESCE(encrypted_password,'')<>''
     AND raw_app_meta_data->>'evo_staff_password_request_id'=r.id::TEXT)) FOR SHARE;$b$),
  ('platform.staff_workspace_reconcile_auth(uuid,uuid)',
   $a$'operation','invite','conflict_code','identity_already_linked'$a$,
   $b$'operation',r.operation,'conflict_code','identity_already_linked'$b$),
  ('platform.staff_workspace_reconcile_auth(uuid,uuid)',
   $a$'systemRole','staff','access_version',v_access_version,'invitationRequestId',r.id,$a$,
   $b$'systemRole','staff','access_version',v_access_version,
     CASE WHEN r.operation='invite' THEN 'invitationRequestId' ELSE 'passwordRequestId' END,r.id,
     'authOperation',r.operation,$b$),
  ('platform.staff_workspace_reconcile_auth(uuid,uuid)',
   $a$RETURN jsonb_build_object('status','completed','operation','invite');$a$,
   $b$RETURN jsonb_build_object('status','completed','operation',r.operation);$b$)
 ) AS changes(signature,old_text,new_text) LOOP
  body:=pg_get_functiondef(item.signature::regprocedure);
  anchor:=item.old_text; replacement:=item.new_text;
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'staff_password_onboarding_source_drift: %',item.signature USING ERRCODE='55000';
  END IF;
  EXECUTE replace(body,anchor,replacement);
 END LOOP;
END $password_onboarding$;

-- All ACLs, forced RLS, immutable request IDs, recipient collision locks,
-- real require_admin_actor checks, prepared roles and audit remain from 157.
-- No new service-role business grant, stored password or email-delivery receipt.
COMMIT;
