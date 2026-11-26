// «Ошибки» и «Прогресс» CSCA как на вебе (math/review/page.tsx, ReviewRunner.tsx, math/progress/page.tsx). Экраны идут по
// настоящему пути приложения (RPC-слой, разборщики веба) на поддельном транспорте; данные синтетические.
import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo } from "react-native";

import { CscaProgressScreen } from "@/features/learning/csca/CscaProgressScreen";
import { CscaReviewScreen, reviewOutcome } from "@/features/learning/csca/CscaReviewScreen";
import type { RpcTransport } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, failure } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));

beforeEach(() => {
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.dismissTo).mockClear();
});

/** Ответ сервера с ошибкой и текстом, как его отдаёт PostgREST: из текста слой берёт только имя из закрытого списка. */
const serverError = (code: string, message?: string, status = 400) => ({ code, message, status });

async function openReview(handlers: Record<string, unknown>, errors: Record<string, ReturnType<typeof serverError>> = {}) {
  const { transport: base, calls } = fakeTransport(handlers);
  const transport: RpcTransport = async (name, args, options) => {
    const error = errors[name];
    if (!error) return base(name, args, options);
    calls.push({ name, args: args as Record<string, unknown> | undefined, get: options.get });
    return { data: null, error: { code: error.code, message: error.message }, status: error.status };
  };
  await renderPortal(<CscaReviewScreen />, testApi(transport));
  return { calls };
}

const due = (count = 6, change: (raw: Record<string, any>) => void = () => undefined) => {
  const raw = fx("csca_review_v2_due");
  raw.items = raw.items.slice(0, count);
  raw.dueCount = count;
  change(raw);
  return raw;
};

