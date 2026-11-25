// Экран теста как на сайте (G57-G59, G62): страницы по четыре утверждения и цельная полоса, уход только после подтверждённого
// сохранения, конфликт с кнопкой «Показать сохранённые ответы», начатый тест открывается без «Перед началом». Чтения и записи
// идут по настоящему пути приложения (слой RPC, разборщики) на поддельном транспорте; данные синтетические.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, Alert, ScrollView } from "react-native";

import { AssessmentScreen } from "@/features/learning/tests/AssessmentScreen";
import { answersFor, attemptFixture, ATTEMPT_ID, catalogFixture, completedFixture, type FixtureKey } from "@/test-fixtures/assessment";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockDisable = jest.fn();
const mockNav = { setOptions: jest.fn(), dispatch: jest.fn() };
const mockPrevent = jest.fn((..._args: unknown[]) => mockDisable);
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn(), dismissTo: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
  useNavigation: () => mockNav,
  usePreventRemove: (...args: unknown[]) => mockPrevent(...args),
}));

const SAVE = "save_student_assessment_answers_v1";
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;

beforeEach(() => {
  jest.mocked(router.dismissTo).mockClear();
  jest.mocked(router.navigate).mockClear();
  mockDisable.mockClear();
  mockNav.setOptions.mockClear();
  mockNav.dispatch.mockClear();
  mockPrevent.mockClear();
  scrollTo.mockClear();
});

type Handlers = Record<string, unknown>;
async function open(key: FixtureKey, handlers: Handlers, props: { attemptId?: string | null } = {}) {
  const fake = fakeTransport({ student_assessments_v1: catalogFixture(key), ...handlers });
  const view = await renderPortal(<AssessmentScreen instrumentKey={key} attemptId={props.attemptId ?? null} />, testApi(fake.transport));
  return { ...fake, ...view };
}
async function begin() {
  await fireEvent.press(await screen.findByTestId("assessment-begin"));
  await screen.findByTestId("assessment-heading");
}
const guard = () => mockPrevent.mock.calls[mockPrevent.mock.calls.length - 1] as [boolean, (event: { data: { action: unknown }; repeat: () => void }) => void];

