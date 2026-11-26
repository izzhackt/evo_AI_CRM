// Шапка «Главной» (веб #1489): фото столицы с «©», «страна · набор», отсчёт до ближайшей даты, тёмная плашка без фото
// и без страны, светлая и тёмная темы.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";
import { homeDayMonth } from "@web/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@web/lib/portal/i18n";

import { HomeScreen } from "@/features/home/HomeScreen";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";
import { setReducedMotionForTests } from "@/ui/motion";
import { OVERVIEW_ROW_EMPTY, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { homeHandlers, moveNow, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;
const uriOf = (node: { props: unknown }) => [(node.props as { source: { uri: string } | { uri: string }[] }).source].flat()[0].uri;
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

type JsonNode = { props?: { testID?: string }; children?: (JsonNode | string)[] | null };
/** Есть ли в поддереве узел с таким `testID`. */
function containsTestId(node: JsonNode | string, testID: string): boolean {
  return typeof node !== "string" && (node.props?.testID === testID || (node.children ?? []).some((child) => containsTestId(child, testID)));
}
/** Самая глубокая колонка, у которой в разных детях лежат оба узла: общий предок двух элементов. */
function columnOf(tree: unknown, first: string, second: string): JsonNode | null {
  const roots = ([] as unknown[]).concat(tree) as JsonNode[];
  for (const node of roots) {
    const children = (node.children ?? []).filter((child): child is JsonNode => typeof child !== "string");
    for (const child of children) {
      const deeper = columnOf(child, first, second);
      if (deeper) return deeper;
    }
    const holders = children.filter((child) => containsTestId(child, first) || containsTestId(child, second));
    if (holders.length >= 2 && holders.some((child) => containsTestId(child, first)) && holders.some((child) => containsTestId(child, second))) return node;
  }
  return null;
}

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear(); // копия индекса каталога с диска не переходит между тестами
  await AsyncStorage.clear();
  navigate.mockClear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(restoreNow);

describe("шапка на фото столицы", () => {
  it("фото города-столицы из нашего бакета, подпись автора по «©», приветствие и «страна · набор» поверх", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const photo = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    // Куала-Лумпур - столица Малайзии: копия нужной ширины из бакета каталога, без похода на чужие сайты
    expect(uriOf(photo)).toMatch(/^http:\/\/localhost:46421\/storage\/v1\/render\/image\/public\/portal-university-photos\/geography\/cities\/kuala-lumpur-0123456789ab\.jpg\?width=\d+/);
    expect(within(screen.getByTestId("home-hero")).getByText("Здравствуйте, Тест Студентов")).toBeTruthy();
    expect(screen.getByTestId("hero-sub")).toHaveTextContent(/^Малайзия · /);
    // фото не читается экранной читалкой: это декор, название страны уже в тексте
    expect(photo.props.accessibilityElementsHidden).toBe(true);
    // «©» сворачивается; по нажатию - автор, источник и лицензия, ссылка ведёт на страницу файла
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    expect(screen.queryByTestId("hero-credit-text")).toBeNull();
    await fireEvent.press(screen.getByTestId("hero-credit"));
    const line = screen.getByTestId("hero-credit-text");
    expect(within(line).getByText("Фото: Автор Тестов, Wikimedia Commons, CC BY 4.0")).toBeTruthy();
    await fireEvent.press(line);
    expect(open).toHaveBeenCalledWith("https://commons.wikimedia.org/wiki/File:Test.jpg");
    open.mockRestore();
  });

  it("раскрытая подпись «©» не закрывает кнопки шапки: стоит в потоке под ними, а кнопка «©» лежит в углу", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    // кнопка «©» - в правом нижнем углу шапки, в запасе под кнопками (нижний отступ шапки 52 pt, кнопка 44 pt)
    const button = screen.getByTestId("hero-credit");
    expect(flat(button)).toMatchObject({ position: "absolute", right: 2, bottom: 6, width: 44, height: 44 });
    await fireEvent.press(button);
    const text = screen.getByTestId("hero-credit-text");
    // подпись не абсолютная и не лежит ни в одном абсолютном блоке до самой шапки: она в потоке, значит не поверх чего-либо
    expect(flat(text).position).toBeUndefined();
    let ancestors = 0;
    for (let node = text.parent; node && node.props.testID !== "home-hero"; node = node.parent) {
      expect(flat(node).position).not.toBe("absolute"); // `flat` сворачивает и стили-массивы
      ancestors += 1;
    }
    expect(ancestors).toBeGreaterThan(0); // обход действительно прошёл по предкам, а не стоял на месте
    // и она идёт в колонке шапки ПОСЛЕ кнопок «Все шаги» / «Сменить страну»: ниже них, а не над ними
    const column = columnOf(screen.toJSON(), "change-country", "hero-credit-text");
    expect(column).not.toBeNull();
    const children = column!.children as JsonNode[];
    const at = (testID: string) => children.findIndex((child) => containsTestId(child, testID));
    expect(at("hero-credit-text")).toBeGreaterThan(at("change-country"));
    expect(at("change-country")).toBeGreaterThan(at("hero-countdown"));
    // повторное нажатие сворачивает подпись, шапка возвращается к прежней высоте
    await fireEvent.press(button);
    expect(screen.queryByTestId("hero-credit-text")).toBeNull();
    expect(screen.getByTestId("hero-credit").props.accessibilityState).toMatchObject({ expanded: false });
  });

  it("копия не загрузилась - оригинал; и он не загрузился - тёмная плашка без «©»", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const first = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    expect(uriOf(first)).toContain("/render/image/public/");
    await fireEvent(first, "error", { nativeEvent: { error: "load failed" } });
    const second = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    expect(uriOf(second)).toBe("http://localhost:46421/storage/v1/object/public/portal-university-photos/geography/cities/kuala-lumpur-0123456789ab.jpg");
    await fireEvent(second, "error", { nativeEvent: { error: "load failed" } });
    await waitFor(() => expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull());
    expect(screen.queryByTestId("hero-credit")).toBeNull();
    // шапка осталась: текст, «Сменить страну» и строка шага на месте
    expect(screen.getByText("Здравствуйте, Тест Студентов")).toBeTruthy();
    expect(screen.getByTestId("change-country")).toBeTruthy();
    expect(screen.getByTestId("journey-now")).toBeTruthy();
  });

  it.each([
    [false, 150],
    [true, 0],
  ])("«Уменьшить движение» = %s: фото появляется за %s мс (веб: `prefers-reduced-motion`)", async (reduced, duration) => {
    setReducedMotionForTests(reduced);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    // expo-image принимает число миллисекунд и отдаёт нативному слою `{ duration }`
    expect((await screen.findByTestId("hero-photo", { includeHiddenElements: true })).props.transition).toEqual({ duration });
    setReducedMotionForTests(true);
  });

  it("фото не загрузилось - потянуть вниз даёт ему ещё одну попытку (веб: перезагрузка страницы)", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const first = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    await fireEvent(first, "error", { nativeEvent: { error: "load failed" } });
    const second = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    await fireEvent(second, "error", { nativeEvent: { error: "load failed" } });
    await waitFor(() => expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull());
    await act(async () => {
      screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    // снова копия нужной ширины, а не оригинал: попытка начинается сначала
    const again = await screen.findByTestId("hero-photo", { includeHiddenElements: true });
    expect(uriOf(again)).toContain("/render/image/public/");
    expect(screen.getByTestId("hero-credit")).toBeTruthy();
  });

  it("нет фото столицы (у Китая в тестовом каталоге нет ни Пекина, ни фото страны) - плашка без «©»", async () => {
    const { transport } = fakeTransport(homeHandlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-sub");
    expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId("hero-credit")).toBeNull();
    expect(screen.getByTestId("hero-sub")).toHaveTextContent(/^Китай · набор на сентябрь 2027 года$/);
  });

  it("индекс каталога не прочитался - шапка без фото, страница не падает", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_university_index_v1: failure(null, 503) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-sub");
    await screen.findByTestId("case-open");
    expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("journey")).toBeTruthy();
  });

  it("без страны - тёмная плашка с приветствием и отсчётом, фото и «©» нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Выберите страну");
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId("hero-sub")).toBeNull();
    expect(await screen.findByTestId("hero-countdown")).toBeTruthy(); // отсчёт есть и у тёмной плашки (веб #1489)
  });
});

