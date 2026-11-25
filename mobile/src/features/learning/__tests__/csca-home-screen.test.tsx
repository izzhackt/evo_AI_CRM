// Главная CSCA как на вебе: вкладки «Об экзамене» (по умолчанию) и «Занятия», следующий шаг со значками, плитки-ссылки,
// строки тестов, модули-аккордеоны; календарь сессий и вопросы на «Об экзамене»; подпись фото с автором и лицензией.
// Экран идёт по настоящему пути приложения (RPC-слой, разборщики веба) на поддельном транспорте; данные синтетические.
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking, ScrollView } from "react-native";

import { CscaHomeScreen, cscaTabFromParam } from "@/features/learning/csca/CscaHomeScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

// Параметры маршрута как внешнее хранилище: тест меняет `?view=` у открытого экрана, как это делает новая ссылка.
let mockSnapshot: { view?: string } = {};
const mockListeners = new Set<() => void>();
const setView = (view?: string) => {
  mockSnapshot = view === undefined ? {} : { view };
  mockListeners.forEach((listener) => listener());
};
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), setParams: jest.fn(), push: jest.fn(), back: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: () =>
    jest.requireActual<typeof import("react")>("react").useSyncExternalStore(
      (listener: () => void) => {
        mockListeners.add(listener);
        return () => mockListeners.delete(listener);
      },
      () => mockSnapshot,
    ),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const homeAfter = (change: (raw: Record<string, any>) => void = () => undefined) => {
  const raw = fx("csca_home_after");
  change(raw);
  return raw;
};

async function open(home: unknown = homeAfter(), extra: Record<string, unknown> = {}, lang: "ru" | "ky" = "ru") {
  const { transport, calls } = fakeTransport({ learning_track_home_v1: home, ...extra });
  const view = await renderPortal(<CscaHomeScreen />, testApi(transport), lang);
  return { ...view, calls };
}

beforeEach(() => {
  setView(undefined);
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.setParams).mockClear();
});

