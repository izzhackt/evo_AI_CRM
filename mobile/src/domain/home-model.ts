// Сборка «Главной» из прочитанных источников: чистые правила порядка блоков, дат, отсчёта и
// новостей. Источник правил: src/components/portal/home/HomeView.tsx, HomeCase.tsx, HomeHero.tsx,
// HomeNews.tsx и стили `.pt-home-slot[data-slot]` в portal.css (веб #1412, #1489, 18-20.11.2026).
import { todayForTimeline } from "@web/lib/portal/country-timeline";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import {
  bishkekDay,
  homeDayMonth,
  homeDaysLabel,
  homeDaysUntil,
  preparationHomeDates,
  upcomingHomeDates,
  type HomeDateItem,
} from "@web/lib/portal/home-dates";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import { nearestUniversityIntake } from "@web/lib/portal/universities";

import { actionHref, actionTitle, linkTarget } from "@/domain/presentation";
import type { StudentPortalNotification, StudentPortalOverview } from "@/domain/portal-source";
import type { AccessTier } from "@/session/access";

type Lang = "ru" | "ky";

export type HomeSlotId = "evo" | "case" | "list" | "dates" | "news" | "csca";

/**
 * Блоки «Главной» под шапкой пути, в порядке телефона. Шапка на фото столицы, её строка текущего шага и весь «Путь
 * поступления» стоят выше как один блок (JourneySection; веб с 18.11.2026: `CountryTimeline` с проп `hero`); выбор страны
 * (пока страны нет) тоже выше.
 *
 * Дальше порядок веба в одну колонку (HomeView.tsx + `.pt-home-slot[data-slot]` в portal.css): задача команды EVO
 * (`info`, только когда она есть), «Что сделать сейчас» (у approved одна «Ваша анкета»), затем «Мой список» (вкладки
 * «Вузы» и «Мои программы»), даты, «Что нового» (только assisted) и CSCA (Китай). «Мой список» стоит сразу за делом, когда
 * правая колонка веба длинная: страна выбрана и у студента либо дело на сопровождении, либо раздел CSCA (веб
 * `listInColumn`); иначе он идёт после остальных блоков. В отличие от веба «раздел CSCA» здесь значит «выбран Китай», а не
 * «карточка уже загрузилась»: порядок блоков не прыгает, когда чтение CSCA заканчивается.
 */
export function homeSlots(input: Readonly<{ tier: AccessTier; hasJourney: boolean; hasCsca: boolean; hasEvoTask: boolean }>): readonly HomeSlotId[] {
  const assisted = input.tier === "assisted";
  const listUp = input.hasJourney && (assisted || input.hasCsca);
  const slots: HomeSlotId[] = [];
  if (assisted && input.hasEvoTask) slots.push("evo");
  slots.push("case");
  if (listUp) slots.push("list");
  slots.push("dates");
  if (assisted) slots.push("news");
  if (input.hasCsca) slots.push("csca");
  if (!listUp) slots.push("list");
  return slots;
}

/** Параметры «Главной» из параметров старого `/overview` (`?path=open`, `?view=programs`) и метки `at`. */
export function overviewRedirectParams(
  input: Readonly<{ path?: string | string[]; view?: string | string[] }>,
  at: string,
): Record<string, string> {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const params: Record<string, string> = {};
  if (first(input.path) === "open") params.path = "open";
  params.at = at;
  if (first(input.view) === "programs") params.list = "programs";
  return params;
}

/** Вкладки «Мой список». */
export type HomeListTab = "universities" | "programs";

/** Параметры старых и новых ссылок на «Главную» (`?list=programs`, `?path=open`) -> состояние экрана. */
export function homeParams(params: Readonly<{ list?: string | string[]; path?: string | string[]; at?: string | string[] }>): Readonly<{ listTab: HomeListTab | null; openPath: boolean; stamp: string }> {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const list = one(params.list);
  // `at` - метка перехода: повторная ссылка с теми же параметрами всё равно срабатывает.
  return { listTab: list === "programs" || list === "universities" ? list : null, openPath: one(params.path) === "open", stamp: one(params.at) ?? "" };
}

/** Без выбранной страны первым блоком под шапкой стоит выбор страны, карточки пути нет. */
export function showCountryChoice(hasJourney: boolean): boolean {
  return !hasJourney;
}

export type HomeDate = HomeDateItem;

/** Адрес из общего кода веба (`/portal/csca`) -> маршрут приложения (`/csca`); адрес приложения остаётся как есть. */
function appRoute(href: string): string {
  const target = linkTarget(href);
  return target?.kind === "route" ? target.route : href;
}

