// «Повторение ошибок» как на сайте (G53, G54 и ревью #1567): модуль из ссылки, проверка ответа сразу сервером, вместо формы формулировка
// и разбор, вердикт и номер задания слышит читалка, «Далее» прокручивает наверх, четыре кода ошибки сайта, пустой банк со значком,
// «Разобрано: N из M» и «Все уроки». Чтения идут по настоящему пути приложения на поддельном транспорте; данные синтетические.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, ScrollView } from "react-native";

import { EnglishReviewScreen } from "@/features/learning/english/EnglishReviewScreen";
import { MODULE_ID, explainChoice, exerciseId, modulesFixture, reviewItems } from "@/test-fixtures/english";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

type Json = { type: string; props?: Record<string, unknown>; children?: (Json | string)[] | null } | (Json | string)[] | null;
/** Поддерево экрана с данным testID (дерево сериализовать нельзя: в свойствах провайдеров есть циклы, поэтому обход вручную). */
function subtree(node: Json, testID: string): Json {
  if (node === null || typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = subtree(child as Json, testID);
      if (found) return found;
    }
    return null;
  }
  if (node.props?.testID === testID) return node;
  for (const child of node.children ?? []) {
    const found = subtree(child as Json, testID);
    if (found) return found;
  }
  return null;
}
function hasHostType(node: Json, type: string): boolean {
  if (node === null || typeof node === "string") return false;
  if (Array.isArray(node)) return node.some((child) => hasHostType(child as Json, type));
  return node.type === type || (node.children ?? []).some((child) => hasHostType(child as Json, type));
}

const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
beforeEach(() => {
  scrollTo.mockClear();
  jest.mocked(router.navigate).mockClear();
});

const check = (args: Record<string, unknown> | undefined) => {
  const correct = (args?.p_answer as { selected?: string })?.selected === "b";
  return { exerciseId: String(args?.p_exercise_id), correct, verdict: { correct }, explain: explainChoice("b") };
};

