// Корневой макет и чтение выбора студента (рецензия #1568, п. 4). Первый кадр, который видит студент, уже в его теме и на его
// языке: заставка не снимается и ни экран «Приложение не настроено», ни кабинет не рисуются, пока выбор с устройства не прочитан.
// Всё нативное и всё чужое (маршруты, шрифты, заставка, сессия) заменено пустышками; провайдеры темы и языка настоящие, а чтение
// хранилища управляется тестом.
import { act, render, screen } from "@testing-library/react-native";
import * as MockReact from "react";
import { Appearance, StyleSheet } from "react-native";

import RootLayout from "@/app/_layout";
import { deferredStorage } from "@/test-fixtures/deferred-storage";
import { createSignal } from "@/test-fixtures/reactive-signal";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";

// Порядок событий корневого макета: системная схема окна (`appearance:*`) и снятие заставки (`splash:hide`).
const mockOrder: string[] = [];
const mockHideAsync = jest.fn(async () => {
  mockOrder.push("splash:hide");
  return true;
});
const mockLayout: { configError: string | null; fontsLoaded: boolean } = { configError: null, fontsLoaded: true };

jest.mock("@/polyfills", () => ({}));
// `useFonts` настоящего модуля - useState: когда шрифты загрузились, перерисовывается САМ компонент, который его вызвал. Подмена делает то же,
// когда тест изменил `mockLayout.fontsLoaded` и вызвал `mockFontsChanged.emit()`; перерисовка родителя тут ни при чём (см. `reactive-signal.ts`).
const mockFontsChanged = createSignal();
jest.mock("expo-font", () => ({
  useFonts: () => {
    MockReact.useSyncExternalStore(mockFontsChanged.subscribe, mockFontsChanged.version);
    return [mockLayout.fontsLoaded];
  },
}));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: () => mockHideAsync() }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("expo-router", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const Stack = Object.assign(() => MockReact.createElement(Text, { testID: "routes" }, "routes"), { Screen: () => null, Protected: ({ children }: { children: unknown }) => children });
  return { Stack };
});
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }: { children: unknown }) => children }));
jest.mock("@/config", () => {
  class ConfigError extends Error {}
  return {
    ConfigError,
    getConfig: () => {
      if (mockLayout.configError) throw new ConfigError(mockLayout.configError);
      return {};
    },
  };
});
jest.mock("@/lib/supabase", () => ({ bindAutoRefresh: () => () => undefined, getSupabase: () => ({}) }));
jest.mock("@/session/SessionProvider", () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
  useSession: () => ({ state: { kind: "signedOut", accountDeleted: false }, mustSetPassword: false, ready: true }),
}));
jest.mock("@/features/app/UpdatePrompt", () => ({ UpdatePrompt: () => null }));

const MISSING = "EXPO_PUBLIC_SUPABASE_URL не задан";
const background = () => StyleSheet.flatten(screen.getByTestId("config-error").props.style).backgroundColor;

