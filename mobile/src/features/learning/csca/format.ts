// Подписи дат и времени CSCA. Сервер даёт `…On` (дата Бишкека) и `…At` (момент); показываем по
// Бишкеку (контракт §1). Intl в Hermes есть, но кыргызская локаль может отсутствовать: тогда
// подпись идёт на русской локали, а не падает.
import { cscaDayLabel, cscaMomentDayLabel } from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

export function cscaDayLabelSafe(value: string, lang: "ru" | "ky", withYear = true): string {
  try {
    return cscaMomentDayLabel(value, lang, withYear);
  } catch {
    return cscaMomentDayLabel(value, "ru", withYear);
  }
}

export function cscaOnLabelSafe(value: string, lang: "ru" | "ky", withYear = false): string {
  try {
    return cscaDayLabel(value, lang, withYear);
  } catch {
    return cscaDayLabel(value, "ru", withYear);
  }
}

/** «4 мин» или «7 мин 30 с»: длительность теста на время (веб: components/portal/csca/format.ts `durationLabel`). */
export function cscaDurationLabel(seconds: number, strings: PortalStrings<"csca">): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0
    ? formatPortalString(strings.durationMinutes, { m: String(m) })
    : formatPortalString(strings.durationMinutesSeconds, { m: String(m), s: String(s) });
}
