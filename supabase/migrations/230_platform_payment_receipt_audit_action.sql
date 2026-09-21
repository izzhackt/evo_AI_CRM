-- Keep receipt uploads within041's dotted audit-action grammar.
-- Patch only the two action literals in the canonical post229 metadata command.
-- Preserve the function identity, owner, ACL, locks, replay and financial effects.

BEGIN;

DO $migration$
DECLARE
  signature CONSTANT text := 'platform.record_payment_receipt_file_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)';
  old_anchor CONSTANT text := $old$'case.payment_receipt.upload'$old$;
  new_anchor CONSTANT text := $new$'case.payment.receipt.upload'$new$;
  target_oid oid;
  old_source text;
  new_source text;
  definition text;
  old_attributes jsonb;
  new_attributes jsonb;
BEGIN
  target_oid := signature::pg_catalog.regprocedure;
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT old_source, old_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF pg_catalog.md5(old_source) <> '0397f5faafb20d2261c8a1771e09ba5c' THEN
    RAISE EXCEPTION 'Unexpected canonical payment-receipt metadata body before audit-action repair';
  END IF;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  IF (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_anchor, '')))
       / pg_catalog.length(old_anchor) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two canonical payment-receipt audit actions';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_anchor, new_anchor);
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT new_source, new_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF new_source IS DISTINCT FROM pg_catalog.replace(old_source, old_anchor, new_anchor)
    OR pg_catalog.md5(new_source) <> 'b19d718260a563855a4151fca34b2cdb'
    OR new_attributes IS DISTINCT FROM old_attributes THEN
    RAISE EXCEPTION 'Payment-receipt audit-action repair changed unexpected body or attributes';
  END IF;
END
$migration$;

COMMIT;
