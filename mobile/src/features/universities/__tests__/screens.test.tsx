// Экраны «Университетов» на поддельном транспорте: страны, поиск, «Списком», карта (нативная
// карта заменена заглушкой: настоящая проверяется на симуляторе), сердечко и его откат.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { UniversitiesScreen } from "@/features/universities/UniversitiesScreen";
import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { RpcError } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, universityContent, uuidN } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn() },
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

beforeEach(async () => {
  mockParams.current = {};
  jest.requireMock("expo-file-system").__files.clear(); // копия каталога с диска не переходит между тестами
});

const favId = uuidN(1);
const CASE = "33333333-3333-4333-8333-333333333333";

function transport(extra: Record<string, unknown> = {}) {
  return fakeTransport({
    student_university_index_v1: indexBody(),
    student_university_favorites_v1: [],
    set_university_favorite_v1: { institutionId: favId, favored: true, favoritesCount: 1 },
    ...extra,
  });
}

describe("Университеты", () => {
  it("шесть стран; поиск по названию показывает вузы и «ничего не нашлось»", async () => {
    const { transport: t } = transport();
    await renderPortal(<UniversitiesScreen />, testApi(t));
    expect(await screen.findByTestId("country-MY")).toBeTruthy();
    expect(screen.getByTestId("country-CN").props.accessibilityLabel).toContain("Китай");
    await fireEvent.changeText(screen.getByTestId("university-search"), "bogazici");
    expect(await screen.findByText("Bogaziçi Test University")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("university-search"), "zzz");
    expect(await screen.findByTestId("search-empty")).toBeTruthy();
  });

  it("KY: заголовки и страны на кыргызском", async () => {
    const { transport: t } = transport();
    await renderPortal(<UniversitiesScreen />, testApi(t), "ky");
    expect(await screen.findByText("Университеттер")).toBeTruthy();
    expect((await screen.findByTestId("country-CN")).props.accessibilityLabel).toContain("Кытай");
  });

  it("каталог не загрузился и копии нет: плашка с повтором, не пустота", async () => {
    const { transport: t } = fakeTransport({ student_university_index_v1: failure("500", 500), student_university_favorites_v1: [] });
    await renderPortal(<UniversitiesScreen />, testApi(t));
    expect(await screen.findByTestId("catalog-error")).toBeTruthy();
  });

  it("страна «Списком»: вузы по городам", async () => {
    mockParams.current = { code: "my", view: "list" };
    const { transport: t } = transport();
    await renderPortal(<CountryScreen />, testApi(t));
    expect(await screen.findByText("Академия Альфа")).toBeTruthy();
  });

  it("страна «Карта»: точки только с координатой и счёт без точки", async () => {
    mockParams.current = { code: "my", view: "map" };
    const { transport: t } = transport();
    await renderPortal(<CountryScreen />, testApi(t));
    expect((await screen.findByTestId("catalog-map")).props.children).toBe("pins:2");
    expect(screen.getByTestId("map-summary").props.children.join("")).toContain("На карте: 2");
    // лицензия карты: подпись видна под картой
    expect(screen.getByTestId("map-attribution").props.children).toBe("© OpenFreeMap · © OpenMapTiles · данные © OpenStreetMap");
  });

  it("неверный ?view= : «не найдено»", async () => {
    mockParams.current = { code: "my", view: "grid" };
    const { transport: t } = transport();
    await renderPortal(<CountryScreen />, testApi(t));
    expect(await screen.findByTestId("catalog-not-found")).toBeTruthy();
  });

  it("сердечко: пишет состояние (id, favored), правда - квитанция", async () => {
    mockParams.current = { code: "my", view: "list" };
    const ok = transport();
    await renderPortal(<CountryScreen />, testApi(ok.transport));
    await fireEvent.press(await screen.findByTestId("heart-Университет Зета"));
    await waitFor(() => expect(ok.calls.some((c) => c.name === "set_university_favorite_v1")).toBe(true));
    expect(ok.calls.find((c) => c.name === "set_university_favorite_v1")?.args).toEqual({ p_institution_id: favId, p_favored: true });
    await waitFor(() => expect(screen.getByTestId("heart-Университет Зета").props.accessibilityState.selected).toBe(true));
  });

  it("сердечко: сбой записи откатывает и предупреждает", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    mockParams.current = { code: "my", view: "list" };
    const bad = transport({ set_university_favorite_v1: new RpcError("server", "500", 500) });
    await renderPortal(<CountryScreen />, testApi(bad.transport));
    await fireEvent.press(await screen.findByTestId("heart-Университет Зета"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(screen.getByTestId("heart-Университет Зета").props.accessibilityState.selected).toBe(false);
    alert.mockRestore();
  });
});

describe("Страница вуза", () => {
  const detail = (extra: Record<string, unknown> = {}) => ({
    university: { id: uuidN(1), version: 3, publishedAt: "2026-10-01T00:00:00+00:00", content: universityContent("Университет Зета") },
    country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
    city: null,
    favored: false,
    openConsultation: null,
    preparations: { studentCaseId: CASE, items: [] },
    costs: {
      rows: [
        { id: uuidN(50), kind: "tuition", period: "year", studyLevel: "bachelor", programId: null, teachingLanguage: "en", currency: "MYR", exponent: 2, amountMinMinor: 3500000, amountMaxMinor: null, usdApproxMin: 7500, usdApproxMax: null, academicYear: "2026/27", note: null, source: { kind: "agency", url: null }, verifiedOn: "2026-10-16" },
      ],
      fxRates: [{ currency: "MYR", unitsPerUsd: 4.67, asOf: "2026-10-16", sourceName: "Central Bank of Malaysia" }],
    },
    ...extra,
  });

  it("стоимость в валюте вуза с ориентиром USD, курс с датой; «Добавить в мои программы» шлёт выбор", async () => {
    mockParams.current = { id: uuidN(1) };
    const receipt = (a: Record<string, unknown> | undefined) => ({
      applicationId: uuidN(9, "bbbbbbbb"), studentCaseId: CASE, institutionId: uuidN(1), programId: "cs", intakeId: "11111111-1111-4111-8111-111111111111",
      publicationId: uuidN(9, "cccccccc"), publicationVersion: 3, catalogLevel: "bachelor", applicationDegree: "bachelor", selectedAt: "2026-11-09T08:00:00+00:00",
      deadlineStateAtSelection: "needs_confirmation", requestId: a?.p_request_id,
    });
    const t = fakeTransport({ student_university_detail_v1: detail(), student_university_favorites_v1: [], student_select_catalog_intake_v1: receipt });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    expect(await screen.findByText("Стоимость")).toBeTruthy();
    expect(screen.getByLabelText(/Бакалавриат, на английском\. 35.000 MYR в год/)).toBeTruthy();
    expect(screen.getByText(/1 USD = 4,67 MYR/)).toBeTruthy();
    expect(screen.getByText("Программы вуза")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(t.calls.some((c) => c.name === "student_select_catalog_intake_v1")).toBe(true));
    const call = t.calls.find((c) => c.name === "student_select_catalog_intake_v1");
    expect(call?.args).toMatchObject({ p_program_id: "cs", p_publication_version: 3 });
    expect(typeof call?.args?.p_request_id).toBe("string");
    expect(await screen.findByTestId("program-open-mine")).toBeTruthy();
  });

  it("без опубликованной стоимости блока нет", async () => {
    mockParams.current = { id: uuidN(1) };
    const t = fakeTransport({ student_university_detail_v1: detail({ costs: null }), student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(t.transport));
    expect(await screen.findByText("Программы вуза")).toBeTruthy();
    expect(screen.queryByText("Стоимость")).toBeNull();
  });

  it("вуз чужой (42501): «не найдено»", async () => {
    mockParams.current = { id: uuidN(1) };
    const denied = fakeTransport({ student_university_detail_v1: failure("42501", 403), student_university_favorites_v1: [] });
    await renderPortal(<UniversityScreen />, testApi(denied.transport));
    expect(await screen.findByTestId("catalog-not-found")).toBeTruthy();
  });
});
