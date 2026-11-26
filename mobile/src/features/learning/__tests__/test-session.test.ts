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
  return { env, calls, advance, setNow: (v: number) => (now = v), getNow: () => now, pendingTimers: () => timers.size };
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

  describe("выход с экрана, пока идёт запрос запуска", () => {
    /** Транспорт, который придерживает ответы, пока тест не отпустит: ученик успевает уйти с экрана до ответа сервера. */
    function held(replies: Record<string, Reply[]>) {
      const h = harness(replies);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const env: SessionEnv = { ...h.env, transport: async (name, args, options) => (await gate, h.env.transport(name, args, options)) };
      return { h, env, release: () => release() };
    }

    it("новый запуск: после ответа сервера часы не заводятся, таймеров нет, сохранений нет", async () => {
      const { h, env, release } = held({ start_learning_test_v1: [draftAttempt()] });
      const session = new CscaTestSession(env, FORM, null);
      const starting = session.start();
      expect(session.getState().phase).toBe("starting");
      session.dispose(); // «К темам» или стрелка «назад» до ответа сервера
      release();
      await starting;
      await h.advance(5_000);
      expect(h.pendingTimers()).toBe(0);
      expect(session.getState().phase).toBe("starting"); // экрана нет, показывать некому
      expect(h.calls.map((call) => call.name)).toEqual(["start_learning_test_v1"]);
    });

    it("«Продолжить тест»: чтение черновика после ухода с экрана тоже не заводит часы", async () => {
      const attempt = draftAttempt();
      const { h, env, release } = held({ learning_test_attempt_v1: [attempt] });
      const session = new CscaTestSession(env, FORM, attempt.attemptId);
      const starting = session.start();
      session.dispose();
      release();
      await starting;
      await h.advance(5_000);
      expect(h.pendingTimers()).toBe(0);
      expect(h.calls.map((call) => call.name)).toEqual(["learning_test_attempt_v1"]);
    });

    it("ушли после того, как тест уже идёт: часы остановлены закрытием, как раньше", async () => {
      const h = harness({ start_learning_test_v1: [draftAttempt()] });
      const session = new CscaTestSession(h.env, FORM, null);
      await session.start();
      expect(h.pendingTimers()).toBeGreaterThan(0); // часы идут
      session.dispose();
      await h.advance(5_000);
      expect(h.pendingTimers()).toBe(0);
    });
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

describe("сессия: выход из аккаунта (QA 23: `save_learning_test_v1` сразу после `/auth/v1/logout` кончался 401)", () => {
  const SAVE_RPC = "save_learning_test_v1";
  const COMPLETE_RPC = "complete_learning_test_v1";
  type Wrap = (session: () => CscaTestSession, inner: RpcTransport) => RpcTransport;
  async function running(extra: Record<string, Reply[]> = {}, wrap?: Wrap) {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], ...extra });
    let session!: CscaTestSession;
    const env: SessionEnv = wrap ? { ...h.env, transport: wrap(() => session, h.env.transport) } : h.env;
    session = new CscaTestSession(env, FORM, null);
    await session.start();
    return { h, session, keys: attempt.items.map((i: { itemKey: string }) => i.itemKey) as string[] };
  }
  const total = (h: { calls: Call[] }, name: string) => h.calls.filter((c) => c.name === name).length;

  it("выбор не отправлен, выход, затем закрытие экрана: запись не уходит, таймеров не остаётся", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [saveReceipt(2)] });
    session.select(keys[0], "a");
    expect(h.pendingTimers()).toBeGreaterThan(0);
    session.abandon();
    expect(h.pendingTimers()).toBe(0);
    session.dispose(); // экран закрывается следом и раньше досылал бы выбор
    await h.advance(60_000);
    expect(total(h, SAVE_RPC)).toBe(0);
    expect(h.pendingTimers()).toBe(0);
  });

  it("без выхода то же закрытие экрана досылает выбор (чтобы тест выше проверял именно выход)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [saveReceipt(2)] });
    session.select(keys[0], "a");
    session.dispose();
    await flushMicrotasks();
    expect(total(h, SAVE_RPC)).toBe(1);
  });

  it("идёт повтор после обрыва: выход гасит таймер повтора, новых запросов нет", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(session.getState().saveStatus).toBe("retrying");
    const sent = total(h, SAVE_RPC);
    expect(sent).toBeGreaterThan(0);
    expect(h.pendingTimers()).toBeGreaterThan(1); // отсчёт и повтор
    session.abandon();
    expect(h.pendingTimers()).toBe(0);
    await h.advance(RETRY_MS * 4);
    expect(total(h, SAVE_RPC)).toBe(sent);
  });

  it("запрос уже в полёте и обрывается после выхода: повтор не заводится (ни таймера, ни перечитывания)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK] }, (get, inner) => async (name, args, options) => {
      if (name === SAVE_RPC) get().abandon(); // студент вышел, пока запрос шёл
      return inner(name, args, options);
    });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    await flushMicrotasks();
    const sent = total(h, SAVE_RPC);
    expect(sent).toBeGreaterThan(0);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(RETRY_MS * 4);
    expect(total(h, SAVE_RPC)).toBe(sent);
    expect(total(h, "learning_test_attempt_v1")).toBe(0);
  });

  it("конфликт приходит уже после выхода: попытку не перечитывают с отозванным токеном", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [err("40001", "Learning attempt changed")] }, (get, inner) => async (name, args, options) => {
      if (name === SAVE_RPC) get().abandon();
      return inner(name, args, options);
    });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    await flushMicrotasks();
    expect(total(h, SAVE_RPC)).toBe(1);
    expect(total(h, "learning_test_attempt_v1")).toBe(0);
    expect(session.getState().notice).toBeNull();
  });

  it("после выхода «Начать», сохранение, завершение, фон и сверка часов ничего не шлют", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [saveReceipt(2)], [COMPLETE_RPC]: [fx("csca_test_complete_diagnostic")] });
    session.abandon();
    session.select(keys[0], "a"); // экран после выхода замер, записи и таймеров нет
    expect(h.pendingTimers()).toBe(0);
    await session.flush({ settle: true });
    await session.finalize();
    session.onBackground();
    session.onForeground();
    await session.resyncClock();
    await h.advance(60_000);
    expect(h.calls.map((c) => c.name)).toEqual(["start_learning_test_v1"]);

    const idle = harness({ start_learning_test_v1: [draftAttempt()] });
    const fresh = new CscaTestSession(idle.env, FORM, null);
    fresh.abandon();
    await fresh.start(); // кнопку «Начать» успели нажать, пока шёл выход
    expect(idle.calls).toHaveLength(0);
    expect(fresh.getState().phase).toBe("intro");
  });

  it("выход, пока ждали прошлый запрос: следующее сохранение не уходит", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered = 0;
    const { h, session, keys } = await running({ [SAVE_RPC]: [saveReceipt(2)] }, (_get, inner) => async (name, args, options) => {
      if (name === SAVE_RPC && (entered += 1) === 1) await held; // первый запрос не закончен, пока тест его не отпустит
      return inner(name, args, options);
    });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10); // первый запрос ушёл и ждёт ответа
    expect(entered).toBe(1);
    session.select(keys[1], "b"); // новый выбор, ещё не отправленный
    const waiting = session.flush(); // ждёт конца первого запроса
    session.abandon();
    release();
    await waiting;
    await flushMicrotasks();
    expect(total(h, SAVE_RPC)).toBe(1);
  });

  it("выход, пока шёл запрос завершения, и сервер ответил конфликтом: попытку не перечитывают с отозванным токеном", async () => {
    const { h, session } = await running(
      { [COMPLETE_RPC]: [err("40001", "Learning attempt changed")], learning_test_attempt_v1: [draftAttempt()] },
      (get, inner) => async (name, args, options) => {
        if (name === COMPLETE_RPC) get().abandon();
        return inner(name, args, options);
      },
    );
    await session.finalize();
    await flushMicrotasks();
    expect(total(h, COMPLETE_RPC)).toBe(1);
    expect(total(h, "learning_test_attempt_v1")).toBe(0);
  });

  it("выход до завершения при несохранённом выборе и истёкшем времени: цикл ожидания не заводится (раньше он ждал до конца запаса, ничего не отправляя)", async () => {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt] });
    const waits: number[] = [];
    const env: SessionEnv = {
      ...h.env,
      wait: async (ms) => {
        waits.push(ms);
        await h.env.wait(ms);
      },
    };
    const session = new CscaTestSession(env, FORM, null);
    await session.start();
    session.select(attempt.items[0].itemKey, "a"); // не отправлено
    session.abandon();
    h.setNow(h.getNow() + 245_000); // срок (4 минуты) вышел, запас ещё идёт
    await session.finalize();
    expect(waits).toEqual([]);
    expect(h.calls.map((c) => c.name)).toEqual(["start_learning_test_v1"]);
  });

  it("выход посреди завершения: запрос завершения не повторяется (раньше шёл до 12 раз с отозванным токеном)", async () => {
    const { h, session } = await running({ [COMPLETE_RPC]: [NETWORK] }, (get, inner) => async (name, args, options) => {
      if (name === COMPLETE_RPC) get().abandon();
      return inner(name, args, options);
    });
    await session.finalize();
    await flushMicrotasks();
    const sent = total(h, COMPLETE_RPC);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThanOrEqual(3); // одна отправка с повторами слоя RPC, второго круга нет
    await h.advance(60_000);
    expect(total(h, COMPLETE_RPC)).toBe(sent);
  });
});

