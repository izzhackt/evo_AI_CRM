import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  contentUuid,
  PROFESSIONS_FILE,
  validateProfessionCards,
} from "./generate-portal-learning-seed.mjs";

// «Профессии» 1.1.0 (10.11.2026): the 24 cards of 199 plus a one-line summary
// and the school subjects, as a new immutable content version in the forward
// migration 359. 199 and its draft stay untouched; the additions live in their
// own file. Same convention as 199: deterministic SQL, sha256-stamped sources,
// --check for drift, --write only while 359 is unapplied.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ADDITIONS_FILE = "docs/design/portal/content/professions-v1.1-additions.json";
export const MIGRATION_PATH = resolve(root, "supabase/migrations/359_platform_profession_cards_v1_1.sql");
export const CONTENT_VERSION = "1.1.0";
const ADDITION_KEYS = ["id", "summary_ru", "summary_ky", "school_subjects_ru", "school_subjects_ky"];

function oneLine(value, path) {
  assert.equal(typeof value, "string", `${path} must be a string`);
  assert.ok(value.trim() === value && value.length >= 20 && value.length <= 200, `${path} length`);
  assert.ok(!/[\u0000-\u001f]/u.test(value), `${path} must be one line`);
}

export function validateAdditions(additions, cards) {
  assert.ok(Array.isArray(additions), "additions must be an array");
  assert.deepEqual(additions.map((item) => item.id), cards.map((card) => card.id),
    "additions must cover every 199 card in the same order");
  for (const item of additions) {
    const path = `additions ${item.id}`;
    assert.deepEqual(Object.keys(item).sort(), [...ADDITION_KEYS].sort(), `${path} keys`);
    oneLine(item.summary_ru, `${path}.summary_ru`);
    oneLine(item.summary_ky, `${path}.summary_ky`);
    const ru = item.school_subjects_ru;
    const ky = item.school_subjects_ky;
    assert.ok(Array.isArray(ru) && ru.length >= 1 && ru.length <= 8, `${path}.school_subjects_ru length`);
    assert.ok(Array.isArray(ky) && ky.length === ru.length, `${path} RU/KY subjects must align`);
    for (const subject of [...ru, ...ky]) {
      assert.ok(typeof subject === "string" && subject.trim() === subject && subject.length >= 2
        && subject.length <= 60 && !/[\u0000-\u001f]/u.test(subject), `${path} subject «${subject}»`);
    }
  }
  return additions;
}

