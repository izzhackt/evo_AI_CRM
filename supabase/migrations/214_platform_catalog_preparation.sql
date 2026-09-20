-- B3b: a selected catalogue intake starts preparation in an EXISTING case.
-- Contract: docs/EVO_LAUNCH_PLAN.md, 2026-09-20 B3b / 214 (e337a135).
-- This is binding/readback only. Requirements, slots and package submission
-- remain later slices; an application in preparation is not document readiness.
-- 211's immutable publication is the snapshot: do not copy it into another
-- revision store. Existing manual applications and their commands stay intact.
-- No permissions, cases, sales, identities, files or requirements are created.
BEGIN;

CREATE TABLE platform_private.catalog_preparation_bindings (
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  application_id UUID PRIMARY KEY,
  institution_id UUID NOT NULL,
  publication_id UUID NOT NULL REFERENCES platform_private.university_catalog_publications(id),
  program_id TEXT NOT NULL CHECK (length(program_id) BETWEEN 1 AND 64 AND program_id ~ '^[a-z0-9][a-z0-9-]*$'),
  intake_id UUID NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL,
  deadline_state_at_selection TEXT NOT NULL CHECK (deadline_state_at_selection IN ('confirmed','needs_confirmation')),
  FOREIGN KEY (organization_id, application_id, student_case_id)
    REFERENCES platform.university_applications(organization_id, id, student_case_id),
  FOREIGN KEY (organization_id, institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id),
  -- Deliberately no publication version: a later revision cannot duplicate a
  -- preparation or reopen a terminal application for the same stable intake.
  UNIQUE (organization_id, student_case_id, institution_id, program_id, intake_id)
);
CREATE INDEX catalog_preparation_publication_idx
  ON platform_private.catalog_preparation_bindings(publication_id);
ALTER TABLE platform_private.catalog_preparation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.catalog_preparation_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.catalog_preparation_bindings
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER catalog_preparation_bindings_immutable
  BEFORE UPDATE OR DELETE ON platform_private.catalog_preparation_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER catalog_preparation_bindings_no_truncate
  BEFORE TRUNCATE ON platform_private.catalog_preparation_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change();

-- The closed command inserts the binding immediately after the application in
-- the same transaction. Validate the cross-table snapshot even on that path.
CREATE FUNCTION platform_private.guard_catalog_preparation_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p platform_private.university_catalog_publications%ROWTYPE;
  a platform.university_applications%ROWTYPE; program JSONB; intake JSONB;
BEGIN
  SELECT * INTO p FROM platform_private.university_catalog_publications
    WHERE id = NEW.publication_id AND organization_id = NEW.organization_id
      AND institution_id = NEW.institution_id AND status = 'published';
  SELECT * INTO a FROM platform.university_applications
    WHERE id = NEW.application_id AND organization_id = NEW.organization_id
      AND student_case_id = NEW.student_case_id;
  SELECT item INTO program FROM jsonb_array_elements(p.content->'programs') item
    WHERE item->>'id' = NEW.program_id;
  SELECT item INTO intake FROM jsonb_array_elements(program->'intakes') item
    WHERE item->>'id' = NEW.intake_id::TEXT;
  IF p.id IS NULL OR a.id IS NULL OR program IS NULL OR intake IS NULL
    OR ROW(a.catalog_institution_id, a.institution_name, a.program_name, a.country, a.degree, a.university_deadline_on)
       IS DISTINCT FROM ROW(NEW.institution_id, p.content->>'name', program->>'title', p.content->>'country',
         CASE program->>'level' WHEN 'doctorate' THEN 'phd' ELSE program->>'level' END,
         CASE WHEN NEW.deadline_state_at_selection = 'confirmed'
           THEN (intake->>'applicationDeadline')::DATE ELSE NULL::DATE END)
    OR a.status <> 'preparation' OR a.version <> 1 OR a.is_primary
    OR (p.content->>'country') NOT IN ('CN','MY','AE','TR','IT','CZ')
  THEN RAISE EXCEPTION 'catalog_preparation_binding_immutable' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_preparation_bindings_validate
  BEFORE INSERT ON platform_private.catalog_preparation_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_catalog_preparation_insert();

