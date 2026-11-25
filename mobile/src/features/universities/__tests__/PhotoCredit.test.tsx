// «©» на фото (G41): кнопка и панель, ссылки, одна открытая панель на экране, читалка.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, BackHandler, Linking, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getPortalStrings } from "@web/lib/portal/i18n";

import { closeCreditPanel, PhotoCredit } from "@/features/universities/PhotoCredit";
import { geographyPhotoCredit, universityPhotoCredit } from "@/features/universities/photos";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

// Уход с экрана в тесте: эффект фокуса ведёт учёт, а «уход» играет сам тест, вызывая очистку (как react-navigation при blur).
const mockLeave = new Set<() => void>();
jest.mock("@/lib/focus", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(() => {
      const leave = callback();
      if (typeof leave === "function") mockLeave.add(leave);
      return () => {
        if (typeof leave === "function") {
          mockLeave.delete(leave);
          leave();
        }
      };
    }, [callback]);
  },
}));
const leaveScreen = () =>
  act(async () => {
    for (const leave of [...mockLeave]) leave();
  });

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const ru = getPortalStrings("universities", "ru");

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const place = geographyPhotoCredit({
  path: "geography/cities/penang-0123456789ab.jpg",
  width: 2000,
  height: 1200,
  author: "Автор Тестов",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Autor",
  sourceName: "Wikimedia Commons",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Test.jpg",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
});

describe("PhotoCredit", () => {
  it("без подписи ничего не рисуется", async () => {
    await render(wrap(<PhotoCredit credit={null} strings={ru} />));
    expect(screen.queryByTestId("photo-credit")).toBeNull();
  });

  it("кнопка «Автор и лицензия фото» закрыта, нажатие открывает панель, повторное закрывает; состояние читается", async () => {
    await render(wrap(<PhotoCredit credit={place} strings={ru} />));
    const button = screen.getByTestId("photo-credit");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Автор и лицензия фото");
    expect(button.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
    await fireEvent.press(button);
    expect(screen.getByTestId("photo-credit-panel")).toBeTruthy();
    expect(screen.getByTestId("photo-credit").props.accessibilityState).toEqual({ expanded: true });
    expect(screen.getByText(/Фото: /)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
  });

  it("автор, источник и лицензия - три ссылки, каждая открывает свой адрес; ссылка у текста, а не у всей панели", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(wrap(<PhotoCredit credit={place} strings={ru} />));
    await fireEvent.press(screen.getByTestId("photo-credit"));
    const links = screen.getAllByTestId("photo-credit-link");
    expect(links.map((node) => node.props.children)).toEqual(["Автор Тестов", "Wikimedia Commons", "CC BY-SA 4.0"]);
    expect(links.every((node) => node.props.accessibilityRole === "link")).toBe(true);
    for (const node of links) await fireEvent.press(node);
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      "https://commons.wikimedia.org/wiki/User:Autor",
      "https://commons.wikimedia.org/wiki/File:Test.jpg",
      "https://creativecommons.org/licenses/by-sa/4.0/",
    ]);
    open.mockRestore();
  });

  it("официальный сайт вуза: «Фото: <вуз>, официальный сайт», название ведёт на страницу источника", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const official = universityPhotoCredit("xjtlu");
    await render(wrap(<PhotoCredit credit={official} universityName="Тестовый университет" strings={ru} placement="bottom" testID="uni-credit" />));
    await fireEvent.press(screen.getByTestId("uni-credit"));
    const [link] = screen.getAllByTestId("uni-credit-link");
    expect(link.props.children).toBe("Тестовый университет");
    await fireEvent.press(link);
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^https:\/\//);
    open.mockRestore();
  });

  it("открытая панель всегда одна: открытие другой закрывает прежнюю", async () => {
    await render(
      wrap(
        <View>
          <PhotoCredit credit={place} strings={ru} testID="a" />
          <PhotoCredit credit={place} strings={ru} testID="b" />
        </View>,
      ),
    );
    await fireEvent.press(screen.getByTestId("a"));
    expect(screen.getByTestId("a-panel")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("b"));
    expect(screen.queryByTestId("a-panel")).toBeNull();
    expect(screen.getByTestId("b-panel")).toBeTruthy();
  });

  it("при открытии подпись озвучивается читалке; закрытие молчит", async () => {
    const speak = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await render(wrap(<PhotoCredit credit={place} strings={ru} />));
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(speak).toHaveBeenCalledWith("Фото: Автор Тестов, Wikimedia Commons, CC BY-SA 4.0");
    speak.mockClear();
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(speak).not.toHaveBeenCalled();
    speak.mockRestore();
  });

  it("KY: подпись и название кнопки из общего словаря", async () => {
    const ky = getPortalStrings("universities", "ky");
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LangProvider initial="ky">
            <PhotoCredit credit={place} strings={ky} />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId("photo-credit").props.accessibilityLabel).toBe("Сүрөттүн автору жана лицензиясы");
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(screen.getByText(/Сүрөт: /)).toBeTruthy();
  });

  it("размонтированная открытая панель не оставляет «открытым» чужое состояние", async () => {
    const first = await render(wrap(<PhotoCredit credit={place} strings={ru} testID="a" />));
    await fireEvent.press(screen.getByTestId("a"));
    await first.unmount();
    await render(wrap(<PhotoCredit credit={place} strings={ru} testID="b" />));
    expect(screen.queryByTestId("b-panel")).toBeNull();
  });
});

