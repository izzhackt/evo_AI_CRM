-- B215: authorize only the pending-case seller sync inside the existing sale
-- handoff. Contract: docs/EVO_LAUNCH_PLAN.md, 2026-09-21 B215 (3c7d6105).
-- 208's real Auth path hit guard126; this preserves its immutable identity
-- boundary while binding the one allowed change to a private transaction receipt.
-- No new RPC, caller grant, identity or data repair. Historical migrations stay.
-- https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT
-- https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET
-- https://www.postgresql.org/docs/current/sql-createfunction.html
BEGIN;

CREATE TABLE platform_private.sales_handoff_owner_sync_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id xid8 NOT NULL,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  canonical_lead_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id),
  actor_auth_user_id UUID NOT NULL REFERENCES auth.users(id),
  old_seller_membership_id UUID,
  new_seller_membership_id UUID NOT NULL,
  old_scope_id UUID NOT NULL,
  old_scope_version BIGINT NOT NULL CHECK (old_scope_version > 0),
  curator_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, request_id),
  CHECK (old_seller_membership_id IS DISTINCT FROM new_seller_membership_id),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id),
  FOREIGN KEY (organization_id, canonical_lead_id)
    REFERENCES platform.leads(organization_id, id),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, old_seller_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, new_seller_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, old_scope_id, old_scope_version)
    REFERENCES platform.record_scopes(organization_id, id, scope_version),
  -- The parent is written by the ordinary command AFTER curator assignment and
  -- sale insertion. An isolated context cannot commit without that final receipt.
  CONSTRAINT sales_handoff_owner_sync_completed_request_fkey
    FOREIGN KEY (organization_id, request_id)
    REFERENCES platform_private.sales_report_handoff_requests(organization_id, request_id)
    DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE platform_private.sales_handoff_owner_sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_handoff_owner_sync_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.sales_handoff_owner_sync_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER sales_handoff_owner_sync_receipts_immutable
  BEFORE UPDATE OR DELETE ON platform_private.sales_handoff_owner_sync_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_handoff_owner_sync_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.sales_handoff_owner_sync_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.guard_student_case_identity_e1()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bind_receipt_id UUID;
  owner_sync_id UUID;
  owner_sync platform_private.sales_handoff_owner_sync_receipts%ROWTYPE;
  actor RECORD;
