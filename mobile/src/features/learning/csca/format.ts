// Подписи дат и времени CSCA. Сервер даёт `…On` (дата Бишкека) и `…At` (момент); показываем по
// Бишкеку (контракт §1). Intl в Hermes есть, но кыргызская локаль может отсутствовать: тогда
// подпись идёт на русской локали, а не падает.
import { cscaDayLabel, cscaMomentDayLabel } from "@web/lib/portal/csca";

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
