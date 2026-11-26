// Блок пути на «Главной» как часть списка экрана (веб #1489): строка текущего шага закрепляется, карточка складывается из
// блоков, шапка с красными пятнами, прокрутка к текущему шагу, вход блоков по очереди.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, Dimensions, ScrollView } from "react-native";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { PIN_MAX_SHARE, ROW_SLACK, cardEdge, journeyEdges, rowPinned } from "@/features/admission/JourneySection";
import { HomeScreen } from "@/features/home/HomeScreen";
import { lightTokens } from "@/theme/tokens.generated";
import { setReducedMotionForTests } from "@/ui/motion";
import { homeHandlers, moveNow, restoreNow, saved, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
const layout = (height: number, y = 0) => ({ nativeEvent: { layout: { x: 0, y, width: 358, height } } });

/** Блоки списка экрана сверху вниз и индексы закреплённых: то, что ScrollView получает от «Главной». */
function scrollBlocks() {
  const scroll = screen.getByTestId("screen-scroll");
  const content = (scroll.children as { children: { props: { testID?: string } }[] }[])[1];
  return { ids: content.children.map((child) => child.props.testID), sticky: scroll.props.stickyHeaderIndices as number[] };
}

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear();
  await AsyncStorage.clear();
  scrollTo.mockClear();
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(() => {
  restoreNow();
  jest.restoreAllMocks();
  setReducedMotionForTests(true);
});

describe("строка текущего шага закреплена, а порядок блоков и запас под ней зависят от пути и шрифта", () => {
  /** Запас под строкой стоит на ней самой: у заглушки Jest закреплённые блоки не оборачиваются (настоящий ScrollView - в HomeJourneySticky). */
  const slack = () => flat(screen.getByTestId("journey-now-row")).marginBottom;
  /** Обратный отступ у нулевого блока: он убирает видимую щель, которую оставил бы запас под строкой. */
  const pullBack = () => flat(screen.getByTestId("journey-end", { includeHiddenElements: true })).marginBottom;

  it("свёрнутый путь (по умолчанию у всех): строка и нулевой блок закреплены, блок сразу за строкой, у строки запас; дальше блоки экрана", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    const { ids, sticky } = scrollBlocks();
    expect(ids.slice(0, 3)).toEqual(["home-screen", "journey-now-row", "journey-end"]);
    expect(sticky.map((index) => ids[index])).toEqual(["journey-now-row", "journey-end"]);
    // блок за путём невидим и не занимает места: он только выталкивает строку, когда карточка пути кончается
    expect(flat(screen.getByTestId("journey-end", { includeHiddenElements: true })).height).toBe(0);
    // ровно у нижнего края строки React Native её не отпускает (левая и правая часть неравенства равны): под строкой запас
    expect(slack()).toBe(ROW_SLACK);
    // а видимой щели нет: нулевой блок тянет следующий за ним блок обратно на тот же запас, в сумме отступы дают ноль
    expect(pullBack()).toBe(-ROW_SLACK);
    expect((slack() as number) + (pullBack() as number)).toBe(0);
  });

  it("запас под строкой не меньше пункта: меньший оставляет застрявшие раскладки (стенд ревьюера: 0,05 pt - 316 из 1000, 0,2 pt - 145, 2 pt - ни одной)", () => {
    expect(ROW_SLACK).toBeGreaterThanOrEqual(1);
  });

  it("раскрытый путь: шаги стоят между строкой и нулевым блоком, закрепление охватывает их, запаса у строки нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    const { ids, sticky } = scrollBlocks();
    expect(ids.slice(0, 4)).toEqual(["home-screen", "journey-now-row", "journey-body", "journey-end"]);
    expect(sticky.map((index) => ids[index])).toEqual(["journey-now-row", "journey-end"]);
    expect(slack()).toBeUndefined();
    expect(pullBack()).toBeUndefined(); // шаги между строкой и блоком: запаса нет, тянуть нечего
  });

  it("свернуть и раскрыть: строка и нулевой блок закреплены всегда, меняются место нулевого блока и запас", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    const pinnedIds = () => scrollBlocks().sticky.map((index) => scrollBlocks().ids[index]);
    expect(pinnedIds()).toEqual(["journey-now-row", "journey-end"]);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
    expect(pinnedIds()).toEqual(["journey-now-row", "journey-end"]); // как и при раскрытом пути: закрепление не выключается
    expect(slack()).toBe(ROW_SLACK);
    expect(pullBack()).toBe(-ROW_SLACK);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    expect(pinnedIds()).toEqual(["journey-now-row", "journey-end"]);
    expect(slack()).toBeUndefined();
  });

  it("между закреплённой строкой и нулевым блоком стоят шаги: React Native отпускает строку по строгому неравенству, а не по равенству", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    const { ids, sticky } = scrollBlocks();
    const [row, end] = sticky;
    // тело шагов между ними: `nextHeaderLayoutY - layoutHeight` больше `layoutY` на высоту тела, а не равно ему
    expect(end - row).toBeGreaterThan(1);
    expect(ids.slice(row, end + 1)).toEqual(["journey-now-row", "journey-body", "journey-end"]);
  });

  describe("крупный шрифт: строка выше 40% окна не держится, а блоки лишь переставляются", () => {
    const WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 };
    const THRESHOLD = WINDOW.height * PIN_MAX_SHARE;
    beforeEach(() => {
      jest.spyOn(Dimensions, "get").mockReturnValue(WINDOW);
    });

    async function openedPath() {
      const { transport } = fakeTransport(homeHandlers("MY"));
      await renderPortal(<HomeScreen />, testApi(transport));
      await fireEvent.press(await screen.findByTestId("journey-fold"));
      await screen.findByTestId("journey-body");
    }
    /** Держится ли строка: нулевой блок за шагами (да) или сразу за строкой (нет). */
    const held = () => {
      const { ids } = scrollBlocks();
      return ids.indexOf("journey-end") > ids.indexOf("journey-body");
    };

    it("строка 374 pt на окне 874 pt (43%, iPhone Dynamic Type Accessibility Large): не держится, нулевой блок сразу за ней, шаги остаются", async () => {
      await openedPath();
      expect(held()).toBe(true); // до первой раскладки высота неизвестна: считаем строку держащейся
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(374));
      await waitFor(() => expect(held()).toBe(false));
      const { ids, sticky } = scrollBlocks();
      expect(ids.slice(0, 4)).toEqual(["home-screen", "journey-now-row", "journey-end", "journey-body"]);
      expect(sticky.map((index) => ids[index])).toEqual(["journey-now-row", "journey-end"]); // закреплены по-прежнему оба
      expect(flat(screen.getByTestId("journey-now-row")).marginBottom).toBe(ROW_SLACK);
      expect(pullBack()).toBe(-ROW_SLACK); // и шаги под высокой строкой встают вплотную, без щели в карточке
    });

    it("строка 340 pt (39%): держится; ровно 40% (349,6 pt) - ещё держится, на пункт больше - нет", async () => {
      await openedPath();
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(340));
      expect(held()).toBe(true);
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD));
      expect(held()).toBe(true);
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD + 1));
      await waitFor(() => expect(held()).toBe(false));
    });

    it("доли пикселя при пересчёте раскладки решения не меняют: 349,5 -> 349,7 через порог 349,6 строка продолжает держаться", async () => {
      await openedPath();
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD - 0.1)); // 349,5
      expect(held()).toBe(true);
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD + 0.1)); // 349,7: перешагнул порог на 0,2 pt
      expect(held()).toBe(true); // сдвиг меньше половины пункта не считается изменением, закрепление не мигает
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD + 0.6)); // 350,2: сдвиг от прежних 349,5 больше 0,5
      await waitFor(() => expect(held()).toBe(false));
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(THRESHOLD + 0.3)); // 349,9: снова меньше пункта
      expect(held()).toBe(false); // и обратно не мигает
    });

    it("после смены раскладки строка снова невысокая - держится опять", async () => {
      await openedPath();
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(374));
      await waitFor(() => expect(held()).toBe(false));
      await fireEvent(screen.getByTestId("journey-now-row"), "layout", layout(120));
      await waitFor(() => expect(held()).toBe(true));
      expect(flat(screen.getByTestId("journey-now-row")).marginBottom).toBeUndefined();
    });

    it("«Шаг N из M» под не держащейся строкой: шаг встаёт на 12 pt от верха, а не на высоту строки ниже", async () => {
      setReducedMotionForTests(false); // плавная прокрутка (после #1555 при «Уменьшить движение» она мгновенная, а в тестах оно включено)
      const stepsLabel = getPortalStrings("timeline", "ru").stepsLabel;
      const { transport } = fakeTransport(homeHandlers("MY"));
      await renderPortal(<HomeScreen />, testApi(transport));
      await fireEvent(await screen.findByTestId("journey-now-row"), "layout", layout(374)); // высокая строка: не держится
      await fireEvent.press(screen.getByTestId("journey-now"));
      await fireEvent(await screen.findByTestId("journey-body"), "layout", layout(700, 400));
      await fireEvent(screen.getByLabelText(stepsLabel), "layout", layout(500, 60));
      await fireEvent(screen.getByTestId("step-my-2-documents"), "layout", layout(120, 120));
      // 400 (блок) + 60 (список) + 120 (шаг) - 12: высоту строки не вычитаем, под ней ничего не держится
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 568, animated: true }));
    });
  });

  it("без прогресса (approved) строки шага нет, закреплять нечего", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await screen.findByTestId("journey-fold");
    const { ids, sticky } = scrollBlocks();
    expect(ids).not.toContain("journey-now-row");
    expect(ids).not.toContain("journey-end");
    expect(sticky).toEqual([]);
  });

  it("страны нет: тёмная плашка и выбор страны, закреплённых блоков нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Выберите страну");
    const { ids, sticky } = scrollBlocks();
    expect(ids[0]).toBe("home-screen");
    expect(ids).not.toContain("journey-now-row");
    expect(sticky).toEqual([]);
  });
});

