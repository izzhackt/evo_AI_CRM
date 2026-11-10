import { notFound } from "next/navigation";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { UniversitiesMapSummary } from "@/components/portal/universities/Catalog";
import { UniversitiesMapView } from "@/components/portal/universities/MapView";
import {
  Breadcrumbs,
  CityCards,
  PlaceHero,
  UnavailableNotice,
  placeCountsLabel,
  type CityCardModel,
} from "@/components/portal/universities/Places";
import { UniversityTileGrid } from "@/components/portal/universities/UniversityTile";
import { UniversitySearch } from "@/components/portal/universities/UniversitySearch";
import { EmptyIcon } from "@/components/portal/home/HomeParts";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  cityHref,
  countForm,
  countryCities,
  countryCodeFromSlug,
  countryUniversityGroups,
  countryViewFromQuery,
  countryHref,
  citySearchText,
  countryUniversitiesWithoutCity,
  localizedText,
  UNIVERSITIES_BASE,
  type StudentUniversityIndex,
} from "@/lib/portal/university-index";
import { readStudentUniversityIndex } from "@/lib/portal/university-index-source";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { universityGeo } from "@/lib/portal/university-geo";
import type { UniversityMapPin } from "@/lib/portal/universities";
import {
  PLACE_CARD_WIDTHS,
  PLACE_HERO_WIDTHS,
  indexTileModel,
  placePhoto,
  tileStrings,
  universityPlace,
} from "@/lib/portal/university-tiles";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/**
 * Страна (S3, план 7.3): шапка с фото и текстом, «Города / Списком / Карта», карточки
 * городов (больше вузов выше, затем по названию) и «Другие вузы страны» для
 * вузов без опубликованного города: ни один вуз страны не пропадает
 * (приёмка 7.6.2). Карта страны (`?view=map`): те же точки MapLibre с
 * кластерами; вуз без проверенной координаты считается в строке под картой.
 * «Списком» (`?view=list`): все вузы страны на одной странице по городам
 * (города А→Я, вузы внутри А→Я), без города: последней группой.
 */
