// Тест на время CSCA как на сайте (components/portal/csca/TimedTestRunner.tsx, TestResultView.tsx): правила вступления по виду
// теста, навигатор по заданиям всегда на виду (отвеченное, текущее, отмеченное флажком), минута до конца и завершение
// озвучены читалке, итог с кнопками сразу под счётом и полосами по модулям и темам. Экран идёт по настоящему пути приложения
// (RPC-слой, разборщики сайта, сессия теста) на поддельном транспорте; данные синтетические.
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, ScrollView, StyleSheet } from "react-native";

import { TestScreen } from "@/features/learning/test-runner/TestScreen";
import type { RpcTransport } from "@/lib/rpc";
import { CHAT_FAB_CLEARANCE, TAB_BAR_CLEARANCE } from "@/shell/useTabBarClearance";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockNav = { setOptions: jest.fn(), dispatch: jest.fn() };
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), dismissTo: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
  useNavigation: () => mockNav,
  usePreventRemove: jest.fn(),
}));

// Навигатор считает свои отрисовки (внутри настоящий): часы перерисовывают экран каждые полсекунды, а ему свойства менять незачем.
const mockNavigatorRenders = { count: 0 };
jest.mock("@/features/learning/test-runner/TestNavigator", () => {
  const actual = jest.requireActual<typeof import("@/features/learning/test-runner/TestNavigator")>("@/features/learning/test-runner/TestNavigator");
  const { memo, createElement } = jest.requireActual<typeof import("react")>("react");
  const Counted = memo(function Counted(props: Parameters<typeof actual.TestNavigator>[0]) {
    mockNavigatorRenders.count += 1;
    return createElement(actual.TestNavigator, props);
  });
  return { ...actual, TestNavigator: Counted };
});

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const DIAGNOSTIC = "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2";