describe("PhotoCredit: панель закрывается сама", () => {
  it("«Назад» Android закрывает открытую панель, а не страницу; у закрытой панели обработчика нет и после закрытия он снят", async () => {
    const remove = jest.fn();
    const subscribe = jest.spyOn(BackHandler, "addEventListener").mockImplementation(() => ({ remove }));
    await render(wrap(<PhotoCredit credit={place} strings={ru} />));
    expect(subscribe).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(subscribe).toHaveBeenCalledWith("hardwareBackPress", expect.any(Function));
    const back = subscribe.mock.calls[0]![1] as () => boolean;
    let answer = false;
    await act(async () => {
      answer = back();
    });
    expect(answer).toBe(true); // «Назад» поглощена: страница остаётся
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
    expect(remove).toHaveBeenCalled();
    subscribe.mockRestore();
  });

  it("уход с экрана закрывает панель: на вернувшемся экране она закрыта", async () => {
    await render(wrap(<PhotoCredit credit={place} strings={ru} />));
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(screen.getByTestId("photo-credit-panel")).toBeTruthy();
    await leaveScreen();
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
    expect(screen.getByTestId("photo-credit").props.accessibilityState).toEqual({ expanded: false });
  });

  it("касание мимо подписи (и начало прокрутки) закрывает панель; касание внутри подписи до экрана не доходит", async () => {
    await render(
      wrap(
        <View testID="content" onTouchStart={closeCreditPanel}>
          <PhotoCredit credit={place} strings={ru} />
        </View>,
      ),
    );
    await fireEvent.press(screen.getByTestId("photo-credit"));
    expect(screen.getByTestId("photo-credit-panel")).toBeTruthy();
    // касание кнопки или панели останавливается у подписи: иначе оно закрыло бы панель, а нажатие открыло бы её снова
    const stop = jest.fn();
    await fireEvent(screen.getByTestId("photo-credit"), "touchStart", { stopPropagation: stop });
    await fireEvent(screen.getByTestId("photo-credit-panel"), "touchStart", { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("photo-credit-panel")).toBeTruthy();
    // касание содержимого экрана мимо подписи
    await fireEvent(screen.getByTestId("content"), "touchStart");
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
    // закрытой панели такое касание ничего не меняет
    await fireEvent(screen.getByTestId("content"), "touchStart");
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
  });
});
