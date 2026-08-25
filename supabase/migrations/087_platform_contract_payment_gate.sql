-- ============================================================
-- 087_platform_contract_payment_gate.sql
--
-- U5: canonical contract and first mandatory payment gate.
--
-- This migration records only staff-confirmed facts and provenance. It does
-- not process money, contact a provider, or perform the Admissions handoff.
-- ============================================================

BEGIN;

CREATE TYPE platform.admissions_gate_state AS ENUM (
  'blocked',
  'satisfied',
  'overridden'
);

INSERT INTO platform.permission_definitions (permission_key, description)
VALUES (
  'admissions.handoff.gate.override',
  'Individually granted Admin authority to override the Admissions handoff gate'
);

ALTER TABLE platform.membership_permission_events
  DROP CONSTRAINT membership_permission_events_sensitive_key_check;
ALTER TABLE platform.membership_permission_events
  ADD CONSTRAINT membership_permission_events_sensitive_key_check CHECK (
    permission_key IN (
      'contract.evidence.confirm',
      'finance.first.payment.confirm',
      'admissions.handoff.gate.override'
    )
  );

CREATE TABLE platform.lead_admissions_gates (
  organization_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  contract_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  contract_confirmed_by_membership_id UUID,
  contract_confirmed_by_profile_id UUID,
  contract_confirmed_at TIMESTAMPTZ,
  contract_evidence_reference TEXT,
  first_payment_amount NUMERIC(14, 2),
  first_payment_currency TEXT,
  first_payment_due_date DATE,
  first_payment_received_date DATE,
  first_payment_confirmed_by_membership_id UUID,
  first_payment_confirmed_by_profile_id UUID,
  first_payment_confirmed_at TIMESTAMPTZ,
  first_payment_evidence_reference TEXT,
  override_reason TEXT,
  overridden_by_membership_id UUID,
  overridden_by_profile_id UUID,
  overridden_at TIMESTAMPTZ,
  gate_state platform.admissions_gate_state NOT NULL DEFAULT 'blocked',
  gate_version BIGINT NOT NULL DEFAULT 1 CHECK (gate_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, lead_id),
  CONSTRAINT lead_admissions_gates_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT lead_admissions_gates_contract_actor_fkey
    FOREIGN KEY (
      organization_id,
      contract_confirmed_by_membership_id,
      contract_confirmed_by_profile_id
    ) REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    ) ON DELETE RESTRICT,
  CONSTRAINT lead_admissions_gates_payment_actor_fkey
    FOREIGN KEY (
      organization_id,
      first_payment_confirmed_by_membership_id,
      first_payment_confirmed_by_profile_id
    ) REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    ) ON DELETE RESTRICT,
  CONSTRAINT lead_admissions_gates_override_actor_fkey
    FOREIGN KEY (
      organization_id,
      overridden_by_membership_id,
      overridden_by_profile_id
    ) REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    ) ON DELETE RESTRICT,
  CONSTRAINT lead_admissions_gates_contract_fact_check CHECK (
    (
      NOT contract_confirmed
      AND contract_confirmed_by_membership_id IS NULL
      AND contract_confirmed_by_profile_id IS NULL
      AND contract_confirmed_at IS NULL
      AND contract_evidence_reference IS NULL
    ) OR (
      contract_confirmed
      AND contract_confirmed_by_membership_id IS NOT NULL
      AND contract_confirmed_by_profile_id IS NOT NULL
      AND contract_confirmed_at IS NOT NULL
      AND contract_evidence_reference IS NOT NULL
      AND contract_evidence_reference = btrim(contract_evidence_reference)
      AND length(contract_evidence_reference) BETWEEN 1 AND 2048
    )
  ),
  CONSTRAINT lead_admissions_gates_expectation_check CHECK (
    (
      first_payment_amount IS NULL
      AND first_payment_currency IS NULL
      AND first_payment_due_date IS NULL
    ) OR (
      contract_confirmed
      AND first_payment_amount > 0
      AND first_payment_currency ~ '^[A-Z]{3}$'
      AND first_payment_due_date IS NOT NULL
    )
  ),
  CONSTRAINT lead_admissions_gates_payment_fact_check CHECK (
    (
      first_payment_received_date IS NULL
      AND first_payment_confirmed_by_membership_id IS NULL
      AND first_payment_confirmed_by_profile_id IS NULL
      AND first_payment_confirmed_at IS NULL
      AND first_payment_evidence_reference IS NULL
    ) OR (
      contract_confirmed
      AND first_payment_amount IS NOT NULL
      AND first_payment_currency IS NOT NULL
      AND first_payment_due_date IS NOT NULL
      AND first_payment_received_date IS NOT NULL
      AND first_payment_confirmed_by_membership_id IS NOT NULL
      AND first_payment_confirmed_by_profile_id IS NOT NULL
      AND first_payment_confirmed_at IS NOT NULL
      AND first_payment_evidence_reference IS NOT NULL
      AND first_payment_evidence_reference =
        btrim(first_payment_evidence_reference)
      AND length(first_payment_evidence_reference) BETWEEN 1 AND 2048
    )
  ),
  CONSTRAINT lead_admissions_gates_override_fact_check CHECK (
    (
      override_reason IS NULL
      AND overridden_by_membership_id IS NULL
      AND overridden_by_profile_id IS NULL
      AND overridden_at IS NULL
    ) OR (
      override_reason IS NOT NULL
      AND override_reason = btrim(override_reason)
      AND length(override_reason) BETWEEN 1 AND 1000
      AND overridden_by_membership_id IS NOT NULL
      AND overridden_by_profile_id IS NOT NULL
      AND overridden_at IS NOT NULL
    )
  ),
  CONSTRAINT lead_admissions_gates_state_check CHECK (
    (
      gate_state = 'satisfied'
      AND contract_confirmed
      AND first_payment_confirmed_at IS NOT NULL
    ) OR (
      gate_state = 'overridden'
      AND overridden_at IS NOT NULL
      AND first_payment_confirmed_at IS NULL
    ) OR (
      gate_state = 'blocked'
      AND overridden_at IS NULL
      AND first_payment_confirmed_at IS NULL
    )
  )
);

