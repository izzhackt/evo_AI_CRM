import Link from "next/link";

import { FavoritesView } from "@/components/portal/favorites/FavoritesView";
import { UniversityCard } from "@/components/portal/universities/Catalog";
import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import {
  readStudentHiddenUniversityFavorites,
  readStudentUniversitiesByIds,
} from "@/lib/portal/university-favorites-source";

/**
 * Избранные вузы (PORT-3b, план §6 «Избранное», дизайн-контракт §5) — с
 * 03.11.2026 вкладка «Вузы» на «Моём поступлении»: сохранённые вузы из RPC
 * миграции 195 (только свои записи актора) и сравнение фактических свойств
 * выбранных. Пустое состояние честное; сбой чтения — честная ошибка, не пустой
 * список. `institutionIds` — уже прочитанное избранное страницы (`null` — сбой).
 */
export async function FavoritesSection({ institutionIds, locale }: Readonly<{
  institutionIds: readonly string[] | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("favorites", locale);
  const universitiesStrings = getPortalStrings("universities", locale);
  const now = new Date();

  // 282: избранные вузы стран вне списка продукта не показываются; строка
  // «Больше нет в каталоге: N» говорит о них. Её сбой не прячет список.
  const hidden = readStudentHiddenUniversityFavorites().catch(() => 0);
  let items: readonly PublishedUniversity[] | null = null;
  if (institutionIds !== null) {
    try {
      items = await readStudentUniversitiesByIds(institutionIds);
    } catch {
      items = null;
    }
  }
  const hiddenCount = await hidden;

  return (
    <>
      {items !== null && hiddenCount > 0 ? (
        <p className="pt-page-lead">{formatPortalString(strings.hiddenCount, { count: String(hiddenCount) })}</p>
      ) : null}
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
    </>
  );
}