describe("правило закрепления строки шага", () => {
  const base = { hasStrip: true, folded: false, rowHeight: 120, viewportHeight: 874 };

  it("закрепляется только у раскрытого пути и невысокой строки", () => {
    expect(rowPinned(base)).toBe(true);
    expect(rowPinned({ ...base, folded: true })).toBe(false); // свёрнутый путь: закреплять нечего
    expect(rowPinned({ ...base, hasStrip: false })).toBe(false); // строки нет
    expect(rowPinned({ ...base, rowHeight: 374 })).toBe(false); // 43% экрана
  });

  it("порог - доля экрана, ровно на пороге закреплена", () => {
    expect(PIN_MAX_SHARE).toBe(0.4);
    expect(rowPinned({ ...base, rowHeight: 874 * PIN_MAX_SHARE })).toBe(true);
    expect(rowPinned({ ...base, rowHeight: 874 * PIN_MAX_SHARE + 0.01 })).toBe(false);
    expect(rowPinned({ ...base, rowHeight: 300, viewportHeight: 600 })).toBe(false); // тот же рост на низком экране
  });

  it("высота строки или экрана ещё неизвестна (0, NaN) - закреплена: до первой раскладки решать нечем", () => {
    expect(rowPinned({ ...base, rowHeight: 0 })).toBe(true);
    expect(rowPinned({ ...base, viewportHeight: 0 })).toBe(true);
    expect(rowPinned({ ...base, rowHeight: Number.NaN })).toBe(true);
  });
});

