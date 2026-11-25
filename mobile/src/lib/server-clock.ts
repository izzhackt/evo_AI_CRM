// Часы сервера. «Сегодня», «завтра» и «просрочено» на «Главной» решает сервер, как на вебе: страница там собирается на сервере,
// и `new Date()` в ней - его время. У телефона дата и время бывают переставлены руками, и тогда вчерашний день назывался бы
// сегодняшним. Поправка «сервер минус телефон» берётся из заголовка `Date` каждого ответа нашего сервера (его ставит и сервер,
// который отдаёт `serverNow` для CSCA: часы те же). Пока ни одного ответа не было или заголовка нет, поправка нулевая: берутся часы
// телефона, как раньше. Новых зависимостей нет.
//
// Заголовку `Date` нельзя верить вслепую: прокси или кэш отдаст старое время, а чужое или битое значение сдвинуло бы «сегодня»
// на сутки (ответ тридцатипятиминутной давности в 00:05 по Бишкеку называл бы сегодняшний день вчерашним). Поэтому:
//  - поправка считается по середине запроса (отправка и получение ответа), а не по моменту получения; запрос дольше 10 секунд
//    времени сервера не говорит (телефон мог уснуть посреди запроса: середина отрезка ошибается на половину его длины, и ответ
//    в 30 секунд сдвинул бы поправку сразу на -15 секунд, а два десятиминутных согласились бы на -300);
//  - сдвиг поправки больше двух минут (`JUMP_MS`) принимается, только когда два ответа подряд согласны с ним (расходятся не больше
//    чем на три секунды, `AGREE_MS`); меньшие сдвиги (дрейф часов) принимаются сразу. Это не «берём большую поправку» веба
//    (`laterClockOffset` раннера тестов): телефон, переставленный вперёд руками, так никогда не поправился бы;
//  - поправка больше 48 часов (`MAX_OFFSET_MS`: 1970 и 9999 год, не числа, значения за пределом `Date`) не принимается вовсе,
//    а не обрезается: обрезанная выдавала бы за время сервера выдуманное;
//  - `serverNow()` всегда настоящая дата: `Invalid Date` ломает `todayForTimeline` (RangeError в `toISOString`);
//  - заголовок `Date` читается движком (Hermes разбирает HTTP-дату `Tue, 08 Sep 2026 05:00:00 GMT` через `Date.parse`; на устройстве
//    это не проверено). Разбор, который ошибся, но не вернул `NaN`, сдвинул бы «сегодня» на часы, поэтому при загрузке движок
//    проверяется на известной дате (`Thu, 01 Jan 1970 00:00:00 GMT` должно дать ровно 0), а не прошёл - заголовок не читается совсем.

/** Секунды в заголовке `Date` и дорога ответа дают разброс около секунды: меньшие сдвиги поправку не меняют. */
const NOISE_MS = 1000;
/** Ответ, пролежавший в кэше дольше, несёт старое время сервера: его заголовку верить нельзя. */
const MAX_AGE_SECONDS = 5;
/** Запрос, шедший дольше, времени сервера не говорит: середина отрезка ошибается на его половину. */
const MAX_ROUND_TRIP_MS = 10_000;
/** Сдвиг поправки больше этого принимается только по двум согласным ответам подряд. */
const JUMP_MS = 120_000;
/** Два ответа согласны, если их поправки различаются не больше чем на это. */
const AGREE_MS = 3_000;
/** Дата, на которой при загрузке проверяется разбор HTTP-даты движком: начало эпохи, ровно 0. */
const EPOCH_HTTP_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";
/** Правдоподобная поправка: переставленные руками часы бывают неправы на часы и сутки, но не на годы. */
const MAX_OFFSET_MS = 48 * 3_600_000;
/** Предел значений `Date` (ECMAScript): дальше `new Date(...)` - `Invalid Date`. */
const MAX_DATE_MS = 8.64e15;

let offsetMs = 0;
let known = false;
/** Поправка, которую принёс один ответ с большим сдвигом и которую должен подтвердить следующий. */
let candidateMs: number | null = null;
const listeners = new Set<() => void>();

