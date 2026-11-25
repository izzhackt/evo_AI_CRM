// Сессия теста как у сайта (G57-G59): страницы по правилу веба, «слать больше нечего» перед уходом, конфликт без
// молчаливой замены ответов, замороженный запрос завершения, досылка при закрытии экрана. Сеть и таймеры поддельные.
import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { ASSESSMENT_RETRY_MS, ASSESSMENT_SAVE_MS, AssessmentSession } from "@/features/learning/tests/assessment-session";
import { answersFor, attemptFixture, ATTEMPT_ID, OTHER_ATTEMPT_ID, sessionHarness, type FixtureKey } from "@/test-fixtures/assessment";

const SAVE = "save_student_assessment_answers_v1";
const START = "start_student_assessment_v1";
const COMPLETE = "complete_student_assessment_v1";
const READ = "student_assessment_attempt_v1";

/** Одна запись при обрыве: слой RPC повторяет тот же запрос ещё дважды, поэтому три ответа «обрыв» на один вызов. */
const down = (calls = 1) => Array<string>(3 * calls).fill("NETWORK");
const parse = (key: FixtureKey, overrides: Record<string, unknown> = {}) => normalizeAssessmentAttempt(attemptFixture(key, overrides));
const done = (key: FixtureKey, revision = 9) => {
  const questions = attemptFixture(key).questions;
  const answers = answersFor(key, questions.length);
  const english = key === "english36";
  return attemptFixture(key, {
    status: "completed",
    revision,
    answers,
    completedAt: "2026-11-09T10:05:00+00:00",
    result: {
      instrumentKey: key,
      version: "1.0.0",
      metadata: { title: "t", description: "d", instructions: ["i"], limitations: ["l"] },
      answeredCount: questions.length,
      questionCount: questions.length,
      completedAt: "2026-11-09T10:05:00+00:00",
      ...(english
        ? { english: { correctCount: 1, totalCount: questions.length, topics: [{ topic: "grammar", correctCount: 1, totalCount: questions.length }], feedback: questions.map((q) => ({ questionId: q.id, selectedOptionId: "a", correctOptionId: "a", correct: true, explanation: "e", topic: "grammar" })) } }
        : { orvis: { scales: [{ scale: "analysis", rawSum: 40, itemCount: 14, mean: 2.86 }], topScales: ["analysis"] } }),
    },
  });
};

describe("страницы теста: правило веба", () => {
  it("orvis92 по четыре утверждения: открывается на странице первого пропущенного, 92 вопроса дают 23 страницы", () => {
    const session = new AssessmentSession(sessionHarness({}).env, "orvis92", null, parse("orvis92", { answers: answersFor("orvis92", 10) }));
    expect(session.getState().phase).toBe("running");
    expect(session.getState().page).toBe(2); // вопрос 11 лежит на третьей странице (индекс 2)
    session.goTo(99);
    expect(session.getState().page).toBe(23); // 23 страницы вопросов, страница 23 - «Готовы завершить?»
    session.goTo(-5);
    expect(session.getState().page).toBe(0);
    session.dispose();
  });

  it("english36 по одному заданию: страница равна номеру первого пропущенного вопроса; все отвечены: первая страница", () => {
    const partial = new AssessmentSession(sessionHarness({}).env, "english36", null, parse("english36", { answers: answersFor("english36", 5) }));
    expect(partial.getState().page).toBe(5);
    partial.goTo(500);
    expect(partial.getState().page).toBe(36);
    const full = new AssessmentSession(sessionHarness({}).env, "english36", null, parse("english36", { answers: answersFor("english36", 36) }));
    expect(full.getState().page).toBe(0);
    partial.dispose();
    full.dispose();
  });

  it("черновик, открытый по номеру попытки, сразу идёт (без «Перед началом»), завершённая показывает результат", () => {
    const draft = new AssessmentSession(sessionHarness({}).env, "orvis92", null, parse("orvis92"));
    expect(draft.getState().phase).toBe("running");
    const completed = new AssessmentSession(sessionHarness({}).env, "orvis92", null, normalizeAssessmentAttempt(done("orvis92")));
    expect(completed.getState().phase).toBe("result");
    draft.dispose();
    completed.dispose();
  });

  it("старт: повторное нажатие, пока читается черновик, не шлёт второй запрос; чужой черновик открывается на первом пропущенном", async () => {
    const h = sessionHarness({ [READ]: [attemptFixture("orvis92", { answers: answersFor("orvis92", 9) })] });
    const session = new AssessmentSession(h.env, "orvis92", ATTEMPT_ID);
    const first = session.start();
    const second = session.start();
    await Promise.all([first, second]);
    expect(h.calls.filter((c) => c.name === READ)).toHaveLength(1);
    expect(session.getState().phase).toBe("running");
    expect(session.getState().page).toBe(2);
    session.dispose();
  });

  it("страницы закрыты, пока идёт завершение", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36", {}, 2)], [SAVE]: [attemptFixture("english36", { revision: 2 }, 2)], [COMPLETE]: [done("english36")] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    session.select("e2", "a");
    const completing = session.complete();
    expect(session.getState().phase).toBe("completing");
    session.goTo(1);
    expect(session.getState().page).toBe(0);
    session.select("e1", "b");
    expect(session.getState().answers.e1).toBe("a");
    await completing;
    session.dispose();
  });
});

