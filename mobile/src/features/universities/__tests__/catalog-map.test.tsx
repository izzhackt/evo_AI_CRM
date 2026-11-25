// Карта страны (G43): кнопки «+» и «-», загрузка, «Уменьшить движение», вузы для читалки (не для касаний), мини-карточка и кнопка
// «Назад», рамка камеры по окну, цвета слоёв по теме. Нативная карта заменена заглушкой, которая запоминает свойства и отдаёт ссылки
// на камеру, карту и источник.
import { act, fireEvent, isHiddenFromAccessibility, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, BackHandler, Dimensions, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CatalogMap } from "@/features/universities/CatalogMap";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";
import { setReducedMotionForTests } from "@/ui/motion";

const mockMap = { getZoom: jest.fn(async () => 8) };
const mockCamera = { zoomTo: jest.fn(), easeTo: jest.fn() };
const mockSource = { getClusterExpansionZoom: jest.fn(async () => 9) };
const mockState: { map: Record<string, unknown>; source: Record<string, unknown>; layers: Record<string, { paint: Record<string, unknown> }> } = { map: {}, source: {}, layers: {} };

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Map: ({ children, ref, ...props }: { children: React.ReactNode; ref?: React.Ref<unknown> }) => {
      mockState.map = props;
      React.useImperativeHandle(ref, () => mockMap);
      return <View testID="mock-map">{children}</View>;
    },
    Camera: ({ ref, ...props }: { ref?: React.Ref<unknown> }) => {
      mockState.map = { ...mockState.map, camera: props };
      React.useImperativeHandle(ref, () => mockCamera);
      return null;
    },
    GeoJSONSource: ({ children, ref, ...props }: { children: React.ReactNode; ref?: React.Ref<unknown> }) => {
      mockState.source = props;
      React.useImperativeHandle(ref, () => mockSource);
      return <View>{children}</View>;
    },
    Layer: (props: { id: string; paint: Record<string, unknown> }) => {
      mockState.layers[props.id] = props;
      return null;
    },
  };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const pins = [
  { id: "u1", name: "Университет Зета", place: "Куала-Лумпур · Малайзия", lat: 3.1, lng: 101.6 },
  { id: "u2", name: "Академия Альфа", place: "Пенанг · Малайзия", lat: 5.4, lng: 100.3 },
];
// Два кампуса в 0,1 градуса друг от друга: на телефоне рамка по ним ещё влезает, на планшете встала бы глубже масштаба 11.
const nearPins = [
  { id: "n1", name: "Кампус Север", place: "Куала-Лумпур · Малайзия", lat: 3.2, lng: 101.7 },
  { id: "n2", name: "Кампус Юг", place: "Куала-Лумпур · Малайзия", lat: 3.1, lng: 101.6 },
];

/** Размер окна приложения: по нему карта считает рамку камеры (ширина минус поля экрана по 16 pt). */
function setWindow(width: number) {
  jest.spyOn(Dimensions, "get").mockImplementation(() => ({ width, height: 844, scale: 3, fontScale: 1 }));
}

