// Сбой карты на странице страны (G43): предупреждение со словами веба, выход на «Города» и повтор; сбой не липнет к экрану.
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

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
const mockMounts = { count: 0 };
jest.mock("@/features/universities/CatalogMap", () => ({
  CatalogMap: ({ onFail }: { onFail: () => void }) => {
    const React = jest.requireActual("react");
    const { Pressable } = jest.requireActual("react-native");
    React.useEffect(() => {
      mockMounts.count += 1;
    }, []);
    return <Pressable testID="fail-map" onPress={onFail} />;
  },
}));
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

const index = () => fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });

beforeEach(() => {
  mockMounts.count = 0;
  jest.mocked(router.setParams).mockClear();
});

describe("страна, вид «Карта»", () => {
  it("карта не загрузилась: предупреждение «Карту не удалось загрузить…» и кнопка «Города», которая возвращает вид городов", async () => {
    mockParams.current = { code: "my", view: "map" };
    await renderPortal(<CountryScreen />, testApi(index().transport));
    await fireEvent.press(await screen.findByTestId("fail-map"));
    const alert = screen.getByTestId("map-failed");
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(screen.getByText("Карту не удалось загрузить. Города и вузы страны есть в разделе «Города».")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("map-failed-cities"));
    expect(router.setParams).toHaveBeenCalledWith({ view: undefined });
  });

  it("«Повторить» начинает загрузку карты заново: предупреждение уходит, карта монтируется снова, второй сбой снова показывает его", async () => {
    mockParams.current = { code: "my", view: "map" };
    await renderPortal(<CountryScreen />, testApi(index().transport));
    await fireEvent.press(await screen.findByTestId("fail-map"));
    expect(screen.getByTestId("map-failed")).toBeTruthy();
    expect(screen.queryByTestId("fail-map")).toBeNull();
    expect(mockMounts.count).toBe(1);
    expect(screen.getByTestId("map-failed-retry").props.accessibilityLabel ?? "Повторить").toBe("Повторить");
    await fireEvent.press(screen.getByTestId("map-failed-retry"));
    expect(screen.queryByTestId("map-failed")).toBeNull();
    expect(mockMounts.count).toBe(2);
    await fireEvent.press(screen.getByTestId("fail-map"));
    expect(screen.getByTestId("map-failed")).toBeTruthy();
  });

  it("сбой не живёт до ухода с экрана: выбор «Карта» заново (из другого вида) начинает загрузку заново", async () => {
    const api = testApi(index().transport);
    mockParams.current = { code: "my", view: "map" };
    const view = await renderPortal(<CountryScreen />, api);
    await fireEvent.press(await screen.findByTestId("fail-map"));
    expect(screen.getByTestId("map-failed")).toBeTruthy();
    const again = () => view.rerender(<PortalShell api={api} client={view.client}><CountryScreen /></PortalShell>);
    // ушли на «Списком»: параметр вида меняет роутер (в тесте он заглушка, вид меняется вручную)
    mockParams.current = { code: "my", view: "list" };
    await again();
    expect(screen.queryByTestId("map-failed")).toBeNull();
    await fireEvent.press(screen.getByTestId("view-map"));
    expect(router.setParams).toHaveBeenLastCalledWith({ view: "map" });
    mockParams.current = { code: "my", view: "map" };
    await again();
    expect(await screen.findByTestId("fail-map")).toBeTruthy();
    expect(screen.queryByTestId("map-failed")).toBeNull();
  });

  it("повторное нажатие на уже выбранную «Карту» не перезагружает здоровую карту, а после сбоя повторяет загрузку", async () => {
    mockParams.current = { code: "my", view: "map" };
    await renderPortal(<CountryScreen />, testApi(index().transport));
    await screen.findByTestId("fail-map");
    await fireEvent.press(screen.getByTestId("view-map"));
    expect(mockMounts.count).toBe(1);
    await fireEvent.press(screen.getByTestId("fail-map"));
    expect(screen.getByTestId("map-failed")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("view-map"));
    expect(screen.queryByTestId("map-failed")).toBeNull();
    expect(mockMounts.count).toBe(2);
  });

  it("ни у одного вуза нет точки: это не сбой, а сводка «Без точки на карте», без предупреждения и без кнопки", async () => {
    mockParams.current = { code: "cn", view: "map" };
    await renderPortal(<CountryScreen />, testApi(index().transport));
    const note = await screen.findByTestId("map-failed");
    expect(note.props.accessibilityRole).toBeUndefined();
    expect(screen.getByText(/Без точки на карте: 2/)).toBeTruthy();
    expect(screen.queryByTestId("map-failed-cities")).toBeNull();
    expect(screen.queryByTestId("fail-map")).toBeNull();
  });
});
