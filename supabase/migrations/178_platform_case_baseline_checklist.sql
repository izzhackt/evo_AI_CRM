-- ============================================================
-- 178_platform_case_baseline_checklist.sql
--
-- platform.create_docs_student (176) creates a case with target_degree,
-- program_direction and applied_country_requirement_version_id all NULL.
-- The only existing baseline-checklist seeder,
-- platform.apply_country_requirement_version (053), requires an EXACT route
-- match (target_country/target_degree equality, NULL never matches) and is
-- Admin-only via platform_private.require_bw3_admin_actor, because it also
-- doubles as the editorial "approve and bind" surface. A NULL case route can
-- never satisfy that exact match, so a Docs-intake case can only ever get a
-- checklist item-by-item through platform.create_custom_document_slot.
--
-- This migration adds a second, narrower staff path for the SAME operational
-- outcome (fill the still-open route fields from one already-APPROVED
-- version, seed its baseline document_slots, and perform the identical
-- one-shot immutable binding) gated by the same
-- platform_private.require_case_operator(..., 'document.manage') check that
-- already guards custom checklist slots (108). It never authors, edits or
-- approves a country_requirement_versions row -- that editorial surface, and
-- the free-form admin apply RPC, stay exactly as 053 left them. Version
-- choice here is always explicit from a server-filtered list, never a silent
-- "latest" guess, because the binding is permanent.
-- ============================================================

BEGIN;

