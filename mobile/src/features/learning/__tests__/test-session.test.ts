// Порт CSCAPolicyTests / CSCATestRunnerModel (iPhone 1.1) и поведения TimedTestRunner веба:
// серверные часы, пачки сохранения, замороженные запросы, завершение, возобновление.
import { readFileSync } from "node:fs";
import path from "node:path";

import { clockOffsetMs, laterClockOffset, remainingSeconds, serverAcceptsSave, formatClock } from "@web/lib/portal/csca";

import { CscaTestSession, RETRY_MS, SAVE_ON_CHOICE_MS, type SessionEnv } from "@/features/learning/test-runner/session";
import type { RpcTransport } from "@/lib/rpc";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));

type Call = { name: string; args: Record<string, unknown> };
type Reply = unknown | Error | ((args: Record<string, unknown>) => unknown);

/** Управляемые часы и таймеры: время идёт только когда тест его двигает. */
function harness(replies: Record<string, Reply[]>) {
  let now = 1_000_000;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: Call[] = [];
  let id = 0;
  const transport: RpcTransport = async (name, args) => {
    calls.push({ name, args: { ...(args ?? {}) } });
    const queue = replies[name];
    const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (reply instanceof Error) {
      const e = reply as Error & { code?: string; status?: number; message: string };
      return { data: null, error: { code: e.code ?? null, message: e.message }, status: e.status ?? null };
    }
    const data = typeof reply === "function" ? (reply as (a: Record<string, unknown>) => unknown)(args ?? {}) : reply;
    return { data, error: null, status: 200 };
  };
  const env: SessionEnv = {
    transport,
    now: () => now,
    setTimer: (fn, ms) => {
      const handle = nextTimer++;
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimer: (h) => void timers.delete(h as number),
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    wait: async (ms) => {
      now += ms;
    },
  };
  /** Продвинуть время и выполнить сработавшие таймеры (кроме тикера часов, если он не нужен). */
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      await flushMicrotasks();
    }
    now = target;
    await flushMicrotasks();
  }
  return { env, calls, advance, setNow: (v: number) => (now = v), getNow: () => now };
}

async function flushMicrotasks() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

const NETWORK = Object.assign(new Error("net"), { code: null, status: null });
const err = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });

function draftAttempt(overrides: Record<string, unknown> = {}) {
  const base = fx("csca_test_start_diagnostic");
  return { ...base, serverNow: "2026-10-16T10:36:49.712211+00:00", startedAt: "2026-10-16T10:36:49.712211+00:00", deadlineAt: "2026-10-16T10:40:49.712211+00:00", ...overrides };
}

const saveReceipt = (revision: number, serverNow = "2026-10-16T10:36:52.000000+00:00") => ({
  attemptId: draftAttempt().attemptId,
  status: "draft",
  revision,
  answeredCount: 1,
  savedAt: serverNow,
  deadlineAt: "2026-10-16T10:40:49.712211+00:00",
  serverNow,
});

const FORM = "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2";
const saves = (calls: Call[]) => calls.filter((c) => c.name === "save_learning_test_v1");

