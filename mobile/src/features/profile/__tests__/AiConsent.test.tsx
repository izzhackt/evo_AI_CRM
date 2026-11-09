import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { aiConsentSource, aiConsentWrite, saveAiConsent } from "@/features/profile/ai-consent";
import { AiConsentHomeCard, AiConsentRow } from "@/features/profile/AiConsent";
import { createAiConsentAttempts } from "@/features/profile/use-profile";
import { RpcError } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, failure } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

const VERSION = "2026-10-25";
const none = { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: VERSION };
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

describe("карточка на Главной", () => {
  it("assisted без решения: карточка с текстом веба; «Разрешить» пишет решение один раз и показывает подтверждение", async () => {
    const { transport, calls } = fakeTransport({ portal_ai_consent_get_v1: none, portal_ai_consent_set_v1: decided("granted") });
    await renderPortal(<AiConsentHomeCard />, testApi(transport));
    expect(await screen.findByText("ИИ-помощники EVO")).toBeTruthy();
    expect(screen.getByText(/Данные обрабатывают Anthropic \(Claude, США\) и Google \(Gemini\)/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ai-consent-allow"));
    expect(await screen.findByText("Разрешение сохранено.")).toBeTruthy();
    expect(calls.filter((c) => c.name === "portal_ai_consent_set_v1")).toHaveLength(1);
    expect(screen.getByTestId("ai-consent-to-profile")).toBeTruthy();
    expect(screen.queryByTestId("ai-consent-allow")).toBeNull();
  });

  it("повтор после сбоя шлёт тот же p_request_id; второе нажатие во время отправки игнорируется", async () => {
    let release: (() => void) | undefined;
    const { transport, calls } = fakeTransport({
      portal_ai_consent_get_v1: none,
      portal_ai_consent_set_v1: (_a: unknown, n: number) => (n === 1 ? failure("XX000", 500) : decided("granted")),
    });
    const gated: typeof transport = (name, args, options) =>
      name === "portal_ai_consent_set_v1" && release === undefined ? new Promise((resolve) => { release = () => resolve(transport(name, args, options)); }) : transport(name, args, options);
    await renderPortal(<AiConsentHomeCard />, testApi(gated));
    await screen.findByTestId("ai-consent-allow");
    await fireEvent.press(screen.getByTestId("ai-consent-allow"));
    await fireEvent.press(screen.getByTestId("ai-consent-allow")); // во время отправки
    await act(async () => release?.());
    expect(await screen.findByTestId("ai-consent-error")).toBeTruthy();
    expect(calls.filter((c) => c.name === "portal_ai_consent_set_v1")).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("ai-consent-allow"));
    await screen.findByText("Разрешение сохранено.");
    const writes = calls.filter((c) => c.name === "portal_ai_consent_set_v1");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.args?.p_request_id).toBe(writes[0]?.args?.p_request_id);
  });

  it("решение по текущей версии уже есть: карточки нет; сбой чтения тоже прячет её", async () => {
    const a = fakeTransport({ portal_ai_consent_get_v1: decided("declined") });
    await renderPortal(<AiConsentHomeCard />, testApi(a.transport));
    await waitFor(() => expect(a.calls.some((c) => c.name === "portal_ai_consent_get_v1")).toBe(true));
    expect(screen.queryByTestId("ai-consent-card")).toBeNull();
    const b = fakeTransport({ portal_ai_consent_get_v1: failure("XX000", 500) });
    await renderPortal(<AiConsentHomeCard />, testApi(b.transport));
    await waitFor(() => expect(b.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("ai-consent-card")).toBeNull();
  });

  it("решение по старой версии текста — снова вопрос с пометкой «Условия обновились»", async () => {
    const { transport } = fakeTransport({ portal_ai_consent_get_v1: outdated });
    await renderPortal(<AiConsentHomeCard />, testApi(transport));
    expect(await screen.findByText("Условия обновились. Подтвердите свой выбор ещё раз.")).toBeTruthy();
  });

  it("самостоятельный студент (approved): карточка не спрашивается и RPC не вызывается", async () => {
    const { transport, calls } = fakeTransport({ portal_ai_consent_get_v1: none });
    await renderPortal(<AiConsentHomeCard />, testApi(transport, { tier: "approved" }));
    expect(screen.queryByTestId("ai-consent-card")).toBeNull();
    expect(calls).toHaveLength(0);
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
