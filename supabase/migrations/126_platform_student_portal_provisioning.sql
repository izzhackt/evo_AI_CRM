-- ============================================================
-- 126_platform_student_portal_provisioning.sql
--
-- E1: durable, receipt-authorized Student Portal provisioning.
-- Provider calls, callback handling, UI and read models remain outside this
-- migration.  All provider-facing state is private and all exposed mutation
-- entrypoints are role-specific, narrow SECURITY DEFINER functions.
-- ============================================================

BEGIN;

CREATE TABLE platform_private.student_portal_provisioning_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID NOT NULL UNIQUE,
  normalized_email TEXT NOT NULL UNIQUE CHECK (
    normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))
    AND pg_catalog.char_length(normalized_email) BETWEEN 3 AND 320
    AND normalized_email LIKE '%@%'
    AND normalized_email !~ '[[:space:][:cntrl:]]'
  ),
  student_display_name TEXT NOT NULL CHECK (
    student_display_name = pg_catalog.btrim(student_display_name)
    AND pg_catalog.char_length(student_display_name) BETWEEN 1 AND 200
    AND student_display_name !~ '[[:cntrl:]]'
  ),
  case_shape TEXT NOT NULL CHECK (case_shape IN ('normal_u6', 'legacy_pending')),
  legacy_curator_membership_id UUID,
  fingerprint_sha256 TEXT NOT NULL CHECK (
    fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  authorizing_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  authorizing_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  authorizing_membership_id UUID NOT NULL,
  authorizing_access_version BIGINT NOT NULL CHECK (authorizing_access_version > 0),
  authorizing_bundle_id UUID NOT NULL
    REFERENCES platform.role_bundle_versions(id) ON DELETE RESTRICT,
  authorizing_bundle_version BIGINT NOT NULL CHECK (authorizing_bundle_version > 0),
  required_permission_keys TEXT[] NOT NULL CHECK (
    required_permission_keys = ARRAY['membership.provision', 'scope.manage']::TEXT[]
    OR required_permission_keys = ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]
  ),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  reissue_authorized_by_auth_user_id UUID
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  reissue_authorized_by_profile_id UUID
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  reissue_authorized_by_membership_id UUID,
  reissue_authorized_access_version BIGINT,
  reissue_request_id UUID UNIQUE,
  reissue_authorized_at TIMESTAMPTZ,
  provisioning_state TEXT NOT NULL DEFAULT 'prepared' CHECK (
    provisioning_state IN (
      'prepared', 'dispatching', 'invite_succeeded', 'invite_failed',
      'invite_outcome_unknown', 'authority_activated'
    )
  ),
  invite_delivery_status TEXT CHECK (
    invite_delivery_status IS NULL
    OR invite_delivery_status IN (
      'issued', 'expired', 'reissue_dispatching', 'reissue_failed',
      'reissue_unknown', 'accepted'
    )
  ),
  receipt_version BIGINT NOT NULL DEFAULT 1 CHECK (receipt_version > 0),
  invite_generation BIGINT NOT NULL DEFAULT 0 CHECK (invite_generation >= 0),
  active_attempt_id UUID,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  student_profile_id UUID UNIQUE REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  student_membership_id UUID UNIQUE,
  invite_issued_at TIMESTAMPTZ,
  invite_expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL
    OR (
      safe_error_code = pg_catalog.lower(pg_catalog.btrim(safe_error_code))
      AND safe_error_code ~ '^[a-z][a-z0-9_.-]{0,99}$'
    )
  ),
  authority_activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_portal_receipts_org_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_receipts_authorizer_membership_fkey
    FOREIGN KEY (organization_id, authorizing_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_receipts_legacy_curator_fkey
    FOREIGN KEY (organization_id, legacy_curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_receipts_reissue_authorizer_fkey
    FOREIGN KEY (organization_id, reissue_authorized_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_receipts_student_membership_fkey
    FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_receipts_shape_check CHECK (
    (case_shape = 'normal_u6' AND legacy_curator_membership_id IS NULL)
    OR (case_shape = 'legacy_pending' AND legacy_curator_membership_id IS NOT NULL)
  ),
  CONSTRAINT student_portal_receipts_invite_window_check CHECK (
    (invite_issued_at IS NULL AND invite_expires_at IS NULL)
    OR (
      invite_issued_at IS NOT NULL
      AND invite_expires_at IS NOT NULL
      AND invite_expires_at > invite_issued_at
    )
  ),
  CONSTRAINT student_portal_receipts_identity_shape_check CHECK (
    (auth_user_id IS NULL AND student_profile_id IS NULL AND student_membership_id IS NULL)
    OR auth_user_id IS NOT NULL
  ),
  CONSTRAINT student_portal_receipts_activation_shape_check CHECK (
    (provisioning_state <> 'authority_activated'
      AND authority_activated_at IS NULL)
    OR (provisioning_state = 'authority_activated'
      AND authority_activated_at IS NOT NULL
      AND student_profile_id IS NOT NULL
      AND student_membership_id IS NOT NULL)
  ),
  CONSTRAINT student_portal_receipts_reissue_shape_check CHECK (
    (
      reissue_request_id IS NULL
      AND reissue_authorized_by_auth_user_id IS NULL
      AND reissue_authorized_by_profile_id IS NULL
      AND reissue_authorized_by_membership_id IS NULL
      AND reissue_authorized_access_version IS NULL
      AND reissue_authorized_at IS NULL
    )
    OR (
      reissue_request_id IS NOT NULL
      AND reissue_authorized_by_auth_user_id IS NOT NULL
      AND reissue_authorized_by_profile_id IS NOT NULL
      AND reissue_authorized_by_membership_id IS NOT NULL
      AND reissue_authorized_access_version IS NOT NULL
      AND reissue_authorized_at IS NOT NULL
    )
  )
);

CREATE TABLE platform_private.student_portal_invite_attempts (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL
    REFERENCES platform_private.student_portal_provisioning_receipts(id)
    ON DELETE RESTRICT,
  attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('initial', 'reissue')),
  reissue_request_id UUID,
  claimed_receipt_version BIGINT NOT NULL CHECK (claimed_receipt_version > 0),
  invite_generation BIGINT NOT NULL CHECK (invite_generation > 0),
  attempt_state TEXT NOT NULL DEFAULT 'dispatching' CHECK (
    attempt_state IN ('dispatching', 'succeeded', 'failed', 'unknown')
  ),
  pre_confirmation_sent_at TIMESTAMPTZ,
  observed_confirmation_sent_at TIMESTAMPTZ,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL
    OR (
      safe_error_code = pg_catalog.lower(pg_catalog.btrim(safe_error_code))
      AND safe_error_code ~ '^[a-z][a-z0-9_.-]{0,99}$'
    )
  ),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  recorded_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  CONSTRAINT student_portal_attempts_receipt_id_key UNIQUE (receipt_id, id),
  CONSTRAINT student_portal_attempts_generation_key UNIQUE (
    receipt_id, invite_generation
  ),
  CONSTRAINT student_portal_attempts_kind_shape_check CHECK (
    (attempt_kind = 'initial' AND reissue_request_id IS NULL)
    OR (attempt_kind = 'reissue' AND reissue_request_id IS NOT NULL)
  ),
  CONSTRAINT student_portal_attempts_terminal_shape_check CHECK (
    (attempt_state = 'dispatching' AND recorded_at IS NULL)
    OR (attempt_state <> 'dispatching' AND recorded_at IS NOT NULL)
  )
);