describe("прохождение: страницы и полоса прогресса (G57)", () => {
  it("orvis92: четыре утверждения на странице с номерами, «Часть 1 из 23», одна цельная полоса вместо 92 остановок", async () => {
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92") });
    await begin();
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Часть 1 из 23");
    for (const n of [1, 2, 3, 4]) expect(screen.getByTestId(`assessment-prompt-o${n}`)).toHaveTextContent(`${n}. Утверждение ${n}`);
    expect(screen.queryByTestId("assessment-prompt-o5")).toBeNull();
    // По пять вариантов на утверждение, у каждого свой уникальный testID.
    expect(screen.getAllByRole("radio")).toHaveLength(20);
    const bar = screen.getByTestId("assessment-progress");
    expect(bar.props.accessibilityRole).toBe("progressbar");
    expect(bar.props.accessibilityLabel).toBe("Прогресс: 0 из 92");
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 92, now: 0 });
    // Нет 92 нажимаемых сегментов «Задание N из 92»: полоса одна.
    expect(screen.queryAllByLabelText(/Задание \d+ из 92/)).toHaveLength(0);
    expect(screen.getByText("Ответили на 0 из 92")).toBeTruthy();
  });

  it("выбор считается в полосе и в подписи; «Далее» идёт на следующие четыре, в начало прокрутки, и называет страницу читалке", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: attemptFixture("orvis92", { revision: 2 }) });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-4"));
    await fireEvent.press(screen.getByTestId("assessment-option-o2-2"));
    expect(screen.getByText("Ответили на 2 из 92")).toBeTruthy();
    expect(screen.getByTestId("assessment-progress").props.accessibilityValue).toEqual({ min: 0, max: 92, now: 2 });
    expect(screen.getByTestId("assessment-option-o1-4").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("assessment-prev").props.accessibilityState).toMatchObject({ disabled: true });
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("assessment-next"));
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Часть 2 из 23");
    expect(screen.getByTestId("assessment-prompt-o5")).toHaveTextContent("5. Утверждение 5");
    expect(screen.queryByTestId("assessment-prompt-o1")).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    expect(announce).toHaveBeenCalledWith("Часть 2 из 23");
    await fireEvent.press(screen.getByTestId("assessment-prev"));
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Часть 1 из 23");
    expect(screen.getByTestId("assessment-option-o1-4").props.accessibilityState).toMatchObject({ checked: true });
    announce.mockRestore();
  });

  it("после последней (23-й) страницы идёт шаг «Готовы завершить?», на последней кнопка «Проверить и завершить»", async () => {
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92", { answers: answersFor("orvis92", 88) }) });
    await begin();
    // Открылось на странице первого пропущенного вопроса (89-й): страница 23.
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Часть 23 из 23");
    expect(screen.getByTestId("assessment-prompt-o92")).toHaveTextContent("92. Утверждение 92");
    expect(screen.queryByTestId("assessment-prompt-o93")).toBeNull();
    expect(screen.getByText("Проверить и завершить")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("assessment-next"));
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Готовы завершить?");
    expect(screen.getByText(/Осталось ответить: 4/)).toBeTruthy();
    expect(screen.getByTestId("assessment-complete").props.accessibilityState).toMatchObject({ disabled: true });
    // «К первому пропущенному вопросу» ведёт на страницу этого вопроса.
    await fireEvent.press(screen.getByTestId("assessment-first-open"));
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Часть 23 из 23");
  });

  it("english36: по одному заданию, «Задание 1 из 36», без нумерации перед формулировкой, текст для чтения виден; полоса цельная", async () => {
    await open("english36", { start_student_assessment_v1: attemptFixture("english36") });
    await begin();
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Задание 1 из 36");
    expect(screen.getByTestId("assessment-prompt-e1")).toHaveTextContent(/^Choose the word 1$/);
    expect(screen.getByText("Passage 1")).toBeTruthy();
    expect(screen.queryByTestId("assessment-prompt-e2")).toBeNull();
    expect(screen.getByTestId("assessment-progress").props.accessibilityLabel).toBe("Прогресс: 0 из 36");
    await fireEvent.press(screen.getByTestId("assessment-next"));
    expect(screen.getByTestId("assessment-heading")).toHaveTextContent("Задание 2 из 36");
  });

  it("языки для читалки: английские задания и варианты читаются как английские, «Не знаю» и утверждения orvis92 как русские", async () => {
    await open("english36", { start_student_assessment_v1: attemptFixture("english36") });
    await begin();
    expect(screen.getByTestId("assessment-prompt-e1").props.accessibilityLanguage).toBe("en");
    expect(screen.getByTestId("assessment-option-e1-a").props.accessibilityLanguage).toBe("en");
    expect(screen.getByTestId("assessment-option-e1-unknown").props.accessibilityLanguage).toBe("ru");
  });
});

describe("начатый тест открывается сразу (G62)", () => {
  it("есть черновик: без «Перед началом», сразу страница первого пропущенного вопроса", async () => {
    const { calls } = await open("orvis92", { student_assessments_v1: catalogFixture("orvis92", { draft: ATTEMPT_ID }), student_assessment_attempt_v1: attemptFixture("orvis92", { answers: answersFor("orvis92", 6) }) });
    expect(await screen.findByTestId("assessment-heading")).toHaveTextContent("Часть 2 из 23");
    expect(screen.queryByTestId("assessment-begin")).toBeNull();
    expect(screen.getByText("Ответили на 6 из 92")).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_assessment_attempt_v1")).toHaveLength(1);
    expect(calls.some((c) => c.name === "start_student_assessment_v1")).toBe(false);
  });

  it("черновик не прочитался: остаётся «Перед началом» с ошибкой и кнопкой «Продолжить», повтор открывает тест", async () => {
    let reads = 0;
    await open("orvis92", {
      student_assessments_v1: catalogFixture("orvis92", { draft: ATTEMPT_ID }),
      student_assessment_attempt_v1: () => (++reads <= 1 ? failure(null, 0) : attemptFixture("orvis92", { answers: answersFor("orvis92", 2) })),
    });
    expect(await screen.findByTestId("assessment-start-error")).toBeTruthy();
    expect(screen.getByText("Продолжить")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("assessment-begin"));
    expect(await screen.findByTestId("assessment-heading")).toHaveTextContent("Часть 1 из 23");
  });

  it("нет начатого: сначала «Перед началом», тест открывается нажатием", async () => {
    await open("english36", { start_student_assessment_v1: attemptFixture("english36") });
    expect(await screen.findByText("Перед началом")).toBeTruthy();
    expect(screen.queryByTestId("assessment-heading")).toBeNull();
  });

  it("теста нет в каталоге: заголовок, пояснение и «вернитесь позже», как на сайте", async () => {
    await open("english36", { student_assessments_v1: { instruments: [], attempts: [] } });
    expect(await screen.findByTestId("assessment-unavailable")).toHaveTextContent("Тест пока недоступен");
    expect(screen.getByText("Мы готовим задания. Ваши предыдущие результаты сохранены.")).toBeTruthy();
    expect(screen.getByText("Вернитесь к разделу «Тесты» позже.")).toBeTruthy();
  });
});

