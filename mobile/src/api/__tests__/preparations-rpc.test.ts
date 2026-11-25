// Прямой вызов транспорта для RPC программ: итог без исключений, повтор того же запроса, текст сервера дальше разборщика не идёт.
import { callRpc, failureForParser } from "@/api/preparations-rpc";
import type { RpcTransport, RpcTransportResult } from "@/lib/rpc";

function scripted(results: (RpcTransportResult | Error)[]) {
  const calls: { name: string; args: unknown; get: boolean }[] = [];
  const transport: RpcTransport = async (name, args, options) => {
    calls.push({ name, args, get: options.get });
    const next = results.shift();
    if (next === undefined) throw new Error("no more scripted results");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}

const noWait = async () => undefined;
const ok = (data: unknown): RpcTransportResult => ({ data, error: null, status: 200 });
const bad = (code: string | null, status: number, message: string | null = null): RpcTransportResult => ({ data: null, error: { code, message }, status });

describe("callRpc", () => {
  it("успех: данные как есть, вызов методом POST", async () => {
    const { transport, calls } = scripted([ok({ a: 1 })]);
    expect(await callRpc(transport, "x_v1", { p: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(calls).toEqual([{ name: "x_v1", args: { p: 1 }, get: false }]);
  });

  it("ответ с ошибкой: код, текст и статус только для разборщика; это не обрыв", async () => {
    const { transport } = scripted([bad("PT409", 409, "application_requirements_case_ineligible")]);
    expect(await callRpc(transport, "x_v1", {})).toEqual({
      ok: false,
      transport: false,
      failure: { code: "PT409", message: "application_requirements_case_ineligible", status: 409 },
    });
  });

  it("транспорт бросил: итог «обрыв», исключения наружу нет", async () => {
    const { transport } = scripted([new Error("Network request failed")]);
    expect(await callRpc(transport, "x_v1", {})).toEqual({ ok: false, transport: true, failure: { code: null, message: null, status: null } });
  });

  it("ответ без кода и со статусом 0 - тоже обрыв (так supabase-js сообщает о сети)", async () => {
    const { transport } = scripted([{ data: null, error: { code: "", message: "TypeError: Network request failed" }, status: 0 }]);
    const outcome = await callRpc(transport, "x_v1", {});
    expect(outcome).toMatchObject({ ok: false, transport: true });
  });

  it("повторяет тот же запрос при обрыве и шлюзовых 502/503/504 ровно столько раз, сколько разрешено", async () => {
    const { transport, calls } = scripted([new Error("x"), bad(null, 503), ok("done")]);
    const waits: number[] = [];
    const outcome = await callRpc(transport, "x_v1", { p_request_id: "r" }, { retries: 2, wait: async (attempt) => void waits.push(attempt) });
    expect(outcome).toEqual({ ok: true, data: "done" });
    expect(calls.map((c) => c.args)).toEqual([{ p_request_id: "r" }, { p_request_id: "r" }, { p_request_id: "r" }]);
    expect(waits).toEqual([0, 1]);
  });

  it("не повторяет отказ сервера (конфликт, запрет, 500) и не выходит за предел повторов", async () => {
    for (const result of [bad("PT409", 409), bad("42501", 403), bad("PT500", 500), bad("22023", 400)]) {
      const { transport, calls } = scripted([result]);
      const outcome = await callRpc(transport, "x_v1", {}, { retries: 3, wait: noWait });
      expect(outcome).toMatchObject({ ok: false, transport: false });
      expect(calls).toHaveLength(1);
    }
    const { transport, calls } = scripted([new Error("a"), new Error("b"), new Error("c"), new Error("d")]);
    const outcome = await callRpc(transport, "x_v1", {}, { retries: 2, wait: noWait });
    expect(outcome).toMatchObject({ ok: false, transport: true });
    expect(calls).toHaveLength(3);
  });

  it("без своей паузы повторы идут с паузами 250, 500 и 1000 мс, а не подряд", async () => {
    jest.useFakeTimers();
    try {
      const { transport, calls } = scripted([new Error("a"), new Error("b"), bad(null, 503), ok("done")]);
      const pending = callRpc(transport, "x_v1", { p_request_id: "r" }, { retries: 3 });
      await jest.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(249);
      expect(calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(499);
      expect(calls).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(3);
      await jest.advanceTimersByTimeAsync(999);
      expect(calls).toHaveLength(3);
      await jest.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: true, data: "done" });
      // тот же запрос с теми же аргументами на каждой попытке
      expect(new Set(calls.map((c) => JSON.stringify(c.args))).size).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("пауза дольше четвёртой попытки остаётся секундой", async () => {
    jest.useFakeTimers();
    try {
      const { transport, calls } = scripted([new Error("a"), new Error("b"), new Error("c"), new Error("d"), ok(1)]);
      const pending = callRpc(transport, "x_v1", {}, { retries: 4 });
      await jest.advanceTimersByTimeAsync(250 + 500 + 1000);
      expect(calls).toHaveLength(4);
      await jest.advanceTimersByTimeAsync(999);
      expect(calls).toHaveLength(4);
      await jest.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: true, data: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("без разрешённых повторов запрос уходит один раз", async () => {
    const { transport, calls } = scripted([new Error("a"), ok(1)]);
    expect(await callRpc(transport, "x_v1", {})).toMatchObject({ ok: false, transport: true });
    expect(calls).toHaveLength(1);
  });
});

describe("failureForParser", () => {
  it("передаёт разборщику только то, что есть", () => {
    expect(failureForParser({ code: "PT409", message: "m", status: 409 })).toEqual({ code: "PT409", message: "m" });
    expect(failureForParser({ code: null, message: null, status: null })).toEqual({});
    expect(failureForParser({ code: "42501", message: null, status: 403 })).toEqual({ code: "42501" });
  });
});