CREATE INDEX lead_admissions_gates_state_idx
  ON platform.lead_admissions_gates (
    organization_id,
    gate_state,
    updated_at DESC,
    lead_id
  );
CREATE INDEX lead_admissions_gates_contract_actor_idx
  ON platform.lead_admissions_gates (
    organization_id,
    contract_confirmed_by_membership_id,
    contract_confirmed_at DESC
  ) WHERE contract_confirmed_by_membership_id IS NOT NULL;
CREATE INDEX lead_admissions_gates_payment_actor_idx
  ON platform.lead_admissions_gates (
    organization_id,
    first_payment_confirmed_by_membership_id,
    first_payment_confirmed_at DESC
  ) WHERE first_payment_confirmed_by_membership_id IS NOT NULL;
CREATE INDEX lead_admissions_gates_override_actor_idx
  ON platform.lead_admissions_gates (
    organization_id,
    overridden_by_membership_id,
    overridden_at DESC
  ) WHERE overridden_by_membership_id IS NOT NULL;

CREATE TABLE platform_private.lead_admissions_gate_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  expected_gate_version BIGINT NOT NULL CHECK (expected_gate_version > 0),
  requested_action TEXT NOT NULL CHECK (
    requested_action IN (
      'confirm_contract',
      'confirm_first_payment',
      'override_gate'
    )
  ),
  requested_amount NUMERIC(14, 2),
  requested_currency TEXT,
  requested_due_date DATE,
  requested_received_date DATE,
  requested_evidence_reference TEXT,
  requested_reason TEXT,
  resulting_gate_version BIGINT NOT NULL CHECK (resulting_gate_version > 1),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT lead_admissions_gate_receipts_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT lead_admissions_gate_receipts_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id, actor_profile_id)
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    ) ON DELETE RESTRICT
);

CREATE INDEX lead_admissions_gate_receipts_lead_created_idx
  ON platform_private.lead_admissions_gate_receipts (
    organization_id,
    lead_id,
    created_at DESC
  );
CREATE INDEX lead_admissions_gate_receipts_actor_created_idx
  ON platform_private.lead_admissions_gate_receipts (
    organization_id,
    actor_membership_id,
    created_at DESC
  );

ALTER TABLE platform.lead_admissions_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_admissions_gates FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_admissions_gate_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_admissions_gate_receipts
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER lead_admissions_gate_receipts_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.lead_admissions_gate_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER lead_admissions_gate_receipts_no_truncate
  BEFORE TRUNCATE
  ON platform_private.lead_admissions_gate_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON TABLE
  platform.lead_admissions_gates,
  platform_private.lead_admissions_gate_receipts
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE POLICY lead_admissions_gates_read
  ON platform.lead_admissions_gates
  FOR SELECT
  TO authenticated
  USING (
    private.platform_can_read_canonical_lead(organization_id, lead_id)
  );

GRANT SELECT ON TABLE platform.lead_admissions_gates TO authenticated;

CREATE OR REPLACE FUNCTION platform_private.initialize_lead_admissions_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO platform.lead_admissions_gates (organization_id, lead_id)
  VALUES (NEW.organization_id, NEW.id)
  ON CONFLICT (organization_id, lead_id) DO NOTHING;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.initialize_lead_admissions_gate()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER leads_initialize_admissions_gate
  AFTER INSERT ON platform.leads
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.initialize_lead_admissions_gate();

