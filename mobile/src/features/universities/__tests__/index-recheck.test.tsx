// Версия каталога перепроверяется, пока приложение открыто (G46): при возврате в приложение и при возврате на экран каталога,
// не чаще раза в минуту после последней попытки (удачной или нет); запрос идёт с известной версией и при отсутствии перемен ничего
// не тянет. Перепроверка идёт молча: полоса «потянули вниз» горит только у запроса, начатого самим студентом. Возврат сети не
// проверяется: без NetInfo `onlineManager` в React Native событий сети не получает.
import { screen, waitFor, act, render } from "@testing-library/react-native";
import { focusManager } from "@tanstack/react-query";

import { CountryScreen } from "@/features/universities/CountryScreen";
import { INDEX_RECHECK_MS } from "@/features/universities/hooks";
import { RpcError, type RpcTransport } from "@/lib/rpc";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";
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
  const state = { version: "v1", fail: false, forbid: false };
  const t = fakeTransport({
    student_university_index_v1: (args: Record<string, unknown> | undefined) => {
      if (state.fail) return new RpcError("transport");
      if (state.forbid) return failure("42501", 403);
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

/** Транспорт, у которого чтение каталога можно придержать: запрос остаётся «в полёте», и экран это видит. */
function holdable(inner: RpcTransport) {
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let started = 0;
  const transport: RpcTransport = async (name, args, options) => {
    if (name === "student_university_index_v1") started += 1;
    if (name === "student_university_index_v1" && gate) await gate;
    return inner(name, args, options);
  };
  return {
    transport,
    /** Сколько запросов индекса начато (в том числе придержанных). */
    started: () => started,
    hold() {
      gate = new Promise<void>((resolve) => {
        open = () => {
          gate = null;
          resolve();
        };
      });
    },
    release: () => open?.(),
  };
}
/** Дать оповещениям TanStack Query (они идут через `setTimeout`) дойти до экрана: иначе проверка «полосы нет» ничего не проверяет. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
/** Полоса «потянули вниз» экрана: её состояние и обработчик. */
const pull = () => screen.getByTestId("screen-scroll").props.refreshControl.props as { refreshing: boolean; onRefresh: () => void };

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

  it("отказ доступа (42501) при перепроверке: прежний каталог на экране, повтор не чаще раза в минуту после самого отказа", async () => {
    const c = catalogue();
    await renderPortal(<CountryScreen />, testApi(c.transport));
    await screen.findByText("Куала-Лумпур");
    c.state.forbid = true;
    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    expect(await screen.findByTestId("catalog-stale")).toBeTruthy();
    expect(c.reads()).toHaveLength(2);
    // последняя удачная загрузка давно устарела, но попытка была только что: возвраты её не повторяют
    await resume();
    await returnToScreen();
    offset = INDEX_RECHECK_MS + 5_000 + (INDEX_RECHECK_MS - 5_000);
    await resume();
    await returnToScreen();
    expect(c.reads()).toHaveLength(2);
    offset = 2 * INDEX_RECHECK_MS + 10_000;
    await resume();
    await waitFor(() => expect(c.reads()).toHaveLength(3));
  });

  it("сбой первой загрузки без копии: возвраты и новый экран каталога не повторяют запрос чаще раза в минуту, потом повторяют", async () => {
    const c = catalogue();
    c.state.fail = true;
    const client = testClient();
    const api = testApi(c.transport);
    const shell = () => (
      <PortalShell api={api} client={client}>
        <CountryScreen />
      </PortalShell>
    );
    const first = await render(shell());
    expect(await screen.findByTestId("catalog-error")).toBeTruthy();
    expect(c.reads()).toHaveLength(1);
    await resume();
    await returnToScreen();
    offset = INDEX_RECHECK_MS - 5_000;
    await resume();
    await returnToScreen();
    await first.unmount();
    // новый экран каталога (тот же кэш, например переход на город): запрос не повторяется, студент видит прежний сбой с «Повторить»
    await render(shell());
    expect(await screen.findByTestId("catalog-error")).toBeTruthy();
    expect(c.reads()).toHaveLength(1);
    // прошла минута после попытки, сеть вернулась: следующий возврат повторяет, и каталог на экране
    c.state.fail = false;
    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    expect(await screen.findByText("Куала-Лумпур")).toBeTruthy();
    expect(c.reads()).toHaveLength(2);
  });

  it("автоматическая перепроверка идёт молча: полоса «потянули вниз» горит только у запроса, начатого самим студентом", async () => {
    const c = catalogue();
    const held = holdable(c.transport);
    const { client } = await renderPortal(<CountryScreen />, testApi(held.transport));
    const fetching = () => client.getQueryState(["portal", "user-test", "university-index"])?.fetchStatus === "fetching";
    await screen.findByText("Куала-Лумпур");
    expect(pull().refreshing).toBe(false);

    held.hold();
    offset = INDEX_RECHECK_MS + 5_000;
    await resume();
    await waitFor(() => expect(held.started()).toBe(2));
    await settle();
    expect(fetching()).toBe(true);
    expect(pull().refreshing).toBe(false); // запрос в полёте, полосы нет
    await act(async () => held.release());
    expect(pull().refreshing).toBe(false);

    held.hold();
    offset = 2 * INDEX_RECHECK_MS + 10_000;
    await returnToScreen();
    await waitFor(() => expect(held.started()).toBe(3));
    await settle();
    expect(fetching()).toBe(true);
    expect(pull().refreshing).toBe(false); // возврат на экран - то же
    await act(async () => held.release());

    held.hold();
    await act(async () => {
      pull().onRefresh();
    });
    await waitFor(() => expect(held.started()).toBe(4));
    expect(pull().refreshing).toBe(true); // потянули вниз: полоса горит, пока идёт запрос
    await act(async () => held.release());
    await waitFor(() => expect(pull().refreshing).toBe(false));
  });
});