-- Old staff detail/priority/status commands still work, but cannot relabel the
-- pinned choice, substitute its geography/degree or turn a terminal choice into
-- a fresh preparation. Manual (unbound) applications retain their old behavior.
CREATE FUNCTION platform_private.guard_catalog_preparation_application()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_private.catalog_preparation_bindings b
    WHERE b.application_id = OLD.id AND b.organization_id = OLD.organization_id) THEN
    IF ROW(NEW.catalog_institution_id, NEW.institution_name, NEW.program_name,
           NEW.country, NEW.degree, NEW.university_deadline_on)
       IS DISTINCT FROM ROW(OLD.catalog_institution_id, OLD.institution_name, OLD.program_name,
           OLD.country, OLD.degree, OLD.university_deadline_on)
    THEN RAISE EXCEPTION 'catalog_preparation_binding_immutable' USING ERRCODE = '55000'; END IF;
    IF OLD.status IN ('rejected','enrolled','withdrawn','closed')
      AND NEW.status NOT IN ('rejected','enrolled','withdrawn','closed')
    THEN RAISE EXCEPTION 'catalog_preparation_terminal' USING ERRCODE = 'PT409'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER university_applications_catalog_preparation_guard
  BEFORE UPDATE ON platform.university_applications
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_catalog_preparation_application();

