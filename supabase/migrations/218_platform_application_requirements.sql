-- B218: explicit EVO starter requirements for an existing 214 preparation.
-- Contract: docs/platform/b3c-application-requirements-contract.md (f4e29237,
-- wire 6c8bb5d8). These are not confirmed university requirements. Existing
-- case checklists, files, upload/review commands and application states stay
-- unchanged. Reads never initialize or repair documents.
BEGIN;

CREATE TABLE platform_private.application_requirement_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  application_id UUID NOT NULL
    REFERENCES platform_private.catalog_preparation_bindings(application_id),
  revision_version BIGINT NOT NULL CHECK (revision_version > 0),
  origin TEXT NOT NULL CHECK (origin = 'evo_starter'),
  configuration_state TEXT NOT NULL CHECK (configuration_state = 'needs_confirmation'),
  initialized_at TIMESTAMPTZ NOT NULL,
  created_by_membership_id UUID NOT NULL,
  UNIQUE (organization_id, application_id, revision_version),
  UNIQUE (organization_id, id, student_case_id, application_id),
  FOREIGN KEY (organization_id, application_id, student_case_id)
    REFERENCES platform.university_applications(organization_id, id, student_case_id),
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

CREATE TABLE platform_private.application_requirement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  application_id UUID NOT NULL,
  revision_id UUID NOT NULL,
  requirement_key TEXT NOT NULL CHECK (
    length(requirement_key) BETWEEN 1 AND 100
    AND requirement_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  position INTEGER NOT NULL CHECK (position > 0),
  required BOOLEAN NOT NULL,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 500),
  group_label TEXT NOT NULL CHECK (length(btrim(group_label)) BETWEEN 1 AND 200),
  instructions TEXT NOT NULL CHECK (length(btrim(instructions)) BETWEEN 1 AND 4000),
  compatibility_key TEXT NOT NULL CHECK (
    length(compatibility_key) BETWEEN 1 AND 100
    AND compatibility_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  source_requirement_id UUID,
  document_slot_id UUID NOT NULL,
  UNIQUE (revision_id, requirement_key),
  UNIQUE (revision_id, position),
  UNIQUE (revision_id, document_slot_id),
  FOREIGN KEY (organization_id, revision_id, student_case_id, application_id)
    REFERENCES platform_private.application_requirement_revisions(
      organization_id, id, student_case_id, application_id
    ),
  FOREIGN KEY (organization_id, document_slot_id, student_case_id)
    REFERENCES platform.document_slots(organization_id, id, student_case_id),
  FOREIGN KEY (organization_id, source_requirement_id)
    REFERENCES platform.document_requirements(organization_id, id)
);

CREATE INDEX application_requirement_items_case_material_idx
  ON platform_private.application_requirement_items(
    organization_id, student_case_id, compatibility_key, document_slot_id
  );
CREATE INDEX application_requirement_items_source_idx
  ON platform_private.application_requirement_items(organization_id, source_requirement_id)
  WHERE source_requirement_id IS NOT NULL;

