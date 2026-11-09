import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalOverview } from "@/lib/v3/portal-source";

import { actionHref, actionTitle } from "./HomeCase";

/**
 * Датированные пункты студента — одни для «Ближайших дат» на «Главной» и для раздела «Календарь» (09.11.2026):
 * сроки дел от менеджера и ближайший дедлайн или старт избранных вузов. Только то, что уже прочитано; своих дат нет.
 */
export function studentDateItems({ overview, favorites, locale, now }: Readonly<{
  overview: StudentPortalOverview | null;
  favorites: readonly PublishedUniversity[] | null;
  locale: Locale;
  now: Date;
}>): HomeDateItem[] {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  return [
    ...(overview?.studentActions ?? []).flatMap((action) => action.dueAt
      ? [{ day: bishkekDay(action.dueAt), title: actionTitle(action, admission), href: actionHref(action) }]
      : []),
    ...(favorites ?? []).flatMap((item) => {
      const nearest = nearestUniversityIntake(item.content, now);
      if (nearest === null || nearest.kind === "startMonth") return [];
      const template = nearest.kind === "deadline" ? strings.dateDeadline : strings.dateStart;
      return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: `/portal/universities/${item.id}` }];
    }),
  ];
}
