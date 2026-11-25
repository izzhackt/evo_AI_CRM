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
// Вызовы согласий (`mockCalls`) и вызовы секции «Удалить аккаунт» (`mockDeletionCalls`) считаются порознь: секция читает статус
// запроса на удаление при открытии экрана, и это не про согласия (на экране, где можно застрять, удаление аккаунта обязательно).
const mockCalls: Call[] = [];
const mockDeletionCalls: Call[] = [];
let mockReply: (call: number) => { data?: unknown; error?: { code: string } | null; status?: number } = () => ({ data: null });
let mockDeletionReply: (name: string) => { data?: unknown; error?: { code: string } | null; status?: number } = () => ({ data: null });
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({}),
  platformTransport: () => async (name: string, args?: Record<string, unknown>) => {
    if (name === "own_account_deletion_request_v1" || name === "request_account_deletion_v2") {
      mockDeletionCalls.push({ name, args });
      const d = mockDeletionReply(name);
      return { data: d.data ?? null, error: d.error ?? null, status: d.status ?? 200 };
    }
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
  mockDeletionCalls.length = 0;
  mockDeletionReply = () => ({ data: null });
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
    // 14.11.2026: единственное место, где говорится о хранении файлов; на экране «Документы» этой строки нет.
    expect(screen.getByTestId("consent-files-note")).toBeTruthy();
    expect(screen.getByText("Файлы хранятся закрыто и проверяются антивирусом; их видят сотрудники EVO, которые ведут ваше дело.")).toBeTruthy();
    await screen.unmount();
    await renderScreen(<ConsentScreen />, "ky");
    expect(screen.getByText("Купуялуулук")).toBeTruthy();
    expect(screen.getByTestId("consent-files-note")).toBeTruthy();
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

// Аккаунт, созданный в приложении или администратором, удаляется с любого экрана, на котором человек может остаться (Apple
// 5.1.1(v); рецензия #1554): экран «Конфиденциальность» и экран нового пароля. Сессия на них уже есть, а база не связывает удаление
// с признаком временного пароля, поэтому общая секция работает и здесь.
describe("«Удалить аккаунт» на экранах, где можно застрять", () => {
  const OPEN = { requestId: "11111111-1111-4111-8111-111111111111", status: "requested", requestedAt: "2026-11-09T08:00:00+00:00", dueAt: "2026-12-09T08:00:00+00:00" };

  it.each([
    ["«Конфиденциальность»", () => <ConsentScreen />],
    ["новый пароль", () => <SetPasswordScreen />],
  ] as const)("%s: секция удаления на месте, запрос уходит с p_request_id, повтор после сбоя тем же id", async (_name, screenOf) => {
    let attempts = 0;
    mockDeletionReply = (name) => {
      if (name === "own_account_deletion_request_v1") return { data: null };
      attempts += 1;
      return attempts === 1 ? { error: { code: "XX000" }, status: 500 } : { data: OPEN };
    };
    await renderScreen(screenOf());
    expect(screen.getByTestId("applicant-deletion-heading")).toHaveTextContent("Удаление аккаунта");
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByTestId("deletion-error")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Запрос на удаление принят 09.11.2026.")).toBeTruthy();
    const writes = mockDeletionCalls.filter((c) => c.name === "request_account_deletion_v2");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toEqual({ p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(writes[1]?.args?.p_request_id).toBe(writes[0]?.args?.p_request_id);
    // согласий и пароля это не касается
    expect(mockCalls).toHaveLength(0);
    expect(mockSetOwnPassword).not.toHaveBeenCalled();
  });

  it("запрос на удаление уже принят: виден статус и «Выйти и стереть данные на этом устройстве»", async () => {
    mockDeletionReply = () => ({ data: OPEN });
    await renderScreen(<ConsentScreen />);
    expect(await screen.findByTestId("deletion-status")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-sign-out"));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("секция не мешает экранам: «Продолжить» без галочек по-прежнему закрыта, пароль уходит как раньше", async () => {
    await renderScreen(<ConsentScreen />);
    expect(screen.getByTestId("consent-submit").props.accessibilityState.disabled).toBe(true);
    await screen.unmount();
    await renderScreen(<SetPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId("new-password"), "synthetic-password-1");
    await fireEvent.changeText(screen.getByTestId("confirm-password"), "synthetic-password-1");
    await fireEvent.press(screen.getByTestId("set-password-submit"));
    await waitFor(() => expect(mockSetOwnPassword).toHaveBeenCalledWith("synthetic-password-1"));
  });
});