-- Case-scoped read: which approved, requirement-backed country requirement
-- versions could seed THIS case's baseline checklist right now. Mirrors the
-- version-matching shape of platform.staff_country_requirement_versions_for_case
-- (053), but that function requires the case's route to already be set (an
-- exact TEXT `=` join) and therefore returns nothing for a NULL route. Here a
-- NULL case route field is unconstrained; a non-NULL one must match exactly.
-- Once the case is bound, no version is ever eligible again.
CREATE FUNCTION platform.staff_case_baseline_checklist_options(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS TABLE (
  country_requirement_version_id UUID,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  checklist_version BIGINT,
  requirement_count BIGINT,
  approved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- The binding is immutable once set (053 trigger); no version is ever an
  -- option again afterward. A non-active case cannot be seeded either (the
  -- write RPC below requires state = 'active'), so offering options for it
  -- would present a form that always fails.
  IF target_case.applied_country_requirement_version_id IS NOT NULL
    OR target_case.state <> 'active'
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    version.id,
    version.target_country,
    version.target_degree,
    version.program_direction,
    version.version,
    (
      SELECT count(*)
      FROM platform.document_requirements AS requirement
      WHERE requirement.organization_id = version.organization_id
        AND requirement.target_country = version.target_country
        AND requirement.target_degree = version.target_degree
        AND requirement.program_direction IS NOT DISTINCT FROM
          version.program_direction
        AND requirement.checklist_version = version.version
        AND requirement.status = 'active'
    ),
    version.approved_at
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.status = 'approved'
    AND (
      target_case.target_country IS NULL
      OR version.target_country = target_case.target_country
    )
    AND (
      target_case.target_degree IS NULL
      OR version.target_degree = target_case.target_degree
    )
    AND (
      target_case.program_direction IS NULL
      OR version.program_direction IS NOT DISTINCT FROM
        target_case.program_direction
    )
    -- A playbook-governed case (137) has its route locked: the write RPC
    -- refuses any version that would change a route field, so only a version
    -- whose route already equals the case's is a real option there.
    AND (
      target_case.admissions_playbook_version_id IS NULL
      OR (
        version.target_country IS NOT DISTINCT FROM target_case.target_country
        AND version.target_degree IS NOT DISTINCT FROM target_case.target_degree
        AND version.program_direction IS NOT DISTINCT FROM
          target_case.program_direction
      )
    )
    AND EXISTS (
      SELECT 1
      FROM platform.document_requirements AS requirement
      WHERE requirement.organization_id = version.organization_id
        AND requirement.target_country = version.target_country
        AND requirement.target_degree = version.target_degree
        AND requirement.program_direction IS NOT DISTINCT FROM
          version.program_direction
        AND requirement.checklist_version = version.version
        AND requirement.status = 'active'
    )
  ORDER BY
    version.target_country,
    version.target_degree,
    version.program_direction,
    version.version DESC;
END
$$;

-- Case-scoped write: apply one of the above options. Same
-- 'document.manage' gate, same request-id replay idempotency pattern as
-- platform.create_custom_document_slot (108), same baseline-slot INSERT and
-- verification shape and the same one-shot binding UPDATE as
-- platform.apply_country_requirement_version (053) -- just reached from a
-- narrower, non-Admin, non-editorial entry point.
CREATE FUNCTION platform.seed_case_baseline_checklist(
  p_organization_id UUID,
  p_request_id UUID,
  p_student_case_id UUID,
  p_country_requirement_version_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  target_version platform.country_requirement_versions%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  requirement_count BIGINT;
  slot_count BIGINT;
  fixed_reason CONSTANT TEXT :=
    'Baseline checklist seeded from an approved country requirement version';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL OR p_country_requirement_version_id IS NULL THEN
    RAISE EXCEPTION 'Student case and country requirement version are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'country_requirement_version_id', p_country_requirement_version_id,
    'request_id', p_request_id
  );

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.checklist.baseline.seed',
    'student_case',
    p_student_case_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- Past this point a failure must never be mistaken for "already handled by
  -- this same request": the replay check above already ruled that out.
  IF target_case.applied_country_requirement_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'case_already_bound'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO target_version
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_country_requirement_version_id
  FOR UPDATE;

  IF NOT FOUND OR target_version.status <> 'approved' THEN
    RAISE EXCEPTION 'country_requirement_version_unavailable'
      USING ERRCODE = '22023';
  END IF;

  -- Re-check live authority after locking the case and version, mirroring
  -- 053's apply RPC: a concurrent case reassignment or scope revocation that
  -- committed between the first check and the locks must not be allowed to
  -- complete this irreversible binding on stale authorization.
  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  SELECT count(*) INTO requirement_count
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version
    AND requirement.status = 'active';

  IF requirement_count = 0 THEN
    RAISE EXCEPTION 'no_active_requirements'
      USING ERRCODE = '22023';
  END IF;

  -- The RPC only ever fills a NULL route field; an already-set field that
  -- disagrees with the chosen version is a client error, never silently
  -- overwritten.
  IF (
      target_case.target_country IS NOT NULL
      AND target_case.target_country <> target_version.target_country
    )
    OR (
      target_case.target_degree IS NOT NULL
      AND target_case.target_degree <> target_version.target_degree
    )
    OR (
      target_case.program_direction IS NOT NULL
      AND target_case.program_direction IS DISTINCT FROM
        target_version.program_direction
    )
  THEN
    RAISE EXCEPTION 'route_mismatch'
      USING ERRCODE = '22023';
  END IF;

  -- A case already governed by an admissions playbook (137) has its route
  -- guarded by a stricter, versioned trigger
  -- (platform_private.admissions_guard_case) that this RPC does not speak.
  -- Fail closed with a named error instead of tripping that trigger's own
  -- generic conflict below.
  IF target_case.admissions_playbook_version_id IS NOT NULL
    AND (
      target_case.target_country IS DISTINCT FROM target_version.target_country
      OR target_case.target_degree IS DISTINCT FROM target_version.target_degree
      OR target_case.program_direction IS DISTINCT FROM
        target_version.program_direction
    )
  THEN
    RAISE EXCEPTION 'admissions_playbook_route_locked'
      USING ERRCODE = '22023';
  END IF;

  -- Separate statement from the binding UPDATE below on purpose: the 053
  -- binding guard trigger
  -- (student_cases_country_requirement_binding_guard) reads
  -- target_country/target_degree/program_direction off the SAME row version
  -- it is updating, so the route must already equal the version's before the
  -- binding column changes. The WHERE clause is a no-op when every field
  -- already matches (a case whose route was already fully set).
  UPDATE platform.student_cases AS student_case
  SET
    target_country = target_version.target_country,
    target_degree = target_version.target_degree,
    program_direction = target_version.program_direction
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND (
      student_case.target_country IS DISTINCT FROM target_version.target_country
      OR student_case.target_degree IS DISTINCT FROM target_version.target_degree
      OR student_case.program_direction IS DISTINCT FROM
        target_version.program_direction
    );

  -- Identical INSERT/verify shape to platform.apply_country_requirement_version
  -- (053).
  INSERT INTO platform.document_slots (
    organization_id,
    student_case_id,
    requirement_id,
    status,
    deadline,
    next_action,
    created_by_membership_id
  )
  SELECT
    p_organization_id,
    p_student_case_id,
    requirement.id,
    'required',
    NULL,
    NULL,
    actor.actor_membership_id
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version
    AND requirement.status = 'active'
  ON CONFLICT (organization_id, student_case_id, requirement_id) DO NOTHING;

  SELECT count(*) INTO slot_count
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version;

  IF slot_count <> requirement_count THEN
    RAISE EXCEPTION 'Baseline checklist slot instantiation is incomplete'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.student_cases AS student_case
  SET applied_country_requirement_version_id = target_version.id
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND student_case.applied_country_requirement_version_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_already_bound'
      USING ERRCODE = 'PT409';
  END IF;

  result := replay_shape || jsonb_build_object(
    'target_country', target_version.target_country,
    'target_degree', target_version.target_degree,
    'program_direction', target_version.program_direction,
    'checklist_version', target_version.version::TEXT,
    'seeded_count', slot_count::TEXT
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'document.checklist.baseline.seed',
    'student_case',
    p_student_case_id,
    jsonb_build_object('applied_country_requirement_version_id', NULL),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Keep the Admin audit journal allowlist synchronized, same as every prior
-- migration that adds a newly-audited action (most recently 154).
-- 'student_case' is already a safe resource type (071); the new action name
-- starts with 'document.' and already falls into the existing
-- p7a_changed_field_codes catch-all for that prefix, so only the action
-- allowlist itself needs the new entry.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_case_baseline_checklist;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_case_baseline_checklist()
      || ARRAY['document.checklist.baseline.seed']::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_case_baseline_checklist(),
  platform_private.p7a_safe_audit_actions()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.staff_case_baseline_checklist_options(
  UUID,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_baseline_checklist_options(
  UUID,
  UUID
)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.seed_case_baseline_checklist(
  UUID,
  UUID,
  UUID,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.seed_case_baseline_checklist(
  UUID,
  UUID,
  UUID,
  UUID
)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_case_baseline_checklist_options(UUID, UUID)
  IS 'Case-scoped list of approved, requirement-backed country requirement versions eligible to seed this case''s baseline checklist. Empty once the case is bound.';
COMMENT ON FUNCTION platform.seed_case_baseline_checklist(UUID, UUID, UUID, UUID)
  IS 'Staff-operable counterpart to the Admin-only platform.apply_country_requirement_version (053): fills only the still-NULL case route fields from an already-approved version, seeds baseline document_slots and performs the same one-shot immutable binding.';

COMMIT;
