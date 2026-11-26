/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// До кабинета у заявителя есть выход и удаление аккаунта (Apple 5.1.1(v)), язык RU|KY и все добавки статуса анкеты
// (аудит паритета 25.11.2026, G9 и G12). Удаление проверяется через настоящий договор маршрута (RPC
// `request_account_deletion_v2` с `p_request_id`) и поддельный транспорт: настоящий аккаунт тут не удаляется никогда.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { ScrollView } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import GateScreen from "@/app/gate";
import { localizedCountryLabel } from "@/features/registration/application-contract";
import { SignedInWizard } from "@/features/registration/SignedInApplication";
import { LangProvider } from "@/i18n/LangProvider";
import type { SessionState } from "@/session/access";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { validDraft } from "@/test-fixtures/registration";

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
type RpcReply = { data?: unknown; error?: { code: string } | null; status?: number };
let mockRpc: (name: string, args?: Record<string, unknown>, count?: number) => RpcReply = () => ({ data: null });
jest.mock("@/lib/supabase", () => {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "synthetic-access", user: { user_metadata: mockMetadata } } } }),
      updateUser: async () => ({ error: null }),
    },
  };
  return {
    getSupabase: () => client,
    platformTransport: () => async (name: string, args?: Record<string, unknown>) => {
      mockCalls.push({ name, args });
      const count = mockCalls.filter((c) => c.name === name).length;
      const r = mockRpc(name, args, count);
      return { data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 };
    },
  };
});

const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderScreen(ui: React.ReactElement, lang: "ru" | "ky" = "ru") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);

/** Шаги 1-6 мастера заполнены и пройдены; открыт последний шаг «Контактные данные». */
async function openAccountStep() {
  await screen.findByTestId("wizard-next");
  await press("country-CN");
  await press("wizard-next");
  await press("season-autumn");
  await press("year-2027");
  await press("wizard-next");
  await press("education-high_school");
  await type("grade-input", "4,5");
  await press("level-bachelor");
  await press("wizard-next");
  await press("field-Информатика и IT");
  await press("wizard-next");
  await press("nationality");
  await type("nationality-search", localizedCountryLabel("KG", "ru"));
  await fireEvent.press(await screen.findByTestId("nationality-KG"));
  await press("english-mode-self");
  await press("level-self-advanced");
  await press("wizard-next");
  await press("budget-5000_10000");
  await press("funding-family");
  await press("wizard-next");
  await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 7 из 7"));
}

const OPEN_REQUEST = {
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "requested",
  requestedAt: "2026-11-09T08:00:00+00:00",
  dueAt: "2026-12-09T08:00:00+00:00",
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCalls.length = 0;
  mockRefresh.mockClear();
  mockSignOut.mockClear();
  scrollTo.mockClear();
  (router.replace as jest.Mock).mockClear();
  mockMetadata = {};
  mockRpc = () => ({ data: null });
  global.fetch = jest.fn(async () => ({ status: 409, json: async () => ({ status: "mismatch" }) })) as never;
});

