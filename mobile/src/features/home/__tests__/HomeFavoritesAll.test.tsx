// «Всё избранное» на «Главной» (веб FavoritesSection и FavoritesView, `/portal?all=1#list`): ссылка, пока в избранном что-то
// есть, полный список карточек каталога без потолка в 120, «Больше нет в каталоге: N», флажки «Сравнивать» и таблица сравнения.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { HomeScreen } from "@/features/home/HomeScreen";
import type { RpcTransport } from "@/lib/rpc";
import { byIds, favorites, homeHandlers, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, universityRow, uuidN } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn(), push: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;
const push = router.push as jest.Mock;
const params = useLocalSearchParams as jest.Mock;

function handlers(count: number, extra: Record<string, unknown> = {}) {
  return homeHandlers("MY", { student_university_favorites_v1: favorites(count), student_hidden_university_favorites_v1: { hiddenCount: 0 }, ...extra });
}

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] | null };
const styleOf = (node: Json) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
/** Все узлы поддерева, сверху вниз. */
const nodesOf = (node: Json | string): Json[] => (typeof node === "string" ? [] : [node, ...(node.children ?? []).flatMap(nodesOf)]);
/** Цепочка узлов от `node` до первого узла с этим testID (включительно); `null` - в поддереве такого нет. */
function chainTo(node: Json | string, testID: string): Json[] | null {
  if (typeof node === "string") return null;
  if (node.props.testID === testID) return [node];
  for (const child of node.children ?? []) {
    const rest = chainTo(child, testID);
    if (rest !== null) return [node, ...rest];
  }
  return null;
}
const tree = (): Json => ([] as Json[]).concat(screen.toJSON() as never)[0];

const byIdsCalls = (calls: { name: string; args?: Record<string, unknown> }[]) => calls.filter((call) => call.name === "student_university_catalog_by_ids_v1").map((call) => (call.args?.p_institution_ids as string[]).length);

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear();
  await AsyncStorage.clear();
  navigate.mockClear();
  push.mockClear();
  params.mockReturnValue({});
  setNow("2026-09-08T05:00:00Z");
});
afterEach(restoreNow);

async function openAll(count = 2, extra: Record<string, unknown> = {}) {
  const view = fakeTransport(handlers(count, extra));
  await renderPortal(<HomeScreen />, testApi(view.transport));
  await fireEvent.press(await screen.findByTestId("favorites-all"));
  await screen.findByTestId("favorites-all-view");
  return view;
}

describe("«Всё избранное»: ссылка и полный список", () => {
  it.each([1, 2, 4])("ссылка есть, пока в избранном что-то есть, даже при %s вузах (веб: `total > 0`)", async (count) => {
    const { transport } = fakeTransport(handlers(count));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("favorites-all")).toHaveTextContent("Всё избранное");
  });

  it("избранного нет - ни ссылки, ни полного списка: пустое состояние с кнопкой каталога", async () => {
    const { transport } = fakeTransport(handlers(0));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Пока ничего не сохранено")).toBeTruthy();
    expect(screen.queryByTestId("favorites-all")).toBeNull();
  });

  it("ссылка открывает полный список: «Сохранено: N» и карточка каждого вуза; ленты и ссылки больше нет", async () => {
    await openAll(2);
    expect(screen.getByTestId("favorites-saved")).toHaveTextContent("Сохранено: 2");
    expect(screen.getByTestId(`tile-${uuidN(1)}`)).toBeTruthy();
    expect(screen.getByTestId(`tile-${uuidN(2)}`)).toBeTruthy();
    expect(screen.queryByTestId("home-favorites")).toBeNull();
    expect(screen.queryByTestId("favorites-all")).toBeNull();
    // карточка каталога: место, уровень и ближайший срок словами, как на вебе
    const tile = screen.getByTestId(`tile-${uuidN(1)}`);
    expect(within(tile).getByText("Куала-Лумпур · Малайзия")).toBeTruthy();
    expect(within(tile).getByText(/Бакалавриат$/)).toBeTruthy();
    expect(within(tile).getByText(/подача до 1 мая 2027 г\.$/)).toBeTruthy();
    await fireEvent.press(tile);
    expect(push).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
  });

  it("больше тридцати вузов: «Главная» читает четыре карточки, полный список - все кусками по 30", async () => {
    const { calls } = await openAll(65);
    await waitFor(() => expect(screen.getByTestId("favorites-saved")).toHaveTextContent("Сохранено: 65"));
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(65);
    expect(byIdsCalls(calls)).toEqual([4, 30, 30, 5]);
  });

  it("потолка в 120 вузов нет: 125 избранных показываются все (прежнее чтение обрезало список)", async () => {
    const { calls } = await openAll(125);
    await waitFor(() => expect(screen.getByTestId("favorites-saved")).toHaveTextContent("Сохранено: 125"), { timeout: 10000 });
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(125);
    expect(byIdsCalls(calls)).toEqual([4, 30, 30, 30, 30, 5]);
  });

  it("до открытия «Главная» читает только свои четыре карточки", async () => {
    const { transport, calls } = fakeTransport(handlers(35));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("favorites-all");
    expect(byIdsCalls(calls)).toEqual([4]);
    expect(calls.map((call) => call.name)).not.toContain("student_hidden_university_favorites_v1");
  });
});

