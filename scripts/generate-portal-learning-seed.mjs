import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// PORT-4b: versioned learning/professions content -> immutable migration 199.
// Mirrors scripts/generate-student-assessment-seed.mjs: deterministic SQL,
// sha256-stamped sources, --check byte-for-byte drift mode, --write to
// regenerate the UNAPPLIED migration. Once 199 is applied, new content means
// a new version and a new forward migration -- never an edit here.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MODULE_FILE = "docs/design/portal/content/english-module-1-draft.json";
export const PROFESSIONS_FILE = "docs/design/portal/content/professions-draft.json";
export const CONTENT_FILES = [MODULE_FILE, PROFESSIONS_FILE];
export const SEED_PATH = resolve(root, "supabase/migrations/199_platform_learning_content_v1.sql");
export const CONTENT_VERSION = "1.0.0";
export const MODULE_KEY = "en-m1-start";
export const EXERCISE_TYPE_COUNTS = { choice: 70, matching: 10, short_answer: 13, reading: 6 };
export const REVIEW_SOURCE_LESSONS = { 2: 1, 3: 1, 4: 1, 6: 1, 7: 2, 8: 1, 9: 1, 10: 1, 11: 1 };
export const ORVIS_SCALE_IDS = [
  "leadership", "organization", "altruism", "creativity",
  "analysis", "production", "adventure", "erudition",
];

// Deterministic row ids: regeneration from unchanged sources is byte-stable.
export function contentUuid(kind, key) {
  const hash = createHash("sha256").update(`evo-learning-content-v1:${kind}:${key}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// The exact normalization the engine applies (migration 198,
// platform_private.normalize_learning_short_answer): apostrophes, spaces,
// case, trailing periods/commas.
export function normalizeShortAnswer(value) {
  return value
    .replaceAll(/[’‘ʻʼ]/gu, "'")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/[.,]+$/u, "")
    .trim();
}

function assertNonEmptyString(value, field) {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok(value.trim(), `${field} must not be blank`);
}

// Every *_ru user-visible string must have a paired non-blank *_ky and vice
// versa (KY is a full translation, not an abbreviation -- module notes).
function assertLanguagePairs(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLanguagePairs(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    for (const [suffix, twin] of [["_ru", "_ky"], ["_ky", "_ru"]]) {
      if (key.endsWith(suffix)) {
        const pairKey = key.slice(0, -suffix.length) + twin;
        assert.ok(Object.hasOwn(value, pairKey), `${path}.${key} must have a ${pairKey} pair`);
      }
    }
    assertLanguagePairs(child, `${path}.${key}`);
  }
}

function assertExactKeys(value, keys, path) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${path} keys`);
}

function assertPrompt(exercise, path) {
  if (Object.hasOwn(exercise, "prompt_en")) {
    assertNonEmptyString(exercise.prompt_en, `${path}.prompt_en`);
    assert.ok(!("prompt_ru" in exercise) && !("prompt_ky" in exercise),
      `${path} must not mix prompt_en with the RU/KY pair`);
  } else {
    assertNonEmptyString(exercise.prompt_ru, `${path}.prompt_ru`);
    assertNonEmptyString(exercise.prompt_ky, `${path}.prompt_ky`);
  }
}

function assertOptions(options, answerIndex, path) {
  assert.ok(Array.isArray(options) && options.length >= 2 && options.length <= 6, `${path}.options length`);
  assert.ok(Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < options.length,
    `${path}.answer_index`);
  assert.equal(new Set(options.map((option) => option.id)).size, options.length, `${path} option ids unique`);
  options.forEach((option, index) => {
    const optionPath = `${path}.options[${index}]`;
    assert.match(option.id, /^[a-z]$/u, `${optionPath}.id`);
    const labelKeys = Object.hasOwn(option, "label")
      ? ["id", "label", "explain_ru", "explain_ky"]
      : ["id", "label_ru", "label_ky", "explain_ru", "explain_ky"];
    assertExactKeys(option, labelKeys, optionPath);
    for (const key of labelKeys.slice(1)) assertNonEmptyString(option[key], `${optionPath}.${key}`);
    // The разбор convention (module notes): «Верно…» marks ONLY the correct
    // option, every distractor names its own mistake.
    const correct = index === answerIndex;
    assert.equal(option.explain_ru.startsWith("Верно"), correct, `${optionPath}.explain_ru verdict prefix`);
    assert.equal(option.explain_ru.startsWith("Неверно"), !correct, `${optionPath}.explain_ru mistake prefix`);
    assert.equal(option.explain_ky.startsWith("Туура эмес"), !correct, `${optionPath}.explain_ky mistake prefix`);
    assert.equal(option.explain_ky.startsWith("Туура") && !option.explain_ky.startsWith("Туура эмес"),
      correct, `${optionPath}.explain_ky verdict prefix`);
  });
}