/**
 * Датированные пункты «Ближайших дат» (HomeView.tsx, веб #1489): сроки действий дела (документ ведёт на свою строку
 * «Документов»), сроки своих программ из «Мои программы» (`preparationHomeDates`, ведут на экран программы), дедлайн или
 * старт избранного вуза (месяц старта без дня пропускается; у вуза, чья программа уже в списке, общей строки нет) и
 * официальные даты CSCA для выбравшего Китай (`cscaHomeDates`). Свои чтения и выдуманные даты не добавляются.
 */
export function collectHomeDates(input: Readonly<{
  overview: StudentPortalOverview | null;
  favorites: readonly PublishedUniversity[] | null;
  preparations: readonly CatalogPreparation[] | null;
  /** Результат `cscaHomeDates`: пусто не для Китая и пока главная трека CSCA не прочитана. Адреса в нём веба. */
  csca: readonly HomeDateItem[];
  admission: PortalStrings<"admission">;
  home: PortalStrings<"home">;
  now: Date;
}>): HomeDate[] {
  const today = todayForTimeline(input.now);
  const fromActions = (input.overview?.studentActions ?? []).flatMap((action) => {
    if (!action.dueAt) return [];
    return [{ day: bishkekDay(action.dueAt), title: actionTitle(action, input.admission), href: actionHref(action) }];
  });
  const programDates = preparationHomeDates(input.preparations ?? [], today, input.home);
  const programInstitutions = new Set(programDates.map((item) => item.institutionId));
  // Срок программы ведёт на её экран (веб: `/portal/preparations/<applicationId>`), а не на общий список.
  const fromPrograms = programDates.map(({ day, title, href }) => ({ day, title, href: appRoute(href) }));
  const fromFavorites = (input.favorites ?? []).flatMap((item) => {
    if (programInstitutions.has(item.id)) return [];
    const nearest = nearestUniversityIntake(item.content, input.now);
    if (nearest === null || nearest.kind === "startMonth") return [];
    const template = nearest.kind === "deadline" ? input.home.dateDeadline : input.home.dateStart;
    return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: `/universities/${item.id}` }];
  });
  const fromCsca = input.csca.map((item) => ({ ...item, href: appRoute(item.href) }));
  return [...fromActions, ...fromPrograms, ...fromFavorites, ...fromCsca];
}

/** Отсчёт в шапке: ближайшая дата «Ближайших дат» и сколько до неё дней (0 - сегодня); `overdue` - просроченное дело. */
export type HomeCountdown = HomeDateItem & Readonly<{ days: number; overdue?: boolean }>;

/**
 * Отсчёт шапки «Главной» (HomeView.tsx, веб): ближайшая из «Ближайших дат» на 60 дней. Просроченное дело важнее любой
 * будущей даты (19.11.2026): шапка не должна звучать спокойно, пока срок уже прошёл. Берётся самое давнее из просроченных;
 * «прошло сегодня по часам» тоже просрочено. Нет ни того, ни другого - отсчёта нет.
 */
export function homeCountdown(input: Readonly<{
  overview: StudentPortalOverview | null;
  dated: readonly HomeDateItem[];
  now: Date;
  admission: PortalStrings<"admission">;
}>): HomeCountdown | null {
  const today = todayForTimeline(input.now);
  const overdue = (input.overview?.studentActions ?? [])
    .filter((action) => action.dueAt !== null && Date.parse(action.dueAt) < input.now.getTime())
    .sort((a, b) => Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? ""))[0] ?? null;
  if (overdue?.dueAt) {
    return { day: bishkekDay(overdue.dueAt), title: actionTitle(overdue, input.admission), href: actionHref(overdue), days: 0, overdue: true };
  }
  const nearest = upcomingHomeDates(input.dated, today)[0] ?? null;
  return nearest ? { ...nearest, days: homeDaysUntil(nearest.day, today) } : null;
}

/**
 * Что стоит на месте числа в отсчёте шапки (HomeHero.tsx, веб): число дней со словом «дней до» либо слово «Сегодня»,
 * «Завтра», «Просрочено» без слова. Формы числа - Intl.PluralRules (у кыргызского одна).
 */
export function countdownWhen(countdown: Readonly<{ days: number; overdue?: boolean }>, lang: Lang, home: PortalStrings<"home">): { big: string; word: string | null } {
  const { days } = countdown;
  if (countdown.overdue) return { big: home.heroOverdue, word: null };
  if (days <= 0) return { big: home.heroToday, word: null };
  if (days === 1) return { big: home.heroTomorrow, word: null };
  const form = new Intl.PluralRules(lang === "ky" ? "ky" : "ru").select(days);
  const key = form === "one" ? "heroDays.one" : form === "few" ? "heroDays.few" : "heroDays.many";
  return { big: String(days), word: home[key] };
}