describe("уход: «слать больше нечего» (G58)", () => {
  it("несохранённый ответ: уход придерживается, сохранение подтверждено - можно уходить", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("orvis92")], [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null);
    await session.start();
    expect(session.getState().unsaved).toBe(false);
    session.select("o1", "3");
    expect(session.getState().unsaved).toBe(true);
    expect(session.getState().saveStatus).toBe("dirty");
    // Студент нажал «назад» раньше таймера 0,9 с: ответ уходит сразу, не ждёт.
    await expect(session.saveForExit()).resolves.toBe(true);
    const saves = h.calls.filter((c) => c.name === SAVE);
    expect(saves).toHaveLength(1);
    expect(saves[0].args.p_answers).toEqual({ o1: "3" });
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });

  it("нет связи: уход не подтверждён, ответ остаётся и продолжает уходить тем же замороженным запросом", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("orvis92")], [SAVE]: [...down(), attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null);
    await session.start();
    session.select("o1", "3");
    await expect(session.saveForExit()).resolves.toBe(false);
    expect(session.getState().saveStatus).toBe("unconfirmed");
    expect(session.getState().unsaved).toBe(true);
    expect(session.getState().answers).toEqual({ o1: "3" });
    // Автоповтор через 3 с идёт тем же запросом и подтверждает.
    await h.advance(ASSESSMENT_RETRY_MS + 10);
    const saves = h.calls.filter((c) => c.name === SAVE);
    expect(new Set(saves.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(session.getState().saveStatus).toBe("saved");
    expect(session.getState().unsaved).toBe(false);
    await expect(session.saveForExit()).resolves.toBe(true);
    session.dispose();
  });

  it("повтор вручную («Повторить сохранение»): flush сразу шлёт замороженный запрос, не ждёт таймер", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36")], [SAVE]: [...down(), attemptFixture("english36", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    expect(session.getState().saveStatus).toBe("unconfirmed");
    await expect(session.flush()).resolves.toBe(true);
    const saves = h.calls.filter((c) => c.name === SAVE);
    expect(saves).toHaveLength(4); // три попытки слоя RPC и ручной повтор: один и тот же запрос
    expect(new Set(saves.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(h.pendingTimers()).toBe(0);
    session.dispose();
  });

  it("ничего не менялось: уход свободен и запросов нет", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36", { answers: answersFor("english36", 2) })] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    await expect(session.saveForExit()).resolves.toBe(true);
    expect(h.calls.map((c) => c.name)).toEqual([START]);
    session.dispose();
  });

  it("окончательный отказ (доступ закрыт): ответы не сохранены, но студента на экране не держим", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36")], [SAVE]: ["DENIED"] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    await expect(session.saveForExit()).resolves.toBe(true);
    expect(session.getState().error).toBe("denied");
    expect(session.getState().saveStatus).toBe("unconfirmed"); // не «Все ответы сохранены»
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });

  it("экран закрыт с несохранённым ответом: он уходит и после закрытия, повторов по таймеру нет", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36")], [SAVE]: ["NETWORK"] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    session.dispose();
    await h.advance(ASSESSMENT_RETRY_MS * 3);
    // Одна запись: слой RPC сам повторяет тот же запрос трижды; нового запроса и таймера повтора после закрытия нет.
    const saves = h.calls.filter((c) => c.name === SAVE);
    expect(saves).toHaveLength(3);
    expect(new Set(saves.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(saves[0].args.p_answers).toEqual({ e1: "a" });
    expect(h.pendingTimers()).toBe(0);
  });

  it("экран закрыт, пока шёл другой запрос и ответ изменился: остаток тоже уходит", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36")], [SAVE]: [attemptFixture("english36", { revision: 2 }), attemptFixture("english36", { revision: 3 })] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    const flush = session.flush(); // ушёл первый запрос
    session.select("e2", "b"); // ответ во время полёта
    session.dispose();
    await flush;
    await h.settle();
    const saves = h.calls.filter((c) => c.name === SAVE);
    expect(saves.map((c) => c.args.p_answers)).toEqual([{ e1: "a" }, { e1: "a", e2: "b" }]);
  });
});

