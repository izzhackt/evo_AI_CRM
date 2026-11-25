// «Сейчас» для «Главной»: время сервера, полночь по Бишкеку, срок дела, возврат в приложение и на вкладку.
import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { todayForTimeline } from "@web/lib/portal/country-timeline";

import { msUntilBishkekMidnight, nextDueAfter, useHomeNow } from "@/features/home/useHomeNow";
import { observeServerTime, resetServerClockForTests } from "@/lib/server-clock";

// Фокус вкладки ведёт тест: общий упрощённый `useFocusEffect` из jest.setup.ts срабатывает только при монтировании и не умеет
// «вкладка снова в фокусе». Здесь `__refocus()` гасит эффекты фокуса и запускает их заново, как возврат на вкладку.
jest.mock("@/lib/focus", () => {
  const { useEffect, useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
  let epoch = 0;
  const listeners = new Set<() => void>();
  return {
    __refocus: () => {
      epoch += 1;
      for (const listener of [...listeners]) listener();
    },
    useFocusEffect: (effect: () => void | (() => void)) => {
      const seen = useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => epoch,
      );
      useEffect(() => effect(), [effect, seen]);
    },
  };
});
const refocus = () => act(async () => (jest.requireMock("@/lib/focus") as { __refocus: () => void }).__refocus());

const at = (iso: string) => new Date(iso);