let announce: jest.SpyInstance;
beforeEach(() => {
  mockNavigatorRenders.count = 0;
  jest.mocked(router.dismissTo).mockClear();
  jest.mocked(router.navigate).mockClear();
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(() => announce.mockRestore());

/** Старт теста со свежим сроком: `left` секунд до конца по часам сервера. */
const started = (left: number, base = "csca_test_start_diagnostic") => ({ ...fx(base), serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + left * 1000).toISOString() });

async function openRunning(left = 240, extra: Record<string, unknown> = {}, lang: "ru" | "ky" = "ru", formId = DIAGNOSTIC, base = "csca_test_start_diagnostic") {
  const start = started(left, base);
  const { transport, calls } = fakeTransport({
    learning_track_home_v1: fx("csca_home_after"),
    start_learning_test_v1: start,
    save_learning_test_v1: { ...fx("csca_test_save"), attemptId: start.attemptId },
    complete_learning_test_v1: fx("csca_test_complete_diagnostic"),
    ...extra,
  });
  await renderPortal(<TestScreen formId={formId} attemptId={null} />, testApi(transport), lang);
  await fireEvent.press(await screen.findByTestId("test-begin"));
  await screen.findByTestId("test-clock");
  return { calls, start };
}

describe("вступление: правила по виду теста", () => {
  async function intro(formKey: "diagnostic" | "mock") {
    const home = fx("csca_home_after");
    const form = home.tests.find((test: { formKey: string }) => test.formKey.includes(formKey));
    const { transport } = fakeTransport({ learning_track_home_v1: home });
    await renderPortal(<TestScreen formId={form.formId} attemptId={null} />, testApi(transport));
    return await screen.findByTestId("test-rules");
  }

  it("диагностика (можно закончить раньше): «Разбор откроется после завершения», строки про вкладки нет", async () => {
    const rules = within(await intro("diagnostic"));
    expect(rules.getByText("• Ответы можно менять до конца.")).toBeTruthy();
    expect(rules.getByText("• Ответы сохраняются сами.")).toBeTruthy();
    expect(rules.getByText("• Таймер идёт, даже если закрыть приложение.")).toBeTruthy();
    expect(rules.getByText("• Разбор откроется после завершения.")).toBeTruthy();
    expect(rules.queryByText(/ответы отправятся сами/)).toBeNull();
    expect(rules.queryByText(/вкладк/)).toBeNull();
  });

  it("пробный тест (без досрочной сдачи): «Когда время выйдет, ответы отправятся сами» вместо строки про разбор", async () => {
    const rules = within(await intro("mock"));
    expect(rules.getByText("• Когда время выйдет, ответы отправятся сами.")).toBeTruthy();
    expect(rules.queryByText(/Разбор откроется/)).toBeNull();
    expect(rules.getAllByText(/^• /)).toHaveLength(4);
  });

  it("заголовок вида теста и «К темам» с вкладкой «Занятия»", async () => {
    await intro("diagnostic");
    expect(screen.getByTestId("test-intro-title")).toHaveTextContent("Тест на время");
    await fireEvent.press(screen.getByTestId("test-intro-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
  });
});

describe("навигатор по заданиям", () => {
  it("всегда на виду: ячейка на задание, окна по нажатию на «Отвечено X из Y» нет", async () => {
    await openRunning();
    const navigator = within(screen.getByTestId("test-navigator"));
    for (const n of [1, 2, 3]) expect(navigator.getByTestId(`nav-${n}`)).toBeTruthy();
    expect(screen.queryByTestId("test-nav-open")).toBeNull();
    expect(screen.getByTestId("test-answered")).toHaveTextContent("Отвечено 0 из 3");
    // Пояснение: что значит закрашенное и флажок (для читалки скрыто: состояние уже в подписях ячеек).
    expect(screen.getByText("Отвечено", { includeHiddenElements: true })).toBeTruthy();
    // «Вернуться позже» дважды: в пояснении навигатора и на кнопке флажка у задания.
    expect(screen.getAllByText("Вернуться позже", { includeHiddenElements: true }).length).toBeGreaterThanOrEqual(2);
  });

  it("подписи ячеек для читалки со словами, текущее отмечено", async () => {
    await openRunning();
    expect(screen.getByTestId("nav-1").props.accessibilityLabel).toBe("Задание 1, без ответа");
    expect(screen.getByTestId("nav-1").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("nav-2").props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId("option-b"));
    expect(screen.getByTestId("nav-1").props.accessibilityLabel).toBe("Задание 1, отвечено");
    expect(screen.getByTestId("test-answered")).toHaveTextContent("Отвечено 1 из 3");
  });

  it("флажок: значок на углу ячейки и слова в подписи, снимается тем же нажатием", async () => {
    await openRunning();
    expect(screen.queryByTestId("nav-flag-1", { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(screen.getByTestId("test-flag"));
    expect(screen.getByTestId("nav-flag-1", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("nav-1").props.accessibilityLabel).toBe("Задание 1, без ответа, вернуться позже");
    expect(screen.getByTestId("test-flag").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("test-flag"));
    expect(screen.queryByTestId("nav-flag-1", { includeHiddenElements: true })).toBeNull();
  });

  it("нажатие на ячейку переходит к заданию и объявляет его читалке", async () => {
    await openRunning();
    await fireEvent.press(screen.getByTestId("nav-3"));
    expect(await screen.findByText("Задание 3 из 3")).toBeTruthy();
    expect(screen.getByTestId("nav-3").props.accessibilityState).toMatchObject({ selected: true });
    expect(announce).toHaveBeenCalledWith("Задание 3 из 3");
  });

  it("переход к другому заданию возвращает страницу к началу, ответ и флажок её не двигают", async () => {
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    await openRunning();
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("option-b"));
    await fireEvent.press(screen.getByTestId("test-flag"));
    expect(scrollTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("test-next"));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    await fireEvent.press(screen.getByTestId("nav-1"));
    expect(scrollTo).toHaveBeenCalledTimes(2);
    // Упёрлись в край: перехода нет, прокрутки тоже.
    await fireEvent.press(screen.getByTestId("test-prev"));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("часы идут и перерисовывают экран, а навигатор не перерисовывается: свойства те же; ответ обновляет его один раз", async () => {
    await openRunning();
    const mounted = mockNavigatorRenders.count;
    expect(mounted).toBeGreaterThanOrEqual(1);
    // Два-три шага часов (каждые полсекунды): экран перерисован, навигатору нечего менять.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(mockNavigatorRenders.count).toBe(mounted);
    await fireEvent.press(screen.getByTestId("option-b"));
    expect(mockNavigatorRenders.count).toBe(mounted + 1);
  });

  it("у состояния сохранения живая область «вежливая», пока идёт тест", async () => {
    await openRunning();
    const status = screen.getByTestId("test-save-status");
    expect(status.props.accessibilityLiveRegion).toBe("polite");
    await fireEvent.press(screen.getByTestId("option-b"));
    expect(screen.getByTestId("test-save-status").props.accessibilityLiveRegion).toBe("polite");
  });

  it("на кыргызском: пояснение и подписи ячеек на кыргызском", async () => {
    await openRunning(240, {}, "ky");
    expect(screen.getByTestId("nav-1").props.accessibilityLabel).toMatch(/^1-тапшырма|Тапшырма 1/u);
  });
});

describe("запуск и завершение: что недоступно, пока идёт запрос", () => {
  /** Придержать ответ одной функции, пока тест не отпустит: экран остаётся в промежуточной фазе. */
  function hold(name: string) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const wrap = (base: RpcTransport): RpcTransport => async (called, args, options) => {
      if (called === name) await gate;
      return base(called, args, options);
    };
    return { wrap, release: () => release() };
  }

  it("пока тест запускается, «К темам» недоступна: уход в этот момент оставил бы запущенный тест без экрана", async () => {
    const start = started(240);
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), start_learning_test_v1: start });
    const gate = hold("start_learning_test_v1");
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(gate.wrap(transport)));
    await screen.findByTestId("test-begin");
    expect(screen.getByTestId("test-intro-topics").props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(screen.getByTestId("test-begin"));
    await waitFor(() => expect(screen.getByTestId("test-begin").props.accessibilityState).toMatchObject({ busy: true }));
    expect(screen.getByTestId("test-intro-topics").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("test-intro-topics"));
    expect(router.dismissTo).not.toHaveBeenCalled();
    gate.release();
    await screen.findByTestId("test-clock");
  });

  it("после запуска «К темам» нет, а при ошибке запуска ссылка снова доступна", async () => {
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), start_learning_test_v1: failure("42501", 403) });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("test-begin"));
    await screen.findByTestId("test-start-error");
    expect(screen.getByTestId("test-intro-topics").props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(screen.getByTestId("test-intro-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
  });

  it("пока идёт завершение: ячейки навигатора, флажок, «Назад» и «Далее» недоступны, а слова завершения читает только `announce`", async () => {
    const start = started(240);
    const { transport } = fakeTransport({
      learning_track_home_v1: fx("csca_home_after"),
      start_learning_test_v1: start,
      save_learning_test_v1: { ...fx("csca_test_save"), attemptId: start.attemptId },
      complete_learning_test_v1: fx("csca_test_complete_diagnostic"),
    });
    const gate = hold("complete_learning_test_v1");
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(gate.wrap(transport)));
    await fireEvent.press(await screen.findByTestId("test-begin"));
    await screen.findByTestId("test-clock");
    // Второе из трёх: «Назад» и «Далее» здесь доступны сами по себе (на первом «Назад», на последнем «Далее» недоступны и без
    // завершения), поэтому их недоступность при завершении что-то значит.
    await fireEvent.press(screen.getByTestId("test-next"));
    expect(await screen.findByText("Задание 2 из 3")).toBeTruthy();
    expect(screen.getByTestId("test-prev").props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.getByTestId("test-next").props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(screen.getByTestId("test-finish"));
    await fireEvent.press(screen.getByTestId("test-confirm-yes"));
    await waitFor(() => expect(screen.getByTestId("test-save-status")).toHaveTextContent("Подводим итог…"));
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`nav-${n}`).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("test-flag").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("test-prev").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("test-next").props.accessibilityState).toMatchObject({ disabled: true });
    // Нажатия по недоступным элементам ничего не меняют: то же второе задание, флажка нет.
    for (const id of ["test-prev", "test-next", "nav-1", "nav-3", "test-flag"]) await fireEvent.press(screen.getByTestId(id));
    expect(screen.getByText("Задание 2 из 3")).toBeTruthy();
    expect(screen.getByTestId("nav-2").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByTestId("nav-flag-2", { includeHiddenElements: true })).toBeNull();
    // Слова завершения: живой области нет (иначе Android прочитал бы их второй раз), читалке их говорит `announce` один раз.
    expect(screen.getByTestId("test-save-status").props.accessibilityLiveRegion).toBe("none");
    expect(announce.mock.calls.filter(([text]) => text === "Подводим итог…")).toHaveLength(1);
    gate.release();
    await screen.findByTestId("test-result");
  });
});

describe("часы и озвучка", () => {
  it("минута до конца: читалке один раз «Осталось времени: 01:00», часы цветом предупреждения", async () => {
    await openRunning(60);
    await waitFor(() => expect(announce).toHaveBeenCalledWith("Осталось времени: 01:00"));
    expect(announce.mock.calls.filter(([text]) => text === "Осталось времени: 01:00")).toHaveLength(1);
    expect(screen.getByTestId("test-clock").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: "#b45309" })]));
  });

  it("до последней минуты ничего не объявляется, часы обычного цвета, живой области у часов нет", async () => {
    await openRunning(240);
    expect(announce).not.toHaveBeenCalledWith("Осталось времени: 01:00");
    expect(screen.getByTestId("test-clock").props.style).not.toEqual(expect.arrayContaining([expect.objectContaining({ color: "#b45309" })]));
    const timer = screen.getByRole("timer");
    expect(timer.props.accessibilityLiveRegion).toBeUndefined();
    expect(timer.props.accessibilityLabel).toMatch(/^Осталось времени: 0\d:\d\d$/u);
  });

  it("остаётся меньше минуты при открытии: минуту уже не объявляют (как на вебе)", async () => {
    await openRunning(30);
    expect(announce).not.toHaveBeenCalledWith("Осталось времени: 01:00");
  });

  it("завершение: «Подводим итог…» и затем счёт читаются читалке", async () => {
    await openRunning();
    await fireEvent.press(screen.getByTestId("test-finish"));
    await fireEvent.press(screen.getByTestId("test-confirm-yes"));
    await screen.findByTestId("test-result");
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Верно \d+ из 3$/u)));
  });

  it("открытие прошлого итога ничего не озвучивает", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), learning_test_attempt_v1: done });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={done.attemptId} />, testApi(transport));
    await screen.findByTestId("test-result");
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("слова ошибок", () => {
  /** Ответ сервера с ошибкой на первый вызов одной из функций; дальше всё идёт как обычно (бесконечный отказ сессию не интересует). */
  const failing = (name: string, error: { code: string; message?: string }) => (base: RpcTransport): RpcTransport => {
    let failed = false;
    return async (called, args, options) => {
      if (called !== name || failed) return base(called, args, options);
      failed = true;
      return { data: null, error, status: 400 };
    };
  };

  async function runWith(name: string, error: { code: string; message?: string }, gateReload?: Promise<unknown>) {
    const start = started(240);
    const { transport } = fakeTransport({
      learning_track_home_v1: fx("csca_home_after"),
      start_learning_test_v1: start,
      learning_test_attempt_v1: start,
      save_learning_test_v1: { ...fx("csca_test_save"), attemptId: start.attemptId },
    });
    // Перечитывание попытки после конфликта можно придержать: успешное сохранение следом сразу снимает плашку.
    const held: RpcTransport = async (called, args, options) => {
      if (called === "learning_test_attempt_v1" && gateReload) await gateReload;
      return transport(called, args, options);
    };
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(failing(name, error)(held)));
    await fireEvent.press(await screen.findByTestId("test-begin"));
    await screen.findByTestId("test-clock");
  }

  it("конфликт попытки при сохранении: «Попытка изменилась на другом устройстве…», без слова «вкладка»", async () => {
    let release: (value?: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => (release = resolve));
    await runWith("save_learning_test_v1", { code: "40001", message: "Learning attempt changed" }, gate);
    await fireEvent.press(screen.getByTestId("option-b"));
    const notice = await screen.findByTestId("test-conflict", undefined, { timeout: 5000 });
    expect(notice).toHaveTextContent("Попытка изменилась на другом устройстве. Показаны сохранённые ответы.");
    expect(notice).not.toHaveTextContent(/вкладк|страниц/u);
    release();
  });

  it("ответ не принят при сохранении: «Откройте тест заново», без слов «Обновите страницу»", async () => {
    await runWith("save_learning_test_v1", { code: "22023", message: "Invalid learning test state" });
    await fireEvent.press(screen.getByTestId("option-b"));
    const alert = await screen.findByTestId("test-error", undefined, { timeout: 5000 });
    expect(alert).toHaveTextContent("Ответ не принят. Откройте тест заново.");
    expect(alert).not.toHaveTextContent(/страниц|вкладк/u);
  });

  it("нет доступа при старте: прежние слова раздела", async () => {
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), start_learning_test_v1: failure("42501", 403) });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("test-begin"));
    expect(await screen.findByTestId("test-start-error")).toHaveTextContent("Раздел недоступен. Войдите в кабинет заново.");
  });
});