describe("конфликт ревизии: ответы на экране не заменяются молча (G59)", () => {
  async function conflicted() {
    const h = sessionHarness({
      [START]: [attemptFixture("orvis92", { answers: { o1: "2" } })],
      [SAVE]: ["CONFLICT"],
      [READ]: [attemptFixture("orvis92", { revision: 7, answers: { o1: "5", o2: "4" } })],
    });
    const session = new AssessmentSession(h.env, "orvis92", null);
    await session.start();
    session.select("o3", "1");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    return { h, session };
  }

  it("ответы студента остаются, сервер не читается сам, сохранение и выбор закрыты, уйти нельзя", async () => {
    const { h, session } = await conflicted();
    const state = session.getState();
    expect(state.reloadRequired).toBe(true);
    expect(state.error).toBe("conflict");
    expect(state.answers).toEqual({ o1: "2", o3: "1" });
    expect(state.unsaved).toBe(true);
    expect(h.calls.some((c) => c.name === READ)).toBe(false);
    session.select("o4", "1");
    expect(session.getState().answers).toEqual({ o1: "2", o3: "1" });
    const before = h.calls.length;
    await expect(session.flush()).resolves.toBe(false);
    await expect(session.saveForExit()).resolves.toBe(false);
    await session.complete();
    expect(h.calls).toHaveLength(before);
    session.dispose();
  });

  it("«Показать сохранённые ответы»: ответы сервера заменяют экранные, ревизия новая, страница не прыгает", async () => {
    const { h, session } = await conflicted();
    session.goTo(2);
    await session.loadSaved();
    const state = session.getState();
    expect(state.answers).toEqual({ o1: "5", o2: "4" });
    expect(state.reloadRequired).toBe(false);
    expect(state.error).toBeNull();
    expect(state.saveStatus).toBe("saved");
    expect(state.reload).toBe("idle");
    expect(state.unsaved).toBe(false);
    expect(state.page).toBe(2);
    expect(session.debug().revision).toBe(7);
    expect(h.calls.filter((c) => c.name === READ)).toHaveLength(1);
    await expect(session.saveForExit()).resolves.toBe(true);
    session.dispose();
  });

  it("чтение сохранённого не удалось: ответы на экране остаются, кнопка остаётся, повтор помогает", async () => {
    const h = sessionHarness({
      [START]: [attemptFixture("orvis92")],
      [SAVE]: ["CONFLICT"],
      [READ]: ["NETWORK", attemptFixture("orvis92", { revision: 4, answers: { o9: "2" } })],
    });
    const session = new AssessmentSession(h.env, "orvis92", null);
    await session.start();
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    await session.loadSaved();
    expect(session.getState().reload).toBe("failed");
    expect(session.getState().reloadRequired).toBe(true);
    expect(session.getState().answers).toEqual({ o1: "3" });
    await session.loadSaved();
    expect(session.getState().answers).toEqual({ o9: "2" });
    expect(session.getState().reloadRequired).toBe(false);
    session.dispose();
  });

  it("доступ к попытке закрыт при чтении: сверять нечего, студента не держим", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("orvis92")], [SAVE]: ["CONFLICT"], [READ]: ["DENIED"] });
    const session = new AssessmentSession(h.env, "orvis92", null);
    await session.start();
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    await session.loadSaved();
    expect(session.getState().error).toBe("denied");
    expect(session.getState().reloadRequired).toBe(false);
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });

  it("за это время тест завершён на другом устройстве: показывается результат", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36")], [SAVE]: ["CONFLICT"], [READ]: [done("english36")] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "b");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    await session.loadSaved();
    expect(session.getState().phase).toBe("result");
    expect(session.getState().reloadRequired).toBe(false);
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });

  it("конфликт при завершении: тот же разбор, завершение закрыто до сверки", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36", {}, 2)], [SAVE]: [attemptFixture("english36", { revision: 2 }, 2)], [COMPLETE]: ["CONFLICT"], [READ]: [attemptFixture("english36", { revision: 6, answers: { e1: "b" } }, 2)] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    session.select("e2", "a");
    await session.complete();
    expect(session.getState().phase).toBe("running");
    expect(session.getState().reloadRequired).toBe(true);
    expect(session.getState().answers).toEqual({ e1: "a", e2: "a" });
    await session.complete();
    expect(h.calls.filter((c) => c.name === COMPLETE)).toHaveLength(1);
    await session.loadSaved();
    expect(session.getState().answers).toEqual({ e1: "b" });
    session.dispose();
  });
});

