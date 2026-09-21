-- B3e-2. Contract/wire approved at b3a81d7ce14270609ec04848669352ad7b77f8ed.
-- Additive immutable requirements, explicit same-case material adoption, and a
-- scoped staff command. No old rows, files, reviews, 137 facts or 214 choices
-- are rewritten. Public reads do not initialize or repair anything.
BEGIN;

CREATE FUNCTION platform_private.requirements_editor_keys(p_value JSONB, p_keys TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN p_value ?& p_keys AND p_value - p_keys = '{}'::JSONB ELSE FALSE END, FALSE)
$$;

-- Match the v2 Unicode White_Space + BOM rule, not locale-dependent btrim/\s.
CREATE FUNCTION platform_private.requirements_editor_trim(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT btrim(p_value, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION platform_private.requirements_editor_text(p_value JSONB, p_max INTEGER)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(p_value) = 'string'
    AND length(p_value #>> '{}') BETWEEN 1 AND p_max
    AND platform_private.requirements_editor_trim(p_value #>> '{}') <> '', FALSE)
$$;

CREATE FUNCTION platform_private.requirements_editor_uuid(p_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(p_value) = 'string' AND length(p_value #>> '{}') = 36
    AND (p_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', FALSE)
$$;

CREATE FUNCTION platform_private.requirements_editor_version(p_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(p_value) = 'string'
    AND (p_value #>> '{}') ~ '^[1-9][0-9]{0,18}$'
    AND (length(p_value #>> '{}') < 19 OR (p_value #>> '{}') COLLATE "C" <= '9223372036854775807'), FALSE)
$$;

CREATE FUNCTION platform_private.requirements_editor_date(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE value TEXT := p_value #>> '{}'; parsed DATE;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string'
    OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN FALSE; END IF;
  parsed := value::DATE;
  RETURN parsed BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND to_char(parsed, 'YYYY-MM-DD') = value;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN FALSE;
END
$$;

CREATE FUNCTION platform_private.requirements_editor_source_url(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE value TEXT := p_value #>> '{}'; authority TEXT; part TEXT; query_key TEXT;
BEGIN
  IF NOT platform_private.requirements_editor_text(p_value, 1000)
    OR left(value, 8) <> 'https://' OR value ~ U&'[\0001-\001F\007F]'
    OR position(chr(92) IN value) > 0 OR position('#' IN value) > 0
    OR value ~ U&'[\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
  THEN RETURN FALSE; END IF;
  authority := split_part(split_part(substr(value, 9), '/', 1), '?', 1);
  IF authority !~* '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    OR authority ~ '[^\x00-\x7F]'
    OR authority ~* '\.(localhost|local|internal|test|invalid|example)$'
  THEN RETURN FALSE; END IF;
  IF position('?' IN value) > 0 THEN
    FOREACH part IN ARRAY string_to_array(substr(value, position('?' IN value) + 1), '&') LOOP
      query_key := replace(split_part(part, '=', 1), '+', ' ');
      IF position('%' IN query_key) > 0 OR query_key ~* 'token|secret|password|auth|api.?key'
      THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;
  -- The raw DNS-only authority excludes ports, credentials and IP literals;
  -- with the scheme/control/whitespace checks above this is a display URL only.
  RETURN TRUE;
END
$$;

CREATE FUNCTION platform_private.requirements_editor_deadline(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE zone TEXT;
BEGIN
  IF p_value = 'null'::JSONB THEN RETURN TRUE; END IF;
  IF NOT platform_private.requirements_editor_keys(p_value, ARRAY['date','time','timezone','sourceUrl','verifiedOn'])
    OR NOT platform_private.requirements_editor_date(p_value->'date')
    OR NOT platform_private.requirements_editor_date(p_value->'verifiedOn')
  THEN RETURN FALSE; END IF;
  IF p_value->'time' <> 'null'::JSONB AND (
    jsonb_typeof(p_value->'time') <> 'string'
    OR p_value->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR p_value->'timezone' = 'null'::JSONB
  ) THEN RETURN FALSE; END IF;
  IF p_value->'timezone' <> 'null'::JSONB THEN
    zone := p_value->>'timezone';
    IF jsonb_typeof(p_value->'timezone') <> 'string' OR length(zone) NOT BETWEEN 1 AND 100
      OR zone ~ '[^\x21-\x7E]' OR zone ~* '^(posix|right)/'
      OR (zone NOT IN ('UTC','GMT') AND zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$')
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = zone)
    THEN RETURN FALSE; END IF;
  END IF;
  RETURN p_value->'sourceUrl' = 'null'::JSONB
    OR platform_private.requirements_editor_source_url(p_value->'sourceUrl');
END
$$;

ALTER TABLE platform_private.application_requirement_revisions
  DROP CONSTRAINT application_requirement_revisions_origin_check,
  DROP CONSTRAINT application_requirement_revisions_configuration_state_check,
  ADD COLUMN previous_revision_id UUID,
  ADD COLUMN change_reason TEXT,
  ADD COLUMN source_snapshot JSONB,
  ADD CONSTRAINT application_requirement_revision_origin_state_check CHECK (
    (origin = 'evo_starter' AND configuration_state = 'needs_confirmation'
      AND previous_revision_id IS NULL AND change_reason IS NULL AND source_snapshot IS NULL)
    OR (origin = 'staff_confirmed' AND configuration_state = 'confirmed'
      AND change_reason IS NOT NULL AND length(change_reason) BETWEEN 1 AND 2000
      AND platform_private.requirements_editor_trim(change_reason) <> ''
      AND source_snapshot IS NOT NULL AND jsonb_typeof(source_snapshot) = 'object'
      AND ((revision_version = 1 AND previous_revision_id IS NULL)
        OR (revision_version > 1 AND previous_revision_id IS NOT NULL)))
  ),
  ADD CONSTRAINT application_requirement_revision_previous_fkey
    FOREIGN KEY (organization_id, previous_revision_id, student_case_id, application_id)
    REFERENCES platform_private.application_requirement_revisions(organization_id, id, student_case_id, application_id);

ALTER TABLE platform_private.application_requirement_items
  ADD COLUMN predecessor_item_id UUID,
  ADD COLUMN material_snapshot JSONB,
  ADD COLUMN provenance JSONB,
  ADD COLUMN deadline JSONB,
  ADD COLUMN definition_impact TEXT CHECK (definition_impact IS NULL OR definition_impact = 'changed'),
  ADD CONSTRAINT application_requirement_item_identity_key UNIQUE (organization_id, id, student_case_id, application_id),
  ADD CONSTRAINT application_requirement_item_predecessor_fkey
    FOREIGN KEY (organization_id, predecessor_item_id, student_case_id, application_id)
    REFERENCES platform_private.application_requirement_items(organization_id, id, student_case_id, application_id),
  ADD CONSTRAINT application_requirement_item_snapshot_shape_check CHECK (
    (material_snapshot IS NULL OR jsonb_typeof(material_snapshot) = 'object')
    AND (provenance IS NULL OR jsonb_typeof(provenance) = 'object')
    AND (deadline IS NULL OR jsonb_typeof(deadline) = 'object')
  );

CREATE FUNCTION platform_private.requirements_editor_slot_snapshot(p_slot platform.document_slots)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE requirement platform.document_requirements%ROWTYPE;
BEGIN
  IF p_slot.id IS NULL THEN RETURN NULL; END IF;
  IF p_slot.requirement_id IS NOT NULL THEN
    SELECT * INTO requirement FROM platform.document_requirements
    WHERE organization_id = p_slot.organization_id AND id = p_slot.requirement_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  END IF;
  RETURN jsonb_build_object(
    'intentKind', p_slot.intent_kind, 'requirementId', p_slot.requirement_id,
    'rawLabel', p_slot.display_label, 'rawGroupLabel', p_slot.group_label,
    'label', COALESCE(p_slot.display_label, requirement.label),
    'groupLabel', COALESCE(p_slot.group_label, requirement.group_label),
    'sourceRequirementKey', requirement.requirement_key,
    'sourceChecklistVersion', requirement.checklist_version::TEXT,
    'sourceInstructions', requirement.instructions
  );
END
$$;

CREATE FUNCTION platform_private.requirements_editor_definition(p_item platform_private.application_requirement_items)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('requirementKey', p_item.requirement_key,
    'required', p_item.required, 'label', p_item.label, 'groupLabel', p_item.group_label,
    'instructions', p_item.instructions, 'deadline', p_item.deadline, 'documentSlotId', p_item.document_slot_id)
$$;

CREATE FUNCTION platform_private.requirements_editor_item_matches(
  p_slot platform.document_slots, p_item platform_private.application_requirement_items
)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_item.material_snapshot IS NULL
    THEN platform_private.application_requirement_slot_matches(p_slot, p_item)
    ELSE p_item.material_snapshot = platform_private.requirements_editor_slot_snapshot(p_slot) END
$$;

-- Prove typed provenance through immutable predecessors, not by a reused name
-- or compatibility key. Revision versions strictly decrease: no cyclic walk.
CREATE FUNCTION platform_private.requirements_editor_typed_item(p_item_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item platform_private.application_requirement_items%ROWTYPE;
  previous platform_private.application_requirement_items%ROWTYPE;
  revision platform_private.application_requirement_revisions%ROWTYPE;
  previous_revision platform_private.application_requirement_revisions%ROWTYPE;
  expected_snapshot JSONB;
BEGIN
  SELECT * INTO item FROM platform_private.application_requirement_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  LOOP
    SELECT * INTO revision FROM platform_private.application_requirement_revisions WHERE id = item.revision_id;
    IF revision.id IS NULL OR item.requirement_key NOT IN ('evo.photo.v1','evo.passport.v1')
      OR item.compatibility_key <> item.requirement_key OR NOT item.required
      OR item.source_requirement_id IS NOT NULL OR item.deadline IS NOT NULL
    THEN RETURN FALSE; END IF;
    IF revision.origin = 'evo_starter' THEN RETURN TRUE; END IF;
    IF item.provenance->>'kind' IS DISTINCT FROM 'typed_starter' OR item.predecessor_item_id IS NULL
    THEN RETURN FALSE; END IF;
    SELECT * INTO previous FROM platform_private.application_requirement_items
    WHERE id = item.predecessor_item_id AND organization_id = item.organization_id
      AND student_case_id = item.student_case_id AND application_id = item.application_id;
    IF NOT FOUND OR platform_private.requirements_editor_definition(item)
      IS DISTINCT FROM platform_private.requirements_editor_definition(previous) THEN RETURN FALSE; END IF;
    SELECT * INTO previous_revision FROM platform_private.application_requirement_revisions WHERE id = previous.revision_id;
    IF previous_revision.id IS DISTINCT FROM revision.previous_revision_id
      OR previous_revision.revision_version >= revision.revision_version THEN RETURN FALSE; END IF;
    expected_snapshot := COALESCE(previous.material_snapshot, jsonb_build_object(
      'intentKind','custom','requirementId',NULL,'rawLabel',previous.label,'rawGroupLabel',previous.group_label,
      'label',previous.label,'groupLabel',previous.group_label,
      'sourceRequirementKey',NULL,'sourceChecklistVersion',NULL,'sourceInstructions',NULL));
    IF item.material_snapshot IS DISTINCT FROM expected_snapshot THEN RETURN FALSE; END IF;
    item := previous;
  END LOOP;
END
$$;

CREATE FUNCTION platform_private.requirements_editor_file_state(p_slot platform.document_slots)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE version platform.document_versions%ROWTYPE; review platform.document_reviews%ROWTYPE;
  reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_slot.id IS NULL THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  IF p_slot.current_version_id IS NULL THEN
    reasons := ARRAY['file_missing'];
  ELSE
    SELECT * INTO version FROM platform.document_versions AS candidate
    WHERE candidate.organization_id = p_slot.organization_id AND candidate.student_case_id = p_slot.student_case_id
      AND candidate.document_slot_id = p_slot.id AND candidate.id = p_slot.current_version_id
      AND candidate.version_no = p_slot.current_version_no;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    SELECT * INTO review FROM platform.document_reviews AS candidate
    WHERE candidate.organization_id = p_slot.organization_id AND candidate.document_version_id = version.id
    ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM platform_private.document_upload_finalizations AS finalization
      WHERE finalization.organization_id = p_slot.organization_id AND finalization.document_version_id = version.id)
    THEN reasons := array_append(reasons, 'upload_not_finalized'); END IF;
    IF version.integrity_status = 'pending' THEN reasons := array_append(reasons, 'integrity_pending');
    ELSIF version.integrity_status = 'failed' THEN reasons := array_append(reasons, 'integrity_failed'); END IF;
    IF version.malware_status = 'pending' THEN reasons := array_append(reasons, 'malware_pending');
    ELSIF version.malware_status = 'infected' THEN reasons := array_append(reasons, 'malware_infected');
    ELSIF version.malware_status = 'error' THEN reasons := array_append(reasons, 'malware_error'); END IF;
  END IF;
  RETURN jsonb_build_object('slotStatus',p_slot.status,'currentVersionId',version.id,
    'currentVersionNo',version.version_no::TEXT,'filename',version.original_filename,
    'reviewDecision',review.decision,'reviewReason',CASE WHEN review.decision IN ('correction_required','rejected') THEN review.reason ELSE NULL END,
    'reviewedAt',review.created_at,'technicalAvailability',CASE WHEN cardinality(reasons)=0 THEN 'available' ELSE 'unavailable' END,
    'unavailableReasons',to_jsonb(reasons));
END
$$;

CREATE FUNCTION platform_private.requirements_editor_assert_item(
  p_item platform_private.application_requirement_items,
  p_revision platform_private.application_requirement_revisions
)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous platform_private.application_requirement_items%ROWTYPE; snapshot JSONB := p_item.material_snapshot;
BEGIN
  IF p_revision.origin = 'evo_starter' THEN
    IF p_item.predecessor_item_id IS NOT NULL OR snapshot IS NOT NULL OR p_item.provenance IS NOT NULL
      OR p_item.deadline IS NOT NULL OR p_item.definition_impact IS NOT NULL
      OR p_item.requirement_key NOT IN ('evo.photo.v1','evo.passport.v1')
      OR p_item.compatibility_key <> p_item.requirement_key OR NOT p_item.required
      OR p_item.source_requirement_id IS NOT NULL
      OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.label),500)
      OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.group_label),200)
      OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.instructions),4000)
    THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    RETURN;
  END IF;
  IF NOT platform_private.requirements_editor_keys(snapshot, ARRAY[
    'intentKind','requirementId','rawLabel','rawGroupLabel','label','groupLabel',
    'sourceRequirementKey','sourceChecklistVersion','sourceInstructions'])
    OR NOT platform_private.requirements_editor_keys(p_item.provenance, ARRAY['kind','sourceKey','basis','source'])
    OR jsonb_typeof(p_item.provenance->'kind') IS DISTINCT FROM 'string'
    OR p_item.provenance->>'kind' NOT IN ('typed_starter','country_manifest','application_details','staff_entry')
    OR NOT platform_private.requirements_editor_text(p_item.provenance->'basis',2000)
    OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.label),500)
    OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.group_label),200)
    OR NOT platform_private.requirements_editor_text(to_jsonb(p_item.instructions),4000)
    OR NOT platform_private.requirements_editor_deadline(COALESCE(p_item.deadline,'null'::JSONB))
    OR jsonb_typeof(snapshot->'intentKind') IS DISTINCT FROM 'string'
    OR snapshot->>'intentKind' NOT IN ('custom','baseline')
    OR snapshot->'requirementId' IS DISTINCT FROM COALESCE(to_jsonb(p_item.source_requirement_id),'null'::JSONB)
    OR NOT platform_private.requirements_editor_text(snapshot->'label',2147483647)
    OR NOT platform_private.requirements_editor_text(snapshot->'groupLabel',2147483647)
    OR (snapshot->'rawLabel' <> 'null'::JSONB
      AND NOT platform_private.requirements_editor_text(snapshot->'rawLabel',2147483647))
    OR (snapshot->'rawGroupLabel' <> 'null'::JSONB
      AND NOT platform_private.requirements_editor_text(snapshot->'rawGroupLabel',2147483647))
    OR (snapshot->'rawLabel' <> 'null'::JSONB AND snapshot->'rawLabel' <> snapshot->'label')
    OR (snapshot->'rawGroupLabel' <> 'null'::JSONB AND snapshot->'rawGroupLabel' <> snapshot->'groupLabel')
  THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  IF p_item.provenance->>'kind' = 'staff_entry' THEN
    IF p_item.provenance->'sourceKey' <> 'null'::JSONB OR p_item.provenance->'source' <> 'null'::JSONB
    THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  ELSIF jsonb_typeof(p_item.provenance->'source') IS DISTINCT FROM 'object'
    OR NOT platform_private.requirements_editor_text(p_item.provenance->'sourceKey',200)
    OR p_item.provenance->>'sourceKey' IS DISTINCT FROM p_item.provenance->'source'->>'sourceKey'
  THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  IF snapshot->>'intentKind' = 'custom' THEN
    IF p_item.source_requirement_id IS NOT NULL
      OR NOT platform_private.requirements_editor_text(snapshot->'rawLabel',2147483647)
      OR NOT platform_private.requirements_editor_text(snapshot->'rawGroupLabel',2147483647)
      OR snapshot->'label' <> snapshot->'rawLabel' OR snapshot->'groupLabel' <> snapshot->'rawGroupLabel'
      OR snapshot->'sourceRequirementKey' <> 'null'::JSONB
      OR snapshot->'sourceChecklistVersion' <> 'null'::JSONB OR snapshot->'sourceInstructions' <> 'null'::JSONB
    THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  ELSIF p_item.source_requirement_id IS NULL
    OR NOT platform_private.requirements_editor_version(snapshot->'sourceChecklistVersion')
    OR NOT platform_private.requirements_editor_text(snapshot->'sourceRequirementKey',2147483647)
    OR NOT platform_private.requirements_editor_text(snapshot->'sourceInstructions',2147483647)
  THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  IF p_item.predecessor_item_id IS NOT NULL THEN
    SELECT * INTO previous FROM platform_private.application_requirement_items
    WHERE id=p_item.predecessor_item_id AND organization_id=p_item.organization_id
      AND student_case_id=p_item.student_case_id AND application_id=p_item.application_id
      AND revision_id=p_revision.previous_revision_id AND requirement_key=p_item.requirement_key;
    IF NOT FOUND OR (previous.definition_impact='changed' AND p_item.definition_impact IS DISTINCT FROM 'changed')
    THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  ELSIF left(p_item.requirement_key,2) <> 'r.'
    OR NOT platform_private.requirements_editor_uuid(to_jsonb(substr(p_item.requirement_key,3)))
  THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
END
$$;

CREATE FUNCTION platform_private.requirements_editor_insert_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE revision platform_private.application_requirement_revisions%ROWTYPE;
  previous platform_private.application_requirement_revisions%ROWTYPE;
  inserted_item platform_private.application_requirement_items%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'application_requirement_revisions' THEN
    IF NEW.origin = 'staff_confirmed' THEN
      SELECT * INTO previous FROM platform_private.application_requirement_revisions
      WHERE organization_id=NEW.organization_id AND student_case_id=NEW.student_case_id
        AND application_id=NEW.application_id ORDER BY revision_version DESC LIMIT 1;
      IF previous.id IS NOT NULL AND previous.revision_version=9223372036854775807 THEN
        RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
      IF NEW.previous_revision_id IS DISTINCT FROM previous.id
        OR NEW.revision_version <> COALESCE(previous.revision_version,0)+1
        OR NOT platform_private.requirements_editor_keys(NEW.source_snapshot,
          ARRAY['protocolVersion','contextHash','binding','legacyApplication','sources','sourceDecisions'])
        OR NEW.source_snapshot->'protocolVersion' IS DISTINCT FROM '1'::JSONB
        OR jsonb_typeof(NEW.source_snapshot->'sources') IS DISTINCT FROM 'array'
        OR jsonb_typeof(NEW.source_snapshot->'sourceDecisions') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    END IF;
  ELSE
    SELECT * INTO revision FROM platform_private.application_requirement_revisions
    WHERE id=NEW.revision_id AND organization_id=NEW.organization_id
      AND student_case_id=NEW.student_case_id AND application_id=NEW.application_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    inserted_item := NEW;
    PERFORM platform_private.requirements_editor_assert_item(inserted_item,revision);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER application_requirement_revision_full_insert_guard
  BEFORE INSERT ON platform_private.application_requirement_revisions
  FOR EACH ROW EXECUTE FUNCTION platform_private.requirements_editor_insert_guard();
CREATE TRIGGER application_requirement_item_full_insert_guard
  BEFORE INSERT ON platform_private.application_requirement_items
  FOR EACH ROW EXECUTE FUNCTION platform_private.requirements_editor_insert_guard();

CREATE FUNCTION platform_private.requirements_editor_assert_revision(p_revision platform_private.application_requirement_revisions)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item platform_private.application_requirement_items%ROWTYPE; position INTEGER := 0;
BEGIN
  IF p_revision.id IS NULL THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  IF p_revision.origin = 'evo_starter' THEN
    IF p_revision.configuration_state <> 'needs_confirmation' OR p_revision.revision_version <> 1
      OR p_revision.previous_revision_id IS NOT NULL OR p_revision.change_reason IS NOT NULL
      OR p_revision.source_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    PERFORM platform_private.application_requirement_receipt(p_revision.id,NULL);
  ELSIF p_revision.origin IS DISTINCT FROM 'staff_confirmed' OR p_revision.configuration_state <> 'confirmed'
    OR p_revision.source_snapshot IS NULL OR p_revision.change_reason IS NULL
  THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  FOR item IN SELECT * FROM platform_private.application_requirement_items
    WHERE revision_id=p_revision.id ORDER BY application_requirement_items.position
  LOOP
    position := position+1;
    IF item.position<>position OR position>100 THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
    PERFORM platform_private.requirements_editor_assert_item(item,p_revision);
    IF p_revision.origin='staff_confirmed' AND item.compatibility_key IN ('evo.photo.v1','evo.passport.v1')
      AND NOT platform_private.requirements_editor_typed_item(item.id)
    THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  END LOOP;
  IF position=0 THEN RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
END
$$;

CREATE FUNCTION platform_private.application_requirements_v2_view(
  p_organization_id UUID,p_student_case_id UUID,p_application_id UUID,p_student BOOLEAN,
  p_revision_id UUID DEFAULT NULL,p_staff_write BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE revision platform_private.application_requirement_revisions%ROWTYPE;
  item platform_private.application_requirement_items%ROWTYPE; slot platform.document_slots%ROWTYPE;
  reasons TEXT[]; configuration TEXT[] := ARRAY[]::TEXT[]; file_state JSONB; items JSONB := '[]'::JSONB;
BEGIN
  IF p_student_case_id IS NULL OR p_application_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  IF p_staff_write IS NULL OR (p_student AND p_staff_write) THEN
    RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM platform_private.application_requirements_actor(p_organization_id,p_student_case_id,p_student,p_staff_write);
  IF NOT EXISTS (SELECT 1 FROM platform_private.catalog_preparation_bindings
    WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id)
  THEN RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO revision FROM platform_private.application_requirement_revisions AS candidate
  WHERE candidate.organization_id=p_organization_id AND candidate.student_case_id=p_student_case_id
    AND candidate.application_id=p_application_id AND (p_revision_id IS NULL OR candidate.id=p_revision_id)
  ORDER BY candidate.revision_version DESC LIMIT 1;
  IF p_revision_id IS NOT NULL AND revision.id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501'; END IF;
  IF revision.id IS NULL THEN
    configuration := platform_private.application_requirement_configuration_reasons(p_organization_id,p_student_case_id,p_application_id);
  ELSE
    PERFORM platform_private.requirements_editor_assert_revision(revision);
    FOR item IN SELECT * FROM platform_private.application_requirement_items WHERE revision_id=revision.id ORDER BY position LOOP
      reasons := ARRAY[]::TEXT[];
      SELECT * INTO slot FROM platform.document_slots
      WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND id=item.document_slot_id;
      IF NOT FOUND THEN reasons := array_append(reasons,'slot_missing');
      ELSE
        IF slot.removed_at IS NOT NULL THEN reasons := array_append(reasons,'slot_removed'); END IF;
        IF NOT platform_private.requirements_editor_item_matches(slot,item) THEN reasons := array_append(reasons,'slot_metadata_changed'); END IF;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM platform.document_slot_case_links
        WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id
          AND document_slot_id=item.document_slot_id AND university_application_id=p_application_id)
      THEN reasons := array_append(reasons,'application_link_missing'); END IF;
      IF reasons && ARRAY['slot_missing','slot_removed','application_link_missing']
        AND NOT ('material_association_unavailable'=ANY(configuration))
      THEN configuration := array_append(configuration,'material_association_unavailable'); END IF;
      IF 'slot_metadata_changed'=ANY(reasons) AND NOT ('material_metadata_changed'=ANY(configuration))
      THEN configuration := array_append(configuration,'material_metadata_changed'); END IF;
      IF cardinality(reasons)>0 THEN
        file_state := jsonb_build_object('slotStatus',NULL,'currentVersionId',NULL,'currentVersionNo',NULL,
          'reviewDecision',NULL,'reviewReason',NULL,'reviewedAt',NULL,'technicalAvailability','unavailable','unavailableReasons',to_jsonb(reasons));
      ELSE file_state := platform_private.requirements_editor_file_state(slot)-'filename'; END IF;
      items := items || jsonb_build_array(jsonb_build_object('requirementItemId',item.id,'requirementKey',item.requirement_key,
        'documentSlotId',item.document_slot_id,'position',item.position,'required',item.required,
        'label',item.label,'groupLabel',item.group_label,'instructions',item.instructions,
        'compatibilityKey',item.compatibility_key,'deadline',item.deadline,
        'reviewScope','document_version','definitionImpact',item.definition_impact) || file_state);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('protocolVersion',2,'studentCaseId',p_student_case_id,'applicationId',p_application_id,
    'state',CASE WHEN cardinality(configuration)>0 THEN 'needs_configuration'
      WHEN revision.id IS NULL THEN 'uninitialized' ELSE 'initialized' END,
    'revisionId',revision.id,'revisionVersion',revision.revision_version::TEXT,'origin',revision.origin,
    'configurationState',revision.configuration_state,'initializedAt',revision.initialized_at,
    'configurationReasons',to_jsonb(configuration),'items',items);
END
$$;

CREATE OR REPLACE FUNCTION platform.student_application_requirements_v2(p_student_case_id UUID,p_application_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role='student';
  RETURN platform_private.application_requirements_v2_view(organization_id,p_student_case_id,p_application_id,TRUE,NULL);
END
$$;
CREATE OR REPLACE FUNCTION platform.staff_application_requirements_v2(p_student_case_id UUID,p_application_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id FROM platform.current_actor_authority() AS authority;
  RETURN platform_private.application_requirements_v2_view(organization_id,p_student_case_id,p_application_id,FALSE,NULL);
END
$$;

CREATE FUNCTION platform_private.requirements_editor_legacy(p_details JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE field TEXT; ids UUID[]; exceptions UUID[];
BEGIN
  FOREACH field IN ARRAY ARRAY['documentsApplicability','documentsSource','documentsCheckedOn',
    'documentSlotIds','documentExceptionSlotIds','documentsExceptionReason','documentsExceptionEvidence'] LOOP
    IF p_details ? field AND NOT platform_private.requirements_editor_text(p_details->field,2000)
    THEN RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE = 'PT409'; END IF;
  END LOOP;
  IF (p_details ? 'documentsApplicability' AND p_details->>'documentsApplicability'
      NOT IN ('needs_confirmation','required','not_required'))
    OR (p_details ? 'documentsCheckedOn' AND NOT platform_private.requirements_editor_date(p_details->'documentsCheckedOn'))
  THEN RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE = 'PT409'; END IF;
  BEGIN
    ids := platform_private.admissions_document_ids(p_details->>'documentSlotIds');
    exceptions := platform_private.admissions_document_ids(p_details->>'documentExceptionSlotIds');
  EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation THEN
    RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE = 'PT409';
  END;
  IF NOT exceptions <@ ids THEN
    RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE = 'PT409'; END IF;
  RETURN jsonb_build_object('documentsApplicability',p_details->'documentsApplicability',
    'documentsSource',p_details->'documentsSource','documentsCheckedOn',p_details->'documentsCheckedOn',
    'documentSlotIds',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM unnest(ids) AS selected(value)),'[]'::JSONB),
    'documentExceptionSlotIds',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM unnest(exceptions) AS selected(value)),'[]'::JSONB),
    'documentsExceptionReason',p_details->'documentsExceptionReason','documentsExceptionEvidence',p_details->'documentsExceptionEvidence');
END
$$;

CREATE FUNCTION platform_private.requirements_editor_context(
  p_organization_id UUID,p_student_case_id UUID,p_application_id UUID,p_write BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; target_case platform.student_cases%ROWTYPE;
  application platform.university_applications%ROWTYPE;
  bound platform_private.catalog_preparation_bindings%ROWTYPE;
  publication platform_private.university_catalog_publications%ROWTYPE;
  manifest platform.country_requirement_versions%ROWTYPE;
  requirement platform.document_requirements%ROWTYPE;
  item platform_private.application_requirement_items%ROWTYPE;
  revision platform_private.application_requirement_revisions%ROWTYPE;
  slot platform.document_slots%ROWTYPE; link platform.document_slot_case_links%ROWTYPE;
  program JSONB; intake JSONB; snapshot JSONB; legacy JSONB; candidate JSONB; links JSONB;
  sources JSONB := '[]'::JSONB; candidates JSONB := '[]'::JSONB; result JSONB; source_id UUID;
  block_reason TEXT; material_state TEXT;
BEGIN
  IF p_student_case_id IS NULL OR p_application_id IS NULL OR p_write IS NULL THEN
    RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  SELECT * INTO actor FROM platform_private.application_requirements_actor(p_organization_id,p_student_case_id,FALSE,p_write);
  SELECT * INTO target_case FROM platform.student_cases WHERE organization_id=p_organization_id AND id=p_student_case_id;
  SELECT * INTO application FROM platform.university_applications
  WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND id=p_application_id;
  SELECT * INTO bound FROM platform_private.catalog_preparation_bindings
  WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id;
  IF target_case.id IS NULL OR application.id IS NULL OR bound.application_id IS NULL THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO publication FROM platform_private.university_catalog_publications
  WHERE organization_id=p_organization_id AND institution_id=bound.institution_id AND id=bound.publication_id AND status='published';
  SELECT value INTO program FROM jsonb_array_elements(publication.content->'programs') AS entry(value)
    WHERE value->>'id'=bound.program_id;
  SELECT value INTO intake FROM jsonb_array_elements(program->'intakes') AS entry(value)
    WHERE value->>'id'=bound.intake_id::TEXT;
  IF publication.id IS NULL OR program IS NULL OR intake IS NULL THEN
    RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE = '55000'; END IF;
  legacy := platform_private.requirements_editor_legacy(application.admissions_details);
  IF (SELECT count(*) FROM platform.document_slots WHERE organization_id=p_organization_id
      AND student_case_id=p_student_case_id AND removed_at IS NULL)>1000
  THEN RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
  FOR slot IN SELECT * FROM platform.document_slots WHERE organization_id=p_organization_id
    AND student_case_id=p_student_case_id AND removed_at IS NULL ORDER BY id LOOP
    snapshot := platform_private.requirements_editor_slot_snapshot(slot);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('linkId',entry.id,'targetKind',entry.target_kind,
      'targetId',COALESCE(entry.university_application_id,entry.visa_case_id))
      ORDER BY entry.target_kind::TEXT COLLATE "C",COALESCE(entry.university_application_id,entry.visa_case_id),entry.id),'[]'::JSONB)
    INTO links FROM platform.document_slot_case_links AS entry
    WHERE entry.organization_id=p_organization_id AND entry.student_case_id=p_student_case_id AND entry.document_slot_id=slot.id;
    candidate := jsonb_build_object('documentSlotId',slot.id,'slotVersion',slot.version::TEXT,'intentKind',slot.intent_kind,
      'sourceRequirement',CASE WHEN slot.requirement_id IS NOT NULL THEN jsonb_build_object(
        'requirementId',slot.requirement_id,'requirementKey',snapshot->'sourceRequirementKey',
        'checklistVersion',snapshot->'sourceChecklistVersion') ELSE NULL END,
      'rawLabel',slot.display_label,'rawGroupLabel',slot.group_label,'label',snapshot->'label',
      'groupLabel',snapshot->'groupLabel','instructions',snapshot->'sourceInstructions','links',links)
      || platform_private.requirements_editor_file_state(slot);
    candidates := candidates || jsonb_build_array(candidate);
  END LOOP;

  SELECT * INTO revision FROM platform_private.application_requirement_revisions
  WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND application_id=p_application_id
  ORDER BY revision_version DESC LIMIT 1;
  FOR item IN SELECT * FROM platform_private.application_requirement_items WHERE revision_id=revision.id ORDER BY position LOOP
    SELECT * INTO slot FROM platform.document_slots WHERE organization_id=p_organization_id
      AND student_case_id=p_student_case_id AND id=item.document_slot_id;
    material_state := CASE WHEN slot.id IS NULL THEN 'missing' WHEN slot.removed_at IS NOT NULL THEN 'removed' ELSE 'selectable' END;
    sources := sources || jsonb_build_array(jsonb_build_object('sourceKey','prior:'||item.id::TEXT,'kind','prior',
      'documentSlotId',item.document_slot_id,'materialState',material_state,'required',item.required,
      'label',item.label,'groupLabel',item.group_label,'instructions',item.instructions,
      'reference',jsonb_build_object('revisionId',revision.id,'revisionVersion',revision.revision_version::TEXT,
        'requirementItemId',item.id,'requirementKey',item.requirement_key,'origin',revision.origin,
        'compatibilityKey',item.compatibility_key,'typedStarterEligible',
          COALESCE(material_state='selectable' AND platform_private.requirements_editor_typed_item(item.id)
            AND platform_private.requirements_editor_item_matches(slot,item),FALSE)),
      'legacyException',FALSE,'mustRetain',FALSE));
  END LOOP;
  IF target_case.applied_country_requirement_version_id IS NOT NULL THEN
    SELECT * INTO manifest FROM platform.country_requirement_versions
    WHERE organization_id=p_organization_id AND id=target_case.applied_country_requirement_version_id
      AND status IN ('approved','retired');
    IF NOT FOUND THEN RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE = 'PT409'; END IF;
    FOR requirement IN SELECT * FROM platform.document_requirements AS entry
      WHERE entry.organization_id=p_organization_id AND entry.target_country=manifest.target_country
        AND entry.target_degree=manifest.target_degree AND entry.program_direction IS NOT DISTINCT FROM manifest.program_direction
        AND entry.checklist_version=manifest.version ORDER BY entry.id LOOP
      SELECT * INTO slot FROM platform.document_slots WHERE organization_id=p_organization_id
        AND student_case_id=p_student_case_id AND requirement_id=requirement.id;
      material_state := CASE WHEN slot.id IS NULL THEN 'missing' WHEN slot.removed_at IS NOT NULL THEN 'removed' ELSE 'selectable' END;
      sources := sources || jsonb_build_array(jsonb_build_object('sourceKey','country:'||requirement.id::TEXT,'kind','country',
        'documentSlotId',slot.id,'materialState',material_state,'required',NULL,'label',requirement.label,
        'groupLabel',requirement.group_label,'instructions',requirement.instructions,
        'reference',jsonb_build_object('manifestId',manifest.id,'manifestVersion',manifest.version::TEXT,'manifestStatus',manifest.status,
          'requirementId',requirement.id,'requirementKey',requirement.requirement_key,'requirementStatus',requirement.status),
        'legacyException',FALSE,'mustRetain',FALSE));
      IF jsonb_array_length(sources)>2000 THEN RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
    END LOOP;
  END IF;
  FOR link IN SELECT * FROM platform.document_slot_case_links
    WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id
      AND university_application_id=p_application_id ORDER BY document_slot_id LOOP
    SELECT * INTO slot FROM platform.document_slots WHERE organization_id=p_organization_id
      AND student_case_id=p_student_case_id AND id=link.document_slot_id;
    snapshot := platform_private.requirements_editor_slot_snapshot(slot);
    material_state := CASE WHEN slot.id IS NULL THEN 'missing' WHEN slot.removed_at IS NOT NULL THEN 'removed' ELSE 'selectable' END;
    sources := sources || jsonb_build_array(jsonb_build_object('sourceKey','link:'||link.document_slot_id::TEXT,'kind','link',
      'documentSlotId',link.document_slot_id,'materialState',material_state,'required',NULL,
      'label',snapshot->'label','groupLabel',snapshot->'groupLabel','instructions',snapshot->'sourceInstructions',
      'reference',jsonb_build_object('linkId',link.id),'legacyException',FALSE,'mustRetain',FALSE));
    IF jsonb_array_length(sources)>2000 THEN RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
  END LOOP;
  FOR source_id IN SELECT value::UUID FROM jsonb_array_elements_text(legacy->'documentSlotIds') AS entry(value) LOOP
    SELECT * INTO slot FROM platform.document_slots WHERE organization_id=p_organization_id
      AND student_case_id=p_student_case_id AND id=source_id;
    snapshot := platform_private.requirements_editor_slot_snapshot(slot);
    material_state := CASE WHEN slot.id IS NULL THEN 'missing' WHEN slot.removed_at IS NOT NULL THEN 'removed' ELSE 'selectable' END;
    sources := sources || jsonb_build_array(jsonb_build_object('sourceKey','application:'||source_id::TEXT,'kind','application',
      'documentSlotId',source_id,'materialState',material_state,'required',CASE legacy->>'documentsApplicability'
        WHEN 'required' THEN TRUE WHEN 'not_required' THEN FALSE ELSE NULL END,
      'label',snapshot->'label','groupLabel',snapshot->'groupLabel','instructions',snapshot->'sourceInstructions',
      'reference',jsonb_build_object('applicationVersion',application.version::TEXT),
      'legacyException',(legacy->'documentExceptionSlotIds') ? source_id::TEXT,
      'mustRetain',COALESCE(legacy->>'documentsApplicability'='required',FALSE)));
  END LOOP;
  IF jsonb_array_length(sources)>2000 THEN RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'sourceKey') COLLATE "C"),'[]'::JSONB)
    INTO sources FROM jsonb_array_elements(sources) AS entry(value);
  block_reason := CASE
    WHEN NOT platform_private.staff_can_access_for_actor(p_organization_id,'document.manage','student_case',p_student_case_id) THEN 'permission_required'
    WHEN target_case.state<>'active' THEN 'case_inactive'
    WHEN target_case.portal_activated_at IS NULL THEN 'portal_inactive'
    WHEN application.status<>'preparation' THEN 'application_not_preparation' ELSE NULL END;
  result := jsonb_build_object('protocolVersion',1,'studentCaseId',p_student_case_id,'applicationId',p_application_id,
    'applicationVersion',application.version::TEXT,'admissionsVersion',target_case.admissions_version::TEXT,
    'binding',jsonb_build_object('institutionId',bound.institution_id,'publicationId',bound.publication_id,
      'publicationVersion',publication.version,'programId',bound.program_id,'intakeId',bound.intake_id,
      'institutionName',publication.content->>'name','programTitle',program->>'title','intakeLabel',intake->>'label',
      'selectedAt',bound.selected_at,'deadlineStateAtSelection',bound.deadline_state_at_selection),
    'requirements',platform_private.application_requirements_v2_view(p_organization_id,p_student_case_id,p_application_id,FALSE,NULL,p_write),
    'legacyApplication',legacy,'sources',sources,'candidates',candidates,'canSave',block_reason IS NULL,'saveBlockReason',block_reason);
  RETURN result || jsonb_build_object('contextHash',encode(sha256(convert_to(jsonb_build_object(
    'domain','evo.application.requirements.editor.v1','organizationId',p_organization_id,
    'actorMembershipId',actor.actor_membership_id,'context',result)::TEXT,'UTF8')),'hex'));
