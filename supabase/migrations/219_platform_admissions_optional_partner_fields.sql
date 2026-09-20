-- Accept the four optional application fields already normalized by184.
-- Preserve legacy facts, validation, function identity and existing ACL.
BEGIN;

CREATE OR REPLACE FUNCTION platform_private.admissions_validate_fields(p_kind TEXT,p_value JSONB) RETURNS JSONB
 LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE field RECORD; schema JSONB:=platform_private.admissions_field_schema(p_kind); rule JSONB; val TEXT; parsed_date DATE;
BEGIN
 IF schema IS NULL OR p_value IS NULL OR jsonb_typeof(p_value)<>'object' OR octet_length(p_value::TEXT)>65536 THEN
   RAISE EXCEPTION 'Invalid admissions details' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT * FROM jsonb_each(p_value) LOOP
   IF p_kind='application' AND field.key=ANY(ARRAY[
     'partner_contact','external_link','decision_reference','decision_note'
   ]) THEN
     PERFORM platform_private.application_partner_detail_fields(jsonb_build_object(field.key,field.value));
     CONTINUE;
   END IF;
   rule:=schema->field.key; val:=field.value#>>'{}';
   IF rule IS NULL OR jsonb_typeof(field.value)<>'string' OR length(btrim(val)) NOT BETWEEN 1 AND 2000
     OR val ~ '[\x01-\x08\x0B\x0C\x0E-\x1F]' THEN
     RAISE EXCEPTION 'Invalid admissions field: %',field.key USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(rule)='array' AND NOT(rule ? val) THEN RAISE EXCEPTION 'Invalid admissions choice: %',field.key USING ERRCODE='22023'; END IF;
   IF rule='"date"'::JSONB THEN
     BEGIN parsed_date:=val::DATE; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END;
     IF val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR parsed_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
       OR to_char(parsed_date,'YYYY-MM-DD')<>val THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END IF;
   END IF;
 END LOOP;
 IF p_kind='case' THEN
   FOREACH val IN ARRAY ARRAY['medical','registration','studentPass'] LOOP
     IF p_value->>(val||'Status')='confirmed' AND
       (NOT p_value ? (val||'On') OR NOT p_value ? (val||'Evidence')) THEN
       RAISE EXCEPTION 'Confirmed post-arrival fact requires date and evidence' USING ERRCODE='22023'; END IF;
     IF p_value->>(val||'Status')='not_required' AND NOT p_value ? (val||'Evidence') THEN
       RAISE EXCEPTION 'Post-arrival exception requires evidence' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF p_value ? 'arrivalOn' AND ((p_value->>'arrivalOn')::DATE > CURRENT_DATE
     OR (p_value ? 'departureOn' AND (p_value->>'arrivalOn')::DATE < (p_value->>'departureOn')::DATE)) THEN
     RAISE EXCEPTION 'Actual arrival cannot be future or before departure' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN p_value;
END $$;

COMMIT;