describe("уход с теста (G58)", () => {
  it("защита включается, пока есть несохранённое, и снимается, когда сервер подтвердил; в обычную отправку жест назад не трогается", async () => {
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: attemptFixture("orvis92", { revision: 2 }) });
    await begin();
    expect(guard()[0]).toBe(false);
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    expect(guard()[0]).toBe(true);
    await waitFor(() => expect(guard()[0]).toBe(false), { timeout: 3000 });
    // Жест идёт через защиту (как «назад»): сохраняет и уходит. Выключать и включать его на каждое сохранение незачем.
    expect(mockNav.setOptions).not.toHaveBeenCalled();
  });

  it("жест назад выключается один раз, когда защита держит экран из-за сбоя, и включается, когда сбой прошёл", async () => {
    let saves = 0;
    await open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92"),
      [SAVE]: () => (++saves <= 3 ? failure(null, 0) : attemptFixture("orvis92", { revision: 2 })),
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    await screen.findByTestId("assessment-retry-save", undefined, { timeout: 3000 });
    expect(mockNav.setOptions.mock.calls).toEqual([[{ gestureEnabled: false }]]);
    // Плашка говорит, почему жест молчит и что будет, если выйти другим путём.
    expect(screen.getByTestId("assessment-error")).toHaveTextContent(/Ответы ещё не сохранены, свайп назад выключен/);
    expect(screen.getByTestId("assessment-error")).toHaveTextContent(/через меню или вкладки/);
    await fireEvent.press(screen.getByTestId("assessment-retry-save"));
    await waitFor(() => expect(screen.queryByTestId("assessment-error")).toBeNull());
    expect(mockNav.setOptions.mock.calls).toEqual([[{ gestureEnabled: false }], [{ gestureEnabled: true }]]);
  });

  it("«назад» раньше таймера 0,9 с: ответ уходит сразу, после подтверждения экран закрывается сам и ничего не спрашивает", async () => {
    const { calls } = await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: attemptFixture("orvis92", { revision: 2 }) });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    const repeat = jest.fn();
    await act(async () => guard()[1]({ data: { action: { type: "GO_BACK" } }, repeat }));
    expect(repeat).toHaveBeenCalledTimes(1);
    const saves = calls.filter((c) => c.name === SAVE);
    expect(saves).toHaveLength(1);
    expect(saves[0].args?.p_answers).toEqual({ o1: "3" });
    expect(screen.queryByTestId("assessment-error")).toBeNull();
  });

  it("нет связи: экран не закрывается, ответ на экране, внизу строка «Сначала сохраним ответы…» и кнопка «Повторить сохранение»", async () => {
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: failure(null, 0) });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    const repeat = jest.fn();
    await act(async () => guard()[1]({ data: { action: { type: "GO_BACK" } }, repeat }));
    expect(repeat).not.toHaveBeenCalled();
    const notice = await screen.findByTestId("assessment-error");
    expect(notice).toHaveTextContent(/Не удалось подтвердить сохранение/);
    expect(notice).toHaveTextContent(/Сначала сохраним ответы/);
    expect(screen.getByTestId("assessment-retry-save")).toBeTruthy();
    expect(screen.getByTestId("assessment-option-o1-3").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("assessment-save-status")).toHaveTextContent("Сохранение не подтверждено");
    expect(guard()[0]).toBe(true);
  });

  it("«Сохранить и выйти»: уходит только после подтверждённого сохранения; без связи остаётся на экране", async () => {
    let saves = 0;
    const { calls } = await open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92"),
      // Первая запись (с её повторами слоя RPC) обрывается, следующая проходит.
      [SAVE]: () => (++saves <= 3 ? failure(null, 0) : attemptFixture("orvis92", { revision: 2 })),
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o2-5"));
    await fireEvent.press(screen.getByTestId("assessment-exit"));
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(await screen.findByTestId("assessment-retry-save")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("assessment-retry-save"));
    await waitFor(() => expect(screen.queryByTestId("assessment-error")).toBeNull());
    await fireEvent.press(screen.getByTestId("assessment-exit"));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledTimes(1));
    expect(router.dismissTo).toHaveBeenCalledWith("/tests"); // к «Всем тестам», а не `router.back()` во вкладку «Главная»
    expect(mockDisable).toHaveBeenCalled();
    // Один и тот же замороженный запрос на все попытки сохранить этот ответ.
    expect(new Set(calls.filter((c) => c.name === SAVE).map((c) => c.args?.p_request_id)).size).toBe(1);
  });

  it("всё сохранено: «Сохранить и выйти» уходит сразу, без обращений к серверу", async () => {
    const { calls } = await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92", { answers: answersFor("orvis92", 3) }) });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-exit"));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledTimes(1));
    expect(calls.some((c) => c.name === SAVE)).toBe(false);
    expect(screen.getByText("Можно вернуться к любому ответу до завершения.")).toBeTruthy();
  });

  it("два нажатия «назад» подряд закрывают один экран", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92"),
      [SAVE]: async () => {
        await gate;
        return attemptFixture("orvis92", { revision: 2 });
      },
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    const repeat = jest.fn();
    await act(async () => {
      guard()[1]({ data: { action: { type: "GO_BACK" } }, repeat });
      guard()[1]({ data: { action: { type: "GO_BACK" } }, repeat });
      release();
    });
    await waitFor(() => expect(repeat).toHaveBeenCalledTimes(1));
  });
});

