-- B3e-1: read-only compatibility projection of the existing 218 starter.
-- Contract: docs/platform/b3e1-requirements-v2-read-contract.md (7403e503).
-- No full-revision writer/schema, initialization, repair or historical changes.
-- B3e-2 must replace these internals before enabling full writes and restricting
-- v1 reads. The v2 wire alone does not implement the future full backend.
BEGIN;

CREATE FUNCTION platform_private.application_requirements_v2_projection(
  p_source JSONB,
  p_student_case_id UUID,
  p_application_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  top_keys CONSTANT TEXT[] := ARRAY[
    'studentCaseId', 'applicationId', 'state', 'revisionId', 'revisionVersion',
    'origin', 'configurationState', 'initializedAt', 'configurationReasons', 'items'
  ];
  item_keys CONSTANT TEXT[] := ARRAY[
    'requirementItemId', 'requirementKey', 'documentSlotId', 'position', 'required',
    'label', 'groupLabel', 'instructions', 'compatibilityKey', 'slotStatus',
    'currentVersionId', 'currentVersionNo', 'reviewDecision', 'reviewReason',
    'reviewedAt', 'technicalAvailability', 'unavailableReasons'
  ];
  allowed_configuration CONSTANT TEXT[] := ARRAY[
    'legacy_case_checklist', 'legacy_application_links', 'legacy_application_configuration',
    'ambiguous_material', 'material_association_unavailable', 'material_metadata_changed'
  ];
  association_reasons CONSTANT TEXT[] := ARRAY[
    'slot_missing', 'slot_removed', 'application_link_missing', 'slot_metadata_changed'
  ];
  allowed_unavailable CONSTANT TEXT[] := ARRAY[
    'slot_missing', 'slot_removed', 'application_link_missing', 'slot_metadata_changed',
    'file_missing', 'upload_not_finalized', 'integrity_pending', 'integrity_failed',
    'malware_pending', 'malware_infected', 'malware_error'
  ];
  starter_keys CONSTANT TEXT[] := ARRAY['evo.photo.v1', 'evo.passport.v1'];
  uuid_pattern CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  timestamp_pattern CONSTANT TEXT := '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$';
  item JSONB;
  field TEXT;
  position INTEGER := 0;
  configuration_reasons TEXT[];
  derived_configuration TEXT[] := ARRAY[]::TEXT[];
  unavailable TEXT[];
  seen_item_ids TEXT[] := ARRAY[]::TEXT[];
  seen_slot_ids TEXT[] := ARRAY[]::TEXT[];
  projected_items JSONB := '[]'::JSONB;
  association_unavailable BOOLEAN;
BEGIN
  -- A closed projection prevents newly added private/unexpected v1 fields from
  -- being silently copied into the public v2 response.
  IF p_source IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
  END IF;
  IF NOT (p_source ?& top_keys) OR p_source - top_keys <> '{}'::JSONB
    OR p_student_case_id IS NULL OR p_application_id IS NULL
    OR jsonb_typeof(p_source->'studentCaseId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_source->'applicationId') IS DISTINCT FROM 'string'
    OR (p_source->>'studentCaseId') IS DISTINCT FROM p_student_case_id::TEXT
    OR (p_source->>'applicationId') IS DISTINCT FROM p_application_id::TEXT
    OR (p_source->>'studentCaseId') !~ uuid_pattern
    OR (p_source->>'applicationId') !~ uuid_pattern
    OR jsonb_typeof(p_source->'state') IS DISTINCT FROM 'string'
    OR NOT ((p_source->>'state') = ANY(ARRAY['uninitialized', 'initialized', 'needs_configuration']))
    OR jsonb_typeof(p_source->'configurationReasons') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_source->'items') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_source->'configurationReasons') AS reason(value)
    WHERE jsonb_typeof(reason.value) <> 'string') THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(array_agg(reason.value), ARRAY[]::TEXT[])
  INTO configuration_reasons
  FROM jsonb_array_elements_text(p_source->'configurationReasons') AS reason(value);
  IF NOT configuration_reasons <@ allowed_configuration
    OR cardinality(configuration_reasons) <> (SELECT count(DISTINCT value) FROM unnest(configuration_reasons) AS reason(value))
  THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
  END IF;

  IF p_source->'revisionId' = 'null'::JSONB THEN
    IF p_source->'revisionVersion' <> 'null'::JSONB OR p_source->'origin' <> 'null'::JSONB
      OR p_source->'configurationState' <> 'null'::JSONB OR p_source->'initializedAt' <> 'null'::JSONB
      OR jsonb_array_length(p_source->'items') <> 0
      OR NOT (
        (p_source->>'state' = 'uninitialized' AND cardinality(configuration_reasons) = 0)
        OR (p_source->>'state' = 'needs_configuration' AND cardinality(configuration_reasons) > 0)
      )
    THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
    END IF;
  ELSE
    -- Current v1 can only describe a two-item starter. Do not silently accept a
    -- future full revision here or project an older revision as current.
    IF jsonb_typeof(p_source->'revisionId') IS DISTINCT FROM 'string'
      OR (p_source->>'revisionId') !~ uuid_pattern
      OR jsonb_typeof(p_source->'revisionVersion') IS DISTINCT FROM 'string'
      OR (p_source->>'revisionVersion') !~ '^[1-9][0-9]{0,18}$'
      OR p_source->'origin' IS DISTINCT FROM '"evo_starter"'::JSONB
      OR p_source->'configurationState' IS DISTINCT FROM '"needs_confirmation"'::JSONB
      OR jsonb_typeof(p_source->'initializedAt') IS DISTINCT FROM 'string'
      OR (p_source->>'initializedAt') !~ timestamp_pattern
      OR jsonb_array_length(p_source->'items') <> 2
    THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
    END IF;
    -- Cast only after the lexical checks; overflow/invalid calendar values below
    -- are reported as invariant failures, not accepted as arbitrary strings.
    PERFORM (p_source->>'revisionVersion')::BIGINT;
    PERFORM (p_source->>'initializedAt')::TIMESTAMPTZ;

    FOR item IN
      SELECT value FROM jsonb_array_elements(p_source->'items') WITH ORDINALITY AS source_item(value, ordinal)
      ORDER BY ordinal
    LOOP
      position := position + 1;
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      IF NOT (item ?& item_keys) OR item - item_keys <> '{}'::JSONB
        OR item->'position' IS DISTINCT FROM to_jsonb(position)
        OR item->'required' IS DISTINCT FROM 'true'::JSONB
        OR item->'requirementKey' IS DISTINCT FROM to_jsonb(starter_keys[position])
        OR item->'compatibilityKey' IS DISTINCT FROM item->'requirementKey'
        OR jsonb_typeof(item->'unavailableReasons') IS DISTINCT FROM 'array'
        OR NOT (item->'technicalAvailability' = ANY(ARRAY['"available"'::JSONB, '"unavailable"'::JSONB]))
      THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      FOREACH field IN ARRAY ARRAY['requirementItemId', 'documentSlotId'] LOOP
        IF jsonb_typeof(item->field) IS DISTINCT FROM 'string' OR (item->>field) !~ uuid_pattern THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
      END LOOP;
      IF (item->>'requirementItemId') = ANY(seen_item_ids) OR (item->>'documentSlotId') = ANY(seen_slot_ids) THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      seen_item_ids := array_append(seen_item_ids, item->>'requirementItemId');
      seen_slot_ids := array_append(seen_slot_ids, item->>'documentSlotId');
      FOREACH field IN ARRAY ARRAY['label', 'groupLabel', 'instructions'] LOOP
        IF jsonb_typeof(item->field) IS DISTINCT FROM 'string'
          OR length(btrim(item->>field)) = 0
          OR length(item->>field) > (CASE field WHEN 'label' THEN 500 WHEN 'groupLabel' THEN 200 ELSE 4000 END)
        THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
      END LOOP;
      IF item->'slotStatus' <> 'null'::JSONB AND NOT (item->'slotStatus' = ANY(ARRAY[
        '"required"'::JSONB, '"submitted"'::JSONB, '"approved"'::JSONB,
        '"correction_required"'::JSONB, '"rejected"'::JSONB
      ])) THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      IF (item->'currentVersionId' = 'null'::JSONB) <> (item->'currentVersionNo' = 'null'::JSONB)
        OR (item->'reviewDecision' = 'null'::JSONB) <> (item->'reviewedAt' = 'null'::JSONB)
        OR (item->'reviewDecision' <> 'null'::JSONB AND NOT (item->'reviewDecision' = ANY(ARRAY[
          '"approved"'::JSONB, '"correction_required"'::JSONB, '"rejected"'::JSONB
        ])))
        OR (item->'reviewReason' <> 'null'::JSONB AND (
          jsonb_typeof(item->'reviewReason') <> 'string' OR length(btrim(item->>'reviewReason')) = 0
        ))
        OR (item->'reviewDecision' IN ('null'::JSONB, '"approved"'::JSONB) AND item->'reviewReason' <> 'null'::JSONB)
      THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      IF item->'currentVersionId' <> 'null'::JSONB THEN
        IF jsonb_typeof(item->'currentVersionId') <> 'string' OR (item->>'currentVersionId') !~ uuid_pattern
          OR jsonb_typeof(item->'currentVersionNo') <> 'string' OR (item->>'currentVersionNo') !~ '^[1-9][0-9]{0,18}$'
        THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
        PERFORM (item->>'currentVersionNo')::BIGINT;
      END IF;
      IF item->'reviewedAt' <> 'null'::JSONB THEN
        IF jsonb_typeof(item->'reviewedAt') <> 'string' OR (item->>'reviewedAt') !~ timestamp_pattern THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
        PERFORM (item->>'reviewedAt')::TIMESTAMPTZ;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(item->'unavailableReasons') AS reason(value)
        WHERE jsonb_typeof(reason.value) <> 'string') THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      SELECT COALESCE(array_agg(reason.value), ARRAY[]::TEXT[]) INTO unavailable
      FROM jsonb_array_elements_text(item->'unavailableReasons') AS reason(value);
      IF NOT unavailable <@ allowed_unavailable
        OR cardinality(unavailable) <> (SELECT count(DISTINCT value) FROM unnest(unavailable) AS reason(value))
        OR (SELECT count(*) FROM unnest(unavailable) AS reason(value) WHERE value LIKE 'integrity_%') > 1
        OR (SELECT count(*) FROM unnest(unavailable) AS reason(value) WHERE value LIKE 'malware_%') > 1
      THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      association_unavailable := unavailable && association_reasons;
      IF association_unavailable THEN
        IF item->'slotStatus' <> 'null'::JSONB OR item->'currentVersionId' <> 'null'::JSONB
          OR item->'reviewDecision' <> 'null'::JSONB OR NOT unavailable <@ association_reasons
        THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
      ELSE
        IF item->'slotStatus' = 'null'::JSONB
          OR (item->'currentVersionId' = 'null'::JSONB AND (
            item->'reviewDecision' <> 'null'::JSONB OR unavailable IS DISTINCT FROM ARRAY['file_missing']::TEXT[]
          ))
          OR (item->'currentVersionId' <> 'null'::JSONB AND 'file_missing' = ANY(unavailable))
        THEN
          RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
        END IF;
      END IF;
      IF (item->>'technicalAvailability' = 'available') <> (cardinality(unavailable) = 0)
        OR (item->>'technicalAvailability' = 'available' AND item->'currentVersionId' = 'null'::JSONB)
      THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
      END IF;
      IF 'slot_metadata_changed' = ANY(unavailable)
        AND NOT 'material_metadata_changed' = ANY(derived_configuration) THEN
        derived_configuration := array_append(derived_configuration, 'material_metadata_changed');
      END IF;
      IF unavailable && ARRAY['slot_missing', 'slot_removed', 'application_link_missing']::TEXT[]
        AND NOT 'material_association_unavailable' = ANY(derived_configuration) THEN
        derived_configuration := array_append(derived_configuration, 'material_association_unavailable');
      END IF;
      projected_items := projected_items || jsonb_build_array(jsonb_build_object(
        'requirementItemId', item->'requirementItemId', 'requirementKey', item->'requirementKey',
        'documentSlotId', item->'documentSlotId', 'position', item->'position', 'required', item->'required',
        'label', item->'label', 'groupLabel', item->'groupLabel', 'instructions', item->'instructions',
        'compatibilityKey', item->'compatibilityKey', 'slotStatus', item->'slotStatus',
        'currentVersionId', item->'currentVersionId', 'currentVersionNo', item->'currentVersionNo',
        'reviewDecision', item->'reviewDecision', 'reviewReason', item->'reviewReason', 'reviewedAt', item->'reviewedAt',
        'technicalAvailability', item->'technicalAvailability', 'unavailableReasons', item->'unavailableReasons',
        'deadline', NULL, 'reviewScope', 'document_version', 'definitionImpact', NULL
      ));
    END LOOP;
    IF NOT configuration_reasons <@ derived_configuration OR NOT derived_configuration <@ configuration_reasons
      OR NOT (
        (p_source->>'state' = 'initialized' AND cardinality(derived_configuration) = 0)
        OR (p_source->>'state' = 'needs_configuration' AND cardinality(derived_configuration) > 0)
      )
    THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'protocolVersion', 2,
    'studentCaseId', p_source->'studentCaseId', 'applicationId', p_source->'applicationId',
    'state', p_source->'state', 'revisionId', p_source->'revisionId', 'revisionVersion', p_source->'revisionVersion',
    'origin', p_source->'origin', 'configurationState', p_source->'configurationState',
    'initializedAt', p_source->'initializedAt', 'configurationReasons', p_source->'configurationReasons',
    'items', projected_items
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
    OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000';
END
$$;

CREATE FUNCTION platform.student_application_requirements_v2(
  p_student_case_id UUID, p_application_id UUID
)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.application_requirements_v2_projection(
    platform.student_application_requirements_v1(p_student_case_id, p_application_id),
    p_student_case_id, p_application_id
  );
$$;

CREATE FUNCTION platform.staff_application_requirements_v2(
  p_student_case_id UUID, p_application_id UUID
)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.application_requirements_v2_projection(
    platform.staff_application_requirements_v1(p_student_case_id, p_application_id),
    p_student_case_id, p_application_id
  );
$$;

REVOKE ALL ON FUNCTION
  platform_private.application_requirements_v2_projection(JSONB, UUID, UUID),
  platform.student_application_requirements_v2(UUID, UUID),
  platform.staff_application_requirements_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.student_application_requirements_v2(UUID, UUID),
  platform.staff_application_requirements_v2(UUID, UUID)
  TO authenticated;

COMMIT;
