import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXERCISE_TYPE_COUNTS,
  MODULE_KEY,
  ORVIS_SCALE_IDS,
  REVIEW_SOURCE_LESSONS,
  SEED_PATH,
  generateSeed,
  loadLearningContent,
  normalizeShortAnswer,
} from "./generate-portal-learning-seed.mjs";

const { module: moduleSource, professions: professionsSource } = loadLearningContent();
const draft = moduleSource.content;
const cards = professionsSource.content;

test("the start module carries the PORT-0 composition with the review lesson map", () => {
  assert.equal(draft.module.id, MODULE_KEY);
  assert.equal(draft.lessons.length, 12);
  const exercises = draft.lessons.flatMap((lesson) => lesson.exercises);
  assert.equal(exercises.length, 99);
  for (const [type, expected] of Object.entries(EXERCISE_TYPE_COUNTS)) {
    assert.equal(exercises.filter((exercise) => exercise.type === type).length, expected, type);
  }
  const review = draft.lessons.find((lesson) => lesson.order === 12);
  assert.equal(review.exercises.length, 10);
  const sources = {};
  for (const exercise of review.exercises) {
    sources[exercise.source_lesson] = (sources[exercise.source_lesson] ?? 0) + 1;
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(sources).map(([key, value]) => [Number(key), value])),
    REVIEW_SOURCE_LESSONS);
  // Нет CEFR-меток в пользовательских строках (решение PORT-0).
  const userVisible = JSON.stringify({ module: draft.module, lessons: draft.lessons });
  assert.doesNotMatch(userVisible, /CEFR|IELTS|\bA0\b|\bA1\b/u);
});

test("every accepted short answer survives the exact engine normalization", () => {
  for (const lesson of draft.lessons) {
    for (const exercise of lesson.exercises) {
      if (exercise.type !== "short_answer") continue;
      for (const accepted of exercise.accepted) {
        assert.ok(normalizeShortAnswer(accepted), `${exercise.id}: ${accepted}`);
      }
      // Апострофные формы канонизируются: типографский вариант ученика
      // обязан совпасть с ASCII-формой из accepted.
      for (const accepted of exercise.accepted) {
        assert.equal(
          normalizeShortAnswer(accepted.replaceAll("'", "’")),
          normalizeShortAnswer(accepted),
          `${exercise.id}: apostrophe normalization`);
      }
    }
  }
});

test("profession cards cover all eight scales, keep provenance and no salary fields", () => {
  assert.equal(cards.length, 24);
  for (const scale of ORVIS_SCALE_IDS) {
    assert.equal(cards.filter((card) => card.orvis_scales[0] === scale).length, 3, scale);
  }
  for (const card of cards) {
    assert.ok(card.linked_program_refs.length >= 1, card.id);
    for (const source of card.sources) {
      assert.match(source, /^https:\/\/www\.onetonline\.org\/link\/summary\//u);
    }
    assert.ok(!("salary" in card) && !("employers" in card), card.id);
  }
});

test("generated seed exactly matches committed artifact and inserts only private content", () => {
  const sql = generateSeed();
  assert.equal(readFileSync(SEED_PATH, "utf8"), sql);
  assert.equal((sql.match(/INSERT INTO platform_private\.learning_modules/g) ?? []).length, 1);
  assert.equal((sql.match(/INSERT INTO platform_private\.learning_lessons/g) ?? []).length, 12);
  assert.equal((sql.match(/INSERT INTO platform_private\.learning_exercises/g) ?? []).length, 99);
  assert.equal((sql.match(/INSERT INTO platform_private\.profession_cards/g) ?? []).length, 24);
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE platform|DELETE FROM|INSERT INTO auth\.|INSERT INTO platform\./);
  assert.match(sql, /P199_LEARNING_CONTENT_SEED_START/);
  assert.match(sql, /P199_LEARNING_CONTENT_SEED_ASSERTED/);
  assert.ok(sql.endsWith("COMMIT;\n"));
  assert.ok(!sql.endsWith("\n\n"));
});
