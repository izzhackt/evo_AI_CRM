-- ============================================================
-- 052_platform_workflow_case_bindings.sql
--
-- BW2: bind confirmed-contract Student Cases to the approved OP/OZO
-- workflow definitions from migration 051 and expose fixed staff repository
-- projections over the existing admissions domain from migrations 042-043.
--
-- This is a database/audit contract only. It does not create a local sales
-- pipeline, contact or lead authority and does not prove any amoCRM, WAHA,
-- AI, telephony or deployment provider operation.
-- ============================================================

BEGIN;

-- Existing cases stay valid and unbound. A case may move only from NULL to one
-- approved OZO version; that historical binding can never be cleared/rebased.
ALTER TABLE platform.student_cases
  ADD COLUMN applied_ozo_workflow_contract_version_id UUID;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_applied_ozo_version_fkey
  FOREIGN KEY (
    organization_id,
    applied_ozo_workflow_contract_version_id
  )
  REFERENCES platform.workflow_contract_versions(organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_org_id_applied_ozo_key
  UNIQUE (
    organization_id,
    id,
    applied_ozo_workflow_contract_version_id
  );

CREATE OR REPLACE FUNCTION platform_private.guard_student_case_ozo_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.applied_ozo_workflow_contract_version_id IS NOT NULL
      AND NEW.applied_ozo_workflow_contract_version_id
        IS DISTINCT FROM OLD.applied_ozo_workflow_contract_version_id
    THEN
      RAISE EXCEPTION 'Applied OZO workflow version is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.applied_ozo_workflow_contract_version_id IS NULL
      AND NEW.applied_ozo_workflow_contract_version_id IS NULL
    THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.applied_ozo_workflow_contract_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.workflow_contract_versions AS version
    JOIN platform.workflow_contracts AS contract
      ON contract.organization_id = version.organization_id
      AND contract.id = version.workflow_contract_id
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.applied_ozo_workflow_contract_version_id
      AND version.status = 'approved'
      AND contract.workflow_kind = 'ozo'
  ) THEN
    RAISE EXCEPTION 'Applied workflow version must be the approved OZO version'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_student_case_ozo_binding()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_cases_ozo_binding_guard
  BEFORE INSERT OR UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_ozo_binding();