/**
 * Запомнить время сервера из ответа: `serverTime` (строка `Date` или ISO, либо миллисекунды) и показание часов телефона `localMs`,
 * которое ему соответствует (у запроса - середина между отправкой и получением ответа). Непонятное время, бесконечность и
 * поправка больше 48 часов игнорируются; сдвиг больше двух минут ждёт подтверждения вторым ответом. Подписчики узнают, когда
 * поправка заметно изменилась.
 */
export function observeServerTime(serverTime: string | number, localMs: number = Date.now()): void {
  const server = typeof serverTime === "number" ? serverTime : Date.parse(serverTime);
  const next = server - localMs;
  if (!Number.isFinite(next) || Math.abs(next) > MAX_OFFSET_MS) return;
  if (Math.abs(next - offsetMs) > JUMP_MS) {
    const confirmed = candidateMs !== null && Math.abs(next - candidateMs) <= AGREE_MS;
    if (!confirmed) {
      // Первый ответ с таким сдвигом (или второй не согласен с первым): запоминаем и ждём следующего.
      candidateMs = next;
      return;
    }
  }
  candidateMs = null;
  if (known && Math.abs(next - offsetMs) < NOISE_MS) return;
  offsetMs = next;
  known = true;
  for (const listener of [...listeners]) listener();
}

/** Поправка «сервер минус телефон» в миллисекундах; `null` - серверного времени ещё не было. */
export function serverOffsetMs(): number | null {
  return known ? offsetMs : null;
}

/**
 * Сейчас по часам сервера (часы телефона плюс поправка); всегда настоящая дата: если сумма вышла за пределы `Date` или время
 * телефона не число, берутся часы телефона.
 */
export function serverNow(deviceNowMs: number = Date.now()): Date {
  const at = deviceNowMs + offsetMs;
  return new Date(Number.isFinite(at) && Math.abs(at) <= MAX_DATE_MS ? at : Date.now());
}

/** «Сейчас» для экранов: единственный вход к часам сервера (до первого ответа и при любом сбое - часы телефона). */
export function now(): Date {
  return serverNow();
}

/** Подписка на изменение поправки; возвращает отписку. */
export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Для тестов: забыть всё, как при запуске приложения. */
export function resetServerClockForTests(): void {
  offsetMs = 0;
  known = false;
  candidateMs = null;
  listeners.clear();
}

/**
 * Разбирает ли движок HTTP-дату правильно: известная дата начала эпохи даёт ровно 0. `NaN` (не разобрал) и любое другое число
 * (разобрал со сдвигом, например как местное время) - нет. `parse` подставляется в тестах.
 */
export function httpDateParsesCorrectly(parse: (value: string) => number = Date.parse): boolean {
  try {
    return parse(EPOCH_HTTP_DATE) === 0;
  } catch {
    return false;
  }
}

/** Итог проверки движка при загрузке модуля: разобрал неверно - заголовку `Date` не верим. */
const HTTP_DATE_OK = httpDateParsesCorrectly();

/**
 * `fetch`, который по пути записывает время сервера из заголовка `Date` ответа. Ответ возвращается нетронутым (тело не
 * читается), любой сбой разбора заголовка остаётся незамеченным: часы необязательны, запрос важнее. Заголовок ставит сервер,
 * пока готовит ответ, то есть где-то между отправкой запроса и получением ответа: сопоставляем его с серединой этого отрезка.
 * Если часы телефона переставили посреди запроса (получение раньше отправки) или запрос шёл дольше `MAX_ROUND_TRIP_MS`, отрезок
 * ничего не значит и ответ не учитывается.
 */
export function withServerClock(baseFetch: typeof fetch = fetch, clockMs: () => number = Date.now, httpDateOk: boolean = HTTP_DATE_OK): typeof fetch {
  return async (input, init) => {
    const sentAt = clockMs();
    const response = await baseFetch(input, init);
    try {
      const receivedAt = clockMs();
      const date = response.headers?.get("date");
      const age = Number(response.headers?.get("age") ?? 0);
      if (httpDateOk && date && !(age > MAX_AGE_SECONDS) && receivedAt >= sentAt && receivedAt - sentAt <= MAX_ROUND_TRIP_MS) observeServerTime(date, sentAt + (receivedAt - sentAt) / 2);
    } catch {
      // Часы необязательны.
    }
    return response;
  };
}
