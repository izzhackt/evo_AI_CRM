// Время и день в ленте чата: по Бишкеку, как в вебе (MessagesThread).
import { formatPortalTimestamp } from "@/domain/presentation";
import type { Lang } from "@/i18n";

const TZ = "Asia/Bishkek";
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${key}:${locale}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: TZ, ...options });
    cache.set(id, f);
  }
  return f;
}
const loc = (lang: Lang) => (lang === "ky" ? "ky" : "ru");

export const timeLabel = (iso: string, lang: Lang) => fmt("t", loc(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const dayLabel = (iso: string, lang: Lang) => fmt("d", loc(lang), { day: "numeric", month: "long" }).format(new Date(iso));
/** Ключ дня по Бишкеку (для разделителей и «Сегодня»). */
export const dayKey = (iso: string) => fmt("k", "en-CA", {}).format(new Date(iso));

/**
 * «25.11.2026, 14:30 (Бишкек)»: время решения и отправки на экранах решений (веб ProgramDocumentTime: время по Бишкеку и
 * пометка города, в обоих языках одинаково). Пустая строка, если время не разобрать.
 */
export function bishkekTime(value: string | null): string {
  const label = formatPortalTimestamp(value);
  return label === null ? "" : `${label} (Бишкек)`;
}