-- Current authority is required even for an exact replay. The Student branch
-- uses the existing portal ownership/scope gate, never application.manage.
-- State active is a NEW-choice guard below, not a replay/existing-reader guard.
CREATE FUNCTION platform_private.catalog_preparation_actor(
  p_organization_id UUID, p_student_case_id UUID, p_student BOOLEAN, p_write BOOLEAN
) RETURNS TABLE (actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; permission_key TEXT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.organization_id IS DISTINCT FROM p_organization_id
    OR p_student IS NULL OR p_write IS NULL OR p_student_case_id IS NULL
  THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  IF p_student THEN
    IF a.platform_role IS DISTINCT FROM 'student'
      OR NOT private.platform_has_permission(p_organization_id, 'portal.read.self')
      OR NOT EXISTS (SELECT 1 FROM platform.student_cases c
        WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
          AND c.student_membership_id = a.membership_id)
      OR NOT private.platform_can_read_student_portal_case(p_organization_id, p_student_case_id)
    THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  ELSE
    permission_key := CASE WHEN p_write THEN 'application.manage' ELSE 'case.read.full' END;
    IF a.platform_role = 'student'
      OR NOT platform_private.staff_can_access_for_actor(
        p_organization_id, permission_key, 'student_case', p_student_case_id)
    THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN QUERY SELECT a.profile_id, a.membership_id, a.auth_user_id;
END $$;

-- Shared immutable selection facts. Full publication content is joined only by
-- the reader; the command receipt carries no mutable status/version/readiness.
CREATE FUNCTION platform_private.catalog_preparation_binding_json(p_application_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'applicationId', b.application_id, 'studentCaseId', b.student_case_id,
    'institutionId', b.institution_id, 'programId', b.program_id, 'intakeId', b.intake_id,
    'publicationId', b.publication_id, 'publicationVersion', p.version,
    'catalogLevel', program.value->>'level',
    'applicationDegree', CASE program.value->>'level' WHEN 'doctorate' THEN 'phd' ELSE program.value->>'level' END,
    'selectedAt', b.selected_at, 'deadlineStateAtSelection', b.deadline_state_at_selection)
  FROM platform_private.catalog_preparation_bindings b
  JOIN platform_private.university_catalog_publications p ON p.id = b.publication_id
    AND p.organization_id = b.organization_id AND p.institution_id = b.institution_id
  CROSS JOIN LATERAL jsonb_array_elements(p.content->'programs') program(value)
  WHERE b.application_id = p_application_id AND program.value->>'id' = b.program_id
$$;

CREATE FUNCTION platform_private.select_catalog_intake(
  p_organization_id UUID, p_student_case_id UUID, p_catalog_institution_id UUID,
  p_program_id TEXT, p_intake_id UUID, p_publication_version BIGINT, p_request_id UUID,
  p_student BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE;
  p platform_private.university_catalog_publications%ROWTYPE;
  b platform_private.catalog_preparation_bindings%ROWTYPE;
  program JSONB; intake JSONB; intent JSONB; expected_after JSONB; replayed JSONB;
  receipt JSONB; application_id UUID; selected_at TIMESTAMPTZ; cutoff TIMESTAMPTZ;
  local_cutoff TIMESTAMP; zone TEXT; deadline_state TEXT := 'needs_confirmation';
  fixed_reason CONSTANT TEXT := 'Catalogue intake preparation selected';
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_catalog_institution_id IS NULL
    OR p_program_id IS NULL OR length(p_program_id) NOT BETWEEN 1 AND 64
    OR p_program_id !~ '^[a-z0-9][a-z0-9-]*$' OR p_intake_id IS NULL
    OR p_intake_id::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_publication_version IS NULL OR p_publication_version NOT BETWEEN 1 AND 9007199254740990
    OR p_request_id IS NULL OR p_student IS NULL
  THEN RAISE EXCEPTION 'catalog_preparation_invalid_intent' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM platform_private.catalog_preparation_actor(
    p_organization_id, p_student_case_id, p_student, TRUE);

  -- Same order as existing request/actor commands and 211 publication:
  -- request -> organization/profile/membership -> tenant intake identity -> case.
  -- No publication lock is acquired before 211's tenant lock. Case locking also
  -- serializes old application creates/status commands. All guards are repeated
  -- after waiting; 211's lock requires a fresh READ COMMITTED snapshot.
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_student THEN
    PERFORM 1 FROM platform_private.require_domain_actor(p_organization_id, 'portal.read.self');
  ELSE
    PERFORM 1 FROM platform_private.require_case_operator(p_organization_id, p_student_case_id, 'application.manage');
  END IF;
  PERFORM platform_private.lock_university_intake_identities(p_organization_id);
  SELECT * INTO c FROM platform.student_cases
    WHERE organization_id = p_organization_id AND id = p_student_case_id FOR UPDATE;
  SELECT * INTO a FROM platform_private.catalog_preparation_actor(
    p_organization_id, p_student_case_id, p_student, TRUE);

  intent := jsonb_build_object('organizationId', p_organization_id,
    'actorMembershipId', a.actor_membership_id, 'actorKind', CASE WHEN p_student THEN 'student' ELSE 'staff' END,
    'studentCaseId', p_student_case_id, 'institutionId', p_catalog_institution_id,
    'programId', p_program_id, 'intakeId', p_intake_id,
    'publicationVersion', p_publication_version, 'requestId', p_request_id);
  expected_after := jsonb_build_object('intent', intent);
  BEGIN
    replayed := platform_private.replay_audit(p_request_id, 'application.catalog.select',
      'university_application', NULL, fixed_reason, expected_after);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE EXCEPTION 'catalog_preparation_request_conflict' USING ERRCODE = '22023';
  END;
  IF replayed IS NOT NULL THEN RETURN replayed->'receipt'; END IF;

  SELECT * INTO b FROM platform_private.catalog_preparation_bindings
    WHERE organization_id = p_organization_id AND student_case_id = p_student_case_id
      AND institution_id = p_catalog_institution_id AND program_id = p_program_id AND intake_id = p_intake_id;
  IF FOUND THEN
    -- No new eligibility or current-publication check here. Preserve the saved
    -- version and terminal status; a new request simply opens the same choice.
    application_id := b.application_id;
  ELSE
    IF c.id IS NULL OR c.state IS DISTINCT FROM 'active' OR c.portal_activated_at IS NULL
    THEN RAISE EXCEPTION 'catalog_preparation_case_ineligible' USING ERRCODE = 'PT409'; END IF;
    SELECT publication.* INTO p FROM platform_private.university_catalog_publications publication
      JOIN platform.catalog_institutions institution
        ON institution.organization_id = publication.organization_id AND institution.id = publication.institution_id
      WHERE publication.organization_id = p_organization_id AND publication.institution_id = p_catalog_institution_id
        AND publication.status = 'published' AND institution.institution_kind = 'university'
      ORDER BY publication.version DESC LIMIT 1;
    IF p.id IS NULL OR p.version IS DISTINCT FROM p_publication_version
    THEN RAISE EXCEPTION 'catalog_preparation_stale_publication' USING ERRCODE = 'PT409'; END IF;
    IF (p.content->>'country') IS NULL OR (p.content->>'country') NOT IN ('CN','MY','AE','TR','IT','CZ')
    THEN RAISE EXCEPTION 'catalog_preparation_unsupported_country' USING ERRCODE = 'PT409'; END IF;
    SELECT item INTO program FROM jsonb_array_elements(p.content->'programs') item WHERE item->>'id' = p_program_id;
    IF program IS NULL THEN RAISE EXCEPTION 'catalog_preparation_program_unavailable' USING ERRCODE = 'PT409'; END IF;
    SELECT item INTO intake FROM jsonb_array_elements(program->'intakes') item WHERE item->>'id' = p_intake_id::TEXT;
    IF intake IS NULL THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(program->'intakes') item WHERE NOT (item ? 'id'))
      THEN RAISE EXCEPTION 'catalog_preparation_intake_identity_required' USING ERRCODE = 'PT409'; END IF;
      RAISE EXCEPTION 'catalog_preparation_intake_unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF intake->>'status' = 'closed'
    THEN RAISE EXCEPTION 'catalog_preparation_intake_closed' USING ERRCODE = 'PT409'; END IF;

    -- Coordinator assumption, not a new owner-confirmed business policy:
    -- disputed/unknown dates permit preparation with needs_confirmation.
    -- Expiry is authoritative only with confirmed open/announced + date +
    -- named IANA zone. Never turn a missing zone into UTC. Date-only expires at
    -- the EXCLUSIVE next local midnight (not a fixed 24-hour UTC interval).
    -- https://www.postgresql.org/docs/current/functions-datetime.html
    -- https://www.postgresql.org/docs/current/explicit-locking.html
    zone := intake->>'timezone';
    selected_at := clock_timestamp(); -- after all lock waits, never transaction_timestamp()
    IF intake->>'status' IN ('open','announced') AND intake->>'applicationDeadline' IS NOT NULL
      AND zone IS NOT NULL
      AND (zone ~ '^[A-Za-z_]+/[A-Za-z0-9_+/-]+$' OR zone IN ('UTC','GMT'))
      AND zone !~ '^(posix|right)/'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = zone)
    THEN
      IF intake->>'deadlineTime' IS NULL THEN
        local_cutoff := ((intake->>'applicationDeadline')::DATE + 1)::TIMESTAMP;
      ELSE
        local_cutoff := (intake->>'applicationDeadline')::DATE + (intake->>'deadlineTime')::TIME;
      END IF;
      cutoff := local_cutoff AT TIME ZONE zone;
      -- A nonexistent local wall time in a DST gap is not a precise deadline.
      IF cutoff AT TIME ZONE zone = local_cutoff THEN
        deadline_state := 'confirmed';
        IF selected_at >= cutoff
        THEN RAISE EXCEPTION 'catalog_preparation_intake_expired' USING ERRCODE = 'PT409'; END IF;
      END IF;
    END IF;
    application_id := gen_random_uuid();
    -- Legacy staff deadline/report readers treat this column as authoritative.
    -- Keep disputed/uncertain source dates only in the immutable publication;
    -- do not project them into the operational deadline column.
    INSERT INTO platform.university_applications (
      id, organization_id, student_case_id, catalog_institution_id, institution_name,
      program_name, status, created_by_membership_id, version, is_primary,
      university_deadline_on, country, degree
    ) VALUES (application_id, p_organization_id, p_student_case_id, p_catalog_institution_id,
      p.content->>'name', program->>'title', 'preparation', a.actor_membership_id, 1, FALSE,
      CASE WHEN deadline_state = 'confirmed' THEN (intake->>'applicationDeadline')::DATE ELSE NULL::DATE END,
      p.content->>'country',
      CASE program->>'level' WHEN 'doctorate' THEN 'phd' ELSE program->>'level' END);
    INSERT INTO platform_private.catalog_preparation_bindings (
      organization_id, student_case_id, application_id, institution_id, publication_id,
      program_id, intake_id, selected_at, deadline_state_at_selection
    ) VALUES (p_organization_id, p_student_case_id, application_id, p_catalog_institution_id,
      p.id, p_program_id, p_intake_id, selected_at, deadline_state);
    INSERT INTO platform.university_application_events (
      organization_id, application_id, student_case_id, previous_status, new_status,
      evidence_reference, note, actor_membership_id, request_id
    ) VALUES (p_organization_id, application_id, p_student_case_id, NULL, 'preparation', NULL,
      'Подготовка выбранного набора; требования документов ещё не настроены', a.actor_membership_id, p_request_id);
  END IF;
  receipt := platform_private.catalog_preparation_binding_json(application_id)
    || jsonb_build_object('requestId', p_request_id);
  IF receipt IS NULL THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (p_organization_id, 'user', a.actor_profile_id, 'auth:' || a.actor_auth_user_id::TEXT,
    'application.catalog.select', 'university_application', application_id, NULL,
    expected_after || jsonb_build_object('receipt', receipt), fixed_reason, p_request_id);
  RETURN receipt;
