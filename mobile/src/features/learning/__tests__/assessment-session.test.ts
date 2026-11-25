// Сессия теста как у сайта (G57-G59): страницы по правилу веба, «слать больше нечего» перед уходом, конфликт без
// молчаливой замены ответов, замороженный запрос завершения, досылка при закрытии экрана. Сеть и таймеры поддельные.
import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { ASSESSMENT_RETRY_MS, ASSESSMENT_SAVE_MS, AssessmentSession } from "@/features/learning/tests/assessment-session";
import { answersFor, attemptFixture, ATTEMPT_ID, completedFixture, OTHER_ATTEMPT_ID, sessionHarness, type FixtureKey } from "@/test-fixtures/assessment";

const SAVE = "save_student_assessment_answers_v1";
const START = "start_student_assessment_v1";
const COMPLETE = "complete_student_assessment_v1";
const READ = "student_assessment_attempt_v1";

/** Одна запись при обрыве: слой RPC повторяет тот же запрос ещё дважды, поэтому три ответа «обрыв» на один вызов. */
const down = (calls = 1) => Array<string>(3 * calls).fill("NETWORK");
const parse = (key: FixtureKey, overrides: Record<string, unknown> = {}) => normalizeAssessmentAttempt(attemptFixture(key, overrides));
const done = completedFixture;

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

