import { RpcError, classifyRpcFailure, createWrite, omitNulls, rpcErrorKey, rpcRead, rpcWrite, type RpcTransport } from "@/lib/rpc";

const ok = (data: unknown) => Promise.resolve({ data, error: null, status: 200 });

describe("запись с p_request_id", () => {
  it("добавляет клиентский p_request_id и замораживает запрос", () => {
    const write = createWrite("set_student_country_choice_v1", { p_country: "CN" }, { newId: () => "id-1" });
    expect(write.requestId).toBe("id-1");
    expect(write.args).toEqual({ p_country: "CN", p_request_id: "id-1" });
    expect(Object.isFrozen(write)).toBe(true);
    expect(Object.isFrozen(write.args)).toBe(true);
  });

  it("не принимает p_request_id от вызывающего кода", () => {
    expect(() => createWrite("x", { p_request_id: "mine" })).toThrow();
  });

  it("берёт заданный id (детерминированный UUIDv5 для «прочитано»)", () => {
    expect(createWrite("x", {}, { requestId: "fixed" }).args.p_request_id).toBe("fixed");
  });

  it("аргументы вызывающего кода после создания не влияют на запрос", () => {
    const answers: Record<string, string> = { q1: "a" };
    const write = createWrite("save", { p_answers: answers }, { newId: () => "id" });
    answers.q1 = "b";
    expect(write.args).toEqual({ p_answers: { q1: "a" }, p_request_id: "id" });
  });
});

describe("повтор после обрыва", () => {
  it("отправляет тот же id и те же аргументы, новый id не создаётся", async () => {
    let ids = 0;
    const write = createWrite("complete", { p_attempt_id: "a1", p_expected_revision: 3 }, { newId: () => `id-${++ids}` });
    const seen: unknown[] = [];
    let calls = 0;
    const transport: RpcTransport = (name, args) => {
      seen.push({ name, args });
      calls += 1;
      return calls < 3 ? Promise.reject(new TypeError("Network request failed")) : ok({ done: true });
    };
    await expect(rpcWrite(transport, write, { retries: 2 })).resolves.toEqual({ done: true });
    expect(calls).toBe(3);
    expect(ids).toBe(1);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect((seen[0] as { args: Record<string, unknown> }).args.p_request_id).toBe("id-1");
  });

  it("ответ без кода и без статуса тоже считается обрывом и повторяется", async () => {
    const write = createWrite("w", {}, { newId: () => "id" });
    let calls = 0;
    const transport: RpcTransport = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ data: null, error: { code: "" }, status: 0 }) : ok(1);
    };
    await expect(rpcWrite(transport, write)).resolves.toBe(1);
    expect(calls).toBe(2);
  });

  it("не повторяет конфликт и отказ", async () => {
    const write = createWrite("w", {}, { newId: () => "id" });
    let calls = 0;
    const transport: RpcTransport = () => {
      calls += 1;
      return Promise.resolve({ data: null, error: { code: "40001" }, status: 409 });
    };
    await expect(rpcWrite(transport, write)).rejects.toMatchObject({ kind: "conflict" });
    expect(calls).toBe(1);
  });

  it("после исчерпания повторов отдаёт ошибку обрыва", async () => {
    const write = createWrite("w", {}, { newId: () => "id" });
    const transport: RpcTransport = () => Promise.reject(new Error("offline"));
    await expect(rpcWrite(transport, write, { retries: 1 })).rejects.toMatchObject({ kind: "transport" });
  });
});

describe("ошибки без текстов сервера", () => {
  it("классифицирует коды и не хранит message", async () => {
    expect(classifyRpcFailure("42501", 403).kind).toBe("forbidden");
    expect(classifyRpcFailure("22023", 400).kind).toBe("invalid");
    expect(classifyRpcFailure("PT409", 409).kind).toBe("conflict");
    expect(classifyRpcFailure(null, 503).kind).toBe("server");
    expect(classifyRpcFailure(null, 429).kind).toBe("rate_limited");
    const secret = "relation \"platform.secret_table\" does not exist";
    const transport: RpcTransport = () => Promise.resolve({ data: null, error: { code: "42P01", message: secret } as never, status: 404 });
    const error = await rpcRead(transport, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(JSON.stringify(error)).not.toContain("secret_table");
    expect((error as Error).message).not.toContain("secret_table");
  });

  it("сводит ошибку к ключу словаря", () => {
    expect(rpcErrorKey(new RpcError("transport"))).toBe("error.offline");
    expect(rpcErrorKey(new RpcError("server"))).toBe("error.server");
    expect(rpcErrorKey(new Error("boom"))).toBe("error.generic");
  });
});

describe("чтение", () => {
  it("в GET-режиме опускает null", async () => {
    expect(omitNulls({ a: 1, b: null, c: undefined, d: "x" })).toEqual({ a: 1, d: "x" });
    const calls: unknown[] = [];
    const transport: RpcTransport = (name, args, options) => {
      calls.push({ name, args, options });
      return ok([]);
    };
    await rpcRead(transport, "student_portal_poll_v1", { p_since: null, p_limit: 5 }, { get: true });
    expect(calls[0]).toEqual({ name: "student_portal_poll_v1", args: { p_limit: 5 }, options: { get: true } });
  });
});