END $$;

-- Separate public wrappers: callers cannot choose the authority mode. All facts
-- and the organization of a Student request are resolved from current authority.
CREATE FUNCTION platform.student_select_catalog_intake_v1(
  p_student_case_id UUID, p_catalog_institution_id UUID, p_program_id TEXT,
  p_intake_id UUID, p_publication_version BIGINT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org UUID;
BEGIN
  SELECT organization_id INTO org FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF org IS NULL THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  RETURN platform_private.select_catalog_intake(org, p_student_case_id, p_catalog_institution_id,
    p_program_id, p_intake_id, p_publication_version, p_request_id, TRUE);
END $$;
CREATE FUNCTION platform.staff_select_catalog_intake_v1(
  p_organization_id UUID, p_student_case_id UUID, p_catalog_institution_id UUID,
  p_program_id TEXT, p_intake_id UUID, p_publication_version BIGINT, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.select_catalog_intake(p_organization_id, p_student_case_id,
    p_catalog_institution_id, p_program_id, p_intake_id, p_publication_version, p_request_id, FALSE)
$$;

CREATE FUNCTION platform_private.catalog_preparations_for_case(
  p_organization_id UUID, p_student_case_id UUID, p_student BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM 1 FROM platform_private.catalog_preparation_actor(p_organization_id, p_student_case_id, p_student, FALSE);
  SELECT COALESCE(jsonb_agg(platform_private.catalog_preparation_binding_json(b.application_id)
    || jsonb_build_object('applicationStatus', a.status, 'applicationVersion', a.version::TEXT, 'content', p.content)
    ORDER BY b.selected_at, b.application_id), '[]'::JSONB)
  INTO result
  FROM platform_private.catalog_preparation_bindings b
  JOIN platform.university_applications a ON a.id = b.application_id
    AND a.organization_id = b.organization_id AND a.student_case_id = b.student_case_id
  JOIN platform_private.university_catalog_publications p ON p.id = b.publication_id
    AND p.organization_id = b.organization_id AND p.institution_id = b.institution_id
  WHERE b.organization_id = p_organization_id AND b.student_case_id = p_student_case_id;
  RETURN result; -- empty is legitimate; no silent limit or partial page
END $$;
CREATE FUNCTION platform.student_catalog_preparations_v1(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org UUID;
BEGIN
  SELECT organization_id INTO org FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF org IS NULL THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  RETURN platform_private.catalog_preparations_for_case(org, p_student_case_id, TRUE);
END $$;
CREATE FUNCTION platform.staff_case_catalog_preparations_v1(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org UUID;
BEGIN
  SELECT organization_id INTO org FROM platform.current_actor_authority() WHERE platform_role IS DISTINCT FROM 'student';
  IF org IS NULL THEN RAISE EXCEPTION 'catalog_preparation_unavailable' USING ERRCODE = '42501'; END IF;
  RETURN platform_private.catalog_preparations_for_case(org, p_student_case_id, FALSE);
END $$;

REVOKE ALL ON FUNCTION
  platform_private.guard_catalog_preparation_insert(),
  platform_private.guard_catalog_preparation_application(),
  platform_private.catalog_preparation_actor(UUID,UUID,BOOLEAN,BOOLEAN),
  platform_private.catalog_preparation_binding_json(UUID),
  platform_private.select_catalog_intake(UUID,UUID,UUID,TEXT,UUID,BIGINT,UUID,BOOLEAN),
  platform_private.catalog_preparations_for_case(UUID,UUID,BOOLEAN),
  platform.student_select_catalog_intake_v1(UUID,UUID,TEXT,UUID,BIGINT,UUID),
  platform.staff_select_catalog_intake_v1(UUID,UUID,UUID,TEXT,UUID,BIGINT,UUID),
  platform.student_catalog_preparations_v1(UUID),
  platform.staff_case_catalog_preparations_v1(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.student_select_catalog_intake_v1(UUID,UUID,TEXT,UUID,BIGINT,UUID),
  platform.staff_select_catalog_intake_v1(UUID,UUID,UUID,TEXT,UUID,BIGINT,UUID),
  platform.student_catalog_preparations_v1(UUID),
  platform.staff_case_catalog_preparations_v1(UUID)
TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