ALTER TABLE platform_private.application_requirement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.application_requirement_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.application_requirement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.application_requirement_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.application_requirement_revisions,
  platform_private.application_requirement_items
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER application_requirement_revisions_immutable
  BEFORE UPDATE OR DELETE ON platform_private.application_requirement_revisions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER application_requirement_revisions_no_truncate
  BEFORE TRUNCATE ON platform_private.application_requirement_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER application_requirement_items_immutable
  BEFORE UPDATE OR DELETE ON platform_private.application_requirement_items
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER application_requirement_items_no_truncate
  BEFORE TRUNCATE ON platform_private.application_requirement_items
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Authority is independent of NEW eligibility: a closed application may still
-- replay its receipt/read its requirements, but revoked access never may.
CREATE FUNCTION platform_private.application_requirements_actor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_student BOOLEAN,
  p_write BOOLEAN
)
RETURNS TABLE (actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  permission_key TEXT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL
    OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR p_student_case_id IS NULL OR p_student IS NULL OR p_write IS NULL
  THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_student THEN
    IF actor.platform_role IS DISTINCT FROM 'student'
      OR NOT private.platform_has_permission(p_organization_id, 'document.read.self')
      OR NOT private.platform_can_read_student_portal_case(p_organization_id, p_student_case_id)
      OR NOT EXISTS (
        SELECT 1 FROM platform.student_cases AS student_case
        WHERE student_case.organization_id = p_organization_id
          AND student_case.id = p_student_case_id
          AND student_case.student_membership_id = actor.membership_id
          -- Match 192's document read boundary; writes check NEW state later.
          AND (p_write OR student_case.state IN ('active', 'closed'))
      )
    THEN
      RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
    END IF;
  ELSE
    permission_key := CASE WHEN p_write THEN 'document.manage' ELSE 'document.read.full' END;
    IF actor.platform_role = 'student'
      OR NOT platform_private.staff_can_access_for_actor(
        p_organization_id, permission_key, 'student_case', p_student_case_id
      )
    THEN
      RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY SELECT actor.profile_id, actor.membership_id, actor.auth_user_id;
END
$$;

-- 108 still permits metadata edits. The immutable item provides the typed
-- definition; a label alone never gives an old/untyped slot that provenance.
CREATE FUNCTION platform_private.application_requirement_slot_matches(
  p_slot platform.document_slots,
  p_item platform_private.application_requirement_items
)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (p_slot).intent_kind = 'custom'
    AND (p_slot).requirement_id IS NULL
    AND (p_slot).display_label IS NOT DISTINCT FROM (p_item).label
    AND (p_slot).group_label IS NOT DISTINCT FROM (p_item).group_label,
    FALSE
  )
$$;

-- Only call this for an application without a requirements revision. Own 218
-- links are intentionally not inspected on the existing-revision/replay path.
CREATE FUNCTION platform_private.application_requirement_configuration_reasons(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_application_id UUID
)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND student_case.applied_country_requirement_version_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM platform.document_slots AS slot
    WHERE slot.organization_id = p_organization_id
      AND slot.student_case_id = p_student_case_id AND slot.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM platform_private.application_requirement_items AS item
        JOIN platform_private.application_requirement_revisions AS revision
          ON revision.id = item.revision_id AND revision.organization_id = item.organization_id
          AND revision.student_case_id = item.student_case_id
          AND revision.application_id = item.application_id
        WHERE item.organization_id = slot.organization_id
          AND item.student_case_id = slot.student_case_id AND item.document_slot_id = slot.id
          AND revision.origin = 'evo_starter' AND item.source_requirement_id IS NULL
          AND item.compatibility_key IN ('evo.photo.v1', 'evo.passport.v1')
      )
  ) THEN
    reasons := array_append(reasons, 'legacy_case_checklist');
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform.document_slot_case_links AS link
    WHERE link.organization_id = p_organization_id
      AND link.student_case_id = p_student_case_id
      AND link.university_application_id = p_application_id
  ) THEN
    reasons := array_append(reasons, 'legacy_application_links');
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id AND application.id = p_application_id
      AND application.admissions_details ?| ARRAY[
        'documentsApplicability', 'documentsSource', 'documentsCheckedOn',
        'documentSlotIds', 'documentExceptionSlotIds',
        'documentsExceptionReason', 'documentsExceptionEvidence'
      ]::TEXT[]
  ) THEN
    reasons := array_append(reasons, 'legacy_application_configuration');
  END IF;

  IF EXISTS (
    SELECT item.compatibility_key
    FROM platform_private.application_requirement_items AS item
    JOIN platform.document_slots AS slot
      ON slot.organization_id = item.organization_id AND slot.student_case_id = item.student_case_id
      AND slot.id = item.document_slot_id
    WHERE item.organization_id = p_organization_id AND item.student_case_id = p_student_case_id
      AND item.compatibility_key IN ('evo.photo.v1', 'evo.passport.v1')
      AND item.source_requirement_id IS NULL AND slot.removed_at IS NULL
    GROUP BY item.compatibility_key HAVING count(DISTINCT slot.id) > 1
  ) THEN
    reasons := array_append(reasons, 'ambiguous_material');
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform_private.application_requirement_items AS item
    JOIN platform.document_slots AS slot
      ON slot.organization_id = item.organization_id AND slot.student_case_id = item.student_case_id
      AND slot.id = item.document_slot_id
    WHERE item.organization_id = p_organization_id AND item.student_case_id = p_student_case_id
      AND item.compatibility_key IN ('evo.photo.v1', 'evo.passport.v1')
      AND item.source_requirement_id IS NULL AND slot.removed_at IS NULL
      AND NOT platform_private.application_requirement_slot_matches(slot, item)
  ) THEN
    reasons := array_append(reasons, 'material_metadata_changed');
  END IF;
  -- A previously removed typed material is not silently replaced. An existing
  -- active compatible material is considered separately; no old link is fixed.
  IF EXISTS (
    SELECT 1 FROM platform_private.application_requirement_items AS item
    JOIN platform.document_slots AS slot
      ON slot.organization_id = item.organization_id AND slot.student_case_id = item.student_case_id
      AND slot.id = item.document_slot_id
    WHERE item.organization_id = p_organization_id AND item.student_case_id = p_student_case_id
      AND item.compatibility_key IN ('evo.photo.v1', 'evo.passport.v1')
      AND item.source_requirement_id IS NULL AND slot.removed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM platform_private.application_requirement_items AS active_item
        JOIN platform.document_slots AS active_slot
          ON active_slot.organization_id = active_item.organization_id
          AND active_slot.student_case_id = active_item.student_case_id
          AND active_slot.id = active_item.document_slot_id
        WHERE active_item.organization_id = item.organization_id
          AND active_item.student_case_id = item.student_case_id
          AND active_item.compatibility_key = item.compatibility_key
          AND active_item.source_requirement_id IS NULL AND active_slot.removed_at IS NULL
      )
  ) THEN
    reasons := array_append(reasons, 'material_association_unavailable');
  END IF;
  RETURN reasons;
