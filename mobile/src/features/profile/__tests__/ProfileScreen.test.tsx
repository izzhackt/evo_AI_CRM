import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";

import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockSession = {
  state: { kind: "active", session: { authority: { displayName: "Тест Студентов" } } },
  portalAuth: { changeOwnPassword: jest.fn() },
  signOut: jest.fn(async () => undefined),
};
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "2.0.0" } } }));
jest.mock("@/shell/TabBar", () => ({ TAB_BAR_CLEARANCE: 0 }));

const PROFILE = { displayName: "Тест Студентов", email: "student@example.test", portalLanguage: "ru", caseState: "active", deletionRequestedAt: null };
const CONSENT = { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: "2026-10-25" };

function handlers(extra: Record<string, unknown> = {}) {
  return {
    get_own_portal_profile_v1: PROFILE,
    own_student_login_v1: "test.student",
    portal_ai_consent_get_v1: CONSENT,
    own_account_deletion_request_v1: null,
    set_own_portal_language_v1: (args: Record<string, unknown> | undefined) => ({ portalLanguage: args?.p_language }),
    ...extra,
  };
}

let openURL: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession.signOut.mockClear();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => openURL.mockRestore());

describe("ProfileScreen", () => {
  it("«Мои данные»: имя, почта и логин для входа только для чтения; версия приложения", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByLabelText("Почта: student@example.test")).toBeTruthy();
    expect(screen.getByLabelText("Логин для входа: test.student")).toBeTruthy();
    expect(screen.getByLabelText("Имя: Тест Студентов")).toBeTruthy();
    expect(screen.getByText("Версия 2.0.0")).toBeTruthy();
    // на вебе телефона в профиле нет: поля ввода телефона тоже нет
    expect(screen.queryByLabelText(/телефон/i)).toBeNull();
  });

  it("«Мои данные» (#1360): телефон и имя меняет куратор, ссылка ведёт в чат; у approved ссылка на поддержку", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByText("Телефон и имя меняет куратор: напишите ему, и он исправит.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("profile-write-evo"));
    expect(router.navigate).toHaveBeenLastCalledWith("/messages/chat");
    const approved = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(approved.transport, { tier: "approved" }));
    expect(await screen.findByText("Телефон и имя меняет менеджер: напишите в поддержку EVO, и он исправит.")).toBeTruthy();
    expect(screen.queryByTestId("profile-write-evo")).toBeNull();
    await fireEvent.press(screen.getByTestId("profile-data-support"));
    expect(openURL).toHaveBeenCalledWith("https://evoadmissions.com/ru/support/");
  });

  it("язык: сохраняется в БД (set_own_portal_language_v1), интерфейс меняется после ответа", async () => {
    const { transport, calls } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-lang-ky");
    await fireEvent.press(screen.getByTestId("profile-lang-ky"));
    expect(await screen.findByText("Порталдын тили")).toBeTruthy();
    expect(calls.find((c) => c.name === "set_own_portal_language_v1")?.args).toEqual({ p_language: "ky" });
  });

  it("язык: сбой записи оставляет прежний язык и показывает строку веба", async () => {
    const { transport } = fakeTransport(handlers({ set_own_portal_language_v1: failure("XX000", 500) }));
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-lang-ky"));
    expect(await screen.findByText("Не удалось сохранить язык. Повторите.")).toBeTruthy();
    expect(screen.getByText("Удаление аккаунта")).toBeTruthy();
  });

  it("политика и поддержка открываются в браузере, лицензии — экраном со списком", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-privacy"));
    expect(openURL).toHaveBeenCalledWith("https://evoadmissions.com/ru/privacy/");
    await fireEvent.press(screen.getByTestId("profile-support"));
    expect(openURL).toHaveBeenCalledWith("https://evoadmissions.com/ru/support/");
    await fireEvent.press(screen.getByTestId("profile-licenses"));
    expect(await screen.findByTestId("licenses-screen")).toBeTruthy();
    expect(screen.getByText(/Записей: \d+/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("licenses-search"), "openstreetmap");
    await fireEvent.press(await screen.findByTestId("license-row-OpenStreetMap (данные карты)"));
    expect(screen.getByTestId("license-text").props.children).toContain("Open Database License");
  });

  it("ссылка не открылась — сообщение, а не тишина", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"));
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-privacy"));
    expect(await screen.findByText("Не удалось открыть ссылку.")).toBeTruthy();
  });

  it("выход: signOut вызывается; блок согласия на ИИ и удаления на экране", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("ai-consent-row");
    await screen.findByTestId("deletion-start");
    await fireEvent.press(screen.getByTestId("sign-out"));
    await waitFor(() => expect(mockSession.signOut).toHaveBeenCalledTimes(1));
  });
});
