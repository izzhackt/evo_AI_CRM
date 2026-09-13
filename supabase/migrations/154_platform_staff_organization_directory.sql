-- S1: editable organizational details for existing real staff memberships.
-- Departments, job titles and direction assignments are descriptive only:
-- they do not grant a role, record scope, assignment eligibility or Auth access.
-- Official references reviewed for this slice (2026-09-13):
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/database/functions
BEGIN;

CREATE TABLE platform.staff_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 120
    AND name !~ '[[:cntrl:]]'
  ),
  description TEXT CHECK (
    description IS NULL OR (
      description = btrim(description) AND char_length(description) BETWEEN 1 AND 500
    )
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT staff_departments_organization_id_id_key UNIQUE (organization_id, id)
);

-- An archived name remains reserved: restore the same department instead of
-- creating a second identity with the same name and splitting its history.
CREATE UNIQUE INDEX staff_departments_organization_name_key
  ON platform.staff_departments (organization_id, lower(name));

CREATE TABLE platform.staff_organizational_details (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  department_id UUID,
  job_title TEXT CHECK (
    job_title IS NULL OR (
      job_title = btrim(job_title) AND char_length(job_title) BETWEEN 1 AND 160
      AND job_title !~ '[[:cntrl:]]'
    )
  ),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, membership_id),
  CONSTRAINT staff_organizational_details_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_organizational_details_department_fkey
    FOREIGN KEY (organization_id, department_id)
    REFERENCES platform.staff_departments(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX staff_organizational_details_department_idx
  ON platform.staff_organizational_details (organization_id, department_id);

CREATE TABLE platform.staff_direction_assignments (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  -- Reuse the Admissions direction domain from migration137. These records
  -- neither create new Admissions routes nor become permission/scope grants.
  direction_code TEXT NOT NULL CHECK (direction_code IN ('CN', 'MY', 'EUROPE', 'AE', 'TR')),
  PRIMARY KEY (organization_id, membership_id, direction_code),
  CONSTRAINT staff_direction_assignments_details_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.staff_organizational_details(organization_id, membership_id)
    ON DELETE RESTRICT
);

ALTER TABLE platform.staff_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_departments FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_organizational_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_organizational_details FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_direction_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_direction_assignments FORCE ROW LEVEL SECURITY;

-- No table policy or direct table grant: the canonical Admin RPCs below are
-- the only product read/write path, including for suspended staff records.
REVOKE ALL ON TABLE platform.staff_departments,
  platform.staff_organizational_details, platform.staff_direction_assignments
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.staff_workspace_directory(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');

  WITH staff AS MATERIALIZED (
    SELECT * FROM platform.staff_directory(p_organization_id)
  )
  SELECT jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id', member.membership_id,
        'display_name', member.display_name,
        'platform_role', member.platform_role,
        'membership_status', member.membership_status,
        'access_version', member.access_version,
        'contract_confirmation_granted', member.contract_confirmation_granted,
        'first_payment_confirmation_granted', member.first_payment_confirmation_granted,
        'admissions_gate_override_granted', member.admissions_gate_override_granted,
        'organizational_version', COALESCE(details.version, 0),
        'department_id', details.department_id,
        'job_title', details.job_title,
        'direction_codes', COALESCE((
          SELECT jsonb_agg(assignment.direction_code ORDER BY assignment.direction_code)
          FROM platform.staff_direction_assignments AS assignment
          WHERE assignment.organization_id = p_organization_id
            AND assignment.membership_id = member.membership_id
        ), '[]'::JSONB)
      ) ORDER BY lower(member.display_name), member.membership_id)
      FROM staff AS member
      LEFT JOIN platform.staff_organizational_details AS details
        ON details.organization_id = p_organization_id
        AND details.membership_id = member.membership_id
    ), '[]'::JSONB),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', department.id,
        'name', department.name,
        'description', department.description,
        'status', department.status,
        'version', department.version,
        'member_count', (
          SELECT count(*)
          FROM platform.staff_organizational_details AS details
          JOIN staff AS member ON member.membership_id = details.membership_id
          WHERE details.organization_id = department.organization_id
            AND details.department_id = department.id
        )
      ) ORDER BY lower(department.name), department.id)
      FROM platform.staff_departments AS department
      WHERE department.organization_id = p_organization_id
    ), '[]'::JSONB)
  ) INTO result;

  RETURN result;
END $$;