/** Часы и таймеры подменены, а очередь микрозадач, `setImmediate` и прочее настоящие: `await render` и `act` Testing Library живут на них. */
const REAL = ["setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "performance", "setInterval", "clearInterval"] as const;
const fakeClock = (iso: string) => jest.useFakeTimers({ now: at(iso), doNotFake: [...REAL] });

describe("граница суток по Бишкеку", () => {
  it("полночь Бишкека - 18:00 UTC; осталось до неё столько, сколько до следующей даты", async () => {
    expect(msUntilBishkekMidnight(at("2026-09-08T05:00:00Z"))).toBe(13 * 3_600_000); // 11:00 в Бишкеке
    expect(msUntilBishkekMidnight(at("2026-09-08T17:59:50Z"))).toBe(10_000);
    expect(msUntilBishkekMidnight(at("2026-09-08T18:00:00Z"))).toBe(86_400_000);
  });

  it("совпадает с календарём `todayForTimeline`: за миллисекунду до границы ещё вчера, на границе уже новый день", async () => {
    for (const midnightUtc of ["2026-01-31T18:00:00Z", "2026-02-28T18:00:00Z", "2026-03-28T18:00:00Z", "2026-10-25T18:00:00Z", "2026-12-31T18:00:00Z"]) {
      const edge = at(midnightUtc).getTime();
      const before = at(new Date(edge - 1).toISOString());
      expect(msUntilBishkekMidnight(before)).toBe(1);
      expect(todayForTimeline(new Date(edge))).not.toBe(todayForTimeline(before));
      expect(msUntilBishkekMidnight(new Date(edge))).toBe(86_400_000);
    }
  });
});

describe("ближайший срок дела", () => {
  const now = at("2026-09-08T05:00:00Z");
  it("берётся ближайший из тех, что впереди; прошедшие, пустые и негодные пропускаются", async () => {
    expect(nextDueAfter(now, ["2026-09-08T04:00:00Z", null, "не дата", "2026-09-10T03:00:00Z", "2026-09-09T03:00:00Z"])).toBe(Date.parse("2026-09-09T03:00:00Z"));
    expect(nextDueAfter(now, [])).toBeNull();
    expect(nextDueAfter(now, ["2026-09-08T05:00:00Z"])).toBeNull(); // ровно сейчас - уже не впереди
  });
});

describe("useHomeNow", () => {
  let appState: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    resetServerClockForTests();
    appState = undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_event: string, handler: (state: AppStateStatus) => void) => {
      appState = handler;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetServerClockForTests();
  });

  const dayOf = (value: Date) => todayForTimeline(value);

  it("в полночь по Бишкеку «сегодня» сменяется само, без перерисовки извне", async () => {
    fakeClock("2026-09-08T17:59:50Z");
    const { result } = await renderHook(() => useHomeNow());
    expect(dayOf(result.current)).toBe("2026-09-08");
    await act(async () => {
      jest.advanceTimersByTime(9_000);
    });
    expect(dayOf(result.current)).toBe("2026-09-08"); // ещё без одной секунды
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(dayOf(result.current)).toBe("2026-09-09");
    // дальше таймер ставится на следующую полночь
    await act(async () => {
      jest.advanceTimersByTime(86_400_000);
    });
    expect(dayOf(result.current)).toBe("2026-09-10");
  });

  it("в час срока ближайшего дела время обновляется: «сегодня» станет «просрочено»", async () => {
    fakeClock("2026-09-08T05:00:00Z");
    const { result } = await renderHook(() => useHomeNow(["2026-09-08T08:00:00Z", "2026-09-12T03:00:00Z"]));
    const first = result.current;
    await act(async () => {
      jest.advanceTimersByTime(3 * 3_600_000 - 1_000);
    });
    expect(result.current).toBe(first); // до срока перерисовки нет
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(result.current.getTime()).toBeGreaterThan(Date.parse("2026-09-08T08:00:00Z"));
  });

  it("возврат приложения на передний план пересчитывает время, фон и повтор «active» - тоже без вреда", async () => {
    fakeClock("2026-09-08T05:00:00Z");
    const { result } = await renderHook(() => useHomeNow());
    const first = result.current;
    await act(async () => appState?.("background"));
    expect(result.current).toBe(first);
    // телефон «спал» всю ночь: таймеры стояли, часы ушли вперёд
    jest.setSystemTime(at("2026-09-09T04:00:00Z"));
    await act(async () => appState?.("active"));
    expect(result.current).not.toBe(first);
    expect(dayOf(result.current)).toBe("2026-09-09");
  });

  describe("возврат на вкладку (настоящий эффект фокуса)", () => {
    it("секунды экран не перерисовывают: сдвиг на 59,999 с и тот же день - прежнее время", async () => {
      fakeClock("2026-09-08T05:00:00Z");
      const { result } = await renderHook(() => useHomeNow());
      const first = result.current;
      jest.setSystemTime(at("2026-09-08T05:00:59.999Z"));
      await refocus();
      expect(result.current).toBe(first);
    });

    it("минута и больше: сдвиг ровно на 60 с и дальше пересчитывает время (граница `>=`)", async () => {
      fakeClock("2026-09-08T05:00:00Z");
      const { result } = await renderHook(() => useHomeNow());
      const first = result.current;
      jest.setSystemTime(at("2026-09-08T05:01:00Z"));
      await refocus();
      expect(result.current).not.toBe(first);
      expect(result.current.toISOString()).toBe("2026-09-08T05:01:00.000Z");
      // и пятью минутами позже тоже (порог не час)
      const second = result.current;
      jest.setSystemTime(at("2026-09-08T05:06:00Z"));
      await refocus();
      expect(result.current).not.toBe(second);
      expect(result.current.toISOString()).toBe("2026-09-08T05:06:00.000Z");
    });

    it("граница суток по Бишкеку: сдвиг всего на 20 с, но день сменился - время пересчитывается", async () => {
      fakeClock("2026-09-08T17:59:50Z"); // 23:59:50 в Бишкеке
      const { result } = await renderHook(() => useHomeNow());
      const first = result.current;
      expect(dayOf(first)).toBe("2026-09-08");
      jest.setSystemTime(at("2026-09-08T18:00:10Z")); // 00:00:10 9 сентября
      await refocus();
      expect(result.current).not.toBe(first);
      expect(dayOf(result.current)).toBe("2026-09-09");
    });

    it("без возврата на вкладку время не меняется само (его будят границы суток, срок, возврат в приложение), с возвратом - меняется", async () => {
      fakeClock("2026-09-08T05:00:00Z");
      const { result } = await renderHook(() => useHomeNow());
      const first = result.current;
      jest.setSystemTime(at("2026-09-08T09:00:00Z"));
      expect(result.current).toBe(first);
      await refocus();
      expect(result.current.toISOString()).toBe("2026-09-08T09:00:00.000Z");
    });

    it("время сервера: возврат на вкладку берёт часы сервера, а не телефона", async () => {
      fakeClock("2026-09-09T05:00:00Z");
      observeServerTime("2026-09-08T05:00:00Z", Date.now());
      observeServerTime("2026-09-08T05:00:00Z", Date.now()); // телефон на сутки впереди
      const { result } = await renderHook(() => useHomeNow());
      jest.setSystemTime(at("2026-09-09T06:00:00Z"));
      await refocus();
      expect(result.current.toISOString()).toBe("2026-09-08T06:00:00.000Z");
    });
  });

  it("возврат приложения на передний план пересчитывает время и после возврата на вкладку (оба пути независимы)", async () => {
    fakeClock("2026-09-08T05:00:00Z");
    const { result } = await renderHook(() => useHomeNow());
    jest.setSystemTime(at("2026-09-08T09:00:00Z"));
    await act(async () => appState?.("active"));
    expect(result.current.toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });

  it("часы телефона переставлены на сутки вперёд: один ответ сервера время не меняет, два согласных возвращают время сервера", async () => {
    fakeClock("2026-09-09T05:00:00Z");
    const { result } = await renderHook(() => useHomeNow());
    expect(dayOf(result.current)).toBe("2026-09-09"); // пока серверного времени нет - часы телефона
    await act(async () => {
      observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.now());
    });
    expect(dayOf(result.current)).toBe("2026-09-09"); // сдвиг в сутки ждёт подтверждения вторым ответом
    await act(async () => {
      observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.now());
    });
    expect(dayOf(result.current)).toBe("2026-09-08");
  });

  it("шум в секунды от ответа к ответу экран не перерисовывает", async () => {
    fakeClock("2026-09-08T05:00:00Z");
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    const { result } = await renderHook(() => useHomeNow());
    const first = result.current;
    await act(async () => {
      observeServerTime("2026-09-08T05:00:03Z", Date.now());
    });
    expect(result.current).toBe(first);
  });

  it("время берётся по часам сервера уже на первой отрисовке, если поправка известна", async () => {
    fakeClock("2026-09-09T05:00:00Z");
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    const { result } = await renderHook(() => useHomeNow());
    expect(dayOf(result.current)).toBe("2026-09-08");
  });

  it("уже первая отрисовка идёт по часам сервера, а не по часам телефона (до эффектов фокуса)", async () => {
    fakeClock("2026-09-09T05:00:00Z"); // телефон на сутки впереди сервера
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    const seen: Date[] = [];
    await renderHook(() => {
      const value = useHomeNow();
      seen.push(value);
      return value;
    });
    expect(dayOf(seen[0])).toBe("2026-09-08");
  });

  it("возврат в приложение и таймеры берут часы сервера, а не телефона", async () => {
    fakeClock("2026-09-09T05:00:00Z");
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    observeServerTime("2026-09-08T05:00:00Z", Date.now());
    const { result } = await renderHook(() => useHomeNow());
    jest.setSystemTime(at("2026-09-09T06:00:00Z")); // прошёл час: по серверу 8 сентября, 12:00 в Бишкеке
    await act(async () => appState?.("active"));
    expect(dayOf(result.current)).toBe("2026-09-08");
    expect(result.current.toISOString()).toBe("2026-09-08T06:00:00.000Z");
    // полночь по Бишкеку считается тоже по серверу: до неё ещё 12 часов, а не 11 по часам телефона
    await act(async () => {
      jest.advanceTimersByTime(11 * 3_600_000);
    });
    expect(dayOf(result.current)).toBe("2026-09-08");
    await act(async () => {
      jest.advanceTimersByTime(2 * 3_600_000);
    });
    expect(dayOf(result.current)).toBe("2026-09-09");
  });

  it("при размонтировании таймер снимается", async () => {
    fakeClock("2026-09-08T05:00:00Z");
    const { unmount } = await renderHook(() => useHomeNow(["2026-09-08T08:00:00Z"]));
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    await unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