describe("корневой макет ждёт выбор темы и языка с устройства", () => {
  const storage = deferredStorage();
  beforeEach(() => {
    mockHideAsync.mockClear();
    mockOrder.length = 0;
    mockLayout.configError = null;
    mockLayout.fontsLoaded = true;
    jest.spyOn(Appearance, "setColorScheme").mockImplementation((scheme) => {
      mockOrder.push(`appearance:${scheme}`);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  describe("приложение не настроено", () => {
    beforeEach(() => {
      mockLayout.configError = MISSING;
    });

    it("пока выбор не прочитан: ни экрана, ни снятия заставки; потом сразу кыргызский язык и тёмная тема", async () => {
      await render(<RootLayout />);
      expect(screen.toJSON()).toBeNull();
      expect(screen.queryByText("Приложение не настроено")).toBeNull();
      expect(mockHideAsync).not.toHaveBeenCalled();

      await act(async () => storage.release({ "evo.lang": "ky", "evo.theme": "dark" }));
      expect(screen.getByText("Колдонмо ыңгайлаштырылган эмес")).toBeTruthy();
      expect(screen.queryByText("Приложение не настроено")).toBeNull();
      expect(screen.getByText(MISSING)).toBeTruthy();
      expect(background()).toBe(darkTokens.bg);
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it("на устройстве ничего нет: русский язык и светлая тема, заставка снимается", async () => {
      await render(<RootLayout />);
      expect(mockHideAsync).not.toHaveBeenCalled();
      await act(async () => storage.release());
      expect(screen.getByText("Приложение не настроено")).toBeTruthy();
      expect(background()).toBe(lightTokens.bg);
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it("хранилище недоступно: экран всё равно появляется", async () => {
      await render(<RootLayout />);
      await act(async () => storage.fail());
      expect(screen.getByText("Приложение не настроено")).toBeTruthy();
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it("шрифты ещё грузятся: выбор прочитан, а экрана и снятия заставки нет, пока шрифты не готовы", async () => {
      mockLayout.fontsLoaded = false;
      await render(<RootLayout />);
      await act(async () => storage.release({ "evo.lang": "ky" }));
      expect(screen.toJSON()).toBeNull();
      expect(mockHideAsync).not.toHaveBeenCalled();

      await act(async () => {
        mockLayout.fontsLoaded = true;
        mockFontsChanged.emit();
      });
      expect(screen.getByText("Колдонмо ыңгайлаштырылган эмес")).toBeTruthy();
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("приложение настроено", () => {
    it("пока выбор не прочитан, кабинет не рисуется и заставка держится; прочитан - маршруты и заставка снимается", async () => {
      await render(<RootLayout />);
      expect(screen.queryByTestId("routes")).toBeNull();
      expect(mockHideAsync).not.toHaveBeenCalled();

      await act(async () => storage.release({ "evo.lang": "ky", "evo.theme": "dark" }));
      expect(screen.getByTestId("routes")).toBeTruthy();
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it("хранилище недоступно: маршруты всё равно появляются", async () => {
      await render(<RootLayout />);
      await act(async () => storage.fail());
      expect(screen.getByTestId("routes")).toBeTruthy();
      expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    // Рецензия #1579: на iOS заставка берёт стиль из `overrideUserInterfaceStyle` окна. Пока выбор студента не прочитан, `choice` -
    // значение по умолчанию (светлая); выставить его значило бы на миг перекрасить заставку и вернуть обратно.
    describe("системная схема окна (`Appearance.setColorScheme`) не ставится до чтения выбора", () => {
      it("«Тёмная»: до чтения ничего; потом сразу тёмная, без промежуточной светлой, и только затем снятие заставки", async () => {
        await render(<RootLayout />);
        expect(mockOrder).toEqual([]);
        await act(async () => storage.release({ "evo.theme": "dark" }));
        expect(mockOrder).toEqual(["appearance:dark", "splash:hide"]);
      });

      it("«Как в системе»: сразу `unspecified`, без промежуточной светлой", async () => {
        await render(<RootLayout />);
        expect(mockOrder).toEqual([]);
        await act(async () => storage.release({ "evo.theme": "system" }));
        expect(mockOrder).toEqual(["appearance:unspecified", "splash:hide"]);
      });

      it("на устройстве ничего нет: светлая по умолчанию, один раз, перед снятием заставки", async () => {
        await render(<RootLayout />);
        expect(mockOrder).toEqual([]);
        await act(async () => storage.release());
        expect(mockOrder).toEqual(["appearance:light", "splash:hide"]);
      });

      it("хранилище недоступно: светлая по умолчанию, затем заставка", async () => {
        await render(<RootLayout />);
        await act(async () => storage.fail());
        expect(mockOrder).toEqual(["appearance:light", "splash:hide"]);
      });
    });
  });
});
