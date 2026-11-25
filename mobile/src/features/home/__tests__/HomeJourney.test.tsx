// Блок пути на «Главной» как часть списка экрана (веб #1489): строка текущего шага закрепляется, карточка складывается из
// блоков, шапка с красными пятнами, прокрутка к текущему шагу, вход блоков по очереди.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, ScrollView } from "react-native";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { cardEdge, journeyEdges } from "@/features/admission/JourneySection";
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

describe("строка текущего шага закрепляется у верха", () => {
  it("свёрнутый путь: шапка, закреплённая строка и закреплённый нулевой блок за картой пути, дальше блоки экрана", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    const { ids, sticky } = scrollBlocks();
    expect(ids.slice(0, 3)).toEqual(["home-screen", "journey-now-row", "journey-end"]);
    expect(sticky).toEqual([1, 2]);
    expect(sticky.map((index) => ids[index])).toEqual(["journey-now-row", "journey-end"]);
    // блок за путём невидим и не занимает места: он только выталкивает строку, когда карточка пути кончается
    const end = screen.getByTestId("journey-end", { includeHiddenElements: true });
    expect(flat(end).height).toBe(0);
  });

  it("раскрытый путь: шаги стоят между строкой и нулевым блоком, закрепление охватывает их", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    const { ids, sticky } = scrollBlocks();
    expect(ids.slice(0, 4)).toEqual(["home-screen", "journey-now-row", "journey-body", "journey-end"]);
    expect(sticky.map((index) => ids[index])).toEqual(["journey-now-row", "journey-end"]);
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