describe("запись избранного на карточке каталога (#1558): флажок, сердечко и «©»", () => {
  const withPhoto = (args?: Record<string, unknown>) => ({
    items: ((args?.p_institution_ids as string[]) ?? []).map((id) => {
      const n = Number(id.slice(-12));
      const row = universityRow(n);
      return n === 1 ? { ...row, content: { ...row.content, photoKey: "sunway" } } : row;
    }),
    nextOffset: null,
  });

  it("флажок «Сравнивать» стоит над карточкой, в потоке; сердечко и «©» лежат на фото карточки в разных углах и не пересекаются", async () => {
    await openAll(2, { student_university_catalog_by_ids_v1: withPhoto });
    const id = uuidN(1);
    const heartId = "heart-Университет 1";
    const entry = nodesOf(tree()).find((node) => node.props.testID === `favorite-entry-${id}`);
    expect(entry).toBeDefined();
    const [pick, card] = entry!.children as Json[];
    // строка флажка и карточка - соседи записи: флажок не лежит на фото и ничего не закрывает
    expect(chainTo(pick, `compare-pick-${id}`)).not.toBeNull();
    expect(styleOf(pick).position).toBeUndefined();
    for (const testID of [`tile-${id}`, heartId, `credit-${id}`]) {
      expect(chainTo(pick, testID)).toBeNull(); // ни карточки, ни сердечка, ни «©» в строке флажка
      expect(chainTo(card, testID)).not.toBeNull(); // они все - в карточке
    }
    // сердечко (над фото сверху справа) и «©» (над фото снизу справа) считаем по настоящим стилям карточки каталога
    const heart = chainTo(card, heartId)!;
    const credit = chainTo(card, `credit-${id}`)!;
    const absolute = (chain: Json[]) => chain.map(styleOf).filter((style) => style.position === "absolute");
    // слой над фото растянут на всю ширину (`left` и `right`), у угла прижат один край (`right`) и верх или низ
    const layer = absolute(heart).find((style) => typeof style.height === "number" && style.left !== undefined);
    const heartCorner = absolute(heart).filter((style) => style.top !== undefined && style.right !== undefined && style.left === undefined).at(-1);
    const creditCorner = absolute(credit).filter((style) => style.bottom !== undefined && style.right !== undefined && style.left === undefined).at(-1);
    expect(layer).toBeDefined();
    expect(heartCorner).toBeDefined();
    expect(creditCorner).toBeDefined();
    const target = (chain: Json[]) => styleOf(chain.at(-1)!).height as number; // цель нажатия кнопки
    const heartBottom = (heartCorner!.top as number) + target(heart);
    const creditTop = (layer!.height as number) - (creditCorner!.bottom as number) - target(credit);
    expect(target(heart)).toBeGreaterThanOrEqual(44);
    expect(target(credit)).toBeGreaterThanOrEqual(44);
    expect(heartBottom).toBeLessThanOrEqual(creditTop); // сердечко кончается выше, чем начинается «©»
    expect(creditTop + target(credit)).toBeLessThanOrEqual(layer!.height as number); // и обе кнопки целиком на фото
  });

  it("вуз без фото: сердечко на месте, «©» нет; флажок над карточкой, как у вуза с фото", async () => {
    await openAll(2, { student_university_catalog_by_ids_v1: withPhoto });
    const second = within(screen.getByTestId(`favorite-entry-${uuidN(2)}`));
    expect(second.getByTestId("heart-Университет 2")).toBeTruthy();
    expect(second.queryByTestId(`credit-${uuidN(2)}`)).toBeNull();
    expect(second.getByTestId(`compare-pick-${uuidN(2)}`)).toBeTruthy();
  });

  it("нажатия не мешают друг другу: сердечко не открывает вуз и не ставит флажок, флажок не снимает сердечко, карточка открывает вуз", async () => {
    let saved = favorites(2);
    const { calls } = await openAll(2, {
      student_university_favorites_v1: () => saved,
      set_university_favorite_v1: (args?: Record<string, unknown>) => {
        saved = saved.filter((entry) => entry.institutionId !== args?.p_institution_id);
        return { institutionId: args?.p_institution_id, favored: false, favoritesCount: saved.length };
      },
    });
    const entry = within(screen.getByTestId(`favorite-entry-${uuidN(1)}`));
    await fireEvent.press(entry.getByTestId(`compare-pick-${uuidN(1)}`));
    expect(screen.getByTestId(`compare-pick-${uuidN(1)}`).props.accessibilityState).toMatchObject({ checked: true });
    expect(calls.map((call) => call.name)).not.toContain("set_university_favorite_v1"); // флажок сердечко не трогает
    expect(push).not.toHaveBeenCalled();
    await fireEvent.press(entry.getByRole("button", { name: /Убрать из избранного/ }));
    await waitFor(() => expect(screen.queryByTestId(`favorite-entry-${uuidN(1)}`)).toBeNull());
    expect(push).not.toHaveBeenCalled(); // сердечко не открывает вуз
    await fireEvent.press(screen.getByTestId(`tile-${uuidN(2)}`));
    expect(push).toHaveBeenCalledWith(`/universities/${uuidN(2)}`); // а карточка открывает
  });
});

