-- ============================================================
-- 088_platform_sales_admissions_handoff.sql
--
-- U6: one audited, idempotent and tenant-bound Sales-to-Admissions handoff.
-- The handoff consumes U5's locked gate and creates or activates exactly one
-- canonical Admissions case without claiming Student Portal activation.
-- ============================================================

BEGIN;

-- A U6 case may exist before a Student Portal account and before U7 collects
-- the complete study route. Null means "not collected yet"; it is never a
-- placeholder fact.
ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_state_shape_check,
  ALTER COLUMN student_membership_id DROP NOT NULL,
  ALTER COLUMN contract_confirmation_ref DROP NOT NULL,
  ALTER COLUMN contract_confirmed_at DROP NOT NULL,
  ALTER COLUMN target_country DROP NOT NULL,
  ALTER COLUMN target_degree DROP NOT NULL;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_state_shape_check CHECK (
    (
      state = 'pending'
      AND current_curator_membership_id IS NULL
      AND handoff_at IS NULL
      AND portal_activated_at IS NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'active'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'closed'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND closed_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT student_cases_portal_membership_shape_check CHECK (
    portal_activated_at IS NULL OR student_membership_id IS NOT NULL
  ),
  ADD CONSTRAINT student_cases_contract_confirmation_shape_check CHECK (
    (contract_confirmation_ref IS NULL) = (contract_confirmed_at IS NULL)
  );

-- The lead binding, not a browser-local check, is the canonical duplicate
-- guard. A completed U6 handoff remains the lead's canonical Admissions case;
-- U6 never silently reopens a closed case or creates a second lifecycle.
CREATE UNIQUE INDEX student_cases_one_open_case_per_canonical_lead_idx
  ON platform.student_cases (organization_id, canonical_lead_id)
  WHERE canonical_lead_id IS NOT NULL
    AND state IN ('pending', 'active');

ALTER TABLE platform.case_tasks
  ADD COLUMN source_key TEXT,
  ADD CONSTRAINT case_tasks_source_key_check CHECK (
    source_key IS NULL
    OR (
      source_key = pg_catalog.lower(pg_catalog.btrim(source_key))
      AND source_key ~ '^[a-z][a-z0-9_.-]{0,127}$'
    )
  );

CREATE UNIQUE INDEX case_tasks_case_source_key_idx
  ON platform.case_tasks (organization_id, student_case_id, source_key)
  WHERE source_key IS NOT NULL;

DROP TRIGGER case_tasks_identity_immutable ON platform.case_tasks;
CREATE TRIGGER case_tasks_identity_immutable
  BEFORE UPDATE ON platform.case_tasks
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'created_by_membership_id',
    'source_key'
  );

CREATE TABLE platform.sales_admissions_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL,
  client_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  source_key TEXT NOT NULL CHECK (
    source_key = pg_catalog.lower(pg_catalog.btrim(source_key))
    AND source_key ~ '^canonical-lead:[0-9a-f-]{36}$'
  ),
  handoff_mode TEXT NOT NULL CHECK (
    handoff_mode IN ('normal', 'exceptional_override')
  ),
  handoff_state TEXT NOT NULL DEFAULT 'completed' CHECK (
    handoff_state = 'completed'
  ),
  handoff_source TEXT NOT NULL DEFAULT 'canonical_sales' CHECK (
    handoff_source = 'canonical_sales'
  ),
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  admissions_owner_membership_id UUID NOT NULL,
  gate_version BIGINT NOT NULL CHECK (gate_version > 0),
  gate_state platform.admissions_gate_state NOT NULL,
  workflow_version BIGINT NOT NULL CHECK (workflow_version > 0),
  sales_context JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(sales_context) = 'object'
  ),
  client_context JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(client_context) = 'object'
  ),
  provenance JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(provenance) = 'array'
  ),
  conversation_links JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(conversation_links) = 'array'
  ),
  handed_off_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sales_admissions_handoffs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT sales_admissions_handoffs_one_per_lead_key
    UNIQUE (organization_id, lead_id),
  CONSTRAINT sales_admissions_handoffs_one_per_case_key
    UNIQUE (organization_id, student_case_id),
  CONSTRAINT sales_admissions_handoffs_source_key
    UNIQUE (organization_id, source_key),
  CONSTRAINT sales_admissions_handoffs_lead_fkey
    FOREIGN KEY (organization_id, client_id, lead_id)
    REFERENCES platform.leads(organization_id, client_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_admissions_handoffs_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_admissions_handoffs_actor_fkey
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
  CONSTRAINT sales_admissions_handoffs_owner_fkey
    FOREIGN KEY (organization_id, admissions_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX sales_admissions_handoffs_actor_idx
  ON platform.sales_admissions_handoffs (
    organization_id,
    actor_membership_id,
    handed_off_at DESC
  );
CREATE INDEX sales_admissions_handoffs_owner_idx
  ON platform.sales_admissions_handoffs (
    organization_id,
    admissions_owner_membership_id,
    handed_off_at DESC
  );

CREATE TABLE platform_private.sales_admissions_handoff_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  expected_gate_version BIGINT NOT NULL CHECK (expected_gate_version > 0),
  admissions_owner_membership_id UUID NOT NULL,
  handoff_mode TEXT NOT NULL CHECK (
    handoff_mode IN ('normal', 'exceptional_override')
  ),
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  student_case_id UUID NOT NULL,
  handoff_id UUID NOT NULL,
  result JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sales_admissions_handoff_receipts_actor_fkey
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
  CONSTRAINT sales_admissions_handoff_receipts_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_admissions_handoff_receipts_owner_fkey
    FOREIGN KEY (organization_id, admissions_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_admissions_handoff_receipts_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_admissions_handoff_receipts_handoff_fkey
    FOREIGN KEY (organization_id, handoff_id)
    REFERENCES platform.sales_admissions_handoffs(organization_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE platform.sales_admissions_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.sales_admissions_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_admissions_handoff_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_admissions_handoff_receipts
  FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_admissions_handoffs_full_case_read
  ON platform.sales_admissions_handoffs
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE TRIGGER sales_admissions_handoffs_append_only
  BEFORE UPDATE OR DELETE ON platform.sales_admissions_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_admissions_handoffs_no_truncate
  BEFORE TRUNCATE ON platform.sales_admissions_handoffs
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_admissions_handoff_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.sales_admissions_handoff_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_admissions_handoff_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.sales_admissions_handoff_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.u6_eligible_admissions_owners(
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(owner.item ORDER BY owner.sort_label, owner.membership_id),
    '[]'::JSONB
  )
  FROM (
    SELECT
      pg_catalog.lower(profile.display_name) AS sort_label,
      membership.id AS membership_id,
      pg_catalog.jsonb_build_object(
        'membership_id', membership.id,
        'display_name', profile.display_name
      ) AS item
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" = 'curator'
      AND profile.status = 'active'
      AND bundle.status = 'published'
    ORDER BY pg_catalog.lower(profile.display_name), membership.id
    LIMIT 100
  ) AS owner
$$;

REVOKE ALL ON FUNCTION
  platform_private.u6_eligible_admissions_owners(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.u6_handoff_result(
  p_organization_id UUID,
  p_lead_id UUID,
  p_request_id UUID,
  p_changed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'organization_id', handoff.organization_id,
    'lead_id', handoff.lead_id,
    'gate_version', handoff.gate_version,
    'gate_state', handoff.gate_state,
    'normal_handoff_allowed', handoff.gate_state = 'satisfied',
    'exceptional_handoff_allowed', handoff.gate_state = 'overridden',
    'can_submit_normal', FALSE,
    'can_submit_exceptional', FALSE,
    'case_id', handoff.student_case_id,
    'case_state', student_case.state,
    'admissions_owner_membership_id', handoff.admissions_owner_membership_id,
    'admissions_owner_display_name', owner_profile.display_name,
    'handoff_mode', handoff.handoff_mode,
    'handoff_reason', handoff.reason,
    'handed_off_at', handoff.handed_off_at,
    'starter_task_count', (
      SELECT pg_catalog.count(*)
      FROM platform.case_tasks AS task
      WHERE task.organization_id = handoff.organization_id
        AND task.student_case_id = handoff.student_case_id
        AND task.source_key LIKE 'u6.%'
    ),
    'eligible_admissions_owners',
      platform_private.u6_eligible_admissions_owners(handoff.organization_id),
    'request_id', p_request_id,
    'changed_at', p_changed_at
  )
  FROM platform.sales_admissions_handoffs AS handoff
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = handoff.organization_id
    AND student_case.id = handoff.student_case_id
  JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = handoff.organization_id
    AND owner_membership.id = handoff.admissions_owner_membership_id
  JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  WHERE handoff.organization_id = p_organization_id
    AND handoff.lead_id = p_lead_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION platform_private.u6_handoff_result(
  UUID, UUID, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_lead_admissions_handoff(
  p_lead_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  lead_id UUID,
  gate_version BIGINT,
  gate_state platform.admissions_gate_state,
  normal_handoff_allowed BOOLEAN,
  exceptional_handoff_allowed BOOLEAN,
  can_submit_normal BOOLEAN,
  can_submit_exceptional BOOLEAN,
  case_id UUID,
  case_state platform.student_case_state,
  admissions_owner_membership_id UUID,
  admissions_owner_display_name TEXT,
  handoff_mode TEXT,
  handoff_reason TEXT,
  handed_off_at TIMESTAMPTZ,
  starter_task_count BIGINT,
  eligible_admissions_owners JSONB
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
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    lead.organization_id,
    lead.id,
    gate.gate_version,
    gate.gate_state,
    gate.gate_state = 'satisfied',
    gate.gate_state = 'overridden',
    handoff.id IS NULL
      AND lead.lifecycle_state = 'open'
      AND client.lifecycle_state = 'active'
      AND lead.stage_key = 'qualified'
      AND lead.current_owner_membership_id IS NOT NULL
      AND gate.gate_state = 'satisfied'
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
      ),
    handoff.id IS NULL
      AND actor.platform_role = 'admin'
      AND lead.lifecycle_state = 'open'
      AND client.lifecycle_state = 'active'
      AND lead.stage_key = 'qualified'
      AND gate.gate_state = 'overridden',
    handoff.student_case_id,
    student_case.state,
    handoff.admissions_owner_membership_id,
    owner_profile.display_name,
    handoff.handoff_mode,
    handoff.reason,
    handoff.handed_off_at,
    CASE
      WHEN handoff.id IS NULL THEN 0::BIGINT
      ELSE (
        SELECT pg_catalog.count(*)
        FROM platform.case_tasks AS task
        WHERE task.organization_id = handoff.organization_id
          AND task.student_case_id = handoff.student_case_id
          AND task.source_key LIKE 'u6.%'
      )
    END,
    platform_private.u6_eligible_admissions_owners(lead.organization_id)
  FROM platform.leads AS lead
  JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id
    AND client.id = lead.client_id
  JOIN platform.lead_admissions_gates AS gate
    ON gate.organization_id = lead.organization_id
    AND gate.lead_id = lead.id
  LEFT JOIN platform.sales_admissions_handoffs AS handoff
    ON handoff.organization_id = lead.organization_id
    AND handoff.lead_id = lead.id
  LEFT JOIN platform.student_cases AS student_case
    ON student_case.organization_id = handoff.organization_id
    AND student_case.id = handoff.student_case_id
  LEFT JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = handoff.organization_id
    AND owner_membership.id = handoff.admissions_owner_membership_id
  LEFT JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  WHERE lead.organization_id = actor.organization_id
    AND lead.id = p_lead_id
    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
    )
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_lead_admissions_handoff(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_lead_admissions_handoff(UUID)
TO authenticated;

CREATE OR REPLACE FUNCTION platform.staff_student_case_handoff_context(
  p_student_case_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  lead_id UUID,
  student_case_id UUID,
  case_state platform.student_case_state,
  handoff_mode TEXT,
  handoff_state TEXT,
  handoff_reason TEXT,
  handoff_source TEXT,
  handed_off_at TIMESTAMPTZ,
  actor_membership_id UUID,
  actor_display_name TEXT,
  admissions_owner_membership_id UUID,
  admissions_owner_display_name TEXT,
  gate_version BIGINT,
  gate_state platform.admissions_gate_state,
  workflow_version BIGINT,
  sales_context JSONB,
  client_context JSONB,
  provenance JSONB,
  conversation_links JSONB,
  starter_tasks JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'admissions_handoff_context_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'case.read.full'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_context_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    handoff.organization_id,
    handoff.lead_id,
    handoff.student_case_id,
    student_case.state,
    handoff.handoff_mode,
    handoff.handoff_state,
    handoff.reason,
    handoff.handoff_source,
    handoff.handed_off_at,
    handoff.actor_membership_id,
    actor_profile.display_name,
    handoff.admissions_owner_membership_id,
    owner_profile.display_name,
    handoff.gate_version,
    handoff.gate_state,
    handoff.workflow_version,
    handoff.sales_context,
    handoff.client_context,
    handoff.provenance,
    handoff.conversation_links,
    COALESCE(task_projection.items, '[]'::JSONB)
  FROM platform.sales_admissions_handoffs AS handoff
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = handoff.organization_id
    AND student_case.id = handoff.student_case_id
  JOIN platform.organization_memberships AS actor_membership
    ON actor_membership.organization_id = handoff.organization_id
    AND actor_membership.id = handoff.actor_membership_id
  JOIN platform.profiles AS actor_profile
    ON actor_profile.id = actor_membership.profile_id
  JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = handoff.organization_id
    AND owner_membership.id = handoff.admissions_owner_membership_id
  JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'task_id', task.id,
        'source_key', task.source_key,
        'title', task.title,
        'assignee_membership_id', task.assignee_membership_id,
        'assignee_display_name', assignee_profile.display_name,
        'priority', task.priority,
        'due_at', task.due_at,
        'status', task.status
      )
      ORDER BY task.source_key, task.id
    ) AS items
    FROM platform.case_tasks AS task
    JOIN platform.organization_memberships AS assignee_membership
      ON assignee_membership.organization_id = task.organization_id
      AND assignee_membership.id = task.assignee_membership_id
    JOIN platform.profiles AS assignee_profile
      ON assignee_profile.id = assignee_membership.profile_id
    WHERE task.organization_id = handoff.organization_id
      AND task.student_case_id = handoff.student_case_id
      AND task.source_key LIKE 'u6.%'
  ) AS task_projection ON TRUE
  WHERE handoff.organization_id = actor.organization_id
    AND handoff.student_case_id = p_student_case_id
    AND private.platform_can_read_student_case(
      handoff.organization_id,
      handoff.student_case_id
    )
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_handoff_context(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_handoff_context(UUID)
TO authenticated;

CREATE OR REPLACE FUNCTION platform.handoff_lead_to_admissions(
  p_lead_id UUID,
  p_expected_gate_version BIGINT,
  p_admissions_owner_membership_id UUID,
  p_handoff_mode TEXT,
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
  lead_record RECORD;
  owner_record RECORD;
  prior_receipt RECORD;
  prior_handoff RECORD;
  target_case platform.student_cases%ROWTYPE;
  normalized_mode TEXT;
  normalized_reason TEXT;
  canonical_source_key TEXT;
  changed_at TIMESTAMPTZ := pg_catalog.statement_timestamp();
  created_case BOOLEAN := FALSE;
  created_case_id UUID := gen_random_uuid();
  initial_scope_id UUID := gen_random_uuid();
  admissions_scope_id UUID := gen_random_uuid();
  admissions_scope_version BIGINT;
  created_handoff_id UUID := gen_random_uuid();
  created_task_id UUID;
  task_spec RECORD;
  provenance_snapshot JSONB;
  conversation_snapshot JSONB;
  result JSONB;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admissions_handoff_request_id_conflict'
      USING ERRCODE = '23505';
  END IF;
  IF p_expected_gate_version IS NULL OR p_expected_gate_version < 1 THEN
    RAISE EXCEPTION 'admissions_handoff_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_admissions_owner_membership_id IS NULL THEN
    RAISE EXCEPTION 'admissions_handoff_invalid_owner'
      USING ERRCODE = '22023';
  END IF;

  normalized_mode := pg_catalog.lower(
    NULLIF(pg_catalog.btrim(p_handoff_mode), '')
  );
  normalized_reason := NULLIF(pg_catalog.btrim(p_reason), '');
  IF normalized_mode IS NULL
    OR normalized_mode NOT IN ('normal', 'exceptional_override') THEN
    RAISE EXCEPTION 'admissions_handoff_invalid_mode'
      USING ERRCODE = '22023';
  END IF;
  IF normalized_reason IS NULL
    OR pg_catalog.length(normalized_reason) > 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'admissions_handoff_reason_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF normalized_mode = 'exceptional_override'
    AND actor.platform_role <> 'admin'
  THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::TEXT, 0)
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.sales_admissions_handoff_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id IS DISTINCT FROM actor.organization_id
      OR prior_receipt.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior_receipt.actor_profile_id IS DISTINCT FROM actor.profile_id
      OR prior_receipt.lead_id IS DISTINCT FROM p_lead_id
      OR prior_receipt.expected_gate_version IS DISTINCT FROM
        p_expected_gate_version
      OR prior_receipt.admissions_owner_membership_id IS DISTINCT FROM
        p_admissions_owner_membership_id
      OR prior_receipt.handoff_mode IS DISTINCT FROM normalized_mode
      OR prior_receipt.reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'admissions_handoff_request_id_conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_receipt.result;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor.organization_id::TEXT || ':u6:' || p_lead_id::TEXT,
      0
    )
  );

  SELECT
    lead.organization_id,
    lead.id,
    lead.client_id,
    lead.current_owner_membership_id,
    lead.stage_key,
    lead.source_key,
    lead.lifecycle_state,
    lead.next_action_text,
    lead.next_action_due_date,
    lead.workflow_version,
    client.display_name AS client_display_name,
    client.lifecycle_state AS client_lifecycle_state,
    gate.contract_confirmed,
    gate.contract_confirmed_at,
    gate.contract_evidence_reference,
    gate.gate_state,
    gate.gate_version
  INTO lead_record
  FROM platform.leads AS lead
  JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id
    AND client.id = lead.client_id
  JOIN platform.lead_admissions_gates AS gate
    ON gate.organization_id = lead.organization_id
    AND gate.lead_id = lead.id
  WHERE lead.organization_id = actor.organization_id
    AND lead.id = p_lead_id
    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
    )
  FOR UPDATE OF lead, client, gate;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    handoff.*,
    student_case.state AS case_state
  INTO prior_handoff
  FROM platform.sales_admissions_handoffs AS handoff
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = handoff.organization_id
    AND student_case.id = handoff.student_case_id
  WHERE handoff.organization_id = actor.organization_id
    AND handoff.lead_id = p_lead_id
  FOR UPDATE OF handoff, student_case;

  IF FOUND THEN
    IF prior_handoff.case_state <> 'active'
      OR prior_handoff.gate_version IS DISTINCT FROM p_expected_gate_version
      OR prior_handoff.admissions_owner_membership_id IS DISTINCT FROM
        p_admissions_owner_membership_id
      OR prior_handoff.handoff_mode IS DISTINCT FROM normalized_mode
      OR prior_handoff.reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'admissions_handoff_already_completed_conflict'
        USING ERRCODE = 'PT409';
    END IF;

    result := platform_private.u6_handoff_result(
      actor.organization_id,
      p_lead_id,
      p_request_id,
      prior_handoff.handed_off_at
    );
    INSERT INTO platform_private.sales_admissions_handoff_receipts (
      request_id,
      organization_id,
      actor_membership_id,
      actor_profile_id,
      lead_id,
      expected_gate_version,
      admissions_owner_membership_id,
      handoff_mode,
      reason,
      student_case_id,
      handoff_id,
      result,
      created_at
    ) VALUES (
      p_request_id,
      actor.organization_id,
      actor.membership_id,
      actor.profile_id,
      p_lead_id,
      p_expected_gate_version,
      p_admissions_owner_membership_id,
      normalized_mode,
      normalized_reason,
      prior_handoff.student_case_id,
      prior_handoff.id,
      result,
      changed_at
    );
    RETURN result;
  END IF;

  IF lead_record.lifecycle_state <> 'open'
    OR lead_record.client_lifecycle_state <> 'active'
    OR lead_record.stage_key <> 'qualified'
    OR lead_record.current_owner_membership_id IS NULL
  THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM platform.organization_memberships AS sales_owner
  JOIN platform.profiles AS sales_owner_profile
    ON sales_owner_profile.id = sales_owner.profile_id
  JOIN platform.role_bundle_versions AS sales_owner_bundle
    ON sales_owner_bundle.id = sales_owner.current_bundle_id
    AND sales_owner_bundle.role = sales_owner."current_role"
  WHERE sales_owner.organization_id = actor.organization_id
    AND sales_owner.id = lead_record.current_owner_membership_id
    AND sales_owner.status = 'active'
    AND sales_owner."current_role" = 'sales'
    AND sales_owner_profile.status = 'active'
    AND sales_owner_bundle.status = 'published'
  FOR UPDATE OF sales_owner, sales_owner_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    membership.id AS membership_id,
    membership.profile_id,
    profile.display_name
  INTO owner_record
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = actor.organization_id
    AND membership.id = p_admissions_owner_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'curator'
    AND profile.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_invalid_owner'
      USING ERRCODE = '22023';
  END IF;

  IF lead_record.gate_version <> p_expected_gate_version THEN
    RAISE EXCEPTION 'admissions_handoff_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  PERFORM platform_private.assert_lead_admissions_handoff_gate(
    actor.organization_id,
    p_lead_id,
    normalized_mode
  );

  IF normalized_mode = 'normal'
    AND (
      NOT lead_record.contract_confirmed
      OR lead_record.contract_confirmed_at IS NULL
      OR lead_record.contract_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION 'admissions_handoff_gate_incomplete'
      USING ERRCODE = 'PT409';
  END IF;

  canonical_source_key := 'canonical-lead:' || p_lead_id::TEXT;

  SELECT student_case.*
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND (
      student_case.canonical_lead_id = p_lead_id
      OR student_case.source_key = canonical_source_key
    )
    AND student_case.state IN ('pending', 'active', 'closed')
  ORDER BY
    CASE student_case.state
      WHEN 'pending' THEN 1
      WHEN 'active' THEN 2
      ELSE 3
    END,
    student_case.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND (
    target_case.state <> 'pending'
    OR target_case.canonical_lead_id IS DISTINCT FROM p_lead_id
    OR target_case.canonical_client_id IS DISTINCT FROM lead_record.client_id
    OR target_case.source_key IS DISTINCT FROM canonical_source_key
    OR target_case.responsible_sales_membership_id IS DISTINCT FROM lead_record.current_owner_membership_id
    OR target_case.contract_confirmation_ref IS DISTINCT FROM lead_record.contract_evidence_reference
    OR target_case.contract_confirmed_at IS DISTINCT FROM lead_record.contract_confirmed_at
    OR target_case.current_scope_id IS NULL
    OR target_case.current_scope_version IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM platform.record_scopes AS scope
      WHERE scope.organization_id = target_case.organization_id
        AND scope.id = target_case.current_scope_id
        AND scope.scope_kind = 'student_case'
        AND scope.scope_key = target_case.id
        AND scope.scope_version = target_case.current_scope_version
        AND scope.is_active
    )
  ) THEN
    RAISE EXCEPTION 'admissions_handoff_existing_case_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF NOT FOUND THEN
    created_case := TRUE;
    INSERT INTO platform.record_scopes (
      id,
      organization_id,
      scope_kind,
      scope_key,
      scope_version,
      is_active
    ) VALUES (
      initial_scope_id,
      actor.organization_id,
      'student_case',
      created_case_id,
      1,
      TRUE
    );

    INSERT INTO platform.student_cases (
      id,
      organization_id,
      student_membership_id,
      responsible_sales_membership_id,
      current_curator_membership_id,
      source_key,
      contract_confirmation_ref,
      contract_confirmed_at,
      student_display_name,
      target_country,
      target_degree,
      route_approval_status,
      operational_stage,
      state,
      handoff_at,
      portal_activated_at,
      closed_at,
      next_action,
      current_scope_id,
      current_scope_version,
      canonical_client_id,
      canonical_lead_id
    ) VALUES (
      created_case_id,
      actor.organization_id,
      NULL,
      lead_record.current_owner_membership_id,
      NULL,
      canonical_source_key,
      lead_record.contract_evidence_reference,
      lead_record.contract_confirmed_at,
      lead_record.client_display_name,
      NULL,
      NULL,
      'draft',
      'sales_handoff_pending',
      'pending',
      NULL,
      NULL,
      NULL,
      'Проверить унаследованный контекст Sales',
      initial_scope_id,
      1,
      lead_record.client_id,
      p_lead_id
    );

    PERFORM platform_private.append_scope_event(
      actor.organization_id,
      lead_record.current_owner_membership_id,
      initial_scope_id,
      1,
      TRUE,
      'user',
      actor.profile_id,
      normalized_reason,
      p_request_id
    );

    SELECT student_case.*
    INTO target_case
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = actor.organization_id
      AND student_case.id = created_case_id
    FOR UPDATE;
  END IF;

  admissions_scope_version := target_case.current_scope_version + 1;

  UPDATE platform.record_scopes AS scope
  SET is_active = FALSE
  WHERE scope.organization_id = target_case.organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = target_case.id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_scope_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO platform.record_scopes (
    id,
    organization_id,
    scope_kind,
    scope_key,
    scope_version,
    is_active
  ) VALUES (
    admissions_scope_id,
    actor.organization_id,
    'student_case',
    target_case.id,
    admissions_scope_version,
    TRUE
  );

  PERFORM platform_private.append_scope_event(
    actor.organization_id,
    p_admissions_owner_membership_id,
    admissions_scope_id,
    admissions_scope_version,
    TRUE,
    'user',
    actor.profile_id,
    normalized_reason,
    p_request_id
  );

  UPDATE platform.student_cases AS student_case
  SET
    current_curator_membership_id = p_admissions_owner_membership_id,
    operational_stage = 'admissions_handoff',
    state = 'active',
    handoff_at = changed_at,
    next_action = 'Проверить унаследованный контекст Sales',
    current_scope_id = admissions_scope_id,
    current_scope_version = admissions_scope_version
  WHERE student_case.organization_id = target_case.organization_id
    AND student_case.id = target_case.id
    AND student_case.state = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_handoff_case_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO platform.student_case_lifecycle_events (
    organization_id,
    student_case_id,
    event_type,
    previous_state,
    new_state,
    actor_membership_id,
    reason,
    request_id,
    created_at
  ) VALUES (
    actor.organization_id,
    target_case.id,
    'activated',
    'pending',
    'active',
    actor.membership_id,
    normalized_reason,
    p_request_id,
    changed_at
  );

  INSERT INTO platform.student_case_assignment_events (
    organization_id,
    student_case_id,
    event_type,
    previous_curator_membership_id,
    new_curator_membership_id,
    previous_scope_id,
    previous_scope_version,
    new_scope_id,
    new_scope_version,
    actor_membership_id,
    reason,
    request_id,
    created_at
  ) VALUES (
    actor.organization_id,
    target_case.id,
    'assigned',
    target_case.current_curator_membership_id,
    p_admissions_owner_membership_id,
    target_case.current_scope_id,
    target_case.current_scope_version,
    admissions_scope_id,
    admissions_scope_version,
    actor.membership_id,
    normalized_reason,
    p_request_id,
    changed_at
  );

  SELECT COALESCE(
    pg_catalog.jsonb_agg(item.payload ORDER BY item.observed_at DESC, item.id DESC),
    '[]'::JSONB
  )
  INTO provenance_snapshot
  FROM (
    SELECT
      provenance.id,
      provenance.observed_at,
      pg_catalog.jsonb_build_object(
        'provenance_id', provenance.id,
        'subject_type', CASE
          WHEN provenance.lead_id IS NOT NULL THEN 'lead'
          ELSE 'client'
        END,
        'source_system', provenance.source_system,
        'evidence_type', provenance.evidence_type,
        'observed_at', provenance.observed_at,
        'imported_at', provenance.imported_at,
        'source_ref', provenance.source_ref
      ) AS payload
    FROM platform.subject_provenance AS provenance
    WHERE provenance.organization_id = actor.organization_id
      AND (
        provenance.lead_id = p_lead_id
        OR provenance.client_id = lead_record.client_id
      )
    ORDER BY provenance.observed_at DESC, provenance.id DESC
    LIMIT 50
  ) AS item;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(item.payload ORDER BY item.updated_at DESC, item.id DESC),
    '[]'::JSONB
  )
  INTO conversation_snapshot
  FROM (
    SELECT
      conversation.id,
      conversation.updated_at,
      pg_catalog.jsonb_build_object(
        'conversation_id', conversation.id,
        'subject', conversation.subject,
        'queue', conversation.queue,
        'status', conversation.status,
        'updated_at', conversation.updated_at
      ) AS payload
    FROM platform.communication_conversations AS conversation
    WHERE conversation.organization_id = actor.organization_id
      AND (
        conversation.canonical_lead_id = p_lead_id
        OR conversation.canonical_client_id = lead_record.client_id
      )
    ORDER BY conversation.updated_at DESC, conversation.id DESC
    LIMIT 50
  ) AS item;

  INSERT INTO platform.sales_admissions_handoffs (
    id,
    organization_id,
    lead_id,
    client_id,
    student_case_id,
    source_key,
    handoff_mode,
    handoff_state,
    handoff_source,
    reason,
    actor_membership_id,
    actor_profile_id,
    admissions_owner_membership_id,
    gate_version,
    gate_state,
    workflow_version,
    sales_context,
    client_context,
    provenance,
    conversation_links,
    handed_off_at
  ) VALUES (
    created_handoff_id,
    actor.organization_id,
    p_lead_id,
    lead_record.client_id,
    target_case.id,
    canonical_source_key,
    normalized_mode,
    'completed',
    'canonical_sales',
    normalized_reason,
    actor.membership_id,
    actor.profile_id,
    p_admissions_owner_membership_id,
    lead_record.gate_version,
    lead_record.gate_state,
    lead_record.workflow_version,
    pg_catalog.jsonb_build_object(
      'lead_id', p_lead_id,
      'stage_key', lead_record.stage_key,
      'source_key', lead_record.source_key,
      'current_owner_membership_id', lead_record.current_owner_membership_id,
      'next_action_text', lead_record.next_action_text,
      'next_action_due_date', lead_record.next_action_due_date,
      'workflow_version', lead_record.workflow_version
    ),
    pg_catalog.jsonb_build_object(
      'client_id', lead_record.client_id,
      'display_name', lead_record.client_display_name
    ),
    provenance_snapshot,
    conversation_snapshot,
    changed_at
  );

  FOR task_spec IN
    SELECT *
    FROM (
      VALUES
        (
          'u6.sales-context-review'::TEXT,
          'Проверить унаследованный контекст Sales'::TEXT,
          'high'::platform.case_task_priority
        ),
        (
          'u6.study-route-confirmation'::TEXT,
          'Подтвердить маршрут обучения и недостающие данные'::TEXT,
          'normal'::platform.case_task_priority
        ),
        (
          'u6.document-request-plan'::TEXT,
          'Подготовить первичный план запроса документов'::TEXT,
          'normal'::platform.case_task_priority
        )
    ) AS starter(source_key, title, priority)
  LOOP
    created_task_id := gen_random_uuid();
    INSERT INTO platform.case_tasks (
      id,
      organization_id,
      student_case_id,
      task_type,
      title,
      assignee_membership_id,
      priority,
      due_at,
      status,
      student_visible,
      created_by_membership_id,
      source_key
    ) VALUES (
      created_task_id,
      actor.organization_id,
      target_case.id,
      'admissions_starter',
      task_spec.title,
      p_admissions_owner_membership_id,
      task_spec.priority,
      NULL,
      'open',
      FALSE,
      actor.membership_id,
      task_spec.source_key
    );

    INSERT INTO platform.case_task_events (
      organization_id,
      case_task_id,
      student_case_id,
      previous_status,
      new_status,
      previous_assignee_membership_id,
      new_assignee_membership_id,
      actor_membership_id,
      request_id,
      created_at
    ) VALUES (
      actor.organization_id,
      created_task_id,
      target_case.id,
      NULL,
      'open',
      NULL,
      p_admissions_owner_membership_id,
      actor.membership_id,
      pg_catalog.md5(
        p_request_id::TEXT || ':event:' || task_spec.source_key
      )::UUID,
      changed_at
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
      actor_membership_id
    ) VALUES (
      actor.organization_id,
      'user',
      actor.profile_id,
      'auth:' || actor.auth_user_id::TEXT,
      'task.create',
      'case_task',
      created_task_id,
      NULL,
      pg_catalog.jsonb_build_object(
        'student_case_id', target_case.id,
        'source_key', task_spec.source_key,
        'title', task_spec.title,
        'assignee_membership_id', p_admissions_owner_membership_id,
        'status', 'open'
      ),
      'U6 Admissions starter task',
      pg_catalog.md5(
        p_request_id::TEXT || ':audit:' || task_spec.source_key
      )::UUID,
      actor.membership_id
    );
  END LOOP;

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
    actor_membership_id,
    resulting_version
  ) VALUES (
    actor.organization_id,
    'user',
    actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    'lead.admissions.handoff.completed',
    'student_case',
    target_case.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'lead_id', p_lead_id,
      'client_id', lead_record.client_id,
      'student_case_id', target_case.id,
      'admissions_owner_membership_id', p_admissions_owner_membership_id,
      'handoff_mode', normalized_mode,
      'handoff_state', 'completed',
      'gate_state', lead_record.gate_state,
      'gate_version', lead_record.gate_version,
      'starter_task_count', 3,
      'created_case', created_case
    ),
    normalized_reason,
    p_request_id,
    actor.membership_id,
    lead_record.gate_version
  );

  PERFORM platform_private.bump_access_version(owner_record.profile_id);

  result := platform_private.u6_handoff_result(
    actor.organization_id,
    p_lead_id,
    p_request_id,
    changed_at
  );

  INSERT INTO platform_private.sales_admissions_handoff_receipts (
    request_id,
    organization_id,
    actor_membership_id,
    actor_profile_id,
    lead_id,
    expected_gate_version,
    admissions_owner_membership_id,
    handoff_mode,
    reason,
    student_case_id,
    handoff_id,
    result,
    created_at
  ) VALUES (
    p_request_id,
    actor.organization_id,
    actor.membership_id,
    actor.profile_id,
    p_lead_id,
    p_expected_gate_version,
    p_admissions_owner_membership_id,
    normalized_mode,
    normalized_reason,
    target_case.id,
    created_handoff_id,
    result,
    changed_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.handoff_lead_to_admissions(
  UUID, BIGINT, UUID, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.handoff_lead_to_admissions(
  UUID, BIGINT, UUID, TEXT, TEXT, UUID
) TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE platform.sales_admissions_handoffs
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE platform.sales_admissions_handoffs TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE
  platform_private.sales_admissions_handoff_receipts
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_u6;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_u6()
      || ARRAY['lead.admissions.handoff.completed']::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_u6;
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
    platform_private.p7a_safe_audit_resource_types_pre_u6()
      || ARRAY['student_case']::TEXT[]
  ) AS allowed(resource_type)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_u6;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action = 'lead.admissions.handoff.completed' THEN ARRAY[
      'admissions_owner',
      'handoff_mode',
      'handoff_state',
      'handoff_reason',
      'inherited_sales_context',
      'starter_tasks'
    ]::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_u6(p_action)
  END
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_u6(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_u6(),
  platform_private.p7a_safe_audit_resource_types(),
  platform_private.p7a_changed_field_codes_pre_u6(TEXT),
  platform_private.p7a_changed_field_codes(TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE platform.sales_admissions_handoffs IS
  'Immutable U6 Sales-to-Admissions handoff evidence binding one canonical lead to one Admissions case.';
COMMENT ON TABLE platform_private.sales_admissions_handoff_receipts IS
  'Private append-only U6 request receipts for exact replay and conflict detection.';
COMMENT ON COLUMN platform.case_tasks.source_key IS
  'Optional stable system source key; U6 uses it to prevent duplicate starter tasks.';
COMMENT ON FUNCTION platform.staff_lead_admissions_handoff(UUID) IS
  'Tenant-bound U6 Sales/Admin handoff state and bounded active Curator options.';
COMMENT ON FUNCTION platform.staff_student_case_handoff_context(UUID) IS
  'Full-case U6 Admissions context for Admin or the assigned Curator.';
COMMENT ON FUNCTION platform.handoff_lead_to_admissions(
  UUID, BIGINT, UUID, TEXT, TEXT, UUID
) IS
  'Atomic U6 handoff consuming the locked U5 gate and converging retries on one case and starter-task set.';

COMMIT;