describe("конфликт: кнопка есть, ответы на экране не пропадают (G59)", () => {
  const conflicted = () =>
    open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92", { answers: { o1: "2" } }),
      [SAVE]: failure("40001", 409),
      student_assessment_attempt_v1: attemptFixture("orvis92", { revision: 7, answers: { o1: "5", o2: "4" } }),
    });

  it("текст обещает «Показать сохранённые ответы» - и кнопка рядом; ответы студента остаются, выбор закрыт, «Сохранить и выйти» закрыта", async () => {
    await conflicted();
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o3-1"));
    const notice = await screen.findByTestId("assessment-error", undefined, { timeout: 3000 });
    expect(notice).toHaveTextContent(/Тест открыт в другой вкладке/);
    expect(notice).toHaveTextContent(/Нажмите «Показать сохранённые ответы»/);
    expect(screen.getByTestId("assessment-load-saved")).toBeTruthy();
    expect(screen.getByTestId("assessment-option-o3-1").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("assessment-option-o4-1").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("assessment-exit").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("assessment-save-status")).toHaveTextContent("Сохранение не подтверждено");
    // Уйти нельзя, пока не сверили: строка называет, что нажать.
    const repeat = jest.fn();
    await act(async () => guard()[1]({ data: { action: { type: "GO_BACK" } }, repeat }));
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByTestId("assessment-error")).toHaveTextContent(/Сначала нажмите «Показать сохранённые ответы»/);
  });

  it("кнопка спрашивает подтверждение; отмена ничего не меняет, «Заменить» показывает ответы сервера, плашка исчезает", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { calls } = await conflicted();
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o3-1"));
    await fireEvent.press(await screen.findByTestId("assessment-load-saved", undefined, { timeout: 3000 }));
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    expect(title).toBe("Показать сохранённые ответы");
    expect(message).toContain("Заменить ответы на экране сохранёнными?");
    expect(buttons.map((b) => b.text)).toEqual(["Отмена", "Заменить"]);
    expect(calls.some((c) => c.name === "student_assessment_attempt_v1")).toBe(false);
    await act(async () => buttons[1].onPress?.());
    await waitFor(() => expect(screen.queryByTestId("assessment-error")).toBeNull());
    expect(screen.getByText("Ответили на 2 из 92")).toBeTruthy();
    expect(screen.getByTestId("assessment-option-o1-5").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("assessment-option-o3-1").props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId("assessment-save-status")).toHaveTextContent("Все ответы сохранены");
    alert.mockRestore();
  });

  it("чтение сохранённого не удалось: текст «Ответы на экране не изменились», кнопка остаётся", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92"),
      [SAVE]: failure("40001", 409),
      student_assessment_attempt_v1: failure(null, 0),
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    await fireEvent.press(await screen.findByTestId("assessment-load-saved", undefined, { timeout: 3000 }));
    const buttons = (alert.mock.calls[0] as [string, string, { onPress?: () => void }[]])[2];
    await act(async () => buttons[1].onPress?.());
    expect(await screen.findByText(/Не получилось показать сохранённые ответы/)).toBeTruthy();
    expect(screen.getByTestId("assessment-load-saved")).toBeTruthy();
    expect(screen.getByTestId("assessment-option-o1-3").props.accessibilityState).toMatchObject({ checked: true });
    alert.mockRestore();
  });
});

