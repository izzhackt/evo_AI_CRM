import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { cscaBishkekLabel, cscaDayLabel, type CscaSession } from "@/lib/portal/csca";

type Strings = PortalStrings<"csca">;

/** RU «14 и 15 ноября 2026 г.», KY «14-ноябрь жана 15-ноябрь, 2026». */
export function sessionDatesLabel(session: CscaSession, locale: Locale, strings: Strings): string {
  const { examFrom: from, examTo: to } = session;
  if (from === to) return cscaDayLabel(from, locale, true);
  if (locale === "ky") {
    return `${formatPortalString(strings.sessionDates, { from: cscaDayLabel(from, locale), to: cscaDayLabel(to, locale) })}, ${to.slice(0, 4)}`;
  }
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return formatPortalString(strings.sessionDates, {
    from: sameMonth ? String(Number(from.slice(8, 10))) : cscaDayLabel(from, locale, from.slice(0, 4) !== to.slice(0, 4)),
    to: cscaDayLabel(to, locale, true),
  });
}

export type SessionLabels = Record<string, { dates: string; registration: string }>;

/**
 * Подписи дат считает сервер (sessionLabels): ICU браузера и Node по-разному
 * пишут кыргызские даты, и разметка не должна расходиться при гидрации.
 */
export function sessionLabels(sessions: CscaSession[], locale: Locale, strings: Strings): SessionLabels {
  return Object.fromEntries(sessions.map((session) => [session.sessionKey, {
    dates: sessionDatesLabel(session, locale, strings),
    registration: session.registrationClosesAt
      ? formatPortalString(strings.sessionRegistration, { date: cscaBishkekLabel(session.registrationClosesAt, locale) })
      : strings.sessionRegistrationPending,
  }]));
}

