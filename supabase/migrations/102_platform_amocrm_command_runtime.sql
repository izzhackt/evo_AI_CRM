BEGIN;

CREATE TYPE platform.amocrm_command_operation AS ENUM (
  'contact_create',
  'contact_update',
  'lead_create',
  'lead_update',
  'contact_lead_link',
  'lead_pipeline_status_update',
  'lead_responsible_update',
  'lead_note_create',
  'lead_task_create',
  'lead_tag_update'
);

CREATE TYPE platform.amocrm_command_status AS ENUM (
  'prepared',
  'accepted',
  'unknown',
  'rejected'
);

CREATE TABLE platform_private.amocrm_command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL CHECK (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    AND pg_catalog.char_length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  actor_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'sales', 'admissions')),
  workflow_scope TEXT NOT NULL CHECK (
    workflow_scope IN ('sales_pre_handoff', 'admissions_post_handoff')
  ),
  workflow_lead_id UUID NOT NULL,
  student_case_id UUID,
  person_id UUID,
  lead_id UUID,
  operation_name platform.amocrm_command_operation NOT NULL,
  target_contact_id TEXT CHECK (
    target_contact_id IS NULL OR target_contact_id ~ '^[1-9][0-9]{0,19}$'
  ),
  target_lead_id TEXT CHECK (
    target_lead_id IS NULL OR target_lead_id ~ '^[1-9][0-9]{0,19}$'
  ),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT amocrm_command_receipts_org_receipt_key
    UNIQUE (organization_id, id),
  CONSTRAINT amocrm_command_receipts_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_receipts_workflow_lead_fkey
    FOREIGN KEY (organization_id, workflow_lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_receipts_student_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_receipts_person_fkey
    FOREIGN KEY (organization_id, person_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_receipts_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_receipts_scope_shape_check CHECK (
    (workflow_scope = 'sales_pre_handoff' AND student_case_id IS NULL)
    OR (workflow_scope = 'admissions_post_handoff' AND student_case_id IS NOT NULL)
  ),
  CONSTRAINT amocrm_command_receipts_object_shape_check CHECK (
    (operation_name IN ('contact_create', 'contact_update') AND person_id IS NOT NULL AND lead_id IS NULL)
    OR (
      operation_name IN (
        'lead_create',
        'lead_update',
        'lead_pipeline_status_update',
        'lead_responsible_update',
        'lead_note_create',
        'lead_task_create',
        'lead_tag_update'
      )
      AND person_id IS NULL
      AND lead_id IS NOT NULL
    )
    OR (operation_name = 'contact_lead_link' AND person_id IS NOT NULL AND lead_id IS NOT NULL)
  ),
  CONSTRAINT amocrm_command_receipts_target_shape_check CHECK (
    (operation_name = 'contact_create' AND target_contact_id IS NULL AND target_lead_id IS NULL)
    OR (operation_name = 'contact_update' AND target_contact_id IS NOT NULL AND target_lead_id IS NULL)
    OR (operation_name = 'lead_create' AND target_contact_id IS NULL AND target_lead_id IS NULL)
    OR (
      operation_name IN (
        'lead_update',
        'lead_pipeline_status_update',
        'lead_responsible_update',
        'lead_note_create',
        'lead_task_create',
        'lead_tag_update'
      )
      AND target_contact_id IS NULL
      AND target_lead_id IS NOT NULL
    )
    OR (operation_name = 'contact_lead_link' AND target_contact_id IS NOT NULL AND target_lead_id IS NOT NULL)
  )
);

CREATE INDEX amocrm_command_receipts_org_created_idx
  ON platform_private.amocrm_command_receipts (organization_id, created_at DESC, id DESC);

ALTER TABLE platform_private.amocrm_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_command_receipts FORCE ROW LEVEL SECURITY;

CREATE TRIGGER amocrm_command_receipts_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.amocrm_command_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER amocrm_command_receipts_append_only_truncate
  BEFORE TRUNCATE ON platform_private.amocrm_command_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TABLE platform_private.amocrm_command_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  command_receipt_id UUID NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'sales', 'admissions')),
  workflow_scope TEXT NOT NULL CHECK (
    workflow_scope IN ('sales_pre_handoff', 'admissions_post_handoff')
  ),
  workflow_lead_id UUID NOT NULL,
  student_case_id UUID,
  person_id UUID,
  lead_id UUID,
  operation_name platform.amocrm_command_operation NOT NULL,
  target_contact_id TEXT CHECK (
    target_contact_id IS NULL OR target_contact_id ~ '^[1-9][0-9]{0,19}$'
  ),
  target_lead_id TEXT CHECK (
    target_lead_id IS NULL OR target_lead_id ~ '^[1-9][0-9]{0,19}$'
  ),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status platform.amocrm_command_status NOT NULL DEFAULT 'prepared',
  dispatch_request_id UUID,
  dispatch_request_sha256 TEXT CHECK (
    dispatch_request_sha256 IS NULL
    OR dispatch_request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  dispatch_worker_ref TEXT CHECK (
    dispatch_worker_ref IS NULL
    OR (
      dispatch_worker_ref = pg_catalog.btrim(dispatch_worker_ref)
      AND pg_catalog.char_length(dispatch_worker_ref) BETWEEN 1 AND 200
      AND dispatch_worker_ref !~ '[[:cntrl:]]'
    )
  ),
  dispatch_claimed_at TIMESTAMPTZ,
  dispatch_lease_expires_at TIMESTAMPTZ,
  provider_dispatched_at TIMESTAMPTZ,
  finish_request_id UUID,
  finish_request_sha256 TEXT CHECK (
    finish_request_sha256 IS NULL
    OR finish_request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  reconcile_request_id UUID,
  reconcile_request_sha256 TEXT CHECK (
    reconcile_request_sha256 IS NULL
    OR reconcile_request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  provider_request_id TEXT CHECK (
    provider_request_id IS NULL
    OR (
      provider_request_id = pg_catalog.btrim(provider_request_id)
      AND pg_catalog.char_length(provider_request_id) BETWEEN 1 AND 200
      AND provider_request_id !~ '[[:cntrl:]]'
    )
  ),
  provider_http_status INTEGER CHECK (
    provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599
  ),
  provider_readback JSONB,
  provider_readback_sha256 TEXT CHECK (
    provider_readback_sha256 IS NULL
    OR provider_readback_sha256 ~ '^[0-9a-f]{64}$'
  ),
  provider_readback_at TIMESTAMPTZ,
  provider_responded_at TIMESTAMPTZ,
  result_contact_id TEXT CHECK (
    result_contact_id IS NULL OR result_contact_id ~ '^[1-9][0-9]{0,19}$'
  ),
  result_lead_id TEXT CHECK (
    result_lead_id IS NULL OR result_lead_id ~ '^[1-9][0-9]{0,19}$'
  ),
  failure_code TEXT CHECK (
    failure_code IS NULL
    OR (
      failure_code = pg_catalog.btrim(failure_code)
      AND pg_catalog.char_length(failure_code) BETWEEN 1 AND 64
      AND failure_code ~ '^[a-z][a-z0-9_]{1,63}$'
    )
  ),
  settled_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT amocrm_command_attempts_org_attempt_key
    UNIQUE (organization_id, id),
  CONSTRAINT amocrm_command_attempts_org_idempotency_key
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT amocrm_command_attempts_dispatch_shape_check CHECK (
    (
      dispatch_request_id IS NULL
      AND dispatch_request_sha256 IS NULL
      AND dispatch_worker_ref IS NULL
      AND dispatch_claimed_at IS NULL
      AND dispatch_lease_expires_at IS NULL
      AND provider_dispatched_at IS NULL
    )
    OR (
      dispatch_request_id IS NOT NULL
      AND dispatch_request_sha256 IS NOT NULL
      AND dispatch_worker_ref IS NOT NULL
      AND dispatch_claimed_at IS NOT NULL
      AND dispatch_lease_expires_at IS NOT NULL
      AND provider_dispatched_at IS NOT NULL
      AND provider_dispatched_at = dispatch_claimed_at
      AND dispatch_lease_expires_at > dispatch_claimed_at
    )
  ),
  CONSTRAINT amocrm_command_attempts_finish_shape_check CHECK (
    (finish_request_id IS NULL AND finish_request_sha256 IS NULL)
    OR (finish_request_id IS NOT NULL AND finish_request_sha256 IS NOT NULL)
  ),
  CONSTRAINT amocrm_command_attempts_reconcile_shape_check CHECK (
    (reconcile_request_id IS NULL AND reconcile_request_sha256 IS NULL)
    OR (reconcile_request_id IS NOT NULL AND reconcile_request_sha256 IS NOT NULL)
  ),
  CONSTRAINT amocrm_command_attempts_org_receipt_fkey
    FOREIGN KEY (organization_id, command_receipt_id)
    REFERENCES platform_private.amocrm_command_receipts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_attempts_workflow_lead_fkey
    FOREIGN KEY (organization_id, workflow_lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_attempts_student_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_attempts_person_fkey
    FOREIGN KEY (organization_id, person_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_command_attempts_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX amocrm_command_attempts_workflow_idx
  ON platform_private.amocrm_command_attempts (
    organization_id,
    workflow_scope,
    workflow_lead_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX amocrm_command_attempts_person_idx
  ON platform_private.amocrm_command_attempts (organization_id, person_id, created_at DESC, id DESC);

CREATE INDEX amocrm_command_attempts_lead_idx
  ON platform_private.amocrm_command_attempts (organization_id, lead_id, created_at DESC, id DESC);

CREATE TRIGGER amocrm_command_attempts_set_updated_at
  BEFORE UPDATE ON platform_private.amocrm_command_attempts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

ALTER TABLE platform_private.amocrm_command_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_command_attempts FORCE ROW LEVEL SECURITY;

CREATE TABLE platform_private.amocrm_contact_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  person_id UUID NOT NULL,
  contact_id TEXT NOT NULL CHECK (contact_id ~ '^[1-9][0-9]{0,19}$'),
  latest_attempt_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, person_id),
  UNIQUE (organization_id, contact_id),
  CONSTRAINT amocrm_contact_bindings_person_fkey
    FOREIGN KEY (organization_id, person_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_contact_bindings_attempt_fkey
    FOREIGN KEY (organization_id, latest_attempt_id)
    REFERENCES platform_private.amocrm_command_attempts(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER amocrm_contact_bindings_set_updated_at
  BEFORE UPDATE ON platform_private.amocrm_contact_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

ALTER TABLE platform_private.amocrm_contact_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_contact_bindings FORCE ROW LEVEL SECURITY;

CREATE TABLE platform_private.amocrm_lead_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL,
  provider_lead_id TEXT NOT NULL CHECK (provider_lead_id ~ '^[1-9][0-9]{0,19}$'),
  latest_attempt_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, lead_id),
  UNIQUE (organization_id, provider_lead_id),
  CONSTRAINT amocrm_lead_bindings_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_lead_bindings_attempt_fkey
    FOREIGN KEY (organization_id, latest_attempt_id)
    REFERENCES platform_private.amocrm_command_attempts(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER amocrm_lead_bindings_set_updated_at
  BEFORE UPDATE ON platform_private.amocrm_lead_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

ALTER TABLE platform_private.amocrm_lead_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_lead_bindings FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.amocrm_runtime_actor(
  p_organization_id UUID,
  p_actor_role TEXT,
  p_workflow_scope TEXT,
  p_workflow_lead_id UUID,
  p_student_case_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_display_name TEXT,
  actor_role TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authority RECORD;
  effective_role TEXT;
BEGIN
  SELECT *
  INTO authority
  FROM platform.current_actor_authority() AS actor
  WHERE actor.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  effective_role := CASE authority.platform_role
    WHEN 'curator' THEN 'admissions'
    ELSE authority.platform_role::TEXT
  END;

  IF effective_role = 'admin' THEN
    IF p_actor_role NOT IN ('admin', 'sales', 'admissions') THEN
      RAISE EXCEPTION 'amocrm_command_forbidden'
        USING ERRCODE = '42501';
    END IF;
    effective_role := p_actor_role;
  ELSIF effective_role <> p_actor_role THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_workflow_scope = 'sales_pre_handoff' THEN
    IF effective_role NOT IN ('admin', 'sales')
      OR p_student_case_id IS NOT NULL
      OR NOT private.platform_can_read_canonical_lead(
        p_organization_id,
        p_workflow_lead_id
      ) THEN
      RAISE EXCEPTION 'amocrm_command_forbidden'
        USING ERRCODE = '42501';
    END IF;
  ELSIF p_workflow_scope = 'admissions_post_handoff' THEN
    IF effective_role NOT IN ('admin', 'admissions')
      OR p_student_case_id IS NULL
      OR NOT private.platform_can_read_canonical_lead(
        p_organization_id,
        p_workflow_lead_id
      )
      OR NOT private.platform_can_read_student_case(
        p_organization_id,
        p_student_case_id
      ) THEN
      RAISE EXCEPTION 'amocrm_command_forbidden'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    authority.organization_id,
    authority.profile_id,
    authority.membership_id,
    authority.auth_user_id,
    authority.display_name,
    effective_role;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.amocrm_command_snapshot(
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'attempt_id', attempt.id,
    'command_receipt_id', attempt.command_receipt_id,
    'organization_id', attempt.organization_id,
    'idempotency_key', attempt.idempotency_key,
    'operation_name', attempt.operation_name,
    'actor_role', attempt.actor_role,
    'workflow_scope', attempt.workflow_scope,
    'workflow_lead_id', attempt.workflow_lead_id,
    'student_case_id', attempt.student_case_id,
    'person_id', attempt.person_id,
    'lead_id', attempt.lead_id,
    'target_contact_id', attempt.target_contact_id,
    'target_lead_id', attempt.target_lead_id,
    'status', attempt.status,
    'provider_dispatched_at', attempt.provider_dispatched_at,
    'result_contact_id', attempt.result_contact_id,
    'result_lead_id', attempt.result_lead_id,
    'failure_code', attempt.failure_code
  )
  FROM platform_private.amocrm_command_attempts AS attempt
  WHERE attempt.id = p_attempt_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.prepare_amocrm_command(
  p_organization_id UUID,
  p_authorization JSONB,
  p_person_id UUID,
  p_lead_id UUID,
  p_operation_name platform.amocrm_command_operation,
  p_idempotency_key TEXT,
  p_target_contact_id TEXT,
  p_target_lead_id TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  existing_attempt RECORD;
  existing_provider_id TEXT;
  receipt_id UUID;
  attempt_id UUID;
  actor_role TEXT;
  workflow_scope TEXT;
  workflow_lead_id UUID;
  student_case_id UUID;
BEGIN
  IF p_organization_id IS NULL
    OR p_authorization IS NULL
    OR p_operation_name IS NULL
    OR p_idempotency_key IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_authorization) <> 'object'
    OR jsonb_typeof(p_payload) <> 'object'
    OR p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    OR pg_catalog.char_length(p_idempotency_key) NOT BETWEEN 1 AND 200
    OR p_idempotency_key ~ '[[:cntrl:]]'
    OR (p_target_contact_id IS NOT NULL AND p_target_contact_id !~ '^[1-9][0-9]{0,19}$')
    OR (p_target_lead_id IS NOT NULL AND p_target_lead_id !~ '^[1-9][0-9]{0,19}$')
  THEN
    RAISE EXCEPTION 'invalid amocrm command request'
      USING ERRCODE = '22023';
  END IF;

  actor_role := p_authorization ->> 'actor_role';
  workflow_scope := p_authorization ->> 'workflow_scope';
  workflow_lead_id := NULLIF(p_authorization ->> 'workflow_lead_id', '')::UUID;
  student_case_id := NULLIF(p_authorization ->> 'student_case_id', '')::UUID;

  SELECT *
  INTO actor
  FROM platform_private.amocrm_runtime_actor(
    p_organization_id,
    actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id
  );

  IF p_lead_id IS NOT NULL
    AND p_lead_id IS DISTINCT FROM workflow_lead_id
  THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_person_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM platform.leads AS workflow_lead
      WHERE workflow_lead.organization_id = p_organization_id
        AND workflow_lead.id = workflow_lead_id
        AND workflow_lead.client_id = p_person_id
    )
  THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF workflow_scope = 'admissions_post_handoff'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = p_organization_id
        AND student_case.id = student_case_id
        AND student_case.canonical_lead_id = workflow_lead_id
        AND (
          p_person_id IS NULL
          OR student_case.canonical_client_id = p_person_id
        )
    )
  THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation_name IN ('contact_create', 'contact_update') AND (p_person_id IS NULL OR p_lead_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid amocrm command request'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation_name = 'contact_lead_link' AND (p_person_id IS NULL OR p_lead_id IS NULL) THEN
    RAISE EXCEPTION 'invalid amocrm command request'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation_name IN (
    'lead_create',
    'lead_update',
    'lead_pipeline_status_update',
    'lead_responsible_update',
    'lead_note_create',
    'lead_task_create',
    'lead_tag_update'
  ) AND (p_person_id IS NOT NULL OR p_lead_id IS NULL) THEN
    RAISE EXCEPTION 'invalid amocrm command request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('amocrm-command:' || p_idempotency_key, 0)
  );

  SELECT
    attempt.*,
    receipt.actor_profile_id AS receipt_actor_profile_id,
    receipt.actor_membership_id AS receipt_actor_membership_id,
    receipt.actor_auth_user_id AS receipt_actor_auth_user_id
  INTO existing_attempt
  FROM platform_private.amocrm_command_attempts AS attempt
  JOIN platform_private.amocrm_command_receipts AS receipt
    ON receipt.organization_id = attempt.organization_id
   AND receipt.id = attempt.command_receipt_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF existing_attempt.receipt_actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR existing_attempt.receipt_actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR existing_attempt.receipt_actor_auth_user_id IS DISTINCT FROM actor.actor_auth_user_id
      OR existing_attempt.actor_role IS DISTINCT FROM actor.actor_role
      OR existing_attempt.workflow_scope IS DISTINCT FROM workflow_scope
      OR existing_attempt.workflow_lead_id IS DISTINCT FROM workflow_lead_id
      OR existing_attempt.student_case_id IS DISTINCT FROM student_case_id
      OR existing_attempt.person_id IS DISTINCT FROM p_person_id
      OR existing_attempt.lead_id IS DISTINCT FROM p_lead_id
      OR existing_attempt.operation_name IS DISTINCT FROM p_operation_name
      OR existing_attempt.target_contact_id IS DISTINCT FROM p_target_contact_id
      OR existing_attempt.target_lead_id IS DISTINCT FROM p_target_lead_id
      OR existing_attempt.payload IS DISTINCT FROM p_payload
    THEN
      RAISE EXCEPTION 'amocrm command idempotency key was reused with different input'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'kind', 'replay',
      'attempt', platform_private.amocrm_command_snapshot(existing_attempt.id)
    );
  END IF;

  IF p_person_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'amocrm-object:' || p_organization_id::TEXT || ':person:' || p_person_id::TEXT,
        0
      )
    );
  END IF;
  IF p_lead_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'amocrm-object:' || p_organization_id::TEXT || ':lead:' || p_lead_id::TEXT,
        0
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.amocrm_command_attempts AS unresolved
    WHERE unresolved.organization_id = p_organization_id
      AND unresolved.status IN ('prepared', 'unknown')
      AND (
        (p_person_id IS NOT NULL AND unresolved.person_id = p_person_id)
        OR (p_lead_id IS NOT NULL AND unresolved.lead_id = p_lead_id)
      )
  ) THEN
    RAISE EXCEPTION 'amocrm command target already has an unresolved attempt'
      USING ERRCODE = '55000';
  END IF;

  IF p_person_id IS NOT NULL THEN
    SELECT binding.contact_id
    INTO existing_provider_id
    FROM platform_private.amocrm_contact_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.person_id = p_person_id
    FOR UPDATE;

    IF p_operation_name = 'contact_create' THEN
      IF FOUND THEN
        RAISE EXCEPTION 'amocrm contact binding already exists'
          USING ERRCODE = '23505';
      END IF;
    ELSIF NOT FOUND
      OR existing_provider_id IS DISTINCT FROM p_target_contact_id
    THEN
      RAISE EXCEPTION 'amocrm contact binding does not match the command target'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_lead_id IS NOT NULL THEN
    SELECT binding.provider_lead_id
    INTO existing_provider_id
    FROM platform_private.amocrm_lead_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.lead_id = p_lead_id
    FOR UPDATE;

    IF p_operation_name = 'lead_create' THEN
      IF FOUND THEN
        RAISE EXCEPTION 'amocrm lead binding already exists'
          USING ERRCODE = '23505';
      END IF;
    ELSIF NOT FOUND
      OR existing_provider_id IS DISTINCT FROM p_target_lead_id
    THEN
      RAISE EXCEPTION 'amocrm lead binding does not match the command target'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO platform_private.amocrm_command_receipts (
    organization_id,
    request_id,
    idempotency_key,
    actor_profile_id,
    actor_membership_id,
    actor_auth_user_id,
    actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id,
    person_id,
    lead_id,
    operation_name,
    target_contact_id,
    target_lead_id,
    payload
  ) VALUES (
    p_organization_id,
    gen_random_uuid(),
    p_idempotency_key,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id,
    p_person_id,
    p_lead_id,
    p_operation_name,
    p_target_contact_id,
    p_target_lead_id,
    p_payload
  )
  RETURNING id INTO receipt_id;

  INSERT INTO platform_private.amocrm_command_attempts (
    organization_id,
    command_receipt_id,
    idempotency_key,
    actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id,
    person_id,
    lead_id,
    operation_name,
    target_contact_id,
    target_lead_id,
    payload
  ) VALUES (
    p_organization_id,
    receipt_id,
    p_idempotency_key,
    actor.actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id,
    p_person_id,
    p_lead_id,
    p_operation_name,
    p_target_contact_id,
    p_target_lead_id,
    p_payload
  )
  RETURNING id INTO attempt_id;

  RETURN jsonb_build_object(
    'kind', 'prepared',
    'attempt', platform_private.amocrm_command_snapshot(attempt_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.read_staff_amocrm_bindings(
  p_organization_id UUID,
  p_authorization JSONB,
  p_person_id UUID,
  p_lead_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role TEXT;
  workflow_scope TEXT;
  workflow_lead_id UUID;
  student_case_id UUID;
  contact_binding TEXT;
  lead_binding TEXT;
BEGIN
  actor_role := p_authorization ->> 'actor_role';
  workflow_scope := p_authorization ->> 'workflow_scope';
  workflow_lead_id := NULLIF(p_authorization ->> 'workflow_lead_id', '')::UUID;
  student_case_id := NULLIF(p_authorization ->> 'student_case_id', '')::UUID;

  PERFORM 1
  FROM platform_private.amocrm_runtime_actor(
    p_organization_id,
    actor_role,
    workflow_scope,
    workflow_lead_id,
    student_case_id
  );

  IF p_lead_id IS DISTINCT FROM workflow_lead_id THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT binding.contact_id
  INTO contact_binding
  FROM platform_private.amocrm_contact_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.person_id IS NOT DISTINCT FROM p_person_id
  LIMIT 1;

  SELECT binding.provider_lead_id
  INTO lead_binding
  FROM platform_private.amocrm_lead_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.lead_id = p_lead_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'contact_id', contact_binding,
    'lead_id', lead_binding
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.read_staff_blocking_amocrm_command(
  p_organization_id UUID,
  p_authorization JSONB,
  p_person_id UUID,
  p_lead_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_role TEXT;
  v_workflow_scope TEXT;
  v_workflow_lead_id UUID;
  v_student_case_id UUID;
  attempt_id UUID;
BEGIN
  v_actor_role := p_authorization ->> 'actor_role';
  v_workflow_scope := p_authorization ->> 'workflow_scope';
  v_workflow_lead_id := NULLIF(p_authorization ->> 'workflow_lead_id', '')::UUID;
  v_student_case_id := NULLIF(p_authorization ->> 'student_case_id', '')::UUID;

  PERFORM 1
  FROM platform_private.amocrm_runtime_actor(
    p_organization_id,
    v_actor_role,
    v_workflow_scope,
    v_workflow_lead_id,
    v_student_case_id
  );

  SELECT attempt.id
  INTO attempt_id
  FROM platform_private.amocrm_command_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.workflow_lead_id = v_workflow_lead_id
    AND attempt.person_id IS NOT DISTINCT FROM p_person_id
    AND attempt.lead_id IS NOT DISTINCT FROM p_lead_id
    AND attempt.status = 'unknown'
  ORDER BY attempt.created_at DESC, attempt.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN platform_private.amocrm_command_snapshot(attempt_id);
END
$$;

CREATE OR REPLACE FUNCTION platform.read_amocrm_command_by_idempotency_key(
  p_organization_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.amocrm_command_snapshot(attempt.id)
  FROM platform_private.amocrm_command_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.idempotency_key = p_idempotency_key
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.read_amocrm_command_for_reconciliation(
  p_organization_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row platform_private.amocrm_command_attempts%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'invalid amocrm reconciliation lookup'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO attempt_row
  FROM platform_private.amocrm_command_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm command attempt not found'
      USING ERRCODE = '02000';
  END IF;

  RETURN platform_private.amocrm_command_snapshot(attempt_row.id)
    || jsonb_build_object(
      'payload', attempt_row.payload,
      'dispatch_request_id', attempt_row.dispatch_request_id,
      'dispatch_request_sha256', attempt_row.dispatch_request_sha256,
      'dispatch_worker_ref', attempt_row.dispatch_worker_ref,
      'dispatch_claimed_at', attempt_row.dispatch_claimed_at,
      'dispatch_lease_expires_at', attempt_row.dispatch_lease_expires_at,
      'finish_request_id', attempt_row.finish_request_id,
      'finish_request_sha256', attempt_row.finish_request_sha256,
      'reconcile_request_id', attempt_row.reconcile_request_id,
      'reconcile_request_sha256', attempt_row.reconcile_request_sha256,
      'provider_request_id', attempt_row.provider_request_id,
      'provider_http_status', attempt_row.provider_http_status,
      'provider_readback', attempt_row.provider_readback,
      'provider_readback_sha256', attempt_row.provider_readback_sha256,
      'provider_readback_at', attempt_row.provider_readback_at,
      'provider_responded_at', attempt_row.provider_responded_at,
      'settled_at', attempt_row.settled_at,
      'last_reconciled_at', attempt_row.last_reconciled_at,
      'created_at', attempt_row.created_at,
      'updated_at', attempt_row.updated_at,
      'version', attempt_row.version
    );
END
$$;

CREATE OR REPLACE FUNCTION platform.claim_amocrm_command(
  p_organization_id UUID,
  p_attempt_id UUID,
  p_request_id UUID,
  p_worker_ref TEXT,
  p_visibility_timeout_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row platform_private.amocrm_command_attempts%ROWTYPE;
  request_sha256 TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_attempt_id IS NULL
    OR p_request_id IS NULL
    OR p_worker_ref IS NULL
    OR p_worker_ref <> pg_catalog.btrim(p_worker_ref)
    OR pg_catalog.char_length(p_worker_ref) NOT BETWEEN 1 AND 200
    OR p_worker_ref ~ '[[:cntrl:]]'
    OR p_visibility_timeout_seconds IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
  THEN
    RAISE EXCEPTION 'invalid amocrm command claim'
      USING ERRCODE = '22023';
  END IF;

  request_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'attempt_id', p_attempt_id,
          'request_id', p_request_id,
          'worker_ref', p_worker_ref,
          'visibility_timeout_seconds', p_visibility_timeout_seconds
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT *
  INTO attempt_row
  FROM platform_private.amocrm_command_attempts
  WHERE organization_id = p_organization_id
    AND id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm command attempt not found'
      USING ERRCODE = '22023';
  END IF;

  IF attempt_row.dispatch_request_id = p_request_id THEN
    IF attempt_row.dispatch_request_sha256 IS DISTINCT FROM request_sha256 THEN
      RAISE EXCEPTION 'amocrm claim request id was reused with different input'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'kind', 'replay',
      'reason', NULL,
      'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
    );
  END IF;

  IF attempt_row.status <> 'prepared'
    OR attempt_row.dispatch_request_id IS NOT NULL
    OR attempt_row.provider_dispatched_at IS NOT NULL
  THEN
    RETURN jsonb_build_object(
      'kind', 'blocked',
      'reason', 'dispatch_already_claimed',
      'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
    );
  END IF;

  UPDATE platform_private.amocrm_command_attempts
  SET
    dispatch_request_id = p_request_id,
    dispatch_request_sha256 = request_sha256,
    dispatch_worker_ref = p_worker_ref,
    dispatch_claimed_at = statement_timestamp(),
    dispatch_lease_expires_at = statement_timestamp()
      + make_interval(secs => p_visibility_timeout_seconds),
    provider_dispatched_at = statement_timestamp(),
    version = version + 1
  WHERE id = attempt_row.id
    AND status = 'prepared'
    AND dispatch_request_id IS NULL
    AND provider_dispatched_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm command claim state conflict'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'kind', 'claimed',
    'reason', NULL,
    'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_amocrm_command(
  p_organization_id UUID,
  p_attempt_id UUID,
  p_request_id UUID,
  p_outcome TEXT,
  p_provider_request_id TEXT,
  p_provider_http_status INTEGER,
  p_provider_readback JSONB,
  p_provider_responded_at TIMESTAMPTZ,
  p_result_contact_id TEXT,
  p_result_lead_id TEXT,
  p_failure_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row platform_private.amocrm_command_attempts%ROWTYPE;
  computed_readback_sha256 TEXT;
  request_sha256 TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_attempt_id IS NULL
    OR p_request_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome NOT IN ('accepted', 'unknown', 'rejected')
    OR (
      p_provider_request_id IS NOT NULL
      AND (
        p_provider_request_id <> pg_catalog.btrim(p_provider_request_id)
        OR pg_catalog.char_length(p_provider_request_id) NOT BETWEEN 1 AND 200
        OR p_provider_request_id ~ '[[:cntrl:]]'
      )
    )
    OR (
      p_provider_http_status IS NOT NULL
      AND p_provider_http_status NOT BETWEEN 100 AND 599
    )
    OR (
      p_provider_readback IS NOT NULL
      AND jsonb_typeof(p_provider_readback) <> 'object'
    )
    OR (
      p_result_contact_id IS NOT NULL
      AND p_result_contact_id !~ '^[1-9][0-9]{0,19}$'
    )
    OR (
      p_result_lead_id IS NOT NULL
      AND p_result_lead_id !~ '^[1-9][0-9]{0,19}$'
    )
    OR (
      p_failure_code IS NOT NULL
      AND (
        p_failure_code <> pg_catalog.btrim(p_failure_code)
        OR pg_catalog.char_length(p_failure_code) NOT BETWEEN 1 AND 64
        OR p_failure_code !~ '^[a-z][a-z0-9_]{1,63}$'
      )
    )
    OR (
      p_outcome = 'accepted'
      AND (
        p_provider_http_status IS NULL
        OR p_provider_http_status NOT BETWEEN 200 AND 299
        OR p_provider_responded_at IS NULL
        OR p_provider_readback IS NULL
        OR p_failure_code IS NOT NULL
      )
    )
    OR (
      p_outcome = 'rejected'
      AND NOT COALESCE((
        (
          p_provider_request_id IS NULL
          AND p_provider_http_status IS NULL
          AND p_provider_readback IS NULL
          AND p_provider_responded_at IS NULL
          AND p_result_contact_id IS NULL
          AND p_result_lead_id IS NULL
          AND p_failure_code = 'token_unavailable'
        )
        OR (
          p_provider_http_status BETWEEN 300 AND 499
          AND p_provider_responded_at IS NOT NULL
          AND p_result_contact_id IS NULL
          AND p_result_lead_id IS NULL
          AND p_failure_code IS NOT NULL
        )
      ), FALSE)
    )
    OR (
      p_outcome = 'unknown'
      AND (
        p_result_contact_id IS NOT NULL
        OR p_result_lead_id IS NOT NULL
        OR p_failure_code IS NULL
        OR (
          p_provider_responded_at IS NULL
          AND (
            p_provider_http_status IS NOT NULL
            OR p_provider_request_id IS NOT NULL
          )
        )
        OR (
          p_provider_responded_at IS NOT NULL
          AND p_provider_http_status IS NULL
        )
      )
    )
  THEN
    RAISE EXCEPTION 'invalid amocrm command settlement'
      USING ERRCODE = '22023';
  END IF;

  computed_readback_sha256 := CASE
    WHEN p_provider_readback IS NULL THEN NULL
    ELSE pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(p_provider_readback::TEXT, 'UTF8')
      ),
      'hex'
    )
  END;

  request_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'attempt_id', p_attempt_id,
          'request_id', p_request_id,
          'outcome', p_outcome,
          'provider_request_id', p_provider_request_id,
          'provider_http_status', p_provider_http_status,
          'provider_readback', p_provider_readback,
          'provider_readback_sha256', computed_readback_sha256,
          'provider_responded_at', p_provider_responded_at,
          'result_contact_id', p_result_contact_id,
          'result_lead_id', p_result_lead_id,
          'failure_code', p_failure_code
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT *
  INTO attempt_row
  FROM platform_private.amocrm_command_attempts
  WHERE organization_id = p_organization_id
    AND id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm command attempt not found'
      USING ERRCODE = '22023';
  END IF;

  IF attempt_row.finish_request_id = p_request_id THEN
    IF attempt_row.finish_request_sha256 IS DISTINCT FROM request_sha256 THEN
      RAISE EXCEPTION 'amocrm finish request id was reused with different input'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'kind', 'replay',
      'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
    );
  END IF;

  IF attempt_row.status <> 'prepared'
    OR attempt_row.dispatch_request_id IS NULL
    OR attempt_row.provider_dispatched_at IS NULL
  THEN
    RAISE EXCEPTION 'amocrm command finish state conflict'
      USING ERRCODE = '55000';
  END IF;

  IF p_provider_responded_at IS NOT NULL
    AND p_provider_responded_at < attempt_row.provider_dispatched_at
  THEN
    RAISE EXCEPTION 'invalid amocrm command settlement chronology'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'accepted'
    AND NOT (
      (
        attempt_row.operation_name = 'contact_create'
        AND p_result_contact_id IS NOT NULL
        AND p_result_lead_id IS NULL
      )
      OR (
        attempt_row.operation_name = 'contact_update'
        AND p_result_contact_id = attempt_row.target_contact_id
        AND p_result_lead_id IS NULL
      )
      OR (
        attempt_row.operation_name = 'lead_create'
        AND p_result_contact_id IS NULL
        AND p_result_lead_id IS NOT NULL
      )
      OR (
        attempt_row.operation_name IN (
          'lead_update',
          'lead_pipeline_status_update',
          'lead_responsible_update',
          'lead_note_create',
          'lead_task_create',
          'lead_tag_update'
        )
        AND p_result_contact_id IS NULL
        AND p_result_lead_id = attempt_row.target_lead_id
      )
      OR (
        attempt_row.operation_name = 'contact_lead_link'
        AND p_result_contact_id = attempt_row.target_contact_id
        AND p_result_lead_id = attempt_row.target_lead_id
      )
    )
  THEN
    RAISE EXCEPTION 'accepted amoCRM result does not match the command operation'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform_private.amocrm_command_attempts
  SET
    status = p_outcome::platform.amocrm_command_status,
    finish_request_id = p_request_id,
    finish_request_sha256 = request_sha256,
    provider_request_id = p_provider_request_id,
    provider_http_status = p_provider_http_status,
    provider_readback = p_provider_readback,
    provider_readback_sha256 = computed_readback_sha256,
    provider_readback_at = CASE
      WHEN p_provider_readback IS NULL THEN provider_readback_at
      ELSE statement_timestamp()
    END,
    provider_responded_at = p_provider_responded_at,
    result_contact_id = p_result_contact_id,
    result_lead_id = p_result_lead_id,
    failure_code = p_failure_code,
    settled_at = statement_timestamp(),
    version = version + 1
  WHERE id = attempt_row.id;

  IF p_outcome = 'accepted' THEN
    IF p_result_contact_id IS NOT NULL AND attempt_row.person_id IS NOT NULL THEN
      INSERT INTO platform_private.amocrm_contact_bindings AS binding (
        organization_id,
        person_id,
        contact_id,
        latest_attempt_id
      ) VALUES (
        p_organization_id,
        attempt_row.person_id,
        p_result_contact_id,
        attempt_row.id
      )
      ON CONFLICT (organization_id, person_id) DO UPDATE
      SET latest_attempt_id = EXCLUDED.latest_attempt_id
      WHERE binding.contact_id = EXCLUDED.contact_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted amoCRM contact binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    IF p_result_lead_id IS NOT NULL AND attempt_row.lead_id IS NOT NULL THEN
      INSERT INTO platform_private.amocrm_lead_bindings AS binding (
        organization_id,
        lead_id,
        provider_lead_id,
        latest_attempt_id
      ) VALUES (
        p_organization_id,
        attempt_row.lead_id,
        p_result_lead_id,
        attempt_row.id
      )
      ON CONFLICT (organization_id, lead_id) DO UPDATE
      SET latest_attempt_id = EXCLUDED.latest_attempt_id
      WHERE binding.provider_lead_id = EXCLUDED.provider_lead_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted amoCRM lead binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', 'settled',
    'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.reconcile_unknown_amocrm_command(
  p_organization_id UUID,
  p_attempt_id UUID,
  p_request_id UUID,
  p_outcome TEXT,
  p_provider_readback JSONB,
  p_provider_readback_at TIMESTAMPTZ,
  p_provider_responded_at TIMESTAMPTZ,
  p_result_contact_id TEXT,
  p_result_lead_id TEXT,
  p_failure_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row platform_private.amocrm_command_attempts%ROWTYPE;
  computed_readback_sha256 TEXT;
  request_sha256 TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amocrm_command_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_attempt_id IS NULL
    OR p_request_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome NOT IN ('accepted', 'unchanged')
    OR (
      p_provider_readback IS NOT NULL
      AND jsonb_typeof(p_provider_readback) <> 'object'
    )
    OR (p_provider_readback IS NULL) <> (p_provider_readback_at IS NULL)
    OR (
      p_result_contact_id IS NOT NULL
      AND p_result_contact_id !~ '^[1-9][0-9]{0,19}$'
    )
    OR (
      p_result_lead_id IS NOT NULL
      AND p_result_lead_id !~ '^[1-9][0-9]{0,19}$'
    )
    OR (
      p_failure_code IS NOT NULL
      AND (
        p_failure_code <> pg_catalog.btrim(p_failure_code)
        OR pg_catalog.char_length(p_failure_code) NOT BETWEEN 1 AND 64
        OR p_failure_code !~ '^[a-z][a-z0-9_]{1,63}$'
      )
    )
    OR (
      p_outcome = 'accepted'
      AND (
        p_provider_readback IS NULL
        OR p_failure_code IS NOT NULL
      )
    )
    OR (
      p_outcome = 'unchanged'
      AND (
        p_result_contact_id IS NOT NULL
        OR p_result_lead_id IS NOT NULL
        OR p_failure_code IS NULL
      )
    )
  THEN
    RAISE EXCEPTION 'invalid amocrm command reconciliation'
      USING ERRCODE = '22023';
  END IF;

  computed_readback_sha256 := CASE
    WHEN p_provider_readback IS NULL THEN NULL
    ELSE pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(p_provider_readback::TEXT, 'UTF8')
      ),
      'hex'
    )
  END;

  request_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'attempt_id', p_attempt_id,
          'request_id', p_request_id,
          'outcome', p_outcome,
          'provider_readback', p_provider_readback,
          'provider_readback_sha256', computed_readback_sha256,
          'provider_readback_at', p_provider_readback_at,
          'provider_responded_at', p_provider_responded_at,
          'result_contact_id', p_result_contact_id,
          'result_lead_id', p_result_lead_id,
          'failure_code', p_failure_code
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT *
  INTO attempt_row
  FROM platform_private.amocrm_command_attempts
  WHERE organization_id = p_organization_id
    AND id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'amocrm command attempt not found'
      USING ERRCODE = '22023';
  END IF;

  IF attempt_row.reconcile_request_id = p_request_id THEN
    IF attempt_row.reconcile_request_sha256 IS DISTINCT FROM request_sha256 THEN
      RAISE EXCEPTION 'amocrm reconcile request id was reused with different input'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'kind', 'replay',
      'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
    );
  END IF;

  IF attempt_row.status NOT IN ('prepared', 'unknown')
    OR (
      attempt_row.status = 'prepared'
      AND attempt_row.provider_dispatched_at IS NULL
    )
  THEN
    RAISE EXCEPTION 'amocrm command reconcile state conflict'
      USING ERRCODE = '55000';
  END IF;

  IF attempt_row.provider_dispatched_at IS NULL
    OR (
      p_provider_readback_at IS NOT NULL
      AND p_provider_readback_at < attempt_row.provider_dispatched_at
    )
    OR (
      p_provider_responded_at IS NOT NULL
      AND p_provider_responded_at < attempt_row.provider_dispatched_at
    )
    OR (
      p_outcome = 'accepted'
      AND COALESCE(
        p_provider_responded_at,
        attempt_row.provider_responded_at
      ) IS NULL
    )
  THEN
    RAISE EXCEPTION 'invalid amocrm command reconciliation chronology'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'accepted'
    AND NOT (
      (
        attempt_row.operation_name = 'contact_create'
        AND p_result_contact_id IS NOT NULL
        AND p_result_lead_id IS NULL
      )
      OR (
        attempt_row.operation_name = 'contact_update'
        AND p_result_contact_id = attempt_row.target_contact_id
        AND p_result_lead_id IS NULL
      )
      OR (
        attempt_row.operation_name = 'lead_create'
        AND p_result_contact_id IS NULL
        AND p_result_lead_id IS NOT NULL
      )
      OR (
        attempt_row.operation_name IN (
          'lead_update',
          'lead_pipeline_status_update',
          'lead_responsible_update',
          'lead_note_create',
          'lead_task_create',
          'lead_tag_update'
        )
        AND p_result_contact_id IS NULL
        AND p_result_lead_id = attempt_row.target_lead_id
      )
      OR (
        attempt_row.operation_name = 'contact_lead_link'
        AND p_result_contact_id = attempt_row.target_contact_id
        AND p_result_lead_id = attempt_row.target_lead_id
      )
    )
  THEN
    RAISE EXCEPTION 'accepted amoCRM result does not match the command operation'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'accepted' THEN
    UPDATE platform_private.amocrm_command_attempts
    SET
      status = 'accepted',
      reconcile_request_id = p_request_id,
      reconcile_request_sha256 = request_sha256,
      provider_readback = p_provider_readback,
      provider_readback_sha256 = computed_readback_sha256,
      provider_readback_at = COALESCE(p_provider_readback_at, statement_timestamp()),
      provider_responded_at = COALESCE(p_provider_responded_at, provider_responded_at),
      result_contact_id = p_result_contact_id,
      result_lead_id = p_result_lead_id,
      failure_code = NULL,
      last_reconciled_at = statement_timestamp(),
      version = version + 1
    WHERE id = attempt_row.id;

    IF p_result_contact_id IS NOT NULL AND attempt_row.person_id IS NOT NULL THEN
      INSERT INTO platform_private.amocrm_contact_bindings AS binding (
        organization_id,
        person_id,
        contact_id,
        latest_attempt_id
      ) VALUES (
        p_organization_id,
        attempt_row.person_id,
        p_result_contact_id,
        attempt_row.id
      )
      ON CONFLICT (organization_id, person_id) DO UPDATE
      SET latest_attempt_id = EXCLUDED.latest_attempt_id
      WHERE binding.contact_id = EXCLUDED.contact_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted amoCRM contact binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    IF p_result_lead_id IS NOT NULL AND attempt_row.lead_id IS NOT NULL THEN
      INSERT INTO platform_private.amocrm_lead_bindings AS binding (
        organization_id,
        lead_id,
        provider_lead_id,
        latest_attempt_id
      ) VALUES (
        p_organization_id,
        attempt_row.lead_id,
        p_result_lead_id,
        attempt_row.id
      )
      ON CONFLICT (organization_id, lead_id) DO UPDATE
      SET latest_attempt_id = EXCLUDED.latest_attempt_id
      WHERE binding.provider_lead_id = EXCLUDED.provider_lead_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted amoCRM lead binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'kind', 'reconciled',
      'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
    );
  END IF;

  UPDATE platform_private.amocrm_command_attempts
  SET
    status = 'unknown',
    reconcile_request_id = p_request_id,
    reconcile_request_sha256 = request_sha256,
    provider_readback = COALESCE(p_provider_readback, provider_readback),
    provider_readback_sha256 = COALESCE(
      computed_readback_sha256,
      provider_readback_sha256
    ),
    provider_readback_at = COALESCE(p_provider_readback_at, provider_readback_at),
    provider_responded_at = COALESCE(p_provider_responded_at, provider_responded_at),
    failure_code = COALESCE(p_failure_code, failure_code),
    last_reconciled_at = statement_timestamp(),
    version = version + 1
  WHERE id = attempt_row.id;

  RETURN jsonb_build_object(
    'kind', 'unchanged',
    'attempt', platform_private.amocrm_command_snapshot(attempt_row.id)
  );
END
$$;

REVOKE ALL ON FUNCTION platform.prepare_amocrm_command(
  UUID, JSONB, UUID, UUID, platform.amocrm_command_operation, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION platform.read_staff_amocrm_bindings(
  UUID, JSONB, UUID, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION platform.read_staff_blocking_amocrm_command(
  UUID, JSONB, UUID, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION platform.read_amocrm_command_by_idempotency_key(
  UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.read_amocrm_command_for_reconciliation(
  UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.claim_amocrm_command(
  UUID, UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.finish_amocrm_command(
  UUID, UUID, UUID, TEXT, TEXT, INTEGER, JSONB, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.reconcile_unknown_amocrm_command(
  UUID, UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.prepare_amocrm_command(
  UUID, JSONB, UUID, UUID, platform.amocrm_command_operation, TEXT, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.read_staff_amocrm_bindings(
  UUID, JSONB, UUID, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.read_staff_blocking_amocrm_command(
  UUID, JSONB, UUID, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.read_amocrm_command_by_idempotency_key(
  UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.read_amocrm_command_for_reconciliation(
  UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.claim_amocrm_command(
  UUID, UUID, UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.finish_amocrm_command(
  UUID, UUID, UUID, TEXT, TEXT, INTEGER, JSONB, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.reconcile_unknown_amocrm_command(
  UUID, UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;

COMMIT;