export function loadCardsV11() {
  const professionsRaw = readFileSync(resolve(root, PROFESSIONS_FILE), "utf8");
  const additionsRaw = readFileSync(resolve(root, ADDITIONS_FILE), "utf8");
  const cards = validateProfessionCards(JSON.parse(professionsRaw));
  const additions = validateAdditions(JSON.parse(additionsRaw), cards);
  return {
    professionsRaw,
    additionsRaw,
    cards: cards.map((card, index) => {
      const extra = { ...additions[index] };
      delete extra.id;
      return { ...card, ...extra };
    }),
  };
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonbLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::JSONB`;
}

const VALIDATOR = String.raw`-- Валидатор принимает обе формы карточки: 20 полей версии 1.0.0 и 24 поля
-- с 1.1.0 (одна строка о работе + школьные предметы, парные RU/KY).
CREATE OR REPLACE FUNCTION platform_private.validate_profession_card()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  body JSONB := NEW.body;
  pair TEXT;
  key_count INTEGER := (SELECT count(*) FROM jsonb_object_keys(NEW.body));
BEGIN
  IF octet_length(body::TEXT) > 65536
    OR key_count NOT IN (20, 24)
    OR NOT (body ?& ARRAY['id', 'title_ru', 'title_ky', 'orvis_scales',
      'day_in_work_ru', 'day_in_work_ky', 'environment_ru', 'environment_ky',
      'skills_ru', 'skills_ky', 'interesting_ru', 'interesting_ky',
      'hard_ru', 'hard_ky', 'trial_task_ru', 'trial_task_ky',
      'study_directions_ru', 'study_directions_ky', 'linked_program_refs', 'sources'])
    OR (key_count = 24 AND NOT (body ?& ARRAY['summary_ru', 'summary_ky',
      'school_subjects_ru', 'school_subjects_ky']))
    OR body ->> 'id' IS DISTINCT FROM NEW.card_key
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['title_ru', 'title_ky', 'day_in_work_ru',
      'day_in_work_ky', 'environment_ru', 'environment_ky', 'trial_task_ru', 'trial_task_ky']) field
      WHERE NOT platform_private.learning_text_ok(body -> field))
    OR (key_count = 24 AND EXISTS (SELECT 1 FROM unnest(ARRAY['summary_ru', 'summary_ky']) field
      WHERE NOT platform_private.learning_text_ok(body -> field)
        OR char_length(body ->> field) > 200))
  THEN
    RAISE EXCEPTION 'Invalid profession card content' USING ERRCODE = '22023';
  END IF;
  -- Шкалы ORVIS: 1..3, только 8 известных id, без повторов (первая — основная).
  IF jsonb_typeof(body -> 'orvis_scales') <> 'array'
    OR jsonb_array_length(body -> 'orvis_scales') NOT BETWEEN 1 AND 3
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(body -> 'orvis_scales') scale
      WHERE scale NOT IN ('leadership', 'organization', 'altruism', 'creativity',
        'analysis', 'production', 'adventure', 'erudition'))
    OR (SELECT count(DISTINCT scale) FROM jsonb_array_elements_text(body -> 'orvis_scales') scale)
      <> jsonb_array_length(body -> 'orvis_scales')
  THEN
    RAISE EXCEPTION 'Invalid profession card scales' USING ERRCODE = '22023';
  END IF;
  -- Парные RU/KY-списки одинаковой длины, непустые строки (KY — не сокращение RU).
  FOREACH pair IN ARRAY (CASE WHEN key_count = 24
    THEN ARRAY['skills', 'interesting', 'hard', 'study_directions', 'school_subjects']
    ELSE ARRAY['skills', 'interesting', 'hard', 'study_directions'] END)
  LOOP
    IF jsonb_typeof(body -> (pair || '_ru')) <> 'array'
      OR jsonb_typeof(body -> (pair || '_ky')) <> 'array'
      OR jsonb_array_length(body -> (pair || '_ru')) NOT BETWEEN 1 AND 12
      OR jsonb_array_length(body -> (pair || '_ru'))
        <> jsonb_array_length(body -> (pair || '_ky'))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> (pair || '_ru')) item
        WHERE NOT platform_private.learning_text_ok(item))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> (pair || '_ky')) item
        WHERE NOT platform_private.learning_text_ok(item))
    THEN
      RAISE EXCEPTION 'Invalid profession card lists' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(body -> 'linked_program_refs') <> 'array'
    OR jsonb_array_length(body -> 'linked_program_refs') NOT BETWEEN 1 AND 8
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(body -> 'linked_program_refs') ref
      WHERE jsonb_typeof(ref) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(ref)) <> 2
        OR NOT (ref ?& ARRAY['institution_photo_key', 'program_hint'])
        OR NOT platform_private.learning_text_ok(ref -> 'institution_photo_key')
        OR NOT platform_private.learning_text_ok(ref -> 'program_hint'))
    OR jsonb_typeof(body -> 'sources') <> 'array'
    OR jsonb_array_length(body -> 'sources') NOT BETWEEN 1 AND 4
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(body -> 'sources') source
      WHERE source !~ '^https://')
  THEN
    RAISE EXCEPTION 'Invalid profession card references' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;`;

const LIST_RPC = String.raw`-- Список отдаёт и строку о работе (null у карточек 1.0.0): сетка показывает
-- её под названием, без чтения каждой карточки.
CREATE OR REPLACE FUNCTION platform.profession_cards_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; cards JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.require_learning_actor_read();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cardId', card.id, 'cardKey', card.card_key, 'version', card.version,
    'titleRu', card.body -> 'title_ru', 'titleKy', card.body -> 'title_ky',
    'orvisScales', card.body -> 'orvis_scales',
    'summaryRu', card.body -> 'summary_ru', 'summaryKy', card.body -> 'summary_ky'
  ) ORDER BY card.body ->> 'title_ru', card.card_key), '[]'::JSONB) INTO cards
  FROM (SELECT DISTINCT ON (card_key) * FROM platform_private.profession_cards
    ORDER BY card_key, published_at DESC, id DESC) card;
  RETURN jsonb_build_object('cards', cards);
