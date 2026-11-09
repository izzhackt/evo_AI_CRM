import { createPoller } from "@/lib/poll";

describe("планировщик опроса", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("запускает через интервал после старта и повторяет", async () => {
    const run = jest.fn(async () => undefined);
    const poller = createPoller({ intervalMs: 30_000, run });
    poller.start();
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(29_999);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("не накладывает запуски: следующий отсчёт после завершения", async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const poller = createPoller({ intervalMs: 1_000, run });
    poller.start();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000); // запрос ещё идёт
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("сбой запуска не останавливает опрос", async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const poller = createPoller({ intervalMs: 1_000, run });
    poller.start();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("poke: внеочередной запуск и новый отсчёт; после stop не работает", async () => {
    const run = jest.fn(async () => undefined);
    const poller = createPoller({ intervalMs: 60_000, run });
    poller.poke();
    expect(run).not.toHaveBeenCalled(); // не запущен
    poller.start();
    await jest.advanceTimersByTimeAsync(30_000);
    poller.poke();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
    poller.poke();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
