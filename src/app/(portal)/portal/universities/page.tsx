import { notFound, redirect } from "next/navigation";

import { CountryCards, UnavailableNotice, placeCountsLabel, type CountryCardModel } from "@/components/portal/universities/Places";
import { UniversitySearch } from "@/components/portal/universities/UniversitySearch";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  countForm,
  countryHref,
  localizedText,
  resolveUniversitiesRoute,
  UNIVERSITIES_BASE,
  type StudentUniversityIndex,
} from "@/lib/portal/university-index";
import { readStudentUniversityIndex } from "@/lib/portal/university-index-source";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { PLACE_CARD_WIDTHS, indexTileModel, placePhoto, tileStrings } from "@/lib/portal/university-tiles";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/**
 * «Университеты» (S3, план 7.3): шесть карточек стран и поиск по названию по
 * всем странам. Данные: один индекс каталога (серверный кэш по версии,
 * выдаётся только после проверки доступа в RPC); избранное читается
 * параллельно и нужно только карточкам найденных вузов. Прежние адреса
 * списка и карты (`?view=`, `?country=`, `?level=`, `?offset=`) ведут на
 * новые экраны.
 */
export default async function UniversitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, params, locale] = await Promise.all([
    requireStudentPortalActor(),
    searchParams,
    getLocale(),
  ]);
  const route = resolveUniversitiesRoute(params);
  if (route.kind === "invalid") notFound();
  if (route.kind === "redirect") redirect(route.href);
  const strings = getPortalStrings("universities", locale);
  const now = new Date();

  const [index, favoriteIds] = await Promise.all([
    readStudentUniversityIndex(actor).catch((): StudentUniversityIndex | null => null),
    // Сбой избранного не роняет каталог: сердечко честно скрывается (PORT-3b).
    readStudentUniversityFavorites()
      .then((favorites) => favorites.map((favorite) => favorite.institutionId))
      .catch(() => null),
  ]);

  const header = (
    <header className="pt-page-header">
      <h1 className="pt-page-title">{strings.title}</h1>
      <p className="pt-page-lead">{strings.lead}</p>
    </header>
  );

  if (index === null) {
    return (
      <main className="pt-page pt-atlas">
        {header}
        <UnavailableNotice strings={strings} href={UNIVERSITIES_BASE} />
      </main>
    );
  }

  const countries: CountryCardModel[] = index.countries.map((country) => ({
    code: country.code,
    name: localizedText(country.name, locale),
    href: countryHref(country.code),
    counts: country.universityCount > 0
      ? placeCountsLabel(strings, country.universityCount, country.cityCount, countForm)
      : strings.countryNoUniversities,
    photo: placePhoto(country.photo, PLACE_CARD_WIDTHS),
  }));
  const searchItems = index.universities.map((item) =>
    indexTileModel(index, item, { strings, locale, now, favoriteIds, showPlace: true }));

  return (
    <main className="pt-page pt-atlas">
      {header}
      <UniversitySearch
        items={searchItems}
        initialQuery={route.query}
        action={UNIVERSITIES_BASE}
        strings={{
          ...tileStrings(strings),
          searchLabel: strings.searchLabel,
          searchPlaceholder: strings.searchPlaceholder,
          searchClear: strings.searchClear,
          searchFound: strings.searchFound,
          searchEmptyTitle: strings.searchEmptyTitle,
          searchEmptyBody: strings.searchEmptyBody,
        }}
        favorites={{ href: "/portal/favorites", label: strings.favoritesLink }}
      >
        <section aria-labelledby="portal-countries-heading">
          <h2 id="portal-countries-heading" className="pt-sr-only">{strings.countriesHeading}</h2>
          <CountryCards countries={countries} strings={strings} label={strings.countriesHeading} />
        </section>
      </UniversitySearch>
    </main>
  );
}
