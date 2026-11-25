// «Английский» как на сайте (G52, G53, G56): плитки по две в ряд с обложкой, номером и английской плашкой, блок модуля без описаний,
// «Повторить ошибки» по банку ошибок, все модули, запасная обложка без фото, цвета обложки в тёмной теме. Чтения идут по настоящему
// пути приложения на поддельном транспорте; данные синтетические.
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Dimensions, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { EnglishScreen } from "@/features/learning/english/EnglishScreen";
import { LessonTileCover } from "@/features/learning/english/LessonCover";
import { LESSON_ART_KEYS, LessonArt } from "@/features/learning/english/LessonArt";
import { LESSON_COVERS } from "@/features/learning/english/covers";
import { darkTokens } from "@/theme/tokens.generated";
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

async function open(handlers: Record<string, unknown>, lang: "ru" | "ky" = "ru") {
  const fake = fakeTransport({ learning_modules_v1: modulesFixture(LESSONS), learning_review_v1: reviewItems(1, 0), ...handlers });
  await renderPortal(<EnglishScreen />, testApi(fake.transport), lang);
  await screen.findByTestId("english-lesson-en-m1-l01");
  return fake;
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

  it("модулей нет: «Уроки готовятся»", async () => {
    const fake = fakeTransport({ learning_modules_v1: { modules: [] } });
    await renderPortal(<EnglishScreen />, testApi(fake.transport));
    expect(await screen.findByText("Уроки готовятся")).toBeTruthy();
  });
});

describe("плитки уроков (G52)", () => {
  it("по две в ряд: у всех плиток одна ширина, вдвое меньше строки за вычетом полей и просвета", async () => {
    await open({});
    const widths = [1, 2, 3, 4].map((n) => flat(screen.getByTestId(`english-tile-en-m1-l0${n}`)).width);
    expect(new Set(widths).size).toBe(1);
    expect((widths[0] as number) * 2 + 12 + 32).toBeLessThanOrEqual(390);
    expect((widths[0] as number) * 2 + 12 + 32).toBeGreaterThanOrEqual(389);
  });

  it("плитка: обложка с номером и английской плашкой, название, число заданий; состояние только у начатого и пройденного", async () => {
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
});

describe("обложка (G52, G56)", () => {
  it("у урока без фото вместо картинки номер и линейный рисунок, а не пустое место", async () => {
    await open({ learning_modules_v1: modulesFixture([{ n: 1 }, { n: 9, key: "en-m9-l99" }]) });
    const withPhoto = screen.getByTestId("lesson-cover-en-m1-l01", hidden);
    const without = screen.getByTestId("lesson-cover-en-m9-l99", hidden);
    expect(within(withPhoto).queryByTestId("lesson-cover-photo", hidden)).toBeTruthy();
    expect(within(without).queryByTestId("lesson-cover-photo", hidden)).toBeNull();
    expect(within(without).getByText("09", hidden)).toBeTruthy();
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
