import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { ThemeProvider } from "@/theme/ThemeProvider";

let mockFailed = false;
const mockRetry = jest.fn();
jest.mock("@/api/PortalPoll", () => ({ usePortalPollFailure: () => ({ failed: mockFailed, retry: mockRetry }) }));

// Состояние обновлений приложения: настоящий `expo-updates` заменён (как в тесте карточки «Вышла новая версия»).
const mockUpdates: { isEnabled: boolean; state: () => { isUpdatePending: boolean } } = { isEnabled: true, state: () => ({ isUpdatePending: false }) };
jest.mock("expo-updates", () => ({
  __esModule: true,
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  useUpdates: () => mockUpdates.state(),
}));

// Общая мера высоты верхней полосы читается через геттер: тест подменяет число и видит, что полоса берёт его оттуда, а не своим
// числом (настоящее значение сверяет тест карточки обновления, `shell/top-bar-metrics`).
let mockBarHeight = 52;
jest.mock("@/shell/top-bar-metrics", () => ({
  get TOP_BAR_HEIGHT() {
    return mockBarHeight;
  },
}));

const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const tree = (lang: "ru" | "ky") => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <LangProvider initial={lang}>
        <PollFailureNotice />
      </LangProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);
const renderNotice = (lang: "ru" | "ky" = "ru") => render(tree(lang));

beforeEach(() => {
  mockFailed = false;
  mockBarHeight = 52;
  mockRetry.mockClear();
  announce.mockClear();
  mockUpdates.isEnabled = true;
  mockUpdates.state = () => ({ isUpdatePending: false });
});

describe("карточка «Не удалось обновить уведомления» (веб: .pt-notification-error)", () => {
  it("опрос в порядке: карточки нет", async () => {
    await renderNotice();
    expect(screen.queryByTestId("poll-failure")).toBeNull();
  });

  it("сбой: карточка-тревога с текстом веба и «Повторить»; повтор зовёт опрос", async () => {
    mockFailed = true;
    await renderNotice();
    expect(screen.getByTestId("poll-failure").props.accessibilityRole).toBe("alert");
    expect(screen.getByText("Не удалось обновить уведомления.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("poll-failure-retry"));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("встаёт под верхней полосой справа, не шире 320; высоту полосы берёт из общей меры, а не своим числом", async () => {
    mockFailed = true;
    mockBarHeight = 64;
    await renderNotice();
    const card = screen.getByTestId("poll-failure");
    expect(card.props.style).toMatchObject({ width: 320 });
    // отступ безопасной зоны 47 + полоса (общая мера, здесь подменена на 64) + зазор 8
    expect(screen.getByTestId("poll-failure-anchor").props.style).toMatchObject({ position: "absolute", top: 47 + 64 + 8, right: 16 });
  });

  it("кыргызский язык", async () => {
    mockFailed = true;
    await renderNotice("ky");
    expect(screen.getByText("Билдирмелер жаңыртылган жок.")).toBeTruthy();
    expect(screen.getByText("Кайталоо")).toBeTruthy();
  });

  describe("пока скачано обновление приложения (веб: `failed && !stale`)", () => {
    it("карточка «Вышла новая версия» стоит на том же месте, поэтому эту не показываем", async () => {
      mockFailed = true;
      mockUpdates.state = () => ({ isUpdatePending: true });
      await renderNotice();
      expect(screen.queryByTestId("poll-failure")).toBeNull();
    });

    it("обновление не скачано: карточка сбоя показывается", async () => {
      mockFailed = true;
      mockUpdates.state = () => ({ isUpdatePending: false });
      await renderNotice();
      expect(screen.getByTestId("poll-failure")).toBeTruthy();
    });

    it("обновления выключены (разработка, Expo Go): флаг хука ничего не значит, карточка показывается", async () => {
      mockFailed = true;
      mockUpdates.isEnabled = false;
      mockUpdates.state = () => ({ isUpdatePending: true });
      await renderNotice();
      expect(screen.getByTestId("poll-failure")).toBeTruthy();
    });

    it("сбой чтения состояния обновлений не роняет оболочку: карточки нет, ничего не падает", async () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        mockFailed = true;
        mockUpdates.state = () => {
          throw new Error("native module is missing");
        };
        await renderNotice();
        expect(screen.queryByTestId("poll-failure")).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("сообщение читалке (веб: role=alert читается сам, а на iPhone accessibilityRole=alert ничего не говорит)", () => {
    it("карточка появилась: текст озвучен один раз; перерисовка и повторные сбои его не повторяют", async () => {
      mockFailed = true;
      const view = await renderNotice();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith("Не удалось обновить уведомления.");
      await view.rerender(tree("ru"));
      expect(announce).toHaveBeenCalledTimes(1);
    });

    it("опрос в порядке или обновление скачано (карточки нет): ничего не озвучивается", async () => {
      await renderNotice();
      mockFailed = true;
      mockUpdates.state = () => ({ isUpdatePending: true });
      await renderNotice();
      expect(announce).not.toHaveBeenCalled();
    });
  });
});