describe("полный список: пробелы, найденные ревью", () => {
  /** «Потянуть вниз» на «Главной»: перечитывает открытые чтения (так приходит «избранное изменилось в другом месте»). */
  const pullToRefresh = () =>
    act(async () => {
      screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
  const unfavor = (saved: { institutionId: string }[]) => (args?: Record<string, unknown>) => {
    const next = saved.filter((entry) => entry.institutionId !== args?.p_institution_id);
    saved.splice(0, saved.length, ...next);
    return { institutionId: args?.p_institution_id, favored: false, favoritesCount: saved.length };
  };

  it("избранное опустело, потом снова появилось: открывается лента, а не прежний полный список", async () => {
    const saved = favorites(1);
    await openAll(1, { student_university_favorites_v1: () => saved, set_university_favorite_v1: unfavor(saved) });
    await fireEvent.press(within(screen.getByTestId(`favorite-entry-${uuidN(1)}`)).getByRole("button", { name: /Убрать из избранного/ }));
    expect(await screen.findByText("Пока ничего не сохранено")).toBeTruthy();
    // вуз добавлен в каталоге: «потянуть вниз» перечитывает избранное
    saved.push(...favorites(2));
    await pullToRefresh();
    expect(await screen.findByTestId("home-favorites")).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    expect(screen.getByTestId("favorites-all")).toBeTruthy(); // ссылка «Всё избранное» вернулась, список открывает только она
  });

  it("вуз убран из избранного и добавлен снова: прежняя отметка «Сравнивать» не возвращается, остальные остаются", async () => {
    const saved = favorites(3);
    await openAll(3, { student_university_favorites_v1: () => saved, set_university_favorite_v1: unfavor(saved) });
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(2)}`));
    expect(await screen.findByTestId("compare-table")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId(`favorite-entry-${uuidN(2)}`)).getByRole("button", { name: /Убрать из избранного/ }));
    await waitFor(() => expect(screen.queryByTestId(`favorite-entry-${uuidN(2)}`)).toBeNull());
    expect(screen.getByTestId("compare-hint")).toBeTruthy(); // остался один выбранный вуз
    saved.splice(0, saved.length, ...favorites(3)); // тот же вуз снова в избранном
    await pullToRefresh();
    const back = await screen.findByTestId(`favorite-entry-${uuidN(2)}`);
    expect(within(back).getByTestId(`compare-pick-${uuidN(2)}`).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryByTestId("compare-table")).toBeNull();
    expect(screen.getByTestId(`compare-pick-${uuidN(1)}`).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("«Больше нет в каталоге» не всплывает после списка: список ждёт и это число, обе части приходят вместе", async () => {
    let release = () => {};
    let hiddenAsked = false;
    let byIdsDone = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = fakeTransport(handlers(2, { student_hidden_university_favorites_v1: { hiddenCount: 3 } }));
    const gated: RpcTransport = async (name, args, options) => {
      if (name === "student_hidden_university_favorites_v1") {
        hiddenAsked = true;
        await gate;
      }
      const result = await view.transport(name, args, options);
      if (name === "student_university_catalog_by_ids_v1") byIdsDone += 1;
      return result;
    };
    await renderPortal(<HomeScreen />, testApi(gated));
    await fireEvent.press(await screen.findByTestId("favorites-all"));
    // список карточек прочитан, а число «вне каталога» ещё нет: на экране заглушка, карточек нет
    await waitFor(() => expect(hiddenAsked).toBe(true));
    // карточки полного списка прочитаны (вторая выборка по id закончилась: первую делает лента «Главной»)
    await waitFor(() => expect(byIdsDone).toBeGreaterThanOrEqual(2));
    // результат чтения доходит до экрана очередью уведомлений React Query, а она идёт таймером: двигаем часы, а не ждём
    for (let turn = 0; turn < 5; turn += 1) await act(async () => jest.advanceTimersByTime(100));
    expect(screen.getByTestId("favorites-all-loading")).toBeTruthy();
    expect(screen.queryByTestId(`tile-${uuidN(1)}`)).toBeNull();
    expect(screen.queryByTestId("favorites-hidden")).toBeNull();
    await act(async () => release());
    expect(await screen.findByTestId("favorites-hidden")).toHaveTextContent("Больше нет в каталоге: 3");
    expect(screen.getByTestId(`tile-${uuidN(1)}`)).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-loading")).toBeNull();
  });

  it("число «вне каталога» не прочиталось: список всё равно появляется, без строки", async () => {
    await openAll(2, { student_hidden_university_favorites_v1: failure(null, 503) });
    expect(await screen.findByTestId(`tile-${uuidN(1)}`)).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-loading")).toBeNull();
    expect(screen.queryByTestId("favorites-hidden")).toBeNull();
  });
});

describe("«Больше нет в каталоге: N»", () => {
  it("число вузов вне списка стран над списком; ноль - строки нет", async () => {
    await openAll(2, { student_hidden_university_favorites_v1: { hiddenCount: 3 } });
    expect(await screen.findByTestId("favorites-hidden")).toHaveTextContent("Больше нет в каталоге: 3");
  });

  it("ноль и сбой этого чтения строку не рисуют и список не прячут (веб: `.catch(() => 0)`)", async () => {
    await openAll(2, { student_hidden_university_favorites_v1: { hiddenCount: 0 } });
    expect(screen.queryByTestId("favorites-hidden")).toBeNull();
  });

  it("сбой чтения числа: список на месте", async () => {
    const { calls } = await openAll(2, { student_hidden_university_favorites_v1: failure(null, 503) });
    await waitFor(() => expect(calls.map((call) => call.name)).toContain("student_hidden_university_favorites_v1"));
    expect(screen.queryByTestId("favorites-hidden")).toBeNull();
    expect(screen.getByTestId(`tile-${uuidN(1)}`)).toBeTruthy();
  });

  it("чужая форма числа - тоже без строки", async () => {
    const { calls } = await openAll(2, { student_hidden_university_favorites_v1: { hiddenCount: -1 } });
    await waitFor(() => expect(calls.map((call) => call.name)).toContain("student_hidden_university_favorites_v1"));
    expect(screen.queryByTestId("favorites-hidden")).toBeNull();
  });
});

describe("сравнение", () => {
  const ordinal = (n: number) => `Университет ${n}`;

  it("раздел «Сравнение» с подсказкой, пока отмечено меньше двух", async () => {
    await openAll(3);
    expect(screen.getByText("Сравнение")).toBeTruthy();
    expect(screen.getByTestId("compare-hint")).toHaveTextContent("Отметьте минимум два университета, чтобы сравнить их.");
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    expect(screen.getByTestId("compare-hint")).toBeTruthy();
    expect(screen.queryByTestId("compare-table")).toBeNull();
  });

  it("флажок «Сравнивать: <вуз>» - флажок для читалки с состоянием", async () => {
    await openAll(2);
    const pick = screen.getByTestId(`compare-pick-${uuidN(1)}`);
    expect(pick.props).toMatchObject({ accessibilityRole: "checkbox", accessibilityLabel: `Сравнивать: ${ordinal(1)}`, accessibilityState: { checked: false } });
    await fireEvent.press(pick);
    expect(screen.getByTestId(`compare-pick-${uuidN(1)}`).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("два вуза - таблица: заголовки вузов, строки свойств, значения; снять отметку - снова подсказка", async () => {
    await openAll(3);
    // нажатия не по порядку: колонки идут в порядке избранного
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(3)}`));
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    const table = await screen.findByTestId("compare-table");
    expect(screen.queryByTestId("compare-hint")).toBeNull();
    const heads = within(table).getAllByTestId(/^compare-head-/, { includeHiddenElements: true });
    expect(heads.map((head) => head.props.testID)).toEqual([`compare-head-${uuidN(1)}`, `compare-head-${uuidN(3)}`]);
    expect(within(table).getByText("Свойство", { includeHiddenElements: true })).toBeTruthy();
    for (const label of ["Страна и город", "Уровни", "Программы", "Ближайший набор"]) expect(within(table).getByText(label, { includeHiddenElements: true })).toBeTruthy();
    const country = within(screen.getByTestId(`compare-cell-country-${uuidN(1)}`)).getByText("Малайзия · Куала-Лумпур");
    expect(country).toBeTruthy();
    expect(within(screen.getByTestId(`compare-cell-programs-${uuidN(3)}`)).getByText("Информатика — Бакалавриат")).toBeTruthy();
    expect(within(screen.getByTestId(`compare-cell-intake-${uuidN(3)}`)).getByText("подача до 1 мая 2027 г.")).toBeTruthy();
    // для читалки ячейка называет вуз, свойство и значение
    expect(screen.getByTestId(`compare-cell-levels-${uuidN(1)}`).props.accessibilityLabel).toBe(`${ordinal(1)}. Уровни: Бакалавриат`);
    // таблица шире экрана прокручивается вбок
    expect(screen.getByTestId("compare-scroll").props.horizontal).toBe(true);
    // третий вуз добавляет колонку, снятые отметки возвращают подсказку
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(2)}`));
    expect(within(screen.getByTestId("compare-table")).getAllByTestId(/^compare-head-/, { includeHiddenElements: true })).toHaveLength(3);
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(2)}`));
    expect(screen.getByTestId("compare-hint")).toBeTruthy();
    expect(screen.queryByTestId("compare-table")).toBeNull();
  });

  it("вуз без города: «Малайзия · Город не указан»", async () => {
    const noCity = (args?: Record<string, unknown>) => ({
      items: ((args?.p_institution_ids as string[]) ?? []).map((id) => universityRow(Number(id.slice(-12)), undefined, Number(id.slice(-12)) === 2 ? { city: null } : {})),
      nextOffset: null,
    });
    await openAll(2, { student_university_catalog_by_ids_v1: noCity });
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(2)}`));
    expect(within(await screen.findByTestId(`compare-cell-country-${uuidN(2)}`)).getByText("Малайзия · Город не указан")).toBeTruthy();
  });
});

describe("возврат и состояния списка", () => {
  it("вкладка «Вузы» возвращает ленту, вкладка «Мои программы» уводит с полного списка", async () => {
    await openAll(2);
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    await fireEvent.press(screen.getByTestId("tab-universities"));
    expect(await screen.findByTestId("home-favorites")).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    expect(screen.getByTestId("favorites-all")).toBeTruthy();
  });

  it("повторное нажатие на «Вузы» в полном списке тоже возвращает ленту (веб: ссылка на `/portal#list`)", async () => {
    await openAll(2);
    await fireEvent.press(screen.getByTestId("tab-universities"));
    expect(await screen.findByTestId("home-favorites")).toBeTruthy();
  });

  it("сбой чтения полного списка: плашка с повтором на языке приложения, а не «обновите страницу»", async () => {
    let attempt = 0;
    const { calls } = await (async () => {
      const view = fakeTransport(
        handlers(6, {
          student_university_catalog_by_ids_v1: (args?: Record<string, unknown>) => {
            const ids = (args?.p_institution_ids as string[]) ?? [];
            // первая «Главная» читает четыре карточки; чтение полного списка (6) падает один раз
            return ids.length === 6 && ++attempt === 1 ? failure("XX000", 500) : byIds(args);
          },
        }),
      );
      await renderPortal(<HomeScreen />, testApi(view.transport));
      await fireEvent.press(await screen.findByTestId("favorites-all"));
      return view;
    })();
    const alert = await screen.findByTestId("favorites-all-error");
    expect(within(alert).getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    expect(screen.queryByText(/страниц/)).toBeNull();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByTestId("favorites-all-view")).toBeTruthy();
    expect(await screen.findByTestId(`tile-${uuidN(6)}`)).toBeTruthy();
    expect(byIdsCalls(calls).filter((size) => size === 6)).toHaveLength(2);
  });

  it("сердечко в полном списке снимает вуз из избранного, и список обновляется (веб: серверное обновление)", async () => {
    let saved = favorites(3);
    const { calls } = await openAll(3, {
      student_university_favorites_v1: () => saved,
      set_university_favorite_v1: (args?: Record<string, unknown>) => {
        saved = saved.filter((entry) => entry.institutionId !== args?.p_institution_id);
        return { institutionId: args?.p_institution_id, favored: false, favoritesCount: saved.length };
      },
    });
    // Сердечко лежит над карточкой отдельным элементом (каталог #1558, G44), а не внутри её кнопки: ищем его в записи избранного.
    const heart = within(screen.getByTestId(`favorite-entry-${uuidN(2)}`)).getByRole("button", { name: /Убрать из избранного/ });
    await fireEvent.press(heart);
    await waitFor(() => expect(screen.queryByTestId(`tile-${uuidN(2)}`)).toBeNull());
    expect(calls.find((call) => call.name === "set_university_favorite_v1")?.args).toEqual({ p_institution_id: uuidN(2), p_favored: false });
    expect(screen.getByTestId("favorites-saved")).toHaveTextContent("Сохранено: 2");
  });

  it("последний вуз убран: пустое состояние, ссылки на полный список нет", async () => {
    let saved = favorites(1);
    await openAll(1, {
      student_university_favorites_v1: () => saved,
      set_university_favorite_v1: (args?: Record<string, unknown>) => {
        saved = [];
        return { institutionId: args?.p_institution_id, favored: false, favoritesCount: 0 };
      },
    });
    await fireEvent.press(within(screen.getByTestId(`favorite-entry-${uuidN(1)}`)).getByRole("button", { name: /Убрать из избранного/ }));
    expect(await screen.findByText("Пока ничего не сохранено")).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
    expect(screen.queryByTestId("favorites-all")).toBeNull();
  });

  it("ссылка на список («Избранное» из каталога, `/home?list=universities`) закрывает полный список и возвращает ленту", async () => {
    await openAll(2);
    params.mockReturnValue({ list: "universities", at: "1" });
    // новая ссылка приходит на уже открытую «Главную»: любое обновление экрана перерисовывает его с новыми параметрами
    await act(async () => {
      screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByTestId("home-favorites")).toBeTruthy();
    expect(screen.queryByTestId("favorites-all-view")).toBeNull();
  });
});

describe("кыргызский", () => {
  it("подписи полного списка и таблицы из общего словаря", async () => {
    const ky = getPortalStrings("favorites", "ky");
    const { transport } = fakeTransport(handlers(2));
    await renderPortal(<HomeScreen />, testApi(transport), "ky");
    await fireEvent.press(await screen.findByTestId("favorites-all"));
    expect(await screen.findByTestId("favorites-saved")).toHaveTextContent(ky.savedCount.replace("{count}", "2"));
    expect(screen.getByTestId("compare-hint")).toHaveTextContent(ky.compareHint);
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(1)}`));
    expect(screen.getByTestId(`compare-pick-${uuidN(1)}`).props.accessibilityLabel).toBe(ky.compareSelect.replace("{name}", "Университет 1"));
    await fireEvent.press(screen.getByTestId(`compare-pick-${uuidN(2)}`));
    expect(within(await screen.findByTestId("compare-table")).getByText(ky.compareCountry, { includeHiddenElements: true })).toBeTruthy();
  });
});
