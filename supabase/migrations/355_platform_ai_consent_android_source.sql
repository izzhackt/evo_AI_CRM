-- ============================================================
-- 355_platform_ai_consent_android_source.sql
--
-- Согласие студента на ИИ-помощников из нового приложения на Expo (iPhone и Android, ADR 0038, 09.11.2026). Миграция 320
-- допускает источник решения только `portal_web` и `ios`; приложение на Android пишет решение с источником `android`.
-- Список источников расширяется до ('portal_web', 'ios', 'android'), больше ничего не меняется.
--
-- Что меняется (две вещи, обе проверяются до замены):
--   1. CHECK `student_ai_consents_source_check` таблицы `platform_private.student_ai_consents` пересоздаётся с тремя
--      источниками. Прежнее определение обязано быть ровно из `portal_web` и `ios`, иначе миграция падает.
--   2. Тело `platform.portal_ai_consent_set_v1(text,text,text,uuid)` меняется заменой одного проверенного фрагмента
--      (шаблон 350, 353): `p_source NOT IN ('portal_web', 'ios')` должен встретиться ровно один раз, рядом должен стоять
--      код отказа `ai_consent_invalid_source`, иначе миграция падает, ничего не меняя. CREATE OR REPLACE сохраняет
--      владельца, SECURITY DEFINER, пустой search_path и права (EXECUTE только у authenticated).
-- Данные не трогаются: прежние строки (`portal_web`, `ios`) остаются как есть. Остальные пути (чтение, запрет ИИ,
-- журнал, удаление аккаунта) источник не перечисляют и не меняются.
-- Forward-only: повтор отказывает a355_already_applied. Файл самодостаточен: при смене номера достаточно переименовать
-- его (в тексте номер только в префиксе a355).
-- ============================================================

BEGIN;

DO $a355$
DECLARE
  fn CONSTANT REGPROCEDURE := 'platform.portal_ai_consent_set_v1(text,text,text,uuid)'::REGPROCEDURE;
  definition TEXT;
  constraint_def TEXT;
  old_fragment CONSTANT TEXT := 'p_source NOT IN (''portal_web'', ''ios'')';
  new_fragment CONSTANT TEXT := 'p_source NOT IN (''portal_web'', ''ios'', ''android'')';
  fn_done BOOLEAN;
  constraint_done BOOLEAN;
BEGIN
  definition := pg_get_functiondef(fn);
  SELECT pg_get_constraintdef(c.oid) INTO constraint_def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'platform_private.student_ai_consents'::REGCLASS AND c.conname = 'student_ai_consents_source_check';
  IF constraint_def IS NULL THEN
    RAISE EXCEPTION 'a355_replace_drift: student_ai_consents_source_check is missing; review migration 355';
  END IF;

  fn_done := strpos(definition, new_fragment) > 0;
  constraint_done := strpos(constraint_def, '''android''') > 0;
  IF fn_done AND constraint_done THEN
    RAISE EXCEPTION 'a355_already_applied' USING ERRCODE = '55000';
  END IF;
  IF fn_done OR constraint_done THEN
    RAISE EXCEPTION 'a355_replace_drift: the source list is changed in only one of the constraint and the function; review migration 355';
  END IF;

  IF (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment) <> 1
     OR strpos(definition, 'ai_consent_invalid_source') = 0 THEN
    RAISE EXCEPTION 'a355_replace_drift: the source guard of portal_ai_consent_set_v1 changed; review migration 355';
  END IF;
  IF strpos(constraint_def, '''portal_web''') = 0 OR strpos(constraint_def, '''ios''') = 0
     OR (length(constraint_def) - length(replace(constraint_def, '''::text', ''))) / length('''::text') <> 2 THEN
    RAISE EXCEPTION 'a355_replace_drift: student_ai_consents_source_check is not exactly (portal_web, ios): %', constraint_def;
  END IF;

  ALTER TABLE platform_private.student_ai_consents DROP CONSTRAINT student_ai_consents_source_check;
  ALTER TABLE platform_private.student_ai_consents
    ADD CONSTRAINT student_ai_consents_source_check CHECK (source IN ('portal_web', 'ios', 'android'));

  EXECUTE replace(definition, old_fragment, new_fragment);
END
$a355$;

COMMIT;
