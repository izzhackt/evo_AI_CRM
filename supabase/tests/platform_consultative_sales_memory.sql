\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  begin_definition TEXT := pg_catalog.pg_get_functiondef(
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE
  );
BEGIN
  IF pg_catalog.strpos(begin_definition, 'p5f2-consultative-sales-v2') = 0
    OR pg_catalog.strpos(begin_definition, 'p5f2-gemini-proposal-v1') > 0
  THEN
    RAISE EXCEPTION 'consultative-sales-v2 begin policy was not installed';
  END IF;

  IF NOT platform_private.gemini_proposal_response_is_valid(
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'language', 'ru',
      'intent', 'admissions_discovery',
      'confidence', 90,
      'risk', 'low',
      'handoff_required', FALSE,
      'handoff_reasons', pg_catalog.jsonb_build_array(),
      'citations', pg_catalog.jsonb_build_array(),
      'memory_changes', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'fact_key', 'age',
          'action', 'set',
          'value', '17',
          'confidence', 90
        ),
        pg_catalog.jsonb_build_object(
          'fact_key', 'english_level',
          'action', 'set',
          'value', 'B1',
          'confidence', 85
        ),
        pg_catalog.jsonb_build_object(
          'fact_key', 'current_education',
          'action', 'set',
          'value', '11th grade',
          'confidence', 90
        ),
        pg_catalog.jsonb_build_object(
          'fact_key', 'countries_considered',
          'action', 'set',
          'value', 'Malaysia; China',
          'confidence', 80
        )
      ),
      'qualification', pg_catalog.jsonb_build_object(
        'status', 'collecting',
        'completeness', 40,
        'missing_fact_keys', pg_catalog.jsonb_build_array('budget_signal'),
        'notes', 'Continue qualification.'
      ),
      'reply_text', 'Спасибо! Подберём варианты с учётом ваших данных.'
    )
  ) THEN
    RAISE EXCEPTION 'new intake facts were rejected by the proposal validator';
  END IF;
END
$test$;

ROLLBACK;