describe("«Ошибки»: вводная и пустое состояние", () => {
  it("вводная об интервалах 1, 3, 7 и 14 дней стоит над заданиями", async () => {
    await openReview({ learning_review_v2: due() });
    // Вводная стоит и пока данные грузятся, поэтому ждём то, что приходит с данными, а не вводную.
    expect(await screen.findByTestId("review-progress")).toHaveTextContent("Повторено 0 из 6 · Интервал 1 из 4", { exact: false });
    expect(screen.getByTestId("review-lead")).toHaveTextContent("Задания, где вы ошиблись, возвращаются через 1, 3, 7 и 14 дней.", { exact: false });
  });

  it("нечего повторять, но в банке есть задания: дата следующего повторения и «К темам» ведёт к занятиям", async () => {
    await openReview({ learning_review_v2: due(0, (raw) => { raw.nextDueOn = "2026-10-17"; raw.activeCount = 6; }) });
    expect(await screen.findByText("На сегодня повторять нечего")).toBeTruthy();
    expect(screen.getByText("Следующее повторение 17 октября. В банке заданий: 6.")).toBeTruthy();
    expect(screen.getByTestId("review-lead")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("review-to-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
  });

  it("банк пуст: «Банк ошибок пуст…», а не «Сегодня повторять нечего»", async () => {
    await openReview({ learning_review_v2: due(0, (raw) => { raw.activeCount = 0; raw.nextDueOn = null; }) });
    expect(await screen.findByText(/Банк ошибок пуст/)).toBeTruthy();
    expect(screen.queryByText("Сегодня повторять нечего")).toBeNull();
  });

  it("сбой чтения: плашка с повтором, вводная на месте", async () => {
    await openReview({ learning_review_v2: failure("XX000", 500) });
    expect(await screen.findByTestId("review-load-error")).toBeTruthy();
    expect(screen.getByTestId("review-lead")).toBeTruthy();
  });
});

describe("«Ошибки»: ответ", () => {
  it("неверный ответ: вердикт озвучен, «Задание вернётся завтра», дальше следующее", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { calls } = await openReview({ learning_review_v2: due(), record_learning_review_v1: fx("csca_record_review_first") });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    expect(await screen.findByTestId("review-next-due")).toHaveTextContent("Задание вернётся завтра.");
    expect(calls.find((call) => call.name === "record_learning_review_v1")?.args).toMatchObject({ p_item_key: "csca-math-exp-log-001", p_answer: { selected: "a" } });
    // Читалка слышит весь вердикт: слово и верный вариант, а не одно слово; живой области у блока нет (Android сказал бы то же второй раз).
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Неверно. Верный ответ: B");
    expect(screen.getByTestId("verdict").props.accessibilityLiveRegion).toBe("none");
    expect(screen.getByTestId("review-progress")).toHaveTextContent("Повторено 1 из 6", { exact: false });
    await fireEvent.press(screen.getByTestId("review-next"));
    expect(screen.getByTestId("review-progress")).toHaveTextContent("Повторено 1 из 6 · Интервал 1 из 4", { exact: false });
    announce.mockRestore();
  });

  it("верный ответ: «Следующий повтор 19 октября» и озвучено «Верно»", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await openReview({ learning_review_v2: due(), record_learning_review_v1: fx("csca_record_review_correct") });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-b"));
    await fireEvent.press(screen.getByTestId("review-check"));
    expect(await screen.findByTestId("review-next-due")).toHaveTextContent("Следующий повтор 19 октября.");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Верно");
    // Интервал после ответа берётся из квитанции.
    expect(screen.getByTestId("review-progress")).toHaveTextContent("Интервал 2 из 4", { exact: false });
    announce.mockRestore();
  });

  it("исход: выучено, верно со сроком, неверно (веб: `outcome`)", () => {
    const text = { retired: "выучено", tomorrow: "завтра", nextDue: (date: string) => `в ${date}` };
    const base = { itemKey: "k", explain: {} as never, box: 2, lapses: 0 };
    expect(reviewOutcome({ ...base, correct: true, dueOn: "2026-10-19", retired: false }, text)).toBe("в 2026-10-19");
    expect(reviewOutcome({ ...base, correct: false, dueOn: "2026-10-17", retired: false }, text)).toBe("завтра");
    expect(reviewOutcome({ ...base, correct: true, dueOn: null, retired: true }, text)).toBe("выучено");
  });

  it("набор заданий фиксируется при открытии: перечитанный банк не сдвигает экран", async () => {
    let reads = 0;
    await openReview({
      learning_review_v2: () => {
        reads += 1;
        // Первое чтение: шесть заданий. После ответа банк перечитывается и первое задание уже не «на сегодня».
        return reads === 1 ? due() : due(5, (raw) => (raw.items = raw.items.slice(1)));
      },
      record_learning_review_v1: fx("csca_record_review_first"),
    });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    await screen.findByTestId("review-next-due");
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    // Вердикт первого задания на месте, число заданий прежнее.
    expect(screen.getByTestId("review-next-due")).toBeTruthy();
    expect(screen.getByText("Задание 1 из 6")).toBeTruthy();
  });

  it("последний ответ: итог «Верно N из M» и «К темам» ведёт к занятиям", async () => {
    await openReview({ learning_review_v2: due(1), record_learning_review_v1: fx("csca_record_review_correct") });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    await screen.findByTestId("review-next-due");
    expect(screen.getByTestId("review-next")).toHaveTextContent("К итогу");
    await fireEvent.press(screen.getByTestId("review-next"));
    expect(screen.getByTestId("review-done")).toHaveTextContent("Повторение на сегодня закончено");
    expect(screen.getByText("Верно 1 из 1.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("review-done-topics"));
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/csca", params: { view: "lessons" } });
  });

  it("срок задания не наступил: текст без слов «Обновите страницу»", async () => {
    await openReview({ learning_review_v2: due() }, { record_learning_review_v1: serverError("22023", "learning_review_not_due") });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    const alert = await screen.findByTestId("review-error");
    expect(alert).toHaveTextContent("Срок этого задания ещё не наступил. Откройте повторение заново.", { exact: false });
    expect(alert).not.toHaveTextContent(/страниц/);
  });

  it("ответ не принят: текст без слов «Обновите страницу»", async () => {
    await openReview({ learning_review_v2: due() }, { record_learning_review_v1: serverError("22023", "Invalid learning request") });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    const alert = await screen.findByTestId("review-error");
    expect(alert).toHaveTextContent("Ответ не принят. Откройте повторение заново.", { exact: false });
    expect(alert).not.toHaveTextContent(/страниц/);
  });

  it("сервер не ответил: в плашке «Повторить», повтор идёт тем же запросом", async () => {
    const { calls } = await openReview({
      learning_review_v2: due(),
      // Первый ответ ошибка сервера (его слой повторами не гасит), второй нормальный.
      record_learning_review_v1: (_args: unknown, call: number) => (call === 1 ? failure("XX000", 500) : fx("csca_record_review_first")),
    });
    await screen.findByTestId("review-progress");
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("review-check"));
    await screen.findByTestId("review-error");
    await fireEvent.press(screen.getByText("Повторить"));
    await screen.findByTestId("review-next-due");
    const sent = calls.filter((call) => call.name === "record_learning_review_v1").map((call) => call.args?.p_request_id);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
  });
});

async function openProgress(handlers: Record<string, unknown>) {
  const { transport } = fakeTransport(handlers);
  await renderPortal(<CscaProgressScreen />, testApi(transport));
}

describe("«Прогресс»", () => {
  const full = { learning_track_progress_v1: fx("csca_progress"), learning_track_home_v1: fx("csca_home_after") };

  it("охват с полосой, серия, темп с полосой и меткой ориентира, банк ошибок", async () => {
    await openProgress(full);
    expect(await screen.findByTestId("progress-coverage")).toHaveTextContent("Темы с пройденным уроком: 1 из 28");
    expect(screen.getByTestId("progress-coverage-meter", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("progress-streak")).toHaveTextContent("Сейчас: 1");
    expect(screen.getByText(/Лучшая серия: 1\. День засчитывается/)).toBeTruthy();
    expect(screen.getByTestId("progress-pace")).toHaveTextContent("В среднем 52 с на задание. Ориентир экзамена 75 с.");
    expect(screen.getByTestId("progress-pace-meter", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("progress-bank")).toHaveTextContent("Сегодня: 0. Всего в банке: 6. Выучено: 0.");
  });

  it("ссылка «Повторить ошибки» только когда есть что повторять", async () => {
    await openProgress(full);
    await screen.findByTestId("progress-bank");
    expect(screen.queryByTestId("progress-review-link")).toBeNull();
  });

  it("есть что повторять: ссылка ведёт к ошибкам", async () => {
    const progress = fx("csca_progress");
    progress.review.dueCount = 3;
    await openProgress({ ...full, learning_track_progress_v1: progress });
    await fireEvent.press(await screen.findByTestId("progress-review-link"));
    expect(router.navigate).toHaveBeenCalledWith("/csca/review");
  });

  it("темпа ещё нет: «Темп появится после теста на время» без полосы", async () => {
    const progress = fx("csca_progress");
    progress.pace = { avgSeconds: null, budgetSeconds: 75, answeredWithTime: 0 };
    await openProgress({ ...full, learning_track_progress_v1: progress });
    expect(await screen.findByTestId("progress-pace")).toHaveTextContent("Темп появится после теста на время.");
    expect(screen.queryByTestId("progress-pace-meter", { includeHiddenElements: true })).toBeNull();
  });

  it("темы по модулям программы в порядке программы, у каждого модуля полоса по клетке на тему", async () => {
    await openProgress(full);
    const second = within(await screen.findByTestId("progress-section-2"));
    expect(second.getByText("Модуль 2")).toBeTruthy();
    expect(second.getByText("Функции")).toBeTruthy();
    expect(second.getAllByTestId(/^strip-/, { includeHiddenElements: true })).toHaveLength(11);
    expect(screen.getByTestId("progress-section-1")).toBeTruthy();
    expect(screen.getByTestId("progress-section-4")).toBeTruthy();
  });

  it("строка темы: «Ответов: N, верно M» и «урок пройден»; без ответов пусто", async () => {
    await openProgress(full);
    const done = within(await screen.findByTestId("progress-topic-m2-exp-log"));
    expect(done.getByText("Ответов: 5, верно 0 · урок пройден")).toBeTruthy();
    const some = within(screen.getByTestId("progress-topic-m2-derivative"));
    expect(some.getByText("Ответов: 1, верно 0")).toBeTruthy();
    const none = within(screen.getByTestId("progress-topic-m3-line-circle"));
    expect(none.queryByText(/Ответов/)).toBeNull();
    expect(none.getByText("Не начато")).toBeTruthy();
    // Старого «Ответов: 0, верно 0» нет нигде.
    expect(screen.queryByText("Ответов: 0, верно 0")).toBeNull();
  });

  it("история: дата без года по Бишкеку, итог, как завершён, «Разбор» ведёт к попытке", async () => {
    const progress = fx("csca_progress");
    progress.tests[0].completedAt = "2026-10-16T18:30:00+00:00";
    await openProgress({ ...full, learning_track_progress_v1: progress });
    const row = await screen.findByTestId("history-94c6025a-01d2-4d16-a9ee-ee0466ae6495");
    expect(row).toHaveTextContent("Диагностика · 0 из 3", { exact: false });
    expect(row).toHaveTextContent("17 октября · Завершён вами", { exact: false });
    expect(row).not.toHaveTextContent("2026");
    await fireEvent.press(row);
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: "/csca/test/[formId]", params: { formId: "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2", attempt: "94c6025a-01d2-4d16-a9ee-ee0466ae6495" } });
  });

  it("подпись «оценка EVO, а не балл CSCA» под историей; даты сегодняшнего дня внизу больше нет", async () => {
    await openProgress(full);
    expect(await screen.findByTestId("progress-caption")).toHaveTextContent("Это оценка EVO по нашим заданиям, а не балл CSCA.");
    expect(screen.queryByText(/16 октября 2026/)).toBeNull();
  });

  it("тестов нет: «Пройденных тестов пока нет», подпись остаётся", async () => {
    const progress = fx("csca_progress");
    progress.tests = [];
    await openProgress({ ...full, learning_track_progress_v1: progress });
    expect(await screen.findByText("Пройденных тестов пока нет.")).toBeTruthy();
    expect(screen.getByTestId("progress-caption")).toBeTruthy();
  });

  it("главная не прочиталась: темы всё равно видны по номерам модулей, а название темы это её ключ", async () => {
    await openProgress({ learning_track_progress_v1: fx("csca_progress"), learning_track_home_v1: failure("XX000", 500) });
    const section = within(await screen.findByTestId("progress-section-2"));
    expect(section.getByText("Модуль 2")).toBeTruthy();
    expect(section.getByText("m2-exp-log")).toBeTruthy();
  });

  it("сбой чтения прогресса: плашка с повтором, вводная на месте", async () => {
    await openProgress({ learning_track_progress_v1: failure("XX000", 500), learning_track_home_v1: fx("csca_home_after") });
    expect(await screen.findByTestId("progress-load-error")).toBeTruthy();
    expect(screen.getByText("Темы считаются по вашим ответам, тесты по нашим заданиям.")).toBeTruthy();
  });
});
