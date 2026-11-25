// «Английский» как на сайте (G52, G53, G56 и ревью #1567): плитки по две в ряд с обложкой, номером и английской плашкой, блок модуля
// без описаний, «Повторить ошибки» по банку ошибок, все модули, обложка без фото, цвета в тёмной теме. Чтения идут по настоящему пути
// приложения на поддельном транспорте; данные синтетические.
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Dimensions, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { EnglishScreen } from "@/features/learning/english/EnglishScreen";
import { actionsStacked, longestWordLength } from "@/features/learning/english/module-actions";
import { LessonTileCover, fallbackArtWidth, lessonHeroHeight } from "@/features/learning/english/LessonCover";
import { LESSON_ART_KEYS, LessonArt } from "@/features/learning/english/LessonArt";
import { LESSON_COVERS } from "@/features/learning/english/covers";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { MODULE_ID, modulesFixture, reviewItems } from "@/test-fixtures/english";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const LESSONS = [
  { n: 1, completed: true, last: { correct: 7, total: 8 } },
  { n: 2, completed: true, last: { correct: 8, total: 8 } },
  { n: 3, draft: true },
  { n: 4 },
];
/** Обложка скрыта от читалки (она декоративная), поэтому проверки вида идут с `includeHiddenElements`. */
const hidden = { includeHiddenElements: true };
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const CONTENT_WIDTH = 358; // экран 390 pt без полей по 16

type Json = { type: string; children?: (Json | string)[] | null } | (Json | string)[] | null;
/** Есть ли в дереве экрана хост-элемент данного типа (дерево сериализовать нельзя: в свойствах провайдеров есть циклы). */
function hasHostType(node: Json, type: string): boolean {
  if (node === null || typeof node === "string") return false;
  if (Array.isArray(node)) return node.some((child) => hasHostType(child as Json, type));
  return node.type === type || (node.children ?? []).some((child) => hasHostType(child as Json, type));
}

