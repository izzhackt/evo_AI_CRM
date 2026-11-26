// Карта на странице страны: обработчик «Назад» открытой карточки не подписывается заново при каждой отрисовке экрана (ревью, мелочь 11).
// Экран строит модель страницы (`countryPageModel`) при каждой отрисовке; пока точки новые, выбранная точка каждый раз «другая»,
// и обработчик снимался и ставился заново (порядок среди других обработчиков «Назад» менялся). Нативная карта подменена заглушкой.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { BackHandler } from "react-native";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { PortalShell, renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@maplibre/maplibre-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Map: ({ children }: { children?: React.ReactNode }) => <View testID="mock-map">{children}</View>,
    Camera: () => null,
    GeoJSONSource: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
    Layer: () => null,
  };
});
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    delete() {}
  }
  class File {
    exists = false;
    async text() {
      return "";
    }
    create() {}
    write() {}
    delete() {}
  }
  return { Directory, File, Paths: { cache: "cache" } };
});

describe("карта страны: «Назад» открытой карточки", () => {
  it("перерисовка экрана (новая модель страницы) обработчик не пересоздаёт: он подписан один раз и не снимался", async () => {
    mockParams.current = { code: "my", view: "map" };
    const remove = jest.fn();
    const subscribe = jest.spyOn(BackHandler, "addEventListener").mockImplementation(() => ({ remove }));
    const api = testApi(fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] }).transport);
    const view = await renderPortal(<CountryScreen />, api);
    const [pin] = await screen.findAllByTestId(/^map-pin-/);
    await fireEvent(pin!, "accessibilityTap");
    expect(screen.getByTestId("map-card")).toBeTruthy();
    expect(subscribe).toHaveBeenCalledTimes(1);

    // экран перерисован (так же бывает от любого его состояния): модель страницы строится заново
    for (let i = 0; i < 3; i += 1) {
      await view.rerender(
        <PortalShell api={api} client={view.client}>
          <CountryScreen />
        </PortalShell>,
      );
    }
    expect(screen.getByTestId("map-card")).toBeTruthy();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    // и обработчик настоящий: «Назад» закрывает карточку
    const back = subscribe.mock.calls[0]![1] as () => boolean;
    let answer = false;
    await act(async () => {
      answer = back();
    });
    expect(answer).toBe(true);
    expect(screen.queryByTestId("map-card")).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    subscribe.mockRestore();
  });
});
