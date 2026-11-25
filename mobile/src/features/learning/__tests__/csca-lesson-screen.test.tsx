// Урок и практика CSCA как на сайте (math/lesson/[lessonId]/page.tsx, ItemRunner.tsx, ItemCard.tsx, StepReveal.tsx,
// TheoryBlocks.tsx): шапка с целью, теория листом, разбор примера по шагам без подсказки ответа, состояния ответа, итог со
// ссылками, слова без «вкладки» и «страницы», вердикт озвучен читалке. Экран идёт по настоящему пути приложения (RPC-слой,
// разборщики сайта) на поддельном транспорте; данные синтетические.
import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo } from "react-native";

import { speakMathText } from "@/features/learning/math/speak";
import { LessonScreen } from "@/features/learning/csca/LessonScreen";
import type { RpcTransport } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const LESSON = "csca_lesson_m2-exp-log-l1";

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.mocked(router.replace).mockClear();
  jest.mocked(router.dismissTo).mockClear();
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(() => announce.mockRestore());

/** Ответы сервера на ход урока: старт, ответы по порядку (сохранённые настоящие квитанции), завершение. */
const run = (change: (receipt: Record<string, any>, call: number) => Record<string, any> = (receipt) => receipt) => ({
  start_learning_lesson_v1: fx("csca_lesson_start"),
  save_learning_answer_v1: (_args: unknown, call: number) => change(fx(`csca_lesson_save_${call}`), call),
  complete_learning_lesson_v1: fx("csca_lesson_complete"),
});

async function open(lesson: Record<string, any> = fx(LESSON), handlers: Record<string, unknown> = run(), wrap?: (transport: RpcTransport) => RpcTransport) {
  const { transport, calls } = fakeTransport({ learning_lesson_v2: lesson, learning_track_home_v1: fx("csca_home_after"), ...handlers });
  await renderPortal(<LessonScreen lessonId={lesson.lesson.lessonId} />, testApi(wrap ? wrap(transport) : transport));
  return { calls };
}

async function answer(option: "a" | "b" | "c" | "d") {
  await fireEvent.press(screen.getByTestId(`option-${option}`));
  await fireEvent.press(screen.getByTestId("lesson-check"));
  await screen.findByTestId("verdict");
}

describe("шапка урока", () => {
  it("название, английское название, цель с формулами и строка «Урок · минуты · пункт программы»", async () => {
    const lesson = fx(LESSON);
    await open(lesson);
    expect(await screen.findByTestId("lesson-title")).toHaveTextContent(lesson.lesson.metadata.title_ru);
    expect(screen.getByTestId("lesson-title-en")).toHaveTextContent("Exponential and logarithmic functions");
    expect(screen.getByTestId("lesson-title-en").props.accessibilityLanguage).toBe("en");
    expect(screen.getByTestId("lesson-meta")).toHaveTextContent(`Урок · 15 мин · пункт программы ${lesson.lesson.metadata.syllabus_point}`);
    const goal = screen.getByTestId("lesson-goal");
    // Цель с формулами читается словами, а не сырым TeX, и языком устройства: текст русский.
    expect(goal.props.accessibilityLabel).toBe(speakMathText(lesson.lesson.metadata.goal_ru));
    expect(goal.props.accessibilityLabel).not.toMatch(/[$\\]/u);
    expect(goal.props.accessibilityLanguage).toBeUndefined();
  });

  it("оглавления «В уроке» на телефоне нет, как и на вебе под 1100 px", async () => {
    await open();
    await screen.findByTestId("lesson-title");
    expect(screen.queryByText("В уроке")).toBeNull();
  });

  it("на кыргызском: название и цель на кыргызском", async () => {
    const lesson = fx(LESSON);
    const { transport } = fakeTransport({ learning_lesson_v2: lesson, learning_track_home_v1: fx("csca_home_after") });
    await renderPortal(<LessonScreen lessonId={lesson.lesson.lessonId} />, testApi(transport), "ky");
    expect(await screen.findByTestId("lesson-title")).toHaveTextContent(lesson.lesson.metadata.title_ky);
  });

  it("практика: без теории, заголовок «Практика» и своя вводная", async () => {
    await open(fx("csca_lesson_m2-exp-log-p1"));
    expect(await screen.findByTestId("lesson-check-heading")).toHaveTextContent("Практика");
    expect(screen.queryByTestId("theory-blocks")).toBeNull();
    expect(screen.getByText("Ответ проверяется сразу, ошибки уходят в «Ошибки».")).toBeTruthy();
    expect(screen.getByTestId("lesson-meta")).toHaveTextContent(/^Практика · 5 мин/);
  });

  it("сбой чтения: плашка с повтором", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<LessonScreen lessonId="7b0e4dda-0000-4000-8000-000000000001" />, testApi(transport));
    expect(await screen.findByTestId("lesson-load-error")).toBeTruthy();
  });
});