describe("карточка пути из нескольких блоков", () => {
  it("места блоков: шапка сверху, строка и шаги ниже, последний закрывает рамку", () => {
    expect(journeyEdges({ strip: null, folded: true })).toEqual({ head: "only", now: "last", body: "last" });
    expect(journeyEdges({ strip: { kind: "complete", total: 3 }, folded: true })).toEqual({ head: "first", now: "last", body: "last" });
    expect(journeyEdges({ strip: { kind: "complete", total: 3 }, folded: false })).toEqual({ head: "first", now: "middle", body: "last" });
    // нет строки шага: у шапки и шагов места те же, строки в карточке просто нет
    expect(journeyEdges({ strip: null, folded: false })).toMatchObject({ head: "first", body: "last" });
  });

  it("рамка: боковые линии у всех, верх и скругление у первого, низ и скругление у последнего", () => {
    const edge = (kind: "only" | "first" | "middle" | "last") => cardEdge(lightTokens as never, "light", kind);
    expect(edge("first")).toMatchObject({ borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 12, borderBottomLeftRadius: 0 });
    expect(edge("middle")).toMatchObject({ borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 0, borderBottomRightRadius: 0 });
    expect(edge("last")).toMatchObject({ borderTopWidth: 0, borderBottomWidth: 1, borderTopRightRadius: 0, borderBottomRightRadius: 12 });
    expect(edge("only")).toMatchObject({ borderTopWidth: 1, borderBottomWidth: 1, borderTopLeftRadius: 12, borderBottomRightRadius: 12 });
    expect(cardEdge(lightTokens as never, "dark", "first").boxShadow).toBeUndefined(); // в тёмной теме тени у карточек нет
    expect(cardEdge(lightTokens as never, "light", "first").boxShadow).toBe(lightTokens.shadowCard);
  });

  it("на экране: свёрнутый путь закрыт строкой шага, раскрытый - шагами", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("journey-now-row");
    expect(flat(screen.getByTestId("journey")).borderBottomWidth).toBe(0); // шапка не закрывает карточку
    expect(flat(screen.getByTestId("journey-now-row"))).toMatchObject({ borderBottomWidth: 1, borderBottomLeftRadius: lightTokens.radiusCard });
    await fireEvent.press(screen.getByTestId("journey-fold"));
    const body = await screen.findByTestId("journey-body");
    expect(flat(screen.getByTestId("journey-now-row"))).toMatchObject({ borderBottomWidth: 1, borderBottomLeftRadius: 0 }); // теперь это линия между строкой и шагами
    expect(flat(body)).toMatchObject({ borderBottomWidth: 1, borderBottomLeftRadius: lightTokens.radiusCard });
  });
});