describe("итог теста", () => {
  async function openResult(change: (done: Record<string, any>) => void = () => undefined, homeHandler: unknown = fx("csca_home_after"), lang: "ru" | "ky" = "ru") {
    const done = fx("csca_test_complete_diagnostic");
    change(done);
    const { transport } = fakeTransport({ learning_track_home_v1: homeHandler, learning_test_attempt_v1: done });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={done.attemptId} />, testApi(transport), lang);
    await screen.findByTestId("test-result");
    return done;
  }

  it("кнопки под итогом: урок слабой темы главной, «К темам» и «Пройти ещё раз», до списка разбора", async () => {
    await openResult();
    const actions = within(await screen.findByTestId("result-actions"));
    const next = await actions.findByTestId("result-next");
    expect(next).toHaveTextContent(/^Следующий шаг: (урок|практика) «/u);
    expect(actions.getByTestId("result-topics")).toHaveTextContent("К темам");
    expect(actions.getByTestId("result-restart")).toHaveTextContent("Пройти ещё раз");
    // Все три в карточке итога, а список разбора ниже.
    const order = JSON.stringify(screen.toJSON());
    expect(order.indexOf("result-actions")).toBeLessThan(order.indexOf("review-1"));
    await fireEvent.press(next);
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: expect.any(String) } });
    await fireEvent.press(actions.getByTestId("result-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
  });

  it("слабой темы с уроком нет: «К темам» главная кнопка, «Пройти ещё раз» вторая", async () => {
    await openResult((done) => {
      // Верно во всех темах: слабых нет.
      for (const topic of done.result.byTopic) topic.correct = topic.total;
    });
    const actions = within(await screen.findByTestId("result-actions"));
    expect(actions.queryByTestId("result-next")).toBeNull();
    expect(actions.getByTestId("result-topics")).toBeTruthy();
    expect(actions.getByTestId("result-restart")).toBeTruthy();
  });

  it("«Пройти ещё раз» возвращает к вступлению, не ожидая конца списка разбора", async () => {
    await openResult();
    await fireEvent.press(within(await screen.findByTestId("result-actions")).getByTestId("result-restart"));
    expect(await screen.findByTestId("test-begin")).toBeTruthy();
  });

  it("три факта: как завершён, без ответа, темп; «Без ответа: N» значком больше нет", async () => {
    await openResult();
    expect(within(screen.getByTestId("result-fact-how")).getByText("Завершён вами")).toBeTruthy();
    expect(within(screen.getByTestId("result-fact-unanswered")).getByText("Без ответа")).toBeTruthy();
    expect(within(screen.getByTestId("result-fact-unanswered")).getByText("1")).toBeTruthy();
    expect(within(screen.getByTestId("result-fact-pace")).getByText("В среднем 52 с на задание при ориентире экзамена 75 с.")).toBeTruthy();
    expect(screen.queryByText(/^Без ответа: \d/)).toBeNull();
    expect(screen.getByText("Это оценка EVO по нашим заданиям, а не балл CSCA.")).toBeTruthy();
  });

  it("полосы по модулям и темам: доля верных, название темы и английское название под ним", async () => {
    await openResult((done) => {
      done.result.byTopic[0].correct = 1;
    });
    const sections = within(screen.getByTestId("tally-sections"));
    expect(sections.getByText(/^Модуль 2\. Функции/u)).toBeTruthy();
    const topic = within(await screen.findByTestId("tally-m2-exp-log"));
    expect(topic.getByText("Показательная и логарифмическая функции")).toBeTruthy();
    expect(topic.getByText("Exponential and logarithmic functions")).toBeTruthy();
    expect(topic.getByText("1 из 1")).toBeTruthy();
    expect(screen.getByTestId("tally-bar-m2-exp-log", { includeHiddenElements: true }).props.style).toMatchObject({ width: "100%" });
    expect(screen.getByTestId("tally-bar-m2-derivative", { includeHiddenElements: true }).props.style).toMatchObject({ width: "0%" });
  });

  it("пока главная трека не прочиталась, вместо сырых ключей тем заглушка; когда прочиталась, названия", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => (release = resolve));
    const done = fx("csca_test_complete_diagnostic");
    const { transport: base } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), learning_test_attempt_v1: done });
    const slow: RpcTransport = async (name, args, options) => {
      if (name === "learning_track_home_v1") await gate;
      return base(name, args, options);
    };
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={done.attemptId} />, testApi(slow));
    // Главная ещё грузится: попытка читается своим запросом, поэтому итог уже виден, а названия тем ждут.
    expect(await screen.findByTestId("tally-topics-skeleton")).toBeTruthy();
    expect(screen.queryByText("m2-exp-log")).toBeNull();
    release(undefined);
    expect(await screen.findByText("Показательная и логарифмическая функции")).toBeTruthy();
    expect(screen.queryByTestId("tally-topics-skeleton")).toBeNull();
  });

  it("главная не прочиталась: темы названы ключами, а не пропадают", async () => {
    await openResult(() => undefined, failure("XX000", 500));
    await waitFor(() => expect(screen.getByText("m2-exp-log")).toBeTruthy());
  });

  it("в разборе: время на задании и значок «Вернуться позже» у отмеченного", async () => {
    await openResult((done) => {
      done.review[0].flagged = true;
      done.review[0].seconds = 41;
    });
    const row = within(await screen.findByTestId("review-1"));
    expect(row.getByTestId("review-flagged")).toHaveTextContent("Вернуться позже");
    expect(row.getByText("Ваше время: 41 с")).toBeTruthy();
    expect(row.queryByText(/Было отмечено/)).toBeNull();
  });

  it("завершённая попытка без разбора: «Итог этой попытки сейчас недоступен», а не «Ответ не принят»", async () => {
    // Итог без `result` разборщик отвергает (экран ошибки чтения); без `review` он допустим, и экран не должен называть это отказом.
    const done = fx("csca_test_complete_diagnostic");
    done.review = null;
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), learning_test_attempt_v1: done });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={done.attemptId} />, testApi(transport));
    const note = await screen.findByTestId("test-result-missing");
    expect(note).toHaveTextContent("Итог этой попытки сейчас недоступен. Откройте его позже.");
    expect(note).not.toHaveTextContent(/Ответ не принят|страниц|вкладк/u);
    expect(screen.queryByTestId("test-result")).toBeNull();
  });

  it("на кыргызском: подписи фактов и кнопок на кыргызском", async () => {
    await openResult(() => undefined, fx("csca_home_after"), "ky");
    expect(within(screen.getByTestId("result-actions")).getByTestId("result-topics")).toHaveTextContent("Темаларга");
  });
});

describe("запас под плавающую панель", () => {
  it("у теста на время тот же запас, что у любой страницы стека «Учёбы»: прежнего явного запаса 32 pt поверх запаса под панель нет", async () => {
    await openRunning();
    const content = StyleSheet.flatten(screen.getByTestId("test-screen-scroll").props.contentContainerStyle) as { paddingBottom: number };
    expect(content.paddingBottom).toBe(34 + TAB_BAR_CLEARANCE + CHAT_FAB_CLEARANCE); // 34 pt - нижняя безопасная зона телефона в тестах
  });
});