describe("вкладки: как на вебе", () => {
  it("без параметра открыта «Об экзамене», выбор вкладки не запоминается", async () => {
    await open();
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
    expect(screen.queryByTestId("csca-lessons")).toBeNull();
    expect(screen.getByTestId("csca-tab-about").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("csca-tab-lessons").props.accessibilityState).toMatchObject({ selected: false });
    // Группа вкладок названа для читалки, роль вкладок.
    expect(screen.getByTestId("csca-tab-group").props.accessibilityRole).toBe("tablist");
    expect(screen.getByTestId("csca-tab-group").props.accessibilityLabel).toBe("Разделы CSCA");
  });

  it("заголовок «CSCA» с полным названием экзамена, «Об экзамене» первая вкладка", async () => {
    await open();
    expect(await screen.findByTestId("title-csca")).toHaveTextContent("CSCA");
    expect(screen.getByText("China Scholastic Competency Assessment")).toBeTruthy();
    const order = screen.getByTestId("csca-tab-group").children.map((child) => (typeof child === "object" && "props" in child ? (child.props as { testID?: string }).testID : null));
    expect(order).toEqual(["csca-tab-about", "csca-tab-lessons"]);
  });

  it("?view=lessons открывает «Занятия»", async () => {
    setView("lessons");
    await open();
    expect(await screen.findByTestId("csca-lessons")).toBeTruthy();
    expect(screen.queryByTestId("csca-overview")).toBeNull();
    expect(screen.getByTestId("csca-tab-lessons").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("нажатие на вкладку открывает её и повторяет в параметре, чтобы следующая ссылка «К темам» меняла значение", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    await fireEvent.press(screen.getByTestId("csca-tab-lessons"));
    expect(await screen.findByTestId("csca-lessons")).toBeTruthy();
    expect(router.setParams).toHaveBeenLastCalledWith({ view: "lessons" });
    await fireEvent.press(screen.getByTestId("csca-tab-about"));
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
    expect(router.setParams).toHaveBeenLastCalledWith({ view: "about" });
  });

  it("другая вкладка читается с начала: прокрутка возвращается к нулю; та же вкладка прокрутку не трогает", async () => {
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    scrollTo.mockClear();
    await open();
    await screen.findByTestId("csca-overview");
    await fireEvent.press(screen.getByTestId("csca-tab-lessons"));
    expect(scrollTo.mock.calls).toEqual([[{ y: 0, animated: false }]]);
    await fireEvent.press(screen.getByTestId("csca-tab-lessons"));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("csca-tab-about"));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("новая ссылка на открытый раздел меняет вкладку", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    await act(async () => setView("lessons"));
    expect(await screen.findByTestId("csca-lessons")).toBeTruthy();
    // И обратно: ссылка без параметра возвращает «Об экзамене».
    await act(async () => setView(undefined));
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
  });

  it("внизу обеих вкладок: «Все задания написаны EVO», программа экзамена и лицензии", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    const footer = () => within(screen.getByTestId("csca-footer"));
    expect(footer().getByText(/Все задания написаны EVO/)).toBeTruthy();
    await waitFor(() => expect(footer().getByTestId("syllabus-link")).toBeTruthy());
    expect(footer().getByTestId("licenses-open")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("csca-tab-lessons"));
    await screen.findByTestId("csca-lessons");
    expect(footer().getByTestId("syllabus-link")).toBeTruthy();
    // Ни вводной строки под заголовком, ни «Сейчас в EVO математика»: веб их убрал.
    expect(screen.queryByText(/Уроки, практика и тесты на время по программе/)).toBeNull();
    expect(screen.queryByText(/Сейчас в EVO математика/)).toBeNull();
  });
});

describe("параметр ?view=", () => {
  it.each([
    ["lessons", "lessons"],
    [undefined, "about"],
    ["about", "about"],
    ["", "about"],
    ["Lessons", "about"],
    ["lessons ", "about"],
    ["unknown", "about"],
    [["lessons"], "lessons"],
    [["lessons", "about"], "lessons"],
    [["about", "lessons"], "about"],
    [[], "about"],
  ] as [string | string[] | undefined, string][])("%j открывает «%s»", (view, tab) => {
    expect(cscaTabFromParam(view)).toBe(tab);
  });
});

describe("«Занятия»", () => {
  beforeEach(() => {
    setView("lessons");
  });

  it("следующий шаг: «Следующий шаг: название», значки и красная кнопка по состоянию", async () => {
    await open();
    const title = await screen.findByTestId("next-step-title");
    expect(title).toHaveTextContent("Следующий шаг: Показательная и логарифмическая функции");
    expect(screen.getByText("В этой теме пока больше ошибок, чем верных ответов.")).toBeTruthy();
    const meta = within(screen.getByTestId("next-step-meta"));
    expect(meta.getByText("Практика")).toBeTruthy();
    expect(meta.getByText("5 мин")).toBeTruthy();
    expect(meta.getByText("Заданий: 3")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("next-step-action"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: "22f0395c-b56d-5da0-8667-adec8f92a4e2" } });
    expect(screen.getByTestId("next-step-action")).toHaveTextContent("Начать практику");
  });

  it("три плитки ведут в прогресс, к ошибкам и к календарю сессий", async () => {
    await open();
    await screen.findByTestId("tile-topics");
    expect(screen.getByTestId("tile-topics").props.accessibilityLabel).toBe("Темы: 1 / 28. С пройденным уроком");
    expect(screen.getByTestId("tile-review").props.accessibilityLabel).toBe("Ошибки: 0. К повторению сегодня");
    expect(screen.getByTestId("tile-exam").props.accessibilityLabel).toBe("Ближайший экзамен: 29 дней. 14 и 15 ноября 2026 г.");
    await fireEvent.press(screen.getByTestId("tile-topics"));
    expect(router.navigate).toHaveBeenLastCalledWith("/csca/progress");
    await fireEvent.press(screen.getByTestId("tile-review"));
    expect(router.navigate).toHaveBeenLastCalledWith("/csca/review");
  });

  it("плитка экзамена открывает «Об экзамене» к блоку сессий", async () => {
    await open();
    await screen.findByTestId("tile-exam");
    await fireEvent.press(screen.getByTestId("tile-exam"));
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
    expect(router.setParams).toHaveBeenLastCalledWith({ view: "about" });
    expect(await screen.findByTestId("sessions-block")).toBeTruthy();
  });

  it("плитка экзамена после перехода прокручивает к блоку сессий по местам блоков, один раз", async () => {
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    scrollTo.mockClear();
    await open();
    await screen.findByTestId("tile-exam");
    await fireEvent.press(screen.getByTestId("tile-exam"));
    await screen.findByTestId("sessions-block");
    // Экран сообщает места блоков: корень 16, вкладка 120 внутри него, календарь 300 внутри вкладки.
    const at = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 358, height: 100 } } });
    await fireEvent(screen.getByTestId("csca-screen"), "layout", at(16));
    await fireEvent(screen.getByTestId("csca-about"), "layout", at(120));
    await fireEvent(screen.getByTestId("sessions-block"), "layout", at(300));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 120 + 300 - 8, animated: true }));
    // Два вызова: смена вкладки читается с начала, затем прокрутка к блоку сессий.
    expect(scrollTo.mock.calls).toEqual([[{ y: 0, animated: false }], [{ y: 16 + 120 + 300 - 8, animated: true }]]);
    // Повторное сообщение о месте блока (поворот, подгрузка) экран не прокручивает.
    await fireEvent(screen.getByTestId("sessions-block"), "layout", at(310));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("плитка экзамена без сессий не оставляет прокрутку «на потом»: сессии, пришедшие позже, экран не прокручивают", async () => {
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    let current = homeAfter((raw) => (raw.sessions = []));
    const { client } = await open(() => current);
    await fireEvent.press(await screen.findByTestId("tile-exam"));
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
    expect(screen.queryByTestId("sessions-block")).toBeNull();
    // Сессии появились позже (обновление данных): блок встаёт на место и сообщает о нём.
    current = homeAfter();
    scrollTo.mockClear();
    await act(async () => {
      await client.invalidateQueries();
    });
    const block = await screen.findByTestId("sessions-block");
    const at = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 358, height: 100 } } });
    await fireEvent(screen.getByTestId("csca-screen"), "layout", at(16));
    await fireEvent(screen.getByTestId("csca-about"), "layout", at(120));
    await fireEvent(block, "layout", at(300));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("плитка экзамена без сессий впереди: «Даты не опубликованы»", async () => {
    await open(homeAfter((raw) => (raw.sessions = [])));
    const tile = await screen.findByTestId("tile-exam");
    expect(tile.props.accessibilityLabel).toBe("Ближайший экзамен. Даты не опубликованы");
  });

  it("тесты на время: строка с ссылкой на разбор по дню Бишкека и кнопки по состоянию", async () => {
    await open(homeAfter((raw) => (raw.tests[0].lastResult.completedAt = "2026-10-16T18:30:00+00:00")));
    await screen.findByTestId("test-row-csca-math-diagnostic-1");
    const last = screen.getByTestId("test-last-csca-math-diagnostic-1");
    expect(last).toHaveTextContent("17 октября: верно 0 из 3");
    await fireEvent.press(last);
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: "/csca/test/[formId]", params: { formId: "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2", attempt: "94c6025a-01d2-4d16-a9ee-ee0466ae6495" } });
    expect(screen.getByTestId("test-open-csca-math-diagnostic-1")).toHaveTextContent("Пройти ещё раз");
    expect(screen.getByTestId("test-open-csca-math-mock-1")).toHaveTextContent("Продолжить");
    // Отдельной кнопки «Разбор» и слов «Можно завершить раньше» больше нет.
    expect(screen.queryByText("Разбор")).toBeNull();
    expect(screen.queryByText(/Можно завершить раньше|Без досрочной сдачи/)).toBeNull();
    await fireEvent.press(screen.getByTestId("test-open-csca-math-mock-1"));
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: "/csca/test/[formId]", params: { formId: expect.any(String) } });
  });

  it("программа: модуль следующего шага раскрыт, остальные свёрнуты; «Пройдено X из Y»", async () => {
    await open();
    await screen.findByTestId("csca-program");
    expect(within(screen.getByTestId("module-2")).getByText("Пройдено 1 из 11")).toBeTruthy();
    expect(screen.getByTestId("topic-m2-exp-log")).toBeTruthy();
    expect(screen.getByTestId("topic-m2-derivative")).toBeTruthy();
    // Модуль 3 свёрнут: его тема с уроками видна только после нажатия на заголовок.
    expect(screen.queryByTestId("topic-m3-line-circle")).toBeNull();
    expect(screen.getByTestId("module-toggle-3").props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(screen.getByTestId("module-toggle-3"));
    expect(screen.getByTestId("topic-m3-line-circle")).toBeTruthy();
    expect(screen.getByTestId("module-toggle-3").props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("тема одной строкой: слово состояния и кнопки урока и практики с минутами и отметкой", async () => {
    await open();
    const topic = within(await screen.findByTestId("topic-m2-exp-log"));
    expect(topic.getByText("Пробел")).toBeTruthy();
    const lesson = screen.getByTestId("lesson-csca-math-m2-exp-log-l1");
    expect(lesson).toHaveTextContent(/^Урок/);
    expect(lesson).toHaveTextContent(/15 мин · Пройден$/);
    await fireEvent.press(screen.getByTestId("lesson-csca-math-m2-exp-log-p1"));
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: "22f0395c-b56d-5da0-8667-adec8f92a4e2" } });
    // Ни «Верно N из M последних», ни «Верно N из M» у урока в строке нет.
    expect(screen.queryByText(/последних/)).toBeNull();
  });

  it("темы без уроков одной строкой внутри модуля, список открывается по нажатию", async () => {
    await open();
    await screen.findByTestId("topic-m2-exp-log");
    expect(screen.getByText("Темы без уроков: 9")).toBeTruthy();
    expect(screen.queryByTestId("topic-m2-func-basics")).toBeNull();
    await fireEvent.press(screen.getByTestId("quiet-toggle-2"));
    expect(screen.getByTestId("topic-m2-func-basics")).toBeTruthy();
    expect(screen.getByTestId("quiet-toggle-2").props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("описаний тем, «Около N из 48 заданий» и «Сегодня повторять нечего» на экране нет", async () => {
    await open();
    await screen.findByTestId("csca-program");
    expect(screen.queryByText(/Около \d+ из 48/)).toBeNull();
    expect(screen.queryByText(/Состояние темы считается/)).toBeNull();
    expect(screen.queryByText("Сегодня повторять нечего")).toBeNull();
    expect(screen.queryByText("Весь прогресс")).toBeNull();
  });

  it("сбой чтения: плашка с повтором; нет модулей: «Материалы готовятся»", async () => {
    await open(failure("XX000", 500));
    expect(await screen.findByTestId("csca-error")).toBeTruthy();
    // Обзор при этом не зависит от сети: вкладка «Об экзамене» открывается.
    await fireEvent.press(screen.getByTestId("csca-tab-about"));
    expect(await screen.findByTestId("csca-overview")).toBeTruthy();
  });

  it("нет модулей в ответе: пустое состояние", async () => {
    await open(homeAfter((raw) => {
      raw.modules = [];
      raw.topics = [];
      raw.lessons = [];
      raw.tests = [];
      raw.nextStep = null;
      raw.sessions = [];
    }));
    expect(await screen.findByText("Материалы готовятся")).toBeTruthy();
    expect(screen.queryByTestId("syllabus-link")).toBeNull();
  });
});

describe("«Об экзамене»: календарь сессий на этой же вкладке", () => {
  it("три сессии на виду, остальные под «Ещё сессии: N»; дата проверки самая поздняя", async () => {
    await open(homeAfter((raw) => (raw.sessions[5].verifiedOn = "2026-10-20")));
    const block = within(await screen.findByTestId("sessions-block"));
    expect(block.getByText("Даты экзамена с csca.cn (проверено 20 октября 2026 г.). Регистрацию и правила уточняйте на сайте экзамена.")).toBeTruthy();
    expect(block.getByText("6")).toBeTruthy();
    for (const key of ["2026-11", "2026-12", "2027-01"]) expect(screen.getByTestId(`session-${key}`)).toBeTruthy();
    expect(screen.queryByTestId("session-2027-03")).toBeNull();
    expect(block.getByText("Ещё сессии: 3")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("sessions-more"));
    for (const key of ["2027-03", "2027-04", "2027-06"]) expect(screen.getByTestId(`session-${key}`)).toBeTruthy();
  });

  it("выбранная сессия дальше третьей видна сразу", async () => {
    await open(homeAfter((raw) => (raw.targetSessionKey = "2027-04")));
    await screen.findByTestId("sessions-block");
    expect(screen.getByTestId("session-2027-04")).toBeTruthy();
    expect(screen.queryByTestId("session-2027-06")).toBeNull();
    expect(screen.getByText("Ещё сессии: 1")).toBeTruthy();
  });

  it("выбранная: «Моя сессия», дни до экзамена с этапом плана и «Сбросить»; у остальных «Готовлюсь к этой»", async () => {
    await open();
    const chosen = within(await screen.findByTestId("session-2026-11"));
    expect(chosen.getByText("Моя сессия")).toBeTruthy();
    expect(chosen.getByText("До экзамена дней: 29")).toBeTruthy();
    // 29 дней до экзамена: этап «Основа» (до 28 дней начинаются слабые места, до 7 пробные тесты).
    expect(chosen.getByText(/Основа: темы и уроки/)).toBeTruthy();
    expect(chosen.getByTestId("session-clear")).toHaveTextContent("Сбросить");
    const other = screen.getByTestId("session-choose-2026-12");
    expect(other).toHaveTextContent("Готовлюсь к этой");
    expect(other.props.accessibilityLabel).toBe("Готовлюсь к этой: 19 и 20 декабря 2026 г.");
    // Дни до экзамена показаны только у выбранной.
    expect(within(screen.getByTestId("session-2026-12")).queryByText(/До экзамена дней/)).toBeNull();
  });

  it("окно регистрации: срок словом и ссылка на csca.cn только у открытой регистрации", async () => {
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await open(homeAfter((raw) => {
      raw.today = "2026-10-16";
      raw.serverNow = "2026-10-16T10:00:00+00:00";
    }));
    const first = within(await screen.findByTestId("session-2026-11"));
    expect(first.getByText(/Регистрация до 21 октября.*21:59 \(время Бишкека\)/)).toBeTruthy();
    expect(first.getByText("закрывается через 5 дней")).toBeTruthy();
    await fireEvent.press(first.getByText("Регистрация на csca.cn"));
    expect(spy).toHaveBeenCalledWith("https://csca.cn");
    expect(within(screen.getByTestId("session-2026-12")).getByText("Окно регистрации ещё не опубликовано")).toBeTruthy();
    expect(within(screen.getByTestId("session-2026-12")).queryByText("Регистрация на csca.cn")).toBeNull();
    spy.mockRestore();
  });

  it("выбор сессии: запрос с её ключом, строка становится выбранной", async () => {
    const { calls } = await open(homeAfter(), { set_learning_target_session_v1: { targetSessionKey: "2026-12" } });
    await screen.findByTestId("sessions-block");
    await fireEvent.press(screen.getByTestId("session-choose-2026-12"));
    await waitFor(() => expect(within(screen.getByTestId("session-2026-12")).getByText("Моя сессия")).toBeTruthy());
    expect(calls.find((call) => call.name === "set_learning_target_session_v1")?.args).toEqual({ p_track: "csca-math", p_session_key: "2026-12" });
    expect(within(screen.getByTestId("session-2026-11")).queryByText("Моя сессия")).toBeNull();
  });

  it("сбой выбора: плашка, выбор прежний", async () => {
    await open(homeAfter(), { set_learning_target_session_v1: failure("XX000", 500) });
    await screen.findByTestId("sessions-block");
    await fireEvent.press(screen.getByTestId("session-choose-2026-12"));
    expect(await screen.findByTestId("sessions-error")).toBeTruthy();
    expect(within(screen.getByTestId("session-2026-11")).getByText("Моя сессия")).toBeTruthy();
  });

  it("календаря отдельным экраном больше нет, а сессий нет совсем: блока нет", async () => {
    await open(homeAfter((raw) => (raw.sessions = [])));
    await screen.findByTestId("csca-overview");
    await waitFor(() => expect(screen.queryByTestId("sessions-skeleton")).toBeNull());
    expect(screen.queryByTestId("sessions-block")).toBeNull();
  });
});

describe("«Об экзамене»: обзор", () => {
  it("вопросы свёрнуты; ответ «Когда проходит экзамен?» ведёт к блоку сессий", async () => {
    await open();
    await screen.findByTestId("sessions-block");
    const answer = "Даты сессий публикует csca.cn. Ближайшие сессии и сроки регистрации собраны на этой странице";
    expect(screen.queryByText(new RegExp(answer))).toBeNull();
    await fireEvent.press(screen.getByTestId("faq-toggle-dates"));
    expect(screen.getByText(new RegExp(answer))).toBeTruthy();
    expect(screen.getByTestId("faq-toggle-dates").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId("faq-sessions")).toHaveTextContent("К сессиям CSCA");
    // Нажатие не уводит на другой экран: прокрутка внутри вкладки к календарю.
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    scrollTo.mockClear();
    const at = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 358, height: 100 } } });
    await fireEvent(screen.getByTestId("csca-screen"), "layout", at(16));
    await fireEvent(screen.getByTestId("csca-about"), "layout", at(120));
    await fireEvent(screen.getByTestId("sessions-block"), "layout", at(300));
    await fireEvent.press(screen.getByTestId("faq-sessions"));
    expect(scrollTo).toHaveBeenCalledWith({ y: 428, animated: true });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("без календаря (сеть недоступна) ответ про даты короткий, без ссылки", async () => {
    await open(failure("XX000", 500));
    await screen.findByTestId("csca-overview");
    await waitFor(() => expect(screen.queryByTestId("sessions-skeleton")).toBeNull());
    await fireEvent.press(screen.getByTestId("faq-toggle-dates"));
    expect(screen.getByText("Даты сессий и сроки регистрации публикует csca.cn.")).toBeTruthy();
    expect(screen.queryByTestId("faq-sessions")).toBeNull();
  });

  it("предметы: английское название и название на языке студента, общие факты группы один раз", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    expect(screen.getByText("Professional Chinese")).toBeTruthy();
    expect(screen.getByText("профессиональный китайский")).toBeTruthy();
    expect(screen.getByText("Fundamental Subjects")).toBeTruthy();
    expect(screen.getByTestId("group-facts-fundamental-subjects")).toBeTruthy();
  });

  it("стоимость таблицей: заголовок столбцов и суммы", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    expect(screen.getByText("Число предметов")).toBeTruthy();
    expect(screen.getByText("Взнос, CNY")).toBeTruthy();
    expect(within(screen.getByTestId("fee-one")).getByText("450")).toBeTruthy();
    expect(within(screen.getByTestId("fee-two-or-more")).getByText("700")).toBeTruthy();
  });

  it("сводки «Нужен для бакалавриата в 306 вузах CSC. 5 предметов…» над текстом больше нет", async () => {
    await open();
    await screen.findByTestId("csca-overview");
    expect(screen.queryByText(/Нужен для бакалавриата в 306 вузах CSC\. 5 предметов/)).toBeNull();
    expect(screen.getByText("Новый единый стандартизированный тест для иностранных абитуриентов бакалавриата.")).toBeTruthy();
  });

  it("подпись фото: «©» открывает автора и лицензию со ссылками на страницу фото и на лицензию", async () => {
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await open();
    await screen.findByTestId("csca-overview");
    const [hero] = screen.getAllByTestId("photo-credit-toggle");
    expect(hero.props.accessibilityLabel).toBe("Автор и лицензия фото");
    expect(screen.queryByTestId("photo-credit")).toBeNull();
    await fireEvent.press(hero);
    const credit = within(screen.getByTestId("photo-credit"));
    expect(screen.getByTestId("photo-credit")).toHaveTextContent("Фото: Oli Liao, Pexels License");
    await fireEvent.press(credit.getByText("Oli Liao"));
    expect(spy).toHaveBeenLastCalledWith("https://www.pexels.com/photo/historic-building-at-sichuan-university-chengdu-37333836/");
    await fireEvent.press(credit.getByText("Pexels License"));
    expect(spy).toHaveBeenLastCalledWith("https://www.pexels.com/license/");
    spy.mockRestore();
  });

  it("KY: названия вкладок, заголовки и подпись фото на кыргызском", async () => {
    await open(homeAfter(), {}, "ky");
    await screen.findByTestId("csca-overview");
    expect(screen.getByTestId("csca-tab-about")).toHaveTextContent("Экзамен жөнүндө");
    expect(screen.getByTestId("csca-tab-lessons")).toHaveTextContent("Сабактар");
    await fireEvent.press(screen.getAllByTestId("photo-credit-toggle")[0]);
    expect(screen.getByTestId("photo-credit")).toHaveTextContent("Сүрөт: Oli Liao, Pexels License");
  });
});
