import { notFound } from "next/navigation";

import { Breadcrumbs, PlaceHero, UnavailableNotice, placeCountsLabel } from "@/components/portal/universities/Places";
import { UniversityTileGrid } from "@/components/portal/universities/UniversityTile";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  cityHref,
  cityUniversities,
  countForm,
  countryCodeFromSlug,
  countryHref,
  localizedText,
  UNIVERSITIES_BASE,
  type StudentUniversityIndex,
} from "@/lib/portal/university-index";
import { readStudentUniversityIndex } from "@/lib/portal/university-index-source";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { PLACE_HERO_WIDTHS, indexTileModel, placePhoto, tileStrings } from "@/lib/portal/university-tiles";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/**
 * Город (S3, план 7.3): шапка с фото и текстом, самый интересный факт со
 * ссылкой «Источник» и карточки вузов города (фото, уровни, ближайший набор,
 * сердечко). Город показывается только опубликованным и полным: другой адрес
 * 404, как прочие неверные адреса каталога.
 */
export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, route, query, locale] = await Promise.all([
    requireStudentPortalActor(),
    params,
    searchParams,
    getLocale(),
  ]);
  const code = countryCodeFromSlug(route.code) ?? notFound();
  if (Object.keys(query).some((key) => query[key] !== undefined)) notFound();
  const strings = getPortalStrings("universities", locale);
  const now = new Date();

  const [index, favoriteIds] = await Promise.all([
    readStudentUniversityIndex(actor).catch((): StudentUniversityIndex | null => null),
    readStudentUniversityFavorites()
      .then((favorites) => favorites.map((favorite) => favorite.institutionId))
      .catch(() => null),
  ]);
  if (index === null) {
    return (
      <main className="pt-page pt-atlas">
        <Breadcrumbs crumbs={[{ label: strings.title, href: UNIVERSITIES_BASE }]} label={strings.breadcrumbAria} />
        <UnavailableNotice strings={strings} href={cityHref(code, route.city)} />
      </main>
    );
  }
  const country = index.countries.find((entry) => entry.code === code) ?? notFound();
  const city = index.cities.find((entry) => entry.key === route.city && entry.country === code) ?? notFound();
  const photo = placePhoto(city.photo, PLACE_HERO_WIDTHS) ?? notFound();
  const name = localizedText(city.name, locale);
  const universities = cityUniversities(index, city.key);

  return (
    <main className="pt-page pt-atlas">
      <Breadcrumbs
        crumbs={[
          { label: strings.title, href: UNIVERSITIES_BASE },
          { label: localizedText(country.name, locale), href: countryHref(code) },
          { label: name, href: null },
        ]}
        label={strings.breadcrumbAria}
      />
      <PlaceHero
        title={name}
        counts={placeCountsLabel(strings, city.universityCount, null, countForm)}
        photo={photo}
        strings={strings}
      >
        <p className="pt-place-summary">{localizedText(city.summary, locale)}</p>
        <aside className="pt-place-fact" aria-labelledby="portal-city-fact">
          <h2 id="portal-city-fact" className="pt-place-fact-label">{strings.cityFactLabel}</h2>
          <p className="pt-place-fact-text">{locale === "ky" ? city.fact.ky : city.fact.ru}</p>
          <a href={city.fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="pt-link pt-place-fact-source">
            {strings.factSource}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
        </aside>
      </PlaceHero>

      <section aria-labelledby="portal-city-universities" className="pt-place-section">
        <h2 id="portal-city-universities" className="pt-section-title">{strings.cityUniversitiesHeading}</h2>
        <UniversityTileGrid
          models={universities.map((item) => indexTileModel(index, item, { strings, locale, now, favoriteIds, showPlace: false }))}
          strings={tileStrings(strings)}
          priorityCount={2}
        />
      </section>
    </main>
  );
}