function wrap(ui: ReactElement, scheme: "light" | "dark" = "light", lang: "ru" | "ky" = "ru") {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial={scheme}>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

async function show(options: { scheme?: "light" | "dark"; lang?: "ru" | "ky"; onOpen?: (id: string) => void; onFail?: () => void; pins?: typeof pins } = {}) {
  const onOpen = options.onOpen ?? jest.fn();
  const onFail = options.onFail ?? jest.fn();
  await render(wrap(<CatalogMap pins={options.pins ?? pins} onOpen={onOpen} onFail={onFail} />, options.scheme, options.lang));
  return { onOpen, onFail };
}

/** Двойное касание читалки: на iOS - `onAccessibilityTap`, на Android - действие `activate` у узла. */
async function activate(id: string) {
  await fireEvent(screen.getByTestId(`map-pin-${id}`), "accessibilityTap");
}

async function finishLoading() {
  await act(async () => {
    (mockState.map.onDidFinishLoadingMap as () => void)();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMap.getZoom.mockResolvedValue(8);
  mockState.layers = {};
  setReducedMotionForTests(true);
  setWindow(390);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => setReducedMotionForTests(true));

describe("загрузка и сбой", () => {
  it("пока карта грузится - «Загружаем карту…» с занятым состоянием и без кнопок масштаба; потом наоборот", async () => {
    await show();
    const loading = screen.getByTestId("map-loading");
    expect(loading.props.accessibilityRole).toBe("progressbar");
    expect(loading.props.accessibilityLabel).toBe("Загружаем карту…");
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByTestId("map-zoom")).toBeNull();
    await finishLoading();
    expect(screen.queryByTestId("map-loading")).toBeNull();
    expect(screen.getByTestId("map-zoom")).toBeTruthy();
  });

  it("сбой загрузки сообщается экрану (он покажет «Города»)", async () => {
    const { onFail } = await show();
    await act(async () => {
      (mockState.map.onDidFailLoadingMap as () => void)();
    });
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("KY: «Загружаем карту…» из общего словаря", async () => {
    await show({ lang: "ky" });
    expect(screen.getByTestId("map-loading").props.accessibilityLabel).toBe("Картаны жүктөп жатабыз…");
  });
});

describe("кнопки «+» и «-»", () => {
  it("на уровень ближе и дальше от нынешнего масштаба; у кнопок названия", async () => {
    await show();
    await finishLoading();
    expect(screen.getByTestId("map-zoom-in").props.accessibilityLabel).toBe("Приблизить карту");
    expect(screen.getByTestId("map-zoom-out").props.accessibilityLabel).toBe("Отдалить карту");
    await fireEvent.press(screen.getByTestId("map-zoom-in"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(9, { duration: 0 });
    await fireEvent.press(screen.getByTestId("map-zoom-out"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(7, { duration: 0 });
  });

  it("масштаб остаётся в пределах карты: не ниже 0 и не выше 22; не ответила карта - ничего не происходит", async () => {
    await show();
    await finishLoading();
    mockMap.getZoom.mockResolvedValue(0.4);
    await fireEvent.press(screen.getByTestId("map-zoom-out"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(0, { duration: 0 });
    mockMap.getZoom.mockResolvedValue(21.6);
    await fireEvent.press(screen.getByTestId("map-zoom-in"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(22, { duration: 0 });
    mockMap.getZoom.mockResolvedValue(22);
    await fireEvent.press(screen.getByTestId("map-zoom-in"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(22, { duration: 0 });
    mockCamera.zoomTo.mockClear();
    mockMap.getZoom.mockRejectedValue(new Error("map not ready"));
    await fireEvent.press(screen.getByTestId("map-zoom-in"));
    expect(mockCamera.zoomTo).not.toHaveBeenCalled();
  });

  it("плавность только без «Уменьшить движение»: 250 мс на кнопках и 400 мс на группе", async () => {
    setReducedMotionForTests(false);
    await show();
    await finishLoading();
    await fireEvent.press(screen.getByTestId("map-zoom-in"));
    expect(mockCamera.zoomTo).toHaveBeenLastCalledWith(9, { duration: 250 });
    await act(async () => {
      await (mockState.source.onPress as (event: unknown) => Promise<void>)({ stopPropagation: jest.fn(), nativeEvent: { features: [{ properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [101, 3] } }] } });
    });
    expect(mockCamera.easeTo).toHaveBeenLastCalledWith({ center: [101, 3], zoom: 9.2, duration: 400 });
  });

  it("при «Уменьшить движение» группа приближается без анимации", async () => {
    await show();
    await act(async () => {
      await (mockState.source.onPress as (event: unknown) => Promise<void>)({ stopPropagation: jest.fn(), nativeEvent: { features: [{ properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [101, 3] } }] } });
    });
    expect(mockCamera.easeTo).toHaveBeenLastCalledWith({ center: [101, 3], zoom: 9.2, duration: 0 });
  });
});

describe("вузы на карте для читалки и мини-карточка", () => {
  it("каждый вуз - кнопка с названием, местом и подсказкой; нативная карта читалке скрыта", async () => {
    await show();
    expect(screen.getByTestId("map-pin-u1").props.accessibilityLabel).toBe("Университет Зета. Куала-Лумпур · Малайзия");
    expect(screen.getByTestId("map-pin-u1").props.accessibilityHint).toBe("Открыть карточку");
    expect(screen.getByTestId("map-pin-u2").props.accessibilityRole).toBe("button");
    expect(isHiddenFromAccessibility(screen.getByTestId("mock-map", { hidden: true }))).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByTestId("map-pin-u1"))).toBe(false);
    expect(screen.getByTestId("catalog-map").props.accessibilityLabel).toBe("Карта университетов");
  });

  it("кнопки вузов не принимают касаний: слой не ловит касание, у кнопок нет onPress, касание угла карты ничего не открывает", async () => {
    await show();
    expect(screen.getByTestId("map-reader-pins").props.pointerEvents).toBe("none");
    expect(screen.getByTestId("map-pin-u1").props.onPress).toBeUndefined();
    expect(screen.getByTestId("map-pin-u2").props.onPress).toBeUndefined();
    await fireEvent.press(screen.getByTestId("map-pin-u2"));
    await fireEvent(screen.getByTestId("map-pin-u2"), "touchEnd");
    expect(screen.queryByTestId("map-card")).toBeNull();
  });

  it("двойное касание читалки (iOS: onAccessibilityTap) открывает мини-карточку и озвучивает её; «Открыть карточку» ведёт на вуз, «Закрыть» закрывает", async () => {
    const speak = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { onOpen } = await show();
    await activate("u2");
    expect(screen.getByTestId("map-card")).toBeTruthy();
    expect(screen.getByText("Академия Альфа")).toBeTruthy();
    expect(speak).toHaveBeenCalledWith("Академия Альфа. Пенанг · Малайзия");
    await fireEvent.press(screen.getByTestId("map-open"));
    expect(onOpen).toHaveBeenCalledWith("u2");
    expect(screen.getByTestId("map-close").props.accessibilityLabel ?? "Закрыть").toBe("Закрыть");
    await fireEvent.press(screen.getByTestId("map-close"));
    expect(screen.queryByTestId("map-card")).toBeNull();
  });

  it("TalkBack: у кнопки есть действие activate (ACTION_CLICK), и оно открывает карточку; другие действия - нет; на iOS действий нет (двойное касание - onAccessibilityTap)", async () => {
    await show();
    expect(screen.getByTestId("map-pin-u1").props.accessibilityActions).toBeUndefined();
    jest.replaceProperty(Platform, "OS", "android");
    try {
      await show();
      const pin = screen.getAllByTestId("map-pin-u1").at(-1)!;
      expect(pin.props.accessibilityActions).toEqual([{ name: "activate" }]);
      await fireEvent(pin, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
      expect(screen.queryByTestId("map-card")).toBeNull();
      await fireEvent(pin, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
      expect(screen.getByText("Университет Зета")).toBeTruthy();
    } finally {
      jest.replaceProperty(Platform, "OS", "ios");
    }
  });

  it("нажатие на точку карты открывает карточку, нажатие на пустое место закрывает", async () => {
    await show();
    await act(async () => {
      await (mockState.source.onPress as (event: unknown) => Promise<void>)({ stopPropagation: jest.fn(), nativeEvent: { features: [{ properties: { pin: 0 }, geometry: { type: "Point", coordinates: [101.6, 3.1] } }] } });
    });
    expect(screen.getByText("Университет Зета")).toBeTruthy();
    await act(async () => {
      (mockState.map.onPress as () => void)();
    });
    expect(screen.queryByTestId("map-card")).toBeNull();
  });

  it("«Назад» на Android закрывает мини-карточку, а не страницу; без карточки обработчика нет", async () => {
    const subscribe = jest.spyOn(BackHandler, "addEventListener");
    await show();
    expect(subscribe).not.toHaveBeenCalled();
    await activate("u1");
    expect(screen.getByTestId("map-card")).toBeTruthy();
    expect(subscribe).toHaveBeenCalledWith("hardwareBackPress", expect.any(Function));
    const handled = subscribe.mock.calls[0]![1] as () => boolean;
    let answer = false;
    await act(async () => {
      answer = handled();
    });
    expect(answer).toBe(true); // «Назад» поглощена: страница остаётся
    expect(screen.queryByTestId("map-card")).toBeNull();
  });
});

describe("рамка камеры по окну карты", () => {
  const initial = () => (mockState.map.camera as { initialViewState: Record<string, unknown> }).initialViewState;

  it("телефон: два кампуса в 0,1 градуса - рамка с полями; планшет - центр на предельном масштабе 11 (веб: fitBounds, maxZoom 11)", async () => {
    setWindow(390);
    await show({ pins: nearPins });
    expect(initial()).toMatchObject({ bounds: [101.6, 3.1, 101.7, 3.2], padding: { top: 48, right: 48, bottom: 48, left: 48 } });
    setWindow(744);
    await show({ pins: nearPins });
    expect(initial()).toMatchObject({ zoom: 11 });
    expect(initial().bounds).toBeUndefined();
  });

  it("разброс по стране - рамка при любом окне", async () => {
    setWindow(744);
    await show();
    expect(initial()).toMatchObject({ bounds: [100.3, 3.1, 101.6, 5.4] });
  });
});

describe("цвета по теме (тёмная тема: подпись на акценте не хуже 4,5:1)", () => {
  it("светлая: белая подпись и кольцо поверхности; тёмная: подпись токена onAccent", async () => {
    await show({ scheme: "light" });
    expect(mockState.layers["cluster-count"]!.paint["text-color"]).toBe(lightTokens.onAccent);
    expect(mockState.layers["clusters"]!.paint["circle-stroke-color"]).toBe(lightTokens.surface);
    expect(mockState.map.mapStyle).toBe("https://tiles.openfreemap.org/styles/positron");
  });

  it("тёмная тема", async () => {
    await show({ scheme: "dark" });
    expect(mockState.layers["cluster-count"]!.paint["text-color"]).toBe(darkTokens.onAccent);
    expect(mockState.layers["clusters"]!.paint["circle-color"]).toBe(darkTokens.accent);
    expect(mockState.layers["points"]!.paint["circle-stroke-color"]).toBe(darkTokens.surface);
    expect(mockState.map.mapStyle).toBe("https://tiles.openfreemap.org/styles/dark");
    // подпись на акценте контрастна: тёмный текст на светлом акценте
    const contrast = (a: string, b: string) => {
      const lum = (hex: string) => {
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
      };
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    expect(contrast(darkTokens.onAccent, darkTokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", darkTokens.accent)).toBeLessThan(4.5); // прежняя белая подпись не проходила
  });
});
