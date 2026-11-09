// Сборка «Главной» из прочитанных источников: чистые правила порядка блоков, дат и
// новостей. Источник правил: src/components/portal/home/HomeView.tsx, HomeNews.tsx и
// стили `.pt-home-slot[data-slot]` в portal.css (веб #1412, 08.11.2026).
import { todayForTimeline } from "@web/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@web/lib/portal/home-dates";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import { nearestUniversityIntake } from "@web/lib/portal/universities";

import { actionTarget, actionTitle } from "@/domain/presentation";
import type { StudentPortalNotification, StudentPortalOverview } from "@/domain/portal-source";
import type { AccessTier } from "@/session/access";

export type HomeSlotId = "evo" | "case" | "path" | "write" | "dates" | "news" | "csca" | "list" | "fullPath";

/**
 * Блоки единственной «Главной» в порядке телефона (HomeView.tsx + `.pt-home-slot[data-slot]`
 * в portal.css, веб #1355): задача команды EVO (`info`, только когда она есть), «Что сделать
 * сейчас» (у approved одна «Ваша анкета»), карточка пути страны (когда страна выбрана), «Написать
 * EVO» (только assisted, #1356), даты, «Что нового» (только assisted), CSCA (карточка для
 * Китая), под ними «Мой список» (вкладки «Вузы» и «Мои программы») и весь «Путь поступления».
 * Выбор страны и шапка стоят выше этого списка.
 */
export function homeSlots(input: Readonly<{ tier: AccessTier; hasJourney: boolean; hasCscaCard: boolean; hasEvoTask: boolean }>): readonly HomeSlotId[] {
  const assisted = input.tier === "assisted";
  const slots: HomeSlotId[] = [];
  if (assisted && input.hasEvoTask) slots.push("evo");
  slots.push("case");
  if (input.hasJourney) slots.push("path");
  if (assisted) slots.push("write");
  slots.push("dates");
  if (assisted) slots.push("news");
  if (input.hasCscaCard) slots.push("csca");
  slots.push("list");
  if (input.hasJourney) slots.push("fullPath");
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

/**
 * Датированные пункты «Ближайших дат»: сроки действий дела и ближайший дедлайн или
 * старт избранного вуза (месяц старта без дня пропускается). Свои чтения и выдуманные
 * даты не добавляются.
 */
export function collectHomeDates(input: Readonly<{
  overview: StudentPortalOverview | null;
  favorites: readonly PublishedUniversity[] | null;
  admission: PortalStrings<"admission">;
  home: PortalStrings<"home">;
  now: Date;
}>): HomeDate[] {
  const fromActions = (input.overview?.studentActions ?? []).flatMap((action) => {
    if (!action.dueAt) return [];
    const target = actionTarget(action);
    return [{ day: bishkekDay(action.dueAt), title: actionTitle(action, input.admission), href: target.route }];
  });
  const fromFavorites = (input.favorites ?? []).flatMap((item) => {
    const nearest = nearestUniversityIntake(item.content, input.now);
    if (nearest === null || nearest.kind === "startMonth") return [];
    const template = nearest.kind === "deadline" ? input.home.dateDeadline : input.home.dateStart;
    return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: "/universities" }];
  });
  return [...fromActions, ...fromFavorites];
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