END
$$;

CREATE FUNCTION platform_private.application_requirement_receipt(
  p_revision_id UUID,
  p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  revision platform_private.application_requirement_revisions%ROWTYPE;
  items JSONB;
  item_keys TEXT[];
BEGIN
  SELECT * INTO revision FROM platform_private.application_requirement_revisions
  WHERE id = p_revision_id;
  SELECT array_agg(item.requirement_key ORDER BY item.position),
    jsonb_agg(jsonb_build_object(
      'requirementItemId', item.id,
      'requirementKey', item.requirement_key,
      'documentSlotId', item.document_slot_id
    ) ORDER BY item.position)
  INTO item_keys, items
  FROM platform_private.application_requirement_items AS item
  WHERE item.revision_id = p_revision_id;
  IF revision.id IS NULL OR item_keys IS DISTINCT FROM ARRAY['evo.photo.v1', 'evo.passport.v1']::TEXT[] THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'requestId', p_request_id, 'studentCaseId', revision.student_case_id,
    'applicationId', revision.application_id, 'revisionId', revision.id,
    'revisionVersion', revision.revision_version::TEXT, 'origin', revision.origin,
    'configurationState', revision.configuration_state,
    'initializedAt', revision.initialized_at, 'items', items
  );
END
$$;

CREATE FUNCTION platform_private.initialize_application_requirements(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_application_id UUID,
  p_request_id UUID,
  p_student BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  application platform.university_applications%ROWTYPE;
  revision platform_private.application_requirement_revisions%ROWTYPE;
  material RECORD;
  slot platform.document_slots%ROWTYPE;
  intent JSONB;
  replayed JSONB;
  receipt JSONB;
  audit_constraint TEXT;
  fixed_reason CONSTANT TEXT := 'EVO starter application requirements initialized';
  starter_group CONSTANT TEXT := 'Стартовый список EVO';
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_application_id IS NULL
    OR p_request_id IS NULL OR p_student IS NULL
  THEN
    RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.application_requirements_actor(
    p_organization_id, p_student_case_id, p_student, TRUE
  );
  PERFORM platform_private.lock_p2e_request(p_request_id);
  BEGIN
    IF p_student THEN
      PERFORM 1 FROM platform_private.require_domain_actor(p_organization_id, 'document.read.self');
    ELSE
      PERFORM 1 FROM platform_private.require_case_operator(
        p_organization_id, p_student_case_id, 'document.manage'
      );
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END;

  -- Existing Docs commands use request -> actor -> case -> slot/application.
  -- Holding the same case before looking for materials serializes two different
  -- applications' first initialization as well as 108/113/179 mutations.
  SELECT * INTO target_case FROM platform.student_cases
  WHERE organization_id = p_organization_id AND id = p_student_case_id FOR UPDATE;
  SELECT candidate.* INTO application
  FROM platform.university_applications AS candidate
  JOIN platform_private.catalog_preparation_bindings AS binding
    ON binding.organization_id = candidate.organization_id
    AND binding.student_case_id = candidate.student_case_id AND binding.application_id = candidate.id
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id AND candidate.id = p_application_id
  FOR UPDATE OF candidate;
  IF target_case.id IS NULL OR application.id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM platform.document_slots AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
  ORDER BY candidate.id FOR UPDATE;
  SELECT * INTO actor FROM platform_private.application_requirements_actor(
    p_organization_id, p_student_case_id, p_student, TRUE
  );

  intent := jsonb_build_object(
    'organizationId', p_organization_id, 'actorMembershipId', actor.actor_membership_id,
    'actorKind', CASE WHEN p_student THEN 'student' ELSE 'staff' END,
    'studentCaseId', p_student_case_id, 'applicationId', p_application_id, 'requestId', p_request_id
  );
  BEGIN
    replayed := platform_private.replay_audit(
      p_request_id, 'application.requirements.initialize', 'university_application',
      p_application_id, fixed_reason, jsonb_build_object('intent', intent)
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE EXCEPTION 'application_requirements_request_conflict' USING ERRCODE = '22023';
  END;
  IF replayed IS NOT NULL THEN RETURN replayed->'receipt'; END IF;

  SELECT * INTO revision FROM platform_private.application_requirement_revisions AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
    AND candidate.application_id = p_application_id
  ORDER BY candidate.revision_version DESC LIMIT 1;
  IF revision.id IS NULL THEN
    IF target_case.state IS DISTINCT FROM 'active' OR target_case.portal_activated_at IS NULL THEN
      RAISE EXCEPTION 'application_requirements_case_ineligible' USING ERRCODE = 'PT409';
    END IF;
    IF application.status IS DISTINCT FROM 'preparation' THEN
      RAISE EXCEPTION 'application_requirements_application_ineligible' USING ERRCODE = 'PT409';
    END IF;
    IF cardinality(platform_private.application_requirement_configuration_reasons(
      p_organization_id, p_student_case_id, p_application_id
    )) > 0 THEN
      RAISE EXCEPTION 'application_requirements_needs_configuration' USING ERRCODE = 'PT409';
    END IF;

    INSERT INTO platform_private.application_requirement_revisions (
      organization_id, student_case_id, application_id, revision_version,
      origin, configuration_state, initialized_at, created_by_membership_id
    ) VALUES (
      p_organization_id, p_student_case_id, p_application_id, 1,
      'evo_starter', 'needs_confirmation', clock_timestamp(), actor.actor_membership_id
    ) RETURNING * INTO revision;

    FOR material IN
      SELECT * FROM (VALUES
        ('evo.photo.v1', 1, 'Фото',
          'Добавьте фотографию для подготовки документов EVO. Требования университета уточняются.'),
        ('evo.passport.v1', 2, 'Загранпаспорт',
          'Добавьте заграничный паспорт для подготовки документов EVO. Требования университета уточняются.')
      ) AS definition(requirement_key, position, label, instructions)
      ORDER BY definition.position
    LOOP
      SELECT candidate.* INTO slot FROM platform.document_slots AS candidate
      WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
        AND candidate.removed_at IS NULL AND EXISTS (
          SELECT 1 FROM platform_private.application_requirement_items AS item
          WHERE item.organization_id = candidate.organization_id
            AND item.student_case_id = candidate.student_case_id AND item.document_slot_id = candidate.id
            AND item.source_requirement_id IS NULL AND item.compatibility_key = material.requirement_key
        );
      IF NOT FOUND THEN
        INSERT INTO platform.document_slots (
          organization_id, student_case_id, requirement_id, intent_kind,
          display_label, group_label, status, version, created_by_membership_id
        ) VALUES (
          p_organization_id, p_student_case_id, NULL, 'custom',
          material.label, starter_group, 'required', 1, actor.actor_membership_id
        ) RETURNING * INTO slot;
      END IF;
      IF slot.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      INSERT INTO platform_private.application_requirement_items (
        organization_id, student_case_id, application_id, revision_id,
        requirement_key, position, required, label, group_label, instructions,
        compatibility_key, source_requirement_id, document_slot_id
      ) VALUES (
        p_organization_id, p_student_case_id, p_application_id, revision.id,
        material.requirement_key, material.position, TRUE, material.label, starter_group,
        material.instructions, material.requirement_key, NULL, slot.id
      );
      INSERT INTO platform.document_slot_case_links (
        organization_id, student_case_id, document_slot_id, target_kind,
        university_application_id, visa_case_id, created_by_membership_id
      ) VALUES (
        p_organization_id, p_student_case_id, slot.id, 'university_application',
        p_application_id, NULL, actor.actor_membership_id
      );
      -- 113 makes relevance part of the slot aggregate; 114 narrows this
      -- transition to the exact transaction-local link context. Preserve that
      -- protocol without changing the guard or any file/status/review fields.
      PERFORM pg_catalog.set_config(
        'platform_private.document_slot_case_link_context',
        p_organization_id::TEXT || ':' || p_student_case_id::TEXT || ':' ||
          slot.id::TEXT || ':' || slot.version::TEXT,
        TRUE
      );
      UPDATE platform.document_slots AS target
      SET version = target.version + 1, updated_at = statement_timestamp()
      WHERE target.organization_id = p_organization_id AND target.student_case_id = p_student_case_id
        AND target.id = slot.id AND target.version = slot.version
      RETURNING target.* INTO slot;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      PERFORM pg_catalog.set_config('platform_private.document_slot_case_link_context', '', TRUE);
    END LOOP;
  END IF;

  receipt := platform_private.application_requirement_receipt(revision.id, p_request_id);
  BEGIN
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_principal, action,
      resource_type, resource_id, before_state, after_state, reason, request_id
    ) VALUES (
      p_organization_id, 'user', actor.actor_profile_id, 'auth:' || actor.actor_auth_user_id::TEXT,
      'application.requirements.initialize', 'university_application', p_application_id, NULL,
      jsonb_build_object('intent', intent, 'receipt', receipt), fixed_reason, p_request_id
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS audit_constraint = CONSTRAINT_NAME;
    IF audit_constraint = 'audit_events_request_id_key' THEN
      RAISE EXCEPTION 'application_requirements_request_conflict' USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  RETURN receipt;
END
$$;

CREATE FUNCTION platform_private.application_requirements_view(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_application_id UUID,
  p_student BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  revision platform_private.application_requirement_revisions%ROWTYPE;
  item platform_private.application_requirement_items%ROWTYPE;
  slot platform.document_slots%ROWTYPE;
  file_version platform.document_versions%ROWTYPE;
  review platform.document_reviews%ROWTYPE;
  configuration_reasons TEXT[] := ARRAY[]::TEXT[];
  unavailable_reasons TEXT[];
  association_unavailable BOOLEAN;
  metadata_changed BOOLEAN;
  items JSONB := '[]'::JSONB;
BEGIN
  IF p_student_case_id IS NULL OR p_application_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM platform_private.application_requirements_actor(
    p_organization_id, p_student_case_id, p_student, FALSE
  );
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.catalog_preparation_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.student_case_id = p_student_case_id AND binding.application_id = p_application_id
  ) THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO revision FROM platform_private.application_requirement_revisions AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
    AND candidate.application_id = p_application_id
  ORDER BY candidate.revision_version DESC LIMIT 1;
  IF revision.id IS NULL THEN
    configuration_reasons := platform_private.application_requirement_configuration_reasons(
      p_organization_id, p_student_case_id, p_application_id
    );
    RETURN jsonb_build_object(
      'studentCaseId', p_student_case_id, 'applicationId', p_application_id,
      'state', CASE WHEN cardinality(configuration_reasons) > 0 THEN 'needs_configuration' ELSE 'uninitialized' END,
      'revisionId', NULL, 'revisionVersion', NULL, 'origin', NULL,
      'configurationState', NULL, 'initializedAt', NULL,
      'configurationReasons', to_jsonb(configuration_reasons), 'items', items
    );
  END IF;
  -- Validate the complete immutable composition, never synthesize revision 0
  -- or a successful empty checklist from a broken/incomplete revision.
  PERFORM platform_private.application_requirement_receipt(revision.id, NULL);
  FOR item IN
    SELECT candidate.* FROM platform_private.application_requirement_items AS candidate
    WHERE candidate.revision_id = revision.id ORDER BY candidate.position
  LOOP
    unavailable_reasons := ARRAY[]::TEXT[];
    association_unavailable := FALSE;
    metadata_changed := FALSE;
    file_version := NULL;
    review := NULL;
    SELECT * INTO slot FROM platform.document_slots AS candidate
    WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
      AND candidate.id = item.document_slot_id;
    IF NOT FOUND THEN
      unavailable_reasons := array_append(unavailable_reasons, 'slot_missing');
      association_unavailable := TRUE;
    ELSE
      IF slot.removed_at IS NOT NULL THEN
        unavailable_reasons := array_append(unavailable_reasons, 'slot_removed');
        association_unavailable := TRUE;
      END IF;
      IF NOT platform_private.application_requirement_slot_matches(slot, item) THEN
        unavailable_reasons := array_append(unavailable_reasons, 'slot_metadata_changed');
        metadata_changed := TRUE;
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM platform.document_slot_case_links AS link
      WHERE link.organization_id = p_organization_id AND link.student_case_id = p_student_case_id
        AND link.document_slot_id = item.document_slot_id
        AND link.university_application_id = p_application_id
    ) THEN
      unavailable_reasons := array_append(unavailable_reasons, 'application_link_missing');
      association_unavailable := TRUE;
    END IF;
    IF association_unavailable AND NOT ('material_association_unavailable' = ANY(configuration_reasons)) THEN
      configuration_reasons := array_append(configuration_reasons, 'material_association_unavailable');
    END IF;
    IF metadata_changed AND NOT ('material_metadata_changed' = ANY(configuration_reasons)) THEN
      configuration_reasons := array_append(configuration_reasons, 'material_metadata_changed');
    END IF;

    IF NOT association_unavailable AND NOT metadata_changed THEN
      IF slot.current_version_id IS NULL THEN
        unavailable_reasons := ARRAY['file_missing']::TEXT[];
      ELSE
        SELECT * INTO file_version FROM platform.document_versions AS candidate
        WHERE candidate.organization_id = p_organization_id AND candidate.student_case_id = p_student_case_id
          AND candidate.document_slot_id = slot.id AND candidate.id = slot.current_version_id
          AND candidate.version_no = slot.current_version_no;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
        SELECT * INTO review FROM platform.document_reviews AS candidate
        WHERE candidate.organization_id = p_organization_id AND candidate.document_version_id = file_version.id
        ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1;
        IF NOT EXISTS (
          SELECT 1 FROM platform_private.document_upload_finalizations AS finalization
          WHERE finalization.organization_id = p_organization_id
            AND finalization.document_version_id = file_version.id
        ) THEN
          unavailable_reasons := array_append(unavailable_reasons, 'upload_not_finalized');
        END IF;
        IF file_version.integrity_status = 'pending' THEN
          unavailable_reasons := array_append(unavailable_reasons, 'integrity_pending');
        ELSIF file_version.integrity_status = 'failed' THEN
          unavailable_reasons := array_append(unavailable_reasons, 'integrity_failed');
        END IF;
        IF file_version.malware_status = 'pending' THEN
          unavailable_reasons := array_append(unavailable_reasons, 'malware_pending');
        ELSIF file_version.malware_status = 'infected' THEN
          unavailable_reasons := array_append(unavailable_reasons, 'malware_infected');
        ELSIF file_version.malware_status = 'error' THEN
          unavailable_reasons := array_append(unavailable_reasons, 'malware_error');
        END IF;
      END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'requirementItemId', item.id, 'requirementKey', item.requirement_key,
      'documentSlotId', item.document_slot_id, 'position', item.position, 'required', item.required,
      'label', item.label, 'groupLabel', item.group_label, 'instructions', item.instructions,
      'compatibilityKey', item.compatibility_key,
      'slotStatus', CASE WHEN association_unavailable OR metadata_changed THEN NULL ELSE slot.status END,
      'currentVersionId', file_version.id, 'currentVersionNo', file_version.version_no::TEXT,
      'reviewDecision', review.decision,
      'reviewReason', CASE WHEN review.decision IN ('correction_required', 'rejected') THEN review.reason ELSE NULL END,
      'reviewedAt', review.created_at,
      'technicalAvailability', CASE WHEN cardinality(unavailable_reasons) = 0 THEN 'available' ELSE 'unavailable' END,
      'unavailableReasons', to_jsonb(unavailable_reasons)
    ));
  END LOOP;
  RETURN jsonb_build_object(
    'studentCaseId', p_student_case_id, 'applicationId', p_application_id,
    'state', CASE WHEN cardinality(configuration_reasons) > 0 THEN 'needs_configuration' ELSE 'initialized' END,
    'revisionId', revision.id, 'revisionVersion', revision.revision_version::TEXT,
    'origin', revision.origin, 'configurationState', revision.configuration_state,
    'initializedAt', revision.initialized_at, 'configurationReasons', to_jsonb(configuration_reasons),
    'items', items
  );
