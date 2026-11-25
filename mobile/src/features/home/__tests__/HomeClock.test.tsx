// «Главная» и время: «Сегодня», «Завтра» и «Просрочено» считаются по часам сервера и не застывают, пока приложение лежит в фоне.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, screen, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { HomeScreen } from "@/features/home/HomeScreen";
import { observeServerTime, resetServerClockForTests } from "@/lib/server-clock";
import { homeHandlers, moveNow, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

let handlers: ((state: AppStateStatus) => void)[] = [];
/** Приложение вернулось на передний план: все подписчики на смену состояния получают «active». */
const resume = () => act(async () => handlers.forEach((handler) => handler("active")));

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear();
  await AsyncStorage.clear();
  resetServerClockForTests();
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_event: string, handler: (state: AppStateStatus) => void) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => {
  restoreNow();
  resetServerClockForTests();
  jest.restoreAllMocks();
});

// Срок паспорта фикстуры - 12.09.2026 03:00 UTC (09:00 в Бишкеке), платёж - 01.10.2026.
describe("«Сегодня» не застывает", () => {
  it("после ночи в фоне при возврате в приложение «Завтра» в шапке и в «Ближайших датах» становится «Сегодня»", async () => {
    setNow("2026-09-11T05:00:00Z"); // 11:00 в Бишкеке, срок - завтра
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(within(count).getByText("Завтра", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("date-left-2026-09-12")).toHaveTextContent("завтра");
    moveNow("2026-09-12T02:00:00Z"); // утро следующего дня, срок позже сегодня
    await resume();
    expect(within(screen.getByTestId("hero-countdown")).getByText("Сегодня", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("date-left-2026-09-12")).toHaveTextContent("сегодня");
    expect(screen.getByTestId("case-primary-due")).toHaveTextContent("сегодня");
  });

  it("срок прошёл, пока приложение лежало: после возврата «Просрочено», красная плашка и «просрочено» у дела", async () => {
    setNow("2026-09-12T02:00:00Z");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-countdown");
    expect(screen.getByTestId("case-primary-due")).toHaveTextContent("сегодня");
    moveNow("2026-09-12T06:00:00Z"); // 12:00 в Бишкеке: срок в 09:00 уже прошёл
    await resume();
    expect(within(screen.getByTestId("hero-countdown")).getByText("Просрочено", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("case-primary-due")).toHaveTextContent(/^просрочено$/);
  });

  it("без возврата и без границы суток время не дёргается: прежняя надпись на месте", async () => {
    setNow("2026-09-11T05:00:00Z");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-countdown");
    moveNow("2026-09-12T02:00:00Z");
    // ни возврата, ни обновления данных: экран не знает, что день сменился (его разбудят границы и возврат, а не опрос часов)
    expect(within(screen.getByTestId("hero-countdown")).getByText("Завтра", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("часы сервера важнее часов телефона", () => {
  it("телефон на двое суток впереди, а сервер говорит 8 сентября: экран живёт по серверу", async () => {
    setNow("2026-09-10T05:00:00Z"); // по часам телефона до срока паспорта два дня, по серверу - четыре
    observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.now());
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(within(count).getByText("4", { includeHiddenElements: true })).toBeTruthy(); // до 12 сентября четыре дня
    expect(screen.getByTestId("case-primary-due")).toHaveTextContent("через 4 дня");
  });

  it("первый ответ сервера исправляет уже нарисованный экран", async () => {
    setNow("2026-09-14T05:00:00Z"); // по часам телефона срок паспорта давно прошёл
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(within(await screen.findByTestId("hero-countdown")).getByText("Просрочено", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.now()));
    expect(within(screen.getByTestId("hero-countdown")).getByText("4", { includeHiddenElements: true })).toBeTruthy();
  });
});
