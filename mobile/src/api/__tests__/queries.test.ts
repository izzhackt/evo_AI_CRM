import { shouldRetry } from "@/api/PortalApi";
import { loadErrorKey, sourceState } from "@/api/queries";
import { PortalDecodeError } from "@/domain/portal-source";
import { RpcError } from "@/lib/rpc";

describe("повторы чтений", () => {
  it("повторяется только обрыв связи, не больше двух раз", () => {
    const offline = new RpcError("transport");
    expect(shouldRetry(0, offline)).toBe(true);
    expect(shouldRetry(1, offline)).toBe(true);
    expect(shouldRetry(2, offline)).toBe(false);
    for (const error of [new RpcError("server"), new RpcError("forbidden"), new PortalDecodeError(), new Error("x")]) expect(shouldRetry(0, error)).toBe(false);
  });
});

describe("состояние источника", () => {
  const base = { isPending: false, isError: false, fetchStatus: "idle", status: "success" };
  it("данные из кэша важнее свежей ошибки", () => {
    expect(sourceState({ ...base, data: [] })).toBe("ready");
    expect(sourceState({ ...base, data: null, status: "error", isError: true })).toBe("ready"); // null = ответ «нет строки»
    expect(sourceState({ ...base, data: undefined, status: "error", isError: true })).toBe("error");
    expect(sourceState({ ...base, data: undefined, status: "pending", isPending: true, fetchStatus: "fetching" })).toBe("loading");
  });
});

describe("строка ошибки загрузки", () => {
  it("связь, сервер, прочее", () => {
    expect(loadErrorKey(new RpcError("transport"))).toBe("error.offline");
    expect(loadErrorKey(new RpcError("server"))).toBe("error.server");
    expect(loadErrorKey(new RpcError("forbidden"))).toBe("error.load");
    expect(loadErrorKey(new PortalDecodeError())).toBe("error.load");
    expect(loadErrorKey(undefined)).toBe("error.load");
  });
});