/**
 * Строка под приветствием: «Китай · набор на сентябрь 2027 года» (HomeHeroContent, веб). Набор пишется со строчной
 * буквы (на кириллице `toLowerCase` и `toLocaleLowerCase` совпадают); нет набора - одна страна; нет страны - строки нет.
 */
export function heroSub(input: Readonly<{ studyCountry: string | null; intake: string | null; home: PortalStrings<"home"> }>): string | null {
  const { studyCountry, intake, home } = input;
  if (studyCountry && intake) return formatPortalString(home.heroIntake, { country: studyCountry, intake: intake.charAt(0).toLowerCase() + intake.slice(1) });
  return studyCountry;
}

/** Тон пилюли срока дела: просрочено - «опасно», сегодня и завтра - «внимание», дальше - нейтрально. */
export type DueTone = "danger" | "warn" | "neutral";

/**
 * Срок дела словом в пилюле (DueStatus, HomeCase.tsx, веб #1489). Дни считаются по календарю Бишкека, как «Ближайшие
 * даты». Срок, прошедший сегодня по часам, уже «просрочено» (как у сервера и на «Оплате»: due_at раньше текущего момента).
 */
export function homeDueStatus(dueAt: string, now: Date, lang: Lang, home: PortalStrings<"home">): Readonly<{ label: string; tone: DueTone }> {
  const days = homeDaysUntil(bishkekDay(dueAt), todayForTimeline(now));
  const passed = Date.parse(dueAt) < now.getTime();
  if (days >= 0 && passed) return { label: home.dateOverdueNow, tone: "danger" };
  return { label: homeDaysLabel(days, lang, home), tone: days < 0 ? "danger" : days <= 1 ? "warn" : "neutral" };
}

/** Сколько дел видно на карточке: первое - кнопкой, следующие строками; остальные - «Ещё действий: N» (HOME_CASE_ROWS, веб). */
export const HOME_CASE_ROWS = 3;

export function caseRows(overview: StudentPortalOverview | null) {
  return {
    primary: overview?.studentAction ?? null,
    next: overview ? overview.studentActions.slice(1, HOME_CASE_ROWS) : [],
    remaining: overview ? Math.max(0, overview.studentActions.length - HOME_CASE_ROWS) : 0,
  };
}

/** Своя анкета студента до договора (tier approved): статус и даты отметок «Ваша анкета». */
export type HomeApplication = Readonly<{ status: "pending" | "approved" | "rejected"; submittedAt: string; decidedAt: string | null }>;

export type ApplicationStep = Readonly<{ kind: "done" | "current"; text: string; date: string | null }>;

/**
 * Отметки карточки «Ваша анкета» (HomeView.tsx, веб #1489): «Анкета отправлена» и «Анкета одобрена» с датами из своей
 * анкеты, затем текущий шаг «Менеджер свяжется с вами» без срока. Анкеты нет или она не прочиталась - одна текущая
 * отметка. Дата - «10 нояб.», другой год - с годом.
 */
export function applicationSteps(application: HomeApplication | null, now: Date, lang: Lang, home: PortalStrings<"home">): ApplicationStep[] {
  const year = todayForTimeline(now).slice(0, 4);
  const stepDate = (iso: string) => {
    const day = bishkekDay(iso);
    const short = homeDayMonth(day, lang);
    return day.slice(0, 4) === year ? short : `${short} ${day.slice(0, 4)}`;
  };
  return [
    ...(application ? [{ kind: "done" as const, text: home.applicationSent, date: stepDate(application.submittedAt) }] : []),
    ...(application?.status === "approved" && application.decidedAt ? [{ kind: "done" as const, text: home.applicationApproved, date: stepDate(application.decidedAt) }] : []),
    { kind: "current" as const, text: home.applicationManagerStep, date: null },
  ];
}

/** Сегодняшний день Бишкека (YYYY-MM-DD). */
export const homeToday = (now: Date): string => todayForTimeline(now);

/** Сколько последних событий видно на «Главной»; вся лента во «Входящих». */
export const HOME_NEWS_LIMIT = 3;
/** Сколько избранных вузов видно на «Главной». */
export const HOME_FAVORITES_LIMIT = 4;
/** Один запрос избранного на Главную и Поступление; Главная показывает первые HOME_FAVORITES_LIMIT. */
export const FAVORITES_QUERY_LIMIT = 120;

export type HomeNewsView = Readonly<{ items: readonly StudentPortalNotification[]; unread: number }>;

export function latestNews(notifications: readonly StudentPortalNotification[], limit = HOME_NEWS_LIMIT): HomeNewsView {
  return {
    items: [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
    unread: notifications.filter((item) => item.readAt === null).length,
  };
}