describe("шапка пути и плашка", () => {
  it("красные пятна лежат под шапкой пути; знак EVO - только у плашки без страны", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    expect(screen.getByTestId("hero-wash", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("hero-mark", { includeHiddenElements: true })).toBeNull();
  });

  it("плашка без страны: красные пятна и знак EVO, тень карточки", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Выберите страну");
    expect(screen.getByTestId("hero-wash", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("hero-mark", { includeHiddenElements: true })).toBeTruthy();
    expect(flat(screen.getByTestId("home-hero")).boxShadow).toBe(lightTokens.shadowCard);
  });

  it("заголовок пути для читалки: «Путь поступления: страна» скрытым заголовком, приветствие остаётся единственным видимым", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const heading = await screen.findByTestId("journey-heading");
    expect(heading).toHaveTextContent("Путь поступления: Малайзия");
    expect(heading.props.accessibilityRole).toBe("header");
    expect(flat(heading)).toMatchObject({ position: "absolute", width: 1, height: 1, color: "transparent" });
  });

  it("приветствие первым в дереве читалки, затем заголовок пути (веб: h1 приветствия, затем скрытый h2)", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const heading = await screen.findByTestId("journey-heading");
    const headers = screen.getAllByRole("header", { includeHiddenElements: true });
    expect(headers[0]).toHaveTextContent("Здравствуйте, Тест Студентов");
    expect(headers[1]).toBe(heading);
    // и по месту на экране заголовок не выше приветствия: он стоит у нижнего края блока приветствия, а не в углу шапки
    expect(flat(heading)).toMatchObject({ position: "absolute", left: 0, bottom: 0 });
    expect(flat(heading).top).toBeUndefined();
  });

  it.each([
    ["MY", "с фото столицы"],
    ["CN", "без фото (тёмная плашка)"],
  ])("низ шапки пути 52 всегда, %s: когда фото приходит позже индекса каталога, шапка не вырастает (веб: `padding-bottom: 52px`)", async (country) => {
    const { transport } = fakeTransport(homeHandlers(country));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-sub");
    expect(flat(screen.getByTestId("hero-content"))).toMatchObject({ paddingTop: 22, paddingBottom: 52 });
  });

  it("после сохранения страны читалка называет новый заголовок пути; тот же выбор ничего не объявляет", async () => {
    let choice: unknown = saved("MY");
    const { transport } = fakeTransport(
      homeHandlers("MY", {
        student_country_choice_v1: () => choice,
        set_student_country_choice_v1: (args: Record<string, unknown> | undefined) => (choice = saved(args?.p_country as string)),
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("change-country"));
    await fireEvent.press(await screen.findByTestId("country-AE"));
    await waitFor(() => expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Путь поступления: ОАЭ"));
    expect(screen.getByTestId("journey-heading")).toHaveTextContent("Путь поступления: ОАЭ");
    (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
    await fireEvent.press(screen.getByTestId("change-country"));
    await fireEvent.press(await screen.findByTestId("country-AE")); // та же страна: запись не идёт, объявлять нечего
    await waitFor(() => expect(screen.queryByTestId("country-AE")).toBeNull());
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it("«Пока не решил»: заголовок пути без названия страны", async () => {
    const { transport } = fakeTransport(homeHandlers("UNDECIDED"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("journey-heading")).toHaveTextContent(/^Путь поступления$/);
  });
});

describe("«Шаг N из M» ведёт к текущему шагу", () => {
  const stepsLabel = getPortalStrings("timeline", "ru").stepsLabel;

  it("раскрывает путь и текущий шаг и прокручивает его под закреплённую строку: место блоков, высота строки и 12 px", async () => {
    setReducedMotionForTests(false); // плавная прокрутка; при «Уменьшить движение» она мгновенная (тест ниже)
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent(await screen.findByTestId("journey-now-row"), "layout", layout(90));
    await fireEvent.press(screen.getByTestId("journey-now"));
    // шаги появились: блок шагов, список в нём и сам шаг получают место
    await fireEvent(await screen.findByTestId("journey-body"), "layout", layout(700, 400));
    await fireEvent(screen.getByLabelText(stepsLabel), "layout", layout(500, 60));
    expect(scrollTo).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("step-my-2-documents"), "layout", layout(120, 120));
    // 400 (блок) + 60 (список) + 120 (шаг) - 90 (строка) - 12
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 478, animated: true }));
    expect(screen.getByTestId("step-toggle-my-2-documents").props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("путь уже на экране - прокрутка сразу, без ожидания раскладки", async () => {
    setReducedMotionForTests(false);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent(await screen.findByTestId("journey-now-row"), "layout", layout(90));
    await fireEvent.press(screen.getByTestId("journey-fold")); // студент сам раскрыл весь путь
    await fireEvent(await screen.findByTestId("journey-body"), "layout", layout(700, 400));
    await fireEvent(screen.getByLabelText(stepsLabel), "layout", layout(500, 60));
    await fireEvent(screen.getByTestId("step-my-2-documents"), "layout", layout(120, 120));
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("journey-now"));
    expect(scrollTo).toHaveBeenCalledWith({ y: 478, animated: true });
  });

  it("при «Уменьшить движение» прокрутка к текущему шагу мгновенная (веб: `behavior: auto`)", async () => {
    setReducedMotionForTests(true);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent(await screen.findByTestId("journey-now-row"), "layout", layout(90));
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await fireEvent(await screen.findByTestId("journey-body"), "layout", layout(700, 400));
    await fireEvent(screen.getByLabelText(stepsLabel), "layout", layout(500, 60));
    await fireEvent(screen.getByTestId("step-my-2-documents"), "layout", layout(120, 120));
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("journey-now"));
    expect(scrollTo).toHaveBeenCalledWith({ y: 478, animated: false });
  });

  it("шаг у самого верха не уходит в минус", async () => {
    setReducedMotionForTests(false);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent(await screen.findByTestId("journey-now-row"), "layout", layout(90));
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await fireEvent(await screen.findByTestId("journey-body"), "layout", layout(700, 0));
    await fireEvent(screen.getByLabelText(stepsLabel), "layout", layout(500, 0));
    await fireEvent(screen.getByTestId("step-my-2-documents"), "layout", layout(120, 10));
    await fireEvent.press(screen.getByTestId("journey-now"));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: true });
  });
});