END
$$;

CREATE FUNCTION platform.staff_application_requirements_editor_v1(p_student_case_id UUID,p_application_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization_id UUID;
BEGIN
  SELECT authority.organization_id INTO organization_id FROM platform.current_actor_authority() AS authority;
  RETURN platform_private.requirements_editor_context(organization_id,p_student_case_id,p_application_id,FALSE);
END
$$;

-- Validation preserves the exact text, explicit nulls and both array orders.
-- JSONB canonicalizes object-key order only; never trim or sort a frozen intent.
CREATE FUNCTION platform_private.requirements_editor_validate_payload(p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item JSONB; material JSONB; provenance JSONB; decision JSONB;
  keys TEXT[] := ARRAY[]::TEXT[]; slots TEXT[] := ARRAY[]::TEXT[]; sources TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF octet_length(p_payload::TEXT)>1048576 THEN
    RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
  IF NOT platform_private.requirements_editor_keys(p_payload,ARRAY['expectedContextHash','expectedApplicationVersion',
      'expectedRevisionId','expectedRevisionVersion','changeReason','items','sourceDecisions'])
    OR jsonb_typeof(p_payload->'expectedContextHash') IS DISTINCT FROM 'string'
    OR length(p_payload->>'expectedContextHash')<>64 OR p_payload->>'expectedContextHash' !~ '^[0-9a-f]{64}$'
    OR NOT platform_private.requirements_editor_version(p_payload->'expectedApplicationVersion')
    OR NOT platform_private.requirements_editor_text(p_payload->'changeReason',2000)
    OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload->'sourceDecisions') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  IF (p_payload->'expectedRevisionId'='null'::JSONB) IS DISTINCT FROM (p_payload->'expectedRevisionVersion'='null'::JSONB)
    OR (p_payload->'expectedRevisionId'<>'null'::JSONB AND (
      NOT platform_private.requirements_editor_uuid(p_payload->'expectedRevisionId')
      OR NOT platform_private.requirements_editor_version(p_payload->'expectedRevisionVersion')))
    OR jsonb_array_length(p_payload->'items')=0
  THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_payload->'items')>100 OR jsonb_array_length(p_payload->'sourceDecisions')>2000 THEN
    RAISE EXCEPTION 'application_requirements_editor_limit' USING ERRCODE = 'PT413'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') AS entry(value) LOOP
    IF NOT platform_private.requirements_editor_keys(item,ARRAY['requirementKey','required','label','groupLabel','instructions','deadline','material','provenance'])
      OR NOT platform_private.requirements_editor_text(item->'requirementKey',100)
      OR item->>'requirementKey' !~ '^[a-z][a-z0-9_.-]*$' OR item->>'requirementKey'=ANY(keys)
      OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean'
      OR NOT platform_private.requirements_editor_text(item->'label',500)
      OR NOT platform_private.requirements_editor_text(item->'groupLabel',200)
      OR NOT platform_private.requirements_editor_text(item->'instructions',4000)
      OR NOT platform_private.requirements_editor_deadline(item->'deadline')
    THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    keys := array_append(keys,item->>'requirementKey');
    material := item->'material'; provenance := item->'provenance';
    IF material->>'kind'='existing' THEN
      IF NOT platform_private.requirements_editor_keys(material,ARRAY['kind','documentSlotId','expectedSlotVersion','expectedCurrentVersionId','expectedCurrentVersionNo'])
        OR NOT platform_private.requirements_editor_uuid(material->'documentSlotId')
        OR NOT platform_private.requirements_editor_version(material->'expectedSlotVersion')
        OR material->>'documentSlotId'=ANY(slots)
        OR (material->'expectedCurrentVersionId'='null'::JSONB) IS DISTINCT FROM (material->'expectedCurrentVersionNo'='null'::JSONB)
        OR (material->'expectedCurrentVersionId'<>'null'::JSONB AND (
          NOT platform_private.requirements_editor_uuid(material->'expectedCurrentVersionId')
          OR NOT platform_private.requirements_editor_version(material->'expectedCurrentVersionNo')))
      THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
      slots := array_append(slots,material->>'documentSlotId');
    ELSIF material->>'kind'='new' THEN
      IF NOT platform_private.requirements_editor_keys(material,ARRAY['kind','label','groupLabel'])
        OR NOT platform_private.requirements_editor_text(material->'label',500)
        OR NOT platform_private.requirements_editor_text(material->'groupLabel',200)
        OR material->>'label' ~ '[[:cntrl:]]' OR material->>'groupLabel' ~ '[[:cntrl:]]'
      THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    ELSE RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    IF NOT platform_private.requirements_editor_keys(provenance,ARRAY['kind','sourceKey','basis'])
      OR jsonb_typeof(provenance->'kind') IS DISTINCT FROM 'string'
      OR provenance->>'kind' NOT IN ('typed_starter','country_manifest','application_details','staff_entry')
      OR NOT platform_private.requirements_editor_text(provenance->'basis',2000)
    THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    IF provenance->>'kind'='staff_entry' THEN
      IF provenance->'sourceKey'<>'null'::JSONB THEN
        RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    ELSIF NOT platform_private.requirements_editor_text(provenance->'sourceKey',200)
      OR provenance->>'sourceKey' ~ '[^\x21-\x7E]' OR material->>'kind'<>'existing'
    THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOR decision IN SELECT value FROM jsonb_array_elements(p_payload->'sourceDecisions') AS entry(value) LOOP
    IF NOT platform_private.requirements_editor_keys(decision,ARRAY['sourceKey','disposition','requirementKey','reason'])
      OR NOT platform_private.requirements_editor_text(decision->'sourceKey',200)
      OR decision->>'sourceKey' ~ '[^\x21-\x7E]' OR decision->>'sourceKey'=ANY(sources)
      OR jsonb_typeof(decision->'disposition') IS DISTINCT FROM 'string'
      OR decision->>'disposition' NOT IN ('included','excluded')
      OR (decision->'reason'<>'null'::JSONB AND NOT platform_private.requirements_editor_text(decision->'reason',2000))
    THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    sources := array_append(sources,decision->>'sourceKey');
    IF decision->>'disposition'='excluded' THEN
      IF decision->'requirementKey'<>'null'::JSONB OR decision->'reason'='null'::JSONB THEN
        RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(decision->'requirementKey') IS DISTINCT FROM 'string'
      OR NOT (decision->>'requirementKey'=ANY(keys)) THEN
      RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE = '22023'; END IF;
  END LOOP;
