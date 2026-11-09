import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { localizedCountryLabel } from "@/features/registration/application-contract";
import { ApplyScreen } from "@/features/registration/ApplyScreen";
import { ConfirmationPending } from "@/features/registration/ConfirmationPending";
import type { RegistrationApi, RegistrationRequest } from "@/features/registration/registration-api";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { INVITE } from "@/test-fixtures/registration";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const PASSWORD = "w".repeat(16);

async function renderPlain(ui: ReactElement, lang: "ru" | "ky" = "ru") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

function fakeApi(over: Partial<RegistrationApi> = {}) {
  const requests: RegistrationRequest[] = [];
  const resends: string[] = [];
  const api: RegistrationApi = {
    register: async (request) => {
      requests.push(request);
      return { ok: true, pending: { maskedEmail: "t***@example.test", expiresAt: "2026-11-10T00:00:00Z", retryAfterSeconds: 45, dispatch: "accepted", resendCapability: "cap.synthetic" } };
    },
    resend: async (capability) => {
      resends.push(capability);
      return { ok: false, reason: "rate_limit" };
    },
    acceptInvite: async () => ({ ok: false }),
    ...over,
  };
  return { api, requests, resends };
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);
const next = () => press("wizard-next");

async function fillAllSteps() {
  await press("country-CN");
  await next();
  await press("season-autumn");
  await press("year-2027");
  await next();
  await press("education-high_school");
  await type("grade-input", "4,5");
  await press("level-bachelor");
  await next();
  await press("field-Информатика и IT");
  await next();
  await press("nationality");
  await type("nationality-search", localizedCountryLabel("KG", "ru"));
  await fireEvent.press(await screen.findByTestId("nationality-KG"));
  await press("english-mode-self");
  await press("level-self-advanced");
  await next();
  await press("budget-5000_10000");
  await press("funding-family");
  await next();
  await type("first-name", "Тест");
  await type("last-name", "Студентов");
  await type("phone", "+996 555 000 111");
  await type("email", " Test.Student@Example.test ");
  await type("password", PASSWORD);
  await press("consent");
  await press("ai-consent");
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  (router.replace as jest.Mock).mockClear();
});

describe("вход по ссылке", () => {
  it("без ссылки: поле для вставки, неверный текст отклоняется", async () => {
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    expect(await screen.findByTestId("invite-input")).toBeTruthy();
    await type("invite-input", "https://evil.example/apply?invite=" + INVITE);
    await press("invite-continue");
    expect(await screen.findByTestId("invite-error")).toBeTruthy();
    expect(screen.queryByTestId("wizard-next")).toBeNull();
  });

  it("вставленная ссылка схемы приложения открывает анкету; токен лежит в защищённом хранилище, не в черновике", async () => {
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    await type("invite-input", `evoadmissions://apply?invite=${INVITE}`);
    await press("invite-continue");
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
    expect([...mockSecure.values()]).toContain(INVITE);
    expect(JSON.stringify(await AsyncStorage.getAllKeys())).not.toContain(INVITE);
  });

  it("параметр маршрута (universal link) сразу открывает анкету", async () => {
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
  });
});

describe("мастер: проверка шагов и черновик", () => {
  it("пустой шаг не пускает дальше и называет причину; «Назад» работает", async () => {
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await next();
    expect(await screen.findByTestId("wizard-error")).toHaveTextContent("Выберите хотя бы одну страну.");
    await press("country-CN");
    await next();
    await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 2 из 7"));
    await press("wizard-back");
    await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7"));
  });

  it("черновик переживает перезапуск и не содержит пароля", async () => {
    const { api } = fakeApi();
    const first = await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await press("country-CN");
    await next();
    await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 2 из 7"));
    const stored = (await AsyncStorage.getItem("evo.application-draft.v1:anonymous")) ?? "";
    expect(stored).toContain('"CN"');
    expect(stored.toLowerCase()).not.toContain("password");
    await first.unmount();

    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 2 из 7"));
  });
});