CREATE OR REPLACE FUNCTION platform_private.bw2_scalar_object_is_bounded(
  p_value JSONB,
  p_max_keys INTEGER,
  p_max_bytes INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_value IS NOT NULL
    AND jsonb_typeof(p_value) = 'object'
    AND octet_length(p_value::TEXT) <= p_max_bytes
    AND (
      SELECT count(*) <= p_max_keys
      FROM jsonb_each(p_value)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_value) AS item(key, value)
      WHERE item.key !~ '^[a-z][a-z0-9_.-]{0,63}$'
        OR jsonb_typeof(item.value) NOT IN ('string', 'number', 'boolean', 'null')
        OR octet_length(item.value::TEXT) > 1024
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.bw2_text_array_is_bounded(
  p_value JSONB,
  p_max_items INTEGER,
  p_max_bytes INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_value IS NOT NULL
    AND jsonb_typeof(p_value) = 'array'
    AND jsonb_array_length(p_value) <= p_max_items
    AND octet_length(p_value::TEXT) <= p_max_bytes
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_value) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
        OR btrim(item.value #>> '{}') = ''
        OR char_length(item.value #>> '{}') > 1000
    )
$$;

REVOKE ALL ON FUNCTION platform_private.bw2_scalar_object_is_bounded(
  JSONB,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.bw2_text_array_is_bounded(
  JSONB,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TABLE platform.student_case_op_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  op_workflow_contract_id UUID NOT NULL,
  op_workflow_contract_version_id UUID NOT NULL,
  ozo_workflow_contract_id UUID NOT NULL,
  ozo_workflow_contract_version_id UUID NOT NULL,
  approved_commercial_fields JSONB NOT NULL,
  unresolved_questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  promises JSONB NOT NULL DEFAULT '[]'::JSONB,
  next_step TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  responsible_role platform.business_role NOT NULL,
  created_by_principal TEXT NOT NULL
    DEFAULT 'service:platform-case-ingest',
  request_id UUID NOT NULL,
  input_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_case_op_handoffs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_case_op_handoffs_one_per_case_key
    UNIQUE (organization_id, student_case_id),
  CONSTRAINT student_case_op_handoffs_request_id_key UNIQUE (request_id),
  CONSTRAINT student_case_op_handoffs_case_binding_fkey
    FOREIGN KEY (
      organization_id,
      student_case_id,
      ozo_workflow_contract_version_id
    )
    REFERENCES platform.student_cases(
      organization_id,
      id,
      applied_ozo_workflow_contract_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_case_op_handoffs_op_version_fkey
    FOREIGN KEY (
      organization_id,
      op_workflow_contract_version_id,
      op_workflow_contract_id
    )
    REFERENCES platform.workflow_contract_versions(
      organization_id,
      id,
      workflow_contract_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_case_op_handoffs_ozo_version_fkey
    FOREIGN KEY (
      organization_id,
      ozo_workflow_contract_version_id,
      ozo_workflow_contract_id
    )
    REFERENCES platform.workflow_contract_versions(
      organization_id,
      id,
      workflow_contract_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_case_op_handoffs_commercial_fields_check CHECK (
    platform_private.bw2_scalar_object_is_bounded(
      approved_commercial_fields,
      32,
      8192
    )
  ),
  CONSTRAINT student_case_op_handoffs_questions_check CHECK (
    platform_private.bw2_text_array_is_bounded(
      unresolved_questions,
      20,
      8192
    )
  ),
  CONSTRAINT student_case_op_handoffs_promises_check CHECK (
    platform_private.bw2_text_array_is_bounded(promises, 20, 8192)
  ),
  CONSTRAINT student_case_op_handoffs_next_step_check CHECK (
    btrim(next_step) <> '' AND char_length(next_step) <= 1000
  ),
  CONSTRAINT student_case_op_handoffs_responsible_role_check CHECK (
    responsible_role IN ('admin', 'sales', 'curator')
  ),
  CONSTRAINT student_case_op_handoffs_creator_check CHECK (
    created_by_principal = 'service:platform-case-ingest'
  ),
  CONSTRAINT student_case_op_handoffs_input_sha256_check CHECK (
    input_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX student_case_op_handoffs_op_version_idx
  ON platform.student_case_op_handoffs (
    organization_id,
    op_workflow_contract_version_id
  );
CREATE INDEX student_case_op_handoffs_ozo_version_idx
  ON platform.student_case_op_handoffs (
    organization_id,
    ozo_workflow_contract_version_id
  );

ALTER TABLE platform.student_case_op_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_op_handoffs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.guard_student_case_op_handoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Student-case OP/OZO handoffs are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.workflow_contract_versions AS version
    JOIN platform.workflow_contracts AS contract
      ON contract.organization_id = version.organization_id
      AND contract.id = version.workflow_contract_id
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.op_workflow_contract_version_id
      AND version.workflow_contract_id = NEW.op_workflow_contract_id
      AND version.status = 'approved'
      AND contract.workflow_kind = 'op'
  ) OR NOT EXISTS (
    SELECT 1
    FROM platform.workflow_contract_versions AS version
    JOIN platform.workflow_contracts AS contract
      ON contract.organization_id = version.organization_id
      AND contract.id = version.workflow_contract_id
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.ozo_workflow_contract_version_id
      AND version.workflow_contract_id = NEW.ozo_workflow_contract_id
      AND version.status = 'approved'
      AND contract.workflow_kind = 'ozo'
  ) THEN
    RAISE EXCEPTION 'Handoff requires approved same-organization OP/OZO versions'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_student_case_op_handoff()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_case_op_handoffs_insert_guard
  BEFORE INSERT ON platform.student_case_op_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_op_handoff();
CREATE TRIGGER student_case_op_handoffs_append_only
  BEFORE UPDATE OR DELETE ON platform.student_case_op_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_op_handoff();
CREATE TRIGGER student_case_op_handoffs_no_truncate
  BEFORE TRUNCATE ON platform.student_case_op_handoffs
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE POLICY student_case_op_handoffs_read
  ON platform.student_case_op_handoffs
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE OR REPLACE FUNCTION platform.create_pending_student_case_with_handoff(
  p_organization_id UUID,
  p_student_membership_id UUID,
  p_responsible_sales_membership_id UUID,
  p_source_key TEXT,
  p_contract_confirmation_ref TEXT,
  p_contract_confirmed_at TIMESTAMPTZ,
  p_student_display_name TEXT,
  p_target_country TEXT,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_intake TEXT,
  p_language_assumption TEXT,
  p_funding_assumption TEXT,
  p_operational_stage TEXT,
  p_next_action TEXT,
  p_op_workflow_contract_version_id UUID,
  p_ozo_workflow_contract_version_id UUID,
  p_approved_commercial_fields JSONB,
  p_unresolved_questions JSONB,
  p_promises JSONB,
  p_handoff_next_step TEXT,
  p_handoff_due_at TIMESTAMPTZ,
  p_handoff_responsible_role platform.business_role,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  fixed_reason CONSTANT TEXT :=
    'Service-created confirmed-contract OP-to-OZO handoff';
  normalized_input JSONB;
  input_sha256 TEXT;
  replayed JSONB;
  child_request_id UUID;
  case_result JSONB;
  created_case_id UUID;
  created_handoff_id UUID := gen_random_uuid();
  op_version platform.workflow_contract_versions%ROWTYPE;
  ozo_version platform.workflow_contract_versions%ROWTYPE;
  result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
    OR p_organization_id IS NULL
    OR p_op_workflow_contract_version_id IS NULL
    OR p_ozo_workflow_contract_version_id IS NULL
    OR p_handoff_due_at IS NULL
    OR p_handoff_responsible_role IS NULL
    OR p_handoff_next_step IS NULL
    OR btrim(p_handoff_next_step) = ''
    OR NOT platform_private.bw2_scalar_object_is_bounded(
      p_approved_commercial_fields,
      32,
      8192
    )
    OR NOT platform_private.bw2_text_array_is_bounded(
      p_unresolved_questions,
      20,
      8192
    )
    OR NOT platform_private.bw2_text_array_is_bounded(
      p_promises,
      20,
      8192
    )
    OR char_length(p_handoff_next_step) > 1000
    OR p_handoff_responsible_role NOT IN ('admin', 'sales', 'curator')
  THEN
    RAISE EXCEPTION 'A bounded complete OP-to-OZO handoff is required'
      USING ERRCODE = '22023';
  END IF;

  normalized_input := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_membership_id', p_student_membership_id,
    'responsible_sales_membership_id', p_responsible_sales_membership_id,
    'source_key', NULLIF(btrim(p_source_key), ''),
    'contract_confirmation_ref', NULLIF(btrim(p_contract_confirmation_ref), ''),
    'contract_confirmed_at', p_contract_confirmed_at,
    'student_display_name', NULLIF(btrim(p_student_display_name), ''),
    'target_country', NULLIF(btrim(p_target_country), ''),
    'target_degree', NULLIF(btrim(p_target_degree), ''),
    'program_direction', NULLIF(btrim(p_program_direction), ''),
    'intake', NULLIF(btrim(p_intake), ''),
    'language_assumption', NULLIF(btrim(p_language_assumption), ''),
    'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
    'operational_stage', NULLIF(btrim(p_operational_stage), ''),
    'next_action', NULLIF(btrim(p_next_action), ''),
    'op_workflow_contract_version_id', p_op_workflow_contract_version_id,
    'ozo_workflow_contract_version_id', p_ozo_workflow_contract_version_id,
    'approved_commercial_fields', p_approved_commercial_fields,
    'unresolved_questions', p_unresolved_questions,
    'promises', p_promises,
    'handoff_next_step', btrim(p_handoff_next_step),
    'handoff_due_at', p_handoff_due_at,
    'handoff_responsible_role', p_handoff_responsible_role
  );
  input_sha256 := platform_private.bw1_input_sha256(normalized_input);

  PERFORM platform_private.lock_bw1_request(p_request_id);
  replayed := platform_private.replay_audit(
    p_request_id,
    'case.handoff.create',
    'student_case',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT version.*
  INTO op_version
  FROM platform.workflow_contract_versions AS version
  JOIN platform.workflow_contracts AS contract
    ON contract.organization_id = version.organization_id
    AND contract.id = version.workflow_contract_id
  WHERE version.organization_id = p_organization_id
    AND version.id = p_op_workflow_contract_version_id
    AND version.status = 'approved'
    AND contract.workflow_kind = 'op';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current approved same-organization OP version is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT version.*
  INTO ozo_version
  FROM platform.workflow_contract_versions AS version
  JOIN platform.workflow_contracts AS contract
    ON contract.organization_id = version.organization_id
    AND contract.id = version.workflow_contract_id
  WHERE version.organization_id = p_organization_id
    AND version.id = p_ozo_workflow_contract_version_id
    AND version.status = 'approved'
    AND contract.workflow_kind = 'ozo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current approved same-organization OZO version is required'
      USING ERRCODE = '22023';
  END IF;

  child_request_id := public.uuid_generate_v5(
    'e9b70b4b-3778-5d4f-b781-b62c34e61d20'::UUID,
    'bw2:create-pending-student-case:' || p_request_id::TEXT
  );

  case_result := platform.create_pending_student_case(
    p_organization_id,
    p_student_membership_id,
    p_responsible_sales_membership_id,
    p_source_key,
    p_contract_confirmation_ref,
    p_contract_confirmed_at,
    p_student_display_name,
    p_target_country,
    p_target_degree,
    p_program_direction,
    p_intake,
    p_language_assumption,
    p_funding_assumption,
    p_operational_stage,
    p_next_action,
    child_request_id
  );
  created_case_id := (case_result ->> 'student_case_id')::UUID;

  UPDATE platform.student_cases
  SET applied_ozo_workflow_contract_version_id = ozo_version.id
  WHERE organization_id = p_organization_id
    AND id = created_case_id
    AND applied_ozo_workflow_contract_version_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New student case could not be bound to OZO workflow'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.student_case_op_handoffs (
    id,
    organization_id,
    student_case_id,
    op_workflow_contract_id,
    op_workflow_contract_version_id,
    ozo_workflow_contract_id,
    ozo_workflow_contract_version_id,
    approved_commercial_fields,
    unresolved_questions,
    promises,
    next_step,
    due_at,
    responsible_role,
    request_id,
    input_sha256
  ) VALUES (
    created_handoff_id,
    p_organization_id,
    created_case_id,
    op_version.workflow_contract_id,
    op_version.id,
    ozo_version.workflow_contract_id,
    ozo_version.id,
    p_approved_commercial_fields,
    p_unresolved_questions,
    p_promises,
    btrim(p_handoff_next_step),
    p_handoff_due_at,
    p_handoff_responsible_role,
    p_request_id,
    input_sha256
  );

  result := case_result || jsonb_build_object(
    'input_sha256', input_sha256,
    'child_request_id', child_request_id,
    'student_case_op_handoff_id', created_handoff_id,
    'op_workflow_contract_version_id', op_version.id,
    'applied_ozo_workflow_contract_version_id', ozo_version.id,
    'handoff_next_step', btrim(p_handoff_next_step),
    'handoff_due_at', p_handoff_due_at,
    'handoff_responsible_role', p_handoff_responsible_role
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
    request_id
  ) VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-case-ingest',
    'case.handoff.create',
    'student_case',
    created_case_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_op_workflow_contract()
RETURNS TABLE (
  organization_id UUID,
  workflow_contract_id UUID,
  workflow_contract_version_id UUID,
  contract_key TEXT,
  workflow_kind platform.workflow_kind,
  version BIGINT,
  status platform.workflow_contract_version_status,
  stage_keys TEXT[],
  follow_up_outcome_keys TEXT[],
  closure_result_keys TEXT[],
  terminal_stage_keys TEXT[],
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    contract.organization_id,
    contract.id,
    version.id,
    contract.contract_key,
    contract.workflow_kind,
    version.version,
    version.status,
    version.stage_keys,
    version.follow_up_outcome_keys,
    version.closure_result_keys,
    version.terminal_stage_keys,
    version.approved_at,
    version.created_at
  FROM platform.current_actor_authority() AS authority
  JOIN platform.workflow_contracts AS contract
    ON contract.organization_id = authority.organization_id
    AND contract.workflow_kind = 'op'
  JOIN platform.workflow_contract_versions AS version
    ON version.organization_id = contract.organization_id
    AND version.workflow_contract_id = contract.id
    AND version.status = 'approved'
  WHERE private.platform_has_permission(
    authority.organization_id,
    'workflow.contract.read'
  )
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_queue()
RETURNS TABLE (
  organization_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  language_assumption TEXT,
  funding_assumption TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  state platform.student_case_state,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  handoff_at TIMESTAMPTZ,
  next_action TEXT,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  applied_ozo_workflow_contract_version_id UUID,
  overdue_task_count BIGINT,
  overdue_obligation_count BIGINT,
  rejected_document_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.organization_id,
    student_case.id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.language_assumption,
    student_case.funding_assumption,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.created_at,
    student_case.updated_at,
    student_case.handoff_at,
    student_case.next_action,
    sales_profile.display_name,
    curator_profile.display_name,
    student_case.applied_ozo_workflow_contract_version_id,
    (
      SELECT count(*)
      FROM platform.case_tasks AS task
      WHERE task.organization_id = student_case.organization_id
        AND task.student_case_id = student_case.id
        AND task.due_at < statement_timestamp()
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*)
      FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = student_case.organization_id
        AND obligation.student_case_id = student_case.id
        AND obligation.due_at < statement_timestamp()
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    ),
    (
      SELECT count(*)
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = student_case.organization_id
        AND slot.student_case_id = student_case.id
        AND slot.status = 'rejected'
    )
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id = student_case.responsible_sales_membership_id
  JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  LEFT JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id = student_case.current_curator_membership_id
  LEFT JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  WHERE private.platform_can_read_student_case(
    student_case.organization_id,
    student_case.id
  )
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_snapshot(
  p_student_case_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  language_assumption TEXT,
  funding_assumption TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  state platform.student_case_state,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  handoff_at TIMESTAMPTZ,
  next_action TEXT,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  applied_ozo_workflow_contract_version_id UUID,
  overdue_task_count BIGINT,
  overdue_obligation_count BIGINT,
  rejected_document_count BIGINT,
  student_case_op_handoff_id UUID,
  op_workflow_contract_version_id UUID,
  approved_commercial_fields JSONB,
  unresolved_questions JSONB,
  promises JSONB,
  handoff_next_step TEXT,
  handoff_due_at TIMESTAMPTZ,
  handoff_responsible_role platform.business_role,
  handoff_created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.organization_id,
    student_case.id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.language_assumption,
    student_case.funding_assumption,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.created_at,
    student_case.updated_at,
    student_case.handoff_at,
    student_case.next_action,
    sales_profile.display_name,
    curator_profile.display_name,
    student_case.applied_ozo_workflow_contract_version_id,
    (
      SELECT count(*)
      FROM platform.case_tasks AS task
      WHERE task.organization_id = student_case.organization_id
        AND task.student_case_id = student_case.id
        AND task.due_at < statement_timestamp()
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*)
      FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = student_case.organization_id
        AND obligation.student_case_id = student_case.id
        AND obligation.due_at < statement_timestamp()
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    ),
    (
      SELECT count(*)
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = student_case.organization_id
        AND slot.student_case_id = student_case.id
        AND slot.status = 'rejected'
    ),
    handoff.id,
    handoff.op_workflow_contract_version_id,
    handoff.approved_commercial_fields,
    handoff.unresolved_questions,
    handoff.promises,
    handoff.next_step,
    handoff.due_at,
    handoff.responsible_role,
    handoff.created_at
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id = student_case.responsible_sales_membership_id
  JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  LEFT JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id = student_case.current_curator_membership_id
  LEFT JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  LEFT JOIN platform.student_case_op_handoffs AS handoff
    ON handoff.organization_id = student_case.organization_id
    AND handoff.student_case_id = student_case.id
  WHERE student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
$$;

CREATE OR REPLACE FUNCTION platform.staff_application_queue()
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    application.organization_id,
    application.id,
    application.student_case_id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    application.institution_name,
    application.program_name,
    application.status,
    application.latest_evidence_reference,
    application.created_at,
    application.updated_at,
    sales_profile.display_name,
    curator_profile.display_name,
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
        AND slot.status <> 'approved'
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    )
  FROM platform.university_applications AS application
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = application.organization_id
    AND student_case.id = application.student_case_id
  JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id = student_case.responsible_sales_membership_id
  JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  LEFT JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id = student_case.current_curator_membership_id
  LEFT JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  WHERE private.platform_can_read_student_case(
    student_case.organization_id,
    student_case.id
  )
$$;

CREATE OR REPLACE FUNCTION platform.staff_application_snapshot(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT queue.*
  FROM platform.staff_application_queue() AS queue
  WHERE queue.university_application_id = p_university_application_id
$$;

REVOKE ALL PRIVILEGES ON TABLE platform.student_case_op_handoffs
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE platform.student_case_op_handoffs TO authenticated;

REVOKE ALL ON FUNCTION platform.create_pending_student_case_with_handoff(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  UUID,
  JSONB,
  JSONB,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  platform.business_role,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_pending_student_case_with_handoff(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  UUID,
  JSONB,
  JSONB,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  platform.business_role,
  UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.staff_op_workflow_contract()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_student_case_queue()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_student_case_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_application_queue()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_application_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.staff_op_workflow_contract(),
  platform.staff_student_case_queue(),
  platform.staff_student_case_snapshot(UUID),
  platform.staff_application_queue(),
  platform.staff_application_snapshot(UUID)
TO authenticated;

COMMENT ON TABLE platform.student_case_op_handoffs IS
  'Immutable approved OP-to-OZO handoff payload; no provider-success claim.';
COMMENT ON FUNCTION platform.create_pending_student_case_with_handoff(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  UUID,
  JSONB,
  JSONB,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  platform.business_role,
  UUID
) IS
  'Service-only atomic case/handoff ingest; does not prove an external provider action.';

COMMIT;
