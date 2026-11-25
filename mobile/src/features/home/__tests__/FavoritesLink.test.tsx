// Ссылка «Избранное» в каталоге университетов (веб UniversitySearch: кнопка с сердцем, `/portal#list`).
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { FAVORITES_ROUTE, FavoritesLink } from "@/features/home/FavoritesLink";
import { UniversitiesScreen } from "@/features/universities/UniversitiesScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { restoreNow, setNow } from "@/test-fixtures/home";
import { fakeTransport } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ all: "1" }),
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn(), replace: jest.fn() },
}));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;

beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear();
  navigate.mockClear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(restoreNow);

describe("«Избранное» из каталога", () => {
  it("ведёт на «Главную», вкладка «Вузы», с меткой, чтобы повторная ссылка срабатывала", async () => {
    expect(FAVORITES_ROUTE).toBe("/home?list=universities");
    const { transport } = fakeTransport({});
    await renderPortal(<FavoritesLink />, testApi(transport));
    const link = screen.getByTestId("catalog-favorites-link");
    expect(link.props).toMatchObject({ accessibilityRole: "link", accessibilityLabel: "Избранное" });
    await fireEvent.press(link);
    expect(navigate).toHaveBeenCalledWith(`/home?list=universities&at=${Date.now()}`);
  });

  it("на кыргызском - слово из общего словаря", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<FavoritesLink />, testApi(transport), "ky");
    expect(screen.getByTestId("catalog-favorites-link").props.accessibilityLabel).toBe("Тандалмалар");
  });

  it("цель нажатия не меньше 44 pt", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<FavoritesLink />, testApi(transport));
    const style = Object.assign({}, ...[screen.getByTestId("catalog-favorites-link").props.style].flat(Infinity).filter(Boolean)) as { minHeight: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("стоит на экране «Университеты» (общий список стран)", async () => {
    const { transport } = fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });
    await renderPortal(<UniversitiesScreen />, testApi(transport));
    expect(await screen.findByTestId("country-MY")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("catalog-favorites-link"));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/home\?list=universities&at=\d+$/));
  });
});