describe("регистрация и «Проверьте почту»", () => {
  it("полный проход: точное тело запроса, 202, маска почты, ссылка и черновик стёрты", async () => {
    const { api, requests } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await fillAllSteps();
    await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 7 из 7"));
    await next();
    expect(await screen.findByTestId("pending-masked-email")).toHaveTextContent("t***@example.test");
    expect(requests).toHaveLength(1);
    const r = requests[0];
    expect(r.invite).toBe(INVITE);
    expect(r.email).toBe("test.student@example.test");
    expect(r.password).toBe(PASSWORD);
    const q = r.questionnaire as Record<string, unknown>;
    expect(q.consent).toBe(true);
    expect(q.consentVersion).toBe("2026-11-07");
    expect(q.averageGrade).toBe(4.5);
    expect(q.destinationCountries).toEqual(["CN"]);
    expect(JSON.stringify(q)).not.toContain(PASSWORD);
    expect(mockSecure.size).toBe(0);
    expect(await AsyncStorage.getItem("evo.application-draft.v1:anonymous")).toBeNull();
    await press("pending-sign-in");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it.each([
    ["invite", "Ссылка для регистрации больше не действует"],
    ["conflict", "Не удалось создать аккаунт с этим email"],
    ["rate_limit", "Слишком много попыток"],
    ["password", "не менее 12 символов"],
    ["network", "Нет связи"],
  ] as const)("отказ %s: понятный текст, ответы остаются", async (reason, text) => {
    const { api } = fakeApi({ register: async () => ({ ok: false, reason }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await fillAllSteps();
    await next();
    expect(await screen.findByTestId("wizard-error")).toHaveTextContent(new RegExp(text));
    expect(screen.getByTestId("first-name").props.value).toBe("Тест");
  });

  it("без галочек и с коротким паролем отправка не уходит", async () => {
    const { api, requests } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await fillAllSteps();
    await type("password", "short");
    await next();
    expect(await screen.findByTestId("wizard-error")).toHaveTextContent(/не короче 12/);
    await type("password", PASSWORD);
    await press("ai-consent");
    await next();
    expect(await screen.findByTestId("wizard-error")).toHaveTextContent(/ИИ-помощников/);
    expect(requests).toHaveLength(0);
  });
});

describe("ConfirmationPending", () => {
  const pending = { maskedEmail: "t***@example.test", expiresAt: "x", retryAfterSeconds: 2, dispatch: "accepted" as const, resendCapability: "cap.one" };

  it("повторная отправка ждёт, потом работает и берёт новую capability", async () => {
    jest.useFakeTimers();
    try {
      let call = 0;
      const resends: string[] = [];
      const api: RegistrationApi = {
        register: async () => ({ ok: false, reason: "unavailable" }),
        acceptInvite: async () => ({ ok: false }),
        resend: async (cap) => {
          resends.push(cap);
          call += 1;
          return { ok: true, pending: { ...pending, resendCapability: `cap.next${call}`, retryAfterSeconds: 30 } };
        },
      };
      await renderPlain(<ConfirmationPending initial={pending} api={api} onSignIn={() => undefined} />);
      expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(screen.getByTestId("pending-resend"));
      expect(resends).toHaveLength(0);
      await act(async () => {
        jest.advanceTimersByTime(2100);
      });
      expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(false);
      await fireEvent.press(screen.getByTestId("pending-resend"));
      expect(resends).toEqual(["cap.one"]);
      expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId("pending-notice")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("отказ повторной отправки показывает текст веба", async () => {
    const api: RegistrationApi = {
      register: async () => ({ ok: false, reason: "unavailable" }),
      acceptInvite: async () => ({ ok: false }),
      resend: async () => ({ ok: false, reason: "expired" }),
    };
    jest.useFakeTimers();
    try {
      await renderPlain(<ConfirmationPending initial={{ ...pending, retryAfterSeconds: 0 }} api={api} onSignIn={() => undefined} />);
      await fireEvent.press(screen.getByTestId("pending-resend"));
      expect(screen.getByTestId("pending-notice")).toHaveTextContent(/Повторная отправка из этой формы недоступна/);
    } finally {
      jest.useRealTimers();
    }
  });
});