/** Ширину блока плиток телефон сообщает сам; в Jest раскладки нет, поэтому сообщаем её тем же событием. */
async function layoutGrids(width = CONTENT_WIDTH) {
  for (const grid of screen.getAllByTestId("english-grid")) await fireEvent(grid, "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });
}

async function open(handlers: Record<string, unknown>, lang: "ru" | "ky" = "ru", width = CONTENT_WIDTH) {
  const fake = fakeTransport({ learning_modules_v1: modulesFixture(LESSONS), learning_review_v1: reviewItems(1, 0), ...handlers });
  const view = await renderPortal(<EnglishScreen />, testApi(fake.transport), lang);
  await screen.findAllByTestId("english-grid");
  await layoutGrids(width);
  return { ...fake, ...view };
}

beforeEach(() => {
  jest.mocked(router.navigate).mockClear();
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});

describe("блок модуля (G52)", () => {
  it("название, «Пройдено уроков: 2 из 4» и цельная полоса; заметки об уровне и подсказки к тесту, которых на сайте нет, не показываются", async () => {
    await open({});
    expect(screen.getByText("Модуль один")).toBeTruthy();
    expect(screen.getByTestId("english-progress")).toHaveTextContent("Пройдено уроков: 2 из 4");
    const bar = screen.getByTestId("english-progress-bar");
    expect(bar.props.accessibilityRole).toBe("progressbar");
    expect(bar.props.accessibilityLabel).toBe("Пройдено уроков: 2 из 4");
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 4, now: 2 });
    expect(screen.queryByText(/Заметка об уровне/)).toBeNull();
    expect(screen.queryByText(/36 заданий покажут/)).toBeNull();
    expect(screen.getByTestId("english-test-open")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("english-test-open"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/tests/[key]", params: { key: "english36" } });
  });

  it("все модули, а не только первый: у каждого свой блок и своя полоса", async () => {
    await open({ learning_modules_v1: modulesFixture(LESSONS, [{ title: "Второй модуль" }]) });
    expect(screen.getByText("Модуль один")).toBeTruthy();
    expect(screen.getByText("Второй модуль")).toBeTruthy();
    expect(screen.getAllByTestId("english-progress-bar")).toHaveLength(2);
  });

  it("модулей нет: «Уроки готовятся» со значком, как пустое состояние сайта", async () => {
    const fake = fakeTransport({ learning_modules_v1: { modules: [] } });
    await renderPortal(<EnglishScreen />, testApi(fake.transport));
    expect(await screen.findByText("Уроки готовятся")).toBeTruthy();
    expect(screen.getByText("Когда проверенный модуль будет опубликован, он появится здесь.")).toBeTruthy();
    // Значок lucide рисуется векторным элементом внутри блока пустого состояния (в дереве он скрыт от читалки).
    expect(hasHostType(screen.toJSON(), "RNSVGSvgView")).toBe(true);
  });

  it("кнопки модуля в одной строке поровну: когда банк ошибок прочитан и появляется вторая, строка не переносится и плитки не сдвигаются вниз", async () => {
    await open({ learning_review_v1: reviewItems(1, 2) });
    const review = await screen.findByTestId("english-review-open");
    for (const button of [review, screen.getByTestId("english-test-open")]) expect(flat(button).flex).toBe(1);
    const row = flat(screen.getByTestId("english-module-actions"));
    expect(row.flexDirection).toBe("row");
    expect(row.flexWrap).not.toBe("wrap");
  });
});

describe("две кнопки модуля: вместе в строке или одна под другой (ревью #1567, мелочь 3)", () => {
  const setFontScale = (fontScale: number) => Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale }, screen: { width: 390, height: 844, scale: 3, fontScale } });
  const measureActions = (width: number) => fireEvent(screen.getByTestId("english-module-actions"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });
  const REVIEW = "Повторить ошибки";
  const TEST = "Тест по английскому";
  /** «Повторить ошибки» появляется, когда банк ошибок прочитан (отдельное чтение): без неё в строке одна кнопка и колонки нет. */
  async function openWithReview() {
    await open({ learning_review_v1: reviewItems(1, 2) });
    await screen.findByTestId("english-review-open");
  }

  it("правило: самое длинное слово подписи («английскому», 11 букв) должно помещаться в половину строки; ширина строки и масштаб шрифта измерены, не угаданы", () => {
    expect(longestWordLength([REVIEW, TEST])).toBe(11);
    expect(longestWordLength(["Каталарды кайталоо", "Англис тили боюнча тест"])).toBe(9);
    const stacked = (rowWidth: number, fontScale: number, labels: readonly string[] = [REVIEW, TEST]) => actionsStacked({ rowWidth, labels, fontSize: 17, fontScale });
    // Экран 390 pt (строка 358): обычный шрифт в строке, шрифт крупнее 1,5 в колонке.
    expect(stacked(358, 1)).toBe(false);
    expect(stacked(358, 1.5)).toBe(true);
    // Экран 430 pt (строка 398) держит чуть больший шрифт, но не крупнейший.
    expect(stacked(398, 1.2)).toBe(false);
    expect(stacked(398, 2)).toBe(true);
    // Узкий экран 300 pt при обычном шрифте уже в колонке: половина строки уже слова.
    expect(stacked(268, 1)).toBe(true);
    // Строка ещё не измерена или кнопка одна: колонки нет.
    expect(stacked(0, 2)).toBe(false);
    expect(stacked(100, 2, [TEST])).toBe(false);
    // Шрифт мельче обычного ширину слова не уменьшает (запас по обычному размеру), больше двух раз не растёт (предел `Text`).
    expect(stacked(358, 0.8)).toBe(stacked(358, 1));
    expect(stacked(358, 5)).toBe(stacked(358, 2));
    // Кыргызские подписи короче по самому длинному слову.
    expect(stacked(320, 1.2, ["Каталарды кайталоо", "Англис тили боюнча тест"])).toBe(false);
  });

  it("строка 358 pt при обычном шрифте: кнопки в одной строке поровну", async () => {
    await openWithReview();
    await measureActions(358);
    expect(flat(screen.getByTestId("english-module-actions")).flexDirection).toBe("row");
    for (const id of ["english-review-open", "english-test-open"]) expect(flat(screen.getByTestId(id)).flex).toBe(1);
  });

  it("крупный шрифт системы: кнопки одна под другой на всю ширину, а не по половине (длинное слово не ломается посреди)", async () => {
    setFontScale(1.6);
    await openWithReview();
    await measureActions(358);
    expect(flat(screen.getByTestId("english-module-actions")).flexDirection).toBe("column");
    for (const id of ["english-review-open", "english-test-open"]) expect(flat(screen.getByTestId(id)).flex).toBeUndefined();
  });

  it("узкий экран (320 pt, строка 288) при обычном шрифте: одна под другой", async () => {
    await openWithReview();
    await measureActions(288);
    expect(flat(screen.getByTestId("english-module-actions")).flexDirection).toBe("column");
  });

  it("кнопка одна (банк ошибок пуст): строка остаётся строкой при любом шрифте", async () => {
    setFontScale(2);
    await open({});
    await measureActions(288);
    expect(flat(screen.getByTestId("english-module-actions")).flexDirection).toBe("row");
  });
});

