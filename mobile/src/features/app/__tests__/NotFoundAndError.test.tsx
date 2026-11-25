// Экраны «страница не найдена» и «сбой экрана» на языке студента (G5 аудита паритета 25.11.2026).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { readFileSync } from "node:fs";
import path from "node:path";
import { StyleSheet, Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import NotFoundRoute from "@/app/+not-found";
import { AppErrorBoundary } from "@/features/app/AppErrorBoundary";
import { NotFoundScreen } from "@/features/app/NotFoundScreen";
import { LangProvider } from "@/i18n/LangProvider";
import { HYDRATION_CAP_MS } from "@/lib/storage-hydration";
import { deferredStorage } from "@/test-fixtures/deferred-storage";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const inApp = (ui: React.ReactElement, lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(async () => {
  await AsyncStorage.clear();
  (router.replace as jest.Mock).mockClear();
});

describe("«Страница не найдена»", () => {
  it("слова веба и кнопка в кабинет: корневой маршрут сам выберет вход, шлюз или «Главную»", async () => {
    await inApp(<NotFoundScreen />);
    expect(screen.getByText("Страница не найдена")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Такой страницы здесь нет" })).toBeTruthy();
    expect(screen.getByText("Ссылка устарела или адрес введён неверно. Вернитесь в личный кабинет и откройте нужный раздел заново.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("not-found-home"));
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("KY", async () => {
    await inApp(<NotFoundScreen />, "ky");
    expect(screen.getByText("Мындай барак бул жерде жок")).toBeTruthy();
    expect(screen.getByText("Башкы бетке")).toBeTruthy();
    expect(screen.queryByText("Такой страницы здесь нет")).toBeNull();
  });

  it("файл маршрута +not-found показывает тот же экран", async () => {
    await inApp(<NotFoundRoute />);
    expect(screen.getByTestId("not-found")).toBeTruthy();
  });
});

describe("сбой экрана", () => {
  const boom = new Error("secret internal failure detail");

  it("«Не удалось открыть кабинет» и «Попробовать снова» на языке по умолчанию; текст ошибки на экран не идёт", async () => {
    const retry = jest.fn(async () => undefined);
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // граница стоит над провайдерами приложения: свои ставит сама
      await render(<AppErrorBoundary error={boom} retry={retry} />);
      expect(screen.getByText("Данные недоступны")).toBeTruthy();
      expect(screen.getByRole("header", { name: "Не удалось открыть кабинет" })).toBeTruthy();
      expect(screen.getByText("Попробуйте ещё раз или откройте другой раздел через меню. Если ошибка повторится, сообщите куратору.")).toBeTruthy();
      expect(screen.queryByText(/secret internal failure detail/)).toBeNull();
      await fireEvent.press(screen.getByTestId("app-error-retry"));
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("язык студента, сохранённый на устройстве, действует и здесь (KY)", async () => {
    await AsyncStorage.setItem("evo.lang", "ky");
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await render(<AppErrorBoundary error={boom} retry={async () => undefined} />);
      await waitFor(() => expect(screen.getByRole("header", { name: "Кабинет ачылган жок" })).toBeTruthy());
      expect(screen.getByText("Кайра аракет кылуу")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("с настоящим предохранителем expo-router: сбой дочернего экрана заменяется этим экраном, повтор перерисовывает", async () => {
    const { Try } = jest.requireActual<{ Try: React.ComponentType<{ catch: React.ComponentType<{ error: Error; retry: () => Promise<void> }>; children: React.ReactNode }> }>("expo-router/build/views/Try");
    let broken = true;
    function Screen() {
      if (broken) throw new Error("render failure");
      return <RNText testID="healthy">экран цел</RNText>;
    }
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await render(
        <Try catch={AppErrorBoundary}>
          <Screen />
        </Try>,
      );
      expect(screen.getByTestId("app-error")).toBeTruthy();
      broken = false;
      await fireEvent.press(screen.getByTestId("app-error-retry"));
      await waitFor(() => expect(screen.getByTestId("healthy")).toBeTruthy());
    } finally {
      spy.mockRestore();
    }
  });

  it("корневой макет отдаёт expo-router именно эту границу", () => {
    const layout = readFileSync(path.join(__dirname, "../../../app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/export \{ AppErrorBoundary as ErrorBoundary \} from "@\/features\/app\/AppErrorBoundary";/);
    expect(layout).toMatch(/<UpdatePrompt \/>/);
  });
});

// Выбор темы и языка читается с устройства асинхронно; граница стоит над провайдерами приложения и ставит свои. Пока выбор не
// прочитан, экран не рисуется: студент с тёмной темой или кыргызским языком не видит светлый русский кадр, а читалка экрана не
// озвучивает русское предупреждение (рецензия #1568, п. 4).
describe("сбой экрана и чтение выбора студента", () => {
  const storage = deferredStorage();
  const boom = new Error("secret internal failure detail");
  const retry = async () => undefined;
  const background = () => StyleSheet.flatten(screen.getByTestId("app-error").props.style).backgroundColor;
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleError.mockRestore();
    jest.useRealTimers();
  });

  it("пока выбор не прочитан, на экране ничего; потом сразу кыргызский язык и тёмная тема, русского кадра не было", async () => {
    await AsyncStorage.setItem("evo.lang", "ky");
    await AsyncStorage.setItem("evo.theme", "dark");
    await render(<AppErrorBoundary error={boom} retry={retry} />);
    expect(screen.toJSON()).toBeNull();
    expect(screen.queryByTestId("app-error")).toBeNull();
    expect(screen.queryByText("Не удалось открыть кабинет")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => storage.release({ "evo.lang": "ky", "evo.theme": "dark" }));
    expect(screen.getByRole("header", { name: "Кабинет ачылган жок" })).toBeTruthy();
    expect(screen.queryByText("Не удалось открыть кабинет")).toBeNull();
    expect(background()).toBe(darkTokens.bg);
  });

  it("на устройстве ничего нет: после чтения русский язык и светлая тема по умолчанию", async () => {
    await render(<AppErrorBoundary error={boom} retry={retry} />);
    expect(screen.queryByTestId("app-error")).toBeNull();
    await act(async () => storage.release());
    expect(screen.getByRole("header", { name: "Не удалось открыть кабинет" })).toBeTruthy();
    expect(background()).toBe(lightTokens.bg);
  });

  it("хранилище недоступно: экран всё равно появляется, на значениях по умолчанию", async () => {
    await render(<AppErrorBoundary error={boom} retry={retry} />);
    expect(screen.queryByTestId("app-error")).toBeNull();
    await act(async () => storage.fail());
    expect(screen.getByRole("header", { name: "Не удалось открыть кабинет" })).toBeTruthy();
    expect(screen.getByTestId("app-error-retry")).toBeTruthy();
  });

  it("хранилище молчит: по истечении предела экран появляется по умолчанию, запоздавший выбор его переключает", async () => {
    jest.useFakeTimers();
    await render(<AppErrorBoundary error={boom} retry={retry} />);
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS - 1);
    });
    expect(screen.queryByTestId("app-error")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole("header", { name: "Не удалось открыть кабинет" })).toBeTruthy();

    await act(async () => storage.release({ "evo.lang": "ky", "evo.theme": "dark" }));
    expect(screen.getByRole("header", { name: "Кабинет ачылган жок" })).toBeTruthy();
    expect(background()).toBe(darkTokens.bg);
  });

  it("повтор работает и после ожидания выбора", async () => {
    const again = jest.fn(async () => undefined);
    await render(<AppErrorBoundary error={boom} retry={again} />);
    await act(async () => storage.release());
    await fireEvent.press(screen.getByTestId("app-error-retry"));
    expect(again).toHaveBeenCalledTimes(1);
  });
});