ALTER TABLE platform_private.student_portal_provisioning_receipts
  ADD CONSTRAINT student_portal_receipts_active_attempt_fkey
  FOREIGN KEY (id, active_attempt_id)
  REFERENCES platform_private.student_portal_invite_attempts(receipt_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform_private.student_portal_provisioning_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_provisioning_receipts
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_invite_attempts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_invite_attempts
  FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE platform_private.student_portal_provisioning_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON TABLE platform_private.student_portal_invite_attempts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.student_portal_child_request_id(
  p_request_id UUID,
  p_suffix TEXT
)
RETURNS UUID
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.uuid_generate_v5(p_request_id, p_suffix)
$$;

CREATE FUNCTION platform_private.lock_student_portal_request_tree(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  child_request_id UUID;
  suffix TEXT;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);
  FOREACH suffix IN ARRAY ARRAY[
    '01-membership-provision',
    '02-organization-scope',
    '03-student-case-scope',
    '04-legacy-curator',
    '05-student-portal-audit'
  ]
  LOOP
    child_request_id := platform_private.student_portal_child_request_id(
      p_request_id,
      suffix
    );
    PERFORM platform_private.lock_p2d_request(child_request_id);
  END LOOP;
END
$$;

CREATE FUNCTION platform_private.student_portal_fingerprint(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_normalized_email TEXT,
  p_student_display_name TEXT,
  p_case_shape TEXT,
  p_legacy_curator_membership_id UUID
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          E'\x1f',
          p_organization_id::TEXT,
          p_student_case_id::TEXT,
          p_normalized_email,
          p_student_display_name,
          p_case_shape,
          COALESCE(p_legacy_curator_membership_id::TEXT, '')
        ),
        'UTF8'
      )
    ),
    'hex'
  )
$$;

CREATE FUNCTION platform_private.student_portal_safe_snapshot(
  p_receipt_id UUID,
  p_include_dispatch_email BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'receipt_id', receipt.id,
    'request_id', receipt.request_id,
    'student_case_id', receipt.student_case_id,
    'case_shape', receipt.case_shape,
    'provisioning_state', receipt.provisioning_state,
    'invite_delivery_status', receipt.invite_delivery_status,
    'receipt_version', receipt.receipt_version,
    'invite_generation', receipt.invite_generation,
    'active_attempt_id', receipt.active_attempt_id,
    'reissue_request_id', receipt.reissue_request_id,
    'auth_user_id', receipt.auth_user_id,
    'student_profile_id', receipt.student_profile_id,
    'student_membership_id', receipt.student_membership_id,
    'invite_issued_at', receipt.invite_issued_at,
    'invite_expires_at', receipt.invite_expires_at,
    'accepted_at', receipt.accepted_at,
    'authority_activated_at', receipt.authority_activated_at,
    'safe_error_code', receipt.safe_error_code,
    'authority_activated', receipt.provisioning_state = 'authority_activated',
    'provider_dispatch_allowed', receipt.active_attempt_id IS NOT NULL,
    'normalized_email', CASE
      WHEN p_include_dispatch_email THEN receipt.normalized_email
      ELSE NULL
    END
  ))
  FROM platform_private.student_portal_provisioning_receipts AS receipt
  WHERE receipt.id = p_receipt_id
$$;

