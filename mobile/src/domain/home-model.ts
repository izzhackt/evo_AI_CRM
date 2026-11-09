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

export type HomeSlotId = "case" | "path" | "universities" | "dates" | "news" | "csca";

/**
 * Блоки «Главной» в порядке телефона: «Что сделать сейчас» (у approved «Ваша анкета»),
 * путь страны (только когда страна выбрана), «Мои вузы», даты, «Что нового» (только
 * assisted), CSCA (только карточка для Китая). Выбор страны и шапка стоят выше этого списка.
 */
export function homeSlots(input: Readonly<{ tier: AccessTier; hasJourney: boolean; hasCscaCard: boolean }>): readonly HomeSlotId[] {
  const slots: HomeSlotId[] = ["case"];
  if (input.hasJourney) slots.push("path");
  slots.push("universities", "dates");
  if (input.tier === "assisted") slots.push("news");
  if (input.hasCscaCard) slots.push("csca");
  return slots;
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

export type HomeNewsView = Readonly<{ items: readonly StudentPortalNotification[]; unread: number }>;

export function latestNews(notifications: readonly StudentPortalNotification[], limit = HOME_NEWS_LIMIT): HomeNewsView {
  return {
    items: [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
    unread: notifications.filter((item) => item.readAt === null).length,
  };
}