describe("часы теста: серверное время, монотонный отсчёт", () => {
  it("поправка считается от serverNow; время устройства её не двигает", () => {
    const offset = clockOffsetMs("2026-10-16T10:36:49.712211+00:00", 5_000);
    expect(remainingSeconds("2026-10-16T10:40:49.712211+00:00", offset, 5_000)).toBe(240);
    // Монотонные часы ушли на 60 с: осталось 180, как бы ни переводили часы устройства.
    expect(remainingSeconds("2026-10-16T10:40:49.712211+00:00", offset, 65_000)).toBe(180);
    expect(remainingSeconds("2026-10-16T10:40:49.712211+00:00", offset, 9_999_999)).toBe(0);
  });
  it("повторная квитанция с более ранним serverNow отсчёт назад не переводит", () => {
    const later = clockOffsetMs("2026-10-16T10:36:52.000000+00:00", 5_000);
    const earlier = clockOffsetMs("2026-10-16T10:36:49.000000+00:00", 5_100);
    expect(laterClockOffset(later, earlier)).toBe(later);
    expect(laterClockOffset(null, earlier)).toBe(earlier);
  });
  it("сохранения принимаются до срока плюс запас 15 с", () => {
    const deadline = "2026-10-16T10:40:49.712211+00:00";
    const offset = clockOffsetMs("2026-10-16T10:40:00.000000+00:00", 0);
    expect(serverAcceptsSave(deadline, 15, offset, 49_000)).toBe(true);
    expect(serverAcceptsSave(deadline, 15, offset, 64_000)).toBe(true);
    expect(serverAcceptsSave(deadline, 15, offset, 65_000)).toBe(false);
  });
  it("подпись обратного отсчёта", () => {
    expect(formatClock(240)).toBe("04:00");
    expect(formatClock(59.2)).toBe("00:59");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("сессия: старт, отсчёт, возобновление", () => {
  it("старт замораживает запрос: повтор после обрыва уходит с тем же p_request_id", async () => {
    const h = harness({ start_learning_test_v1: [NETWORK, NETWORK, NETWORK, draftAttempt()] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    expect(session.getState().phase).toBe("intro");
    expect(session.getState().error).toBe("unavailable");
    await session.start();
    const ids = h.calls.filter((c) => c.name === "start_learning_test_v1").map((c) => c.args.p_request_id);
    expect(new Set(ids).size).toBe(1);
    expect(session.getState().phase).toBe("running");
    session.dispose();
  });

  it("отсчёт идёт по serverNow, срок держит сервер", async () => {
    const h = harness({ start_learning_test_v1: [draftAttempt()] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    expect(session.getState().remaining).toBe(240);
    await h.advance(60_000);
    expect(session.getState().remaining).toBe(180);
    session.dispose();
  });

  it("возобновление после убийства приложения: известный черновик читается, ответы на месте", async () => {
    const attempt = draftAttempt({ answers: { [fx("csca_test_start_diagnostic").items[0].itemKey]: "b" }, answeredCount: 1, revision: 4 });
    const h = harness({ learning_test_attempt_v1: [attempt] });
    const session = new CscaTestSession(h.env, FORM, attempt.attemptId);
    await session.start();
    const state = session.getState();
    expect(h.calls[0].name).toBe("learning_test_attempt_v1");
    expect(state.phase).toBe("running");
    expect(Object.values(state.answers)).toEqual(["b"]);
    expect(state.index).toBe(1); // первое неотвеченное
    session.dispose();
  });

  it("«Продолжить» после срока показывает итог этой попытки, а не новый тест", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const h = harness({ learning_test_attempt_v1: [done] });
    const session = new CscaTestSession(h.env, FORM, done.attemptId);
    await session.start();
    expect(session.getState().phase).toBe("result");
    expect(session.getState().attempt?.result?.correctCount).toBe(0);
    expect(h.calls.map((c) => c.name)).toEqual(["learning_test_attempt_v1"]);
    session.dispose();
  });

  it("старт возвращает завершённую попытку, если черновик формы истёк", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const h = harness({ start_learning_test_v1: [done] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    expect(session.getState().phase).toBe("result");
    session.dispose();
  });
});

describe("сессия: пачки сохранения", () => {
  async function running(extra: Record<string, Reply[]> = {}, attempt = draftAttempt()) {
    const h = harness({ start_learning_test_v1: [attempt], ...extra });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    return { h, session, keys: attempt.items.map((i: { itemKey: string }) => i.itemKey) as string[] };
  }

  it("выбор уходит через 1,5 с; несколько выборов подряд это один запрос", async () => {
    const { h, session, keys } = await running({ save_learning_test_v1: [saveReceipt(2)] });
    session.select(keys[0], "a");
    expect(session.getState().saveStatus).toBe("pending");
    await h.advance(SAVE_ON_CHOICE_MS - 100);
    expect(saves(h.calls)).toHaveLength(0);
    session.select(keys[1], "c");
    await h.advance(SAVE_ON_CHOICE_MS - 1);
    expect(saves(h.calls)).toHaveLength(0);
    await h.advance(10);
    const sent = saves(h.calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].args.p_answers).toEqual({ [keys[0]]: "a", [keys[1]]: "c" });
    expect(sent[0].args.p_expected_revision).toBe(1);
    expect(session.getState().saveStatus).toBe("saved");
    expect(session.debug().revision).toBe(2);
    session.dispose();
  });

  it("следующий запрос несёт ревизию из квитанции и не чаще раза в 2 с", async () => {
    const { h, session, keys } = await running({ save_learning_test_v1: [saveReceipt(2), saveReceipt(3)] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    const firstAt = h.getNow();
    session.select(keys[1], "b");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(saves(h.calls)).toHaveLength(1); // ещё нет 2 с после прошлой отправки
    await h.advance(600);
    expect(saves(h.calls)).toHaveLength(2);
    expect(saves(h.calls)[1].args.p_expected_revision).toBe(2);
    expect(h.getNow() - firstAt).toBeGreaterThanOrEqual(2_000);
    expect(new Set(saves(h.calls).map((c) => c.args.p_request_id)).size).toBe(2);
    session.dispose();
  });

  it("обрыв: повтор тем же замороженным запросом, затем сразу текущее состояние", async () => {
    // Слой RPC повторяет обрыв сам (три отправки одного запроса), затем повторяет сессия.
    const { h, session, keys } = await running({ save_learning_test_v1: [NETWORK, NETWORK, NETWORK, saveReceipt(2), saveReceipt(3)] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(session.getState().saveStatus).toBe("retrying");
    // Пока идёт повтор, выбрано ещё: оно не должно подменить замороженный запрос.
    session.select(keys[1], "d");
    await h.advance(RETRY_MS + 10);
    const sent = saves(h.calls);
    // Четыре отправки одного и того же замороженного запроса: тот же id, то же тело.
    expect(sent.slice(0, 4).every((c) => c.args.p_request_id === sent[0].args.p_request_id)).toBe(true);
    expect(sent.slice(0, 4).every((c) => JSON.stringify(c.args) === JSON.stringify(sent[0].args))).toBe(true);
    expect(sent[3].args.p_answers).toEqual({ [keys[0]]: "a" });
    // Ответ, данный позже, уходит следом новым запросом.
    expect(sent).toHaveLength(5);
    expect(sent[4].args.p_answers).toEqual({ [keys[0]]: "a", [keys[1]]: "d" });
    expect(sent[4].args.p_request_id).not.toBe(sent[0].args.p_request_id);
    expect(session.debug().retry).toBeNull();
    session.dispose();
  });

  it("устаревшая ревизия: сессия перечитывает попытку и показывает сохранённое", async () => {
    const fresh = draftAttempt({ revision: 7, answers: { [draftAttempt().items[0].itemKey]: "c" }, answeredCount: 1 });
    const { h, session, keys } = await running({
      save_learning_test_v1: [err("40001", "Learning attempt changed")],
      learning_test_attempt_v1: [fresh],
    });
    session.select(keys[1], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(session.getState().notice).toBe("conflict");
    expect(session.debug().revision).toBe(7);
    expect(session.getState().answers[keys[0]]).toBe("c");
    session.dispose();
  });

  it("уход в фон сохраняет сразу, время на задании тоже", async () => {
    const { h, session, keys } = await running({ save_learning_test_v1: [saveReceipt(2)] });
    session.select(keys[0], "b");
    await h.advance(500);
    session.onBackground();
    await flushMicrotasks();
    const sent = saves(h.calls);
    expect(sent).toHaveLength(1);
    expect((sent[0].args.p_item_seconds as Record<string, number>)[keys[0]]).toBe(1);
    session.dispose();
  });

  it("срок прошёл: сохранение отвергнуто, тест завершается сохранённым до срока", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const { h, session, keys } = await running({
      save_learning_test_v1: [err("22023", "learning_test_deadline_passed")],
      complete_learning_test_v1: [done],
    });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    await flushMicrotasks();
    expect(session.getState().phase).toBe("result");
    expect(h.calls.some((c) => c.name === "complete_learning_test_v1")).toBe(true);
    session.dispose();
  });
});

describe("сессия: закрытие экрана и возврат из сна", () => {
  async function running(extra: Record<string, Reply[]> = {}) {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], ...extra });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    return { h, session, keys: attempt.items.map((i: { itemKey: string }) => i.itemKey) as string[] };
  }

  it("закрытие экрана досылает несохранённое «по возможности»", async () => {
    const { h, session, keys } = await running({ save_learning_test_v1: [saveReceipt(2)] });
    session.select(keys[0], "a");
    session.dispose(); // свайп назад до срабатывания таймера 1,5 с
    await flushMicrotasks();
    const sent = saves(h.calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].args.p_answers).toEqual({ [keys[0]]: "a" });
  });

  it("возврат из сна: отсчёт сверяется с сервером по свежему serverNow", async () => {
    const { h, session } = await running({
      learning_test_attempt_v1: [draftAttempt({ serverNow: "2026-10-16T10:40:09.712211+00:00", revision: 1 })],
    });
    await h.advance(10_000); // монотонные часы прошли 10 с, а устройство спало почти 4 минуты
    expect(session.getState().remaining).toBe(230);
    session.onForeground();
    await flushMicrotasks();
    expect(session.getState().remaining).toBe(40);
    session.dispose();
  });

  it("возврат из сна: попытка завершена другим путём, виден итог", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const { session } = await running({ learning_test_attempt_v1: [done] });
    session.onForeground();
    await flushMicrotasks();
    expect(session.getState().phase).toBe("result");
    session.dispose();
  });

  it("возврат из сна без связи: прежний отсчёт, ответы не тронуты", async () => {
    const { h, session, keys } = await running({ learning_test_attempt_v1: [NETWORK] });
    session.select(keys[0], "b");
    session.onForeground();
    await flushMicrotasks();
    expect(session.getState().phase).toBe("running");
    expect(session.getState().answers[keys[0]]).toBe("b");
    expect(h.calls.some((c) => c.name === "learning_test_attempt_v1")).toBe(true);
    session.dispose();
  });

  it("конфликт: выборы, сделанные здесь, накладываются поверх сохранённого сервером и уходят следом", async () => {
    const keysOf = draftAttempt().items.map((i: { itemKey: string }) => i.itemKey) as string[];
    const fresh = draftAttempt({ revision: 7, answers: { [keysOf[1]]: "c" }, answeredCount: 1 });
    const { h, session, keys } = await running({
      save_learning_test_v1: [err("40001", "Learning attempt changed"), saveReceipt(8)],
      learning_test_attempt_v1: [fresh],
    });
    session.select(keys[0], "a");
    session.toggleFlag(keys[2]);
    await h.advance(SAVE_ON_CHOICE_MS + 10); // первая отправка: конфликт
    // Выборы поверх сохранённого сервером (не затёрты) и уже уходят следующим запросом.
    expect(session.getState().answers).toEqual({ [keys[1]]: "c", [keys[0]]: "a" });
    expect(session.getState().flags).toEqual([keys[2]]);
    const sent = saves(h.calls);
    expect(sent).toHaveLength(2);
    expect(sent[1].args.p_expected_revision).toBe(7);
    expect(sent[1].args.p_answers).toEqual({ [keys[1]]: "c", [keys[0]]: "a" });
    expect(sent[1].args.p_flags).toEqual([keys[2]]);
    session.dispose();
  });
});

describe("сессия: завершение", () => {
  it("досрочное завершение диагностики сначала досылает несохранённое, потом завершает", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], save_learning_test_v1: [saveReceipt(2)], complete_learning_test_v1: [done] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    session.select(attempt.items[0].itemKey, "a");
    await session.finalize();
    const order = h.calls.map((c) => c.name);
    expect(order.indexOf("save_learning_test_v1")).toBeLessThan(order.indexOf("complete_learning_test_v1"));
    const complete = h.calls.find((c) => c.name === "complete_learning_test_v1");
    expect(complete?.args.p_expected_revision).toBe(2);
    expect(session.getState().phase).toBe("result");
    session.dispose();
  });

  it("нет связи при досрочном завершении: назад к заданиям, ответы не потеряны", async () => {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], save_learning_test_v1: [NETWORK] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    session.select(attempt.items[0].itemKey, "a");
    await session.finalize();
    expect(session.getState().phase).toBe("running");
    expect(session.getState().notice).toBe("finishUnsent");
    expect(h.calls.some((c) => c.name === "complete_learning_test_v1")).toBe(false);
    expect(session.getState().answers[attempt.items[0].itemKey]).toBe("a");
    session.dispose();
  });

  it("пробный тест: по сроку клиент сам завершает; раннее «рано» повторяется, итог показан", async () => {
    const timeout = fx("csca_test_mock_timeout");
    const mock = { ...fx("csca_test_start_mock"), serverNow: "2026-10-16T10:36:49.712211+00:00", deadlineAt: "2026-10-16T10:37:19.712211+00:00" };
    const h = harness({
      start_learning_test_v1: [mock],
      save_learning_test_v1: [saveReceipt(2)],
      complete_learning_test_v1: [err("22023", "learning_test_early_finish_forbidden"), timeout],
    });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    expect(session.getState().attempt?.allowEarlyFinish).toBe(false);
    session.select(mock.items[0].itemKey, "a");
    await h.advance(31_000); // время вышло
    await flushMicrotasks();
    await flushMicrotasks();
    expect(session.getState().phase).toBe("result");
    expect(session.getState().attempt?.completion).toBe("timeout");
    const completes = h.calls.filter((c) => c.name === "complete_learning_test_v1");
    expect(completes.length).toBeGreaterThanOrEqual(2);
    session.dispose();
  });

  it("итог показывает число верных из присланного результата, а не из клиента", async () => {
    const done = fx("csca_test_mock_timeout");
    const h = harness({ start_learning_test_v1: [done] });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    const result = session.getState().attempt?.result;
    expect(result?.correctCount).toBe(2);
    expect(result?.answeredCount).toBe(2);
    expect(result?.pace.budgetSeconds).toBe(75);
    session.dispose();
  });
});

describe("приватность", () => {
  it("тексты серверных ошибок не хранятся ни в состоянии, ни в журнале", async () => {
    const leak = "UNIQUE-SERVER-TEXT";
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], save_learning_test_v1: [err("22023", leak)] });
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const spyErr = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    session.select(attempt.items[0].itemKey, "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(JSON.stringify(session.getState())).not.toContain(leak);
    expect(spy).not.toHaveBeenCalled();
    expect(spyErr).not.toHaveBeenCalled();
    spy.mockRestore();
    spyErr.mockRestore();
    session.dispose();
  });
});
