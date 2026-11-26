// Карточка вуза (G47): не перерисовывается, если не изменилась она сама. Окно прокрутки (NearList) меняет `photoActive` у единиц
// карточек из 165, сборка порциями добавляет новые, остальные должны стоять. Модель карточки экран строит заново при каждой
// отрисовке, поэтому её сравнивают по содержимому; переключатель сердечка - одна и та же функция между отрисовками.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getPortalStrings } from "@web/lib/portal/i18n";

import { UniversityTileView } from "@/features/universities/cards";
import { useFavoriteState } from "@/features/universities/FavoritesContext";
import type { TileModel } from "@/features/universities/model";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

// Каждая отрисовка карточки один раз строит адреса её фото: по числу вызовов видно, сколько раз она отрисовывалась.
const mockDrawn = jest.fn();
jest.mock("@/features/universities/parts", () => {
  const actual = jest.requireActual<typeof import("@/features/universities/parts")>("@/features/universities/parts");
  return {
    ...actual,
    universityUrls: (...args: Parameters<typeof actual.universityUrls>) => {
      mockDrawn();
      return actual.universityUrls(...args);
    },
  };
});
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const strings = getPortalStrings("universities", "ru");
const onToggle = jest.fn();

const model = (over: Partial<TileModel> = {}): TileModel => ({ id: "u1", name: "Университет Зета", place: "Куала-Лумпур", levels: ["Бакалавриат", "Магистратура"], intake: "Осень 2027", photoKey: null, ...over });

type Props = Parameters<typeof UniversityTileView>[0];
const tree = (props: Props) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <LangProvider initial="ru">
        <UniversityTileView {...props} />
      </LangProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);
const base = (over: Partial<Props> = {}): Props => ({ tile: model(), strings, favored: false, onToggle, photoActive: false, ...over });

beforeEach(() => mockDrawn.mockClear());

describe("UniversityTileView: перерисовка только по делу", () => {
  it("те же свойства, а модель - новый объект с тем же содержимым: карточка не перерисовывается", async () => {
    const view = await render(tree(base()));
    expect(mockDrawn).toHaveBeenCalledTimes(1);
    await view.rerender(tree(base({ tile: model({ levels: ["Бакалавриат", "Магистратура"] }) })));
    await view.rerender(tree(base()));
    expect(mockDrawn).toHaveBeenCalledTimes(1);
  });

  it("окно прокрутки: `photoActive` изменился - карточка перерисовывается; сердечко и содержимое тоже", async () => {
    const view = await render(tree(base()));
    await view.rerender(tree(base({ photoActive: true })));
    expect(mockDrawn).toHaveBeenCalledTimes(2);
    await view.rerender(tree(base({ photoActive: true, favored: true })));
    expect(mockDrawn).toHaveBeenCalledTimes(3);
    await view.rerender(tree(base({ photoActive: true, favored: true, priority: "high" })));
    expect(mockDrawn).toHaveBeenCalledTimes(4);
    await view.rerender(tree(base({ photoActive: true, favored: true, priority: "high", tile: model({ name: "Академия Альфа" }) })));
    expect(mockDrawn).toHaveBeenCalledTimes(5);
    expect(screen.getByText("Академия Альфа")).toBeTruthy();
  });

  it("изменились уровни или ближайший набор: карточка показывает новое", async () => {
    const view = await render(tree(base()));
    await view.rerender(tree(base({ tile: model({ levels: ["Бакалавриат"] }) })));
    expect(mockDrawn).toHaveBeenCalledTimes(2);
    await view.rerender(tree(base({ tile: model({ levels: ["Бакалавриат"], intake: "Весна 2028" }) })));
    expect(mockDrawn).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Весна 2028/)).toBeTruthy();
  });
});

describe("переключатель сердечка", () => {
  it("одна и та же функция между отрисовками экрана: карточки могут её сравнивать", async () => {
    const seen: unknown[] = [];
    function Probe() {
      const favorites = useFavoriteState();
      const [, again] = useState(0);
      seen.push(favorites.toggle);
      return <Pressable testID="again" onPress={() => again((n) => n + 1)} />;
    }
    const t = fakeTransport({ student_university_favorites_v1: [] });
    await renderPortal(<Probe />, testApi(t.transport));
    await fireEvent.press(screen.getByTestId("again"));
    await fireEvent.press(screen.getByTestId("again"));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});
