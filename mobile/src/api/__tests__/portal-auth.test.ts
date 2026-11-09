import { createPortalAuthApi, type FetchLike } from "@/api/portal-auth";

type Call = { url: string; init: RequestInit };

function api(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return { api: createPortalAuthApi({ baseUrl: "https://portal.example.test/", fetch }), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sessionBody = { access_token: "at", refresh_token: "rt", expires_at: 1790000000, expires_in: 3600, token_type: "bearer" };

describe("signIn", () => {
  it("шлёт логин и пароль на /api/portal/mobile/session и разбирает 200", async () => {
    const { api: a, calls } = api(() => json(200, { ...sessionBody, must_set_password: true }));
    const result = await a.signIn("ivan.petrov", "pw");
    expect(calls[0]?.url).toBe("https://portal.example.test/api/portal/mobile/session");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ login: "ivan.petrov", password: "pw" });
    expect(result).toEqual({
      ok: true,
      session: { accessToken: "at", refreshToken: "rt", expiresAt: 1790000000, expiresIn: 3600, tokenType: "bearer", mustSetPassword: true },
    });
  });

  it("must_set_password по умолчанию false", async () => {
    const { api: a } = api(() => json(200, sessionBody));
    const result = await a.signIn("a@b.test", "pw");
    expect(result.ok && result.session.mustSetPassword).toBe(false);
  });

  it.each([
    [401, "invalid_credentials"],
    [403, "staff_account"],
    [429, "rate_limited"],
    [400, "invalid_request"],
    [500, "unavailable"],
    [302, "unavailable"],
  ] as const)("HTTP %i -> %s", async (status, reason) => {
    const { api: a } = api(() => json(status, { error: "server text must be ignored" }));
    await expect(a.signIn("l", "p")).resolves.toEqual({ ok: false, reason });
  });

  it("200 с неполным телом считается недоступностью", async () => {
    const { api: a } = api(() => json(200, { access_token: "at" }));
    await expect(a.signIn("l", "p")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("обрыв сети -> network, без исключения", async () => {
    const { api: a } = api(() => {
      throw new TypeError("Network request failed");
    });
    await expect(a.signIn("l", "p")).resolves.toEqual({ ok: false, reason: "network" });
  });
});

describe("requestPasswordRecovery", () => {
  it("200 {ok:true} -> ok, тело {email}, без Authorization", async () => {
    const { api: a, calls } = api(() => json(200, { ok: true }));
    await expect(a.requestPasswordRecovery("a@b.test")).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://portal.example.test/api/portal/password-recovery");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ email: "a@b.test" });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("429 -> rate_limited, прочее -> unavailable", async () => {
    await expect(api(() => json(429, {})).api.requestPasswordRecovery("a@b.test")).resolves.toEqual({ ok: false, reason: "rate_limited" });
    await expect(api(() => json(500, {})).api.requestPasswordRecovery("a@b.test")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(api(() => json(200, { ok: false })).api.requestPasswordRecovery("a@b.test")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("setOwnPassword", () => {
  it("шлёт Bearer и {password}", async () => {
    const { api: a, calls } = api(() => json(200, { ok: true }));
    const fresh = "synthetic-new-value";
    await expect(a.setOwnPassword("tok", fresh)).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://portal.example.test/api/portal/mobile/password");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ password: fresh });
  });

  it.each([
    [400, "weak_password"],
    [401, "unauthorized"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ] as const)("HTTP %i -> %s", async (status, reason) => {
    await expect(api(() => json(status, {})).api.setOwnPassword("t", "p")).resolves.toEqual({ ok: false, reason });
  });
});