describe("упорный сбой: студента не запираем (ревью #1559)", () => {
  /** Ответ сервера, который приложение не может разобрать (`PortalDecodeError`): сервер запрос принял, а квитанцию не прочитать. */
  const garbage = { not: "an attempt" };
  const saves = (h: ReturnType<typeof sessionHarness>) => h.calls.filter((c) => c.name === SAVE);

  it("квитанцию сохранения не удалось разобрать: повторов по таймеру нет, защита снята, сбой показан", async () => {
    const h = sessionHarness({ [SAVE]: [garbage] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(saves(h)).toHaveLength(1);
    const state = session.getState();
    expect(state.saveStatus).toBe("unconfirmed");
    expect(state.error).toBe("unreadable");
    expect(state.unsaved).toBe(false); // досохранять нечем: уход свободен
    expect(state.failures).toBe(0);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    expect(saves(h)).toHaveLength(1); // раньше тот же запрос уходил каждые 3 секунды вечно
    await expect(session.saveForExit()).resolves.toBe(true);
    session.dispose();
  });

  it("обрыв повторяется тем же запросом, счётчик неудач растёт с каждой неудачной отправкой и сбрасывается успехом", async () => {
    const h = sessionHarness({ [SAVE]: [...down(3), attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().failures).toBe(1);
    await h.advance(ASSESSMENT_RETRY_MS);
    expect(session.getState().failures).toBe(2);
    await h.advance(ASSESSMENT_RETRY_MS);
    expect(session.getState().failures).toBe(3);
    expect(session.getState().unsaved).toBe(true); // обрыв держит экран, пока студент сам не выберет «Выйти без сохранения»
    expect(new Set(saves(h).map((c) => c.args.p_request_id)).size).toBe(1);
    await h.advance(ASSESSMENT_RETRY_MS);
    expect(session.getState().failures).toBe(0);
    expect(session.getState().saveStatus).toBe("saved");
    expect(session.getState().unsaved).toBe(false);
    session.dispose();
  });

  it("нажатие «Повторить сохранение» тоже считается попыткой; конфликт и окончательный отказ счётчик обнуляют (их повтором не лечить)", async () => {
    const h = sessionHarness({ [SAVE]: [...down(2), "CONFLICT"] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    await session.flush();
    expect(session.getState().failures).toBe(2);
    await session.flush();
    expect(session.getState().reloadRequired).toBe(true);
    expect(session.getState().failures).toBe(0);
    session.dispose();
  });

  it("сверка после конфликта: обрыв при чтении оставляет кнопку и считает неудачи; ответ, который не разобрать, снимает защиту", async () => {
    const down1 = sessionHarness({ [SAVE]: ["CONFLICT"], [READ]: ["NETWORK"] });
    const offline = new AssessmentSession(down1.env, "orvis92", null, parse("orvis92"));
    offline.select("o1", "3");
    await down1.advance(ASSESSMENT_SAVE_MS);
    for (const n of [1, 2, 3]) {
      await offline.loadSaved();
      expect(offline.getState().failures).toBe(n);
      expect(offline.getState().reloadRequired).toBe(true);
      expect(offline.getState().unsaved).toBe(true);
    }
    offline.dispose();

    const broken = sessionHarness({ [SAVE]: ["CONFLICT"], [READ]: [garbage] });
    const session = new AssessmentSession(broken.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await broken.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().reloadRequired).toBe(true);
    await session.loadSaved();
    expect(session.getState().reload).toBe("failed");
    expect(session.getState().reloadRequired).toBe(false); // сверять нечем, повтор тот же ответ не поймёт
    expect(session.getState().unsaved).toBe(false);
    expect(session.getState().failures).toBe(0);
    await expect(session.saveForExit()).resolves.toBe(true);
    session.dispose();
  });

  it("экран не на виду: повторов по таймеру нет; вернулись: неподтверждённое уходит сразу тем же запросом", async () => {
    const h = sessionHarness({ [SAVE]: [...down(1), attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(saves(h)).toHaveLength(3); // одна отправка: слой RPC пробует обрыв три раза
    session.setPaused(true);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    expect(saves(h)).toHaveLength(3);
    session.setPaused(false);
    await h.settle();
    expect(saves(h)).toHaveLength(4);
    expect(new Set(saves(h).map((c) => c.args.p_request_id)).size).toBe(1);
    expect(session.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("сбой пришёл, пока экран не на виду: таймер не ставится, пока не вернутся", async () => {
    const h = sessionHarness({ [SAVE]: [...down(1), attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    session.setPaused(true);
    await h.advance(ASSESSMENT_SAVE_MS); // выбор сделан на виду, отправка пошла уже без него
    expect(session.getState().saveStatus).toBe("unconfirmed");
    expect(h.pendingTimers()).toBe(0);
    session.setPaused(false);
    await h.settle();
    expect(session.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("пауза и возобновление без сбоя ничего не шлют; после закрытия экрана они ни на что не влияют", async () => {
    const h = sessionHarness({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.setPaused(true);
    session.setPaused(false);
    await h.settle();
    expect(h.calls).toHaveLength(0);
    session.dispose();
    session.setPaused(true);
    session.setPaused(false);
    await h.settle();
    expect(h.calls).toHaveLength(0);
  });
});

/** Среда с запросом, который висит, пока тест его не отпустит: так выбор меняется, пока сохранение в полёте. */
function hangingEnv() {
  let now = 0;
  let next = 1;
  let id = 0;
  const timers = new Map<number, { at: number; ms: number; fn: () => void }>();
  const calls: string[] = [];
  const waiting: ((reply: unknown) => void)[] = [];
  const env = {
    transport: ((name: string) => {
      calls.push(name);
      return new Promise((resolve) => waiting.push(resolve));
    }) as never,
    setTimer: (fn: () => void, ms: number) => {
      const handle = next++;
      timers.set(handle, { at: now + ms, ms, fn });
      return handle;
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
  const settle = async () => {
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      await settle();
    }
    now = target;
    await settle();
  };
  const fail = async () => {
    waiting.shift()?.({ data: null, error: { code: null, message: "net" }, status: null });
    await settle();
  };
  const succeed = async (data: unknown) => {
    waiting.shift()?.({ data, error: null, status: 200 });
    await settle();
  };
  return { env, calls, timers, advance, settle, fail, succeed };
}

describe("таймеры сессии не остаются без хозяина (ревью #1559)", () => {
  it("выбор изменили, пока сохранение в полёте, и оно оборвалось: остаётся один таймер повтора, а после закрытия экрана ни одного", async () => {
    const h = hangingEnv();
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS); // отправка №1 повисла в полёте
    expect(h.calls).toHaveLength(1);
    session.select("o2", "4"); // выбор изменили: поставлен таймер 0,9 с
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([ASSESSMENT_SAVE_MS]);
    for (let k = 0; k < 3; k += 1) await h.fail(); // слой RPC пробует обрыв три раза
    // Раньше таймер повтора затирал ручку таймера 0,9 с, и тот оставался в памяти без хозяина.
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([ASSESSMENT_RETRY_MS]);
    session.dispose();
    expect(h.timers.size).toBe(0);
    const before = h.calls.length;
    await h.advance(ASSESSMENT_RETRY_MS + ASSESSMENT_SAVE_MS + 10);
    expect(h.calls).toHaveLength(before); // после закрытия экрана запросов нет
  });
});

describe("«Выйти без сохранения» - настоящий отказ от несохранённого (ревью #1581)", () => {
  const saves = (h: ReturnType<typeof sessionHarness>) => h.calls.filter((c) => c.name === SAVE);
  /** Три неудачные отправки подряд (девять обращений: слой RPC пробует обрыв три раза); десятое обращение получило бы ответ сервера. */
  async function offline() {
    const h = sessionHarness({ [SAVE]: [...down(3), attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    await h.advance(ASSESSMENT_RETRY_MS);
    await h.advance(ASSESSMENT_RETRY_MS);
    expect(session.getState().failures).toBe(3);
    expect(saves(h)).toHaveLength(9);
    return { h, session };
  }

  it("обычный выход досылает неотправленное один раз «по возможности», а отказ от сохранения - нет: связь вернулась в момент ухода, и сервер не получает ответ", async () => {
    const kept = await offline();
    kept.session.dispose();
    await kept.h.settle();
    expect(saves(kept.h)).toHaveLength(10); // закрытие экрана без отказа: одна досылка (так было и до правки)

    const gone = await offline();
    gone.session.discard();
    gone.session.dispose();
    await gone.h.settle();
    expect(saves(gone.h)).toHaveLength(9); // подтверждённый отказ: ничего не ушло, сервер ответа не получил
  });

  it("отказ снимает таймер повтора: время идёт, а запросов нет; системный flush (фон приложения) отвечает «слать нечего» и отказ не снимает", async () => {
    const { h, session } = await offline();
    session.discard();
    expect(h.pendingTimers()).toBe(0);
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    expect(saves(h)).toHaveLength(9);
    await expect(session.flush()).resolves.toBe(true);
    expect(saves(h)).toHaveLength(9);
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    expect(saves(h)).toHaveLength(9);
    session.dispose();
  });

  it("отказ не даёт отправить завершение (замороженный запрос тоже), когда он выбран посреди завершения: отправка ответов в полёте", async () => {
    const answered = attemptFixture("english36", { answers: answersFor("english36", 36) });
    // Отправка ответов в полёте не удалась: повтора по таймеру и запроса завершения нет, экран не застрял на «сохраняем».
    const hang = hangingEnv();
    const mid = new AssessmentSession(hang.env, "english36", null, normalizeAssessmentAttempt(answered));
    mid.select("e1", "b");
    const completing = mid.complete();
    await hang.settle();
    expect(mid.getState().phase).toBe("completing");
    expect(hang.calls).toEqual([SAVE]);
    mid.discard();
    for (let k = 0; k < 3; k += 1) await hang.fail();
    await completing;
    expect(hang.calls).toHaveLength(3); // ни одного запроса завершения
    expect(hang.timers.size).toBe(0); // и повтора по таймеру после отказа тоже нет
    expect(mid.getState().phase).toBe("running");
    mid.dispose();

    // То же, но отправка ответов в полёте удаётся: без отказа сразу ушло бы завершение, с отказом оно не уходит.
    const ok = hangingEnv();
    const sent = new AssessmentSession(ok.env, "english36", null, normalizeAssessmentAttempt(answered));
    sent.select("e1", "b");
    const finishing = sent.complete();
    await ok.settle();
    expect(ok.calls).toEqual([SAVE]);
    sent.discard();
    await ok.succeed(attemptFixture("english36", { revision: 2, answers: { ...answersFor("english36", 36), e1: "b" } }));
    await finishing;
    expect(ok.calls).toEqual([SAVE]); // завершение не ушло
    expect(sent.getState().phase).toBe("running");
    sent.dispose();
  });

  it("время само отказ не снимает: экран закрывается медленно (JS занят дольше 0,8 с), и закрытие ничего не шлёт (позднее сохранение после «пропадут»)", async () => {
    const { h, session } = await offline();
    session.discard();
    await h.advance(5_000); // «медленный» уход: прошло много времени, студент ничего не нажимал
    expect(saves(h)).toHaveLength(9);
    session.dispose();
    await h.settle();
    expect(saves(h)).toHaveLength(9);
  });

  describe("следующее действие студента после отказа, который не состоялся (экран остался), снимает отказ", () => {
    /** Действия, после которых студент уже не уходит: каждое возвращает сохранение, и тот же замороженный запрос уходит снова. */
    const actions: [string, (session: AssessmentSession) => Promise<unknown> | void][] = [
      ["выбор ответа", (session) => session.select("o2", "4")],
      ["переход на страницу", (session) => session.goTo(1)],
      ["«Завершить»", (session) => session.complete()],
      ["«Повторить сохранение»", (session) => session.retryNow()],
      ["«Сохранить и выйти»", (session) => session.saveForExit()],
    ];
    it.each(actions)("%s: отказ снят, повтор сохранения идёт тем же запросом", async (_name, act) => {
      const { h, session } = await offline();
      const frozen = saves(h)[0].args.p_request_id;
      session.discard();
      await h.advance(10 * ASSESSMENT_RETRY_MS);
      expect(saves(h)).toHaveLength(9); // пока студент ничего не делает, ничего не уходит
      await act(session);
      await h.advance(ASSESSMENT_RETRY_MS);
      await h.settle();
      expect(saves(h).length).toBeGreaterThanOrEqual(10);
      expect(saves(h)[9].args.p_request_id).toBe(frozen);
      expect(session.getState().saveStatus === "saved" || session.getState().saveStatus === "dirty").toBe(true);
      session.dispose();
    });

    it("«Показать сохранённые ответы»: чтение идёт, отказ снят", async () => {
      const h = sessionHarness({ [SAVE]: ["CONFLICT"], [READ]: [attemptFixture("orvis92", { revision: 5, answers: { o1: "5" } })] });
      const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
      session.select("o1", "3");
      await h.advance(ASSESSMENT_SAVE_MS);
      expect(session.getState().reloadRequired).toBe(true);
      session.discard();
      await session.loadSaved();
      expect(h.calls.filter((c) => c.name === READ)).toHaveLength(1);
      expect(session.getState().reloadRequired).toBe(false);
      session.select("o2", "4"); // отказ снят: выбор уходит как обычно
      await h.advance(ASSESSMENT_SAVE_MS);
      expect(saves(h).length).toBeGreaterThanOrEqual(2);
      session.dispose();
    });

    it("выбор, сделанный пока стоял отказ, оставляет один таймер, а не два (прежняя ручка не теряется)", async () => {
      const h = sessionHarness({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
      const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
      session.select("o1", "3");
      session.discard();
      expect(h.pendingTimers()).toBe(0);
      session.select("o2", "4"); // действие студента: отказ снят, таймер 0,9 с один
      expect(h.pendingTimers()).toBe(1);
      session.dispose();
      expect(h.pendingTimers()).toBe(0); // после закрытия экрана ничего не остаётся
    });

    it("страница после отказа при ответе, выбранном, но ещё не отправленном, возвращает таймер 0,9 с", async () => {
      const h = sessionHarness({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
      const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
      session.select("o1", "3");
      session.discard();
      await h.advance(ASSESSMENT_SAVE_MS);
      expect(saves(h)).toHaveLength(0);
      session.goTo(1);
      await h.advance(ASSESSMENT_SAVE_MS);
      expect(saves(h)).toHaveLength(1);
      session.dispose();
    });
  });

  it("отказ после закрытия экрана и действия после него ни на что не влияют", async () => {
    const h = sessionHarness({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.dispose();
    session.discard();
    session.select("o1", "3");
    await h.settle();
    expect(h.calls).toHaveLength(0);
  });
});

describe("выход из аккаунта: сессия бросает неотправленное окончательно (QA 23: запись с отозванным токеном)", () => {
  const saves = (h: ReturnType<typeof sessionHarness>) => h.calls.filter((c) => c.name === SAVE);
  async function offline() {
    const h = sessionHarness({ [SAVE]: [...down(3), attemptFixture("orvis92", { revision: 2 })], [READ]: [attemptFixture("orvis92", { revision: 5 })], [START]: [attemptFixture("orvis92")] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    await h.advance(ASSESSMENT_RETRY_MS);
    await h.advance(ASSESSMENT_RETRY_MS);
    expect(saves(h)).toHaveLength(9);
    return { h, session };
  }

  it("закрытие экрана после выхода ничего не досылает, таймеров нет; без выхода досылало бы", async () => {
    const control = await offline();
    control.session.dispose();
    await control.h.settle();
    expect(saves(control.h)).toHaveLength(10);

    const { h, session } = await offline();
    session.abandon();
    expect(h.pendingTimers()).toBe(0);
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    session.dispose();
    await h.settle();
    expect(saves(h)).toHaveLength(9);
  });

  it("действия студента после выхода отказа не снимают и ничего не шлют: выбор, страница, повтор, «Сохранить и выйти», «Завершить», «Показать сохранённые»", async () => {
    const { h, session } = await offline();
    session.abandon();
    session.select("o2", "4");
    session.goTo(1);
    await expect(session.retryNow()).resolves.toBe(true);
    await expect(session.saveForExit()).resolves.toBe(true);
    await session.complete();
    await session.loadSaved();
    await h.advance(10 * ASSESSMENT_RETRY_MS);
    expect(h.calls).toHaveLength(9);
    expect(h.pendingTimers()).toBe(0);
    session.dispose();
  });

  it("выход до начала теста: «Начать» ничего не шлёт", async () => {
    const h = sessionHarness({ [START]: [attemptFixture("orvis92")] });
    const session = new AssessmentSession(h.env, "orvis92", null);
    session.abandon();
    await session.start();
    expect(h.calls).toHaveLength(0);
    expect(session.getState().phase).toBe("intro");
  });

  it("выход посреди отправки: когда она заканчивается сбоем, повтора по таймеру нет", async () => {
    const hang = hangingEnv();
    const session = new AssessmentSession(hang.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await hang.advance(ASSESSMENT_SAVE_MS);
    expect(hang.calls).toEqual([SAVE]);
    session.abandon();
    for (let k = 0; k < 3; k += 1) await hang.fail();
    expect(hang.timers.size).toBe(0);
    session.dispose();
    expect(hang.calls).toHaveLength(3);
  });
});

describe("квитанцию записи не удалось прочитать: ревизия не теряется (ревью #1581)", () => {
  const saves = (h: ReturnType<typeof sessionHarness>) => h.calls.filter((c) => c.name === SAVE);
  /** Ответ сервера без вопросов и метаданных: строгий разборщик его отвергает, но ревизия и номер попытки видны (запись шла с ревизией 1, ответ - 2). */
  const unreadable = (extra: Record<string, unknown> = {}) => ({ attemptId: ATTEMPT_ID, revision: 2, ...extra });

  it("ревизия берётся из ответа: следующий выбор уходит с ней, ложного конфликта «Тест открыт в другой вкладке» нет", async () => {
    const h = sessionHarness({ [SAVE]: [unreadable(), attemptFixture("orvis92", { revision: 3 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().error).toBe("unreadable");
    expect(session.getState().saveStatus).toBe("unconfirmed");
    expect(session.getState().unsaved).toBe(false); // досохранять нечем: уход свободен
    expect(session.debug().revision).toBe(2);
    session.select("o2", "4");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(saves(h)).toHaveLength(2);
    expect(saves(h)[1].args.p_expected_revision).toBe(2);
    expect(session.getState().reloadRequired).toBe(false);
    expect(session.getState().error).toBeNull();
    expect(session.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("верится только ровно следующей ревизии (запись шла с 4, значит 5): любое другое число, чужая попытка, не число, чужой объект - прежняя ревизия остаётся", async () => {
    const wrong: unknown[] = [
      { attemptId: ATTEMPT_ID },
      unreadable({ revision: "5" }),
      unreadable({ revision: 5.5 }),
      unreadable({ revision: Number.POSITIVE_INFINITY }),
      unreadable({ revision: Number.MAX_SAFE_INTEGER }), // раньше принималось любое целое: следующая запись ушла бы с ним и дала бы ложный конфликт
      unreadable({ revision: 9 }),
      unreadable({ revision: 6 }), // на две вперёд
      unreadable({ revision: 4 }), // запись ревизию не продвинула
      unreadable({ revision: 3 }),
      unreadable({ revision: -1 }),
      unreadable({ attemptId: OTHER_ATTEMPT_ID, revision: 5 }),
      unreadable({ attemptId: undefined, revision: 5 }),
      "не объект",
      null,
    ];
    for (const reply of wrong) {
      const h = sessionHarness({ [SAVE]: [reply] });
      const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92", { revision: 4 }));
      session.select("o1", "3");
      await h.advance(ASSESSMENT_SAVE_MS);
      expect(session.getState().error).toBe("unreadable");
      expect(session.debug().revision).toBe(4);
      session.dispose();
    }
    // А ровно следующая принимается.
    const h = sessionHarness({ [SAVE]: [unreadable({ revision: 5 })] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92", { revision: 4 }));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.debug().revision).toBe(5);
    session.dispose();
  });

  it("у запроса завершения ревизию из нечитаемого ответа не берут: «Завершить» после сбоя уходит тем же замороженным запросом", async () => {
    const answered = attemptFixture("english36", { answers: answersFor("english36", 36) });
    const h = sessionHarness({ [COMPLETE]: [{ attemptId: ATTEMPT_ID, revision: 2 }, done("english36")] });
    const session = new AssessmentSession(h.env, "english36", null, normalizeAssessmentAttempt(answered));
    await session.complete();
    expect(session.getState().error).toBe("unavailable");
    expect(session.debug().revision).toBe(1);
    await session.complete();
    const completes = h.calls.filter((c) => c.name === COMPLETE);
    expect(new Set(completes.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(session.getState().phase).toBe("result");
    session.dispose();
  });

  it("прежний сбой «не удалось прочитать» не прячет следующий, сетевой: плашка называет настоящую причину", async () => {
    const h = sessionHarness({ [SAVE]: [unreadable(), ...down(1)] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().error).toBe("unreadable");
    session.select("o2", "4");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().saveStatus).toBe("unconfirmed");
    expect(session.getState().failures).toBe(1);
    expect(session.getState().error).toBeNull(); // раньше оставалось «unreadable», и плашка говорила «не удалось прочитать» вместо «нет связи»
    session.dispose();
  });

  it("следующее успешное сохранение убирает сбой, а сбой другого рода заменяет его", async () => {
    const h = sessionHarness({ [SAVE]: [unreadable(), "DENIED"] });
    const session = new AssessmentSession(h.env, "orvis92", null, parse("orvis92"));
    session.select("o1", "3");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().error).toBe("unreadable");
    session.select("o2", "4");
    await h.advance(ASSESSMENT_SAVE_MS);
    expect(session.getState().error).toBe("denied");
    session.dispose();
  });
});
