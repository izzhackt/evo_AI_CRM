import { observeServerTime, resetServerClockForTests, serverNow, serverOffsetMs, subscribeServerClock, withServerClock } from "@/lib/server-clock";

beforeEach(resetServerClockForTests);

describe("поправка к часам телефона", () => {
  it("до первого ответа поправки нет: берутся часы телефона", () => {
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(1_000_000).getTime()).toBe(1_000_000);
  });

  it("сервер впереди на два часа: «сейчас» сдвигается на них", () => {
    const received = Date.parse("2026-09-08T05:00:00Z");
    observeServerTime("2026-09-08T07:00:00Z", received);
    expect(serverOffsetMs()).toBe(2 * 3_600_000);
    expect(serverNow(received + 5_000).toISOString()).toBe("2026-09-08T07:00:05.000Z");
  });

  it("часы телефона убежали вперёд на сутки: поправка отрицательная", () => {
    observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.parse("2026-09-09T05:00:00Z"));
    expect(serverOffsetMs()).toBe(-86_400_000);
  });

  it("понимает заголовок Date в виде HTTP-даты, ISO и миллисекунд", () => {
    const received = Date.parse("2026-09-08T05:00:00Z");
    observeServerTime("Tue, 08 Sep 2026 05:00:30 GMT", received);
    expect(serverOffsetMs()).toBe(30_000);
    resetServerClockForTests();
    observeServerTime(received + 45_000, received);
    expect(serverOffsetMs()).toBe(45_000);
  });

  it("непонятное время и непонятный момент получения игнорируются", () => {
    observeServerTime("вчера", 1000);
    observeServerTime("", 1000);
    observeServerTime("2026-09-08T05:00:00Z", Number.NaN);
    expect(serverOffsetMs()).toBeNull();
  });

  it("разброс меньше секунды поправку не двигает и подписчиков не будит; заметный сдвиг - двигает", () => {
    const received = Date.parse("2026-09-08T05:00:00Z");
    const listener = jest.fn();
    subscribeServerClock(listener);
    observeServerTime(received - 400, received); // первое наблюдение всегда запоминается
    expect(listener).toHaveBeenCalledTimes(1);
    observeServerTime(received + 100, received); // сдвиг 500 мс - шум
    expect(serverOffsetMs()).toBe(-400);
    expect(listener).toHaveBeenCalledTimes(1);
    observeServerTime(received + 2_000, received); // сдвиг больше секунды
    expect(serverOffsetMs()).toBe(2_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("подписка снимается", () => {
    const listener = jest.fn();
    const off = subscribeServerClock(listener);
    off();
    observeServerTime("2026-09-08T05:00:00Z", 0);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("withServerClock: время сервера из заголовка Date каждого ответа", () => {
  const respond = (headers: Record<string, string>, status = 200) => jest.fn(async () => new Response("{}", { status, headers })) as unknown as typeof fetch;

  it("записывает поправку и отдаёт ответ нетронутым", async () => {
    const wrapped = withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT" }), () => Date.parse("2026-09-08T05:00:00Z"));
    const response = await wrapped("https://example.test/rpc");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{}");
    expect(serverOffsetMs()).toBe(2 * 3_600_000);
  });

  it("нет заголовка или он непонятный: поправки нет, ответ приходит", async () => {
    await withServerClock(respond({}))("https://example.test/a");
    await withServerClock(respond({ date: "sometime" }))("https://example.test/b");
    expect(serverOffsetMs()).toBeNull();
  });

  it("ответ из кэша (Age больше пяти секунд) несёт старое время и не учитывается; свежий - учитывается", async () => {
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT", age: "3600" }), () => Date.parse("2026-09-08T05:00:00Z"))("https://example.test/a");
    expect(serverOffsetMs()).toBeNull();
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT", age: "2" }), () => Date.parse("2026-09-08T05:00:00Z"))("https://example.test/b");
    expect(serverOffsetMs()).toBe(2 * 3_600_000);
  });

  it("отказ сервера тоже несёт время; обрыв запроса пробрасывается как был", async () => {
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:10 GMT" }, 503), () => Date.parse("2026-09-08T05:00:00Z"))("https://example.test/a");
    expect(serverOffsetMs()).toBe(10_000);
    const broken = withServerClock((async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch);
    await expect(broken("https://example.test/b")).rejects.toThrow("Network request failed");
  });

  it("сбой самого чтения заголовков запрос не ломает", async () => {
    const odd = (async () => ({ headers: { get: () => { throw new Error("boom"); } } })) as unknown as typeof fetch;
    await expect(withServerClock(odd)("https://example.test/c")).resolves.toBeDefined();
    expect(serverOffsetMs()).toBeNull();
  });
});
