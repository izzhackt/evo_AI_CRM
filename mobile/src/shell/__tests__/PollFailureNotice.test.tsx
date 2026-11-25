import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { reportUpdatePromptVisible } from "@/shell/update-prompt-visibility";
import { ThemeProvider } from "@/theme/ThemeProvider";

let mockFailed = false;
let mockBroken = false;
const mockRetry = jest.fn();
jest.mock("@/api/PortalPoll", () => ({
  usePortalPollFailure: () => {
    if (mockBroken) throw new Error("poll context is broken");
    return { failed: mockFailed, retry: mockRetry };
  },
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
  mockBroken = false;
  mockBarHeight = 52;
  mockRetry.mockClear();
  announce.mockClear();
  reportUpdatePromptVisible(false);
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

  describe("пока на виду карточка «Вышла новая версия» (веб: `failed && !stale`)", () => {
    it("карточка обновления стоит на том же месте, поэтому эту не показываем", async () => {
      mockFailed = true;
      reportUpdatePromptVisible(true);
      await renderNotice();
      expect(screen.queryByTestId("poll-failure")).toBeNull();
    });

    it("карточки обновления нет (нет обновления, обновления выключены или студент нажал «Позже»): карточка сбоя показывается", async () => {
      mockFailed = true;
      await renderNotice();
      expect(screen.getByTestId("poll-failure")).toBeTruthy();
    });

    it("карточка обновления появилась и ушла: эта уступает, потом возвращается и говорится читалке заново", async () => {
      // повтор того же сообщения быстрее 800 мс общий помощник глушит: время сдвигается, как у настоящего студента
      const clock = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
      try {
        mockFailed = true;
        await renderNotice();
        expect(announce).toHaveBeenCalledTimes(1);
        await act(async () => reportUpdatePromptVisible(true));
        expect(screen.queryByTestId("poll-failure")).toBeNull();
        clock.mockReturnValue(1_005_000);
        await act(async () => reportUpdatePromptVisible(false));
        expect(screen.getByTestId("poll-failure")).toBeTruthy();
        expect(announce).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

    it("сбой отрисовки не роняет оболочку: карточки нет, ничего не падает", async () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        mockBroken = true;
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

    it("опрос в порядке: ничего не озвучивается", async () => {
      await renderNotice();
      expect(announce).not.toHaveBeenCalled();
    });

    it("карточка уступает карточке обновления (карточки нет): ничего не озвучивается", async () => {
      mockFailed = true;
      reportUpdatePromptVisible(true);
      await renderNotice();
      expect(announce).not.toHaveBeenCalled();
    });
  });
});
