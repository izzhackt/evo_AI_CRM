-- ============================================================
-- 076_platform_consultative_sales_memory.sql
--
-- Extend the existing Platform-owned conversation memory with the facts
-- collected by EVO's opening intake and bind new Gemini proposals to the
-- consultative-sales-v2 prompt. Historical v1 proposal rows remain valid.
-- This migration grants no send, provider, amoCRM-write or autonomy authority.
-- ============================================================

BEGIN;

ALTER TYPE platform.ai_memory_fact_key
  ADD VALUE IF NOT EXISTS 'age' BEFORE 'preferred_country';
ALTER TYPE platform.ai_memory_fact_key
  ADD VALUE IF NOT EXISTS 'english_level' BEFORE 'preferred_country';
ALTER TYPE platform.ai_memory_fact_key
  ADD VALUE IF NOT EXISTS 'current_education' BEFORE 'preferred_country';
ALTER TYPE platform.ai_memory_fact_key
  ADD VALUE IF NOT EXISTS 'countries_considered' BEFORE 'preferred_country';

ALTER TABLE platform_private.gemini_proposal_requests
  DROP CONSTRAINT gemini_proposal_requests_prompt_policy_version_check;

ALTER TABLE platform_private.gemini_proposal_requests
  ADD CONSTRAINT gemini_proposal_requests_prompt_policy_version_check
  CHECK (
    prompt_policy_version IN (
      'p5f2-gemini-proposal-v1',
      'p5f2-consultative-sales-v2'
    )
  );

DO $migration$
DECLARE
  function_definition TEXT;
  updated_definition TEXT;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'platform_private.gemini_proposal_response_is_valid(jsonb)'::REGPROCEDURE
  )
  INTO function_definition;

  updated_definition := pg_catalog.replace(function_definition, '> 9', '> 13');
  updated_definition := pg_catalog.replace(
    updated_definition,
    $old$allowed_fact_keys CONSTANT TEXT[] := ARRAY[
    'preferred_country',$old$,
    $new$allowed_fact_keys CONSTANT TEXT[] := ARRAY[
    'age',
    'english_level',
    'current_education',
    'countries_considered',
    'preferred_country',$new$
  );

  IF updated_definition = function_definition
    OR pg_catalog.strpos(updated_definition, '''age''') = 0
    OR pg_catalog.strpos(updated_definition, '> 13') = 0
  THEN
    RAISE EXCEPTION 'Expected Gemini fact vocabulary and bounds were not found';
  END IF;

  EXECUTE updated_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'platform_private.ai_memory_missing_fact_keys_are_valid(platform.ai_memory_fact_key[])'::REGPROCEDURE
  )
  INTO function_definition;

  updated_definition := pg_catalog.replace(function_definition, '> 9', '> 13');

  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'Expected AI memory missing-facts bound was not found';
  END IF;

  EXECUTE updated_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE
  )
  INTO function_definition;

  updated_definition := pg_catalog.replace(
    function_definition,
    '''p5f2-gemini-proposal-v1''',
    '''p5f2-consultative-sales-v2'''
  );

  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'Expected Gemini prompt policy version was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;

COMMENT ON TYPE platform.ai_memory_fact_key IS
  'Versioned client facts, including EVO opening-intake context, proposed by AI and controlled through Platform staff review.';

COMMENT ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
) IS
  'Service-only idempotent proposal begin operation bound to the consultative-sales-v2 prompt; no send or autonomy authority.';

COMMIT;
