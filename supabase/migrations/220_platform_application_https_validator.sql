-- Forward repair for the HTTPS validator exercised by219.
-- PostgreSQL regexp repetition bounds stop at255; preserve the intended
-- 1..1990-character HTTPS suffix using an explicit length check.
BEGIN;

CREATE OR REPLACE FUNCTION platform_private.application_partner_detail_fields(p_fields JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB:='{}'::JSONB; key TEXT; value TEXT;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR pg_column_size(p_fields)>20000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
      ('partner_contact','external_link','decision_reference','decision_note')) THEN
    RAISE EXCEPTION 'application_partner_details_invalid_fields' USING ERRCODE='22023'; END IF;
  FOREACH key IN ARRAY ARRAY['partner_contact','external_link','decision_reference','decision_note'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'application_partner_details_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>(CASE key WHEN 'partner_contact' THEN 300 WHEN 'decision_reference' THEN 300 ELSE 2000 END)
      OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'application_partner_details_invalid_text' USING ERRCODE='22023'; END IF;
    IF key='external_link' AND value<>'' AND
      (length(value) NOT BETWEEN 9 AND 1998 OR value !~ '^https://[^\s<>"]+$') THEN
      RAISE EXCEPTION 'application_partner_details_invalid_link' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  RETURN result;
END $$;

COMMIT;