BEGIN
  IF NEW.responsible_sales_membership_id IS DISTINCT FROM OLD.responsible_sales_membership_id THEN
    -- The entire row must otherwise be unchanged. In particular this exception
    -- cannot be combined with the independent E1 Student NULL -> UUID binding.
    IF OLD.state IS DISTINCT FROM 'pending' OR NEW.state IS DISTINCT FROM 'pending'
      OR OLD.canonical_lead_id IS NULL
      OR (to_jsonb(NEW) - ARRAY['responsible_sales_membership_id','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['responsible_sales_membership_id','updated_at'])
    THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;
    BEGIN
      owner_sync_id := NULLIF(pg_catalog.current_setting('platform.sales_handoff_owner_sync_receipt_id', TRUE), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      owner_sync_id := NULL;
    END;
    SELECT * INTO owner_sync
    FROM platform_private.sales_handoff_owner_sync_receipts r
    WHERE r.id = owner_sync_id AND r.transaction_id = pg_catalog.pg_current_xact_id()
      AND r.organization_id = OLD.organization_id AND r.student_case_id = OLD.id
      AND r.canonical_lead_id = OLD.canonical_lead_id
      AND r.old_seller_membership_id IS NOT DISTINCT FROM OLD.responsible_sales_membership_id
      AND r.new_seller_membership_id = NEW.responsible_sales_membership_id
      AND r.old_scope_id = OLD.current_scope_id AND r.old_scope_version = OLD.current_scope_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;
    SELECT * INTO actor FROM platform.current_actor_authority()
    WHERE organization_id = owner_sync.organization_id
      AND membership_id = owner_sync.actor_membership_id
      AND profile_id = owner_sync.actor_profile_id AND auth_user_id = owner_sync.actor_auth_user_id;
    IF NOT FOUND
      OR platform_private.staff_is_sales_manager(OLD.organization_id, owner_sync.actor_membership_id) IS NOT TRUE
      OR platform_private.staff_has_permission(OLD.organization_id, owner_sync.actor_membership_id, 'sales.register.manage') IS NOT TRUE
      OR platform_private.staff_can_access(OLD.organization_id, owner_sync.actor_membership_id,
        'lead.sales.workflow.manage', 'lead', OLD.canonical_lead_id) IS NOT TRUE
      OR platform_private.staff_can_access(OLD.organization_id, owner_sync.new_seller_membership_id,
        'lead.sales.workflow.manage', 'lead', OLD.canonical_lead_id) IS NOT TRUE
      OR NOT EXISTS (SELECT 1 FROM platform.leads l JOIN platform.clients c
        ON c.organization_id = l.organization_id AND c.id = l.client_id
        WHERE l.organization_id = OLD.organization_id AND l.id = OLD.canonical_lead_id
          AND l.current_owner_membership_id = owner_sync.new_seller_membership_id
          AND l.lifecycle_state = 'open' AND c.lifecycle_state = 'active')
      OR NOT EXISTS (SELECT 1 FROM platform.record_scopes s
        WHERE s.organization_id = OLD.organization_id AND s.id = OLD.current_scope_id
          AND s.scope_version = OLD.current_scope_version AND s.scope_kind = 'student_case'
          AND s.scope_key = OLD.id AND s.is_active)
    THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;
    RETURN NEW;
  END IF;

  -- Original126 identity and E1 Student-binding rules below remain unchanged.
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.responsible_sales_membership_id IS DISTINCT FROM OLD.responsible_sales_membership_id
    OR NEW.source_key IS DISTINCT FROM OLD.source_key
    OR NEW.contract_confirmation_ref IS DISTINCT FROM OLD.contract_confirmation_ref
    OR NEW.contract_confirmed_at IS DISTINCT FROM OLD.contract_confirmed_at
  THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;

  IF NEW.student_membership_id IS NOT DISTINCT FROM OLD.student_membership_id THEN
    RETURN NEW;
  END IF;
  IF OLD.student_membership_id IS NOT NULL OR NEW.student_membership_id IS NULL THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;

  BEGIN
    bind_receipt_id := NULLIF(
      pg_catalog.current_setting('platform.student_portal_bind_receipt_id', TRUE),
      ''
    )::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    bind_receipt_id := NULL;
  END;

  IF bind_receipt_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = receipt.organization_id
      AND membership.id = receipt.student_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
      AND profile.id = receipt.student_profile_id
      AND profile.auth_user_id = receipt.auth_user_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE receipt.id = bind_receipt_id
      AND receipt.organization_id = NEW.organization_id
      AND receipt.student_case_id = NEW.id
      AND receipt.student_membership_id = NEW.student_membership_id
      AND receipt.provisioning_state = 'invite_succeeded'
      AND membership.status = 'active'
      AND membership."current_role" = 'student'
      AND profile.status = 'active'
      AND bundle.status = 'published'
  ) THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END
$$;

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
  initial_actor_membership_id UUID; initial_actor_profile_id UUID; initial_actor_auth_user_id UUID;
  owner_sync_id UUID; old_seller_profile_id UUID; has_pending_case BOOLEAN;
  pending_case platform.student_cases%ROWTYPE; command_reason TEXT:='Sale saved from the report'; source_snapshot JSONB;
BEGIN
  -- FIRST lock: serialize this handoff with sibling KEY SHARE handoffs and
  -- role changes before touching any actor/profile/request/lead/case locks.
  -- A late upgrade or a private profile prelock order would create lock cycles.
  -- Tradeoff: handoff commands in one organization run serially.
  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id)
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'sales.register.manage')
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'lead.sales.workflow.manage') THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  initial_actor_membership_id := actor.membership_id;
  initial_actor_profile_id := actor.profile_id;
  initial_actor_auth_user_id := actor.auth_user_id;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_curator_membership_id IS NULL
    OR (p_report_month IS NOT NULL AND (extract(day FROM p_report_month)<>1
      OR p_report_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01')) THEN
    RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
  -- The legacy month argument only identifies the original request; it never selects a new sale's month.
  -- Serialize first by request, then by canonical lead. The report trigger owns
  -- the report lock; never acquire it before the lead lock (opposite handoff path).
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-report-request:'||p_organization_id::TEXT||':'||p_request_id::TEXT,0));
  -- Revalidate current authority after waiting on the request lock, including replay.
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF actor.membership_id IS DISTINCT FROM initial_actor_membership_id
    OR actor.profile_id IS DISTINCT FROM initial_actor_profile_id
    OR actor.auth_user_id IS DISTINCT FROM initial_actor_auth_user_id
    OR platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) IS NOT TRUE
    OR platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'sales.register.manage') IS NOT TRUE
    OR platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'lead.sales.workflow.manage') IS NOT TRUE
  THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
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
  has_pending_case := FOUND;
  -- All request/lead/snapshot/case waits are behind us. Current authority and
  -- the canonical seller must still authorize this exact lead before context.
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF actor.membership_id IS DISTINCT FROM initial_actor_membership_id
    OR actor.profile_id IS DISTINCT FROM initial_actor_profile_id
    OR actor.auth_user_id IS DISTINCT FROM initial_actor_auth_user_id
    OR platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) IS NOT TRUE
    OR platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'sales.register.manage') IS NOT TRUE
    OR platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'lead.sales.workflow.manage') IS NOT TRUE
  THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'lead.sales.workflow.manage', 'lead', p_lead_id) IS NOT TRUE
    OR platform_private.staff_can_access(p_organization_id, owner_id,
      'lead.sales.workflow.manage', 'lead', p_lead_id) IS NOT TRUE
    OR NOT EXISTS (SELECT 1 FROM platform.leads l JOIN platform.clients c
      ON c.organization_id=l.organization_id AND c.id=l.client_id
      WHERE l.organization_id=p_organization_id AND l.id=p_lead_id
        AND l.current_owner_membership_id=owner_id AND l.client_id=client_id_value
        AND l.lifecycle_state='open' AND c.lifecycle_state='active')
  THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF has_pending_case THEN
    -- The cabinet case snapshotted responsible_sales at approval time; the
    -- lead may have been reassigned since. Per-case sales scoping (155:
    -- case.read.summary / document.read.sales / finance.read.summary /
    -- communication.read.summary) keys off responsible_sales_membership_id,
    -- so sync it to the CURRENT lead owner credited with the sale
    -- — the same invariant handoff_lead_to_admissions enforces by rejection
    -- (088 'admissions_handoff_existing_case_conflict'), resolved here by
    -- update because the sale itself names the authoritative owner.
    IF pending_case.responsible_sales_membership_id IS DISTINCT FROM owner_id THEN
      INSERT INTO platform_private.sales_handoff_owner_sync_receipts (
        transaction_id, organization_id, request_id, student_case_id, canonical_lead_id,
        actor_membership_id, actor_profile_id, actor_auth_user_id,
        old_seller_membership_id, new_seller_membership_id, old_scope_id, old_scope_version,
        curator_membership_id
      ) VALUES (pg_catalog.pg_current_xact_id(), p_organization_id, p_request_id, pending_case.id, p_lead_id,
        actor.membership_id, actor.profile_id, actor.auth_user_id,
        pending_case.responsible_sales_membership_id, owner_id, pending_case.current_scope_id,
        pending_case.current_scope_version, p_curator_membership_id)
      RETURNING id INTO owner_sync_id;
      -- This pointer is untrusted unless guard126 finds the exact private xid8
      -- receipt. The deferred parent FK commits only with the completed handoff.
      PERFORM pg_catalog.set_config('platform.sales_handoff_owner_sync_receipt_id', owner_sync_id::TEXT, TRUE);
      UPDATE platform.student_cases sc SET responsible_sales_membership_id=owner_id
        WHERE sc.organization_id=p_organization_id AND sc.id=pending_case.id;
      PERFORM pg_catalog.set_config('platform.sales_handoff_owner_sync_receipt_id', '', TRUE);
      INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
        VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'case.sales.owner.sync','student_case',pending_case.id,
          jsonb_build_object('responsible_sales_membership_id',pending_case.responsible_sales_membership_id),
          jsonb_build_object('responsible_sales_membership_id',owner_id),
          'Sales owner synced to the lead''s current owner at sale recording',
          public.uuid_generate_v5(p_request_id,'sales-report:owner-sync'));
    END IF;
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id,pending_case.id,p_curator_membership_id,
      command_reason,public.uuid_generate_v5(p_request_id,'sales-report:assign'),actor.profile_id,actor.membership_id,actor.auth_user_id);
    -- The unchanged helper sees the NEW seller. Retire a different OLD seller's
    -- previous scope too; the existing NULL-owner QA path cannot prove this arm.
    IF pending_case.responsible_sales_membership_id IS NOT NULL
      AND pending_case.responsible_sales_membership_id IS DISTINCT FROM owner_id THEN
      PERFORM platform_private.append_scope_event(p_organization_id,
        pending_case.responsible_sales_membership_id, pending_case.current_scope_id,
        pending_case.current_scope_version, FALSE, 'user', actor.profile_id,
        'Previous Sales scope revoked after sale owner synchronization',
        public.uuid_generate_v5(p_request_id,'sales-report:old-owner-scope-revoke'));
      SELECT m.profile_id INTO old_seller_profile_id FROM platform.organization_memberships m
        WHERE m.organization_id=p_organization_id AND m.id=pending_case.responsible_sales_membership_id;
      -- Deduplicate by PROFILE, not membership: these are exactly the profiles
      -- already bumped by the helper for its pending -> active assignment.
      IF NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
        WHERE m.organization_id=p_organization_id AND m.profile_id=old_seller_profile_id
          AND m.id=ANY(array_remove(ARRAY[owner_id,pending_case.student_membership_id,p_curator_membership_id]::UUID[],NULL))) THEN
        PERFORM platform_private.bump_access_version(old_seller_profile_id);
      END IF;
    END IF;
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

-- CREATE OR REPLACE retains the existing function ACLs; no caller gains a new
-- function or table grant. The private receipt is never a public DTO.
COMMIT;