describe("плитки уроков (G52)", () => {
  it("по две в ряд: ширина берётся у самого блока (поля экрана не зашиты числом), две плитки и просвет 12 дают ширину блока", async () => {
    await open({});
    const widths = [1, 2, 3, 4].map((n) => flat(screen.getByTestId(`english-tile-en-m1-l0${n}`)).width);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(173);
    expect((widths[0] as number) * 2 + 12).toBe(CONTENT_WIDTH);
    const grid = flat(screen.getByTestId("english-grid"));
    expect(grid).toMatchObject({ flexDirection: "row", flexWrap: "wrap", gap: 12 });
  });

  it("другая ширина блока (другие поля, окно): плитки пересчитываются", async () => {
    await open({}, "ru", 300);
    expect(flat(screen.getByTestId("english-tile-en-m1-l01")).width).toBe(144);
    await layoutGrids(400);
    expect(flat(screen.getByTestId("english-tile-en-m1-l01")).width).toBe(194);
  });

  it("до первого замера плиток нет (ширина неизвестна), после замера они есть", async () => {
    const fake = fakeTransport({ learning_modules_v1: modulesFixture(LESSONS), learning_review_v1: reviewItems(1, 0) });
    await renderPortal(<EnglishScreen />, testApi(fake.transport));
    await screen.findAllByTestId("english-grid");
    expect(screen.queryByTestId("english-tile-en-m1-l01")).toBeNull();
    await layoutGrids();
    expect(screen.getByTestId("english-tile-en-m1-l01")).toBeTruthy();
  });

  it("рамка, фон и тень на одном растянутом по ряду блоке, нажимаемая область заполняет его (раньше у плитки ниже соседа под рамкой оставалась полоса фона)", async () => {
    await open({});
    for (const key of ["en-m1-l01", "en-m1-l04"]) {
      const tile = flat(screen.getByTestId(`english-tile-${key}`));
      expect(tile).toMatchObject({ borderWidth: 1, borderColor: lightTokens.line, backgroundColor: lightTokens.surface });
      expect(tile.boxShadow).toBe(lightTokens.shadowCard);
      // Блок не задаёт высоту сам: ряд растягивает его по самой высокой плитке (alignItems по умолчанию stretch).
      expect(tile.height).toBeUndefined();
      expect(tile.alignSelf).toBeUndefined();
      const press = flat(screen.getByTestId(`english-lesson-${key}`));
      expect(press.flexGrow).toBe(1);
      expect(press.overflow).toBe("hidden");
      // У внутреннего блока ни рамки, ни фона, ни тени: он только заполняет внешний и режет углы фото.
      for (const own of ["borderWidth", "backgroundColor", "boxShadow"]) expect(press[own]).toBeUndefined();
    }
  });

  it("плитка: обложка с номером и английской плашкой, название, число заданий; подпись состояния только у начатого и пройденного", async () => {
    await open({});
    const first = within(screen.getByTestId("english-lesson-en-m1-l01"));
    expect(first.getByText("01", hidden)).toBeTruthy();
    expect(first.getByText(LESSON_COVERS["en-m1-l01"].label, hidden)).toBeTruthy();
    expect(first.getByText("Урок номер 1")).toBeTruthy();
    expect(first.getByText("Заданий: 8")).toBeTruthy();
    expect(first.getByText("Пройден · Верно: 7 из 8")).toBeTruthy();
    expect(within(screen.getByTestId("english-lesson-en-m1-l03")).getByText("В процессе")).toBeTruthy();
    // У нового урока подписи нет вовсе («Не начат» была только в приложении), как на сайте.
    expect(screen.queryByTestId("english-state-en-m1-l04")).toBeNull();
    expect(screen.queryByText("Не начат")).toBeNull();
  });

  it("подпись состояния нейтральная, как `.pt-chip` сайта (цвета у пройденного и начатого нет); число заданий 13, подпись 12", async () => {
    await open({});
    for (const key of ["en-m1-l01", "en-m1-l03"]) {
      const chip = flat(screen.getByTestId(`english-state-${key}`));
      expect(chip).toMatchObject({ backgroundColor: lightTokens.bg, borderColor: lightTokens.line, borderWidth: 1 });
      expect(chip.minHeight).toBe(26);
    }
    const chipText = within(screen.getByTestId("english-state-en-m1-l01")).getByText("Пройден · Верно: 7 из 8");
    expect(flat(chipText)).toMatchObject({ fontSize: lightTokens.sizeTab, color: lightTokens.text2 });
    const count = within(screen.getByTestId("english-lesson-en-m1-l01")).getByText("Заданий: 8");
    expect(flat(count)).toMatchObject({ fontSize: lightTokens.sizeCaption, color: lightTokens.text2 });
    expect(lightTokens.sizeCaption).toBeGreaterThan(lightTokens.sizeTab);
  });

  it("номер на обложке у пройденного урока зелёный, у остальных цвета текста (правило `[data-state=done]` сайта сильнее правила фото)", async () => {
    await open({});
    const colour = (key: string) => flat(within(screen.getByTestId(`lesson-cover-${key}`, hidden)).getByTestId("lesson-number-text", hidden)).color;
    expect(colour("en-m1-l01")).toBe(lightTokens.ok);
    expect(colour("en-m1-l02")).toBe(lightTokens.ok);
    expect(colour("en-m1-l03")).toBe(lightTokens.text);
    expect(colour("en-m1-l04")).toBe(lightTokens.text);
  });

  it("читалка слышит одно имя плитки: номер, название, число заданий и состояние", async () => {
    await open({});
    expect(screen.getByTestId("english-lesson-en-m1-l01").props.accessibilityLabel).toBe("Урок 1. Урок номер 1. Заданий: 8. Пройден · Верно: 7 из 8");
    expect(screen.getByTestId("english-lesson-en-m1-l04").props.accessibilityLabel).toBe("Урок 4. Урок номер 4. Заданий: 8");
    // Обложка декоративная: читалка её не обходит.
    expect(screen.getByTestId("lesson-cover-en-m1-l01", hidden).props.accessibilityElementsHidden).toBe(true);
  });

  it("нажатие открывает урок", async () => {
    await open({});
    await fireEvent.press(screen.getByTestId("english-lesson-en-m1-l02"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/english/lesson/[lessonId]", params: { lessonId: "bbbbbbbb-0000-4000-8000-000000000002" } });
  });

  it("кыргызский: названия уроков и подписи состояний из словаря", async () => {
    await open({}, "ky");
    const first = within(screen.getByTestId("english-lesson-en-m1-l01"));
    expect(first.getByText("1-сабак (ky)")).toBeTruthy();
    expect(first.getByText("Өтүлдү · Туура: 8 ичинен 7")).toBeTruthy();
  });
});

describe("«Повторить ошибки» по банку ошибок (G53)", () => {
  it("банк не пуст: кнопка есть, даже если последняя попытка каждого урока без ошибок (раньше она пряталась)", async () => {
    await open({ learning_modules_v1: modulesFixture([{ n: 1, completed: true, last: { correct: 8, total: 8 } }]), learning_review_v1: reviewItems(1, 2) });
    expect(await screen.findByTestId("english-review-open")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("english-review-open"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/english/review", params: { module: MODULE_ID } });
  });

  it("банк пуст: кнопки нет, даже если в последней попытке были ошибки", async () => {
    await open({ learning_modules_v1: modulesFixture([{ n: 1, completed: true, last: { correct: 3, total: 8 } }]), learning_review_v1: reviewItems(1, 0) });
    await screen.findByTestId("english-test-open");
    expect(screen.queryByTestId("english-review-open")).toBeNull();
  });

  it("чтение банка не удалось: карта уроков остаётся, кнопки повторения нет", async () => {
    await open({ learning_review_v1: failure("42883", 404) });
    expect(screen.getByTestId("english-lesson-en-m1-l01")).toBeTruthy();
    expect(screen.queryByTestId("english-review-open")).toBeNull();
  });

  it("потянуть вниз обновляет и список, и банки ошибок (раньше только список, и кнопка «Повторить ошибки» отставала)", async () => {
    const { calls } = await open({});
    const count = (name: string) => calls.filter((c) => c.name === name).length;
    const before = { modules: count("learning_modules_v1"), review: count("learning_review_v1") };
    await act(async () => {
      screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    await screen.findByTestId("english-grid");
    expect(count("learning_modules_v1")).toBeGreaterThan(before.modules);
    expect(count("learning_review_v1")).toBeGreaterThan(before.review);
  });
});

describe("обложка (G52, G56)", () => {
  it("у урока без фото вместо картинки номер и линейный рисунок, а не пустое место", async () => {
    await open({ learning_modules_v1: modulesFixture([{ n: 1 }, { n: 9, key: "en-m9-l99" }]) });
    const withPhoto = screen.getByTestId("lesson-cover-en-m1-l01", hidden);
    const without = screen.getByTestId("lesson-cover-en-m9-l99", hidden);
    expect(within(withPhoto).queryByTestId("lesson-cover-photo", hidden)).toBeTruthy();
    expect(within(without).queryByTestId("lesson-cover-photo", hidden)).toBeNull();
    expect(within(without).getByText("09", hidden)).toBeTruthy();
    expect(within(without).getByTestId("lesson-art", hidden)).toBeTruthy();
  });

  it("номер урока без фото не растёт с динамическим шрифтом: на сайте он фиксированные 44 px, а рисунок рядом посчитан под обычный размер (ревью #1567, мелочь 1)", async () => {
    await open({ learning_modules_v1: modulesFixture([{ n: 9, key: "en-m9-l99" }]) });
    const numeral = within(screen.getByTestId("lesson-cover-en-m9-l99", hidden)).getByText("09", hidden);
    expect(numeral.props.allowFontScaling).toBe(false);
    expect(numeral.props.maxFontSizeMultiplier).toBe(1);
    expect(flat(numeral).fontSize).toBe(44);
  });

  it("плашка темы жирным начертанием (800 сайта у приложения самое жирное из шрифтов, 700), заглавными", async () => {
    await open({});
    const label = screen.getByText(LESSON_COVERS["en-m1-l01"].label, hidden);
    expect(flat(label).fontFamily).toBe("GolosText-Bold");
    expect(flat(label).textTransform).toBe("uppercase");
  });

  it("рисунок без фото не шире места рядом с цифрой и просветом на экранах 320, 375 и 430 pt (раньше на 35, 24 и 14 pt вылезал за обложку)", () => {
    const tileOf = (screenWidth: number) => Math.floor((screenWidth - 2 * 16 - 12) / 2);
    for (const screenWidth of [320, 375, 390, 430]) {
      const tile = tileOf(screenWidth);
      const art = fallbackArtWidth(tile);
      // Поля обложки 12 + 12, просвет 12, самая широкая цифра номера 56.
      expect(24 + 56 + 12 + art).toBeLessThanOrEqual(tile);
      expect(art).toBeGreaterThanOrEqual(40);
      expect(art).toBeLessThanOrEqual(150);
    }
    expect([320, 375, 430].map((w) => fallbackArtWidth(tileOf(w)))).toEqual([46, 73, 101]);
    expect(fallbackArtWidth(1000)).toBe(150);
    expect(fallbackArtWidth(40)).toBe(0);
  });

  it("высота фото над заголовком урока: 132 pt на телефоне, 180 с ширины больше 520 (как веб)", () => {
    expect(lessonHeroHeight(390)).toBe(132);
    expect(lessonHeroHeight(520)).toBe(132);
    expect(lessonHeroHeight(521)).toBe(180);
  });

  it("у каждого из 12 уроков первого модуля есть свой рисунок (на случай, если фото уберут), совпадающий с картой обложек", () => {
    expect([...LESSON_ART_KEYS].sort()).toEqual(Object.keys(LESSON_COVERS).sort());
  });

  it("каждый рисунок и запасной (раскрытая книга для незнакомого урока) отрисовываются, в светлой и в тёмной теме", async () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const key of [...LESSON_ART_KEYS, "en-m9-l99"]) {
        const view = await render(
          <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
            <ThemeProvider initial={scheme}>
              <LessonArt lessonKey={key} done={key === "en-m1-l03"} width={120} />
            </ThemeProvider>
          </SafeAreaProvider>,
        );
        expect(screen.getByTestId("lesson-art", hidden)).toBeTruthy();
        await view.unmount();
      }
    }
  });

  it("тёмная тема: плашка и номер берут цвета темы (светлый текст на тёмной поверхности), а не светлый текст на полупрозрачном чёрном", async () => {
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ThemeProvider initial="dark">
          <LessonTileCover lessonKey="en-m1-l01" orderIndex={1} done={false} width={173} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    const label = screen.getByText(LESSON_COVERS["en-m1-l01"].label, hidden);
    expect(flat(label).color).toBe(darkTokens.text);
    expect(flat(label).color).not.toBe(darkTokens.onAccent);
    expect(flat(screen.getByText("01", hidden)).color).toBe(darkTokens.text);
    expect(flat(screen.getByTestId("lesson-plaque", hidden)).backgroundColor).toBe(darkTokens.surface);
    expect(flat(screen.getByTestId("lesson-number", hidden)).backgroundColor).toBe(darkTokens.surface);
  });
});
