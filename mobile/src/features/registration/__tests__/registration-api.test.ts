import { INVITE, validDraft } from "@/test-fixtures/registration";
import {
  createRegistrationApi,
  mapRegisterResponse,
  mapResendResponse,
  parsePending,
  REGISTRATION_FLOW_HEADER,
  REGISTRATION_FLOW_VERSION,
} from "@/features/registration/registration-api";

const PENDING = { status: "pending_confirmation", maskedEmail: "t***@example.test", expiresAt: "2026-11-10T00:00:00Z", retryAfterSeconds: 60, dispatch: "accepted", resendCapability: "cap.synthetic_123" };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return { status, json: async () => body } as Response;
  };
  return { fetch, calls };
}

describe("запрос регистрации", () => {
  it("шлёт заголовок потока v2 и ровно пять ключей, пароль только в теле", async () => {
    const { fetch, calls } = fakeFetch(202, PENDING);
    const api = createRegistrationApi({ baseUrl: "http://localhost:46430/", fetch });
    const result = await api.register({ email: "t@example.test", password: "q".repeat(16), questionnaire: validDraft(), invite: INVITE });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("http://localhost:46430/api/portal/registration");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers[REGISTRATION_FLOW_HEADER]).toBe("email-confirmation-v2");
    expect(REGISTRATION_FLOW_VERSION).toBe("email-confirmation-v2");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(calls[0].init.body));
    expect(Object.keys(body).sort().join(",")).toBe("aiConsent,email,invite,password,questionnaire");
    expect(body.aiConsent).toBe(true);
    expect(body.invite).toBe(INVITE);
    expect(calls[0].url).not.toContain("qqqq");
  });

  it("обрыв связи — network, а не исключение", async () => {
    const api = createRegistrationApi({ baseUrl: "http://x.test", fetch: async () => { throw new Error("offline"); } });
    expect(await api.register({ email: "a@b.cd", password: "p", questionnaire: {}, invite: INVITE })).toEqual({ ok: false, reason: "network" });
    expect(await api.resend("cap")).toEqual({ ok: false, reason: "network" });
  });
});

describe("статусы регистрации", () => {
  it("202 pending_confirmation", () => {
    const result = mapRegisterResponse(202, PENDING);
    expect(result).toEqual({ ok: true, pending: { maskedEmail: "t***@example.test", expiresAt: "2026-11-10T00:00:00Z", retryAfterSeconds: 60, dispatch: "accepted", resendCapability: "cap.synthetic_123" } });
  });
  it("202 с чужой формой — сбой, не успех", () => {
    expect(mapRegisterResponse(202, { status: "pending_confirmation" })).toEqual({ ok: false, reason: "unavailable" });
    expect(mapRegisterResponse(202, null)).toEqual({ ok: false, reason: "unavailable" });
    expect(parsePending({ ...PENDING, dispatch: "weird" })).toBeNull();
    expect(parsePending({ ...PENDING, retryAfterSeconds: -1 })).toBeNull();
    expect(parsePending({ ...PENDING, retryAfterSeconds: null })?.retryAfterSeconds).toBeNull();
  });
  it.each([
    [400, { status: "invalid" }, "invalid"],
    [400, { status: "password" }, "password"],
    [400, { status: "password_too_long" }, "password_too_long"],
    [403, { status: "invite" }, "invite"],
    [409, { status: "conflict" }, "conflict"],
    [426, { status: "upgrade_required" }, "upgrade_required"],
    [429, { status: "rate_limit" }, "rate_limit"],
    [503, { status: "create_unknown" }, "create_unknown"],
    [503, { status: "unavailable" }, "unavailable"],
    [500, null, "unavailable"],
  ])("HTTP %s %j -> %s", (status, body, reason) => {
    expect(mapRegisterResponse(status, body)).toEqual({ ok: false, reason });
  });
  it.each([
    [200, "confirmed"],
    [409, "account_conflict"],
    [410, "expired"],
    [426, "upgrade_required"],
    [429, "rate_limit"],
    [400, "invalid"],
    [503, "unavailable"],
  ])("повторная отправка HTTP %s -> %s", (status, reason) => {
    expect(mapResendResponse(status, {})).toEqual({ ok: false, reason });
  });
  it("повторная отправка 202 даёт новое ожидание", () => {
    expect(mapResendResponse(202, PENDING).ok).toBe(true);
  });
});

