import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { reportTopNoticeHeight, useTopChromeHeight } from "@/shell/top-chrome";
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
  mockRetry.mockClear();
  announce.mockClear();
  reportUpdatePromptVisible(false);
  reportTopNoticeHeight(0);
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

  it("стоит в потоке раскладки, а не поверх содержимого: без абсолютного положения и сдвигов, во всю ширину под верхней полосой (QA#2, D4)", async () => {
    mockFailed = true;
    await renderNotice();
    const anchor = StyleSheet.flatten(screen.getByTestId("poll-failure-anchor").props.style);
    expect(anchor.position).not.toBe("absolute");
    expect(anchor).not.toHaveProperty("top");
    expect(anchor).not.toHaveProperty("right");
    const card = StyleSheet.flatten(screen.getByTestId("poll-failure").props.style);
    expect(card.position).not.toBe("absolute");
    expect(card.width).toBeUndefined(); // ширина по месту, а не 320 pt: в потоке карточка занимает строку
  });

  describe("высота карточки идёт экранам с клавиатурой (`shell/top-chrome.ts`)", () => {
    function Chrome() {
      return <Text testID="chrome">{String(useTopChromeHeight())}</Text>;
    }
    const withChrome = () => (
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LangProvider initial="ru">
            <PollFailureNotice />
            <Chrome />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    );
    const chrome = () => screen.getByTestId("chrome").props.children as string;

    it("после раскладки карточка сообщает высоту; ушла - сообщает 0", async () => {
      mockFailed = true;
      const view = await render(withChrome());
      expect(chrome()).toBe("99"); // 47 + 52, раскладки ещё не было
      await fireEvent(screen.getByTestId("poll-failure-anchor"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 60 } } });
      expect(chrome()).toBe("159");
      await act(async () => reportUpdatePromptVisible(true)); // уступила карточке обновления
      expect(screen.queryByTestId("poll-failure")).toBeNull();
      expect(chrome()).toBe("99");
      await view.unmount();
    });

    it("карточка размонтирована (выход из кабинета): высота не залипает", async () => {
      mockFailed = true;
      const view = await render(withChrome());
      await fireEvent(screen.getByTestId("poll-failure-anchor"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 60 } } });
      await view.unmount();
      const probe = await render(
        <SafeAreaProvider initialMetrics={metrics}>
          <Chrome />
        </SafeAreaProvider>,
      );
      expect(probe.getByTestId("chrome")).toHaveTextContent("99");
    });
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
