// Версия каталога перепроверяется, пока приложение открыто (G46): при возврате в приложение, при возврате на экран каталога и
// при появлении сети, не чаще раза в минуту; запрос идёт с известной версией и при отсутствии перемен ничего не тянет.
import { screen, waitFor, act } from "@testing-library/react-native";
import { focusManager } from "@tanstack/react-query";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { INDEX_RECHECK_MS } from "@/features/universities/hooks";
import { RpcError } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

const mockParams: { current: Record<string, string> } = { current: { code: "my" } };
const mockFocusCallbacks = new Set<() => void | (() => void)>();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
// Экран в стеке: «возврат на экран» тест играет сам, вызывая запомненные обработчики фокуса.
jest.mock("@/lib/focus", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual("react");
    React.useEffect(() => {
      mockFocusCallbacks.add(callback);
      const dispose = callback();
      return () => {
        mockFocusCallbacks.delete(callback);
        if (typeof dispose === "function") dispose();
      };
    }, [callback]);
  },
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

const realNow = Date.now.bind(Date);
let offset = 0;
beforeEach(() => {
  offset = 0;
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Сервер каталога: версия меняется между вызовами; с известной версией отвечает «не изменился», иначе целиком. */
function catalogue() {
  const state = { version: "v1", fail: false };
  const t = fakeTransport({
    student_university_index_v1: (args: Record<string, unknown> | undefined) => {
      if (state.fail) return new RpcError("transport");
      if (args?.p_known_version === state.version) return { notModified: true, version: state.version };
      const body = indexBody(state.version);
      if (state.version === "v2") body.cities[0]!.name.ru = "Куала-Лумпур (обновлено)";
      return body;
    },
    student_university_favorites_v1: [],
  });
  const reads = () => t.calls.filter((call) => call.name === "student_university_index_v1");
  return { ...t, state, reads };
}

/** Приложение ушло в фон и вернулось: то же, что делает `AppState` кабинета через `focusManager`. */
async function resume() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}
async function returnToScreen() {
  await act(async () => {
    for (const callback of [...mockFocusCallbacks]) callback();
  });
}

describe("перепроверка версии каталога", () => {
  it("первое открытие - один запрос: возврат на экран при монтировании второго не добавляет", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    expect(await screen.findByTestId("city-kuala-lumpur")).toBeTruthy();
    expect(c.reads()).toHaveLength(1);
    expect(c.reads()[0]!.args).toEqual({ p_known_version: null });
  });

  it("в течение минуты возврат в приложение и на экран ничего не просит; позже - просит с известной версией, «не изменился» ничего не меняет", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    await screen.findByTestId("city-kuala-lumpur");
    await resume();
    await returnToScreen();
    offset = INDEX_RECHECK_MS - 5_000;
    await resume();
    await returnToScreen();
    expect(c.reads()).toHaveLength(1);

    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    await waitFor(() => expect(c.reads()).toHaveLength(2));
    expect(c.reads()[1]!.args).toEqual({ p_known_version: "v1" });
    expect(screen.getByText("Куала-Лумпур")).toBeTruthy();
    expect(screen.queryByTestId("catalog-stale")).toBeNull();
  });

  it("версия на сервере изменилась: новые данные приходят без перезапуска и без «потянуть вниз»", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    await screen.findByText("Куала-Лумпур");
    c.state.version = "v2";
    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    expect(await screen.findByText("Куала-Лумпур (обновлено)")).toBeTruthy();
    expect(c.reads()[c.reads().length - 1]!.args).toEqual({ p_known_version: "v1" });
  });

  it("возврат на экран каталога (экран остался в стеке) тоже перепроверяет, но не поверх идущего запроса", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    await screen.findByText("Куала-Лумпур");
    c.state.version = "v2";
    offset = INDEX_RECHECK_MS + 5_000;
    await returnToScreen();
    await returnToScreen(); // второй возврат, пока первый запрос идёт: ещё одного запроса нет
    expect(await screen.findByText("Куала-Лумпур (обновлено)")).toBeTruthy();
    expect(c.reads()).toHaveLength(2);
  });

  it("сети нет при перепроверке: прежний каталог остаётся, под ним строка «Показан сохранённый каталог»", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    await screen.findByText("Куала-Лумпур");
    c.state.fail = true;
    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    expect(await screen.findByTestId("catalog-stale")).toBeTruthy();
    expect(screen.getByText("Куала-Лумпур")).toBeTruthy();
    // сеть вернулась: следующая проверка убирает строку
    c.state.fail = false;
    offset = 2 * INDEX_RECHECK_MS + 10_000;
    await resume();
    await waitFor(() => expect(screen.queryByTestId("catalog-stale")).toBeNull());
  });
});