REVOKE ALL ON FUNCTION
  platform_private.student_portal_child_request_id(UUID, TEXT),
  platform_private.lock_student_portal_request_tree(UUID),
  platform_private.student_portal_fingerprint(UUID, UUID, TEXT, TEXT, TEXT, UUID),
  platform_private.student_portal_safe_snapshot(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Migration 042 made student_membership_id fully immutable.  E1 keeps every
-- other identity column immutable and permits only the receipt-authorized,
-- same-organization active Student NULL -> UUID bind.
DROP TRIGGER student_cases_identity_immutable ON platform.student_cases;

CREATE FUNCTION platform_private.guard_student_case_identity_e1()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bind_receipt_id UUID;
BEGIN
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

CREATE TRIGGER student_cases_identity_immutable
  BEFORE UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_identity_e1();

REVOKE ALL ON FUNCTION platform_private.guard_student_case_identity_e1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Keep the bounded Admin audit projection aware of the one E1 outcome action.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_portal_e1;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY(
    SELECT DISTINCT action_name
    FROM unnest(
      platform_private.p7a_safe_audit_actions_pre_student_portal_e1()
      || ARRAY['student.portal.authority.activate']::TEXT[]
    ) AS action_name
    ORDER BY action_name
  )
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_portal_e1(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Shared authorized mutation bodies.  Existing authenticated coordinators do
-- live Admin checks before invoking them; the E1 finalizer supplies only a
-- locked, receipt-bound Admin actor that has just been revalidated.
CREATE FUNCTION platform_private.provision_member_authorized_e1(
  p_organization_id UUID,
  p_member_auth_user_id UUID,
  p_member_display_name TEXT,
  p_role platform.business_role,
  p_reason TEXT,
  p_request_id UUID,
  p_actor_profile_id UUID,
  p_actor_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  member_profile_id UUID;
  member_membership_id UUID;
  member_bundle_id UUID;
  member_scope_id UUID;
  member_scope_version BIGINT;
  member_access_version BIGINT;
  profile_existed BOOLEAN := FALSE;
  scope_assigned BOOLEAN := FALSE;
  result JSONB;
BEGIN
  result := platform_private.replay_audit(
    p_request_id,
    'membership.provision',
    'organization_membership',
    NULL,
    pg_catalog.btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'member_auth_user_id', p_member_auth_user_id,
      'display_name', pg_catalog.btrim(p_member_display_name),
      'role', p_role::TEXT
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active organization % does not exist', p_organization_id
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = p_member_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Auth user % does not exist', p_member_auth_user_id
      USING ERRCODE = '23503';
  END IF;

  SELECT profile.id, profile.access_version, TRUE
  INTO member_profile_id, member_access_version, profile_existed
  FROM platform.profiles AS profile
  WHERE profile.auth_user_id = p_member_auth_user_id
  FOR UPDATE;

  IF profile_existed THEN
    IF NOT EXISTS (
      SELECT 1 FROM platform.profiles AS profile
      WHERE profile.id = member_profile_id
        AND profile.status = 'active'
        AND profile.display_name = pg_catalog.btrim(p_member_display_name)
    ) THEN
      RAISE EXCEPTION
        'Existing Platform profile is blocked or has a different display name'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO platform.profiles (auth_user_id, display_name)
    VALUES (p_member_auth_user_id, pg_catalog.btrim(p_member_display_name))
    RETURNING id, access_version
    INTO member_profile_id, member_access_version;
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = member_profile_id
  ) THEN
    RAISE EXCEPTION
      'A membership for this profile and organization already exists'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform.organization_memberships AS membership
    WHERE membership.profile_id = member_profile_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION
      'This profile already has an active organization membership'
      USING ERRCODE = '23505';
  END IF;

  member_bundle_id := platform_private.published_bundle_for_role(p_role);
  INSERT INTO platform.organization_memberships (
    organization_id, profile_id, status, "current_role", current_bundle_id
  )
  VALUES (
    p_organization_id, member_profile_id, 'active', p_role, member_bundle_id
  )
  RETURNING id INTO member_membership_id;

  IF profile_existed THEN
    member_access_version :=
      platform_private.bump_access_version(member_profile_id);
  END IF;

  INSERT INTO platform.membership_role_history (
    organization_id, membership_id, profile_id, role_version,
    previous_role, new_role, previous_bundle_id, new_bundle_id,
    actor_kind, actor_profile_id, reason, request_id
  )
  VALUES (
    p_organization_id, member_membership_id, member_profile_id, 1,
    NULL, p_role, NULL, member_bundle_id,
    'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
  );

  IF p_role = 'admin' THEN
    SELECT scope.id, scope.scope_version
    INTO member_scope_id, member_scope_version
    FROM platform.record_scopes AS scope
    WHERE scope.organization_id = p_organization_id
      AND scope.scope_kind = 'organization'
      AND scope.scope_key = p_organization_id
      AND scope.is_active
    ORDER BY scope.scope_version DESC
    LIMIT 1;
    IF member_scope_id IS NULL THEN
      RAISE EXCEPTION 'Organization scope is missing for %', p_organization_id
        USING ERRCODE = '55000';
    END IF;
    PERFORM platform_private.append_scope_event(
      p_organization_id, member_membership_id,
      member_scope_id, member_scope_version, TRUE,
      'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
    );
    scope_assigned := TRUE;
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'profile_id', member_profile_id,
    'member_auth_user_id', p_member_auth_user_id,
    'display_name', pg_catalog.btrim(p_member_display_name),
    'membership_id', member_membership_id,
    'role', p_role::TEXT,
    'status', 'active',
    'bundle_id', member_bundle_id,
    'organization_scope_assigned', scope_assigned,
    'access_version', member_access_version
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  )
  VALUES (
    p_organization_id, 'user', p_actor_profile_id,
    'auth:' || p_actor_auth_user_id::TEXT,
    'membership.provision', 'organization_membership', member_membership_id,
    NULL, result, pg_catalog.btrim(p_reason), p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.provision_member(
  p_organization_id UUID,
  p_member_auth_user_id UUID,
  p_member_display_name TEXT,
  p_role platform.business_role,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_organization_id IS NULL OR p_member_auth_user_id IS NULL
    OR p_role IS NULL OR p_request_id IS NULL
    OR pg_catalog.btrim(COALESCE(p_member_display_name, '')) = ''
    OR pg_catalog.btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, member identity, role, display name, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM platform_private.require_admin_actor(
    p_organization_id, 'membership.provision'
  );
  PERFORM platform_private.lock_student_case_note_assignment_domain(
    p_organization_id
  );
  PERFORM platform_private.lock_p2d_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admin_actor(
    p_organization_id, 'membership.provision'
  );
  RETURN platform_private.provision_member_authorized_e1(
    p_organization_id, p_member_auth_user_id, p_member_display_name,
    p_role, p_reason, p_request_id,
    actor.actor_profile_id, actor.actor_auth_user_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.provision_member_authorized_e1(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.provision_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.provision_pilot_staff_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.provision_pilot_staff_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) TO authenticated;

CREATE FUNCTION platform_private.assign_organization_scope_authorized_e1(
  p_organization_id UUID,
  p_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID,
  p_actor_profile_id UUID,
  p_actor_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_profile_id UUID;
  target_role platform.business_role;
  target_status platform.membership_status;
  organization_scope_id UUID;
  organization_scope_version BIGINT;
  latest_scope_granted BOOLEAN;
  latest_assignment_version BIGINT;
  next_assignment_version BIGINT;
  next_access_version BIGINT;
  before_state JSONB;
  result JSONB;
BEGIN
  result := platform_private.replay_audit(
    p_request_id,
    'membership.scope.organization.assign',
    'organization_membership', p_membership_id,
    pg_catalog.btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'membership_id', p_membership_id,
      'organization_scope_granted', TRUE
    )
  );
  IF result IS NOT NULL THEN RETURN result; END IF;

  SELECT membership.profile_id, membership."current_role", membership.status
  INTO target_profile_id, target_role, target_status
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership % does not exist in organization %',
      p_membership_id, p_organization_id USING ERRCODE = 'P0002';
  END IF;

  SELECT scope.id, scope.scope_version
  INTO organization_scope_id, organization_scope_version
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = p_organization_id
    AND scope.scope_kind = 'organization'
    AND scope.scope_key = p_organization_id
    AND scope.is_active
  ORDER BY scope.scope_version DESC LIMIT 1
  FOR UPDATE;
  IF organization_scope_id IS NULL THEN
    RAISE EXCEPTION 'Organization scope is missing for %', p_organization_id
      USING ERRCODE = '55000';
  END IF;

  SELECT assignment.granted, assignment.assignment_version
  INTO latest_scope_granted, latest_assignment_version
  FROM platform.membership_scope_assignments AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.membership_id = p_membership_id
    AND assignment.scope_id = organization_scope_id
  ORDER BY assignment.assignment_version DESC LIMIT 1;
  IF COALESCE(latest_scope_granted, FALSE) THEN
    RAISE EXCEPTION 'Membership % already has organization scope', p_membership_id
      USING ERRCODE = '22023';
  END IF;

  before_state := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'status', target_status::TEXT,
    'organization_scope_granted', COALESCE(latest_scope_granted, FALSE),
    'assignment_version', latest_assignment_version
  );
  next_assignment_version := platform_private.append_scope_event(
    p_organization_id, p_membership_id,
    organization_scope_id, organization_scope_version, TRUE,
    'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
  );
  next_access_version := platform_private.bump_access_version(target_profile_id);
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'status', target_status::TEXT,
    'scope_id', organization_scope_id,
    'scope_version', organization_scope_version,
    'organization_scope_granted', TRUE,
    'assignment_version', next_assignment_version,
    'access_version', next_access_version
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', p_actor_profile_id,
    'auth:' || p_actor_auth_user_id::TEXT,
    'membership.scope.organization.assign', 'organization_membership',
    p_membership_id, before_state, result,
    pg_catalog.btrim(p_reason), p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.assign_organization_scope(
  p_organization_id UUID,
  p_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_organization_id IS NULL OR p_membership_id IS NULL
    OR p_request_id IS NULL
    OR pg_catalog.btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM platform_private.require_admin_actor(
    p_organization_id, 'scope.manage'
  );
  PERFORM platform_private.lock_student_case_note_assignment_domain(
    p_organization_id
  );
  PERFORM platform_private.lock_p2d_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admin_actor(
    p_organization_id, 'scope.manage'
  );
  RETURN platform_private.assign_organization_scope_authorized_e1(
    p_organization_id, p_membership_id, p_reason, p_request_id,
    actor.actor_profile_id, actor.actor_auth_user_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.assign_organization_scope_authorized_e1(
  UUID, UUID, TEXT, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.assign_organization_scope(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assign_organization_scope(
  UUID, UUID, TEXT, UUID
) TO authenticated;

CREATE FUNCTION platform.prepare_student_portal_provisioning(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_email TEXT,
  p_student_display_name TEXT,
  p_case_shape TEXT,
  p_legacy_curator_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_normalized_display_name TEXT := pg_catalog.btrim(p_student_display_name);
  v_fingerprint_sha256 TEXT;
  required_permissions TEXT[];
  permission_key TEXT;
  actor RECORD;
  actor_bundle_id UUID;
  actor_bundle_version BIGINT;
  actor_access_version BIGINT;
  target_case platform.student_cases%ROWTYPE;
  existing_receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  receipt_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_request_id IS NULL
    OR v_normalized_email IS NULL
    OR pg_catalog.char_length(v_normalized_email) NOT BETWEEN 3 AND 320
    OR v_normalized_email NOT LIKE '%@%'
    OR v_normalized_email ~ '[[:space:][:cntrl:]]'
    OR v_normalized_display_name IS NULL
    OR pg_catalog.char_length(v_normalized_display_name) NOT BETWEEN 1 AND 200
    OR v_normalized_display_name ~ '[[:cntrl:]]'
    OR p_case_shape NOT IN ('normal_u6', 'legacy_pending')
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
      NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid student portal provisioning input'
      USING ERRCODE = '22023';
  END IF;
  IF (p_case_shape = 'normal_u6' AND p_legacy_curator_membership_id IS NOT NULL)
    OR (p_case_shape = 'legacy_pending' AND p_legacy_curator_membership_id IS NULL)
  THEN
    RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
  END IF;

  required_permissions := CASE p_case_shape
    WHEN 'legacy_pending' THEN ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]
    ELSE ARRAY['membership.provision', 'scope.manage']::TEXT[]
  END;

  -- Read-only caller preflight before accepting any caller-selected lock key.
  FOREACH permission_key IN ARRAY required_permissions LOOP
    PERFORM 1 FROM platform_private.require_admin_actor(
      p_organization_id, permission_key
    );
  END LOOP;

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    p_organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(p_request_id);

  -- Repeat live authority after the canonical locks.
  FOREACH permission_key IN ARRAY required_permissions LOOP
    SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, permission_key);
  END LOOP;

  SELECT profile.access_version, membership.current_bundle_id, bundle.version
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
  FOR UPDATE OF profile, membership, bundle;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;

  v_fingerprint_sha256 := platform_private.student_portal_fingerprint(
    p_organization_id, p_student_case_id, v_normalized_email,
    v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id
  );

  SELECT * INTO existing_receipt
  FROM platform_private.student_portal_provisioning_receipts AS receipt
  WHERE receipt.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF existing_receipt.fingerprint_sha256 <> v_fingerprint_sha256 THEN
      RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN platform_private.student_portal_safe_snapshot(existing_receipt.id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF target_case.student_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;

  IF p_case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
    PERFORM 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_legacy_curator_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'curator'
      AND profile.status = 'active'
      AND bundle.status = 'published'
    FOR UPDATE OF membership, profile, bundle;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = p_student_case_id
  ) THEN
    RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.normalized_email = v_normalized_email
  ) THEN
    RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
  END IF;

  BEGIN
    INSERT INTO platform_private.student_portal_provisioning_receipts (
      request_id, organization_id, student_case_id, normalized_email,
      student_display_name, case_shape, legacy_curator_membership_id,
      fingerprint_sha256, authorizing_auth_user_id, authorizing_profile_id,
      authorizing_membership_id, authorizing_access_version,
      authorizing_bundle_id, authorizing_bundle_version,
      required_permission_keys
    ) VALUES (
      p_request_id, p_organization_id, p_student_case_id, v_normalized_email,
      v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id,
      v_fingerprint_sha256, actor.actor_auth_user_id, actor.actor_profile_id,
      actor.actor_membership_id, actor_access_version,
      actor_bundle_id, actor_bundle_version, required_permissions
    ) RETURNING id INTO receipt_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.normalized_email = v_normalized_email
    ) THEN
      RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.student_case_id = p_student_case_id
    ) THEN
      RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
    END IF;
    RAISE;
  END;

  RETURN platform_private.student_portal_safe_snapshot(receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.prepare_student_portal_provisioning(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.prepare_student_portal_provisioning(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID
) TO authenticated;

CREATE FUNCTION platform.claim_student_portal_invite(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  prior_attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  pre_auth_user_id UUID;
  pre_confirmation_sent_at TIMESTAMPTZ;
BEGIN
  IF p_receipt_id IS NULL OR p_attempt_id IS NULL
    OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
  THEN
    RAISE EXCEPTION 'invalid student portal invite claim'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO prior_attempt
  FROM platform_private.student_portal_invite_attempts AS attempt
  WHERE attempt.id = p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF prior_attempt.receipt_id <> p_receipt_id
      OR prior_attempt.attempt_kind <> 'initial'
      OR prior_attempt.attempt_state <> 'dispatching'
      OR receipt.active_attempt_id IS DISTINCT FROM prior_attempt.id
      OR receipt.provisioning_state <> 'dispatching'
      OR receipt.invite_generation <> prior_attempt.invite_generation
    THEN
      RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001';
    END IF;
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, TRUE)
      || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.active_attempt_id IS NOT NULL
    OR receipt.provisioning_state NOT IN ('prepared', 'invite_failed')
    OR receipt.invite_delivery_status IS NOT NULL
  THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;

  SELECT auth_user.id, auth_user.confirmation_sent_at
  INTO pre_auth_user_id, pre_confirmation_sent_at
  FROM auth.users AS auth_user
  WHERE pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = receipt.normalized_email
  ORDER BY auth_user.id LIMIT 1 FOR UPDATE;
  IF pre_auth_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = pre_auth_user_id
      AND COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;

  INSERT INTO platform_private.student_portal_invite_attempts (
    id, receipt_id, attempt_kind, claimed_receipt_version,
    invite_generation, pre_confirmation_sent_at, auth_user_id
  ) VALUES (
    p_attempt_id, p_receipt_id, 'initial', receipt.receipt_version + 1,
    receipt.invite_generation + 1, pre_confirmation_sent_at, pre_auth_user_id
  );
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = 'dispatching',
      active_attempt_id = p_attempt_id,
      receipt_version = target.receipt_version + 1,
      invite_generation = target.invite_generation + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, TRUE)
    || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.claim_student_portal_invite(
  UUID, UUID, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.claim_student_portal_invite(
  UUID, UUID, BIGINT, BIGINT
) TO service_role;

CREATE FUNCTION platform.authorize_student_portal_invite_reissue(
  p_receipt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_reissue_request_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt_hint RECORD;
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  permission_key TEXT;
  actor RECORD;
  actor_access_version BIGINT;
  auth_row RECORD;
BEGIN
  IF p_receipt_id IS NULL OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL OR p_reissue_request_id IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
      NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid student portal reissue authorization'
      USING ERRCODE = '22023';
  END IF;
  SELECT candidate.organization_id, candidate.request_id,
         candidate.required_permission_keys
  INTO receipt_hint
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  FOREACH permission_key IN ARRAY receipt_hint.required_permission_keys LOOP
    PERFORM 1 FROM platform_private.require_admin_actor(
      receipt_hint.organization_id, permission_key
    );
  END LOOP;
  PERFORM platform_private.lock_student_case_note_assignment_domain(
    receipt_hint.organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(receipt_hint.request_id);

  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_invite_attempts AS attempt
    WHERE attempt.reissue_request_id = p_reissue_request_id
  ) OR receipt.reissue_request_id = p_reissue_request_id THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status = 'accepted' THEN
    RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status <> 'issued'
    OR receipt.auth_user_id IS NULL
    OR receipt.invite_expires_at IS NULL
    OR statement_timestamp() < receipt.invite_expires_at
  THEN
    RAISE EXCEPTION 'portal_invite_not_expired' USING ERRCODE = '40001';
  END IF;

  FOREACH permission_key IN ARRAY receipt.required_permission_keys LOOP
    SELECT * INTO actor FROM platform_private.require_admin_actor(
      receipt.organization_id, permission_key
    );
  END LOOP;
  SELECT profile.access_version
  INTO actor_access_version
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id
    AND profile.auth_user_id = actor.actor_auth_user_id
    AND profile.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;

  SELECT auth_user.id, pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF auth_row.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';
  END IF;

  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET invite_delivery_status = 'expired',
      reissue_request_id = p_reissue_request_id,
      reissue_authorized_by_auth_user_id = actor.actor_auth_user_id,
      reissue_authorized_by_profile_id = actor.actor_profile_id,
      reissue_authorized_by_membership_id = actor.actor_membership_id,
      reissue_authorized_access_version = actor_access_version,
      reissue_authorized_at = statement_timestamp(),
      receipt_version = target.receipt_version + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.authorize_student_portal_invite_reissue(
  UUID, BIGINT, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.authorize_student_portal_invite_reissue(
  UUID, BIGINT, BIGINT, UUID, TEXT
) TO authenticated;

CREATE FUNCTION platform.claim_student_portal_invite_reissue(
  p_receipt_id UUID,
  p_reissue_request_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  prior_attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  auth_row RECORD;
BEGIN
  IF p_receipt_id IS NULL OR p_reissue_request_id IS NULL OR p_attempt_id IS NULL
    OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
  THEN
    RAISE EXCEPTION 'invalid student portal reissue claim'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO prior_attempt
  FROM platform_private.student_portal_invite_attempts AS attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;
  IF FOUND THEN
    IF prior_attempt.receipt_id <> p_receipt_id
      OR prior_attempt.attempt_kind <> 'reissue'
      OR prior_attempt.reissue_request_id <> p_reissue_request_id
      OR prior_attempt.attempt_state <> 'dispatching'
      OR receipt.active_attempt_id IS DISTINCT FROM prior_attempt.id
      OR receipt.invite_delivery_status <> 'reissue_dispatching'
      OR receipt.invite_generation <> prior_attempt.invite_generation
    THEN
      RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001';
    END IF;
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, TRUE)
      || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.active_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'invite_reissue_in_progress' USING ERRCODE = '40001';
  END IF;
  IF receipt.reissue_request_id <> p_reissue_request_id
    OR receipt.invite_delivery_status NOT IN ('expired', 'reissue_failed')
    OR receipt.auth_user_id IS NULL
  THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;

  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         auth_user.confirmation_sent_at,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF auth_row.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';
  END IF;

  INSERT INTO platform_private.student_portal_invite_attempts (
    id, receipt_id, attempt_kind, reissue_request_id,
    claimed_receipt_version, invite_generation,
    pre_confirmation_sent_at, auth_user_id
  ) VALUES (
    p_attempt_id, p_receipt_id, 'reissue', p_reissue_request_id,
    receipt.receipt_version + 1, receipt.invite_generation + 1,
    auth_row.confirmation_sent_at, receipt.auth_user_id
  );
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET invite_delivery_status = 'reissue_dispatching',
      active_attempt_id = p_attempt_id,
      receipt_version = target.receipt_version + 1,
      invite_generation = target.invite_generation + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, TRUE)
    || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.claim_student_portal_invite_reissue(
  UUID, UUID, UUID, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.claim_student_portal_invite_reissue(
  UUID, UUID, UUID, BIGINT, BIGINT
) TO service_role;

CREATE FUNCTION platform.record_student_portal_invite_success(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_auth_user_id UUID,
  p_email_otp_expires_in_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  auth_row RECORD;
  next_delivery_status TEXT;
  next_provisioning_state TEXT;
BEGIN
  IF p_receipt_id IS NULL OR p_attempt_id IS NULL OR p_auth_user_id IS NULL
    OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
    OR p_email_otp_expires_in_seconds NOT BETWEEN 60 AND 604800
  THEN
    RAISE EXCEPTION 'invalid student portal invite success'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO attempt
  FROM platform_private.student_portal_invite_attempts AS candidate
  WHERE candidate.receipt_id = p_receipt_id AND candidate.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR receipt.active_attempt_id IS DISTINCT FROM p_attempt_id
    OR attempt.attempt_state <> 'dispatching'
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation
    OR attempt.invite_generation <> p_expected_invite_generation
  THEN RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001'; END IF;
  IF (attempt.attempt_kind = 'initial' AND receipt.provisioning_state <> 'dispatching')
    OR (attempt.attempt_kind = 'reissue'
      AND receipt.invite_delivery_status <> 'reissue_dispatching')
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;

  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         auth_user.confirmation_sent_at,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = p_auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email
    OR auth_row.confirmation_sent_at IS NULL
    OR (attempt.auth_user_id IS NOT NULL AND attempt.auth_user_id <> p_auth_user_id)
    OR (receipt.auth_user_id IS NOT NULL AND receipt.auth_user_id <> p_auth_user_id)
    OR (attempt.pre_confirmation_sent_at IS NOT NULL
      AND auth_row.confirmation_sent_at <= attempt.pre_confirmation_sent_at)
  THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;

  next_delivery_status := CASE
    WHEN auth_row.confirmed_at IS NULL THEN 'issued' ELSE 'accepted'
  END;
  next_provisioning_state := CASE
    WHEN attempt.attempt_kind = 'initial' THEN 'invite_succeeded'
    ELSE receipt.provisioning_state
  END;

  UPDATE platform_private.student_portal_invite_attempts AS target
  SET attempt_state = 'succeeded',
      observed_confirmation_sent_at = auth_row.confirmation_sent_at,
      auth_user_id = p_auth_user_id,
      safe_error_code = NULL,
      recorded_at = statement_timestamp()
  WHERE target.id = p_attempt_id;
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = next_provisioning_state,
      invite_delivery_status = next_delivery_status,
      active_attempt_id = NULL,
      auth_user_id = p_auth_user_id,
      invite_issued_at = auth_row.confirmation_sent_at,
      invite_expires_at = auth_row.confirmation_sent_at
        + pg_catalog.make_interval(secs => p_email_otp_expires_in_seconds),
      accepted_at = CASE
        WHEN auth_row.confirmed_at IS NULL THEN target.accepted_at
        ELSE COALESCE(target.accepted_at, auth_row.confirmed_at)
      END,
      safe_error_code = NULL,
      receipt_version = target.receipt_version + 1,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', FALSE);
END
$$;

CREATE FUNCTION platform_private.record_student_portal_invite_terminal_e1(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_outcome TEXT,
  p_safe_error_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  fixed_error_code TEXT := pg_catalog.lower(pg_catalog.btrim(p_safe_error_code));
BEGIN
  IF p_outcome NOT IN ('failed', 'unknown')
    OR fixed_error_code IS NULL
    OR fixed_error_code !~ '^[a-z][a-z0-9_.-]{0,99}$'
  THEN RAISE EXCEPTION 'invalid student portal invite outcome' USING ERRCODE = '22023'; END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO attempt
  FROM platform_private.student_portal_invite_attempts AS candidate
  WHERE candidate.receipt_id = p_receipt_id AND candidate.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR receipt.active_attempt_id IS DISTINCT FROM p_attempt_id
    OR attempt.attempt_state <> 'dispatching'
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation
    OR attempt.invite_generation <> p_expected_invite_generation
  THEN RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001'; END IF;
  IF (attempt.attempt_kind = 'initial' AND receipt.provisioning_state <> 'dispatching')
    OR (attempt.attempt_kind = 'reissue'
      AND receipt.invite_delivery_status <> 'reissue_dispatching')
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;

  UPDATE platform_private.student_portal_invite_attempts AS target
  SET attempt_state = p_outcome,
      safe_error_code = fixed_error_code,
      recorded_at = statement_timestamp()
  WHERE target.id = p_attempt_id;
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = CASE
        WHEN attempt.attempt_kind = 'initial' AND p_outcome = 'failed'
          THEN 'invite_failed'
        WHEN attempt.attempt_kind = 'initial' THEN 'invite_outcome_unknown'
        ELSE target.provisioning_state
      END,
      invite_delivery_status = CASE
        WHEN attempt.attempt_kind = 'initial' THEN NULL
        WHEN p_outcome = 'failed' THEN 'reissue_failed'
        ELSE 'reissue_unknown'
      END,
      active_attempt_id = NULL,
      safe_error_code = fixed_error_code,
      receipt_version = target.receipt_version + 1,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('attempt_id', p_attempt_id, 'replayed', FALSE);
END
$$;

CREATE FUNCTION platform.record_student_portal_invite_failure(
  p_receipt_id UUID, p_attempt_id UUID,
  p_expected_receipt_version BIGINT, p_expected_invite_generation BIGINT,
  p_safe_error_code TEXT
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.record_student_portal_invite_terminal_e1(
    p_receipt_id, p_attempt_id, p_expected_receipt_version,
    p_expected_invite_generation, 'failed', p_safe_error_code
  )
$$;

CREATE FUNCTION platform.record_student_portal_invite_unknown(
  p_receipt_id UUID, p_attempt_id UUID,
  p_expected_receipt_version BIGINT, p_expected_invite_generation BIGINT,
  p_safe_error_code TEXT
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.record_student_portal_invite_terminal_e1(
    p_receipt_id, p_attempt_id, p_expected_receipt_version,
    p_expected_invite_generation, 'unknown', p_safe_error_code
  )
$$;

REVOKE ALL ON FUNCTION platform_private.record_student_portal_invite_terminal_e1(
  UUID, UUID, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.record_student_portal_invite_success(
  UUID, UUID, BIGINT, BIGINT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.record_student_portal_invite_failure(
  UUID, UUID, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.record_student_portal_invite_unknown(
  UUID, UUID, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_student_portal_invite_success(
  UUID, UUID, BIGINT, BIGINT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.record_student_portal_invite_failure(
  UUID, UUID, BIGINT, BIGINT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.record_student_portal_invite_unknown(
  UUID, UUID, BIGINT, BIGINT, TEXT
) TO service_role;

CREATE FUNCTION platform.reconcile_student_portal_invite(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_auth_user_id UUID,
  p_email_otp_expires_in_seconds INTEGER,
  p_provider_no_issuance_proven BOOLEAN,
  p_provider_operation_upper_bound_at TIMESTAMPTZ,
  p_safe_error_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  auth_row RECORD;
  matching_email_count INTEGER;
  fixed_error_code TEXT := pg_catalog.lower(pg_catalog.btrim(p_safe_error_code));
  issuance_observed BOOLEAN := FALSE;
BEGIN
  IF p_receipt_id IS NULL OR p_attempt_id IS NULL
    OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
    OR p_provider_no_issuance_proven IS NULL
  THEN RAISE EXCEPTION 'invalid student portal reconciliation' USING ERRCODE = '22023'; END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO attempt
  FROM platform_private.student_portal_invite_attempts AS candidate
  WHERE candidate.receipt_id = p_receipt_id AND candidate.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR attempt.attempt_state <> 'unknown'
    OR receipt.active_attempt_id IS NOT NULL
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation
    OR attempt.invite_generation <> p_expected_invite_generation
  THEN RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001'; END IF;
  IF (attempt.attempt_kind = 'initial'
      AND receipt.provisioning_state <> 'invite_outcome_unknown')
    OR (attempt.attempt_kind = 'reissue'
      AND receipt.invite_delivery_status <> 'reissue_unknown')
  THEN RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001'; END IF;

  SELECT pg_catalog.count(*) INTO matching_email_count
  FROM auth.users AS auth_user
  WHERE pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = receipt.normalized_email;
  IF matching_email_count > 1 THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_auth_user_id IS NOT NULL THEN
    SELECT auth_user.id,
           pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
           auth_user.confirmation_sent_at,
           COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
    INTO auth_row
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_auth_user_id
    FOR UPDATE;
    IF NOT FOUND OR auth_row.email <> receipt.normalized_email
      OR (attempt.auth_user_id IS NOT NULL AND attempt.auth_user_id <> p_auth_user_id)
      OR (receipt.auth_user_id IS NOT NULL AND receipt.auth_user_id <> p_auth_user_id)
    THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;
    issuance_observed := auth_row.confirmation_sent_at IS NOT NULL
      AND (
        attempt.pre_confirmation_sent_at IS NULL
        OR auth_row.confirmation_sent_at > attempt.pre_confirmation_sent_at
      );
  ELSIF matching_email_count = 1 THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;

  IF issuance_observed THEN
    IF p_email_otp_expires_in_seconds NOT BETWEEN 60 AND 604800 THEN
      RAISE EXCEPTION 'invalid student portal reconciliation'
        USING ERRCODE = '22023';
    END IF;
    UPDATE platform_private.student_portal_invite_attempts AS target
    SET attempt_state = 'succeeded',
        observed_confirmation_sent_at = auth_row.confirmation_sent_at,
        auth_user_id = p_auth_user_id,
        safe_error_code = NULL,
        reconciled_at = statement_timestamp()
    WHERE target.id = p_attempt_id;
    UPDATE platform_private.student_portal_provisioning_receipts AS target
    SET provisioning_state = CASE
          WHEN attempt.attempt_kind = 'initial' THEN 'invite_succeeded'
          ELSE target.provisioning_state
        END,
        invite_delivery_status = CASE
          WHEN auth_row.confirmed_at IS NULL THEN 'issued' ELSE 'accepted'
        END,
        auth_user_id = p_auth_user_id,
        invite_issued_at = auth_row.confirmation_sent_at,
        invite_expires_at = auth_row.confirmation_sent_at
          + pg_catalog.make_interval(secs => p_email_otp_expires_in_seconds),
        accepted_at = CASE
          WHEN auth_row.confirmed_at IS NULL THEN target.accepted_at
          ELSE COALESCE(target.accepted_at, auth_row.confirmed_at)
        END,
        safe_error_code = NULL,
        receipt_version = target.receipt_version + 1,
        updated_at = statement_timestamp()
    WHERE target.id = p_receipt_id;
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('attempt_id', p_attempt_id, 'reconciled', TRUE);
  END IF;

  IF NOT p_provider_no_issuance_proven
    OR p_provider_operation_upper_bound_at IS NULL
    OR p_provider_operation_upper_bound_at < attempt.claimed_at
    OR p_provider_operation_upper_bound_at > statement_timestamp()
    OR fixed_error_code IS NULL
    OR fixed_error_code !~ '^[a-z][a-z0-9_.-]{0,99}$'
  THEN
    RAISE EXCEPTION 'portal_invite_no_issuance_unproven'
      USING ERRCODE = '40001';
  END IF;

  UPDATE platform_private.student_portal_invite_attempts AS target
  SET attempt_state = 'failed',
      safe_error_code = fixed_error_code,
      reconciled_at = statement_timestamp()
  WHERE target.id = p_attempt_id;
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = CASE
        WHEN attempt.attempt_kind = 'initial' THEN 'invite_failed'
        ELSE target.provisioning_state
      END,
      invite_delivery_status = CASE
        WHEN attempt.attempt_kind = 'initial' THEN NULL ELSE 'reissue_failed'
      END,
      safe_error_code = fixed_error_code,
      receipt_version = target.receipt_version + 1,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('attempt_id', p_attempt_id, 'reconciled', TRUE);
END
$$;

REVOKE ALL ON FUNCTION platform.reconcile_student_portal_invite(
  UUID, UUID, BIGINT, BIGINT, UUID, INTEGER, BOOLEAN, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reconcile_student_portal_invite(
  UUID, UUID, BIGINT, BIGINT, UUID, INTEGER, BOOLEAN, TIMESTAMPTZ, TEXT
) TO service_role;

CREATE FUNCTION platform_private.assign_student_case_curator_authorized_e1(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_curator_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID,
  p_actor_profile_id UUID,
  p_actor_membership_id UUID,
  p_actor_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  previous_scope platform.record_scopes%ROWTYPE;
  new_scope_id UUID := gen_random_uuid();
  new_scope_version BIGINT;
  previous_curator_id UUID;
  new_curator_profile_id UUID;
  affected_profile_id UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  assignment_kind TEXT;
  result JSONB;
BEGIN
  replayed := platform_private.replay_audit(
    p_request_id, 'case.curator.set', 'student_case', p_student_case_id,
    pg_catalog.btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'case.curator.set', 'student_case', p_student_case_id,
    pg_catalog.btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT profile.id INTO new_curator_profile_id
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile ON profile.id = membership.profile_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_curator_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'curator'
    AND profile.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, bundle;
  IF new_curator_profile_id IS NULL THEN
    RAISE EXCEPTION 'Live Curator membership is required' USING ERRCODE = '22023';
  END IF;

  previous_curator_id := target_case.current_curator_membership_id;
  IF previous_curator_id = p_curator_membership_id THEN
    RAISE EXCEPTION 'Student case already has this Curator' USING ERRCODE = '22023';
  END IF;
  IF target_case.state = 'pending' THEN
    assignment_kind := 'assigned';
  ELSIF target_case.state IN ('active', 'closed') AND previous_curator_id IS NOT NULL THEN
    assignment_kind := 'reassigned';
  ELSE
    RAISE EXCEPTION 'Student case is not assignable' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO previous_scope
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = p_organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = p_student_case_id
    AND scope.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
  END IF;
  new_scope_version := previous_scope.scope_version + 1;
  UPDATE platform.record_scopes SET is_active = FALSE WHERE id = previous_scope.id;
  INSERT INTO platform.record_scopes (
    id, organization_id, scope_kind, scope_key, scope_version, is_active
  ) VALUES (
    new_scope_id, p_organization_id, 'student_case', p_student_case_id,
    new_scope_version, TRUE
  );

  IF assignment_kind = 'assigned' THEN
    PERFORM platform_private.append_scope_event(
      p_organization_id, target_case.responsible_sales_membership_id,
      previous_scope.id, previous_scope.scope_version, FALSE,
      'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
    );
  ELSE
    PERFORM platform_private.append_scope_event(
      p_organization_id, previous_curator_id,
      previous_scope.id, previous_scope.scope_version, FALSE,
      'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
    );
    IF target_case.student_membership_id IS NOT NULL THEN
      PERFORM platform_private.append_scope_event(
        p_organization_id, target_case.student_membership_id,
        previous_scope.id, previous_scope.scope_version, FALSE,
        'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
      );
    END IF;
  END IF;
  PERFORM platform_private.append_scope_event(
    p_organization_id, p_curator_membership_id,
    new_scope_id, new_scope_version, TRUE,
    'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
  );
  IF target_case.student_membership_id IS NOT NULL THEN
    PERFORM platform_private.append_scope_event(
      p_organization_id, target_case.student_membership_id,
      new_scope_id, new_scope_version, TRUE,
      'user', p_actor_profile_id, pg_catalog.btrim(p_reason), p_request_id
    );
  END IF;

  UPDATE platform.student_cases AS student_case
  SET current_curator_membership_id = p_curator_membership_id,
      state = CASE WHEN target_case.state = 'pending'
        THEN 'active'::platform.student_case_state ELSE target_case.state END,
      handoff_at = COALESCE(target_case.handoff_at, occurred_at),
      portal_activated_at = COALESCE(target_case.portal_activated_at, occurred_at),
      current_scope_id = new_scope_id,
      current_scope_version = new_scope_version
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  INSERT INTO platform.student_case_assignment_events (
    organization_id, student_case_id, event_type,
    previous_curator_membership_id, new_curator_membership_id,
    previous_scope_id, previous_scope_version, new_scope_id, new_scope_version,
    actor_membership_id, reason, request_id
  ) VALUES (
    p_organization_id, p_student_case_id, assignment_kind,
    previous_curator_id, p_curator_membership_id,
    previous_scope.id, previous_scope.scope_version, new_scope_id, new_scope_version,
    p_actor_membership_id, pg_catalog.btrim(p_reason), p_request_id
  );
  IF assignment_kind = 'assigned' THEN
    INSERT INTO platform.student_case_lifecycle_events (
      organization_id, student_case_id, event_type, previous_state, new_state,
      actor_membership_id, reason, request_id
    ) VALUES (
      p_organization_id, p_student_case_id, 'activated', 'pending', 'active',
      p_actor_membership_id, pg_catalog.btrim(p_reason), p_request_id
    );
  END IF;

  FOR affected_profile_id IN
    SELECT DISTINCT membership.profile_id
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.id = ANY (
        pg_catalog.array_remove(
          CASE WHEN assignment_kind = 'assigned' THEN ARRAY[
            target_case.responsible_sales_membership_id,
            target_case.student_membership_id,
            p_curator_membership_id
          ]::UUID[] ELSE ARRAY[
            previous_curator_id,
            target_case.student_membership_id,
            p_curator_membership_id
          ]::UUID[] END,
          NULL::UUID
        )
      )
  LOOP
    PERFORM platform_private.bump_access_version(affected_profile_id);
  END LOOP;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'curator_membership_id', p_curator_membership_id,
    'previous_curator_membership_id', previous_curator_id,
    'assignment_type', assignment_kind,
    'case_state', CASE WHEN target_case.state = 'pending' THEN 'active'
      ELSE target_case.state::TEXT END,
    'scope_id', new_scope_id,
    'scope_version', new_scope_version,
    'handoff_at', COALESCE(target_case.handoff_at, occurred_at),
    'portal_activated_at', COALESCE(target_case.portal_activated_at, occurred_at)
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', p_actor_profile_id,
    'auth:' || p_actor_auth_user_id::TEXT,
    'case.curator.set', 'student_case', p_student_case_id,
    jsonb_build_object(
      'case_state', target_case.state,
      'curator_membership_id', previous_curator_id,
      'scope_id', previous_scope.id,
      'scope_version', previous_scope.scope_version,
      'handoff_at', target_case.handoff_at,
      'portal_activated_at', target_case.portal_activated_at
    ),
    result, pg_catalog.btrim(p_reason), p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.assign_student_case_curator_body(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_curator_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_admin_actor(
    p_organization_id, 'case.curator.assign'
  );
  RETURN platform_private.assign_student_case_curator_authorized_e1(
    p_organization_id, p_student_case_id, p_curator_membership_id,
    p_reason, p_request_id,
    actor.actor_profile_id, actor.actor_membership_id, actor.actor_auth_user_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.assign_student_case_curator_authorized_e1(
  UUID, UUID, UUID, TEXT, UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.assign_student_case_curator_body(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.assign_student_case_curator(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assign_student_case_curator(
  UUID, UUID, UUID, TEXT, UUID
) TO authenticated;

CREATE FUNCTION platform_private.assert_student_portal_receipt_admin_e1(
  p_receipt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  current_scope_id UUID;
BEGIN
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    JOIN platform.profiles AS profile
      ON profile.auth_user_id = auth_user.id
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE auth_user.id = receipt.authorizing_auth_user_id
      AND profile.id = receipt.authorizing_profile_id
      AND profile.status = 'active'
      AND profile.access_version = receipt.authorizing_access_version
      AND membership.organization_id = receipt.organization_id
      AND membership.id = receipt.authorizing_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'admin'
      AND membership.current_bundle_id = receipt.authorizing_bundle_id
      AND organization.status = 'active'
      AND bundle.id = receipt.authorizing_bundle_id
      AND bundle.version = receipt.authorizing_bundle_version
      AND bundle.status = 'published'
  ) OR EXISTS (
    SELECT 1
    FROM unnest(receipt.required_permission_keys) AS required(permission_key)
    WHERE NOT EXISTS (
      SELECT 1
      FROM platform.role_bundle_permissions AS permission
      WHERE permission.bundle_id = receipt.authorizing_bundle_id
        AND permission.bundle_role = 'admin'
        AND permission.permission_key = required.permission_key
    )
  ) THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;

  SELECT scope.id INTO current_scope_id
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = receipt.organization_id
    AND scope.scope_kind = 'organization'
    AND scope.scope_key = receipt.organization_id
    AND scope.is_active
  ORDER BY scope.scope_version DESC LIMIT 1;
  IF current_scope_id IS NULL OR NOT COALESCE((
    SELECT assignment.granted
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.organization_id = receipt.organization_id
      AND assignment.membership_id = receipt.authorizing_membership_id
      AND assignment.scope_id = current_scope_id
    ORDER BY assignment.assignment_version DESC LIMIT 1
  ), FALSE) THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE FUNCTION platform.finalize_student_portal_authority(
  p_receipt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt_hint RECORD;
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  latest_attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  auth_row RECORD;
  membership_result JSONB;
  scope_result JSONB;
  curator_result JSONB;
  new_student_profile_id UUID;
  new_student_membership_id UUID;
  case_scope platform.record_scopes%ROWTYPE;
  child_membership UUID;
  child_org_scope UUID;
  child_case_scope UUID;
  child_legacy_curator UUID;
  child_final_audit UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  row_count INTEGER;
  final_result JSONB;
BEGIN
  IF p_receipt_id IS NULL OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
  THEN RAISE EXCEPTION 'invalid student portal finalize input' USING ERRCODE = '22023'; END IF;

  SELECT candidate.organization_id, candidate.request_id
  INTO receipt_hint
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  child_membership := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '01-membership-provision'
  );
  child_org_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '02-organization-scope'
  );
  child_case_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '03-student-case-scope'
  );
  child_legacy_curator := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '04-legacy-curator'
  );
  child_final_audit := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '05-student-portal-audit'
  );

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    receipt_hint.organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(receipt_hint.request_id);

  -- Participant locks begin only after the complete advisory tree.
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  SELECT * INTO latest_attempt
  FROM platform_private.student_portal_invite_attempts AS attempt
  WHERE attempt.receipt_id = p_receipt_id
    AND attempt.invite_generation = receipt.invite_generation
  FOR UPDATE;

  PERFORM auth_user.id
  FROM auth.users AS auth_user
  WHERE auth_user.id = ANY (ARRAY[
    receipt.authorizing_auth_user_id, receipt.auth_user_id
  ]::UUID[])
  ORDER BY auth_user.id
  FOR UPDATE;
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = receipt.organization_id
    AND student_case.id = receipt.student_case_id
  FOR UPDATE;
  PERFORM membership.id
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = receipt.organization_id
    AND membership.id = ANY (pg_catalog.array_remove(ARRAY[
      receipt.authorizing_membership_id,
      receipt.legacy_curator_membership_id,
      receipt.student_membership_id
    ]::UUID[], NULL::UUID))
  ORDER BY membership.id
  FOR UPDATE;
  PERFORM profile.id
  FROM platform.profiles AS profile
  WHERE profile.id = ANY (pg_catalog.array_remove(ARRAY[
    receipt.authorizing_profile_id, receipt.student_profile_id
  ]::UUID[], NULL::UUID))
  ORDER BY profile.id
  FOR UPDATE;

  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  PERFORM platform_private.assert_student_portal_receipt_admin_e1(p_receipt_id);
  IF receipt.provisioning_state = 'authority_activated' THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.provisioning_state <> 'invite_succeeded'
    OR receipt.auth_user_id IS NULL
    OR latest_attempt.id IS NULL
    OR (
      latest_attempt.attempt_state <> 'succeeded'
      AND receipt.invite_delivery_status <> 'accepted'
    )
  THEN RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001'; END IF;

  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status = 'accepted'
    AND auth_row.confirmed_at IS NULL
  THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  IF target_case.id IS NULL OR target_case.student_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;
  IF receipt.case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  ELSE
    IF target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile ON profile.id = membership.profile_id
        JOIN platform.role_bundle_versions AS bundle
          ON bundle.id = membership.current_bundle_id
          AND bundle.role = membership."current_role"
        WHERE membership.organization_id = receipt.organization_id
          AND membership.id = receipt.legacy_curator_membership_id
          AND membership.status = 'active'
          AND membership."current_role" = 'curator'
          AND profile.status = 'active'
          AND bundle.status = 'published'
      )
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  END IF;

  BEGIN
    membership_result := platform_private.provision_member_authorized_e1(
      receipt.organization_id, receipt.auth_user_id, receipt.student_display_name,
      'student', 'Student Portal provisioning', child_membership,
      receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
    );
  EXCEPTION
    WHEN invalid_parameter_value OR unique_violation THEN
      RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END;
  new_student_profile_id := (membership_result ->> 'profile_id')::UUID;
  new_student_membership_id := (membership_result ->> 'membership_id')::UUID;
  scope_result := platform_private.assign_organization_scope_authorized_e1(
    receipt.organization_id, new_student_membership_id,
    'Student Portal organization scope', child_org_scope,
    receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
  );

  SELECT * INTO case_scope
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = receipt.organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = receipt.student_case_id
    AND scope.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
  END IF;
  PERFORM platform_private.append_scope_event(
    receipt.organization_id, new_student_membership_id,
    case_scope.id, case_scope.scope_version, TRUE,
    'user', receipt.authorizing_profile_id,
    'Student Portal exact case scope', child_case_scope
  );

  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET student_profile_id = new_student_profile_id,
      student_membership_id = new_student_membership_id,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  PERFORM pg_catalog.set_config(
    'platform.student_portal_bind_receipt_id', p_receipt_id::TEXT, TRUE
  );
  UPDATE platform.student_cases AS student_case
  SET student_membership_id = new_student_membership_id
  WHERE student_case.organization_id = receipt.organization_id
    AND student_case.id = receipt.student_case_id
    AND student_case.student_membership_id IS NULL;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;

  -- Mandatory extra bump after both scopes and the one-way bind.
  PERFORM platform_private.bump_access_version(new_student_profile_id);

  IF receipt.case_shape = 'normal_u6' THEN
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id = new_student_membership_id
      AND student_case.state = 'active'
      AND student_case.portal_activated_at IS NULL
      AND student_case.closed_at IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    curator_result := platform_private.assign_student_case_curator_authorized_e1(
      receipt.organization_id, receipt.student_case_id,
      receipt.legacy_curator_membership_id,
      'Student Portal legacy Curator activation', child_legacy_curator,
      receipt.authorizing_profile_id, receipt.authorizing_membership_id,
      receipt.authorizing_auth_user_id
    );
    occurred_at := (curator_result ->> 'portal_activated_at')::TIMESTAMPTZ;
  END IF;

  final_result := jsonb_build_object(
    'receipt_id', receipt.id,
    'request_id', receipt.request_id,
    'student_case_id', receipt.student_case_id,
    'case_shape', receipt.case_shape,
    'student_profile_id', new_student_profile_id,
    'student_membership_id', new_student_membership_id,
    'portal_activated_at', occurred_at,
    'authority_activated', TRUE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    receipt.organization_id, 'user', receipt.authorizing_profile_id,
    'auth:' || receipt.authorizing_auth_user_id::TEXT,
    'student.portal.authority.activate', 'student_case', receipt.student_case_id,
    jsonb_build_object(
      'student_membership_id', NULL,
      'portal_activated_at', NULL,
      'case_shape', receipt.case_shape
    ),
    final_result,
    'Student Portal authority activation', child_final_audit
  );

  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = 'authority_activated',
      student_profile_id = new_student_profile_id,
      student_membership_id = new_student_membership_id,
      authority_activated_at = occurred_at,
      receipt_version = target.receipt_version + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform_private.assert_student_portal_receipt_admin_e1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.finalize_student_portal_authority(
  UUID, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.finalize_student_portal_authority(
  UUID, BIGINT, BIGINT
) TO service_role;

CREATE FUNCTION platform_private.accept_student_portal_invite_e1(
  p_receipt_id UUID,
  p_confirmed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  row_count INTEGER;
BEGIN
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF p_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  IF receipt.active_attempt_id IS NOT NULL THEN
    UPDATE platform_private.student_portal_invite_attempts AS target
    SET attempt_state = 'succeeded',
        auth_user_id = COALESCE(target.auth_user_id, receipt.auth_user_id),
        safe_error_code = NULL,
        recorded_at = COALESCE(target.recorded_at, statement_timestamp()),
        reconciled_at = statement_timestamp()
    WHERE target.id = receipt.active_attempt_id
      AND target.receipt_id = receipt.id
      AND target.invite_generation = receipt.invite_generation
      AND target.attempt_state = 'dispatching';
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'stale_invite_attempt' USING ERRCODE = '40001';
    END IF;
  END IF;
  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET invite_delivery_status = 'accepted',
      accepted_at = COALESCE(target.accepted_at, p_confirmed_at),
      active_attempt_id = NULL,
      receipt_version = target.receipt_version + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = receipt.id;
END
$$;

REVOKE ALL ON FUNCTION platform_private.accept_student_portal_invite_e1(
  UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.record_student_portal_invite_accepted(
  p_receipt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  auth_row RECORD;
BEGIN
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  IF receipt.invite_delivery_status = 'accepted' THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.auth_user_id IS NULL OR receipt.invite_delivery_status NOT IN (
    'issued', 'expired', 'reissue_dispatching', 'reissue_failed', 'reissue_unknown'
  ) THEN RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001'; END IF;
  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF auth_row.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  PERFORM platform_private.accept_student_portal_invite_e1(
    p_receipt_id, auth_row.confirmed_at
  );
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$$;

CREATE FUNCTION platform.resolve_student_portal_invite_identity(
  p_auth_user_id UUID,
  p_email TEXT,
  p_mark_accepted BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  auth_row RECORD;
BEGIN
  IF p_auth_user_id IS NULL OR v_normalized_email IS NULL
    OR pg_catalog.char_length(v_normalized_email) NOT BETWEEN 3 AND 320
    OR p_mark_accepted IS NULL
  THEN RAISE EXCEPTION 'invalid student portal identity lookup' USING ERRCODE = '22023'; END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.auth_user_id = p_auth_user_id
    AND candidate.normalized_email = v_normalized_email
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001'; END IF;
  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = p_auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> v_normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_mark_accepted AND auth_row.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  IF p_mark_accepted AND receipt.invite_delivery_status <> 'accepted' THEN
    PERFORM platform_private.accept_student_portal_invite_e1(
      receipt.id, auth_row.confirmed_at
    );
  END IF;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = receipt.id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'receipt_id', receipt.id,
    'provisioning_state', receipt.provisioning_state,
    'invite_delivery_status', receipt.invite_delivery_status,
    'receipt_version', receipt.receipt_version,
    'invite_generation', receipt.invite_generation,
    'authority_activated', receipt.provisioning_state = 'authority_activated',
    'account_pending', receipt.provisioning_state <> 'authority_activated'
  ));
END
$$;

REVOKE ALL ON FUNCTION platform.record_student_portal_invite_accepted(
  UUID, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_student_portal_invite_accepted(
  UUID, BIGINT, BIGINT
) TO service_role;
REVOKE ALL ON FUNCTION platform.resolve_student_portal_invite_identity(
  UUID, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.resolve_student_portal_invite_identity(
  UUID, TEXT, BOOLEAN
) TO service_role;

COMMENT ON TABLE platform_private.student_portal_provisioning_receipts IS
  'Private E1 authorization and recovery receipts; no provider payload, token or browser grant.';
COMMENT ON TABLE platform_private.student_portal_invite_attempts IS
  'Private fenced initial/reissue dispatch attempts with bounded outcome evidence only.';
COMMENT ON FUNCTION platform.prepare_student_portal_provisioning(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID
) IS 'Authenticated Admin preparation only; performs no Auth provider call.';
COMMENT ON FUNCTION platform.finalize_student_portal_authority(
  UUID, BIGINT, BIGINT
) IS 'Service-only receipt finalizer; revalidates the original Admin without auth.uid impersonation.';

COMMIT;