-- U1 sensitive permissions remain individual grants. The new override key is
-- additionally restricted to an active Admin, so a title without the grant and
-- a grant on a non-Admin membership both fail closed.
CREATE OR REPLACE FUNCTION private.platform_has_permission(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND membership.organization_id::TEXT =
        (SELECT auth.jwt() ->> 'platform_organization_id')
      AND membership.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_membership_id')
      AND bundle.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_id')
      AND bundle.version::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_version')
      AND (
        (
          p_permission_key = 'contract.evidence.confirm'
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'contract.evidence.confirm'
          )
        )
        OR (
          p_permission_key IN (
            'finance.event.confirm',
            'finance.first.payment.confirm'
          )
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'finance.first.payment.confirm'
          )
        )
        OR (
          p_permission_key = 'admissions.handoff.gate.override'
          AND membership."current_role" = 'admin'
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'admissions.handoff.gate.override'
          )
        )
        OR (
          p_permission_key NOT IN (
            'contract.evidence.confirm',
            'finance.event.confirm',
            'finance.first.payment.confirm',
            'admissions.handoff.gate.override'
          )
          AND EXISTS (
            SELECT 1
            FROM platform.role_bundle_permissions AS bundle_permission
            WHERE bundle_permission.bundle_id = bundle.id
              AND bundle_permission.bundle_role = bundle.role
              AND bundle_permission.permission_key = p_permission_key
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_has_permission(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_has_permission(UUID, TEXT)
TO authenticated;

CREATE OR REPLACE FUNCTION platform.change_membership_permission(
  p_organization_id UUID,
  p_membership_id UUID,
  p_permission_key TEXT,
  p_granted BOOLEAN,
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
  actor_profile_id UUID;
  actor_membership_id UUID;
  actor_auth_user_id UUID;
  target_profile_id UUID;
  target_role platform.business_role;
  previous_granted BOOLEAN;
  next_permission_version BIGINT;
  next_access_version BIGINT;
  event_created_at TIMESTAMPTZ := statement_timestamp();
  before_state JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_membership_id IS NULL
    OR p_permission_key IS NULL
    OR p_permission_key NOT IN (
      'contract.evidence.confirm',
      'finance.first.payment.confirm',
      'admissions.handoff.gate.override'
    )
    OR p_granted IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, sensitive permission, grant, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id
  INTO
    actor_profile_id,
    actor_membership_id,
    actor_auth_user_id
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'membership.role.change'
  ) AS actor;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    'membership.permission.change',
    'organization_membership',
    p_membership_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'membership_id', p_membership_id,
      'permission_key', p_permission_key,
      'granted', p_granted
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  SELECT membership.profile_id, membership."current_role"
  INTO target_profile_id, target_role
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
    AND membership."current_role" IN ('admin', 'sales', 'curator')
    AND profile.status = 'active'
  FOR UPDATE OF membership, profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active U1 pilot staff membership is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_permission_key = 'admissions.handoff.gate.override'
    AND p_granted
    AND target_role <> 'admin'
  THEN
    RAISE EXCEPTION
      'Admissions gate override may be granted only to an Admin membership'
      USING ERRCODE = '22023';
  END IF;

  previous_granted :=
    platform_private.latest_membership_permission_grant(
      p_organization_id,
      p_membership_id,
      p_permission_key
    );

  IF previous_granted = p_granted THEN
    RAISE EXCEPTION 'Sensitive permission is already in the requested state'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(event.permission_version), 0) + 1
  INTO next_permission_version
  FROM platform.membership_permission_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.membership_id = p_membership_id
    AND event.permission_key = p_permission_key;

  INSERT INTO platform.membership_permission_events (
    organization_id,
    membership_id,
    profile_id,
    permission_key,
    permission_version,
    granted,
    actor_profile_id,
    actor_principal,
    reason,
    request_id,
    created_at
  ) VALUES (
    p_organization_id,
    p_membership_id,
    target_profile_id,
    p_permission_key,
    next_permission_version,
    p_granted,
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    btrim(p_reason),
    p_request_id,
    event_created_at
  );

  next_access_version :=
    platform_private.bump_access_version(target_profile_id);

  before_state := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'permission_key', p_permission_key,
    'granted', previous_granted
  );
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'permission_key', p_permission_key,
    'granted', p_granted,
    'permission_version', next_permission_version,
    'access_version', next_access_version,
    'changed_at', event_created_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    created_at
  ) VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    'membership.permission.change',
    'organization_membership',
    p_membership_id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id,
    event_created_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.change_membership_permission(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_membership_permission(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_directory(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
DROP FUNCTION platform.staff_directory(UUID);

CREATE FUNCTION platform.staff_directory(p_organization_id UUID)
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  display_name TEXT,
  platform_role platform.business_role,
  membership_status platform.membership_status,
  access_version BIGINT,
  contract_confirmation_granted BOOLEAN,
  first_payment_confirmation_granted BOOLEAN,
  admissions_gate_override_granted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'membership.read'
  );

  RETURN QUERY
  SELECT
    profile.auth_user_id,
    profile.id,
    membership.id,
    profile.display_name,
    membership."current_role",
    membership.status,
    profile.access_version,
    platform_private.latest_membership_permission_grant(
      membership.organization_id,
      membership.id,
      'contract.evidence.confirm'
    ),
    platform_private.latest_membership_permission_grant(
      membership.organization_id,
      membership.id,
      'finance.first.payment.confirm'
    ),
    platform_private.latest_membership_permission_grant(
      membership.organization_id,
      membership.id,
      'admissions.handoff.gate.override'
    )
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile ON profile.id = membership.profile_id
  WHERE membership.organization_id = p_organization_id
    AND membership."current_role" IN ('admin', 'sales', 'curator')
  ORDER BY lower(profile.display_name), membership.id;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_directory(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_directory(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION platform.assert_sensitive_permission(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authority RECORD;
BEGIN
  IF p_permission_key NOT IN (
    'contract.evidence.confirm',
    'finance.first.payment.confirm',
    'admissions.handoff.gate.override'
  ) THEN
    RAISE EXCEPTION 'Unsupported sensitive permission'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.platform_has_permission(
    p_organization_id,
    p_permission_key
  ) OR NOT private.platform_has_scope(
    p_organization_id,
    'organization',
    p_organization_id
  ) THEN
    RAISE EXCEPTION 'Explicit live sensitive permission is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO authority FROM platform.current_actor_authority();
  IF NOT FOUND OR authority.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'Exact live staff authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'organization_id', authority.organization_id,
    'membership_id', authority.membership_id,
    'profile_id', authority.profile_id,
    'role', authority.platform_role::TEXT,
    'permission_key', p_permission_key,
    'authorized', TRUE,
    'access_version', authority.platform_access_version
  );
END
$$;

REVOKE ALL ON FUNCTION platform.assert_sensitive_permission(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assert_sensitive_permission(UUID, TEXT)
TO authenticated;

CREATE OR REPLACE FUNCTION platform.staff_lead_admissions_gate(
  p_lead_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  lead_id UUID,
  contract_confirmed BOOLEAN,
  contract_confirmed_by_membership_id UUID,
  contract_confirmed_at TIMESTAMPTZ,
  contract_evidence_reference TEXT,
  first_payment_amount NUMERIC,
  first_payment_currency TEXT,
  first_payment_due_date DATE,
  first_payment_received_date DATE,
  first_payment_confirmed_by_membership_id UUID,
  first_payment_confirmed_at TIMESTAMPTZ,
  first_payment_evidence_reference TEXT,
  override_reason TEXT,
  overridden_by_membership_id UUID,
  overridden_at TIMESTAMPTZ,
  gate_state platform.admissions_gate_state,
  normal_handoff_allowed BOOLEAN,
  exceptional_handoff_allowed BOOLEAN,
  can_confirm_contract BOOLEAN,
  can_confirm_first_payment BOOLEAN,
  can_override_gate BOOLEAN,
  gate_version BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.read'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    gate.organization_id,
    gate.lead_id,
    gate.contract_confirmed,
    gate.contract_confirmed_by_membership_id,
    gate.contract_confirmed_at,
    gate.contract_evidence_reference,
    gate.first_payment_amount,
    gate.first_payment_currency,
    gate.first_payment_due_date,
    gate.first_payment_received_date,
    gate.first_payment_confirmed_by_membership_id,
    gate.first_payment_confirmed_at,
    gate.first_payment_evidence_reference,
    gate.override_reason,
    gate.overridden_by_membership_id,
    gate.overridden_at,
    gate.gate_state,
    gate.gate_state = 'satisfied',
    gate.gate_state = 'overridden',
    private.platform_has_permission(
      gate.organization_id,
      'contract.evidence.confirm'
    ) AND NOT gate.contract_confirmed,
    private.platform_has_permission(
      gate.organization_id,
      'finance.first.payment.confirm'
    ) AND gate.contract_confirmed
      AND gate.first_payment_confirmed_at IS NULL,
    actor.platform_role = 'admin'
      AND private.platform_has_permission(
        gate.organization_id,
        'admissions.handoff.gate.override'
      )
      AND gate.gate_state = 'blocked',
    gate.gate_version,
    gate.updated_at
  FROM platform.lead_admissions_gates AS gate
  JOIN platform.leads AS lead
    ON lead.organization_id = gate.organization_id
    AND lead.id = gate.lead_id
  WHERE gate.organization_id = actor.organization_id
    AND gate.lead_id = p_lead_id
    AND lead.lifecycle_state = 'open'
    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND (
          lead.current_owner_membership_id = actor.membership_id
          OR lead.current_owner_membership_id IS NULL
        )
      )
      OR (
        actor.platform_role = 'curator'
        AND private.platform_can_read_canonical_lead(
          lead.organization_id,
          lead.id
        )
      )
    )
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_lead_admissions_gate(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_lead_admissions_gate(UUID)
TO authenticated;

CREATE OR REPLACE FUNCTION platform.mutate_lead_admissions_gate(
  p_lead_id UUID,
  p_expected_gate_version BIGINT,
  p_request_id UUID,
  p_action TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_due_date DATE,
  p_received_date DATE,
  p_evidence_reference TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  lead_record RECORD;
  gate_record RECORD;
  prior_receipt RECORD;
  normalized_action TEXT;
  normalized_currency TEXT;
  normalized_evidence_reference TEXT;
  normalized_reason TEXT;
  effective_reason TEXT;
  audit_action TEXT;
  changed_at TIMESTAMPTZ := statement_timestamp();
  next_gate_version BIGINT;
  before_state JSONB;
  after_state JSONB;
  result JSONB;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admissions_gate_request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  IF p_expected_gate_version IS NULL OR p_expected_gate_version < 1 THEN
    RAISE EXCEPTION 'admissions_gate_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  normalized_action := pg_catalog.lower(
    NULLIF(pg_catalog.btrim(p_action), '')
  );
  normalized_currency := pg_catalog.upper(
    NULLIF(pg_catalog.btrim(p_currency), '')
  );
  normalized_evidence_reference := NULLIF(
    pg_catalog.btrim(p_evidence_reference),
    ''
  );
  normalized_reason := NULLIF(pg_catalog.btrim(p_reason), '');

  IF normalized_action IS NULL OR normalized_action NOT IN (
    'confirm_contract',
    'confirm_first_payment',
    'override_gate'
  ) THEN
    RAISE EXCEPTION 'admissions_gate_invalid_action'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_reason IS NOT NULL
    AND pg_catalog.length(normalized_reason) > 1000
  THEN
    RAISE EXCEPTION 'admissions_gate_invalid_action'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_action = 'confirm_contract' AND (
    p_amount IS NULL
    OR p_amount <= 0
    OR p_amount > 999999999999.99
    OR normalized_currency IS NULL
    OR normalized_currency !~ '^[A-Z]{3}$'
    OR p_due_date IS NULL
    OR p_received_date IS NOT NULL
    OR normalized_evidence_reference IS NULL
    OR pg_catalog.length(normalized_evidence_reference) > 2048
  ) THEN
    RAISE EXCEPTION 'admissions_gate_invalid_contract_confirmation'
      USING ERRCODE = '22023';
  ELSIF normalized_action = 'confirm_first_payment' AND (
    p_amount IS NOT NULL
    OR p_currency IS NOT NULL
    OR p_due_date IS NOT NULL
    OR p_received_date IS NULL
    OR normalized_evidence_reference IS NULL
    OR pg_catalog.length(normalized_evidence_reference) > 2048
  ) THEN
    RAISE EXCEPTION 'admissions_gate_invalid_first_payment'
      USING ERRCODE = '22023';
  ELSIF normalized_action = 'override_gate' AND (
    p_amount IS NOT NULL
    OR p_currency IS NOT NULL
    OR p_due_date IS NOT NULL
    OR p_received_date IS NOT NULL
    OR p_evidence_reference IS NOT NULL
    OR normalized_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'admissions_gate_override_reason_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.read'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF normalized_action = 'confirm_contract'
    AND NOT private.platform_has_permission(
      actor.organization_id,
      'contract.evidence.confirm'
    )
  THEN
    RAISE EXCEPTION 'admissions_gate_contract_confirmation_forbidden'
      USING ERRCODE = '42501';
  ELSIF normalized_action = 'confirm_first_payment'
    AND NOT private.platform_has_permission(
      actor.organization_id,
      'finance.first.payment.confirm'
    )
  THEN
    RAISE EXCEPTION 'admissions_gate_payment_confirmation_forbidden'
      USING ERRCODE = '42501';
  ELSIF normalized_action = 'override_gate' AND (
    actor.platform_role <> 'admin'
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'admissions.handoff.gate.override'
    )
  ) THEN
    RAISE EXCEPTION 'admissions_gate_override_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'u5:lead-admissions-gate:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.lead_admissions_gate_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id IS DISTINCT FROM actor.organization_id
      OR prior_receipt.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior_receipt.actor_profile_id IS DISTINCT FROM actor.profile_id
      OR prior_receipt.lead_id IS DISTINCT FROM p_lead_id
      OR prior_receipt.expected_gate_version IS DISTINCT FROM
        p_expected_gate_version
      OR prior_receipt.requested_action IS DISTINCT FROM normalized_action
      OR prior_receipt.requested_amount IS DISTINCT FROM p_amount
      OR prior_receipt.requested_currency IS DISTINCT FROM normalized_currency
      OR prior_receipt.requested_due_date IS DISTINCT FROM p_due_date
      OR prior_receipt.requested_received_date IS DISTINCT FROM p_received_date
      OR prior_receipt.requested_evidence_reference IS DISTINCT FROM
        normalized_evidence_reference
      OR prior_receipt.requested_reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'admissions_gate_request_id_conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN prior_receipt.result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'admissions_gate_request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  SELECT
    lead.*,
    gate.contract_confirmed,
    gate.contract_confirmed_by_membership_id,
    gate.contract_confirmed_by_profile_id,
    gate.contract_confirmed_at,
    gate.contract_evidence_reference,
    gate.first_payment_amount,
    gate.first_payment_currency,
    gate.first_payment_due_date,
    gate.first_payment_received_date,
    gate.first_payment_confirmed_by_membership_id,
    gate.first_payment_confirmed_by_profile_id,
    gate.first_payment_confirmed_at,
    gate.first_payment_evidence_reference,
    gate.override_reason,
    gate.overridden_by_membership_id,
    gate.overridden_by_profile_id,
    gate.overridden_at,
    gate.gate_state,
    gate.gate_version,
    gate.created_at AS gate_created_at,
    gate.updated_at AS gate_updated_at
  INTO lead_record
  FROM platform.leads AS lead
  JOIN platform.lead_admissions_gates AS gate
    ON gate.organization_id = lead.organization_id
    AND gate.lead_id = lead.id
  WHERE lead.organization_id = actor.organization_id
    AND lead.id = p_lead_id
    AND lead.lifecycle_state = 'open'
    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND (
          lead.current_owner_membership_id = actor.membership_id
          OR lead.current_owner_membership_id IS NULL
        )
      )
      OR (
        actor.platform_role = 'curator'
        AND private.platform_can_read_canonical_lead(
          lead.organization_id,
          lead.id
        )
      )
    )
  FOR UPDATE OF gate;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF lead_record.gate_version <> p_expected_gate_version THEN
    RAISE EXCEPTION 'admissions_gate_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF normalized_action = 'confirm_contract'
    AND lead_record.contract_confirmed
  THEN
    RAISE EXCEPTION 'admissions_gate_contract_already_confirmed'
      USING ERRCODE = 'PT409';
  ELSIF normalized_action = 'confirm_first_payment'
    AND NOT lead_record.contract_confirmed
  THEN
    RAISE EXCEPTION 'admissions_gate_contract_required'
      USING ERRCODE = 'PT409';
  ELSIF normalized_action = 'confirm_first_payment'
    AND lead_record.first_payment_confirmed_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'admissions_gate_first_payment_already_confirmed'
      USING ERRCODE = 'PT409';
  ELSIF normalized_action = 'override_gate'
    AND lead_record.gate_state = 'satisfied'
  THEN
    RAISE EXCEPTION 'admissions_gate_already_satisfied'
      USING ERRCODE = 'PT409';
  END IF;

  before_state := pg_catalog.jsonb_build_object(
    'contract_confirmed', lead_record.contract_confirmed,
    'contract_confirmed_by_membership_id',
      lead_record.contract_confirmed_by_membership_id,
    'contract_confirmed_at', lead_record.contract_confirmed_at,
    'contract_evidence_reference', lead_record.contract_evidence_reference,
    'first_payment_amount', lead_record.first_payment_amount,
    'first_payment_currency', lead_record.first_payment_currency,
    'first_payment_due_date', lead_record.first_payment_due_date,
    'first_payment_received_date', lead_record.first_payment_received_date,
    'first_payment_confirmed_by_membership_id',
      lead_record.first_payment_confirmed_by_membership_id,
    'first_payment_confirmed_at', lead_record.first_payment_confirmed_at,
    'first_payment_evidence_reference',
      lead_record.first_payment_evidence_reference,
    'override_reason', lead_record.override_reason,
    'overridden_by_membership_id', lead_record.overridden_by_membership_id,
    'overridden_at', lead_record.overridden_at,
    'gate_state', lead_record.gate_state,
    'gate_version', lead_record.gate_version
  );

  next_gate_version := lead_record.gate_version + 1;

  IF normalized_action = 'confirm_contract' THEN
    UPDATE platform.lead_admissions_gates AS target
    SET
      contract_confirmed = TRUE,
      contract_confirmed_by_membership_id = actor.membership_id,
      contract_confirmed_by_profile_id = actor.profile_id,
      contract_confirmed_at = changed_at,
      contract_evidence_reference = normalized_evidence_reference,
      first_payment_amount = p_amount,
      first_payment_currency = normalized_currency,
      first_payment_due_date = p_due_date,
      gate_state = CASE
        WHEN target.overridden_at IS NOT NULL THEN 'overridden'
        ELSE 'blocked'
      END::platform.admissions_gate_state,
      gate_version = next_gate_version,
      updated_at = changed_at
    WHERE target.organization_id = actor.organization_id
      AND target.lead_id = p_lead_id
    RETURNING target.* INTO gate_record;
    audit_action := 'lead.admissions.gate.contract.confirmed';
  ELSIF normalized_action = 'confirm_first_payment' THEN
    UPDATE platform.lead_admissions_gates AS target
    SET
      first_payment_received_date = p_received_date,
      first_payment_confirmed_by_membership_id = actor.membership_id,
      first_payment_confirmed_by_profile_id = actor.profile_id,
      first_payment_confirmed_at = changed_at,
      first_payment_evidence_reference = normalized_evidence_reference,
      gate_state = 'satisfied',
      gate_version = next_gate_version,
      updated_at = changed_at
    WHERE target.organization_id = actor.organization_id
      AND target.lead_id = p_lead_id
    RETURNING target.* INTO gate_record;
    audit_action := 'lead.admissions.gate.firstpayment.confirmed';
  ELSE
    UPDATE platform.lead_admissions_gates AS target
    SET
      override_reason = normalized_reason,
      overridden_by_membership_id = actor.membership_id,
      overridden_by_profile_id = actor.profile_id,
      overridden_at = changed_at,
      gate_state = 'overridden',
      gate_version = next_gate_version,
      updated_at = changed_at
    WHERE target.organization_id = actor.organization_id
      AND target.lead_id = p_lead_id
    RETURNING target.* INTO gate_record;
    audit_action := 'lead.admissions.gate.overridden';
  END IF;

  after_state := pg_catalog.jsonb_build_object(
    'contract_confirmed', gate_record.contract_confirmed,
    'contract_confirmed_by_membership_id',
      gate_record.contract_confirmed_by_membership_id,
    'contract_confirmed_at', gate_record.contract_confirmed_at,
    'contract_evidence_reference', gate_record.contract_evidence_reference,
    'first_payment_amount', gate_record.first_payment_amount,
    'first_payment_currency', gate_record.first_payment_currency,
    'first_payment_due_date', gate_record.first_payment_due_date,
    'first_payment_received_date', gate_record.first_payment_received_date,
    'first_payment_confirmed_by_membership_id',
      gate_record.first_payment_confirmed_by_membership_id,
    'first_payment_confirmed_at', gate_record.first_payment_confirmed_at,
    'first_payment_evidence_reference',
      gate_record.first_payment_evidence_reference,
    'override_reason', gate_record.override_reason,
    'overridden_by_membership_id', gate_record.overridden_by_membership_id,
    'overridden_at', gate_record.overridden_at,
    'gate_state', gate_record.gate_state,
    'gate_version', gate_record.gate_version
  );

  effective_reason := COALESCE(normalized_reason, normalized_action);
  result := pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
    'organization_id', gate_record.organization_id,
    'lead_id', gate_record.lead_id,
    'contract_confirmed', gate_record.contract_confirmed,
    'contract_confirmed_by_membership_id',
      gate_record.contract_confirmed_by_membership_id,
    'contract_confirmed_at', gate_record.contract_confirmed_at,
    'contract_evidence_reference', gate_record.contract_evidence_reference,
    'first_payment_amount', gate_record.first_payment_amount,
    'first_payment_currency', gate_record.first_payment_currency,
    'first_payment_due_date', gate_record.first_payment_due_date,
    'first_payment_received_date', gate_record.first_payment_received_date,
    'first_payment_confirmed_by_membership_id',
      gate_record.first_payment_confirmed_by_membership_id,
    'first_payment_confirmed_at', gate_record.first_payment_confirmed_at,
    'first_payment_evidence_reference',
      gate_record.first_payment_evidence_reference,
    'override_reason', gate_record.override_reason,
    'overridden_by_membership_id', gate_record.overridden_by_membership_id,
    'overridden_at', gate_record.overridden_at,
    'gate_state', gate_record.gate_state,
    'normal_handoff_allowed', gate_record.gate_state = 'satisfied',
    'exceptional_handoff_allowed', gate_record.gate_state = 'overridden',
    'can_confirm_contract',
      private.platform_has_permission(
        gate_record.organization_id,
        'contract.evidence.confirm'
      ) AND NOT gate_record.contract_confirmed,
    'can_confirm_first_payment',
      private.platform_has_permission(
        gate_record.organization_id,
        'finance.first.payment.confirm'
      ) AND gate_record.contract_confirmed
        AND gate_record.first_payment_confirmed_at IS NULL,
    'can_override_gate',
      actor.platform_role = 'admin'
        AND private.platform_has_permission(
          gate_record.organization_id,
          'admissions.handoff.gate.override'
        )
        AND gate_record.gate_state = 'blocked',
    'gate_version', gate_record.gate_version,
    'updated_at', gate_record.updated_at,
    'changed_at', changed_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    created_at,
    actor_membership_id,
    resulting_version
  ) VALUES (
    actor.organization_id,
    'user',
    actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    audit_action,
    'lead',
    p_lead_id,
    before_state,
    after_state,
    effective_reason,
    p_request_id,
    changed_at,
    actor.membership_id,
    gate_record.gate_version
  );

  INSERT INTO platform_private.lead_admissions_gate_receipts (
    request_id,
    organization_id,
    actor_membership_id,
    actor_profile_id,
    lead_id,
    expected_gate_version,
    requested_action,
    requested_amount,
    requested_currency,
    requested_due_date,
    requested_received_date,
    requested_evidence_reference,
    requested_reason,
    resulting_gate_version,
    result,
    created_at
  ) VALUES (
    p_request_id,
    actor.organization_id,
    actor.membership_id,
    actor.profile_id,
    p_lead_id,
    p_expected_gate_version,
    normalized_action,
    p_amount,
    normalized_currency,
    p_due_date,
    p_received_date,
    normalized_evidence_reference,
    normalized_reason,
    gate_record.gate_version,
    result,
    changed_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.mutate_lead_admissions_gate(
  UUID, BIGINT, UUID, TEXT, NUMERIC, TEXT, DATE, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.mutate_lead_admissions_gate(
  UUID, BIGINT, UUID, TEXT, NUMERIC, TEXT, DATE, DATE, TEXT, TEXT
) TO authenticated;

-- #383 must name one of two paths. "normal" accepts only satisfied; the
-- exceptional mode accepts only a currently overridden gate. The row lock is
-- held until the caller's transaction finishes, so handoff cannot race a gate
-- change after this assertion.
CREATE OR REPLACE FUNCTION platform_private.assert_lead_admissions_handoff_gate(
  p_organization_id UUID,
  p_lead_id UUID,
  p_handoff_mode TEXT
)
RETURNS platform.admissions_gate_state
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_mode TEXT;
  current_state platform.admissions_gate_state;
BEGIN
  normalized_mode := pg_catalog.lower(
    NULLIF(pg_catalog.btrim(p_handoff_mode), '')
  );

  IF normalized_mode NOT IN ('normal', 'exceptional_override') THEN
    RAISE EXCEPTION 'admissions_gate_invalid_handoff_mode'
      USING ERRCODE = '22023';
  END IF;

  SELECT gate.gate_state
  INTO current_state
  FROM platform.lead_admissions_gates AS gate
  WHERE gate.organization_id = p_organization_id
    AND gate.lead_id = p_lead_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_gate_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF (normalized_mode = 'normal' AND current_state = 'satisfied')
    OR (
      normalized_mode = 'exceptional_override'
      AND current_state = 'overridden'
    )
  THEN
    RETURN current_state;
  END IF;

  RAISE EXCEPTION 'admissions_gate_handoff_blocked'
    USING ERRCODE = 'PT409';
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.assert_lead_admissions_handoff_gate(UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_u5;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_u5()
      || ARRAY[
        'lead.admissions.gate.contract.confirmed',
        'lead.admissions.gate.firstpayment.confirmed',
        'lead.admissions.gate.overridden'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_u5;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type
    ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_u5()
      || ARRAY['lead']::TEXT[]
  ) AS allowed(resource_type)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_u5;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action IN (
      'lead.admissions.gate.contract.confirmed',
      'lead.admissions.gate.firstpayment.confirmed',
      'lead.admissions.gate.overridden'
    ) THEN ARRAY[
      'contract_confirmation',
      'first_payment_expectation',
      'first_payment_confirmation',
      'gate_state',
      'gate_version'
    ]::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_u5(p_action)
  END
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_u5(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_u5(),
  platform_private.p7a_safe_audit_resource_types(),
  platform_private.p7a_changed_field_codes_pre_u5(TEXT),
  platform_private.p7a_changed_field_codes(TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE platform.lead_admissions_gates IS
  'Canonical U5 contract, first mandatory payment expectation/evidence, and Sales-to-Admissions gate facts.';
COMMENT ON TABLE platform_private.lead_admissions_gate_receipts IS
  'Private append-only U5 idempotency receipts for optimistic gate mutations.';
COMMENT ON FUNCTION platform.staff_lead_admissions_gate(UUID) IS
  'Tenant-scoped staff U5 gate read model with live actor capabilities.';
COMMENT ON FUNCTION platform.mutate_lead_admissions_gate(
  UUID, BIGINT, UUID, TEXT, NUMERIC, TEXT, DATE, DATE, TEXT, TEXT
) IS
  'Atomic, permissioned, version-checked and idempotent U5 gate mutation.';
COMMENT ON FUNCTION
  platform_private.assert_lead_admissions_handoff_gate(UUID, UUID, TEXT) IS
  'Locked #383 boundary: normal requires satisfied; exceptional_override requires overridden.';
COMMENT ON FUNCTION platform.staff_directory(UUID) IS
  'Admin-only staff directory with all three live individual sensitive grants.';

COMMIT;
