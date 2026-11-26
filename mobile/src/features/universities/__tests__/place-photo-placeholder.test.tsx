// Фото страны и города без файла или с ошибкой загрузки (ревью QA 26.11): заглушка без надписи про «кампус». Такие надписи есть в словаре
// только для фото вузов; у веба фото места (`PlaceImage`) при сбое оставляет тёмную подложку, смысл несёт текст рядом. Экраны на поддельном
// транспорте, картинка «не загрузилась» событием `error`.
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getPortalStrings } from "@web/lib/portal/i18n";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { RemotePhoto } from "@/features/universities/parts";
import { UniversitiesScreen } from "@/features/universities/UniversitiesScreen";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
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

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const ru = getPortalStrings("universities", "ru");
const urls = { sized: "https://x.test/sized.jpg", original: "https://x.test/original.jpg" };

/** Картинка не загрузилась: сначала копия нужной ширины, затем оригинал. */
async function failBoth(testID: string) {
  await fireEvent(await screen.findByTestId(testID, { hidden: true }), "error", { nativeEvent: { error: "load failed" } });
  await fireEvent(screen.getByTestId(testID, { hidden: true }), "error", { nativeEvent: { error: "load failed" } });
}

/** Подложка вместо фото: без слов вовсе (ни «Проверенное фото кампуса…», ни «Не удалось загрузить фото кампуса»). */
const plaque = (testID: string) => screen.getByTestId(`${testID}-placeholder`, { hidden: true });
const textOf = (testID: string) => within(plaque(testID)).queryByText(/./, { includeHiddenElements: true });

async function photo(props: Partial<React.ComponentProps<typeof RemotePhoto>>) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <RemotePhoto urls={null} height={120} label="Подпись" strings={ru} testID="photo" {...props} />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("RemotePhoto: заглушка фото места и фото вуза", () => {
  it("фото места (decorative), адреса нет: тёмная подложка без надписи и значка, читалка её пропускает", async () => {
    await photo({ urls: null, decorative: true });
    expect(textOf("photo")).toBeNull();
    expect(plaque("photo").props.accessibilityElementsHidden).toBe(true);
    expect(plaque("photo").props.accessibilityLabel).toBeUndefined();
  });

  it("фото места (decorative), обе загрузки не удались: то же", async () => {
    await photo({ urls, decorative: true });
    await failBoth("photo");
    expect(textOf("photo")).toBeNull();
    expect(plaque("photo").props.accessibilityLabel).toBeUndefined();
  });

  it("фото вуза (не decorative): надписи про кампус остаются, как у веба", async () => {
    await photo({ urls: null });
    expect(within(plaque("photo")).getByText("Проверенное фото кампуса пока не добавлено")).toBeTruthy();
    expect(plaque("photo").props.accessibilityLabel).toBe("Проверенное фото кампуса пока не добавлено");
  });

  it("фото вуза (не decorative), загрузка не удалась: «Не удалось загрузить фото кампуса»", async () => {
    await photo({ urls });
    await failBoth("photo");
    expect(within(plaque("photo")).getByText("Не удалось загрузить фото кампуса")).toBeTruthy();
  });
});

describe("экраны: фото страны и города", () => {
  it("шапка страны: фото без файла - подложка без «Не удалось загрузить фото кампуса»", async () => {
    mockParams.current = { code: "my" };
    const t = fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });
    await renderPortal(<CountryScreen />, testApi(t.transport));
    await failBoth("country-photo");
    expect(textOf("country-photo")).toBeNull();
    expect(screen.queryByText("Не удалось загрузить фото кампуса")).toBeNull();
  });

  it("карточка страны: то же, и у страны без фото (адреса нет) тоже без слов про кампус", async () => {
    mockParams.current = { all: "1" };
    const t = fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });
    await renderPortal(<UniversitiesScreen />, testApi(t.transport));
    await screen.findByTestId("country-MY");
    await failBoth("photo-MY");
    expect(textOf("photo-MY")).toBeNull();
    // Китай в тестовом каталоге без фото: подложка есть, текста нет
    expect(textOf("photo-CN")).toBeNull();
  });

  it("карточка города на странице страны: то же", async () => {
    mockParams.current = { code: "my" };
    const t = fakeTransport({ student_university_index_v1: indexBody(), student_university_favorites_v1: [] });
    await renderPortal(<CountryScreen />, testApi(t.transport));
    await screen.findByTestId("city-penang");
    await failBoth("photo-penang");
    expect(textOf("photo-penang")).toBeNull();
  });
});
