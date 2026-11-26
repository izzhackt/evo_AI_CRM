/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Вход временным паролем (QA#2, D1): «Войти» крутится вечно, хотя сессия уже сохранена. НАСТОЯЩИЕ: корневой макет с охранниками
// маршрутов (`Stack.Protected`), `SessionProvider`, клиент Supabase (`getSupabase`) с его событиями, маршрутизатор доступа и вызовы
// портала. Заменена только сеть (поддельный сервер) и родные хранилища. Этот файл - ЧИСТЫЙ запуск: клиент создан впервые и ни
// выхода, ни другого входа до этого не было, поэтому здесь видно, что причина не в выходе из прошлой сессии.
import { act, render, screen, waitFor } from "@testing-library/react-native";

import RootLayout from "@/app/_layout";
import { getSupabase } from "@/lib/supabase";
import { fakeAccount, installFakeBackend, syntheticPassword } from "@/test-fixtures/auth-backend";
import { sessionProbe } from "@/test-fixtures/session-probe";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock("@/polyfills", () => ({}));
jest.mock("expo-font", () => ({ useFonts: () => [true] }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: async () => true, hideAsync: async () => true }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }: { children: unknown }) => children }));
jest.mock("@/features/app/UpdatePrompt", () => ({ UpdatePrompt: () => null }));
jest.mock("@/config", () => {
  const { PORTAL_URL, SUPABASE_URL } = require("@/test-fixtures/auth-backend");
  return { ConfigError: class extends Error {}, getConfig: () => ({ supabaseUrl: SUPABASE_URL, supabasePublishableKey: "sb_publishable_synthetic", portalBaseUrl: PORTAL_URL }) };
});
// Стек с настоящими охранниками: рисуются только те экраны, чей `guard` истинен; внутри стоит зонд сессии.
jest.mock("expo-router", () => require("@/test-fixtures/expo-router-guards"));

const accounts = [fakeAccount({ login: "test.temporary", id: "00000000-0000-4000-8000-000000000003", temporary: true })];

// Клиент Supabase заводит собственный таймер обновления токена: без остановки он держит процесс Jest.
afterAll(async () => {
  await getSupabase().auth.stopAutoRefresh();
});

describe("вход временным паролем с чистого запуска", () => {
  it("«Придумайте свой пароль», а не вечное «Войти»; кабинет при этом не опрашивается", async () => {
    const backend = installFakeBackend(accounts);
    await render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen:(auth)")).toBeTruthy());

    await act(async () => {
      expect(await sessionProbe.current?.signIn("test.temporary", syntheticPassword("test.temporary"))).toEqual({ ok: true });
    });

    await waitFor(() => expect(screen.getByTestId("screen:set-password")).toBeTruthy());
    // экран входа ушёл, колесо «Входим…» (`authenticating`) не осталось: вход закончен, пароль только предстоит сменить
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(screen.getByTestId("session-probe").props.children).toBe("resolvingAccess|must|ready");
    // то, что видел Kong в QA: вход на портале и `GET /auth/v1/user` от `setSession`, дальше приложение ничего не спрашивает
    expect(backend.calls).toEqual(["POST /api/portal/mobile/session", "GET /auth/v1/user"]);
  });
});
