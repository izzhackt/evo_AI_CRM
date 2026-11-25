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
/** Первые три попытки (одна отправка с повторами) обрываются, дальше сервер отвечает `reply`: так одна досылка при закрытии проходит. */
const down = (name: string, reply: unknown) => {
  let n = 0;
  return { [name]: (args: Record<string, unknown> | undefined) => (++n <= 3 ? failure(null, 0) : typeof reply === "function" ? (reply as (a: unknown) => unknown)(args) : reply) };
};
/** Ответы поддельной сети приходят цепочкой обещаний без таймеров: двадцати проходов с запасом хватает, чтобы все ожидания закончились. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

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

describe("урок: идентификаторы запросов и ответ старта (ревью #1567)", () => {
  const one = (extra: Parameters<typeof lessonView>[1] = {}) => parseLearningLessonView(lessonView({ n: 1, exercises: 1 }, extra));
  const single = (handlers: Record<string, unknown>, extra: Parameters<typeof lessonView>[1] = {}) => {
    const parsed = one(extra);
    const fake = fakeTransport(handlers);
    return { ...fake, session: new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, parsed.draft, parsed.latestCompleted, newId) };
  };
  const done = (id: string) => attemptFixture(1, { id, status: "completed", total: 1, result: { correct: 1, total: 1, wrong: [] }, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
  const answerOne = saveResult(1, 1, true, 2, 1, 1);

  it("«Пройти ещё раз»: старт и завершение новой попытки идут с НОВЫМИ p_request_id (иначе сервер вернул бы квитанцию старой)", async () => {
    const { session: s, calls } = single({
      [START]: (_args: unknown, call: number) => (call === 1 ? attemptFixture(1, { total: 1 }) : attemptFixture(1, { id: NEW_ATTEMPT_ID, total: 1 })),
      [SAVE]: answerOne,
      [COMPLETE]: (_args: unknown, call: number) => (call === 1 ? done(ATTEMPT_ID) : done(NEW_ATTEMPT_ID)),
    });
    await s.begin();
    await s.answer({ selected: "b" });
    await expect(s.finish()).resolves.toBe(true);
    s.restart();
    await s.begin();
    expect(s.getState().attemptId).toBe(NEW_ATTEMPT_ID);
    await s.answer({ selected: "b" });
    await expect(s.finish()).resolves.toBe(true);
    const starts = calls.filter((c) => c.name === START).map((c) => c.args?.p_request_id);
    const completes = calls.filter((c) => c.name === COMPLETE).map((c) => c.args?.p_request_id);
    expect(starts).toHaveLength(2);
    expect(new Set(starts).size).toBe(2);
    expect(completes).toHaveLength(2);
    expect(new Set(completes).size).toBe(2);
    // Ответ второй попытки идёт в неё, а не в первую.
    const saves = calls.filter((c) => c.name === SAVE);
    expect(saves[1].args).toMatchObject({ p_attempt_id: NEW_ATTEMPT_ID });
  });

  it("«Пройти ещё раз» после неподтверждённого завершения: замороженный запрос завершения забыт, новая попытка завершается новым p_request_id", async () => {
    let tries = 0;
    const { session: s, calls } = single(
      {
        [COMPLETE]: () => (++tries <= 3 ? failure(null, 0) : done(NEW_ATTEMPT_ID)),
        [START]: attemptFixture(1, { id: NEW_ATTEMPT_ID, total: 1 }),
        [SAVE]: answerOne,
      },
      { draft: attemptFixture(1, { total: 1, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } }) },
    );
    await expect(s.finish()).resolves.toBe(false); // запрос завершения заморожен, подтверждения нет
    const frozen = calls.filter((c) => c.name === COMPLETE)[0].args?.p_request_id;
    s.restart();
    await s.begin();
    await s.answer({ selected: "b" });
    await expect(s.finish()).resolves.toBe(true);
    const last = calls.filter((c) => c.name === COMPLETE).at(-1);
    expect(last?.args?.p_request_id).not.toBe(frozen);
    expect(last?.args).toMatchObject({ p_attempt_id: NEW_ATTEMPT_ID });
  });

  it("двойное нажатие «Начать урок» шлёт один запрос старта, оба вызова получают один исход", async () => {
    const { session: s, calls } = single({ [START]: attemptFixture(1, { total: 1 }) });
    await expect(Promise.all([s.begin(), s.begin()])).resolves.toEqual([true, true]);
    expect(calls.filter((c) => c.name === START)).toHaveLength(1);
    expect(s.getState().attemptId).toBe(ATTEMPT_ID);
    expect(s.getState().busy).toBe(false);
  });

  it("старт возвращает уже начатый на другом устройстве черновик: ответы и первое неотвеченное задание берутся из него, как на сайте", async () => {
    const parsed = parseLearningLessonView(lessonView({ n: 1 }));
    const started = attemptFixture(1, { revision: 4, answers: { [exerciseId(1, 1)]: attemptEntry("b", true), [exerciseId(1, 2)]: attemptEntry("a", false) } });
    const fake = fakeTransport({ [START]: started });
    const s = new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, null, null, newId);
    await expect(s.begin()).resolves.toBe(true);
    expect(s.getState()).toMatchObject({ attemptId: ATTEMPT_ID, revision: 4, index: 2, completed: false });
    expect(Object.keys(s.getState().answers)).toEqual([exerciseId(1, 1), exerciseId(1, 2)]);
  });

  it("первый ответ без «Начать урок»: если задание уже отвечено в найденном черновике, второй ответ не шлётся (иначе отказ «уже отвечено»)", async () => {
    const parsed = parseLearningLessonView(lessonView({ n: 1 }));
    const started = attemptFixture(1, { revision: 3, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
    const fake = fakeTransport({ [START]: started, [SAVE]: saveResult(1, 1, true) });
    const s = new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, null, null, newId);
    await s.answer({ selected: "a" });
    expect(nameOf(fake.calls)).toEqual([START]);
    expect(s.getState().index).toBe(1);
    expect(s.getState().answers[exerciseId(1, 1)]).toMatchObject({ correct: true });
    expect(s.getState().error).toBeNull();
  });

  it("«Завершить»: true при успехе; при обрыве false, тот же p_request_id при повторе; конфликт сбрасывает запрос, повтор идёт новым id", async () => {
    let n = 0;
    const { session: s, calls } = single(
      { [COMPLETE]: () => (++n <= 3 ? failure(null, 0) : n === 4 ? failure("40001", 409) : done(ATTEMPT_ID)) },
      { draft: attemptFixture(1, { total: 1, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } }) },
    );
    await expect(s.finish()).resolves.toBe(false); // обрыв: три попытки слоя RPC, один id
    expect(s.getState().error).toBe("unavailable");
    await expect(s.finish()).resolves.toBe(false); // тот же замороженный запрос, теперь конфликт
    expect(s.getState().error).toBe("conflict");
    await expect(s.finish()).resolves.toBe(true); // после конфликта запрос новый
    const ids = calls.filter((c) => c.name === COMPLETE).map((c) => c.args?.p_request_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids.slice(0, 4)).size).toBe(1);
    expect(ids[4]).not.toBe(ids[0]);
    expect(s.getState().completed).toBe(true);
  });
});

describe("урок: закрытие экрана досылает неподтверждённое один раз (замена запирающего выхода)", () => {
  const draft = () => attemptFixture(1, { total: 3 });

  it("ответ отправлен, подтверждения нет: при закрытии один повтор того же замороженного запроса; второе закрытие ничего не шлёт", async () => {
    const { session: s, calls } = session(down(SAVE, saveResult(1, 1, true)), { draft: draft() });
    await s.answer({ selected: "b" });
    expect(s.getState().error).toBe("unavailable");
    const before = calls.filter((c) => c.name === SAVE);
    expect(before).toHaveLength(3);
    s.dispose();
    s.dispose();
    await Promise.resolve();
    await Promise.resolve();
    const saves = calls.filter((c) => c.name === SAVE);
    expect(saves).toHaveLength(4);
    expect(new Set(saves.map((c) => c.args?.p_request_id)).size).toBe(1);
    expect(saves[3].args).toMatchObject({ p_answer: { selected: "b" }, p_exercise_id: exerciseId(1, 1) });
  });

  it("ответ подтверждён, ничего не отправлялось, отказ окончательный или запрос ещё идёт: при закрытии ничего не шлётся", async () => {
    const ok = session({ [SAVE]: saveResult(1, 1, true) }, { draft: draft() });
    await ok.session.answer({ selected: "b" });
    ok.session.dispose();
    expect(ok.calls.filter((c) => c.name === SAVE)).toHaveLength(1);

    const idle = session({}, { draft: draft() }); // студент только выбрал вариант (сессия об этом не знает): досылать нечего
    idle.session.dispose();
    expect(idle.calls).toHaveLength(0);

    const conflict = session({ [SAVE]: failure("40001", 409) }, { draft: draft() });
    await conflict.session.answer({ selected: "b" });
    conflict.session.dispose();
    expect(conflict.calls.filter((c) => c.name === SAVE)).toHaveLength(1);
  });

  it("ответ не подтверждён, а потом чтение вернуло окончательный отказ (доступ закрыт): при закрытии повтор не шлётся", async () => {
    const { session: s, calls } = session({ ...down(SAVE, saveResult(1, 1, true)), [READ]: failure("42501", 403) }, { draft: draft() });
    await s.answer({ selected: "b" });
    expect(s.getState().error).toBe("unavailable");
    await s.reload();
    expect(s.getState().error).toBe("denied"); // замороженный ответ остался, но повторять его после отказа бессмысленно
    s.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(3);
  });

  it("«Завершить» не подтверждено: при закрытии один повтор запроса завершения с тем же p_request_id", async () => {
    const full = attemptFixture(1, { total: 1, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
    const parsed = parseLearningLessonView(lessonView({ n: 1, exercises: 1 }, { draft: full }));
    const fake = fakeTransport(down(COMPLETE, attemptFixture(1, { status: "completed", total: 1, result: { correct: 1, total: 1, wrong: [] }, answers: full.answers })));
    const s = new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, parsed.draft, null, newId);
    await expect(s.finish()).resolves.toBe(false);
    s.dispose();
    await Promise.resolve();
    await Promise.resolve();
    const completes = fake.calls.filter((c) => c.name === COMPLETE);
    expect(completes).toHaveLength(4);
    expect(new Set(completes.map((c) => c.args?.p_request_id)).size).toBe(1);
  });
});

describe("урок: экран узнаёт о подтверждённой досылке; после выхода из аккаунта ничего не шлётся (QA 23, мелочь 4 и выход)", () => {
  const draft = () => attemptFixture(1, { total: 3 });
  const full = () => attemptFixture(1, { total: 1, answers: { [exerciseId(1, 1)]: attemptEntry("b", true) } });
  const finishing = (handlers: Record<string, unknown>) => {
    const parsed = parseLearningLessonView(lessonView({ n: 1, exercises: 1 }, { draft: full() }));
    const fake = fakeTransport(handlers);
    return { ...fake, session: new EnglishSession(fake.transport, parsed.lesson.lessonId, parsed.lesson.exercises, parsed.draft, null, newId) };
  };
  const completed = () => attemptFixture(1, { status: "completed", total: 1, result: { correct: 1, total: 1, wrong: [] }, answers: full().answers });

  it("досылка ответа подтверждена: `onConfirmed` вызван один раз; второе закрытие экрана ничего не шлёт и не зовёт", async () => {
    const { session: s, calls } = session(down(SAVE, saveResult(1, 1, true)), { draft: draft() });
    await s.answer({ selected: "b" });
    const confirmed = jest.fn();
    s.dispose(confirmed);
    s.dispose(confirmed);
    await settle();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(4);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it("досылка завершения подтверждена: `onConfirmed` вызван один раз", async () => {
    const { session: s, calls } = finishing(down(COMPLETE, completed()));
    await expect(s.finish()).resolves.toBe(false);
    const confirmed = jest.fn();
    s.dispose(confirmed);
    await settle();
    expect(calls.filter((c) => c.name === COMPLETE)).toHaveLength(4);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it("досылка не удалась (сервер недоступен и на этот раз): `onConfirmed` не вызван, ошибки наружу не вылетает", async () => {
    const { session: s, calls } = session({ [SAVE]: failure(null, 0) }, { draft: draft() });
    await s.answer({ selected: "b" });
    const sent = calls.filter((c) => c.name === SAVE).length;
    const confirmed = jest.fn();
    s.dispose(confirmed);
    await settle();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(2 * sent);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("закрытие экрана без обратного вызова по-прежнему досылает (вызов `dispose()` без аргументов)", async () => {
    const { session: s, calls } = session(down(SAVE, saveResult(1, 1, true)), { draft: draft() });
    await s.answer({ selected: "b" });
    s.dispose();
    await settle();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(4);
  });

  it("выход из аккаунта после обрыва: закрытие экрана ничего не досылает и не зовёт `onConfirmed` (токен отозван)", async () => {
    const answered = session(down(SAVE, saveResult(1, 1, true)), { draft: draft() });
    await answered.session.answer({ selected: "b" });
    const confirmed = jest.fn();
    answered.session.abandon();
    answered.session.dispose(confirmed);
    await settle();
    expect(answered.calls.filter((c) => c.name === SAVE)).toHaveLength(3);
    expect(confirmed).not.toHaveBeenCalled();

    const finishingSession = finishing(down(COMPLETE, completed()));
    await finishingSession.session.finish();
    finishingSession.session.abandon();
    finishingSession.session.dispose(confirmed);
    await settle();
    expect(finishingSession.calls.filter((c) => c.name === COMPLETE)).toHaveLength(3);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("после выхода из аккаунта кнопки уже ничего не шлют: «Начать», ответ, «Завершить» и перечитывание", async () => {
    const lesson = session({ [START]: attemptFixture(1, { total: 3 }), [SAVE]: saveResult(1, 1, true), [READ]: lessonView({ n: 1 }, {}) });
    lesson.session.abandon();
    await expect(lesson.session.begin()).resolves.toBe(false);
    await lesson.session.answer({ selected: "b" });
    await expect(lesson.session.finish()).resolves.toBe(false);
    await lesson.session.reload();
    expect(lesson.calls).toHaveLength(0);

    const open = finishing({ [COMPLETE]: completed() });
    open.session.abandon();
    await expect(open.session.finish()).resolves.toBe(false);
    expect(open.calls).toHaveLength(0);
    expect(open.session.getState().error).toBeNull();
  });
});