END
$$;

-- Public wrappers fix the authority mode; Student callers cannot supply an org.
CREATE FUNCTION platform.student_initialize_application_requirements_v1(
  p_student_case_id UUID, p_application_id UUID, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id
  FROM platform.current_actor_authority() AS authority WHERE authority.platform_role = 'student';
  IF organization_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.initialize_application_requirements(
    organization_id, p_student_case_id, p_application_id, p_request_id, TRUE
  );
END
$$;

CREATE FUNCTION platform.staff_initialize_application_requirements_v1(
  p_organization_id UUID, p_student_case_id UUID, p_application_id UUID, p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.initialize_application_requirements(
    p_organization_id, p_student_case_id, p_application_id, p_request_id, FALSE
  )
$$;

CREATE FUNCTION platform.student_application_requirements_v1(
  p_student_case_id UUID, p_application_id UUID
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id
  FROM platform.current_actor_authority() AS authority WHERE authority.platform_role = 'student';
  IF organization_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.application_requirements_view(
    organization_id, p_student_case_id, p_application_id, TRUE
  );
END
$$;

CREATE FUNCTION platform.staff_application_requirements_v1(
  p_student_case_id UUID, p_application_id UUID
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id FROM platform.current_actor_authority() AS authority;
  IF organization_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.application_requirements_view(
    organization_id, p_student_case_id, p_application_id, FALSE
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.application_requirements_actor(UUID, UUID, BOOLEAN, BOOLEAN),
  platform_private.application_requirement_slot_matches(
    platform.document_slots, platform_private.application_requirement_items
  ),
  platform_private.application_requirement_configuration_reasons(UUID, UUID, UUID),
  platform_private.application_requirement_receipt(UUID, UUID),
  platform_private.initialize_application_requirements(UUID, UUID, UUID, UUID, BOOLEAN),
  platform_private.application_requirements_view(UUID, UUID, UUID, BOOLEAN),
  platform.student_initialize_application_requirements_v1(UUID, UUID, UUID),
  platform.staff_initialize_application_requirements_v1(UUID, UUID, UUID, UUID),
  platform.student_application_requirements_v1(UUID, UUID),
  platform.staff_application_requirements_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.student_initialize_application_requirements_v1(UUID, UUID, UUID),
  platform.staff_initialize_application_requirements_v1(UUID, UUID, UUID, UUID),
  platform.student_application_requirements_v1(UUID, UUID),
  platform.staff_application_requirements_v1(UUID, UUID)
  TO authenticated;

COMMIT;
