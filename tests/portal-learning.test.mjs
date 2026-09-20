import assert from "node:assert/strict";
import test from "node:test";

import {
  firstUnansweredIndex,
  parseLearningAnswerInput,
  parseLearningAttempt,
  parseLearningLessonView,
  parseLearningModules,
  parseLearningReview,
  parseLearningSaveResult,
  LearningParseError,
} from "../src/lib/portal/learning.ts";

const LESSON_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const EXERCISE_ID = "44444444-4444-4444-8444-444444444444";
const DATE = "2026-09-19T12:00:00+00:00";

const moduleMeta = {
  title_ru: "Модуль", title_ky: "Модуль KY",
  level_note_ru: "С нуля", level_note_ky: "Нөлдөн",
};
const lessonMeta = {
  title_ru: "Урок", title_ky: "Сабак", goal_ru: "Цель", goal_ky: "Максат",
};
const result = {
  exercisesTotal: 4, correctCount: 2, correctShare: 0.5,
  wrongExerciseIds: [EXERCISE_ID], completedAt: DATE,
};

// Проекция choice-упражнения В ТОМ ВИДЕ, в котором её мог бы прислать
// скомпрометированный транспорт: с «протёкшими» приватными полями. Парсер
// обязан их отбросить — на клиент они не проходят даже при ошибке сервера.
const leakyChoice = {
  exerciseId: EXERCISE_ID, exerciseKey: "en-m1-l01-e01", orderIndex: 1,
  type: "choice",
  promptRu: "Выберите.", promptKy: "Тандаңыз.",
  options: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }],
  answer_index: 1,
  explains: { a: "private" },
  answerKey: "b",
};

const matching = {
  exerciseId: EXERCISE_ID, exerciseKey: "en-m1-l01-e02", orderIndex: 2,
  type: "matching",
  instructionRu: "Соедините.", instructionKy: "Дал келтириңиз.",
  lefts: ["one", "two", "three"],
  rights: [
    { rightRu: "три", rightKy: "үч" },
    { rightRu: "один", rightKy: "бир" },
    { rightRu: "два", rightKy: "эки" },
  ],
};

const view = {
  module: { moduleId: MODULE_ID, moduleKey: "en-m1-start", version: "1.0.0", metadata: moduleMeta },
  lesson: {
    lessonId: LESSON_ID, lessonKey: "en-m1-l01", orderIndex: 1, metadata: lessonMeta,
    theory: [{
      text_ru: "Теория", text_ky: "Теория KY",
      examples: [{ en: "Hello", ru: "Привет", ky: "Салам" }],
    }],
    exercises: [leakyChoice, matching],
  },
  draft: {
    attemptId: ATTEMPT_ID, lessonId: LESSON_ID, status: "draft", revision: 2,
    answers: {
      [EXERCISE_ID]: {
        answer: { selected: "a" }, correct: false,
        verdict: { correct: false },
        answeredAt: DATE,
        explain: {
          correctOptionId: "b",
          options: [
            { id: "a", explainRu: "Неверно: причина.", explainKy: "Туура эмес: себеби." },
            { id: "b", explainRu: "Верно: правило.", explainKy: "Туура: эреже." },
          ],
        },
      },
    },
    answeredCount: 1, exercisesTotal: 2, result: null,
    createdAt: DATE, updatedAt: DATE, completedAt: null,
  },
  latestCompleted: null,
};

test("lesson projection parses strictly and drops any leaked private keys", () => {
  const parsed = parseLearningLessonView(view);
  assert.equal(parsed.lesson.exercises.length, 2);
  const serialized = JSON.stringify(parsed.lesson.exercises);
  assert.doesNotMatch(serialized, /answer_index|answerKey|"explains"/u);
  assert.deepEqual(parsed.lesson.exercises[1].lefts, ["one", "two", "three"]);
  assert.equal(parsed.draft?.answeredCount, 1);
  // Разбор присутствует ТОЛЬКО у отвеченного упражнения.
  assert.equal(Object.keys(parsed.draft?.answers ?? {}).length, 1);
  assert.equal(parsed.draft?.answers[EXERCISE_ID]?.explain.correctOptionId, "b");
});

