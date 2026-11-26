// «©» на экранах каталога закрывается сама (G41, ревью): касание содержимого мимо подписи и начало прокрутки (палец ложится на содержимое)
// закрывают открытую панель, как клик вне подписи у веба. Сами закрытия «Назад» и уходом с экрана - в PhotoCredit.test.tsx.
import { fireEvent, screen } from "@testing-library/react-native";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, STUDENT_CASE_ID, universityContent, uuidN } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/features/universities/CatalogMap", () => ({ CatalogMap: () => null }));
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

describe("«©» закрывается касанием содержимого экрана", () => {
  it("страна: открыли «©» на карточке города, коснулись содержимого - панель закрыта; касание самой «©» её не закрывает", async () => {
    mockParams.current = { code: "my" };
    const t = fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });
    await renderPortal(<CountryScreen />, testApi(t.transport));
    await fireEvent.press(await screen.findByTestId("credit-penang"));
    expect(screen.getByTestId("credit-penang-panel")).toBeTruthy();
    // касание внутри подписи останавливается у неё и до содержимого не доходит
    const stop = jest.fn();
    await fireEvent(screen.getByTestId("credit-penang"), "touchStart", { stopPropagation: stop });
    expect(stop).toHaveBeenCalled();
    expect(screen.getByTestId("credit-penang-panel")).toBeTruthy();
    await fireEvent(screen.getByTestId("catalog-content"), "touchStart");
    expect(screen.queryByTestId("credit-penang-panel")).toBeNull();
  });

  it("страница вуза: то же для «©» на фото вуза", async () => {
    mockParams.current = { id: uuidN(1) };
    const detail = {
      university: { id: uuidN(1), version: 1, publishedAt: "2026-10-01T00:00:00+00:00", content: { ...universityContent("Университет Зета"), photoKey: "apu" } },
      country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
      city: null,
      favored: false,
      openConsultation: null,
      preparations: { studentCaseId: STUDENT_CASE_ID, items: [] },
      costs: null,
    };
    const t = fakeTransport({ student_university_detail_v1: detail, student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    await fireEvent.press(await screen.findByTestId("photo-credit"));
    expect(screen.getByTestId("photo-credit-panel")).toBeTruthy();
    await fireEvent(screen.getByTestId("university-content"), "touchStart");
    expect(screen.queryByTestId("photo-credit-panel")).toBeNull();
  });
});