CREATE FUNCTION platform.staff_department_command(
  p_organization_id UUID,
  p_department_id UUID,
  p_operation TEXT,
  p_name TEXT,
  p_description TEXT,
  p_expected_version BIGINT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  department_row platform.staff_departments%ROWTYPE;
  normalized_name TEXT := btrim(p_name);
  normalized_description TEXT := NULLIF(btrim(p_description), '');
  normalized_reason TEXT := btrim(p_reason);
  input_fingerprint TEXT;
  before_state JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');

  IF p_organization_id IS NULL OR p_request_id IS NULL
    OR p_operation IS NULL OR p_operation NOT IN ('create', 'update', 'archive', 'restore')
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740990
    OR normalized_reason IS NULL OR char_length(normalized_reason) NOT BETWEEN 1 AND 500
    OR normalized_reason ~ '[[:cntrl:]]'
    OR (p_operation = 'create' AND (p_department_id IS NOT NULL OR p_expected_version <> 0))
    OR (p_operation <> 'create' AND (p_department_id IS NULL OR p_expected_version < 1))
  THEN
    RAISE EXCEPTION 'staff_department_invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_operation IN ('create', 'update') THEN
    IF normalized_name IS NULL OR char_length(normalized_name) NOT BETWEEN 1 AND 120
      OR normalized_name ~ '[[:cntrl:]]' OR char_length(normalized_description) > 500
    THEN
      RAISE EXCEPTION 'staff_department_invalid_input' USING ERRCODE = '22023';
    END IF;
  ELSIF p_name IS NOT NULL OR p_description IS NOT NULL THEN
    RAISE EXCEPTION 'staff_department_invalid_input' USING ERRCODE = '22023';
  END IF;

  input_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'actor_membership_id', actor.actor_membership_id,
    'department_id', p_department_id, 'operation', p_operation,
    'name', normalized_name, 'description', normalized_description,
    'expected_version', p_expected_version, 'reason', normalized_reason
  )::TEXT, 'UTF8')), 'hex');

  -- Match canonical audit request locking. Then use the same organization
  -- lock as staff139 so archive/assignment and concurrent creates serialize.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR UPDATE;
  SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');

  result := platform_private.replay_audit(
    p_request_id, 'staff.department.' || p_operation, 'staff_department',
    p_department_id, normalized_reason,
    jsonb_build_object('organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id, 'input_fingerprint', input_fingerprint)
  );
  IF result IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'replayed',
      'department_id', result -> 'department_id', 'version', result -> 'version');
  END IF;

  IF p_operation <> 'create' THEN
    SELECT * INTO department_row FROM platform.staff_departments AS department
      WHERE department.organization_id = p_organization_id AND department.id = p_department_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff_department_unavailable' USING ERRCODE = '42501';
    END IF;
    IF department_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'staff_department_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF (p_operation IN ('update', 'archive') AND department_row.status <> 'active')
      OR (p_operation = 'restore' AND department_row.status <> 'archived')
    THEN
      RAISE EXCEPTION 'staff_department_invalid_transition' USING ERRCODE = '22023';
    END IF;
    before_state := jsonb_build_object('department_id', department_row.id,
      'name', department_row.name, 'description', department_row.description,
      'status', department_row.status, 'version', department_row.version);
  END IF;

  IF p_operation IN ('create', 'update') AND EXISTS (
    SELECT 1 FROM platform.staff_departments AS department
    WHERE department.organization_id = p_organization_id
      AND lower(department.name) = lower(normalized_name)
      AND (p_department_id IS NULL OR department.id <> p_department_id)
  ) THEN
    RAISE EXCEPTION 'staff_department_name_exists' USING ERRCODE = '23505';
  END IF;

  changed_at := clock_timestamp();
  IF p_operation = 'create' THEN
    INSERT INTO platform.staff_departments(organization_id, name, description, created_at, updated_at)
      VALUES (p_organization_id, normalized_name, normalized_description, changed_at, changed_at)
      RETURNING * INTO department_row;
  ELSIF p_operation = 'update' THEN
    UPDATE platform.staff_departments AS department
      SET name = normalized_name, description = normalized_description,
        version = department.version + 1, updated_at = changed_at
      WHERE department.organization_id = p_organization_id AND department.id = p_department_id
      RETURNING * INTO department_row;
  ELSE
    UPDATE platform.staff_departments AS department
      SET status = CASE WHEN p_operation = 'archive' THEN 'archived' ELSE 'active' END,
        version = department.version + 1, updated_at = changed_at
      WHERE department.organization_id = p_organization_id AND department.id = p_department_id
      RETURNING * INTO department_row;
  END IF;

  result := jsonb_build_object('organization_id', p_organization_id,
    'actor_membership_id', actor.actor_membership_id, 'input_fingerprint', input_fingerprint,
    'request_id', p_request_id, 'department_id', department_row.id,
    'name', department_row.name, 'description', department_row.description,
    'department_status', department_row.status, 'version', department_row.version);
  INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id,
    actor_principal, action, resource_type, resource_id, before_state, after_state, reason,
    request_id, created_at)
  VALUES (p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'staff.department.' || p_operation,
    'staff_department', department_row.id, before_state, result, normalized_reason,
    p_request_id, changed_at);

  RETURN jsonb_build_object('status', 'applied',
    'department_id', department_row.id, 'version', department_row.version);
