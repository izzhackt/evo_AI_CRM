import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { NotificationBell } from "@/shell/NotificationBell";
import { ThemeProvider } from "@/theme/ThemeProvider";

let mockUnread: number | null = null;
jest.mock("@/api/PortalPoll", () => ({ usePortalUnread: () => mockUnread }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => "/home" }));
const navigate = router.navigate as jest.Mock;
const withOptions = AccessibilityInfo.announceForAccessibilityWithOptions as unknown as jest.Mock;
const plain = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

// Кружок скрыт от читалки (имя несёт кнопка), поэтому по умолчанию тест его не видит.
const HIDDEN = { includeHiddenElements: true } as const;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const tree = (lang: "ru" | "ky") => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <LangProvider initial={lang}>
        <NotificationBell />
      </LangProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);
const renderBell = (lang: "ru" | "ky" = "ru") => render(tree(lang));

beforeEach(() => {
  mockUnread = null;
  navigate.mockClear();
  withOptions.mockClear();
  plain.mockClear();
});

describe("колокольчик «Что нового» (веб: PortalNotificationUpdates)", () => {
  it.each([
    [null, "Что нового"],
    [0, "Новых уведомлений нет"],
    [1, "Новых уведомлений: 1"],
    [12, "Новых уведомлений: 12"],
  ])("число %s: имя для читалки «%s»", async (unread, label) => {
    mockUnread = unread;
    await renderBell();
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByTestId("notification-bell").props.accessibilityRole).toBe("link");
  });

  it("кыргызский язык: имена из общего словаря", async () => {
    mockUnread = 3;
    const view = await renderBell("ky");
    expect(screen.getByLabelText("Жаңы билдирмелер: 3")).toBeTruthy();
    mockUnread = 0;
    await view.rerender(tree("ky"));
    expect(screen.getByLabelText("Жаңы билдирмелер жок")).toBeTruthy();
    mockUnread = null;
    await view.rerender(tree("ky"));
    expect(screen.getByLabelText("Эмне жаңы")).toBeTruthy();
  });

  it("кружок с числом: нет при неизвестном и при нуле, 99+ у больших, читалке не виден", async () => {
    mockUnread = null;
    const view = await renderBell();
    expect(screen.queryByTestId("notification-bell-count", HIDDEN)).toBeNull();
    mockUnread = 0;
    await view.rerender(tree("ru"));
    expect(screen.queryByTestId("notification-bell-count", HIDDEN)).toBeNull();
    mockUnread = 7;
    await view.rerender(tree("ru"));
    expect(screen.getByTestId("notification-bell-count", HIDDEN)).toHaveTextContent("7");
    expect(screen.getByTestId("notification-bell-count", HIDDEN).props.accessibilityElementsHidden).toBe(true);
    mockUnread = 99;
    await view.rerender(tree("ru"));
    expect(screen.getByTestId("notification-bell-count", HIDDEN)).toHaveTextContent("99");
    mockUnread = 100;
    await view.rerender(tree("ru"));
    expect(screen.getByTestId("notification-bell-count", HIDDEN)).toHaveTextContent("99+");
  });

  it("нажатие ведёт в ленту «Что нового»", async () => {
    mockUnread = 2;
    await renderBell();
    await fireEvent.press(screen.getByTestId("notification-bell"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
  });

  describe("сообщение читалке при смене числа (веб: невидимый role=status)", () => {
    it("iPhone: известное число сменилось другим известным - одно сообщение в очередь за текущей речью", async () => {
      mockUnread = 3;
      const view = await renderBell();
      expect(withOptions).not.toHaveBeenCalled(); // первое число не озвучивается
      mockUnread = 5;
      await act(async () => {
        await view.rerender(tree("ru"));
      });
      expect(withOptions).toHaveBeenCalledTimes(1);
      expect(withOptions).toHaveBeenCalledWith("Новых уведомлений: 5", { queue: true });
      mockUnread = 0;
      await act(async () => {
        await view.rerender(tree("ru"));
      });
      expect(withOptions).toHaveBeenLastCalledWith("Новых уведомлений нет", { queue: true });
    });

    it("тот же число, потеря числа после сбоя и возвращение после него не озвучиваются", async () => {
      mockUnread = 3;
      const view = await renderBell();
      await act(async () => {
        await view.rerender(tree("ru"));
      });
      mockUnread = null; // сбой опроса
      await act(async () => {
        await view.rerender(tree("ru"));
      });
      mockUnread = 4; // восстановилось
      await act(async () => {
        await view.rerender(tree("ru"));
      });
      expect(withOptions).not.toHaveBeenCalled();
      expect(plain).not.toHaveBeenCalled();
    });

    it("Android: сообщения читалке нет (работает живая область у самой кнопки)", async () => {
      jest.replaceProperty(Platform, "OS", "android");
      try {
        mockUnread = 3;
        const view = await renderBell();
        mockUnread = 6;
        await act(async () => {
          await view.rerender(tree("ru"));
        });
        expect(withOptions).not.toHaveBeenCalled();
        expect(plain).not.toHaveBeenCalled();
        expect(screen.getByTestId("notification-bell").props.accessibilityLiveRegion).toBe("polite");
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});