describe("«Свернуть» возвращает экран к карточке пути", () => {
  // QA 25.11.2026: «Свернуть» на закреплённой строке глубоко в пути оставляло прежний сдвиг прокрутки, и экран оказывался на ~1500 pt
  // ниже карточки: шаги под строкой пропали, а сдвиг остался. Ревью: у самого верха страницы (карточка на 16 pt ниже края) возврат
  // сдвигал страницу на эти 16 pt, поэтому возвращаем только когда экран ниже верха карточки.
  /** Сообщить карточке пути её место на экране: до того, как путь отрисован, на её месте стоит плашка без `onLayout`. */
  async function placeCard(y: number) {
    await screen.findByTestId("journey");
    await fireEvent(screen.getByTestId("home-screen"), "layout", layout(420, y));
  }
  /** Прокрутка списка: верх окна стоит на `y` пунктов от начала содержимого. */
  const scrollTop = (y: number) => fireEvent.scroll(screen.getByTestId("screen-scroll"), { nativeEvent: { contentOffset: { y } } });

  it("свернули глубоко в пути - экран сразу, без анимации, встаёт на верх карточки; раскрытие экран не двигает", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await placeCard(24);
    await fireEvent.press(await screen.findByTestId("journey-fold")); // раскрыли весь путь
    await screen.findByTestId("journey-body");
    expect(scrollTo).not.toHaveBeenCalled();
    await scrollTop(1500); // ушли вглубь пути
    await fireEvent.press(screen.getByTestId("journey-fold")); // свернули со строки шага
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 24, animated: false });
    await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
    // и снова раскрыли: прокрутки нет
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("у самого верха страницы «Свернуть» её не двигает: на верху карточки и выше (в том числе отрицательный сдвиг iPhone) прокрутки нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await placeCard(16); // верх карточки на 16 pt: боковой отступ содержимого
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    const foldAt = async (y: number) => {
      await scrollTop(y);
      scrollTo.mockClear();
      await fireEvent.press(screen.getByTestId("journey-fold")); // свернуть
      const called = scrollTo.mock.calls.length;
      await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
      await fireEvent.press(screen.getByTestId("journey-fold")); // раскрыть обратно для следующего прогона
      await screen.findByTestId("journey-body");
      return called;
    };
    expect(await foldAt(0)).toBe(0); // страница у самого верха: двигать нечего
    expect(await foldAt(-30)).toBe(0); // «резинка» iPhone: сдвиг отрицательный
    expect(await foldAt(16)).toBe(0); // ровно на верху карточки
    expect(await foldAt(16.5)).toBe(1); // чуть ниже карточки: возвращаем
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 16, animated: false });
  });

  it("верх карточки выше края (минус от раскладки): возврат не уходит в минус", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await placeCard(-3);
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    await scrollTop(300);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it("место карточки ещё не известно (раскладки не было): путь сворачивается без прокрутки", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    await scrollTop(300);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("положение прокрутки не знают, пока список не прокручивали: считается верх страницы, прокрутки нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await placeCard(24);
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    await fireEvent.press(screen.getByTestId("journey-fold")); // событий прокрутки не было
    await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("«Свернуть» в шапке (без строки шага, approved) тоже возвращает к карточке, если экран ниже неё", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await placeCard(8);
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    await scrollTop(300);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    expect(scrollTo).toHaveBeenCalledWith({ y: 8, animated: false });
  });

  it("список сообщает положение прокрутки: событие каждые 16 мс, обработчик только у экрана, которому он нужен", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const scroll = await screen.findByTestId("screen-scroll");
    expect(scroll.props.scrollEventThrottle).toBe(16);
    expect(typeof scroll.props.onScroll).toBe("function");
  });
});