END $$;

CREATE FUNCTION platform.staff_organizational_details_save(
  p_organization_id UUID,
  p_membership_id UUID,
  p_department_id UUID,
  p_job_title TEXT,
  p_direction_codes TEXT[],
  p_expected_version BIGINT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  details_row platform.staff_organizational_details%ROWTYPE;
  normalized_title TEXT := NULLIF(btrim(p_job_title), '');
  normalized_reason TEXT := btrim(p_reason);
  normalized_directions TEXT[];
  previous_directions TEXT[];
  previous_version BIGINT;
  department_status TEXT;
  input_fingerprint TEXT;
  before_state JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');

  IF p_organization_id IS NULL OR p_membership_id IS NULL OR p_request_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740990
    OR normalized_reason IS NULL OR char_length(normalized_reason) NOT BETWEEN 1 AND 500
    OR normalized_reason ~ '[[:cntrl:]]'
    OR char_length(normalized_title) > 160 OR normalized_title ~ '[[:cntrl:]]'
    OR p_direction_codes IS NULL OR cardinality(p_direction_codes) > 5
    OR COALESCE(array_ndims(p_direction_codes), 1) <> 1
  THEN
    RAISE EXCEPTION 'staff_organization_invalid_input' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_direction_codes) AS direction(code)
    WHERE direction.code IS NULL OR direction.code NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR'))
  THEN
    RAISE EXCEPTION 'staff_organization_invalid_direction' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(direction.code ORDER BY direction.code), ARRAY[]::TEXT[])
    INTO normalized_directions
    FROM (SELECT DISTINCT unnest(p_direction_codes) AS code) AS direction;

  input_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'actor_membership_id', actor.actor_membership_id,
    'membership_id', p_membership_id, 'department_id', p_department_id,
    'job_title', normalized_title, 'direction_codes', normalized_directions,
    'expected_version', p_expected_version, 'reason', normalized_reason
  )::TEXT, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR UPDATE;
  SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, 'membership.read');

  -- Organizational data can describe a suspended existing employee. It must
  -- never create a membership or attach employee metadata to a Student.
  PERFORM 1 FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id AND membership.id = p_membership_id
      AND membership."current_role" IN ('admin', 'sales', 'curator')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_organization_member_unavailable' USING ERRCODE = '42501';
  END IF;

  result := platform_private.replay_audit(
    p_request_id, 'staff.organization.details.change', 'staff_organizational_details',
    p_membership_id, normalized_reason,
    jsonb_build_object('organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id, 'input_fingerprint', input_fingerprint)
  );
  IF result IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'replayed',
      'membership_id', result -> 'membership_id',
      'version', result -> 'organizational_version',
      'organizational_version', result -> 'organizational_version');
  END IF;

  SELECT * INTO details_row FROM platform.staff_organizational_details AS details
    WHERE details.organization_id = p_organization_id AND details.membership_id = p_membership_id
    FOR UPDATE;
  previous_version := COALESCE(details_row.version, 0);
  IF previous_version <> p_expected_version THEN
    RAISE EXCEPTION 'staff_organizational_version_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT department.status INTO department_status FROM platform.staff_departments AS department
      WHERE department.organization_id = p_organization_id AND department.id = p_department_id
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff_department_unavailable' USING ERRCODE = '42501';
    END IF;
    IF department_status <> 'active' AND details_row.department_id IS DISTINCT FROM p_department_id THEN
      RAISE EXCEPTION 'staff_department_archived' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(assignment.direction_code ORDER BY assignment.direction_code), ARRAY[]::TEXT[])
    INTO previous_directions
    FROM platform.staff_direction_assignments AS assignment
    WHERE assignment.organization_id = p_organization_id AND assignment.membership_id = p_membership_id;
  before_state := jsonb_build_object('membership_id', p_membership_id,
    'organizational_version', previous_version, 'department_id', details_row.department_id,
    'job_title', details_row.job_title, 'direction_codes', previous_directions);
  changed_at := clock_timestamp();

  IF previous_version = 0 THEN
    INSERT INTO platform.staff_organizational_details(organization_id, membership_id,
      department_id, job_title, created_at, updated_at)
    VALUES (p_organization_id, p_membership_id, p_department_id, normalized_title, changed_at, changed_at)
    RETURNING * INTO details_row;
  ELSE
    UPDATE platform.staff_organizational_details AS details
      SET department_id = p_department_id, job_title = normalized_title,
        version = details.version + 1, updated_at = changed_at
      WHERE details.organization_id = p_organization_id AND details.membership_id = p_membership_id
      RETURNING * INTO details_row;
  END IF;
  DELETE FROM platform.staff_direction_assignments AS assignment
    WHERE assignment.organization_id = p_organization_id AND assignment.membership_id = p_membership_id;
  INSERT INTO platform.staff_direction_assignments(organization_id, membership_id, direction_code)
    SELECT p_organization_id, p_membership_id, direction.code
    FROM unnest(normalized_directions) AS direction(code);

  result := jsonb_build_object('organization_id', p_organization_id,
    'actor_membership_id', actor.actor_membership_id, 'input_fingerprint', input_fingerprint,
    'request_id', p_request_id, 'membership_id', p_membership_id,
    'organizational_version', details_row.version, 'department_id', details_row.department_id,
    'job_title', details_row.job_title, 'direction_codes', normalized_directions);
  INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id,
    actor_principal, action, resource_type, resource_id, before_state, after_state, reason,
    request_id, created_at)
  VALUES (p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'staff.organization.details.change',
    'staff_organizational_details', p_membership_id, before_state, result, normalized_reason,
    p_request_id, changed_at);

  RETURN jsonb_build_object('status', 'applied', 'membership_id', p_membership_id,
    'version', details_row.version, 'organizational_version', details_row.version);