describe("сбой сохранения без ухода", () => {
  it("«Повторить сохранение» сразу шлёт тот же запрос и убирает плашку", async () => {
    let saves = 0;
    const { calls } = await open("english36", {
      start_student_assessment_v1: attemptFixture("english36"),
      [SAVE]: () => (++saves <= 3 ? failure(null, 0) : attemptFixture("english36", { revision: 2 })),
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-e1-a"));
    expect(await screen.findByTestId("assessment-retry-save", undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByTestId("assessment-error")).toHaveTextContent(/Повторите запрос перед выходом/);
    await fireEvent.press(screen.getByTestId("assessment-retry-save"));
    await waitFor(() => expect(screen.queryByTestId("assessment-error")).toBeNull());
    expect(screen.getByTestId("assessment-save-status")).toHaveTextContent("Все ответы сохранены");
    expect(new Set(calls.filter((c) => c.name === SAVE).map((c) => c.args?.p_request_id)).size).toBe(1);
  });
});

describe("упорный сбой: «Выйти без сохранения» (ревью #1559)", () => {
  /** Три неудачные отправки подряд: первая сама, две нажатием «Повторить сохранение». */
  async function offlineThreeTimes() {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: failure(null, 0) });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    await screen.findByTestId("assessment-retry-save", undefined, { timeout: 3000 });
    return { ...view, alert };
  }
  const retry = async () => {
    await fireEvent.press(screen.getByTestId("assessment-retry-save"));
    await act(async () => undefined);
  };

  it("до трёх неудач подряд кнопки нет; на третьей рядом с повтором появляется «Выйти без сохранения»", async () => {
    const { alert } = await offlineThreeTimes();
    expect(screen.queryByTestId("assessment-leave-anyway")).toBeNull();
    await retry();
    expect(screen.queryByTestId("assessment-leave-anyway")).toBeNull();
    await retry();
    expect(await screen.findByTestId("assessment-leave-anyway")).toHaveTextContent("Выйти без сохранения");
    expect(screen.getByTestId("assessment-retry-save")).toBeTruthy();
    alert.mockRestore();
  });

  it("окно спрашивает подтверждение: «Остаться» ничего не меняет, «Выйти» снимает защиту и уходит в «Все тесты»", async () => {
    const { alert } = await offlineThreeTimes();
    await retry();
    await retry();
    await fireEvent.press(await screen.findByTestId("assessment-leave-anyway"));
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    expect(title).toBe("Выйти без сохранения?");
    expect(message).toBe("Ответы, которые не удалось сохранить, пропадут. Те, что сохранены раньше, останутся.");
    expect(buttons.map((b) => b.text)).toEqual(["Остаться", "Выйти"]);
    expect(buttons[0].style).toBe("cancel");
    expect(buttons[1].style).toBe("destructive");
    expect(router.dismissTo).not.toHaveBeenCalled(); // ничего не меняется, пока не выбрали «Выйти»
    await act(async () => buttons[1].onPress?.());
    expect(mockDisable).toHaveBeenCalledTimes(1); // защита снята, иначе уход перехватила бы она же
    expect(router.dismissTo).toHaveBeenCalledWith("/tests");
    alert.mockRestore();
  });

  it("на плашке сказано, что ответы ещё не сохранены и что свайп назад выключен; читалка слышит плашку целиком", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { alert } = await offlineThreeTimes();
    const notice = screen.getByTestId("assessment-error");
    expect(notice).toHaveTextContent(/Не удалось подтвердить сохранение/);
    expect(notice).toHaveTextContent(/Ответы ещё не сохранены, свайп назад выключен/);
    const spoken = announce.mock.calls.map((c) => String(c[0])).filter((text) => text.includes("Не удалось подтвердить сохранение"));
    expect(spoken[spoken.length - 1]).toContain("свайп назад выключен");
    announce.mockRestore();
    alert.mockRestore();
  });

  it("ответ сервера не разобрать: повтора и «Выйти без сохранения» нет, защита снята, «Сохранить и выйти» уходит сразу", async () => {
    const { calls } = await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92"), [SAVE]: { not: "an attempt" } });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    const notice = await screen.findByTestId("assessment-error", undefined, { timeout: 3000 });
    expect(notice).toHaveTextContent(/Не удалось подтвердить сохранение/);
    expect(screen.queryByTestId("assessment-retry-save")).toBeNull();
    expect(screen.queryByTestId("assessment-leave-anyway")).toBeNull();
    expect(guard()[0]).toBe(false);
    await fireEvent.press(screen.getByTestId("assessment-exit"));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith("/tests"));
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(1);
  });

  it("стрелка в шапке идёт тем же путём, что «Сохранить и выйти»: без связи остаётся на экране, со связью сохраняет и уходит", async () => {
    let saves = 0;
    const { calls } = await open("orvis92", {
      start_student_assessment_v1: attemptFixture("orvis92"),
      [SAVE]: () => (++saves <= 3 ? failure(null, 0) : attemptFixture("orvis92", { revision: 2 })),
    });
    await begin();
    await fireEvent.press(screen.getByTestId("assessment-option-o1-3"));
    await fireEvent.press(screen.getByTestId("assessment-title-back"));
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(await screen.findByTestId("assessment-retry-save")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("assessment-title-back"));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith("/tests"));
    expect(new Set(calls.filter((c) => c.name === SAVE).map((c) => c.args?.p_request_id)).size).toBe(1);
  });
});

