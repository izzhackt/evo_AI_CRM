// `announce`: короткое сообщение читалке. Системный вызов в Jest - заглушка из пресета React Native, поэтому проверяется,
// что и когда до него доходит: пустое не доходит, повтор внутри окна склеивается, настоящий повтор позже окна проходит.
import { AccessibilityInfo } from "react-native";

import * as a11y from "@/ui/a11y";
import { ANNOUNCE_REPEAT_MS, announce, resetAnnouncementsForTests } from "@/ui/a11y";
import * as motion from "@/ui/motion";

const native = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

/** Часы теста: `announce` читает `Date.now()`. */
function clock(start = 1_000_000) {
  let now = start;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  return {
    set: (value: number) => {
      now = value;
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => {
  native.mockClear();
  resetAnnouncementsForTests();
});
afterEach(() => jest.restoreAllMocks());

describe("announce: что доходит до читалки", () => {
  it("сообщение уходит один раз, как есть, без пробелов по краям", () => {
    clock();
    announce("  Верно  ");
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith("Верно");
  });

  it("пустая строка, одни пробелы, null и undefined не озвучиваются", () => {
    clock();
    announce("");
    announce("   ");
    announce("\n\t");
    announce(null);
    announce(undefined);
    expect(native).not.toHaveBeenCalled();
  });

  it("пустое сообщение не глушит следующее настоящее", () => {
    clock();
    announce("");
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("разные сообщения подряд озвучиваются все, в своём порядке", () => {
    const time = clock();
    announce("Верно");
    time.tick(10);
    announce("Осталась одна минута");
    expect(native.mock.calls.map((call) => call[0])).toEqual(["Верно", "Осталась одна минута"]);
  });
});

describe("announce: быстрые повторы", () => {
  it("то же сообщение внутри окна озвучивается один раз", () => {
    const time = clock();
    announce("Сообщение отправлено");
    time.tick(ANNOUNCE_REPEAT_MS - 1);
    announce("Сообщение отправлено");
    announce("Сообщение отправлено");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("то же сообщение после окна озвучивается снова", () => {
    const time = clock();
    announce("Верно");
    time.tick(ANNOUNCE_REPEAT_MS);
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(2);
  });

  it("окно считается от последнего озвученного: поток повторов не заглушает сообщение навсегда", () => {
    const time = clock();
    announce("Верно"); // 0 мс: озвучено
    time.tick(500);
    announce("Верно"); // 500 мс: повтор, склеен
    time.tick(400);
    announce("Верно"); // 900 мс от озвученного: окно прошло, озвучено
    expect(native).toHaveBeenCalledTimes(2);
  });

  it("повтор через другое сообщение озвучивается: окно только для подряд идущих одинаковых", () => {
    const time = clock();
    announce("Верно");
    time.tick(10);
    announce("Неверно");
    time.tick(10);
    announce("Верно");
    expect(native.mock.calls.map((call) => call[0])).toEqual(["Верно", "Неверно", "Верно"]);
  });

  it("пробелы по краям не делают повтор «другим» сообщением", () => {
    const time = clock();
    announce("Верно");
    time.tick(10);
    announce(" Верно ");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("часы ушли назад: повтор не глушится, а озвучивается", () => {
    const time = clock(2_000_000);
    announce("Верно");
    time.set(1_000_000);
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(2);
  });
});

describe("«Уменьшить движение»", () => {
  it("хук доступен из ui/a11y и это тот же хук, что в ui/motion: второго нет", () => {
    expect(typeof a11y.useReducedMotion).toBe("function");
    expect(a11y.useReducedMotion).toBe(motion.useReducedMotion);
  });
});

describe("announce: сбой системного вызова", () => {
  it("исключение читалки не доходит до экрана", () => {
    clock();
    native.mockImplementationOnce(() => {
      throw new Error("native module is not available");
    });
    expect(() => announce("Верно")).not.toThrow();
  });
});