END
$$;

CREATE FUNCTION platform.staff_save_application_requirements_v1(
  p_student_case_id UUID,p_application_id UUID,p_request_id UUID,p_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_organization_id UUID; actor RECORD; target_case platform.student_cases%ROWTYPE;
  application platform.university_applications%ROWTYPE; previous_revision platform_private.application_requirement_revisions%ROWTYPE;
  revision platform_private.application_requirement_revisions%ROWTYPE;
  previous platform_private.application_requirement_items%ROWTYPE; created_item platform_private.application_requirement_items%ROWTYPE;
  slot platform.document_slots%ROWTYPE; audit platform.audit_events%ROWTYPE;
  context JSONB; intent JSONB; receipt JSONB; item JSONB; material JSONB; provenance JSONB;
  source JSONB; decision JSONB; candidate JSONB; item_source JSONB; item_decision JSONB;
  next_definition JSONB; material_snapshot JSONB; previous_snapshot JSONB;
  compatibility_key TEXT; definition_impact TEXT; item_position INTEGER:=0; typed BOOLEAN; audit_constraint TEXT;
BEGIN
  IF NOT platform_private.requirements_editor_uuid(to_jsonb(p_student_case_id))
    OR NOT platform_private.requirements_editor_uuid(to_jsonb(p_application_id))
    OR NOT platform_private.requirements_editor_uuid(to_jsonb(p_request_id)) OR p_payload IS NULL
  THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  SELECT authority.organization_id INTO actor_organization_id FROM platform.current_actor_authority() AS authority
    WHERE authority.platform_role<>'student';
  SELECT * INTO actor FROM platform_private.application_requirements_actor(actor_organization_id,p_student_case_id,FALSE,TRUE);
  BEGIN
    PERFORM 1 FROM platform_private.require_case_operator(actor_organization_id,p_student_case_id,'document.manage');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE='42501';
  END;
  SELECT * INTO target_case FROM platform.student_cases AS target
    WHERE target.organization_id=actor_organization_id AND target.id=p_student_case_id FOR UPDATE;
  SELECT * INTO application FROM platform.university_applications AS target
    WHERE target.organization_id=actor_organization_id AND target.student_case_id=p_student_case_id AND target.id=p_application_id FOR UPDATE;
  IF target_case.id IS NULL OR application.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM platform_private.catalog_preparation_bindings AS bound
    WHERE bound.organization_id=actor_organization_id AND bound.student_case_id=p_student_case_id AND bound.application_id=p_application_id)
  THEN RAISE EXCEPTION 'application_requirements_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.document_slots AS target WHERE target.organization_id=actor_organization_id
    AND target.student_case_id=p_student_case_id ORDER BY target.id FOR UPDATE;
  PERFORM 1 FROM platform.document_slot_case_links AS target WHERE target.organization_id=actor_organization_id
    AND target.student_case_id=p_student_case_id ORDER BY target.id FOR UPDATE;
  SELECT * INTO actor FROM platform_private.application_requirements_actor(actor_organization_id,p_student_case_id,FALSE,TRUE);
  intent := jsonb_build_object('organizationId',actor_organization_id,'actorMembershipId',actor.actor_membership_id,
    'studentCaseId',p_student_case_id,'applicationId',p_application_id,'requestId',p_request_id,'payload',p_payload);
  SELECT * INTO audit FROM platform.audit_events AS entry WHERE entry.request_id=p_request_id;
  IF FOUND THEN
    IF audit.organization_id IS DISTINCT FROM actor_organization_id OR audit.action IS DISTINCT FROM 'application.requirements.save'
      OR audit.resource_type IS DISTINCT FROM 'university_application' OR audit.resource_id IS DISTINCT FROM p_application_id
      OR audit.after_state->'intent' IS DISTINCT FROM intent
    THEN RAISE EXCEPTION 'application_requirements_request_conflict' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(audit.after_state->'receipt') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'application_requirements_invariant_conflict' USING ERRCODE='55000'; END IF;
    RETURN audit.after_state->'receipt';
  END IF;
  -- Historical replay above is independent of current lifecycle, source counts,
  -- timezone catalogue and current revision. NEW saves check all of them below.
  PERFORM platform_private.requirements_editor_validate_payload(p_payload);
  IF target_case.state<>'active' OR target_case.portal_activated_at IS NULL THEN
    RAISE EXCEPTION 'application_requirements_case_ineligible' USING ERRCODE='PT409'; END IF;
  IF application.status<>'preparation' THEN
    RAISE EXCEPTION 'application_requirements_application_ineligible' USING ERRCODE='PT409'; END IF;
  context := platform_private.requirements_editor_context(actor_organization_id,p_student_case_id,p_application_id,TRUE);
  IF p_payload->>'expectedContextHash' IS DISTINCT FROM context->>'contextHash'
    OR p_payload->>'expectedApplicationVersion' IS DISTINCT FROM application.version::TEXT
    OR p_payload->'expectedRevisionId' IS DISTINCT FROM context->'requirements'->'revisionId'
    OR p_payload->'expectedRevisionVersion' IS DISTINCT FROM context->'requirements'->'revisionVersion'
  THEN RAISE EXCEPTION 'application_requirements_stale_context' USING ERRCODE='PT409'; END IF;
  SELECT * INTO previous_revision FROM platform_private.application_requirement_revisions AS target
    WHERE target.organization_id=actor_organization_id AND target.student_case_id=p_student_case_id
      AND target.application_id=p_application_id ORDER BY target.revision_version DESC LIMIT 1;
  IF previous_revision.revision_version=9223372036854775807 THEN
    RAISE EXCEPTION 'application_requirements_stale_context' USING ERRCODE='PT409'; END IF;
  IF jsonb_array_length(p_payload->'sourceDecisions')<>jsonb_array_length(context->'sources')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sourceDecisions') AS d(value)
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(context->'sources') AS s(value)
        WHERE s.value->>'sourceKey'=d.value->>'sourceKey'))
  THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;

  FOR source IN SELECT value FROM jsonb_array_elements(context->'sources') AS entry(value) LOOP
    SELECT value INTO decision FROM jsonb_array_elements(p_payload->'sourceDecisions') AS entry(value)
      WHERE value->>'sourceKey'=source->>'sourceKey';
    IF decision->>'disposition'='excluded' THEN
      IF source->'mustRetain'='true'::JSONB THEN
        RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE='PT409'; END IF;
      CONTINUE;
    END IF;
    SELECT value INTO item FROM jsonb_array_elements(p_payload->'items') AS entry(value)
      WHERE value->>'requirementKey'=decision->>'requirementKey';
    IF source->>'kind'='prior' THEN
      IF source->'reference'->>'requirementKey' IS DISTINCT FROM item->>'requirementKey' THEN
        RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
    ELSIF item->'material'->>'kind' IS DISTINCT FROM 'existing'
      OR source->>'materialState'<>'selectable' OR source->'documentSlotId'='null'::JSONB
      OR item->'material'->'documentSlotId' IS DISTINCT FROM source->'documentSlotId'
    THEN
      IF source->'mustRetain'='true'::JSONB THEN
        RAISE EXCEPTION 'application_requirements_legacy_configuration_conflict' USING ERRCODE='PT409'; END IF;
      RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023';
    END IF;
    IF source->'required'='true'::JSONB AND item->'required'='false'::JSONB AND decision->'reason'='null'::JSONB THEN
      RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
  END LOOP;

  -- Validate every selected material and every claimed source before creating
  -- the revision. The transaction still rolls everything back on any later guard.
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') AS entry(value) LOOP
    material:=item->'material'; provenance:=item->'provenance';
    SELECT * INTO previous FROM platform_private.application_requirement_items AS entry
      WHERE entry.revision_id=previous_revision.id AND entry.requirement_key=item->>'requirementKey';
    IF previous.id IS NULL THEN
      IF left(item->>'requirementKey',2)<>'r.'
        OR NOT platform_private.requirements_editor_uuid(to_jsonb(substr(item->>'requirementKey',3)))
        OR EXISTS (SELECT 1 FROM platform_private.application_requirement_items AS entry
          WHERE entry.organization_id=actor_organization_id AND entry.student_case_id=p_student_case_id
            AND entry.application_id=p_application_id AND entry.requirement_key=item->>'requirementKey')
      THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
    ELSE
      SELECT value INTO item_decision FROM jsonb_array_elements(p_payload->'sourceDecisions') AS entry(value)
        WHERE value->>'sourceKey'='prior:'||previous.id::TEXT;
      IF item_decision->>'disposition' IS DISTINCT FROM 'included'
        OR item_decision->>'requirementKey' IS DISTINCT FROM previous.requirement_key THEN
        RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
    END IF;
    candidate:=NULL;
    IF material->>'kind'='existing' THEN
      SELECT value INTO candidate FROM jsonb_array_elements(context->'candidates') AS entry(value)
        WHERE value->'documentSlotId'=material->'documentSlotId';
      IF candidate IS NULL OR candidate->'slotVersion' IS DISTINCT FROM material->'expectedSlotVersion'
        OR candidate->'currentVersionId' IS DISTINCT FROM material->'expectedCurrentVersionId'
        OR candidate->'currentVersionNo' IS DISTINCT FROM material->'expectedCurrentVersionNo'
      THEN RAISE EXCEPTION 'application_requirements_stale_context' USING ERRCODE='PT409'; END IF;
    END IF;
    IF provenance->>'kind'<>'staff_entry' THEN
      SELECT value INTO item_source FROM jsonb_array_elements(context->'sources') AS entry(value)
        WHERE value->>'sourceKey'=provenance->>'sourceKey';
      SELECT value INTO item_decision FROM jsonb_array_elements(p_payload->'sourceDecisions') AS entry(value)
        WHERE value->>'sourceKey'=provenance->>'sourceKey';
      IF item_source IS NULL OR item_decision->>'disposition' IS DISTINCT FROM 'included'
        OR item_decision->>'requirementKey' IS DISTINCT FROM item->>'requirementKey'
        OR item_source->>'materialState'<>'selectable'
        OR item_source->'documentSlotId' IS DISTINCT FROM material->'documentSlotId'
        OR (provenance->>'kind'='country_manifest' AND (item_source->>'kind'<>'country'
          OR candidate->'sourceRequirement'->'requirementId' IS DISTINCT FROM item_source->'reference'->'requirementId'))
        OR (provenance->>'kind'='application_details' AND item_source->>'kind'<>'application')
        OR (provenance->>'kind'='typed_starter' AND (item_source->>'kind'<>'prior'
          OR item_source->'reference'->'typedStarterEligible' IS DISTINCT FROM 'true'::JSONB
          OR previous.id IS NULL OR previous.id::TEXT IS DISTINCT FROM item_source->'reference'->>'requirementItemId'))
      THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
      IF provenance->>'kind'='typed_starter' AND platform_private.requirements_editor_definition(previous)
        IS DISTINCT FROM jsonb_build_object('requirementKey',item->'requirementKey','required',item->'required',
          'label',item->'label','groupLabel',item->'groupLabel','instructions',item->'instructions',
          'deadline',item->'deadline','documentSlotId',material->'documentSlotId')
      THEN RAISE EXCEPTION 'application_requirements_invalid_intent' USING ERRCODE='22023'; END IF;
    END IF;
  END LOOP;

  INSERT INTO platform_private.application_requirement_revisions (
    organization_id,student_case_id,application_id,revision_version,origin,configuration_state,
    initialized_at,created_by_membership_id,previous_revision_id,change_reason,source_snapshot
  ) VALUES (actor_organization_id,p_student_case_id,p_application_id,COALESCE(previous_revision.revision_version,0)+1,
    'staff_confirmed','confirmed',clock_timestamp(),actor.actor_membership_id,previous_revision.id,p_payload->>'changeReason',
    jsonb_build_object('protocolVersion',1,'contextHash',context->'contextHash','binding',context->'binding',
      'legacyApplication',context->'legacyApplication','sources',context->'sources','sourceDecisions',p_payload->'sourceDecisions'))
  RETURNING * INTO revision;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') AS entry(value) LOOP
    item_position:=item_position+1; material:=item->'material'; provenance:=item->'provenance'; item_source:=NULL;
    SELECT * INTO previous FROM platform_private.application_requirement_items AS entry
      WHERE entry.revision_id=previous_revision.id AND entry.requirement_key=item->>'requirementKey';
    IF material->>'kind'='new' THEN
      INSERT INTO platform.document_slots (organization_id,student_case_id,requirement_id,intent_kind,
        display_label,group_label,status,version,created_by_membership_id)
      VALUES (actor_organization_id,p_student_case_id,NULL,'custom',material->>'label',material->>'groupLabel',
        'required',1,actor.actor_membership_id) RETURNING * INTO slot;
    ELSE
      SELECT * INTO slot FROM platform.document_slots AS entry
      WHERE entry.organization_id=actor_organization_id AND entry.student_case_id=p_student_case_id
        AND entry.id=(material->>'documentSlotId')::UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM platform.document_slot_case_links AS entry
      WHERE entry.organization_id=actor_organization_id AND entry.student_case_id=p_student_case_id
        AND entry.document_slot_id=slot.id AND entry.university_application_id=p_application_id) THEN
      IF slot.version=9223372036854775807 THEN
        RAISE EXCEPTION 'application_requirements_stale_context' USING ERRCODE='PT409'; END IF;
      INSERT INTO platform.document_slot_case_links (organization_id,student_case_id,document_slot_id,target_kind,
        university_application_id,visa_case_id,created_by_membership_id)
      VALUES (actor_organization_id,p_student_case_id,slot.id,'university_application',p_application_id,NULL,actor.actor_membership_id);
      PERFORM pg_catalog.set_config('platform_private.document_slot_case_link_context',
        actor_organization_id::TEXT||':'||p_student_case_id::TEXT||':'||slot.id::TEXT||':'||slot.version::TEXT,TRUE);
      UPDATE platform.document_slots AS target SET version=target.version+1,updated_at=statement_timestamp()
      WHERE target.organization_id=actor_organization_id AND target.student_case_id=p_student_case_id
        AND target.id=slot.id AND target.version=slot.version RETURNING target.* INTO slot;
      IF NOT FOUND THEN RAISE EXCEPTION 'application_requirements_stale_context' USING ERRCODE='PT409'; END IF;
      PERFORM pg_catalog.set_config('platform_private.document_slot_case_link_context','',TRUE);
    END IF;
    material_snapshot:=platform_private.requirements_editor_slot_snapshot(slot);
    typed:=provenance->>'kind'='typed_starter';
    compatibility_key:=CASE WHEN typed THEN previous.compatibility_key
      WHEN previous.id IS NOT NULL AND previous.compatibility_key NOT IN ('evo.photo.v1','evo.passport.v1') THEN previous.compatibility_key
      ELSE 'staff.'||encode(sha256(convert_to(actor_organization_id::TEXT||':'||p_application_id::TEXT||':'||(item->>'requirementKey'),'UTF8')),'hex') END;
    next_definition:=jsonb_build_object('requirementKey',item->'requirementKey','required',item->'required',
      'label',item->'label','groupLabel',item->'groupLabel','instructions',item->'instructions',
      'deadline',item->'deadline','documentSlotId',slot.id);
    previous_snapshot:=CASE WHEN previous.id IS NULL THEN NULL ELSE COALESCE(previous.material_snapshot,
      jsonb_build_object('intentKind','custom','requirementId',NULL,'rawLabel',previous.label,'rawGroupLabel',previous.group_label,
        'label',previous.label,'groupLabel',previous.group_label,'sourceRequirementKey',NULL,'sourceChecklistVersion',NULL,'sourceInstructions',NULL)) END;
    definition_impact:=CASE WHEN previous.definition_impact='changed'
      OR (previous.id IS NOT NULL AND (platform_private.requirements_editor_definition(previous) IS DISTINCT FROM next_definition
        OR previous_snapshot IS DISTINCT FROM material_snapshot OR previous.compatibility_key IS DISTINCT FROM compatibility_key))
      OR (previous.id IS NULL AND material->>'kind'='existing') THEN 'changed' ELSE NULL END;
    IF provenance->>'kind'<>'staff_entry' THEN
      SELECT value INTO item_source FROM jsonb_array_elements(context->'sources') AS entry(value)
        WHERE value->>'sourceKey'=provenance->>'sourceKey';
    END IF;
    INSERT INTO platform_private.application_requirement_items (organization_id,student_case_id,application_id,revision_id,
      requirement_key,position,required,label,group_label,instructions,compatibility_key,source_requirement_id,document_slot_id,
      predecessor_item_id,material_snapshot,provenance,deadline,definition_impact)
    VALUES (actor_organization_id,p_student_case_id,p_application_id,revision.id,item->>'requirementKey',item_position,
      (item->>'required')::BOOLEAN,item->>'label',item->>'groupLabel',item->>'instructions',compatibility_key,slot.requirement_id,slot.id,
      previous.id,material_snapshot,provenance||jsonb_build_object('source',item_source),NULLIF(item->'deadline','null'::JSONB),definition_impact)
    RETURNING * INTO created_item;
  END LOOP;
  PERFORM platform_private.requirements_editor_assert_revision(revision);
  SELECT jsonb_build_object('protocolVersion',1,'requestId',p_request_id,'studentCaseId',p_student_case_id,
    'applicationId',p_application_id,'revisionId',revision.id,'revisionVersion',revision.revision_version::TEXT,
    'previousRevisionId',revision.previous_revision_id,'savedAt',revision.initialized_at,
    'items',jsonb_agg(jsonb_build_object('requirementItemId',entry.id,'requirementKey',entry.requirement_key,
      'documentSlotId',entry.document_slot_id,'position',entry.position) ORDER BY entry.position))
  INTO receipt FROM platform_private.application_requirement_items AS entry WHERE entry.revision_id=revision.id;
  BEGIN
    INSERT INTO platform.audit_events (organization_id,actor_kind,actor_profile_id,actor_principal,action,
      resource_type,resource_id,before_state,after_state,reason,request_id)
    VALUES (actor_organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,'application.requirements.save',
      'university_application',p_application_id,jsonb_build_object('revisionId',previous_revision.id,'revisionVersion',previous_revision.revision_version::TEXT),
      jsonb_build_object('intent',intent,'receipt',receipt),p_payload->>'changeReason',p_request_id);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS audit_constraint=CONSTRAINT_NAME;
    IF audit_constraint='audit_events_request_id_key' THEN
      RAISE EXCEPTION 'application_requirements_request_conflict' USING ERRCODE='22023'; END IF;
    RAISE;
  END;
  RETURN receipt;
