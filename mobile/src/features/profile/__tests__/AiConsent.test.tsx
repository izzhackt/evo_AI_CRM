import { fireEvent, screen } from "@testing-library/react-native";

import { aiConsentSource, aiConsentWrite, saveAiConsent } from "@/features/profile/ai-consent";
import { AiConsentRow } from "@/features/profile/AiConsent";
import { createAiConsentAttempts } from "@/features/profile/use-profile";
import { RpcError } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, failure } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

const VERSION = "2026-10-25";
const decided = (status: "granted" | "declined") => ({ status, policyVersion: VERSION, decidedAt: "2026-11-02T10:00:00+00:00", currentPolicyVersion: VERSION });
const outdated = { status: "granted", policyVersion: "2026-01-01", decidedAt: "2026-02-02T10:00:00+00:00", currentPolicyVersion: VERSION };

describe("запись согласия: идемпотентность", () => {
  it("попытка хранит один id на выбор: повтор того же выбора после сбоя, новый id для другого выбора и после успеха", () => {
    const attempts = createAiConsentAttempts(() => aiConsentWrite("granted", "ios"));
    const first = attempts.writeFor("granted");
    expect(attempts.writeFor("granted").requestId).toBe(first.requestId);
    const other = createAiConsentAttempts();
    const a = other.writeFor("granted");
    const b = other.writeFor("declined");
    expect(b.requestId).not.toBe(a.requestId);
    other.done();
    expect(other.writeFor("declined").requestId).not.toBe(b.requestId);
  });

  it("замороженная запись несёт версию, источник и p_request_id; повтор шлёт те же аргументы", async () => {
    const write = aiConsentWrite("granted", "ios");
    const { transport, calls } = fakeTransport({
      portal_ai_consent_set_v1: (_args: unknown, n: number) => (n === 1 ? new RpcError("transport") : decided("granted")),
    });
    const consent = await saveAiConsent(transport, write); // rpcWrite повторяет обрыв тем же запросом
    expect(consent.status).toBe("granted");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(calls[1]?.args);
    expect(calls[0]?.args).toEqual({ p_status: "granted", p_policy_version: VERSION, p_source: "ios", p_request_id: write.requestId });
  });

  it("ответ, не подтверждающий выбор или версию, — отказ, а не выдуманный успех", async () => {
    const wrongStatus = fakeTransport({ portal_ai_consent_set_v1: decided("declined") });
    await expect(saveAiConsent(wrongStatus.transport, aiConsentWrite("granted", "ios"))).rejects.toThrow();
    const wrongVersion = fakeTransport({ portal_ai_consent_set_v1: outdated });
    await expect(saveAiConsent(wrongVersion.transport, aiConsentWrite("granted", "ios"))).rejects.toThrow();
  });

  it("источник: ios на iPhone, android на Android (миграция 355), иначе portal_web", () => {
    expect(aiConsentSource("ios")).toBe("ios");
    expect(aiConsentSource("android")).toBe("android");
    expect(aiConsentSource("web")).toBe("portal_web");
  });
});

describe("строка в Профиле", () => {
  it("разрешено: слово и дата, кнопка «Отозвать согласие» пишет отказ", async () => {
    const { transport, calls } = fakeTransport({ portal_ai_consent_get_v1: decided("granted"), portal_ai_consent_set_v1: decided("declined") });
    await renderPortal(<AiConsentRow />, testApi(transport));
    expect((await screen.findByTestId("ai-consent-state")).props.children).toBeTruthy();
    expect(screen.getByText("Разрешено")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ai-consent-revoke"));
    expect(await screen.findByText("Отказ сохранён.")).toBeTruthy();
    expect(calls.find((c) => c.name === "portal_ai_consent_set_v1")?.args?.p_status).toBe("declined");
    expect(screen.getByText("Не разрешено")).toBeTruthy();
  });

  it("approved видит строку (345): можно отозвать согласие, данное при регистрации", async () => {
    const { transport } = fakeTransport({ portal_ai_consent_get_v1: decided("granted") });
    await renderPortal(<AiConsentRow />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("ai-consent-revoke")).toBeTruthy();
  });

  it("сбой чтения — честная строка и повтор, не выдуманное состояние", async () => {
    const { transport } = fakeTransport({ portal_ai_consent_get_v1: failure("XX000", 500) });
    await renderPortal(<AiConsentRow />, testApi(transport));
    expect(await screen.findByText("Не удалось проверить выбор. Обновите страницу.")).toBeTruthy();
    expect(screen.queryByTestId("ai-consent-state")).toBeNull();
  });
});
