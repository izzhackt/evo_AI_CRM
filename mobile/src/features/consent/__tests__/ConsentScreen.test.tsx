/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CONSENT_GATE_AI_POLICY_VERSION, PRIVACY_POLICY_VERSION } from "@/features/consent/consent-contract";

import ConsentScreen from "@/app/consent";
import SetPasswordScreen from "@/app/set-password";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("expo-crypto", () => ({ randomUUID: () => require("node:crypto").randomUUID() }));

const mockComplete = jest.fn();
const mockSignOut = jest.fn(async () => undefined);
const mockSetOwnPassword = jest.fn(async (..._args: unknown[]) => "ok" as const);
jest.mock("@/session/SessionProvider", () => ({
  useSession: () => ({ completeConsent: mockComplete, signOut: mockSignOut, setOwnPassword: mockSetOwnPassword }),
}));

type Call = { name: string; args?: Record<string, unknown> };
const mockCalls: Call[] = [];
let mockReply: (call: number) => { data?: unknown; error?: { code: string } | null; status?: number } = () => ({ data: null });
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({}),
  platformTransport: () => async (name: string, args?: Record<string, unknown>) => {
    mockCalls.push({ name, args });
    const r = mockReply(mockCalls.length);
    return { data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 };
  },
}));

const accepted = {
  policyVersionCurrent: PRIVACY_POLICY_VERSION,
  policyAcceptedVersion: PRIVACY_POLICY_VERSION,
  aiStatus: "granted",
  aiPolicyVersion: CONSENT_GATE_AI_POLICY_VERSION,
  aiPolicyVersionCurrent: CONSENT_GATE_AI_POLICY_VERSION,
  needsDecision: false,
};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = (ui: React.ReactElement, lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockCalls.length = 0;
  mockReply = () => ({ data: accepted });
  mockComplete.mockClear();
  mockSignOut.mockClear();
  mockSetOwnPassword.mockClear();
});

describe("экран «Конфиденциальность»", () => {
  it("тексты веба: заголовок, обе галочки, «Продолжить» и «Выйти»; KY тоже", async () => {
    await renderScreen(<ConsentScreen />);
    expect(screen.getByText("Конфиденциальность")).toBeTruthy();
    expect(screen.getByText("Разрешаю ИИ-помощникам EVO читать мою переписку и документы дела")).toBeTruthy();
    expect(screen.getByText("политику конфиденциальности")).toBeTruthy();
    expect(screen.getByText("Продолжить")).toBeTruthy();
    expect(screen.getByText("Выйти")).toBeTruthy();
    await screen.unmount();
    await renderScreen(<ConsentScreen />, "ky");
    expect(screen.getByText("Купуялуулук")).toBeTruthy();
  });

  it("без обеих галочек продолжить нельзя: ни одной, только одна - RPC не вызывается", async () => {
    await renderScreen(<ConsentScreen />);
    const submit = screen.getByTestId("consent-submit");
    expect(submit.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(submit);
    await fireEvent.press(screen.getByTestId("consent-policy"));
    expect(screen.getByTestId("consent-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("consent-submit"));
    expect(mockCalls).toHaveLength(0);
    expect(mockComplete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("consent-ai"));
    expect(screen.getByTestId("consent-submit").props.accessibilityState.disabled).toBe(false);
  });

  it("обе галочки: запись с версиями сборки и источником, затем кабинет", async () => {
    await renderScreen(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId("consent-policy"));
    await fireEvent.press(screen.getByTestId("consent-ai"));
    await fireEvent.press(screen.getByTestId("consent-submit"));
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]?.name).toBe("portal_consents_accept_v1");
    expect(mockCalls[0]?.args).toMatchObject({ p_policy_version: PRIVACY_POLICY_VERSION, p_ai_policy_version: CONSENT_GATE_AI_POLICY_VERSION });
    expect(["ios", "android", "portal_web"]).toContain(mockCalls[0]?.args?.p_source);
    expect(mockCalls[0]?.args?.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("сбой записи: «Не удалось сохранить», кабинет закрыт; повтор шлёт тот же p_request_id", async () => {
    mockReply = (call) => (call === 1 ? { error: { code: "XX000" }, status: 500 } : { data: accepted });
    await renderScreen(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId("consent-policy"));
    await fireEvent.press(screen.getByTestId("consent-ai"));
    await fireEvent.press(screen.getByTestId("consent-submit"));
    expect(await screen.findByTestId("consent-error")).toBeTruthy();
    expect(mockComplete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("consent-submit"));
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockCalls).toHaveLength(2);
    expect(mockCalls[1]?.args?.p_request_id).toBe(mockCalls[0]?.args?.p_request_id);
  });

  it("ответ без подтверждения принятия не открывает кабинет", async () => {
    mockReply = () => ({ data: { ...accepted, needsDecision: true } });
    await renderScreen(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId("consent-policy"));
    await fireEvent.press(screen.getByTestId("consent-ai"));
    await fireEvent.press(screen.getByTestId("consent-submit"));
    expect(await screen.findByTestId("consent-error")).toBeTruthy();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("«Выйти» доступен без решения; ссылка на Политику открывает браузер", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    await renderScreen(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId("consent-policy-link"));
    expect(open).toHaveBeenCalledWith("https://evoadmissions.com/ru/privacy/");
    await fireEvent.press(screen.getByTestId("consent-logout"));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});

describe("«Задайте свой пароль» без галочек (конфиденциальность спрашивается один раз, на /consent)", () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByTestId("new-password"), "synthetic-password-1");
    await fireEvent.changeText(screen.getByTestId("confirm-password"), "synthetic-password-1");
  };

  it("на экране пароля нет галочек конфиденциальности и требования «отметьте оба пункта»", async () => {
    await renderScreen(<SetPasswordScreen />);
    expect(screen.queryByTestId("consent-policy")).toBeNull();
    expect(screen.queryByTestId("consent-ai")).toBeNull();
    expect(screen.queryByText("Отметьте оба пункта, чтобы продолжить.")).toBeNull();
  });

  it("пароль уходит без признака записи согласий и без обращения к согласиям", async () => {
    await renderScreen(<SetPasswordScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId("set-password-submit"));
    await waitFor(() => expect(mockSetOwnPassword).toHaveBeenCalledWith("synthetic-password-1"));
    expect(mockSetOwnPassword.mock.calls[0]).toHaveLength(1);
    expect(mockCalls).toHaveLength(0);
  });
});
