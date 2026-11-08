\set ON_ERROR_STOP on
-- Boundary suite for migration 353 «ключи фото новых карточек Малайзии». Runs on the real chain right after 353 inside
-- one transaction that is rolled back. Synthetic data only.
--
-- Proves: the five new keys are accepted by the card validator that stage_university_catalog_publication calls, the old keys still are, an unknown key and a near-miss key are refused, a null key is
-- still accepted, the rest of the validation still refuses, and the function keeps STABLE, an empty search_path and no
-- grant for any client role.
BEGIN;

\echo A353_UNIVERSITY_PHOTO_KEYS_SUITE_START

CREATE FUNCTION pg_temp.a353_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A353: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a353_card(p_photo TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'name', 'A353 Synthetic University', 'country', 'MY', 'city', 'Kuala Lumpur',
    'overview', 'Synthetic card for the photo key suite.',
    'websiteUrl', 'https://example-university.edu.my', 'sourceUrl', 'https://example-university.edu.my/programmes',
    'verifiedOn', '2026-11-08', 'notes', '', 'photoKey', to_jsonb(p_photo),
    'programs', jsonb_build_array(jsonb_build_object(
      'id', 'p1', 'title', 'Programme 1', 'level', 'bachelor',
      'duration', '1 год', 'language', NULL, 'summary', '', 'sourceUrl', 'https://example-university.edu.my/programmes/p1',
      'intakes', jsonb_build_array(jsonb_build_object(
        'label', 'Сентябрь', 'startDate', NULL, 'startMonth', NULL, 'applicationDeadline', NULL, 'deadlineTime', NULL,
        'timezone', NULL, 'status', 'needs_reconfirmation', 'note', '', 'sourceUrl', 'https://example-university.edu.my/programmes/p1',
        'verifiedOn', '2026-11-08')))))
$$;

SELECT pg_temp.a353_assert(platform_private.valid_university_content(pg_temp.a353_card(k)), 'new key ' || k || ' is accepted')
FROM unnest(ARRAY['um', 'iium', 'alfa', 'inti-subang', 'inti-penang']) AS k;
SELECT pg_temp.a353_assert(platform_private.valid_university_content(pg_temp.a353_card(k)), 'old key ' || k || ' is still accepted')
FROM unnest(ARRAY['sunway', 'taylors', 'inti', 'city-malaysia', 'apu']) AS k;
SELECT pg_temp.a353_assert(platform_private.valid_university_content(pg_temp.a353_card(NULL)), 'a null key is accepted');
SELECT pg_temp.a353_assert(NOT platform_private.valid_university_content(pg_temp.a353_card(k)), 'unknown key ' || k || ' is refused')
FROM unnest(ARRAY['inti-sabah', 'not-a-university', 'um ', 'UM', 'inti-subang2', '']) AS k;
SELECT pg_temp.a353_assert(NOT platform_private.valid_university_content(jsonb_set(pg_temp.a353_card('um'), '{programs,0,level}', '"phd"')),
  'the rest of the validation still refuses');

SELECT pg_temp.a353_assert(
  (SELECT p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
     FROM pg_proc p WHERE p.oid = 'platform_private.valid_university_content(jsonb)'::regprocedure),
  'the validator keeps STABLE and an empty search_path');
SELECT pg_temp.a353_assert(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(name)
    WHERE has_function_privilege(r.name, 'platform_private.valid_university_content(jsonb)'::regprocedure, 'EXECUTE')),
  'no client role may call the validator');
SELECT pg_temp.a353_assert(
  (SELECT count(*) FROM regexp_matches(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure),
     'value->>''photoKey'' IN \(', 'g')) = 1
  AND strpos(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure), 'BETWEEN 1 AND 300') > 0,
  'the allow-list is written once and migration 350 is intact');

\echo A353_UNIVERSITY_PHOTO_KEYS_SUITE_PASSED

ROLLBACK;
