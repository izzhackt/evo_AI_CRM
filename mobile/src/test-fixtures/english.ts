// Синтетические данные «Английского» (модуль, урок, попытки, банк ошибок) в форме строгих разборщиков веба
// (`src/lib/portal/learning.ts`). Тексты и идентификаторы придуманы, настоящего содержания курса здесь нет.
const pad = (n: number) => String(n).padStart(12, "0");
export const MODULE_ID = `aaaaaaaa-0000-4000-8000-${pad(1)}`;
export const lessonId = (n: number) => `bbbbbbbb-0000-4000-8000-${pad(n)}`;
export const exerciseId = (lesson: number, n: number) => `cccccccc-${String(lesson).padStart(4, "0")}-4000-8000-${pad(n)}`;
export const ATTEMPT_ID = `dddddddd-0000-4000-8000-${pad(1)}`;
export const NEW_ATTEMPT_ID = `dddddddd-0000-4000-8000-${pad(2)}`;
export const COMPLETED_AT = "2026-11-09T22:05:00+00:00";

export type LessonSpec = { n: number; key?: string; title?: string; exercises?: number; completed?: boolean; draft?: boolean; last?: { correct: number; total: number } | null };

const moduleMeta = { title_ru: "Модуль один", title_ky: "Биринчи модуль", level_note_ru: "Заметка об уровне (её на сайте нет)", level_note_ky: "Деңгээл жөнүндө эскертүү" };

function lastResult(last: { correct: number; total: number }) {
  return {
    exercisesTotal: last.total,
    correctCount: last.correct,
    correctShare: last.total ? last.correct / last.total : 0,
    wrongExerciseIds: Array.from({ length: last.total - last.correct }, (_, i) => exerciseId(0, 90 + i)),
    completedAt: COMPLETED_AT,
  };
}

export function lessonSummary(spec: LessonSpec) {
  return {
    lessonId: lessonId(spec.n),
    lessonKey: spec.key ?? `en-m1-l${String(spec.n).padStart(2, "0")}`,
    orderIndex: spec.n,
    metadata: { title_ru: spec.title ?? `Урок номер ${spec.n}`, title_ky: `${spec.n}-сабак (ky)`, goal_ru: `Цель урока ${spec.n}`, goal_ky: `${spec.n}-сабактын максаты` },
    exercisesTotal: spec.exercises ?? 8,
    completed: spec.completed ?? false,
    draftAttemptId: spec.draft ? ATTEMPT_ID : null,
    lastResult: spec.last ? lastResult(spec.last) : null,
  };
}

export function modulesFixture(lessons: LessonSpec[], extra: { moduleId?: string; key?: string; title?: string }[] = []) {
  const make = (id: string, key: string, title: string, list: LessonSpec[]) => ({
    moduleId: id,
    moduleKey: key,
    version: "1.0.0",
    metadata: { ...moduleMeta, title_ru: title },
    lessonsTotal: list.length,
    lessonsCompleted: list.filter((l) => l.completed).length,
    lessons: list.map(lessonSummary),
  });
  return { modules: [make(MODULE_ID, "en-m1", "Модуль один", lessons), ...extra.map((m, i) => make(m.moduleId ?? `aaaaaaaa-0000-4000-8000-${pad(i + 2)}`, m.key ?? `en-m${i + 2}`, m.title ?? `Модуль ${i + 2}`, [{ n: 100 + i, key: `en-m${i + 2}-l01` }]))] };
}

const choice = (lesson: number, n: number) => ({
  exerciseId: exerciseId(lesson, n),
  exerciseKey: `ex-${lesson}-${n}`,
  orderIndex: n,
  type: "choice" as const,
  promptEn: `Pick the right word ${n}.`,
  options: [
    { id: "a", label: `go ${n}` },
    { id: "b", label: `goes ${n}` },
    { id: "c", label: `going ${n}` },
  ],
});

export const matchingExercise = (lesson: number, n: number) => ({
  exerciseId: exerciseId(lesson, n),
  exerciseKey: `ex-${lesson}-${n}`,
  orderIndex: n,
  type: "matching" as const,
  instructionRu: "Соедините пары",
  instructionKy: "Жуптарды бириктириңиз",
  lefts: ["cat", "dog"],
  rights: [
    { rightRu: "кошка", rightKy: "мышык" },
    { rightRu: "собака", rightKy: "ит" },
  ],
});

