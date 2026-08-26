-- ============================================================
-- 092_platform_u10_pilot_cohort_legacy_isolation.sql
--
-- U10: explicit net-new pilot membership on the canonical Student Case.
-- Existing cases are never scanned or backfilled. Automatic membership is
-- derived only while a new canonical case row is being inserted, and every
-- later exception is an audited Admin decision. No legacy/provider relation
-- is read or written by this migration.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION
platform_private.u10_pilot_provenance_is_safe(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    platform_private.bw2_scalar_object_is_bounded(p_value, 16, 4096)
    AND p_value ? 'source'
    AND pg_catalog.jsonb_typeof(p_value -> 'source') = 'string'
    AND pg_catalog.btrim(p_value ->> 'source') = p_value ->> 'source'
    AND pg_catalog.length(p_value ->> 'source') BETWEEN 1 AND 128
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS item(key, value)
      WHERE item.key ~* '(^|[_.-])(token|secret|password|api[_-]?key|authorization|cookie)([_.-]|$)'
        OR (
          pg_catalog.jsonb_typeof(item.value) = 'string'
          AND (item.value #>> '{}') ~ '[[:cntrl:]]'
        )
    )
$$;

CREATE TABLE platform.pilot_cohort_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  configuration_version BIGINT NOT NULL CHECK (configuration_version > 0),
  configuration_state TEXT NOT NULL CHECK (
    configuration_state IN ('active', 'paused')
  ),
  cutoff_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  provenance JSONB NOT NULL CHECK (
    platform_private.u10_pilot_provenance_is_safe(provenance)
  ),
  changed_by_membership_id UUID NOT NULL,
  changed_by_profile_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT pilot_cohort_configurations_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT pilot_cohort_configurations_org_version_key
    UNIQUE (organization_id, configuration_version),
  CONSTRAINT pilot_cohort_configurations_actor_fkey
    FOREIGN KEY (
      organization_id,
      changed_by_membership_id,
      changed_by_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX pilot_cohort_configurations_current_idx
  ON platform.pilot_cohort_configurations (
    organization_id,
    configuration_version DESC,
    id DESC
  );
CREATE INDEX pilot_cohort_configurations_actor_idx
  ON platform.pilot_cohort_configurations (
    organization_id,
    changed_by_membership_id,
    changed_at DESC
  );

ALTER TABLE platform.student_cases
  ADD COLUMN pilot_membership_status TEXT NOT NULL DEFAULT 'outside',
  ADD COLUMN pilot_membership_basis TEXT,
  ADD COLUMN pilot_configuration_id UUID,
  ADD COLUMN pilot_membership_reason TEXT,
  ADD COLUMN pilot_membership_provenance JSONB,
  ADD COLUMN pilot_changed_by_membership_id UUID,
  ADD COLUMN pilot_changed_by_profile_id UUID,
  ADD COLUMN pilot_changed_at TIMESTAMPTZ,
  ADD COLUMN pilot_membership_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pilot_change_request_id UUID;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_pilot_configuration_fkey
    FOREIGN KEY (organization_id, pilot_configuration_id)
    REFERENCES platform.pilot_cohort_configurations(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT student_cases_pilot_actor_fkey
    FOREIGN KEY (
      organization_id,
      pilot_changed_by_membership_id,
      pilot_changed_by_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT student_cases_pilot_request_key
    UNIQUE (pilot_change_request_id),
  ADD CONSTRAINT student_cases_pilot_status_check CHECK (
    pilot_membership_status IN ('outside', 'included', 'excluded')
  ),
  ADD CONSTRAINT student_cases_pilot_basis_check CHECK (
    pilot_membership_basis IS NULL
    OR pilot_membership_basis IN (
      'cutoff_rule',
      'manual_include',
      'manual_exclude'
    )
  ),
  ADD CONSTRAINT student_cases_pilot_reason_check CHECK (
    pilot_membership_reason IS NULL
    OR (
      pilot_membership_reason = pg_catalog.btrim(pilot_membership_reason)
      AND pg_catalog.length(pilot_membership_reason) BETWEEN 1 AND 1000
      AND pilot_membership_reason !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT student_cases_pilot_provenance_check CHECK (
    pilot_membership_provenance IS NULL
    OR platform_private.u10_pilot_provenance_is_safe(
      pilot_membership_provenance
    )
  ),
  ADD CONSTRAINT student_cases_pilot_shape_check CHECK (
    (
      pilot_membership_status = 'outside'
      AND pilot_membership_basis IS NULL
      AND pilot_configuration_id IS NULL
      AND pilot_membership_reason IS NULL
      AND pilot_membership_provenance IS NULL
      AND pilot_changed_by_membership_id IS NULL
      AND pilot_changed_by_profile_id IS NULL
      AND pilot_changed_at IS NULL
      AND pilot_membership_version = 0
      AND pilot_change_request_id IS NULL
    )
    OR (
      pilot_membership_status = 'included'
      AND pilot_membership_basis IN ('cutoff_rule', 'manual_include')
      AND pilot_configuration_id IS NOT NULL
      AND pilot_membership_reason IS NOT NULL
      AND pilot_membership_provenance IS NOT NULL
      AND pilot_changed_by_membership_id IS NOT NULL
      AND pilot_changed_by_profile_id IS NOT NULL
      AND pilot_changed_at IS NOT NULL
      AND pilot_membership_version > 0
      AND pilot_change_request_id IS NOT NULL
    )
    OR (
      pilot_membership_status = 'excluded'
      AND pilot_membership_basis = 'manual_exclude'
      AND pilot_configuration_id IS NOT NULL
      AND pilot_membership_reason IS NOT NULL
      AND pilot_membership_provenance IS NOT NULL
      AND pilot_changed_by_membership_id IS NOT NULL
      AND pilot_changed_by_profile_id IS NOT NULL
      AND pilot_changed_at IS NOT NULL
      AND pilot_membership_version > 0
      AND pilot_change_request_id IS NOT NULL
    )
  );

CREATE INDEX student_cases_pilot_membership_idx
  ON platform.student_cases (
    organization_id,
    pilot_membership_status,
    pilot_changed_at DESC,
    id DESC
  );
CREATE INDEX student_cases_pilot_configuration_idx
  ON platform.student_cases (organization_id, pilot_configuration_id)
  WHERE pilot_configuration_id IS NOT NULL;

CREATE TABLE platform.pilot_cohort_membership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  membership_version BIGINT NOT NULL CHECK (membership_version > 0),
  event_action TEXT NOT NULL CHECK (
    event_action IN (
      'automatic_include',
      'manual_include',
      'manual_exclude'
    )
  ),
  membership_status TEXT NOT NULL CHECK (
    membership_status IN ('included', 'excluded')
  ),
  membership_basis TEXT NOT NULL CHECK (
    membership_basis IN (
      'cutoff_rule',
      'manual_include',
      'manual_exclude'
    )
  ),
  configuration_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  provenance JSONB NOT NULL CHECK (
    platform_private.u10_pilot_provenance_is_safe(provenance)
  ),
  changed_by_membership_id UUID NOT NULL,
  changed_by_profile_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT pilot_cohort_membership_events_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT pilot_cohort_membership_events_case_version_key
    UNIQUE (organization_id, student_case_id, membership_version),
  CONSTRAINT pilot_cohort_membership_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT pilot_cohort_membership_events_configuration_fkey
    FOREIGN KEY (organization_id, configuration_id)
    REFERENCES platform.pilot_cohort_configurations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT pilot_cohort_membership_events_actor_fkey
    FOREIGN KEY (
      organization_id,
      changed_by_membership_id,
      changed_by_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT pilot_cohort_membership_events_action_shape_check CHECK (
    (event_action = 'automatic_include'
      AND membership_status = 'included'
      AND membership_basis = 'cutoff_rule')
    OR (event_action = 'manual_include'
      AND membership_status = 'included'
      AND membership_basis = 'manual_include')
    OR (event_action = 'manual_exclude'
      AND membership_status = 'excluded'
      AND membership_basis = 'manual_exclude')
  )
);

CREATE INDEX pilot_cohort_membership_events_case_history_idx
  ON platform.pilot_cohort_membership_events (
    organization_id,
    student_case_id,
    membership_version DESC,
    id DESC
  );
CREATE INDEX pilot_cohort_membership_events_configuration_idx
  ON platform.pilot_cohort_membership_events (
    organization_id,
    configuration_id,
    changed_at DESC
  );
CREATE INDEX pilot_cohort_membership_events_actor_idx
  ON platform.pilot_cohort_membership_events (
    organization_id,
    changed_by_membership_id,
    changed_at DESC
  );

CREATE TABLE platform_private.pilot_cohort_configuration_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  requested_cutoff_at TIMESTAMPTZ NOT NULL,
  requested_state TEXT NOT NULL CHECK (
    requested_state IN ('active', 'paused')
  ),
  requested_reason TEXT NOT NULL CHECK (
    requested_reason = pg_catalog.btrim(requested_reason)
    AND pg_catalog.length(requested_reason) BETWEEN 1 AND 1000
    AND requested_reason !~ '[[:cntrl:]]'
  ),
  result JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT pilot_cohort_configuration_receipts_actor_fkey
    FOREIGN KEY (
      organization_id,
      actor_membership_id,
      actor_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.pilot_cohort_membership_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  requested_action TEXT NOT NULL CHECK (
    requested_action IN ('include', 'exclude')
  ),
  requested_reason TEXT NOT NULL CHECK (
    requested_reason = pg_catalog.btrim(requested_reason)
    AND pg_catalog.length(requested_reason) BETWEEN 1 AND 1000
    AND requested_reason !~ '[[:cntrl:]]'
  ),
  requested_provenance JSONB NOT NULL CHECK (
    platform_private.u10_pilot_provenance_is_safe(requested_provenance)
  ),
  result JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT pilot_cohort_membership_receipts_actor_fkey
    FOREIGN KEY (
      organization_id,
      actor_membership_id,
      actor_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT pilot_cohort_membership_receipts_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX pilot_cohort_configuration_receipts_actor_idx
  ON platform_private.pilot_cohort_configuration_receipts (
    organization_id,
    actor_membership_id,
    created_at DESC
  );
CREATE INDEX pilot_cohort_membership_receipts_case_idx
  ON platform_private.pilot_cohort_membership_receipts (
    organization_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX pilot_cohort_membership_receipts_actor_idx
  ON platform_private.pilot_cohort_membership_receipts (
    organization_id,
    actor_membership_id,
    created_at DESC
  );

ALTER TABLE platform.pilot_cohort_configurations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.pilot_cohort_configurations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.pilot_cohort_membership_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.pilot_cohort_membership_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.pilot_cohort_configuration_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.pilot_cohort_configuration_receipts
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.pilot_cohort_membership_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.pilot_cohort_membership_receipts
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER pilot_cohort_configurations_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.pilot_cohort_configurations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_configurations_no_truncate
  BEFORE TRUNCATE ON platform.pilot_cohort_configurations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_membership_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.pilot_cohort_membership_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_membership_events_no_truncate
  BEFORE TRUNCATE ON platform.pilot_cohort_membership_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_configuration_receipts_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.pilot_cohort_configuration_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_configuration_receipts_no_truncate
  BEFORE TRUNCATE
  ON platform_private.pilot_cohort_configuration_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_membership_receipts_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.pilot_cohort_membership_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER pilot_cohort_membership_receipts_no_truncate
  BEFORE TRUNCATE
  ON platform_private.pilot_cohort_membership_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Automatic cohort derivation is deliberately INSERT-only. A configuration
-- change never invokes this trigger for rows already present in Student Cases.
CREATE OR REPLACE FUNCTION
platform_private.derive_student_case_pilot_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  configuration RECORD;
  is_exact_net_new BOOLEAN := FALSE;
BEGIN
  SELECT
    config.id,
    config.configuration_version,
    config.cutoff_at,
    config.changed_by_membership_id,
    config.changed_by_profile_id
  INTO configuration
  FROM platform.pilot_cohort_configurations AS config
  WHERE config.organization_id = NEW.organization_id
  ORDER BY config.configuration_version DESC, config.id DESC
  LIMIT 1;

  IF NOT FOUND OR configuration.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the latest active configuration enables automatic entry. Pausing
  -- writes a newer immutable version, so old active rows cannot keep acting.
  IF NOT EXISTS (
    SELECT 1
    FROM platform.pilot_cohort_configurations AS config
    WHERE config.organization_id = NEW.organization_id
      AND config.id = configuration.id
      AND config.configuration_state = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT TRUE
  INTO is_exact_net_new
  FROM platform.clients AS client
  JOIN platform.leads AS lead
    ON lead.organization_id = client.organization_id
    AND lead.client_id = client.id
  WHERE client.organization_id = NEW.organization_id
    AND client.id = NEW.canonical_client_id
    AND lead.id = NEW.canonical_lead_id
    AND NEW.canonical_client_id IS NOT NULL
    AND NEW.canonical_lead_id IS NOT NULL
    AND NEW.source_key =
      'canonical-lead:' || NEW.canonical_lead_id::TEXT
    AND client.created_at >= configuration.cutoff_at
    AND lead.created_at >= configuration.cutoff_at
    AND NEW.created_at >= configuration.cutoff_at
  LIMIT 1;

  IF COALESCE(is_exact_net_new, FALSE) THEN
    NEW.pilot_membership_status := 'included';
    NEW.pilot_membership_basis := 'cutoff_rule';
    NEW.pilot_configuration_id := configuration.id;
    NEW.pilot_membership_reason :=
      'Eligible by the configured net-new cutoff';
    NEW.pilot_membership_provenance := pg_catalog.jsonb_build_object(
      'source', 'automatic_cutoff',
      'configuration_id', configuration.id,
      'configuration_version', configuration.configuration_version,
      'cutoff_at', configuration.cutoff_at,
      'source_key', NEW.source_key
    );
    NEW.pilot_changed_by_membership_id :=
      configuration.changed_by_membership_id;
    NEW.pilot_changed_by_profile_id := configuration.changed_by_profile_id;
    NEW.pilot_changed_at := statement_timestamp();
    NEW.pilot_membership_version := 1;
    NEW.pilot_change_request_id := pg_catalog.gen_random_uuid();
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION
platform_private.record_automatic_pilot_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  configuration_version BIGINT;
BEGIN
  IF NEW.pilot_membership_status <> 'included'
    OR NEW.pilot_membership_basis <> 'cutoff_rule'
  THEN
    RETURN NEW;
  END IF;

  SELECT config.configuration_version
  INTO STRICT configuration_version
  FROM platform.pilot_cohort_configurations AS config
  WHERE config.organization_id = NEW.organization_id
    AND config.id = NEW.pilot_configuration_id;

  INSERT INTO platform.pilot_cohort_membership_events (
    organization_id,
    student_case_id,
    membership_version,
    event_action,
    membership_status,
    membership_basis,
    configuration_id,
    reason,
    provenance,
    changed_by_membership_id,
    changed_by_profile_id,
    request_id,
    changed_at
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    NEW.pilot_membership_version,
    'automatic_include',
    NEW.pilot_membership_status,
    NEW.pilot_membership_basis,
    NEW.pilot_configuration_id,
    NEW.pilot_membership_reason,
    NEW.pilot_membership_provenance,
    NEW.pilot_changed_by_membership_id,
    NEW.pilot_changed_by_profile_id,
    NEW.pilot_change_request_id,
    NEW.pilot_changed_at
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
    resulting_version
  ) VALUES (
    NEW.organization_id,
    'system',
    NULL,
    'platform.u10.automatic',
    'pilot.cohort.member.automatic',
    'pilot_cohort_membership',
    NEW.id,
    pg_catalog.jsonb_build_object(
      'membership_status', 'outside',
      'membership_version', 0
    ),
    pg_catalog.jsonb_build_object(
      'membership_status', NEW.pilot_membership_status,
      'membership_basis', NEW.pilot_membership_basis,
      'configuration_id', NEW.pilot_configuration_id,
      'configuration_version', configuration_version,
      'membership_version', NEW.pilot_membership_version
    ),
    'Automatic inclusion from configured net-new cutoff',
    NEW.pilot_change_request_id,
    NEW.pilot_membership_version
  );

  RETURN NEW;
END
$$;

CREATE TRIGGER student_cases_pilot_cohort_derive
  BEFORE INSERT ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.derive_student_case_pilot_membership();

CREATE TRIGGER student_cases_pilot_cohort_record
  AFTER INSERT ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.record_automatic_pilot_membership();

CREATE OR REPLACE FUNCTION platform.configure_pilot_cohort(
  p_organization_id UUID,
  p_cutoff_at TIMESTAMPTZ,
  p_state TEXT,
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
  prior_receipt RECORD;
  normalized_state TEXT;
  normalized_reason TEXT;
  next_version BIGINT;
  created_configuration_id UUID;
  changed_at TIMESTAMPTZ;
  changed_by_name TEXT;
  provenance JSONB;
  result JSONB;
BEGIN
  normalized_state := pg_catalog.lower(pg_catalog.btrim(p_state));
  normalized_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_cutoff_at IS NULL
    OR p_request_id IS NULL
    OR normalized_state IS NULL
    OR normalized_state NOT IN ('active', 'paused')
    OR normalized_reason IS NULL
    OR pg_catalog.length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Organization, cutoff, active/paused state, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO STRICT actor
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'scope.manage'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u10:pilot-config:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.pilot_cohort_configuration_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id IS DISTINCT FROM p_organization_id
      OR prior_receipt.actor_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR prior_receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR prior_receipt.requested_cutoff_at IS DISTINCT FROM p_cutoff_at
      OR prior_receipt.requested_state IS DISTINCT FROM normalized_state
      OR prior_receipt.requested_reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'pilot_configuration_request_id_conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN prior_receipt.result
      || pg_catalog.jsonb_build_object('replayed', TRUE);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'pilot_configuration_request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  -- Serializing on the organization makes version assignment deterministic.
  PERFORM 1
  FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id
    AND organization.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active pilot organization is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(config.configuration_version), 0) + 1
  INTO next_version
  FROM platform.pilot_cohort_configurations AS config
  WHERE config.organization_id = p_organization_id;

  SELECT profile.display_name
  INTO STRICT changed_by_name
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id;

  changed_at := statement_timestamp();
  created_configuration_id := pg_catalog.gen_random_uuid();
  provenance := pg_catalog.jsonb_build_object(
    'source', 'staff_configuration',
    'request_id', p_request_id,
    'configuration_version', next_version
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'request_id', p_request_id,
    'configuration_id', created_configuration_id,
    'version', next_version,
    'state', normalized_state,
    'cutoff_at', p_cutoff_at,
    'reason', normalized_reason,
    'provenance', provenance,
    'changed_by_membership_id', actor.actor_membership_id,
    'changed_by_name', changed_by_name,
    'changed_at', changed_at,
    'replayed', FALSE
  );

  INSERT INTO platform.pilot_cohort_configurations (
    id,
    organization_id,
    configuration_version,
    configuration_state,
    cutoff_at,
    reason,
    provenance,
    changed_by_membership_id,
    changed_by_profile_id,
    request_id,
    changed_at
  ) VALUES (
    created_configuration_id,
    p_organization_id,
    next_version,
    normalized_state,
    p_cutoff_at,
    normalized_reason,
    provenance,
    actor.actor_membership_id,
    actor.actor_profile_id,
    p_request_id,
    changed_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    resulting_version
  ) VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id::TEXT,
    'pilot.cohort.configured',
    'pilot_cohort_configuration',
    created_configuration_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'configuration_version', next_version,
      'configuration_state', normalized_state,
      'cutoff_at', p_cutoff_at
    ),
    normalized_reason,
    p_request_id,
    next_version
  );

  INSERT INTO platform_private.pilot_cohort_configuration_receipts (
    request_id,
    organization_id,
    actor_membership_id,
    actor_profile_id,
    requested_cutoff_at,
    requested_state,
    requested_reason,
    result
  ) VALUES (
    p_request_id,
    p_organization_id,
    actor.actor_membership_id,
    actor.actor_profile_id,
    p_cutoff_at,
    normalized_state,
    normalized_reason,
    result
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.set_student_case_pilot_membership(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_membership_action TEXT,
  p_reason TEXT,
  p_provenance JSONB,
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
  prior_receipt RECORD;
  target_case RECORD;
  current_configuration RECORD;
  has_configuration BOOLEAN := FALSE;
  normalized_action TEXT;
  normalized_reason TEXT;
  next_status TEXT;
  next_basis TEXT;
  event_action TEXT;
  next_version BIGINT;
  created_event_id UUID;
  changed_at TIMESTAMPTZ;
  changed_by_name TEXT;
  before_state JSONB;
  result JSONB;
BEGIN
  normalized_action := pg_catalog.lower(
    pg_catalog.btrim(p_membership_action)
  );
  normalized_reason := pg_catalog.btrim(p_reason);

  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_request_id IS NULL
    OR normalized_action IS NULL
    OR normalized_action NOT IN ('include', 'exclude')
    OR normalized_reason IS NULL
    OR pg_catalog.length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
    OR p_provenance IS NULL
    OR NOT platform_private.u10_pilot_provenance_is_safe(p_provenance)
    OR p_provenance = '{}'::JSONB
  THEN
    RAISE EXCEPTION
      'Organization, case, include/exclude action, reason, bounded provenance and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO STRICT actor
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'scope.manage'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u10:pilot-membership:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.pilot_cohort_membership_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id IS DISTINCT FROM p_organization_id
      OR prior_receipt.actor_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR prior_receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR prior_receipt.student_case_id IS DISTINCT FROM p_student_case_id
      OR prior_receipt.requested_action IS DISTINCT FROM normalized_action
      OR prior_receipt.requested_reason IS DISTINCT FROM normalized_reason
      OR prior_receipt.requested_provenance IS DISTINCT FROM p_provenance
    THEN
      RAISE EXCEPTION 'pilot_membership_request_id_conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN prior_receipt.result
      || pg_catalog.jsonb_build_object('replayed', TRUE);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'pilot_membership_request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  SELECT student_case.*
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pilot Student Case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    config.id,
    config.configuration_version,
    config.configuration_state,
    config.cutoff_at
  INTO current_configuration
  FROM platform.pilot_cohort_configurations AS config
  WHERE config.organization_id = p_organization_id
  ORDER BY config.configuration_version DESC, config.id DESC
  LIMIT 1;
  has_configuration := FOUND;

  IF NOT has_configuration THEN
    RAISE EXCEPTION 'Pilot configuration is required before manual membership'
      USING ERRCODE = '55000';
  END IF;

  IF normalized_action = 'include' THEN
    next_status := 'included';
    next_basis := 'manual_include';
    event_action := 'manual_include';
  ELSE
    next_status := 'excluded';
    next_basis := 'manual_exclude';
    event_action := 'manual_exclude';
  END IF;

  next_version := target_case.pilot_membership_version + 1;
  created_event_id := pg_catalog.gen_random_uuid();
  changed_at := statement_timestamp();

  SELECT profile.display_name
  INTO STRICT changed_by_name
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id;

  before_state := pg_catalog.jsonb_build_object(
    'membership_status', target_case.pilot_membership_status,
    'membership_basis', target_case.pilot_membership_basis,
    'configuration_id', target_case.pilot_configuration_id,
    'membership_version', target_case.pilot_membership_version
  );

  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'request_id', p_request_id,
    'student_case_id', p_student_case_id,
    'event_id', created_event_id,
    'membership_status', next_status,
    'membership_basis', next_basis,
    'reason', normalized_reason,
    'provenance', p_provenance,
    'changed_by_membership_id', actor.actor_membership_id,
    'changed_by_name', changed_by_name,
    'changed_at', changed_at,
    'replayed', FALSE
  );

  UPDATE platform.student_cases AS student_case
  SET
    pilot_membership_status = next_status,
    pilot_membership_basis = next_basis,
    pilot_configuration_id = current_configuration.id,
    pilot_membership_reason = normalized_reason,
    pilot_membership_provenance = p_provenance,
    pilot_changed_by_membership_id = actor.actor_membership_id,
    pilot_changed_by_profile_id = actor.actor_profile_id,
    pilot_changed_at = changed_at,
    pilot_membership_version = next_version,
    pilot_change_request_id = p_request_id
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  INSERT INTO platform.pilot_cohort_membership_events (
    id,
    organization_id,
    student_case_id,
    membership_version,
    event_action,
    membership_status,
    membership_basis,
    configuration_id,
    reason,
    provenance,
    changed_by_membership_id,
    changed_by_profile_id,
    request_id,
    changed_at
  ) VALUES (
    created_event_id,
    p_organization_id,
    p_student_case_id,
    next_version,
    event_action,
    next_status,
    next_basis,
    current_configuration.id,
    normalized_reason,
    p_provenance,
    actor.actor_membership_id,
    actor.actor_profile_id,
    p_request_id,
    changed_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    resulting_version
  ) VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id::TEXT,
    CASE normalized_action
      WHEN 'include' THEN 'pilot.cohort.member.included'
      ELSE 'pilot.cohort.member.excluded'
    END,
    'pilot_cohort_membership',
    p_student_case_id,
    before_state,
    pg_catalog.jsonb_build_object(
      'membership_status', next_status,
      'membership_basis', next_basis,
      'configuration_id', current_configuration.id,
      'membership_version', next_version
    ),
    normalized_reason,
    p_request_id,
    next_version
  );

  INSERT INTO platform_private.pilot_cohort_membership_receipts (
    request_id,
    organization_id,
    actor_membership_id,
    actor_profile_id,
    student_case_id,
    requested_action,
    requested_reason,
    requested_provenance,
    result
  ) VALUES (
    p_request_id,
    p_organization_id,
    actor.actor_membership_id,
    actor.actor_profile_id,
    p_student_case_id,
    normalized_action,
    normalized_reason,
    p_provenance,
    result
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_pilot_write_boundary(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_target TEXT
)
RETURNS TABLE (
  requested_target TEXT,
  allowed BOOLEAN,
  reason_code TEXT,
  authority TEXT,
  fallback_allowed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_target TEXT;
  target_membership_status TEXT;
BEGIN
  normalized_target := pg_catalog.lower(pg_catalog.btrim(p_target));

  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR normalized_target IS NULL
    OR pg_catalog.length(normalized_target) NOT BETWEEN 1 AND 64
    OR normalized_target !~ '^[a-z][a-z0-9_.-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Organization, Student Case and bounded target are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT student_case.pilot_membership_status
  INTO target_membership_status
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
  LIMIT 1;

  IF target_membership_status IS NULL THEN
    RAISE EXCEPTION 'Pilot Student Case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  requested_target := normalized_target;
  authority := 'evo_supabase_only';
  fallback_allowed := FALSE;

  IF normalized_target <> 'evo_supabase' THEN
    allowed := FALSE;
    reason_code := 'legacy_write_forbidden';
  ELSIF target_membership_status = 'included' THEN
    allowed := TRUE;
    reason_code := 'canonical_write_allowed';
  ELSIF target_membership_status = 'excluded' THEN
    allowed := FALSE;
    reason_code := 'pilot_membership_excluded';
  ELSE
    allowed := FALSE;
    reason_code := 'pilot_membership_required';
  END IF;

  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_pilot_cohort(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_history_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  organization_id UUID,
  student_case_id UUID,
  membership_status TEXT,
  membership_basis TEXT,
  reason TEXT,
  provenance JSONB,
  changed_by_membership_id UUID,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ,
  configuration JSONB,
  counts JSONB,
  history JSONB,
  write_boundary JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case RECORD;
  current_configuration RECORD;
  has_configuration BOOLEAN := FALSE;
  history_payload JSONB;
  counts_payload JSONB;
  boundary_payload JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_history_limit IS NULL
    OR p_history_limit NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION
      'Organization, Student Case and history limit from 1 to 100 are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    student_case.*,
    changed_by.display_name AS changed_by_name
  INTO target_case
  FROM platform.student_cases AS student_case
  LEFT JOIN platform.profiles AS changed_by
    ON changed_by.id = student_case.pilot_changed_by_profile_id
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pilot Student Case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    config.*,
    config_actor.display_name AS changed_by_name
  INTO current_configuration
  FROM platform.pilot_cohort_configurations AS config
  JOIN platform.profiles AS config_actor
    ON config_actor.id = config.changed_by_profile_id
  WHERE config.organization_id = p_organization_id
  ORDER BY config.configuration_version DESC, config.id DESC
  LIMIT 1;
  has_configuration := FOUND;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(event_payload.payload ORDER BY event_payload.membership_version DESC),
    '[]'::JSONB
  )
  INTO history_payload
  FROM (
    SELECT
      event.membership_version,
      pg_catalog.jsonb_build_object(
        'event_id', event.id,
        'action', event.event_action,
        'basis', event.membership_basis,
        'reason', event.reason,
        'provenance', event.provenance,
        'changed_by_membership_id', event.changed_by_membership_id,
        'changed_by_name', event_actor.display_name,
        'changed_at', event.changed_at
      ) AS payload
    FROM platform.pilot_cohort_membership_events AS event
    JOIN platform.profiles AS event_actor
      ON event_actor.id = event.changed_by_profile_id
    WHERE event.organization_id = p_organization_id
      AND event.student_case_id = p_student_case_id
    ORDER BY event.membership_version DESC, event.id DESC
    LIMIT p_history_limit
  ) AS event_payload;

  SELECT pg_catalog.jsonb_build_object(
    'outside', COUNT(*) FILTER (
      WHERE student_case.pilot_membership_status = 'outside'
    ),
    'included', COUNT(*) FILTER (
      WHERE student_case.pilot_membership_status = 'included'
    ),
    'excluded', COUNT(*) FILTER (
      WHERE student_case.pilot_membership_status = 'excluded'
    ),
    'total', COUNT(*)
  )
  INTO counts_payload
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id;

  boundary_payload := pg_catalog.jsonb_build_object(
    'requested_target', 'evo_supabase',
    'allowed', target_case.pilot_membership_status = 'included',
    'reason_code', CASE target_case.pilot_membership_status
      WHEN 'included' THEN 'canonical_write_allowed'
      WHEN 'excluded' THEN 'pilot_membership_excluded'
      ELSE 'pilot_membership_required'
    END,
    'authority', 'evo_supabase_only',
    'fallback_allowed', FALSE
  );

  organization_id := p_organization_id;
  student_case_id := p_student_case_id;
  membership_status := target_case.pilot_membership_status;
  membership_basis := target_case.pilot_membership_basis;
  reason := target_case.pilot_membership_reason;
  provenance := target_case.pilot_membership_provenance;
  changed_by_membership_id := target_case.pilot_changed_by_membership_id;
  changed_by_name := target_case.changed_by_name;
  changed_at := target_case.pilot_changed_at;
  configuration := CASE
    WHEN NOT has_configuration THEN NULL
    ELSE pg_catalog.jsonb_build_object(
      'configuration_id', current_configuration.id,
      'version', current_configuration.configuration_version,
      'state', current_configuration.configuration_state,
      'cutoff_at', current_configuration.cutoff_at,
      'reason', current_configuration.reason,
      'provenance', current_configuration.provenance,
      'changed_by_membership_id',
        current_configuration.changed_by_membership_id,
      'changed_by_name', current_configuration.changed_by_name,
      'changed_at', current_configuration.changed_at
    )
  END;
  counts := counts_payload;
  history := history_payload;
  write_boundary := boundary_payload;

  RETURN NEXT;
END
$$;

-- Compose with U9's safe audit projection. The projection reveals only fixed
-- action/resource codes and changed-field codes; raw reason/provenance remains
-- inside the tenant-bound cohort read.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_u10;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_u10()
      || ARRAY[
        'pilot.cohort.configured',
        'pilot.cohort.member.automatic',
        'pilot.cohort.member.included',
        'pilot.cohort.member.excluded'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_u10;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(
    DISTINCT allowed.resource_type
    ORDER BY allowed.resource_type
  )
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_u10()
      || ARRAY[
        'pilot_cohort_configuration',
        'pilot_cohort_membership'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_u10;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action = 'pilot.cohort.configured' THEN
      ARRAY['pilot_configuration', 'pilot_cutoff']::TEXT[]
    WHEN p_action IN (
      'pilot.cohort.member.automatic',
      'pilot.cohort.member.included',
      'pilot.cohort.member.excluded'
    ) THEN ARRAY['pilot_membership', 'pilot_write_boundary']::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_u10(p_action)
  END
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform.pilot_cohort_configurations,
  platform.pilot_cohort_membership_events,
  platform_private.pilot_cohort_configuration_receipts,
  platform_private.pilot_cohort_membership_receipts
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.u10_pilot_provenance_is_safe(JSONB),
  platform_private.derive_student_case_pilot_membership(),
  platform_private.record_automatic_pilot_membership(),
  platform_private.p7a_safe_audit_actions_pre_u10(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_u10(),
  platform_private.p7a_safe_audit_resource_types(),
  platform_private.p7a_changed_field_codes_pre_u10(TEXT),
  platform_private.p7a_changed_field_codes(TEXT),
  platform.configure_pilot_cohort(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID),
  platform.set_student_case_pilot_membership(
    UUID,
    UUID,
    TEXT,
    TEXT,
    JSONB,
    UUID
  ),
  platform.staff_student_case_pilot_cohort(UUID, UUID, INTEGER),
  platform.staff_pilot_write_boundary(UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.configure_pilot_cohort(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID),
  platform.set_student_case_pilot_membership(
    UUID,
    UUID,
    TEXT,
    TEXT,
    JSONB,
    UUID
  ),
  platform.staff_student_case_pilot_cohort(UUID, UUID, INTEGER),
  platform.staff_pilot_write_boundary(UUID, UUID, TEXT)
TO authenticated;

COMMENT ON TABLE platform.pilot_cohort_configurations IS
  'Append-only U10 organization configuration history; only the latest version controls new-case automatic entry.';
COMMENT ON TABLE platform.pilot_cohort_membership_events IS
  'Append-only U10 Student Case pilot membership history; exclusion never removes prior inclusion evidence.';
COMMENT ON COLUMN platform.student_cases.pilot_membership_status IS
  'Canonical U10 current pilot state: outside, included or excluded; existing cases default outside without backfill.';
COMMENT ON FUNCTION platform.configure_pilot_cohort(
  UUID,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  UUID
) IS
  'Admin-only append-only active/paused pilot configuration with exact request replay.';
COMMENT ON FUNCTION platform.set_student_case_pilot_membership(
  UUID,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  UUID
) IS
  'Admin-only manual include/exclude with bounded provenance, append-only history and exact request replay.';
COMMENT ON FUNCTION platform.staff_student_case_pilot_cohort(
  UUID,
  UUID,
  INTEGER
) IS
  'Tenant-bound one-row U10 case membership/config/count/history/write-boundary projection.';
COMMENT ON FUNCTION platform.staff_pilot_write_boundary(UUID, UUID, TEXT) IS
  'Tenant-bound truthful U10 evaluator: only included cases targeting evo_supabase are allowed; fallback is always false.';

COMMIT;
