import { todayForTimeline } from "@web/lib/portal/country-timeline";

import { httpDateParsesCorrectly, now, observeServerTime, resetServerClockForTests, serverNow, serverOffsetMs, subscribeServerClock, withServerClock } from "@/lib/server-clock";

beforeEach(resetServerClockForTests);

const T = Date.parse("2026-09-08T05:00:00Z"); // 11:00 в Бишкеке
const HOUR = 3_600_000;
/** Два ответа подряд с одной поправкой: так принимается сдвиг больше двух минут. */
const observeTwice = (serverMs: number, localMs: number) => {
  observeServerTime(serverMs, localMs);
  observeServerTime(serverMs + 1_000, localMs + 1_000);
};

describe("поправка к часам телефона", () => {
  it("до первого ответа поправки нет: берутся часы телефона", () => {
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(1_000_000).getTime()).toBe(1_000_000);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("сервер впереди на два часа: один ответ ждёт подтверждения, два согласных ответа подряд сдвигают «сейчас»", () => {
    observeServerTime("2026-09-08T07:00:00Z", T);
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(T).getTime()).toBe(T);
    observeServerTime("2026-09-08T07:00:01Z", T + 1_000);
    expect(serverOffsetMs()).toBe(2 * HOUR);
    expect(serverNow(T + 5_000).toISOString()).toBe("2026-09-08T07:00:05.000Z");
  });

  it("часы телефона убежали вперёд на сутки: поправка отрицательная (после двух согласных ответов)", () => {
    observeServerTime("Tue, 08 Sep 2026 05:00:00 GMT", Date.parse("2026-09-09T05:00:00Z"));
    observeServerTime("Tue, 08 Sep 2026 05:00:02 GMT", Date.parse("2026-09-09T05:00:02Z"));
    expect(serverOffsetMs()).toBe(-86_400_000);
  });

  it("понимает заголовок Date в виде HTTP-даты, ISO и миллисекунд", () => {
    observeServerTime("Tue, 08 Sep 2026 05:00:30 GMT", T);
    expect(serverOffsetMs()).toBe(30_000);
    resetServerClockForTests();
    observeServerTime(T + 45_000, T);
    expect(serverOffsetMs()).toBe(45_000);
  });

  it("непонятное время и непонятный момент получения игнорируются", () => {
    observeServerTime("вчера", 1000);
    observeServerTime("", 1000);
    observeServerTime("2026-09-08T05:00:00Z", Number.NaN);
    expect(serverOffsetMs()).toBeNull();
  });

  it("разброс меньше секунды поправку не двигает и подписчиков не будит; заметный сдвиг - двигает", () => {
    const listener = jest.fn();
    subscribeServerClock(listener);
    observeServerTime(T - 400, T); // первое наблюдение всегда запоминается
    expect(listener).toHaveBeenCalledTimes(1);
    observeServerTime(T + 100, T); // сдвиг 500 мс - шум
    expect(serverOffsetMs()).toBe(-400);
    expect(listener).toHaveBeenCalledTimes(1);
    observeServerTime(T + 2_000, T); // сдвиг больше секунды
    expect(serverOffsetMs()).toBe(2_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("граница шума: сдвиг на 999 мс - шум, ровно на секунду - уже новая поправка", () => {
    observeServerTime(T + 500, T);
    observeServerTime(T + 500 + 999, T);
    expect(serverOffsetMs()).toBe(500);
    observeServerTime(T + 500 + 1_000, T);
    expect(serverOffsetMs()).toBe(1_500);
  });

  it("подписка снимается", () => {
    const listener = jest.fn();
    const off = subscribeServerClock(listener);
    off();
    observeServerTime("2026-09-08T05:00:00Z", T);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("сдвиг больше двух минут принимается, только когда два ответа подряд согласны", () => {
  it("дрейф до двух минут принимается сразу, на границе тоже; на миллисекунду больше - уже нет", () => {
    observeServerTime(T + 90_000, T);
    expect(serverOffsetMs()).toBe(90_000);
    resetServerClockForTests();
    observeServerTime(T + 120_000, T);
    expect(serverOffsetMs()).toBe(120_000);
    resetServerClockForTests();
    observeServerTime(T + 120_001, T);
    expect(serverOffsetMs()).toBeNull();
  });

  it("одиночный ответ трёхчасовой давности без Age не двигает часы (кэш или прокси отдал старое время)", () => {
    observeServerTime(T - 3 * HOUR, T);
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(T).getTime()).toBe(T);
  });

  it("ответ тридцатипятиминутной давности в 00:05 по Бишкеку не превращает сегодня во вчера; два таких ответа подряд - превращают", () => {
    const phone = Date.parse("2026-09-08T18:05:00Z"); // 00:05 9 сентября в Бишкеке
    observeServerTime(phone - 35 * 60_000, phone);
    expect(todayForTimeline(serverNow(phone))).toBe("2026-09-09");
    // второй такой же ответ уже подтверждает: сервер действительно отстаёт на 35 минут
    observeServerTime(phone + 1_000 - 35 * 60_000, phone + 1_000);
    expect(todayForTimeline(serverNow(phone))).toBe("2026-09-08");
  });

  it("два ответа согласны, если расходятся не больше трёх секунд; на три секунды и миллисекунду - нет", () => {
    observeServerTime(T + HOUR, T);
    observeServerTime(T + HOUR + 3_000, T); // разница 3000 мс - согласны
    expect(serverOffsetMs()).toBe(HOUR + 3_000);
    resetServerClockForTests();
    observeServerTime(T + HOUR, T);
    observeServerTime(T + HOUR + 3_001, T); // разница 3001 мс - не согласны
    expect(serverOffsetMs()).toBeNull();
  });

  it("два несогласных ответа не принимаются, но второй становится кандидатом: третий, согласный со вторым, принимается", () => {
    observeServerTime(T + HOUR, T);
    observeServerTime(T + 5 * HOUR, T);
    expect(serverOffsetMs()).toBeNull();
    observeServerTime(T + 5 * HOUR + 500, T);
    expect(serverOffsetMs()).toBe(5 * HOUR + 500);
  });

  it("между двумя большими ответами пришёл обычный: кандидат сброшен, подтверждения нет", () => {
    observeServerTime(T + HOUR, T); // кандидат
    observeServerTime(T + 200, T); // обычный ответ, поправка рядом с нулевой: принят (первое наблюдение)
    expect(serverOffsetMs()).toBe(200);
    observeServerTime(T + HOUR, T); // снова большой, но кандидата уже нет
    expect(serverOffsetMs()).toBe(200);
    observeServerTime(T + HOUR + 100, T); // теперь подряд два согласных
    expect(serverOffsetMs()).toBe(HOUR + 100);
  });

  it("подписчики узнают о принятом сдвиге один раз, а о кандидате - никогда", () => {
    const listener = jest.fn();
    subscribeServerClock(listener);
    observeServerTime(T + HOUR, T);
    expect(listener).not.toHaveBeenCalled();
    observeServerTime(T + HOUR + 1_000, T);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("сброс для тестов забывает и кандидата: ответ после сброса не подтверждается ответом до него", () => {
    observeServerTime(T + HOUR, T); // кандидат
    resetServerClockForTests();
    observeServerTime(T + HOUR + 100, T); // согласен с прежним кандидатом, но того уже нет
    expect(serverOffsetMs()).toBeNull();
    observeServerTime(T + HOUR + 200, T); // а теперь подряд два согласных
    expect(serverOffsetMs()).toBe(HOUR + 200);
  });

  it("уже принятая поправка не мешает принять обратный большой сдвиг: человек исправил часы телефона", () => {
    observeTwice(T + 3 * HOUR, T); // телефон отставал на три часа
    expect(serverOffsetMs()).toBe(3 * HOUR);
    observeServerTime(T + 10_000, T + 10_000); // часы исправлены: сервер и телефон совпали
    expect(serverOffsetMs()).toBe(3 * HOUR); // один ответ не верим
    observeServerTime(T + 11_000, T + 11_000);
    expect(serverOffsetMs()).toBe(0);
  });
});

describe("поправка вне правдоподобного диапазона не принимается, а «сейчас» остаётся настоящей датой", () => {
  const PHONE = T;
  const finiteNow = () => Number.isFinite(serverNow(PHONE).getTime());

  it.each([
    ["1970 год", "Thu, 01 Jan 1970 00:00:00 GMT"],
    ["9999 год", "Fri, 31 Dec 9999 23:59:59 GMT"],
    ["самая поздняя дата Date", "+275760-09-13T00:00:00.000Z"],
    ["самая ранняя дата Date", "-271821-04-20T00:00:00.000Z"],
  ])("%s: даже два одинаковых ответа подряд не двигают часы", (_name, header) => {
    observeServerTime(header, PHONE);
    observeServerTime(header, PHONE + 1_000);
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(PHONE).getTime()).toBe(PHONE);
    expect(finiteNow()).toBe(true);
    // и день по-прежнему считается: раньше `Invalid Date` ронял `todayForTimeline` с RangeError
    expect(() => todayForTimeline(serverNow(PHONE))).not.toThrow();
    expect(todayForTimeline(serverNow(PHONE))).toBe("2026-09-08");
  });

  it("не числа и бесконечности игнорируются", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "", "не дата", "Invalid Date"]) observeServerTime(value, PHONE);
    observeServerTime(PHONE, Number.POSITIVE_INFINITY);
    observeServerTime(PHONE, Number.NEGATIVE_INFINITY);
    observeServerTime(PHONE, Number.NaN);
    expect(serverOffsetMs()).toBeNull();
    expect(finiteNow()).toBe(true);
  });

  it("поправка ровно 48 часов правдоподобна (после двух ответов), на миллисекунду больше - нет", () => {
    observeTwice(PHONE + 48 * HOUR, PHONE);
    expect(serverOffsetMs()).toBe(48 * HOUR);
    resetServerClockForTests();
    observeTwice(PHONE + 48 * HOUR + 1, PHONE);
    expect(serverOffsetMs()).toBeNull();
    resetServerClockForTests();
    observeTwice(PHONE - 48 * HOUR - 1, PHONE);
    expect(serverOffsetMs()).toBeNull();
  });

  it("принятая поправка не отменяется неверным ответом: 1970 год после нормального ничего не меняет", () => {
    observeServerTime(PHONE + 500, PHONE);
    observeServerTime("Thu, 01 Jan 1970 00:00:00 GMT", PHONE + 1_000);
    observeServerTime("Thu, 01 Jan 1970 00:00:00 GMT", PHONE + 2_000);
    expect(serverOffsetMs()).toBe(500);
  });

  it("serverNow всегда настоящая дата, при любом времени телефона и любой принятой поправке", () => {
    observeTwice(PHONE + 48 * HOUR, PHONE); // самая большая правдоподобная поправка
    for (const device of [0, -1, PHONE, 8.64e15, -8.64e15, 8.64e15 - 1_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300]) {
      const at = serverNow(device).getTime();
      expect(Number.isFinite(at)).toBe(true);
      expect(Math.abs(at)).toBeLessThanOrEqual(8.64e15);
    }
    expect(serverNow(8.64e15 - 1_000).getTime()).toBeLessThanOrEqual(8.64e15); // сумма вышла бы за предел Date
  });
});

describe("withServerClock: время сервера из заголовка Date каждого ответа", () => {
  const respond = (headers: Record<string, string>, status = 200) => jest.fn(async () => new Response("{}", { status, headers })) as unknown as typeof fetch;
  /** Часы телефона, которые идут вперёд на `step` мс при каждом чтении: отправка и получение разнесены. */
  const ticking = (start: number, step: number) => {
    let current = start - step;
    return () => (current += step);
  };

  it("записывает поправку и отдаёт ответ нетронутым", async () => {
    const wrapped = withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:30 GMT" }), () => T);
    const response = await wrapped("https://example.test/rpc");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{}");
    expect(serverOffsetMs()).toBe(30_000);
  });

  it("большой сдвиг принимается после двух ответов подряд", async () => {
    const wrapped = withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT" }), () => T);
    await wrapped("https://example.test/a");
    expect(serverOffsetMs()).toBeNull();
    await wrapped("https://example.test/b");
    expect(serverOffsetMs()).toBe(2 * HOUR);
  });

  it("поправка считается по середине запроса, а не по моменту получения ответа", async () => {
    // отправили в T, ответ получили в T + 2 с; сервер поставил Date на 05:00:06 -> телефон в этот момент (середина) показывал 05:00:01
    const wrapped = withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:06 GMT" }), ticking(T, 2_000));
    await wrapped("https://example.test/a");
    expect(serverOffsetMs()).toBe(5_000); // по моменту получения вышло бы 4 000
  });

  it("часы телефона переставили посреди запроса (получение раньше отправки): ответ не учитывается", async () => {
    // отправили в T, а при получении часы показывают на 10 секунд раньше: середина отрезка выдала бы поправку в 5 секунд
    const readings = [T, T - 10_000];
    const wrapped = withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:00 GMT" }), () => readings.shift() ?? T);
    await wrapped("https://example.test/a");
    expect(serverOffsetMs()).toBeNull();
  });

  it("нет заголовка или он непонятный: поправки нет, ответ приходит", async () => {
    await withServerClock(respond({}))("https://example.test/a");
    await withServerClock(respond({ date: "sometime" }))("https://example.test/b");
    expect(serverOffsetMs()).toBeNull();
  });

  it("ответ из кэша (Age больше пяти секунд) несёт старое время и не учитывается, даже два раза подряд; свежий - учитывается", async () => {
    const stale = withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT", age: "3600" }), () => T);
    await stale("https://example.test/a");
    await stale("https://example.test/a2");
    expect(serverOffsetMs()).toBeNull();
    const fresh = withServerClock(respond({ date: "Tue, 08 Sep 2026 07:00:00 GMT", age: "2" }), () => T);
    await fresh("https://example.test/b");
    await fresh("https://example.test/b2");
    expect(serverOffsetMs()).toBe(2 * HOUR);
  });

  it("возраст ответа: ровно 5 секунд ещё свежий, 6 и 100 уже из кэша", async () => {
    const withAge = (age: string) => withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:30 GMT", age }), () => T)("https://example.test/age");
    await withAge("5");
    expect(serverOffsetMs()).toBe(30_000);
    for (const age of ["6", "100", "500"]) {
      resetServerClockForTests();
      await withAge(age);
      expect(serverOffsetMs()).toBeNull();
    }
  });

  it("запрос дольше десяти секунд времени сервера не говорит; ровно десять секунд - говорит", async () => {
    // отправили в T, ответ через 10 с; заголовок на 5 с впереди середины отрезка
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:10 GMT" }), ticking(T, 10_000))("https://example.test/a");
    expect(serverOffsetMs()).toBe(5_000);
    resetServerClockForTests();
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:10 GMT" }), ticking(T, 10_001))("https://example.test/b");
    expect(serverOffsetMs()).toBeNull();
  });

  it("телефон уснул посреди запроса: ответ в 30 секунд не сдвигает поправку на -15 секунд, два десятиминутных не соглашаются на -300", async () => {
    // заголовок = момент отправки, середина отрезка на полдлины позже: без предела получилось бы «сервер отстаёт»
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:00 GMT" }), ticking(T, 30_000))("https://example.test/slow");
    expect(serverOffsetMs()).toBeNull();
    const tenMinutes = withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:00 GMT" }), ticking(T, 600_000));
    await tenMinutes("https://example.test/a");
    await tenMinutes("https://example.test/b"); // два согласных ответа: поправка -300 секунд, принята бы без предела
    expect(serverOffsetMs()).toBeNull();
  });

  it("отказ сервера тоже несёт время; обрыв запроса пробрасывается как был", async () => {
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:10 GMT" }, 503), () => T)("https://example.test/a");
    expect(serverOffsetMs()).toBe(10_000);
    const broken = withServerClock((async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch);
    await expect(broken("https://example.test/b")).rejects.toThrow("Network request failed");
  });

  it("битые и вредные заголовки Date ничего не ломают: «сейчас» остаётся настоящей датой", async () => {
    for (const date of ["Thu, 01 Jan 1970 00:00:00 GMT", "Fri, 31 Dec 9999 23:59:59 GMT", "+275760-09-13T00:00:00.000Z", "Invalid Date", ""]) {
      const wrapped = withServerClock(respond(date ? { date } : {}), () => T);
      await wrapped("https://example.test/a");
      await wrapped("https://example.test/b");
    }
    expect(serverOffsetMs()).toBeNull();
    expect(serverNow(T).getTime()).toBe(T);
    expect(() => todayForTimeline(serverNow(T))).not.toThrow();
  });

  it("сбой самого чтения заголовков запрос не ломает", async () => {
    const odd = (async () => ({ headers: { get: () => { throw new Error("boom"); } } })) as unknown as typeof fetch;
    await expect(withServerClock(odd)("https://example.test/c")).resolves.toBeDefined();
    expect(serverOffsetMs()).toBeNull();
  });
});

describe("проверка разбора HTTP-даты движком при загрузке", () => {
  const EPOCH = "Thu, 01 Jan 1970 00:00:00 GMT";
  const respond = (headers: Record<string, string>) => jest.fn(async () => new Response("{}", { status: 200, headers })) as unknown as typeof fetch;

  it("настоящий движок (Node) разбирает дату начала эпохи в ровно 0", () => {
    expect(Date.parse(EPOCH)).toBe(0);
    expect(httpDateParsesCorrectly()).toBe(true);
  });

  it("не разобрал (NaN), разобрал со сдвигом (на 6 часов, как местное время Бишкека) или бросил - проверка не пройдена", () => {
    expect(httpDateParsesCorrectly(() => Number.NaN)).toBe(false);
    expect(httpDateParsesCorrectly(() => -6 * 3_600_000)).toBe(false);
    expect(httpDateParsesCorrectly(() => 6 * 3_600_000)).toBe(false);
    expect(httpDateParsesCorrectly(() => 1)).toBe(false);
    expect(httpDateParsesCorrectly(() => { throw new Error("parse"); })).toBe(false);
    expect(httpDateParsesCorrectly(() => 0)).toBe(true);
  });

  it("проверка спрашивает именно дату начала эпохи", () => {
    const asked: string[] = [];
    httpDateParsesCorrectly((value) => (asked.push(value), 0));
    expect(asked).toEqual([EPOCH]);
  });

  it("движок не прошёл проверку: заголовок Date не читается совсем, даже правильный и близкий; прошёл - читается", async () => {
    const header = { date: "Tue, 08 Sep 2026 05:00:30 GMT" };
    await withServerClock(respond(header), () => T, false)("https://example.test/a");
    await withServerClock(respond(header), () => T, false)("https://example.test/b");
    expect(serverOffsetMs()).toBeNull();
    await withServerClock(respond(header), () => T, true)("https://example.test/c");
    expect(serverOffsetMs()).toBe(30_000);
  });

  it("по умолчанию (проверка при загрузке в Node прошла) заголовок читается", async () => {
    await withServerClock(respond({ date: "Tue, 08 Sep 2026 05:00:30 GMT" }), () => T)("https://example.test/a");
    expect(serverOffsetMs()).toBe(30_000);
  });

  it("проверка идёт именно при загрузке модуля: движок ошибся на эпохе - свежезагруженный модуль заголовок не читает, исправный - читает", async () => {
    const load = () => {
      let loaded: typeof import("@/lib/server-clock") | undefined;
      jest.isolateModules(() => {
        loaded = jest.requireActual<typeof import("@/lib/server-clock")>("@/lib/server-clock");
      });
      return loaded!;
    };
    const header = { date: "Tue, 08 Sep 2026 05:00:30 GMT" };
    const realParse = Date.parse;
    const parse = jest.spyOn(Date, "parse").mockImplementation((value) => (value === EPOCH ? 6 * 3_600_000 : realParse(value))); // ошибся на 6 часов
    const broken = load();
    await broken.withServerClock(respond(header), () => T)("https://example.test/a");
    expect(broken.serverOffsetMs()).toBeNull();
    parse.mockRestore();
    const healthy = load();
    await healthy.withServerClock(respond(header), () => T)("https://example.test/b");
    expect(healthy.serverOffsetMs()).toBe(30_000);
  });
});

describe("now(): единственный вход к часам сервера для экранов", () => {
  it("повторяет serverNow: поправка видна сразу", () => {
    const local = Date.now();
    observeServerTime(local + 30_000, local);
    expect(Math.abs(now().getTime() - (Date.now() + 30_000))).toBeLessThan(1000);
  });
});
