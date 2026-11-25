// Урок английского как на сайте (G54, G55, G56 и ревью #1567): ссылка, фото темы, заголовок, «Перед началом» с «Начать урок» /
// «Продолжить», задания только после неё, вместо формы после ответа формулировка и разбор, озвучка вердикта, итог со списком заданий
// и ссылкой на повторение, пройденный урок сразу на итоге. Чтения и записи идут по настоящему пути приложения (слой RPC, строгие
// разборщики) на поддельном транспорте; данные синтетические.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, Dimensions, ScrollView, StyleSheet } from "react-native";

import { EnglishLessonScreen } from "@/features/learning/english/EnglishLessonScreen";
import { CHAT_FAB_CLEARANCE, TAB_BAR_CLEARANCE } from "@/shell/useTabBarClearance";
import { lightTokens } from "@/theme/tokens.generated";
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

const setWindow = (width: number) => Dimensions.set({ window: { width, height: 844, scale: 3, fontScale: 1 }, screen: { width, height: 844, scale: 3, fontScale: 1 } });

beforeEach(() => {
  jest.mocked(router.navigate).mockClear();
  scrollTo.mockClear();
  setWindow(390);
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
async function open(opts: Opts = {}, handlers: Record<string, unknown> = {}, lang: "ru" | "ky" = "ru", spec: Parameters<typeof lessonView>[0] = SPEC) {
  const fake = fakeTransport({ [READ]: lessonView(spec, opts), [START]: attemptFixture(1), [SAVE]: saveHandler, ...handlers });
  const view = await renderPortal(<EnglishLessonScreen lessonId={lessonId(1)} />, testApi(fake.transport), lang);
  await screen.findByTestId("english-lesson-title");
  return { ...fake, ...view };
}
const choose = (id: string) => fireEvent.press(screen.getByTestId(`opt-${id}`));

type Json = { type: string; props?: { testID?: string }; children?: (Json | string)[] | null } | (Json | string)[] | null;
/** testID всех элементов экрана в порядке обхода сверху вниз (по нему проверяется порядок блоков). */
function idsInOrder(node: Json, out: string[] = []): string[] {
  if (node === null || typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const child of node) idsInOrder(child as Json, out);
    return out;
  }
  if (node.props?.testID) out.push(node.props.testID);
  for (const child of node.children ?? []) idsInOrder(child as Json, out);
  return out;
}

describe("«Перед началом» (G54)", () => {
  it("новый урок: ссылка «Все уроки», фото темы, заголовок «Урок N. Название», цель, объяснение с примерами и «Начать урок»; заданий нет, попытка не создана", async () => {
    const { calls } = await open();
    expect(await screen.findByTestId("english-goal")).toHaveTextContent("Цель урока 1");
    expect(screen.getByTestId("english-lesson-title")).toHaveTextContent("Урок 1. Урок номер 1");
    // Шапка называет раздел, а стрелка «Все уроки» - возврат (на сайте это ссылка над фото).
    expect(screen.getByTestId("english-lesson-header")).toHaveTextContent("Английский");
    expect(screen.getByLabelText("Все уроки")).toBeTruthy();
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

  it("порядок как на сайте: фото над заголовком, заголовок над целью (раньше заголовок был в шапке, над фото)", async () => {
    await open();
    await screen.findByTestId("english-goal");
    const order = idsInOrder(screen.toJSON() as Json);
    const at = (id: string) => order.indexOf(id);
    expect(at("english-lesson-header")).toBeGreaterThanOrEqual(0);
    expect(at("english-lesson-header")).toBeLessThan(at("lesson-hero"));
    expect(at("lesson-hero")).toBeLessThan(at("english-lesson-title"));
    expect(at("english-lesson-title")).toBeLessThan(at("english-goal-heading"));
  });

  it("фото темы: 132 pt на телефоне, 180 на широком экране (как `.pt-lesson-hero`)", async () => {
    await open();
    expect(flat(screen.getByTestId("lesson-hero", hidden)).height).toBe(132);
  });

  it("широкий экран (планшет): фото 180 pt", async () => {
    setWindow(700);
    await open();
    expect(flat(screen.getByTestId("lesson-hero", hidden)).height).toBe(180);
  });

  it("у урока без объяснения заголовок «Объяснение» всё равно есть, как на сайте", async () => {
    await open({ theory: false });
    expect(await screen.findByTestId("english-theory-heading")).toHaveTextContent("Объяснение");
    expect(screen.queryByText("I go to school.")).toBeNull();
    expect(screen.getByTestId("english-start")).toBeTruthy();
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

  it("пока идёт старт: кнопка называется «Сохраняем…» для читалки (общая кнопка прячет подпись при busy), состояние называется вслух", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open({}, { [START]: async () => (await gate, attemptFixture(1)) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await waitFor(() => expect(screen.getByTestId("english-start").props.accessibilityLabel).toBe("Сохраняем…"));
    expect(screen.getByTestId("english-start").props.accessibilityState).toMatchObject({ busy: true });
    expect(announce).toHaveBeenCalledWith("Сохраняем…");
    release();
    expect(await screen.findByTestId("english-counter")).toBeTruthy();
    announce.mockRestore();
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

  it("старт вернул черновик, начатый на другом устройстве: открывается на первом неотвеченном задании с его ответами", async () => {
    await open({}, { [START]: attemptFixture(1, { revision: 4, answers: answers([1, "b", true]) }) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    expect(await screen.findByTestId("english-counter")).toHaveTextContent("Задание 2 из 3");
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

  it("кыргызский: цель, объяснение, заголовок и кнопка из словаря", async () => {
    await open({}, {}, "ky");
    expect(await screen.findByTestId("english-goal")).toHaveTextContent("1-сабактын максаты");
    expect(screen.getByTestId("english-lesson-title")).toHaveTextContent("1-сабак. 1-сабак (ky)");
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

  it("после ответа вместо формы формулировка и разбор (как на сайте): вариантов ответа на экране больше нет", async () => {
    await started();
    expect(screen.getByTestId("opt-a")).toBeTruthy();
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    expect(screen.queryByTestId("opt-a")).toBeNull();
    expect(screen.queryByTestId("opt-b")).toBeNull();
    expect(screen.getByTestId("english-answered-prompt")).toHaveTextContent("Pick the right word 1.");
    expect(screen.queryByTestId("english-answer")).toBeNull();
    expect(screen.getByTestId("english-next")).toBeTruthy();
  });

  it("разбор без живой области: вердикт называет `announce` (на TalkBack иначе он прозвучал бы дважды и вместе со всем разбором)", async () => {
    await started();
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect((await screen.findByTestId("explain-panel")).props.accessibilityLiveRegion).toBeUndefined();
  });

  it("счётчик, под ним полоса (на сайте так), текущий отрезок цвета текста, верные зелёные, ошибки красные; полоса скрыта от читалки", async () => {
    await started();
    const order = idsInOrder(screen.toJSON() as Json);
    expect(order.indexOf("english-counter")).toBeGreaterThanOrEqual(0);
    // Полоса скрыта от читалки, поэтому в дереве доступности её отрезков нет, а проверка вида идёт с `includeHiddenElements`.
    expect(screen.queryByTestId("english-segments")).toBeNull();
    const bar = (i: number) => flat(screen.getByTestId(`english-segments-${i}`, hidden)).backgroundColor;
    expect([bar(0), bar(1), bar(2)]).toEqual([lightTokens.text, lightTokens.line, lightTokens.line]);
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await screen.findByTestId("explain-panel");
    expect(bar(0)).toBe(lightTokens.ok);
    await fireEvent.press(screen.getByTestId("english-next"));
    await choose("a");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await screen.findByTestId("explain-panel");
    expect([bar(0), bar(1), bar(2)]).toEqual([lightTokens.ok, lightTokens.error, lightTokens.line]);
    expect(screen.getByTestId("english-counter").props.accessibilityRole).toBe("header");
    // Порядок в дереве доступности: у отрезков нет (они скрыты), но у счётчика над ними сайтовый порядок «сначала число».
    const full = idsInOrder(screen.toJSON() as Json);
    expect(full.indexOf("english-counter")).toBeLessThan(full.indexOf("english-segments"));
  });

  it("пока идёт запись ответа: кнопка называется «Сохраняем…» для читалки, состояние называется вслух", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open({}, { [SAVE]: async (args: Record<string, unknown> | undefined) => (await gate, saveHandler(args)) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await waitFor(() => expect(screen.getByTestId("english-answer").props.accessibilityLabel).toBe("Сохраняем…"));
    expect(announce).toHaveBeenCalledWith("Сохраняем…");
    release();
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    announce.mockRestore();
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

  it("четыре кода сайта: доступ закрыт и «не принято» читаются своими словами, без кнопок повтора и перечитывания", async () => {
    await open({ draft: attemptFixture(1, { answers: answers([1, "b", true]) }) }, { [SAVE]: failure("42501", 403) });
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("english-run-error")).toHaveTextContent("Урок недоступен. Войдите в кабинет заново.");
    expect(screen.queryByTestId("english-retry")).toBeNull();
    expect(screen.queryByTestId("english-reload")).toBeNull();
  });

  it("конфликт: «Загрузить сохранённую попытку» перечитывает урок и сбрасывает выбор на экране (как `reloadDraft` сайта)", async () => {
    const { calls } = await open({ draft: attemptFixture(1, { answers: answers([1, "b", true]) }) }, { [SAVE]: failure("40001", 409) });
    await screen.findByTestId("english-counter");
    await choose("b");
    expect(screen.getByTestId("opt-b").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("english-answer"));
    expect(await screen.findByTestId("english-run-error")).toHaveTextContent(/Попытка изменилась/);
    await fireEvent.press(screen.getByTestId("english-reload"));
    await waitFor(() => expect(calls.filter((c) => c.name === READ)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("english-run-error")).toBeNull());
    expect(screen.getByTestId("opt-b").props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId("english-answer").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("ответили на все: «Завершить урок» заголовком и кнопкой, затем итог со счётом, обновление списка и прокрутка наверх", async () => {
    const done = completedAttempt();
    const { calls, client } = await open({ draft: attemptFixture(1, { answers: answers([1, "b", true], [2, "a", false]) }) }, { [COMPLETE]: done });
    const invalidate = jest.spyOn(client, "invalidateQueries");
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
    const keys = invalidate.mock.calls.map(([filter]) => (filter as { queryKey: unknown[] }).queryKey.slice(-1)[0]);
    expect(keys).toEqual(expect.arrayContaining(["english-modules", "english-review"]));
  });

  it("«Завершить» не удалось: список не обновляется и страница не прокручивается (раньше то и другое шло и после отказа); повтор успешен", async () => {
    let n = 0;
    const { client } = await open(
      { draft: attemptFixture(1, { answers: answers([1, "b", true], [2, "a", false], [3, "b", true]) }) },
      { [COMPLETE]: () => (++n <= 3 ? failure(null, 0) : completedAttempt()) },
    );
    const invalidate = jest.spyOn(client, "invalidateQueries");
    await fireEvent.press(await screen.findByTestId("english-finish"));
    expect(await screen.findByTestId("english-run-error")).toHaveTextContent(/Не удалось подтвердить сохранение/);
    expect(screen.queryByTestId("english-complete")).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("english-retry"));
    expect(await screen.findByTestId("english-complete")).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it("ответы на сопоставление: кнопки пар не меньше 44 pt и по высоте, и по ширине (короткая подпись не даёт узкой кнопки)", async () => {
    await open({ matching: true });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("match-0-0");
    for (const id of ["match-0-0", "match-1-1"]) {
      expect(flat(screen.getByTestId(id)).minHeight).toBeGreaterThanOrEqual(44);
      expect(flat(screen.getByTestId(id)).minWidth).toBeGreaterThanOrEqual(44);
    }
  });

  it("закрытие экрана после обрыва ответа досылает тот же запрос один раз (замена запирающей защиты ухода)", async () => {
    let n = 0;
    const { calls, unmount } = await open({}, { [SAVE]: (args: Record<string, unknown> | undefined) => (++n <= 3 ? failure(null, 0) : saveHandler(args)) });
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("english-counter");
    await choose("b");
    await fireEvent.press(screen.getByTestId("english-answer"));
    await screen.findByTestId("english-retry");
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(3);
    await unmount();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(4);
    expect(new Set(calls.filter((c) => c.name === SAVE).map((c) => c.args?.p_request_id)).size).toBe(1);
  });

  it("закрытие экрана, когда ответ только выбран и не отправлен: ничего не шлётся (ответ финален и уходит кнопкой)", async () => {
    const { calls, unmount } = await open();
    await fireEvent.press(await screen.findByTestId("english-start"));
    await screen.findByTestId("english-counter");
    await choose("b");
    await unmount();
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(0);
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

describe("нижний запас страницы урока", () => {
  it("как у `Screen`: безопасная зона плюс плавающая панель вкладок плюс место под «Написать EVO» (раньше 32, и последняя кнопка пряталась под панелью)", async () => {
    await open();
    const content = screen.getByTestId("english-lesson-screen-scroll").props.contentContainerStyle as { paddingBottom: number };
    // В тестовом окружении нижняя безопасная зона 34 pt, уровень assisted: панель и кнопка чата есть.
    expect(content.paddingBottom).toBe(34 + TAB_BAR_CLEARANCE + CHAT_FAB_CLEARANCE);
    expect(content.paddingBottom).toBeGreaterThan(TAB_BAR_CLEARANCE);
  });

  it("у клиента без панели вкладок (approved) запаса под неё нет", async () => {
    const fake = fakeTransport({ [READ]: lessonView(SPEC), [START]: attemptFixture(1) });
    await renderPortal(<EnglishLessonScreen lessonId={lessonId(1)} />, testApi(fake.transport, { tier: "approved" }));
    await screen.findByTestId("english-lesson-title");
    const content = screen.getByTestId("english-lesson-screen-scroll").props.contentContainerStyle as { paddingBottom: number };
    expect(content.paddingBottom).toBe(34);
  });
});
