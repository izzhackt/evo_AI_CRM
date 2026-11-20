-- ============================================================
-- 365_platform_university_photo_keys_china.sql
--
-- Фото новых карточек Китая (срез C8 плана docs/catalog/china-2026-11-plan.md, запись 2026-11-20 «Китай: фото 118 новых
-- вузов» в docs/PLAN_CHANGES.md). Проверка карточки допускает только ключи фото из закрытого списка
-- `value->>'photoKey' IN (...)` (151, 353); он равен ключам src/lib/university-photo-library.json. Добавляются ровно
-- 90 ключей новых записей библиотеки (ключ фото равен ключу карточки). Ключ harbin-institute-of-technology-shenzhen
-- уже есть в списке и библиотеке и не добавляется. Остальная проверка карточки не меняется.
--
-- Тело `platform_private.valid_university_content(jsonb)` меняется заменой одного проверенного фрагмента (шаблон 353):
-- список должен встретиться ровно один раз и содержать опорные ключи sunway, city-malaysia и inti-penang (353), иначе
-- миграция падает, ничего не меняя. CREATE OR REPLACE сохраняет владельца, STABLE, пустой search_path и права (клиентским
-- ролям функция недоступна). Данные не трогаются. Forward-only: повтор отказывает a365_already_applied.
-- Файл самодостаточен: при смене номера достаточно переименовать его (в тексте номер только в префиксе a365).
-- ============================================================

BEGIN;

DO $a365$
DECLARE
  definition TEXT;
  found TEXT[];
  old_list TEXT;
  new_keys CONSTANT TEXT[] := ARRAY['anhui-jianzhu-university', 'anhui-normal-university', 'anhui-university', 'anhui-university-of-technology', 'beihang-university', 'beijing-foreign-studies-university', 'beijing-institute-of-fashion-technology', 'beijing-institute-of-graphic-communication', 'beijing-wuzi-university', 'central-china-normal-university', 'central-south-university-of-forestry-and-technology', 'changzhou-university', 'chengdu-university', 'china-three-gorges-university', 'china-university-of-mining-and-technology', 'china-university-of-petroleum-beijing', 'chongqing-jiaotong-university', 'chongqing-technology-and-business-university', 'chongqing-university', 'chongqing-university-of-posts-and-telecommunications', 'civil-aviation-university-of-china', 'dali-university', 'dalian-polytechnic-university', 'dalian-university-of-technology', 'gannan-normal-university', 'guangdong-polytechnic-normal-university', 'guangdong-university-of-finance', 'guangxi-minzu-university', 'guangzhou-university', 'guilin-university-of-electronic-technology', 'hainan-university', 'hangzhou-dianzi-university', 'hebei-geo-university', 'hebei-university', 'hebei-university-of-technology', 'henan-polytechnic-university', 'huai-an-university', 'huangshan-university', 'jiangsu-normal-university', 'jiangsu-ocean-university', 'jiangsu-university', 'jiangsu-university-of-science-and-technology', 'jiangsu-university-of-technology', 'jiangxi-university-of-science-and-technology', 'jiaxing-university', 'jilin-university', 'lanzhou-jiaotong-university', 'liaoning-petrochemical-university', 'linyi-university', 'lishui-university', 'nanchang-hangkong-university', 'nanjing-tech-university', 'nanjing-university-of-information-science-and-technology', 'nanjing-university-of-science-and-technology', 'north-china-electric-power-university', 'northeast-petroleum-university', 'qiongtai-normal-university', 'shandong-jianzhu-university', 'shandong-university', 'shandong-university-of-technology', 'shanghai-business-school', 'shanghai-ocean-university', 'shanghai-polytechnic-university', 'shanghai-university-of-engineering-science', 'shantou-university', 'shanxi-university', 'shaoxing-university', 'shenyang-agricultural-university', 'shenyang-university-of-chemical-technology', 'shenyang-urban-construction-university', 'shenzhen-university', 'sichuan-agricultural-university', 'south-central-minzu-university', 'southwest-university-of-political-science-and-law', 'sun-yat-sen-university', 'taiyuan-university-of-technology', 'taizhou-university', 'tianjin-chengjian-university', 'tianjin-foreign-studies-university', 'university-of-science-and-technology-beijing', 'wenzhou-university', 'wuchang-university-of-technology', 'wuhan-college', 'wuxi-university', 'xi-an-shiyou-university', 'xi-an-university-of-architecture-and-technology', 'yangtze-university', 'yanshan-university', 'yunnan-university', 'zaozhuang-university'];
  k TEXT;
  occurrences INTEGER;
BEGIN
  definition := pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure);
  occurrences := (SELECT count(*) FROM regexp_matches(definition, 'value->>''photoKey'' IN \(([^)]*)\)', 'g'));
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'a365_replace_drift: photoKey allow-list occurs % times in the university validator; review migration 365', occurrences;
  END IF;
  found := regexp_match(definition, 'value->>''photoKey'' IN \(([^)]*)\)');
  old_list := found[1];
  IF strpos(old_list, '''' || new_keys[1] || '''') > 0 THEN
    RAISE EXCEPTION 'a365_already_applied' USING ERRCODE = '55000';
  END IF;
  IF strpos(old_list, '''sunway''') = 0 OR strpos(old_list, '''city-malaysia''') = 0 OR strpos(old_list, '''inti-penang''') = 0 THEN
    RAISE EXCEPTION 'a365_replace_drift: photoKey allow-list lost its anchor keys; review migration 365';
  END IF;
  FOREACH k IN ARRAY new_keys LOOP
    IF strpos(old_list, '''' || k || '''') > 0 THEN
      RAISE EXCEPTION 'a365_replace_drift: key % is already in the allow-list', k;
    END IF;
    old_list := old_list || ',''' || k || '''';
  END LOOP;
  EXECUTE replace(definition, found[1], old_list);
END
$a365$;

COMMIT;
