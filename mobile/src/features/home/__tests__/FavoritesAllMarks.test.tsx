// «Всё избранное»: сердечко записи закрашено, пока состояние избранного не прочитано (запись из избранного по определению
// избранная). Состояние живёт в контексте каталога; здесь оно подставлено «неизвестным» (`null`), как при сбое чтения.
import { screen } from "@testing-library/react-native";

import { FavoritesAll } from "@/features/home/FavoritesAll";
import { favorites, homeHandlers, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, uuidN } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn(), push: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const mockMarks = jest.fn();
jest.mock("@/features/universities/FavoritesContext", () => ({ useFavoriteState: () => mockMarks() }));

beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(restoreNow);

const open = async () => {
  const { transport } = fakeTransport(homeHandlers("MY", { student_university_favorites_v1: favorites(2), student_hidden_university_favorites_v1: { hiddenCount: 0 } }));
  await renderPortal(<FavoritesAll now={new Date("2026-09-08T05:00:00Z")} />, testApi(transport));
  await screen.findByTestId(`tile-${uuidN(1)}`);
};

describe("сердечко записи, пока состояние избранного неизвестно", () => {
  it("состояние не прочитано (null): оба сердечка закрашены - «Убрать из избранного»", async () => {
    mockMarks.mockReturnValue({ isFavored: () => null, toggle: jest.fn() });
    await open();
    const hearts = screen.getAllByRole("button", { name: /Убрать из избранного/ });
    expect(hearts).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Добавить в избранное/ })).toBeNull();
    expect(hearts[0].props.accessibilityState).toMatchObject({ selected: true });
  });

  it("состояние известно: вуза нет в наборе - сердечко не закрашено, есть - закрашено", async () => {
    mockMarks.mockReturnValue({ isFavored: (id: string) => id === uuidN(1), toggle: jest.fn() });
    await open();
    expect(screen.getByTestId("heart-Университет 1").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("heart-Университет 2").props.accessibilityState).toMatchObject({ selected: false });
  });
});