END $$;`;

export function generateMigration() {
  const { professionsRaw, additionsRaw, cards } = loadCardsV11();
  const inserts = cards.map((card) => [
    "INSERT INTO platform_private.profession_cards (id, card_key, version, body)",
    `VALUES (${sqlString(contentUuid("profession", `${card.id}@${CONTENT_VERSION}`))}, ${sqlString(card.id)}, ${sqlString(CONTENT_VERSION)}, ${jsonbLiteral(card)});`,
  ].join("\n"));
  const assertions = `DO $p359$
DECLARE cards_count INTEGER; distinct_keys INTEGER; latest_old INTEGER;
BEGIN
  SELECT count(*), count(DISTINCT card.card_key) INTO cards_count, distinct_keys
    FROM platform_private.profession_cards card
    WHERE card.version = ${sqlString(CONTENT_VERSION)}
      AND (SELECT count(*) FROM jsonb_object_keys(card.body)) = 24;
  IF cards_count <> 24 OR distinct_keys <> 24 THEN
    RAISE EXCEPTION 'P359 assertion failed: expected 24 unique 1.1.0 cards, found %/%',
      cards_count, distinct_keys;
  END IF;
  SELECT count(*) INTO latest_old FROM (
    SELECT DISTINCT ON (card_key) version FROM platform_private.profession_cards
    WHERE card_key IN (SELECT card_key FROM platform_private.profession_cards
      WHERE version = ${sqlString(CONTENT_VERSION)})
    ORDER BY card_key, published_at DESC, id DESC
  ) latest WHERE latest.version <> ${sqlString(CONTENT_VERSION)};
  IF latest_old <> 0 THEN
    RAISE EXCEPTION 'P359 assertion failed: 1.1.0 must be the latest version of every card';
  END IF;
END $p359$;`;
  return [
    "-- «Профессии» 1.1.0 (10.11.2026): строка о работе и школьные предметы для 24",
    "-- карточек 199. Карточки неизменяемы, поэтому это новая версия, а не правка:",
    "-- 1.0.0 остаётся (старые ссылки на cardId открываются), список берёт последнюю.",
    "-- Generated by scripts/import/generate-profession-cards-v1-1.mjs; do not edit",
    "-- SQL content by hand.",
    `-- ${PROFESSIONS_FILE} sha256: ${createHash("sha256").update(professionsRaw).digest("hex")}`,
    `-- ${ADDITIONS_FILE} sha256: ${createHash("sha256").update(additionsRaw).digest("hex")}`,
    "BEGIN;",
    "SELECT 'P359_PROFESSION_CARDS_V1_1_START' AS p359_marker;",
    VALIDATOR,
    LIST_RPC,
    ...inserts,
    assertions,
    "SELECT 'P359_PROFESSION_CARDS_V1_1_ASSERTED' AS p359_marker;",
    "COMMIT;",
  ].join("\n\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ["--check", "--write"].includes(args[0])),
    "Usage: node scripts/import/generate-profession-cards-v1-1.mjs [--check|--write]");
  const sql = generateMigration();
  if (args[0] === "--check") {
    assert.equal(readFileSync(MIGRATION_PATH, "utf8"), sql, "Migration 359 differs from the versioned JSON sources");
    process.stdout.write("Profession cards 1.1.0: exact match\n");
  } else if (args[0] === "--write") {
    writeFileSync(MIGRATION_PATH, sql, "utf8");
    process.stdout.write("Generated migration 359 from checked content\n");
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
