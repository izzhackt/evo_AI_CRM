-- R1: staff directory projection, versioned lifecycle, and Auth send ledger.
-- Auth sends are external side effects. A claimed request is NEVER dispatched
-- again; reconciliation reads Auth evidence and completes membership separately.
BEGIN;

CREATE FUNCTION platform.staff_workspace_participants(p_organization_id UUID)
RETURNS TABLE(membership_id UUID, display_name TEXT, platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin','sales','curator')) THEN
    RAISE EXCEPTION 'staff_workspace_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT m.id, p.display_name, m."current_role"
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id AND b.role = m."current_role"
    WHERE m.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
      AND m."current_role" IN ('admin','sales','curator') AND b.status = 'published'
    ORDER BY lower(p.display_name), m.id;
END $$;

-- Serialize removal of Admin authority per organization, including callers of
-- the pre-existing 083 commands. Two Admins cannot concurrently remove both.
CREATE FUNCTION platform_private.staff_workspace_keep_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD."current_role" = 'admin' AND OLD.status = 'active'
    AND (NEW."current_role" <> 'admin' OR NEW.status <> 'active') THEN
    PERFORM 1 FROM platform.organizations WHERE id = OLD.organization_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = OLD.organization_id AND m.id <> OLD.id
        AND m."current_role" = 'admin' AND m.status = 'active' AND p.status = 'active') THEN
      RAISE EXCEPTION 'staff_workspace_last_admin' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_workspace_keep_admin BEFORE UPDATE OF "current_role", status
  ON platform.organization_memberships FOR EACH ROW
  EXECUTE FUNCTION platform_private.staff_workspace_keep_admin();