describe("сессия: после закрытия экрана ничего не заводится (повторы, таймеры, завершение)", () => {
  const SAVE_RPC = "save_learning_test_v1";
  const COMPLETE_RPC = "complete_learning_test_v1";
  const READ_RPC = "learning_test_attempt_v1";
  const ofName = (h: { calls: Call[] }, name: string) => h.calls.filter((c) => c.name === name);
  const keysOf = (attempt: { items: { itemKey: string }[] }) => attempt.items.map((i) => i.itemKey);

  async function running(extra: Record<string, Reply[]> = {}) {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], ...extra });
    const session = new CscaTestSession(h.env, FORM, null);
    await session.start();
    return { h, session, keys: keysOf(attempt) };
  }

  /** Первый запрос сохранения не заканчивается, пока тест его не отпустит: так экран закрывается при запросе «в полёте». */
  async function runningWithHeldSave(extra: Record<string, Reply[]>) {
    const attempt = draftAttempt();
    const h = harness({ start_learning_test_v1: [attempt], ...extra });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered = 0;
    const transport: RpcTransport = async (name, args, options) => {
      if (name === SAVE_RPC && (entered += 1) === 1) await held;
      return h.env.transport(name, args, options);
    };
    const session = new CscaTestSession({ ...h.env, transport }, FORM, null);
    await session.start();
    return { h, session, keys: keysOf(attempt), release: () => release(), entered: () => entered };
  }

  it("закрытие экрана без связи: одна досылка, а повторов по таймеру нет, сколько бы времени ни прошло (раньше запрос шёл каждые 3 с, пока не пройдёт)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK] });
    session.select(keys[0], "a"); // не отправлено
    session.dispose();
    await flushMicrotasks();
    const sent = ofName(h, SAVE_RPC).length;
    expect(sent).toBe(3); // три попытки слоя RPC одного запроса
    expect(h.pendingTimers()).toBe(0);
    await h.advance(RETRY_MS * 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(sent);
    expect(h.pendingTimers()).toBe(0);
  });

  it("пока экран открыт, повтор после обрыва идёт по таймеру как раньше (защита касается только закрытого экрана)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(3);
    expect(h.pendingTimers()).toBeGreaterThan(1); // отсчёт и повтор
    await h.advance(RETRY_MS + 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(6);
    await h.advance(RETRY_MS + 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(9);
    session.dispose();
  });

  it("двойное закрытие экрана шлёт один раз (второй вызов `dispose` ничего не делает)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK] });
    session.select(keys[0], "a");
    session.dispose();
    session.dispose();
    await flushMicrotasks();
    expect(ofName(h, SAVE_RPC)).toHaveLength(3);
    expect(h.pendingTimers()).toBe(0);
  });

  it("запрос в полёте, экран закрыт, затем ответ «нет связи»: повтор не заводится, состояние экрана не тронуто", async () => {
    const { h, session, keys, release, entered } = await runningWithHeldSave({ [SAVE_RPC]: [NETWORK] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(entered()).toBe(1); // запрос ушёл и висит
    const before = session.getState();
    session.dispose();
    release(); // ответ пришёл уже после закрытия
    await flushMicrotasks();
    const sent = ofName(h, SAVE_RPC).length;
    expect(sent).toBe(6); // три попытки висевшего запроса и досылка при закрытии (тот же запрос ещё раз)
    expect(h.pendingTimers()).toBe(0);
    await h.advance(RETRY_MS * 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(sent);
    expect(session.getState()).toBe(before);
  });

  it("запрос в полёте, экран закрыт, затем ответ «принято»: ничего не заводится, состояние экрана не тронуто (так и было: проверка не даёт это сломать)", async () => {
    const { h, session, keys, release, entered } = await runningWithHeldSave({ [SAVE_RPC]: [saveReceipt(2)] });
    session.select(keys[0], "a");
    await h.advance(SAVE_ON_CHOICE_MS + 10);
    expect(entered()).toBe(1);
    const before = session.getState();
    session.dispose();
    release();
    await flushMicrotasks();
    expect(ofName(h, SAVE_RPC)).toHaveLength(1);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(RETRY_MS * 10);
    expect(ofName(h, SAVE_RPC)).toHaveLength(1);
    expect(session.getState()).toBe(before);
    expect(session.debug().revision).toBe(2); // внутренняя ревизия идёт дальше: завершение, начатое до закрытия, ждёт её
  });

  it("сервер отвечает конфликтом уже после закрытия экрана (и ответит так всегда): одно перечитывание и тишина, повторных отправок по кругу нет", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [err("40001", "Learning attempt changed")], [READ_RPC]: [draftAttempt()] });
    session.select(keys[0], "a");
    session.dispose();
    await flushMicrotasks();
    expect(ofName(h, SAVE_RPC)).toHaveLength(1);
    expect(ofName(h, READ_RPC)).toHaveLength(1);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(60_000);
    expect(ofName(h, SAVE_RPC)).toHaveLength(1);
    expect(ofName(h, READ_RPC)).toHaveLength(1);
  });

  it("выбор после закрытия экрана (опоздавший ввод) таймера сохранения не заводит", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [saveReceipt(2)] });
    session.dispose();
    session.select(keys[0], "b");
    session.toggleFlag(keys[0]);
    expect(h.pendingTimers()).toBe(0);
    await h.advance(60_000);
    expect(ofName(h, SAVE_RPC)).toHaveLength(0);
  });

  it("ответ «срок прошёл» уже после закрытия экрана: нового завершения не начинается (сервер завершит попытку при следующем чтении)", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [err("22023", "learning_test_deadline_passed")], [COMPLETE_RPC]: [fx("csca_test_complete_diagnostic")] });
    session.select(keys[0], "a");
    session.dispose();
    await flushMicrotasks();
    expect(ofName(h, SAVE_RPC)).toHaveLength(1);
    expect(ofName(h, COMPLETE_RPC)).toHaveLength(0);
  });

  it("экран закрыт посреди досрочного завершения, а отправка не прошла: неотправленное остаётся помеченным, завершение без этих ответов не уходит, таймеров нет", async () => {
    const { h, session, keys } = await running({ [SAVE_RPC]: [NETWORK], [COMPLETE_RPC]: [fx("csca_test_complete_diagnostic")] });
    session.select(keys[0], "a");
    const finishing = session.finalize();
    session.dispose();
    await finishing;
    await flushMicrotasks();
    expect(ofName(h, COMPLETE_RPC)).toHaveLength(0);
    expect(h.pendingTimers()).toBe(0);
    expect(session.debug().retry).not.toBeNull(); // замороженный запрос на месте: завершение ждёт его
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
