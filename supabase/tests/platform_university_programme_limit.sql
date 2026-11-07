\set ON_ERROR_STOP on
-- Boundary suite for migration 352 «предел программ в карточке 30 -> 300». Runs on the real chain right after 352
-- inside one transaction that is rolled back. Synthetic data only.
--
-- Proves: a card with 1, 30, 31 and 300 programmes is accepted; 0 and 301 are refused; the rest of the validation
-- still refuses (duplicate programme id, unknown level, bad URL); the function keeps STABLE, an empty search_path
-- and no grant for any client role.
BEGIN;

\echo A352_UNIVERSITY_PROGRAMME_LIMIT_SUITE_START

CREATE FUNCTION pg_temp.a352_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A352: %', message; END IF;
END
$$;
-- A synthetic card with p_count programmes ids p1..pN.
CREATE FUNCTION pg_temp.a352_card(p_count INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'name', 'A352 Synthetic University', 'country', 'MY', 'city', 'Kuala Lumpur',
    'overview', 'Synthetic card for the programme limit suite.',
    'websiteUrl', 'https://example-university.edu.my', 'sourceUrl', 'https://example-university.edu.my/programmes',
    'verifiedOn', '2026-11-08', 'notes', '', 'photoKey', NULL,
    'programs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', 'p' || n, 'title', 'Programme ' || n, 'level', CASE WHEN n % 2 = 0 THEN 'bachelor' ELSE 'foundation' END,
        'duration', '1 год', 'language', NULL, 'summary', '', 'sourceUrl', 'https://example-university.edu.my/programmes/p' || n,
        'intakes', jsonb_build_array(jsonb_build_object(
          'label', 'Сентябрь', 'startDate', NULL, 'startMonth', NULL, 'applicationDeadline', NULL, 'deadlineTime', NULL,
          'timezone', NULL, 'status', 'needs_reconfirmation', 'note', '', 'sourceUrl', 'https://example-university.edu.my/programmes/p' || n,
          'verifiedOn', '2026-11-08'))) ORDER BY n) FROM generate_series(1, p_count) AS n), '[]'::JSONB))
$$;

SELECT pg_temp.a352_assert(platform_private.valid_university_content(pg_temp.a352_card(1)), 'one programme is accepted');
SELECT pg_temp.a352_assert(platform_private.valid_university_content(pg_temp.a352_card(30)), '30 programmes are accepted');
SELECT pg_temp.a352_assert(platform_private.valid_university_content(pg_temp.a352_card(31)), '31 programmes are accepted (was refused before 352)');
SELECT pg_temp.a352_assert(platform_private.valid_university_content(pg_temp.a352_card(300)), '300 programmes are accepted');
SELECT pg_temp.a352_assert(NOT platform_private.valid_university_content(pg_temp.a352_card(0)), 'no programme is refused');
SELECT pg_temp.a352_assert(NOT platform_private.valid_university_content(pg_temp.a352_card(301)), '301 programmes are refused');

-- The rest of the validation is unchanged.
SELECT pg_temp.a352_assert(NOT platform_private.valid_university_content(jsonb_set(pg_temp.a352_card(40), '{programs,5,id}', '"p1"')),
  'a duplicate programme id is refused');
SELECT pg_temp.a352_assert(NOT platform_private.valid_university_content(jsonb_set(pg_temp.a352_card(40), '{programs,5,level}', '"phd"')),
  'an unknown level is refused');
SELECT pg_temp.a352_assert(NOT platform_private.valid_university_content(jsonb_set(pg_temp.a352_card(40), '{programs,5,sourceUrl}', '"http://example-university.edu.my/x"')),
  'a non-https programme source is refused');
SELECT pg_temp.a352_assert(platform_private.valid_university_content(jsonb_set(pg_temp.a352_card(40), '{programs,5,level}', '"language"')),
  'the language level is still accepted');

-- The function keeps its shape.
SELECT pg_temp.a352_assert(
  (SELECT p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
     FROM pg_proc p WHERE p.oid = 'platform_private.valid_university_content(jsonb)'::regprocedure),
  'the validator keeps STABLE and an empty search_path');
SELECT pg_temp.a352_assert(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(name)
    WHERE has_function_privilege(r.name, 'platform_private.valid_university_content(jsonb)'::regprocedure, 'EXECUTE')),
  'no client role may call the validator');
SELECT pg_temp.a352_assert(
  (length(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure))
    - length(replace(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure), 'BETWEEN 1 AND 300', ''))) / length('BETWEEN 1 AND 300') = 1
  AND strpos(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure), 'NOT BETWEEN 1 AND 30 THEN') = 0,
  'the limit is written once');

\echo A352_UNIVERSITY_PROGRAMME_LIMIT_SUITE_PASSED

ROLLBACK;