CREATE FUNCTION platform.staff_workspace_change_member(
  p_organization_id UUID, p_membership_id UUID, p_expected_version BIGINT,
  p_operation TEXT, p_value TEXT, p_reason TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_version BIGINT;
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');
  -- Use the same organization lock order as the last-Admin guard.
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR UPDATE;
  SELECT p.access_version INTO v_version FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id
      AND m."current_role" IN ('admin','sales','curator') FOR UPDATE OF m, p;
  IF v_version IS NULL OR p_expected_version IS NULL OR v_version <> p_expected_version THEN
    RAISE EXCEPTION 'staff_workspace_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_operation = 'role' AND p_value IN ('admin','sales','curator') THEN
    RETURN platform.change_pilot_staff_role(p_organization_id, p_membership_id,
      p_value::platform.business_role, p_reason, p_request_id);
  ELSIF p_operation = 'status' AND p_value IN ('active','suspended') THEN
    RETURN platform.change_pilot_staff_status(p_organization_id, p_membership_id,
      p_value::platform.membership_status, p_reason, p_request_id);
  END IF;
  RAISE EXCEPTION 'staff_workspace_invalid_change' USING ERRCODE = '22023';
END $$;

CREATE TABLE platform_private.staff_auth_requests (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  actor_membership_id UUID NOT NULL REFERENCES platform.organization_memberships(id),
  operation TEXT NOT NULL CHECK (operation IN ('invite','recovery')),
  normalized_email TEXT NOT NULL CHECK (normalized_email = lower(btrim(normalized_email))
    AND length(normalized_email) BETWEEN 3 AND 320 AND normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  requested_role platform.business_role NOT NULL CHECK (requested_role IN ('admin','sales','curator')),
  target_membership_id UUID REFERENCES platform.organization_memberships(id),
  auth_user_id UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'dispatching' CHECK (status IN ('dispatching','reconciliation_required','completed')),
  baseline_recovery_sent_at TIMESTAMPTZ,
  provider_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX staff_auth_requests_pending_email ON platform_private.staff_auth_requests
  (organization_id, normalized_email) WHERE status <> 'completed';
CREATE INDEX staff_auth_requests_org_created ON platform_private.staff_auth_requests
  (organization_id, created_at DESC);
ALTER TABLE platform_private.staff_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_auth_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.staff_auth_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION platform.staff_workspace_claim_auth(
  p_organization_id UUID, p_request_id UUID, p_operation TEXT,
  p_email TEXT DEFAULT NULL, p_display_name TEXT DEFAULT NULL,
  p_role platform.business_role DEFAULT NULL, p_membership_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; r platform_private.staff_auth_requests%ROWTYPE; v_email TEXT;
  v_name TEXT; v_role platform.business_role; v_auth UUID; v_baseline TIMESTAMPTZ;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');
  IF a.platform_role <> 'admin' OR a.organization_id <> p_organization_id OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'staff_workspace_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT,139));
  SELECT * INTO r FROM platform_private.staff_auth_requests WHERE id = p_request_id;
  IF FOUND THEN
    IF r.organization_id <> p_organization_id OR r.operation <> p_operation
      OR (p_operation = 'invite' AND (r.normalized_email <> lower(btrim(p_email))
        OR r.display_name <> btrim(p_display_name) OR r.requested_role <> p_role))
      OR (p_operation = 'recovery' AND r.target_membership_id IS DISTINCT FROM p_membership_id) THEN
      RAISE EXCEPTION 'staff_workspace_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id',r.id,'dispatch',false,'status',r.status);
  END IF;
  IF p_operation = 'invite' THEN
    v_email := lower(btrim(p_email)); v_name := btrim(p_display_name); v_role := p_role;
    IF p_membership_id IS NOT NULL OR v_email IS NULL OR v_name IS NULL OR v_role IS NULL
      OR v_role NOT IN ('admin','sales','curator') THEN
      RAISE EXCEPTION 'staff_workspace_invalid_invite' USING ERRCODE = '22023';
    END IF;
    -- Do not adopt an existing Student, staff or unrelated Auth account.
    IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
      RAISE EXCEPTION 'staff_workspace_email_exists' USING ERRCODE = '23505';
    END IF;
  ELSIF p_operation = 'recovery' THEN
    SELECT u.email, p.display_name, m."current_role", u.id, u.recovery_sent_at
      INTO v_email, v_name, v_role, v_auth, v_baseline
      FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      JOIN auth.users u ON u.id = p.auth_user_id
      WHERE m.organization_id = p_organization_id AND m.id = p_membership_id
        AND m.status = 'active' AND p.status = 'active' AND m."current_role" IN ('admin','sales','curator');
    IF v_auth IS NULL THEN
      RAISE EXCEPTION 'staff_workspace_recovery_target_unavailable' USING ERRCODE = '22023';
    END IF;
    v_email := lower(btrim(v_email));
  ELSE
    RAISE EXCEPTION 'staff_workspace_invalid_operation' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::TEXT || ':' || v_email,139));
  IF EXISTS (SELECT 1 FROM platform_private.staff_auth_requests
    WHERE organization_id = p_organization_id AND normalized_email = v_email
      AND (status <> 'completed' OR created_at > clock_timestamp() - interval '60 seconds')) THEN
    RAISE EXCEPTION 'staff_workspace_auth_pending' USING ERRCODE = '55000';
  END IF;
  INSERT INTO platform_private.staff_auth_requests(id,organization_id,actor_membership_id,operation,
    normalized_email,display_name,requested_role,target_membership_id,auth_user_id,baseline_recovery_sent_at)
    VALUES(p_request_id,p_organization_id,a.membership_id,p_operation,v_email,v_name,v_role,p_membership_id,v_auth,v_baseline);
  RETURN jsonb_build_object('id',p_request_id,'dispatch',true,'email',v_email,'status','dispatching');
END $$;

CREATE FUNCTION platform.staff_workspace_reconcile_auth(p_organization_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r platform_private.staff_auth_requests%ROWTYPE; u RECORD; v_result JSONB;
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');
  SELECT * INTO r FROM platform_private.staff_auth_requests
    WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_workspace_request_missing' USING ERRCODE = '22023'; END IF;
  IF r.status = 'completed' THEN RETURN jsonb_build_object('status','completed','operation',r.operation); END IF;
  IF r.operation = 'invite' THEN
    SELECT id, invited_at INTO u FROM auth.users
      WHERE lower(email) = r.normalized_email AND invited_at >= r.created_at
        AND raw_user_meta_data ->> 'evo_staff_invitation_request_id' = r.id::TEXT;
    IF FOUND AND NOT EXISTS (SELECT 1 FROM platform.profiles p
      JOIN platform.organization_memberships m ON m.profile_id = p.id WHERE p.auth_user_id = u.id) THEN
      -- This is an authenticated Admin RPC, never a service-key business write.
      v_result := platform.provision_pilot_staff_member(r.organization_id,u.id,r.display_name,
        r.requested_role,'Staff invitation',md5(r.id::TEXT || ':membership')::UUID);
      UPDATE platform_private.staff_auth_requests SET status = 'completed',auth_user_id = u.id,
        target_membership_id = (v_result ->> 'membership_id')::UUID,
        provider_observed_at = u.invited_at,completed_at = clock_timestamp() WHERE id = r.id;
      RETURN jsonb_build_object('status','completed','operation','invite');
    END IF;
  ELSE
    SELECT recovery_sent_at INTO u FROM auth.users WHERE id = r.auth_user_id
      AND lower(email) = r.normalized_email AND recovery_sent_at >= r.created_at
      AND recovery_sent_at > coalesce(r.baseline_recovery_sent_at,'-infinity'::TIMESTAMPTZ);
    IF FOUND THEN
      UPDATE platform_private.staff_auth_requests SET status = 'completed',provider_observed_at = u.recovery_sent_at,
        completed_at = clock_timestamp() WHERE id = r.id;
      RETURN jsonb_build_object('status','completed','operation','recovery');
    END IF;
  END IF;
  UPDATE platform_private.staff_auth_requests SET status = 'reconciliation_required' WHERE id = r.id;
  RETURN jsonb_build_object('status','reconciliation_required','operation',r.operation);
END $$;

CREATE FUNCTION platform.staff_workspace_auth_history(p_organization_id UUID)
RETURNS TABLE(request_id UUID,operation TEXT,display_name TEXT,status TEXT,created_at TIMESTAMPTZ,provider_observed_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');
  RETURN QUERY SELECT r.id,r.operation,r.display_name,r.status,r.created_at,r.provider_observed_at
    FROM platform_private.staff_auth_requests r WHERE r.organization_id = p_organization_id
    ORDER BY (r.status <> 'completed') DESC,r.created_at DESC,r.id DESC LIMIT 100;
END $$;

REVOKE ALL ON FUNCTION platform_private.staff_workspace_keep_admin() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.staff_workspace_participants(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.staff_workspace_change_member(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.staff_workspace_claim_auth(UUID,UUID,TEXT,TEXT,TEXT,platform.business_role,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.staff_workspace_reconcile_auth(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION platform.staff_workspace_auth_history(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_participants(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_change_member(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_claim_auth(UUID,UUID,TEXT,TEXT,TEXT,platform.business_role,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_reconcile_auth(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_auth_history(UUID) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
