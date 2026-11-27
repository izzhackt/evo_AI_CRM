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
import { announceSignOut, flushBeforeSignOut, SIGN_OUT_FLUSH_MS } from "@/session/sign-out-signal";
import type { RpcTransport, RpcTransportResult } from "@/lib/rpc";
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

describe("выход из аккаунта посреди теста (QA 23: `save_learning_test_v1` сразу после `/auth/v1/logout` кончался 401)", () => {
  const saves = (calls: { name: string }[]) => calls.filter((c) => c.name === "save_learning_test_v1");
  /** Закрытие экрана досылает выбор синхронно с очисткой эффекта; несколько проходов по обещаниям хватает, чтобы запрос дошёл до сети. */
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

  it("контроль: без выхода закрытие экрана досылает выбор, который не успел уйти по таймеру", async () => {
    const { calls } = await openRunning();
    await fireEvent.press(await screen.findByTestId("option-b"));
    expect(saves(calls)).toHaveLength(0);
    await screen.unmount();
    await settle();
    expect(saves(calls)).toHaveLength(1);
  });

  it("выход, затем закрытие экрана: выбор не уходит с отозванным токеном", async () => {
    const { calls } = await openRunning();
    await fireEvent.press(await screen.findByTestId("option-b"));
    await act(async () => announceSignOut());
    await screen.unmount();
    await settle();
    expect(saves(calls)).toHaveLength(0);
  });

  it("выход, затем срабатывает таймер сохранения: запись не уходит, даже если экран ещё открыт", async () => {
    jest.useFakeTimers();
    try {
      const { calls } = await openRunning();
      await fireEvent.press(await screen.findByTestId("option-b"));
      await act(async () => announceSignOut());
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(saves(calls)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // Кнопка «Выйти» (решение владельца 27.11): сначала досылка неотправленного, пока токен действует, потом сигнал и отзыв токена. Те же три
  // шага делает `SessionProvider.signOut` (сам провайдер, порядок и одну цепочку на два нажатия проверяет `sign-out-signal.test.tsx`).
  const signOutLikeProvider = async (logout: () => void) => {
    await flushBeforeSignOut();
    announceSignOut();
    logout();
  };
  /** Экран теста со своим ответом сервера на сохранение (запрос не отвечает, отказ связи); остальное по-настоящему. `sent`: сколько раз сохранение отправлено. */
  async function openWithSave(save: () => PromiseLike<RpcTransportResult>) {
    const start = started(240);
    const { transport: base } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), start_learning_test_v1: start });
    const sent: string[] = [];
    const transport: RpcTransport = (name, args, options) => {
      if (name !== "save_learning_test_v1") return base(name, args, options);
      sent.push(name);
      return save();
    };
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(transport), "ru");
    await fireEvent.press(await screen.findByTestId("test-begin"));
    await screen.findByTestId("test-clock");
    return { sent };
  }
  const offline = async (): Promise<RpcTransportResult> => ({ data: null, error: { code: null }, status: 0 });

  it("кнопка «Выйти»: выбор, не успевший уйти по таймеру, уходит ДО отзыва токена; потом ни таймер, ни закрытие экрана ничего не шлют", async () => {
    jest.useFakeTimers();
    try {
      const { calls } = await openRunning();
      await fireEvent.press(await screen.findByTestId("option-b"));
      expect(saves(calls)).toHaveLength(0);
      const sentAtLogout: number[] = [];
      await act(async () => {
        await signOutLikeProvider(() => void sentAtLogout.push(saves(calls).length));
      });
      expect(sentAtLogout).toEqual([1]); // к отзыву токена запись уже ушла
      await fireEvent.press(await screen.findByTestId("option-c")); // студент ещё успел нажать: сессия брошена, новая запись не планируется
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      await screen.unmount();
      await settle();
      expect(saves(calls)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("без связи (сервер не отвечает): выход идёт дальше ровно через 3 с, и запрос не повторяется", async () => {
    jest.useFakeTimers();
    try {
      const { sent } = await openWithSave(() => new Promise(() => undefined));
      await fireEvent.press(await screen.findByTestId("option-b"));
      const logout = jest.fn();
      await act(async () => {
        void signOutLikeProvider(logout);
        await jest.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_MS - 1);
      });
      expect(sent).toHaveLength(1); // досылка попробовала и ждёт ответа
      expect(logout).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(logout).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(sent).toHaveLength(1); // сессия брошена: повтора нет
    } finally {
      jest.useRealTimers();
    }
  });

  it("контроль: без выхода сбой связи повторяется по таймеру", async () => {
    jest.useFakeTimers();
    try {
      const { sent } = await openWithSave(offline);
      await fireEvent.press(await screen.findByTestId("option-b"));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(sent.length).toBeGreaterThan(3); // первая отправка (до трёх попыток слоя RPC) и повторы сессии каждые 3 с
    } finally {
      jest.useRealTimers();
    }
  });

  it("сбой связи (запрос отклонён сразу): выход не ждёт, и повтора по таймеру нет", async () => {
    jest.useFakeTimers();
    try {
      const { sent } = await openWithSave(offline);
      await fireEvent.press(await screen.findByTestId("option-b"));
      const logout = jest.fn();
      await act(async () => {
        await signOutLikeProvider(logout); // часы стоят: с ожиданием в 3 с этот вызов завис бы
      });
      expect(logout).toHaveBeenCalledTimes(1);
      const atLogout = sent.length; // слой RPC сам пробует отправить обрывом поражённую запись до трёх раз подряд, без пауз
      expect(atLogout).toBeGreaterThan(0);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(sent).toHaveLength(atLogout); // таймер повтора сессии снят сигналом: новых отправок нет
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("прокрутка страницы теста при смене стадии (QA 23, D3)", () => {
  const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
  const toTop = { y: 0, animated: false };
  /** Студент долистал «Перед началом» до кнопки: прокрутка страницы не нулевая. */
  const scrollDown = () => fireEvent.scroll(screen.getByTestId("test-screen-scroll"), { nativeEvent: { contentOffset: { y: 900 } } });

  it("«Начать» на долистанной странице: первое задание открывается сверху, а не с прежней прокрутки", async () => {
    const start = started(240);
    const { transport } = fakeTransport({
      learning_track_home_v1: fx("csca_home_after"),
      start_learning_test_v1: start,
      save_learning_test_v1: { ...fx("csca_test_save"), attemptId: start.attemptId },
    });
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(transport));
    const begin = await screen.findByTestId("test-begin");
    await scrollDown();
    scrollTo.mockClear();
    await fireEvent.press(begin);
    await screen.findByTestId("test-clock");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(toTop));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("итог открывается сверху (завершение «Подводим итог» страницу не двигает), «Пройти ещё раз» возвращает к началу", async () => {
    await openRunning();
    scrollTo.mockClear();
    await fireEvent.press(await screen.findByTestId("test-finish"));
    await fireEvent.press(await screen.findByTestId("test-confirm-yes"));
    await screen.findByTestId("test-result");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(toTop));
    expect(scrollTo).toHaveBeenCalledTimes(1); // «завершаем» и «идёт тест» одна стадия, прокрутка один раз, на итоге
    scrollTo.mockClear();
    await fireEvent.press(within(await screen.findByTestId("result-actions")).getByTestId("result-restart"));
    await screen.findByTestId("test-begin");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(toTop));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("открытие прошлого итога и возобновление теста сами страницу не прокручивают (нечего сбрасывать)", async () => {
    const done = fx("csca_test_complete_diagnostic");
    const { transport } = fakeTransport({ learning_track_home_v1: fx("csca_home_after"), learning_test_attempt_v1: done });
    scrollTo.mockClear();
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={done.attemptId} />, testApi(transport));
    await screen.findByTestId("test-result");
    expect(scrollTo).not.toHaveBeenCalled();
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

describe("сообщение о сбое в видимой части (QA 24, N2)", () => {
  // Сообщения о сбое стоят над заданием, а «Завершить» внизу: после отказа «Завершить» сообщение показывается, если его верх выше
  // видимой части. Сообщение из фонового сохранения посреди теста (конфликт, «нет доступа», «ответ не принят») страницу не двигает:
  // студент читает задание. Раскладки в Jest нет, телефон сообщает её событием: раннер лежит на 16 от начала содержимого, сообщения
  // на 140 от раннера.
  const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
  const NOTICE_Y = 140;
  const shown = { y: 16 + NOTICE_Y - 12, animated: false }; // верх раннера + верх сообщений - запас над ними
  const scrollDown = () => fireEvent.scroll(screen.getByTestId("test-screen-scroll"), { nativeEvent: { contentOffset: { y: 900 } } });
  const layout = (id: string, y: number) => fireEvent(screen.getByTestId(id), "layout", { nativeEvent: { layout: { x: 0, y, width: 370, height: 100 } } });
  /**
   * Конфликт при сохранении на первый вызов, дальше сохранение проходит (как «слова ошибок»); перечитывание попытки придержано,
   * и сообщение о конфликте остаётся на экране, пока тест не отпустит. Вечный конфликт сессия повторяла бы без пауз.
   */
  async function openWithConflict() {
    let attempt: unknown = null;
    let release: () => void = () => undefined;
    const reload = new Promise<void>((resolve) => (release = resolve));
    let saves = 0;
    const { start } = await openRunning(240, {
      save_learning_test_v1: (args: Record<string, unknown> | undefined) => (++saves === 1 ? failure("40001", 409) : { ...fx("csca_test_save"), attemptId: args?.p_attempt_id }),
      learning_test_attempt_v1: () => reload.then(() => attempt),
    });
    attempt = start;
    return release;
  }
  /** Закончить тест досрочно: нажать «Завершить» и подтвердить. */
  const finish = async () => {
    await fireEvent.press(screen.getByTestId("test-finish"));
    await fireEvent.press(await screen.findByTestId("test-confirm-yes"));
  };

  it("конфликт при сохранении посреди теста, пока студент внизу страницы: страница стоит (ни при появлении сообщения, ни когда телефон сообщил его раскладку)", async () => {
    const release = await openWithConflict();
    await layout("test-runner", 16);
    await scrollDown();
    scrollTo.mockClear();
    await fireEvent.press(await screen.findByTestId("option-b"));
    await screen.findByTestId("test-conflict", undefined, { timeout: 5000 });
    expect(scrollTo).not.toHaveBeenCalled();
    await layout("test-notices", NOTICE_Y); // верх сообщения выше видимой части, но студент читает задание: страница стоит
    expect(scrollTo).not.toHaveBeenCalled();
    release();
  });

  it("страница вверху: сообщение на виду, страница не двигается", async () => {
    const release = await openWithConflict();
    await layout("test-runner", 16);
    scrollTo.mockClear();
    await fireEvent.press(await screen.findByTestId("option-b"));
    await screen.findByTestId("test-conflict", undefined, { timeout: 5000 });
    await layout("test-notices", NOTICE_Y);
    expect(scrollTo).not.toHaveBeenCalled();
    release();
  });

  it("сообщение исчезло (связь вернулась) и появилось снова: показ идёт по его новому положению, а не по прежнему", async () => {
    let online = false;
    await openRunning(240, { save_learning_test_v1: (args: Record<string, unknown> | undefined) => (online ? { ...fx("csca_test_save"), attemptId: args?.p_attempt_id } : failure(null, 0)) });
    await layout("test-runner", 16);
    await fireEvent.press(await screen.findByTestId("option-b"));
    await finish();
    await screen.findByTestId("test-unsent");
    await layout("test-notices", NOTICE_Y); // страница вверху: сообщение на виду
    online = true; // связь вернулась: повтор сохранения через 3 с проходит, и сообщение уходит
    await waitFor(() => expect(screen.queryByTestId("test-unsent")).toBeNull(), { timeout: 8000 });

    online = false;
    await fireEvent.press(await screen.findByTestId("option-a")); // новый выбор, связи снова нет
    await scrollDown();
    scrollTo.mockClear();
    await finish();
    await screen.findByTestId("test-unsent");
    await layout("test-notices", 170); // сообщение появилось в другом месте (выше стал навигатор)
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 16 + 170 - 12, animated: false });
    online = true; // повторы после теста кончаются
  });

  it.each([
    ["ответ не принят", failure("22023", 400), "Ответ не принят. Откройте тест заново."],
    ["нет доступа", failure("42501", 403), "Раздел недоступен. Войдите в кабинет заново."],
  ])("%s при сохранении посреди теста, пока студент внизу страницы: сообщение об ошибке появилось, страница стоит", async (_name, reply, words) => {
    await openRunning(240, { save_learning_test_v1: reply });
    await layout("test-runner", 16);
    await scrollDown();
    scrollTo.mockClear();
    await fireEvent.press(await screen.findByTestId("option-b"));
    expect(await screen.findByTestId("test-error", undefined, { timeout: 5000 })).toHaveTextContent(words);
    await layout("test-notices", NOTICE_Y);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("«Завершить» не удалось (связи нет), а сообщение выше видимой части: оно показано; нажатие снова даёт тот же отказ, и сообщение показано снова", async () => {
    let online = false;
    await openRunning(240, { save_learning_test_v1: (args: Record<string, unknown> | undefined) => (online ? { ...fx("csca_test_save"), attemptId: args?.p_attempt_id } : failure(null, 0)) });
    await layout("test-runner", 16);
    await fireEvent.press(await screen.findByTestId("option-b")); // выбор не отправлен
    await scrollDown();
    scrollTo.mockClear();
    await finish();
    await screen.findByTestId("test-unsent");
    expect(scrollTo).not.toHaveBeenCalled(); // раскладки сообщения ещё нет
    await layout("test-notices", NOTICE_Y);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(shown);

    await scrollDown();
    await finish(); // сообщение то же, а нажатие ответа ждёт
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
    expect(scrollTo).toHaveBeenLastCalledWith(shown);
    expect(screen.getAllByTestId("test-unsent")).toHaveLength(1);
    online = true; // связь вернулась: досылка при закрытии экрана проходит, и повторы после теста кончаются (без этого они шли бы вечно)
  });

  it("«Завершить» нажато, когда сообщение уже на экране: пока отправка идёт, страница стоит; отказ пришёл - страница идёт к сообщению один раз (начало завершения не повод)", async () => {
    let online = false;
    let held: Promise<void> | null = null; // отправка, которую тест придерживает, пока не отпустит
    let release: () => void = () => undefined;
    const start = started(240);
    const { transport } = fakeTransport({
      learning_track_home_v1: fx("csca_home_after"),
      start_learning_test_v1: start,
      save_learning_test_v1: (args: Record<string, unknown> | undefined) => (online ? { ...fx("csca_test_save"), attemptId: args?.p_attempt_id } : failure(null, 0)),
    });
    const gated: RpcTransport = async (called, args, options) => {
      if (called === "save_learning_test_v1" && held) await held;
      return transport(called, args, options);
    };
    await renderPortal(<TestScreen formId={DIAGNOSTIC} attemptId={null} />, testApi(gated));
    try {
      await fireEvent.press(await screen.findByTestId("test-begin"));
      await screen.findByTestId("test-clock");
      await layout("test-runner", 16);
      await fireEvent.press(await screen.findByTestId("option-b")); // выбор не отправлен
      await finish(); // первый отказ: страница вверху, сообщение на виду
      await screen.findByTestId("test-unsent");
      await layout("test-notices", NOTICE_Y);

      await scrollDown(); // студент ушёл вниз, сообщение выше видимой части и его раскладка известна
      scrollTo.mockClear();
      held = new Promise<void>((resolve) => (release = resolve));
      await finish(); // «Завершить» ещё раз: идёт «Подводим итог», отправка повисла
      await waitFor(() => expect(screen.getByTestId("test-finish").props.accessibilityState).toMatchObject({ disabled: true }), { timeout: 5000 });
      expect(scrollTo).not.toHaveBeenCalled(); // отказа ещё нет: страница стоит
      release(); // отправка не прошла: тот же отказ
      await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(scrollTo).toHaveBeenLastCalledWith(shown);
      await waitFor(() => expect(screen.getByTestId("test-finish").props.accessibilityState).toMatchObject({ disabled: false }), { timeout: 5000 });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      online = true; // связь вернулась: досылка при закрытии экрана проходит, и повторы после теста кончаются (даже если проверка выше упала)
      release();
    }
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
