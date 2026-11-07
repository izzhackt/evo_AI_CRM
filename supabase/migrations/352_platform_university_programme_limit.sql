-- ============================================================
-- 352_platform_university_programme_limit.sql
--
-- Каталог «Университеты → Малайзия» (владелец, 07.11.2026: «все существующие программы, включая foundation»).
-- Карточка вуза держит не больше 30 программ (148), а у UTM, UM и IIUM по официальным спискам 186-270 программ.
-- Предел растёт до 300; всё остальное в проверке карточки (поля, уровни, ссылки, наборы, идентичность) не меняется.
--
-- Тело `platform_private.valid_university_content(jsonb)` меняется заменой одного проверенного фрагмента (шаблон 211,
-- 347): фрагмент обязан встретиться ровно один раз, иначе миграция падает, ничего не меняя. CREATE OR REPLACE
-- сохраняет владельца, STABLE, пустой search_path и права (на функцию их нет ни у одной клиентской роли).
-- Данные не трогаются: опубликованные карточки не меняются, CHECK таблицы публикаций применяется к новым записям.
-- Forward-only: повтор отказывает a352_already_applied.
-- ============================================================

BEGIN;

DO $a352$
DECLARE
  definition TEXT;
  old_fragment CONSTANT TEXT := 'IF jsonb_array_length(value->''programs'') NOT BETWEEN 1 AND 30 THEN RETURN FALSE; END IF;';
  new_fragment CONSTANT TEXT := 'IF jsonb_array_length(value->''programs'') NOT BETWEEN 1 AND 300 THEN RETURN FALSE; END IF;';
BEGIN
  definition := pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure);
  IF strpos(definition, new_fragment) > 0 THEN
    RAISE EXCEPTION 'a352_already_applied' USING ERRCODE = '55000';
  END IF;
  IF (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment) <> 1 THEN
    RAISE EXCEPTION 'a352_replace_drift: university validator programme limit changed; review migration 352';
  END IF;
  EXECUTE replace(definition, old_fragment, new_fragment);
END
$a352$;

COMMIT;
