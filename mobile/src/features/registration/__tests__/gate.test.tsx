/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import GateScreen from "@/app/gate";
import { registrationAiConsentChoice } from "@/features/registration/ai-consent";
import { LangProvider } from "@/i18n/LangProvider";
import type { SessionState } from "@/session/access";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { REQUEST_ID, validDraft } from "@/test-fixtures/registration";

jest.mock("expo-crypto", () => ({
  randomUUID: () => require("node:crypto").randomUUID(),
  getRandomBytes: (size: number) => new Uint8Array(require("node:crypto").randomBytes(size)),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_a: string, text: string) => require("node:crypto").createHash("sha256").update(text).digest("hex"),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "http://portal.example.test", supabaseUrl: "http://s.test", supabasePublishableKey: "k" }) }));

const mockRefresh = jest.fn(async () => undefined);
const mockSignOut = jest.fn(async () => undefined);
let mockState: SessionState = { kind: "accessPending" };
jest.mock("@/session/SessionProvider", () => ({
  useSession: () => ({ state: mockState, retry: jest.fn(), refreshAccess: mockRefresh, signOut: mockSignOut }),
}));

type Call = { name: string; args?: Record<string, unknown> };
const mockCalls: Call[] = [];
let mockMetadata: Record<string, unknown> = {};
let mockRpc: (name: string) => { data?: unknown; error?: { code: string } | null; status?: number } = () => ({ data: null });
const mockUpdateUser = jest.fn(async (_: unknown) => ({ error: null }));
jest.mock("@/lib/supabase", () => {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "synthetic-access", user: { user_metadata: mockMetadata } } } }),
      updateUser: (arg: unknown) => mockUpdateUser(arg),
    },
  };
  return {
    getSupabase: () => client,
    platformTransport: () => async (name: string, args?: Record<string, unknown>) => {
      mockCalls.push({ name, args });
      const r = mockRpc(name);
      return { data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 };
    },
  };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
async function renderGate() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <GateScreen />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCalls.length = 0;
  mockRefresh.mockClear();
  mockUpdateUser.mockClear();
  mockMetadata = {};
  mockRpc = () => ({ data: null });
  global.fetch = jest.fn(async () => ({ status: 409, json: async () => ({ status: "mismatch" }) })) as never;
});

describe("needsApplication", () => {
  it("без черновика: мастер в режиме signedIn с почтой из сессии, без пароля и поля почты", async () => {
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: false } };
    await renderGate();
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
    expect(mockCalls).toHaveLength(0);
  });

  it("resume: валидный черновик из метаданных отправляется с expected_revision 0, потом согласие и очистка, затем обновление маршрута", async () => {
    const choice = await registrationAiConsentChoice(REQUEST_ID);
    mockMetadata = { student_application_draft: validDraft(), student_ai_consent_choice: choice };
    mockRpc = (name) => (name === "portal_ai_consent_get_v1" ? { data: { status: null } } : { data: {} });
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: true } };
    await renderGate();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const submit = mockCalls.find((c) => c.name === "submit_student_application_v1");
    expect(submit?.args).toMatchObject({ p_expected_revision: 0, p_request_id: REQUEST_ID });
    expect(mockCalls.some((c) => c.name === "portal_ai_consent_set_v1")).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith({ data: { student_application_draft: null, student_ai_consent_choice: null } });
  });

  it("resume: конфликт ревизии ведёт к статусу существующей анкеты", async () => {
    mockMetadata = { student_application_draft: validDraft() };
    mockRpc = (name) => (name === "submit_student_application_v1" ? { error: { code: "40001" }, status: 409 } : { data: null });
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: true } };
    await renderGate();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("resume: сбой отправки показывает повтор и «Заполнить заново»; повтор уходит тем же запросом", async () => {
    mockMetadata = { student_application_draft: validDraft() };
    let attempts = 0;
    mockRpc = (name) => {
      if (name !== "submit_student_application_v1") return { data: null };
      attempts += 1;
      return attempts <= 1 ? { error: { code: "XX000" }, status: 500 } : { data: {} };
    };
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: true } };
    await renderGate();
    expect(await screen.findByTestId("resume-retry")).toBeTruthy();
    expect(screen.getByTestId("resume-fill-again")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("resume-retry"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const ids = mockCalls.filter((c) => c.name === "submit_student_application_v1").map((c) => c.args?.p_request_id);
    expect(new Set(ids)).toEqual(new Set([REQUEST_ID]));
  });
});

describe("applicationStatus", () => {
  const row = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "33333333-3333-4333-8333-333333333333",
    status,
    revision: 2,
    email: "me@example.test",
    questionnaire: validDraft(),
    submitted_at: "2026-11-08T10:00:00Z",
    decided_at: status === "pending" ? null : "2026-11-09T10:00:00Z",
    decision_reason: null,
    student_case_id: status === "approved" ? "44444444-4444-4444-8444-444444444444" : null,
    admissions_direction: null,
    canonical_lead_id: null,
    ...extra,
  });

  it("pending: статус, ответы, обновление", async () => {
    mockRpc = () => ({ data: row("pending") });
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderGate();
    expect(await screen.findByText("Тест Студентов")).toBeTruthy();
    expect(screen.getByTestId("application-status-title")).toHaveTextContent("Анкета на рассмотрении");
    expect(screen.queryByTestId("application-fix")).toBeNull();
    await fireEvent.press(screen.getByTestId("gate-refresh"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("rejected: комментарий команды и исправление уходит с ревизией анкеты", async () => {
    mockRpc = (name) => (name === "own_student_application_v1" ? { data: row("rejected", { decision_reason: "Укажите верный телефон" }) } : { data: {} });
    mockState = { kind: "applicationStatus", application: { status: "rejected" } };
    await renderGate();
    expect(await screen.findByTestId("application-reason")).toHaveTextContent(/Укажите верный телефон/);
    await fireEvent.press(screen.getByTestId("application-fix"));
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
    // ответы подставлены из прежней анкеты
    expect(screen.getByTestId("country-CN").props.accessibilityState.checked).toBe(true);
  });

  it("чужая форма ответа не рисуется выдуманным экраном: статус остаётся, ответов нет", async () => {
    mockRpc = () => ({ data: { status: "pending", questionnaire: {} } });
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderGate();
    expect(await screen.findByTestId("application-status-pill")).toBeTruthy();
    expect(screen.queryByText("Тест Студентов")).toBeNull();
  });
});
