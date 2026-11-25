// Проверка личной ссылки до анкеты (G11) и возвращение экрана «Подтвердите почту» после перезапуска (G10), аудит паритета
// 25.11.2026. Сервер заменён поддельным `RegistrationApi`: настоящая сеть не вызывается.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApplyScreen } from "@/features/registration/ApplyScreen";
import { loadPendingSignup, savePendingSignup } from "@/features/registration/pending-store";
import type { InviteCheck, PendingConfirmation, RegistrationApi, RegistrationRequest, ResendResult } from "@/features/registration/registration-api";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { INVITE } from "@/test-fixtures/registration";
import { fillAccountAndSubmit, openAccountStep, WIZARD_PASSWORD } from "@/test-fixtures/registration-wizard";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderPlain(ui: ReactElement, lang: "ru" | "ky" = "ru") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

const PENDING: PendingConfirmation = {
  maskedEmail: "t***@example.test",
  expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  retryAfterSeconds: 45,
  dispatch: "accepted",
  resendCapability: "cap.synthetic_first",
};

function fakeApi(over: Partial<RegistrationApi> = {}) {
  const checks: string[] = [];
  const resends: string[] = [];
  const requests: RegistrationRequest[] = [];
  const api: RegistrationApi = {
    register: async (request) => {
      requests.push(request);
      return { ok: true, pending: PENDING };
    },
    resend: async (capability) => {
      resends.push(capability);
      return { ok: true, pending: { ...PENDING, resendCapability: `cap.synthetic_next${resends.length}`, retryAfterSeconds: 30 } };
    },
    acceptInvite: async () => ({ ok: false }),
    checkInvite: async (invite) => {
      checks.push(invite);
      return { status: "valid", prefill: null };
    },
    ...over,
  };
  return { api, checks, resends, requests };
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);

const TEXT = {
  used: "Эта ссылка уже использована. Если аккаунт создавали вы, войдите.",
  expired: "Срок ссылки истёк. Попросите менеджера прислать новую.",
  unknown: "Аккаунт в кабинете EVO создаётся по личной ссылке. Напишите нам в WhatsApp, и менеджер пришлёт ссылку.",
  unavailable: "Не удалось проверить ссылку. Обновите страницу.",
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  (router.replace as jest.Mock).mockClear();
});

