// Каталог как в вебе (аудит паритета 25.11.2026, G41, G42, G44, G47): «©» на каждой поверхности с фото, карточка города с фактом,
// путь ссылками, общая «страница не найдена», поиск, подписи читалки и сердечко, не вложенное в карточку.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";

import { CityScreen } from "@/features/universities/CityScreen";
import { CountryScreen } from "@/features/universities/CountryScreen";
import { UniversitiesScreen } from "@/features/universities/UniversitiesScreen";
import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, universityContent, uuidN } from "@/test-fixtures/universities";
import { cityRow, indexBody, uniRow } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/features/universities/CatalogMap", () => ({
  CatalogMap: ({ pins }: { pins: readonly unknown[] }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text testID="catalog-map">{`pins:${pins.length}`}</Text>;
  },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-file-system", () => {
  const files = new Map<string, string>();
  class Directory {
    exists = true;
    create() {}
    delete() {
      files.clear();
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : "dir")).join("/");
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, "");
    }
    write(text: string) {
      files.set(this.uri, text);
    }
    async text() {
      return files.get(this.uri) ?? "";
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: "cache" }, __files: files };
});

beforeEach(() => {
  mockParams.current = {};
  jest.requireMock("expo-file-system").__files.clear();
  (router.push as jest.Mock).mockClear();
});

const CASE = "33333333-3333-4333-8333-333333333333";
const favId = uuidN(1);

function transport(extra: Record<string, unknown> = {}) {
  return fakeTransport({
    student_university_index_v1: indexBody(),
    student_university_favorites_v1: [],
    set_university_favorite_v1: { institutionId: favId, favored: true, favoritesCount: 1 },
    ...extra,
  });
}

