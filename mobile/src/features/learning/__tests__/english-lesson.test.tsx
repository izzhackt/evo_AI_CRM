// Урок английского как на сайте (G54, G55, G56): фото темы, «Перед началом» с «Начать урок» / «Продолжить», задания только после неё,
// озвучка вердикта, итог со списком заданий и ссылкой на повторение, пройденный урок сразу на итоге. Чтения и записи идут по
// настоящему пути приложения (слой RPC, строгие разборщики) на поддельном транспорте; данные синтетические.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, ScrollView, StyleSheet } from "react-native";

import { EnglishLessonScreen } from "@/features/learning/english/EnglishLessonScreen";
import { ATTEMPT_ID, MODULE_ID, NEW_ATTEMPT_ID, attemptEntry, attemptFixture, exerciseId, lessonId, lessonView, saveResult } from "@/test-fixtures/english";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const START = "start_learning_lesson_v1";
const SAVE = "save_learning_answer_v1";
const COMPLETE = "complete_learning_lesson_v1";
const READ = "learning_lesson_v1";
const SPEC = { n: 1 };
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
const hidden = { includeHiddenElements: true };
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

beforeEach(() => {
  jest.mocked(router.navigate).mockClear();
  scrollTo.mockClear();
});

/** Ответ на запись по номеру задания из его идентификатора; «b» верно. */
const saveHandler = (args: Record<string, unknown> | undefined) => {
  const n = Number(String(args?.p_exercise_id).slice(-12));
  return saveResult(1, n, (args?.p_answer as { selected?: string })?.selected === "b", 2 + n, n);
};
const answers = (...spec: [number, string, boolean][]) => Object.fromEntries(spec.map(([n, selected, correct]) => [exerciseId(1, n), attemptEntry(selected, correct)]));
const completedAttempt = (extra: { correct?: number; wrong?: string[] } = {}) =>
  attemptFixture(1, { id: NEW_ATTEMPT_ID, status: "completed", result: { correct: extra.correct ?? 2, total: 3, wrong: extra.wrong ?? [exerciseId(1, 2)] }, answers: answers([1, "b", true], [2, "a", false], [3, "b", true]) });

type Opts = Parameters<typeof lessonView>[1];
async function open(opts: Opts = {}, handlers: Record<string, unknown> = {}, lang: "ru" | "ky" = "ru") {
  const fake = fakeTransport({ [READ]: lessonView(SPEC, opts), [START]: attemptFixture(1), [SAVE]: saveHandler, ...handlers });
  await renderPortal(<EnglishLessonScreen lessonId={lessonId(1)} />, testApi(fake.transport), lang);
  await screen.findByTestId("english-lesson-title");
  return fake;
}
const choose = (id: string) => fireEvent.press(screen.getByTestId(`opt-${id}`));

