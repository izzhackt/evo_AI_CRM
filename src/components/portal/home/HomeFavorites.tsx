import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityMonthLabel,
} from "@/lib/portal/universities";

import { HomeCardHead, HomeEmpty } from "./HomeParts";

type UniversitiesStrings = PortalStrings<"universities">;

function nearestIntakeText(item: PublishedUniversity, strings: UniversitiesStrings, locale: Locale, now: Date): string {
  const nearest = nearestUniversityIntake(item.content, now);
  if (nearest === null) return strings.intakeDatesPending;
  if (nearest.kind === "deadline") {
    return formatPortalString(strings.intakeDeadlineByDate, { date: universityDateLabel(nearest.value, locale) });
  }
  return formatPortalString(strings.intakeStartFromDate, {
    date: nearest.kind === "start" ? universityDateLabel(nearest.value, locale) : universityMonthLabel(nearest.value, locale),
  });
}

/**
 * «Мои вузы» на «Главной»: первые записи избранного с ближайшим набором; полный список — вкладка «Вузы» на
 * «Поступлении». 08.11.2026 (по образцу пользователя): карточка в левой колонке, пустое состояние со значком и
 * кнопкой в каталог. `null` — чтение не удалось (честная плашка).
 */
export function HomeFavorites({ favorites, total, locale, now }: Readonly<{
  favorites: readonly PublishedUniversity[] | null;
  total: number;
  locale: Locale;
  now: Date;
}>) {
  const strings = getPortalStrings("home", locale);
  const favoritesStrings = getPortalStrings("favorites", locale);
  const universitiesStrings = getPortalStrings("universities", locale);

  return (
    <section aria-labelledby="home-favorites" className="pt-card pt-home-box pt-home-favorites">
      <HomeCardHead
        id="home-favorites"
        title={strings.favoritesHeading}
        count={favorites === null ? null : total}
        action={favorites !== null && total > 0 ? (
          <IntentPrefetchLink className="pt-link" href="/portal">{strings.favoritesAll}</IntentPrefetchLink>
        ) : null}
      />
      {favorites === null ? (
        <p role="alert" className="pt-alert">{favoritesStrings.unavailable}</p>
      ) : favorites.length === 0 ? (
        <HomeEmpty
          icon="universities"
          title={favoritesStrings.emptyTitle}
          body={favoritesStrings.emptyBody}
          action={(
            <IntentPrefetchLink href="/portal/universities" className="pt-btn-ghost">
              {favoritesStrings.emptyAction}
            </IntentPrefetchLink>
          )}
        />
      ) : (
        <ul className="pt-home-fav-list">
          {favorites.map((item) => (
            <li key={item.id}>
              <IntentPrefetchLink href={`/portal/universities/${item.id}`} className="pt-home-fav-row">
                <span className="pt-home-fav-main">
                  <span className="pt-home-fav-name">{item.content.name}</span>
                  <span className="pt-home-fav-place">
                    {universityCountryLabel(item.content.country, locale)}
                    {item.content.city ? ` · ${item.content.city}` : ""}
                  </span>
                </span>
                <span className="pt-home-fav-intake">
                  {universitiesStrings.nearestIntake}
                  {": "}
                  <span className="pt-data">{nearestIntakeText(item, universitiesStrings, locale, now)}</span>
                </span>
              </IntentPrefetchLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
