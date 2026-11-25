// Сессия урока английского (G54, G55): «Начать урок» открывает попытку сразу (замороженный запрос), ответ идёт в уже открытую
// попытку, итог берётся из ответа сервера, повтор и перечитывание. Сеть поддельная, данные синтетические.
import { parseLearningLessonView } from "@web/lib/portal/learning";

import { EnglishSession } from "@/features/learning/english/english-session";
import { ATTEMPT_ID, NEW_ATTEMPT_ID, attemptEntry, attemptFixture, exerciseId, lessonView, saveResult } from "@/test-fixtures/english";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const START = "start_learning_lesson_v1";
const SAVE = "save_learning_answer_v1";
const COMPLETE = "complete_learning_lesson_v1";
const READ = "learning_lesson_v1";

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const view = (opts: Parameters<typeof lessonView>[1] = {}) => parseLearningLessonView(lessonView({ n: 1 }, opts));
function session(handlers: Record<string, unknown>, opts: Parameters<typeof lessonView>[1] = {}) {
  const parsed = view(opts);
  const fake = fakeTransport(handlers);
  return { ...fake, session: new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, parsed.draft, parsed.latestCompleted, newId) };
}
const nameOf = (calls: { name: string }[]) => calls.map((c) => c.name);

describe("урок: «Начать урок» открывает попытку", () => {
  it("попытка создаётся сразу, второй вызов её не создаёт; первый ответ идёт в уже открытую попытку", async () => {
    const { session: s, calls } = session({ [START]: attemptFixture(1), [SAVE]: saveResult(1, 1, true) });
    await expect(s.begin()).resolves.toBe(true);
    expect(s.getState().attemptId).toBe(ATTEMPT_ID);
    expect(s.getState().revision).toBe(1);
    await expect(s.begin()).resolves.toBe(true);
    await s.answer({ selected: "b" });
    expect(nameOf(calls)).toEqual([START, SAVE]);
    expect(calls[1].args).toMatchObject({ p_attempt_id: ATTEMPT_ID, p_expected_revision: 1, p_exercise_id: exerciseId(1, 1), p_answer: { selected: "b" } });
    expect(s.getState().answers[exerciseId(1, 1)]).toMatchObject({ correct: true });
  });

  it("обрыв при старте: ошибка, повтор идёт тем же p_request_id", async () => {
    let n = 0;
    const { session: s, calls } = session({ [START]: () => (++n <= 3 ? failure(null, 0) : attemptFixture(1)) });
    await expect(s.begin()).resolves.toBe(false);
    expect(s.getState().error).toBe("unavailable");
    await expect(s.begin()).resolves.toBe(true);
    expect(s.getState().error).toBeNull();
    expect(new Set(calls.map((c) => c.args?.p_request_id)).size).toBe(1);
  });

  it("если попытки нет и «Начать урок» не нажимали, первый ответ создаёт её, как раньше", async () => {
    const { session: s, calls } = session({ [START]: attemptFixture(1), [SAVE]: saveResult(1, 1, false) });
    await s.answer({ selected: "a" });
    expect(nameOf(calls)).toEqual([START, SAVE]);
  });

  it("черновик из чтения: попытка уже есть, «Начать» ничего не шлёт; открывается на первом неотвеченном", async () => {
    const draft = attemptFixture(1, { answers: { [exerciseId(1, 1)]: attemptEntry("b", true), [exerciseId(1, 2)]: attemptEntry("a", false) } });
    const { session: s, calls } = session({}, { draft });
    expect(s.getState().attemptId).toBe(ATTEMPT_ID);
    expect(s.getState().index).toBe(2);
    expect(s.getState().completed).toBe(false);
    await expect(s.begin()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("урок: итог", () => {
  it("«Завершить» берёт счёт и номера заданий с ошибками из ответа сервера", async () => {
    const wrong = [exerciseId(1, 2)];
    const done = attemptFixture(1, { status: "completed", result: { correct: 2, total: 3, wrong } });
    const draft = attemptFixture(1, { answers: { [exerciseId(1, 1)]: attemptEntry("b", true), [exerciseId(1, 2)]: attemptEntry("a", false), [exerciseId(1, 3)]: attemptEntry("b", true) } });
    const { session: s } = session({ [COMPLETE]: done }, { draft });
    await s.finish();
    expect(s.getState().completed).toBe(true);
    expect(s.getState().result).toMatchObject({ correctCount: 2, exercisesTotal: 3, wrongExerciseIds: wrong });
    expect(s.getState().attemptId).toBeNull();
  });

  it("пройденный урок открывается сразу на итоге с результатом последней попытки", () => {
    const latest = attemptFixture(1, { id: NEW_ATTEMPT_ID, status: "completed", result: { correct: 3, total: 3, wrong: [] }, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
    const { session: s } = session({}, { latestCompleted: latest });
    expect(s.getState().completed).toBe(true);
    expect(s.getState().result).toMatchObject({ correctCount: 3, wrongExerciseIds: [] });
    expect(s.getState().attemptId).toBeNull();
  });

  it("«Пройти ещё раз»: итог и ответы сброшены, новый старт идёт новым запросом", async () => {
    const latest = attemptFixture(1, { status: "completed", result: { correct: 1, total: 3, wrong: [exerciseId(1, 2)] }, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
    const { session: s, calls } = session({ [START]: attemptFixture(1, { id: NEW_ATTEMPT_ID }) }, { latestCompleted: latest });
    s.restart();
    expect(s.getState()).toMatchObject({ completed: false, result: null, answers: {}, index: 0, attemptId: null });
    await s.begin();
    expect(s.getState().attemptId).toBe(NEW_ATTEMPT_ID);
    expect(nameOf(calls)).toEqual([START]);
  });

  it("конфликт ревизии: перечитывание берёт итог пройденного урока", async () => {
    const latest = attemptFixture(1, { status: "completed", result: { correct: 3, total: 3, wrong: [] }, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
    const draft = attemptFixture(1, { answers: {} });
    const { session: s } = session({ [READ]: lessonView({ n: 1 }, { latestCompleted: latest }) }, { draft });
    await s.reload();
    expect(s.getState().completed).toBe(true);
    expect(s.getState().result).toMatchObject({ correctCount: 3 });
  });
});
