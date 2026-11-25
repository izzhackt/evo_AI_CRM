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

describe("планировщик: сбои, пауза и возврат (как лёгкий опрос веба)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("после сбоев подряд задержка растёт по заданному правилу, первый успех возвращает обычную", async () => {
    let fail = true;
    const run = jest.fn(async () => {
      if (fail) throw new Error("нет связи");
    });
    const poller = createPoller({ intervalMs: 1_000, run, delayAfterFailures: (failures) => 1_000 * 2 ** failures });
    poller.start();
    await jest.advanceTimersByTimeAsync(1_000); // первый запуск, сбой 1
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(run).toHaveBeenCalledTimes(1); // ждём 2 с, а не 1 с
    await jest.advanceTimersByTimeAsync(1); // сбой 2
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3_999);
    expect(run).toHaveBeenCalledTimes(2); // ждём 4 с
    fail = false;
    await jest.advanceTimersByTimeAsync(1); // успех
    expect(run).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1); // снова обычная секунда
    expect(run).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("без правила задержки сбой расписание не меняет", async () => {
    const run = jest.fn().mockRejectedValue(new Error("x"));
    const poller = createPoller({ intervalMs: 1_000, run });
    poller.start();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("поке во время сбоев запускает сразу и не обнуляет счёт сбоев, пока запуск не удался", async () => {
    const run = jest.fn().mockRejectedValue(new Error("x"));
    const poller = createPoller({ intervalMs: 1_000, run, delayAfterFailures: (failures) => 1_000 * 2 ** failures });
    poller.start();
    await jest.advanceTimersByTimeAsync(1_000); // сбой 1, дальше 2 с
    poller.poke(); // сбой 2, дальше 4 с
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3_999);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("пауза: отсчёт стоит, внеочередные запуски не идут; возврат без ограничения опрашивает сразу", async () => {
    const run = jest.fn(async () => undefined);
    const poller = createPoller({ intervalMs: 1_000, run });
    poller.start();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    poller.pause();
    await jest.advanceTimersByTimeAsync(10_000);
    poller.poke();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1); // фон: ни отсчёта, ни поке
    poller.resume(); // без ограничения возврат опрашивает сразу
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3); // и отсчёт пошёл дальше
    poller.stop();
  });

  it("возврат: сразу только если прошлый запуск начался не меньше чем resumeMinGapMs назад, иначе обычный отсчёт", async () => {
    const run = jest.fn(async () => undefined);
    const poller = createPoller({ intervalMs: 60_000, run, resumeMinGapMs: 30_000 });
    poller.start();
    poller.poke(); // запуск в нулевую секунду
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    poller.pause();
    await jest.advanceTimersByTimeAsync(10_000);
    poller.resume(); // прошло 10 с: рано, только отсчёт
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); // обычная минута от возврата
    expect(run).toHaveBeenCalledTimes(2);
    poller.pause();
    await jest.advanceTimersByTimeAsync(30_000);
    poller.resume(); // ровно 30 с после начала прошлого: уже можно
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("возврат во время идущего запуска не накладывает второй; после stop ничего не делает", async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const poller = createPoller({ intervalMs: 1_000, run });
    poller.start();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    poller.resume();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    poller.stop();
    poller.resume();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