const EXERCISE_BASE_KEYS = {
  choice: ["options", "answer_index"],
  matching: ["instruction_ru", "instruction_ky", "pairs", "explain_ru", "explain_ky"],
  short_answer: ["accepted", "explain_ru", "explain_ky"],
  reading: ["passage_en", "questions"],
};

function validateExercise(exercise, lessonOrder, path) {
  assert.ok(["choice", "matching", "short_answer", "reading"].includes(exercise.type), `${path}.type`);
  const allowed = new Set([
    "id", "type", "source_lesson", "prompt_en", "prompt_ru", "prompt_ky",
    ...EXERCISE_BASE_KEYS[exercise.type],
  ]);
  for (const key of Object.keys(exercise)) assert.ok(allowed.has(key), `${path}.${key} is not allowed`);
  for (const key of EXERCISE_BASE_KEYS[exercise.type]) {
    assert.ok(Object.hasOwn(exercise, key), `${path}.${key} is required`);
  }
  assert.match(exercise.id, /^[a-z0-9][a-z0-9-]{0,99}$/u, `${path}.id`);
  if (lessonOrder === 12) {
    assert.ok(Number.isInteger(exercise.source_lesson)
      && exercise.source_lesson >= 1 && exercise.source_lesson <= 11,
      `${path}.source_lesson is required in the review lesson`);
  } else {
    assert.ok(!("source_lesson" in exercise), `${path}.source_lesson belongs to the review lesson only`);
  }
  if (exercise.type === "choice") {
    assertPrompt(exercise, path);
    assertOptions(exercise.options, exercise.answer_index, path);
  } else if (exercise.type === "matching") {
    for (const key of ["instruction_ru", "instruction_ky", "explain_ru", "explain_ky"]) {
      assertNonEmptyString(exercise[key], `${path}.${key}`);
    }
    assert.ok(Array.isArray(exercise.pairs) && exercise.pairs.length >= 3 && exercise.pairs.length <= 8,
      `${path}.pairs length`);
    exercise.pairs.forEach((pair, index) => {
      assertExactKeys(pair, ["left_en", "right_ru", "right_ky"], `${path}.pairs[${index}]`);
      for (const key of Object.keys(pair)) assertNonEmptyString(pair[key], `${path}.pairs[${index}].${key}`);
    });
    assert.equal(new Set(exercise.pairs.map((pair) => pair.left_en)).size, exercise.pairs.length,
      `${path} lefts must be distinct`);
    assert.equal(new Set(exercise.pairs.map((pair) => pair.right_ru)).size, exercise.pairs.length,
      `${path} rights must be distinct`);
  } else if (exercise.type === "short_answer") {
    assertPrompt(exercise, path);
    assertNonEmptyString(exercise.explain_ru, `${path}.explain_ru`);
    assertNonEmptyString(exercise.explain_ky, `${path}.explain_ky`);
    assert.ok(Array.isArray(exercise.accepted) && exercise.accepted.length >= 1
      && exercise.accepted.length <= 12, `${path}.accepted length`);
    exercise.accepted.forEach((accepted, index) => {
      assertNonEmptyString(accepted, `${path}.accepted[${index}]`);
      assert.ok(normalizeShortAnswer(accepted), `${path}.accepted[${index}] must survive normalization`);
    });
  } else {
    assert.ok(!("prompt_en" in exercise) && !("prompt_ru" in exercise) && !("prompt_ky" in exercise),
      `${path} reading has no top-level prompt`);
    assertNonEmptyString(exercise.passage_en, `${path}.passage_en`);
    assert.ok(Array.isArray(exercise.questions) && exercise.questions.length >= 1
      && exercise.questions.length <= 5, `${path}.questions length`);
    assert.equal(new Set(exercise.questions.map((question) => question.id)).size,
      exercise.questions.length, `${path} question ids unique`);
    exercise.questions.forEach((question, index) => {
      const questionPath = `${path}.questions[${index}]`;
      assertExactKeys(question, ["id", "prompt_en", "options", "answer_index"], questionPath);
      assert.match(question.id, /^[a-z0-9][a-z0-9_-]{0,99}$/u, `${questionPath}.id`);
      assertNonEmptyString(question.prompt_en, `${questionPath}.prompt_en`);
      assertOptions(question.options, question.answer_index, questionPath);
    });
  }
}