describe("повторение ошибок", () => {
  it("модуль из ссылки: банк читается по нему, список модулей не нужен; без ссылки берётся первый модуль", async () => {
    const withLink = fakeTransport({ learning_review_v1: reviewItems(1, 2) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(withLink.transport));
    expect(await screen.findByTestId("english-review-counter")).toHaveTextContent("Задание 1 из 2 · Урок 1");
    expect(withLink.calls.find((c) => c.name === "learning_review_v1")?.args).toMatchObject({ p_module_id: MODULE_ID });
    expect(withLink.calls.some((c) => c.name === "learning_modules_v1")).toBe(false);
  });

  it("без ссылки: первый модуль, как на сайте", async () => {
    const fake = fakeTransport({ learning_modules_v1: modulesFixture([{ n: 1 }]), learning_review_v1: reviewItems(1, 1) });
    await renderPortal(<EnglishReviewScreen />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-counter")).toHaveTextContent("Задание 1 из 1 · Урок 1");
    expect(fake.calls.find((c) => c.name === "learning_review_v1")?.args).toMatchObject({ p_module_id: MODULE_ID });
  });

  it("счётчик идёт первым, затем «Урок N» (порядок сайта: «Задание 1 из 5 · Урок 3»)", async () => {
    const fake = fakeTransport({ learning_review_v1: reviewItems(3, 2) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-counter")).toHaveTextContent("Задание 1 из 2 · Урок 3");
  });

  it("проверка ответа: вместо формы формулировка и разбор, читалка слышит вердикт; «Далее» называет следующее задание и прокручивает наверх", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 2), learning_review_check_v1: check });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await screen.findByTestId("english-review-check");
    // Первое задание при загрузке банка вслух не называется (счётчик «1 из 0» стал «1 из 2»), называются только переходы.
    expect(announce).not.toHaveBeenCalledWith("Задание 1 из 2");
    await fireEvent.press(screen.getByTestId("opt-a"));
    await fireEvent.press(screen.getByTestId("english-review-check"));
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    expect(screen.queryByTestId("opt-a")).toBeNull();
    expect(screen.getByTestId("english-review-prompt")).toHaveTextContent("Pick the right word 1.");
    expect(screen.getByTestId("verdict")).toHaveTextContent("Неверно");
    expect(announce).toHaveBeenCalledWith("Неверно");
    expect(fake.calls.find((c) => c.name === "learning_review_check_v1")?.args).toMatchObject({ p_exercise_id: exerciseId(1, 1), p_answer: { selected: "a" } });
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("english-review-next"));
    expect(announce).toHaveBeenCalledWith("Задание 2 из 2");
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    expect(screen.getByTestId("english-review-counter")).toHaveTextContent("Задание 2 из 2 · Урок 1");
    announce.mockRestore();
  });

  it("разобрали всё: «Разобрано: 1 из 1» и «Все уроки» (на сайте так, раньше кнопка называлась «К урокам»)", async () => {
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 1), learning_review_check_v1: check });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await fireEvent.press(await screen.findByTestId("opt-b"));
    await fireEvent.press(screen.getByTestId("english-review-check"));
    await fireEvent.press(await screen.findByTestId("english-review-next"));
    expect(await screen.findByTestId("english-review-done")).toHaveTextContent("Разобрано: 1 из 1");
    expect(screen.getByTestId("english-review-back")).toHaveTextContent("Все уроки");
    await fireEvent.press(screen.getByTestId("english-review-back"));
    expect(router.navigate).toHaveBeenCalledWith("/english");
  });

  it("банк пуст: значок, «Повторять пока нечего», пояснение и «К урокам», как на сайте", async () => {
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 0) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-empty")).toHaveTextContent(/Повторять пока нечего/);
    expect(screen.getByText("Здесь появятся задания, решённые с ошибкой в завершённых уроках.")).toBeTruthy();
    expect(screen.getByTestId("english-review-empty-action")).toHaveTextContent("К урокам");
    expect(screen.queryByTestId("english-review-done")).toBeNull();
    // Значок lucide рисуется векторным элементом внутри самого блока пустого состояния (стрелка шапки не в счёт).
    expect(hasHostType(subtree(screen.toJSON() as Json, "english-review-empty"), "RNSVGSvgView")).toBe(true);
  });

  it("модулей нет вовсе: «Повторять пока нечего», а не вечная загрузка", async () => {
    const fake = fakeTransport({ learning_modules_v1: { modules: [] } });
    await renderPortal(<EnglishReviewScreen />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-empty")).toHaveTextContent(/Повторять пока нечего/);
    expect(fake.calls.some((c) => c.name === "learning_review_v1")).toBe(false);
  });

  it("сбой чтения банка: плашка с повтором, а не пустой экран", async () => {
    const fake = fakeTransport({ learning_review_v1: failure(null, 0) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    expect(await screen.findByText("Повторить")).toBeTruthy();
  });

  it.each([
    ["доступ закрыт", failure("42501", 403), "Урок недоступен. Войдите в кабинет заново."],
    ["конфликт", failure("40001", 409), "Попытка изменилась в другой вкладке. Загрузите сохранённую попытку."],
    ["не принято", failure("22023", 400), "Ответ не принят. Проверьте заполнение и повторите."],
    ["нет подтверждения", failure(null, 0), "Не удалось подтвердить сохранение. Ответ остался на экране — повторите."],
  ])("проверка не удалась (%s): текст по коду, как у четырёх кодов сайта", async (_name, reply, text) => {
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 1), learning_review_check_v1: reply });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await fireEvent.press(await screen.findByTestId("opt-b"));
    await fireEvent.press(screen.getByTestId("english-review-check"));
    expect(await screen.findByTestId("english-review-error")).toHaveTextContent(text);
    // Форма остаётся: ответ можно проверить ещё раз.
    expect(screen.getByTestId("opt-b")).toBeTruthy();
  });

  it("сбой проверки называет читалке `announce`: плашка с ролью alert на iPhone сама не озвучивается (ревью #1567, мелочь 2)", async () => {
    // `announceForAccessibility` в Jest уже общий мок: вызовы прошлых тестов копятся, поэтому счёт начинается с нуля.
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 1), learning_review_check_v1: failure("42501", 403) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await fireEvent.press(await screen.findByTestId("opt-b"));
    await fireEvent.press(await screen.findByTestId("english-review-check"));
    expect(await screen.findByTestId("english-review-error")).toHaveTextContent("Урок недоступен. Войдите в кабинет заново.");
    await waitFor(() => expect(announce).toHaveBeenCalledWith("Урок недоступен. Войдите в кабинет заново."));
    // Без сбоя плашки нет, и пустая строка не озвучивается.
    expect(announce).not.toHaveBeenCalledWith("");
    announce.mockRestore();
  });

  it("пока идёт проверка: кнопка называется «Сохраняем…» для читалки (общая кнопка прячет подпись при busy)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 1), learning_review_check_v1: async (args: Record<string, unknown> | undefined) => (await gate, check(args)) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await fireEvent.press(await screen.findByTestId("opt-b"));
    await fireEvent.press(screen.getByTestId("english-review-check"));
    expect(await screen.findByLabelText("Сохраняем…")).toBeTruthy();
    release();
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
  });
});