export default async function CountryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, route, query, locale] = await Promise.all([
    requireStudentPortalActor(),
    params,
    searchParams,
    getLocale(),
  ]);
  const code = countryCodeFromSlug(route.code) ?? notFound();
  const keys = Object.keys(query).filter((key) => query[key] !== undefined);
  const view = countryViewFromQuery(query.view);
  // `q`: поиск по городам и вузам страны, только на экране городов.
  const search = typeof query.q === "string" ? query.q : "";
  if (keys.some((key) => key !== "view" && key !== "q") || view === null
    || (keys.includes("q") && (view !== "cities" || typeof query.q !== "string" || search.length > 100 || /[\u0000-\u001f\u007f]/u.test(search)))) notFound();
  const strings = getPortalStrings("universities", locale);
  const now = new Date();

  const [index, favoriteIds] = await Promise.all([
    readStudentUniversityIndex(actor).catch((): StudentUniversityIndex | null => null),
    view === "map" ? null : readStudentUniversityFavorites()
      .then((favorites) => favorites.map((favorite) => favorite.institutionId))
      .catch(() => null),
  ]);
  if (index === null) {
    return (
      <main className="pt-page pt-atlas">
        <Breadcrumbs crumbs={[{ label: strings.title, href: UNIVERSITIES_BASE }]} label={strings.breadcrumbAria} />
        <UnavailableNotice strings={strings} href={countryHref(code, view)} />
      </main>
    );
  }
  const country = index.countries.find((entry) => entry.code === code) ?? notFound();
  const name = localizedText(country.name, locale);
  const cities = countryCities(index, code, locale);
  // Город без фото карточкой не показывается (приёмка 7.6.3), его вузы
  // остаются в «Других вузах страны».
  const hiddenCities = new Set<string>();
  const cityCards: CityCardModel[] = cities.flatMap((city) => {
    const photo = placePhoto(city.photo, PLACE_CARD_WIDTHS);
    if (photo === null) hiddenCities.add(city.key);
    return photo === null ? [] : [{
      key: city.key,
      name: localizedText(city.name, locale),
      href: cityHref(code, city.key),
      count: placeCountsLabel(strings, city.universityCount, null, countForm),
      summary: localizedText(city.summary, locale),
      fact: locale === "ky" ? city.fact.ky : city.fact.ru,
      photo,
      search: citySearchText(city),
    }];
  });
  const others = [
    ...countryUniversitiesWithoutCity(index, code),
    ...index.universities.filter((item) => item.cityKey !== null && hiddenCities.has(item.cityKey)),
  ];

  let map: Readonly<{ pins: UniversityMapPin[]; missing: number }> | null = null;
  if (view === "map") {
    const pins: UniversityMapPin[] = [];
    let missing = 0;
    for (const item of index.universities) {
      if (item.country !== code) continue;
      const geo = universityGeo(item.photoKey);
      if (geo === null) {
        missing += 1;
        continue;
      }
      pins.push({ id: item.id, name: item.name, place: universityPlace(index, item, locale), lat: geo.lat, lng: geo.lng });
    }
    map = { pins, missing };
  }

  return (
    <main className="pt-page pt-atlas">
      <Breadcrumbs
        crumbs={[{ label: strings.title, href: UNIVERSITIES_BASE }, { label: name, href: null }]}
        label={strings.breadcrumbAria}
      />
      <PlaceHero
        title={name}
        counts={country.universityCount > 0
          ? placeCountsLabel(strings, country.universityCount, country.cityCount, countForm)
          : strings.countryNoUniversities}
        photo={placePhoto(country.photo, PLACE_HERO_WIDTHS)}
        strings={strings}
        compact={view !== "cities"}
      >
        {country.summary && view === "cities" ? <p className="pt-place-summary">{localizedText(country.summary, locale)}</p> : null}
      </PlaceHero>

      {country.universityCount === 0 ? (
        <section className="pt-empty">
          <EmptyIcon name="universities" />
          <h2 className="pt-empty-title">{strings.countryEmptyTitle}</h2>
          <p className="pt-empty-body">{strings.countryEmptyBody}</p>
          <p>
            <IntentPrefetchLink href={UNIVERSITIES_BASE} className="pt-btn-ghost">{strings.allCountries}</IntentPrefetchLink>
          </p>
        </section>
      ) : (
        <>
          <nav aria-label={strings.viewAria} className="pt-view-toggle pt-place-toggle">
            <IntentPrefetchLink
              href={countryHref(code)}
              aria-current={view === "cities" ? "page" : undefined}
              className="pt-view-toggle-link"
            >
              {strings.viewCities}
            </IntentPrefetchLink>
            <IntentPrefetchLink
              href={countryHref(code, "list")}
              aria-current={view === "list" ? "page" : undefined}
              className="pt-view-toggle-link"
            >
              {strings.viewList}
            </IntentPrefetchLink>
            <IntentPrefetchLink
              href={countryHref(code, "map")}
              aria-current={view === "map" ? "page" : undefined}
              className="pt-view-toggle-link"
            >
              {strings.viewMap}
            </IntentPrefetchLink>
          </nav>

          {map !== null ? (
            <>
              <UniversitiesMapView
                pins={map.pins}
                base={UNIVERSITIES_BASE}
                listHref={countryHref(code)}
                strings={strings}
              />
              <UniversitiesMapSummary shown={map.pins.length} missing={map.missing} strings={strings} />
            </>
          ) : view === "list" ? (
            <div className="pt-list-groups">
              <h2 className="pt-sr-only">{strings.listHeading}</h2>
              {countryUniversityGroups(index, code, locale).map((group, position) => {
                const title = group.city === null ? strings.listNoCity : localizedText(group.city.name, locale);
                const headingId = `portal-list-${group.city?.key ?? "no-city"}`;
                // Страница города без фото даёт 404: такой заголовок остаётся текстом.
                const linked = group.city !== null && !hiddenCities.has(group.city.key);
                return (
                  <section key={headingId} aria-labelledby={headingId} className="pt-place-section pt-list-group">
                    <h3 id={headingId} className="pt-section-title pt-list-group-title">
                      {linked && group.city !== null ? (
                        <IntentPrefetchLink href={cityHref(code, group.city.key)} className="pt-list-city-link">{title}</IntentPrefetchLink>
                      ) : title}
                      <span className="pt-list-group-count">{placeCountsLabel(strings, group.universities.length, null, countForm)}</span>
                    </h3>
                    <UniversityTileGrid
                      models={group.universities.map((item) => indexTileModel(index, item, { strings, locale, now, favoriteIds, showPlace: false }))}
                      strings={tileStrings(strings)}
                      priorityCount={position === 0 ? 3 : 0}
                      headingLevel={4}
                    />
                  </section>
                );
              })}
            </div>
          ) : (
            <UniversitySearch
              items={index.universities
                .filter((item) => item.country === code)
                .map((item) => indexTileModel(index, item, { strings, locale, now, favoriteIds, showPlace: true }))}
              cities={cityCards}
              initialQuery={search}
              action={countryHref(code)}
              strings={{
                ...tileStrings(strings),
                searchLabel: strings.searchLabel,
                searchPlaceholder: strings.searchPlaceholder,
                searchClear: strings.searchClear,
                searchFound: strings.searchFound,
                searchEmptyTitle: strings.searchEmptyTitle,
                searchEmptyBody: strings.searchEmptyBody,
                universitiesHeading: strings.universitiesHeading,
                citiesHeading: strings.citiesHeading,
                cityFactLabel: strings.cityFactLabel,
              }}
            >
              {cityCards.length > 0 ? (
                <section aria-labelledby="portal-cities-heading" className="pt-place-section">
                  <h2 id="portal-cities-heading" className="pt-sr-only">{strings.citiesHeading}</h2>
                  <CityCards cities={cityCards} strings={strings} label={strings.citiesHeading} />
                </section>
              ) : null}
              {others.length > 0 ? (
                <section aria-labelledby="portal-other-universities" className="pt-place-section">
                  <h2 id="portal-other-universities" className="pt-section-title">{strings.otherUniversitiesHeading}</h2>
                  <p className="pt-place-section-lead">{strings.otherUniversitiesLead}</p>
                  <UniversityTileGrid
                    models={others.map((item) => indexTileModel(index, item, { strings, locale, now, favoriteIds, showPlace: true }))}
                    strings={tileStrings(strings)}
                    priorityCount={cityCards.length > 0 ? 0 : 3}
                  />
                </section>
              ) : null}
            </UniversitySearch>
          )}
        </>
      )}
    </main>
  );
}