describe("мастер вошедшего заявителя: выход и удаление аккаунта", () => {
  it("вверху «Выйти» и «Удалить аккаунт», внизу секция удаления; «Выйти» выходит после подтверждения", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    expect(await screen.findByTestId("wizard-sign-out")).toBeTruthy();
    expect(screen.getByTestId("wizard-delete-account")).toBeTruthy();
    expect(screen.getByTestId("applicant-deletion-heading")).toHaveTextContent("Удаление аккаунта");
    await press("wizard-sign-out");
    await press("wizard-sign-out-yes");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("«Выйти» - кнопка (действие), «Удалить аккаунт» - ссылка (переход к месту на экране)", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    await screen.findByTestId("wizard-sign-out");
    const signOut = screen.getByTestId("wizard-sign-out");
    expect(signOut.props.accessibilityRole).toBe("button");
    expect(screen.getByRole("button", { name: "Выйти" })).toBe(signOut);
    expect(screen.getByTestId("wizard-delete-account").props.accessibilityRole).toBe("link");
  });

  it("случайное нажатие «Выйти» не выходит: сначала вопрос о стёртых ответах, «Отмена» возвращает к анкете", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    await screen.findByTestId("wizard-sign-out");
    expect(screen.queryByTestId("wizard-sign-out-confirm")).toBeNull();
    await press("wizard-sign-out");
    expect(screen.getByTestId("wizard-sign-out-confirm")).toBeTruthy();
    expect(screen.getByText("Выйти из аккаунта?")).toBeTruthy();
    expect(screen.getByText("Ответы анкеты, сохранённые на этом телефоне, будут стёрты. После входа анкету можно будет заполнить заново.")).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    await press("wizard-sign-out-cancel");
    expect(screen.queryByTestId("wizard-sign-out-confirm")).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
    // анкета на месте
    expect(screen.getByTestId("wizard-next")).toBeTruthy();
  });

  it("KY: вопрос о выходе на кыргызском", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />, "ky");
    await fireEvent.press(await screen.findByText("Чыгуу"));
    expect(await screen.findByText("Аккаунттан чыгасызбы?")).toBeTruthy();
  });

  it("«Удалить аккаунт» вверху прокручивает к секции удаления внизу", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    await press("wizard-delete-account");
    expect(scrollTo).toHaveBeenCalledWith({ y: expect.any(Number), animated: false });
  });

  it("удаление идёт настоящим договором: статус читается, запрос уходит как request_account_deletion_v2 с p_request_id, повтор тем же id", async () => {
    mockRpc = (name, _args, count) => {
      if (name === "own_account_deletion_request_v1") return { data: null };
      if (name === "request_account_deletion_v2") return count === 1 ? { error: { code: "XX000" }, status: 500 } : { data: OPEN_REQUEST };
      return { data: null };
    };
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    // веб look="apply": абзацы о сроке и хранении записей на месте
    expect(await screen.findByTestId("deletion-description")).toHaveTextContent("Мы удалим аккаунт и связанные с ним данные в течение 30 дней.");
    expect(screen.getByTestId("deletion-kept-note")).toBeTruthy();
    await press("deletion-start");
    await press("deletion-confirm-yes");
    expect(await screen.findByTestId("deletion-error")).toBeTruthy();
    await press("deletion-confirm-yes");
    expect(await screen.findByText("Запрос на удаление принят 09.11.2026.")).toBeTruthy();
    const writes = mockCalls.filter((c) => c.name === "request_account_deletion_v2");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toEqual({ p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(writes[1]?.args?.p_request_id).toBe(writes[0]?.args?.p_request_id);
    // запрос принят: статус виден, а выйти и стереть данные на устройстве можно
    await press("deletion-sign-out");
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("запрос на удаление уже есть (другое устройство): виден статус, кнопки удаления нет", async () => {
    mockRpc = (name) => (name === "own_account_deletion_request_v1" ? { data: OPEN_REQUEST } : { data: null });
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    expect(await screen.findByTestId("deletion-status")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
  });

  it("язык RU|KY есть в шапке мастера и меняет тексты", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    expect(await screen.findByText("Выйти")).toBeTruthy();
    await press("lang-ky");
    expect(await screen.findByText("Чыгуу")).toBeTruthy();
    expect(screen.getByTestId("applicant-deletion-heading")).toHaveTextContent("Аккаунтту өчүрүү");
  });

  it("кнопка шага «Продолжить», под «На какую программу» подсказка «Можно выбрать несколько вариантов.»", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    expect(await screen.findByText("Продолжить")).toBeTruthy();
    expect(screen.queryByText("Далее")).toBeNull();
    await press("country-CN");
    await press("wizard-next");
    await press("season-autumn");
    await press("year-2027");
    await press("wizard-next");
    // шаг «Образование и ступень»: подсказка стоит и под вопросом о ступени
    expect(await screen.findAllByText("Можно выбрать несколько вариантов.")).toHaveLength(1);
  });

  it("служебная почта (.invalid) студенту не показывается, обычная показывается", async () => {
    const technical = await renderScreen(<SignedInWizard email="aigul.test@students.evoadmissions.invalid" expectedRevision={0} onDone={() => undefined} />);
    await openAccountStep();
    expect(screen.queryByTestId("signed-in-email")).toBeNull();
    expect(screen.queryByText(/students\.evoadmissions\.invalid/)).toBeNull();
    await technical.unmount();
    await AsyncStorage.clear();
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    await openAccountStep();
    expect(screen.getByTestId("signed-in-email")).toHaveTextContent("me@example.test");
  });
});

describe("кабинет от администратора: имя из user_metadata.evo_name_prefill", () => {
  it("мастер без черновика подставляет имя и фамилию, которые ввёл администратор", async () => {
    mockMetadata = { evo_name_prefill: { firstName: "Айгүл", lastName: "Тестова" } };
    mockState = { kind: "needsApplication", entry: { signedInEmail: "aigul.test@students.evoadmissions.invalid", resume: false } };
    await renderScreen(<GateScreen />);
    await openAccountStep();
    expect(screen.getByTestId("first-name").props.value).toBe("Айгүл");
    expect(screen.getByTestId("last-name").props.value).toBe("Тестова");
    expect(screen.queryByTestId("signed-in-email")).toBeNull();
  });

  it("чужая форма подсказки не подставляется", async () => {
    mockMetadata = { evo_name_prefill: { firstName: "<b>Айгүл", lastName: "Тестова" } };
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: false } };
    await renderScreen(<GateScreen />);
    await openAccountStep();
    expect(screen.getByTestId("first-name").props.value).toBe("");
  });
});

