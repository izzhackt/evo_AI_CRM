// «Сейчас» для «Главной»: время сервера (как веб, где страница собирается на сервере), которое не застывает. Раньше экран брал
// `new Date()` при каждой отрисовке: после ночи в фоне надписи «Сегодня» и «Завтра» оставались вчерашними, пока что-нибудь
// не перерисует экран, а часы телефона с переставленной датой врали насчёт «просрочено». Теперь:
//  - время берётся по часам сервера (`lib/server-clock.ts`: поправка из заголовка `Date` ответов; пока её нет - часы телефона);
//  - оно пересчитывается в полночь по Бишкеку (день календаря «Ближайших дат» и «через N дней» сменился), в час срока ближайшего
//    дела (веб считает «прошло сегодня по часам» уже просроченным, `homeDueStatus`), при возврате приложения на передний план,
//    при возврате на вкладку и когда часы сервера заметно разошлись с часами телефона (первый ответ сервера).
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { todayForTimeline } from "@web/lib/portal/country-timeline";

import { useFocusEffect } from "@/lib/focus";
import { serverNow, subscribeServerClock } from "@/lib/server-clock";

/** Бишкек - UTC+6 без перехода на летнее время с 2005 года; тест сверяет границу суток с `todayForTimeline`. */
const BISHKEK_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
/** Небольшой запас после границы, чтобы сработать уже по ту сторону: таймер не бывает точнее часов. */
const MARGIN_MS = 500;
/** Меньший сдвиг при возврате на вкладку или смене поправки экран не перерисовывает. */
const REFRESH_AFTER_MS = 60_000;

/** Сколько миллисекунд осталось до ближайшей полуночи по Бишкеку. */
export function msUntilBishkekMidnight(now: Date): number {
  const local = now.getTime() + BISHKEK_OFFSET_MS;
  return (Math.floor(local / DAY_MS) + 1) * DAY_MS - local;
}

/** Ближайший из сроков (ISO), который ещё впереди; `null` - таких нет. */
export function nextDueAfter(now: Date, dueAts: readonly (string | null)[]): number | null {
  let next: number | null = null;
  for (const value of dueAts) {
    const at = value === null ? Number.NaN : Date.parse(value);
    if (Number.isFinite(at) && at > now.getTime() && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * Текущее время «Главной». `dueAts` - сроки дел студента (ISO): в час ближайшего из них экран перерисуется, и «сегодня» станет
 * «просрочено». Возвращает один и тот же `Date`, пока ничего из перечисленного выше не случилось.
 */
export function useHomeNow(dueAts: readonly (string | null)[] = []): Date {
  const [now, setNow] = useState(() => serverNow());

  /** Принудительно: границу суток, срок и возврат в приложение пропустить нельзя, даже если сдвиг мал. */
  const renew = useCallback(() => setNow(serverNow()), []);
  /** Мягко: возврат на вкладку и смена поправки не перерисовывают экран из-за секунд. */
  const renewIfFar = useCallback(
    () =>
      setNow((previous) => {
        const next = serverNow();
        return Math.abs(next.getTime() - previous.getTime()) >= REFRESH_AFTER_MS || todayForTimeline(next) !== todayForTimeline(previous) ? next : previous;
      }),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") renew();
    });
    return () => subscription.remove();
  }, [renew]);

  useEffect(() => subscribeServerClock(renewIfFar), [renewIfFar]);
  useFocusEffect(renewIfFar);

  const nextDue = nextDueAfter(now, dueAts);
  const nowMs = now.getTime();
  useEffect(() => {
    const untilDue = nextDue === null ? Number.POSITIVE_INFINITY : nextDue - nowMs;
    const delay = Math.min(msUntilBishkekMidnight(new Date(nowMs)), untilDue) + MARGIN_MS;
    const timer = setTimeout(renew, delay);
    return () => clearTimeout(timer);
  }, [nowMs, nextDue, renew]);

  return now;
}