export const explainChoice = (correct = "b") => ({
  correctOptionId: correct,
  options: [
    { id: "a", explainRu: "Почему «a»: разбор русский.", explainKy: "«a» эмне үчүн" },
    { id: "b", explainRu: "Почему «b»: разбор русский.", explainKy: "«b» эмне үчүн" },
    { id: "c", explainRu: "Почему «c»: разбор русский.", explainKy: "«c» эмне үчүн" },
  ],
});

export function attemptEntry(selected: string, correct: boolean, correctId = "b") {
  return { answer: { selected }, correct, verdict: { correct }, answeredAt: COMPLETED_AT, explain: explainChoice(correctId) };
}

export function attemptFixture(lesson: number, opts: { id?: string; status?: "draft" | "completed"; revision?: number; answers?: Record<string, ReturnType<typeof attemptEntry>>; total?: number; result?: { correct: number; total: number; wrong: string[] } | null } = {}) {
  const status = opts.status ?? "draft";
  const answers = opts.answers ?? {};
  const total = opts.total ?? 3;
  return {
    attemptId: opts.id ?? ATTEMPT_ID,
    lessonId: lessonId(lesson),
    status,
    revision: opts.revision ?? 1,
    answers,
    answeredCount: Object.keys(answers).length,
    exercisesTotal: total,
    result: status === "completed" ? { exercisesTotal: opts.result?.total ?? total, correctCount: opts.result?.correct ?? 0, correctShare: opts.result ? opts.result.correct / opts.result.total : 0, wrongExerciseIds: opts.result?.wrong ?? [], completedAt: COMPLETED_AT } : null,
    createdAt: "2026-11-09T09:00:00+00:00",
    updatedAt: COMPLETED_AT,
    completedAt: status === "completed" ? COMPLETED_AT : null,
  };
}

export function lessonView(spec: LessonSpec & { exercises?: number }, opts: { draft?: ReturnType<typeof attemptFixture> | null; latestCompleted?: ReturnType<typeof attemptFixture> | null; theory?: boolean; matching?: boolean } = {}) {
  const count = spec.exercises ?? 3;
  const exercises = Array.from({ length: count }, (_, i) => (opts.matching && i === 0 ? matchingExercise(spec.n, i + 1) : choice(spec.n, i + 1)));
  return {
    module: { moduleId: MODULE_ID, moduleKey: "en-m1", version: "1.0.0", metadata: moduleMeta },
    lesson: {
      lessonId: lessonId(spec.n),
      lessonKey: spec.key ?? `en-m1-l${String(spec.n).padStart(2, "0")}`,
      orderIndex: spec.n,
      metadata: { title_ru: spec.title ?? `Урок номер ${spec.n}`, title_ky: `${spec.n}-сабак (ky)`, goal_ru: `Цель урока ${spec.n}`, goal_ky: `${spec.n}-сабактын максаты` },
      theory: opts.theory === false ? [] : [{ text_ru: "Объяснение правила по-русски.", text_ky: "Эреже кыргызча", examples: [{ en: "I go to school.", ru: "Я хожу в школу.", ky: "Мен мектепке барам." }, { en: "She goes home.", ru: "Она идёт домой.", ky: "Ал үйгө барат." }] }],
      exercises,
    },
    draft: opts.draft ?? null,
    latestCompleted: opts.latestCompleted ?? null,
  };
}

export function saveResult(lesson: number, n: number, correct: boolean, revision = 2, answered = 1, total = 3) {
  return { attemptId: ATTEMPT_ID, revision, exerciseId: exerciseId(lesson, n), correct, verdict: { correct }, explain: explainChoice("b"), answeredCount: answered, exercisesTotal: total };
}

export function reviewItems(lesson: number, count: number) {
  return { items: Array.from({ length: count }, (_, i) => ({ ...choice(lesson, i + 1), lessonId: lessonId(lesson), lessonKey: `en-m1-l${String(lesson).padStart(2, "0")}`, lessonOrderIndex: lesson })) };
}