describe("приветствие", () => {
  it("два ряда, дальше шрифт ужимается, но не мельче 60%: длинное слово не рвётся посреди (QA, «Сопровождаемы / й» при крупном шрифте)", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const greeting = await screen.findByText("Здравствуйте, Тест Студентов");
    expect(greeting.props.accessibilityRole).toBe("header");
    expect(greeting.props.numberOfLines).toBe(2);
    expect(greeting.props.adjustsFontSizeToFit).toBe(true);
    expect(greeting.props.minimumFontScale).toBe(0.6);
    // шрифт системы растёт не больше, чем на 20%: заголовок не вытесняет остальную шапку
    expect(greeting.props.maxFontSizeMultiplier).toBe(1.2);
  });

  it("у тёмной плашки без страны приветствие устроено так же", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const greeting = await screen.findByText("Здравствуйте, Тест Студентов");
    expect(greeting.props).toMatchObject({ numberOfLines: 2, adjustsFontSizeToFit: true, minimumFontScale: 0.6, maxFontSizeMultiplier: 1.2 });
  });
});

describe("отсчёт до ближайшей даты", () => {
  it("число дней, «дней до 12 сент.» и само дело; вся плашка ведёт к делу", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(within(count).getByText("4", { includeHiddenElements: true })).toBeTruthy();
    expect(within(count).getByText("дня до 12 сент.", { includeHiddenElements: true })).toBeTruthy();
    expect(within(count).getByText("Замените документ: Паспорт", { includeHiddenElements: true })).toBeTruthy();
    // читалка слышит одну фразу: «4 дня до: дело, полная дата»
    expect(count.props.accessibilityLabel).toBe("4 дня до: Замените документ: Паспорт, 12 сентября 2026 г.");
    await fireEvent.press(count);
    expect(navigate).toHaveBeenCalledWith(`/documents?focus=${SLOT_ID}`);
  });

  it("при крупном шрифте системы число растёт не больше, чем заголовок шапки, а подпись уходит под него, а не сжимается", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(flat(count)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    const big = within(screen.getByTestId("hero-countdown-big", { includeHiddenElements: true })).getByText("4", { includeHiddenElements: true });
    expect(big.props.maxFontSizeMultiplier).toBe(1.2);
    // подпись держит свою ширину (не уже 180) и растягивается на остаток строки
    expect(flat(screen.getByTestId("hero-countdown-text", { includeHiddenElements: true }))).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 });
  });

  it("слово «Просрочено» (на кыргызском длинное) тоже ограничено в росте и переносится вместе со строкой", async () => {
    moveNow("2026-09-20T05:00:00Z");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport), "ky");
    const count = await screen.findByTestId("hero-countdown");
    const word = within(screen.getByTestId("hero-countdown-big", { includeHiddenElements: true })).getByText(getPortalStrings("home", "ky").heroOverdue, { includeHiddenElements: true });
    expect(word.props.maxFontSizeMultiplier).toBe(1.2);
    expect(flat(count).flexWrap).toBe("wrap");
  });

  it.each([
    ["2026-09-12T02:00:00Z", "Сегодня", "12 сент."], // 08:00 в Бишкеке, срок паспорта - 09:00 того же дня
    ["2026-09-11T05:00:00Z", "Завтра", "12 сент."],
  ])("при «сегодня» %s на месте числа стоит слово «%s» и дата «%s»", async (today, word, date) => {
    moveNow(today);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(within(count).getByText(word, { includeHiddenElements: true })).toBeTruthy();
    expect(within(count).getByText(date, { includeHiddenElements: true })).toBeTruthy();
  });

  it("просроченное дело важнее будущей даты: красная плашка «Просрочено» и ссылка на это дело", async () => {
    moveNow("2026-09-20T05:00:00Z"); // паспорт до 12.09 прошёл, платёж до 01.10 ещё впереди
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(within(count).getByText("Просрочено", { includeHiddenElements: true })).toBeTruthy();
    expect(within(count).getByText("Замените документ: Паспорт", { includeHiddenElements: true })).toBeTruthy();
    expect(flat(screen.getByTestId("hero-countdown-big", { includeHiddenElements: true })).backgroundColor).toBe(lightTokens.brandRed);
    await fireEvent.press(count);
    expect(navigate).toHaveBeenCalledWith(`/documents?focus=${SLOT_ID}`);
  });

  // QA 25.11.2026: слово «Просрочено» рисовалось размером числа (44 pt) и занимало три четверти строки, число - размером слова.
  it.each([
    ["2026-09-08T05:00:00Z", "4", lightTokens.sizeDisplay * 1.375, lightTokens.sizeDisplay * 1.375], // число: крупно, интерлиньяж 1
    ["2026-09-12T02:00:00Z", "Сегодня", lightTokens.sizeTitle, lightTokens.sizeTitle * 1.2],
    ["2026-09-11T05:00:00Z", "Завтра", lightTokens.sizeTitle, lightTokens.sizeTitle * 1.2],
    ["2026-09-20T05:00:00Z", "Просрочено", lightTokens.sizeTitle, lightTokens.sizeTitle * 1.2],
  ])("при «сегодня» %s «%s» набрано размером %s, интерлиньяж %s: слово мельче числа", async (today, text, fontSize, lineHeight) => {
    moveNow(today);
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-countdown");
    const big = within(screen.getByTestId("hero-countdown-big", { includeHiddenElements: true })).getByText(text, { includeHiddenElements: true });
    expect(flat(big)).toMatchObject({ fontSize, lineHeight });
    // система не раздувает ни число, ни слово больше, чем на 20%: иначе при крупном шрифте плашка выходит за шапку
    expect(big.props.maxFontSizeMultiplier).toBe(1.2);
    expect(big.props.numberOfLines).toBeUndefined(); // «Просрочено» не обрезается
  });

  it("строка отсчёта переносится: дата и дело остаются рядом с числом, пока им хватает 180 pt, иначе уходят строкой ниже на всю ширину", async () => {
    moveNow("2026-09-20T05:00:00Z"); // просрочено: самая широкая плашка
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const count = await screen.findByTestId("hero-countdown");
    expect(flat(count)).toMatchObject({ flexDirection: "row", flexWrap: "wrap", columnGap: 10 });
    const text = screen.getByTestId("hero-countdown-text", { includeHiddenElements: true });
    // столбец подписи растёт на остаток строки, сжимается и не требует меньше 180 pt; нулевой минимум - чтобы название не распирало шапку
    expect(flat(text)).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 });
    // название дела в одну строку с многоточием (как на вебе), дата - над ним
    expect(within(text).getByText("Замените документ: Паспорт", { includeHiddenElements: true }).props.numberOfLines).toBe(1);
  });

  it("дат на 60 дней нет - отсчёта нет", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [], student_university_favorites_v1: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Дат пока нет");
    expect(screen.queryByTestId("hero-countdown")).toBeNull();
  });

  it("кыргызский: слова отсчёта из общего словаря", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport), "ky");
    const count = await screen.findByTestId("hero-countdown");
    const home = getPortalStrings("home", "ky");
    expect(within(count).getByText("4", { includeHiddenElements: true })).toBeTruthy();
    // строка отсчёта по шаблону кыргызского словаря: «{дата} · {слово}»
    const line = formatPortalString(home.heroCountdownLine, { word: home["heroDays.few"], date: homeDayMonth("2026-09-12", "ky") });
    expect(within(count).getByText(line, { includeHiddenElements: true })).toBeTruthy();
    expect(line).toContain(home["heroDays.few"]);
  });
});

describe("светлая и тёмная тема", () => {
  it("шапка одинакова в обеих темах (графит с белым текстом), остальное берёт токены темы", async () => {
    await AsyncStorage.setItem("evo.theme", "dark");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("hero-sub");
    await waitFor(() => expect(flat(screen.getByTestId("journey")).backgroundColor).toBe(darkTokens.surface));
    // шапка: графит и красная кромка не зависят от темы
    expect(flat(screen.getByTestId("home-hero")).backgroundColor).toBe(darkTokens.heroBg);
    expect(flat(screen.getByTestId("home-hero")).borderTopColor).toBe(darkTokens.brandRed);
    // строка шага и карточки - цвета тёмной темы
    expect(flat(screen.getByTestId("journey-now-row")).borderColor).toBe(darkTokens.line);
    expect(flat(screen.getByTestId("journey-now-row")).backgroundColor).toBe(darkTokens.surface);
    expect(darkTokens.heroBg).toBe(lightTokens.heroBg);
    expect(darkTokens.surface).not.toBe(lightTokens.surface);
  });
});