describe("«©» на каждой поверхности с фото (G41)", () => {
  it("карточка страны с фото несёт «©», у страны без фото кнопки нет; панель показывает автора, источник и лицензию со ссылками", async () => {
    mockParams.current = { all: "1" };
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await renderPortal(<UniversitiesScreen />, testApi(transport().transport));
    expect(await screen.findByTestId("country-MY")).toBeTruthy();
    expect(screen.getByTestId("credit-MY").props.accessibilityLabel).toBe("Автор и лицензия фото");
    expect(screen.queryByTestId("credit-CN")).toBeNull();
    await fireEvent.press(screen.getByTestId("credit-MY"));
    expect(screen.getByText("Wikimedia Commons")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("credit-MY-link"));
    expect(open).toHaveBeenCalledWith("https://commons.wikimedia.org/wiki/File:Test.jpg");
    open.mockRestore();
  });

  it("«©» не вложена в нажимаемую карточку: она её соседка, и нажатие по ней не открывает карточку", async () => {
    mockParams.current = { all: "1" };
    await renderPortal(<UniversitiesScreen />, testApi(transport().transport));
    const card = await screen.findByTestId("country-MY");
    expect(within(card).queryByTestId("credit-MY")).toBeNull();
    await fireEvent.press(screen.getByTestId("credit-MY"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("карточка города: «©», полное описание, «Интересный факт»; в подписи читалки то же самое", async () => {
    mockParams.current = { code: "my" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    const card = await screen.findByTestId("city-penang");
    expect(screen.getByTestId("credit-penang")).toBeTruthy();
    expect(within(card).getByText("Город Пенанг")).toBeTruthy();
    expect(within(card).getByText("Интересный факт")).toBeTruthy();
    expect(within(card).getByText("Факт Пенанг")).toBeTruthy();
    expect(within(card).getByText("Город Пенанг").props.numberOfLines).toBeUndefined();
    expect(card.props.accessibilityLabel).toBe("Пенанг. 1 университет. Город Пенанг. Интересный факт: Факт Пенанг");
  });

  it("карточка вуза с фото несёт «©», вуз без фото нет; сердечко и «©» лежат рядом с карточкой, а не внутри неё", async () => {
    mockParams.current = { code: "my", view: "list" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    const tile = await screen.findByTestId(`tile-${uuidN(1)}`); // Университет Зета, фото apu
    expect(screen.getByTestId(`credit-${uuidN(1)}`)).toBeTruthy();
    expect(within(tile).queryByTestId("heart-Университет Зета")).toBeNull();
    expect(within(tile).queryByTestId(`credit-${uuidN(1)}`)).toBeNull();
    expect(screen.getByTestId("heart-Университет Зета").props.accessibilityLabel).toBe("В избранное: Университет Зета");
    expect(screen.queryByTestId(`credit-${uuidN(3)}`)).toBeNull(); // Колледж Пенанг: фото нет
    // нажатие по «©» не открывает карточку
    await fireEvent.press(screen.getByTestId(`credit-${uuidN(1)}`));
    expect(router.push).not.toHaveBeenCalled();
    // нажатие по карточке открывает
    await fireEvent.press(tile);
    expect(router.push).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
  });

  it("подпись карточки вуза читалке: название, место, уровни, ближайший набор; «Программы и сроки» - подсказка", async () => {
    mockParams.current = { code: "my", view: "list" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    const tile = await screen.findByTestId(`tile-${uuidN(1)}`);
    expect(tile.props.accessibilityLabel).toBe("Университет Зета. Уровень: Бакалавриат. Ближайший набор: подача до 1 мая 2099 г.");
    expect(tile.props.accessibilityHint).toBe("Программы и сроки");
    expect(within(tile).getByText("Бакалавриат")).toBeTruthy(); // уровень таблеткой
  });

  it("шапки страны и города несут «©» сверху", async () => {
    mockParams.current = { code: "my", view: "list" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    expect(await screen.findByTestId("photo-credit")).toBeTruthy();
    mockParams.current = { code: "my", city: "penang" };
    await renderPortal(<CityScreen />, testApi(transport().transport));
    await waitFor(() => expect(screen.getAllByTestId("photo-credit").length).toBeGreaterThan(0));
  });
});

describe("страница вуза: шапка и путь", () => {
  const cityWithoutCount = () => {
    const { universityCount, ...rest } = cityRow("kuala-lumpur", "MY", "Куала-Лумпур", "Куала-Лумпур", 2);
    void universityCount;
    return rest;
  };
  const detail = (photoKey: string | null, withCity = true) => ({
    university: { id: uuidN(1), version: 3, publishedAt: "2026-10-01T00:00:00+00:00", content: { ...universityContent("Университет Зета"), photoKey } },
    country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
    city: withCity ? cityWithoutCount() : null,
    favored: false,
    openConsultation: null,
    preparations: { studentCaseId: CASE, items: [] },
    costs: null,
  });

  it("без проверенной копии фото шапки нет вовсе (ни серой плашки, ни «©»)", async () => {
    mockParams.current = { id: uuidN(1) };
    const t = fakeTransport({ student_university_detail_v1: detail(null), student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    expect(await screen.findByText("Университет Зета")).toBeTruthy();
    expect(screen.queryByText("Проверенное фото кампуса пока не добавлено")).toBeNull();
    expect(screen.queryByTestId("photo-credit")).toBeNull();
  });

  it("с фото: шапка, «©» снизу, описание фото вместо названия для читалки", async () => {
    mockParams.current = { id: uuidN(1) };
    const t = fakeTransport({ student_university_detail_v1: detail("sunway"), student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    expect(await screen.findByTestId("photo-credit")).toBeTruthy();
    expect(screen.getByLabelText("Корпус кампуса Sunway University")).toBeTruthy();
  });

  it("путь: «Университеты › Страна › Город» ссылками, названия вуза в пути нет; нажатие ведёт на страницу", async () => {
    mockParams.current = { id: uuidN(1) };
    const t = fakeTransport({ student_university_detail_v1: detail(null), student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    await screen.findByText("Университет Зета");
    const crumbs = screen.getByTestId("path-crumbs");
    expect(within(crumbs).getByText("Университеты")).toBeTruthy();
    expect(within(crumbs).getByText("Малайзия")).toBeTruthy();
    expect(within(crumbs).getByText("Куала-Лумпур")).toBeTruthy();
    expect(within(crumbs).queryByText("Университет Зета")).toBeNull();
    await fireEvent.press(screen.getByTestId("crumb-0"));
    expect(router.push).toHaveBeenLastCalledWith("/universities?all=1");
    await fireEvent.press(screen.getByTestId("crumb-1"));
    expect(router.push).toHaveBeenLastCalledWith("/universities/country/my");
    await fireEvent.press(screen.getByTestId("crumb-2"));
    expect(router.push).toHaveBeenLastCalledWith("/universities/country/my/kuala-lumpur");
    expect(screen.getByTestId("crumb-1").props.accessibilityRole).toBe("link");
  });
});

describe("пути и «не найдено»", () => {
  it("страница страны: текущая страна текстом, «Университеты» ссылкой", async () => {
    mockParams.current = { code: "my" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    await screen.findByTestId("city-penang");
    expect(screen.getByTestId("crumb-current").props.children).toBe("Малайзия");
    await fireEvent.press(screen.getByTestId("crumb-0"));
    expect(router.push).toHaveBeenLastCalledWith("/universities?all=1");
  });

  it("страница города: страна ссылкой на страну", async () => {
    mockParams.current = { code: "my", city: "penang" };
    await renderPortal(<CityScreen />, testApi(transport().transport));
    await screen.findByText("Колледж Пенанг");
    await fireEvent.press(screen.getByTestId("crumb-1"));
    expect(router.push).toHaveBeenLastCalledWith("/universities/country/my");
  });

  it("неизвестный город: общая «Страница не найдена», а не «в этой стране нет университетов»; своей прокрутки блок не заводит", async () => {
    mockParams.current = { code: "my", city: "paris" };
    await renderPortal(<CityScreen />, testApi(transport().transport));
    expect(await screen.findByTestId("catalog-not-found")).toBeTruthy();
    expect(screen.getByText("Страница не найдена")).toBeTruthy();
    expect(screen.queryByText("В этой стране пока нет опубликованных университетов")).toBeNull();
    // один Screen (рамка каталога), а не второй внутри первого (U12 аудита)
    expect(screen.getAllByTestId("screen-scroll")).toHaveLength(1);
  });

  it("неверный адрес до чтения каталога: блок занимает экран сам", async () => {
    mockParams.current = { code: "my", view: "grid" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    expect(screen.getByTestId("catalog-not-found")).toBeTruthy();
    expect(screen.getAllByTestId("screen-scroll")).toHaveLength(1);
    await fireEvent.press(screen.getByText("Все страны"));
    expect(router.push).toHaveBeenLastCalledWith("/universities?all=1");
  });

  it("KY: «Страница не найдена» на кыргызском из своего файла строк", async () => {
    mockParams.current = { code: "my", city: "paris" };
    await renderPortal(<CityScreen />, testApi(transport().transport), "ky");
    expect(await screen.findByText("Барак табылган жок")).toBeTruthy();
  });
});

describe("поиск и списки", () => {
  it("запрос не длиннее 100 знаков, пустой результат с кнопкой «Очистить поиск», число найденных читается", async () => {
    mockParams.current = { all: "1" };
    await renderPortal(<UniversitiesScreen />, testApi(transport().transport));
    const field = await screen.findByTestId("university-search");
    expect(field.props.maxLength).toBe(100);
    await fireEvent.changeText(field, "bogazici");
    expect((await screen.findByTestId("search-status")).props.children).toBe("Найдено: 1");
    expect(screen.getByTestId("search-status").props.accessibilityLiveRegion).toBe("polite");
    await fireEvent.changeText(screen.getByTestId("university-search"), "zzz");
    expect(await screen.findByTestId("search-empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("search-empty-clear"));
    expect(await screen.findByTestId("country-CN")).toBeTruthy();
    expect(screen.queryByTestId("search-empty")).toBeNull();
  });

  it("поиск по стране: тот же запрос не длиннее 100 знаков и та же кнопка очистки", async () => {
    mockParams.current = { code: "my" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    const field = await screen.findByTestId("country-search");
    expect(field.props.maxLength).toBe(100);
    await fireEvent.changeText(field, "zzz");
    await fireEvent.press(await screen.findByTestId("search-empty-clear"));
    expect(await screen.findByTestId("city-penang")).toBeTruthy();
  });

  it("переключатель вида назван («Представление каталога»)", async () => {
    mockParams.current = { code: "my" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    expect((await screen.findByTestId("view-group")).props.accessibilityLabel).toBe("Представление каталога");
  });

  it("«Списком»: заголовок города - кнопка с подсказкой и ведёт на город, заголовок без страницы города - обычный заголовок", async () => {
    mockParams.current = { code: "my", view: "list" };
    await renderPortal(<CountryScreen />, testApi(transport().transport));
    await screen.findByText("Академия Альфа");
    const opens = screen.getAllByTestId("group-open");
    expect(opens.length).toBe(4 - 1); // Субанг-Джая, Куала-Лумпур, Пенанг; «Город не указан» - без страницы
    expect(opens[0].props.accessibilityRole).toBe("header");
    expect(opens[0].props.accessibilityHint).toBe("Открыть страницу города");
    expect(opens[0].props.accessibilityLabel).toBe("Субанг-Джая, 1 университет");
    await fireEvent.press(opens[0]);
    expect(router.push).toHaveBeenLastCalledWith("/universities/country/my/subang-jaya");
  });

  it("длинный список собирается порциями: 60 карточек появляются все, а не одним куском", async () => {
    const universities = Array.from({ length: 60 }, (_, i) => uniRow(100 + i, `Вуз номер ${i + 1}`, "MY", { cityKey: "kuala-lumpur" }));
    const body = indexBody();
    const long = { ...body, universities, countries: body.countries.map((c) => (c.code === "MY" ? { ...c, universityCount: 60 } : c)) };
    mockParams.current = { code: "my", view: "list" };
    await renderPortal(<CountryScreen />, testApi(transport({ student_university_index_v1: long }).transport));
    await screen.findByText("Вуз номер 1");
    expect(screen.getAllByTestId(/^tile-/).length).toBeLessThan(60);
    await waitFor(() => expect(screen.getAllByTestId(/^tile-/)).toHaveLength(60), { timeout: 3000 });
  });
});