export function validateModuleContent(draft) {
  assertExactKeys(draft, ["module", "editorial", "lessons"], "module draft");
  assert.equal(draft.module.id, MODULE_KEY);
  for (const key of ["title_ru", "title_ky", "level_note_ru", "level_note_ky"]) {
    assertNonEmptyString(draft.module[key], `module.${key}`);
  }
  assert.equal(draft.lessons.length, 12, "the start module carries 12 lessons");
  assert.deepEqual(draft.lessons.map((lesson) => lesson.order),
    Array.from({ length: 12 }, (_, index) => index + 1), "lesson order 1..12");
  assert.equal(new Set(draft.lessons.map((lesson) => lesson.id)).size, 12, "lesson ids unique");

  const typeCounts = { choice: 0, matching: 0, short_answer: 0, reading: 0 };
  const reviewSources = {};
  const exerciseIds = new Set();
  for (const lesson of draft.lessons) {
    const path = `lesson ${lesson.id}`;
    assert.match(lesson.id, /^[a-z0-9][a-z0-9-]{0,79}$/u, `${path}.id`);
    for (const key of ["title_ru", "title_ky", "goal_ru", "goal_ky"]) {
      assertNonEmptyString(lesson[key], `${path}.${key}`);
    }
    assert.ok(Array.isArray(lesson.theory) && lesson.theory.length >= 1 && lesson.theory.length <= 6,
      `${path}.theory length`);
    lesson.theory.forEach((block, index) => {
      assertExactKeys(block, ["text_ru", "text_ky", "examples"], `${path}.theory[${index}]`);
      assertNonEmptyString(block.text_ru, `${path}.theory[${index}].text_ru`);
      assertNonEmptyString(block.text_ky, `${path}.theory[${index}].text_ky`);
      assert.ok(Array.isArray(block.examples) && block.examples.length >= 1 && block.examples.length <= 8);
      block.examples.forEach((example, exampleIndex) => {
        assertExactKeys(example, ["en", "ru", "ky"], `${path}.theory[${index}].examples[${exampleIndex}]`);
        for (const key of Object.keys(example)) assertNonEmptyString(example[key], `${path} example ${key}`);
      });
    });
    const expected = lesson.order === 12 ? [10, 10] : [8, 10];
    assert.ok(lesson.exercises.length >= expected[0] && lesson.exercises.length <= expected[1],
      `${path} exercise count`);
    for (const exercise of lesson.exercises) {
      assert.ok(!exerciseIds.has(exercise.id), `duplicate exercise id ${exercise.id}`);
      exerciseIds.add(exercise.id);
      validateExercise(exercise, lesson.order, `${path} exercise ${exercise.id}`);
      typeCounts[exercise.type] += 1;
      if (lesson.order === 12) {
        reviewSources[exercise.source_lesson] = (reviewSources[exercise.source_lesson] ?? 0) + 1;
      }
    }
  }
  assert.deepEqual(typeCounts, EXERCISE_TYPE_COUNTS, "exercise type composition");
  assert.equal(exerciseIds.size, 99, "the start module carries 99 exercises");
  assert.deepEqual(
    Object.fromEntries(Object.entries(reviewSources).map(([key, value]) => [Number(key), value])),
    REVIEW_SOURCE_LESSONS,
    "review lesson source coverage");
  assertLanguagePairs(draft.lessons, "lessons");
  return draft;
}