describe("завершение: замороженный запрос", () => {
  async function ready(replies: Record<string, unknown[]>) {
    const h = sessionHarness({ [START]: [attemptFixture("english36", {}, 2)], [SAVE]: [attemptFixture("english36", { revision: 2 }, 2)], ...replies });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    session.select("e2", "b");
    return { h, session };
  }

  it("обрыв: повторное «Завершить» идёт тем же p_request_id (сервер мог уже принять), успех сбрасывает его", async () => {
    const { h, session } = await ready({ [COMPLETE]: [...down(), done("english36")] });
    await session.complete();
    expect(session.getState().phase).toBe("running");
    expect(session.getState().error).toBe("unavailable");
    expect(session.debug().completeRequest).not.toBeNull();
    await session.complete();
    expect(session.getState().phase).toBe("result");
    const ids = h.calls.filter((c) => c.name === COMPLETE).map((c) => c.args.p_request_id);
    expect(ids).toHaveLength(4); // три попытки слоя RPC и повтор после нажатия
    expect(new Set(ids).size).toBe(1);
    expect(session.debug().completeRequest).toBeNull();
    session.dispose();
  });

  it("ответы изменились после обрыва: запрос новый, с новыми ответами", async () => {
    const { h, session } = await ready({ [COMPLETE]: [...down(), done("english36")], [SAVE]: [attemptFixture("english36", { revision: 2 }, 2), attemptFixture("english36", { revision: 3 }, 2)] });
    await session.complete();
    const first = h.calls.filter((c) => c.name === COMPLETE).map((c) => c.args.p_request_id)[0];
    session.select("e2", "unknown");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    await session.complete();
    const completes = h.calls.filter((c) => c.name === COMPLETE);
    const last = completes[completes.length - 1];
    expect(last.args.p_request_id).not.toBe(first);
    expect(last.args.p_answers).toEqual({ e1: "a", e2: "unknown" });
    session.dispose();
  });

  it("не на все вопросы ответили: запроса нет, ошибка «проверьте ответы»", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("english36", {}, 2)] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("e1", "a");
    await session.complete();
    expect(session.getState().error).toBe("invalid");
    expect(h.calls.some((c) => c.name === COMPLETE)).toBe(false);
    session.dispose();
  });

  it("тест начат с известного черновика и завершён: «Пройти заново» открывает новую попытку, а не читает завершённую ещё раз", async () => {
    const h = sessionHarness({
      [READ]: [attemptFixture("english36", {}, 2)],
      [SAVE]: [attemptFixture("english36", { revision: 2 }, 2)],
      [COMPLETE]: [done("english36")],
      [START]: [attemptFixture("english36", { attemptId: OTHER_ATTEMPT_ID }, 2)],
    });
    const session = new AssessmentSession(h.env, "english36", ATTEMPT_ID);
    expect(session.getState().resumable).toBe(true);
    await session.start();
    session.select("e1", "a");
    session.select("e2", "b");
    await session.complete();
    expect(session.getState().phase).toBe("result");
    expect(session.getState().resumable).toBe(false);
    session.restart();
    expect(session.getState().resumable).toBe(false);
    await session.start();
    expect(h.calls.filter((c) => c.name === READ)).toHaveLength(1);
    expect(h.calls.filter((c) => c.name === START)).toHaveLength(1);
    expect(session.getState().phase).toBe("running");
    expect(session.getState().attempt?.attemptId).toBe(OTHER_ATTEMPT_ID);
    session.dispose();
  });

  it("черновик, открытый «Продолжить», не остаётся «продолжаемым», если его уже завершили в другом месте", async () => {
    const h = sessionHarness({ [READ]: [done("english36")] });
    const session = new AssessmentSession(h.env, "english36", ATTEMPT_ID);
    await session.start();
    expect(session.getState().phase).toBe("result");
    expect(session.getState().resumable).toBe(false);
    session.dispose();
  });

  it("уход во время завершения ждёт его конца", async () => {
    const { session } = await ready({ [COMPLETE]: [done("english36")] });
    const completing = session.complete();
    await expect(session.saveForExit()).resolves.toBe(true);
    await completing;
    expect(session.getState().phase).toBe("result");
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });
});
