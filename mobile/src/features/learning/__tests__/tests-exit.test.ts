// Куда ведёт выход из теста (ревью QA 22): откуда открыт тест и какие команды маршрутизатору уходят. На настоящем стеке то же проверяет
// `tests-exit-router.test.tsx`; здесь значения `from` из ссылки (приходят снаружи, поэтому верится только одному) и сами команды.
import { router } from "expo-router";

import { leaveTests, testsOrigin } from "@/features/learning/tests/exit";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn(), dismissTo: jest.fn(), back: jest.fn() } }));

beforeEach(() => {
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.dismissTo).mockClear();
  jest.mocked(router.back).mockClear();
});

describe("откуда открыт тест", () => {
  it("верится только `professions`; чужие, пустые и повторённые значения ничего не значат", () => {
    expect(testsOrigin("professions")).toBe("professions");
    for (const value of ["home", "english", "Professions", "", "/professions", undefined, null, ["professions"], ["professions", "x"], ["x", "professions"]]) {
      expect(testsOrigin(value as never)).toBeNull();
    }
  });
});

describe("выход из теста", () => {
  it("всегда к «Всем тестам» через `dismissTo`, никогда `back`: из другого раздела тест в стеке единственный, и `back` ушла бы во вкладку «Главная»", () => {
    leaveTests(null);
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith("/tests");
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("тест с карточки «Профессий»: после каталога открываются «Профессии», и в этом порядке", () => {
    const order: string[] = [];
    jest.mocked(router.dismissTo).mockImplementation(() => void order.push("dismissTo"));
    jest.mocked(router.navigate).mockImplementation(() => void order.push("navigate"));
    leaveTests("professions");
    expect(order).toEqual(["dismissTo", "navigate"]);
    expect(router.navigate).toHaveBeenCalledWith("/professions");
    expect(router.back).not.toHaveBeenCalled();
  });
});