const CARD_KEYS = [
  "id", "title_ru", "title_ky", "orvis_scales",
  "day_in_work_ru", "day_in_work_ky", "environment_ru", "environment_ky",
  "skills_ru", "skills_ky", "interesting_ru", "interesting_ky",
  "hard_ru", "hard_ky", "trial_task_ru", "trial_task_ky",
  "study_directions_ru", "study_directions_ky", "linked_program_refs", "sources",
];

export function validateProfessionCards(cards) {
  assert.ok(Array.isArray(cards), "professions draft must be an array");
  assert.equal(cards.length, 24, "the start set carries 24 profession cards");
  assert.equal(new Set(cards.map((card) => card.id)).size, 24, "card ids unique");
  const primaryCoverage = Object.fromEntries(ORVIS_SCALE_IDS.map((scale) => [scale, 0]));
  for (const card of cards) {
    const path = `card ${card.id}`;
    assertExactKeys(card, CARD_KEYS, path);
    assert.match(card.id, /^[a-z0-9][a-z0-9-]{0,79}$/u, `${path}.id`);
    for (const key of ["title_ru", "title_ky", "day_in_work_ru", "day_in_work_ky",
      "environment_ru", "environment_ky", "trial_task_ru", "trial_task_ky"]) {
      assertNonEmptyString(card[key], `${path}.${key}`);
    }
    assert.ok(Array.isArray(card.orvis_scales) && card.orvis_scales.length >= 1
      && card.orvis_scales.length <= 3, `${path}.orvis_scales length`);
    for (const scale of card.orvis_scales) {
      assert.ok(ORVIS_SCALE_IDS.includes(scale), `${path} unknown scale ${scale}`);
    }
    assert.equal(new Set(card.orvis_scales).size, card.orvis_scales.length, `${path} scales unique`);
    primaryCoverage[card.orvis_scales[0]] += 1;
    for (const pair of ["skills", "interesting", "hard", "study_directions"]) {
      const ru = card[`${pair}_ru`];
      const ky = card[`${pair}_ky`];
      assert.ok(Array.isArray(ru) && ru.length >= 1 && ru.length <= 12, `${path}.${pair}_ru length`);
      assert.equal(ru.length, ky.length, `${path}.${pair} RU/KY lists must align`);
      ru.forEach((item, index) => assertNonEmptyString(item, `${path}.${pair}_ru[${index}]`));
      ky.forEach((item, index) => assertNonEmptyString(item, `${path}.${pair}_ky[${index}]`));
    }
    assert.ok(Array.isArray(card.linked_program_refs) && card.linked_program_refs.length >= 1
      && card.linked_program_refs.length <= 8, `${path}.linked_program_refs length`);
    card.linked_program_refs.forEach((ref, index) => {
      assertExactKeys(ref, ["institution_photo_key", "program_hint"], `${path}.linked_program_refs[${index}]`);
      assertNonEmptyString(ref.institution_photo_key, `${path} ref photo key`);
      assertNonEmptyString(ref.program_hint, `${path} ref program hint`);
    });
    assert.ok(Array.isArray(card.sources) && card.sources.length >= 1 && card.sources.length <= 4,
      `${path}.sources length`);
    for (const source of card.sources) {
      assert.match(source, /^https:\/\/www\.onetonline\.org\/link\/summary\//u, `${path} source provenance`);
    }
    // No salary/employer fields without a reliable regional source (PORT-0).
    assert.ok(!("salary" in card) && !("employers" in card), `${path} must not carry salary/employers`);
  }
  for (const scale of ORVIS_SCALE_IDS) {
    assert.equal(primaryCoverage[scale], 3, `scale ${scale} must be primary for exactly 3 cards`);
  }
  assertLanguagePairs(cards, "cards");
  return cards;
}

export function loadLearningContent() {
  const [moduleRaw, professionsRaw] = CONTENT_FILES.map((name) =>
    readFileSync(resolve(root, name), "utf8"));
  return {
    module: { name: MODULE_FILE, raw: moduleRaw, content: validateModuleContent(JSON.parse(moduleRaw)) },
    professions: { name: PROFESSIONS_FILE, raw: professionsRaw, content: validateProfessionCards(JSON.parse(professionsRaw)) },
  };
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonbLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::JSONB`;
}

function exerciseBody(exercise) {
  const body = { ...exercise };
  delete body.id;
  delete body.type;
  return body;
}

export function generateSeed() {
  const { module: moduleSource, professions: professionsSource } = loadLearningContent();
  const draft = moduleSource.content;
  const moduleId = contentUuid("module", `${MODULE_KEY}@${CONTENT_VERSION}`);
  const statements = [];
  statements.push([
    "INSERT INTO platform_private.learning_modules (id, module_key, version, metadata)",
    `VALUES (${sqlString(moduleId)}, ${sqlString(MODULE_KEY)}, ${sqlString(CONTENT_VERSION)}, ${jsonbLiteral({
      title_ru: draft.module.title_ru,
      title_ky: draft.module.title_ky,
      level_note_ru: draft.module.level_note_ru,
      level_note_ky: draft.module.level_note_ky,
    })});`,
  ].join("\n"));
  for (const lesson of draft.lessons) {
    const lessonId = contentUuid("lesson", `${lesson.id}@${CONTENT_VERSION}`);
    statements.push([
      "INSERT INTO platform_private.learning_lessons (id, module_id, lesson_key, order_index, metadata, theory)",
      `VALUES (${sqlString(lessonId)}, ${sqlString(moduleId)}, ${sqlString(lesson.id)}, ${lesson.order}, ${jsonbLiteral({
        title_ru: lesson.title_ru,
        title_ky: lesson.title_ky,
        goal_ru: lesson.goal_ru,
        goal_ky: lesson.goal_ky,
      })}, ${jsonbLiteral(lesson.theory)});`,
    ].join("\n"));
    lesson.exercises.forEach((exercise, index) => {
      statements.push([
        "INSERT INTO platform_private.learning_exercises (id, lesson_id, exercise_key, order_index, exercise_type, body)",
        `VALUES (${sqlString(contentUuid("exercise", `${exercise.id}@${CONTENT_VERSION}`))}, ${sqlString(lessonId)}, ${sqlString(exercise.id)}, ${index + 1}, ${sqlString(exercise.type)}, ${jsonbLiteral(exerciseBody(exercise))});`,
      ].join("\n"));
    });
  }
  for (const card of professionsSource.content) {
    statements.push([
      "INSERT INTO platform_private.profession_cards (id, card_key, version, body)",
      `VALUES (${sqlString(contentUuid("profession", `${card.id}@${CONTENT_VERSION}`))}, ${sqlString(card.id)}, ${sqlString(CONTENT_VERSION)}, ${jsonbLiteral(card)});`,
    ].join("\n"));
  }
  const assertions = `DO $p199$
DECLARE
  seeded_module_id UUID;
  lessons_count INTEGER;
  exercises_count INTEGER;
  wrong_type_split INTEGER;
  cards_count INTEGER;
  uncovered_scales INTEGER;
BEGIN
  SELECT module.id INTO seeded_module_id FROM platform_private.learning_modules module
    WHERE module.module_key = ${sqlString(MODULE_KEY)} AND module.version = ${sqlString(CONTENT_VERSION)};
  IF seeded_module_id IS NULL THEN
    RAISE EXCEPTION 'P199 seed assertion failed: module row is missing';
  END IF;
  SELECT count(*) INTO lessons_count FROM platform_private.learning_lessons lesson
    WHERE lesson.module_id = seeded_module_id;
  IF lessons_count <> 12 THEN
    RAISE EXCEPTION 'P199 seed assertion failed: expected 12 lessons, found %', lessons_count;
  END IF;
  SELECT count(*), count(DISTINCT exercise.exercise_key) INTO exercises_count, wrong_type_split
    FROM platform_private.learning_exercises exercise
    JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
    WHERE lesson.module_id = seeded_module_id;
  IF exercises_count <> 99 OR wrong_type_split <> 99 THEN
    RAISE EXCEPTION 'P199 seed assertion failed: expected 99 unique exercises, found %/%',
      exercises_count, wrong_type_split;
  END IF;
  SELECT count(*) INTO wrong_type_split FROM (
    SELECT exercise.exercise_type, count(*) AS n
    FROM platform_private.learning_exercises exercise
    JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
    WHERE lesson.module_id = seeded_module_id
    GROUP BY exercise.exercise_type
  ) split
  WHERE (split.exercise_type, split.n) NOT IN (
    ('choice', ${EXERCISE_TYPE_COUNTS.choice}), ('matching', ${EXERCISE_TYPE_COUNTS.matching}),
    ('short_answer', ${EXERCISE_TYPE_COUNTS.short_answer}), ('reading', ${EXERCISE_TYPE_COUNTS.reading}));
  IF wrong_type_split <> 0 THEN
    RAISE EXCEPTION 'P199 seed assertion failed: exercise type composition drifted';
  END IF;
  SELECT count(*), count(DISTINCT card.card_key) INTO cards_count, wrong_type_split
    FROM platform_private.profession_cards card WHERE card.version = ${sqlString(CONTENT_VERSION)};
  IF cards_count <> 24 OR wrong_type_split <> 24 THEN
    RAISE EXCEPTION 'P199 seed assertion failed: expected 24 unique profession cards, found %/%',
      cards_count, wrong_type_split;
  END IF;
  SELECT count(*) INTO uncovered_scales FROM (
    SELECT scale.value AS scale_id, count(*) AS n
    FROM platform_private.profession_cards card
    CROSS JOIN LATERAL jsonb_array_elements_text(card.body -> 'orvis_scales') WITH ORDINALITY AS scale(value, ordinality)
    WHERE card.version = ${sqlString(CONTENT_VERSION)} AND scale.ordinality = 1
    GROUP BY scale.value
  ) primary_coverage
  WHERE primary_coverage.n <> 3;
  IF uncovered_scales <> 0 THEN
    RAISE EXCEPTION 'P199 seed assertion failed: every ORVIS scale must be primary for exactly 3 cards';
  END IF;
END $p199$;`;
  return [
    "-- PORT-4b: immutable v1 content for the learning engine (migration 198):",
    "-- «Английский. Модуль 1 — старт» (12 lessons, 99 exercises) and the 24",
    "-- profession cards, generated from the merged docs/design/portal/content",
    "-- drafts. Generated by scripts/generate-portal-learning-seed.mjs; do not",
    "-- edit SQL content by hand.",
    "-- Changes after application require a new content version and a new forward migration.",
    "-- Answer keys and explains live only in platform_private, behind the 198 RPC surface.",
    `-- ${MODULE_FILE} sha256: ${createHash("sha256").update(moduleSource.raw).digest("hex")}`,
    `-- ${PROFESSIONS_FILE} sha256: ${createHash("sha256").update(professionsSource.raw).digest("hex")}`,
    "BEGIN;",
    "SELECT 'P199_LEARNING_CONTENT_SEED_START' AS p199_marker;",
    ...statements,
    assertions,
    "SELECT 'P199_LEARNING_CONTENT_SEED_ASSERTED' AS p199_marker;",
    "COMMIT;",
  ].join("\n\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ["--check", "--write"].includes(args[0])),
    "Usage: node scripts/generate-portal-learning-seed.mjs [--check|--write]");
  const sql = generateSeed();
  if (args[0] === "--check") {
    assert.equal(readFileSync(SEED_PATH, "utf8"), sql, "Migration 199 differs from the versioned JSON sources");
    process.stdout.write("Learning content seed: exact match\n");
  } else if (args[0] === "--write") {
    writeFileSync(SEED_PATH, sql, "utf8");
    process.stdout.write("Generated migration 199 from checked content\n");
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