describe("invite-acceptance", () => {
  it("Bearer, имя и поток", async () => {
    const { fetch, calls } = fakeFetch(200, { status: "accepted", intakeFlow: "anketa_v1", accountPending: false, displayName: " Тест Студентов " });
    const api = createRegistrationApi({ baseUrl: "http://x.test", fetch });
    const result = await api.acceptInvite("synthetic-access");
    expect(result).toEqual({ ok: true, acceptance: { intakeFlow: "anketa_v1", accountPending: false, displayName: "Тест Студентов" } });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-access");
  });
  it("любой сбой — просто ok:false", async () => {
    const api = createRegistrationApi({ baseUrl: "http://x.test", fetch: fakeFetch(409, { status: "mismatch" }).fetch });
    expect(await api.acceptInvite("t")).toEqual({ ok: false });
  });
});

// Проверка личной ссылки до анкеты (G11 аудита паритета 25.11.2026). Сервер: POST /api/portal/registration/link-check.
describe("проверка личной ссылки (checkInvite)", () => {
  const api = (status: number, body: unknown) => {
    const fake = fakeFetch(status, body);
    return { api: createRegistrationApi({ baseUrl: "http://x.test/", fetch: fake.fetch }), calls: fake.calls };
  };

  it("шлёт POST со ссылкой только в теле, без Bearer и без флага потока регистрации", async () => {
    const { api: client, calls } = api(200, { status: "valid", firstName: "Айдана", lastName: "Осмонова" });
    await client.checkInvite(INVITE);
    expect(calls[0].url).toBe("http://x.test/api/portal/registration/link-check");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ invite: INVITE });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(headers[REGISTRATION_FLOW_HEADER]).toBeUndefined();
    // токен в адресе попал бы в журналы доступа
    expect(calls[0].url).not.toContain(INVITE);
  });

  it("действующая ссылка: имя для предзаполнения; нет имени - null", async () => {
    expect(await api(200, { status: "valid", firstName: "Айдана", lastName: "Осмонова" }).api.checkInvite(INVITE)).toEqual({ status: "valid", prefill: { firstName: "Айдана", lastName: "Осмонова" } });
    expect(await api(200, { status: "valid", firstName: "Айдана", lastName: "" }).api.checkInvite(INVITE)).toEqual({ status: "valid", prefill: { firstName: "Айдана", lastName: "" } });
    expect(await api(200, { status: "valid", firstName: null, lastName: null }).api.checkInvite(INVITE)).toEqual({ status: "valid", prefill: null });
    // слишком длинное или не строка: ссылка действует, а имя не подставляется
    expect(await api(200, { status: "valid", firstName: "а".repeat(61), lastName: "б" }).api.checkInvite(INVITE)).toEqual({ status: "valid", prefill: null });
    expect(await api(200, { status: "valid", firstName: 5, lastName: "б" }).api.checkInvite(INVITE)).toEqual({ status: "valid", prefill: null });
  });

  it.each(["used", "expired", "unknown", "unavailable"] as const)("статус %s доходит как есть", async (status) => {
    expect(await api(200, { status }).api.checkInvite(INVITE)).toEqual({ status });
  });

  it.each([
    [404, { status: "valid", firstName: null, lastName: null }],
    [429, { status: "rate_limit" }],
    [400, { status: "invalid" }],
    [415, { status: "invalid" }],
    [500, null],
    [503, { status: "unavailable" }],
  ])("HTTP %s - маршрут недоступен: null, приложение идёт дальше без проверки", async (code, body) => {
    expect(await api(code, body).api.checkInvite(INVITE)).toBeNull();
  });

  it("200 с чужой формой, обрыв связи и сбой разбора - тоже null", async () => {
    expect(await api(200, { status: "approved" }).api.checkInvite(INVITE)).toBeNull();
    expect(await api(200, null).api.checkInvite(INVITE)).toBeNull();
    expect(await api(200, ["valid"]).api.checkInvite(INVITE)).toBeNull();
    const offline = createRegistrationApi({ baseUrl: "http://x.test", fetch: async () => { throw new Error("offline"); } });
    expect(await offline.checkInvite(INVITE)).toBeNull();
  });

  it("не отвечает дольше 8 секунд - null, человек не застревает на загрузке", async () => {
    jest.useFakeTimers();
    try {
      const hanging = createRegistrationApi({
        baseUrl: "http://x.test",
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      });
      const pending = hanging.checkInvite(INVITE);
      await jest.advanceTimersByTimeAsync(8_100);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
