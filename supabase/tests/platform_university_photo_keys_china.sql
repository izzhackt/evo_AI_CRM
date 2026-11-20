\set ON_ERROR_STOP on
-- Boundary suite for migration 365 «ключи фото новых карточек Китая» (срез C8). Runs on the real chain right after 365
-- inside one transaction that is rolled back. Synthetic data only.
--
-- Proves: all 94 new keys are accepted by the card validator that stage_university_catalog_publication calls, the
-- older keys (151, 353) still are, keys that left the slice and near misses are refused, a null key is still accepted,
-- the rest of the validation still refuses, the allow-list holds exactly the 243 library keys, and the function keeps
-- STABLE, an empty search_path and no grant for any client role.
BEGIN;

\echo A365_UNIVERSITY_PHOTO_KEYS_CHINA_SUITE_START

CREATE FUNCTION pg_temp.a365_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A365: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a365_card(p_photo TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'name', 'A365 Synthetic University', 'country', 'MY', 'city', 'Kuala Lumpur',
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

SELECT pg_temp.a365_assert(platform_private.valid_university_content(pg_temp.a365_card(k)), 'new key ' || k || ' is accepted')
FROM unnest(ARRAY[
  'anhui-jianzhu-university', 'anhui-normal-university', 'anhui-university', 'anhui-university-of-technology-campus',
  'beihang-university', 'beijing-foreign-studies-university', 'beijing-institute-of-fashion-technology',
  'beijing-institute-of-graphic-communication', 'beijing-wuzi-university', 'central-china-normal-university',
  'central-south-university-of-forestry-and-technology', 'changzhou-university', 'chengdu-university',
  'china-three-gorges-university', 'china-university-of-mining-and-technology',
  'china-university-of-petroleum-beijing', 'chongqing-jiaotong-university',
  'chongqing-technology-and-business-university', 'chongqing-university',
  'chongqing-university-of-posts-and-telecommunications', 'civil-aviation-university-of-china', 'dali-university',
  'dalian-polytechnic-university', 'dalian-university-of-technology', 'gannan-normal-university',
  'guangdong-polytechnic-normal-university', 'guangdong-university-of-finance-campus', 'guangxi-minzu-university',
  'guangzhou-university', 'guilin-university-of-electronic-technology', 'hainan-university-campus',
  'hangzhou-dianzi-university', 'harbin-institute-of-technology-shenzhen-campus', 'hebei-geo-university',
  'hebei-university', 'hebei-university-of-technology', 'henan-polytechnic-university', 'huai-an-university',
  'huangshan-university-campus', 'jiangsu-normal-university', 'jiangsu-ocean-university', 'jiangsu-university',
  'jiangsu-university-of-science-and-technology', 'jiangsu-university-of-technology',
  'jiangxi-university-of-science-and-technology', 'jiaxing-university', 'jilin-university-campus',
  'lanzhou-jiaotong-university', 'liaoning-petrochemical-university', 'linyi-university', 'lishui-university',
  'nanchang-hangkong-university', 'nanjing-tech-university',
  'nanjing-university-of-information-science-and-technology', 'nanjing-university-of-science-and-technology',
  'north-china-electric-power-university', 'northeast-petroleum-university', 'qiongtai-normal-university',
  'shandong-jianzhu-university', 'shandong-university', 'shandong-university-of-technology',
  'shanghai-business-school', 'shanghai-ocean-university', 'shanghai-polytechnic-university',
  'shanghai-university-of-engineering-science', 'shantou-university', 'shanxi-university', 'shaoxing-university',
  'shenyang-university-of-chemical-technology', 'shenyang-urban-construction-university', 'shenzhen-university',
  'sichuan-agricultural-university', 'south-central-minzu-university',
  'southwest-university-of-political-science-and-law', 'sun-yat-sen-university', 'taiyuan-university-of-technology',
  'taizhou-university', 'tianjin-chengjian-university', 'tianjin-foreign-studies-university',
  'university-of-science-and-technology-beijing', 'weifang-university', 'wenzhou-university',
  'wuchang-university-of-technology', 'wuhan-college', 'wuxi-university', 'xi-an-shiyou-university',
  'xi-an-technological-university', 'xi-an-university-of-architecture-and-technology', 'yangtze-normal-university',
  'yangtze-university', 'yanshan-university', 'yunnan-university', 'zaozhuang-university', 'zhengzhou-university'
]) AS k;
SELECT pg_temp.a365_assert(platform_private.valid_university_content(pg_temp.a365_card(k)), 'old key ' || k || ' is still accepted')
FROM unnest(ARRAY['sunway', 'um', 'inti-penang', 'harbin-institute-of-technology-shenzhen', 'harbin-institute-of-technology-hit', 'tsinghua-university']) AS k;
SELECT pg_temp.a365_assert(platform_private.valid_university_content(pg_temp.a365_card(NULL)), 'a null key is accepted');
-- Keys that left the slice (unreachable sources, oversized originals that moved to -campus keys) and near misses.
SELECT pg_temp.a365_assert(NOT platform_private.valid_university_content(pg_temp.a365_card(k)), 'key ' || k || ' is refused')
FROM unnest(ARRAY['shenyang-agricultural-university', 'southwest-petroleum-university', 'guangdong-university-of-finance',
  'jilin-university', 'zhengzhou-university ', 'ZHENGZHOU-UNIVERSITY', 'harbin-institute-of-technology-shenzhen-campus2', '']) AS k;
SELECT pg_temp.a365_assert(NOT platform_private.valid_university_content(jsonb_set(pg_temp.a365_card('zhengzhou-university'), '{programs,0,level}', '"phd"')),
  'the rest of the validation still refuses');

SELECT pg_temp.a365_assert(
  (SELECT count(*) FROM regexp_matches(
     (regexp_match(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure), 'value->>''photoKey'' IN \(([^)]*)\)'))[1],
     '''[a-z0-9-]+''', 'g')) = 243,
  'the allow-list holds exactly the 243 library keys');
SELECT pg_temp.a365_assert(
  (SELECT p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
     FROM pg_proc p WHERE p.oid = 'platform_private.valid_university_content(jsonb)'::regprocedure),
  'the validator keeps STABLE and an empty search_path');
SELECT pg_temp.a365_assert(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(name)
    WHERE has_function_privilege(r.name, 'platform_private.valid_university_content(jsonb)'::regprocedure, 'EXECUTE')),
  'no client role may call the validator');
SELECT pg_temp.a365_assert(
  (SELECT count(*) FROM regexp_matches(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure),
     'value->>''photoKey'' IN \(', 'g')) = 1
  AND strpos(pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure), 'BETWEEN 1 AND 300') > 0,
  'the allow-list is written once and migration 350 is intact');

\echo A365_UNIVERSITY_PHOTO_KEYS_CHINA_SUITE_PASSED

ROLLBACK;
