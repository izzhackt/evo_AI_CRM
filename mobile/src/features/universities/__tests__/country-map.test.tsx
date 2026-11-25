// Сбой карты на странице страны (G43): предупреждение со словами веба и выходом на «Города».
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/features/universities/CatalogMap", () => ({
  CatalogMap: ({ onFail }: { onFail: () => void }) => {
    const { Pressable } = jest.requireActual("react-native");
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
