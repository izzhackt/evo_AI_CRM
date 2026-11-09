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
