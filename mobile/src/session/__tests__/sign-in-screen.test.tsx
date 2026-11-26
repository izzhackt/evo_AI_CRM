/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Экран входа на настоящем `SessionProvider` и клиенте Supabase (сеть и хранилища подменены): колесо «Войти» гаснет, чем бы вход ни
// кончился, ошибка видна, кнопка работает снова (QA#2, D1; рецензия #1591, F1). Роутера здесь нет: экран остаётся на месте, видно только
// то, что он сам рисует.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import SignInScreen from "@/app/(auth)/sign-in";
import { LangProvider } from "@/i18n/LangProvider";
import { getSupabase } from "@/lib/supabase";
import { SessionProvider } from "@/session/SessionProvider";
import { fakeAccount, installFakeBackend, syntheticPassword } from "@/test-fixtures/auth-backend";
import { SessionProbe } from "@/test-fixtures/session-probe";
import { ThemeProvider } from "@/theme/ThemeProvider";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock("expo-router", () => {
  const { Pressable } = require("react-native");
  return { Link: ({ children, href: _href, ...rest }: { children: React.ReactNode; href: string }) => <Pressable {...rest}>{children}</Pressable> };
});
jest.mock("@/config", () => {
  const { PORTAL_URL, SUPABASE_URL } = require("@/test-fixtures/auth-backend");
  return { ConfigError: class extends Error {}, getConfig: () => ({ supabaseUrl: SUPABASE_URL, supabasePublishableKey: "sb_publishable_synthetic", portalBaseUrl: PORTAL_URL }) };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider>
          <SessionProvider>
            <SessionProbe />
            <SignInScreen />
          </SessionProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(async () => {
  installFakeBackend([
    fakeAccount({ login: "test.approved", id: "00000000-0000-4000-8000-000000000002" }),
    fakeAccount({ login: "test.temporary", id: "00000000-0000-4000-8000-000000000003", temporary: true }),
  ]);
  await getSupabase().auth.signOut({ scope: "local" });
  mockSecure.clear();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await getSupabase().auth.stopAutoRefresh();
});

const button = () => screen.getByTestId("sign-in-submit");
const probeText = () => screen.getByTestId("session-probe").props.children;

/** Печатает логин и пароль учебной записи и нажимает «Войти». */
async function submit(login: string) {
  await fireEvent.changeText(screen.getByTestId("login-input"), login);
  await fireEvent.changeText(screen.getByTestId("password-input"), syntheticPassword(login));
  await fireEvent.press(button());
}

describe("экран входа: колесо гаснет, чем бы вход ни кончился", () => {
  it("временный пароль: после входа колесо и «Входим…» уходят (раньше крутились вечно, QA#2 D1)", async () => {
    await renderScreen();
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));

    await submit("test.temporary");

    // приложение ушло с «Входим…» на «проверяем доступ» (по нему открывается экран пароля): кнопка свободна и снова называется «Войти в кабинет»
    await waitFor(() => expect(probeText()).toBe("resolvingAccess|must|ready"));
    expect(button().props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(within(button()).getByText("Войти в кабинет")).toBeTruthy();
    expect(screen.queryByText("Входим…")).toBeNull();
    expect(screen.queryByTestId("sign-in-error")).toBeNull();
  });

  it("`setSession` бросил исключение (запись сессии не удалась): ошибка «Сервис входа временно недоступен.», кнопка работает снова, повтор входит", async () => {
    await renderScreen();
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
    jest.spyOn(getSupabase().auth, "setSession").mockRejectedValueOnce(new Error("хранилище недоступно"));

    await submit("test.approved");

    expect(await screen.findByTestId("sign-in-error")).toHaveTextContent("Сервис входа временно недоступен.");
    expect(probeText()).toBe("signedOut|free|ready");
    expect(button().props.accessibilityState).toEqual({ disabled: false, busy: false });

    // исключение было одноразовым: кнопка принимает нажатие, вход идёт по-настоящему, ошибка уходит
    await fireEvent.press(button());
    await waitFor(() => expect(probeText()).toBe("active|free|ready"));
    expect(screen.queryByTestId("sign-in-error")).toBeNull();
    expect(button().props.accessibilityState).toEqual({ disabled: false, busy: false });
  });
});