describe("карточка вариантов и «Пройти заново»", () => {
  it("группа вариантов называется формулировкой: у orvis92 с номером, у english36 как есть", async () => {
    await open("orvis92", { start_student_assessment_v1: attemptFixture("orvis92") });
    await begin();
    expect(screen.getByTestId("assessment-options-o1").props.accessibilityRole).toBe("radiogroup");
    expect(screen.getByTestId("assessment-options-o1").props.accessibilityLabel).toBe("1. Утверждение 1");
    expect(screen.getByTestId("assessment-options-o4").props.accessibilityLabel).toBe("4. Утверждение 4");
  });

  it("english36: группа называется заданием и читается как английская", async () => {
    await open("english36", { start_student_assessment_v1: attemptFixture("english36") });
    await begin();
    expect(screen.getByTestId("assessment-options-e1").props.accessibilityLabel).toBe("Choose the word 1");
    expect(screen.getByTestId("assessment-options-e1").props.accessibilityLanguage).toBe("en");
  });

  it("«Пройти заново» прокручивает наверх: «Перед началом» короче результата, без этого страница открылась бы с пустого низа", async () => {
    await open("english36", { student_assessment_attempt_v1: completedFixture("english36") }, { attemptId: ATTEMPT_ID });
    const again = await screen.findByTestId("assessment-restart");
    scrollTo.mockClear();
    await fireEvent.press(again);
    expect(await screen.findByTestId("assessment-begin")).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });
});
