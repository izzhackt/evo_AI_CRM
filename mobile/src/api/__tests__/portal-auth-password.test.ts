import { createPortalAuthApi, type FetchLike } from "@/api/portal-auth";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function api(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    return respond();
  };
  return { api: createPortalAuthApi({ baseUrl: "https://portal.example.test", fetch }), calls };
}

const OLD = "o".repeat(8);
const NEW = "n".repeat(14);

describe("changeOwnPassword: контракт POST /api/portal/mobile/password", () => {
  it("шлёт Bearer, новый пароль и текущий; 200 {ok:true} — успех", async () => {
    const { api: a, calls } = api(() => json(200, { ok: true }));
    await expect(a.changeOwnPassword("tok", OLD, NEW)).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://portal.example.test/api/portal/mobile/password");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ password: NEW, current_password: OLD });
  });

  it("503 revoke_failed с password_changed — успех (пароль уже сменён)", async () => {
    const { api: a } = api(() => json(503, { error: "revoke_failed", password_changed: true }));
    await expect(a.changeOwnPassword("t", "o", "n")).resolves.toEqual({ ok: true });
  });

  it("503 без password_changed и другие 503 — не успех", async () => {
    const one = api(() => json(503, { error: "revoke_failed" }));
    await expect(one.api.changeOwnPassword("t", "o", "n")).resolves.toEqual({ ok: false, reason: "unavailable" });
    const two = api(() => json(503, { error: "unavailable" }));
    await expect(two.api.changeOwnPassword("t", "o", "n")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([
    [400, { error: "weak_password" }, "weak_password"],
    [400, { error: "same_password" }, "same_password"],
    [400, { error: "invalid_request" }, "invalid_request"],
    [403, { error: "invalid_current_password" }, "wrong_current"],
    [403, { error: "staff_account" }, "staff_account"],
    [401, { error: "unauthorized" }, "unauthorized"],
    [429, { error: "rate_limited" }, "rate_limited"],
    [500, {}, "unavailable"],
  ] as const)("HTTP %i %j -> %s", async (status, body, reason) => {
    const { api: a } = api(() => json(status, body));
    await expect(a.changeOwnPassword("t", "o", "n")).resolves.toEqual({ ok: false, reason });
  });

  it("обрыв связи — network, тела ответа сервера наружу не идут", async () => {
    const a = createPortalAuthApi({ baseUrl: "https://p.test", fetch: async () => { throw new Error("secret server text"); } });
    await expect(a.changeOwnPassword("t", "o", "n")).resolves.toEqual({ ok: false, reason: "network" });
  });
});