describe("проверка ссылки до анкеты (G11)", () => {
  it("действующая ссылка с именем: анкета открывается, имя и фамилия приглашённого уже стоят на последнем шаге", async () => {
    const { api, checks } = fakeApi({ checkInvite: async () => ({ status: "valid", prefill: { firstName: "Айдана", lastName: "Осмонова" } }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await openAccountStep();
    expect(screen.getByTestId("first-name").props.value).toBe("Айдана");
    expect(screen.getByTestId("last-name").props.value).toBe("Осмонова");
    expect(checks).toEqual([]);
  });

  it("ссылка проверяется ровно один раз, до анкеты, по токену ссылки", async () => {
    const { api, checks } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    expect(checks).toEqual([INVITE]);
  });

  it("пока идёт проверка, анкеты ещё нет: только ожидание", async () => {
    let release: (value: InviteCheck | null) => void = () => undefined;
    const slow = new Promise<InviteCheck | null>((resolve) => {
      release = resolve;
    });
    const { api } = fakeApi({ checkInvite: () => slow });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await waitFor(() => expect(screen.queryByTestId("invite-input")).toBeNull());
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    release({ status: "valid", prefill: null });
    expect(await screen.findByTestId("wizard-next")).toBeTruthy();
  });

  it("действующая ссылка без имени: имя и фамилия пусты", async () => {
    const { api } = fakeApi({ checkInvite: async () => ({ status: "valid", prefill: null }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await openAccountStep();
    expect(screen.getByTestId("first-name").props.value).toBe("");
  });

  it("маршрута проверки нет или он сбоит (null): анкета открывается, как раньше; ссылку проверит отправка", async () => {
    const { api } = fakeApi({ checkInvite: async () => null });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
    expect(screen.queryByTestId("invite-required-used")).toBeNull();
  });

  it.each([
    ["used", TEXT.used],
    ["expired", TEXT.expired],
    ["unknown", TEXT.unknown],
  ] as const)("ссылка %s: экран «Регистрация по приглашению» вместо семи шагов; ссылка и черновик стёрты", async (status, text) => {
    await AsyncStorage.setItem("evo.application-draft.v1:anonymous", JSON.stringify({ createdAt: Date.now(), step: 2, values: {} }));
    const { api } = fakeApi({ checkInvite: async () => ({ status }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId(`invite-required-${status}`)).toBeTruthy();
    expect(screen.getByText("Регистрация по приглашению")).toBeTruthy();
    expect(screen.getByTestId("invite-required-text")).toHaveTextContent(text);
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    expect(screen.queryByTestId("invite-required-retry")).toBeNull();
    expect(mockSecure.size).toBe(0);
    expect(await AsyncStorage.getItem("evo.application-draft.v1:anonymous")).toBeNull();
  });

  it("на экране отказа «Войти» ведёт ко входу, «Другая ссылка» - к вводу ссылки", async () => {
    const { api } = fakeApi({ checkInvite: async () => ({ status: "used" }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await press("invite-required-sign-in");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
    await press("invite-required-change-link");
    expect(await screen.findByTestId("invite-input")).toBeTruthy();
    expect(screen.queryByTestId("invite-required-used")).toBeNull();
  });

  it("KY: тексты кыргызские (словарь веба)", async () => {
    const { api } = fakeApi({ checkInvite: async () => ({ status: "expired" }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />, "ky");
    expect(await screen.findByTestId("invite-required-text")).toHaveTextContent("Шилтеменин мөөнөтү бүттү. Менеджерден жаңысын сураңыз.");
    expect(screen.getByText("Чакыруу менен катталуу")).toBeTruthy();
    expect(screen.getByText("Кирүү")).toBeTruthy();
  });

  it("«Не удалось проверить»: ссылка и черновик остаются, повтор проверяет заново и открывает анкету", async () => {
    await AsyncStorage.setItem("evo.application-draft.v1:anonymous", JSON.stringify({ createdAt: Date.now(), step: 1, values: {} }));
    let call = 0;
    const { api } = fakeApi({
      checkInvite: async () => {
        call += 1;
        return call === 1 ? { status: "unavailable" } : { status: "valid", prefill: null };
      },
    });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("invite-required-text")).toHaveTextContent(TEXT.unavailable);
    expect(mockSecure.size).toBe(1);
    expect(await AsyncStorage.getItem("evo.application-draft.v1:anonymous")).not.toBeNull();
    await press("invite-required-retry");
    expect(await screen.findByTestId("wizard-next")).toBeTruthy();
    expect(call).toBe(2);
  });

  it("вставленная вручную ссылка проверяется так же", async () => {
    const { api, checks } = fakeApi({ checkInvite: async () => ({ status: "used" }) });
    await renderPlain(<ApplyScreen api={api} />);
    await type("invite-input", `evoadmissions://apply?invite=${INVITE}`);
    await press("invite-continue");
    expect(await screen.findByTestId("invite-required-used")).toBeTruthy();
    expect(checks).toEqual([]);
  });

  it("сохранённая ранее ссылка проверяется при открытии экрана", async () => {
    mockSecure.set("evo.registration-invite.v1", INVITE);
    let seen = "";
    const { api } = fakeApi({
      checkInvite: async (invite) => {
        seen = invite;
        return { status: "expired" };
      },
    });
    await renderPlain(<ApplyScreen api={api} />);
    expect(await screen.findByTestId("invite-required-expired")).toBeTruthy();
    expect(seen).toBe(INVITE);
    expect(mockSecure.size).toBe(0);
  });
});

describe("«Подтвердите почту» после перезапуска (G10)", () => {
  it("после регистрации ожидание запоминается, а при перезапуске экран возвращается с текстом restored и с повтором письма", async () => {
    const { api } = fakeApi();
    const first = await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await screen.findByTestId("wizard-next");
    await openAccountStep();
    await fillAccountAndSubmit();
    expect(await screen.findByTestId("pending-masked-email")).toHaveTextContent("t***@example.test");
    // ссылка и черновик стёрты, а ожидание записано
    expect(await loadPendingSignup()).not.toBeNull();
    expect([...mockSecure.values()].join("")).not.toContain(INVITE);
    expect([...mockSecure.values()].join("")).not.toContain(WIZARD_PASSWORD);
    await first.unmount();

    const { api: second } = fakeApi();
    await renderPlain(<ApplyScreen api={second} />);
    expect(await screen.findByTestId("pending-masked-email")).toHaveTextContent("t***@example.test");
    expect(screen.getByTestId("pending-dispatch")).toHaveTextContent("Подтверждение почты ещё не завершено. Если письма нет, запросите его ещё раз.");
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    expect(screen.queryByTestId("invite-input")).toBeNull();
    expect(screen.getByTestId("pending-resend")).toBeTruthy();
    expect(screen.getByTestId("pending-sign-in")).toBeTruthy();
  });

  it("восстановленный экран: срок повторной отправки не обнуляется перезапуском", async () => {
    await savePendingSignup({ ...PENDING, retryAfterSeconds: 600 });
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    await screen.findByTestId("pending-masked-email");
    expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(true);
  });

  it("повторная отправка работает после перезапуска: идёт со старым предъявителем, новый запоминается, текст о результате отправки", async () => {
    await savePendingSignup({ ...PENDING, retryAfterSeconds: 30 }, Date.now() - 10 * 60_000);
    const { api, resends } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    await screen.findByTestId("pending-masked-email");
    await waitFor(() => expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(false));
    await press("pending-resend");
    await waitFor(() => expect(resends).toEqual(["cap.synthetic_first"]));
    expect(await screen.findByTestId("pending-notice")).toBeTruthy();
    expect(screen.getByTestId("pending-dispatch")).toHaveTextContent("Проверьте почту и папку «Спам». Используйте ссылку из последнего письма.");
    const restored = await loadPendingSignup();
    expect(restored?.pending.resendCapability).toBe("cap.synthetic_next1");
  });

  it.each([
    ["confirmed", "Почта подтверждена. Войдите, чтобы продолжить."],
    ["expired", "Повторная отправка из этой формы недоступна. Если почта ещё не подтверждена, напишите в EVO."],
    ["account_conflict", "Вы вошли в другой аккаунт. Откройте ссылку в приватном окне или выйдите из текущего аккаунта самостоятельно."],
  ] as const)("итог %s: ожидание стёрто, повтор спрятан, остаётся «Войти»", async (reason, text) => {
    await savePendingSignup({ ...PENDING, retryAfterSeconds: 0 });
    const result: ResendResult = { ok: false, reason };
    const { api } = fakeApi({ resend: async () => result });
    await renderPlain(<ApplyScreen api={api} />);
    await screen.findByTestId("pending-masked-email");
    await waitFor(() => expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(false));
    await press("pending-resend");
    expect(await screen.findByTestId("pending-notice")).toHaveTextContent(text);
    expect(screen.queryByTestId("pending-resend")).toBeNull();
    expect(screen.queryByTestId("pending-masked-email")).toBeNull();
    expect(screen.getByTestId("pending-sign-in")).toBeTruthy();
    expect(mockSecure.size).toBe(0);
  });

  it("ожидание с вышедшим сроком не возвращается: ввод ссылки, запись стёрта", async () => {
    await savePendingSignup({ ...PENDING, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    expect(await screen.findByTestId("invite-input")).toBeTruthy();
    expect(screen.queryByTestId("pending-masked-email")).toBeNull();
    expect(mockSecure.size).toBe(0);
  });

  it("новая личная ссылка начинает новую регистрацию: ожидание стёрто, открыта анкета", async () => {
    await savePendingSignup(PENDING);
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("wizard-step-label")).toHaveTextContent("Шаг 1 из 7");
    expect(await loadPendingSignup()).toBeNull();
  });

  it("«Войти» с восстановленного экрана ведёт ко входу", async () => {
    await savePendingSignup(PENDING);
    const { api } = fakeApi();
    await renderPlain(<ApplyScreen api={api} />);
    await press("pending-sign-in");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });
});

// Рецензия #1563, M1: ожидание подтверждения почты нельзя стирать до проверки новой ссылки. Сервер гасит личную ссылку при создании
// аккаунта, поэтому та же ссылка из WhatsApp, открытая второй раз, отвечает «использована»; запись с предъявителем повторной
// отправки при этом нужна (без неё не войти, не отправить письмо, не зарегистрироваться заново). Порядок как на вебе
// (apply/page.tsx:85-98): ожидание первее ссылки, а новая анкета открывается только по действующей новой ссылке.
describe("ожидание подтверждения почты и ссылка (M1)", () => {
  const waiting: PendingConfirmation = { ...PENDING, retryAfterSeconds: 0 };

  it("человек зарегистрировался, письмо задерживается, он снова открыл ту же ссылку: ожидание и «Отправить письмо ещё раз» на месте", async () => {
    const first = fakeApi();
    const view = await renderPlain(<ApplyScreen api={first.api} inviteParam={INVITE} />);
    await openAccountStep();
    await fillAccountAndSubmit();
    await screen.findByTestId("pending-masked-email");
    await view.unmount();

    // тот же токен: сервер его уже погасил
    const second = fakeApi({ checkInvite: async () => ({ status: "used" }) });
    await renderPlain(<ApplyScreen api={second.api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("pending-masked-email")).toHaveTextContent("t***@example.test");
    expect(screen.getByTestId("pending-dispatch")).toHaveTextContent(/Подтверждение почты ещё не завершено/);
    expect(screen.queryByTestId("invite-required-used")).toBeNull();
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    expect((await loadPendingSignup())?.pending.resendCapability).toBe("cap.synthetic_first");
    expect([...mockSecure.keys()]).toEqual(["evo.registration-pending.v1"]);
  });

  it.each(["used", "expired", "unknown", "unavailable"] as const)("ожидание и ссылка %s: запись остаётся, экран «Подтвердите почту», повтор письма работает", async (status) => {
    await savePendingSignup(waiting);
    const { api, resends } = fakeApi({ checkInvite: async () => ({ status }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("pending-masked-email")).toBeTruthy();
    expect(screen.queryByTestId(`invite-required-${status}`)).toBeNull();
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    expect((await loadPendingSignup())?.pending.resendCapability).toBe("cap.synthetic_first");
    // ссылка не сохранена: она негодна или неизвестно, годна ли
    expect([...mockSecure.keys()]).toEqual(["evo.registration-pending.v1"]);
    await waitFor(() => expect(screen.getByTestId("pending-resend").props.accessibilityState.disabled).toBe(false));
    await press("pending-resend");
    await waitFor(() => expect(resends).toEqual(["cap.synthetic_first"]));
  });

  it("проверка ссылки не удалась (маршрута нет, нет связи): запись остаётся, анкета не открывается поверх неё", async () => {
    await savePendingSignup(waiting);
    const { api } = fakeApi({ checkInvite: async () => null });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("pending-masked-email")).toBeTruthy();
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    expect((await loadPendingSignup())?.pending.resendCapability).toBe("cap.synthetic_first");
    expect([...mockSecure.keys()]).toEqual(["evo.registration-pending.v1"]);
  });

  it("действующая новая ссылка: ожидание стёрто, ссылка сохранена, анкета с именем приглашённого", async () => {
    await savePendingSignup(waiting);
    const { api } = fakeApi({ checkInvite: async () => ({ status: "valid", prefill: { firstName: "Айдана", lastName: "Осмонова" } }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await openAccountStep();
    expect(screen.getByTestId("first-name").props.value).toBe("Айдана");
    expect(await loadPendingSignup()).toBeNull();
    expect([...mockSecure.values()]).toEqual([INVITE]);
  });

  it("запись стирается не раньше ответа проверки: пока ссылка проверяется, ожидание на месте", async () => {
    await savePendingSignup(waiting);
    let release: (value: InviteCheck | null) => void = () => undefined;
    const slow = new Promise<InviteCheck | null>((resolve) => {
      release = resolve;
    });
    const { api } = fakeApi({ checkInvite: () => slow });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    await waitFor(() => expect(screen.queryByTestId("invite-input")).toBeNull());
    expect(await loadPendingSignup()).not.toBeNull();
    expect([...mockSecure.keys()]).toEqual(["evo.registration-pending.v1"]);
    release({ status: "used" });
    expect(await screen.findByTestId("pending-masked-email")).toBeTruthy();
    expect(await loadPendingSignup()).not.toBeNull();
  });

  it("без ожидания использованная ссылка по-прежнему открывает «Регистрация по приглашению» и стирает ссылку", async () => {
    const { api } = fakeApi({ checkInvite: async () => ({ status: "used" }) });
    await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
    expect(await screen.findByTestId("invite-required-used")).toBeTruthy();
    expect(mockSecure.size).toBe(0);
  });
});
