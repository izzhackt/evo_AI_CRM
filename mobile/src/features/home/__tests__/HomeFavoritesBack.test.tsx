// «Всё избранное» и доступность (ревью #1561): нажатие озвучивает новый вид, а Android-«Назад» при открытом списке закрывает его,
// не выходя из приложения. Обработчик «Назад» привязан к фокусу вкладки: ушла вкладка - обработчика нет, чужой экран не страдает.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, BackHandler } from "react-native";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { HomeScreen } from "@/features/home/HomeScreen";
import { favorites, homeHandlers, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn(), push: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());
// Фокус вкладки управляется из теста: общий упрощённый `useFocusEffect` из jest.setup.ts не умеет «ушла из фокуса».
jest.mock("@/lib/focus", () => {
  const { useEffect, useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
  let focused = true;
  const listeners = new Set<() => void>();
  return {
    __setFocused: (value: boolean) => {
      focused = value;
      for (const listener of [...listeners]) listener();
    },
    useFocusEffect: (effect: () => void | (() => void)) => {
      const isFocused = useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => focused,
      );
      useEffect(() => (isFocused ? effect() : undefined), [effect, isFocused]);
    },
  };
});
const setFocused = (jest.requireMock("@/lib/focus") as { __setFocused: (value: boolean) => void }).__setFocused;

type Subscription = { handler: () => boolean | null | undefined; removed: boolean };
let subscriptions: Subscription[] = [];
/** Обработчики «Назад», которые сейчас стоят (добавлены и не сняты). */
const active = () => subscriptions.filter((entry) => !entry.removed);
/** Нажатие аппаратной «Назад»: последний поставленный обработчик первым, `true` - нажатие поглощено. */
const pressBack = (): boolean => {
  for (const entry of [...active()].reverse()) if (entry.handler()) return true;
  return false;
};

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear();
  await AsyncStorage.clear();
  setFocused(true);
  subscriptions = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_event: string, handler: Subscription["handler"]) => {
    const entry: Subscription = { handler, removed: false };
    subscriptions.push(entry);
    return { remove: () => void (entry.removed = true) };
  }) as never);
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(() => {
  restoreNow();
  jest.restoreAllMocks();
});

async function open(lang: "ru" | "ky" = "ru", count = 2) {
  const { transport } = fakeTransport(homeHandlers("MY", { student_university_favorites_v1: favorites(count), student_hidden_university_favorites_v1: { hiddenCount: 0 } }));
  await renderPortal(<HomeScreen />, testApi(transport), lang);
  await fireEvent.press(await screen.findByTestId("favorites-all"));
  await screen.findByTestId("favorites-all-view");
}

describe("нажатие «Всё избранное»: читалка слышит новый вид", () => {
  it.each(["ru", "ky"] as const)("%s: «Всё избранное. Сохранено: N» из общего словаря", async (lang) => {
    await open(lang, 2);
    const home = getPortalStrings("home", lang);
    const favoritesStrings = getPortalStrings("favorites", lang);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(`${home.favoritesAll}. ${favoritesStrings.savedCount.replace("{count}", "2")}`);
  });

  it("до нажатия ничего не озвучивается, число - общее число избранного, а не четырёх карточек ленты", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_university_favorites_v1: favorites(7), student_hidden_university_favorites_v1: { hiddenCount: 0 } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("favorites-all");
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("favorites-all"));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Всё избранное. Сохранено: 7");
  });
});

describe("Android «Назад» при открытом полном списке", () => {
  it("список закрыт - обработчика нет, «Назад» работает как обычно", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("favorites-all");
    expect(active()).toHaveLength(0);
    expect(pressBack()).toBe(false);
  });

  it("список открыт - «Назад» закрывает его и поглощает нажатие; после закрытия обработчик снят", async () => {
    await open();
    expect(active()).toHaveLength(1);
    let swallowed = false;
    await act(async () => {
      swallowed = pressBack();
    });
    expect(swallowed).toBe(true);
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    expect(await screen.findByTestId("home-favorites")).toBeTruthy(); // вернулась лента
    expect(active()).toHaveLength(0);
    expect(pressBack()).toBe(false); // второе «Назад» уже не наше
  });

  it("вкладка ушла из фокуса - обработчик снят и не перехватывает «Назад» чужого экрана; вернулась - список открыт и «Назад» снова наше", async () => {
    await open();
    expect(active()).toHaveLength(1);
    await act(async () => setFocused(false));
    expect(active()).toHaveLength(0);
    expect(pressBack()).toBe(false);
    expect(screen.getByTestId("favorites-all-view")).toBeTruthy(); // сам список остался, как и положено вкладке в фоне
    await act(async () => setFocused(true));
    expect(active()).toHaveLength(1);
    await act(async () => {
      pressBack();
    });
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
  });

  it("экран закрыт совсем: обработчик снят", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    const view = await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("favorites-all"));
    await screen.findByTestId("favorites-all-view");
    expect(active()).toHaveLength(1);
    await view.unmount();
    expect(active()).toHaveLength(0);
  });

  it("вкладка «Вузы» (нажатие на уже выбранную) закрывает список и снимает обработчик, как и «Назад»", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("tab-universities"));
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    expect(active()).toHaveLength(0);
  });
});
