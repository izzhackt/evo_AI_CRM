/**
 * Раздел CSCA целиком (меню, страницы, действия, карточка на «Главной», даты;
 * решение владельца Q16, 18.10.2026, распространено на весь раздел 21.11.2026):
 * только для студента, чей выбор страны (`student_country_choice_v1`, миграция 284; тот
 * же выбор, что ведёт «Путь поступления») это Китай. Сохранённый выбор и вывод
 * по умолчанию из анкеты или дела считаются одинаково. Для остальных стран,
 * для «Пока не решил», без выбора и при сбое чтения выбора раздела нет. Это
 * уместность, а не граница безопасности: база CSCA не меняется.
 *
 * Текст берётся из уже существующего: одна строка `summary` из
 * src/content/csca/overview.json (новых утверждений нет) и ближайшая сессия из
 * `learning_track_home_v1`, которую читает сам раздел «CSCA»: даты и срок
 * «закрывается через N дней» считает тот же `sessionLabels`, что на странице
 * сессий. Данные CSCA не загрузились: карточки нет, плашки ошибки нет (раздел
 * «CSCA» показывает свою ошибку сам). Тот же порядок на iPhone
 * (`CSCAHomeCardPolicy`, ios/EVOAdmissions/Services/CSCA/CSCAHomeCard.swift).
 * Модуль клиент-безопасный: без server-only и Supabase.
 */
import { sessionLabels } from "../../components/portal/csca/session-labels.ts";
import type { Locale } from "../i18n-data.ts";
import type { StudentCountryChoice } from "./country-choice.ts";
import type { CscaHome, CscaSession } from "./csca.ts";
import { CSCA_OVERVIEW } from "./csca-overview.ts";
import { bishkekDay, type HomeDateItem } from "./home-dates.ts";
import { formatPortalString, type PortalStrings } from "./i18n.ts";

/** Код Китая в выборе страны (src/lib/study-countries.json). */
export const CSCA_HOME_COUNTRY = "CN";

/** Маршрут раздела «CSCA»; существование страницы проверяет тест. */
export const CSCA_HOME_HREF = "/portal/csca";

/**
 * Доступен ли студенту раздел CSCA по выбору страны. `null`: выбор не
 * прочитался; без выбранной страны раздела нет, как нет и пути поступления.
 */
export function cscaAvailableFor(choice: Pick<StudentCountryChoice, "country"> | null): boolean {
  return choice?.country === CSCA_HOME_COUNTRY;
}

/**
 * Ближайшая официальная сессия: первая по дате начала из ещё не закончившихся
 * (последний день экзамена не раньше сегодняшнего дня Бишкека из ответа
 * сервера). Прошедшие сессии не показываются; если будущих нет, `null`.
 */
export function nearestCscaSession(sessions: readonly CscaSession[], today: string): CscaSession | null {
  const upcoming = sessions
    .filter((session) => session.examTo >= today)
    .sort((a, b) => a.examFrom.localeCompare(b.examFrom));
  return upcoming[0] ?? null;
}

export type CscaHomeCardView = Readonly<{
  title: string;
  /** Одна строка `summary` обзора экзамена на языке интерфейса. */
  summary: string;
  /** Ближайшая сессия; `null`, если сервер не отдал ни одной будущей. */
  session: Readonly<{
    /** «Ближайшая сессия: 14 и 15 ноября 2026 г.» */
    line: string;
    /** «Регистрация закрывается через 4 дня»; только у открытого окна при N ≤ 60. */
    registration: string | null;
  }> | null;
  action: string;
  href: string;
}>;

/**
 * Готовая карточка или `null` (скрыта). Чтения идут в одной волне страницы:
 * `home` приходит `null`, если выбор не Китай (CSCA не читался) или если
 * чтение CSCA не удалось.
 */
export function selectCscaHomeCard(input: Readonly<{
  choice: Pick<StudentCountryChoice, "country"> | null;
  home: CscaHome | null;
  locale: Locale;
  cscaStrings: PortalStrings<"csca">;
  homeStrings: PortalStrings<"home">;
}>): CscaHomeCardView | null {
  if (!cscaAvailableFor(input.choice) || input.home === null) return null;
  const { home, locale, cscaStrings, homeStrings } = input;
  const nearest = nearestCscaSession(home.sessions, home.today);
  const labels = nearest
    ? sessionLabels([nearest], locale, cscaStrings, { serverNow: home.serverNow, today: home.today })[nearest.sessionKey]
    : null;
  return Object.freeze({
    title: cscaStrings.title,
    summary: locale === "ky" ? CSCA_OVERVIEW.summary.ky : CSCA_OVERVIEW.summary.ru,
    session: labels
      ? Object.freeze({
        line: formatPortalString(homeStrings.cscaSession, { dates: labels.dates }),
        registration: labels.closesIn
          ? formatPortalString(homeStrings.cscaRegistration, { closes: labels.closesIn })
          : null,
      })
      : null,
    action: homeStrings.cscaAction,
    href: CSCA_HOME_HREF,
  });
}

/**
 * Официальные даты CSCA для «Ближайших дат» «Главной» (18.11.2026): последний день регистрации и первый день экзамена
 * каждой ещё не закончившейся сессии. Доступ тот же, что у карточки: только Китай и только прочитанная главная трека.
 * Срок регистрации — пока окно не закрылось по часам сервера (csca.cn закрывает в 23:59 по Пекину, это 21:59 в Бишкеке:
 * позже в тот же день строки «регистрация закрывается» уже нет, как и в карточке CSCA). Окно в 60 дней, порядок и
 * предел задаёт `upcomingHomeDates`.
 */
export function cscaHomeDates(input: Readonly<{
  choice: Pick<StudentCountryChoice, "country"> | null;
  home: CscaHome | null;
  homeStrings: PortalStrings<"home">;
}>): HomeDateItem[] {
  if (!cscaAvailableFor(input.choice) || input.home === null) return [];
  const { home, homeStrings } = input;
  return home.sessions
    .filter((session) => session.examTo >= home.today)
    .flatMap((session) => [
      ...(session.registrationClosesAt && Date.parse(home.serverNow) <= Date.parse(session.registrationClosesAt)
        ? [{ day: bishkekDay(session.registrationClosesAt), title: homeStrings.cscaDateRegistration, href: CSCA_HOME_HREF }]
        : []),
      { day: session.examFrom, title: homeStrings.cscaDateExam, href: CSCA_HOME_HREF },
    ]);
}