describe("«Анкета не отправилась» и «Доступ готовится»", () => {
  it("resume не удался: выйти и удалить аккаунт можно, язык переключается", async () => {
    mockMetadata = { student_application_draft: validDraft() };
    mockRpc = (name) => (name === "submit_student_application_v1" ? { error: { code: "XX000" }, status: 500 } : { data: null });
    mockState = { kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: true } };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("resume-retry")).toBeTruthy();
    expect(screen.getByTestId("lang-ky")).toBeTruthy();
    expect(await screen.findByTestId("deletion-start")).toBeTruthy();
    await press("resume-sign-out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("в сессии нет почты (аудит U19): вместо вечной загрузки обновить, выйти, язык и удаление аккаунта", async () => {
    mockState = { kind: "needsApplication", entry: { signedInEmail: null, resume: false } };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("no-email-sign-out")).toBeTruthy();
    expect(screen.getByTestId("no-email-refresh")).toBeTruthy();
    expect(screen.getByTestId("lang-ky")).toBeTruthy();
    // секция удаления аккаунта: человек, застрявший здесь, всё равно может удалить аккаунт (Apple 5.1.1(v))
    expect(screen.getByTestId("applicant-deletion-heading")).toHaveTextContent("Удаление аккаунта");
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await press("deletion-confirm-yes");
    await waitFor(() => expect(mockCalls.some((c) => c.name === "request_account_deletion_v2")).toBe(true));
    // и мастера нет: без почты анкету не открыть
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    await press("no-email-refresh");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await press("no-email-sign-out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("«Доступ готовится»: повтор, выход, язык и удаление аккаунта", async () => {
    mockState = { kind: "accessPending" };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("gate-pending-retry")).toBeTruthy();
    expect(screen.getByTestId("lang-ru")).toBeTruthy();
    expect(await screen.findByTestId("deletion-start")).toBeTruthy();
    await press("deletion-start");
    await press("deletion-confirm-yes");
    await waitFor(() => expect(mockCalls.some((c) => c.name === "request_account_deletion_v2")).toBe(true));
    await press("gate-sign-out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("сбой связи: язык и «Выйти» есть, удаления нет (сервера не достать)", async () => {
    mockState = { kind: "networkError", messageKey: "error.offline" };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("gate-retry")).toBeTruthy();
    expect(screen.getByTestId("lang-ky")).toBeTruthy();
    expect(screen.getByTestId("gate-sign-out")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
  });
});

