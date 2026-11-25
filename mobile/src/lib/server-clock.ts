// Часы сервера. «Сегодня», «завтра» и «просрочено» на «Главной» решает сервер, как на вебе: страница там собирается на сервере,
// и `new Date()` в ней - его время. У телефона дата и время бывают переставлены руками, и тогда вчерашний день назывался бы
// сегодняшним. Поправка «сервер минус телефон» берётся из заголовка `Date` каждого ответа нашего сервера (его ставит и сервер,
// который отдаёт `serverNow` для CSCA: часы те же). Пока ни одного ответа не было или заголовка нет, поправка нулевая: берутся часы
// телефона, как раньше. Новых зависимостей нет.

/** Секунды в заголовке `Date` и дорога ответа дают разброс около секунды: меньшие сдвиги поправку не меняют. */
const NOISE_MS = 1000;
/** Ответ, пролежавший в кэше дольше, несёт старое время сервера: его заголовку верить нельзя. */
const MAX_AGE_SECONDS = 5;

let offsetMs = 0;
let known = false;
const listeners = new Set<() => void>();

/**
 * Запомнить время сервера из ответа: `serverTime` (строка `Date` или ISO, либо миллисекунды) и момент, когда телефон получил
 * ответ. Непонятное время игнорируется. Подписчики узнают, когда поправка заметно изменилась.
 */
export function observeServerTime(serverTime: string | number, receivedAtMs: number = Date.now()): void {
  const server = typeof serverTime === "number" ? serverTime : Date.parse(serverTime);
  if (!Number.isFinite(server) || !Number.isFinite(receivedAtMs)) return;
  const next = server - receivedAtMs;
  if (known && Math.abs(next - offsetMs) < NOISE_MS) return;
  offsetMs = next;
  known = true;
  for (const listener of [...listeners]) listener();
}

/** Поправка «сервер минус телефон» в миллисекундах; `null` - серверного времени ещё не было. */
export function serverOffsetMs(): number | null {
  return known ? offsetMs : null;
}

/** Сейчас по часам сервера (часы телефона плюс поправка). */
export function serverNow(deviceNowMs: number = Date.now()): Date {
  return new Date(deviceNowMs + offsetMs);
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
  listeners.clear();
}

/**
 * `fetch`, который по пути записывает время сервера из заголовка `Date` ответа. Ответ возвращается нетронутым (тело не
 * читается), любой сбой разбора заголовка остаётся незамеченным: часы необязательны, запрос важнее.
 */
export function withServerClock(baseFetch: typeof fetch = fetch, now: () => number = Date.now): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    try {
      const receivedAt = now();
      const date = response.headers?.get("date");
      const age = Number(response.headers?.get("age") ?? 0);
      if (date && !(age > MAX_AGE_SECONDS)) observeServerTime(date, receivedAt);
    } catch {
      // Часы необязательны.
    }
    return response;
  };
}