test("attempt/status/result consistency is enforced", () => {
  assert.throws(
    () => parseLearningAttempt({ ...view.draft, status: "completed" }),
    LearningParseError,
  );
  const completed = {
    ...view.draft, status: "completed", result, completedAt: DATE,
  };
  assert.equal(parseLearningAttempt(completed).result?.correctShare, 0.5);
});

test("module map parses own progress and rejects a malformed share", () => {
  const modules = {
    modules: [{
      moduleId: MODULE_ID, moduleKey: "en-m1-start", version: "1.0.0", metadata: moduleMeta,
      lessonsTotal: 12, lessonsCompleted: 1,
      lessons: [{
        lessonId: LESSON_ID, lessonKey: "en-m1-l01", orderIndex: 1, metadata: lessonMeta,
        exercisesTotal: 8, completed: true, draftAttemptId: null, lastResult: result,
      }],
    }],
  };
  assert.equal(parseLearningModules(modules)[0].lessons[0].lastResult?.correctCount, 2);
  assert.throws(() => parseLearningModules({
    modules: [{
      ...modules.modules[0],
      lessons: [{
        ...modules.modules[0].lessons[0],
        lastResult: { ...result, correctShare: 1.5 },
      }],
    }],
  }), LearningParseError);
});

test("save result carries the verdict and разбор of the answered exercise", () => {
  const save = parseLearningSaveResult({
    attemptId: ATTEMPT_ID, revision: 3, exerciseId: EXERCISE_ID,
    correct: true,
    verdict: { correct: true, perPair: [true, true, true], correctCount: 3, total: 3 },
    explain: {
      pairs: [{ leftEn: "one", rightRu: "один", rightKy: "бир" }],
      explainRu: "Разбор.", explainKy: "Разбор KY.",
    },
    answeredCount: 2, exercisesTotal: 2,
  });
  assert.equal(save.verdict.correctCount, 3);
  assert.equal(save.explain.pairs?.length, 1);
});

test("review items are safe projections with lesson anchors", () => {
  const parsed = parseLearningReview({
    items: [{ ...leakyChoice, lessonId: LESSON_ID, lessonKey: "en-m1-l01", lessonOrderIndex: 1 }],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].lessonOrderIndex, 1);
  assert.doesNotMatch(JSON.stringify(parsed), /answer_index|answerKey/u);
});

test("answer input validation is exact per exercise type", () => {
  assert.deepEqual(parseLearningAnswerInput("choice", { selected: "a" }), { selected: "a" });
  assert.equal(parseLearningAnswerInput("choice", { selected: "a", extra: 1 }), null);
  assert.deepEqual(parseLearningAnswerInput("matching", { matches: [2, 0, 1] }), { matches: [2, 0, 1] });
  assert.equal(parseLearningAnswerInput("matching", { matches: [0, 0, 1] }), null);
  assert.equal(parseLearningAnswerInput("matching", { matches: [0, 1, 5] }), null);
  assert.deepEqual(parseLearningAnswerInput("short_answer", { text: "I'm Aidana" }), { text: "I'm Aidana" });
  assert.equal(parseLearningAnswerInput("short_answer", { text: "  " }), null);
  assert.equal(parseLearningAnswerInput("short_answer", { text: "x".repeat(301) }), null);
  assert.deepEqual(
    parseLearningAnswerInput("reading", { selected: { q1: "a", q2: "b" } }),
    { selected: { q1: "a", q2: "b" } },
  );
  assert.equal(parseLearningAnswerInput("reading", { selected: {} }), null);
  assert.equal(parseLearningAnswerInput("reading", { selected: { q1: 5 } }), null);
});

test("draft resume points to the first unanswered exercise", () => {
  const exercises = [{ exerciseId: MODULE_ID }, { exerciseId: EXERCISE_ID }, { exerciseId: ATTEMPT_ID }];
  assert.equal(firstUnansweredIndex(exercises, {}), 0);
  assert.equal(firstUnansweredIndex(exercises, { [MODULE_ID]: {} }), 1);
  assert.equal(
    firstUnansweredIndex(exercises, {
      [MODULE_ID]: {}, [EXERCISE_ID]: {}, [ATTEMPT_ID]: {},
    }),
    3,
  );
});
