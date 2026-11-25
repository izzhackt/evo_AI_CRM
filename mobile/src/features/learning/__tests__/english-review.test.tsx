// «Повторение ошибок» (G53, G54): модуль из ссылки, проверка ответа сразу сервером, вердикт и номер задания слышит читалка,
// «Далее» прокручивает наверх. Чтения идут по настоящему пути приложения на поддельном транспорте; данные синтетические.
import { fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, ScrollView } from "react-native";

import { EnglishReviewScreen } from "@/features/learning/english/EnglishReviewScreen";
import { MODULE_ID, explainChoice, exerciseId, modulesFixture, reviewItems } from "@/test-fixtures/english";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
beforeEach(() => scrollTo.mockClear());

const check = (args: Record<string, unknown> | undefined) => {
  const correct = (args?.p_answer as { selected?: string })?.selected === "b";
  return { exerciseId: String(args?.p_exercise_id), correct, verdict: { correct }, explain: explainChoice("b") };
};

describe("повторение ошибок", () => {
  it("модуль из ссылки: банк читается по нему, список модулей не нужен; без ссылки берётся первый модуль", async () => {
    const withLink = fakeTransport({ learning_review_v1: reviewItems(1, 2) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(withLink.transport));
    expect(await screen.findByText(/Урок 1 · Задание 1 из 2/)).toBeTruthy();
    expect(withLink.calls.find((c) => c.name === "learning_review_v1")?.args).toMatchObject({ p_module_id: MODULE_ID });
    expect(withLink.calls.some((c) => c.name === "learning_modules_v1")).toBe(false);
  });

  it("без ссылки: первый модуль, как на сайте", async () => {
    const fake = fakeTransport({ learning_modules_v1: modulesFixture([{ n: 1 }]), learning_review_v1: reviewItems(1, 1) });
    await renderPortal(<EnglishReviewScreen />, testApi(fake.transport));
    expect(await screen.findByText(/Урок 1 · Задание 1 из 1/)).toBeTruthy();
    expect(fake.calls.find((c) => c.name === "learning_review_v1")?.args).toMatchObject({ p_module_id: MODULE_ID });
  });

  it("проверка ответа: вердикт и разбор, читалка слышит вердикт; «Далее» называет следующее задание и прокручивает наверх", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 2), learning_review_check_v1: check });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    await screen.findByTestId("english-review-check");
    await fireEvent.press(screen.getByTestId("opt-a"));
    await fireEvent.press(screen.getByTestId("english-review-check"));
    expect(await screen.findByTestId("explain-panel")).toBeTruthy();
    expect(screen.getByTestId("verdict")).toHaveTextContent("Неверно");
    expect(announce).toHaveBeenCalledWith("Неверно");
    expect(fake.calls.find((c) => c.name === "learning_review_check_v1")?.args).toMatchObject({ p_exercise_id: exerciseId(1, 1), p_answer: { selected: "a" } });
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("english-review-next"));
    expect(announce).toHaveBeenCalledWith("Задание 2 из 2");
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    expect(screen.getByText(/Урок 1 · Задание 2 из 2/)).toBeTruthy();
    announce.mockRestore();
  });

  it("банк пуст: «Повторять пока нечего»", async () => {
    const fake = fakeTransport({ learning_review_v1: reviewItems(1, 0) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-empty")).toHaveTextContent("Повторять пока нечего");
  });

  it("модулей нет вовсе: «Повторять пока нечего», а не вечная загрузка", async () => {
    const fake = fakeTransport({ learning_modules_v1: { modules: [] } });
    await renderPortal(<EnglishReviewScreen />, testApi(fake.transport));
    expect(await screen.findByTestId("english-review-empty")).toHaveTextContent("Повторять пока нечего");
    expect(fake.calls.some((c) => c.name === "learning_review_v1")).toBe(false);
  });

  it("сбой чтения банка: плашка с повтором, а не пустой экран", async () => {
    const fake = fakeTransport({ learning_review_v1: failure(null, 0) });
    await renderPortal(<EnglishReviewScreen moduleId={MODULE_ID} />, testApi(fake.transport));
    expect(await screen.findByText("Повторить")).toBeTruthy();
  });
});