END
$$;

-- Keep the entire 218 replay/authority/intent protocol intact. Change only the
-- NEW-intent/full-current boundary; never reconstruct a historical receipt from
-- today's requirements and never make v2 depend on this starter-only reader.
DO $compatibility$
DECLARE body TEXT; anchor TEXT;
BEGIN
  SELECT pg_get_functiondef('platform_private.initialize_application_requirements(uuid,uuid,uuid,uuid,boolean)'::regprocedure) INTO body;
  anchor := '  IF revision.id IS NULL THEN';
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION '226 initializer source anchor drift'; END IF;
  body := replace(body,anchor,E'  IF revision.origin = ''staff_confirmed'' THEN\n'
    || E'    RAISE EXCEPTION ''application_requirements_application_ineligible'' USING ERRCODE = ''PT409'';\n'
    || E'  END IF;\n' || anchor);
  EXECUTE body;
  SELECT pg_get_functiondef('platform_private.application_requirements_view(uuid,uuid,uuid,boolean)'::regprocedure) INTO body;
  anchor := '  -- Validate the complete immutable composition, never synthesize revision 0';
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION '226 v1 reader source anchor drift'; END IF;
  body := replace(body,anchor,E'  IF revision.origin = ''staff_confirmed'' THEN\n'
    || E'    RAISE EXCEPTION ''application_requirements_client_update_required'' USING ERRCODE = ''PT409'';\n'
    || E'  END IF;\n' || anchor);
  EXECUTE body;
END
$compatibility$;

-- Only these two new public surfaces are exposed. The internal write-authority
-- mode is never a public parameter and has no authenticated/service-role grant.
DO $private_acl$
DECLARE routine REGPROCEDURE;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
    WHERE n.nspname='platform_private' AND (left(p.proname,20)='requirements_editor_'
      OR p.proname='application_requirements_v2_view')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin',routine);
  END LOOP;
END
$private_acl$;
REVOKE ALL ON FUNCTION
  platform.staff_application_requirements_editor_v1(UUID,UUID),
  platform.staff_save_application_requirements_v1(UUID,UUID,UUID,JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.staff_application_requirements_editor_v1(UUID,UUID),
  platform.staff_save_application_requirements_v1(UUID,UUID,UUID,JSONB)
  TO authenticated;

COMMIT;
