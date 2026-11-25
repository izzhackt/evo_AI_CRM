// Каталог тестов как на сайте (G62): без лишней строки «Заданий: N», история с датой по UTC, переходы в тест и результат.
// Чтение идёт по настоящему пути приложения на поддельном транспорте; данные синтетические.
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { TestsScreen } from "@/features/learning/tests/TestsScreen";
import { ATTEMPT_ID, OTHER_ATTEMPT_ID, catalogFixture } from "@/test-fixtures/assessment";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

beforeEach(() => jest.mocked(router.navigate).mockClear());

const attempt = (id: string, status: "draft" | "completed", extra: Record<string, unknown> = {}) => ({
  attemptId: id,
  instrumentKey: "english36",
  version: "1.0.0",
  status,
  revision: 2,
  answeredCount: status === "completed" ? 36 : 5,
  questionCount: 36,
  createdAt: "2026-11-09T09:00:00+00:00",
  updatedAt: "2026-11-09T22:05:00+00:00",
  completedAt: status === "completed" ? "2026-11-09T22:05:00+00:00" : null,
  ...extra,
});

describe("каталог тестов", () => {
  it("карточка: состояние, описание, «Можно прерваться…» и кнопки; строки «Заданий: N» нет (сайт её не показывает)", async () => {
    const { transport } = fakeTransport({ student_assessments_v1: catalogFixture("english36", { draft: ATTEMPT_ID, attempts: [attempt(ATTEMPT_ID, "draft")] }) });
    await renderPortal(<TestsScreen />, testApi(transport));
    expect(await screen.findByText("В процессе · 5 из 36")).toBeTruthy();
    expect(screen.getByText("Описание теста")).toBeTruthy();
    expect(screen.getByText("Можно прерваться и вернуться позже")).toBeTruthy();
    expect(screen.queryByText(/Заданий:/)).toBeNull();
    await fireEvent.press(screen.getByTestId("assessment-continue-english36"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/tests/[key]", params: { key: "english36" } });
  });

  it("история: дата завершения по UTC (22:05 UTC 9 ноября остаётся 9 ноября), вход в результат нужной попытки", async () => {
    const done = attempt(OTHER_ATTEMPT_ID, "completed");
    const { transport } = fakeTransport({ student_assessments_v1: catalogFixture("english36", { completed: OTHER_ATTEMPT_ID, attempts: [done] }) });
    await renderPortal(<TestsScreen />, testApi(transport));
    expect(await screen.findByText("9 нояб. 2026 г.")).toBeTruthy();
    expect(screen.getAllByText("Английский").length).toBeGreaterThanOrEqual(2); // карточка и строка истории
    await fireEvent.press(screen.getByTestId(`history-${OTHER_ATTEMPT_ID}`));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/tests/[key]", params: { key: "english36", attempt: OTHER_ATTEMPT_ID } });
  });

  it("история пуста: подсказка вместо списка", async () => {
    const { transport } = fakeTransport({ student_assessments_v1: catalogFixture("orvis92") });
    await renderPortal(<TestsScreen />, testApi(transport));
    expect(await screen.findByTestId("tests-history-empty")).toBeTruthy();
    expect(screen.getByText("Не начат")).toBeTruthy();
  });
});