END $$;

REVOKE ALL ON FUNCTION platform.staff_workspace_directory(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_department_command(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_organizational_details_save(UUID, UUID, UUID, TEXT, TEXT[], BIGINT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_workspace_directory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_department_command(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_organizational_details_save(UUID, UUID, UUID, TEXT, TEXT[], BIGINT, TEXT, UUID)
  TO authenticated;

COMMENT ON TABLE platform.staff_departments
  IS 'Canonical editable staff departments. Archive preserves membership links; no authorization effects.';
COMMENT ON TABLE platform.staff_organizational_details
  IS 'Optional descriptive details of existing staff memberships. Version is independent of Auth access_version.';
COMMENT ON TABLE platform.staff_direction_assignments
  IS 'Descriptive employee assignments to existing Admissions directions; never record scopes or role grants.';
COMMENT ON FUNCTION platform.staff_workspace_directory(UUID)
  IS 'Admin directory based on canonical staff_directory, retaining real members without organizational details and omitting Auth identifiers.';

-- Reuse the safe journal projection: it exposes only action/resource/time and
-- fixed category codes, never before/after payloads, names, titles or reasons.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_staff_organization;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM unnest(platform_private.p7a_safe_audit_actions_pre_staff_organization()
    || ARRAY['staff.department.create', 'staff.department.update', 'staff.department.archive',
      'staff.department.restore', 'staff.organization.details.change']::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_staff_organization;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM unnest(platform_private.p7a_safe_audit_resource_types_pre_staff_organization()
    || ARRAY['staff_department', 'staff_organizational_details']::TEXT[]
  ) AS allowed(resource_type)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_staff_organization;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_action IN ('staff.department.create', 'staff.department.update',
      'staff.department.archive', 'staff.department.restore') THEN ARRAY['record_status']::TEXT[]
    WHEN p_action = 'staff.organization.details.change' THEN ARRAY['assignment']::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_staff_organization(p_action)
  END
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_staff_organization(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_staff_organization(),
  platform_private.p7a_safe_audit_resource_types(),
  platform_private.p7a_changed_field_codes_pre_staff_organization(TEXT),
  platform_private.p7a_changed_field_codes(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;
