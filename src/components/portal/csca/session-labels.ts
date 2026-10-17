// Относительные пути с .ts: файл проверяют node-тесты (tests/portal-csca-overview.test.mjs).
import type { Locale } from "../../../lib/i18n-data.ts";
import { formatPortalString, type PortalStrings } from "../../../lib/portal/i18n.ts";
import { cscaBishkekLabel, cscaDayLabel, daysBetween, type CscaSession } from "../../../lib/portal/csca.ts";

type Strings = PortalStrings<"csca">;

/** Мягкий срок «закрывается через N дней» только при N ≤ 60 (дизайн-контракт портала). */
export const SESSION_CLOSES_SOON_DAYS = 60;

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

/** День метки времени по Бишкеку, `YYYY-MM-DD` (окно регистрации csca.cn публикует по Пекину). */
export function bishkekDay(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));
}

/** «закрывается через 4 дня» с русскими формами числа; KY без форм. */
export function closesInLabel(days: number, locale: Locale, strings: Strings): string {
  if (days <= 0) return strings.sessionClosesToday;
  const form = new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(days);
  const key = form === "one" ? "sessionClosesIn.one" : form === "few" ? "sessionClosesIn.few" : "sessionClosesIn.many";
  return formatPortalString(strings[key], { count: String(days) });
}

export type SessionRegistration =
  | { state: "pending" }
  | { state: "upcoming"; opensAt: string }
  | { state: "open"; closesAt: string; daysLeft: number }
  | { state: "closed"; closesAt: string };

/** Состояние окна регистрации на момент serverNow главной трека. */
export function sessionRegistration(session: CscaSession, serverNow: string, today: string): SessionRegistration {
  const closes = session.registrationClosesAt;
  if (!closes) return { state: "pending" };
  const now = Date.parse(serverNow);
  const opens = session.registrationOpensAt;
  if (opens && now < Date.parse(opens)) return { state: "upcoming", opensAt: opens };
  if (now <= Date.parse(closes)) return { state: "open", closesAt: closes, daysLeft: Math.max(0, daysBetween(today, bishkekDay(closes))) };
  return { state: "closed", closesAt: closes };
}

export type SessionLabels = Record<string, {
  dates: string;
  registration: string;
  /** «закрывается через N дней», только у открытого окна при N ≤ 60. */
  closesIn: string | null;
  /** Ссылка «Регистрация на csca.cn», только у открытого окна. */
  registerUrl: string | null;
}>;

/**
 * Подписи дат считает сервер (sessionLabels): ICU браузера и Node по-разному
 * пишут кыргызские даты, и разметка не должна расходиться при гидрации.
 */
export function sessionLabels(
  sessions: CscaSession[],
  locale: Locale,
  strings: Strings,
  clock: Readonly<{ serverNow: string; today: string }>,
): SessionLabels {
  return Object.fromEntries(sessions.map((session) => {
    const registration = sessionRegistration(session, clock.serverNow, clock.today);
    const text = registration.state === "pending"
      ? strings.sessionRegistrationPending
      : registration.state === "upcoming"
        ? formatPortalString(strings.sessionRegistrationOpens, { date: cscaBishkekLabel(registration.opensAt, locale) })
        : registration.state === "open"
          ? formatPortalString(strings.sessionRegistration, { date: cscaBishkekLabel(registration.closesAt, locale) })
          : formatPortalString(strings.sessionRegistrationClosed, { date: cscaBishkekLabel(registration.closesAt, locale) });
    const open = registration.state === "open";
    return [session.sessionKey, {
      dates: sessionDatesLabel(session, locale, strings),
      registration: text,
      closesIn: open && registration.daysLeft <= SESSION_CLOSES_SOON_DAYS ? closesInLabel(registration.daysLeft, locale, strings) : null,
      registerUrl: open ? new URL(session.sourceUrl).origin : null,
    }];
  }));
}