describe("теория листом", () => {
  it("все виды блоков урока на месте, рисунок с подписью рядом с идеей", async () => {
    await open();
    await screen.findByTestId("theory-blocks");
    for (const id of ["theory-idea-0", "theory-formula-1", "theory-figure-2", "theory-table-3", "theory-example-6", "theory-pitfalls-8", "theory-tip-9", "theory-terms-10"]) expect(screen.getByTestId(id)).toBeTruthy();
  });

  it("рисунка нет в выдаче (сбой контента): блок пропускается, а не рисуется пустая подпись", async () => {
    const lesson = fx(LESSON);
    lesson.figures = {};
    await open(lesson);
    await screen.findByTestId("theory-blocks");
    expect(screen.queryByTestId("theory-figure-2")).toBeNull();
    expect(screen.getByTestId("theory-table-3")).toBeTruthy();
  });

  it("разбор примера: сначала ни шага, ни ответа; «Следующий шаг» открывает по одному, ответ после последнего", async () => {
    const lesson = fx(LESSON);
    const example = lesson.lesson.theory[6];
    const steps = example.steps.length;
    await open(lesson);
    await screen.findByTestId("theory-example-6");
    const stepsId = "theory-example-6-steps";
    expect(screen.queryByTestId(`${stepsId}-step-1`)).toBeNull();
    expect(screen.queryByTestId(`${stepsId}-answer`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${stepsId}-next`));
    expect(screen.getByTestId(`${stepsId}-step-1`)).toBeTruthy();
    expect(screen.queryByTestId(`${stepsId}-step-2`)).toBeNull();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Шаг 1\. /u));
    for (let i = 1; i < steps; i += 1) {
      expect(screen.queryByTestId(`${stepsId}-answer`)).toBeNull();
      await fireEvent.press(screen.getByTestId(`${stepsId}-next`));
    }
    expect(screen.getByTestId(`${stepsId}-step-${steps}`)).toBeTruthy();
    expect(screen.getByTestId(`${stepsId}-answer`)).toBeTruthy();
    // Кнопок больше нет: всё открыто.
    expect(screen.queryByTestId(`${stepsId}-next`)).toBeNull();
    expect(screen.queryByTestId(`${stepsId}-all`)).toBeNull();
  });

  it("«Показать решение» открывает все шаги и ответ сразу", async () => {
    const lesson = fx(LESSON);
    const steps = lesson.lesson.theory[7].steps.length;
    await open(lesson);
    await screen.findByTestId("theory-example-7");
    await fireEvent.press(screen.getByTestId("theory-example-7-steps-all"));
    expect(screen.getByTestId(`theory-example-7-steps-step-${steps}`)).toBeTruthy();
    expect(screen.getByTestId("theory-example-7-steps-answer")).toBeTruthy();
  });

  it("термины блока: английский жирно с английским голосом, перевод рядом", async () => {
    await open();
    const terms = within(await screen.findByTestId("theory-terms-10"));
    const first = fx(LESSON).lesson.theory[10].terms[0];
    expect(terms.getByText(first.en).props.accessibilityLanguage).toBe("en");
    expect(terms.getByText(first.ru)).toBeTruthy();
  });
});

describe("задание: ответ и разбор", () => {
  it("до ответа: четыре варианта словами для читалки, выбранный отмечен, вердикта нет", async () => {
    await open();
    const option = await screen.findByTestId("option-a");
    const exercise = fx(LESSON).lesson.exercises[0];
    expect(option.props.accessibilityRole).toBe("radio");
    expect(option.props.accessibilityLabel).toBe(`A. ${speakMathText(exercise.options[0].label)}`);
    expect(option.props.accessibilityLabel).not.toMatch(/[$\\]/u);
    expect(option.props.accessibilityLanguage).toBe("en");
    await fireEvent.press(option);
    expect(screen.getByTestId("option-a").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("item-difficulty").props.accessibilityLabel).toBe(`Сложность ${exercise.difficulty} из 3`);
  });

  it("неверный ответ: «Неверно · Верный ответ: B», значки и слова у вариантов, вердикт озвучен", async () => {
    await open();
    await screen.findByTestId("option-a");
    await answer("a");
    expect(screen.getByTestId("verdict")).toHaveTextContent("Неверно · Верный ответ: B", { exact: false });
    expect(announce).toHaveBeenCalledWith("Неверно");
    expect(screen.getByTestId("option-a-tags")).toHaveTextContent("Ваш ответ");
    expect(screen.getByTestId("option-b-tags")).toHaveTextContent("Верный ответ");
    expect(screen.queryByTestId("option-c-tags")).toBeNull();
    // Вариант после ответа не нажимается и всё ещё читается как «A. слова».
    expect(screen.getByTestId("option-a").props.accessibilityRole).not.toBe("radio");
    // Разбор каждого варианта виден.
    const explain = fx("csca_lesson_save_1").explain.options.find((o: { id: string }) => o.id === "b").explainRu;
    expect(within(screen.getByTestId("option-b")).getByText(explain.replace(/\$[^$]*\$/gu, "").slice(0, 12), { exact: false })).toBeTruthy();
  });

  it("верный ответ: «Верно» без строки «Верный ответ: X», у выбранного обе подписи", async () => {
    await open(fx(LESSON), run((receipt) => ({ ...receipt, correct: true })));
    await screen.findByTestId("option-a");
    await answer("b");
    expect(screen.getByTestId("verdict")).toHaveTextContent(/^Верно$/u);
    expect(screen.queryByText(/Верный ответ: /)).toBeNull();
    expect(screen.getByTestId("option-b-tags")).toHaveTextContent("Ваш ответ · Верный ответ");
    expect(announce).toHaveBeenCalledWith("Верно");
  });

  it("решение: сначала только кнопки, шаги по одному; термины пилюлями без заголовка", async () => {
    await open();
    await screen.findByTestId("option-a");
    await answer("a");
    expect(screen.getByTestId("solution-block")).toBeTruthy();
    expect(screen.queryByTestId("solution-step-1")).toBeNull();
    await fireEvent.press(screen.getByTestId("solution-next"));
    expect(screen.getByTestId("solution-step-1")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("solution-all"));
    expect(screen.getByTestId("solution-step-3")).toBeTruthy();
    expect(screen.queryByTestId("solution-next")).toBeNull();
    // Термины разбора пилюлями, без собственного заголовка (в теории у блока «Термины» заголовок есть).
    expect(within(screen.getByTestId("item-terms")).queryByText("Термины")).toBeNull();
    expect(screen.getByTestId("item-terms").props.accessibilityLabel).toBe("Термины");
  });

  it("полоса заданий: подписи со словом результата, зона нажатия 44 pt, к ответу можно вернуться", async () => {
    await open();
    await screen.findByTestId("option-a");
    const bar = () => within(screen.getByTestId("lesson-progress"));
    expect(bar().getByLabelText("Задание 1 из 4")).toBeTruthy();
    await answer("a");
    const first = bar().getByLabelText("Задание 1 из 4, Неверно");
    expect(first.props.style).toMatchObject({ minHeight: 44 });
    await fireEvent.press(screen.getByTestId("lesson-next"));
    expect(await screen.findByText("Задание 2 из 4")).toBeTruthy();
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(bar().getByLabelText("Задание 2 из 4").props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(bar().getByLabelText("Задание 1 из 4, Неверно"));
    expect(screen.getByTestId("verdict")).toBeTruthy();
  });

  it("слова ошибок без «вкладки» и «страницы»", async () => {
    const fail = (code: string, message?: string): ((transport: RpcTransport) => RpcTransport) => (base) => async (name, args, options) =>
      name === "save_learning_answer_v1" ? { data: null, error: { code, message }, status: 400 } : base(name, args, options);
    await open(fx(LESSON), run(), fail("40001", "Learning attempt changed"));
    await screen.findByTestId("option-a");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    const conflict = await screen.findByTestId("lesson-error");
    expect(conflict).toHaveTextContent("Попытка изменилась на другом устройстве. Загрузите сохранённую.");
    expect(conflict).not.toHaveTextContent(/вкладк|страниц/u);
  });

  it("повторный ответ и отклонённый ответ тоже без слов веба", async () => {
    const fail = (code: string, message: string): ((transport: RpcTransport) => RpcTransport) => (base) => async (name, args, options) =>
      name === "save_learning_answer_v1" ? { data: null, error: { code, message }, status: 400 } : base(name, args, options);
    await open(fx(LESSON), run(), fail("22023", "Learning exercise is already answered"));
    await screen.findByTestId("option-a");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(await screen.findByTestId("lesson-error")).toHaveTextContent("Это задание уже отвечено на другом устройстве.");
  });

  it("ответ не принят: «Откройте задание заново»", async () => {
    const fail = (base: RpcTransport): RpcTransport => async (name, args, options) =>
      name === "save_learning_answer_v1" ? { data: null, error: { code: "22023", message: "Invalid item answer" }, status: 400 } : base(name, args, options);
    await open(fx(LESSON), run(), fail);
    await screen.findByTestId("option-a");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    const alert = await screen.findByTestId("lesson-error");
    expect(alert).toHaveTextContent("Ответ не принят. Откройте задание заново.");
    expect(alert).not.toHaveTextContent(/страниц/u);
  });
});

describe("итог урока", () => {
  async function finishAll() {
    await open();
    await screen.findByTestId("option-a");
    for (let i = 0; i < 4; i += 1) {
      await answer("a");
      await fireEvent.press(screen.getByTestId("lesson-next"));
    }
    await screen.findByTestId("lesson-summary");
  }

  it("после последнего ответа: «Верно N из M», практика той же темы первой кнопкой, затем «К темам» и «Пройти ещё раз»", async () => {
    await finishAll();
    expect(screen.getByTestId("lesson-summary")).toHaveTextContent("Верно 0 из 4");
    const sibling = screen.getByTestId("lesson-to-sibling");
    expect(sibling).toHaveTextContent("К практике по теме");
    await fireEvent.press(sibling);
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: "22f0395c-b56d-5da0-8667-adec8f92a4e2" } });
    await fireEvent.press(screen.getByTestId("lesson-to-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
    expect(screen.getByTestId("lesson-repeat")).toHaveTextContent("Пройти ещё раз");
  });

  it("нет соседа в теме: «К темам» главная кнопка", async () => {
    const home = fx("csca_home_after");
    home.lessons = home.lessons.filter((lesson: { lessonKey: string }) => lesson.lessonKey !== "csca-math-m2-exp-log-p1");
    const lesson = fx(LESSON);
    const { transport } = fakeTransport({ learning_lesson_v2: lesson, learning_track_home_v1: home, ...run() });
    await renderPortal(<LessonScreen lessonId={lesson.lesson.lessonId} />, testApi(transport));
    await screen.findByTestId("option-a");
    for (let i = 0; i < 4; i += 1) {
      await answer("a");
      await fireEvent.press(screen.getByTestId("lesson-next"));
    }
    await screen.findByTestId("lesson-summary");
    expect(screen.queryByTestId("lesson-to-sibling")).toBeNull();
    expect(screen.getByTestId("lesson-to-topics")).toBeTruthy();
  });
});

describe("«Сообщить об ошибке»", () => {
  it("счётчик n/500 растёт с текстом, после отправки «Отмена» становится «Закрыть»", async () => {
    await open(fx(LESSON), { ...run(), report_learning_item_v1: fx("csca_report") });
    await screen.findByTestId("report-open");
    await fireEvent.press(screen.getByTestId("report-open"));
    expect(screen.getByText("До 500 знаков. 0/500")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("report-input"), "  В условии опечатка  ");
    expect(screen.getByText("До 500 знаков. 18/500")).toBeTruthy();
    expect(screen.getByTestId("report-cancel")).toHaveTextContent("Отмена");
    await fireEvent.press(screen.getByTestId("report-send"));
    await waitFor(() => expect(screen.getByTestId("report-status")).toHaveTextContent("Спасибо, сообщение отправлено."));
    expect(screen.getByTestId("report-cancel")).toHaveTextContent("Закрыть");
  });
});
