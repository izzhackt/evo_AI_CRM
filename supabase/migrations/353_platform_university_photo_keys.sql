-- ============================================================
-- 353_platform_university_photo_keys.sql
--
-- Фото новых карточек Малайзии (владелец, 07.11.2026, «сам исправь»). Проверка карточки допускает только ключи фото из
-- закрытого списка `value->>'photoKey' IN (...)` (151); он равен ключам src/lib/university-photo-library.json.
-- Добавляются ровно пять ключей новых записей библиотеки: um, iium, alfa, inti-subang, inti-penang. Остальная проверка
-- карточки не меняется.
--
-- Тело `platform_private.valid_university_content(jsonb)` меняется заменой одного проверенного фрагмента (шаблон 350):
-- список должен встретиться ровно один раз и содержать опорные ключи sunway и city-malaysia, иначе миграция падает,
-- ничего не меняя. CREATE OR REPLACE сохраняет владельца, STABLE, пустой search_path и права (клиентским ролям
-- функция недоступна). Данные не трогаются. Forward-only: повтор отказывает a353_already_applied.
-- Файл самодостаточен: при смене номера достаточно переименовать его (в тексте номер только в префиксе a353).
-- ============================================================

BEGIN;

DO $a353$
DECLARE
  definition TEXT;
  found TEXT[];
  old_list TEXT;
  new_keys CONSTANT TEXT[] := ARRAY['um', 'iium', 'alfa', 'inti-subang', 'inti-penang'];
  k TEXT;
  occurrences INTEGER;
BEGIN
  definition := pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure);
  occurrences := (SELECT count(*) FROM regexp_matches(definition, 'value->>''photoKey'' IN \(([^)]*)\)', 'g'));
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'a353_replace_drift: photoKey allow-list occurs % times in the university validator; review migration 353', occurrences;
  END IF;
  found := regexp_match(definition, 'value->>''photoKey'' IN \(([^)]*)\)');
  old_list := found[1];
  IF strpos(old_list, '''' || new_keys[1] || '''') > 0 THEN
    RAISE EXCEPTION 'a353_already_applied' USING ERRCODE = '55000';
  END IF;
  IF strpos(old_list, '''sunway''') = 0 OR strpos(old_list, '''city-malaysia''') = 0 THEN
    RAISE EXCEPTION 'a353_replace_drift: photoKey allow-list lost its anchor keys; review migration 353';
  END IF;
  FOREACH k IN ARRAY new_keys LOOP
    IF strpos(old_list, '''' || k || '''') > 0 THEN
      RAISE EXCEPTION 'a353_replace_drift: key % is already in the allow-list', k;
    END IF;
    old_list := old_list || ',''' || k || '''';
  END LOOP;
  EXECUTE replace(definition, found[1], old_list);
END
$a353$;

COMMIT;
