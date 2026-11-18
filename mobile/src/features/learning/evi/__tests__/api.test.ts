import { createEviApi, parseEviActionResult, type EviFetch } from "@/features/learning/evi/api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const HISTORY = [
  { role: "assistant" as const, content: "Привет!" },
  { role: "user" as const, content: "Начнём!" },
];
const ANSWER = { ok: true, answer: { message: "Что любишь?", mood: "talk", options: ["Рисовать"], multi: false, results: null, progress: { step: 1, total: 10 } } };

function harness(respond: (n: number) => Response | Promise<Response>, over: { getToken?: () => Promise<string | null>; refreshToken?: () => Promise<string | null> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: EviFetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length);
  };
  const api = createEviApi({ baseUrl: "https://portal.example.test/", getToken: over.getToken ?? (async () => "tok-1"), refreshToken: over.refreshToken, fetch });
  return { api, calls };
}

describe("POST /api/portal/mobile/evi: запрос", () => {
  it("шлёт Bearer, историю и язык; другого адреса и других полей нет", async () => {
    const { api, calls } = harness(() => json(200, ANSWER));
    const result = await api.ask(HISTORY, "ky");
    expect(result).toEqual(ANSWER);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://portal.example.test/api/portal/mobile/evi");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ history: HISTORY, locale: "ky" });
  });

  it("нет токена: сети не касается, исход «error»", async () => {
    const { api, calls } = harness(() => json(200, ANSWER), { getToken: async () => null });
    await expect(api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason: "error" });
    expect(calls).toHaveLength(0);
  });

  it("401: сессия обновляется один раз и запрос повторяется с новым токеном; второй 401 - «error»", async () => {
    const refresh = jest.fn(async () => "tok-2");
    const first = harness((n) => (n === 1 ? json(401, { error: "unauthorized" }) : json(200, ANSWER)), { refreshToken: refresh });
    await expect(first.api.ask(HISTORY, "ru")).resolves.toEqual(ANSWER);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((first.calls[1]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-2");
    const second = harness(() => json(401, {}), { refreshToken: async () => "tok-2" });
    await expect(second.api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason: "error" });
    expect(second.calls).toHaveLength(2);
    const noRefresh = harness(() => json(401, {}), { refreshToken: async () => null });
    await expect(noRefresh.api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason: "error" });
    expect(noRefresh.calls).toHaveLength(1);
  });
});

describe("исходы", () => {
  it.each([
    [403, "unavailable"],
    [429, "busy"],
    [400, "invalid"],
    [503, "error"],
    [500, "error"],
  ] as const)("HTTP %s -> %s", async (status, reason) => {
    const { api } = harness(() => json(status, { error: "x" }));
    await expect(api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason });
  });

  it("исходы разговора приходят как есть: consent, busy, limit...", async () => {
    for (const reason of ["consent", "unavailable", "limit", "busy", "invalid", "error"] as const) {
      const { api } = harness(() => json(200, { ok: false, reason }));
      await expect(api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason });
    }
  });

  it("обрыв сети и не-JSON: «error», без исключения", async () => {
    const offline = createEviApi({ baseUrl: "https://portal.example.test", getToken: async () => "t", fetch: async () => { throw new TypeError("network"); } });
    await expect(offline.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason: "error" });
    const html = harness(() => new Response("<html>", { status: 200 }));
    await expect(html.api.ask(HISTORY, "ru")).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("разбор ответа", () => {
  it("итог с тремя профессиями разбирается; прогресс и сводка по форме", () => {
    const results = [1, 2, 3].map((n) => ({ cardId: `id-${n}`, cardKey: `key-${n}`, title: `Профессия ${n}`, summary: n === 2 ? null : "Чем занимается", why: "Подходит." }));
    const parsed = parseEviActionResult({ ok: true, answer: { message: "Придумал!", mood: "eureka", options: [], multi: false, results, progress: null } });
    expect(parsed).toEqual({ ok: true, answer: { message: "Придумал!", mood: "eureka", options: [], multi: false, results, progress: null } });
  });

  it("чужая форма - не ответ, а «не получилось»", () => {
    expect(parseEviActionResult(null)).toBeNull();
    expect(parseEviActionResult({ ok: true })).toBeNull();
    expect(parseEviActionResult({ ok: false, reason: "teapot" })).toBeNull();
    expect(parseEviActionResult({ ok: true, answer: { ...ANSWER.answer, mood: "angry" } })).toBeNull();
    expect(parseEviActionResult({ ok: true, answer: { ...ANSWER.answer, message: "" } })).toBeNull();
    expect(parseEviActionResult({ ok: true, answer: { ...ANSWER.answer, options: [1] } })).toBeNull();
    expect(parseEviActionResult({ ok: true, answer: { ...ANSWER.answer, results: [{ cardId: "a" }] } })).toBeNull();
  });
});
