import Link from "next/link";

import { FavoritesView } from "@/components/portal/favorites/FavoritesView";
import { UniversityCard } from "@/components/portal/universities/Catalog";
import { getLocale } from "@/lib/i18n";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  readStudentUniversitiesByIds,
  readStudentUniversityFavorites,
} from "@/lib/portal/university-favorites-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/**
 * Раздел «Избранное» (PORT-3b, план §6 «Избранное», дизайн-контракт §5):
 * сохранённые вузы из RPC миграции 195 (только свои записи актора) и
 * сравнение фактических свойств выбранных. Пустое состояние честное; сбой
 * чтения — честная ошибка, не пустой список.
 */
export default async function FavoritesPage() {
  const [, locale] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
  ]);
  const strings = getPortalStrings("favorites", locale);
  const universitiesStrings = getPortalStrings("universities", locale);
  const now = new Date();

  let items: readonly PublishedUniversity[] | null = null;
  try {
    const favorites = await readStudentUniversityFavorites();
    items = await readStudentUniversitiesByIds(
      favorites.map((favorite) => favorite.institutionId),
    );
  } catch {
    items = null;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>
      {items === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : items.length === 0 ? (
        <section className="pt-empty">
          <h2 className="pt-empty-title">{strings.emptyTitle}</h2>
          <p className="pt-empty-body">{strings.emptyBody}</p>
          <p>
            <Link href="/portal/universities" className="pt-btn">
              {strings.emptyAction}
            </Link>
          </p>
        </section>
      ) : (
        <FavoritesView
          items={items}
          cards={Object.fromEntries(items.map((item) => [item.id, (
            <UniversityCard
              key={item.id}
              item={item}
              base="/portal/universities"
              strings={universitiesStrings}
              locale={locale}
              now={now}
              favored
            />
          )]))}
          strings={strings}
          universitiesStrings={universitiesStrings}
          locale={locale}
          now={now}
        />
      )}
    </main>
  );
}