describe("«Перед началом» (G54)", () => {
  it("новый урок: фото темы, цель, объяснение с примерами и «Начать урок»; заданий и «К заданиям» нет, попытка не создана", async () => {
    const { calls } = await open();
    expect(await screen.findByTestId("english-goal")).toHaveTextContent("Цель урока 1");
    expect(screen.getByTestId("lesson-hero", hidden)).toBeTruthy();
    expect(within(screen.getByTestId("lesson-hero", hidden)).getByText("Greetings", hidden)).toBeTruthy(); // плашка темы урока 1
    expect(screen.getByTestId("english-goal-heading")).toHaveTextContent("Цель урока");
    expect(screen.getByText("Объяснение")).toBeTruthy();
    expect(screen.getByText("Объяснение правила по-русски.")).toBeTruthy();
    expect(screen.getByText("I go to school.")).toBeTruthy();
    expect(screen.getByText("Я хожу в школу.")).toBeTruthy();
    expect(screen.getByTestId("english-start")).toHaveTextContent("Начать урок");
    expect(screen.queryByText("К заданиям")).toBeNull();
    expect(screen.queryByTestId("english-counter")).toBeNull();
    expect(calls.map((c) => c.name)).toEqual([READ]);
  });

  it("«Начать урок» создаёт черновик сразу и открывает первое задание; после начала цели и объяснения на экране нет", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { calls } = await open();
    await fireEvent.press(await screen.findByTestId("english-start"));
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 1 из 3");
    expect(announce).toHaveBeenCalledWith("Задание 1 из 3");
    announce.mockRestore();
    expect(calls.filter((c) => c.name === START)).toHaveLength(1);
    expect(calls.find((c) => c.name === START)?.args).toMatchObject({ p_lesson_id: lessonId(1) });
    expect(screen.queryByTestId("english-goal")).toBeNull();
    expect(screen.queryByText("Объяснение")).toBeNull();
    expect(screen.getByTestId("opt-a")).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it("обрыв при старте: ошибка и «Повторить»; повтор идёт тем же запросом и открывает задание", async () => {
    let n = 0;
    const { calls } = await open({}, { [START]: () => (++n <= 3 ? failure(null, 0) : attemptFixture(1)) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    expect(await screen.findByTestId("english-run-error")).toHaveTextContent(/Не удалось подтвердить сохранение/);
    expect(screen.queryByTestId("english-counter")).toBeNull();
    await fireEvent.press(screen.getByTestId("english-retry"));
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 1 из 3");
    expect(new Set(calls.filter((c) => c.name === START).map((c) => c.args?.p_request_id)).size).toBe(1);
  });

  it("черновик без ответов: кнопка «Продолжить», новая попытка не создаётся", async () => {
    const { calls } = await open({ draft: attemptFixture(1) });
    expect(await screen.findByTestId("english-start")).toHaveTextContent("Продолжить");
    await fireEvent.press(screen.getByTestId("english-start"));
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 1 из 3");
    expect(calls.some((c) => c.name === START)).toBe(false);
  });

  it("черновик с ответами: сразу задания, на первом неотвеченном", async () => {
    await open({ draft: attemptFixture(1, { answers: answers([1, "b", true], [2, "a", false]) }) });
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 3 из 3");
    expect(screen.queryByTestId("english-start")).toBeNull();
    expect(screen.queryByTestId("english-goal")).toBeNull();
  });

  it("кыргызский: цель, объяснение и кнопка из словаря", async () => {
    await open({}, {}, "ky");
    expect(await screen.findByTestId("english-goal")).toHaveTextContent("1-сабактын максаты");
    expect(screen.getByText("Эреже кыргызча")).toBeTruthy();
    expect(screen.getByText("Мен мектепке барам.")).toBeTruthy();
    expect(screen.getByTestId("english-start")).toHaveTextContent("Сабакты баштоо");
  });
});

describe("задания и вердикт (G54, G56)", () => {
  async function started() {
    const fake = await open();
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("english-counter");
    return fake;
  }

  it("верный ответ: запись с выбором, разбор, читалка слышит «Верно»; «Далее» ведёт к следующему и называет его", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { calls } = await started();
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    expect(screen.getByTestId("verdict")).toHaveTextContent("Верно");
    expect(announce).toHaveBeenCalledWith("Верно");
    expect(calls.find((c) => c.name === SAVE)?.args).toMatchObject({ p_attempt_id: ATTEMPT_ID, p_exercise_id: exerciseId(1, 1), p_answer: { selected: "b" } });
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("english-next"));
    expect(screen.getByTestId("english-counter")).toHaveTextContent("Задание 2 из 3");
    expect(announce).toHaveBeenCalledWith("Задание 2 из 3");
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    announce.mockRestore();
  });

  it("неверный ответ: читалка слышит «Неверно»", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await started();
    await choose("a");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await screen.findByTestId("explain-panel");
    expect(screen.getByTestId("verdict")).toHaveTextContent("Неверно");
    expect(announce).toHaveBeenCalledWith("Неверно");
    announce.mockRestore();
  });

  it("полоса заданий скрыта от читалки (у веба aria-hidden), счётчик остаётся заголовком", async () => {
    await started();
    expect(screen.getByTestId("english-segments", hidden)).toBeTruthy();
    expect(screen.queryByTestId("english-segments")).toBeNull();
    expect(screen.getByTestId("english-counter").props.accessibilityRole).toBe("header");
  });

  it("обрыв при ответе: «Повторить» шлёт тот же запрос, ответ принят", async () => {
    let n = 0;
    const { calls } = await open({}, { [SAVE]: (args: Record<string, unknown> | undefined) => (++n <= 3 ? failure(null, 0) : saveHandler(args)) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("english-retry")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("english-retry"));
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    expect(new Set(calls.filter((c) => c.name === SAVE).map((c) => c.args?.p_request_id)).size).toBe(1);
    expect(screen.queryByTestId("english-run-error")).toBeNull();
  });

  it("конфликт: «Загрузить сохранённую попытку» перечитывает урок", async () => {
    const { calls } = await open({ draft: attemptFixture(1, { answers: answers([1, "b", true]) }) }, { [SAVE]: failure("40001", 409) });
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("english-run-error")).toHaveTextContent(/Попытка изменилась/);
    await fireEvent.press(screen.getByTestId("english-reload"));
    await waitFor(() => expect(calls.filter((c) => c.name === READ)).toHaveLength(2));
  });

  it("ответили на все: «Завершить урок» заголовком и кнопкой, затем итог со счётом", async () => {
    const done = completedAttempt();
    const { calls } = await open({ draft: attemptFixture(1, { answers: answers([1, "b", true], [2, "a", false]) }) }, { [COMPLETE]: done });
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await fireEvent.press(await screen.findByTestId("english-next")); // «К итогу урока»
    expect(await screen.findByTestId("english-finish-heading")).toHaveTextContent("Завершить урок");
    expect(screen.getByText("После завершения ответы этой попытки нельзя изменить.")).toBeTruthy();
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("english-finish"));
    expect(await screen.findByTestId("english-complete")).toHaveTextContent("Урок пройден");
    expect(calls.find((c) => c.name === COMPLETE)?.args).toMatchObject({ p_attempt_id: ATTEMPT_ID });
    expect(screen.getByTestId("english-complete-share")).toHaveTextContent("Верно: 2 из 3");
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it("ответы на сопоставление: кнопки пар не меньше 44 pt (раньше 40)", async () => {
    await open({ matching: true });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("match-0-0");
    expect(flat(screen.getByTestId("match-0-0")).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(screen.getByTestId("match-1-1")).minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe("итог урока (G55)", () => {
  it("пройденный урок открывается сразу на итоге: счёт, «Заданий с ошибками», три кнопки и список всех заданий с разбором", async () => {
    const { calls } = await open({ latestCompleted: completedAttempt() });
    expect(await screen.findByTestId("english-complete")).toHaveTextContent("Урок пройден");
    expect(screen.getByTestId("english-complete-share")).toHaveTextContent("Верно: 2 из 3");
    expect(screen.getByText("Заданий с ошибками: 1. Они добавлены в повторение.")).toBeTruthy();
    expect(screen.getByTestId("english-review-open")).toHaveTextContent("Повторить ошибки");
    expect(screen.getByTestId("english-repeat")).toHaveTextContent("Пройти ещё раз");
    expect(screen.getByTestId("english-back-module")).toHaveTextContent("Все уроки");
    // Ни цели, ни объяснения, ни кнопки «Пройти ещё раз» в роли первого экрана: сразу итог.
    expect(screen.queryByTestId("english-goal")).toBeNull();
    expect(screen.queryByTestId("english-start")).toBeNull();
    expect(calls.some((c) => c.name === START)).toBe(false);
    // Список: каждое задание со счётчиком, формулировкой и разбором.
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`completion-counter-${n}`)).toHaveTextContent(`Задание ${n} из 3`);
    expect(screen.getAllByTestId("explain-panel")).toHaveLength(3);
    expect(screen.getByText("Pick the right word 2.")).toBeTruthy();
    expect(screen.getAllByTestId("verdict").map((node) => node.props.children ?? "")).toHaveLength(3);
  });

  it("счёт берётся из итога сервера (`result`), а не пересчитывается по ответам на экране", async () => {
    // Ответы показывают две верных, итог сервера говорит об одной: на экране то, что записал сервер.
    const attempt = attemptFixture(1, { id: NEW_ATTEMPT_ID, status: "completed", result: { correct: 1, total: 3, wrong: [exerciseId(1, 2), exerciseId(1, 3)] }, answers: answers([1, "b", true], [2, "b", true], [3, "a", false]) });
    await open({ latestCompleted: attempt });
    expect(await screen.findByTestId("english-complete-share")).toHaveTextContent("Верно: 1 из 3");
    expect(screen.getByText("Заданий с ошибками: 2. Они добавлены в повторение.")).toBeTruthy();
  });

  it("без ошибок: «Все задания решены верно», кнопки «Повторить ошибки» нет", async () => {
    await open({ latestCompleted: completedAttempt({ correct: 3, wrong: [] }) });
    expect(await screen.findByText("Все задания решены верно.")).toBeTruthy();
    expect(screen.getByTestId("english-complete-share")).toHaveTextContent("Верно: 3 из 3");
    expect(screen.queryByTestId("english-review-open")).toBeNull();
  });

  it("«Повторить ошибки» ведёт на повторение этого модуля, «Все уроки» на список", async () => {
    await open({ latestCompleted: completedAttempt() });
    await fireEvent.press(await screen.findByTestId("english-review-open"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/english/review", params: { module: MODULE_ID } });
    await fireEvent.press(screen.getByTestId("english-back-module"));
    expect(router.navigate).toHaveBeenCalledWith("/english");
  });

  it("«Пройти ещё раз»: сразу новая попытка и первое задание, а не повторный показ прежнего итога", async () => {
    const { calls } = await open({ latestCompleted: completedAttempt() }, { [START]: attemptFixture(1, { id: NEW_ATTEMPT_ID }) });
    await fireEvent.press(await screen.findByTestId("english-repeat"));
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 1 из 3");
    expect(calls.filter((c) => c.name === START)).toHaveLength(1);
    expect(screen.queryByTestId("english-complete")).toBeNull();
    expect(screen.queryByTestId("explain-panel")).toBeNull();
  });
});