describe("статус анкеты: добавки веба и удаление аккаунта", () => {
  const row = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "33333333-3333-4333-8333-333333333333",
    status,
    revision: 2,
    email: "me@example.test",
    questionnaire: validDraft(),
    submitted_at: "2026-11-08T10:00:00Z",
    decided_at: status === "pending" ? null : "2026-11-09T10:00:00Z",
    decision_reason: null,
    student_case_id: null,
    admissions_direction: null,
    canonical_lead_id: null,
    ...extra,
  });

  it("pending: почта анкеты, «Логин для входа», комментарий команды, выход и удаление", async () => {
    mockRpc = (name) => {
      if (name === "own_student_application_v1") return { data: row("pending", { decision_reason: "Проверим документы" }) };
      if (name === "own_student_login_v1") return { data: "test.student" };
      return { data: null };
    };
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("application-email")).toHaveTextContent("me@example.test");
    expect(await screen.findByTestId("application-login")).toHaveTextContent("Логин для входа: test.student");
    expect(screen.getByTestId("application-reason")).toHaveTextContent(/Проверим документы/);
    expect(await screen.findByTestId("deletion-start")).toBeTruthy();
    expect(screen.getByTestId("lang-ky")).toBeTruthy();
    await press("application-sign-out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("служебная почта не показывается и на статусе; без логина строки нет", async () => {
    mockRpc = (name) => (name === "own_student_application_v1" ? { data: row("pending", { email: "aigul.test@students.evoadmissions.invalid" }) } : { data: null });
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderScreen(<GateScreen />);
    expect(await screen.findByText("Ваша анкета")).toBeTruthy();
    expect(screen.queryByTestId("application-email")).toBeNull();
    expect(screen.queryByTestId("application-login")).toBeNull();
  });

  it("сбой обновления статуса: «Не удалось обновить статус. Попробуйте ещё раз.»", async () => {
    mockRpc = (name, _args, count) => {
      if (name !== "own_student_application_v1") return { data: null };
      return count === 1 ? { data: row("pending") } : { error: { code: "XX000" }, status: 500 };
    };
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderScreen(<GateScreen />);
    await screen.findByTestId("application-status-pill");
    expect(screen.queryByTestId("application-refresh-failed")).toBeNull();
    await press("gate-refresh");
    expect(await screen.findByTestId("application-refresh-failed")).toHaveTextContent("Не удалось обновить статус. Попробуйте ещё раз.");
  });

  it("язык переключается прямо на экране статуса", async () => {
    mockRpc = (name) => (name === "own_student_application_v1" ? { data: row("pending") } : { data: null });
    mockState = { kind: "applicationStatus", application: { status: "pending" } };
    await renderScreen(<GateScreen />);
    expect(await screen.findByTestId("application-status-title")).toHaveTextContent("Анкета на рассмотрении");
    await press("lang-ky");
    expect(await screen.findByText("Анкета каралып жатат")).toBeTruthy();
  });
});

describe("ConflictAction: «аккаунт уже есть» ведёт ко входу", () => {
  // Отдельный набор в ApplyScreen.test.tsx; здесь проверен только выход заявителя из мастера без стирания ответов.
  it("у вошедшего нет ссылки «Уже есть аккаунт? Войти»", async () => {
    await renderScreen(<SignedInWizard email="me@example.test" expectedRevision={0} onDone={() => undefined} />);
    await screen.findByTestId("wizard-sign-out");
    expect(screen.queryByTestId("wizard-login-link")).toBeNull();
  });
});