describe("блоки входят по очереди", () => {
  it("дело, даты, «Мой список», «Что нового», CSCA - с шагом stagger; задача EVO не входит; блок скрыт до своей очереди", async () => {
    setReducedMotionForTests(false);
    const start = jest.fn();
    const timing = jest.spyOn(Animated, "timing").mockImplementation(() => ({ start, stop: jest.fn(), reset: jest.fn() }) as never);
    const { transport } = fakeTransport(homeHandlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-csca");
    // порядок входа - по слотам веба, а не по месту на экране
    const enters = timing.mock.calls.map((call) => call[1] as Animated.TimingAnimationConfig).filter((config) => config.duration === lightTokens.motionBase);
    const delays = new Set(enters.map((config) => config.delay));
    for (const slot of [0, 1, 2, 3, 4]) expect(delays.has(slot * lightTokens.stagger)).toBe(true);
    expect(flat(screen.getByTestId("slot-dates")).opacity).toBe(0);
    expect(flat(screen.getByTestId("slot-evo")).opacity).toBeUndefined(); // обычный блок, без входа
  });

  it("полоса шагов растёт один раз: scaleX с нуля", async () => {
    setReducedMotionForTests(false);
    jest.spyOn(Animated, "timing").mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }) as never);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("journey-now-row");
    const meter = screen.getByTestId("journey-meter");
    expect(flat(meter).transformOrigin).toBe("left center");
    expect(JSON.stringify(flat(meter).transform)).toContain('"scaleX":0');
  });

  it("при «Уменьшить движение» всё стоит на месте сразу", async () => {
    moveNow("2026-09-08T05:00:00Z");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-dates");
    expect(flat(screen.getByTestId("slot-dates")).opacity).toBe(1);
  });
});
